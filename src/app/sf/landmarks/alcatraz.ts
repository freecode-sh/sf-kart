/**
 * Alcatraz Island: a rocky island (~510 x 180 m, 41 m high) with cliffs and terraces, the
 * cellhouse on the crest, the lighthouse at its south end, the water tower and the power-house
 * smokestack on the north end, and Building 64 by the dock on the south-east. Mostly seen from
 * 3-6 km, so detail is modest.
 *
 * Local frame: meters, origin at the island center at sea level, x east, z south. The island is
 * its own terrain (the far DEM only has a bump here).
 */

import * as THREE from 'three';
import { Batch, box, cone, cyl, facetCyl, mat, prism, rng, sphere, type V2 } from './kit';

/** True position (37.8267 N, 122.4229 W). */
export const ALCATRAZ = { e: 4803, n: 1803 };

/** Long axis (toward NNW) and cross axis (toward ENE), e/n. */
const L: V2 = [-0.6, 0.8];
const W: V2 = [0.8, 0.6];
/** (u along the island, v across) → local (x, z). */
const P = (u: number, v: number): V2 => [u * L[0] + v * W[0], -(u * L[1] + v * W[1])];
const RY = Math.atan2(L[1], L[0]); // box local x along L

/** Crest height profile along the island (u: + = NNW end). */
function crest(u: number): number {
    const k: V2[] = [
        [-270, 4],
        [-225, 14],
        [-170, 24],
        [-120, 27],
        [-75, 38],
        [-40, 41],
        [80, 41],
        [120, 34],
        [165, 26],
        [215, 17],
        [255, 6],
    ];
    if (u <= k[0]![0]) return k[0]![1];
    for (let i = 0; i + 1 < k.length; ++i) {
        const [u0, h0] = k[i]!;
        const [u1, h1] = k[i + 1]!;
        if (u <= u1) {
            const t = (u - u0) / (u1 - u0);
            return h0 + (h1 - h0) * (t * t * (3 - 2 * t));
        }
    }
    return k[k.length - 1]![1];
}

/** Half-width of the island at u (meters), wobbly. */
const halfWidth = (u: number) => {
    const t = u / 262;
    if (Math.abs(t) >= 1) return 0;
    return (88 + 12 * Math.sin(u / 37) + 8 * Math.cos(u / 19)) * Math.pow(1 - t * t, 0.45);
};

function height(u: number, v: number): number {
    const hw = halfWidth(u);
    // Signed distance-ish to the shoreline (positive inside).
    const d = hw - Math.abs(v - 8 * Math.sin(u / 50));
    const top = crest(u);
    if (d <= 0) return Math.max(-9, d * 0.8);
    // Cliffs: rise steeply over the first ~25 m, gentler to the crest.
    const cliff = Math.min(1, d / 22);
    const shoulder = Math.min(1, d / 55);
    let h = top * (0.72 * Math.pow(cliff, 0.55) + 0.28 * shoulder);
    h += 1.6 * Math.sin(u / 7.3 + v / 5.1) * Math.min(1, d / 10);
    return h;
}

function islandGeo(): THREE.BufferGeometry {
    const du = 6;
    const dv = 5;
    const nu = Math.round(560 / du);
    const nv = Math.round(260 / dv);
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const r = rng(7);
    const hs: number[] = [];
    for (let j = 0; j <= nv; ++j)
        for (let i = 0; i <= nu; ++i) {
            const u = -280 + i * du;
            const v = -130 + j * dv;
            hs.push(height(u, v));
        }
    const H = (i: number, j: number) => hs[j * (nu + 1) + i]!;
    const c = new THREE.Color();
    const rockA = new THREE.Color(0x7a6e62);
    const rockB = new THREE.Color(0x5d544b);
    const green = new THREE.Color(0x5f6f3c);
    const pale = new THREE.Color(0xa49b88);
    const wet = new THREE.Color(0x3b3630);
    for (let j = 0; j <= nv; ++j)
        for (let i = 0; i <= nu; ++i) {
            const u = -280 + i * du;
            const v = -130 + j * dv;
            const h = H(i, j);
            const [x, z] = P(u, v);
            pos.push(x, h, z);
            uv.push(x / 12, z / 12);
            const gx = (H(Math.min(nu, i + 1), j) - H(Math.max(0, i - 1), j)) / (2 * du);
            const gz = (H(i, Math.min(nv, j + 1)) - H(i, Math.max(0, j - 1))) / (2 * dv);
            const slope = Math.hypot(gx, gz);
            const n = r();
            if (h < 1.2) c.copy(wet);
            else if (slope > 0.9) c.copy(rockA).lerp(rockB, n);
            else if (h > crest(u) - 6 && Math.abs(u) < 150) c.copy(pale).lerp(green, 0.25 + 0.3 * n);
            else c.copy(green).lerp(rockA, Math.min(1, slope * 0.9) * (0.5 + 0.5 * n));
            col.push(c.r, c.g, c.b);
        }
    const idx: number[] = [];
    for (let j = 0; j < nv; ++j)
        for (let i = 0; i < nu; ++i) {
            const a = j * (nu + 1) + i;
            const b = a + 1;
            const d = a + nu + 1;
            const e = d + 1;
            // Skip cells entirely under the sea floor clamp.
            if (Math.max(H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)) < -8.5) continue;
            idx.push(a, d, b, b, d, e);
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // Ensure upward winding.
    g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    let up = 0;
    for (let i = 0; i < nrm.count; ++i) up += nrm.getY(i);
    if (up < 0) {
        const ix = g.getIndex()!.array as unknown as number[];
        const flipped: number[] = [];
        for (let k = 0; k < ix.length; k += 3) flipped.push(ix[k]!, ix[k + 2]!, ix[k + 1]!);
        g.setIndex(flipped);
        g.computeVertexNormals();
    }
    return g;
}

/** Ground height at (u, v) for placing buildings: the max over a small footprint. */
const siteH = (u: number, v: number, r = 6) => Math.max(height(u, v), height(u + r, v), height(u - r, v), height(u, v + r), height(u, v - r));

export function buildAlcatraz(): Batch {
    const b = new Batch();
    b.add('rock', islandGeo());
    // Cellhouse on the crest, along the island.
    const cu = 22;
    const cv = -4;
    const cy = siteH(cu, cv, 20) - 0.5;
    const [cx, cz] = P(cu, cv);
    const cell: V2[] = [
        [-52, -17],
        [52, -17],
        [52, 17],
        [-52, 17],
    ].map(([u, v]) => P(cu + u!, cv + v!));
    b.add('deco', prism(cell, cy - 4, cy + 13, { tile: [4, 6.5], vBase: cy - 1 }));
    b.add('plain', box(104, 0.5, 34), { m: mat(cx, cy + 13, cz, RY), color: 0x8c8a84 });
    b.add('plain', box(96, 2.4, 10), { m: mat(cx, cy + 13.5, cz, RY), color: 0xa8a59c });
    b.add('glass', box(96.2, 1.2, 10.2), { m: mat(cx, cy + 14.1, cz, RY), color: 0x6f7c84 });
    // Administration wing at the south end of the cellhouse.
    const [awx, awz] = P(cu - 58, cv + 4);
    b.add('deco', box(12, 10, 26), { m: mat(awx, cy - 3, awz, RY), uv: 'box', tile: [4, 5] });
    // Lighthouse just south of the cellhouse.
    const lu = -44;
    const lv = 16;
    const ly = siteH(lu, lv) - 0.3;
    const [lx, lz] = P(lu, lv);
    b.add('plain', facetCyl(2.4, 3.1, 24, 8, false, Math.PI / 8), { m: mat(lx, ly, lz), color: 0xf4f1ea });
    b.add('metal', cyl(3.3, 3.3, 0.5, 12), { m: mat(lx, ly + 24, lz), color: 0x2b2b2b });
    b.add('glass', cyl(1.8, 1.8, 2.4, 10, true), { m: mat(lx, ly + 24.5, lz), color: 0xfff4c8 });
    b.add('lamp', sphere(0.8, 8, 6), { m: mat(lx, ly + 25.6, lz), color: 0xfff1b0 });
    b.add('metal', cone(2.2, 1.6, 10), { m: mat(lx, ly + 26.9, lz), color: 0x2b2b2b });
    // Warden's house ruin next to it.
    const [wx, wz] = P(-62, -6);
    const wy = siteH(-62, -6, 10);
    b.add('plain', box(18, 9, 13), { m: mat(wx, wy - 2, wz, RY), color: 0x9b8e7f });
    // Water tower on the north end.
    const tu = 150;
    const tv = -30;
    const ty = siteH(tu, tv) - 0.5;
    const [tx, tz] = P(tu, tv);
    for (const [du, dv] of [
        [-4, -4],
        [4, -4],
        [4, 4],
        [-4, 4],
    ] as const) {
        const [x, z] = P(tu + du, tv + dv);
        b.add('metal', cyl(0.35, 0.45, 18, 6), { m: mat(x, ty, z), color: 0x8f8a82 });
    }
    b.add('plain', cyl(6.2, 6.2, 9, 16), { m: mat(tx, ty + 18, tz), color: 0xd8d1c4 });
    b.add('plain', cone(6.6, 2.6, 16), { m: mat(tx, ty + 27, tz), color: 0x8a5a44 });
    // Power house + smokestack near the north-east shore.
    const pu = 185;
    const pv = 42;
    const py = siteH(pu, pv, 12) - 0.5;
    const [px, pz] = P(pu, pv);
    b.add('deco', box(22, 11, 16), { m: mat(px, py - 3, pz, RY), uv: 'box', tile: [4, 6] });
    const [sx, sz] = P(pu + 6, pv + 10);
    b.add('plain', cyl(1.2, 1.8, 30, 10), { m: mat(sx, py, sz), color: 0xb7aa98 });
    // Building 64 (the big barracks by the dock) and the dock.
    const bu = -205;
    const bv = 55;
    const [bx, bz] = P(bu, bv);
    b.add('deco', box(62, 16, 15), { m: mat(bx, -1, bz, RY), uv: 'box', tile: [4, 4.5] });
    b.add('plain', box(64, 0.6, 17), { m: mat(bx, 15, bz, RY), color: 0x8a847a });
    const [dx, dz] = P(-228, 78);
    b.add('plain', box(60, 3.2, 14), { m: mat(dx, -1.5, dz, RY), color: 0x9a948a });
    // Scattered lesser buildings (officers' row, ruins), on the terraces.
    const r = rng(19);
    for (let i = 0; i < 9; ++i) {
        const u = -150 + r() * 300;
        const v = (r() - 0.5) * 70;
        if (Math.abs(u - cu) < 60 && Math.abs(v - cv) < 22) continue;
        const [x, z] = P(u, v);
        const y = siteH(u, v, 8) - 1.5;
        if (y < 6) continue;
        b.add('plain', box(8 + r() * 10, 5 + r() * 5, 7 + r() * 6), { m: mat(x, y, z, RY + (r() < 0.5 ? 0 : Math.PI / 2)), color: r() < 0.5 ? 0xb9ae9c : 0x9d9385 });
    }
    return b;
}
