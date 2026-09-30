/**
 * Stat adjustments on top of a vehicle's data (public/data/vehicles/vehicles.json), for the dev
 * tuning panels.
 *
 * Tuning adjusts a copy of the vehicle's stats, which the packer (vehicleData.ts) turns into the
 * engine's stats bytes before the race starts: the engine stays untouched and still deterministic
 * (the same numbers always give the same race). Every knob is relative to the data file, so the
 * default (all 1, mini-turbo +0) is exactly the file's numbers; small nudges are the idea.
 */

import type { VehicleStats } from './vehicleData';

export interface VehicleTune {
    /** Top speed (× the vehicle's top speed). */
    speed: number;
    /** Acceleration (× every stage of the standard acceleration curve). */
    accel: number;
    /** Steering tightness outside drifts (× manual and automatic handling). */
    handling: number;
    /** Drift tightness (× manual and automatic drift). */
    drift: number;
    /** How far sideways a kart sits in an outside drift (× the target angle, 45° stock); lower is less slidy. */
    driftAngle: number;
    /** Speed lost while steering (× the loss; below 1 keeps more speed through turns). */
    turnDrag: number;
    /** Speed on offroad surfaces (× the weak / normal / heavy offroad factors). */
    offroad: number;
    /** Mini-turbo boost length, frames added (manual drift only). */
    miniTurbo: number;
}

export const STOCK_TUNE: VehicleTune = { speed: 1, accel: 1, handling: 1, drift: 1, driftAngle: 1, turnDrag: 1, offroad: 1, miniTurbo: 0 };

export type TuneKey = keyof VehicleTune;

/** The knobs, with their slider ranges (kept narrow on purpose: the stock numbers are well tuned). */
export const TUNE_KNOBS: readonly { key: TuneKey; label: string; min: number; max: number; step: number; help: string; kartOnly?: boolean }[] = [
    { key: 'speed', label: 'Top speed', min: 0.95, max: 1.05, step: 0.0025, help: 'Base top speed.' },
    { key: 'accel', label: 'Acceleration', min: 0.85, max: 1.15, step: 0.01, help: 'How fast it gets up to speed.' },
    { key: 'handling', label: 'Handling', min: 0.9, max: 1.1, step: 0.005, help: 'How tightly it steers outside drifts.' },
    { key: 'drift', label: 'Drift', min: 0.9, max: 1.15, step: 0.005, help: 'How tightly it turns while drifting.' },
    { key: 'driftAngle', label: 'Drift angle', min: 0.6, max: 1.1, step: 0.01, help: 'How far sideways a kart sits in a drift (45° stock); lower is less slidy.', kartOnly: true },
    { key: 'turnDrag', label: 'Turn drag', min: 0.7, max: 1.3, step: 0.02, help: 'Speed lost while steering (lower keeps more speed in corners).' },
    { key: 'offroad', label: 'Offroad', min: 0.9, max: 1.1, step: 0.01, help: 'Speed on grass, sand and dirt.' },
    { key: 'miniTurbo', label: 'Mini-turbo', min: -10, max: 10, step: 1, help: 'Frames of boost from a drift.' },
];

function isStock(t: VehicleTune): boolean {
    return (Object.keys(STOCK_TUNE) as TuneKey[]).every((k) => t[k] === STOCK_TUNE[k]);
}

/** `base` with `partial` on top (unknown keys and bad values dropped). */
export function withTune(base: VehicleTune, partial: Partial<VehicleTune> | undefined): VehicleTune {
    const t = { ...base };
    for (const k of Object.keys(STOCK_TUNE) as TuneKey[]) {
        const v = partial?.[k];
        if (typeof v === 'number' && Number.isFinite(v)) t[k] = v;
    }
    return t;
}

/** Collision surface types of the offroad surfaces (weak, normal, heavy). */
const OFFROAD_SURFACES = [2, 3, 4];

/** A copy of `s` adjusted by `tune`, at the engine's float precision (the input is not modified). */
export function tuneStats(s: VehicleStats, tune: VehicleTune): VehicleStats {
    if (isStock(tune)) return s;
    const f = Math.fround;
    const t: VehicleStats = structuredClone(s);
    t.topSpeed = f(s.topSpeed * tune.speed);
    t.accel = s.accel.map((a) => f(a * tune.accel)) as VehicleStats['accel'];
    t.handlingManual = f(s.handlingManual * tune.handling);
    t.handlingAuto = f(s.handlingAuto * tune.handling);
    t.driftManual = f(s.driftManual * tune.drift);
    t.driftAuto = f(s.driftAuto * tune.drift);
    t.outsideDriftAngle = f(s.outsideDriftAngle * tune.driftAngle);
    for (const i of OFFROAD_SURFACES) t.surfaceSpeed[i] = f(s.surfaceSpeed[i]! * tune.offroad);
    t.steerSpeedKeep = f(1 - (1 - s.steerSpeedKeep) * tune.turnDrag);
    t.miniTurboFrames = Math.max(1, s.miniTurboFrames + Math.round(tune.miniTurbo));
    return t;
}

/** The handful of numbers worth comparing between vehicles. */
export interface StatSummary {
    speed: number;
    accel: number;
    handling: number;
    drift: number;
    /** Outside drift angle (degrees; 0 for inside-drift bikes). */
    driftAngle: number;
    /** Percent of speed lost at full steering. */
    turnDrag: number;
    offroad: number;
    miniTurbo: number;
    weight: number;
}

export function summarize(s: VehicleStats): StatSummary {
    return {
        speed: s.topSpeed,
        accel: s.accel[0],
        handling: s.handlingManual,
        drift: s.driftManual,
        driftAngle: s.outsideDriftAngle,
        turnDrag: (1 - s.steerSpeedKeep) * 100,
        offroad: s.surfaceSpeed[3]!,
        miniTurbo: s.miniTurboFrames,
        weight: s.weight,
    };
}
