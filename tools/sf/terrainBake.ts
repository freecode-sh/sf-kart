/**
 * Core terrain for the San Francisco course, from the 1 m lidar elevation model (heights.ts): a grid
 * of CELL m cells, each sampled at its own spacing by how close the course is — 2 m along the road,
 * 4 m within a few hundred meters (and on cliffs), 8 m beyond, 16 m under shallow water; cells
 * entirely under deep water are left out (the sea covers them).
 *
 * The course is carved in: flattened just under the road (the road mesh covers it), with cut / fill
 * slopes beside it, untouched under the bridge decks, only cut down (never filled) under the
 * viaducts. Where two cells of different spacing meet, the finer cell's edge follows the coarser
 * one's, so the meshes join without cracks.
 *
 * Output: Int16 world y per sample, cells in row-major order (row 0 north, column 0 west), each
 * cell's samples row-major (north row first); `levels` gives each cell's spacing (index into STEPS,
 * NONE = no cell).
 */

import { SCALE } from './geo';
import type { Corridor } from './corridor';
import type { HeightModel } from './heights';

/** Terrain grid (meters east / north of the origin): covers geo.CORE, rounded out to whole cells. */
export const TERRAIN = { e0: -1250, n1: 3350, cell: 96, cx: 50, cz: 54 };
export const TERRAIN_BOX = { e0: TERRAIN.e0, e1: TERRAIN.e0 + TERRAIN.cell * TERRAIN.cx, n0: TERRAIN.n1 - TERRAIN.cell * TERRAIN.cz, n1: TERRAIN.n1 };
/** Sample spacing per level (m). */
export const STEPS = [2, 4, 8, 16];
export const NONE = 255;

export interface BakedTerrain {
    levels: Uint8Array;
    /** Per cell (row-major), its samples (Float32 world y), or null. */
    cells: (Float32Array | null)[];
    /** World y at (e, n) meters, from the baked cells (bilinear in the containing cell). */
    at(e: number, n: number): number;
    /** Int16 blob of all cells in order. */
    bytes(): Buffer;
}

export function bakeTerrainCells(heights: HeightModel, corridor: Corridor, seaY: number): BakedTerrain {
    const wy = (m: number) => seaY + m * SCALE;
    const { cell, cx, cz } = TERRAIN;
    const e0 = (i: number) => TERRAIN.e0 + i * cell;
    const n1 = (j: number) => TERRAIN.n1 - j * cell;

    /** Raw ground (world y) with the course carved in. */
    const ground = (e: number, n: number): number => {
        // Clamp the bay floor (only the shallows show through the water).
        let y = Math.max(wy(heights.at(e, n)), wy(-40));
        const x = e * SCALE;
        const z = -n * SCALE;
        const near = corridor.near(x, z).filter((r) => !r.elevated && r.d < r.hw + 9000);
        near.sort((a, b) => b.d - a.d);
        for (const r of near) {
            const core = r.hw + 120;
            // Viaducts: the ground stays itself under the deck, only cut down where it would reach it.
            if (r.viaduct) {
                y = Math.min(y, r.y - 300 + Math.max(0, r.d - core) * 0.75);
                continue;
            }
            if (r.d < core) {
                y = r.y - 70;
                continue;
            }
            const t = r.d - core;
            const lo = r.y - 70 - t * 0.9; // fill slope
            const hi = r.y + 160 + t * 0.75; // cut slope
            y = Math.min(hi, Math.max(lo, y));
        }
        return y;
    };

    // ---- levels ----
    const levels = new Uint8Array(cx * cz);
    for (let j = 0; j < cz; ++j)
        for (let i = 0; i < cx; ++i) {
            const ce = e0(i) + cell / 2;
            const cn = n1(j) - cell / 2;
            // Distance (m) from the cell to the nearest road edge on the ground, and to any road (the
            // bridge decks look down on the cliffs).
            const dg = corridor.distance(ce * SCALE, -cn * SCALE, false) / SCALE - cell * 0.71;
            const d = corridor.distance(ce * SCALE, -cn * SCALE) / SCALE - cell * 0.71;
            // Relief and depth from a coarse 8 m pass.
            let lo = Infinity;
            let hi = -Infinity;
            let steep = 0;
            for (let b = 0; b <= 12; ++b)
                for (let a = 0; a <= 12; ++a) {
                    const h = heights.at(e0(i) + a * 8, n1(j) - b * 8);
                    lo = Math.min(lo, h);
                    hi = Math.max(hi, h);
                    if (a > 0) steep = Math.max(steep, Math.abs(h - heights.at(e0(i) + (a - 1) * 8, n1(j) - b * 8)) / 8);
                }
            let lv: number;
            if (hi < -3 && dg > 60) lv = NONE;
            else if (dg < 110) lv = 0;
            else if (hi < 0.5) lv = 3;
            else if (d < 420 || (steep > 0.6 && d < 1200)) lv = 1;
            else lv = 2;
            levels[j * cx + i] = lv;
        }

    // ---- samples ----
    const cells: (Float32Array | null)[] = [];
    for (let j = 0; j < cz; ++j)
        for (let i = 0; i < cx; ++i) {
            const lv = levels[j * cx + i]!;
            if (lv === NONE) {
                cells.push(null);
                continue;
            }
            const st = STEPS[lv]!;
            const m = cell / st + 1;
            const h = new Float32Array(m * m);
            for (let b = 0; b < m; ++b) for (let a = 0; a < m; ++a) h[b * m + a] = ground(e0(i) + a * st, n1(j) - b * st);
            cells.push(h);
        }

    // ---- stitch: a finer cell's edge follows its coarser neighbor's samples ----
    /** Index of the k-th sample along a side of an m x m cell. */
    const edge = (m: number, side: 'n' | 's' | 'w' | 'e', k: number) => (side === 'n' ? k : side === 's' ? (m - 1) * m + k : side === 'w' ? k * m : k * m + m - 1);
    const opposite = { n: 's', s: 'n', w: 'e', e: 'w' } as const;
    for (let j = 0; j < cz; ++j)
        for (let i = 0; i < cx; ++i) {
            const h = cells[j * cx + i];
            if (!h) continue;
            const lv = levels[j * cx + i]!;
            const m = cell / STEPS[lv]! + 1;
            for (const [side, di, dj] of [
                ['n', 0, -1],
                ['s', 0, 1],
                ['w', -1, 0],
                ['e', 1, 0],
            ] as const) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= cx || nj >= cz) continue;
                const nh = cells[nj * cx + ni];
                const nl = levels[nj * cx + ni]!;
                if (!nh || nl <= lv) continue;
                const nm = cell / STEPS[nl]! + 1;
                const ratio = (m - 1) / (nm - 1);
                for (let k = 0; k < m; ++k) {
                    const f = k / ratio;
                    const k0 = Math.min(nm - 2, Math.floor(f));
                    const t = f - k0;
                    const a = nh[edge(nm, opposite[side], k0)]!;
                    const b = nh[edge(nm, opposite[side], k0 + 1)]!;
                    h[edge(m, side, k)] = a + (b - a) * t;
                }
            }
        }

    return {
        levels,
        cells,
        at(e, n) {
            const i = Math.floor((e - TERRAIN.e0) / cell);
            const j = Math.floor((TERRAIN.n1 - n) / cell);
            if (i < 0 || j < 0 || i >= cx || j >= cz) return NaN;
            const h = cells[j * cx + i];
            if (!h) return NaN;
            const st = STEPS[levels[j * cx + i]!]!;
            const m = cell / st + 1;
            const fx = (e - e0(i)) / st;
            const fy = (n1(j) - n) / st;
            const a0 = Math.min(m - 2, Math.floor(fx));
            const b0 = Math.min(m - 2, Math.floor(fy));
            const a = fx - a0;
            const b = fy - b0;
            const k = b0 * m + a0;
            return (h[k]! * (1 - a) + h[k + 1]! * a) * (1 - b) + (h[k + m]! * (1 - a) + h[k + m + 1]! * a) * b;
        },
        bytes() {
            const n = cells.reduce((s, c) => s + (c?.length ?? 0), 0);
            const out = new Int16Array(n);
            let o = 0;
            for (const c of cells) if (c) for (let k = 0; k < c.length; ++k) out[o++] = Math.max(-32768, Math.min(32767, Math.round(c[k]!)));
            return Buffer.from(out.buffer);
        },
    };
}
