/**
 * Buildings for the San Francisco course (bakeWorld.ts → world.json `buildings`), from real data:
 *
 *   footprints  DataSF Building Footprints (PDDL), which merge whole row-house blocks into one
 *               polygon, split into one building per lot by the DataSF parcels (PDDL); OSM footprints
 *               only where DataSF has none (Marin, a few gaps). Lots reaching into the course (and its
 *               chase camera) are cut back behind it, not dropped.
 *   heights     the 2023 lidar (USGS 3DEP via NASA WERK, CC0, 1 m: DSM − DTM) over each lot: wall
 *               (eave) height, and a pitched roof where the ridge stands well above the eaves; else
 *               DataSF's 2010 lidar median, OSM tags or a guess.
 *   facades     per edge: 1 street front (a street or the course in front before another building),
 *               2 party wall (touching the neighbour), 0 side / back; the lot's zoning (houses,
 *               apartments, shops on the ground floor) for src/app/sf/buildings.ts's facade shader.
 *   roofs       median colour of the aerial photo inside the footprint.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCALE, toMeters } from './geo';
import { simplify, type OsmElement, type P2 } from './osm';
import type { Corridor } from './corridor';
import { loadBuildingHeights } from './buildingData';
import { loadCanopy, loadNdvi } from './treesBake';
import { TERRAIN_BOX } from './terrainBake';

type Ring = P2[]; // meters, east / north

export interface BuildingsJson {
    /** Vertex count per building; `pts` world (x, z) pairs, counterclockwise seen from above. */
    n: number[];
    pts: number[];
    /** World y of the lowest ground under the footprint. */
    base: number[];
    /** Wall (eave) height above `base` (units), incl. the ground's fall across the footprint. */
    h: number[];
    /** Pitched roof rise (units; 0 = flat roof). */
    roof: number[];
    /** 0 Presidio, 1 Marina / city, 2 big (area > 2500 m²). */
    kind: number[];
    /** 0xRRGGBB from the aerial photo, -1 unknown. */
    roofColor: number[];
    /** Per building, one digit per edge (edge k: vertex k → k + 1): 0 side, 1 street front, 2 party wall. */
    edges: string[];
    /** Lot zoning: 0 houses, 1 apartments, 2 shops on the ground floor, 3 other / unknown. */
    zone: number[];
}

export interface BuildingsInputs {
    ctx: string;
    els: OsmElement[];
    corridor: Corridor;
    groundAt(x: number, z: number): number;
    roofColor(ring: Ring): number;
    /** True for a footprint (meters) where a landmark draws itself. */
    hole(ring: Ring): boolean;
    /**
     * True for footprints to list after all the others (buildings.ts picks each building's look by
     * its index: newly baked ones go last, so the others keep theirs).
     */
    late?(ring: Ring): boolean;
    seaY: number;
}

const ringArea = (r: Ring) => r.reduce((a, p, k) => a + p[0] * r[(k + 1) % r.length]![1] - r[(k + 1) % r.length]![0] * p[1], 0) / 2;
const centroid = (r: Ring): P2 => r.reduce<P2>((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);

function pointInRing(r: Ring, e: number, n: number): boolean {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i]!;
        const b = r[j]!;
        if (a[1] > n !== b[1] > n && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
}

/** Calls fn(x, y) for every 1 m cell (centre) inside the ring, on a raster with its north-west corner at (e0, n1). */
function fillRing(r: Ring, e0: number, n1: number, w: number, h: number, fn: (x: number, y: number) => void): void {
    let nMin = Infinity;
    let nMax = -Infinity;
    for (const p of r) {
        nMin = Math.min(nMin, p[1]);
        nMax = Math.max(nMax, p[1]);
    }
    const y0 = Math.max(0, Math.floor(n1 - nMax));
    const y1 = Math.min(h - 1, Math.ceil(n1 - nMin));
    for (let y = y0; y <= y1; ++y) {
        const n = n1 - (y + 0.5);
        const xs: number[] = [];
        for (let k = 0; k < r.length; ++k) {
            const a = r[k]!;
            const b = r[(k + 1) % r.length]!;
            if (a[1] > n !== b[1] > n) xs.push(a[0] + ((n - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const x0 = Math.max(0, Math.ceil(xs[k]! - e0 - 0.5));
            const x1 = Math.min(w - 1, Math.floor(xs[k + 1]! - e0 - 0.5));
            for (let x = x0; x <= x1; ++x) fn(x, y);
        }
    }
}

/** Calls fn(x, y) for 1 m cells within hw of the polyline. */
function strokeLine(pts: P2[], hw: number, e0: number, n1: number, w: number, h: number, fn: (x: number, y: number) => void): void {
    for (let k = 0; k + 1 < pts.length; ++k) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - hw - e0));
        const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + hw - e0));
        const y0 = Math.max(0, Math.floor(n1 - Math.max(a[1], b[1]) - hw));
        const y1 = Math.min(h - 1, Math.ceil(n1 - Math.min(a[1], b[1]) + hw));
        const dx = b[0] - a[0];
        const dn = b[1] - a[1];
        const L2 = dx * dx + dn * dn || 1;
        for (let y = y0; y <= y1; ++y)
            for (let x = x0; x <= x1; ++x) {
                const e = e0 + x + 0.5;
                const n = n1 - y - 0.5;
                const t = Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dn) / L2));
                if (Math.hypot(a[0] + dx * t - e, a[1] + dn * t - n) <= hw) fn(x, y);
            }
    }
}

/** Sutherland–Hodgman: the part of `r` where side(p) >= 0 (side linear along edges). */
function clipHalf(r: Ring, side: (p: P2) => number): Ring {
    const out: Ring = [];
    for (let k = 0; k < r.length; ++k) {
        const a = r[k]!;
        const b = r[(k + 1) % r.length]!;
        const sa = side(a);
        const sb = side(b);
        if (sa >= 0) out.push(a);
        if (sa >= 0 !== sb >= 0) {
            const t = sa / (sa - sb);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    return out;
}

/** The part of ring `r` inside the convex counterclockwise polygon `c`. */
function clipConvex(r: Ring, c: Ring): Ring {
    let out = r;
    for (let k = 0; k < c.length && out.length >= 3; ++k) {
        const a = c[k]!;
        const b = c[(k + 1) % c.length]!;
        out = clipHalf(out, (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    }
    return out;
}

function isConvex(r: Ring): boolean {
    let sign = 0;
    for (let k = 0; k < r.length; ++k) {
        const a = r[k]!;
        const b = r[(k + 1) % r.length]!;
        const c = r[(k + 2) % r.length]!;
        const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(z) < 1e-6) continue;
        if (sign === 0) sign = Math.sign(z);
        else if (Math.sign(z) !== sign) return false;
    }
    return true;
}

/** Drops repeated and (nearly) collinear vertices. */
function cleanRing(r: Ring): Ring {
    const out: Ring = [];
    for (const p of r) {
        const q = out[out.length - 1];
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
    }
    while (out.length > 2 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) <= 0.05) out.pop();
    for (let k = 0; k < out.length && out.length > 3; ) {
        const a = out[(k + out.length - 1) % out.length]!;
        const b = out[k]!;
        const c = out[(k + 1) % out.length]!;
        const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(z) < 0.02 * Math.hypot(c[0] - a[0], c[1] - a[1])) out.splice(k, 1);
        else ++k;
    }
    return out;
}

/** Douglas-Peucker for a closed ring (split at the vertex farthest from the first). */
function simplifyRing(ring: Ring, eps: number): Ring {
    const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
    if (open.length < 4) return open;
    let far = 0;
    let fd = -1;
    open.forEach((p, i) => {
        const d = Math.hypot(p[0] - open[0]![0], p[1] - open[0]![1]);
        if (d > fd) {
            fd = d;
            far = i;
        }
    });
    const a = simplify(open.slice(0, far + 1), eps);
    const b = simplify([...open.slice(far), open[0]!], eps);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Counterclockwise (east / north), cleaned. */
function ccw(r: Ring): Ring {
    const c = cleanRing(r);
    return ringArea(c) < 0 ? c.reverse() : c;
}

type GeoFeature = { geometry: { type: string; coordinates: number[][][][] | number[][][] } | null; properties: Record<string, string> };

function outerRings(f: GeoFeature): Ring[] {
    if (!f.geometry) return [];
    const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as number[][][][];
    return polys.map((poly) => poly[0]!.map(([lon, lat]) => toMeters(lat!, lon!)));
}

/** Spatial hash of items with a bounding box (meters). */
class BoxGrid<T> {
    private cells = new Map<string, T[]>();
    constructor(private readonly cell: number) {}
    add(item: T, e0: number, n0: number, e1: number, n1: number): void {
        for (let gx = Math.floor(e0 / this.cell); gx <= Math.floor(e1 / this.cell); ++gx)
            for (let gy = Math.floor(n0 / this.cell); gy <= Math.floor(n1 / this.cell); ++gy) {
                const k = `${gx},${gy}`;
                let l = this.cells.get(k);
                if (!l) this.cells.set(k, (l = []));
                l.push(item);
            }
    }
    query(e0: number, n0: number, e1: number, n1: number): Set<T> {
        const out = new Set<T>();
        for (let gx = Math.floor(e0 / this.cell); gx <= Math.floor(e1 / this.cell); ++gx)
            for (let gy = Math.floor(n0 / this.cell); gy <= Math.floor(n1 / this.cell); ++gy) for (const t of this.cells.get(`${gx},${gy}`) ?? []) out.add(t);
        return out;
    }
}

const bbox = (r: Ring): [number, number, number, number] => {
    let e0 = Infinity;
    let n0 = Infinity;
    let e1 = -Infinity;
    let n1 = -Infinity;
    for (const p of r) {
        e0 = Math.min(e0, p[0]);
        e1 = Math.max(e1, p[0]);
        n0 = Math.min(n0, p[1]);
        n1 = Math.max(n1, p[1]);
    }
    return [e0, n0, e1, n1];
};

/** OSM highways drawn as streets (m), for the street fronts. */
const ROAD_W: Record<string, number> = {
    motorway: 14, trunk: 13, primary: 12, secondary: 11, tertiary: 10, unclassified: 8, residential: 9, living_street: 6,
    motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6, service: 5, pedestrian: 5,
};

/** Keep this far (m) past the course's road edge: the walls and the chase camera. */
const MARGIN = 500 / SCALE;

export async function bakeBuildings(inp: BuildingsInputs): Promise<{ json: BuildingsJson; rings: Ring[]; log: string }> {
    const B = TERRAIN_BOX;
    const inBox = (r: Ring) => r.every((p) => p[0] > B.e0 && p[0] < B.e1 && p[1] > B.n0 && p[1] < B.n1);
    const clearance = (p: P2) => inp.corridor.clearance(p[0] * SCALE, -p[1] * SCALE) / SCALE;

    // ---- the course's road segments (m) near a point, for cutting lots back ----
    const segs = inp.corridor.segs.map((g) => ({ a: [g.ax / SCALE, -g.az / SCALE] as P2, b: [g.bx / SCALE, -g.bz / SCALE] as P2, hw: g.hw / SCALE }));
    const segGrid = new BoxGrid<number>(60);
    segs.forEach((g, k) => segGrid.add(k, Math.min(g.a[0], g.b[0]) - g.hw - 30, Math.min(g.a[1], g.b[1]) - g.hw - 30, Math.max(g.a[0], g.b[0]) + g.hw + 30, Math.max(g.a[1], g.b[1]) + g.hw + 30));
    /** Cuts the ring back to MARGIN behind the road edge (null: nothing left). */
    const cutForCourse = (ring: Ring): Ring | null => {
        let r = ring;
        for (let it = 0; it < 8 && r.length >= 3; ++it) {
            let worst = Infinity;
            let wp: P2 | null = null;
            for (let k = 0; k < r.length; ++k) {
                const a = r[k]!;
                const b = r[(k + 1) % r.length]!;
                for (const t of [0, 0.25, 0.5, 0.75]) {
                    const q: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                    const c = clearance(q);
                    if (c < worst) {
                        worst = c;
                        wp = q;
                    }
                }
            }
            if (worst >= MARGIN - 0.05 || !wp) return r;
            // The nearest segment's line; keep the side the ring's centroid is on.
            let best = -1;
            let bd = Infinity;
            for (const k of segGrid.query(wp[0], wp[1], wp[0], wp[1])) {
                const g = segs[k]!;
                const dx = g.b[0] - g.a[0];
                const dn = g.b[1] - g.a[1];
                const t = Math.max(0, Math.min(1, ((wp[0] - g.a[0]) * dx + (wp[1] - g.a[1]) * dn) / (dx * dx + dn * dn || 1)));
                const d = Math.hypot(g.a[0] + dx * t - wp[0], g.a[1] + dn * t - wp[1]) - g.hw;
                if (d < bd) {
                    bd = d;
                    best = k;
                }
            }
            if (best < 0) return null;
            const g = segs[best]!;
            const dx = g.b[0] - g.a[0];
            const dn = g.b[1] - g.a[1];
            const L = Math.hypot(dx, dn) || 1;
            const c = centroid(r);
            const side = Math.sign(dx * (c[1] - g.a[1]) - dn * (c[0] - g.a[0])) || 1;
            const off = g.hw + MARGIN;
            r = cleanRing(clipHalf(r, (p) => (side * (dx * (p[1] - g.a[1]) - dn * (p[0] - g.a[0]))) / L - off));
        }
        return r.length >= 3 && clearance(centroid(r)) >= MARGIN - 0.05 ? r : null;
    };

    // ---- parcels (convex lots) with their zoning ----
    type Parcel = { ring: Ring; zone: number; box: [number, number, number, number] };
    const parcels: Parcel[] = [];
    const pGrid = new BoxGrid<number>(40);
    const pFile = join(inp.ctx, 'datasf/parcels.geojson');
    if (existsSync(pFile)) {
        for (const f of (JSON.parse(readFileSync(pFile, 'utf8')) as { features: GeoFeature[] }).features) {
            const z = f.properties.zoning_code ?? '';
            const zone = /^NC|^C-|^NCT/.test(z) ? 2 : /^RM|^RTO|^RC/.test(z) ? 1 : /^RH/.test(z) ? 0 : 3;
            for (const r0 of outerRings(f)) {
                const ring = ccw(r0);
                if (ring.length < 3 || !isConvex(ring)) continue;
                const box = bbox(ring);
                pGrid.add(parcels.push({ ring, zone, box }) - 1, ...box);
            }
        }
    }
    /** The footprint split into its lots (whole where the parcels don't cover it: the Presidio, odd lots). */
    const splitByLots = (ring: Ring): { ring: Ring; zone: number }[] => {
        const [e0, n0, e1, n1] = bbox(ring);
        const out: { ring: Ring; zone: number }[] = [];
        let covered = 0;
        for (const k of pGrid.query(e0, n0, e1, n1)) {
            const pc = parcels[k]!;
            if (pc.box[2] < e0 || pc.box[0] > e1 || pc.box[3] < n0 || pc.box[1] > n1) continue;
            const part = cleanRing(clipConvex(ring, pc.ring));
            if (part.length < 3) continue;
            const a = Math.abs(ringArea(part));
            if (a < 4) continue;
            covered += a;
            out.push({ ring: part, zone: pc.zone });
        }
        if (covered < Math.abs(ringArea(ring)) * 0.8) return [{ ring, zone: out.length ? out[0]!.zone : 3 }];
        return out;
    };

    // ---- footprints: DataSF (split into lots), then OSM where DataSF has none ----
    type Lot = { ring: Ring; zone: number; props: Record<string, string> | null; tags: Record<string, string> | null };
    const lots: Lot[] = [];
    const sfGrid = new BoxGrid<Ring>(50);
    const sfFile = join(inp.ctx, 'datasf/buildings.geojson');
    let nSf = 0;
    if (existsSync(sfFile)) {
        for (const f of (JSON.parse(readFileSync(sfFile, 'utf8')) as { features: GeoFeature[] }).features) {
            for (const r0 of outerRings(f)) {
                const whole = ccw(simplifyRing(r0, 0.35));
                if (whole.length < 3 || !inBox(whole) || Math.abs(ringArea(whole)) < 12) continue;
                sfGrid.add(whole, ...bbox(whole));
                if (inp.hole(whole)) continue;
                ++nSf;
                for (const lot of splitByLots(whole)) lots.push({ ring: lot.ring, zone: lot.zone, props: f.properties, tags: null });
            }
        }
    }
    let nOsm = 0;
    for (const el of inp.els) {
        if (el.type !== 'way' || !el.tags || !(el.tags.building || el.tags['building:part'])) continue;
        if (el.tags.building === 'roof' || el.tags.building === 'construction') continue;
        if (el.nodes[0] !== el.nodes[el.nodes.length - 1]) continue;
        const ring = ccw(simplifyRing(el.geometry.map((g) => toMeters(g.lat, g.lon)), 0.4));
        if (ring.length < 3 || !inBox(ring) || Math.abs(ringArea(ring)) < 8) continue;
        if (inp.hole(ring)) continue;
        const c = centroid(ring);
        // Covered by DataSF: its centroid inside a DataSF footprint or the other way round.
        let dup = false;
        for (const r of sfGrid.query(...bbox(ring))) {
            if (pointInRing(r, c[0], c[1]) || pointInRing(ring, ...centroid(r))) {
                dup = true;
                break;
            }
        }
        if (dup) continue;
        ++nOsm;
        lots.push({ ring, zone: 3, props: null, tags: el.tags });
    }

    if (inp.late) lots.sort((a, b) => Number(inp.late!(a.ring)) - Number(inp.late!(b.ring)));

    // ---- heights, roofs, the course ----
    const canopy = await loadCanopy(join(inp.ctx, 'chm'));
    const ndvi = loadNdvi(inp.ctx);
    const dataSf = loadBuildingHeights(sfFile);
    const out: BuildingsJson = { n: [], pts: [], base: [], h: [], roof: [], kind: [], roofColor: [], edges: [], zone: [] };
    const rings: Ring[] = [];
    let cut = 0;
    let dropped = 0;
    let fromLidar = 0;
    let pitchedN = 0;
    for (const lot of lots) {
        let ring: Ring | null = lot.ring;
        if (Math.min(...ring.map(clearance)) < MARGIN + 30) {
            const area0 = Math.abs(ringArea(ring));
            ring = cutForCourse(ring);
            if (ring) ring = ccw(ring);
            if (!ring || ring.length < 3 || Math.abs(ringArea(ring)) < 15) {
                ++dropped;
                continue;
            }
            if (Math.abs(ringArea(ring)) < area0 - 0.5) ++cut;
            const [e0, n0, e1, n1] = bbox(ring);
            if (Math.min(e1 - e0, n1 - n0) < 3) {
                ++dropped;
                continue;
            }
        }
        const rg = ring;
        const area = Math.abs(ringArea(rg));
        const c = centroid(rg);
        // Lidar heights over the lot (DSM − DTM, 1 m cells), leaving out trees over the roof (NDVI):
        // a house under a cypress would otherwise be as tall as the cypress.
        const [be0, , , bn1] = bbox(rg);
        const hs: number[] = [];
        fillRing(rg, Math.floor(be0), Math.ceil(bn1), 2000, 2000, (x, y) => {
            const e = Math.floor(be0) + x + 0.5;
            const n = Math.ceil(bn1) - y - 0.5;
            const v = canopy.at(e, n);
            if (Number.isFinite(v) && !(ndvi(e, n) > 0.2)) hs.push(v);
        });
        hs.sort((a, b) => a - b);
        const q = (t: number) => hs[Math.min(hs.length - 1, Math.floor(t * hs.length))]!;
        let h: number;
        let ridge: number;
        let low: number;
        let lidarRoof = false;
        if (hs.length >= Math.max(4, area * 0.3)) {
            h = q(0.55);
            ridge = q(0.93);
            low = q(0.2);
            lidarRoof = true;
            ++fromLidar;
        } else {
            // DataSF 2010 lidar median, OSM's tags, the levels, a guess.
            const t = lot.tags ?? {};
            h = Number.parseFloat(lot.props?.hgt_median_m ?? t.height ?? '');
            if (!(h >= 2)) h = dataSf.lookup(rg)?.median ?? NaN;
            if (!(h >= 2)) {
                const lv = Number.parseFloat(t['building:levels'] ?? '');
                if (Number.isFinite(lv)) h = lv * 3.2 + 1.5;
                else if (t.building === 'garage' || t.building === 'shed' || t.building === 'garages') h = 3.5;
                else if (t.building === 'house' || t.building === 'detached') h = 8;
                else h = c[0] < 2400 ? 8 : 11;
            }
            const shape = t['roof:shape'];
            const tagged = shape === 'gabled' || shape === 'hipped' || shape === 'pyramidal';
            ridge = tagged || (c[0] < 2400 && h < 14 && area < 900) ? h + Math.min(5, Math.sqrt(area) * 0.3) : h;
            low = tagged || ridge > h ? h - 0.5 : h;
        }
        h = Math.max(3, Math.min(120, h));
        // The Presidio is low-rise (houses, barracks, four storeys at most) but wooded: small lots
        // taller than that are trees the NDVI missed.
        if (c[0] < 2350 && area < 1500) {
            h = Math.min(h, 14);
            low = Math.min(low, 14);
            ridge = Math.min(ridge, 18);
        }
        ridge = Math.max(h, Math.min(h + 9, ridge));
        // Pitched when the ridge stands well above the eaves on a house-sized footprint.
        const pitched = ridge - low > 1.8 && area < 1200 && ridge - low < 0.7 * ridge && (lidarRoof || ridge > h);
        const eave = pitched ? Math.max(3, Math.min(h, low + 0.6)) : h;
        const rise = pitched ? Math.min(7, ridge - eave, Math.sqrt(area) * 0.45) : 0;
        if (pitched) ++pitchedN;
        const ys = rg.map((p) => inp.groundAt(p[0] * SCALE, -p[1] * SCALE));
        const base = Math.min(...ys);
        if (base < inp.seaY - 0.5 * SCALE) continue; // piers over water
        out.n.push(rg.length);
        for (const p of rg) out.pts.push(Math.round(p[0] * SCALE), Math.round(-p[1] * SCALE));
        out.base.push(Math.round(base));
        out.h.push(Math.round(eave * SCALE + (Math.max(...ys) - base)));
        out.roof.push(Math.round(rise * SCALE));
        out.kind.push(area > 2500 ? 2 : c[0] < 2350 ? 0 : 1);
        out.roofColor.push(inp.roofColor(rg));
        out.zone.push(lot.zone);
        rings.push(rg);
    }

    // ---- facade kinds per edge, from 1 m occupancy rasters: buildings (index + 1) and streets ----
    const W = Math.ceil(B.e1 - B.e0);
    const H = Math.ceil(B.n1 - B.n0);
    const occ = new Int32Array(W * H);
    rings.forEach((r, k) => fillRing(r, B.e0, B.n1, W, H, (x, y) => (occ[y * W + x] = k + 1)));
    const street = new Uint8Array(W * H);
    for (const el of inp.els) {
        if (el.type !== 'way' || !el.tags?.highway || el.tags.tunnel === 'yes') continue;
        const w = ROAD_W[el.tags.highway];
        if (w) strokeLine(el.geometry.map((g) => toMeters(g.lat, g.lon)), w / 2, B.e0, B.n1, W, H, (x, y) => (street[y * W + x] = 1));
    }
    const at = (a: Int32Array | Uint8Array, e: number, n: number) => {
        const x = Math.floor(e - B.e0);
        const y = Math.floor(B.n1 - n);
        return x < 0 || y < 0 || x >= W || y >= H ? 0 : a[y * W + x]!;
    };
    let fronts = 0;
    let parties = 0;
    rings.forEach((r, k) => {
        let s = '';
        for (let i = 0; i < r.length; ++i) {
            const a = r[i]!;
            const b = r[(i + 1) % r.length]!;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            // Outward normal of a counterclockwise ring (east / north): (dn, −de).
            const nx = (b[1] - a[1]) / len;
            const ny = -(b[0] - a[0]) / len;
            let touching = 0;
            for (const t of [0.2, 0.5, 0.8]) {
                const o = at(occ, a[0] + (b[0] - a[0]) * t + nx * 0.9, a[1] + (b[1] - a[1]) * t + ny * 0.9);
                if (o && o !== k + 1) ++touching;
            }
            let kind = 0;
            if (touching >= 2) kind = 2;
            else if (len > 2.5) {
                const e0 = (a[0] + b[0]) / 2;
                const n0 = (a[1] + b[1]) / 2;
                for (let d = 1; d < 22; d += 0.7) {
                    const e = e0 + nx * d;
                    const n = n0 + ny * d;
                    const o = at(occ, e, n);
                    if (o && o !== k + 1) break;
                    if (at(street, e, n) || clearance([e, n]) < 0) {
                        kind = 1;
                        break;
                    }
                }
            }
            if (kind === 1) ++fronts;
            if (kind === 2) ++parties;
            s += kind;
        }
        out.edges.push(s);
    });

    const log =
        `buildings: ${out.n.length} (DataSF ${nSf} footprints → lots, OSM ${nOsm}; ${cut} cut back for the course, ${dropped} dropped; ` +
        `${fromLidar} lidar heights, ${pitchedN} pitched; ${fronts} street fronts, ${parties} party walls)`;
    return { json: out, rings, log };
}
