/**
 * Shared layout of the bridge: stations along the axis, lateral bands, tower levels,
 * the main-cable profile. Along / lateral / heights in world units unless named ...M (meters).
 *
 * Heights, along depths and the north stations are fitted to the USGS 3DEP 2023 lidar
 * (tools/sf/bridgeFit.ts); the lateral bands are the game's widened deck, not the real one. The
 * deliberate departures for the game: proportions tuned by eye for the widened deck (a moderate
 * vertical stretch above the deck, bulkier legs and struts: ABOVE_DECK_STRETCH, LEG_BULK,
 * STRUT_GROW), and the Fort Point arch / south pylons moved clear of the roads under the south end
 * (S2, ARCH, S1).
 */

import { worldY } from '../geo';
import { LEN, M, S_MARIN, S_SF, deckY } from './frame';

// ---- Game proportions above the deck. ----
/**
 * Everything above the road (tower legs, portal struts, crowns and beacons, the main cables' rise
 * over the towers, hence their sag and the suspenders) is stretched vertically by this factor about
 * the road at the towers. The drivable deck is ~3.7x wider than the real one (the legs stand outside
 * two 38 m carriageways), so at the lidar heights the towers read squat from the deck; but the span
 * is real, so every bit of stretch shows side-on as taller towers and a deeper cable sag. 2x (leg
 * tops at 370 m, sag 1/4.3 of the main span) made it read like a different, spindly bridge from
 * Crissy Field and the water. This is judged by eye across the deck, Crissy, water, Battery Spencer
 * and approach views: leg tops ~296 m above the sea (real 227), the main-span sag ~1/5.8 (real 1/8.9;
 * a little deeper reads as more iconic than accurate). The rest of the "tall enough from the deck"
 * job is done by mass, not height: thicker legs (LEG_BULK), deeper portal struts with big stepped
 * corners (STRUT_GROW) and a deeper truss, which keep the portal from reading as a wide, thin ladder
 * over the widened deck. The deck, the truss and everything under it keep their course heights; so
 * do the pylons and the cables' low points / ends.
 */
export const ABOVE_DECK_STRETCH = 1.5;
/** Road height (m) at the towers (lidar) that the stretch is measured from. */
export const ROAD_AT_TOWERS_M = 73.9;
/** A real height (m above sea level, above the deck) → world y, stretched above the road. */
export function stretchY(hM: number): number {
    return worldY(ROAD_AT_TOWERS_M + (hM - ROAD_AT_TOWERS_M) * ABOVE_DECK_STRETCH);
}
/** One real meter measured vertically above the deck, in world units. */
export const UP_M = M * ABOVE_DECK_STRETCH;

// ---- Lateral bands (units from the axis; the drivable deck is |l| < 2410). ----
/** Outer edge of each carriageway's road surface. */
export const ROAD_EDGE = 2410;
/** Crash barrier / railing band at the road edge. */
export const BARRIER_OUT = 2560;
/** Median barrier half-width (the carriageways' inner edges are at +-110). */
export const MEDIAN_HALF = 95;
/** Inner face of the tower legs. */
export const LEG_IN = 2660;
/**
 * Inner face of the concrete pylon shafts above the deck (S2, S1, N1): 9 m clear of the road walls
 * on the parallel deck, ~7 m where the plaza approaches diverge past S2.
 */
export const PYLON_IN = 50 * M;
/** Main cables, suspenders and stiffening trusses. */
export const CABLE_L = 3080;
/** Outer edge of the sidewalks. */
export const WALK_OUT = 3480;
/** Deck slab (under the road) lateral half-width. */
export const SLAB_HALF = 3520;

// ---- Stations (units along from the south end). ----
export { LEN, S_SF, S_MARIN };
/**
 * South anchorage block (0 → S2 south face), S2 pylon, the Fort Point arch and S1. Placed for the
 * course, not measured (the real ones: anchorage 130-165 m, S2 165-177.5 m, a 97.5 m arch, S1
 * 275-287.5 m): the course's Marine Drive / Fort Point loop (with its half-pipe) run under the south
 * end, so S2 stands south of Marine Drive (15 m clear) and S1 north of the loop (37 m clear), and
 * the arch leaps over all of it (bottom chord >= 7 m over the loop's half-pipe near S1).
 */
export const S2 = [24 * M, 46 * M] as const;
/** Fort Point arch springings (on the S2 / S1 pylon faces). */
export const ARCH = [46 * M, 372 * M] as const;
/** S1, where the main cables come down to the deck. */
export const S1 = [372 * M, 384.5 * M] as const;
/** North pylon N1 (the cable ends in it) and the anchorage behind it (the real one runs to 2354 m). */
export const N1 = [2254.5 * M, 2264 * M] as const;
export const N_ANCH_END = LEN;
/** North approach viaduct bents (the real ones start at 2424 m, past the model's end). */
export const VIADUCT_BENTS: number[] = [];

// ---- Stiffening truss (units below the deck surface). ----
export const TRUSS_TOP = 190;
/**
 * Bottom chord ~10.7 m under the road (the real top chord is at the sidewalk, outside our widened one;
 * the real truss is 7.6 m deep): a little deeper than real so the ~100 m wide deck keeps some heft
 * side-on next to the towers.
 */
export const TRUSS_DEPTH = 450;
export const TRUSS_BOT = TRUSS_TOP + TRUSS_DEPTH;
/** Panel length (25 ft; 7.64 m in the course frame, ~0.3% long north-south). Suspenders every 2 panels. */
export const PANEL = 7.64 * M;
/** Main-span suspenders stay this far from the tower centers (the first is 31 m out). */
export const MAIN_SUSPENDER_CLEAR = 30 * M;

// ---- Towers. ----
/**
 * Tower levels as fractions of the height above the deck (portal strut bottoms / tops). Measured:
 * 109-120.5, 148.5-160, 182-192 and 213-222 m with the road at 73.9 m.
 */
export const STRUTS: [number, number][] = [
    [0.237, 0.314],
    [0.504, 0.581],
    [0.73, 0.797],
    [0.939, 1.0],
];

/**
 * Leg footprint (meters) per section: along depth D (measured), lateral width W (widened with the
 * deck); sections end at strut tops.
 */
export const LEG_SECTIONS: { D: number; W: number }[] = [
    { D: 14.4, W: 20 },
    { D: 12.4, W: 18 },
    { D: 10.5, W: 16 },
    { D: 8.9, W: 14 },
];
/** Below the deck the legs keep the lowest section's depth (a little wider across). */
export const LEG_BASE = { D: 14.3, W: 21 };
/**
 * Game factors on the measured leg footprint (along depth D, lateral width W). The legs frame a
 * portal ~3.3x wider than the real one; at the real sizes they read as thin sticks beside it (and
 * side-on, next to the stretched height).
 */
export const LEG_BULK = { D: 1.3, W: 1.6 };
/** Leg footprint in meters, with LEG_BULK applied. */
export const legSize = (sec: { D: number; W: number }): { D: number; W: number } => ({ D: sec.D * LEG_BULK.D, W: sec.W * LEG_BULK.W });
/**
 * Portal struts are this much deeper (vertically, about their measured centers) than the stretched
 * lidar ones, so they stay chunky across the wide opening.
 */
export const STRUT_GROW = 1.3;
/** Strut [bottom, top] as fractions of the height above the deck, with STRUT_GROW applied (the top one keeps its top). */
export function strutLevels(): [number, number][] {
    return STRUTS.map(([a, c], k) => {
        const h = (c - a) * STRUT_GROW;
        if (k === STRUTS.length - 1) return [c - h, c];
        const m = (a + c) / 2;
        return [m - h / 2, m + h / 2];
    });
}

/** Half along-depth (units) of the zone around a tower where deck parts stop / detour. */
export const TOWER_CLEAR = ((LEG_BASE.D * LEG_BULK.D) / 2 + 1) * M;

// ---- Main cables. ----
export type CableSpec = { saddleY: number; capY: number; midY: number; s1Y: number; n1Y: number; l: number };

export function cableSpec(topM: number, sg: number): CableSpec {
    const mid = (S_SF + S_MARIN) / 2;
    const l = sg * CABLE_L;
    return {
        // The spans' parabolas meet 6.4 m above the leg tops; the cable itself rides over the saddle
        // flat, 4 m above them.
        saddleY: stretchY(topM + 6.4),
        capY: stretchY(topM + 4),
        midY: deckY(mid, l) + 3.6 * M,
        s1Y: deckY((S1[0] + S1[1]) / 2, l) + 2.5 * M,
        n1Y: deckY((N1[0] + N1[1]) / 2, l) + 2.3 * M,
        l,
    };
}

/** Cable centerline height at along s (valid from S2 to N1). */
export function cableY(c: CableSpec, s: number): number {
    const s1 = (S1[0] + S1[1]) / 2;
    const n1 = (N1[0] + N1[1]) / 2;
    const mid = (S_SF + S_MARIN) / 2;
    const half = (S_MARIN - S_SF) / 2;
    const sagMain = c.saddleY - c.midY;
    // Same horizontal tension in the side spans: sag scales with the span squared.
    const side = (a: number, ya: number, b: number, yb: number) => {
        const t = (s - a) / (b - a);
        const L = b - a;
        const sag = sagMain * (L / (2 * half)) ** 2;
        return ya + (yb - ya) * t - 4 * sag * t * (1 - t);
    };
    if (s <= s1) {
        // Back stay from the S2 anchorage to S1, nearly straight.
        const a = S2[0] + 10 * M;
        const ya = deckY(a, c.l) + 3.2 * M;
        return ya + ((c.s1Y - ya) * (s - a)) / (s1 - a);
    }
    if (s <= S_SF) return Math.min(c.capY, side(s1, c.s1Y, S_SF, c.saddleY));
    if (s <= S_MARIN) return Math.min(c.capY, c.midY + sagMain * ((s - mid) / half) ** 2);
    if (s <= n1) return Math.min(c.capY, side(S_MARIN, c.saddleY, n1, c.n1Y));
    return c.n1Y;
}

/**
 * Suspender stations: every 50 ft in the suspended spans. The side spans start one step from the
 * towers; the main span's grid is centered, ~31 m clear of both towers.
 */
export function suspenderStations(step = 2 * PANEL): number[] {
    const out: number[] = [];
    const sideS: number[] = [];
    for (let s = S_SF - step; s > S1[1] + 20 * M; s -= step) sideS.push(s);
    out.push(...sideS.reverse().filter((s) => s < S_SF - TOWER_CLEAR - 1 * M));
    const n = Math.floor((S_MARIN - S_SF - 2 * MAIN_SUSPENDER_CLEAR) / step) + 1;
    const first = (S_SF + S_MARIN) / 2 - ((n - 1) / 2) * step;
    for (let k = 0; k < n; ++k) out.push(first + k * step);
    for (let s = S_MARIN + step; s < N1[0] - 4 * M; s += step) if (s > S_MARIN + TOWER_CLEAR + 1 * M) out.push(s);
    return out;
}

/** The suspended / truss-carried deck spans [a, b] (units along), between towers and pylons. */
export function trussSpans(clear = TOWER_CLEAR): [number, number][] {
    const spans: [number, number][] = [
        [ARCH[0], ARCH[1]],
        [S1[1], S_SF - clear],
        [S_SF + clear, S_MARIN - clear],
        [S_MARIN + clear, N1[0]],
    ];
    return spans.filter(([a, b]) => b - a > 1 * M);
}

/**
 * Fort Point arch bottom chord height (world y) at along s: a parabola from the springings to the
 * crown. The real rib (lidar, chord tops) springs at 9.8 m and crowns at 44 m, its top chord from
 * 28.8 m to 46.5 m; the game's much longer arch springs higher (17 m) so its ends clear the roads
 * passing near the pylons.
 */
export const ARCH_TOP_CHORD: [number, number] = [31, 46.5];
export function archY(s: number, springM = 17, crownM = 44): number {
    const t = (s - ARCH[0]) / (ARCH[1] - ARCH[0]);
    return worldY(springM + (crownM - springM) * 4 * t * (1 - t));
}

/** Is s inside a tower / pylon zone (plus margin), where rails, lamps, sidewalks detour. */
export function blocked(s: number, margin: number, clear = TOWER_CLEAR): boolean {
    const zones: [number, number][] = [
        [S_SF - clear, S_SF + clear],
        [S_MARIN - clear, S_MARIN + clear],
        [S2[0], S2[1]],
        [S1[0], S1[1]],
        [N1[0], N1[1]],
    ];
    return zones.some(([a, e]) => s > a - margin && s < e + margin);
}

/** Along ranges [r0, r1] minus the blocked zones. */
export function freeRanges(margin: number, r0: number, r1: number, clear = TOWER_CLEAR): [number, number][] {
    const cuts: [number, number][] = [
        [S2[0], S2[1]],
        [S1[0], S1[1]],
        [S_SF - clear, S_SF + clear],
        [S_MARIN - clear, S_MARIN + clear],
        [N1[0], N1[1]],
    ];
    const out: [number, number][] = [];
    let a = r0;
    for (const [c0, c1] of cuts) {
        if (c0 - margin > a) out.push([a, Math.min(r1, c0 - margin)]);
        a = Math.max(a, c1 + margin);
    }
    if (a < r1) out.push([a, r1]);
    return out.filter(([x, y]) => y > x);
}
