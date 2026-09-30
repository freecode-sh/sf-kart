/**
 * Where the landmarks (src/app/sf/landmarks.ts) draw themselves, so the baked scenery (buildings,
 * trees, shrubs in bakeWorld.ts; street detail in bakeStreetDetail.ts) stays out: circles (e, n,
 * r m), and the Palace of Fine Arts' rotunda and peristyle (palaceSite.ts), so the
 * lagoon's trees and the Exhibition Hall behind the peristyle stay.
 */

import { PALACE } from '../../src/app/sf/landmarks/palace';
import { siteDistance } from './palaceSite';

export const LANDMARK_HOLES: [number, number, number][] = [
    [35, 1, 75], // Fort Point
    [180, -390, 45], // toll plaza (its canopy and gantries)
    [232, -303, 45], // toll plaza admin building
];

/** Distance (m) from (e, n) to the Palace's rotunda and peristyle (<= 0 inside them). */
export const palaceDist = (e: number, n: number) => siteDistance(e - PALACE.e, PALACE.n - n);

/** (e, n) lies in a landmark, or within `pad` m of the Palace's buildings. */
export const inLandmark = (e: number, n: number, pad: number) => palaceDist(e, n) < pad || LANDMARK_HOLES.some(([le, ln, r]) => Math.hypot(e - le, n - ln) < r);
