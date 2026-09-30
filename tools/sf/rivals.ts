/**
 * Records the CPU rivals for the Golden Gate course: bot runs (tools/course/botlap.ts) in a mix of
 * vehicles with different skills and lines, collecting the speed-up pickups like the player (the same
 * layout and rule as the app, itemBoxes.ts), captured frame by frame (position, rotation, lap progress) into
 *   public/data/courses/golden_gate/rivals.bin   (per rival, every 2nd frame: pos f32x3, quat i16x4, dist f32)
 *   public/data/courses/golden_gate/rivals.json  (names, colors, frame counts, finish frames)
 * The app plays them back in sync with the race (they don't collide; the engine is single-player).
 *
 * Usage: npx tsx tools/sf/rivals.ts
 */

import { writeFileSync } from 'node:fs';
import { KartObjectManager } from '../../src/game/kart/KartObjectManager';
import { RaceManager, Stage } from '../../src/game/system/RaceManager';
import { PickupField, pickupRows } from '../../src/app/sf/itemBoxes';
import type { Station } from '../../src/app/sf/road';
import { vehicleSlot } from '../../src/app/vehicleData';
import type { VehicleId } from '../../src/app/vehicles';
import { loadCourseFiles, loadMeta, RACE_START_FRAME, runBot, type BotAction } from '../course/botlap';

const DIR = 'public/data/courses/golden_gate';
const STRIDE = 2;

type Rival = {
    name: string;
    color: string;
    accent: string;
    vehicle: VehicleId;
    /** Lateral line (units, + = left) per stretch of the lap. */
    line: number;
    /** Use a stored boost on these sections (fractions into the section). */
    boosts?: [string, number][];
    autoDrift: boolean;
    /** Lift off the throttle for this many units every `every` units (slower drivers). */
    lift?: { every: number; len: number };
    steer?: number;
    /** Weave through the lane panels on the bridge (off: stay on `line`, hitting only some). */
    lanes?: boolean;
};

const RIVALS: Rival[] = [
    // A spread from ~2:42 (hard to beat: needs mini-turbos, tricks and the stored boosts) to ~3:05,
    // across all three vehicles.
    { name: 'Karl the Fog', vehicle: 'robotaxi', color: '#d9dee6', accent: '#6b7a8f', line: 350, autoDrift: true, lanes: true, boosts: [['bridge_nb', 0.05], ['bridge_sb', 0.1], ['parkway', 0.4]], lift: { every: 60000, len: 3400 } },
    { name: 'Sutro', vehicle: 'ebike', color: '#e53935', accent: '#fafafa', line: -450, autoDrift: true, lanes: true, boosts: [['bridge_sb', 0.55]], lift: { every: 60000, len: 3600 } },
    { name: 'Muni', vehicle: 'buggy', color: '#2e86de', accent: '#f39c12', line: 500, autoDrift: false, lanes: true, boosts: [['bridge_nb', 0.5]], lift: { every: 50000, len: 5600 } },
    { name: 'Lombard', vehicle: 'ebike', color: '#8e44ad', accent: '#f1c40f', line: 0, autoDrift: true, lift: { every: 50000, len: 3400 } },
    { name: 'Coit', vehicle: 'buggy', color: '#27ae60', accent: '#ecf0f1', line: -250, autoDrift: false, lift: { every: 40000, len: 4600 } },
];

const files = loadCourseFiles(DIR);
const meta = loadMeta(DIR);
const L = meta.length;
const pickupRowsS = pickupRows(meta.segments);
const seg = meta.segments;
RaceManager.lapsToFinish = 1;

const bufs: Buffer[] = [];
const out: { name: string; color: string; accent: string; vehicle: VehicleId; frames: number; stride: number; finishFrame: number; offset: number }[] = [];
for (const r of RIVALS) {
    const actions: BotAction[] = [];
    if (r.line) actions.push({ from: 0, to: L, action: 'offset', value: r.line });
    // The bridge's lane panels: line up with each from 4500 units out.
    const onBridge = (s: number) => ['bridge_nb', 'bridge_sb'].some((n) => s > seg[n]![0] && s < seg[n]![1]);
    if (r.lanes)
        for (const f of meta.features)
            if (f.type === 'dashPanel' && f.lat && onBridge(f.s[0]))
                actions.push({ from: f.s[0] - 4500, to: f.s[1], action: 'offset', value: (f.lat[0] + f.lat[1]) / 2 });
    for (const [name, frac] of r.boosts ?? []) {
        const s = seg[name]!;
        const at = s[0] + (s[1] - s[0]) * frac;
        actions.push({ from: at, to: at + 300, action: 'item' });
    }
    if (r.lift) for (let s = r.lift.every / 2; s + r.lift.len < L; s += r.lift.every) actions.push({ from: s, to: s + r.lift.len, action: 'noaccel' });
    const frames: { pos: number[]; q: number[]; dist: number }[] = [];
    let lastS = -1;
    let laps = 0;
    // Speed-up pickups, as in the app (frames counted like sim.frame(): the first is 1).
    const pickups = new PickupField(meta.centerline as unknown as Station[], pickupRowsS);
    const res = runBot(files, meta, {
        laps: 1,
        vehicle: vehicleSlot(r.vehicle),
        autoDrift: r.autoDrift,
        steer: r.steer,
        actions,
        onFrame: (f) => {
            const k = KartObjectManager.Instance()!.object(0);
            const q = k.fullRot();
            // Unwrapped distance along the lap from the finish line's S = 0 (negative before it).
            if (lastS >= 0 && f.s < lastS - L / 2) ++laps;
            if (lastS >= 0 && f.s > lastS + L / 2) --laps;
            lastS = f.s;
            frames.push({ pos: [...f.pos], q: [q.v.x, q.v.y, q.v.z, q.w], dist: laps * L + f.s - (meta.start as { s: number }).s });
            const p = k.pos();
            if (RaceManager.Instance()!.stage() === Stage.Race && pickups.check({ x: p.x, y: p.y, z: p.z }, frames.length) > 0) k.move().activateMushroom();
        },
    });
    // Frames before the recording starts (intro): the bot's onFrame covers every frame from 0.
    const n = Math.ceil(frames.length / STRIDE);
    const b = Buffer.alloc(n * 24);
    for (let i = 0; i < n; ++i) {
        const f = frames[i * STRIDE]!;
        b.writeFloatLE(f.pos[0]!, i * 24);
        b.writeFloatLE(f.pos[1]!, i * 24 + 4);
        b.writeFloatLE(f.pos[2]!, i * 24 + 8);
        for (let c = 0; c < 4; ++c) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f.q[c]!)) * 32767), i * 24 + 12 + c * 2);
        b.writeFloatLE(f.dist, i * 24 + 20);
    }
    const finishFrame = res.lapFrames[0] !== undefined ? RACE_START_FRAME + res.lapFrames[0] : frames.length;
    const offset = bufs.reduce((a, x) => a + x.length, 0);
    bufs.push(b);
    out.push({ name: r.name, color: r.color, accent: r.accent, vehicle: r.vehicle, frames: frames.length, stride: STRIDE, finishFrame, offset });
    console.log(`${r.name} (${r.vehicle}): lap ${res.lapFrames[0] ? (res.lapFrames[0] / 59.94).toFixed(2) + ' s' : 'DNF'}, ${frames.length} frames, walls ${res.wallFrames}, respawns ${res.respawns.length}`);
}
writeFileSync(`${DIR}/rivals.bin`, Buffer.concat(bufs));
writeFileSync(`${DIR}/rivals.json`, JSON.stringify({ rivals: out }, null, 1) + '\n');
console.log(`wrote ${DIR}/rivals.{bin,json} (${(Buffer.concat(bufs).length / 1e6).toFixed(2)} MB)`);
