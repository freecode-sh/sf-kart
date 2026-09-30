/**
 * Bakes the course chart the menus draw (src/app/ui/chart.ts) into
 * public/data/courses/golden_gate/chart.json: the lap and its surroundings as SVG path data.
 *
 *   route    the lap (the course centreline, simplified), closed
 *   start    the start line
 *   mark     the lap again, normalised into a 100 x 100 box: the SF Kart logo's symbol
 *   land     the land above sea level, filled (from the terrain: the 0 m contour, closed)
 *   coast    the coastline (0 m), stroked
 *   streets  OSM roads (paths dropped): major (8 m and wider) and minor
 *   frame    the lap's extent, padded: [x0, y0, x1, y1]
 *
 * Coordinates are metres, x = east, y = south (world x / SCALE, world z / SCALE), so the chart and
 * the course share an origin.
 *
 * Usage: npx tsx tools/sf/bakeChart.ts    (after bakeWorld.ts and build.ts golden_gate)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE } from './geo';

type Pt = [number, number];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = `${ROOT}/public/data`;
const OUT = `${DATA}/courses/golden_gate/chart.json`;
const SEA = 600;

interface Meta {
    start: { s: number };
    centerline: { s: number; pos: [number, number, number] }[];
}
interface World {
    terrain: { levels: number[]; steps: number[]; cell: number; e0: number; n1: number; cx: number; cz: number };
    far: { file: string; e0: number; n1: number; step: number; nx: number; nz: number };
    streets: { kind: number; w: number; pts: number[] }[];
}
const meta = JSON.parse(readFileSync(`${DATA}/courses/golden_gate/course_meta.json`, 'utf8')) as Meta;
const world = JSON.parse(readFileSync(`${DATA}/sf/world.json`, 'utf8')) as World;

// ---- Geometry ----

const round = (v: number) => Math.round(v);
const toD = (pts: Pt[], close = false) => 'M' + pts.map(([x, y]) => `${round(x)} ${round(y)}`).join('L') + (close ? 'Z' : '');
const length = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) : 0), 0);

/** Douglas-Peucker simplification (a closed loop is split at its farthest point first). */
function simplify(pts: Pt[], tol: number): Pt[] {
    if (pts.length < 3) return pts;
    const [fx, fy] = pts[0]!;
    const [lx, ly] = pts[pts.length - 1]!;
    if (Math.hypot(fx - lx, fy - ly) < 1e-6 && pts.length > 4) {
        let far = 1;
        let fd = 0;
        pts.forEach(([x, y], i) => {
            const d = Math.hypot(x - fx, y - fy);
            if (d > fd) [fd, far] = [d, i];
        });
        return [...simplify(pts.slice(0, far + 1), tol).slice(0, -1), ...simplify(pts.slice(far), tol)];
    }
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop()!;
        const [ax, ay] = pts[a]!;
        const [bx, by] = pts[b]!;
        const dx = bx - ax;
        const dy = by - ay;
        const L = Math.hypot(dx, dy) || 1;
        let best = -1;
        let bi = -1;
        for (let i = a + 1; i < b; ++i) {
            const d = Math.abs((pts[i]![0] - ax) * dy - (pts[i]![1] - ay) * dx) / L;
            if (d > best) [best, bi] = [d, i];
        }
        if (best > tol) {
            keep[bi] = 1;
            stack.push([a, bi], [bi, b]);
        }
    }
    return pts.filter((_, i) => keep[i]);
}

// ---- Terrain heights (metres above the sea), from the core cells and the far grid ----

const t = world.terrain;
const tb = readFileSync(`${DATA}/sf/terrain.bin`);
const terr = new Int16Array(tb.buffer, tb.byteOffset, tb.length / 2);
const cells: ({ h: Int16Array; st: number; m: number } | null)[] = [];
{
    let o = 0;
    for (const lv of t.levels) {
        if (lv === 255) {
            cells.push(null);
            continue;
        }
        const m = t.cell / t.steps[lv]! + 1;
        cells.push({ h: terr.subarray(o, o + m * m), st: t.steps[lv]!, m });
        o += m * m;
    }
}
const f = world.far;
const fb = readFileSync(`${DATA}/sf/${f.file}`);
const far = new Float32Array(fb.buffer, fb.byteOffset, fb.length / 4);
function farHeight(e: number, n: number): number {
    const fi = (e - f.e0) / f.step;
    const fj = (f.n1 - n) / f.step;
    const i = Math.max(0, Math.min(f.nx - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(f.nz - 2, Math.floor(fj)));
    const a = Math.max(0, Math.min(1, fi - i));
    const b = Math.max(0, Math.min(1, fj - j));
    const k = j * f.nx + i;
    const y = (far[k]! * (1 - a) + far[k + 1]! * a) * (1 - b) + (far[k + f.nx]! * (1 - a) + far[k + f.nx + 1]! * a) * b;
    return (y - SEA) / SCALE;
}
function height(e: number, n: number): number {
    const i = Math.floor((e - t.e0) / t.cell);
    const j = Math.floor((t.n1 - n) / t.cell);
    if (i < 0 || j < 0 || i >= t.cx || j >= t.cz) return farHeight(e, n);
    const c = cells[j * t.cx + i];
    if (!c) return -40; // deep water
    const fx = (e - (t.e0 + i * t.cell)) / c.st;
    const fy = (t.n1 - j * t.cell - n) / c.st;
    const a0 = Math.min(c.m - 2, Math.floor(fx));
    const b0 = Math.min(c.m - 2, Math.floor(fy));
    const a = fx - a0;
    const b = fy - b0;
    const k = b0 * c.m + a0;
    const h = c.h;
    const y = (h[k]! * (1 - a) + h[k + 1]! * a) * (1 - b) + (h[k + c.m]! * (1 - a) + h[k + c.m + 1]! * a) * b;
    return (y - SEA) / SCALE;
}

/** A height grid over the chart's area (12 m cells), blurred so the coast is smooth. */
const G = 12;
const E0 = -2600;
const N1 = 4600;
const NX = Math.floor(7800 / G) + 1;
const NZ = Math.floor(8200 / G) + 1;
const grid = new Float32Array(NX * NZ);
for (let j = 0; j < NZ; ++j) for (let i = 0; i < NX; ++i) grid[j * NX + i] = height(E0 + i * G + 0.01, N1 - j * G - 0.01);
function blur(src: Float32Array, r: number): Float32Array {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let j = 0; j < NZ; ++j)
        for (let i = 0; i < NX; ++i) {
            let s = 0;
            let c = 0;
            for (let k = -r; k <= r; ++k) if (i + k >= 0 && i + k < NX) (s += src[j * NX + i + k]!), c++;
            tmp[j * NX + i] = s / c;
        }
    for (let j = 0; j < NZ; ++j)
        for (let i = 0; i < NX; ++i) {
            let s = 0;
            let c = 0;
            for (let k = -r; k <= r; ++k) if (j + k >= 0 && j + k < NZ) (s += tmp[(j + k) * NX + i]!), c++;
            out[j * NX + i] = s / c;
        }
    return out;
}

/** Marching squares at `level`, chained into polylines (chart coordinates). */
function contour(g: Float32Array, level: number): Pt[][] {
    const segs: [Pt, Pt][] = [];
    const P = (i: number, j: number): Pt => [E0 + i * G, -(N1 - j * G)];
    const lerp = (i0: number, j0: number, i1: number, j1: number): Pt => {
        const a = g[j0 * NX + i0]!;
        const b = g[j1 * NX + i1]!;
        const k = (level - a) / (b - a);
        const [x0, y0] = P(i0, j0);
        const [x1, y1] = P(i1, j1);
        return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    };
    const up = (i: number, j: number) => g[j * NX + i]! > level;
    for (let j = 0; j < NZ - 1; ++j)
        for (let i = 0; i < NX - 1; ++i) {
            const c = (up(i, j) ? 8 : 0) | (up(i + 1, j) ? 4 : 0) | (up(i + 1, j + 1) ? 2 : 0) | (up(i, j + 1) ? 1 : 0);
            if (c === 0 || c === 15) continue;
            const T = () => lerp(i, j, i + 1, j);
            const R = () => lerp(i + 1, j, i + 1, j + 1);
            const B = () => lerp(i, j + 1, i + 1, j + 1);
            const L = () => lerp(i, j, i, j + 1);
            const cases: Record<number, (() => Pt)[][]> = {
                1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
                8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
            };
            for (const [a, b] of cases[c]!) segs.push([a!(), b!()]);
        }
    const key = ([x, y]: Pt) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
    const at = new Map<string, number[]>();
    segs.forEach((s, k) => {
        for (const p of s) {
            const q = key(p);
            if (!at.has(q)) at.set(q, []);
            at.get(q)!.push(k);
        }
    });
    const used = new Uint8Array(segs.length);
    const lines: Pt[][] = [];
    for (let k = 0; k < segs.length; ++k) {
        if (used[k]) continue;
        used[k] = 1;
        const line: Pt[] = [segs[k]![0], segs[k]![1]];
        for (const dir of [1, -1]) {
            for (;;) {
                const end = dir === 1 ? line[line.length - 1]! : line[0]!;
                const next = (at.get(key(end)) ?? []).find((n) => !used[n]);
                if (next === undefined) break;
                used[next] = 1;
                const [a, b] = segs[next]!;
                const p = key(a) === key(end) ? b : a;
                if (dir === 1) line.push(p);
                else line.unshift(p);
            }
        }
        lines.push(line);
    }
    return lines;
}

// ---- The lap ----

const lap: Pt[] = meta.centerline.map((c) => [c.pos[0] / SCALE, c.pos[2] / SCALE]);
const startAt = meta.centerline.find((c) => c.s >= meta.start.s) ?? meta.centerline[0]!;
const start: Pt = [round(startAt.pos[0] / SCALE), round(startAt.pos[2] / SCALE)];
const xs = lap.map((p) => p[0]);
const ys = lap.map((p) => p[1]);
const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
const PAD = 700;
const frame = [box[0] - PAD, box[1] - PAD, box[2] + PAD, box[3] + PAD];
const inFrame = ([x, y]: Pt, m = 0) => x > frame[0]! - m && x < frame[2]! + m && y > frame[1]! - m && y < frame[3]! + m;

/** The logo's symbol: the lap, simplified hard, in a 100 x 100 box. */
function mark(): string {
    const g = simplify(lap, 45);
    const gx = g.map((p) => p[0]);
    const gy = g.map((p) => p[1]);
    const x0 = Math.min(...gx);
    const y0 = Math.min(...gy);
    const w = Math.max(...gx) - x0;
    const h = Math.max(...gy) - y0;
    const sc = 100 / Math.max(w, h);
    const ox = (100 - w * sc) / 2;
    const oy = (100 - h * sc) / 2;
    return 'M' + g.map(([x, y]) => `${((x - x0) * sc + ox).toFixed(1)} ${((y - y0) * sc + oy).toFixed(1)}`).join('L') + 'Z';
}

// ---- Land and coast ----

const smooth = blur(grid, 1);
const coast = contour(smooth, 0.5)
    .filter((l) => length(l) > 120)
    .map((l) => simplify(l, 3));
// Land, filled: pad the grid with water so every coastline closes.
const padded = new Float32Array(smooth);
for (let j = 0; j < NZ; ++j) for (let i = 0; i < NX; ++i) if (i === 0 || j === 0 || i === NX - 1 || j === NZ - 1) padded[j * NX + i] = -40;
const land = contour(padded, 0.5)
    .filter((l) => length(l) > 200)
    .map((l) => toD(simplify(l, 3), true))
    .join('');

// ---- Streets ----

const major: string[] = [];
const minor: string[] = [];
for (const st of world.streets) {
    if (st.kind === 1) continue; // paths
    const pts: Pt[] = [];
    for (let k = 0; k < st.pts.length; k += 2) pts.push([st.pts[k]! / SCALE, st.pts[k + 1]! / SCALE]);
    if (!pts.some((p) => inFrame(p, 600))) continue;
    (st.w >= 8 ? major : minor).push(toD(simplify(pts, 2.5)));
}

const chart = {
    frame: frame.map(round),
    route: toD(simplify(lap, 1.2), true),
    start,
    mark: mark(),
    land,
    coast: coast.map((l) => toD(l)).join(''),
    streets: { major: major.join(''), minor: minor.join('') },
};
writeFileSync(OUT, JSON.stringify(chart));
console.log(`${OUT}: ${(JSON.stringify(chart).length / 1024).toFixed(0)} KB (streets ${major.length} major, ${minor.length} minor)`);
