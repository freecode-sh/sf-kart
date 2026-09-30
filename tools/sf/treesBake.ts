/**
 * Trees for the San Francisco course, from real data:
 *
 *   street trees   DataSF Street Tree Inventory (PDDL): position, species, trunk size
 *   canopy         the 2023 lidar canopy height (USGS 3DEP via NASA WERK, CC0, 1 m) masked by NOAA's
 *                  vegetation index (NDVI from the near-infrared band; drops buildings and walls),
 *                  tree tops found as local maxima (window growing with height); in woodland
 *                  (dense canopy, or groves in the parks away from the street trees) the Presidio's
 *                  planted cypress / eucalyptus / pine, elsewhere broadleaf
 *   elsewhere      (Marin, beyond the lidar) jittered trees on OSM forest / park land cover
 *
 * Each tree: x, y, z (world), scale * 100 (of the type's unit height in trees.ts), type (0 cypress,
 * 1 eucalyptus, 2 pine, 3 broadleaf, 4 palm), + 8 when far from the course (low-detail mesh); and
 * its crown radius (dm, `crowns`): measured in the lidar canopy where it covers the tree, else from
 * the trunk size (street trees) or the type.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import { SCALE, toMeters } from './geo';
import { crsOf, projector } from './raster';
import { TERRAIN_BOX } from './terrainBake';

/** The types' unit heights in trees.ts (world units): scale = real height / this. */
export const TREE_UNIT_H = [950, 1700, 1250, 650, 1100];
export const FAR_FLAG = 8;

const CHM_RES = 1;
/**
 * Woodland test for a canopy top in a park, by the lidar canopy's share within WOODS_R m: woods from
 * WOODS_COVER, or from GROVE_COVER where no DataSF street tree stands within STREET_NEAR m.
 */
const WOODS_R = 15;
const WOODS_COVER = 0.45;
const GROVE_COVER = 0.25;
const STREET_NEAR = 60;

export interface TreeInputs {
    ctx: string;
    /** World y of the ground. */
    groundAt(x: number, z: number): number;
    /** True where a tree may stand (clear of the road, buildings, water, landmarks). */
    ok(e: number, n: number): boolean;
    /** Land cover class at (e, n) meters (bakeWorld LC). */
    landcover(e: number, n: number): number;
    /** Distance (m) from (e, n) to the course's road edge. */
    roadDist(e: number, n: number): number;
    /** Procedural trees for areas without lidar (Marin): called per candidate. */
    fallback(add: (e: number, n: number, type: number, heightM: number) => void, hasLidar: (e: number, n: number) => boolean): void;
    /** The photo shows foliage at (e, n) (for the lidar without NDVI). */
    leafy(e: number, n: number): boolean;
    lcForest: number;
    lcGrass: number;
    lcScrub: number;
}

type Canopy = { at(e: number, n: number): number; W: number; H: number; data: Float32Array };
const canopies = new Map<string, Promise<Canopy>>();

/**
 * Canopy height (m) on a 1 m grid over TERRAIN_BOX (NaN = no lidar): the DSM − DTM band, so
 * buildings too (buildingsBake.ts reads their heights from it). Loaded once per directory.
 */
export function loadCanopy(dir: string): Promise<Canopy> {
    let c = canopies.get(dir);
    if (!c) canopies.set(dir, (c = readCanopy(dir)));
    return c;
}

async function readCanopy(dir: string): Promise<Canopy> {
    const B = TERRAIN_BOX;
    const W = Math.round((B.e1 - B.e0) / CHM_RES);
    const H = Math.round((B.n1 - B.n0) / CHM_RES);
    const data = new Float32Array(W * H).fill(NaN);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('_topographic_cog_1m.tif')) : [];
    for (const f of files) {
        const tif = await fromFile(join(dir, f));
        const im = await tif.getImage();
        const [chm] = (await im.readRasters({ samples: [2] })) as unknown as [Float32Array];
        const to = projector(crsOf(im));
        const [ox, oy] = im.getOrigin();
        const [rx, ry] = im.getResolution();
        const w = im.getWidth();
        const h = im.getHeight();
        // Our grid cells whose centers fall in this tile: CS13 → course meters is near-linear over a
        // tile, so fit an affine map at the tile (a global fit first, to find where the tile is).
        const fit = (e: number, n: number) => {
            const [xa, ya] = to(e, n);
            const [xb, yb] = to(e + 100, n);
            const [xc, yc] = to(e, n + 100);
            return { e, n, xa, ya, dxe: (xb - xa) / 100, dye: (yb - ya) / 100, dxn: (xc - xa) / 100, dyn: (yc - ya) / 100 };
        };
        const invOf = (a: ReturnType<typeof fit>) => {
            const det = a.dxe * a.dyn - a.dxn * a.dye;
            return (x: number, y: number): [number, number] => {
                const X = x - a.xa;
                const Y = y - a.ya;
                return [a.e + (X * a.dyn - Y * a.dxn) / det, a.n + (Y * a.dxe - X * a.dye) / det];
            };
        };
        const center = invOf(fit((B.e0 + B.e1) / 2, (B.n0 + B.n1) / 2))(ox! + (w * rx!) / 2, oy! + (h * ry!) / 2);
        const A = fit(center[0], center[1]);
        const inv = invOf(A);
        const { xa, ya, dxe, dye, dxn, dyn } = A;
        const corners = [inv(ox!, oy!), inv(ox! + w * rx!, oy!), inv(ox!, oy! + h * ry!), inv(ox! + w * rx!, oy! + h * ry!)];
        const e0 = Math.min(...corners.map((c) => c[0]));
        const e1 = Math.max(...corners.map((c) => c[0]));
        const n0 = Math.min(...corners.map((c) => c[1]));
        const n1 = Math.max(...corners.map((c) => c[1]));
        for (let gy = Math.max(0, Math.floor((B.n1 - n1) / CHM_RES)); gy < Math.min(H, Math.ceil((B.n1 - n0) / CHM_RES)); ++gy)
            for (let gx = Math.max(0, Math.floor((e0 - B.e0) / CHM_RES)); gx < Math.min(W, Math.ceil((e1 - B.e0) / CHM_RES)); ++gx) {
                const e = B.e0 + (gx + 0.5) * CHM_RES;
                const n = B.n1 - (gy + 0.5) * CHM_RES;
                const x = xa + (e - A.e) * dxe + (n - A.n) * dxn;
                const y = ya + (e - A.e) * dye + (n - A.n) * dyn;
                const px = Math.floor((x - ox!) / rx!);
                const py = Math.floor((y - oy!) / ry!);
                if (px < 0 || py < 0 || px >= w || py >= h) continue;
                const v = chm![py * w + px]!;
                if (v > -1 && v < 120) data[gy * W + gx] = Math.max(0, v);
            }
        await tif.close();
    }
    return {
        W,
        H,
        data,
        at(e, n) {
            const gx = Math.floor((e - B.e0) / CHM_RES);
            const gy = Math.floor((B.n1 - n) / CHM_RES);
            if (gx < 0 || gy < 0 || gx >= W || gy >= H) return NaN;
            return data[gy * W + gx]!;
        },
    };
}

/** NDVI grid from bakeImagery.ts (Uint8: 0 = none, else 1 + (ndvi + 1) * 127). */
export function loadNdvi(ctx: string): (e: number, n: number) => number {
    const f = join(ctx, 'derived/ndvi.bin');
    const info = join(ctx, 'derived/imagery.json');
    if (!existsSync(f) || !existsSync(info)) return () => NaN;
    const g = (JSON.parse(readFileSync(info, 'utf8')) as { ndvi: { e0: number; n1: number; res: number; nx: number; nz: number } }).ndvi;
    const data = readFileSync(f);
    return (e, n) => {
        const i = Math.floor((e - g.e0) / g.res);
        const j = Math.floor((g.n1 - n) / g.res);
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return NaN;
        const v = data[j * g.nx + i]!;
        return v ? (v - 1) / 127 - 1 : NaN;
    };
}

/** Deterministic hash → [0, 1). */
export function hash(a: number, b: number, seed: number): number {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tree type from a DataSF species name. */
function speciesType(species: string): number {
    const s = species.toLowerCase();
    if (s.includes('palm')) return 4;
    if (s.includes('cypress') || s.includes('juniper') || s.includes('cedar') || s.includes('redwood')) return 0;
    if (s.includes('eucalyptus') || s.includes('gum')) return 1;
    if (s.includes('pine')) return 2;
    return 3;
}

/** Crown radius as a fraction of the height, per type (when there's nothing better). */
const CROWN_OF_H = [0.42, 0.22, 0.26, 0.4, 0.24];

export async function bakeTrees(inp: TreeInputs): Promise<{ trees: number[]; crowns: number[]; counts: Record<string, number> }> {
    const trees: number[] = [];
    const crowns: number[] = [];
    const counts = { street: 0, canopy: 0, fallback: 0, far: 0 };
    const canopy = await loadCanopy(join(inp.ctx, 'chm'));
    const ndvi = loadNdvi(inp.ctx);
    const placed: [number, number][] = [];
    const grid = new Map<string, number[]>();
    const near = (e: number, n: number, r: number) => {
        for (let dj = -1; dj <= 1; ++dj)
            for (let di = -1; di <= 1; ++di)
                for (const k of grid.get(`${Math.floor(e / 8) + di},${Math.floor(n / 8) + dj}`) ?? []) {
                    const p = placed[k]!;
                    if (Math.hypot(p[0] - e, p[1] - n) < r) return true;
                }
        return false;
    };
    const add = (e: number, n: number, type: number, hM: number, rM = hM * CROWN_OF_H[type]!) => {
        if (!inp.ok(e, n)) return false;
        crowns.push(Math.round(Math.max(0.8, Math.min(12, rM)) * 10));
        const x = e * SCALE;
        const z = -n * SCALE;
        const far = inp.roadDist(e, n) > 160 ? FAR_FLAG : 0;
        if (far) ++counts.far;
        trees.push(Math.round(x), Math.round(inp.groundAt(x, z)), Math.round(z), Math.round(((hM * SCALE) / TREE_UNIT_H[type]!) * 100), type + far);
        const k = placed.push([e, n]) - 1;
        const key = `${Math.floor(e / 8)},${Math.floor(n / 8)}`;
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(k);
        return true;
    };
    /**
     * Crown radius (m) of a tree of height h (m) at (e, n) in the canopy model: the mean distance, in
     * 8 directions, to where the canopy drops below 55 % of h (NaN without lidar there).
     */
    const crownOf = (e: number, n: number, h: number) => {
        if (!Number.isFinite(canopy.at(e, n))) return NaN;
        let rs = 0;
        for (let k = 0; k < 8; ++k) {
            const ax = Math.cos((k * Math.PI) / 4);
            const ay = Math.sin((k * Math.PI) / 4);
            let d = 1;
            for (; d < 14; ++d) if (!(canopy.at(e + ax * d, n + ay * d) >= h * 0.55)) break;
            rs += d;
        }
        return rs / 8 + 0.3;
    };
    /** Tallest canopy (m) within r m of (e, n). */
    const canopyMax = (e: number, n: number, r: number) => {
        let m = NaN;
        for (let v = -r; v <= r; ++v)
            for (let u = -r; u <= r; ++u) {
                const h = canopy.at(e + u, n + v);
                if (Number.isFinite(h)) m = Number.isFinite(m) ? Math.max(m, h) : h;
            }
        return m;
    };

    // ---- street trees ----
    const B = TERRAIN_BOX;
    /** Every DataSF tree's cell (STREET_NEAR m): where the city's street trees are. */
    const streetCells = new Set<string>();
    const streetNear = (e: number, n: number) => {
        const i = Math.floor(e / STREET_NEAR);
        const j = Math.floor(n / STREET_NEAR);
        for (let dj = -1; dj <= 1; ++dj) for (let di = -1; di <= 1; ++di) if (streetCells.has(`${i + di},${j + dj}`)) return true;
        return false;
    };
    const stFile = join(inp.ctx, 'datasf/trees.geojson');
    if (existsSync(stFile)) {
        const fc = JSON.parse(readFileSync(stFile, 'utf8')) as { features: { properties: Record<string, string | null> }[] };
        for (const f of fc.features) {
            const p = f.properties;
            const lat = Number.parseFloat(p.latitude ?? '');
            const lon = Number.parseFloat(p.longitude ?? '');
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if ((p.species ?? '').toLowerCase().includes('planting site')) continue;
            const [e, n] = toMeters(lat, lon);
            if (e < B.e0 || e > B.e1 || n < B.n0 || n > B.n1) continue;
            streetCells.add(`${Math.floor(e / STREET_NEAR)},${Math.floor(n / STREET_NEAR)}`);
            const type = speciesType(p.species ?? '');
            const dbh = Number.parseFloat(p.mapdbh ?? '') || 8;
            // Height: the lidar's canopy over the spot, else from the trunk (in inches).
            const ch = canopyMax(e, n, 2);
            const lidar = Number.isFinite(ch) && ch > 2.5;
            let hM = lidar ? ch : Math.max(4, Math.min(18, 3 + 0.55 * dbh));
            if (type === 4) hM = Math.max(hM, 8);
            hM = Math.max(3, Math.min(30, hM));
            // Crown: the lidar's (a street tree's crown can't be much wider than its trunk allows),
            // else urban-forestry allometry from the trunk (inches).
            const fromDbh = Math.min(7, 1.3 + dbh * 0.2);
            let rM = lidar ? Math.min(crownOf(e, n, hM), fromDbh * 1.5) : fromDbh;
            if (!Number.isFinite(rM)) rM = fromDbh;
            if (type === 4) rM = Math.min(3.2, 1.8 + hM * 0.1);
            if (add(e, n, type, hM, rM)) ++counts.street;
        }
    }

    // ---- canopy tops ----
    const { W, H, data } = canopy;
    /** Share of the lidar canopy (>= 3 m) within WOODS_R m of (e, n). */
    const coverAt = (e: number, n: number) => {
        let c = 0;
        let all = 0;
        for (let v = -WOODS_R; v <= WOODS_R; v += 2)
            for (let u = -WOODS_R; u <= WOODS_R; u += 2) {
                if (u * u + v * v > WOODS_R * WOODS_R) continue;
                const h = canopy.at(e + u, n + v);
                if (!Number.isFinite(h)) continue;
                ++all;
                if (h >= 3) ++c;
            }
        return all ? c / all : 0;
    };
    /**
     * Woodland species: stands of one species (a ~40 m patch, its edges jittered per tree) with some
     * trees of the others mixed in: 40 % cypress, 30 % eucalyptus, 30 % pine (the Presidio's planted
     * forest); the tall canopy is half blue gum and the tallest all of it; on scrub (the sea bluffs)
     * cypress and pine; a few young broadleaf trees (oak, willow, myrtle) among the small ones.
     */
    const woodsType = (gx: number, gy: number, e: number, n: number, h: number, lc: number) => {
        const euc = h > 26 ? 0.5 : 0.3;
        const mix = (q: number) => (q < euc ? 1 : q < euc + (1 - euc) * 0.57 ? 0 : 2);
        const je = e + (hash(gx, gy, 9) - 0.5) * 24;
        const jn = n + (hash(gx, gy, 10) - 0.5) * 24;
        let type = hash(gx, gy, 8) < 0.7 ? mix(hash(Math.floor(je / 40), Math.floor(jn / 40), 11)) : mix(hash(gx, gy, 7));
        if (h > 34) type = 1;
        else if (lc === inp.lcScrub && type === 1) type = hash(gx, gy, 12) < 0.6 ? 0 : 2;
        if (h < 7 && hash(gx, gy, 13) < 0.35) type = 3;
        return type;
    };
    for (let gy = 2; gy < H - 2; ++gy)
        for (let gx = 2; gx < W - 2; ++gx) {
            const h = data[gy * W + gx]!;
            if (!(h >= 3)) continue;
            const e = B.e0 + (gx + 0.5) * CHM_RES;
            const n = B.n1 - (gy + 0.5) * CHM_RES;
            // Vegetation only (roofs and walls have a low NDVI; unknown NDVI, the lidar's strip of
            // Marin: the land cover or the photo).
            const v = ndvi(e, n);
            if (Number.isFinite(v) ? v < 0.18 : inp.landcover(e, n) !== inp.lcForest && !inp.leafy(e, n)) continue;
            // A top: the highest point within a window that grows with the tree.
            const r = Math.max(2, Math.min(6, Math.round(1 + h * 0.13)));
            let top = true;
            for (let v2 = -r; v2 <= r && top; ++v2)
                for (let u = -r; u <= r; ++u) {
                    if (u * u + v2 * v2 > r * r || (u === 0 && v2 === 0)) continue;
                    const o = data[(gy + v2) * W + gx + u];
                    if (o !== undefined && o > h) {
                        top = false;
                        break;
                    }
                }
            if (!top || near(e, n, Math.max(3, r * 0.8))) continue;
            // Woodland (OSM forest and scrub; in parks, dense canopy around, or a grove away from the
            // city's street trees: the Presidio is one park polygon) gets the woodland species;
            // isolated park trees and the city's (yards; street trees: DataSF, above) stay broadleaf.
            const lc = inp.landcover(e, n);
            const cover = coverAt(e, n);
            const woods = lc === inp.lcForest || lc === inp.lcScrub || (lc === inp.lcGrass && (cover >= WOODS_COVER || (cover >= GROVE_COVER && !streetNear(e, n))));
            const type = woods ? woodsType(gx, gy, e, n, h, lc) : h > 22 ? (hash(gx, gy, 7) < 0.5 ? 1 : 0) : 3;
            if (add(e, n, type, h, crownOf(e, n, h))) ++counts.canopy;
        }

    // ---- no lidar: procedural ----
    inp.fallback(
        (e, n, type, hM) => {
            if (!near(e, n, 4) && add(e, n, type, hM)) ++counts.fallback;
        },
        (e, n) => Number.isFinite(canopy.at(e, n)),
    );
    return { trees, crowns, counts };
}
