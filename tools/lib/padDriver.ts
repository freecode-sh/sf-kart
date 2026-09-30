/**
 * A scripted, human-ish driver that produces the app's raw pads (input.ts RawPadState) from the
 * kart's pose, for recording test runs through the live path (Sim.step): pure-pursuit steering along
 * the centerline with mouse-like jitter on the stick, the drift button held through corners, hop
 * taps (tricks off the ramps), trick-key presses, stick up / down, the odd throttle lift and
 * speed-up use. Seeded, so a seed gives the same run. It doesn't need to be deterministic across
 * machines: the pads it makes are what gets recorded and replayed.
 *
 * Plain math, no DOM or Node APIs: tests/replay.test.ts runs it in Node, and the dev server serves
 * it to the page for runs recorded in the browser (see tools/verify.ts).
 */

export interface DriverPad {
    buttons: number;
    stickXRaw: number;
    stickYRaw: number;
    trick: number;
    explicitTrick?: boolean;
}

interface Station {
    s: number;
    pos: [number, number, number];
}

type XYZ = { x: number; y: number; z: number };

const ACCEL = 0x1;
const ITEM = 0x4;
const DRIFT = 0x8;

export class PadDriver {
    private seed: number;
    private idx = -1;
    private prev: XYZ | null = null;
    /** Frames left of: a throttle lift, the drift button, a hop tap, the stick up / down. */
    private lift = 0;
    private drift = 0;
    private tap = 0;
    private tilt = 0;
    private tiltY = 7;
    private item = 0;
    /** Mouse-like steering: a smoothed value with jitter on top. */
    private steer = 0;

    constructor(
        private readonly centerline: Station[],
        seed = 1,
    ) {
        this.seed = seed >>> 0 || 1;
    }

    private rnd(): number {
        // xorshift32
        let x = this.seed;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.seed = x >>> 0;
        return this.seed / 0x100000000;
    }

    private nearest(p: XYZ): number {
        const cl = this.centerline;
        const n = cl.length;
        const d2 = (i: number, y: boolean) => {
            const c = cl[i]!.pos;
            return (c[0] - p.x) * (c[0] - p.x) + (c[2] - p.z) * (c[2] - p.z) + (y ? (c[1] - p.y) * (c[1] - p.y) : 0);
        };
        if (this.idx >= 0) {
            let bi = this.idx;
            for (let k = -10; k <= 40; ++k) {
                const i = (((this.idx + k) % n) + n) % n;
                if (d2(i, false) < d2(bi, false)) bi = i;
            }
            // Lost (a respawn far away, a drop between stacked roads): search everything again.
            if (d2(bi, true) < 4000 * 4000) return (this.idx = bi);
        }
        let best = Infinity;
        for (let i = 0; i < n; ++i) {
            const d = d2(i, true);
            if (d < best) {
                best = d;
                this.idx = i;
            }
        }
        return this.idx;
    }

    /**
     * The pad for the next frame. `pos` / `fwd`: the kart after the last frame (Sim.kartPos,
     * Sim.kartForward); `racing`: past GO (Sim.racing), else the countdown.
     */
    pad(pos: XYZ, fwd: { x: number; z: number }, racing: boolean): DriverPad {
        const cl = this.centerline;
        const n = cl.length;
        const speed = this.prev ? Math.hypot(pos.x - this.prev.x, pos.z - this.prev.z) : 0;
        this.prev = { x: pos.x, y: pos.y, z: pos.z };
        let buttons = 0;
        let trick = 0;
        if (!racing) {
            // The countdown: on the throttle for the last second or so, fidgeting with the stick.
            if (this.rnd() < 0.02) this.steer = (this.rnd() - 0.5) * 0.6;
            const x = Math.max(0, Math.min(14, Math.round(7 + this.steer * 7)));
            return { buttons: this.rnd() < 0.6 ? ACCEL : 0, stickXRaw: x, stickYRaw: 7, trick: 0 };
        }

        // Pure pursuit to a point along the centerline ahead.
        let j = this.nearest(pos);
        const look = 700 + 11 * speed;
        for (let acc = 0, k = 0; acc < look && k < n; ++k) {
            const nx = (j + 1) % n;
            acc += Math.hypot(cl[nx]!.pos[0] - cl[j]!.pos[0], cl[nx]!.pos[2] - cl[j]!.pos[2]);
            j = nx;
        }
        let alpha = Math.atan2(cl[j]!.pos[0] - pos.x, cl[j]!.pos[2] - pos.z) - Math.atan2(fwd.x, fwd.z);
        alpha = ((alpha + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const want = Math.max(-1, Math.min(1, -4 * alpha));
        // A hand on a mouse: follows with a lag, overshoots a little, never quite still.
        this.steer += (want - this.steer) * (0.25 + this.rnd() * 0.2) + (this.rnd() - 0.5) * 0.22;
        this.steer = Math.max(-1, Math.min(1, this.steer));
        const stickXRaw = Math.max(0, Math.min(14, Math.round(7 + this.steer * 7)));

        // Throttle, with an occasional short lift.
        if (this.lift > 0) this.lift--;
        else if (this.rnd() < 0.002) this.lift = 6 + Math.floor(this.rnd() * 20);
        if (this.lift === 0 || speed < 30) buttons |= ACCEL;

        // Drift through the corners (the easy-drift layer turns held drift + steer into a drift).
        if (this.drift > 0) this.drift--;
        else if (Math.abs(alpha) > 0.22 && speed > 60 && this.rnd() < 0.3) this.drift = 20 + Math.floor(this.rnd() * 70);
        if (this.drift > 0 && Math.abs(alpha) < 0.04 && this.rnd() < 0.1) this.drift = 0;
        // Hop taps now and then: hops on the flat, tricks off the ramps.
        if (this.tap > 0) this.tap--;
        else if (this.rnd() < 0.012) this.tap = 1 + Math.floor(this.rnd() * 5);
        if (this.drift > 0 || this.tap > 0) buttons |= DRIFT;

        // Speed-ups: press the item button every so often.
        if (this.item > 0) {
            this.item--;
            buttons |= ITEM;
        } else if (this.rnd() < 0.003) this.item = 2 + Math.floor(this.rnd() * 6);

        // The trick key (Up, or a side trick with steering), a frame at a time.
        if (this.rnd() < 0.004) trick = 1;
        // Stick up / down for a moment (dive / lean back in the air).
        if (this.tilt > 0) this.tilt--;
        else if (this.rnd() < 0.004) {
            this.tilt = 10 + Math.floor(this.rnd() * 40);
            this.tiltY = this.rnd() < 0.5 ? 2 : 12;
        }
        return { buttons, stickXRaw, stickYRaw: this.tilt > 0 ? this.tiltY : 7, trick };
    }
}
