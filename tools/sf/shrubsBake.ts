/**
 * Low vegetation near the course (trees.ts draws it with the understory shrubs), from real data:
 *
 *   brush       the 2023 lidar canopy 0.5–3 m tall and green in NOAA's NDVI (in the photo where the
 *               lidar reaches into Marin): coastal scrub, hedges, young trees; one clump per few
 *               meters of it, sized by the patch
 *   low green   green under 0.5 m on the scrub's slopes (the bluffs' low scrub, ice plant): sparse, low
 *   dune grass  sand and scrub by the shore with a little green (NDVI): the Crissy Field dunes
 *   brush       (beyond the lidar, Marin) scrub and grass land cover where the photo shows dark green
 *               brush (coyote brush), not tree canopy (bakeWorld.ts plants trees there)
 *
 * Within REACH of the course, thinning out over its last stretch. Each shrub: x, z (world), and
 * kind + 4 * (radius dm + 32 * height dm); kind 0 brush, 1 low green, 2 dune grass. The ground's
 * height comes from the terrain at load (the carves move it).
 */

import { join } from 'node:path';
import { SCALE } from './geo';
import { TERRAIN_BOX } from './terrainBake';
import { loadCanopy, loadNdvi } from './treesBake';

/** Shrubs within REACH[0] m of the road edge, thinning out to none at REACH[1]. */
const REACH = [150, 220] as const;
/** Candidate spacing (m, jittered): the lidar's brush, the low / dune plants, Marin's photo brush. */
const PITCH = { brush: 3, low: 4, photo: 4 };
export const SHRUB_KIND = { brush: 0, low: 1, dune: 2 } as const;
/** Dunes lie below this (m above the sea). */
const DUNE_TOP = 8;

export interface ShrubInputs {
    ctx: string;
    /** True where a shrub may grow (clear of the road, buildings, water, landmarks); `sand` for the dune grass. */
    ok(e: number, n: number, sand: boolean): boolean;
    /** Land cover class at (e, n) meters (bakeWorld LC). */
    landcover(e: number, n: number): number;
    lc: { grass: number; scrub: number; forest: number; sand: number };
    /** Distance (m) from (e, n) to the course's road edge. */
    roadDist(e: number, n: number): number;
    /** Ground height (m) at (e, n). */
    heightAt(e: number, n: number): number;
    /** The photo shows dark green foliage / tree canopy at (e, n) (bakeWorld.ts). */
    leafy(e: number, n: number): boolean;
    grove(e: number, n: number): boolean;
}

function hash(a: number, b: number, seed: number): number {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export async function bakeShrubs(inp: ShrubInputs): Promise<{ shrubs: number[]; counts: Record<string, number> }> {
    const canopy = await loadCanopy(join(inp.ctx, 'chm'));
    const ndvi = loadNdvi(inp.ctx);
    const B = TERRAIN_BOX;
    const shrubs: number[] = [];
    const counts = { brush: 0, low: 0, dune: 0, marin: 0 };
    const add = (e: number, n: number, kind: number, rM: number, hM: number) => {
        const r = Math.max(3, Math.min(31, Math.round(rM * 10)));
        const h = Math.max(2, Math.min(30, Math.round(hM * 10)));
        shrubs.push(Math.round(e * SCALE), Math.round(-n * SCALE), kind + 4 * (r + 32 * h));
    };
    // The road distance on a coarse grid (it's a brute-force search): cells beyond the reach are skipped.
    const C = 20;
    const cx = Math.ceil((B.e1 - B.e0) / C);
    const cz = Math.ceil((B.n1 - B.n0) / C);
    const reach = new Float32Array(cx * cz);
    for (let j = 0; j < cz; ++j)
        for (let i = 0; i < cx; ++i) {
            const d = inp.roadDist(B.e0 + (i + 0.5) * C, B.n0 + (j + 0.5) * C);
            reach[j * cx + i] = Math.max(0, Math.min(1, (REACH[1] - d) / (REACH[1] - REACH[0])));
        }
    const reachAt = (e: number, n: number) => {
        const i = Math.floor((e - B.e0) / C);
        const j = Math.floor((n - B.n0) / C);
        return i < 0 || j < 0 || i >= cx || j >= cz ? 0 : reach[j * cx + i]!;
    };
    /** Green in the NDVI; where there's none (the lidar's strip of Marin), in the photo. */
    const green = (e: number, n: number) => {
        const v = ndvi(e, n);
        return Number.isFinite(v) ? v >= 0.2 : inp.leafy(e, n);
    };
    const slope = (e: number, n: number) => Math.hypot(inp.heightAt(e + 1.5, n) - inp.heightAt(e - 1.5, n), inp.heightAt(e, n + 1.5) - inp.heightAt(e, n - 1.5)) / 3;

    /** Calls fn at each jittered candidate of a `pitch` m grid within the reach, with its thinning and a hash. */
    const scan = (pitch: number, seed: number, fn: (e: number, n: number, keep: number, q: (s: number) => number) => void) => {
        for (let n = B.n0; n < B.n1; n += pitch)
            for (let e = B.e0; e < B.e1; e += pitch) {
                const keep = reachAt(e, n);
                if (keep <= 0) continue;
                const gi = Math.round(e / pitch);
                const gj = Math.round(n / pitch);
                const q = (s: number) => hash(gi, gj, seed + s);
                fn(e + (q(0) - 0.5) * pitch * 0.9, n + (q(1) - 0.5) * pitch * 0.9, keep, q);
            }
    };

    // ---- lidar: brush 0.5–3 m (the share of it within 1.5 m sets the chance and the size) ----
    scan(PITCH.brush, 20, (e, n, keep, q) => {
        if (!Number.isFinite(canopy.at(e, n))) return;
        let cells = 0;
        let hSum = 0;
        for (let v = -1; v <= 1; ++v)
            for (let u = -1; u <= 1; ++u) {
                const h = canopy.at(e + u, n + v);
                if (h >= 0.5 && h < 3 && green(e + u, n + v)) {
                    ++cells;
                    hSum += h;
                }
            }
        const f = cells / 9;
        if (f < 0.34 || q(2) > keep * Math.min(1, f * 1.3) || !inp.ok(e, n, false)) return;
        add(e, n, SHRUB_KIND.brush, 0.9 + 1.3 * f * (0.7 + 0.6 * q(3)), Math.max(0.6, hSum / cells));
        ++counts.brush;
    });
    // ---- lidar: the dunes' grass (sand and scrub by the shore; dormant in February, so only a
    // little green), and low green on the slopes ----
    scan(PITCH.low, 30, (e, n, keep, q) => {
        const h = canopy.at(e, n);
        const v = ndvi(e, n);
        const lc = inp.landcover(e, n);
        if ((lc === inp.lc.sand || lc === inp.lc.scrub) && inp.heightAt(e, n) < DUNE_TOP) {
            if (!(h < 1.5) || !(v >= 0.02 && v < 0.2) || q(2) > keep * 0.4 || !inp.ok(e, n, true)) return;
            add(e, n, SHRUB_KIND.dune, 0.5 + 0.4 * q(3), 0.4 + 0.3 * q(4));
            ++counts.dune;
        } else {
            if (lc !== inp.lc.scrub && lc !== inp.lc.forest) return;
            if (!(h < 0.5) || !(v >= 0.25) || slope(e, n) < 0.36 || q(2) > keep * 0.45 || !inp.ok(e, n, false)) return;
            add(e, n, SHRUB_KIND.low, 0.7 + 0.7 * q(3), 0.35 + 0.35 * q(4));
            ++counts.low;
        }
    });
    // ---- no lidar (Marin): the photo's brush on scrub and grass ----
    scan(PITCH.photo, 40, (e, n, keep, q) => {
        if (Number.isFinite(canopy.at(e, n))) return;
        const lc = inp.landcover(e, n);
        if (lc !== inp.lc.scrub && lc !== inp.lc.grass) return;
        if (q(2) > keep * 0.6 || !inp.leafy(e, n) || inp.grove(e, n) || !inp.ok(e, n, false)) return;
        const r = 1 + 1.2 * q(3);
        add(e, n, SHRUB_KIND.brush, r, r * (0.6 + 0.5 * q(4)));
        ++counts.marin;
    });
    return { shrubs, counts };
}
