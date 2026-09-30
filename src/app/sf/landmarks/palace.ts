/**
 * Palace of Fine Arts: the octagonal Beaux-Arts rotunda (arched piers, paired Corinthian columns
 * with sculpture groups, drum with relief panels, the salmon/ochre dome) and the two curved wings
 * of the peristyle west of it, concave toward the lagoon, with the planter boxes and their
 * weeping-women figures.
 *
 * Local frame: meters, origin at the rotunda center on the ground, x east, z south.
 */

import * as THREE from 'three';
import { Batch, box, cyl, facetCyl, lathe, mat, prism, regPoly, sphere, type V2 } from './kit';

export const PALACE = { e: 2561, n: -844 };
/** Peristyle arc: center (east of the rotunda, in the lagoon), radius, wing extent (degrees from due west). */
const ARC = { cx: 107, cz: 0, r: 132, gap: 9, span: 50 };

type LocalGround = (x: number, z: number) => number;

/** Arc point (local x, z) at angle phi (radians; pi = due west of the arc center), radius r. */
const arcPt = (phi: number, r: number): V2 => [ARC.cx + r * Math.cos(phi), ARC.cz - r * Math.sin(phi)];

/** Closed polygon of an annular sector between radii r0 < r1 and angles a0 < a1. */
function sector(a0: number, a1: number, r0: number, r1: number, steps: number): V2[] {
    const outer: V2[] = [];
    const inner: V2[] = [];
    for (let i = 0; i <= steps; ++i) {
        const a = a0 + ((a1 - a0) * i) / steps;
        outer.push(arcPt(a, r1));
        inner.push(arcPt(a, r0));
    }
    return [...outer, ...inner.reverse()];
}

const deg = Math.PI / 180;
const wings = (): [number, number][] => [
    [(180 - ARC.span) * deg, (180 - ARC.gap) * deg],
    [(180 + ARC.gap) * deg, (180 + ARC.span) * deg],
];

// ------------------------------------------------------------------------------ model

const STONE = 0xeccca0;
const STONE_DARK = 0xd6b58a;
const STONE_GREY = 0xd8c9b0;
const RELIEF = 0xe0a27a;

function column(b: Batch, x: number, y: number, z: number, ry: number, shaftH: number, r: number): void {
    // Attic base: square plinth + round torus.
    b.add('stone', box(r * 2.6, 0.5, r * 2.6), { m: mat(x, y, z, ry), uv: 'box', tile: [4, 4], color: STONE });
    b.add('stone', cyl(r * 1.22, r * 1.3, 0.45, 20), { m: mat(x, y + 0.5, z, ry), uv: 'box', tile: [4, 4], color: STONE });
    // Fluted shaft with entasis (two stacked frustums).
    const y0 = y + 0.95;
    b.add('column', cyl(r * 0.97, r, shaftH * 0.4, 20, true), { m: mat(x, y0, z, ry), color: STONE, uvOffset: [0, 0] });
    b.add('column', cyl(r * 0.84, r * 0.97, shaftH * 0.6, 20, true), { m: mat(x, y0 + shaftH * 0.4, z, ry), color: STONE });
    // Corinthian capital: astragal, bell of leaves (two flared tiers), abacus.
    const yc = y0 + shaftH;
    b.add('stone', cyl(r * 0.95, r * 0.9, 0.2, 16), { m: mat(x, yc, z, ry), uv: 'box', tile: [4, 4], color: STONE });
    b.add('stone', facetCyl(r * 1.12, r * 0.88, r * 0.75, 12, false, Math.PI / 12), { m: mat(x, yc + 0.2, z, ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
    b.add('stone', facetCyl(r * 1.38, r * 1.08, r * 0.65, 8, false, Math.PI / 8), { m: mat(x, yc + 0.2 + r * 0.75, z, ry), uv: 'box', tile: [4, 4], color: STONE });
    b.add('stone', box(r * 2.7, r * 0.35, r * 2.7), { m: mat(x, yc + 0.2 + r * 1.4, z, ry), uv: 'box', tile: [4, 4], color: STONE });
}

/** Height of a column assembly from its base to the top of the abacus. */
const columnH = (shaftH: number, r: number) => 0.95 + shaftH + 0.2 + r * 1.75;

function figure(b: Batch, key: string, x: number, y: number, z: number, lean: number, ry: number, h: number, color: number): void {
    // Draped standing figure: tapered robe, shoulders, head; leaning by `lean` toward local -z.
    const m = mat(x, y, z, ry, 1, -lean);
    const robe = facetCyl(h * 0.1, h * 0.17, h * 0.78, 7);
    b.add(key, robe, { m, color, uv: 'box', tile: [4, 4] });
    const head = sphere(h * 0.085, 7, 5, true);
    b.add(key, head, { m: new THREE.Matrix4().multiplyMatrices(m, mat(0, h * 0.87, -h * 0.04, 0)), color, uv: 'box', tile: [4, 4] });
}

function rotunda(b: Batch, ground: LocalGround): void {
    // ---- rotunda ----
    const RW = 16.5; // wall mid-line circumradius
    const TH = 2.6; // wall thickness
    const Y0 = 1.8; // top of the plinth
    const YW = 25; // top of the arcade wall
    const oct = (r: number) => regPoly(r, 8, Math.PI / 8);
    const g0 = Math.min(-2.5, ground(0, 0) - 1);
    b.add('stone', prism(oct(23), g0, 0.6, { tile: [4, 4], top: true }), { color: STONE_GREY });
    b.add('stone', prism(oct(22), 0.6, 1.2, { tile: [4, 4], top: true }), { color: STONE_GREY });
    b.add('stone', prism(oct(21), 1.2, Y0, { tile: [4, 4], top: true }), { color: STONE_GREY });

    const side = 2 * RW * Math.sin(Math.PI / 8);
    const inR = RW * Math.cos(Math.PI / 8);
    const archW = 8.6;
    const spring = 13.2;
    const panel = new THREE.Shape();
    panel.moveTo(-side / 2, 0);
    panel.lineTo(-archW / 2, 0);
    panel.lineTo(-archW / 2, spring);
    panel.absarc(0, spring, archW / 2, Math.PI, 0, true);
    panel.lineTo(archW / 2, 0);
    panel.lineTo(side / 2, 0);
    panel.lineTo(side / 2, YW - Y0);
    panel.lineTo(-side / 2, YW - Y0);
    panel.closePath();
    const panelGeo = new THREE.ExtrudeGeometry(panel, { depth: TH, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -TH / 2);
    // Archivolt molding around the arch on the outer face.
    const av = new THREE.Shape();
    av.absarc(0, spring, archW / 2 + 0.9, 0, Math.PI, false);
    av.lineTo(-archW / 2, spring);
    av.absarc(0, spring, archW / 2, Math.PI, 0, true);
    av.closePath();
    const avGeo = new THREE.ExtrudeGeometry(av, { depth: 0.35, bevelEnabled: false, curveSegments: 14 });
    for (let k = 0; k < 8; ++k) {
        const th = (k * Math.PI) / 4;
        const cx = inR * Math.cos(th);
        const cz = -inR * Math.sin(th);
        const ry = th + Math.PI / 2;
        b.add('stone', panelGeo, { m: mat(cx, Y0, cz, ry), uv: 'box', tile: [4, 4], color: STONE });
        const ox = (inR + TH / 2) * Math.cos(th);
        const oz = -(inR + TH / 2) * Math.sin(th);
        b.add('stone', avGeo, { m: mat(ox, Y0, oz, ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
        // Relief panel on the drum above this arch.
        const dr = 15.5 * Math.cos(Math.PI / 8);
        b.add('stone', box(8.2, 3.8, 0.5), { m: mat(dr * Math.cos(th), 26.2, -dr * Math.sin(th), ry), uv: 'box', tile: [3, 3], color: RELIEF });
    }
    // Corner piers with paired columns, entablature blocks and sculpture groups.
    const cr = 0.78;
    const shaftH = 14.2;
    const colTop = Y0 + columnH(shaftH, cr);
    for (let k = 0; k < 8; ++k) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        const ca = Math.cos(a);
        const sa = -Math.sin(a);
        const ry = a + Math.PI / 2;
        b.add('stone', box(4.2, YW - Y0, 4.2), { m: mat(RW * ca, Y0, RW * sa, ry), uv: 'box', tile: [4, 4], color: STONE });
        const rc = RW + 3.1;
        // Tangent direction (perpendicular to the radius).
        const tx = -sa;
        const tz = ca;
        for (const s of [-1.35, 1.35]) column(b, rc * ca + tx * s, Y0, rc * sa + tz * s, ry, shaftH, cr);
        // Pilasters behind the columns.
        b.add('stone', box(4.8, colTop - Y0, 0.6), { m: mat((RW + 2.2) * ca, Y0, (RW + 2.2) * sa, ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
        // Entablature block over the pair.
        const eb = RW + 2.2;
        b.add('stone', box(5.6, 2.2, 4.4), { m: mat(eb * ca, colTop, eb * sa, ry), uv: 'box', tile: [4, 4], color: STONE });
        b.add('stone', box(6.3, 0.55, 5.1), { m: mat(eb * ca, colTop + 2.2, eb * sa, ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
        // Sculpture group: pedestal and three figures.
        const yS = colTop + 2.75;
        b.add('stone', box(4.4, 0.9, 3.0), { m: mat(eb * ca, yS, eb * sa, ry), uv: 'box', tile: [4, 4], color: STONE });
        for (const [s, h] of [
            [-1.3, 3.3],
            [0, 3.8],
            [1.3, 3.3],
        ] as const)
            figure(b, 'stone', eb * ca + tx * s + ca * 0.4, yS + 0.9, eb * sa + tz * s + sa * 0.4, 0.05, ry + Math.PI, h, STONE_DARK);
    }
    // Arcade cornice, drum, dome.
    b.add('stone', prism(oct(RW + 2.0), YW - 0.9, YW + 0.2, { tile: [4, 4], top: true, bottom: true }), { color: STONE_DARK });
    b.add('stone', prism(oct(15.5), YW + 0.2, 30.8, { tile: [4, 4], top: true, vBase: 0.4 }), { color: STONE });
    b.add('stone', prism(oct(16.4), 30.4, 31.3, { tile: [4, 4], top: true, bottom: true }), { color: STONE_DARK });
    b.add('stone', cyl(14.4, 14.6, 1.2, 32), { m: mat(0, 31.3, 0), uv: 'box', tile: [4, 4], color: STONE_DARK });
    const prof: V2[] = [];
    const DY = 32.5;
    for (let i = 0; i <= 16; ++i) {
        const t = (i / 16) * (Math.PI / 2);
        prof.push([14.1 * Math.cos(t), DY + 14.4 * Math.sin(t)]);
    }
    b.add('dome', lathe(prof, 32, -Math.PI / 2));
    // Oculus lantern and finial.
    b.add('stone', cyl(1.8, 2.0, 1.0, 16), { m: mat(0, DY + 14.1, 0), uv: 'box', tile: [4, 4], color: STONE_DARK });
    b.add('stone', lathe([[1.9, 0], [1.6, 0.8], [0.6, 1.5], [0.25, 2.2], [0.05, 3.0]], 12), { m: mat(0, DY + 15.1, 0), uv: 'box', tile: [4, 4], color: RELIEF });
}

function peristyle(b: Batch, ground: LocalGround): void {
    const R = ARC.r;
    const halfW = 2.3; // column rows at R +- halfW
    const cr = 0.62;
    const shaftH = 10.4;
    const colTop = 0.6 + columnH(shaftH, cr);
    const entH = 2.2;
    for (const [a0, a1] of wings()) {
        const steps = 40;
        // Podium (reaching down to the ground everywhere).
        let gmin = 0;
        for (let i = 0; i <= 8; ++i) {
            const p = arcPt(a0 + ((a1 - a0) * i) / 8, R);
            gmin = Math.min(gmin, ground(p[0], p[1]));
        }
        b.add('stone', prism(sector(a0 - 0.012, a1 + 0.012, R - 4.6, R + 4.6, steps), gmin - 2, 0.6, { tile: [4, 4], top: true }), { color: STONE_GREY });
        // Entablature band over both rows (architrave, frieze) and cornice.
        b.add('stone', prism(sector(a0, a1, R - halfW - 1.1, R + halfW + 1.1, steps), colTop, colTop + entH, { tile: [4, 4], top: true, bottom: true }), { color: STONE });
        b.add('stone', prism(sector(a0 - 0.004, a1 + 0.004, R - halfW - 1.8, R + halfW + 1.8, steps), colTop + entH, colTop + entH + 0.6, { tile: [4, 4], top: true, bottom: true }), { color: STONE_DARK });
        // Clusters of four columns with a planter box above.
        const len = (a1 - a0) * R;
        const nC = Math.max(2, Math.round(len / 10.5) + 1);
        for (let c = 0; c < nC; ++c) {
            const ac = a0 + ((a1 - a0) * c) / (nC - 1);
            const pc = arcPt(ac, R);
            const ry = ac; // local x axis along the radius
            // Along-arc unit (tangent) and radial unit, in (x, z).
            const rx = Math.cos(ac);
            const rz = -Math.sin(ac);
            const tx = -rz;
            const tz = rx;
            for (const s of [-1.3, 1.3])
                for (const q of [-halfW, halfW]) column(b, pc[0] + rx * q + tx * s, 0.6, pc[1] + rz * q + tz * s, ry, shaftH, cr);
            // Planter box with cornice, base molding and greenery.
            const yb = colTop + entH + 0.6;
            b.add('stone', box(7.4, 0.6, 5.6), { m: mat(pc[0], yb, pc[1], ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
            b.add('stone', box(6.6, 4.2, 4.8), { m: mat(pc[0], yb + 0.6, pc[1], ry), uv: 'box', tile: [3, 3], color: STONE });
            b.add('stone', box(7.2, 0.55, 5.4), { m: mat(pc[0], yb + 4.8, pc[1], ry), uv: 'box', tile: [4, 4], color: STONE_DARK });
            b.add('plain', box(6.0, 0.9, 4.2), { m: mat(pc[0], yb + 5.35, pc[1], ry), color: 0x5f7f3f });
            // Weeping women at the four corners, leaning in toward the box.
            for (const sa of [-1, 1])
                for (const sb of [-1, 1]) {
                    const fx = pc[0] + rx * sa * 3.9 + tx * sb * 2.8;
                    const fz = pc[1] + rz * sa * 3.9 + tz * sb * 2.8;
                    // Lean toward the box: local -z must point at (pc - f).
                    const ryF = Math.atan2(-(pc[0] - fx), -(pc[1] - fz));
                    figure(b, 'stone', fx, yb + 0.6, fz, 0.22, ryF, 3.9, STONE);
                }
        }
    }
}

/** The palace in local meters (origin at the rotunda on the ground). */
export function buildPalace(ground: LocalGround): Batch {
    const b = new Batch();
    rotunda(b, ground);
    peristyle(b, ground);
    return b;
}
