/**
 * The Golden Gate Bridge model: Art Deco towers with fluted legs, stepped setbacks and portal
 * struts, catenary main cables with bands and paired suspender ropes, the deep stiffening truss and
 * floor system, the Fort Point arch, concrete pylons / anchorages / piers, railings and lamps.
 * Everything is merged per material (or instanced) in world space.
 */

import * as THREE from 'three';
import { worldY } from '../geo';
import { GeoBuilder } from './builder';
import { extrudeAlong, extrudeNosed, instanced, latDir, segMatrix, stations } from './common';
import { Frame, LEN, M, at, deckTop, deckY, frameAt, onDeck, sideRange } from './frame';
import {
    ARCH,
    ARCH_TOP_CHORD,
    BARRIER_OUT,
    CABLE_L,
    LEG_BASE,
    LEG_IN,
    LEG_SECTIONS,
    MEDIAN_HALF,
    N1,
    N_ANCH_END,
    PANEL,
    PYLON_IN,
    ROAD_EDGE,
    S1,
    S2,
    SLAB_HALF,
    S_MARIN,
    S_SF,
    TOWER_CLEAR,
    TRUSS_BOT,
    TRUSS_TOP,
    UP_M,
    VIADUCT_BENTS,
    WALK_OUT,
    archY,
    legSize,
    strutLevels,
    cableSpec,
    stretchY,
    cableY,
    blocked,
    freeRanges,
    suspenderStations,
    trussSpans,
} from './layout';
import { cutGaps, inGap, overlapsGap } from './features';
import { concreteTextures, paintTextures } from './textures';
import { weatherConcrete } from '../weathering';
import { chunkMesh } from '../chunks';

/** Tower leg / top portal roof (m above sea level; lidar: 222, the beacon 229), before ABOVE_DECK_STRETCH. */
export const REAL_TOP_M = 222;
const PAINT = '#e0532c';
/** Span cell for the merged meshes (world units, ~400 m). */
const SPAN_CELL = 24000;
const SPAN_MIN_TRIS = 10000;

type B = {
    paint: GeoBuilder;
    cable: GeoBuilder;
    concrete: GeoBuilder;
    walk: GeoBuilder;
    barrier: GeoBuilder;
    glass: GeoBuilder;
    beacon: GeoBuilder;
};

/** Vertical pilasters (flutes) on the four faces of a box in frame f. */
function fluted(b: GeoBuilder, f: Frame, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, opts: { pitch: number; depth: number; faces: ('u-' | 'u+' | 'v-' | 'v+')[] }) {
    b.box(f, u0, u1, v0, v1, y0, y1);
    const { pitch, depth: p, faces } = opts;
    const along = (a0: number, a1: number, fn: (c0: number, c1: number) => void) => {
        const n = Math.max(2, Math.round((a1 - a0) / pitch));
        const w = (a1 - a0) / n;
        for (let k = 0; k < n; ++k) fn(a0 + w * (k + 0.25), a0 + w * (k + 0.75));
    };
    for (const fc of faces) {
        if (fc === 'u-') along(v0, v1, (c0, c1) => b.box(f, u0 - p, u0, c0, c1, y0, y1));
        if (fc === 'u+') along(v0, v1, (c0, c1) => b.box(f, u1, u1 + p, c0, c1, y0, y1));
        if (fc === 'v-') along(u0, u1, (c0, c1) => b.box(f, c0, c1, v0 - p, v0, y0, y1));
        if (fc === 'v+') along(u0, u1, (c0, c1) => b.box(f, c0, c1, v1, v1 + p, y0, y1));
    }
}

function tower(bs: B, s: number, fender: boolean) {
    const b = bs.paint;
    const f = frameAt(s);
    const deck = deckTop(s);
    const top = stretchY(REAL_TOP_M);
    const H = top - deck;
    const pierTop = worldY(12);
    // Vertical sizes above the deck are stretched with the tower (V); horizontal ones are not (M).
    const V = UP_M;
    const lv = strutLevels().map(([a, c]) => [deck + a * H, deck + c * H] as [number, number]);
    const baseTop = deck - 13 * M;
    const sections: { D: number; W: number; y0: number; y1: number }[] = [
        { ...legSize(LEG_BASE), y0: pierTop, y1: baseTop },
        { ...legSize(LEG_SECTIONS[0]!), y0: baseTop, y1: lv[0]![1] },
        { ...legSize(LEG_SECTIONS[1]!), y0: lv[0]![1], y1: lv[1]![1] },
        { ...legSize(LEG_SECTIONS[2]!), y0: lv[1]![1], y1: lv[2]![1] },
        { ...legSize(LEG_SECTIONS[3]!), y0: lv[2]![1], y1: top },
    ];
    for (const sg of [-1, 1]) {
        const vr = (a: number, c: number): [number, number] => (sg > 0 ? [a, c] : [-c, -a]);
        sections.forEach((sec, i) => {
            const D = sec.D * M;
            const W = sec.W * M;
            const [v0, v1] = vr(LEG_IN, LEG_IN + W);
            const outer: 'v-' | 'v+' = sg > 0 ? 'v+' : 'v-';
            const inner: 'v-' | 'v+' = sg > 0 ? 'v-' : 'v+';
            const bandH = 1.3 * (i > 0 ? V : M);
            const yTop = i < sections.length - 1 ? sec.y1 - bandH : sec.y1;
            fluted(b, f, -D / 2, D / 2, v0, v1, sec.y0, yTop, { pitch: 4 * M, depth: 0.8 * M, faces: ['u-', 'u+', outer, ...(i > 0 ? [inner] : [])] });
            if (i < sections.length - 1) {
                // Cornice band at the setback.
                const e = 0.9 * M;
                const [bv0, bv1] = vr(LEG_IN - 0.45 * M, LEG_IN + W + e);
                b.box(f, -D / 2 - e, D / 2 + e, bv0, bv1, yTop, sec.y1);
            }
        });
        // Crown: stepped cap, cable saddle hood, aviation beacon.
        const last = legSize(LEG_SECTIONS[3]!);
        const vc = sg * (LEG_IN + (last.W * M) / 2);
        const D3 = last.D * M;
        const W3 = last.W * M;
        b.box(f, -D3 / 2 - 0.6 * M, D3 / 2 + 0.6 * M, vc - W3 / 2 - 0.6 * M, vc + W3 / 2 + 0.6 * M, top, top + 1.0 * V);
        b.box(f, -D3 / 2 + 1.2 * M, D3 / 2 - 1.2 * M, vc - W3 / 2 + 0.8 * M, vc + W3 / 2 - 0.8 * M, top + 1.0 * V, top + 2.6 * V);
        b.box(f, -4.8 * M, 4.8 * M, vc - 2.6 * M, vc + 2.6 * M, top + 2.6 * V, top + 4.4 * V);
        b.taper(f, [-4.8 * M, 4.8 * M, vc - 2.6 * M, vc + 2.6 * M], [-3.6 * M, 3.6 * M, vc - 1.3 * M, vc + 1.3 * M], top + 4.4 * V, top + 5.4 * V);
        bs.beacon.box(f, -0.6 * M, 0.6 * M, vc - 0.6 * M, vc + 0.6 * M, top + 5.4 * V, top + 7.1 * V);
    }
    // Portal struts with fluted faces, bands and stepped knee brackets at the opening corners.
    lv.forEach(([ya, yb], k) => {
        const D = (legSize(LEG_SECTIONS[k]!).D - 3.5) * M;
        const isTop = k === lv.length - 1;
        fluted(b, f, -D / 2, D / 2, -LEG_IN, LEG_IN, ya + 0.9 * V, yb - 0.9 * V, { pitch: 3.4 * M, depth: 0.35 * M, faces: ['u-', 'u+'] });
        b.box(f, -D / 2 - 0.5 * M, D / 2 + 0.5 * M, -LEG_IN, LEG_IN, ya, ya + 0.9 * V);
        b.box(f, -D / 2 - 0.5 * M, D / 2 + 0.5 * M, -LEG_IN, LEG_IN, yb - 0.9 * V, yb);
        for (const sg of [-1, 1]) {
            const st = (w: number, y0: number, y1: number) => {
                const [v0, v1] = sg > 0 ? [LEG_IN - w, LEG_IN] : [-LEG_IN, -LEG_IN + w];
                b.box(f, -D / 2 + 0.6 * M, D / 2 - 0.6 * M, v0, v1, y0, y1);
            };
            // Sized for the widened portal (the real ones are ~5 / 3 / 1 m across a 27 m opening).
            const step = isTop ? 2.6 * V : 3.4 * V;
            st(12 * M, ya - step, ya);
            st(7 * M, ya - 2 * step, ya - step);
            st(3 * M, ya - 3 * step, ya - 2 * step);
        }
        if (isTop) {
            // Parapet over the top strut.
            b.box(f, -D / 2 + 0.8 * M, D / 2 - 0.8 * M, -LEG_IN, LEG_IN, yb, yb + 1.2 * V);
            b.box(f, -D / 2 + 2 * M, D / 2 - 2 * M, -18 * M, 18 * M, yb + 1.2 * V, yb + 2.2 * V);
        }
    });
    // Below the deck: the deck strut, the X bracing and the pier-level strut.
    const ds1 = Math.min(deckY(s, -CABLE_L), deckY(s, CABLE_L)) - TRUSS_BOT - 40;
    const ds0 = ds1 - 6.5 * M;
    const Du = (legSize(LEG_BASE).D - 2) * M;
    fluted(b, f, -Du / 2, Du / 2, -LEG_IN, LEG_IN, ds0, ds1, { pitch: 3.4 * M, depth: 0.3 * M, faces: ['u-', 'u+'] });
    b.box(f, -Du / 2, Du / 2, -LEG_IN, LEG_IN, pierTop, pierTop + 5 * M);
    for (const sg of [-1, 1]) {
        const a = f.p(0, -sg * LEG_IN, pierTop + 5 * M);
        const c = f.p(0, sg * LEG_IN, ds0);
        b.beamSide(a, c, Du, 3.2 * M, f.u);
    }
    b.beamSide(f.p(0, -LEG_IN, (pierTop + ds0) / 2 + 1.5 * M), f.p(0, LEG_IN, (pierTop + ds0) / 2 + 1.5 * M), Du, 2.6 * M, f.u);
    // Pier (stadium) and, for the SF tower, the oval fender.
    const R = 17 * M;
    const half = 75 * M - R;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 8; ++k) {
        const a = (k / 8) * Math.PI;
        pts.push([R * Math.cos(a), half + R * Math.sin(a)]);
    }
    for (let k = 0; k <= 8; ++k) {
        const a = Math.PI + (k / 8) * Math.PI;
        pts.push([R * Math.cos(a), -half + R * Math.sin(a)]);
    }
    bs.concrete.prism(f, pts.reverse(), worldY(-20), pierTop, true);
    bs.concrete.prism(
        f,
        pts.map(([u, v]) => [u * 0.9, v * 0.97]),
        pierTop,
        pierTop + 0.6 * M,
        true,
    );
    if (fender) {
        const outer: [number, number][] = [];
        const inner: [number, number][] = [];
        const n = 40;
        for (let k = 0; k < n; ++k) {
            const a = (k / n) * Math.PI * 2;
            outer.push([52 * M * Math.cos(a), 104 * M * Math.sin(a)]);
            inner.push([47 * M * Math.cos(a), 99 * M * Math.sin(a)]);
        }
        bs.concrete.ring(f, outer, inner, worldY(-8), worldY(6));
    }
}

/** Concrete Art Deco pylon: a full-width wall under the deck, shafts flanking the roadway above. */
function pylon(bs: B, s0: number, s1: number, shaftTopM: number, voM = 66) {
    const c = bs.concrete;
    const s = (s0 + s1) / 2;
    const f = frameAt(s);
    const deck = Math.min(deckY(s, -CABLE_L), deckY(s, CABLE_L));
    const hu = (s1 - s0) / 2;
    const vo = voM * M;
    c.taper(f, [-hu - 2 * M, hu + 2 * M, -vo, vo], [-hu, hu, -vo, vo], worldY(-10), deck - 140);
    // Vertical grooves on the long faces.
    for (const side of [-1, 1]) {
        const n = 24;
        for (let k = 0; k < n; ++k) {
            const v0 = -vo + ((k + 0.3) / n) * 2 * vo;
            const v1 = -vo + ((k + 0.7) / n) * 2 * vo;
            const u = side * hu;
            c.box(f, Math.min(u, u + side * 0.5 * M), Math.max(u, u + side * 0.5 * M), v0, v1, worldY(4), deck - 5 * M);
        }
    }
    // Belt course under the deck.
    c.box(f, -hu - 0.8 * M, hu + 0.8 * M, -vo - 0.8 * M, vo + 0.8 * M, deck - 5 * M, deck - 140);
    for (const sg of [-1, 1]) {
        const [v0, v1] = sg > 0 ? [PYLON_IN, vo] : [-vo, -PYLON_IN];
        const y1 = deckY(s, sg * CABLE_L) + shaftTopM * M;
        fluted(c, f, -hu, hu, v0, v1, deck - 140, y1, { pitch: 3 * M, depth: 0.4 * M, faces: ['u-', 'u+', sg > 0 ? 'v+' : 'v-'] });
        const vi = sg > 0 ? [PYLON_IN + 1 * M, vo - 1 * M] : [-vo + 1 * M, -PYLON_IN - 1 * M];
        c.box(f, -hu - 0.6 * M, hu + 0.6 * M, v0 - (sg > 0 ? 0 : 0.6 * M), v1 + (sg > 0 ? 0.6 * M : 0), y1, y1 + 1 * M);
        c.box(f, -hu + 1.5 * M, hu - 1.5 * M, vi[0]!, vi[1]!, y1 + 1 * M, y1 + 2.4 * M);
        c.box(f, -hu + 4 * M, hu - 4 * M, vi[0]! + 2 * M, vi[1]! - 2 * M, y1 + 2.4 * M, y1 + 3.4 * M);
    }
}

/** Anchorage block under the deck. */
function anchorage(bs: B, s0: number, s1: number) {
    const f = frameAt((s0 + s1) / 2);
    const hu = (s1 - s0) / 2;
    const deck = Math.min(deckY((s0 + s1) / 2, -CABLE_L), deckY((s0 + s1) / 2, CABLE_L));
    const vo = 68 * M;
    bs.concrete.taper(f, [-hu - 3 * M, hu + 3 * M, -vo - 4 * M, vo + 4 * M], [-hu, hu, -vo, vo], worldY(-10), deck - 150);
    for (const side of [-1, 1]) {
        const n = Math.max(3, Math.round((2 * hu) / (4 * M)));
        for (let k = 0; k < n; ++k) {
            const u0 = -hu + ((k + 0.3) / n) * 2 * hu;
            const u1 = -hu + ((k + 0.7) / n) * 2 * hu;
            const v = side * vo;
            bs.concrete.box(f, u0, u1, Math.min(v, v + side * 0.6 * M), Math.max(v, v + side * 0.6 * M), worldY(2), deck - 6 * M);
        }
    }
}

function truss(bs: B) {
    const b = bs.paint;
    for (const [a, e] of trussSpans()) {
        const ss = stations(a, e, PANEL);
        const lat = latDir((a + e) / 2);
        for (const sg of [-1, 1]) {
            const l = sg * CABLE_L;
            const T = (s: number) => onDeck(s, l, -TRUSS_TOP);
            const Bt = (s: number) => onDeck(s, l, -TRUSS_BOT);
            for (let i = 0; i < ss.length; ++i) {
                const s = ss[i]!;
                b.beamSide(Bt(s), T(s), 70, 50, lat);
                if (i + 1 < ss.length) {
                    const n = ss[i + 1]!;
                    b.beam(T(s), T(n), 90, 100);
                    b.beam(Bt(s), Bt(n), 90, 90);
                    if (i % 2 === 0) b.beamSide(Bt(s), T(n), 70, 45, lat);
                    else b.beamSide(T(s), Bt(n), 70, 45, lat);
                }
            }
        }
        // Floor system: floor beams, bottom lateral struts and X bracing, stringers.
        for (let i = 0; i < ss.length; ++i) {
            const s = ss[i]!;
            if (i % 2 === 0) {
                // Across a deck gap only the intact carriageway's half of the floor remains.
                const lE = inGap(s, 1) ? -150 : CABLE_L;
                const lW = inGap(s, -1) ? 150 : -CABLE_L;
                b.beam(onDeck(s, lW, -TRUSS_TOP - 70), onDeck(s, lE, -TRUSS_TOP - 70), 60, 200);
                b.beam(onDeck(s, lW, -TRUSS_BOT), onDeck(s, lE, -TRUSS_BOT), 40, 50);
                if (i % 4 === 0 && i + 4 < ss.length && a !== ARCH[0] && !overlapsGap(s, ss[i + 4]!, 1) && !overlapsGap(s, ss[i + 4]!, -1)) {
                    const n = ss[i + 4]!;
                    b.beam(onDeck(s, -CABLE_L, -TRUSS_BOT + 30), onDeck(n, CABLE_L, -TRUSS_BOT + 30), 36, 36);
                    b.beam(onDeck(s, CABLE_L, -TRUSS_BOT + 30), onDeck(n, -CABLE_L, -TRUSS_BOT + 30), 36, 36);
                }
            }
            if (i + 1 < ss.length)
                for (const l of [-2600, -1700, -800, 0, 800, 1700, 2600])
                    for (const [p, q] of l === 0 ? [[s, ss[i + 1]!] as [number, number]] : cutGaps([[s, ss[i + 1]!]], l)) b.beam(onDeck(p, l, -200), onDeck(q, l, -200), 30, 140);
        }
    }
}

function arch(bs: B) {
    const b = bs.paint;
    const ss = stations(ARCH[0], ARCH[1], PANEL);
    const lat = latDir((ARCH[0] + ARCH[1]) / 2);
    const top = (s: number) => archY(s, ...ARCH_TOP_CHORD);
    for (const sg of [-1, 1]) {
        const l = sg * CABLE_L;
        const B0 = (s: number) => at(s, l, archY(s));
        const B1 = (s: number) => at(s, l, top(s));
        const T = (s: number) => onDeck(s, l, -TRUSS_BOT);
        for (let i = 0; i < ss.length; ++i) {
            const s = ss[i]!;
            if (i > 0 && i < ss.length - 1) {
                // Spandrel posts every panel, the rib's own verticals.
                b.beamSide(B1(s), T(s), 60, 60, lat);
                b.beamSide(B0(s), B1(s), 90, 70, lat);
            }
            if (i + 1 < ss.length) {
                const n = ss[i + 1]!;
                // Heavy two-chord arch rib with a tight zigzag web.
                b.beam(B0(s), B0(n), 230, 230);
                b.beam(B1(s), B1(n), 200, 170);
                if (i % 2 === 0) b.beamSide(B0(s), B1(n), 70, 55, lat);
                else b.beamSide(B1(s), B0(n), 70, 55, lat);
                // Light spandrel diagonals every other panel, where there is room.
                const gap = T(s).y - B1(s).y;
                if (gap > 5 * M && i % 4 === 1) b.beamSide(B1(s), T(n), 40, 35, lat);
                if (gap > 5 * M && i % 4 === 3) b.beamSide(T(s), B1(n), 40, 35, lat);
            }
        }
    }
    // Lateral bracing between the two ribs.
    for (let i = 0; i < ss.length; i += 2) {
        const s = ss[i]!;
        const y = (archY(s) + top(s)) / 2;
        b.beam(at(s, -CABLE_L, y), at(s, CABLE_L, y), 60, 90);
        if (i % 4 === 0 && i + 4 < ss.length) {
            const n = ss[i + 4]!;
            const yn = (archY(n) + top(n)) / 2;
            b.beam(at(s, -CABLE_L, y), at(n, CABLE_L, yn), 40, 40);
            b.beam(at(s, CABLE_L, y), at(n, -CABLE_L, yn), 40, 40);
        }
    }
}

function viaduct(bs: B) {
    const b = bs.paint;
    for (const s of VIADUCT_BENTS) {
        const f = frameAt(s);
        const top = Math.min(deckY(s, -CABLE_L), deckY(s, CABLE_L)) - TRUSS_BOT - 40;
        const bot = worldY(-4);
        for (const sg of [-1, 1]) {
            b.box(f, -1.6 * M, 1.6 * M, sg * CABLE_L - 1.5 * M, sg * CABLE_L + 1.5 * M, bot, top);
            b.box(f, -2.2 * M, 2.2 * M, sg * CABLE_L - 2.2 * M, sg * CABLE_L + 2.2 * M, bot, bot + 3 * M);
        }
        b.box(f, -1.8 * M, 1.8 * M, -CABLE_L - 1.5 * M, CABLE_L + 1.5 * M, top - 2.5 * M, top);
        const ys = [bot + 4 * M, (bot + top) / 2, top - 2.5 * M];
        for (let k = 0; k + 1 < ys.length; ++k) {
            b.beamSide(f.p(0, -CABLE_L, ys[k]!), f.p(0, CABLE_L, ys[k + 1]!), 1.2 * M, 1 * M, f.u);
            b.beamSide(f.p(0, CABLE_L, ys[k]!), f.p(0, -CABLE_L, ys[k + 1]!), 1.2 * M, 1 * M, f.u);
            b.box(f, -1 * M, 1 * M, -CABLE_L, CABLE_L, ys[k + 1]! - 0.8 * M, ys[k + 1]!);
        }
    }
}

function deckAndRails(bs: B, posts: THREE.Matrix4[], balusters: THREE.Matrix4[]) {
    const STEP = PANEL;
    // Slab under the whole road (top below the road surface, so the game's road draws on top).
    const [w0, w1] = sideRange(-1);
    const [e0, e1] = sideRange(1);
    const mid: [number, number] = [Math.max(w0, e0), Math.min(w1, e1)];
    extrudeAlong(bs.walk, [
        [-150, -140],
        [150, -140],
        [150, -45],
        [-150, -45],
    ], mid[0], mid[1], STEP);
    // Median: a strip and the (moveable) concrete barrier.
    extrudeNosed(bs.barrier, [
        [-MEDIAN_HALF, -45],
        [MEDIAN_HALF, -45],
        [MEDIAN_HALF, 25],
        [58, 85],
        [42, 200],
        [-42, 200],
        [-58, 85],
        [-MEDIAN_HALF, 25],
    ], mid[0], mid[1], STEP, 4 * STEP);
    for (const sg of [-1, 1]) {
        const P = (pts: [number, number][]) => (sg > 0 ? pts : pts.map(([l, h]) => [-l, h] as [number, number]).reverse());
        const [r0, r1] = sideRange(sg);
        // This side's deck, minus any gap (the course's jump over a missing deck section).
        const spans = cutGaps([[r0, r1]], sg);
        for (const [a, e] of spans) {
            extrudeAlong(bs.walk, P([
                [150, -140],
                [SLAB_HALF, -140],
                [SLAB_HALF, -45],
                [150, -45],
            ]), a, e, STEP);
            // Curb under the roadside railing, and the sidewalk (through the pylons / towers, where it hides).
            extrudeAlong(bs.walk, P([
                [ROAD_EDGE + 15, -45],
                [BARRIER_OUT, -45],
                [BARRIER_OUT, 70],
                [ROAD_EDGE + 25, 70],
                [ROAD_EDGE + 15, 55],
            ]), a, e, STEP);
            extrudeAlong(bs.walk, P([
                [BARRIER_OUT, -45],
                [WALK_OUT, -45],
                [WALK_OUT, 22],
                [BARRIER_OUT, 22],
            ]), a, e, STEP);
        }
        // Roadside railing: rails merged, posts instanced.
        const lr = sg * ((ROAD_EDGE + BARRIER_OUT) / 2);
        for (const [a, e] of spans) {
            const ss = stations(a, e, STEP);
            for (let i = 0; i + 1 < ss.length; ++i) {
                bs.paint.beam(onDeck(ss[i]!, lr, 212), onDeck(ss[i + 1]!, lr, 212), 80, 26);
                bs.paint.beam(onDeck(ss[i]!, lr, 150), onDeck(ss[i + 1]!, lr, 150), 34, 22);
                bs.paint.beam(onDeck(ss[i]!, lr, 100), onDeck(ss[i + 1]!, lr, 100), 34, 22);
            }
            for (const s of stations(a, e, 2.1 * M)) {
                const f = frameAt(s);
                posts.push(segMatrix(onDeck(s, lr, 70), onDeck(s, lr, 200), 30, 22, f.v));
            }
        }
        // Outer railing along the sidewalk edge (detours around the towers and pylons).
        const lo = sg * (WALK_OUT - 18);
        for (const [a, e] of cutGaps(freeRanges(0, r0, r1), sg)) {
            const ss = stations(a, e, STEP);
            for (let i = 0; i + 1 < ss.length; ++i) {
                bs.paint.beam(onDeck(ss[i]!, lo, 175), onDeck(ss[i + 1]!, lo, 175), 34, 22);
                bs.paint.beam(onDeck(ss[i]!, lo, 40), onDeck(ss[i + 1]!, lo, 40), 26, 20);
            }
            for (const s of stations(a, e, 1.3 * M)) balusters.push(segMatrix(onDeck(s, lo, 22), onDeck(s, lo, 175), 11, 11));
        }
    }
    // Walkway platforms around the tower legs, with their railings.
    for (const s of [S_SF, S_MARIN]) {
        const f = frameAt(s);
        const legOut = LEG_IN + legSize(LEG_SECTIONS[0]!).W * M + 0.6 * M;
        const u = TOWER_CLEAR + 4 * M;
        const vOut = legOut + 5.5 * M;
        for (const sg of [-1, 1]) {
            const deck = deckY(s, sg * CABLE_L);
            const [v0, v1] = sg > 0 ? [WALK_OUT - 40, vOut] : [-vOut, -WALK_OUT + 40];
            bs.walk.box(f, -u, u, v0, v1, deck - 30, deck + 22);
            // Brackets under the platform.
            for (const uu of [-u + 1 * M, 0, u - 1 * M]) bs.paint.beamSide(f.p(uu, sg * (legOut - 1 * M), deck - 8 * M), f.p(uu, sg * (vOut - 0.5 * M), deck - 40), 50, 60, f.u);
            const ro = sg * (vOut - 18);
            const rail = (a: THREE.Vector3, c: THREE.Vector3) => {
                bs.paint.beam(a.clone().setY(deck + 175), c.clone().setY(deck + 175), 34, 22);
                bs.paint.beam(a.clone().setY(deck + 40), c.clone().setY(deck + 40), 26, 20);
                const n = Math.ceil(a.distanceTo(c) / (1.3 * M));
                for (let k = 0; k <= n; ++k) {
                    const p = a.clone().lerp(c, k / n);
                    balusters.push(segMatrix(p.clone().setY(deck + 22), p.clone().setY(deck + 175), 11, 11));
                }
            };
            rail(f.p(-u, ro, 0), f.p(u, ro, 0));
            rail(f.p(-u, sg * (WALK_OUT - 18), 0), f.p(-u, ro, 0));
            rail(f.p(u, sg * (WALK_OUT - 18), 0), f.p(u, ro, 0));
        }
    }
}

function lamps(bs: B) {
    const b = bs.paint;
    for (let s = 12 * M; s < LEN - 5 * M; s += 3 * PANEL * 2) {
        if (blocked(s, 6 * M)) continue;
        const f = frameAt(s);
        for (const sg of [-1, 1]) {
            const [r0, r1] = sideRange(sg);
            if (s < r0 + 4 * M || s > r1 - 4 * M || inGap(s, sg, 4 * M)) continue;
            const y = deckY(s, sg * 2600);
            const v = (x: number) => sg * x;
            // Everything at |lateral| >= 2600 (outside the railing band), the lantern reaching inward.
            const lp = 2720;
            b.box(f, -45, 45, Math.min(v(lp - 45), v(lp + 45)), Math.max(v(lp - 45), v(lp + 45)), y + 20, y + 120);
            b.column(f.p(0, v(lp), y + 120), 26, 17, 560, 8);
            const p0 = f.p(0, v(lp), y + 680);
            const p1 = f.p(0, v(lp - 30), y + 740);
            const p2 = f.p(0, v(2640), y + 758);
            b.beamSide(f.p(0, v(lp), y + 670), p0, 24, 24, f.u);
            b.beamSide(p0, p1, 22, 22, f.u);
            b.beamSide(p1, p2, 22, 22, f.u);
            b.box(f, -34, 34, Math.min(v(2604), v(2684)), Math.max(v(2604), v(2684)), y + 728, y + 770);
            bs.glass.box(f, -28, 28, Math.min(v(2610), v(2678)), Math.max(v(2610), v(2678)), y + 706, y + 728);
        }
    }
}

function cables(bs: B, bands: THREE.Matrix4[], ropes: THREE.Matrix4[]) {
    const specs = [cableSpec(REAL_TOP_M, -1), cableSpec(REAL_TOP_M, 1)];
    const s0 = S2[0] + 10 * M;
    const s1 = (N1[0] + N1[1]) / 2;
    const R = 80;
    for (const sg of [-1, 1]) {
        const spec = specs[sg > 0 ? 1 : 0]!;
        const l = sg * CABLE_L;
        const path: THREE.Vector3[] = [];
        const ss = stations(s0, s1, 4 * M);
        // Make sure the saddle points are samples.
        for (const t of [S_SF, S_MARIN]) if (!ss.some((x) => Math.abs(x - t) < 1)) ss.push(t);
        ss.sort((a, c) => a - c);
        for (const s of ss) path.push(at(s, l, cableY(spec, s)));
        bs.cable.tube(path, R, 14);
    }
    for (const s of suspenderStations()) {
        for (const sg of [-1, 1]) {
            const spec = specs[sg > 0 ? 1 : 0]!;
            const d = cableY(spec, s + 20) - cableY(spec, s - 20);
            const l = sg * CABLE_L;
            const c = at(s, l, cableY(spec, s));
            const tan = new THREE.Vector3().subVectors(at(s + 20, l, cableY(spec, s) + d / 2), at(s - 20, l, cableY(spec, s) - d / 2)).normalize();
            bands.push(segMatrix(c.clone().addScaledVector(tan, -60), c.clone().addScaledVector(tan, 60), R + 14, R + 14));
            const yb = deckY(s, l) - TRUSS_TOP + 40;
            const yt = cableY(spec, s) - 20;
            for (const o of [-34, 34]) {
                const [x, z] = [at(s, l + o, 0).x, at(s, l + o, 0).z];
                ropes.push(segMatrix(new THREE.Vector3(x, yb, z), new THREE.Vector3(x, yt, z), 11, 11));
            }
        }
    }
}

export function buildBridgeModel(): THREE.Group {
    const origin = onDeck(LEN / 2, 0);
    const bs: B = {
        paint: new GeoBuilder(origin),
        cable: new GeoBuilder(origin),
        concrete: new GeoBuilder(origin, 1 / 480),
        walk: new GeoBuilder(origin, 1 / 480),
        barrier: new GeoBuilder(origin),
        glass: new GeoBuilder(origin),
        beacon: new GeoBuilder(origin),
    };
    tower(bs, S_SF, true);
    tower(bs, S_MARIN, false);
    // Shaft tops above the road: 9.6 / 9.7 / 7.8 m (lidar).
    pylon(bs, S2[0], S2[1], 9.6, 58);
    pylon(bs, S1[0], S1[1], 9.7);
    pylon(bs, N1[0], N1[1], 7.8);
    anchorage(bs, 0, S2[0]);
    anchorage(bs, N1[1], N_ANCH_END);
    truss(bs);
    arch(bs);
    viaduct(bs);
    const posts: THREE.Matrix4[] = [];
    const balusters: THREE.Matrix4[] = [];
    deckAndRails(bs, posts, balusters);
    lamps(bs);
    const bands: THREE.Matrix4[] = [];
    const ropes: THREE.Matrix4[] = [];
    cables(bs, bands, ropes);

    const pt = paintTextures();
    const ct = concreteTextures();
    const paintMat = new THREE.MeshStandardMaterial({ name: 'gg-paint', color: PAINT, roughness: 0.72, metalness: 0.06, ...(pt ? { map: pt.map, normalMap: pt.normalMap, roughnessMap: pt.roughnessMap, normalScale: new THREE.Vector2(0.7, 0.7) } : {}) });
    const cableMat = new THREE.MeshStandardMaterial({ name: 'gg-cable', color: PAINT, roughness: 0.45, metalness: 0.12 });
    // Weathered (weathering.ts): at pylon scale the clean 4 m texture read as a plain tan box.
    const concreteMat = weatherConcrete(new THREE.MeshStandardMaterial({ name: 'gg-concrete', color: '#aaaba7', roughness: 1, metalness: 0, ...(ct ? { map: ct.map, normalMap: ct.normalMap, roughnessMap: ct.roughnessMap, normalScale: new THREE.Vector2(1.6, 1.6) } : {}) }));
    const walkMat = new THREE.MeshStandardMaterial({ name: 'gg-walk', color: '#aaa59b', roughness: 1, metalness: 0, ...(ct ? { map: ct.map, roughnessMap: ct.roughnessMap } : {}) });
    const barrierMat = new THREE.MeshStandardMaterial({ name: 'gg-median', color: '#c9c4ba', roughness: 0.9, metalness: 0 });
    const glassMat = new THREE.MeshStandardMaterial({ name: 'gg-lamp', color: '#fff4d6', emissive: '#ffd89a', emissiveIntensity: 0.8, roughness: 0.3 });
    const beaconMat = new THREE.MeshBasicMaterial({ name: 'gg-beacon', color: '#ff2a1a' });

    const g = new THREE.Group();
    g.name = 'golden-gate-bridge';
    // The big ones in spans (chunks.ts): from the deck most of the bridge is behind the camera or
    // outside the shadow camera's box, which would otherwise draw all of each material every frame.
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast: boolean, receive: boolean) => {
        const m = new THREE.Mesh(geo, mat);
        m.name = name;
        m.castShadow = cast;
        m.receiveShadow = receive;
        for (const piece of (geo.index?.count ?? 0) / 3 > SPAN_MIN_TRIS ? chunkMesh(m, SPAN_CELL) : [m]) g.add(piece);
    };
    add(bs.paint.geometry(), paintMat, 'steel', true, true);
    add(bs.cable.geometry(), cableMat, 'cables', true, false);
    add(bs.concrete.geometry(), concreteMat, 'concrete', true, true);
    add(bs.walk.geometry(), walkMat, 'deck', false, true);
    add(bs.barrier.geometry(), barrierMat, 'median', false, true);
    add(bs.glass.geometry(), glassMat, 'lamps', false, false);
    add(bs.beacon.geometry(), beaconMat, 'beacons', false, false);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string, cast: boolean) => {
        const m = instanced(geo, mat, list, name);
        m.castShadow = cast;
        g.add(m);
    };
    inst(boxGeo, paintMat, posts, 'rail-posts', false);
    inst(cylGeo, cableMat, balusters, 'balusters', false);
    inst(cylGeo, cableMat, ropes, 'suspenders', true);
    inst(bandGeo, cableMat, bands, 'cable-bands', false);
    return g;
}
