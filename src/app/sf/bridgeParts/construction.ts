/**
 * The "bridge work" dressing around the course's deck gap: striped barricades along
 * the opening's edges, hazard-striped cut ends and landing edge, cones, a catwalk, blinking amber
 * lights, warning signs on the approach, a crane barge in the bay beside the hole, and a support
 * bent under the boost ramp's lip. Everything stays out of the drivable volume (|lateral| < 2410 up
 * to 1800 above the road) except the median/edge barricades inside the usual barrier bands (<= 250
 * tall), the ramp bent, which stands under the ramp surface, and the landing paint (6 units thick).
 */

import * as THREE from 'three';
import { SEA_Y } from '../geo';
import { GeoBuilder } from './builder';
import { extrudeAlong, latDir } from './common';
import { M, deckY, frameAt, onDeck } from './frame';
import { boostKickers, deckGaps } from './features';
import { SLAB_HALF } from './layout';

type Parts = {
    orange: GeoBuilder;
    white: GeoBuilder;
    steel: GeoBuilder;
    yellow: GeoBuilder;
    dark: GeoBuilder;
    lightA: GeoBuilder;
    lightB: GeoBuilder;
    support: GeoBuilder;
};

function signTexture(lines: string[], diamond: boolean): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 512);
    const path = () => {
        g.beginPath();
        if (diamond) {
            g.moveTo(256, 8);
            g.lineTo(504, 256);
            g.lineTo(256, 504);
            g.lineTo(8, 256);
        } else g.rect(8, 120, 496, 272);
        g.closePath();
    };
    path();
    g.fillStyle = '#ff8a00';
    g.fill();
    g.lineWidth = 14;
    g.strokeStyle = '#111';
    g.lineJoin = 'round';
    path();
    g.stroke();
    g.fillStyle = '#111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = diamond ? 58 : 72;
    g.font = `900 ${size}px Arial Black, Arial, sans-serif`;
    lines.forEach((t, i) => g.fillText(t, 256, 256 + (i - (lines.length - 1) / 2) * size * 1.1));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

/** A striped board from a to b (world), split into alternating orange / white blocks. */
function stripedBoard(p: Parts, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, n: number, side: THREE.Vector3) {
    for (let k = 0; k < n; ++k) {
        const q0 = a.clone().lerp(b, k / n);
        const q1 = a.clone().lerp(b, (k + 1) / n);
        (k % 2 ? p.white : p.orange).beamSide(q0, q1, w, h, side);
    }
}

function cone(p: Parts, c: THREE.Vector3) {
    p.orange.column(c.clone(), 34, 7, 125, 8);
    p.white.column(c.clone().setY(c.y + 55), 22, 17, 26, 8, false);
    const base = new THREE.Matrix4().makeTranslation(c.x, c.y + 6, c.z);
    p.dark.add(new THREE.BoxGeometry(80, 12, 80), base);
}

export function buildConstruction(): THREE.Group | null {
    const gaps = deckGaps();
    const kickers = boostKickers();
    if (gaps.length === 0 && kickers.length === 0) return null;
    const origin = onDeck(0, 0);
    const p: Parts = {
        orange: new GeoBuilder(origin),
        white: new GeoBuilder(origin),
        steel: new GeoBuilder(origin),
        yellow: new GeoBuilder(origin),
        dark: new GeoBuilder(origin),
        lightA: new GeoBuilder(origin),
        lightB: new GeoBuilder(origin),
        support: new GeoBuilder(origin),
    };
    const g = new THREE.Group();
    g.name = 'bridge-work';
    const signs: { tex: THREE.Texture | null; geo: THREE.BufferGeometry }[] = [];

    for (const gap of gaps) {
        const sg = gap.side;
        const L = (l: number) => sg * l;
        const at = (s: number, l: number, dy: number) => onDeck(s, L(l), dy);
        const lat = latDir((gap.s0 + gap.s1) / 2);
        const P = (pts: [number, number][]) => (sg > 0 ? pts : pts.map(([l, h]) => [-l, h] as [number, number]).reverse());

        // Catwalk over the outer truss, with a toe board.
        extrudeAlong(p.steel, P([
            [2440, -70],
            [3320, -70],
            [3320, -25],
            [2440, -25],
        ]), gap.s0, gap.s1, 450);
        extrudeAlong(p.steel, P([
            [3300, -25],
            [3330, -25],
            [3330, 60],
            [3300, 60],
        ]), gap.s0, gap.s1, 450);
        // Catwalk hangers down to the truss.
        for (let s = gap.s0 + 150; s < gap.s1; s += 600) for (const l of [2480, 3280]) p.steel.beamSide(at(s, l, -70), at(s, l, -190), 30, 30, lat);

        // Hazard stripes on the cut ends of the deck slab.
        for (const [s, d] of [
            [gap.s0, 1],
            [gap.s1, -1],
        ] as const) {
            const n = Math.round((SLAB_HALF - 150) / 160);
            for (let k = 0; k < n; ++k) {
                const l0 = 150 + ((SLAB_HALF - 150) * k) / n;
                const l1 = 150 + ((SLAB_HALF - 150) * (k + 1)) / n;
                (k % 2 ? p.dark : p.yellow).beamSide(at(s + d * 6, l0, -92), at(s + d * 6, l1, -92), 14, 94, new THREE.Vector3(0, 1, 0).cross(lat).normalize());
            }
        }

        // The landing edge, painted across the road in hazard stripes (a flat 6-unit strip), so the
        // far side of the hole reads from the air.
        {
            const land = sg > 0 ? gap.s1 : gap.s0;
            const mid = land + sg * 75;
            const along = new THREE.Vector3().subVectors(onDeck(mid + 10, 0), onDeck(mid - 10, 0)).normalize();
            const n = 14;
            for (let k = 0; k < n; ++k) {
                const l0 = 130 + ((2400 - 130) * k) / n;
                const l1 = 130 + ((2400 - 130) * (k + 1)) / n;
                (k % 2 ? p.dark : p.yellow).beamSide(at(mid, l0, 4), at(mid, l1, 4), 150, 6, along);
            }
        }

        // Barricades: along the outer edge (in the railing band) and on the median's face.
        let phase = 0;
        for (let s = gap.s0 + 180; s < gap.s1 - 100; s += 380) {
            // Outer edge, standing on the catwalk.
            for (const ds of [-140, 140]) p.steel.beamSide(at(s + ds, 2515, -25), at(s + ds, 2515, 228), 26, 26, lat);
            for (const [h0, h1] of [
                [95, 140],
                [170, 215],
            ] as const)
                stripedBoard(p, at(s - 170, 2500, (h0 + h1) / 2), at(s + 170, 2500, (h0 + h1) / 2), 18, h1 - h0, 5, lat);
            // Median face (just inside the barrier band).
            for (const ds of [-140, 140]) p.steel.beamSide(at(s + ds, 100, 30), at(s + ds, 100, 190), 12, 18, lat);
            stripedBoard(p, at(s - 170, 100, 105), at(s + 170, 100, 105), 12, 40, 5, lat);
            stripedBoard(p, at(s - 170, 100, 165), at(s + 170, 100, 165), 12, 40, 5, lat);
            // Blinking amber lamps, alternating phases.
            const la = phase++ % 2 ? p.lightA : p.lightB;
            const lb = la === p.lightA ? p.lightB : p.lightA;
            const f = frameAt(s);
            const y = deckY(s, L(2515));
            la.box(f, -140 - 24, -140 + 24, L(2515) - 24, L(2515) + 24, y + 228, y + 248);
            lb.box(f, 140 - 24, 140 + 24, L(2515) - 24, L(2515) + 24, y + 228, y + 248);
            const ym = deckY(s, 0);
            la.box(f, -30, 30, L(0) - 30, L(0) + 30, ym + 200, ym + 238);
        }
        // Cones: along the catwalk and at the sidewalk ends by the cut.
        for (let s = gap.s0 + 400; s < gap.s1 - 200; s += 700) cone(p, at(s, 2950, -25));
        for (const s of [gap.s0 - 90, gap.s0 - 300, gap.s1 + 90, gap.s1 + 300]) for (const l of [2750, 3050, 3300]) cone(p, at(s, l, 22));
        // Barricades across the sidewalk ends.
        for (const s of [gap.s0 - 40, gap.s1 + 40]) {
            const side = new THREE.Vector3().subVectors(onDeck(s + 10, 0), onDeck(s - 10, 0)).normalize();
            for (const l of [2620, 3420]) p.steel.beamSide(at(s, l, 22), at(s, l, 230), 26, 26, side);
            stripedBoard(p, at(s, 2610, 120), at(s, 3430, 120), 18, 45, 5, side);
            stripedBoard(p, at(s, 2610, 195), at(s, 3430, 195), 18, 45, 5, side);
            const f = frameAt(s);
            const y = deckY(s, L(3000));
            p.lightA.box(f, -24, 24, L(2620) - 24, L(2620) + 24, y + 230, y + 252);
            p.lightB.box(f, -24, 24, L(3420) - 24, L(3420) + 24, y + 230, y + 252);
        }

        // Warning signs on the approach (on the sidewalk, facing oncoming traffic).
        const dir = sg; // direction of travel in s on this carriageway
        const start = dir > 0 ? gap.s0 : gap.s1;
        const signAt = (sOff: number, lines: string[], diamond: boolean, size: number) => {
            const s = start - dir * sOff;
            const base = at(s, 3020, 22);
            const f = frameAt(s);
            const N = f.u.clone().multiplyScalar(-dir);
            const X = new THREE.Vector3(0, 1, 0).cross(N).normalize();
            // Low on stout posts (high up on thin ones it read as floating from the other deck).
            const cy = base.y + 260 + size / 2;
            const center = base.clone().setY(cy);
            const m = new THREE.Matrix4().makeBasis(X, new THREE.Vector3(0, 1, 0), N).setPosition(center);
            const plane = new THREE.PlaneGeometry(size, size).applyMatrix4(m);
            signs.push({ tex: signTexture(lines, diamond), geo: plane });
            // Back plate and posts.
            const back = new THREE.Shape();
            const r = size / 2 - 6;
            if (diamond) {
                back.moveTo(0, r);
                back.lineTo(r, 0);
                back.lineTo(0, -r);
                back.lineTo(-r, 0);
            } else {
                back.moveTo(-r, -r * 0.53);
                back.lineTo(r, -r * 0.53);
                back.lineTo(r, r * 0.53);
                back.lineTo(-r, r * 0.53);
            }
            const bg = new THREE.ShapeGeometry(back);
            bg.rotateY(Math.PI);
            p.steel.add(bg, new THREE.Matrix4().makeBasis(X, new THREE.Vector3(0, 1, 0), N).setPosition(center.clone().addScaledVector(N, -8)));
            for (const o of [-size * 0.28, size * 0.28]) {
                const q = base.clone().addScaledVector(X, o).addScaledVector(N, -14);
                p.steel.beamSide(q, q.clone().setY(cy - (diamond ? size * 0.2 : size * 0.1)), 60, 60, X);
            }
            // A blinker on top of each sign.
            const top = center.clone().setY(cy + (diamond ? size / 2 : size * 0.27) + 20);
            p.lightA.add(new THREE.SphereGeometry(28, 8, 6), new THREE.Matrix4().makeTranslation(top.x, top.y, top.z));
        };
        signAt(220 * M, ['BRIDGE', 'WORK', 'AHEAD'], true, 700);
        signAt(90 * M, ['MIND', 'THE GAP!'], false, 640);

        // The crane barge in the bay beside the hole.
        const sc = (gap.s0 + gap.s1) / 2 + 8 * M;
        const fb = frameAt(sc);
        const lb = L(9800);
        const hullTop = SEA_Y + 200;
        p.dark.box(fb, -2600, 2600, lb - 1300, lb + 1300, SEA_Y - 150, hullTop);
        p.orange.box(fb, -2610, 2610, lb - 1310, lb + 1310, SEA_Y + 60, SEA_Y + 110);
        p.steel.box(fb, -1400, 400, lb - 900, lb + 900, hullTop, hullTop + 160);
        p.yellow.box(fb, 800, 2200, lb - 700, lb + 700, hullTop, hullTop + 420);
        // Tower: four chords + X bracing.
        const towerTop = deckY(sc, L(3000)) + 2600;
        const tu = 0;
        const tl = lb;
        const hw = 190;
        const corners = [
            [-hw, -hw],
            [hw, -hw],
            [hw, hw],
            [-hw, hw],
        ] as const;
        for (const [du, dl] of corners) p.yellow.beamSide(fb.p(tu + du, tl + dl, hullTop + 160), fb.p(tu + du, tl + dl, towerTop), 50, 50, fb.u);
        const step = 420;
        for (let y = hullTop + 160; y + step <= towerTop; y += step)
            for (let k = 0; k < 4; ++k) {
                const [a0, b0] = corners[k]!;
                const [a1, b1] = corners[(k + 1) % 4]!;
                p.yellow.beamSide(fb.p(tu + a0, tl + b0, y), fb.p(tu + a1, tl + b1, y + step), 22, 22, fb.u);
                p.yellow.beamSide(fb.p(tu + a0, tl + b0, y + step), fb.p(tu + a1, tl + b1, y + step), 22, 22, fb.u);
            }
        // Slewing deck, cab, A-frame.
        p.yellow.box(fb, tu - 320, tu + 320, tl - 320, tl + 320, towerTop, towerTop + 120);
        p.white.box(fb, tu - 150, tu + 250, tl - 60 * sg - 200, tl - 60 * sg + 200, towerTop - 330, towerTop);
        p.dark.box(fb, tu + 250, tu + 256, tl - 60 * sg - 170, tl - 60 * sg + 170, towerTop - 250, towerTop - 60);
        const apex = fb.p(tu, tl, towerTop + 900);
        for (const du of [-200, 200]) p.yellow.beamSide(fb.p(tu + du, tl, towerTop + 120), apex, 40, 40, fb.u);
        // Jib toward the bridge (triangular lattice), counter-jib the other way.
        const tipL = L(4300);
        const jibY = towerTop + 60;
        const jibLen = Math.abs(tl - tipL);
        const jn = Math.round(jibLen / 380);
        const J = (t: number, du: number, dy: number) => fb.p(tu + du, tl + (tipL - tl) * t, jibY + dy);
        for (const [du, dy] of [
            [-130, 0],
            [130, 0],
            [0, 220],
        ] as const)
            p.yellow.beamSide(J(0, du, dy), J(1, du * 0.4, dy * 0.4), 34, 34, fb.u);
        for (let k = 0; k < jn; ++k) {
            const t0 = k / jn;
            const t1 = (k + 1) / jn;
            const sc0 = 1 - 0.6 * t0;
            const sc1 = 1 - 0.6 * t1;
            p.yellow.beamSide(J(t0, -130 * sc0, 0), J(t1, 0, 220 * sc1), 16, 16, fb.u);
            p.yellow.beamSide(J(t0, 130 * sc0, 0), J(t1, 0, 220 * sc1), 16, 16, fb.u);
            p.yellow.beamSide(J(t1, -130 * sc1, 0), J(t1, 130 * sc1, 0), 16, 16, fb.u);
        }
        const cjL = tl + (tl - tipL) * 0.36;
        p.yellow.box(fb, tu - 140, tu + 140, Math.min(tl, cjL), Math.max(tl, cjL), jibY - 40, jibY + 60);
        p.steel.box(fb, tu - 200, tu + 200, Math.min(cjL, cjL + sg * 500), Math.max(cjL, cjL + sg * 500), jibY - 380, jibY + 60);
        const tip = J(1, 0, 90);
        p.dark.beam(apex, tip, 10, 10);
        p.dark.beam(apex, fb.p(tu, cjL, jibY + 60), 10, 10);
        // Trolley, hook line and a dangling beam (orange, it is a bridge part after all).
        const hookL = tl + (tipL - tl) * 0.93;
        const hookY = deckY(sc, L(3000)) + 520;
        p.dark.box(fb, tu - 90, tu + 90, hookL - 90, hookL + 90, jibY - 60, jibY);
        p.dark.beam(fb.p(tu, hookL, jibY - 60), fb.p(tu, hookL, hookY + 170), 8, 8);
        p.yellow.box(fb, tu - 60, tu + 60, hookL - 50, hookL + 50, hookY + 90, hookY + 170);
        p.dark.beam(fb.p(tu, hookL, hookY + 90), fb.p(tu - 420, hookL, hookY + 20), 6, 6);
        p.dark.beam(fb.p(tu, hookL, hookY + 90), fb.p(tu + 420, hookL, hookY + 20), 6, 6);
        p.steel.box(fb, tu - 480, tu + 480, hookL - 45, hookL + 45, hookY - 110, hookY + 20);
        p.lightB.add(new THREE.SphereGeometry(55, 10, 8), new THREE.Matrix4().makeTranslation(apex.x, apex.y + 40, apex.z));
        p.lightA.add(new THREE.SphereGeometry(40, 10, 8), new THREE.Matrix4().makeTranslation(tip.x, tip.y + 20, tip.z));
    }

    // Support bents under the boost ramp's lip (inside the ramp's own volume).
    for (const k of kickers) {
        const dir = k.side;
        const lat = latDir(k.lipS);
        const hw = k.width / 2 - 70;
        const bent = (s: number, h: number) => {
            const lo = k.lc - hw;
            const hi = k.lc + hw;
            for (const l of [lo, (lo + hi) / 2, hi]) p.support.beamSide(onDeck(s, l, 0), onDeck(s, l, h), 60, 60, lat);
            p.support.beam(onDeck(s, lo, h - 30), onDeck(s, hi, h - 30), 50, 60);
            p.support.beam(onDeck(s, lo, h * 0.45), onDeck(s, hi, h * 0.45), 40, 40);
            for (const [a, b] of [
                [lo, (lo + hi) / 2],
                [(lo + hi) / 2, hi],
            ] as const) {
                p.support.beam(onDeck(s, a, 20), onDeck(s, b, h - 60), 30, 30);
                p.support.beam(onDeck(s, b, 20), onDeck(s, a, h - 60), 30, 30);
            }
        };
        const len = Math.abs(k.lipS - k.s0) || 2400;
        const s1 = k.lipS - dir * 30;
        const s2 = k.lipS - dir * len * 0.28;
        bent(s1, k.lipH - 60);
        bent(s2, k.lipH * 0.72 * 0.72 - 50);
        for (const l of [k.lc - hw, k.lc + hw]) p.support.beam(onDeck(s2, l, (k.lipH * 0.72 * 0.72 - 50) * 0.5), onDeck(s1, l, (k.lipH - 60) * 0.5), 40, 40);
    }

    // Materials.
    const mat = (color: string, opts: { rough?: number; metal?: number } = {}) =>
        new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.05 });
    const lightMat = () => new THREE.MeshStandardMaterial({ color: '#ffb300', emissive: '#ffa200', emissiveIntensity: 2.5, roughness: 0.3 });
    const lampA = lightMat();
    const lampB = lightMat();
    const add = (b: GeoBuilder, m: THREE.Material, name: string, cast = true) => {
        if (b.triangles === 0) return;
        const mesh = new THREE.Mesh(b.geometry(), m);
        mesh.name = name;
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        g.add(mesh);
    };
    add(p.orange, mat('#ff6311'), 'work-orange');
    add(p.white, mat('#f6f4ee'), 'work-white');
    add(p.steel, mat('#6f757c', { metal: 0.3, rough: 0.55 }), 'work-steel');
    add(p.yellow, mat('#f0b400', { metal: 0.15, rough: 0.5 }), 'work-yellow');
    add(p.dark, mat('#1f2328'), 'work-dark');
    add(p.support, mat('#8a8f96', { metal: 0.3, rough: 0.5 }), 'ramp-support');
    add(p.lightA, lampA, 'work-lights-a', false);
    add(p.lightB, lampB, 'work-lights-b', false);
    for (const sgn of signs) {
        const m = new THREE.Mesh(sgn.geo, sgn.tex ? new THREE.MeshStandardMaterial({ map: sgn.tex, transparent: true, alphaTest: 0.5, roughness: 0.5 }) : mat('#ff8a00'));
        m.name = 'work-sign';
        g.add(m);
    }
    const setLamp = (m: THREE.MeshStandardMaterial, on: boolean) => {
        m.emissiveIntensity = on ? 3 : 0.08;
    };
    g.userData.update = (t: number) => {
        const on = Math.floor(t * 2.4) % 2 === 0;
        setLamp(lampA, on);
        setLamp(lampB, !on);
    };
    (g.userData.update as (t: number) => void)(0);
    return g;
}
