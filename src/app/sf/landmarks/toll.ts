/**
 * Golden Gate Bridge toll plaza: in the median between the course's two carriageways, a flat
 * canopy over a row of toll-booth islands (lamps underneath, lane signals on the fascia), the
 * Art-Deco administration building further south in the widening median, and lamp posts.
 * Nothing is built over the roads: every piece is kept >= 3.5 m outside the road corridors.
 *
 * Local frame: meters, origin at TOLL on the ground, x east, z south.
 */

import * as THREE from 'three';
import { Batch, box, cap, cyl, mat, prism, type V2 } from './kit';

export const TOLL = { e: 180, n: -390 };

/** Course carriageway centerlines (meters e/n, from the baked path) and their half width incl. walls. */
const NB: V2[] = [
    [290, -432],
    [268, -410],
    [245, -391],
    [225, -372],
    [204, -351],
    [184, -332],
    [160, -309],
    [140, -290],
];
const SB: V2[] = [
    [80, -330],
    [99, -354],
    [113, -373],
    [130, -394],
    [145, -413],
    [163, -433],
    [182, -452],
    [205, -475],
    [230, -500],
];
const ROAD_HALF = 19.5;
const MARGIN = 5;

/** Unit vector along the plaza toward the bridge (NW) and across it (toward NE), e/n. */
const U: V2 = (() => {
    const a = [-0.716, 0.698];
    const b = [-0.625, 0.781];
    const l = Math.hypot(a[0]! + b[0]!, a[1]! + b[1]!);
    return [(a[0]! + b[0]!) / l, (a[1]! + b[1]!) / l];
})();
const Pp: V2 = [U[1], -U[0]];

function segDist(p: V2, a: V2, b: V2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const lineDist = (p: V2, l: V2[]) => Math.min(...l.slice(1).map((b, i) => segDist(p, l[i]!, b)));

/** Median at `s` meters along U from TOLL: its center (e/n) and free half-width. */
function median(s: number): { c: V2; half: number } {
    const base: V2 = [TOLL.e + U[0] * s, TOLL.n + U[1] * s];
    let lo = -60;
    let hi = 60;
    const at = (t: number): V2 => [base[0] + Pp[0] * t, base[1] + Pp[1] * t];
    // f(t) = dNB - dSB decreases toward NB (+Pp side).
    for (let i = 0; i < 40; ++i) {
        const mid = (lo + hi) / 2;
        const p = at(mid);
        if (lineDist(p, NB) - lineDist(p, SB) > 0) lo = mid;
        else hi = mid;
    }
    const c = at((lo + hi) / 2);
    return { c, half: lineDist(c, NB) - ROAD_HALF - MARGIN };
}

/** Local (x, z) of a point s along the plaza and t across it (from the median center at s). */
function local(s: number, t: number): V2 {
    const m = median(s);
    return [m.c[0] + Pp[0] * t - TOLL.e, -(m.c[1] + Pp[1] * t - TOLL.n)];
}
/** Rotation so that local box x runs across the plaza (Pp) and z along it (-U). */
const RY = Math.atan2(-(-Pp[1]), Pp[0]);

const CANOPY_S = 6;
const CANOPY_D = 16;
const ADMIN_S = -42;

type LocalGround = (x: number, z: number) => number;

/** Lowest local ground under a rectangle (half sizes along/across) centered at (s, t). */
function groundUnder(ground: LocalGround, s: number, t: number, hs: number, ht: number): number {
    let g = Infinity;
    for (const ds of [-hs, 0, hs])
        for (const dt of [-ht, 0, ht]) {
            const p = local(s + ds, t + dt);
            g = Math.min(g, ground(p[0], p[1]));
        }
    return g;
}

function build(b: Batch, ground: LocalGround): void {
    const cm = median(CANOPY_S);
    const half = Math.min(cm.half, 22);
    // ---- canopy over the booth islands ----
    const y0 = groundUnder(ground, CANOPY_S, 0, CANOPY_D / 2, half);
    const gTop = ground(...local(CANOPY_S, 0));
    const clear = 6.2;
    const [cx, cz] = local(CANOPY_S, 0);
    const yc = gTop + clear;
    // Plaza pad under everything (concrete), reaching down to the lowest ground.
    b.add('plain', box(half * 2 - 1, gTop - y0 + 1.2, CANOPY_D + 30), { m: mat(cx, y0 - 1, cz, RY), color: 0xa9a7a0 });
    // Slab + fascia (white with an International Orange band).
    b.add('plain', box(half * 2, 0.7, CANOPY_D), { m: mat(cx, yc + 0.6, cz, RY), color: 0xf2f0ea });
    b.add('plain', box(half * 2 + 0.6, 0.6, CANOPY_D + 0.6), { m: mat(cx, yc, cz, RY), color: 0xe9e6de });
    b.add('plain', box(half * 2 + 0.7, 0.35, CANOPY_D + 0.7), { m: mat(cx, yc + 0.3, cz, RY), color: 0xc0362c });
    b.add('plain', box(half * 2 - 1, 0.3, CANOPY_D - 1), { m: mat(cx, yc + 1.3, cz, RY), color: 0x8d8f91 });
    // Sign boards on both long sides of the canopy (facing the approaching traffic).
    for (const e of [-1, 1]) {
        const [sx, sz] = local(CANOPY_S + e * (CANOPY_D / 2 + 0.36), 0);
        const sign = new THREE.PlaneGeometry(Math.min(24, half * 2 - 4), 1.35);
        // Plane faces +z; box local z runs along -U, so e = +1 (toward the bridge) needs a flip.
        b.add('sign', sign, { m: mat(sx, yc + 1.95, sz, RY + (e > 0 ? Math.PI : 0)) });
        const [bx, bz] = local(CANOPY_S + e * (CANOPY_D / 2 + 0.16), 0);
        b.add('plain', box(Math.min(24, half * 2 - 4) + 0.4, 1.55, 0.3), { m: mat(bx, yc + 1.2, bz, RY), color: 0xe9e6de });
    }
    // Underside lamps: a grid of panels.
    const lampsX = Math.max(3, Math.floor((half * 2) / 5));
    for (let i = 0; i < lampsX; ++i)
        for (let j = 0; j < 3; ++j) {
            const t = -half + ((i + 0.5) * half * 2) / lampsX;
            const s = CANOPY_S + (j - 1) * (CANOPY_D / 3.2);
            const [x, z] = local(s, t);
            b.add('lamp', box(2.2, 0.08, 1.0), { m: mat(x, yc - 0.06, z, RY), color: 0xfff6dd });
        }
    // Booth islands with columns carrying the canopy.
    const islands = Math.max(2, Math.floor((half * 2) / 9.5));
    for (let i = 0; i < islands; ++i) {
        const t = -half + 3 + ((half * 2 - 6) * i) / (islands - 1);
        const [x, z] = local(CANOPY_S, t);
        const g = ground(x, z);
        const isl = 2.4;
        const len = CANOPY_D + 10;
        b.add('plain', box(isl, 0.3 + (g - y0) + 1, len), { m: mat(x, y0 - 1, z, RY), color: 0xc9c6bd });
        // Yellow-striped nose at both ends + bollards.
        for (const e of [-1, 1]) {
            const [nx, nz] = local(CANOPY_S + e * (len / 2 - 0.9), t);
            b.add('plain', box(isl + 0.1, 0.5, 1.8), { m: mat(nx, g, nz, RY), color: 0xe8c21f });
            const [bx, bz] = local(CANOPY_S + e * (len / 2 - 2.8), t);
            b.add('plain', cyl(0.2, 0.2, 1.1, 8), { m: mat(bx, g + 0.3, bz), color: 0xe8c21f });
        }
        // Booth.
        b.add('plain', box(1.9, 0.9, 3.4), { m: mat(x, g + 0.3, z, RY), color: 0xe8e4d8 });
        b.add('glass', box(1.95, 1.2, 3.45), { m: mat(x, g + 1.2, z, RY), color: 0x9fb4c0 });
        b.add('plain', box(2.2, 0.35, 3.8), { m: mat(x, g + 2.4, z, RY), color: 0xf2efe6 });
        // Columns (two per island).
        for (const e of [-1, 1]) {
            const [px, pz] = local(CANOPY_S + e * (CANOPY_D / 2 - 2), t);
            b.add('metal', cyl(0.28, 0.28, yc - g, 10), { m: mat(px, g, pz), color: 0xe8e8e8 });
        }
        // Lane signals on the fascia (green arrows NW-facing, red X SE-facing).
        for (const e of [-1, 1]) {
            const [sx, sz] = local(CANOPY_S + e * (CANOPY_D / 2 + 0.4), t);
            b.add('lamp', box(0.9, 0.7, 0.12), { m: mat(sx, yc - 0.9, sz, RY), color: e > 0 ? 0x40ff70 : 0xff3030 });
            b.add('metal', box(1.1, 0.9, 0.25), { m: mat(sx, yc - 1.0, sz, RY), color: 0x222222 });
        }
    }
    // ---- administration building ----
    const am = median(ADMIN_S);
    const aw = Math.min(8, am.half - 1); // half width across
    const al = 16; // half length along
    const ag = groundUnder(ground, ADMIN_S, 0, al, aw);
    const [ax, az] = local(ADMIN_S, 0);
    const H = 8.4;
    const top = ground(ax, az) + H;
    b.add('stone', box(aw * 2 + 0.8, ground(ax, az) - ag + 1.6, al * 2 + 0.8), { m: mat(ax, ag - 1, az, RY), uv: 'box', tile: [4, 4], color: 0xcfc8b8 });
    const body = rectPoly(ax, az, aw, al);
    b.add('deco', prism(body, ground(ax, az) + 0.6, top, { tile: [3.5, 4], vBase: ground(ax, az) + 0.6 }));
    b.add('plain', cap(body, top, true, 4), { color: 0x9a978f });
    // Stepped parapet and the central tower with vertical fins.
    b.add('plain', prism(rectPoly(ax, az, aw + 0.25, al + 0.25), top - 0.2, top + 0.9, { tile: [4, 4], top: true }), { color: 0xf3ecd9 });
    const tw = rectPoly(ax, az, aw * 0.45, 4.5);
    b.add('deco', prism(tw, top, top + 5.5, { tile: [3.5, 4], vBase: top + 0.3 }));
    b.add('plain', prism(rectPoly(ax, az, aw * 0.45 + 0.3, 4.8), top + 5.5, top + 6.3, { tile: [4, 4], top: true }), { color: 0xf3ecd9 });
    b.add('plain', prism(rectPoly(ax, az, aw * 0.28, 3.0), top + 6.3, top + 7.6, { tile: [4, 4], top: true }), { color: 0xf3ecd9 });
    for (const e of [-1, 1])
        for (let f = -2; f <= 2; ++f) {
            const [fx, fz] = local(ADMIN_S + f * 1.7, e * (aw * 0.45 + 0.2));
            b.add('plain', box(0.35, 7.2, 0.5), { m: mat(fx, top - 1.2, fz, RY + Math.PI / 2), color: 0xf6f0e0 });
        }
    // Entrance canopy and a flagpole.
    const [ex, ez] = local(ADMIN_S + al + 1.5, 0);
    b.add('plain', box(6, 0.4, 3), { m: mat(ex, ground(ax, az) + 3.4, ez, RY), color: 0xc0362c });
    const [fx, fz] = local(ADMIN_S + al + 4, 3);
    b.add('metal', cyl(0.07, 0.12, 12, 6), { m: mat(fx, ground(ax, az), fz), color: 0xdddddd });
    // ---- lamp posts along the median edges ----
    for (const s of [30, -14, -70]) {
        const m = median(s);
        for (const e of [-1, 1]) {
            const t = e * (m.half - 1.5);
            const [x, z] = local(s, t);
            const g = ground(x, z);
            b.add('metal', cyl(0.12, 0.2, 11, 8), { m: mat(x, g, z), color: 0x8a8d90 });
            const [ax2, az2] = local(s, t + e * 2.2);
            b.add('metal', box(2.4, 0.18, 0.18), { m: mat((x + ax2) / 2, g + 10.8, (z + az2) / 2, RY), color: 0x8a8d90 });
            b.add('lamp', box(0.9, 0.2, 0.5), { m: mat(ax2, g + 10.65, az2, RY), color: 0xfff3d0 });
        }
    }
}

/** Rectangle polygon (ccw from above) centered at local (x, z), half sizes across (Pp) / along (U). */
function rectPoly(x: number, z: number, hw: number, hl: number): V2[] {
    const ax: V2 = [Pp[0], -Pp[1]];
    const al: V2 = [U[0], -U[1]];
    const pts: V2[] = [
        [-hw, -hl],
        [hw, -hl],
        [hw, hl],
        [-hw, hl],
    ].map(([a, l]) => [x + ax[0] * a! + al[0] * l!, z + ax[1] * a! + al[1] * l!]);
    return pts;
}

export function buildToll(ground: LocalGround): Batch {
    const b = new Batch();
    build(b, ground);
    return b;
}
