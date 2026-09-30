/**
 * Measures the Golden Gate Bridge in the USGS 3DEP 2023 lidar (tools/sf/lidar.ts → .context/sf/lidar/
 * bridge.bin) and compares it with the procedural model (src/app/sf/bridgeParts/*) and the course's
 * drivable deck:
 *
 *   .context/bridge-fit/report.json   every measurement: model value, measured value, error (m)
 *   .context/bridge-fit/report.md     the human summary + recommended deck knots for bakeTrack.ts
 *   .context/bridge-fit/sideview.png  lidar side view with the model's deck / cables / towers drawn over
 *   public/data/sf/debug/bridge_lidar.bin   thinned points for sfviewer.html?model=bridge&lidar=1
 *
 * Coordinates: model along s / lateral l from bridgeParts/frame.ts (meters here), lateral r from the
 * real deck centerline (the real bridge is straight, the model axis bends at the towers), heights in
 * meters above our sea level (NAVD88 − DATUM).
 *
 * Usage: npx tsx tools/sf/bridgeFit.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE, DECK_PROFILE, SEA_Y, deckHeightM } from '../../src/app/sf/geo';
import { type CenterlinePoint, LEN, S_MARIN, S_SF, deckY, toAxis, useCourseCenterline, xz } from '../../src/app/sf/bridgeParts/frame';
import * as LY from '../../src/app/sf/bridgeParts/layout';
import { REAL_TOP_M } from '../../src/app/sf/bridgeParts/real';
import { SCALE } from './geo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.context/bridge-fit');
const DEBUG_BIN = join(ROOT, 'public/data/sf/debug/bridge_lidar.bin');

/**
 * Our sea level (y = SEA_Y) in NAVD88 meters: mean sea level at NOAA station 9414290 San Francisco
 * (1983-2001 epoch: MSL 2.773 m, NAVD88 1.804 m above station datum). Check: the lidar's water returns
 * (2023-04-20 13:45-14:00 UTC) sit at -0.06..-0.15 m NAVD88 where the gauge read -0.16..-0.13 m.
 */
const DATUM = 0.969;
const GAUGE = { station: '9414290 San Francisco', time: '2023-04-20 13:42-14:00 UTC', navd88: [-0.166, -0.129], msl: 0.969, mhw: 1.612, mllw: 0.018 };
/** Main cable radius (36 3/8 in over the wrapping): the lidar sees its top. */
const CABLE_R = 0.46;
const M = SCALE;

// ---- Points. ----
type Pts = { n: number; e: Float32Array; nn: Float32Array; h: Float32Array; c: Uint8Array; s: Float32Array; l: Float32Array; r: Float32Array };

function loadPoints(): Pts {
    const f = join(ROOT, '.context/sf/lidar/bridge.bin');
    if (!existsSync(f)) throw new Error(`missing ${f} (run npx tsx tools/sf/lidar.ts)`);
    const b = readFileSync(f);
    if (b.toString('ascii', 0, 4) !== 'GGL1') throw new Error('bad bridge.bin');
    const n = b.readUInt32LE(4);
    const xyz = new Float32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + n * 12));
    const c = new Uint8Array(b.buffer.slice(b.byteOffset + 8 + n * 12, b.byteOffset + 8 + n * 13));
    const P: Pts = { n, e: new Float32Array(n), nn: new Float32Array(n), h: new Float32Array(n), c, s: new Float32Array(n), l: new Float32Array(n), r: new Float32Array(n) };
    for (let i = 0; i < n; ++i) {
        P.e[i] = xyz[i * 3]!;
        P.nn[i] = xyz[i * 3 + 1]!;
        P.h[i] = xyz[i * 3 + 2]! - DATUM;
        const a = toAxis(P.e[i]! * M, -P.nn[i]! * M);
        P.s[i] = a.s / M;
        P.l[i] = a.l / M;
    }
    return P;
}

// ---- Small statistics helpers. ----
const quant = (a: number[] | Float32Array, p: number): number => {
    const s = Array.from(a).sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]! : NaN;
};
const median = (a: number[]) => quant(a, 0.5);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Piecewise linear interpolation in a sorted table (clamped). */
function interp(xs: number[], ys: number[], x: number): number {
    if (!xs.length) return NaN;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (xs[m]! <= x) lo = m;
        else hi = m;
    }
    return ys[lo]! + ((ys[hi]! - ys[lo]!) * (x - xs[lo]!)) / (xs[hi]! - xs[lo]!);
}
/** Least-squares polynomial (degree 1 or 2) through (x, y). Returns coefficients [c0, c1, c2]. */
function polyfit(x: number[], y: number[], deg: 1 | 2): number[] {
    const k = deg + 1;
    const A = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
    for (let i = 0; i < x.length; ++i) {
        const p = Array.from({ length: k }, (_, j) => x[i]! ** j);
        for (let a = 0; a < k; ++a) {
            for (let b = 0; b < k; ++b) A[a]![b]! += p[a]! * p[b]!;
            A[a]![k]! += p[a]! * y[i]!;
        }
    }
    for (let i = 0; i < k; ++i) {
        let piv = i;
        for (let j = i + 1; j < k; ++j) if (Math.abs(A[j]![i]!) > Math.abs(A[piv]![i]!)) piv = j;
        [A[i], A[piv]] = [A[piv]!, A[i]!];
        for (let j = 0; j < k; ++j) {
            if (j === i) continue;
            const f = A[j]![i]! / A[i]![i]!;
            for (let q = i; q <= k; ++q) A[j]![q]! -= f * A[i]![q]!;
        }
    }
    return A.map((row, i) => row[k]! / row[i]!);
}
const poly = (c: number[], x: number) => c.reduce((t, v, j) => t + v * x ** j, 0);
/** Runs of consecutive histogram bins with count >= thr (gaps up to `gap` bins bridged). */
function runs(hist: number[], thr: number, gap = 1): [number, number][] {
    const out: [number, number][] = [];
    let a = -1;
    let last = -1;
    for (let i = 0; i < hist.length; ++i) {
        if (hist[i]! < thr) continue;
        if (a >= 0 && i - last - 1 <= gap) last = i;
        else {
            if (a >= 0) out.push([a, last]);
            a = i;
            last = i;
        }
    }
    if (a >= 0) out.push([a, last]);
    return out;
}

// ---- Report. ----
type Item = { group: string; name: string; model: number | null; measured: number; error: number | null; unit: string; note?: string };
const items: Item[] = [];
function item(group: string, name: string, model: number | null, measured: number, note?: string, unit = 'm'): void {
    items.push({ group, name, model: model === null ? null : r2(model), measured: r2(measured), error: model === null ? null : r2(model - measured), unit, ...(note ? { note } : {}) });
}
const my = (y: number) => (y - SEA_Y) / M;

function main() {
    mkdirSync(OUT, { recursive: true });
    const P = loadPoints();
    console.log(`${P.n} points`);

    // Course centerline (the drivable deck as built).
    const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/courses/golden_gate/course_meta.json'), 'utf8')) as { centerline: (CenterlinePoint & { s: number })[]; segments: Record<string, [number, number]> };

    // ---- 1. Real deck centerline and axis. ----
    const BIN = 10;
    const nb = Math.ceil((LEN / M + 170) / BIN) + 20;
    const b0 = -170;
    const deckBins: number[][] = Array.from({ length: nb }, () => []);
    for (let i = 0; i < P.n; ++i) if (P.c[i] === 17) deckBins[Math.floor((P.s[i]! - b0) / BIN)]?.push(i);
    const cenS: number[] = [];
    const cenL: number[] = [];
    deckBins.forEach((ids, k) => {
        if (ids.length < 1500) return;
        const ls = ids.map((i) => P.l[i]!);
        const lo = quant(ls, 0.02);
        const hi = quant(ls, 0.98);
        // Skip bins where walkways / ramps widen the deck (towers, the Vista Point ramps).
        if (hi - lo > 27.5) return;
        cenS.push(b0 + (k + 0.5) * BIN);
        cenL.push((lo + hi) / 2);
    });
    const cen = (s: number) => interp(cenS, cenL, s);
    // Straight real axis from the deck centers between the pylons.
    const axE: number[] = [];
    const axN: number[] = [];
    cenS.forEach((s, k) => {
        if (s < 300 || s > 2200) return;
        const [x, z] = xz(s * M, cenL[k]! * M);
        axE.push(x / M);
        axN.push(-z / M);
    });
    const ax = polyfit(axN, axE, 1);
    const heading = (Math.atan(ax[1]!) * 180) / Math.PI;
    const axisOff = (e: number, n: number) => (e - poly(ax, n)) * Math.cos((heading * Math.PI) / 180);
    // Lateral from the real deck centerline: the straight axis north of the curved south approach.
    for (let i = 0; i < P.n; ++i) P.r[i] = P.s[i]! >= 110 ? axisOff(P.e[i]!, P.nn[i]!) : P.l[i]! - cen(P.s[i]!);
    const segHeading = (a: [number, number], b: [number, number]) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    item('axis', 'heading SF tower → Marin tower (deg east of north)', segHeading(BRIDGE.sfTower, BRIDGE.marinTower), heading, undefined, 'deg');
    item('axis', 'heading south end → SF tower (deg)', segHeading(BRIDGE.southEnd, BRIDGE.sfTower), heading, 'model axis kinks at the towers; the real bridge is straight', 'deg');
    item('axis', 'heading Marin tower → north end (deg)', segHeading(BRIDGE.marinTower, BRIDGE.northEnd), heading, undefined, 'deg');
    for (const [name, p] of [
        ['southEnd', BRIDGE.southEnd],
        ['sfTower', BRIDGE.sfTower],
        ['marinTower', BRIDGE.marinTower],
        ['northEnd', BRIDGE.northEnd],
    ] as const)
        item('axis', `geo.ts BRIDGE.${name}: lateral offset from the real axis (+ east)`, axisOff(p[0], p[1]), 0);
    for (const s of [0, 120, 200, 400]) item('axis', `real deck centerline at s=${s}: model lateral l`, 0, cen(s), 'course carriageways follow the model axis');

    // ---- 2. Road surface along the span. ----
    type Row = { s: number; mid: number; west: number; east: number; n: number };
    const road: Row[] = [];
    deckBins.forEach((ids, k) => {
        const s = b0 + (k + 0.5) * BIN;
        const w: number[] = [];
        const e: number[] = [];
        for (const i of ids) {
            const r = P.r[i]!;
            if (Math.abs(r) > 8.5) continue;
            if (r < -1) w.push(P.h[i]!);
            else if (r > 1) e.push(P.h[i]!);
        }
        if (w.length + e.length < 800) return;
        road.push({ s, mid: median([...w, ...e]), west: median(w), east: median(e), n: w.length + e.length });
    });
    const rs = road.map((q) => q.s);
    const roadMid = (s: number) => interp(rs, road.map((q) => q.mid), s);
    const roadSide = (s: number, sg: number) => interp(rs, road.map((q) => (sg > 0 ? q.east : q.west)), s);

    // The course deck as built (the visual deck follows it).
    useCourseCenterline(meta.centerline);
    const course = (s: number, sg: number) => my(deckY(s * M, sg * BRIDGE.carriageway * M));
    const geoDeck = (s: number) => deckHeightM((s * 2330) / (LEN / M));
    for (const s of [0, 100, 200, 300, 400, 500, S_SF / M, 800, 1000, 1100, 1200, (S_SF + S_MARIN) / 2 / M, 1400, 1600, 1800, S_MARIN / M, 2000, 2100, 2200, 2300, LEN / M]) {
        const tag = Math.abs(s - S_SF / M) < 1 ? ' (SF tower)' : Math.abs(s - S_MARIN / M) < 1 ? ' (Marin tower)' : Math.abs(s - (S_SF + S_MARIN) / 2 / M) < 1 ? ' (midspan)' : '';
        item('deck', `road surface s=${r1(s)}${tag}: course NB (east)`, course(s, 1), roadSide(s, 1));
        item('deck', `road surface s=${r1(s)}${tag}: course SB (west)`, course(s, -1), roadSide(s, -1));
        item('deck', `road surface s=${r1(s)}${tag}: geo.ts DECK_PROFILE`, geoDeck(s), roadMid(s));
    }
    const crown = median(road.filter((q) => q.s > 700 && q.s < 1850).map((q) => q.mid - (q.west + q.east) / 2));
    const tilt = median(road.filter((q) => q.s > 700 && q.s < 1850).map((q) => q.east - q.west));
    item('deck', 'cross slope: east half − west half (main span median)', null, tilt);
    item('deck', 'crown: center − mean of halves (main span median)', null, crown);
    const peak = road.reduce((a, q) => (q.mid > a.mid ? q : a));
    item('deck', 'road high point: along s', 1270 * (LEN / M / 2330), peak.s);
    item('deck', 'road high point: height', 76, peak.mid);
    const knots = fitKnots(meta, roadSide);

    // ---- 3. Towers. ----
    const towers = [measureTower(P, 'SF', S_SF / M, roadMid), measureTower(P, 'Marin', S_MARIN / M, roadMid)];
    for (const t of towers) {
        const S = t.name === 'SF' ? S_SF / M : S_MARIN / M;
        const [x, z] = xz(t.s * M, t.l * M);
        item('tower', `${t.name} tower center: along s`, S, t.s, `world e,n = ${r1(x / M)}, ${r1(-z / M)}`);
        item('tower', `${t.name} tower center: lateral from model axis`, 0, t.l);
        item('tower', `${t.name} leg top (cornice under the cap)`, REAL_TOP_M, t.top);
        item('tower', `${t.name} highest point (beacon / mast)`, REAL_TOP_M + 7.1, t.max);
        item('tower', `${t.name} road at tower`, my(deckY(S * M, 0)), t.road);
        item('tower', `${t.name} leg inner face |r| (model is widened, not fitted)`, LY.LEG_IN / M, t.legIn);
        item('tower', `${t.name} pier top`, 12, t.pierTop);
        t.sections.forEach((sec, k) => {
            const ms = k === 0 ? LY.LEG_BASE : LY.LEG_SECTIONS[k - 1];
            item('tower', `${t.name} leg section ${k} (${k === 0 ? 'under the deck' : `above strut ${k - 1}`}, sampled ${r1(sec.h0)}..${r1(sec.h1)}): along depth D`, ms ? ms.D : null, sec.D);
            item('tower', `${t.name} leg section ${k}: lateral width W (model widened, not fitted)`, ms ? ms.W : null, sec.W);
        });
        const H = t.top - t.road;
        const mH = REAL_TOP_M - my(deckTop(S));
        t.struts.forEach((st, k) => {
            const ms = LY.STRUTS[k];
            item('tower', `${t.name} portal strut ${k} bottom (fraction of top − road)`, ms ? ms[0] : null, (st[0] - t.road) / H, `${r1(st[0])} m; model ${ms ? r1(my(deckTop(S)) + ms[0] * mH) : '-'} m`, 'frac');
            item('tower', `${t.name} portal strut ${k} top (fraction)`, ms ? ms[1] : null, (st[1] - t.road) / H, `${r1(st[1])} m; model ${ms ? r1(my(deckTop(S)) + ms[1] * mH) : '-'} m`, 'frac');
        });
    }
    const T = { sf: towers[0]!, marin: towers[1]! };
    const tc = [T.sf.s, T.marin.s];

    // ---- 4. Pylons, arch, anchorages, viaduct bents. ----
    const ends = measureEnds(P, roadMid);
    const nearest = (want: number, list: [number, number][]) => list.reduce((a, b) => (Math.abs((b[0] + b[1]) / 2 - want) < Math.abs((a[0] + a[1]) / 2 - want) ? b : a));
    const sS2 = nearest(170, ends.pylons);
    const sS1 = nearest(282, ends.pylons);
    const sN1 = nearest(2258, ends.pylons);
    const sN2 = nearest(2358, ends.pylons);
    for (const [name, m, got] of [
        ['S2', LY.S2, sS2],
        ['S1', LY.S1, sS1],
        ['N1', LY.N1, sN1],
    ] as const) {
        item('pylon', `${name} south face`, m[0] / M, got[0]);
        item('pylon', `${name} north face`, m[1] / M, got[1]);
    }
    item('pylon', 'N2 (north end of the anchorage) south face', null, sN2[0]);
    item('pylon', 'N2 north face', null, sN2[1]);
    for (const [name, p, m] of [
        ['S2', sS2, 9.6],
        ['S1', sS1, 9.7],
        ['N1', sN1, 7.8],
        ['N2', sN2, null],
    ] as const) {
        const t = ends.pylonTops.find((q) => Math.abs(q.s - (p[0] + p[1]) / 2) < 1)!;
        item('pylon', `${name} shaft top above the road`, m, t.top - roadMid(t.s), m === null ? undefined : 'model: real.ts pylon()');
    }
    item('anchorage', 'south anchorage block: south end', 0, ends.southAnch[0]);
    item('anchorage', 'south anchorage block: north end', LY.S2[0] / M, ends.southAnch[1]);
    item('anchorage', 'south anchorage block: top', null, ends.southAnchTop);
    item('anchorage', 'north anchorage block: south end', LY.N1[1] / M, sN1[1]);
    item('anchorage', 'north anchorage block: north end', LY.N_ANCH_END / M, sN2[0]);
    // Viaduct bents: only the approaches (outside the pylons and the anchorages).
    const bentsIn = ends.bents.filter((b) => b[0] > -100 && b[1] < LEN / M + 150 && (b[1] < ends.southAnch[0] + 8 || b[0] > sN2[1] + 2));
    bentsIn.forEach((b, k) => item('viaduct', `bent ${k} center (depth ${r1(b[1] - b[0])} m)`, null, (b[0] + b[1]) / 2));
    LY.VIADUCT_BENTS.forEach((s, k) => item('viaduct', `model bent ${k}: nearest measured bent`, s / M, bentsIn.length ? bentsIn.map((b) => (b[0] + b[1]) / 2).reduce((a, c) => (Math.abs(c - s / M) < Math.abs(a - s / M) ? c : a)) : NaN));
    const arch = measureArch(P, sS2[1], sS1[0]);
    item('arch', 'south springing (S2 north face)', LY.ARCH[0] / M, sS2[1]);
    item('arch', 'north springing (S1 south face)', LY.ARCH[1] / M, sS1[0]);
    item('arch', 'span', (LY.ARCH[1] - LY.ARCH[0]) / M, sS1[0] - sS2[1]);
    item('arch', 'bottom chord at the springings (parabola fit to the chord tops)', my(LY.archY(LY.ARCH[0])), arch.parabola.spring, `circular segment fit: ${r1(arch.spring)}`);
    item('arch', 'bottom chord crown', my(LY.archY((LY.ARCH[0] + LY.ARCH[1]) / 2)), arch.parabola.crown, `circular segment fit: ${r1(arch.crown)}`);
    item('arch', 'top chord at the springings (parabola fit)', LY.ARCH_TOP_CHORD[0], arch.topChord.spring, `rms ${r2(arch.topChord.rms)} m, ${arch.topChord.inliers} bins`);
    item('arch', 'top chord crown', LY.ARCH_TOP_CHORD[1], arch.topChord.crown);
    item('arch', 'intrados rms of the model curve vs the measured one (same span fraction)', null, archShapeErr(arch));
    item('arch', 'rib depth at the crown (chord tops)', LY.ARCH_TOP_CHORD[1] - my(LY.archY((LY.ARCH[0] + LY.ARCH[1]) / 2)), arch.rib, 'a slice at the crown reads 43.0 / 47.5 (4.5 m)');
    item('arch', 'intrados rms vs best parabola', null, arch.rmsParabola, `spring ${r1(arch.parabola.spring)}, crown ${r1(arch.parabola.crown)}`);
    item('arch', `intrados rms vs ${arch.shapeName}`, null, arch.rmsShape);

    // ---- 5. Main cables. ----
    // The measured road as a course centerline (both carriageways), to check the structure's shape
    // independently of the deck error.
    const measuredDeck: CenterlinePoint[] = [];
    for (const sg of [-1, 1])
        for (let s = -60; s <= LEN / M + 150; s += 5) {
            const [x, z] = xz(s * M, sg * BRIDGE.carriageway * M);
            measuredDeck.push({ pos: [x, SEA_Y + roadSide(s, sg) * M, z] });
        }
    const cab = measureCables(P, roadMid, tc, [sS1, sN1], measuredDeck, meta.centerline);
    useCourseCenterline(meta.centerline);
    for (const sg of [-1, 1]) {
        const side = sg > 0 ? 'east' : 'west';
        const c = cab.side[sg > 0 ? 1 : 0]!;
        const spec = LY.cableSpec(REAL_TOP_M, sg);
        item('cable', `${side} cable lateral |r| (model widened, not fitted)`, LY.CABLE_L / M, Math.abs(c.lat));
        item('cable', `${side} span parabolas' intersection at the SF tower`, my(spec.saddleY), c.saddle[0], 'over the saddle the model cable is capped flat at the leg top + 4 m (lidar apex ~226)');
        item('cable', `${side} span parabolas' intersection at the Marin tower`, my(spec.saddleY), c.saddle[1]);
        item('cable', `${side} main span low point`, my(spec.midY), c.low, `at s=${r1(c.lowS)} (model ${r1((S_SF + S_MARIN) / 2 / M)})`);
        item('cable', `${side} low point above road`, my(spec.midY) - my(deckY((S_SF + S_MARIN) / 2, sg * LY.CABLE_L)), c.low - roadMid(c.lowS));
        const s1m = (LY.S1[0] + LY.S1[1]) / 2;
        const n1m = (LY.N1[0] + LY.N1[1]) / 2;
        item('cable', `${side} cable at the S1 pylon center, above the road`, my(spec.s1Y) - my(deckY(s1m, sg * LY.CABLE_L)), c.atS1 - roadMid((sS1[0] + sS1[1]) / 2));
        item('cable', `${side} cable at the N1 pylon center, above the road`, my(spec.n1Y) - my(deckY(n1m, sg * LY.CABLE_L)), c.atN1 - roadMid((sN1[0] + sN1[1]) / 2));
        item('cable', `${side} saddle above the leg top`, my(spec.saddleY) - REAL_TOP_M, (c.saddle[0] + c.saddle[1]) / 2 - (T.sf.top + T.marin.top) / 2);
        item('cable', `${side} main span sag (saddle − low)`, my(spec.saddleY) - my(spec.midY), (c.saddle[0] + c.saddle[1]) / 2 - c.low);
        for (const span of c.spans) item('cable', `${side} ${span.name} (model's span): model − measured, mean`, span.mean, 0, `max |err| ${r2(span.max)} m (course deck); with the measured deck: mean ${r2(span.meanM)}, max ${r2(span.maxM)}; parabola fit rms ${r2(span.rms)} m`);
    }
    const tr = measureTruss(P, roadMid, tc, cab.lat);
    item('truss', 'bottom chord, top surface, below the road', null, tr.chord, 'airborne lidar sees the top surfaces');
    item('truss', 'truss bottom (bottom chord underside, ~0.9 m chord) below the road', LY.TRUSS_BOT / M, tr.chord + 0.9);
    item('truss', 'lowest structure (travelers / lateral bracing) below the road', null, tr.lowest);
    item('truss', 'midspan clearance of the lowest structure above MHW', null, roadMid(1270) - tr.lowest - (GAUGE.mhw - DATUM), 'the charted figure is 220 ft (67 m)');
    item('truss', 'truss top below the road (model under the widened sidewalk; not fitted)', LY.TRUSS_TOP / M, tr.top);
    const bs = cab.backstay;
    item('cable', 'backstay (S1 → anchorage) slope, rise per m north', null, bs.slope, `${bs.n} points, rms ${r2(bs.rms)} m`, 'm/m');
    item('cable', 'backstay height at the S1 south face', null, bs.at(sS1[0]));
    item('cable', 'backstay height at the S2 north face', null, bs.at(sS2[1]));

    // ---- 6. Suspenders. ----
    const sus = measureSuspenders(P, cab, tc, [sS1[1], sN1[0]]);
    const modelSus = LY.suspenderStations().map((s) => s / M);
    item('suspender', 'spacing (median)', 2 * LY.PANEL / M, sus.spacing);
    item('suspender', 'first suspender north of the SF tower center', modelSus.find((s) => s > S_SF / M)! - S_SF / M, sus.firstMain[0]);
    item('suspender', 'first suspender south of the Marin tower center', S_MARIN / M - [...modelSus].reverse().find((s) => s < S_MARIN / M)!, sus.firstMain[1]);
    item('suspender', 'count, main span (per cable)', modelSus.filter((s) => s > S_SF / M && s < S_MARIN / M).length, sus.countMain, undefined, 'count');
    item('suspender', 'count, SF side span', modelSus.filter((s) => s < S_SF / M).length, sus.countSide[0], 'the model side span is shorter (its S1 is placed for the course)', 'count');
    item('suspender', 'count, Marin side span', modelSus.filter((s) => s > S_MARIN / M).length, sus.countSide[1], 'detection unreliable: the ropes near N1 are short and in front of the hillside trees', 'count');
    item('suspender', 'phase: offset of the measured grid from the tower-aligned grid (median)', 0, sus.phase);

    // ---- Datum check. ----
    const water: number[] = [];
    for (let i = 0; i < P.n; ++i) if (P.c[i] === 9) water.push(P.h[i]! + DATUM);
    const datum = { assumed: DATUM, rule: 'our height = NAVD88 − DATUM (MSL at NOAA 9414290)', lidarWaterNavd88: { p5: r2(quant(water, 0.05)), median: r2(median(water)), p95: r2(quant(water, 0.95)), n: water.length }, gauge: GAUGE };

    // ---- Outputs. ----
    const report = { generated: new Date().toISOString(), source: 'USGS 3DEP CA_SanFrancisco_1_B23 (2023) EPT, via tools/sf/lidar.ts', datum, items, road: road.map((q) => ({ s: q.s, mid: r2(q.mid), west: r2(q.west), east: r2(q.east), courseNB: r2(course(q.s, 1)), courseSB: r2(course(q.s, -1)) })), knots, towers: towers.map((t) => ({ ...t, profile: undefined })), towerProfiles: towers.map((t) => ({ name: t.name, profile: t.profile })), cables: cab.side.map((c) => ({ lat: c.lat, bins: c.bins })), backstay: { slope: bs.slope, c0: bs.c0 }, suspenders: sus, ends, arch };
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
    writeFileSync(join(OUT, 'report.md'), markdown(items, knots, datum, report.road));
    sideview(P, road, cab, towers);
    writeDebug(P);
    useCourseCenterline(null);
    console.log(`wrote ${join(OUT, 'report.json')}, report.md, sideview.png`);
}

/** Rms (m) of the model's arch curve against the measured intrados, compared at the same span fraction. */
function archShapeErr(arch: { a: number; b: number; intrados: number[][] }): number {
    const [m0, m1] = [LY.ARCH[0] / M, LY.ARCH[1] / M];
    const d = arch.intrados.map(([s, y]) => my(LY.archY((m0 + ((s! - arch.a) / (arch.b - arch.a)) * (m1 - m0)) * M)) - y!);
    const ok = d.filter((v) => Math.abs(v) < 6);
    return Math.sqrt(ok.reduce((q, v) => q + v * v, 0) / ok.length);
}

const deckTop = (s: number) => Math.max(deckY(s, -2000), deckY(s, 2000));

// ---- Towers. ----
type Tower = {
    name: string;
    s: number;
    l: number;
    road: number;
    top: number;
    hood: number;
    max: number;
    legIn: number;
    pierTop: number;
    sections: { h0: number; h1: number; D: number; W: number }[];
    struts: [number, number][];
    profile: { h: number; D: number; W: number; inner: number; s: number }[];
};

function measureTower(P: Pts, name: string, guess: number, road: (s: number) => number): Tower {
    const ids: number[] = [];
    for (let i = 0; i < P.n; ++i) if (P.c[i] === 1 && Math.abs(P.s[i]! - guess) < 30 && Math.abs(P.r[i]!) < 30) ids.push(i);
    // Center: the legs between the deck and the top (no suspenders within ~7 m of the leg faces).
    const rd0 = road(guess);
    const legs = ids.filter((i) => P.h[i]! > rd0 + 10 && Math.abs(P.r[i]!) > 6 && Math.abs(P.r[i]!) < 22 && Math.abs(P.s[i]! - guess) < 14);
    const sc = (quant(legs.map((i) => P.s[i]!), 0.01) + quant(legs.map((i) => P.s[i]!), 0.99)) / 2;
    const rd = road(sc);
    const lw = legs.filter((i) => P.r[i]! < 0).map((i) => P.l[i]!);
    const le = legs.filter((i) => P.r[i]! > 0).map((i) => P.l[i]!);
    const lc = (quant(lw, 0.01) + quant(le, 0.99)) / 2;
    const col = ids.filter((i) => Math.abs(P.s[i]! - sc) < 12 && Math.abs(P.r[i]!) < 24);
    const max = quant(col.map((i) => P.h[i]!), 0.9995);
    // Horizontal surfaces between the legs (strut tops / soffit ledges, the pier top, the roof): spikes
    // in a 0.5 m height histogram of the points inside the tower's footprint.
    const hist = new Array<number>(Math.ceil(max * 2) + 2).fill(0);
    for (const i of col) if (Math.abs(P.s[i]! - sc) < 7 && Math.abs(P.r[i]!) < 7.5 && P.h[i]! > 0) hist[Math.floor(P.h[i]! * 2)]!++;
    const spikes = runs(hist.map((v) => (v >= 150 ? 1 : 0)), 1, 2).map(([x, y]) => [x / 2, (y + 1) / 2] as [number, number]);
    // The pier top: the highest surface under the deck structure, well above the water.
    const pierTop = spikes.filter(([x]) => x > 4 && x < rd - 30).reduce((a, [x]) => Math.max(a, x), -Infinity) + 0.25;
    // Roof: the most-hit surface high up; the tower top is the top of that surface.
    let roof = -1;
    hist.forEach((v, k) => {
        if (k / 2 > rd + 100 && (roof < 0 || v > hist[roof]!)) roof = k;
    });
    const top = roof / 2 + 0.5;
    // Portal struts: pairs of surfaces 6-14 m apart with the space between them mostly filled.
    const struts: [number, number][] = [];
    const up = spikes.filter(([x]) => x > rd + 8 && x < top + 1);
    for (let k = 0; k + 1 < up.length; ++k) {
        const [a0] = up[k]!;
        let best = -1;
        for (let j = k + 1; j < up.length; ++j) {
            const b1 = Math.min(top, up[j]![1]);
            if (b1 - a0 > 14) break;
            if (b1 - a0 < 6) continue;
            let fill = 0;
            let tot = 0;
            for (let q = Math.floor(a0 * 2); q < Math.floor(b1 * 2); ++q, ++tot) if (hist[q]! >= 8) ++fill;
            if (fill / tot >= 0.7) best = j;
        }
        if (best < 0) continue;
        struts.push([a0, Math.min(top, up[best]![1])]);
        k = best;
    }
    // Per-meter profile of the legs: along depth, lateral width, inner face.
    const profile: Tower['profile'] = [];
    for (let h = 0; h < max; ++h) {
        const band = col.filter((i) => P.h[i]! >= h && P.h[i]! < h + 1 && Math.abs(P.r[i]!) > 5);
        if (band.length < 60) continue;
        const ss = band.map((i) => P.s[i]!);
        const ar = band.map((i) => Math.abs(P.r[i]!));
        const inner = quant(ar, 0.03);
        profile.push({ h: h + 0.5, D: quant(ss, 0.99) - quant(ss, 0.01), W: quant(ar, 0.99) - Math.max(inner, 0), inner, s: (quant(ss, 0.99) + quant(ss, 0.01)) / 2 });
    }
    const legIn = median(profile.filter((p) => p.h > rd + 8 && !struts.some(([a, b]) => p.h > a - 1 && p.h < b + 1)).map((p) => p.inner));
    // Leg sections: below the deck, then between the struts (setbacks at the strut tops).
    const sec = (h0: number, h1: number) => {
        const pr = profile.filter((p) => p.h > h0 && p.h < h1);
        return { h0, h1, D: median(pr.map((p) => p.D)), W: median(pr.map((p) => p.W)) };
    };
    const S = struts;
    const sections = [sec(pierTop + 8, rd - 16), sec(rd + 8, (S[0]?.[0] ?? top) - 1)];
    for (let k = 0; k + 1 < S.length; ++k) sections.push(sec(S[k]![1] + 1, S[k + 1]![0] - 1));
    const flare = sec(pierTop, pierTop + 6);
    console.log(`${name} tower: s ${r2(sc)} l ${r2(lc)} road ${r2(rd)} top ${r2(top)} max ${r2(max)} legIn ${r2(legIn)} pier ${r2(pierTop)} (flare D ${r1(flare.D)})`);
    console.log(`  sections ${sections.map((s) => `[${r1(s.h0)}..${r1(s.h1)} D${r1(s.D)} W${r1(s.W)}]`).join(' ')}`);
    console.log(`  struts ${struts.map(([x, y]) => `${r1(x)}..${r1(y)}`).join(' ')}`);
    return { name, s: sc, l: lc, road: rd, top, hood: NaN, max, legIn, pierTop, sections, struts, profile };
}

// ---- Pylons, anchorages, bents (the two ends). ----
function measureEnds(P: Pts, road: (s: number) => number) {
    const S0 = -160;
    const S1 = LEN / M + 160;
    const nb = Math.ceil((S1 - S0) * 2);
    const shaft = new Array<number>(nb).fill(0);
    const slabs = Array.from({ length: nb * 2 }, () => new Set<number>());
    const roofs: number[][] = Array.from({ length: nb }, () => []);
    const tops = new Array<number>(nb).fill(-Infinity);
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1) continue;
        const s = P.s[i]!;
        if (s > 450 && s < 2150) continue;
        const k = Math.floor((s - S0) * 2);
        const ar = Math.abs(P.r[i]!);
        const dh = P.h[i]! - road(s);
        // Pylon shafts flank the sidewalks above the deck (outside the cable and suspender line).
        if (ar > 14.8 && ar < 19.5 && dh > 2.5 && dh < 14) {
            shaft[k]!++;
            tops[k] = Math.max(tops[k]!, P.h[i]!);
        }
        // Bents: full-height columns under both stiffening trusses (occupied 1 m slabs per side).
        if (ar > 6 && ar < 18 && dh > -36 && dh < -14) slabs[k * 2 + (P.r[i]! > 0 ? 1 : 0)]!.add(Math.floor(dh));
        // Anchorage roofs: the middle, well under the deck.
        if (ar < 9 && dh > -45 && dh < -16) roofs[k]!.push(P.h[i]!);
    }
    const toS = ([a, b]: [number, number]): [number, number] => [r2(S0 + a / 2), r2(S0 + (b + 1) / 2)];
    const pylons = runs(shaft, 40, 2)
        .filter(([a, b]) => b - a >= 12)
        .map(toS);
    const pylonTops = pylons.map(([a, b]) => ({ s: (a + b) / 2, top: quant(tops.slice(Math.floor((a - S0) * 2), Math.floor((b - S0) * 2)).filter(Number.isFinite), 0.7) }));
    // A bin is a bent column when both sides are occupied over most of the 22 m under the truss.
    // (X-braced towers: pool 2 m of bins so the diagonals cover the whole height.)
    const pool = (k: number, sd: number) => {
        const u = new Set<number>();
        for (let q = Math.max(0, k - 2); q <= Math.min(nb - 1, k + 2); ++q) for (const v of slabs[q * 2 + sd]!) u.add(v);
        return u.size;
    };
    const under = Array.from({ length: nb }, (_, k) => Math.max(pool(k, 0), pool(k, 1)));
    const bents = runs(under, 19, 10)
        .filter(([a, b]) => b - a >= 2 && b - a <= 60)
        .map(toS);
    // South anchorage: the flat roof under the deck south of S2 (the backstay goes into it).
    const s2 = pylons.reduce((a, p) => (Math.abs((p[0] + p[1]) / 2 - 171) < Math.abs((a[0] + a[1]) / 2 - 171) ? p : a));
    const roofAt = (k: number) => quant(roofs[k]!, 0.9);
    const k2 = Math.floor((s2[0] - S0) * 2);
    const ref = median(Array.from({ length: 12 }, (_, q) => roofAt(k2 - 4 - q)).filter(Number.isFinite));
    let k = k2 - 4;
    while (k > 0 && Math.abs(roofAt(k - 1) - ref) < 2.5) --k;
    const south: [number, number] = [r2(S0 + k / 2), s2[0]];
    const southTop = ref;
    console.log(`pylons ${pylons.map(([a, b]) => `${a}..${b}`).join(' ')}`);
    console.log(`bents ${bents.map(([a, b]) => `${a}..${b}`).join(' ')}`);
    console.log(`south anchorage ${south[0]}..${south[1]} roof ${r2(southTop)}`);
    return { pylons, pylonTops, bents, southAnch: south, southAnchTop: southTop };
}

// ---- Fort Point arch. ----
function measureArch(P: Pts, a: number, b: number) {
    const nb = Math.ceil(b - a);
    const nh = 140;
    const rib: number[][] = Array.from({ length: nb }, () => new Array<number>(nh).fill(0));
    const mid: number[][] = Array.from({ length: nb }, () => new Array<number>(nh).fill(0));
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1 || P.s[i]! < a || P.s[i]! >= b) continue;
        const k = Math.floor(P.s[i]! - a);
        const j = Math.floor(P.h[i]! * 2);
        if (j < 0 || j >= nh) continue;
        const ar = Math.abs(P.r[i]!);
        if (ar > 10 && ar < 17) rib[k]![j]!++;
        else if (ar < 5) mid[k]![j]!++;
    }
    const S: number[] = [];
    const Y: number[] = [];
    const E: number[] = [];
    for (let k = 1; k < nb - 1; ++k) {
        const occ = (j: number) => rib[k]![j]! >= 3 && mid[k]![j]! <= rib[k]![j]! * 0.3;
        for (let j = 6; j < nh - 6; ++j) {
            if (!occ(j)) continue;
            // A rib is at least ~2 m thick.
            let c = 0;
            for (let q = j; q < j + 6; ++q) if (occ(q)) ++c;
            if (c < 4) continue;
            let top = j;
            while (top + 1 < nh && (occ(top + 1) || occ(top + 2))) ++top;
            S.push(a + k + 0.5);
            Y.push(j / 2);
            // Top chord: the most-hit cell between the intrados and the deck truss (the web is sparse).
            let e = -1;
            for (let q = j + 5; q < Math.min(nh, 104); ++q) if (occ(q) && (e < 0 || rib[k]![q]! > rib[k]![e]!)) e = q;
            E.push(e < 0 ? NaN : e / 2);
            break;
        }
    }
    // Robust fits (drop points > 2 m off, e.g. the fort's roofs or a spandrel post): a parabola and a
    // circular segment, both through the springings at the pylon faces, by spring / crown height.
    const L = b - a;
    const shapes = {
        parabola: (s: number, sp: number, cr: number) => {
            const t = (s - a) / L;
            return sp + (cr - sp) * 4 * t * (1 - t);
        },
        circle: (s: number, sp: number, cr: number) => {
            const f = cr - sp;
            const R = (f * f + (L / 2) ** 2) / (2 * f);
            return sp + Math.sqrt(Math.max(0, R * R - (s - a - L / 2) ** 2)) - (R - f);
        },
    };
    const fit = (fn: (s: number, sp: number, cr: number) => number) => {
        let best = { sp: 0, cr: 0, rms: Infinity, n: 0 };
        for (let sp = -5; sp <= 40; sp += 0.25)
            for (let cr = sp + 5; cr <= 60; cr += 0.25) {
                let q = 0;
                let n = 0;
                for (let i = 0; i < S.length; ++i) {
                    const d = Y[i]! - fn(S[i]!, sp, cr);
                    if (Math.abs(d) > 2) continue;
                    q += d * d;
                    ++n;
                }
                // Maximize the inliers first, then minimize their rms.
                const score = n - Math.sqrt(q / Math.max(1, n)) * 0.01;
                if (score > best.n - best.rms * 0.01 || !Number.isFinite(best.rms)) best = { sp, cr, rms: Math.sqrt(q / Math.max(1, n)), n };
            }
        return best;
    };
    const par = fit(shapes.parabola);
    const cir = fit(shapes.circle);
    // The top chord, fitted the same way (a parabola).
    const top = (() => {
        const ok = E.map((_, i) => i).filter((i) => Number.isFinite(E[i]!));
        let best = { sp: 0, cr: 0, n: -1, rms: 0 };
        for (let sp = 0; sp <= 50; sp += 0.25)
            for (let cr = sp; cr <= 60; cr += 0.25) {
                let q = 0;
                let n = 0;
                for (const i of ok) {
                    const d = E[i]! - shapes.parabola(S[i]!, sp, cr);
                    if (Math.abs(d) > 1.5) continue;
                    q += d * d;
                    ++n;
                }
                if (n > best.n) best = { sp, cr, n, rms: Math.sqrt(q / Math.max(1, n)) };
            }
        return best;
    })();
    const spring = cir.sp;
    const crown = cir.cr;
    const rmsParabola = par.rms;
    const rmsShape = cir.rms;
    const crownRib = top.cr - par.cr;
    console.log(`arch ${r1(a)}..${r1(b)}: circle spring ${r2(spring)} crown ${r2(crown)} rms ${r2(rmsShape)} (${cir.n}/${S.length}); parabola ${r2(par.sp)} / ${r2(par.cr)} rms ${r2(par.rms)} (${par.n}); top chord ${r2(top.sp)} / ${r2(top.cr)} rms ${r2(top.rms)} (${top.n})`);
    return { a, b, spring, crown, parabola: { spring: par.sp, crown: par.cr, inliers: par.n }, topChord: { spring: top.sp, crown: top.cr, inliers: top.n, rms: top.rms }, inliers: cir.n, samples: S.length, rib: crownRib, rmsParabola, shapeName: 'circular segment', rmsShape, intrados: S.map((s, i) => [r1(s), r2(Y[i]!), r2(E[i]!)]) };
}

// ---- Main cables. ----
type CableSide = { lat: number; bins: [number, number][]; saddle: [number, number]; low: number; lowS: number; atS1: number; atN1: number; spans: { name: string; mean: number; max: number; meanM: number; maxM: number; rms: number }[] };

function measureCables(P: Pts, road: (s: number) => number, tc: number[], py: [[number, number], [number, number]], measuredDeck: readonly CenterlinePoint[], courseDeck: readonly CenterlinePoint[]) {
    const s1c = (py[0][0] + py[0][1]) / 2;
    const n1c = (py[1][0] + py[1][1]) / 2;
    // Lateral position: the points high above the main span.
    const hi: number[][] = [[], []];
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1 || P.s[i]! < tc[0]! + 40 || P.s[i]! > tc[1]! - 40 || P.h[i]! < road(P.s[i]!) + 40) continue;
        hi[P.r[i]! > 0 ? 1 : 0]!.push(P.r[i]!);
    }
    const lat = hi.map((a) => median(a));
    const BIN = 5;
    const side: CableSide[] = [];
    const binsAll: Map<number, number[]>[] = [new Map(), new Map()];
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1) continue;
        const s = P.s[i]!;
        if (s < py[0][1] || s > py[1][0]) continue;
        if (Math.abs(s - tc[0]!) < 12 || Math.abs(s - tc[1]!) < 12) continue;
        const sd = P.r[i]! > 0 ? 1 : 0;
        if (Math.abs(P.r[i]! - lat[sd]!) > 1.6) continue;
        if (P.h[i]! < road(s) + 1.8) continue;
        const k = Math.floor(s / BIN);
        const m = binsAll[sd]!;
        (m.get(k) ?? m.set(k, []).get(k)!).push(P.h[i]!);
    }
    for (const sd of [0, 1]) {
        const sg = sd ? 1 : -1;
        const bins: [number, number][] = [];
        for (const [k, hs] of [...binsAll[sd]!].sort((x, y) => x[0] - y[0])) {
            hs.sort((x, y) => y - x);
            // Top of the cable: the highest height with >= 3 points within 0.3 m under it.
            let top = NaN;
            for (let j = 0; j + 2 < hs.length; ++j)
                if (hs[j]! - hs[j + 2]! < 0.3) {
                    top = hs[j]!;
                    break;
                }
            if (Number.isFinite(top)) bins.push([(k + 0.5) * BIN, top - CABLE_R]);
        }
        const inSpan = (a: number, b: number) => bins.filter(([s]) => s > a && s < b);
        const fitSpan = (a: number, b: number) => {
            const pts = inSpan(a, b);
            const c = polyfit(
                pts.map(([s]) => s),
                pts.map(([, y]) => y),
                2,
            );
            // Iterate once without outliers (lamps, birds, the tower walkways).
            const keep = pts.filter(([s, y]) => Math.abs(y - poly(c, s)) < 1.2);
            const c2 = polyfit(
                keep.map(([s]) => s),
                keep.map(([, y]) => y),
                2,
            );
            const rms = Math.sqrt(keep.reduce((q, [s, y]) => q + (y - poly(c2, s)) ** 2, 0) / keep.length);
            return { c: c2, rms, pts: keep };
        };
        const main = fitSpan(tc[0]! + 15, tc[1]! - 15);
        const sideS = fitSpan(py[0][1] + 3, tc[0]! - 15);
        const sideN = fitSpan(tc[1]! + 15, py[1][0] - 3);
        const lowS = -main.c[1]! / (2 * main.c[2]!);
        // Model errors over the model's own spans (its S1 is not at the real one), with the course's
        // deck as built and with the measured deck (the cable's mid / end heights ride on the deck).
        const modelSpans: [string, ReturnType<typeof fitSpan>, number, number][] = [
            ['main span', main, S_SF / M, S_MARIN / M],
            ['SF side span', sideS, LY.S1[1] / M, S_SF / M],
            ['Marin side span', sideN, S_MARIN / M, LY.N1[0] / M],
        ];
        const spanErr = (deck: readonly CenterlinePoint[]) => {
            useCourseCenterline(deck);
            const spec = LY.cableSpec(REAL_TOP_M, sg);
            return modelSpans.map(([, ff, a, b]) => ff.pts.filter(([s]) => s > a + 12 && s < b - 12).map(([s, y]) => my(LY.cableY(spec, s * M)) - y));
        };
        const eM = spanErr(measuredDeck);
        const eC = spanErr(courseDeck);
        const mean = (e: number[]) => e.reduce((q, v) => q + v, 0) / Math.max(1, e.length);
        const mx = (e: number[]) => Math.max(0, ...e.map(Math.abs));
        const spans = modelSpans.map(([name, ff], j) => ({ name, mean: mean(eC[j]!), max: mx(eC[j]!), meanM: mean(eM[j]!), maxM: mx(eM[j]!), rms: ff.rms }));
        side.push({
            lat: lat[sd]!,
            bins: bins.map(([s, y]) => [r1(s), r2(y)]),
            saddle: [(poly(main.c, tc[0]!) + poly(sideS.c, tc[0]!)) / 2, (poly(main.c, tc[1]!) + poly(sideN.c, tc[1]!)) / 2],
            low: poly(main.c, lowS),
            lowS,
            atS1: poly(sideS.c, s1c),
            atN1: poly(sideN.c, n1c),
            spans,
        });
        const sdd = side[side.length - 1]!;
        console.log(`cable ${sg > 0 ? 'E' : 'W'} lat ${r2(sdd.lat)} saddles ${r2(sdd.saddle[0])} ${r2(sdd.saddle[1])} low ${r2(sdd.low)} @${r1(lowS)} S1 ${r2(sdd.atS1)} N1 ${r2(sdd.atN1)} rms ${spans.map((q) => r2(q.rms)).join('/')}`);
    }
    // Backstay: from S1 down through the arch to the south anchorage (a straight line).
    const sS1 = py[0][0];
    let c = [0, 0];
    {
        const y1 = (side[0]!.atS1 + side[1]!.atS1) / 2;
        const slope = (y1 - 30) / (sS1 - 170);
        c = [y1 - slope * sS1, slope];
    }
    let used: [number, number][] = [];
    for (const tol of [3, 2, 1.2, 0.8, 0.8]) {
        used = [];
        for (let i = 0; i < P.n; ++i) {
            if (P.c[i] !== 1) continue;
            const s = P.s[i]!;
            if (s < 150 || s > sS1 - 1) continue;
            const sd = P.r[i]! > 0 ? 1 : 0;
            if (Math.abs(P.r[i]! - side[sd]!.lat) > 1.6) continue;
            if (Math.abs(P.h[i]! - poly(c, s)) < tol) used.push([s, P.h[i]!]);
        }
        c = polyfit(
            used.map(([s]) => s),
            used.map(([, h]) => h),
            1,
        );
    }
    const rms = Math.sqrt(used.reduce((q, [s, h]) => q + (h - poly(c, s)) ** 2, 0) / used.length);
    // The fitted line runs through the cable's middle (points all around it).
    const backstay = { slope: c[1]!, c0: c[0]!, n: used.length, rms, at: (s: number) => poly(c, s) };
    console.log(`backstay slope ${r2(c[1]!)} at S1 face ${r2(backstay.at(sS1))} (${used.length} pts, rms ${r2(rms)})`);
    return { side, backstay, lat };
}

// ---- Stiffening truss (main span, in the cable planes). ----
function measureTruss(P: Pts, road: (s: number) => number, tc: number[], lat: number[]) {
    const hist = new Array<number>(80).fill(0);
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1 && P.c[i] !== 17) continue;
        const s = P.s[i]!;
        if (s < tc[0]! + 40 || s > tc[1]! - 40) continue;
        if (Math.abs(P.r[i]! - lat[P.r[i]! > 0 ? 1 : 0]!) > 1.2) continue;
        const k = Math.floor((P.h[i]! - road(s) + 16) * 4);
        if (k >= 0 && k < hist.length) hist[k]!++;
    }
    const peak = (a: number, b: number) => {
        let best = Math.floor((a + 16) * 4);
        for (let k = best; k < Math.floor((b + 16) * 4); ++k) if (hist[k]! > hist[best]!) best = k;
        return best / 4 - 16 + 0.125;
    };
    const chord = peak(-10.5, -7.5);
    const lowest = peak(-13.5, -10.5);
    // Top chord: the first surface over 1 m under the road (the sidewalk / curb are at the road level).
    const top = peak(-4, -1);
    console.log(`truss: bottom chord top ${r2(chord)}, lowest ${r2(lowest)}, top ${r2(top)} (m from the road)`);
    return { chord: -chord, lowest: -lowest, top: -top };
}

// ---- Suspenders. ----
function measureSuspenders(P: Pts, cab: ReturnType<typeof measureCables>, tc: number[], ends: [number, number]) {
    const S0 = 250;
    const S1 = 2300;
    const nb = (S1 - S0) * 4;
    const hist = new Array<number>(nb).fill(0);
    const cableAt = (s: number, sd: number) => interp(
        cab.side[sd]!.bins.map(([x]) => x),
        cab.side[sd]!.bins.map(([, y]) => y),
        s,
    );
    for (let i = 0; i < P.n; ++i) {
        if (P.c[i] !== 1) continue;
        const s = P.s[i]!;
        if (s < S0 || s >= S1 || Math.abs(s - tc[0]!) < 12 || Math.abs(s - tc[1]!) < 12) continue;
        const sd = P.r[i]! > 0 ? 1 : 0;
        if (Math.abs(P.r[i]! - cab.lat[sd]!) > 1.6) continue;
        const cy = cableAt(s, sd);
        if (P.h[i]! > cy - 3 || P.h[i]! < cy - 30) continue;
        hist[Math.floor((s - S0) * 4)]!++;
    }
    // Peaks: local maxima of the 1 m smoothed histogram, at least 8 m apart (thresholds per span:
    // the side-span ropes are shorter and get fewer returns).
    const sm = hist.map((_, k) => hist.slice(Math.max(0, k - 2), k + 3).reduce((q, v) => q + v, 0));
    const spans: [number, number][] = [
        [ends[0], tc[0]!],
        [tc[0]!, tc[1]!],
        [tc[1]!, ends[1]],
    ];
    const peaks: number[] = [];
    for (const [a, b] of spans) {
        const k0 = Math.max(1, Math.floor((a - S0) * 4));
        const k1 = Math.min(sm.length - 1, Math.floor((b - S0) * 4));
        const thr = quant(sm.slice(k0, k1).filter((v) => v > 0), 0.9) * 0.2;
        const start = peaks.length;
        for (let k = k0; k < k1; ++k) {
            if (sm[k]! < thr || sm[k]! < sm[k - 1]! || sm[k]! < sm[k + 1]!) continue;
            const s = S0 + (k + 0.5) / 4;
            if (peaks.length > start && s - peaks[peaks.length - 1]! < 8) {
                if (sm[k]! > sm[Math.floor((peaks[peaks.length - 1]! - S0) * 4)]!) peaks[peaks.length - 1] = s;
                continue;
            }
            peaks.push(s);
        }
    }
    const diffs = peaks.slice(1).map((s, i) => s - peaks[i]!).filter((d) => d > 12 && d < 18);
    const spacing = median(diffs);
    const main = peaks.filter((s) => s > tc[0]! && s < tc[1]!);
    const phase = median(peaks.map((s) => {
        const t = s < (tc[0]! + tc[1]!) / 2 ? tc[0]! : tc[1]!;
        const q = (s - t) / spacing;
        return (q - Math.round(q)) * spacing;
    }));
    console.log(`suspenders: ${peaks.length} (main ${main.length}), spacing ${r2(spacing)}, phase ${r2(phase)}, first ${r2(main[0]! - tc[0]!)} / ${r2(tc[1]! - main[main.length - 1]!)}`);
    return {
        spacing,
        phase,
        firstMain: [main[0]! - tc[0]!, tc[1]! - main[main.length - 1]!] as [number, number],
        countMain: main.length,
        countSide: [peaks.filter((s) => s < tc[0]!).length, peaks.filter((s) => s > tc[1]!).length] as [number, number],
        stations: peaks.map(r2),
    };
}

// ---- Deck knots for tools/sf/bakeTrack.ts deck(). ----
/** Same interpolation as tools/course/lib/course.ts makeProfile (periodic monotone cubic). */
function makeProfile(knots: { S: number; y: number }[], L: number): (S: number) => number {
    const k = [...knots].sort((a, b) => a.S - b.S);
    const n = k.length;
    const h = (i: number) => {
        const a = k[i % n]!.S;
        const b = k[(i + 1) % n]!.S;
        return i + 1 >= n ? b + L - a : b - a;
    };
    const d = (i: number) => (k[(i + 1) % n]!.y - k[i % n]!.y) / h(i);
    const m = k.map((_, i) => {
        const i0 = (i - 1 + n) % n;
        const d0 = d(i0);
        const d1 = d(i);
        if (d0 * d1 <= 0) return 0;
        const h0 = h(i0);
        const h1 = h(i);
        return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    });
    return (S: number) => {
        S = ((S % L) + L) % L;
        let i = n - 1;
        for (let j = 0; j < n; ++j) if (k[j]!.S <= S) i = j;
        let x = S - k[i]!.S;
        if (x < 0) x += L;
        const hi = h(i);
        const t = x / hi;
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * k[i]!.y + (t3 - 2 * t2 + t) * hi * m[i]! + (-2 * t3 + 3 * t2) * k[(i + 1) % n]!.y + (t3 - t2) * hi * m[(i + 1) % n]!;
    };
}

type SegKnots = {
    seg: 'bridge_nb' | 'bridge_sb';
    /** bakeTrack.ts deck() stations (fraction a / 2330 of the section, reversed for bridge_sb) and heights. */
    along: number[];
    heights: number[];
    /** Where each knot lands on the bridge (s, l in meters on the model axis). */
    at: { s: number; l: number }[];
    maxErr: number;
    rmsErr: number;
    currentMaxErr: number;
    currentRmsErr: number;
    /** Heights at the current five stations only (no extra knots). */
    fiveHeights: number[];
    fiveMaxErr: number;
};
type Knots = { segs: SegKnots[]; emulationCheck: number };

function fitKnots(meta: { centerline: (CenterlinePoint & { s: number })[]; segments: Record<string, [number, number]> }, measured: (s: number, sg: number) => number): Knots {
    const path = JSON.parse(readFileSync(join(ROOT, 'tools/course/tracks/golden_gate.path.json'), 'utf8')) as { profile: { seg: string; at: number; y: number }[] };
    const L = Math.max(...Object.values(meta.segments).map((r) => r[1]));
    const cl = [...meta.centerline].sort((a, b) => a.s - b.s);
    const clS = cl.map((p) => p.s);
    // Course S → bridge (s, l) in meters.
    const where = (S: number) => {
        const x = interp(clS, cl.map((p) => p.pos[0]!), S);
        const z = interp(clS, cl.map((p) => p.pos[2]!), S);
        const a = toAxis(x, z);
        return { s: a.s / M, l: a.l / M };
    };
    const FIVE = [0, 625, 1270, 1910, 2330];
    const CUR = [62, 69, 76, 69, 64];
    const knotS = (seg: 'bridge_nb' | 'bridge_sb', a: number) => {
        const r = meta.segments[seg]!;
        const fr = seg === 'bridge_nb' ? a / 2330 : 1 - a / 2330;
        return r[0] + Math.round((r[1] - r[0]) * Math.min(0.999, fr));
    };
    const alongOf = (seg: 'bridge_nb' | 'bridge_sb', S: number) => {
        const r = meta.segments[seg]!;
        const fr = (S - r[0]) / (r[1] - r[0]);
        return (seg === 'bridge_nb' ? fr : 1 - fr) * 2330;
    };
    type K = { seg: string; a: number; y: number };
    const build = (ks: K[]) =>
        makeProfile(
            [
                ...path.profile.filter((k) => !ks.some((q) => q.seg === k.seg)).map((k) => ({ S: meta.segments[k.seg]![0] + k.at, y: k.y })),
                ...ks.map((k) => ({ S: knotS(k.seg as 'bridge_nb', k.a), y: SEA_Y + k.y * M })),
            ],
            L,
        );
    const current = (seg: string) => FIVE.map((a, j) => ({ seg, a, y: CUR[j]! }));
    // Check the emulation against the baked centerline (median, so the jump ramps don't count).
    const all5 = build([...current('bridge_nb'), ...current('bridge_sb')]);
    const byS = (S: number) => interp(clS, cl.map((p) => p.pos[1]!), S);
    const chk: number[] = [];
    for (const seg of ['bridge_nb', 'bridge_sb']) for (let S = meta.segments[seg]![0]; S < meta.segments[seg]![1]; S += 600) chk.push(Math.abs(my(all5(S)) - my(byS(S))));
    const emulationCheck = r2(median(chk));
    const segs: SegKnots[] = [];
    for (const seg of ['bridge_nb', 'bridge_sb'] as const) {
        const sg = seg === 'bridge_nb' ? 1 : -1;
        // Samples: the parallel part of this carriageway, every 5 m.
        const samples: { S: number; s: number }[] = [];
        const [a0, a1] = meta.segments[seg]!;
        for (let S = a0; S < a1; S += 300) {
            const w = where(S);
            if (Math.abs(Math.abs(w.l) - BRIDGE.carriageway) > 3 || w.s < 20 || w.s > LEN / M - 20) continue;
            samples.push({ S, s: w.s });
        }
        const other = current(seg === 'bridge_nb' ? 'bridge_sb' : 'bridge_nb');
        const err = (ks: K[]) => {
            const f = build([...ks, ...other]);
            return samples.map((q) => ({ q, e: my(f(q.S)) - measured(q.s, sg) })).filter((x) => Number.isFinite(x.e));
        };
        const stats = (e: { e: number }[]) => ({ max: Math.max(...e.map((x) => Math.abs(x.e))), rms: Math.sqrt(e.reduce((q, x) => q + x.e * x.e, 0) / e.length) });
        // Knot height = the measured road at the knot's own station (clamped to the measured range).
        const heightAt = (a: number) => Math.round(measured(where(knotS(seg, a)).s, sg) * 10) / 10;
        const five = FIVE.map((a) => ({ seg, a, y: heightAt(a) }));
        let ks: K[] = five.map((k) => ({ ...k }));
        for (let it = 0; it < 24; ++it) {
            const e = err(ks);
            const worst = e.reduce((a, b) => (Math.abs(b.e) > Math.abs(a.e) ? b : a));
            if (Math.abs(worst.e) <= 0.25) break;
            const a = Math.round(alongOf(seg, worst.q.S) / 5) * 5;
            const near = ks.reduce((bi, k, i) => (Math.abs(k.a - a) < Math.abs(ks[bi]!.a - a) ? i : bi), 0);
            if (Math.abs(ks[near]!.a - a) < 25) ks[near]!.y = Math.round((ks[near]!.y - worst.e * 0.8) * 10) / 10;
            else ks = [...ks, { seg, a, y: heightAt(a) }].sort((x, y) => x.a - y.a);
        }
        const fin = stats(err(ks));
        const cur = stats(err(current(seg)));
        const fv = stats(err(five));
        segs.push({
            seg,
            along: ks.map((k) => k.a),
            heights: ks.map((k) => k.y),
            at: ks.map((k) => {
                const w = where(knotS(seg, k.a));
                return { s: r1(w.s), l: r1(w.l) };
            }),
            maxErr: r2(fin.max),
            rmsErr: r2(fin.rms),
            currentMaxErr: r2(cur.max),
            currentRmsErr: r2(cur.rms),
            fiveHeights: five.map((k) => k.y),
            fiveMaxErr: r2(fv.max),
        });
        const q = segs[segs.length - 1]!;
        console.log(`${seg} knots: along ${JSON.stringify(q.along)} ys ${JSON.stringify(q.heights)} max ${q.maxErr} rms ${q.rmsErr} (current ${q.currentMaxErr}; 5 knots ${JSON.stringify(q.fiveHeights)} max ${q.fiveMaxErr})`);
    }
    return { segs, emulationCheck };
}

// ---- Side view PNG. ----
function sideview(P: Pts, road: { s: number; mid: number }[], cab: ReturnType<typeof measureCables>, towers: Tower[]) {
    const s0 = -120;
    const s1 = LEN / M + 150;
    const SX = 1;
    const SY = 2;
    const hTop = 250;
    const hBot = -8;
    const W = Math.ceil((s1 - s0) * SX);
    const H = Math.ceil((hTop - hBot) * SY);
    const img = Buffer.alloc(W * H * 3, 255);
    const put = (x: number, y: number, c: [number, number, number], a = 1) => {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const k = (y * W + x) * 3;
        for (let j = 0; j < 3; ++j) img[k + j] = Math.round(img[k + j]! * (1 - a) + c[j]! * a);
    };
    const X = (s: number) => (s - s0) * SX;
    const Y = (h: number) => (hTop - h) * SY;
    // Grid: 50 m along, 10 m up.
    for (let s = Math.ceil(s0 / 50) * 50; s < s1; s += 50) for (let y = 0; y < H; ++y) put(X(s), y, [215, 222, 235]);
    for (let h = 0; h < hTop; h += 10) for (let x = 0; x < W; ++x) put(x, Y(h), h === 0 ? [120, 150, 220] : [225, 230, 238]);
    // Lidar: |r| < 25 (the bridge, not the hillsides).
    for (let i = 0; i < P.n; ++i) {
        if (Math.abs(P.r[i]!) > 25 || P.c[i] === 9) continue;
        const c: [number, number, number] = P.c[i] === 17 ? [235, 140, 120] : P.c[i] === 2 ? [190, 170, 140] : [150, 150, 150];
        put(X(P.s[i]!), Y(P.h[i]!), c, 0.35);
    }
    const line = (f: (s: number) => number, a: number, b: number, c: [number, number, number], step = 0.25) => {
        for (let s = a; s <= b; s += step) {
            const y0 = Y(f(s));
            const y1 = Y(f(s + step));
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 0.01; y += 0.5) put(X(s), y, c);
        }
    };
    const vline = (s: number, h0: number, h1: number, c: [number, number, number]) => {
        for (let y = Y(h1); y <= Y(h0); y += 0.5) put(X(s), y, c);
    };
    const blue: [number, number, number] = [30, 80, 220];
    const green: [number, number, number] = [0, 150, 60];
    const mag: [number, number, number] = [200, 0, 160];
    const orange: [number, number, number] = [230, 110, 0];
    // Model: course deck (both carriageways), cables, towers, pylons, arch.
    line((s) => my(deckY(s * M, BRIDGE.carriageway * M)), 0, LEN / M, blue);
    line((s) => my(deckY(s * M, -BRIDGE.carriageway * M)), 0, LEN / M, blue);
    line((s) => interp(road.map((q) => q.s), road.map((q) => q.mid), s), s0, s1, green);
    for (const sg of [-1, 1]) line((s) => my(LY.cableY(LY.cableSpec(REAL_TOP_M, sg), s * M)), LY.S2[0] / M + 10, (LY.N1[0] + LY.N1[1]) / 2 / M, mag);
    for (const S of [S_SF, S_MARIN]) {
        const deck = my(deckTop(S));
        const top = REAL_TOP_M;
        const H = top - deck;
        const D = LY.LEG_SECTIONS[0]!.D;
        for (const u of [-D / 2, D / 2]) vline(S / M + u, 12, top, orange);
        line(() => top, S / M - D / 2, S / M + D / 2, orange);
        for (const [a, b] of LY.STRUTS) {
            line(() => deck + a * H, S / M - D / 2, S / M + D / 2, orange);
            line(() => deck + b * H, S / M - D / 2, S / M + D / 2, orange);
        }
    }
    for (const [a, b] of [LY.S2, LY.S1, LY.N1]) {
        const top = my(deckTop((a + b) / 2)) + 9;
        vline(a / M, 0, top, orange);
        vline(b / M, 0, top, orange);
        line(() => top, a / M, b / M, orange);
    }
    line((s) => my(LY.archY(s * M)), LY.ARCH[0] / M, LY.ARCH[1] / M, orange);
    line((s) => my(LY.archY(s * M, ...LY.ARCH_TOP_CHORD)), LY.ARCH[0] / M, LY.ARCH[1] / M, orange);
    for (const s of LY.VIADUCT_BENTS) vline(s / M, 0, my(deckTop(s)) - 12, orange);
    // Measured tower centers.
    for (const t of towers) vline(t.s, t.top, t.max, [0, 0, 0]);
    void cab;
    execFileSync('magick', ['-size', `${W}x${H}`, '-depth', '8', 'rgb:-', join(OUT, 'sideview.png')], { input: img });
}

// ---- Debug overlay points for the viewer. ----
/**
 * 'GGLD', u32 count, f32 datum (NAVD88 m of our sea level), f32 decimeters per unit (0.1), then
 * Int16 [e, n, h] in decimeters (course meters east / north, height above our sea level) * count,
 * Uint8 class * count. Thinned on a voxel grid to stay under ~3 MB.
 */
function writeDebug(P: Pts) {
    for (const vox of [0.5, 0.7, 0.9, 1.2, 1.6]) {
        const seen = new Set<number>();
        const keep: number[] = [];
        for (let i = 0; i < P.n; ++i) {
            if (P.c[i] !== 1 && P.c[i] !== 17) continue;
            if (Math.abs(P.r[i]!) > 40) continue;
            const key = (Math.floor((P.e[i]! + 2000) / vox) * 8192 + Math.floor((P.nn[i]! + 1000) / vox)) * 1024 + Math.floor((P.h[i]! + 20) / vox);
            if (seen.has(key)) continue;
            seen.add(key);
            keep.push(i);
        }
        const bytes = 16 + keep.length * 7;
        if (bytes > 2.9e6) continue;
        const buf = Buffer.alloc(bytes);
        buf.write('GGLD', 0, 'ascii');
        buf.writeUInt32LE(keep.length, 4);
        buf.writeFloatLE(DATUM, 8);
        buf.writeFloatLE(0.1, 12);
        const q = new Int16Array(buf.buffer, buf.byteOffset + 16, keep.length * 3);
        keep.forEach((i, j) => {
            q[j * 3] = Math.round(P.e[i]! * 10);
            q[j * 3 + 1] = Math.round(P.nn[i]! * 10);
            q[j * 3 + 2] = Math.round(P.h[i]! * 10);
            buf[16 + keep.length * 6 + j] = P.c[i]!;
        });
        mkdirSync(dirname(DEBUG_BIN), { recursive: true });
        writeFileSync(DEBUG_BIN, buf);
        console.log(`wrote ${DEBUG_BIN}: ${keep.length} points (${vox} m voxels), ${(bytes / 1e6).toFixed(2)} MB`);
        return;
    }
}

// ---- Markdown summary. ----
function markdown(items: Item[], k: Knots, datum: { assumed: number; lidarWaterNavd88: { median: number } }, road: { s: number; mid: number; west: number; east: number; courseNB: number; courseSB: number }[]): string {
    const L: string[] = [];
    L.push('# Golden Gate Bridge: model vs USGS 3DEP 2023 lidar', '');
    L.push(`Generated by tools/sf/bridgeFit.ts. Heights in meters above our sea level = NAVD88 − ${datum.assumed} (MSL at NOAA 9414290). Along s / lateral l in meters on the model axis (bridgeParts/frame.ts); error = model − measured.`, '');
    L.push(`Datum check: lidar water returns median ${datum.lidarWaterNavd88.median} m NAVD88; the tide gauge read ${GAUGE.navd88.join('..')} m NAVD88 during the flight (${GAUGE.time}).`, '');
    L.push('## Recommended deck knots (tools/sf/bakeTrack.ts deck())', '');
    L.push("The same `along` array lands at different bridge stations on the two carriageways (the sections start / end at different places), so each carriageway gets its own list:", '');
    L.push('```ts');
    for (const q of k.segs) L.push(`// ${q.seg}: max |err| ${q.maxErr} m, rms ${q.rmsErr} m (current knots: max ${q.currentMaxErr}, rms ${q.currentRmsErr})`, `const along = ${JSON.stringify(q.along)};`, `const ys = ${JSON.stringify(q.heights)};`);
    L.push('```', '');
    for (const q of k.segs) L.push(`- ${q.seg}: the five current stations alone: ys = ${JSON.stringify(q.fiveHeights)} (max |err| ${q.fiveMaxErr} m). Knots land at s = ${q.at.map((w) => w.s).join(', ')} m.`);
    L.push('', `Errors are over the parallel part of each carriageway (course emulation of tools/course/lib/course.ts makeProfile; check vs the baked centerline: ${k.emulationCheck} m median). The stations depend on the course's section lengths: rerun this tool after a route change.`, '');
    L.push('## Measured road surface (m above sea level; s = meters along the model axis)', '', '| s | center | west half | east half | course SB | course NB |', '|---:|---:|---:|---:|---:|---:|');
    for (const q of road) if (Math.round(q.s - 5) % 50 === 0) L.push(`| ${q.s - 5} | ${q.mid} | ${q.west} | ${q.east} | ${q.courseSB} | ${q.courseNB} |`);
    L.push('');
    let g = '';
    for (const it of items) {
        if (it.group !== g) {
            g = it.group;
            L.push(`## ${g}`, '', '| item | model | measured | error | note |', '|---|---:|---:|---:|---|');
        }
        const flag = it.error !== null && it.unit === 'm' && Math.abs(it.error) > 0.5 ? ' **' : '';
        L.push(`| ${it.name} | ${it.model ?? '–'} | ${it.measured} | ${it.error === null ? '–' : it.error + flag}${it.unit !== 'm' ? ` ${it.unit}` : ''} | ${it.note ?? ''} |`);
    }
    L.push('');
    return L.join('\n');
}

void DECK_PROFILE;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
