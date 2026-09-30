/**
 * The course's part in the rules: what the app layers on the engine from course_meta.json. The
 * speed-up pickups (pickups.ts) and the section splits (the frame the kart first entered each
 * section of the lap), both after every frame from the kart's position. Sim.step runs them, so live
 * play, run replays and the verifier (resim.ts) collect the same pickups and time the same splits.
 *
 * Plain arithmetic (no Math.hypot / pow / trig), so every JS engine gives the same result.
 */

import { PickupField, pickupRows, type PickupStation } from './pickups';

/** The course_meta.json fields the rules read (and rulesHash hashes). */
export interface RulesMeta {
    laps: number;
    length: number;
    segments: Record<string, [number, number]>;
    centerline: PickupStation[];
}

type XYZ = { x: number; y: number; z: number };

/**
 * The kart's course S (distance along the centerline, 0..length): the nearest station (a window
 * around the last one, everything when far off), then the projection onto the segment to the next
 * or previous station. The HUD follows the kart the same way (main.ts).
 */
export class CourseTracker {
    /** The nearest centerline station after the last update. */
    station = 0;

    constructor(private readonly meta: { centerline: { s: number; pos: [number, number, number] }[]; length: number }) {}

    reset(): void {
        this.station = 0;
    }

    update(p: XYZ): number {
        const cl = this.meta.centerline;
        const n = cl.length;
        const L = this.meta.length;
        let best = this.station;
        let bd = Infinity;
        const scan = (i: number) => {
            const c = cl[(i + n) % n]!.pos;
            const dx = c[0] - p.x;
            const dz = c[2] - p.z;
            const dy = (c[1] - p.y) * 3;
            const d = dx * dx + dz * dz + dy * dy;
            if (d < bd) {
                bd = d;
                best = (i + n) % n;
            }
        };
        for (let k = -40; k <= 40; ++k) scan(this.station + k);
        if (bd > 1600 * 1600) for (let i = 0; i < n; ++i) scan(i);
        this.station = best;
        const a = cl[best]!;
        for (const nb of [cl[(best + 1) % n]!, cl[(best - 1 + n) % n]!]) {
            const dx = nb.pos[0] - a.pos[0];
            const dz = nb.pos[2] - a.pos[2];
            const L2 = dx * dx + dz * dz;
            const t = L2 > 0 ? ((p.x - a.pos[0]) * dx + (p.z - a.pos[2]) * dz) / L2 : 0;
            if (t > 0 && t <= 1) {
                let ds = nb.s - a.s;
                if (ds < -L / 2) ds += L;
                if (ds > L / 2) ds -= L;
                return (a.s + t * ds + L) % L;
            }
        }
        return a.s;
    }
}

/** The course's sections (course_meta segments, in lap order) and the one at S (-1: none). */
export function sectionAt(meta: Pick<RulesMeta, 'segments'>, S: number): number {
    return Object.values(meta.segments).findIndex((r) => S >= r[0] && S < r[1]);
}

/**
 * Section splits: the frame the kart first entered each section during the race, in lap order
 * (a section counts once the one before it has: the course passes close to itself, e.g. under the
 * bridge, where the nearest station can briefly be a later section's).
 */
export class SectionSplits {
    private readonly track: CourseTracker;
    /** Per section (lap order): the frame it was first entered, 0 = not yet. */
    readonly entry: number[];
    private current = -1;

    constructor(private readonly meta: RulesMeta) {
        this.track = new CourseTracker(meta);
        this.entry = Object.keys(meta.segments).map(() => 0);
    }

    reset(): void {
        this.track.reset();
        this.entry.fill(0);
        this.current = -1;
    }

    /** After frame `frame`; `racing`: between GO and the finish. */
    update(pos: XYZ, frame: number, racing: boolean): void {
        const S = this.track.update(pos);
        if (!racing) return;
        const sec = sectionAt(this.meta, S);
        if (sec < 0 || sec === this.current) return;
        this.current = sec;
        if (!this.entry[sec] && (sec === 0 || this.entry[sec - 1])) this.entry[sec] = frame;
    }
}

/** The pickups and the splits of one course, as Sim.step runs them. */
export class CourseRules {
    readonly pickups: PickupField;
    readonly splits: SectionSplits;

    constructor(readonly meta: RulesMeta) {
        this.pickups = new PickupField(meta.centerline, pickupRows(meta.segments));
        this.splits = new SectionSplits(meta);
    }

    reset(): void {
        this.pickups.reset();
        this.splits.reset();
    }
}
