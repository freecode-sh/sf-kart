/**
 * Top-down PNG preview of a built course: KCL triangles rasterized by type (height-shaded), plus
 * checkpoints (thin lines, key checkpoints red), respawn points (white dots) and the start (yellow).
 *
 * Usage: npx tsx tools/course/preview.ts <id> [out.png] [--px 40] [--bbox x0,z0,x1,z1] [--wire]
 * (--px: world units per pixel; --wire: triangle edges.) Default output: .context/preview/<id>.png
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { readKclTriangles } from '../../src/app/kclMesh';
import { crc32 } from '../lib/bin';

const COLORS: Record<number, [number, number, number]> = {
    0x00: [110, 114, 122],
    0x01: [201, 168, 107],
    0x02: [111, 155, 63],
    0x03: [78, 138, 47],
    0x04: [120, 80, 40],
    0x06: [255, 154, 31],
    0x07: [255, 60, 200],
    0x08: [31, 154, 255],
    0x0c: [230, 220, 200],
    0x10: [60, 20, 20],
};

function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
    const raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0; y < h; ++y) {
        raw[y * (w * 3 + 1)] = 0;
        raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
    }
    const chunks: Uint8Array[] = [];
    const chunk = (type: string, data: Uint8Array) => {
        const b = new Uint8Array(12 + data.length);
        const dv = new DataView(b.buffer);
        dv.setUint32(0, data.length);
        for (let i = 0; i < 4; ++i) b[4 + i] = type.charCodeAt(i);
        b.set(data, 8);
        dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
        chunks.push(b);
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;
    ihdr[9] = 2;
    chunk('IHDR', ihdr);
    chunk('IDAT', deflateSync(raw));
    chunk('IEND', new Uint8Array(0));
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    out.set(sig, 0);
    let o = 8;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

function renderPreview(
    courseDir: string,
    unitsPerPx = 40,
    bbox?: [number, number, number, number],
    wire = false,
): { png: Uint8Array; w: number; h: number } {
    const kcl = readKclTriangles(new Uint8Array(readFileSync(`${courseDir}/course.kcl`)));
    const meta = JSON.parse(readFileSync(`${courseDir}/course_meta.json`, 'utf8'));
    const P = kcl.positions;
    const n = kcl.attributes.length;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n * 3; ++i) {
        minX = Math.min(minX, P[i * 3]!);
        maxX = Math.max(maxX, P[i * 3]!);
        minY = Math.min(minY, P[i * 3 + 1]!);
        maxY = Math.max(maxY, P[i * 3 + 1]!);
        minZ = Math.min(minZ, P[i * 3 + 2]!);
        maxZ = Math.max(maxZ, P[i * 3 + 2]!);
    }
    if (bbox) [minX, minZ, maxX, maxZ] = bbox;
    const pad = bbox ? 0 : 1000;
    const w = Math.ceil((maxX - minX + 2 * pad) / unitsPerPx);
    const h = Math.ceil((maxZ - minZ + 2 * pad) / unitsPerPx);
    const rgb = new Uint8Array(w * h * 3).fill(24);
    const zbuf = new Float32Array(w * h).fill(-Infinity);
    // +X is the driver's left when facing +Z: draw X increasing to the LEFT so the map reads like a
    // view from above (north = +Z up).
    const toPx = (x: number, z: number): [number, number] => [(maxX + pad - x) / unitsPerPx, (maxZ + pad - z) / unitsPerPx];
    const put = (x: number, y: number, c: [number, number, number], depth: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const k = y * w + x;
        if (depth < zbuf[k]!) return;
        zbuf[k] = depth;
        rgb[k * 3] = c[0];
        rgb[k * 3 + 1] = c[1];
        rgb[k * 3 + 2] = c[2];
    };
    const order = [...Array(n).keys()].sort((a, b) => {
        const fa = (kcl.attributes[a]! & 0x1f) === 0x10 ? -1 : (kcl.attributes[a]! & 0x1f) === 0x0c ? 1 : 0;
        const fb = (kcl.attributes[b]! & 0x1f) === 0x10 ? -1 : (kcl.attributes[b]! & 0x1f) === 0x0c ? 1 : 0;
        return fa - fb;
    });
    for (const t of order) {
        const type = kcl.attributes[t]! & 0x1f;
        const base = COLORS[type] ?? [200, 0, 200];
        const v = [0, 1, 2].map((k) => toPx(P[t * 9 + k * 3]!, P[t * 9 + k * 3 + 2]!));
        const ys = [0, 1, 2].map((k) => P[t * 9 + k * 3 + 1]!);
        const yAvg = (ys[0]! + ys[1]! + ys[2]!) / 3;
        const shade = type === 0x10 || type === 0x0c ? 1 : 0.55 + 0.45 * ((yAvg - minY) / Math.max(1, maxY - minY));
        const c: [number, number, number] = [base[0] * shade, base[1] * shade, base[2] * shade];
        const depth = type === 0x0c ? 1e9 : type === 0x10 ? -1e9 : yAvg;
        const x0 = Math.floor(Math.min(v[0]![0], v[1]![0], v[2]![0]));
        const x1 = Math.ceil(Math.max(v[0]![0], v[1]![0], v[2]![0]));
        const y0 = Math.floor(Math.min(v[0]![1], v[1]![1], v[2]![1]));
        const y1 = Math.ceil(Math.max(v[0]![1], v[1]![1], v[2]![1]));
        const [a, b, cc] = v as [[number, number], [number, number], [number, number]];
        const area = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
        if (Math.abs(area) < 1e-6) {
            // vertical (walls): draw the edge
            for (let k = 0; k < 3; ++k) {
                const p = v[k]!;
                const q = v[(k + 1) % 3]!;
                const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])) + 1;
                for (let s = 0; s <= steps; ++s) put(Math.round(p[0] + ((q[0] - p[0]) * s) / steps), Math.round(p[1] + ((q[1] - p[1]) * s) / steps), c, depth);
            }
            continue;
        }
        if (wire && type !== 0x10) {
            for (let k = 0; k < 3; ++k) {
                const p = v[k]!;
                const q = v[(k + 1) % 3]!;
                const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])) + 1;
                if (steps > 4000) continue;
                for (let s = 0; s <= steps; ++s) put(Math.round(p[0] + ((q[0] - p[0]) * s) / steps), Math.round(p[1] + ((q[1] - p[1]) * s) / steps), [255, 255, 255], 5e8);
            }
        }
        if (x1 - x0 > 20000 || y1 - y0 > 20000) continue;
        for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); ++y)
            for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); ++x) {
                const px = x + 0.5;
                const py = y + 0.5;
                const w0 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
                const w1 = (cc[0] - b[0]) * (py - b[1]) - (cc[1] - b[1]) * (px - b[0]);
                const w2 = (a[0] - cc[0]) * (py - cc[1]) - (a[1] - cc[1]) * (px - cc[0]);
                if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) put(x, y, c, depth);
            }
    }
    const line = (x0: number, z0: number, x1: number, z1: number, c: [number, number, number]) => {
        const p = toPx(x0, z0);
        const q = toPx(x1, z1);
        const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])) + 1;
        for (let s = 0; s <= steps; ++s) put(Math.round(p[0] + ((q[0] - p[0]) * s) / steps), Math.round(p[1] + ((q[1] - p[1]) * s) / steps), c, 2e9);
    };
    for (const c of meta.checkpoints) line(c.left[0], c.left[1], c.right[0], c.right[1], c.key >= 0 ? [255, 40, 40] : [90, 90, 160]);
    const dot = (x: number, z: number, c: [number, number, number], r = 3) => {
        const p = toPx(x, z);
        for (let dy = -r; dy <= r; ++dy) for (let dx = -r; dx <= r; ++dx) if (dx * dx + dy * dy <= r * r) put(Math.round(p[0]) + dx, Math.round(p[1]) + dy, c, 3e9);
    };
    for (const j of meta.respawns) dot(j.pos[0], j.pos[2], [255, 255, 255]);
    dot(meta.start.pos[0], meta.start.pos[2], [255, 230, 0], 5);
    return { png: png(w, h, rgb), w, h };
}

if (process.argv[1]?.endsWith('preview.ts')) {
    const args = process.argv.slice(2);
    const id = args[0]!;
    const pxI = args.indexOf('--px');
    const upp = pxI >= 0 ? Number(args[pxI + 1]) : 40;
    const bbI = args.indexOf('--bbox');
    const bbox = bbI >= 0 ? (args[bbI + 1]!.split(',').map(Number) as [number, number, number, number]) : undefined;
    const out = args[1] && !args[1].startsWith('--') ? args[1] : `.context/preview/${id}.png`;
    const r = renderPreview(`public/data/courses/${id}`, upp, bbox, args.includes('--wire'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.png);
    console.log(`wrote ${out} (${r.w}x${r.h})`);
}
