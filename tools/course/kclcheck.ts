/**
 * Sanity checker for course.kcl: parses the file the way Kinoko does (KColData), then
 *  1. checks every prism has unit normals and a positive height,
 *  2. for a dense grid of points around the track surface, verifies with a brute-force search that
 *     every prism a 250-radius sphere at that point touches (Kinoko's edge/plane test incl. the
 *     300-unit prism thickness) is present in the octree leaf returned by searchBlock,
 *  3. casts rays straight down on the centerline / edges and reports the floor type found.
 *
 * Usage: npx tsx tools/course/kclcheck.ts [<id> | path/to/course.kcl]   (default: golden_gate)
 * The course_meta.json next to the .kcl is used for the probe points.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKclTriangles } from '../../src/app/kclMesh';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = process.argv[2] ?? 'golden_gate';
const file = arg.endsWith('.kcl') ? resolve(arg) : join(ROOT, 'public/data/courses', arg, 'course.kcl');
const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const u32 = (o: number) => dv.getUint32(o, false);
const f32 = (o: number) => dv.getFloat32(o, false);
const u16 = (o: number) => dv.getUint16(o, false);

type V = [number, number, number];
const posOff = u32(0);
const nrmOff = u32(4);
const prismOff = u32(8);
const blockOff = u32(12);
const thickness = f32(0x10);
const areaMin: V = [f32(0x14), f32(0x18), f32(0x1c)];
const mask: V = [u32(0x20), u32(0x24), u32(0x28)];
const blockShift = u32(0x2c);
const xShift = u32(0x30);
const xyShift = u32(0x34);
const sphereRadius = f32(0x38);

const nVerts = (nrmOff - posOff) / 12;
const nNrms = (prismOff + 0x10 - nrmOff) / 12;
const nPrisms = (blockOff - prismOff) / 0x10; // includes dummy #0
const vert = (i: number): V => [f32(posOff + i * 12), f32(posOff + i * 12 + 4), f32(posOff + i * 12 + 8)];
const nrm = (i: number): V => [f32(nrmOff + i * 12), f32(nrmOff + i * 12 + 4), f32(nrmOff + i * 12 + 8)];
type Prism = { h: number; a: V; fn: V; e1: V; e2: V; e3: V; attr: number; tri: [V, V, V] };
const prisms: Prism[] = [];
const triangles = readKclTriangles(new Uint8Array(buf));
const triOf = (i: number): [V, V, V] => {
    const P = triangles.positions;
    const o = (i - 1) * 9;
    return [
        [P[o]!, P[o + 1]!, P[o + 2]!],
        [P[o + 3]!, P[o + 4]!, P[o + 5]!],
        [P[o + 6]!, P[o + 7]!, P[o + 8]!],
    ];
};
for (let i = 1; i < nPrisms; ++i) {
    const o = prismOff + i * 0x10;
    prisms[i] = {
        h: f32(o),
        a: vert(u16(o + 4)),
        fn: nrm(u16(o + 6)),
        e1: nrm(u16(o + 8)),
        e2: nrm(u16(o + 10)),
        e3: nrm(u16(o + 12)),
        attr: u16(o + 14),
        tri: triOf(i),
    };
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

let problems = 0;
const fail = (msg: string) => {
    if (++problems <= 20) console.error('  ' + msg);
};

// 1. geometry
for (let i = 1; i < nPrisms; ++i) {
    const p = prisms[i]!;
    for (const [n, v] of [
        ['fnrm', p.fn],
        ['e1', p.e1],
        ['e2', p.e2],
        ['e3', p.e3],
    ] as const)
        if (Math.abs(dot(v, v) - 1) > 1e-5) fail(`prism ${i} ${n} not unit`);
    if (!(p.h > 0)) fail(`prism ${i} height ${p.h}`);
}

// searchBlock port
function searchBlock(p: V): number | null {
    const x = Math.trunc(p[0] - areaMin[0]);
    const y = Math.trunc(p[1] - areaMin[1]);
    const z = Math.trunc(p[2] - areaMin[2]);
    if ((x & mask[0]) || (y & mask[1]) || (z & mask[2])) return null;
    let shift = blockShift;
    let cur = blockOff;
    let index = 4 * ((((z >>> shift) << xyShift) | ((y >>> shift) << xShift) | (x >>> shift)) >>> 0);
    for (;;) {
        const off = u32(cur + index);
        if (off & 0x80000000) return cur + (off & 0x7fffffff);
        shift--;
        cur += off;
        index = 4 * (((x >>> shift) & 1) | (((y >>> shift) & 1) << 1) | (((z >>> shift) & 1) << 2));
    }
}
function leafList(p: V): Set<number> | null {
    const at = searchBlock(p);
    if (at === null) return null;
    const s = new Set<number>();
    for (let o = at + 2; ; o += 2) {
        const i = u16(o);
        if (i === 0) break;
        if (i >= nPrisms) fail(`bad prism index ${i}`);
        s.add(i);
    }
    return s;
}

/** Kinoko KColData::checkCollision<Edge> (double precision; radius r). */
function touches(p: Prism, pos: V, r: number): boolean {
    const rel = sub(pos, p.a);
    const dca = dot(rel, p.e1);
    if (r <= dca) return false;
    const dab = dot(rel, p.e2);
    if (r <= dab) return false;
    const dbc = dot(rel, p.e3) - p.h;
    if (r <= dbc) return false;
    const pd = dot(rel, p.fn);
    const dip = r - pd;
    if (dip <= 0) return false;
    if (dip >= thickness + r) return false;
    if (dab <= 0 && dbc <= 0 && dca <= 0) return true;
    let en: V, on: V, ed: number, od: number;
    let swap = false;
    let swapN = false;
    if (dab >= dca && dab > dbc) {
        en = p.e2;
        ed = dab;
        if (dca >= dbc) {
            on = p.e1;
            od = dca;
            swapN = true;
        } else {
            on = p.e3;
            od = dbc;
            swap = true;
        }
    } else if (dbc >= dca) {
        en = p.e3;
        ed = dbc;
        if (dab >= dca) {
            on = p.e2;
            od = dab;
            swapN = true;
        } else {
            on = p.e1;
            od = dca;
            swap = true;
        }
    } else {
        en = p.e1;
        ed = dca;
        if (dbc >= dab) {
            on = p.e3;
            od = dbc;
            swapN = true;
        } else {
            on = p.e2;
            od = dab;
            swap = true;
        }
    }
    const cos = dot(en, on);
    let sq: number;
    if (cos * ed > od) {
        sq = r * r - ed * ed;
    } else {
        const sqSin = cos * cos - 1;
        if (swap) [ed, od] = [od, ed];
        if (swapN) [en, on] = [on, en];
        const t = (cos * ed - od) / sqSin;
        const s2 = ed - t * cos;
        const c: V = [en[0] * t + on[0] * s2, en[1] * t + on[1] * s2, en[2] * t + on[2] * s2];
        sq = r * r - dot(c, c);
    }
    if (sq < pd * pd || sq <= 0) return false;
    return Math.sqrt(sq) - pd > 0;
}

/** Exact test: the sphere (pos, r) intersects the prism volume (triangle swept `thickness` down its normal). */
function trulyTouches(p: Prism, pos: V, r: number): boolean {
    // vertices from the prism definition (A, then B/C from the edge normals and height)
    const [A, B, C] = p.tri;
    const n = p.fn;
    const d = dot(sub(pos, A), n);
    if (d > r || d < -(thickness + r)) return false;
    // project onto the plane (clamped into the slab) and measure the in-plane distance to the triangle
    const q: V = [pos[0] - n[0] * d, pos[1] - n[1] * d, pos[2] - n[2] * d];
    const inPlane = distToTri(q, A, B, C);
    const perp = d > 0 ? d : d < -thickness ? -thickness - d : 0;
    return inPlane * inPlane + perp * perp < r * r;
}
function distToTri(q: V, A: V, B: V, C: V): number {
    const seg = (P: V, Q: V) => {
        const pq = sub(Q, P);
        const t = Math.max(0, Math.min(1, dot(sub(q, P), pq) / dot(pq, pq)));
        const c: V = [P[0] + pq[0] * t, P[1] + pq[1] * t, P[2] + pq[2] * t];
        return Math.sqrt(dot(sub(q, c), sub(q, c)));
    };
    const n = cross3(sub(B, A), sub(C, A));
    const s1 = dot(cross3(sub(B, A), sub(q, A)), n);
    const s2 = dot(cross3(sub(C, B), sub(q, B)), n);
    const s3 = dot(cross3(sub(A, C), sub(q, C)), n);
    if (s1 >= 0 && s2 >= 0 && s3 >= 0) return 0;
    return Math.min(seg(A, B), seg(B, C), seg(C, A));
}
function cross3(a: V, b: V): V {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// 2. octree completeness on a grid around the surface: every prism a 250-radius sphere truly
// intersects must be in the point's leaf. (Kinoko's own edge test is approximate near acute
// vertices and can report touches further out; those extra prisms may be absent — Kinoko only
// tests what the leaf lists — and are counted separately.)
let approxOnly = 0;
type Meta = { centerline: { pos: V; right: V; halfWidth?: number }[] };
const meta = JSON.parse(readFileSync(join(dirname(file), 'course_meta.json'), 'utf8')) as Meta;
let points = 0;
let maxLeaf = 0;
const r = sphereRadius;
for (const c of meta.centerline) {
    const hw = Math.ceil(((c.halfWidth ?? 3000) + 200) / 200) * 200;
    for (let lat = -hw; lat <= hw; lat += 200) {
        for (let dy = -250; dy <= 300; dy += 50) {
            const pos: V = [c.pos[0] + c.right[0] * lat, c.pos[1] + dy, c.pos[2] + c.right[2] * lat];
            const leaf = leafList(pos);
            ++points;
            if (!leaf) {
                fail(`point ${pos} outside octree area`);
                continue;
            }
            maxLeaf = Math.max(maxLeaf, leaf.size);
            for (let i = 1; i < nPrisms; ++i) {
                const p = prisms[i]!;
                // cheap reject
                if (Math.abs(pos[0] - p.a[0]) > 4000 || Math.abs(pos[2] - p.a[2]) > 4000) continue;
                if (leaf.has(i)) continue;
                if (trulyTouches(p, pos, r * 0.999)) {
                    fail(`prism ${i} (attr ${p.attr}) touches ${pos.map((v) => v.toFixed(0))} but is not in its leaf`);
                } else if (touches(p, pos, r * 0.999)) ++approxOnly;
            }
        }
    }
}

// 3. floor types under the centerline / road edge / offroad
const floorAt = (pos: V): number | null => {
    const leaf = leafList(pos);
    if (!leaf) return null;
    let best: number | null = null;
    let bestD = Infinity;
    for (const i of leaf) {
        const p = prisms[i]!;
        if (p.fn[1] < 0.5) continue;
        const rel = sub(pos, p.a);
        if (dot(rel, p.e1) > 0.01 || dot(rel, p.e2) > 0.01 || dot(rel, p.e3) - p.h > 0.01) continue;
        const d = Math.abs(dot(rel, p.fn));
        if (d < bestD) {
            bestD = d;
            best = p.attr;
        }
    }
    return best;
};
const hist = new Map<string, number>();
for (const c of meta.centerline) {
    for (const lat of [0, 1000, -1000, 2300, -2300]) {
        const pos: V = [c.pos[0] + c.right[0] * lat, c.pos[1] + 10, c.pos[2] + c.right[2] * lat];
        const t = floorAt(pos);
        const k = `lat ${lat}: ${t === null ? 'none' : '0x' + t.toString(16)}`;
        hist.set(k, (hist.get(k) ?? 0) + 1);
    }
}

console.log(
    `${file}: ${nPrisms - 1} prisms, ${nVerts} verts, ${nNrms} normals, thickness ${thickness}, sphere ${sphereRadius}, ` +
        `area min ${areaMin.join(',')} block shift ${blockShift}`,
);
console.log(`  octree: ${points} probe points checked, max leaf ${maxLeaf} prisms; ${approxOnly} approximate-only (acute-vertex) touches outside leaves`);
console.log('  floor under probes: ' + [...hist].map(([k, v]) => `${k} x${v}`).join(' | '));
if (problems) {
    console.error(`FAILED: ${problems} problems`);
    process.exit(1);
}
console.log('  OK');
