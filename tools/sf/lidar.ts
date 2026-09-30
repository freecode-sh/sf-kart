/**
 * Downloads the USGS 3DEP 2023 San Francisco lidar (public domain, Entwine Point Tiles on AWS) in the
 * Golden Gate Bridge corridor and writes the bridge's points in course meters:
 *
 *   .context/sf/lidar/ept/          raw EPT hierarchy + LAZ nodes (cache)
 *   .context/sf/lidar/bridge.bin    'GGL1', u32 count, Float32 [e, n, h] * count, Uint8 class * count
 *   .context/sf/lidar/bridge.json   metadata (source, datum, corridor, class counts)
 *
 * e / n are meters east / north of tools/sf/geo.ts ORIGIN; h is the lidar height (NAVD88 m, Geoid18;
 * the EPT srs only states EPSG:3857 horizontal, the vertical comes from the project's LAS headers).
 * Kept: class 1 (unclassified: towers, cables, suspenders, cars) and 17 (bridge deck), all of them;
 * class 2 (ground) and 9 (water) thinned 1 in 8, for the datum check.
 *
 * The corridor is the bridge axis of src/app/sf/bridgeParts/frame.ts extended 160 m past both ends,
 * +-50 m laterally, heights -10..245 m, which covers the towers, the Fort Point arch, both
 * anchorages and the north viaduct.
 *
 * Usage: npx tsx tools/sf/lidar.ts [--dry]   (--dry: walk the hierarchy and print the download size)
 * Then tools/sf/bridgeFit.ts measures the structure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLazPerf } from 'laz-perf';
import { LEN, toAxis, xz } from '../../src/app/sf/bridgeParts/frame';
import { fromMeters, SCALE, toMeters } from './geo';
import { USER_AGENT as UA } from './sources';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.context/sf/lidar');
const CACHE = join(OUT, 'ept');
const EPT = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23';

/** Corridor (course meters along / lateral of the bridge axis, NAVD88 heights). */
const CORRIDOR = { along: [-160, LEN / SCALE + 160] as [number, number], lateral: 50, h: [-10, 245] as [number, number] };
const KEEP_ALL = new Set([1, 17]);
const KEEP_THIN = new Set([2, 9]);
const THIN = 8;

type Ept = { bounds: number[]; srs: { horizontal?: string; vertical?: string; wkt?: string }; points: number; span: number; schema: { name: string }[] };

async function get(url: string, file: string): Promise<Uint8Array> {
    if (existsSync(file)) return readFileSync(file);
    for (let attempt = 0; ; ++attempt) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!r.ok) throw new Error(`${r.status} ${url}`);
            const b = new Uint8Array(await r.arrayBuffer());
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, b);
            return b;
        } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
}
const getJson = async <T>(url: string, file: string): Promise<T> => JSON.parse(new TextDecoder().decode(await get(url, file))) as T;

// ---- EPSG:3857 <-> course meters. ----
const R = 6378137;
const D = 180 / Math.PI;
const mercToLatLon = (x: number, y: number): [number, number] => [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * D, (x / R) * D];
const latLonToMerc = (lat: number, lon: number): [number, number] => [(lon / D) * R, Math.log(Math.tan(Math.PI / 4 + lat / D / 2)) * R];
const metersToMerc = (e: number, n: number): [number, number] => latLonToMerc(...fromMeters(e, n));

/** Corridor as convex quads in EPSG:3857, one per axis segment piece (every 100 m). */
function corridorQuads(): [number, number][][] {
    const quads: [number, number][][] = [];
    const [a0, a1] = CORRIDOR.along;
    const L = CORRIDOR.lateral + 5;
    const P = (s: number, l: number) => {
        const [x, z] = xz(s * SCALE, l * SCALE);
        return metersToMerc(x / SCALE, -z / SCALE);
    };
    for (let s = a0; s < a1; s += 100) {
        const t = Math.min(a1, s + 100);
        quads.push([P(s, -L), P(t, -L), P(t, L), P(s, L)]);
    }
    return quads;
}

/** Separating-axis test: convex polygon vs axis-aligned box. */
function polyHitsBox(poly: [number, number][], x0: number, y0: number, x1: number, y1: number): boolean {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    if (Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...ys) < y0 || Math.min(...ys) > y1) return false;
    const box: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
    for (let i = 0; i < poly.length; ++i) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const nx = b[1] - a[1];
        const ny = a[0] - b[0];
        const pr = poly.map((p) => p[0] * nx + p[1] * ny);
        const br = box.map((p) => p[0] * nx + p[1] * ny);
        if (Math.max(...br) < Math.min(...pr) || Math.min(...br) > Math.max(...pr)) return false;
    }
    return true;
}

/** Walks the EPT hierarchy: every node with points whose cube meets the corridor. */
async function walk(ept: Ept): Promise<{ key: string; count: number }[]> {
    const B = ept.bounds;
    const quads = corridorQuads();
    const nodes: { key: string; count: number }[] = [];
    const hits = (d: number, x: number, y: number, z: number) => {
        const size = (B[3]! - B[0]!) / 2 ** d;
        const bx = B[0]! + x * size;
        const by = B[1]! + y * size;
        const bz = B[2]! + z * size;
        // Heights are not scaled by the projection; allow some slack for the cube's own bounds.
        if (bz > CORRIDOR.h[1] + 5 || bz + size < CORRIDOR.h[0] - 5) return false;
        return quads.some((q) => polyHitsBox(q, bx, by, bx + size, by + size));
    };
    const sub = async (root: string) => {
        const h = await getJson<Record<string, number>>(`${EPT}/ept-hierarchy/${root}.json`, join(CACHE, `h-${root}.json`));
        const todo = [root];
        while (todo.length) {
            const k = todo.pop()!;
            const c = h[k];
            if (c === undefined) continue;
            const [d, x, y, z] = k.split('-').map(Number) as [number, number, number, number];
            if (!hits(d, x, y, z)) continue;
            if (c === -1 && k !== root) {
                await sub(k);
                continue;
            }
            if (c > 0) nodes.push({ key: k, count: c });
            for (let i = 0; i < 8; ++i) todo.push(`${d + 1}-${2 * x + (i & 1)}-${2 * y + ((i >> 1) & 1)}-${2 * z + ((i >> 2) & 1)}`);
        }
    };
    await sub('0-0-0-0');
    return nodes;
}

type Lp = Awaited<ReturnType<typeof createLazPerf>>;

/** Decodes a LAZ node, calling fn(x, y, z, cls) (x, y EPSG:3857, z NAVD88 m) per point. */
function decode(lp: Lp, bytes: Uint8Array, fn: (x: number, y: number, z: number, cls: number) => void): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fmt = dv.getUint8(104) & 0x3f;
    const [sx, sy, sz] = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
    const [ox, oy, oz] = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
    // Classification: formats 0-5 keep it in the low 5 bits of byte 15, formats 6-10 in byte 16.
    const clsAt = fmt >= 6 ? 16 : 15;
    const clsMask = fmt >= 6 ? 0xff : 0x1f;
    const filePtr = lp._malloc(bytes.length);
    lp.HEAPU8.set(bytes, filePtr);
    const las = new lp.LASZip();
    try {
        las.open(filePtr, bytes.length);
        const n = las.getCount();
        const len = las.getPointLength();
        const pt = lp._malloc(len);
        try {
            for (let i = 0; i < n; ++i) {
                las.getPoint(pt);
                const p = new DataView(lp.HEAPU8.buffer, pt, len);
                fn(p.getInt32(0, true) * sx + ox, p.getInt32(4, true) * sy + oy, p.getInt32(8, true) * sz + oz, p.getUint8(clsAt) & clsMask);
            }
        } finally {
            lp._free(pt);
        }
    } finally {
        las.delete();
        lp._free(filePtr);
    }
}

async function main() {
    mkdirSync(CACHE, { recursive: true });
    const ept = await getJson<Ept>(`${EPT}/ept.json`, join(CACHE, 'ept.json'));
    console.log(`EPT: ${ept.points} points, srs horizontal EPSG:${ept.srs.horizontal}, vertical ${ept.srs.vertical ?? '(not stated: NAVD88 Geoid18 m per the LAS headers)'}`);
    const nodes = await walk(ept);
    const depths = new Map<number, number>();
    for (const n of nodes) depths.set(Number(n.key.split('-')[0]), (depths.get(Number(n.key.split('-')[0])) ?? 0) + 1);
    const cached = nodes.filter((n) => existsSync(join(CACHE, `${n.key}.laz`))).length;
    console.log(`corridor: ${nodes.length} nodes (${cached} cached), ${nodes.reduce((t, n) => t + n.count, 0)} points; per depth ${[...depths].sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d}:${c}`).join(' ')}`);
    if (process.argv.includes('--dry')) return;

    // Download (in parallel), decode (one WASM instance, in order).
    const lp = await createLazPerf();
    const E: number[] = [];
    const N: number[] = [];
    const H: number[] = [];
    const C: number[] = [];
    const counts: Record<number, number> = {};
    let thin = 0;
    let done = 0;
    let bytes = 0;
    const queue = [...nodes];
    const pending = new Map<string, Promise<Uint8Array>>();
    const start = (k: string) => pending.set(k, get(`${EPT}/ept-data/${k}.laz`, join(CACHE, `${k}.laz`)));
    const AHEAD = 12;
    for (let i = 0; i < Math.min(AHEAD, queue.length); ++i) start(queue[i]!.key);
    for (let i = 0; i < queue.length; ++i) {
        const k = queue[i]!.key;
        if (i + AHEAD < queue.length) start(queue[i + AHEAD]!.key);
        const b = await pending.get(k)!;
        pending.delete(k);
        bytes += b.length;
        decode(lp, b, (x, y, z, cls) => {
            const all = KEEP_ALL.has(cls);
            if (!all && !KEEP_THIN.has(cls)) return;
            if (z < CORRIDOR.h[0] || z > CORRIDOR.h[1]) return;
            const [lat, lon] = mercToLatLon(x, y);
            const [e, n] = toMeters(lat, lon);
            const a = toAxis(e * SCALE, -n * SCALE);
            if (Math.abs(a.l / SCALE) > CORRIDOR.lateral || a.s / SCALE < CORRIDOR.along[0] || a.s / SCALE > CORRIDOR.along[1]) return;
            if (!all && thin++ % THIN) return;
            E.push(e);
            N.push(n);
            H.push(z);
            C.push(cls);
            counts[cls] = (counts[cls] ?? 0) + 1;
        });
        if (++done % 50 === 0 || done === queue.length) console.log(`  ${done}/${queue.length} nodes, ${(bytes / 1e6).toFixed(0)} MB, kept ${E.length}`);
    }

    const n = E.length;
    const buf = Buffer.alloc(8 + n * 13);
    buf.write('GGL1', 0, 'ascii');
    buf.writeUInt32LE(n, 4);
    const f = new Float32Array(buf.buffer, buf.byteOffset + 8, n * 3);
    for (let i = 0; i < n; ++i) {
        f[i * 3] = E[i]!;
        f[i * 3 + 1] = N[i]!;
        f[i * 3 + 2] = H[i]!;
    }
    buf.set(C, 8 + n * 12);
    writeFileSync(join(OUT, 'bridge.bin'), buf);
    const meta = {
        source: `${EPT} (USGS 3DEP, CA_SanFrancisco_1_B23, 2023, public domain)`,
        horizontal: 'EPSG:3857 → course meters east / north of tools/sf/geo.ts ORIGIN (equirectangular)',
        vertical: 'NAVD88 height (Geoid18), meters',
        layout: "'GGL1', u32 count, Float32 [e, n, h] * count, Uint8 class * count",
        corridor: CORRIDOR,
        classes: counts,
        thinned: { classes: [...KEEP_THIN], keepOneIn: THIN },
        nodes: nodes.length,
        downloadedMB: +(bytes / 1e6).toFixed(1),
    };
    writeFileSync(join(OUT, 'bridge.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(`wrote ${join(OUT, 'bridge.bin')}: ${n} points, classes ${JSON.stringify(counts)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
