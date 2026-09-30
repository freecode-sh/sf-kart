/**
 * Closed-loop pure-pursuit bot. Drives a course through RaceSession (local player, manual drift, the
 * E-Bike from our vehicle data unless --vehicle picks another) by reading the kart pose every frame
 * and feeding raw (ghost-format) inputs to the host controller. Records the inputs (→ RKG ghost) and
 * collects events: laps, airtime (takeoff/landing), boosts (dash panel / trick / MT), jump pads,
 * respawns.
 *
 * Library:  runBot(files, meta, options) → BotResult
 * CLI:      npx tsx tools/course/botlap.ts <id> [--laps N] [--frames N] [--no-trick]
 *                                             [--vehicle ebike|robotaxi|buggy] [--rkg out.rkg]
 *
 * Steering: nearest centerline station (windowed search), lookahead point at
 * `look[0] + look[1] * speed` along the path shifted by a lateral offset,
 * stick = clamp(-steer * headingError).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Course, type Character, type Vehicle } from '../../src/Common';
import { KartObjectManager } from '../../src/game/kart/KartObjectManager';
import { eStatus } from '../../src/game/kart/Status';
import { RaceSession, type RaceSessionFiles } from '../../src/game/scene/RaceSession';
import { KPadHostController, type Trick } from '../../src/game/system/KPadController';
import { RaceManager, Stage } from '../../src/game/system/RaceManager';
import { DRIVER_SLOT, packVehicleFiles, vehicleSlot, type VehicleDataFile } from '../../src/app/vehicleData';
import { vehicleDef } from '../../src/app/vehicles';
import { buildRKG, type InputFrame } from '../ghost/rkg';

export type CenterlinePt = {
    s: number;
    pos: [number, number, number];
    right: [number, number, number];
    edges?: { wallL: number; roadL: number; roadR: number; wallR: number; island: number };
};
export type CourseMeta = {
    id: string;
    name: string;
    length: number;
    laps: number;
    centerline: CenterlinePt[];
    features: { type: string; s: [number, number]; pos: [number, number, number]; lat?: [number, number]; label?: string }[];
    respawns: { id: number; s: number; pos: [number, number, number]; angleDeg: number }[];
    checkpoints: { id: number; s: number; left: [number, number]; right: [number, number]; key: number; jugem: number }[];
    segments: Record<string, [number, number]>;
    [k: string]: unknown;
};

/**
 * Actions keyed by centerline S ranges [from, to] (wrap-around not supported; use two entries).
 * Add `laps: [..]` (1-based; 0 = before the first finish-line crossing) to restrict an action.
 */
export type BotAction = { laps?: number[]; /** Disable once the kart has respawned. */ untilRespawn?: boolean } & (
    | { from: number; to: number; action: 'offset'; value: number } // lateral target offset (+left)
    | { from: number; to: number; action: 'item' } // hold the item button (fires once per press)
    | { from: number; to: number; action: 'noaccel' }
    | { from: number; to: number; action: 'brake' }
    | { from: number; to: number; action: 'drift'; dir: 'L' | 'R' }
    | { from: number; to: number; action: 'wheelie' }
    | { from: number; to: number; action: 'look'; value: number }
    | { from: number; to: number; action: 'aim'; points: [number, number][] } // waypoints (x, z)
    | { from: number; to: number; action: 'stick'; value: number } // raw stick X 0..14
);

export type BotOptions = {
    /** Engine slots; default the course slot generated courses load into and the E-Bike's. */
    course?: Course;
    character?: Character;
    vehicle?: Vehicle;
    laps?: number; // stop after completing this many laps (default: meta.laps → race finish)
    maxFrames?: number; // hard cap (default 60 * 60 * 6)
    startBoost?: boolean; // default true
    autoTrick?: boolean; // trick up right after leaving trickable surfaces (default true)
    /** Hop + inside-drift through corners that turn more than `driftDeg` over the next 2500 units (default true). */
    autoDrift?: boolean;
    driftDeg?: number; // default 35
    look?: [number, number]; // default [600, 12]
    steer?: number; // default 4
    actions?: BotAction[];
    /** Only apply `actions` on these laps (1-based); default all. */
    actionLaps?: number[];
    /** Called after every frame (analysis hooks); return true to stop the run there. */
    onFrame?: (f: FrameInfo) => void | boolean;
};

export type FrameInfo = {
    frame: number;
    s: number;
    lat: number;
    lap: number;
    pos: [number, number, number];
    speed: number;
    airtime: number;
    ground: boolean;
    boost: boolean;
    status: (bit: eStatus) => boolean;
};

export type AirEvent = {
    lap: number;
    frame: number;
    takeoffS: number;
    takeoffSpeed: number;
    landS: number;
    frames: number;
    maxRise: number; // max height above the takeoff point
    trick: boolean;
    rampBoost: boolean;
    jumpPad: boolean;
    landedOnRoad: boolean; // landed without triggering a respawn and within the road edges
    landLat: number;
};
export type BoostEvent = { lap: number; frame: number; s: number; kind: 'mt' | 'panel/item' | 'trick'; speed: number };
export type RespawnEvent = {
    lap: number;
    frame: number;
    fallS: number;
    fallPos: [number, number, number];
    jugemId: number;
    respawnPos: [number, number, number];
    landedS: number;
    landedLat: number;
    landedOnRoad: boolean;
    framesToLand: number;
};
export type BotResult = {
    frames: number;
    raceFrames: number;
    finished: boolean;
    lapsCompleted: number;
    lapFrames: number[];
    inputs: InputFrame[];
    air: AirEvent[];
    boosts: BoostEvent[];
    respawns: RespawnEvent[];
    maxCheckpoint: number;
    checkpointsSeen: number;
    offroadFrames: number;
    /** Grounded frames with the kart outside the road's wall lines (e.g. in a shortcut fill). */
    offTrackFrames: number;
    wallFrames: number;
    minSpeedAfterStart: number;
    topSpeed: number;
};

export const INTRO_FRAMES = 172;
export const RACE_START_FRAME = INTRO_FRAMES + 240;
/** The engine course slot every generated course loads into (the app's too, src/app/sim.ts). */
export const COURSE_SLOT = Course.Luigi_Circuit;

/**
 * Number of countdown frames A must be held (ending on the last countdown frame) for the best
 * start boost: KartState::calcStartBoost charge must land in (0.94, 0.95]. Simulated in f32.
 */
export function bestStartBoostHold(): number {
    const fr = Math.fround;
    const D1 = fr(0.02);
    const D12 = fr(fr(0.02) - fr(0.002));
    const ok: number[] = [];
    // Inputs #0..#238 happen during the countdown.
    for (let n = 1; n < 239; ++n) {
        let c = 0;
        for (let k = 0; k < n; ++k) {
            c = fr(c + fr(D1 - fr(D12 * c)));
            c = Math.max(0, Math.min(1, c));
        }
        if (c > fr(0.94) && c <= fr(0.95)) ok.push(n);
    }
    if (!ok.length) throw new Error('no start boost window');
    return ok[Math.floor(ok.length / 2)]!;
}

/** Frames of A held at the end of the countdown for the best start boost. */
const START_BOOST_HOLD = bestStartBoostHold();

export const VEHICLE_DATA_FILE = join(import.meta.dirname, '../../public/data/vehicles/vehicles.json');

export function loadVehicleData(file = VEHICLE_DATA_FILE): VehicleDataFile {
    return JSON.parse(readFileSync(file, 'utf8')) as VehicleDataFile;
}

/** The engine's core files packed from our vehicle data (src/app/vehicleData.ts). */
export function vehicleCore(data = loadVehicleData()): Record<string, Uint8Array> {
    return Object.fromEntries(packVehicleFiles(data));
}

/** A course's files plus the core files (default: our vehicle data). */
export function loadCourseFiles(courseDir: string, core: Record<string, Uint8Array> = vehicleCore()): RaceSessionFiles {
    return {
        core,
        course: {
            'course.kcl': new Uint8Array(readFileSync(join(courseDir, 'course.kcl'))),
            'course.kmp': new Uint8Array(readFileSync(join(courseDir, 'course.kmp'))),
        },
    };
}

export function loadMeta(courseDir: string): CourseMeta {
    return JSON.parse(readFileSync(join(courseDir, 'course_meta.json'), 'utf8')) as CourseMeta;
}

export function runBot(files: RaceSessionFiles, meta: CourseMeta, o: BotOptions = {}): BotResult {
    const cl = meta.centerline;
    const n = cl.length;
    const L = meta.length;
    const look = o.look ?? [600, 12];
    const steerGain = o.steer ?? 4;
    const maxFrames = o.maxFrames ?? 60 * 60 * 6;
    const lapsTarget = o.laps ?? meta.laps;
    const autoTrick = o.autoTrick ?? true;
    const startBoost = o.startBoost ?? true;
    const autoDrift = o.autoDrift ?? true;
    const driftDeg = o.driftDeg ?? 35;
    // No auto-drifts near ramps, gaps and jump pads (approach and flight).
    const noDrift: [number, number][] = meta.features
        .filter((f) => ['ramp', 'boostRamp', 'gap', 'jumpPad'].includes(f.type))
        .map((f) => [f.s[0] - 3000, f.s[1] + 1500]);
    const yawAt = (i: number) => {
        const c = cl[i]!;
        return Math.atan2(c.right[2], -c.right[0]); // fwd = (right.z, 0, -right.x)
    };
    /** Signed heading change (radians, + = left) of the centerline over the next `dist` units. */
    const turnAhead = (i: number, dist: number) => {
        let j = i;
        let acc = 0;
        while (acc < dist) {
            const k = (j + 1) % n;
            acc += Math.hypot(cl[k]!.pos[0] - cl[j]!.pos[0], cl[k]!.pos[2] - cl[j]!.pos[2]);
            j = k;
        }
        let d = yawAt(j) - yawAt(i);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    };
    let autoDir = 0;

    const session = new RaceSession();
    session.init(files, {
        type: 'local',
        course: o.course ?? COURSE_SLOT,
        character: o.character ?? DRIVER_SLOT,
        vehicle: o.vehicle ?? vehicleSlot('ebike'),
        driftIsAuto: false,
    });
    const kart = KartObjectManager.Instance()!.object(0);
    const rm = RaceManager.Instance()!;
    const move = kart.move() as unknown as {
        m_boost: { m_active: boolean[]; m_timers: number[] };
        speed(): number;
        mtCharge(): number;
        kclSpeedFactor(): number;
    };

    let idx = -1;
    const nearest = (x: number, z: number) => {
        const d2 = (i: number) => (cl[i]!.pos[0] - x) ** 2 + (cl[i]!.pos[2] - z) ** 2;
        if (idx < 0) {
            // Global search in 3D (stacked roads share x/z); the kart hovers ~1000 above the road
            // while a respawn carries it, which doesn't matter at this scale.
            const y = kart.pos().y;
            let best = Infinity;
            for (let i = 0; i < n; ++i) {
                const d = d2(i) + (cl[i]!.pos[1] - y) ** 2;
                if (d < best) {
                    best = d;
                    idx = i;
                }
            }
        } else {
            let bi = idx;
            let best = d2(bi);
            for (let k = -10; k <= 40; ++k) {
                const i = (((idx + k) % n) + n) % n;
                if (d2(i) < best) {
                    best = d2(i);
                    bi = i;
                }
            }
            idx = bi;
        }
        return idx;
    };
    /** Arc length + lateral offset (+left) of (x, z) relative to station i. */
    const project = (i: number, x: number, z: number) => {
        const c = cl[i]!;
        // right = -left, left = (fwd.z, 0, -fwd.x) ⇒ fwd = (right.z, 0, -right.x)
        const fwdX = c.right[2];
        const fwdZ = -c.right[0];
        const dx = x - c.pos[0];
        const dz = z - c.pos[2];
        const along = dx * fwdX + dz * fwdZ;
        const lat = -(dx * c.right[0] + dz * c.right[2]);
        let s = c.s + along;
        if (s < 0) s += L;
        if (s >= L) s -= L;
        return { s, lat };
    };

    const inputs: InputFrame[] = [];
    const air: AirEvent[] = [];
    const boosts: BoostEvent[] = [];
    const respawns: RespawnEvent[] = [];
    const lapFrames: number[] = [];
    let prevButtons = 0;
    let driftStart = -1;
    let lastWheelie = -1000;
    let itemHeldPrev = false;
    let aimIdx = 0;
    let aimKey = '';
    let curAir: (AirEvent & { y0: number }) | null = null;
    let lastGroundTrickable = false;
    let curResp: (Partial<RespawnEvent> & { landWait: boolean }) | null = null;
    let prevBoost = [false, false, false];
    let prevTimers = [0, 0, 0];
    let prevLap = 0;
    let lapStartFrame = RACE_START_FRAME;
    let maxCheckpoint = 0;
    const seen = new Set<number>();
    let offroadFrames = 0;
    let offTrackFrames = 0;
    let wallFrames = 0;
    let minSpeedAfterStart = Infinity;
    let topSpeed = 0;
    let frame = 0;
    let finished = false;
    let lapsCompleted = 0;
    let s = 0;
    let lat = 0;

    const edgesAt = (i: number) => cl[i]!.edges ?? { wallL: 3000, roadL: 1600, roadR: -1600, wallR: -3000, island: 0 };

    while (frame < maxFrames) {
        const hc = session.hostController();
        const p = kart.pos();
        const status = kart.status();
        // After a respawn far from where the kart fell (e.g. a drop between stacked roads), the
        // windowed nearest-station search can stay locked onto the wrong stretch: search again.
        if (idx >= 0 && status.onBit(eStatus.InRespawn)) {
            const c = cl[nearest(p.x, p.z)]!;
            if (Math.hypot(c.pos[0] - p.x, c.pos[2] - p.z) > 4000 || Math.abs(c.pos[1] - p.y) > 4000) idx = -1;
        }
        const lap = rm.player().currentLap();
        const actionsOn = !o.actionLaps || o.actionLaps.includes(Math.max(1, lap));
        if (hc.isAcceptingInputs()) {
            const racing = frame + 1 >= RACE_START_FRAME;
            const i0 = nearest(p.x, p.z);
            const pr = project(i0, p.x, p.z);
            s = pr.s;
            let accel = racing || (startBoost && frame + 1 >= RACE_START_FRAME - START_BOOST_HOLD);
            let brake = false;
            let item = false;
            let driftDir = 0;
            let offset = 0;
            let lookOverride = 0;
            let fixedStick = -1;
            let wheelie = false;
            let aim: [number, number][] | null = null;
            let aimK = '';
            if (racing && actionsOn) {
                for (const a of o.actions ?? []) {
                    if (s < a.from || s > a.to) continue;
                    if (a.laps && !a.laps.includes(lap)) continue;
                    if (a.untilRespawn && respawns.length + (curResp ? 1 : 0) > 0) continue;
                    switch (a.action) {
                        case 'offset':
                            offset = a.value;
                            break;
                        case 'item':
                            item = true;
                            break;
                        case 'noaccel':
                            // Anti-stall: never coast to a standstill (keeps scenarios from hanging).
                            if (Math.abs(kart.speed()) > 8) accel = false;
                            break;
                        case 'brake':
                            // Anti-stall: brake to a crawl, never into reverse.
                            if (kart.speed() > 20) {
                                brake = true;
                                accel = false;
                            }
                            break;
                        case 'drift':
                            driftDir = a.dir === 'L' ? -1 : 1;
                            break;
                        case 'wheelie':
                            wheelie = true;
                            break;
                        case 'look':
                            lookOverride = a.value;
                            break;
                        case 'stick':
                            fixedStick = a.value;
                            break;
                        case 'aim':
                            aim = a.points;
                            aimK = `${a.from}:${a.to}`;
                            break;
                    }
                }
            }
            // Target point.
            const speed = Math.abs(kart.speed());
            let tx: number;
            let tz: number;
            if (aim && aimK !== aimKey) {
                aimKey = aimK;
                aimIdx = 0;
            }
            while (aim && aimIdx < aim.length && Math.hypot(aim[aimIdx]![0] - p.x, aim[aimIdx]![1] - p.z) < 1200) ++aimIdx;
            if (aim && aimIdx < aim.length) {
                tx = aim[aimIdx]![0] - p.x;
                tz = aim[aimIdx]![1] - p.z;
            } else {
                const lk = lookOverride > 0 ? lookOverride : look[0] + look[1] * speed;
                let j = i0;
                let acc = 0;
                for (let step = 0; step < n && acc < lk; ++step) {
                    const k = (j + 1) % n;
                    acc += Math.hypot(cl[k]!.pos[0] - cl[j]!.pos[0], cl[k]!.pos[2] - cl[j]!.pos[2]);
                    j = k;
                }
                const c = cl[j]!;
                // left = -right
                tx = c.pos[0] - c.right[0] * offset - p.x;
                tz = c.pos[2] - c.right[2] * offset - p.z;
            }
            const front = kart.bodyFront();
            const heading = Math.atan2(front.x, front.z);
            let alpha = Math.atan2(tx, tz) - heading;
            while (alpha > Math.PI) alpha -= 2 * Math.PI;
            while (alpha < -Math.PI) alpha += 2 * Math.PI;
            const stick = Math.max(-1, Math.min(1, -steerGain * alpha));
            let rawX = Math.round(stick * 7) + 7;
            // Automatic drifting: start when the road ahead turns sharply, hold while it keeps turning.
            if (autoDrift && racing && driftDir === 0 && fixedStick < 0 && !aim && offset === 0) {
                const ahead = (turnAhead(i0, 2500) * 180) / Math.PI;
                const blocked = noDrift.some(([a, b]) => s > a && s < b);
                const grounded = status.onBit(eStatus.TouchingGround);
                if (autoDir === 0) {
                    if (!blocked && grounded && speed > 55 && Math.abs(ahead) > driftDeg) autoDir = ahead > 0 ? -1 : 1;
                } else {
                    const near = (turnAhead(i0, 1200) * 180) / Math.PI;
                    // stick direction the pursuit wants: autoDir -1 (left) wants rawX < 7
                    const wantsOpposite = autoDir < 0 ? rawX > 8 : rawX < 6;
                    const hopping = driftStart >= 0 && frame - driftStart < 25 && status.onBit(eStatus.Hop);
                    const lost = driftStart >= 0 && frame - driftStart > 25 && status.offBit(eStatus.DriftManual);
                    if (!hopping && (blocked || lost || (Math.abs(near) < 10 && Math.abs(ahead) < 20) || wantsOpposite)) autoDir = 0;
                }
                driftDir = autoDir;
                if (driftDir !== 0 && driftStart >= 0 && frame - driftStart >= 6) {
                    // Inside drift: keep the stick on the drift side (neutral widens, full lock tightens).
                    rawX = driftDir < 0 ? Math.min(rawX, 7) : Math.max(rawX, 7);
                }
            }
            if (driftDir !== 0 && !autoDrift) {
                if (driftStart < 0) driftStart = frame;
                const age = frame - driftStart;
                if (age < 6) rawX = driftDir < 0 ? 0 : 14;
                else if (move.mtCharge() < 270) rawX = driftDir < 0 ? Math.min(rawX, 3) : Math.max(rawX, 11);
            } else if (driftDir === 0) driftStart = -1;
            if (driftDir !== 0 && autoDrift) {
                if (driftStart < 0) driftStart = frame;
                if (frame - driftStart < 6) rawX = driftDir < 0 ? 0 : 14;
            }
            if (fixedStick >= 0) rawX = fixedStick;
            if (!racing) rawX = 7;
            // Tricks right after leaving a trickable surface / jump pad; wheelies on request.
            let trick = 0;
            const airtime = kart.state().airtime();
            // One frame, like the app's input (a trick input lasts one frame, as in recorded ghosts).
            if (autoTrick && status.offBit(eStatus.TouchingGround) && airtime === 1 && (lastGroundTrickable || status.onBit(eStatus.JumpPad, eStatus.RampBoost))) trick = 1;
            if (wheelie && status.onBit(eStatus.TouchingGround) && status.offBit(eStatus.Wheelie) && frame - lastWheelie > 30 && driftDir === 0) {
                trick = 1;
                lastWheelie = frame;
            }
            const itemPress = item && !itemHeldPrev;
            itemHeldPrev = item;
            const buttons = KPadHostController.MakeGhostButtons(accel, brake || driftDir !== 0, itemPress, prevButtons);
            prevButtons = buttons;
            hc.setRawInputs(buttons, rawX, 7, trick as Trick);
            inputs.push({ buttons, stickX: rawX, stickY: 7, trick });
        }
        if (status.onBit(eStatus.TouchingGround)) lastGroundTrickable = status.onBit(eStatus.Trickable) || kart.state().boostRampType() >= 0;

        session.step();
        ++frame;

        // ---- analysis ----------------------------------------------------------------------
        const q = kart.pos();
        const st = kart.status();
        const i1 = nearest(q.x, q.z);
        const pr1 = project(i1, q.x, q.z);
        s = pr1.s;
        lat = pr1.lat;
        const e = edgesAt(i1);
        const player = rm.player();
        const lapNow = player.currentLap();
        const speed = kart.speed();
        if (frame >= RACE_START_FRAME + 60) minSpeedAfterStart = Math.min(minSpeedAfterStart, speed);
        topSpeed = Math.max(topSpeed, speed);
        if (st.onBit(eStatus.WallCollision)) ++wallFrames;
        if (move.kclSpeedFactor() < 1 && st.onBit(eStatus.TouchingGround)) ++offroadFrames;
        if (st.onBit(eStatus.TouchingGround) && (lat > e.wallL + 50 || lat < e.wallR - 50)) ++offTrackFrames;
        if (st.offBit(eStatus.BeforeRespawn, eStatus.InRespawn)) {
            const cp = player.checkpointId();
            seen.add(cp);
            maxCheckpoint = Math.max(maxCheckpoint, cp);
        }
        // Boost activations (a type's timer was (re)started).
        const act = move.m_boost.m_active;
        const tim = move.m_boost.m_timers;
        const kinds: BoostEvent['kind'][] = ['mt', 'panel/item', 'trick'];
        for (let k = 0; k < 3; ++k) if (act[k] && (!prevBoost[k] || tim[k]! > prevTimers[k]!)) boosts.push({ lap: lapNow, frame, s, kind: kinds[k]!, speed });
        prevBoost = [...act];
        prevTimers = [...tim];
        // Airtime (ignore hops: < 8 frames).
        const ground = st.onBit(eStatus.TouchingGround);
        const inResp = st.onBit(eStatus.BeforeRespawn, eStatus.InRespawn, eStatus.AfterRespawn);
        if (!ground && !curAir && !inResp && frame > RACE_START_FRAME) {
            curAir = {
                lap: lapNow,
                frame,
                takeoffS: s,
                takeoffSpeed: speed,
                landS: 0,
                frames: 0,
                maxRise: 0,
                trick: false,
                rampBoost: st.onBit(eStatus.RampBoost),
                jumpPad: st.onBit(eStatus.JumpPad),
                landedOnRoad: false,
                landLat: 0,
                y0: q.y,
            };
        }
        if (curAir) {
            curAir.frames++;
            curAir.maxRise = Math.max(curAir.maxRise, q.y - curAir.y0);
            if (st.onBit(eStatus.InATrick)) curAir.trick = true;
            if (st.onBit(eStatus.RampBoost)) curAir.rampBoost = true;
            if (st.onBit(eStatus.JumpPad)) curAir.jumpPad = true;
            if (st.onBit(eStatus.BeforeRespawn)) {
                if (curAir.frames >= 8) air.push({ ...curAir, landS: s, landedOnRoad: false, landLat: lat });
                curAir = null;
            } else if (ground) {
                if (curAir.frames >= 8) {
                    const onRoad = lat <= e.wallL && lat >= e.wallR;
                    const { y0: _y0, ...ev } = curAir;
                    void _y0;
                    air.push({ ...ev, landS: s, landedOnRoad: onRoad, landLat: lat });
                }
                curAir = null;
            }
        }
        // Respawns.
        if (st.onBit(eStatus.BeforeRespawn) && !curResp) {
            curResp = { lap: lapNow, frame, fallS: s, fallPos: [q.x, q.y, q.z], jugemId: player.jugemId(), landWait: false };
        }
        if (curResp) {
            if (st.onBit(eStatus.InRespawn) && !curResp.respawnPos) curResp.respawnPos = [q.x, q.y, q.z];
            if (st.onBit(eStatus.AfterRespawn)) curResp.landWait = true;
            if (curResp.landWait && st.offBit(eStatus.AfterRespawn) && st.offBit(eStatus.InRespawn, eStatus.BeforeRespawn)) {
                respawns.push({
                    lap: curResp.lap!,
                    frame: curResp.frame!,
                    fallS: curResp.fallS!,
                    fallPos: curResp.fallPos!,
                    jugemId: curResp.jugemId!,
                    respawnPos: curResp.respawnPos ?? [NaN, NaN, NaN],
                    landedS: s,
                    landedLat: lat,
                    landedOnRoad: ground && lat <= e.roadL && lat >= e.roadR,
                    framesToLand: frame - curResp.frame!,
                });
                curResp = null;
            }
        }
        if (o.onFrame?.({ frame, s, lat, lap: lapNow, pos: [q.x, q.y, q.z], speed, airtime: kart.state().airtime(), ground, boost: act.some((x) => x), status: (b) => st.onBit(b) })) break;
        // Laps.
        if (lapNow > prevLap) {
            if (prevLap >= 1) {
                lapFrames.push(frame - lapStartFrame);
                lapsCompleted = prevLap;
            }
            lapStartFrame = frame;
            prevLap = lapNow;
        }
        if (rm.stage() === Stage.FinishGlobal) {
            finished = true;
            lapsCompleted = lapFrames.length;
            break;
        }
        if (lapsCompleted >= lapsTarget) break;
    }
    session.destroy();
    return {
        frames: frame,
        raceFrames: frame - RACE_START_FRAME,
        finished,
        lapsCompleted,
        lapFrames,
        inputs,
        air,
        boosts,
        respawns,
        maxCheckpoint,
        checkpointsSeen: seen.size,
        offroadFrames,
        offTrackFrames,
        wallFrames,
        minSpeedAfterStart,
        topSpeed,
    };
}

export function summarize(r: BotResult): string[] {
    const out: string[] = [];
    out.push(
        `  ${r.finished ? 'FINISHED' : 'not finished'} ${r.lapsCompleted} laps in ${r.raceFrames} race frames; laps [${r.lapFrames.join(', ')}] frames; ` +
            `checkpoints seen ${r.checkpointsSeen} (max id ${r.maxCheckpoint}); top speed ${r.topSpeed.toFixed(1)}; wall frames ${r.wallFrames}; offroad frames ${r.offroadFrames}`,
    );
    const hops = r.air.filter((a) => a.frames < 20 && !a.rampBoost && !a.jumpPad && !a.trick);
    if (hops.length) out.push(`  ${hops.length} short airtimes (hops / bumps < 20 frames) not listed`);
    for (const a of r.air.filter((x) => !hops.includes(x)))
        out.push(
            `  air L${a.lap} f${a.frame}: takeoff S=${a.takeoffS.toFixed(0)} @${a.takeoffSpeed.toFixed(1)} → land S=${a.landS.toFixed(0)} lat ${a.landLat.toFixed(0)} ` +
                `(${a.frames}f, +${a.maxRise.toFixed(0)} rise${a.trick ? ', trick' : ''}${a.rampBoost ? ', rampBoost' : ''}${a.jumpPad ? ', jumpPad' : ''}) ${a.landedOnRoad ? 'LANDED' : 'NOT LANDED'}`,
        );
    const bk = new Map<string, number>();
    for (const b of r.boosts) bk.set(b.kind, (bk.get(b.kind) ?? 0) + 1);
    out.push(`  boosts: ${[...bk].map(([k, v]) => `${k} x${v}`).join(', ') || 'none'}`);
    for (const b of r.boosts.filter((b) => b.kind !== 'mt')) out.push(`    ${b.kind} L${b.lap} f${b.frame} S=${b.s.toFixed(0)} speed ${b.speed.toFixed(1)}`);
    for (const x of r.respawns)
        out.push(
            `  respawn L${x.lap} f${x.frame}: fell at S=${x.fallS.toFixed(0)} y=${x.fallPos[1].toFixed(0)} → jugem ${x.jugemId} → landed S=${x.landedS.toFixed(0)} lat ${x.landedLat.toFixed(0)} ` +
                `${x.landedOnRoad ? 'ON ROAD' : 'OFF ROAD'} after ${x.framesToLand}f`,
        );
    return out;
}

if (process.argv[1]?.endsWith('botlap.ts')) {
    const args = process.argv.slice(2);
    const id = args[0];
    if (!id) {
        console.error('usage: npx tsx tools/course/botlap.ts <id> [--laps N] [--frames N] [--no-trick] [--vehicle ebike|robotaxi|buggy] [--rkg out.rkg]');
        process.exit(2);
    }
    const opt = (k: string) => {
        const i = args.indexOf(k);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const dir = `public/data/courses/${id}`;
    const meta = loadMeta(dir);
    const veh = vehicleDef(opt('--vehicle') ?? 'ebike');
    const r = runBot(loadCourseFiles(dir), meta, {
        vehicle: vehicleSlot(veh.id),
        laps: opt('--laps') ? Number(opt('--laps')) : undefined,
        maxFrames: opt('--frames') ? Number(opt('--frames')) : undefined,
        autoTrick: !args.includes('--no-trick'),
    });
    console.log(`${meta.name}:`);
    console.log(summarize(r).join('\n'));
    const rkgOut = opt('--rkg');
    if (rkgOut) {
        writeFileSync(rkgOut, buildRKG(r.inputs, { course: COURSE_SLOT, vehicle: vehicleSlot(veh.id), character: DRIVER_SLOT, driftIsAuto: false, controller: 2, name: id }));
        console.log(`wrote ${rkgOut} (${r.inputs.length} input frames)`);
    }
}
