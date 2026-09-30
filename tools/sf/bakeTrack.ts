/**
 * Bakes the Golden Gate course centerline: the street route (tools/sf/route.ts) → simplified
 * polygon in world units → corners filleted with circular arcs (as large as the neighboring edges
 * allow, capped at MAX_RADIUS) → densely sampled closed path, plus the section boundaries and the
 * road elevation knots: the 1 m lidar terrain along the streets, smoothed to drive well
 * (tools/sf/profile.ts), and designed heights on the bridge deck and the Vista Point dip. Writes
 * tools/course/tracks/golden_gate.path.json, read by tracks/golden_gate.ts, and the profile's
 * samples (ground and road height every 5 m) to .context/profile/road.json for inspection.
 *
 * Usage: npx tsx tools/sf/bakeTrack.ts        (needs .context/sf from tools/sf/fetch.ts)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE, SCALE } from './geo';
import { HeightModel } from './heights';
import { loadOsm, simplify, StreetGraph, type P2 } from './osm';
import { roadProfile, type Knot } from './profile';
import { ALLOW_PATHS, buildRoute, CARRIAGEWAY, describe } from './route';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CTX = join(ROOT, '.context/sf');

/** World height of sea level (karts below y = 0 respawn, so the whole course sits above it). */
export const SEA_Y = 600;
const MAX_RADIUS = 9000;
/** Corners tighter than this after filleting are smoothed out (the builder needs >= 1.15 x the half width). */
const MIN_RADIUS = 2300;
const SAMPLE = 60;

const worldOf = (p: P2): P2 => [p[0] * SCALE, -p[1] * SCALE];

type Vertex = { p: P2; sec: number };

/** Fillets every corner of a closed polygon; returns a dense closed polyline with section tags. */
function fillet(V: Vertex[]): { pts: P2[]; sec: number[]; radii: number[] } {
    const n = V.length;
    const dir = (i: number): P2 => {
        const a = V[i % n]!.p;
        const b = V[(i + 1) % n]!.p;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    };
    const edgeLen = (i: number) => Math.hypot(V[(i + 1) % n]!.p[0] - V[i]!.p[0], V[(i + 1) % n]!.p[1] - V[i]!.p[1]);
    // Deflection at vertex i (between edge i-1 and edge i).
    const defl = V.map((_, i) => {
        const a = dir((i - 1 + n) % n);
        const b = dir(i);
        return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    });
    const tanHalf = defl.map((d) => Math.tan(Math.abs(d) / 2));
    // Tangent lengths: start from MAX_RADIUS, then shrink pairs that overlap on an edge.
    const T = tanHalf.map((t) => MAX_RADIUS * t);
    for (let iter = 0; iter < 200; ++iter) {
        let changed = false;
        for (let i = 0; i < n; ++i) {
            const j = (i + 1) % n;
            const L = edgeLen(i);
            if (T[i]! + T[j]! > L + 1e-6) {
                // Split the edge in proportion to what each corner wants.
                const k = L / (T[i]! + T[j]!);
                T[i] = T[i]! * k;
                T[j] = T[j]! * k;
                changed = true;
            }
        }
        if (!changed) break;
    }
    const pts: P2[] = [];
    const sec: number[] = [];
    const radii: number[] = [];
    for (let i = 0; i < n; ++i) {
        const P = V[i]!.p;
        const din = dir((i - 1 + n) % n);
        const dout = dir(i);
        const t = T[i]!;
        const a: P2 = [P[0] - din[0] * t, P[1] - din[1] * t];
        const R = tanHalf[i]! > 1e-9 ? t / tanHalf[i]! : Infinity;
        radii.push(R);
        // Arc from a (tangent din) turning by defl[i].
        const d = defl[i]!;
        if (Math.abs(d) < 1e-6 || !Number.isFinite(R)) {
            pts.push(P);
            sec.push(V[i]!.sec);
        } else {
            const sgn = Math.sign(d);
            // Left normal of din.
            const nl: P2 = [-din[1], din[0]];
            const c: P2 = [a[0] + nl[0] * R * sgn, a[1] + nl[1] * R * sgn];
            const steps = Math.max(2, Math.ceil((R * Math.abs(d)) / SAMPLE));
            for (let k = 0; k <= steps; ++k) {
                const th = (d * k) / steps;
                const ca = Math.cos(th);
                const sa = Math.sin(th);
                // Rotate (a - c) by th.
                const vx = a[0] - c[0];
                const vy = a[1] - c[1];
                pts.push([c[0] + vx * ca - vy * sa, c[1] + vx * sa + vy * ca]);
                // The arc belongs to the incoming section up to the vertex, then to the vertex's.
                sec.push(k * 2 < steps ? V[(i - 1 + n) % n]!.sec : V[i]!.sec);
            }
        }
        // Straight to the next arc start.
        const Q = V[(i + 1) % n]!.p;
        const b: P2 = [P[0] + dout[0] * t, P[1] + dout[1] * t];
        const e: P2 = [Q[0] - dout[0] * T[(i + 1) % n]!, Q[1] - dout[1] * T[(i + 1) % n]!];
        const len = Math.hypot(e[0] - b[0], e[1] - b[1]);
        const steps = Math.floor(len / SAMPLE);
        for (let k = 1; k < steps; ++k) {
            pts.push([b[0] + ((e[0] - b[0]) * k) / steps, b[1] + ((e[1] - b[1]) * k) / steps]);
            sec.push(V[i]!.sec);
        }
    }
    return { pts, sec, radii };
}

/** Radius of the circle through three points (Infinity when collinear). */
function radius3(a: P2, b: P2, c: P2): number {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

/**
 * Curvature-limited smoothing of a closed polyline: resampled uniformly, then points around any
 * spot whose radius (over +-H samples) is below `rMin` are Laplacian-smoothed until none is.
 * Elsewhere the geometry is left alone.
 */
function relax(pts0: P2[], sec0: number[], rMin: number): { pts: P2[]; sec: number[]; radii: number[] } {
    // Uniform resampling (closed), carrying section tags.
    const n0 = pts0.length;
    const cum = [0];
    for (let i = 1; i <= n0; ++i) cum.push(cum[i - 1]! + Math.hypot(pts0[i % n0]![0] - pts0[i - 1]![0], pts0[i % n0]![1] - pts0[i - 1]![1]));
    const total = cum[n0]!;
    const n = Math.round(total / SAMPLE);
    let pts: P2[] = [];
    const sec: number[] = [];
    let j = 0;
    for (let k = 0; k < n; ++k) {
        const S = (total * k) / n;
        while (j + 1 < n0 && cum[j + 1]! <= S) ++j;
        const a = pts0[j]!;
        const b = pts0[(j + 1) % n0]!;
        const w = (S - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
        pts.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
        sec.push(sec0[j]!);
    }
    const H = 5;
    const W = 12;
    const radii = () => pts.map((_, i) => radius3(pts[(i - H + n) % n]!, pts[i]!, pts[(i + H) % n]!));
    for (let it = 0; it < 4000; ++it) {
        const R = radii();
        const mark = new Uint8Array(n);
        let bad = 0;
        R.forEach((r, i) => {
            if (r >= rMin) return;
            ++bad;
            for (let d = -W; d <= W; ++d) mark[(i + d + n) % n] = 1;
        });
        if (!bad) break;
        pts = pts.map((p, i) => {
            if (!mark[i]) return p;
            const a = pts[(i - 1 + n) % n]!;
            const b = pts[(i + 1) % n]!;
            return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as P2;
        });
    }
    return { pts, sec, radii: radii() };
}

export async function bakeTrack(verbose = true) {
    const els = loadOsm(join(CTX, 'osm.json'));
    const graph = new StreetGraph(els, ALLOW_PATHS);
    const pieces = buildRoute(graph);
    if (verbose) console.log(describe(pieces));
    const heights = await HeightModel.load(CTX, { e0: CORE.e0 - 300, e1: CORE.e1 + 300, n0: CORE.n0 - 300, n1: CORE.n1 + 300 });

    // Closed polygon (world units), simplified, with each vertex tagged by section.
    const V: Vertex[] = [];
    pieces.forEach((p, si) => {
        // Literal polylines (the Fort Point and switchback arcs) keep their shape; streets are simplified.
        for (const q of simplify(p.pts, p.ways[0] === '(literal)' ? 0.25 : 2)) {
            const w = worldOf(q);
            const last = V[V.length - 1];
            if (last && Math.hypot(last.p[0] - w[0], last.p[1] - w[1]) < 150) continue;
            V.push({ p: w, sec: si });
        }
    });
    if (Math.hypot(V[0]!.p[0] - V.at(-1)!.p[0], V[0]!.p[1] - V.at(-1)!.p[1]) < 150) V.pop();
    const f0 = fillet(V);
    const f = relax(f0.pts, f0.sec, MIN_RADIUS);
    // The Fort Point loop (a literal arc) comes out of the fillets as short straights between
    // rounded corners: even its curvature out (Laplacian passes, ends held).
    for (const name of ['fort_point']) {
        const si = pieces.findIndex((p) => p.name === name);
        const idx = f.sec.map((s, i) => (s === si ? i : -1)).filter((i) => i >= 0);
        const n = f.pts.length;
        for (let it = 0; it < 250; ++it)
            for (const i of idx.slice(8, -8)) {
                const a = f.pts[(i - 1 + n) % n]!;
                const b = f.pts[(i + 1) % n]!;
                const p = f.pts[i]!;
                f.pts[i] = [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
            }
    }

    // Rotate so the path starts where the first section starts.
    const i0 = f.sec.findIndex((s) => s === 0);
    const pts = [...f.pts.slice(i0), ...f.pts.slice(0, i0)];
    const sec = [...f.sec.slice(i0), ...f.sec.slice(0, i0)];
    // Section starts (first index of each section after the previous one).
    const sections: { name: string; at: number }[] = [];
    let cur = -1;
    sec.forEach((s, i) => {
        if (s !== cur && s > cur) {
            sections.push({ name: pieces[s]!.name, at: i });
            cur = s;
        }
    });
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; ++i) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const secRange = (name: string): [number, number] => {
        const k = sections.findIndex((s) => s.name === name);
        const a = cum[sections[k]!.at]!;
        const b = k + 1 < sections.length ? cum[sections[k + 1]!.at]! : cum.at(-1)!;
        return [a, b];
    };

    // Designed heights (meters above sea level): the bridge deck and the Vista Point dip.
    const fixed: Knot[] = [];
    const k = (seg: string, frac: number, m: number) => {
        const r = secRange(seg);
        fixed.push({ seg, at: Math.round((r[1] - r[0]) * frac), y: m });
    };
    // The bridge deck, measured by the 2023 lidar (tools/sf/bridgeFit.ts): ~57 m at the south
    // anchorage, 74 m at the towers, 80.7 m at midspan, 65 m at the north end. Stations are meters
    // along each carriageway from its south end (the two carriageways start and end at different
    // places, so each has its own list; rerun bridgeFit.ts after a route change).
    const DECK = {
        bridge_nb: {
            along: [0, 65, 195, 625, 895, 1035, 1270, 1520, 1705, 1910, 2120, 2230, 2265, 2330],
            ys: [57.2, 59.1, 62.9, 74.1, 78.4, 79.9, 80.7, 79.5, 77.2, 73.3, 68.3, 65.2, 64.9, 66],
        },
        bridge_sb: {
            along: [0, 210, 625, 710, 1270, 1505, 1650, 1910, 2140, 2245, 2290, 2330],
            ys: [56.1, 60.9, 72.2, 74.1, 80.6, 80.2, 78.8, 74.5, 69.2, 66.1, 64.9, 65.1],
        },
    };
    const deck = (seg: 'bridge_nb' | 'bridge_sb') => {
        const r = secRange(seg);
        const len = r[1] - r[0];
        const { along, ys } = DECK[seg];
        along.forEach((a, j) => {
            const fr = seg === 'bridge_nb' ? a / 2330 : 1 - a / 2330;
            fixed.push({ seg, at: Math.round(len * Math.min(0.999, fr)), y: ys[j]! });
        });
    };
    deck('bridge_nb');
    // Vista Point: down to the lot, under US 101, back up to the deck.
    // (US 101 above the loop is at ~67 m and up; the deck ends are at 65-66 m.)
    k('vista', 0.25, 60);
    k('vista', 0.5, 53);
    k('vista', 0.62, 52);
    k('vista', 0.82, 58);
    deck('bridge_sb');

    const sectionMap = Object.fromEntries(sections.map((x) => [x.name, secRange(x.name)])) as Record<string, [number, number]>;
    const marina = secRange('marina');
    const prof = roadProfile({
        pts,
        cum,
        sections: sectionMap,
        heights,
        osm: els,
        fixedSections: ['bridge_nb', 'vista', 'bridge_sb'],
        fixed,
        // The boost-ramp jump over the Crissy Field lagoon inlet (tracks/golden_gate.ts): flat run-up.
        skip: [[marina[1] - 16000, marina[1] - 6000]],
        // Marine Drive eastbound is offset right of the street (route.ts CARRIAGEWAY).
        streetOffset: { marine_e: CARRIAGEWAY },
    });
    mkdirSync(join(ROOT, '.context/profile'), { recursive: true });
    writeFileSync(join(ROOT, '.context/profile/road.json'), JSON.stringify({ sections: sectionMap, samples: prof.samples }));
    const knots = prof.knots.map((q) => ({ seg: q.seg, at: q.at, y: Math.round(SEA_Y + q.y * SCALE) }));
    knots.sort((a, b) => secRange(a.seg)[0] + a.at - (secRange(b.seg)[0] + b.at));

    const minR = Math.min(...f.radii);
    if (verbose) {
        console.log(`path: ${pts.length} points, ${(cum.at(-1)! / 1000).toFixed(1)}k units, min fillet radius ${minR.toFixed(0)}`);
        const tight = f.radii.map((r, i) => [r, i] as const).filter(([r]) => r < MIN_RADIUS);
        for (const [r, i] of tight.slice(0, 20)) console.log(`  tight R=${r.toFixed(0)} at ${f.pts[i]!.map((v) => (v / SCALE).toFixed(0))} (${pieces[f.sec[i]!]!.name})`);
    }
    const out = {
        note: 'Generated by tools/sf/bakeTrack.ts from OpenStreetMap (ODbL) and USGS 3DEP lidar (public domain); world units (x east, z south).',
        scale: SCALE,
        seaY: SEA_Y,
        pts: pts.map(([x, z]) => [Math.round(x), Math.round(z)]),
        sections,
        titles: Object.fromEntries(pieces.map((p) => [p.name, p.title])),
        profile: knots,
    };
    writeFileSync(join(ROOT, 'tools/course/tracks/golden_gate.path.json'), JSON.stringify(out) + '\n');
    return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bakeTrack();
