/**
 * A race, the way every run is raced: the engine's files and scenario, then per frame the
 * engine-level input, the engine step and the start boost at GO, then the speed-up pickups.
 * Shared by the live game (sim.ts, main.ts) and the leaderboard's verifier (verify.ts), so a
 * recorded run replays exactly. The input layers before it (easy drift, hop tricks) only shape the
 * input: what reaches the engine is what's recorded.
 */

import { Course } from '../../Common';
import { KartObjectManager } from '../../game/kart/KartObjectManager';
import type { RaceSession, RaceSessionFiles, RaceSessionScenario } from '../../game/scene/RaceSession';
import type { Trick } from '../../game/system/KPadController';
import { RaceManager, Stage } from '../../game/system/RaceManager';
import type { PickupField } from '../sf/pickupField';
import { STOCK_TUNE, tuneStats, type VehicleTune } from '../tuning';
import { DRIVER_SLOT, packKartParam, vehicleSlot, type VehicleDataFile } from '../vehicleData';
import type { VehicleId } from '../vehicles';

/** What the engine's controller gets each frame (KPadHostController.setRawInputs). */
export interface EngineInput {
    /** Accelerate 0x1, brake 0x2, item 0x4, drift 0x8 (KPadHostController.MakeGhostButtons). */
    buttons: number;
    /** 0..14, 7 = neutral. */
    stickX: number;
    stickY: number;
    /** 0 none, 1 up, 2 down, 3 left, 4 right. */
    trick: number;
}

/** Course slot the race runs in (generated courses use the engine's default slot, like their ghosts). */
export const COURSE_SLOT = Course.Luigi_Circuit;
/** The engine's longest start boost (frames); everyone gets it at GO. */
const START_BOOST_FRAMES = 70;

/** kartParam.bin with `id`'s stats adjusted by `tune` (stock: the vehicle data as is). */
export function kartParamFor(data: VehicleDataFile, id: VehicleId, tune: VehicleTune = STOCK_TUNE): Uint8Array {
    return packKartParam(data, { [id]: tuneStats(data.vehicles[id].stats, tune) });
}

/** The engine's files: the packed vehicle files (`common`, with `kartParam` over its own) and the course's. */
export function raceFiles(common: Map<string, Uint8Array>, course: Map<string, Uint8Array>, kartParam: Uint8Array | null): RaceSessionFiles {
    const core = new Map<string, Uint8Array>();
    for (const [k, v] of common) core.set(k.startsWith('bsp/') ? `/${k}` : k, v);
    if (kartParam) core.set('kartParam.bin', kartParam);
    return { core, course };
}

export function raceScenario(vehicle: VehicleId): RaceSessionScenario {
    return { type: 'local', course: COURSE_SLOT, character: DRIVER_SLOT, vehicle: vehicleSlot(vehicle), driftIsAuto: false };
}

/** The next frame is GO (the last countdown frame): the engine doesn't see the accelerator on it. */
export function isGoFrame(): boolean {
    const rm = RaceManager.Instance()!;
    return rm.stage() === Stage.Countdown && rm.getCountdownTimer() === 1;
}

/** One race frame: the input, the engine step and, at GO, everyone's best start boost. */
export function stepRace(session: RaceSession, input: EngineInput): void {
    const go = isGoFrame();
    session.hostController().setRawInputs(input.buttons, input.stickX, input.stickY, input.trick as Trick);
    session.step();
    if (go) KartObjectManager.Instance()!.object(0).move().applyStartBoost(START_BOOST_FRAMES);
}

/** After a frame: drives through a speed-up pickup for an instant boost (racing only). */
export function collectPickups(field: PickupField, pos: { x: number; y: number; z: number }, frame: number): boolean {
    if (RaceManager.Instance()!.stage() !== Stage.Race || field.check(pos, frame) === 0) return false;
    KartObjectManager.Instance()!.object(0).move().activateMushroom();
    return true;
}

/** The finished race's official time (ms), or null before the finish. */
export function finishTimeMs(): number | null {
    const rm = RaceManager.Instance()!;
    const t = rm.player().raceTimer();
    if (rm.stage() < Stage.FinishLocal || !t.valid) return null;
    return (t.min * 60 + t.sec) * 1000 + t.mil;
}
