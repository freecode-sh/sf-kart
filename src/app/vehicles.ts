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
    /** One friendly line for the vehicle picker (ui/onboarding.ts). */
    blurb: string;
    /** What its speed-ups are (the pickups on the road, sf/itemBoxes.ts). */
    speedUp: string;
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
        blurb: 'Light and nimble. Leans into tight drifts and pops wheelies on the straights.',
        speedUp: 'coffee',
        kind: 'bike',
        engineVoice: 'ebike',
        color: '#c3c8cf',
    },
    {
        id: 'robotaxi',
        name: 'Robo Car',
        short: 'Robo Car',
        tagline: 'Heavy car. Top speed and wide, stable slides; super mini-turbos. Nobody at the wheel.',
        blurb: 'Fast and steady, with wide, stable drifts. The easy one to start with. Nobody at the wheel.',
        speedUp: 'battery',
        kind: 'car',
        engineVoice: 'ev',
        color: '#2fd0c4',
    },
    {
        id: 'buggy',
        name: 'Tour Kart',
        short: 'Tour Kart',
        tagline: 'Heavy car. Quicker off the line and tighter to turn, lower top speed; super mini-turbos.',
        blurb: 'The little yellow tour kart: quick off the line and tight in the turns.',
        speedUp: 'gas can',
        kind: 'car',
        engineVoice: 'putt',
        color: '#f6c21a',
    },
];

/** A first race's vehicle: the Robo Car, the steadiest to learn on. */
export const DEFAULT_VEHICLE: VehicleId = 'robotaxi';

/** The vehicle picker's order (ui/onboarding.ts): the beginner's pick first. */
export const PICKER_ORDER: readonly VehicleId[] = ['robotaxi', 'ebike', 'buggy'];

export function vehicleDef(id: string): VehicleDef {
    return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]!;
}
