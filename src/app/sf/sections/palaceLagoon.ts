/**
 * The Palace of Fine Arts lagoon. The lidar has its water surface flat ~0.7 m above the bay (the
 * banks ~2 m), so the terrain drew it as dry ground with the aerial photo's dark, blotchy water
 * painted on, and from the palace loop (the course runs round three sides of it) it read as a purple
 * parking lot next to the real, reflective bay. Flooded like the Crissy Field lagoon
 * (waterfront.ts): ground in the lagoon's box that lies within ~1 m of the sea is pushed under the
 * sea plane, so the lagoon is real water with the sky in it and the lidar's own banks round it.
 * Runs on the terrain samples before the terrain is built (scene.ts, before world.stitch()).
 */

import type { SfWorld } from '../world';

/** The lagoon's box (meters east / north); nothing else in it lies this low. */
export const LAGOON_BOX = { e0: 2530, e1: 2700, n0: -960, n1: -700 };
/** Ground below LOW over the sea floods fully, fading out by LAGOON_HIGH (world units: 0.9 m, 1.1 m). */
const LOW = 54;
export const LAGOON_HIGH = 66;
/** The flooded bed, under the sea plane (world units below it). */
const BED = 40;

export function floodPalaceLagoon(world: SfWorld): number {
    const t = world.json.terrain;
    const sea = world.json.seaY;
    let moved = 0;
    const i0 = Math.max(0, Math.floor((LAGOON_BOX.e0 - t.e0) / t.cell));
    const i1 = Math.min(t.cx - 1, Math.floor((LAGOON_BOX.e1 - t.e0) / t.cell));
    const j0 = Math.max(0, Math.floor((t.n1 - LAGOON_BOX.n1) / t.cell));
    const j1 = Math.min(t.cz - 1, Math.floor((t.n1 - LAGOON_BOX.n0) / t.cell));
    for (let j = j0; j <= j1; ++j)
        for (let i = i0; i <= i1; ++i) {
            const h = world.cells[j * t.cx + i];
            if (!h) continue;
            const st = t.steps[t.levels[j * t.cx + i]!]!;
            const m = t.cell / st + 1;
            const ce0 = t.e0 + i * t.cell;
            const cn1 = t.n1 - j * t.cell;
            for (let b = 0; b < m; ++b) {
                const n = cn1 - b * st;
                if (n < LAGOON_BOX.n0 || n > LAGOON_BOX.n1) continue;
                for (let a = 0; a < m; ++a) {
                    const e = ce0 + a * st;
                    if (e < LAGOON_BOX.e0 || e > LAGOON_BOX.e1) continue;
                    const q = b * m + a;
                    const y = h[q]!;
                    if (y >= sea + LAGOON_HIGH) continue;
                    const k = Math.min(1, (sea + LAGOON_HIGH - y) / (LAGOON_HIGH - LOW));
                    h[q] = y + (sea - BED - y) * k;
                    ++moved;
                }
            }
        }
    return moved;
}
