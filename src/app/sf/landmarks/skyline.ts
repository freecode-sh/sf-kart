/**
 * Distant San Francisco skyline (read at 3-8 km): Transamerica Pyramid, Coit Tower on Telegraph
 * Hill, Salesforce Tower, the Ferry Building, named Financial District towers plus generic ones,
 * a low-rise city fill, and the Bay Bridge western span. Positions are true (from lat/lon).
 * Everything merges into a handful of meshes.
 *
 * Local frame: meters relative to SKY at sea level, x east, z south.
 */

import * as THREE from 'three';
import { worldXZ, worldY, SCALE } from '../geo';
import { Batch, box, cap, cyl, facetCyl, lathe, mat, prism, regPoly, rng, sphere, strut, type V2 } from './kit';

export const SKY = { e: 6800, n: -1900 };

type GroundM = (e: number, n: number) => number;

/** Local (x, z) of a point in meters e/n. */
const L = (e: number, n: number): V2 => [e - SKY.e, -(n - SKY.n)];

/** Lofted walls through rings of equal vertex count (ccw from above), with flat normals. */
function loft(rings: { y: number; pts: V2[] }[], tile: [number, number], top = true): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const n = rings[0]!.pts.length;
    for (let r = 0; r + 1 < rings.length; ++r) {
        const A = rings[r]!;
        const B = rings[r + 1]!;
        let run = 0;
        for (let i = 0; i < n; ++i) {
            const a0 = A.pts[i]!;
            const a1 = A.pts[(i + 1) % n]!;
            const b0 = B.pts[i]!;
            const b1 = B.pts[(i + 1) % n]!;
            const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
            const u0 = run / tile[0];
            const u1 = (run + len) / tile[0];
            run += len;
            const va = A.y / tile[1];
            const vb = B.y / tile[1];
            // ccw polygon: (a0, a1, b1) faces outward.
            pos.push(a0[0], A.y, a0[1], a1[0], A.y, a1[1], b1[0], B.y, b1[1], a0[0], A.y, a0[1], b1[0], B.y, b1[1], b0[0], B.y, b0[1]);
            uv.push(u0, va, u1, va, u1, vb, u0, va, u1, vb, u0, vb);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    if (!top) return g;
    const last = rings[rings.length - 1]!;
    const b = new Batch();
    b.add('x', g);
    b.add('x', cap(last.pts, last.y, true, tile[0]));
    const out = b.geometry('x')!;
    out.deleteAttribute('color');
    return out;
}

/** Rounded square (superellipse-ish) of half size h, corner radius rc, ccw from above. */
function roundedSquare(h: number, rc: number, per = 4): V2[] {
    const out: V2[] = [];
    const corners: V2[] = [
        [h - rc, -(h - rc)],
        [-(h - rc), -(h - rc)],
        [-(h - rc), h - rc],
        [h - rc, h - rc],
    ];
    for (let c = 0; c < 4; ++c) {
        const [cx, cz] = corners[c]!;
        for (let i = 0; i <= per; ++i) {
            const a = (c * Math.PI) / 2 + (i / per) * (Math.PI / 2);
            out.push([cx + rc * Math.cos(a), cz - rc * Math.sin(a)]);
        }
    }
    return out;
}

const square = (h: number, rot = 0): V2[] => regPoly(h * Math.SQRT2, 4, Math.PI / 4 + rot);
const rect = (hx: number, hz: number, rot: number): V2[] => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pts: V2[] = [
        [hx, hz],
        [hx, -hz],
        [-hx, -hz],
        [-hx, hz],
    ];
    // Counterclockwise from above (areaXZ > 0); the rotation keeps the winding.
    return pts.map(([x, z]) => [x * c + z * s, -x * s + z * c]);
};
const shift = (p: V2[], x: number, z: number): V2[] => p.map(([a, b]) => [a + x, b + z]);

type Tower = { e: number; n: number; h: number; hx: number; hz: number; rot: number; color: number; kind: 'box' | 'setback' | 'slab' | 'cyl' | 'crown' };

const NAMED: Tower[] = [
    { e: 6501, n: -2059, h: 237, hx: 28, hz: 22, rot: 0, color: 0x806660, kind: 'setback' }, // 555 California
    { e: 6730, n: -1970, h: 212, hx: 22, hz: 22, rot: 0, color: 0xc9c0ae, kind: 'crown' }, // 345 California
    { e: 6994, n: -1959, h: 183, hx: 20, hz: 20, rot: 0, color: 0x8ea3b0, kind: 'cyl' }, // 101 California
    { e: 6790, n: -1792, h: 130, hx: 30, hz: 10, rot: 0, color: 0xd8d2c4, kind: 'slab' }, // Embarcadero Center 1
    { e: 6880, n: -1783, h: 150, hx: 30, hz: 10, rot: 0, color: 0xd8d2c4, kind: 'slab' },
    { e: 6970, n: -1774, h: 173, hx: 30, hz: 10, rot: 0, color: 0xd8d2c4, kind: 'slab' },
    { e: 7060, n: -1765, h: 140, hx: 30, hz: 10, rot: 0, color: 0xd8d2c4, kind: 'slab' },
    { e: 7143, n: -2226, h: 197, hx: 18, hz: 18, rot: 0.785, color: 0x7f95a6, kind: 'cyl' }, // Millennium Tower
    { e: 7214, n: -2315, h: 244, hx: 16, hz: 16, rot: 0.785, color: 0xb7c2c8, kind: 'crown' }, // 181 Fremont
    { e: 7495, n: -2549, h: 188, hx: 17, hz: 17, rot: 0.785, color: 0x9fb2bd, kind: 'box' }, // One Rincon Hill
    { e: 7300, n: -2470, h: 150, hx: 16, hz: 16, rot: 0.785, color: 0xa8b4bb, kind: 'box' },
    { e: 6860, n: -2140, h: 160, hx: 20, hz: 18, rot: 0, color: 0xcfc6b5, kind: 'setback' },
];

/** Generic Financial District / SoMa towers (deterministic). */
function genericTowers(): Tower[] {
    const r = rng(1234);
    const out: Tower[] = [];
    const avoid = [...NAMED.map((t) => [t.e, t.n] as V2), [6572, -1704] as V2, [7099, -2309] as V2];
    const palette = [0xd0c8b8, 0xbfc5c9, 0x8c9aa6, 0xd6cfc2, 0x6f7b85, 0xc2b49c, 0xa3aeb5, 0xdcd5c8];
    let tries = 0;
    while (out.length < 28 && tries++ < 2000) {
        const e = 6480 + r() * 1080;
        const n = -1780 - r() * 900;
        if (avoid.some(([ae, an]) => Math.hypot(ae - e, an - n) < 55)) continue;
        // Taller toward the core (Market & Fremont).
        const core = Math.exp(-(Math.hypot(e - 7050, n + 2150) ** 2) / (2 * 420 ** 2));
        const h = 60 + (40 + 100 * core) * (0.4 + 0.6 * r());
        const soma = e - 6500 > -(n + 2000) * 1.1; // SE of Market: grid at 45 degrees
        out.push({
            e,
            n,
            h,
            hx: 12 + r() * 14,
            hz: 12 + r() * 12,
            rot: soma ? 0.785 : 0.0,
            color: palette[Math.floor(r() * palette.length)]!,
            kind: r() < 0.3 ? 'setback' : r() < 0.15 ? 'cyl' : 'box',
        });
        avoid.push([e, n]);
    }
    return out;
}

function tower(b: Batch, t: Tower, g: number): void {
    const [x, z] = L(t.e, t.n);
    const base = g - 3;
    const tile: [number, number] = [12, 21];
    const roof = 0x55595e;
    if (t.kind === 'cyl') {
        const pts = regPoly(Math.max(t.hx, t.hz), 12, t.rot);
        b.add('facade', prism(shift(pts, x, z), base, g + t.h, { tile, top: false }), { color: t.color });
        b.add('plain', cap(shift(regPoly(Math.max(t.hx, t.hz), 12, t.rot), x, z), g + t.h, true, 8), { color: roof });
        b.add('plain', facetCyl(t.hx * 0.5, t.hx * 0.6, 6, 8), { m: mat(x, g + t.h, z), color: roof });
        return;
    }
    if (t.kind === 'slab') {
        b.add('facade', prism(shift(rect(t.hx, t.hz, t.rot), x, z), base, g + t.h, { tile }), { color: t.color });
        // Vertical fins / setbacks at the ends.
        b.add('facade', prism(shift(rect(t.hx * 0.7, t.hz + 1.2, t.rot), x, z), base, g + t.h - 12, { tile }), { color: t.color });
        b.add('plain', cap(shift(rect(t.hx, t.hz, t.rot), x, z), g + t.h, true, 8), { color: roof });
        return;
    }
    if (t.kind === 'setback') {
        const h1 = t.h * 0.62;
        b.add('facade', prism(shift(rect(t.hx, t.hz, t.rot), x, z), base, g + h1, { tile }), { color: t.color });
        b.add('plain', cap(shift(rect(t.hx, t.hz, t.rot), x, z), g + h1, true, 8), { color: roof });
        b.add('facade', prism(shift(rect(t.hx * 0.72, t.hz * 0.72, t.rot), x, z), g + h1, g + t.h, { tile, vBase: 0 }), { color: t.color });
        b.add('plain', cap(shift(rect(t.hx * 0.72, t.hz * 0.72, t.rot), x, z), g + t.h, true, 8), { color: roof });
        b.add('plain', box(t.hx * 0.6, 5, t.hz * 0.6), { m: mat(x, g + t.h, z, t.rot), color: roof });
        return;
    }
    if (t.kind === 'crown') {
        b.add('facade', prism(shift(rect(t.hx, t.hz, t.rot), x, z), base, g + t.h - 14, { tile }), { color: t.color });
        // Stepped / pyramidal crown.
        const rings = [0, 1, 2, 3].map((i) => ({ y: g + t.h - 14 + i * 4.7, pts: shift(rect(t.hx * (1 - i * 0.22), t.hz * (1 - i * 0.22), t.rot), x, z) }));
        b.add('facade', loft(rings, tile), { color: t.color });
        b.add('metal', cyl(0.4, 0.8, 16, 6), { m: mat(x, g + t.h, z), color: 0xcccccc });
        return;
    }
    b.add('facade', prism(shift(rect(t.hx, t.hz, t.rot), x, z), base, g + t.h, { tile }), { color: t.color });
    b.add('plain', cap(shift(rect(t.hx, t.hz, t.rot), x, z), g + t.h, true, 8), { color: roof });
    b.add('plain', box(t.hx * 0.8, 4, t.hz * 0.6), { m: mat(x, g + t.h, z, t.rot), color: roof });
}

function transamerica(b: Batch, g: number): void {
    const [x, z] = L(6572, -1704);
    const H = 212;
    const rings: { y: number; pts: V2[] }[] = [];
    for (let i = 0; i <= 6; ++i) {
        const t = i / 6;
        const y = g - 3 + (H + 3) * t;
        rings.push({ y, pts: shift(square(26.5 - (26.5 - 8.5) * t), x, z) });
    }
    b.add('facade', loft(rings, [8, 12], false), { color: 0xeeebe3 });
    // Wings (elevator / stair towers) on the east and west faces, from ~110 m up.
    for (const s of [-1, 1]) {
        const y0 = g + 105;
        const w0 = 26.5 - (18 * 105) / H;
        const wing = [
            { y: y0, pts: shift(rect(4.5, 9, 0), x + s * (w0 - 2), z) },
            { y: g + H + 4, pts: shift(rect(4.5, 6, 0), x + s * (8.5 + 2.5), z) },
        ];
        b.add('facade', loft(wing, [8, 12]), { color: 0xe9e5dc });
    }
    // Spire (aluminum-clad) to 260 m, with a beacon.
    const spire = [
        { y: g + H, pts: shift(square(8.5), x, z) },
        { y: g + 258, pts: shift(square(0.6), x, z) },
    ];
    b.add('plain', loft(spire, [8, 8]), { color: 0xe9e7e0 });
    b.add('lamp', sphere(1.2, 6, 4), { m: mat(x, g + 258, z), color: 0xff5040 });
}

function salesforce(b: Batch, g: number): void {
    const [x, z] = L(7099, -2309);
    const levels: [number, number][] = [
        [-3, 27],
        [120, 26.4],
        [220, 25],
        [290, 22.5],
    ];
    const rings = levels.map(([y, h]) => ({ y: g + y, pts: shift(roundedSquare(h, h * 0.45, 3), x, z) }));
    b.add('facade', loft(rings, [9, 14]), { color: 0xc9d4da });
    // The open crown (lighter band, slightly transparent look via pale lamp-free color).
    const crown = [
        { y: g + 290, pts: shift(roundedSquare(22.5, 10, 3), x, z) },
        { y: g + 326, pts: shift(roundedSquare(19, 8.5, 3), x, z) },
    ];
    b.add('plain', loft(crown, [9, 6], false), { color: 0xe6ecef });
    b.add('lamp', cap(shift(roundedSquare(21.5, 9.6, 3), x, z), g + 304, true, 8), { color: 0xfaf6ea });
}

function coit(b: Batch, g: number): void {
    const [x, z] = L(6305, -903);
    // Fluted shaft (16 sides), arcaded crown, cap; a base pavilion.
    b.add('plain', facetCyl(5.3, 5.6, 56, 16, false, 0), { m: mat(x, g - 1, z), color: 0xefe7d5 });
    b.add('plain', facetCyl(6.0, 5.6, 1.5, 16), { m: mat(x, g + 55, z), color: 0xe7ddc8 });
    b.add('glass', facetCyl(5.4, 5.4, 4.5, 16, true), { m: mat(x, g + 56.5, z), color: 0x4a5058 });
    for (let i = 0; i < 16; ++i) {
        const a = (i / 16) * Math.PI * 2;
        b.add('plain', box(0.9, 4.5, 0.9), { m: mat(x + 5.5 * Math.cos(a), g + 56.5, z + 5.5 * Math.sin(a), -a), color: 0xefe7d5 });
    }
    b.add('plain', facetCyl(5.7, 6.1, 1.6, 16), { m: mat(x, g + 61, z), color: 0xe7ddc8 });
    b.add('plain', box(28, 6, 22), { m: mat(x, g - 2, z), color: 0xe7ddc8 });
}

function ferryBuilding(b: Batch, g: number): void {
    const [x, z] = L(7372, -1670);
    const rot = -0.72; // along the Embarcadero (NNW-SSE)
    b.add('facade', box(200, 17, 30), { m: mat(x, g - 3, z, rot), uv: 'box', tile: [9, 8], color: 0xece3d0 });
    b.add('plain', box(202, 3, 32), { m: mat(x, g + 14, z, rot), color: 0x9aa39a });
    b.add('plain', box(12, 60, 12), { m: mat(x, g + 14, z, rot), color: 0xf0e8d6 });
    b.add('plain', box(9, 9, 9), { m: mat(x, g + 74, z, rot), color: 0xf0e8d6 });
    b.add('lamp', box(12.2, 4, 12.2), { m: mat(x, g + 62, z, rot), color: 0xfbf4dc });
    b.add('plain', facetCyl(0.2, 5.5, 8, 4, false, Math.PI / 4 + rot), { m: mat(x, g + 83, z), color: 0x6f8f79 });
}

/**
 * Low-rise city fill: blocks of 2-6 storey buildings, in the Marina's stucco colours under tar and
 * gravel roofs (buildings.ts), densest by the detailed city's east edge (e 3550) so the city
 * carries on past it.
 */
function lowRise(b: Batch, groundM: GroundM, flat: boolean): void {
    const r = rng(77);
    const colsReal = [0xe6dcc8, 0xe3d2a6, 0xd6c29c, 0xdcb898, 0xcfa184, 0xbfc9cc, 0xcac6bd, 0xdfc3bb, 0xddd6ca, 0xc9b79a];
    const roofs = [0x5b5754, 0x6d6a66, 0x77706a, 0x625c57];
    for (let i = 0; i < 1300; ++i) {
        // (the first 600 in the band next to the detailed city)
        const e = i < 600 ? 3560 + r() * 900 : 3700 + r() * 4200;
        const n = -600 - r() * 2800;
        // Rough north waterfront: land south of a line from (3700, -450) to (6000, -250), then the
        // Embarcadero running SE to (7900, -2600).
        const shoreN = e < 6000 ? -450 + ((e - 3700) / 2300) * 200 : -250 - ((e - 6000) / 1900) * 2350;
        if (n > shoreN - 60) continue;
        if (Math.hypot(e - 6305, n + 903) < 160) continue; // Telegraph Hill park
        if (e > 4050 && e < 4550 && n > -820) continue; // Fort Mason
        const g = groundM(e, n);
        if (!flat && g < 1.5) continue;
        const core = Math.exp(-(Math.hypot(e - 7000, n + 2100) ** 2) / (2 * 700 ** 2));
        const near = i < 600;
        const h = near ? 8 + r() * 7 : 10 + r() * 14 + core * r() * 30;
        const w = near ? 10 + r() * 16 : 20 + r() * 40;
        const d = near ? 18 + r() * 16 : 18 + r() * 30;
        const rot = e - 6500 > -(n + 2000) * 1.1 ? 0.785 : 0;
        const [x, z] = L(e, n);
        b.add('resid', box(w, h + 4, d), { m: mat(x, g - 4, z, rot), uv: 'box', tile: [12, 12], uvOffset: [Math.floor(r() * 4) / 4, 4 / 12], color: colsReal[Math.floor(r() * colsReal.length)]! });
        b.add('plain', box(w - 0.6, 0.5, d - 0.6), { m: mat(x, g + h, z, rot), color: roofs[Math.floor(r() * roofs.length)]! });
    }
}

/** Bay Bridge western span: two suspension bridges joined at the center anchorage. */
function bayBridge(b: Batch): void {
    const A: V2 = [7900, -2600];
    const B: V2 = [9480, -580];
    const at = (t: number): V2 => L(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t);
    const dir = new THREE.Vector2(B[0] - A[0], -(B[1] - A[1])).normalize();
    const ry = Math.atan2(-dir.y, dir.x);
    const perp: V2 = [-dir.y, dir.x];
    const K = 'metal';
    const C = 0xaab2b8;
    const deckY = 58;
    const towerH = 160;
    const spans = [0, 0.125, 0.375, 0.5, 0.625, 0.875, 1];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    // Deck (double-deck truss as one deep box).
    const mid = at(0.5);
    b.add(K, box(len, 9, 22), { m: mat(mid[0], deckY - 9, mid[1], ry), color: 0x8d969c });
    // Anchorages.
    for (const t of [0, 0.5, 1]) {
        const p = at(t);
        const h = t === 0.5 ? 90 : 62;
        b.add('plain', box(60, h + 10, 40), { m: mat(p[0], -10, p[1], ry), color: 0xb9b4aa });
    }
    const tops: { t: number; y: number }[] = [];
    for (const t of spans) {
        if (t === 0 || t === 0.5 || t === 1) {
            tops.push({ t, y: t === 0.5 ? 90 : 62 });
            continue;
        }
        const p = at(t);
        for (const s of [-1, 1]) b.add(K, box(6, towerH + 10, 6), { m: mat(p[0] + perp[0] * s * 12, -10, p[1] + perp[1] * s * 12, ry), color: C });
        for (const y of [deckY + 5, 100, 130, towerH - 4]) b.add(K, box(6, 5, 30), { m: mat(p[0], y, p[1], ry), color: C });
        b.add(K, box(40, 8, 30), { m: mat(p[0], -8, p[1], ry), color: 0x9f9a92 });
        tops.push({ t, y: towerH });
    }
    // Main cables (sagging polylines).
    for (let k = 0; k + 1 < tops.length; ++k) {
        const a = tops[k]!;
        const c = tops[k + 1]!;
        const segs = 8;
        for (const s of [-1, 1]) {
            let prev: THREE.Vector3 | null = null;
            for (let i = 0; i <= segs; ++i) {
                const f = i / segs;
                const t = a.t + (c.t - a.t) * f;
                const p = at(t);
                const sag = (c.t - a.t) * len * 0.1 * 4 * f * (1 - f);
                const y = a.y + (c.y - a.y) * f - Math.min(sag, Math.min(a.y, c.y) - deckY - 2);
                const v = new THREE.Vector3(p[0] + perp[0] * s * 12, y, p[1] + perp[1] * s * 12);
                if (prev) {
                    const st = strut(prev, v, 1.1, 4);
                    b.add(K, st.geo, { m: st.m, color: C });
                }
                prev = v;
            }
        }
    }
}

export function buildSkyline(groundY: (x: number, z: number) => number, flat = false): Batch {
    const b = new Batch();
    const groundM: GroundM = (e, n) => {
        const [x, z] = worldXZ(e, n);
        return (groundY(x, z) - worldY(0)) / SCALE;
    };
    const gMax = (e: number, n: number, r: number) => Math.max(groundM(e, n), groundM(e + r, n), groundM(e - r, n), groundM(e, n + r), groundM(e, n - r));
    for (const t of [...NAMED, ...genericTowers()]) tower(b, t, gMax(t.e, t.n, Math.max(t.hx, t.hz)));
    transamerica(b, gMax(6572, -1704, 26));
    salesforce(b, gMax(7099, -2309, 27));
    ferryBuilding(b, Math.max(3, groundM(7372, -1670)));
    // Telegraph Hill: use the terrain if it has the hill, else add a mound.
    let hill = gMax(6305, -903, 30);
    if (hill < 40) {
        const [hx, hz] = L(6305, -903);
        const prof: V2[] = [];
        for (let i = 0; i <= 8; ++i) {
            const t = i / 8;
            prof.push([380 * (1 - t) + 20 * t, hill - 4 + (85 - hill + 4) * Math.pow(Math.sin((t * Math.PI) / 2), 1.3)]);
        }
        prof.push([0.01, 85]);
        b.add('rock', lathe(prof, 24), { m: mat(hx, 0, hz), color: 0x6f7a55 });
        hill = 85;
    }
    coit(b, hill);
    lowRise(b, groundM, flat);
    bayBridge(b);
    return b;
}
