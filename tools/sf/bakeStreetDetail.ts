/**
 * Bakes optional street detail from DataSF (City and County of San Francisco open data, PDDL) into
 * public/data/sf/detail.json, drawn by src/app/sf/streetDetail.ts:
 *
 *   crosswalks  one per leg of every DataSF crosswalk intersection (the data are points at the
 *               intersection node): center, heading of the street, half length, continental or not
 *   sidewalks   curb lines of the city blocks (DataSF curb rings) with the sidewalk width per vertex
 *               (DataSF sidewalk widths, nearest street); the sidewalk lies on
 *               the (-dz, dx) side in world x/z. Plus bands along streets that have a width but no
 *               curb data (offset from the street centerline).
 *   curbs       open curb lines (raised strips)
 *   islands     traffic islands / medians (closed rings, raised + filled)
 *   bike        CLASS II bike lanes: lane center lines (offset from the street centerline)
 *   center      double yellow center lines of collectors / arterials (DataSF street centerlines)
 *   ramps       curb ramps: x, z, heading (the direction the ramp runs down into the street), raised
 *   meters      parking meters: x, z, heading (towards the street), kind (0 post, 1 pay station), cap color, raised
 *
 * Heights are not baked: the app samples the terrain at run time. Everything is kept clear of the
 * course corridor (road ribbon + a margin, corridor.ts) and inside geo.CORE. Coordinates are
 * world units (60 per meter; x = east, z = -north), rounded to integers.
 *
 * Usage: npx tsx tools/sf/datasf.ts && npx tsx tools/sf/bakeStreetDetail.ts   (after bakeWorld.ts: its streets)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Corridor, type Meta } from './corridor';
import { CORE, SCALE, toMeters } from './geo';
import { polyLength, simplify, type P2 } from './osm';
import { offsetLine } from './route';
import { DATASF_DIR, type DatasetName } from './datasf';
import { inLandmark } from './landmarkHoles';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/data/sf/detail.json');

/** Clearance (world units past the course road edge) for flat decals and for upright things. */
const MARGIN_FLAT = 250;
const MARGIN_TALL = 450;
const FT = 0.3048;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------
type Geom = { type: 'Point'; coordinates: number[] } | { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] };
type Feature = { geometry: Geom | null; properties: Record<string, string | boolean | null | undefined> };

function load(name: DatasetName): Feature[] {
    const fc = JSON.parse(readFileSync(join(DATASF_DIR, `${name}.geojson`), 'utf8')) as { features: Feature[] };
    return fc.features.filter((f) => f.geometry);
}
const m = (c: number[]): P2 => toMeters(c[1]!, c[0]!);
function lines(g: Geom): P2[][] {
    if (g.type === 'LineString') return [g.coordinates.map(m)];
    if (g.type === 'MultiLineString') return g.coordinates.map((l) => l.map(m));
    return [];
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
    const x = Number.parseFloat(str(v));
    return Number.isFinite(x) ? x : 0;
};
const normName = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// ---------------------------------------------------------------------------------------------
// Segment hash (meters) for nearest-line queries.
// ---------------------------------------------------------------------------------------------
type Seg<T> = { a: P2; b: P2; data: T };
class SegHash<T> {
    private grid = new Map<string, Seg<T>[]>();
    constructor(private readonly cell = 25) {}
    add(a: P2, b: P2, data: T): void {
        const s: Seg<T> = { a, b, data };
        const c = this.cell;
        for (let gx = Math.floor(Math.min(a[0], b[0]) / c); gx <= Math.floor(Math.max(a[0], b[0]) / c); ++gx)
            for (let gy = Math.floor(Math.min(a[1], b[1]) / c); gy <= Math.floor(Math.max(a[1], b[1]) / c); ++gy) {
                const key = `${gx},${gy}`;
                let l = this.grid.get(key);
                if (!l) this.grid.set(key, (l = []));
                l.push(s);
            }
    }
    addLine(pts: P2[], data: T): void {
        for (let i = 0; i + 1 < pts.length; ++i) this.add(pts[i]!, pts[i + 1]!, data);
    }
    /** Segments within r of p, with the closest point and distance. */
    query(p: P2, r: number): { seg: Seg<T>; d: number; q: P2; t: number }[] {
        const c = this.cell;
        const out: { seg: Seg<T>; d: number; q: P2; t: number }[] = [];
        const seen = new Set<Seg<T>>();
        for (let gx = Math.floor((p[0] - r) / c); gx <= Math.floor((p[0] + r) / c); ++gx)
            for (let gy = Math.floor((p[1] - r) / c); gy <= Math.floor((p[1] + r) / c); ++gy)
                for (const s of this.grid.get(`${gx},${gy}`) ?? []) {
                    if (seen.has(s)) continue;
                    seen.add(s);
                    const dx = s.b[0] - s.a[0];
                    const dy = s.b[1] - s.a[1];
                    const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (dx * dx + dy * dy || 1)));
                    const q: P2 = [s.a[0] + dx * t, s.a[1] + dy * t];
                    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                    if (d <= r) out.push({ seg: s, d, q, t });
                }
        return out;
    }
    nearest(p: P2, r: number): { seg: Seg<T>; d: number; q: P2; t: number } | null {
        let best: { seg: Seg<T>; d: number; q: P2; t: number } | null = null;
        for (const h of this.query(p, r)) if (!best || h.d < best.d) best = h;
        return best;
    }
}

// ---------------------------------------------------------------------------------------------
// Polyline helpers (meters)
// ---------------------------------------------------------------------------------------------
function densify(pts: P2[], step: number): P2[] {
    const out: P2[] = [];
    for (let i = 0; i + 1 < pts.length; ++i) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let k = 0; k < n; ++k) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (pts.length) out.push(pts[pts.length - 1]!);
    return out;
}
/** Point and unit direction at distance s along a polyline. */
function along(pts: P2[], s: number): { p: P2; d: P2 } {
    for (let i = 0; i + 1 < pts.length; ++i) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (s <= L || i + 2 === pts.length) {
            const t = L > 0 ? Math.min(1, s / L) : 0;
            return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0] };
        }
        s -= L;
    }
    return { p: pts[0]!, d: [1, 0] };
}
/** Douglas-Peucker that also works for closed polylines (first == last point). */
function simp(pts: P2[], eps: number): P2[] {
    const n = pts.length;
    if (n < 4 || Math.hypot(pts[0]![0] - pts[n - 1]![0], pts[0]![1] - pts[n - 1]![1]) > 1e-6) return simplify(pts, eps);
    let far = 0;
    let fd = -1;
    pts.forEach((p, i) => {
        const d = Math.hypot(p[0] - pts[0]![0], p[1] - pts[0]![1]);
        if (d > fd) {
            fd = d;
            far = i;
        }
    });
    return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
}

/**
 * Inverse Lambert conformal conic for EPSG:2227 (NAD83 / California zone III, US survey feet) →
 * meters east/north of the origin (NAD83 taken as WGS84; they differ by ~1 m here).
 */
function stateplane(xFt: number, yFt: number): P2 {
    const ft = 1200 / 3937;
    const a = 6378137;
    const f = 1 / 298.257222101;
    const e = Math.sqrt(2 * f - f * f);
    const r = Math.PI / 180;
    const [phi1, phi2, phi0, lam0] = [(38 + 26 / 60) * r, (37 + 4 / 60) * r, 36.5 * r, -120.5 * r];
    const mf = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
    const tf = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
    const n = (Math.log(mf(phi1)) - Math.log(mf(phi2))) / (Math.log(tf(phi1)) - Math.log(tf(phi2)));
    const F = mf(phi1) / (n * tf(phi1) ** n);
    const rho0 = a * F * tf(phi0) ** n;
    const x = xFt * ft - 2000000;
    const y = rho0 - (yFt * ft - 500000);
    const rho = Math.hypot(x, y);
    const t = (rho / (a * F)) ** (1 / n);
    const lam = Math.atan2(x, y) / n + lam0;
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let k = 0; k < 8; ++k) phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
    return toMeters(phi / r, lam / r);
}

const signedArea = (r: P2[]) => r.reduce((s, p, k) => s + p[0] * r[(k + 1) % r.length]![1] - r[(k + 1) % r.length]![0] * p[1], 0) / 2;

// ---------------------------------------------------------------------------------------------

function main(): void {
    const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/courses/golden_gate/course_meta.json'), 'utf8')) as Meta;
    const corridor = new Corridor(meta, []);
    const inCore = (p: P2) => p[0] > CORE.e0 && p[0] < CORE.e1 && p[1] > CORE.n0 && p[1] < CORE.n1;
    /** A spot (meters) that detail may cover: in the core, off the course (+ margin), not in a landmark (landmarkHoles.ts). */
    const ok = (p: P2, margin = MARGIN_FLAT) => inCore(p) && corridor.clearance(p[0] * SCALE, -p[1] * SCALE) > margin && !inLandmark(p[0], p[1], 8);
    /** Splits a polyline into the runs that are ok (densified so the corridor can't slip between vertices). */
    const clip = (pts: P2[], margin = MARGIN_FLAT, step = 3): P2[][] => {
        const runs: P2[][] = [];
        let run: P2[] = [];
        for (const p of densify(pts, step)) {
            if (ok(p, margin)) run.push(p);
            else {
                if (run.length > 1) runs.push(run);
                run = [];
            }
        }
        if (run.length > 1) runs.push(run);
        return runs;
    };
    const W = (v: number) => Math.round(v * SCALE);
    const wx = (p: P2) => W(p[0]);
    const wz = (p: P2) => -W(p[1]);
    /** World heading (radians) of a direction given in meters east/north: atan2(dx, dz) in world x/z. */
    const heading = (d: P2) => Math.atan2(d[0], -d[1]);
    const deg = (a: number) => ((Math.round((a * 180) / Math.PI) % 360) + 360) % 360;

    // ---- street centerlines + half widths ----
    const worldJson = JSON.parse(readFileSync(join(ROOT, 'public/data/sf/world.json'), 'utf8')) as { streets: { w: number; kind: number; pts: number[] }[] };
    const osmHash = new SegHash<number>(30);
    for (const s of worldJson.streets) {
        if (s.kind !== 0) continue;
        const pts: P2[] = [];
        for (let k = 0; k + 1 < s.pts.length; k += 2) pts.push([s.pts[k]! / SCALE, -s.pts[k + 1]! / SCALE]);
        osmHash.addLine(pts, s.w);
    }
    const curbHash = new SegHash<number>(25);
    const curbFeats = load('curbs');
    curbFeats.forEach((f, i) => {
        for (const l of lines(f.geometry!)) curbHash.addLine(simp(l, 0.05), i);
    });

    type Street = { pts: P2[]; name: string; cnn: string; layer: string; cls: number; hw: number; fromNode: string; toNode: string; curbed: boolean };
    const streets: Street[] = [];
    for (const f of load('streets')) {
        const p = f.properties;
        if (p.active === false) continue;
        const layer = str(p.layer);
        if (layer === 'PAPER' || layer === 'PRIVATE') continue;
        for (const l of lines(f.geometry!)) {
            if (!l.some(inCore)) continue;
            const node = (v: unknown) => (str(v) ? String(Math.round(num(v))) : '');
            streets.push({ pts: l, name: normName(str(p.streetname)), cnn: str(p.cnn), layer, cls: num(p.classcode), hw: 0, fromNode: node(p.f_node_cnn), toNode: node(p.t_node_cnn), curbed: false });
        }
    }
    /** Half width of the roadway (meters): curb to curb where DataSF has curbs, else the OSM ribbon, else by class. */
    for (const st of streets) {
        const L = polyLength(st.pts);
        const ws: number[] = [];
        let curbed = 0;
        for (const f of [0.25, 0.5, 0.75]) {
            const { p, d } = along(st.pts, L * f);
            let left = Infinity;
            let right = Infinity;
            for (const h of curbHash.query(p, 16)) {
                const cx = h.q[0] - p[0];
                const cy = h.q[1] - p[1];
                // Only curbs roughly across the street (not the curb return of a side street).
                const sd = Math.hypot(cx, cy) || 1;
                if (Math.abs(cx * d[0] + cy * d[1]) / sd > 0.5) continue;
                if (d[0] * cy - d[1] * cx > 0) left = Math.min(left, h.d);
                else right = Math.min(right, h.d);
            }
            if (left < 16 && right < 16) {
                ws.push((left + right) / 2);
                ++curbed;
            } else {
                const o = osmHash.nearest(p, 8);
                if (o) ws.push(o.seg.data / 2);
            }
        }
        ws.sort((a, b) => a - b);
        const def = st.layer === 'FREEWAYS' ? 7 : st.cls >= 5 ? 4 : st.cls >= 4 ? 4.5 : 6;
        st.hw = Math.max(2.5, Math.min(14, ws.length ? ws[ws.length >> 1]! : def));
        st.curbed = curbed >= 2;
    }
    const streetHash = new SegHash<number>(30);
    streets.forEach((st, i) => streetHash.addLine(st.pts, i));
    /** Inside the roadway of another street (not `name`)? */
    const inOtherRoad = (p: P2, name: string, pad = 0.3) =>
        streetHash.query(p, 16).some((h) => {
            const st = streets[h.seg.data]!;
            return st.name !== name && st.layer !== 'FREEWAYS' && h.d < st.hw + pad;
        });
    /** Offset runs of a street, trimmed where they cross other roadways and at the course. */
    const offsetRuns = (pts: P2[], off: number, name: string): P2[][] => {
        const out: P2[][] = [];
        for (const run of clip(offsetLine(densify(pts, 2), off), MARGIN_FLAT, 2)) {
            let cur: P2[] = [];
            for (const p of run) {
                if (!inOtherRoad(p, name)) cur.push(p);
                else {
                    if (cur.length > 1) out.push(cur);
                    cur = [];
                }
            }
            if (cur.length > 1) out.push(cur);
        }
        return out.filter((r) => polyLength(r) > 4);
    };
    const emit = (runs: P2[][], eps: number, dst: { n: number[]; pts: number[] }) => {
        for (const r of runs) {
            const s = simp(r, eps);
            dst.n.push(s.length);
            for (const p of s) dst.pts.push(wx(p), wz(p));
        }
    };

    // ---- sidewalk widths (nearest street record) ----
    const walkHash = new SegHash<number>(30);
    const walkFeats = load('sidewalks');
    const walkWidth: number[] = walkFeats.map((f) => {
        const a = num(f.properties.sidewalk_f);
        const b = num(f.properties.width_min);
        const ft = a > 0 ? a : b;
        return ft > 0 ? Math.max(1.2, Math.min(7, ft * FT)) : 0;
    });
    walkFeats.forEach((f, i) => {
        for (const l of lines(f.geometry!)) walkHash.addLine(l, i);
    });

    // ---- curbs: block rings → sidewalks; small rings + ISLANDS → islands; the rest → curb strips ----
    const sidewalks = { n: [] as number[], pts: [] as number[], w: [] as number[] };
    const curbs = { n: [] as number[], pts: [] as number[] };
    const islands = { n: [] as number[], pts: [] as number[] };
    let nBlocks = 0;
    for (const f of curbFeats) {
        const layer = str(f.properties.layer);
        for (const l0 of lines(f.geometry!)) {
            const closed = l0.length > 3 && Math.hypot(l0[0]![0] - l0[l0.length - 1]![0], l0[0]![1] - l0[l0.length - 1]![1]) < 0.5;
            if (!closed) {
                emit(clip(l0), 0.1, curbs);
                continue;
            }
            let ring = simp(l0, 0.12);
            ring = ring.slice(0, -1);
            if (ring.length < 3) continue;
            // Clockwise in east/north = counter-clockwise in world x/z: the inside on the (-dz, dx) side.
            if (signedArea(ring) > 0) ring.reverse();
            const area = -signedArea(ring);
            if (layer === 'ISLANDS' || area < 900) {
                // Whole island or nothing.
                if (!densify([...ring, ring[0]!], 3).every((p) => ok(p))) continue;
                islands.n.push(ring.length);
                for (const p of ring) islands.pts.push(wx(p), wz(p));
                continue;
            }
            // Block curb ring: the block, and its sidewalk, on the (-dz, dx) side.
            ++nBlocks;
            const closedRing = [...ring, ring[0]!];
            let runs = clip(closedRing, MARGIN_FLAT + 300);
            // A ring that is entirely clear: rotate so the run is continuous around the start.
            if (runs.length === 1 && polyLength(runs[0]!) > polyLength(closedRing) - 1) runs = [closedRing];
            for (const run of runs) {
                const s = simp(run, 0.12);
                if (s.length < 2 || polyLength(s) < 3) continue;
                sidewalks.n.push(s.length);
                for (const p of s) {
                    const h = walkHash.nearest(p, 22);
                    const w = h && walkWidth[h.seg.data]! > 0 ? walkWidth[h.seg.data]! : 10 * FT;
                    sidewalks.pts.push(wx(p), wz(p));
                    sidewalks.w.push(W(w));
                }
            }
        }
    }
    // Streets with a sidewalk width but no curb data (the Presidio): bands off the centerline.
    let nFree = 0;
    walkFeats.forEach((f, i) => {
        const w = walkWidth[i]!;
        if (w <= 0) return;
        for (const l of lines(f.geometry!)) {
            const mid = along(l, polyLength(l) / 2).p;
            if (curbHash.nearest(mid, 18)) continue;
            const sn = streetHash.nearest(mid, 5);
            const st = sn ? streets[sn.seg.data]! : null;
            const hw = st?.hw ?? 4.5;
            const name = st?.name ?? '';
            const side = str(f.properties.side);
            // Sidewalk on the left of the run: left side as drawn, right side reversed.
            const both = side === 'Both' || side === '';
            for (const s of [1, -1]) {
                if (!both) {
                    // N/S/E/W: keep the side whose offset points that way.
                    const { d } = along(l, polyLength(l) / 2);
                    const nrm: P2 = [-d[1] * s, d[0] * s];
                    const want: P2 = side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'E' ? [1, 0] : [-1, 0];
                    if (nrm[0] * want[0] + nrm[1] * want[1] <= 0) continue;
                }
                const line = s === 1 ? l : l.slice().reverse();
                for (const run of offsetRuns(line, hw, name)) {
                    // The run is the curb line; the sidewalk lies away from the street (meters-left),
                    // which is world (dz, -dx): reverse to put it on (-dz, dx).
                    const sim = simplify(run, 0.12).reverse();
                    sidewalks.n.push(sim.length);
                    for (const p of sim) sidewalks.pts.push(wx(p), wz(p)), sidewalks.w.push(W(w));
                    ++nFree;
                }
            }
        }
    });
    console.log(`curbs: ${nBlocks} block rings → ${sidewalks.n.length} sidewalk runs (${nFree} off centerlines), ${curbs.n.length} curb strips, ${islands.n.length} islands`);

    // ---- crosswalks: every leg of every crosswalk node ----
    type Leg = { st: Street; p: P2; d: P2 }; // node position, unit direction away from the node
    const legsOf = new Map<string, Leg[]>();
    for (const st of streets) {
        if (st.layer === 'FREEWAYS' || st.layer === 'STREETS_PEDESTRI' || st.cls === 1 || st.cls === 0) continue;
        const L = polyLength(st.pts);
        const addLeg = (node: string, pts: P2[]) => {
            if (!node) return;
            const a = along(pts, Math.min(8, L * 0.5));
            const p = pts[0]!;
            const dx = a.p[0] - p[0];
            const dy = a.p[1] - p[1];
            const dl = Math.hypot(dx, dy) || 1;
            let l = legsOf.get(node);
            if (!l) legsOf.set(node, (l = []));
            l.push({ st, p, d: [dx / dl, dy / dl] });
        };
        addLeg(st.fromNode, st.pts);
        addLeg(st.toNode, st.pts.slice().reverse());
    }
    const crosswalks: number[] = [];
    let cwDropped = 0;
    let cwNodes = 0;
    for (const f of load('crosswalks')) {
        const node = String(Math.round(num(f.properties.cnn)));
        const legs = legsOf.get(node);
        if (!legs) continue;
        ++cwNodes;
        const continental = str(f.properties.continental) === 'YES' ? 1 : 0;
        for (const leg of legs) {
            if (leg.st.hw > 11) continue;
            // Set back past the cross street's curb line: its half width, measured along this leg.
            let setback = 1.5;
            for (const o of legs) {
                if (o === leg) continue;
                const sin = Math.abs(o.d[0] * leg.d[1] - o.d[1] * leg.d[0]);
                if (sin < 0.3) continue; // the same street continuing straight on
                setback = Math.max(setback, o.st.hw / sin);
            }
            setback = Math.min(setback, 16) + 0.6 + 1.5; // + gap + half the 3 m crosswalk
            if (setback > polyLength(leg.st.pts) * 0.45) continue;
            const c: P2 = [leg.p[0] + leg.d[0] * setback, leg.p[1] + leg.d[1] * setback];
            const hl = leg.st.hw - 0.3;
            const n: P2 = [-leg.d[1], leg.d[0]];
            const corners: P2[] = [];
            for (const a of [-1.5, 1.5]) for (const b of [-hl, hl]) corners.push([c[0] + leg.d[0] * a + n[0] * b, c[1] + leg.d[1] * a + n[1] * b]);
            if (!corners.every((p) => ok(p)) || !ok(c)) {
                ++cwDropped;
                continue;
            }
            crosswalks.push(wx(c), wz(c), Math.round(((heading(leg.d) * 180) / Math.PI) * 10), W(hl), continental);
        }
    }
    console.log(`crosswalks: ${crosswalks.length / 5} legs at ${cwNodes} nodes (${cwDropped} dropped at the course)`);

    // ---- bike lanes (CLASS II: painted lanes) ----
    const bike = { n: [] as number[], pts: [] as number[] };
    const compass: Record<string, P2> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0], NB: [0, 1], SB: [0, -1], EB: [1, 0], WB: [-1, 0] };
    for (const f of load('bike')) {
        const p = f.properties;
        if (str(p.facility_t) !== 'CLASS II') continue;
        for (const l of lines(f.geometry!)) {
            if (!l.some(inCore)) continue;
            const mid = along(l, polyLength(l) / 2);
            const sn = streetHash.nearest(mid.p, 6);
            const st = sn ? streets[sn.seg.data]! : null;
            const hw = st?.hw ?? 5;
            const name = st?.name ?? normName(str(p.streetname));
            // Lane center: next to the curb, or outside a 2.4 m parking lane on wide streets.
            const off = hw >= 6 ? hw - 2.4 - 0.8 : hw - 0.8;
            if (off < 1.5) continue;
            const oneWay = str(p.direct) === '1W';
            const dir = compass[str(p.dir).toUpperCase()];
            for (const s of [1, -1]) {
                // Lanes run with traffic: keep on the right of travel. The run's left side is s = 1.
                if (oneWay && dir) {
                    const travel = mid.d[0] * dir[0] + mid.d[1] * dir[1] >= 0 ? 1 : -1;
                    if (s !== -travel) continue;
                }
                emit(offsetRuns(l, off * s, name), 0.1, bike);
            }
        }
    }
    console.log(`bike lanes: ${bike.n.length} runs`);

    // ---- center lines (double yellow) on collectors / arterials ----
    const center = { n: [] as number[], pts: [] as number[] };
    for (const st of streets) {
        if (st.layer === 'FREEWAYS' || st.cls < 2 || st.cls > 4 || st.hw < 4) continue;
        emit(offsetRuns(st.pts, 0, st.name), 0.1, center);
    }
    console.log(`center lines: ${center.n.length} runs`);

    // ---- curb ramps ----
    const nodePos = new Map<string, P2>();
    for (const st of streets) {
        if (st.fromNode) nodePos.set(st.fromNode, st.pts[0]!);
        if (st.toNode) nodePos.set(st.toNode, st.pts[st.pts.length - 1]!);
    }
    const ramps: number[] = [];
    for (const f of load('curbRamps')) {
        if (str(f.properties.crexist) !== '1') continue;
        // The lat/lon are the intersection's; xloc/yloc (state plane) are the ramp's own.
        const x = num(f.properties.xloc);
        const y = num(f.properties.yloc);
        if (!x || !y) continue;
        const p = stateplane(x, y);
        if (!ok(p)) continue;
        // Faces the road: towards the nearest curb, else the intersection node, else the street.
        let d: P2 | null = null;
        const c = curbHash.nearest(p, 5);
        if (c && c.d > 0.1) d = [(c.q[0] - p[0]) / c.d, (c.q[1] - p[1]) / c.d];
        const node = nodePos.get(String(Math.round(num(f.properties.cnn))));
        if (!d && node) {
            const L = Math.hypot(node[0] - p[0], node[1] - p[1]);
            if (L > 0.5 && L < 40) d = [(node[0] - p[0]) / L, (node[1] - p[1]) / L];
        }
        if (!d) {
            const s = streetHash.nearest(p, 30);
            if (s && s.d > 0.1) d = [(s.q[0] - p[0]) / s.d, (s.q[1] - p[1]) / s.d];
        }
        if (!d) continue;
        ramps.push(wx(p), wz(p), deg(heading(d)), c ? 1 : 0);
    }
    console.log(`curb ramps: ${ramps.length / 4}`);

    // ---- parking meters ----
    const CAPS = ['Grey', 'Green', 'Yellow', 'Red', 'Black', 'Blue', 'Purple', 'Brown'];
    const meters: number[] = [];
    for (const f of load('meters')) {
        const pr = f.properties;
        if (str(pr.active_meter_flag) === 'U' || f.geometry!.type !== 'Point') continue;
        const p = m(f.geometry!.coordinates);
        if (!ok(p, MARGIN_TALL)) continue;
        let d: P2 = [0, 1];
        const c = curbHash.nearest(p, 6);
        const s = streetHash.nearest(p, 40);
        if (c && c.d > 0.1) d = [(c.q[0] - p[0]) / c.d, (c.q[1] - p[1]) / c.d];
        else if (s && s.d > 0.1) d = [(s.q[0] - p[0]) / s.d, (s.q[1] - p[1]) / s.d];
        // Not in the roadway.
        if (s && s.d < streets[s.seg.data]!.hw - 0.5) continue;
        const kind = str(pr.meter_type) === 'MS' ? 1 : 0;
        const cap = Math.max(0, CAPS.indexOf(str(pr.cap_color)));
        meters.push(wx(p), wz(p), deg(heading(d)), kind, cap, c ? 1 : 0);
    }
    console.log(`parking meters: ${meters.length / 6}`);

    const detail = {
        attribution: 'Street data: City and County of San Francisco, DataSF (PDDL).',
        scale: SCALE,
        /** x, z, heading (tenths of a degree; world atan2(dx, dz) of the street), half length, continental. */
        crosswalks,
        sidewalks,
        curbs,
        islands,
        bike,
        center,
        /** x, z, heading (degrees), on a raised (curbed) sidewalk. */
        ramps,
        /** x, z, heading (degrees), kind (0 post, 1 pay station), cap color (index into caps), on a raised sidewalk. */
        meters,
        caps: CAPS,
    };
    const text = JSON.stringify(detail);
    writeFileSync(OUT, text);
    console.log(`detail.json ${(text.length / 1024).toFixed(0)} KB`);
}

main();
