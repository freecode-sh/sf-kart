/**
 * Golden Gate section (bridge_nb, vista, bridge_sb): fixes to the shared scenery that only matter
 * around the bridge.
 *
 * carveUnderBridge: the drivable deck is ~3.7x wider than the real one, so north of the Marin tower
 * the lidar hillside west of the real bridge rises up to ~25 m through the widened southbound
 * carriageway, its sidewalk and railings. Pulls the core terrain (and the trees on it) down under
 * the widened deck — below the truss under the suspended spans, just under the road over the north
 * anchorage — with a 1:1 cut slope beside it, like the real road cut at the north end.
 */

import { SCALE } from '../geo';
import { type CenterlinePoint, LEN, deckY, toAxis, useCourseCenterline } from '../bridgeParts/frame';
import { N1, S1, SLAB_HALF, TRUSS_BOT } from '../bridgeParts/layout';
import type { SfWorld } from '../world';

/** Clearance under the deck surface over the suspended spans (truss bottom + 2 m). */
const UNDER_SPAN = TRUSS_BOT + 2 * SCALE;
/** ... and over the north anchorage (solid concrete: the ground meets the road's underside). */
const UNDER_ANCHORAGE = 1 * SCALE;
/** Past the north end the course's own (baked) carving takes over. */
const END = LEN + 10 * SCALE;

/** Highest ground (world y) allowed at world (x, z), or null where the bridge doesn't constrain it. */
function ceiling(x: number, z: number): number | null {
    const { s, l } = toAxis(x, z);
    // South of S1 the deck sits on the anchorage / Fort Point arch / on-grade approach: untouched.
    if (s < S1[1] || s > END) return null;
    const out = Math.abs(l) - SLAB_HALF;
    if (out > 60 * SCALE) return null;
    // Blend from the span's clearance to the anchorage's across the N1 pylon.
    const t = Math.min(1, Math.max(0, (s - N1[0]) / (N1[1] - N1[0])));
    const under = UNDER_SPAN + (UNDER_ANCHORAGE - UNDER_SPAN) * t;
    return deckY(s, l) - under + Math.max(0, out);
}

export function carveUnderBridge(world: SfWorld, centerline: readonly CenterlinePoint[]): void {
    useCourseCenterline(centerline);
    try {
        const t = world.json.terrain;
        const S = world.json.scale;
        for (let j = 0; j < t.cz; ++j)
            for (let i = 0; i < t.cx; ++i) {
                const h = world.cells[j * t.cx + i];
                if (!h) continue;
                const st = t.steps[t.levels[j * t.cx + i]!]!;
                const m = t.cell / st + 1;
                const e0 = t.e0 + i * t.cell;
                const n0 = t.n1 - j * t.cell;
                // Cheap reject: the cell's center well away from the north half of the bridge.
                const c = toAxis((e0 + t.cell / 2) * S, -(n0 - t.cell / 2) * S);
                if (c.s < S1[0] - t.cell * S || c.s > END + t.cell * S || Math.abs(c.l) > SLAB_HALF + (60 + t.cell) * S) continue;
                for (let b = 0; b < m; ++b)
                    for (let a = 0; a < m; ++a) {
                        const y = ceiling((e0 + a * st) * S, -(n0 - b * st) * S);
                        if (y !== null && h[b * m + a]! > y) h[b * m + a] = y;
                    }
            }
        // Trees on the carved slope: drop the ones under the deck, lower the rest onto the ground.
        const tr = world.json.trees;
        const kept: number[] = [];
        for (let k = 0; k + 4 < tr.length; k += 5) {
            const [x, y, z] = [tr[k]!, tr[k + 1]!, tr[k + 2]!];
            const cap = ceiling(x, z);
            if (cap !== null && y > cap) {
                if (Math.abs(toAxis(x, z).l) < SLAB_HALF + 8 * SCALE) continue;
                kept.push(x, Math.min(y, world.groundY(x, z)), z, tr[k + 3]!, tr[k + 4]!);
            } else kept.push(x, y, z, tr[k + 3]!, tr[k + 4]!);
        }
        tr.length = 0;
        for (const v of kept) tr.push(v);
    } finally {
        useCourseCenterline(null);
    }
}
