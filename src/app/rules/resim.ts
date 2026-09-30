/**
 * Re-simulates a run from its pads, headless: the same Sim and live path the app races with
 * (Sim.startRun: the drift layer, tricks, start boost, pickups, splits), from the course and vehicle
 * data it's given (no file loading here: tools/lib/rulesFiles.ts reads them in Node, the app has them
 * loaded, a Worker gets them from storage). No DOM, no rendering; three.js math only.
 *
 * The engine keeps its state in singletons, so there's one simulation per JS realm at a time: run
 * this in a Worker (sf/ghostWorker.ts) while the app races.
 */

import { Sim } from '../sim';
import { STOCK_TUNE, tuneStats, type VehicleTune } from '../tuning';
import { packKartParam, packVehicleFiles, vehicleSlot, type VehicleDataFile } from '../vehicleData';
import type { RawPadState } from '../input';
import type { VehicleId } from '../vehicles';
import { CourseRules, type RulesMeta } from './course';
import { rulesHash, rulesMeta, type RulesSources } from './hash';
import { RUN_TUNED, type RunFile } from './runfile';

/** What a run is simulated with: the course files and meta, and the vehicle data. */
export interface RulesData extends RulesSources {
    meta: RulesMeta;
    vehicles: VehicleDataFile;
}

export interface ResimResult {
    /** Session frame of the finish; null: the pads ran out first. */
    finishFrame: number | null;
    splits: number[];
    /** The engine's race time (ms); null: not finished. */
    raceMs: number | null;
    /** Frames simulated. */
    frames: number;
}

/**
 * A Sim set up the way the app races `vehicle` (main.ts applyVehicle): the packed vehicle files,
 * the vehicle's kartParam with `tune` (the stock numbers unless dev tuning), the course's laps and
 * rules.
 */
export function rulesSim(data: RulesData, vehicle: VehicleId, tune: VehicleTune = STOCK_TUNE): Sim {
    const sim = new Sim(packVehicleFiles(data.vehicles), new Map([['course.kcl', data.kcl], ['course.kmp', data.kmp]]));
    sim.vehicle = vehicleSlot(vehicle);
    sim.setKartParam(packKartParam(data.vehicles, { [vehicle]: tuneStats(data.vehicles.vehicles[vehicle].stats, tune) }));
    sim.laps = data.meta.laps;
    sim.setRules(new CourseRules(rulesMeta(data.meta)));
    return sim;
}

/**
 * Plays `pads` from the start until the finish (or until they run out). `onFrame` sees the sim
 * after every frame (ghost poses); `tune`: dev tuning the run was raced with (ghosts of your own).
 */
export function resim(run: { vehicle: VehicleId; pads: readonly RawPadState[] }, data: RulesData, onFrame?: (sim: Sim) => void, tune?: VehicleTune): ResimResult {
    const sim = rulesSim(data, run.vehicle, tune);
    sim.startRun(run.pads);
    let frames = 0;
    while (frames < run.pads.length && sim.finishFrame === null) {
        sim.step(run.pads[frames]!);
        sim.events.length = 0;
        ++frames;
        onFrame?.(sim);
    }
    return { finishFrame: sim.finishFrame, splits: sim.splits(), raceMs: sim.raceMs(), frames };
}

export interface RunCheck extends ResimResult {
    ok: boolean;
    /** Why it isn't (empty when ok). */
    errors: string[];
    vehicle: VehicleId;
}

/**
 * Verifies a run file: raced under these rules (the hash), not tuned, and re-simulated it finishes
 * on the frame with the splits it claims. (`onFrame`: as for resim.)
 */
export async function checkRun(run: RunFile, data: RulesData, onFrame?: (sim: Sim) => void): Promise<RunCheck> {
    const errors: string[] = [];
    const hash = await rulesHash(data);
    if (run.rulesHash !== hash) errors.push(`rules hash ${run.rulesHash.slice(0, 12)}… is not the current ${hash.slice(0, 12)}…`);
    if (run.flags & RUN_TUNED) errors.push('raced with dev tuning');
    const r = resim(run, data, onFrame);
    if (r.finishFrame === null) errors.push('did not finish');
    else if (r.finishFrame !== run.finishFrame) errors.push(`finishes on frame ${r.finishFrame}, not the claimed ${run.finishFrame}`);
    if (r.splits.join() !== run.splits.join()) errors.push(`splits ${r.splits.join()} are not the claimed ${run.splits.join()}`);
    return { ok: errors.length === 0, errors, vehicle: run.vehicle, ...r };
}
