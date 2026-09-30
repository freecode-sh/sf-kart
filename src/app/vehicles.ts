/**
 * The three San Francisco vehicles. How each one drives (stats, hitboxes, wheels, suspension) is
 * its entry in public/data/vehicles/vehicles.json (see vehicleData.ts).
 *
 * All three drift the same way: easy drifting (easyDrift.ts) on the engine's manual drift, with the
 * engine's own performance: the heavy cars drift outward with mini-turbos and super mini-turbos,
 * the Share E-Bike leans into inside drifts with mini-turbos.
 *
 * The dev tools' Tuning panels try stat changes on top of the data file (tuning.ts).
 */

import type { EngineVoice } from './audio';

export type VehicleId = 'ebike' | 'robotaxi' | 'buggy';

export interface VehicleDef {
    id: VehicleId;
    name: string;
    /** Short name for tags (ghosts). */
    short: string;
    tagline: string;
    kind: 'bike' | 'car';
    engineVoice: EngineVoice;
    /** Color for this vehicle in comparisons (ghost tags, split tables). */
    color: string;
}

export const VEHICLES: readonly VehicleDef[] = [
    {
        id: 'ebike',
        name: 'Share E-Bike',
        short: 'E-Bike',
        tagline: 'Bike. Leans into inside drifts, mini-turbos (no super), wheelies on the straights.',
        kind: 'bike',
        engineVoice: 'ebike',
        color: '#c3c8cf',
    },
    {
        id: 'robotaxi',
        name: 'Robotaxi',
        short: 'Robotaxi',
        tagline: 'Heavy car. Top speed and wide, stable slides; super mini-turbos. Nobody at the wheel.',
        kind: 'car',
        engineVoice: 'ev',
        color: '#2fd0c4',
    },
    {
        id: 'buggy',
        name: 'Tour Buggy',
        short: 'Buggy',
        tagline: 'Heavy car. Quicker off the line and tighter to turn, lower top speed; super mini-turbos.',
        kind: 'car',
        engineVoice: 'putt',
        color: '#f6c21a',
    },
];

export const DEFAULT_VEHICLE: VehicleId = 'ebike';

export function vehicleDef(id: string): VehicleDef {
    return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]!;
}
