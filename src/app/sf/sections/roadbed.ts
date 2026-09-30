/**
 * Course-wide roadbed check: the baked terrain is carved under the road, but not everywhere (the
 * bake leaves the bridge's on-grade south approach alone, and there the lidar ground rose ~2 m
 * through the southbound carriageway just before the toll plaza). Runs on the terrain before it's
 * built: any ground sample between a stretch's wall lines that comes within CLEAR of the road
 * surface is pushed down to CLEAR below it, rising 1:1 past the wall lines so the cut meets the
 * untouched ground behind the barriers without a step. Lower ground (the usual case, and everything
 * under decks and viaducts) is left alone.
 *
 * Also finds the ground the asphalt always hides (buriedUnderRoad), which the terrain leaves out.
 */

import type { Station } from '../road';
import type { SfWorld } from '../world';

/** Ground kept at least this far under the road surface (world units; ~0.7 m). */
const CLEAR = 40;
/** How far past the wall line the cut slope reaches. */
const MARGIN = 400;
/** Samples this far inside the asphalt's edges count as under it (the road is drawn to the edges). */
const INSIDE = 200;
/** ...if at most this far under the road surface (deeper, e.g. under a deck, the ground shows). */
const BURIED = 150;

/**
 * Calls `fn` for every ground sample within `reach` of a stretch's wall lines, with the stretch's
 * stations, the position along it (0..1) and the signed lateral offset (+ left, as road.ts);
 * `h[q]` is the sample's height.
 */
function forCorridor(
    world: SfWorld,
    centerline: Station[],
    reach: number,
    fn: (h: Float32Array, q: number, A: Station, B: Station, u: number, lat: number) => void,
): void {
    const t = world.json.terrain;
    const S = world.json.scale;
    for (let k = 0; k + 1 < centerline.length; ++k) {
        const A = centerline[k]!;
        const B = centerline[k + 1]!;
        const ex = B.pos[0] - A.pos[0];
        const ez = B.pos[2] - A.pos[2];
        const len2 = ex * ex + ez * ez;
        if (len2 < 1) continue;
        const len = Math.sqrt(len2);
        const r = Math.max(A.edges.wallL, -A.edges.wallR, B.edges.wallL, -B.edges.wallR) + reach;
        // Bounding box of the segment's corridor (meters e / n).
        const e0 = (Math.min(A.pos[0], B.pos[0]) - r) / S;
        const e1 = (Math.max(A.pos[0], B.pos[0]) + r) / S;
        const n0 = -(Math.max(A.pos[2], B.pos[2]) + r) / S;
        const n1 = -(Math.min(A.pos[2], B.pos[2]) - r) / S;
        const i0 = Math.max(0, Math.floor((e0 - t.e0) / t.cell));
        const i1 = Math.min(t.cx - 1, Math.floor((e1 - t.e0) / t.cell));
        const j0 = Math.max(0, Math.floor((t.n1 - n1) / t.cell));
        const j1 = Math.min(t.cz - 1, Math.floor((t.n1 - n0) / t.cell));
        for (let j = j0; j <= j1; ++j)
            for (let i = i0; i <= i1; ++i) {
                const h = world.cells[j * t.cx + i];
                if (!h) continue;
                const st = t.steps[t.levels[j * t.cx + i]!]!;
                const m = t.cell / st + 1;
                const ce0 = t.e0 + i * t.cell;
                const cn1 = t.n1 - j * t.cell;
                for (let b = 0; b < m; ++b) {
                    const z = -(cn1 - b * st) * S;
                    if (z < -n1 * S || z > -n0 * S) continue;
                    for (let a = 0; a < m; ++a) {
                        const x = (ce0 + a * st) * S;
                        if (x < e0 * S || x > e1 * S) continue;
                        const u = ((x - A.pos[0]) * ex + (z - A.pos[2]) * ez) / len2;
                        if (u < 0 || u > 1) continue;
                        fn(h, b * m + a, A, B, u, ((x - A.pos[0]) * ez - (z - A.pos[2]) * ex) / len);
                    }
                }
            }
    }
}

export function carveRoadbed(world: SfWorld, centerline: Station[]): number {
    let moved = 0;
    forCorridor(world, centerline, MARGIN, (h, q, A, B, u, lat) => {
        const wl = A.edges.wallL + (B.edges.wallL - A.edges.wallL) * u;
        const wr = A.edges.wallR + (B.edges.wallR - A.edges.wallR) * u;
        const out = Math.max(0, lat - wl, wr - lat);
        if (out > MARGIN) return;
        const cap = A.pos[1] + (B.pos[1] - A.pos[1]) * u - CLEAR + out;
        if (h[q]! > cap) {
            h[q] = cap;
            ++moved;
        }
    });
    return moved;
}

/**
 * The ground samples the asphalt always hides: well inside its edges and just under its surface
 * (the road on grade, the usual case once carved). Per terrain cell, a mask of its samples (null
 * where none are); the terrain leaves out the quads whose corners all are (terrain.ts). Not where
 * `noRoad(s)` (the jump gaps, which road.ts leaves open).
 */
export function buriedUnderRoad(world: SfWorld, centerline: Station[], noRoad: (s: number) => boolean): (Uint8Array | null)[] {
    const masks = new Map<Float32Array, Uint8Array>();
    forCorridor(world, centerline, 0, (h, q, A, B, u, lat) => {
        if (noRoad(A.s + (B.s - A.s) * u)) return;
        const rl = A.edges.roadL + (B.edges.roadL - A.edges.roadL) * u;
        const rr = A.edges.roadR + (B.edges.roadR - A.edges.roadR) * u;
        if (lat > rl - INSIDE || lat < rr + INSIDE) return;
        const below = A.pos[1] + (B.pos[1] - A.pos[1]) * u - h[q]!;
        if (below < 0 || below > BURIED) return;
        let mask = masks.get(h);
        if (!mask) masks.set(h, (mask = new Uint8Array(h.length)));
        mask[q] = 1;
    });
    return world.cells.map((h) => (h && masks.get(h)) ?? null);
}
