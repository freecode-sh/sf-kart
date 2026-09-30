/**
 * Compares the SF vehicles on a course: their race stats (public/data/vehicles/vehicles.json, and
 * with --tune multipliers on top) and a bot lap each with section splits.
 *
 *   npx tsx tools/vehicles/compare.ts [course=golden_gate] [--tune '{"robotaxi":{"speed":1.01}}'] [--only ebike,buggy]
 *
 * The bot (tools/course/botlap.ts) is a pure-pursuit driver: it's consistent, not fast, and only
 * drifts the bike (its drift steering suits inside drifts), so the cars' laps are no-drift
 * baselines. Use it to see what a tuning change does section by section, then play it.
 */

import { packKartParam, vehicleSlot } from '../../src/app/vehicleData';
import { STOCK_TUNE, summarize, tuneStats, withTune, type StatSummary, type VehicleTune } from '../../src/app/tuning';
import { VEHICLES, type VehicleId } from '../../src/app/vehicles';
import { loadCourseFiles, loadMeta, loadVehicleData, runBot } from '../course/botlap';

const args = process.argv.slice(2);
const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
};
const course = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'golden_gate';
const overrides = JSON.parse(opt('--tune') ?? '{}') as Partial<Record<VehicleId, Partial<VehicleTune>>>;
const only = opt('--only')?.split(',');
const dir = `public/data/courses/${course}`;
const meta = loadMeta(dir);
const data = loadVehicleData();
const base = loadCourseFiles(dir);
const core = base.core as Record<string, Uint8Array>;
const segs = Object.entries(meta.segments).sort((a, b) => a[1][0] - b[1][0]);
const fmt = (f: number) => {
    const s = f / 59.94;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
};

const statRows: Record<string, Record<string, string>> = {};
const splitRows: Record<string, Record<string, string>> = {};
const stat = (s: StatSummary, k: keyof StatSummary) => (k === 'miniTurbo' ? String(s[k]) : s[k].toPrecision(4));
for (const v of VEHICLES.filter((x) => !only || only.includes(x.id))) {
    const tuned = tuneStats(data.vehicles[v.id].stats, withTune(STOCK_TUNE, overrides[v.id]));
    const kp = packKartParam(data, { [v.id]: tuned });
    const stock = summarize(data.vehicles[v.id].stats);
    const now = summarize(tuned);
    statRows[v.name] = Object.fromEntries((Object.keys(stock) as (keyof StatSummary)[]).map((k) => [k, stock[k] === now[k] ? stat(now, k) : `${stat(stock, k)}→${stat(now, k)}`]));

    const files = { core: { ...core, 'kartParam.bin': kp }, course: base.course };
    const frames: Record<string, number> = {};
    let raceStart = -1;
    const r = runBot(files, meta, {
        vehicle: vehicleSlot(v.id),
        // The bot's hop-drift steering was tuned on the inside-drifting bike; karts drive its lines
        // without drifting (a baseline, not their best).
        autoDrift: v.kind === 'bike',
        laps: 1,
        onFrame: (f) => {
            if (raceStart < 0) return void (f.lap >= 1 && f.speed > 1 && (raceStart = f.frame));
            const seg = segs.find(([, rg]) => f.s >= rg[0] && f.s < rg[1])?.[0];
            if (seg) frames[seg] = (frames[seg] ?? 0) + 1;
        },
    });
    splitRows[v.name] = { ...Object.fromEntries(segs.map(([k]) => [k, ((frames[k] ?? 0) / 59.94).toFixed(2)])), lap: fmt(r.lapFrames[0] ?? r.raceFrames), top: r.topSpeed.toFixed(1), respawns: String(r.respawns.length) };
}
console.log(`${meta.name}: race stats`);
console.table(statRows);
console.log('Bot lap, seconds per section:');
console.table(splitRows);
