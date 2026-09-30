/**
 * The leaderboard's check of a run: races its inputs again, headless, exactly as the game raced
 * them (race.ts), and reports whether it finished and in what time. Synchronous (the engine's
 * singletons allow one race at a time per JS realm), about 2-4 s of CPU for a lap.
 */

import { RaceSession } from '../../game/scene/RaceSession';
import { KartObjectManager } from '../../game/kart/KartObjectManager';
import { RaceManager, Stage } from '../../game/system/RaceManager';
import { startRace } from '../raceStart';
import { PickupField, pickupRows } from '../sf/pickupField';
import type { Station } from '../sf/road';
import { packVehicleFiles, type VehicleDataFile } from '../vehicleData';
import type { VehicleId } from '../vehicles';
import { collectPickups, finishTimeMs, kartParamFor, raceFiles, raceScenario, stepRace, type EngineInput } from './race';

export interface RulesData {
    vehicleData: VehicleDataFile;
    /** course.kcl and course.kmp. */
    course: Map<string, Uint8Array>;
    meta: { laps?: number; centerline: Station[]; segments: Record<string, [number, number]> };
}

export interface Verdict {
    /** Finished on the run's last frame (a run ends at its finish). */
    ok: boolean;
    /** The official time (ms) if it finished. */
    timeMs: number | null;
    /** Frames raced (to the finish, or all of them). */
    frames: number;
    /** The race frame of each speed-up pickup collected. */
    pickups: number[];
    /** The kart's position after the last frame raced. */
    pos: [number, number, number];
}

export function verifyRun(data: RulesData, vehicle: VehicleId, inputs: readonly EngineInput[]): Verdict {
    const session = new RaceSession();
    RaceManager.lapsToFinish = typeof data.meta.laps === 'number' ? data.meta.laps : 1;
    startRace(session, raceFiles(packVehicleFiles(data.vehicleData), data.course, kartParamFor(data.vehicleData, vehicle)), raceScenario(vehicle));
    const field = new PickupField(data.meta.centerline, pickupRows(data.meta.segments));
    const rm = RaceManager.Instance()!;
    const pickups: number[] = [];
    let frames = 0;
    let finishedAt = -1;
    let pos: [number, number, number] = [0, 0, 0];
    try {
        for (const input of inputs) {
            stepRace(session, input);
            ++frames;
            const p = KartObjectManager.Instance()!.object(0).pos();
            pos = [p.x, p.y, p.z];
            if (collectPickups(field, { x: p.x, y: p.y, z: p.z }, session.frame())) pickups.push(session.frame());
            if (rm.stage() >= Stage.FinishLocal) {
                finishedAt = frames;
                break;
            }
        }
        const timeMs = finishTimeMs();
        return { ok: finishedAt === inputs.length && timeMs !== null, timeMs, frames, pickups, pos };
    } finally {
        session.destroy();
    }
}
