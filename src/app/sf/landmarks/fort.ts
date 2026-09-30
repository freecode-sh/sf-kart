/**
 * Fort Point: the brick casemate fort under the south end of the bridge. A trapezoid ring of
 * three casemate tiers around a parade ground, the barbette tier with its parapet on top, stair
 * towers, barracks chimneys and the Fort Point Light (iron skeleton tower with a lantern).
 *
 * Local frame: meters, origin at the fort's center on the ground, x east, z south. The long face
 * looks north-west to the Golden Gate. Everything stays within ~50 m of (30, -15), inside the
 * course's loop road.
 */

import * as THREE from 'three';
import { Batch, box, cap, cone, cyl, mat, offsetPoly, prism, sphere, strut, type V2 } from './kit';

export const FORT = { e: 33, n: -5 };

type LocalGround = (x: number, z: number) => number;

/** Fort plan coordinates: a along the front (toward NE), b toward the front (NW). → local (x, z). */
const S = Math.SQRT1_2;
const P = (a: number, b: number): V2 => [a * S - b * S, -(a * S + b * S)];

const OUTER: [number, number][] = [
    [-31, 21],
    [-23, -22],
    [23, -22],
    [31, 21],
];
/** Counterclockwise seen from above. */
const outerPoly = (): V2[] => OUTER.map(([a, b]) => P(a, b));

const TIER = 4.2;
const Y_T0 = 0.8; // floor of the first casemate tier
const Y_ROOF = Y_T0 + 3 * TIER; // barbette floor
const Y_PARA = Y_ROOF + 1.6;

const GRANITE = 0xb4b0a6;
const ROOF = 0x9b958a;
const IRON = 0x28332d;

function lighthouse(b: Batch, x: number, y: number, z: number): void {
    // Skeleton tower: six legs, rings, central stair column.
    const legs = 6;
    const h = 8.2;
    for (let i = 0; i < legs; ++i) {
        const a = (i / legs) * Math.PI * 2;
        const lo = new THREE.Vector3(x + 2.3 * Math.cos(a), y, z + 2.3 * Math.sin(a));
        const hi = new THREE.Vector3(x + 1.25 * Math.cos(a), y + h, z + 1.25 * Math.sin(a));
        const s = strut(lo, hi, 0.13, 5);
        b.add('metal', s.geo, { m: s.m, color: IRON });
        // Diagonal braces to the next leg.
        const a2 = ((i + 1) / legs) * Math.PI * 2;
        for (const t of [0, 0.5]) {
            const r0 = 2.3 - 1.05 * t;
            const r1 = 2.3 - 1.05 * (t + 0.5);
            const p0 = new THREE.Vector3(x + r0 * Math.cos(a), y + h * t, z + r0 * Math.sin(a));
            const p1 = new THREE.Vector3(x + r1 * Math.cos(a2), y + h * (t + 0.5), z + r1 * Math.sin(a2));
            const d = strut(p0, p1, 0.06, 4);
            b.add('metal', d.geo, { m: d.m, color: IRON });
        }
    }
    b.add('metal', cyl(0.45, 0.45, h, 8), { m: mat(x, y, z), color: IRON });
    // Gallery, lantern, roof, ventilator ball.
    b.add('metal', cyl(1.9, 1.9, 0.25, 16), { m: mat(x, y + h, z), color: IRON });
    b.add('metal', cyl(1.2, 1.2, 0.6, 12), { m: mat(x, y + h + 0.25, z), color: IRON });
    b.add('glass', cyl(1.1, 1.1, 1.5, 12, true), { m: mat(x, y + h + 0.85, z), color: 0xfff4c8 });
    b.add('lamp', sphere(0.45, 8, 6), { m: mat(x, y + h + 1.55, z), color: 0xfff1b0 });
    b.add('metal', cone(1.45, 1.1, 12), { m: mat(x, y + h + 2.35, z), color: IRON });
    b.add('metal', sphere(0.28, 8, 6), { m: mat(x, y + h + 3.5, z), color: IRON });
    // Gallery railing.
    b.add('metal', cyl(1.9, 1.9, 0.9, 16, true), { m: mat(x, y + h + 0.25, z), color: IRON });
}

export function buildFort(ground: LocalGround): Batch {
    const b = new Batch();
    const outer = outerPoly();
    const inner = offsetPoly(outer, -9.5);
    let gmin = 0;
    for (const p of outer) gmin = Math.min(gmin, ground(p[0], p[1]));
    // Granite foundation / seawall plinth.
    b.add('stone', prism(offsetPoly(outer, 0.5), gmin - 3, 1.3, { tile: [4, 4], top: true }), { color: GRANITE });
    // Casemate tiers outside and around the parade ground.
    b.add('brick', prism(outer, 1.3, Y_ROOF, { tile: [5, TIER], vBase: Y_T0 }));
    b.add('brick', prism(inner, 0.3, Y_ROOF, { tile: [5, TIER], vBase: Y_T0, inward: true }));
    // Granite string courses between the tiers.
    for (let t = 1; t <= 3; ++t) {
        const y = Y_T0 + t * TIER - 0.05;
        const band = offsetPoly(outer, 0.14);
        b.add('stone', prism(band, y, y + 0.3, { tile: [4, 4] }), { color: GRANITE });
        b.add('stone', cap(band, y + 0.3, true, 4, [[...outer].reverse()]), { color: GRANITE });
        b.add('stone', cap(band, y, false, 4, [[...outer].reverse()]), { color: GRANITE });
    }
    // Granite quoins at the outer corners.
    for (let i = 0; i < outer.length; ++i) {
        const [x, z] = outer[i]!;
        const [xp, zp] = outer[(i + outer.length - 1) % outer.length]!;
        const [xn, zn] = outer[(i + 1) % outer.length]!;
        const ry = (Math.atan2(-(zn - z), xn - x) + Math.atan2(-(z - zp), x - xp)) / 2;
        b.add('stone', box(1.6, Y_ROOF - 1.3, 1.6), { m: mat(x, 1.3, z, ry), uv: 'box', tile: [4, 4], color: GRANITE });
    }
    // Parade ground.
    b.add('stone', cap(offsetPoly(inner, 0.5), 0.3, true, 4), { color: 0x8f8a7e });
    // Barbette tier: floor ring and parapet (solid brick part of the texture: v in 0.02..0.22).
    b.add('stone', cap(outer, Y_ROOF, true, 4, [[...inner].reverse()]), { color: ROOF });
    const pin = offsetPoly(outer, -1.3);
    const vb = Y_ROOF - 0.02 * 7.3;
    b.add('brick', prism(outer, Y_ROOF, Y_PARA, { tile: [5, 7.3], vBase: vb }));
    b.add('brick', prism(pin, Y_ROOF, Y_PARA, { tile: [5, 7.3], vBase: vb, inward: true }));
    b.add('stone', cap(offsetPoly(outer, 0.15), Y_PARA, true, 4, [[...pin].reverse()]), { color: GRANITE });
    // Low parapet around the parade ground.
    const iin = offsetPoly(inner, 0.8);
    b.add('brick', prism(inner, Y_ROOF, Y_ROOF + 1.0, { tile: [5, 7.3], vBase: vb, inward: true }));
    b.add('brick', prism(iin, Y_ROOF, Y_ROOF + 1.0, { tile: [5, 7.3], vBase: vb }));
    b.add('stone', cap(iin, Y_ROOF + 1.0, true, 4, [[...inner].reverse()]), { color: GRANITE });
    // Stair towers at the four corners (inset into the barbette).
    for (const [a, bb] of [
        [-25, 15],
        [25, 15],
        [-19, -16],
        [19, -16],
    ] as const) {
        const [x, z] = P(a, bb);
        b.add('brick', box(4.4, 3.2, 4.4), { m: mat(x, Y_ROOF, z, Math.PI / 4), uv: 'box', tile: [5, 14], uvOffset: [0, 0.01] });
        b.add('stone', box(5.0, 0.4, 5.0), { m: mat(x, Y_ROOF + 3.2, z, Math.PI / 4), uv: 'box', tile: [4, 4], color: GRANITE });
    }
    // Barracks chimneys along the landward (gorge) side.
    for (let i = 0; i < 6; ++i) {
        const [x, z] = P(-17 + i * 6.8, -18.5);
        b.add('brick', box(1.3, 2.6, 1.8), { m: mat(x, Y_ROOF, z, Math.PI / 4), uv: 'box', tile: [5, 14], uvOffset: [0, 0.01] });
    }
    // Flagpole.
    {
        const [x, z] = P(0, -17);
        b.add('metal', cyl(0.07, 0.12, 11, 6), { m: mat(x, Y_ROOF, z), color: 0xdddddd });
    }
    // Fort Point Light on the west corner of the barbette.
    const [lx, lz] = P(-24.5, 12.5);
    lighthouse(b, lx, Y_ROOF, lz);
    return b;
}
