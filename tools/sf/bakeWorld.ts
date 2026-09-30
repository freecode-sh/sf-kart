/**
 * Bakes the San Francisco scenery around the Golden Gate course into public/data/sf/:
 *
 *   terrain.bin        Int16 world y per terrain cell sample (terrainBake.ts: multi-resolution cells
 *                      from the 1 m lidar, the course carved in).
 *   landcover.bin      Uint8 on an 8 m grid over the terrain: 0 urban, 1 grass/park, 2 forest, 3 sand,
 *                      4 scrub, 5 water, 6 paved.
 *   terrain_far.bin    Float32 world y, 100 m grid over geo.FAR (the horizon).
 *   depth.bin          Uint8 water depth (m; 255 = land), 20 m grid, for the sea's colour.
 *   img/far.jpg        NAIP orthoimagery for geo.FAR, graded like the core's (bakeImagery.ts, grade.ts).
 *   world.json         grids, imagery (from bakeImagery.ts), buildings (buildingsBake.ts: DataSF
 *                      footprints split into lots by the parcels, OSM where DataSF has none, 2023
 *                      lidar heights and roofs, facade kinds per edge, photo roof colours), trees
 *                      (treesBake.ts), shrubs (shrubsBake.ts), streets,
 *                      viaducts (S ranges along the lap, for src/app/sf/sections/parkway.ts),
 *                      attribution.
 *
 * Usage: npx tsx tools/sf/bakeWorld.ts    (after tools/sf/fetch.ts, datasf.ts, bakeTrack.ts and build.ts golden_gate)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dem } from './dem';
import { FAR, SCALE, toMeters } from './geo';
import { HeightModel, MSL_NAVD88 } from './heights';
import { HeightRaster, ImageTiles } from './raster';
import { DEM_FILES, NOAA_TILES } from './sources';
import { grade, loadNaip, naipGain } from './grade';
import { bakeTerrainCells, NONE, STEPS, TERRAIN, TERRAIN_BOX } from './terrainBake';
import { loadOsm, simplify, type OsmElement, type OsmWay, type P2 } from './osm';
import { SEA_Y } from './bakeTrack';
import { Corridor, osmViaducts, type Meta } from './corridor';
import { bakeBuildings } from './buildingsBake';
import { bakeTrees, hash } from './treesBake';
import { bakeShrubs } from './shrubsBake';
import { inLandmark, palaceDist } from './landmarkHoles';
import { PALACE } from '../../src/app/sf/landmarks/palace';
import { LAGOON_BOX, LAGOON_HIGH } from '../../src/app/sf/sections/palaceLagoon';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CTX = join(ROOT, '.context/sf');
const OUT = join(ROOT, 'public/data/sf');

const STEP = 8; // core grid spacing (m)
const FAR_STEP = 100;
const wy = (m: number) => SEA_Y + m * SCALE;

// ---------------------------------------------------------------------------------------------
// Polygons from OSM (closed ways + multipolygon outer rings), scanline rasterization.
// ---------------------------------------------------------------------------------------------
type Ring = P2[]; // meters

function rings(el: OsmElement): Ring[] {
    if (el.type === 'way') {
        const pts = el.geometry.map((g) => toMeters(g.lat, g.lon));
        return el.nodes[0] === el.nodes[el.nodes.length - 1] && pts.length > 3 ? [pts] : [];
    }
    if (el.type !== 'relation') return [];
    // Join outer member ways end to end.
    const parts = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry!.map((g) => toMeters(g.lat, g.lon)));
    const out: Ring[] = [];
    const key = (p: P2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    while (parts.length) {
        let ring = parts.shift()!;
        for (let guard = 0; guard < 1000 && key(ring[0]!) !== key(ring[ring.length - 1]!); ++guard) {
            const end = key(ring[ring.length - 1]!);
            const i = parts.findIndex((p) => key(p[0]!) === end || key(p[p.length - 1]!) === end);
            if (i < 0) break;
            const p = parts.splice(i, 1)[0]!;
            ring = ring.concat(key(p[0]!) === end ? p.slice(1) : p.reverse().slice(1));
        }
        if (ring.length > 3) out.push(ring);
    }
    return out;
}

class Grid {
    constructor(
        readonly e0: number,
        readonly n0: number,
        readonly step: number,
        readonly nx: number,
        readonly nz: number,
    ) {}
    /** Row j runs from north (j = 0) to south; column i from west to east. */
    e(i: number) {
        return this.e0 + i * this.step;
    }
    n(j: number) {
        return this.n0 - j * this.step;
    }
    /** Calls fn(i, j) for every vertex inside the ring (even-odd scanline). */
    fill(ring: Ring, fn: (i: number, j: number) => void): void {
        let nMin = Infinity;
        let nMax = -Infinity;
        for (const p of ring) {
            nMin = Math.min(nMin, p[1]);
            nMax = Math.max(nMax, p[1]);
        }
        const j0 = Math.max(0, Math.ceil((this.n0 - nMax) / this.step));
        const j1 = Math.min(this.nz - 1, Math.floor((this.n0 - nMin) / this.step));
        for (let j = j0; j <= j1; ++j) {
            const y = this.n(j);
            const xs: number[] = [];
            for (let k = 0; k < ring.length; ++k) {
                const a = ring[k]!;
                const b = ring[(k + 1) % ring.length]!;
                if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
            }
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const i0 = Math.max(0, Math.ceil((xs[k]! - this.e0) / this.step));
                const i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1]! - this.e0) / this.step));
                for (let i = i0; i <= i1; ++i) fn(i, j);
            }
        }
    }
}

const LC = { urban: 0, grass: 1, forest: 2, sand: 3, scrub: 4, water: 5, paved: 6 } as const;

function landcoverOf(t: Record<string, string>): number | null {
    if (t.natural === 'wood' || t.landuse === 'forest') return LC.forest;
    if (t.natural === 'beach' || t.natural === 'sand') return LC.sand;
    if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland' || t.natural === 'wetland' || t.natural === 'bare_rock') return LC.scrub;
    if (t.natural === 'water' || t.water) return LC.water;
    if (t.leisure === 'park' || t.leisure === 'pitch' || t.leisure === 'golf_course' || t.leisure === 'garden' || t.leisure === 'nature_reserve' || t.leisure === 'common')
        return LC.grass;
    if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'recreation_ground' || t.landuse === 'cemetery' || t.landuse === 'village_green') return LC.grass;
    if (t.amenity === 'parking' || t.landuse === 'industrial' || t.landuse === 'railway') return LC.paved;
    return null;
}
/** Paint order: later wins (small specific areas over big parks). */
const LC_ORDER = [LC.grass, LC.scrub, LC.forest, LC.paved, LC.sand, LC.water];

// ---------------------------------------------------------------------------------------------

type Photo = (e: number, n: number) => [number, number, number] | null;

/** The baked base imagery (bakeImagery.ts): sRGB at (e, n) meters, or null outside it / unbaked. */
async function photoSampler(): Promise<Photo> {
    const info = existsSync(join(CTX, 'derived/imagery.json'))
        ? (JSON.parse(readFileSync(join(CTX, 'derived/imagery.json'), 'utf8')) as { base: { e0: number; e1: number; n0: number; n1: number; n: number; pattern: string } }).base
        : null;
    if (!info) return () => null;
    const tiles: { data: Buffer; w: number; h: number }[] = [];
    for (let j = 0; j < info.n; ++j)
        for (let i = 0; i < info.n; ++i) {
            const f = join(OUT, info.pattern.replace('{i}', String(i)).replace('{j}', String(j)));
            const { data, info: im } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            tiles.push({ data, w: im.width, h: im.height });
        }
    const tw = (info.e1 - info.e0) / info.n;
    const th = (info.n1 - info.n0) / info.n;
    return (e, n) => {
        const i = Math.floor((e - info.e0) / tw);
        const j = Math.floor((info.n1 - n) / th);
        if (i < 0 || j < 0 || i >= info.n || j >= info.n) return null;
        const t = tiles[j * info.n + i]!;
        const x = Math.min(t.w - 1, Math.floor(((e - info.e0 - i * tw) / tw) * t.w));
        const y = Math.min(t.h - 1, Math.floor(((info.n1 - j * th - n) / th) * t.h));
        const k = (y * t.w + x) * 3;
        return [t.data[k]!, t.data[k + 1]!, t.data[k + 2]!];
    };
}

/**
 * Roof colours from the base imagery: the median colour inside a footprint, shrunk a little (the
 * photos lean, and edges catch walls and shadows). 0xRRGGBB, or -1 if unknown.
 */
function roofSampler(px: Photo): (ring: Ring) => number {
    return (ring) => {
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        const inner = ring.map((p) => [c[0] + (p[0] - c[0]) * 0.7, c[1] + (p[1] - c[1]) * 0.7] as P2);
        const samples: [number, number, number][] = [];
        let e0 = Infinity;
        let e1 = -Infinity;
        let n0 = Infinity;
        let n1 = -Infinity;
        for (const p of inner) {
            e0 = Math.min(e0, p[0]);
            e1 = Math.max(e1, p[0]);
            n0 = Math.min(n0, p[1]);
            n1 = Math.max(n1, p[1]);
        }
        const step = Math.max(1, Math.min(e1 - e0, n1 - n0) / 8);
        for (let n = n0; n <= n1; n += step)
            for (let e = e0; e <= e1; e += step) {
                let ok = false;
                for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
                    const a = inner[i]!;
                    const b = inner[j]!;
                    if (a[1] > n !== b[1] > n && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) ok = !ok;
                }
                const v = ok ? px(e, n) : null;
                if (v) samples.push(v);
            }
        if (samples.length < 3) return -1;
        const med = (c: number) => samples.map((s) => s[c]!).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
        return (med(0) << 16) | (med(1) << 8) | med(2);
    };
}

async function main(): Promise<void> {
    const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/courses/golden_gate/course_meta.json'), 'utf8')) as Meta;
    const els = loadOsm(join(CTX, 'osm.json'));
    const heights = await HeightModel.load(CTX, { e0: TERRAIN_BOX.e0 - 300, e1: TERRAIN_BOX.e1 + 300, n0: TERRAIN_BOX.n0 - 300, n1: TERRAIN_BOX.n1 + 300 });
    // The Presidio Parkway's viaducts (OSM bridges over the valleys): on piers, not embankments.
    const viaducts = osmViaducts(meta, els, heights, SEA_Y, [meta.segments.parkway!]);
    console.log(`viaducts: ${viaducts.map(([a, b]) => `${(a / SCALE).toFixed(0)}-${(b / SCALE).toFixed(0)} m`).join(', ')}`);
    const corridor = new Corridor(meta, ['bridge_nb', 'bridge_sb'], viaducts);
    mkdirSync(join(OUT, 'img'), { recursive: true });

    // ---- terrain ----
    const terrain = bakeTerrainCells(heights, corridor, SEA_Y);
    writeFileSync(join(OUT, 'terrain.bin'), terrain.bytes());
    const groundAt = (x: number, z: number): number => {
        const y = terrain.at(x / SCALE, -z / SCALE);
        return Number.isFinite(y) ? y : wy(-40);
    };
    {
        const count = [0, 0, 0, 0, 0];
        for (const l of terrain.levels) ++count[l === NONE ? 4 : l]!;
        console.log(`terrain cells: ${STEPS.map((s, k) => `${s} m x${count[k]}`).join(', ')}, none x${count[4]}; ${(terrain.bytes().length / 1e6).toFixed(2)} MB`);
    }

    // ---- land cover (8 m grid over the terrain) ----
    const nx = Math.round((TERRAIN_BOX.e1 - TERRAIN_BOX.e0) / STEP) + 1;
    const nz = Math.round((TERRAIN_BOX.n1 - TERRAIN_BOX.n0) / STEP) + 1;
    const grid = new Grid(TERRAIN_BOX.e0, TERRAIN_BOX.n1, STEP, nx, nz);
    const lc = new Uint8Array(nx * nz);
    const polys: { lc: number; ring: Ring }[] = [];
    for (const el of els) {
        const t = el.tags;
        if (!t) continue;
        const c = landcoverOf(t);
        if (c === null) continue;
        for (const r of rings(el)) polys.push({ lc: c, ring: r });
    }
    polys.sort((a, b) => LC_ORDER.indexOf(a.lc as never) - LC_ORDER.indexOf(b.lc as never));
    for (const p of polys) grid.fill(p.ring, (i, j) => (lc[j * nx + i] = p.lc));
    for (let j = 0; j < nz; ++j)
        for (let i = 0; i < nx; ++i) {
            const k = j * nx + i;
            const e = grid.e(i);
            const n = grid.n(j);
            if (heights.at(e, n) <= 0.3 && groundAt(e * SCALE, -n * SCALE) < wy(0.5)) lc[k] = LC.water;
        }
    writeFileSync(join(OUT, 'landcover.bin'), lc);

    // ---- far terrain ----
    const fnx = Math.round((FAR.e1 - FAR.e0) / FAR_STEP) + 1;
    const fnz = Math.round((FAR.n1 - FAR.n0) / FAR_STEP) + 1;
    const farDem = Dem.load(join(CTX, 'terrain'), 11);
    const far = new Float32Array(fnx * fnz);
    for (let j = 0; j < fnz; ++j)
        for (let i = 0; i < fnx; ++i) {
            const e = FAR.e0 + i * FAR_STEP;
            const n = FAR.n1 - j * FAR_STEP;
            // Alcatraz is its own model (landmarks.ts): keep the far grid under water there.
            const alc = Math.hypot(e - 4803, n - 1803) < 380;
            far[j * fnx + i] = alc ? wy(-15) : Math.max(wy(-40), wy(farDem.at(e, n) - MSL_NAVD88));
        }
    writeFileSync(join(OUT, 'terrain_far.bin'), Buffer.from(far.buffer));
    console.log(`far terrain ${fnx}x${fnz}`);

    // ---- buildings (buildingsBake.ts: DataSF footprints split into lots, lidar heights, facades) ----
    // Out of the landmarks (landmarkHoles.ts).
    const photo = await photoSampler();
    const bld = await bakeBuildings({
        ctx: CTX,
        els,
        corridor,
        groundAt,
        roofColor: roofSampler(photo),
        // By the centroid; small pieces (the planters, the pavilions' parts) by any corner.
        hole(ring) {
            const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
            if (inLandmark(c[0]!, c[1]!, 8)) return true;
            const area = Math.abs(ring.reduce((a, p, k) => a + p[0] * ring[(k + 1) % ring.length]![1] - ring[(k + 1) % ring.length]![0] * p[1], 0)) / 2;
            return area < 400 && ring.some((p) => palaceDist(p[0], p[1]) < 6);
        },
        // What the holes used to cover (a 150 m disc round the Palace, 70 m round the toll plaza).
        late(ring) {
            const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
            return Math.hypot(c[0]! - PALACE.e, c[1]! - PALACE.n) < 150 || Math.hypot(c[0]! - 180, c[1]! + 390) < 70;
        },
        seaY: SEA_Y,
    });
    console.log(bld.log);

    const bldGrid = new Uint8Array(nx * nz);
    for (const ring of bld.rings) grid.fill(ring, (i, j) => (bldGrid[j * nx + i] = 1));
    // ---- trees (treesBake.ts: DataSF street trees, lidar canopy tops, procedural in Marin) ----
    const lcAt = (e: number, n: number) => {
        const i = Math.round((e - grid.e0) / STEP);
        const j = Math.round((grid.n0 - n) / STEP);
        return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : lc[j * nx + i]!;
    };
    /**
     * Where a plant may stand: `road` (world units) clear of the course's road (the chase camera too),
     * not under the bridge decks, `landmark` m clear of the landmarks, not in buildings or water; on
     * sand only if `sand`.
     */
    const plantable = (e: number, n: number, road: number, landmark: number, sand: boolean) => {
        const x = e * SCALE;
        const z = -n * SCALE;
        if (corridor.clearance(x, z, false) < road || corridor.clearance(x, z) < 0) return false;
        const i = Math.round((e - grid.e0) / STEP);
        const j = Math.round((grid.n0 - n) / STEP);
        if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
        const k = j * nx + i;
        if (bldGrid[k] || lc[k] === LC.water || (lc[k] === LC.sand && !sand)) return false;
        // Clear of the water (and of the Palace lagoon's flooded banks, palaceLagoon.ts).
        const lagoon = e > LAGOON_BOX.e0 && e < LAGOON_BOX.e1 && n > LAGOON_BOX.n0 && n < LAGOON_BOX.n1;
        if (groundAt(x, z) < (lagoon ? SEA_Y + LAGOON_HIGH + 12 : wy(0.8))) return false;
        return !inLandmark(e, n, landmark);
    };
    /** The photo shows foliage (trees, brush) at (e, n): dark and green, not golden grass, asphalt or blue shade. */
    const leafy = (e: number, n: number) => {
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (const [u, v] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const c = photo(e + u, n + v);
            if (!c) continue;
            r += c[0];
            g += c[1];
            b += c[2];
            ++k;
        }
        return k > 0 && (0.3 * r + 0.59 * g + 0.11 * b) / k < 90 && (g - r) / k > -2 && (g - b) / k > 15;
    };
    /** The photo shows tree canopy around (e, n): dark green across ~6 m (brush is lighter, patchier). */
    const grove = (e: number, n: number) => {
        let hits = 0;
        for (let v = -3; v <= 3; v += 3)
            for (let u = -3; u <= 3; u += 3) {
                const c = photo(e + u, n + v);
                if (c && 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] < 80 && c[1] - c[0] > -4 && c[1] - c[2] > 12) ++hits;
            }
        return hits >= 7;
    };
    /** Higher than the ground ~15 m around: a ridge or knoll. */
    const ridge = (e: number, n: number) => heights.at(e, n) - (heights.at(e - 15, n) + heights.at(e + 15, n) + heights.at(e, n - 15) + heights.at(e, n + 15)) / 4 > 1;
    /** How far (m, up to 16) (e, n) lies inside the forest land cover. */
    const forestDepth = (e: number, n: number) => {
        for (let d = 4; d <= 16; d += 4)
            for (let k = 0; k < 8; ++k) if (lcAt(e + Math.cos((k * Math.PI) / 4) * d, n + Math.sin((k * Math.PI) / 4) * d) !== LC.forest) return d - 4;
        return 16;
    };
    const { trees, crowns, counts } = await bakeTrees({
        ctx: CTX,
        groundAt,
        leafy,
        lcForest: LC.forest,
        lcGrass: LC.grass,
        lcScrub: LC.scrub,
        landcover: lcAt,
        roadDist: (e, n) => corridor.distance(e * SCALE, -n * SCALE, false) / SCALE,
        ok: (e, n) => plantable(e, n, 350, 10, false),
        fallback(add, hasLidar) {
            // Where the lidar doesn't reach (Marin), from the land cover and the photo. Forest: a
            // jittered 11 m grid, thinning over its first 15 m (soft grove edges) and in clearings;
            // elsewhere groves where the photo shows tree canopy (Fort Baker's eucalyptus and
            // cypress) and a few trees where it shows foliage: yards, parks, and very few pines on
            // the scrub. None on the scrub's ridges or high up (wind-swept).
            for (let n = TERRAIN_BOX.n0; n < TERRAIN_BOX.n1; n += 11)
                for (let e = TERRAIN_BOX.e0; e < TERRAIN_BOX.e1; e += 11) {
                    const gi = Math.round(e / 11);
                    const gj = Math.round(n / 11);
                    const je = e + (hash(gi, gj, 1) - 0.5) * 9;
                    const jn = n + (hash(gi, gj, 2) - 0.5) * 9;
                    if (hasLidar(je, jn)) continue;
                    const c = lcAt(je, jn);
                    const r = hash(gi, gj, 3);
                    const t = hash(gi, gj, 5);
                    const hM = 7 + hash(gi, gj, 4) ** 1.3 * 15;
                    const exposed = heights.at(je, jn) > 150 || ridge(je, jn);
                    if (c === LC.forest) {
                        const p = (0.3 + 0.5 * Math.min(1, forestDepth(je, jn) / 15)) * (leafy(je, jn) ? 1 : 0.4);
                        if (r < p) add(je, jn, t < 0.4 ? 0 : t < 0.75 ? 2 : 1, t < 0.75 ? hM : Math.min(26, hM * 1.3));
                    } else if (c !== LC.urban && c !== LC.grass && c !== LC.scrub) continue;
                    else if (grove(je, jn) && r < (c === LC.scrub ? (exposed ? 0 : 0.3) : 0.5))
                        add(je, jn, t < 0.35 ? 1 : t < 0.7 ? 0 : t < 0.85 ? 2 : 3, t < 0.35 ? Math.min(26, hM * 1.3) : hM);
                    else if (!leafy(je, jn)) continue;
                    else if (c === LC.urban && r < 0.03) add(je, jn, t < 0.5 ? 3 : 0, hM * 0.8);
                    else if (c === LC.grass && r < 0.035) add(je, jn, 3, hM * 0.8);
                    else if (c === LC.scrub && r < 0.004 && !exposed) add(je, jn, t < 0.5 ? 2 : 0, hM * 0.6);
                }
        },
    });
    console.log(`trees: ${trees.length / 5} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    // ---- shrubs (shrubsBake.ts: the lidar's brush, low green and dune grass; the photo's brush in Marin) ----
    const shrubs = await bakeShrubs({
        ctx: CTX,
        ok: (e, n, sand) => plantable(e, n, 250, 6, sand),
        landcover: lcAt,
        lc: { grass: LC.grass, scrub: LC.scrub, forest: LC.forest, sand: LC.sand },
        roadDist: (e, n) => corridor.distance(e * SCALE, -n * SCALE) / SCALE,
        heightAt: (e, n) => heights.at(e, n),
        leafy,
        grove,
    });
    console.log(`shrubs: ${shrubs.shrubs.length / 3} (${Object.entries(shrubs.counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);

    // ---- streets (for drawing, not driving): polylines with a width, cut out of the course ----
    const WIDTH: Record<string, number> = {
        motorway: 14, trunk: 13, primary: 12, secondary: 11, tertiary: 9, unclassified: 7, residential: 8, living_street: 6,
        motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6, service: 5, pedestrian: 5,
        footway: 2.5, path: 2, cycleway: 3, steps: 2, track: 3,
    };
    const streets: { w: number; kind: number; pts: number[] }[] = [];
    for (const el of els) {
        if (el.type !== 'way' || !el.tags?.highway) continue;
        const w = WIDTH[el.tags.highway];
        if (!w) continue;
        if (el.tags.tunnel === 'yes') continue;
        const kind = w >= 5 ? 0 : 1;
        // Streets pass under the viaducts; the viaducts' own OSM ways (bridges) don't get drawn.
        const bridge = !!el.tags.bridge && el.tags.bridge !== 'no';
        let run: number[] = [];
        const flush = () => {
            if (run.length >= 4) streets.push({ w, kind, pts: run });
            run = [];
        };
        const pts = simplify((el as OsmWay).geometry.map((g) => toMeters(g.lat, g.lon)), 0.8);
        for (const p of pts) {
            if (p[0] < TERRAIN_BOX.e0 || p[0] > TERRAIN_BOX.e1 || p[1] < TERRAIN_BOX.n0 || p[1] > TERRAIN_BOX.n1) {
                flush();
                continue;
            }
            const x = p[0] * SCALE;
            const z = -p[1] * SCALE;
            if (corridor.clearance(x, z, false, bridge) < 200) {
                flush();
                continue;
            }
            run.push(Math.round(x), Math.round(z));
        }
        flush();
    }
    console.log(`streets: ${streets.length}`);

    // ---- water depth (NOAA CUDEM topobathy) for the sea's colour: Uint8 m, 255 = land ----
    const DEPTH = { e0: -3500, e1: 7000, n0: -2500, n1: 6500, step: 20 };
    const dnx = Math.round((DEPTH.e1 - DEPTH.e0) / DEPTH.step) + 1;
    const dnz = Math.round((DEPTH.n1 - DEPTH.n0) / DEPTH.step) + 1;
    {
        const cudem = await HeightRaster.load(join(CTX, 'dem', DEM_FILES.cudem), DEPTH, (v) => v > -500 && v < 1000);
        const depth = new Uint8Array(dnx * dnz);
        for (let j = 0; j < dnz; ++j)
            for (let i = 0; i < dnx; ++i) {
                const h = (cudem?.at(DEPTH.e0 + i * DEPTH.step, DEPTH.n1 - j * DEPTH.step) ?? NaN) - MSL_NAVD88;
                depth[j * dnx + i] = !Number.isFinite(h) ? 120 : h > 0 ? 255 : Math.min(250, Math.round(-h));
            }
        writeFileSync(join(OUT, 'depth.bin'), depth);
    }

    // ---- imagery (core: bakeImagery.ts; far field: NAIP, matched and graded like the core's, grade.ts) ----
    {
        const noaa = await ImageTiles.open(NOAA_TILES.map((t) => join(CTX, 'noaa', `${t}.tif`)));
        const { gain } = await naipGain(noaa, await loadNaip(CTX));
        await noaa.close();
        const { data, info } = await sharp(join(CTX, 'naip/far/0_0.jpg')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const px = new Float32Array(3);
        for (let k = 0; k < data.length; k += 3) {
            for (let c = 0; c < 3; ++c) px[c] = data[k + c]! * gain[c]!;
            grade(px);
            for (let c = 0; c < 3; ++c) data[k + c] = Math.round(px[c]!);
        }
        await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 82 }).toFile(join(OUT, 'img/far.jpg'));
    }
    const imagery = existsSync(join(CTX, 'derived/imagery.json'))
        ? (JSON.parse(readFileSync(join(CTX, 'derived/imagery.json'), 'utf8')) as { base: unknown; detail: unknown })
        : null;

    const world = {
        attribution:
            'Map data © OpenStreetMap contributors (ODbL). Elevation: USGS 3DEP lidar, NOAA NCEI CUDEM (public domain), AWS Terrain Tiles. Imagery: NOAA NGS, USDA NAIP (public domain). Canopy: USGS 3DEP via NASA WERK (CC0). Buildings, street trees: DataSF (PDDL).',
        scale: SCALE,
        seaY: SEA_Y,
        terrain: { e0: TERRAIN.e0, n1: TERRAIN.n1, cell: TERRAIN.cell, cx: TERRAIN.cx, cz: TERRAIN.cz, steps: STEPS, levels: Array.from(terrain.levels), file: 'terrain.bin' },
        landcover: { e0: TERRAIN_BOX.e0, e1: TERRAIN_BOX.e1, n0: TERRAIN_BOX.n0, n1: TERRAIN_BOX.n1, step: STEP, nx, nz, file: 'landcover.bin' },
        imagery: imagery && { base: imagery.base, detail: imagery.detail },
        far: { e0: FAR.e0, e1: FAR.e1, n0: FAR.n0, n1: FAR.n1, step: FAR_STEP, nx: fnx, nz: fnz, file: 'terrain_far.bin', image: 'img/far.jpg' },
        depth: { ...DEPTH, nx: dnx, nz: dnz, file: 'depth.bin', max: 250 },
        buildings: bld.json,
        trees,
        treeCrowns: crowns,
        shrubs: shrubs.shrubs,
        streets,
        viaducts: viaducts.map(([a, b]) => [Math.round(a), Math.round(b)]),
    };
    writeFileSync(join(OUT, 'world.json'), JSON.stringify(world));
    console.log(`world.json ${(readFileSync(join(OUT, 'world.json')).length / 1e6).toFixed(2)} MB`);
}

await main();
