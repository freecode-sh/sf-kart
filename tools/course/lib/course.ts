/**
 * Course builder: TrackDef (declarative) → course.kcl + course.kmp + course_meta.json.
 *
 * Pipeline:
 *   1. turtle program → closure solve → control points → closed centripetal Catmull-Rom centerline
 *   2. elevation(S) = baseY + Σ bumps + Σ rises; bank(S) = Σ bank zones (cosine eased)
 *   3. stations along S (denser in tight corners and on ramps; forced at feature boundaries)
 *   4. per station interval: lateral lines (walls, road edges, island edges, lane splits, feature
 *      edges) → floor strips with attributes (road/offroad/features/gaps) → walls, step faces,
 *      island walls, fall boundaries; then ramp lips, gap edges and shortcut fills
 *   5. checkpoints (spacing / max turn), key checkpoints (evenly spaced, plus one between any two
 *      nearby stretches of road), respawn points, start point → KMP
 *   6. validation (radius vs wall offset, grade, self clearance, turning, checkpoint quads, barriers
 *      over jumps and half-pipes)
 *
 * Deterministic: no randomness, no timestamps.
 */

import { encodeKCL, type Tri, type V3 } from './kcl';
import { encodeKMP, type CkptEntry, type CnptEntry, type JgptEntry, type PointEntry } from './kmp';
import {
    CP_SPACING,
    controlPoints,
    curvatureAt,
    polyAt,
    sampleSpline,
    solveClosure,
    turtleRanges,
    type ControlPoint,
    type Polyline,
    type TurtleSeg,
    type Vec2,
} from './centerline';
import { KCL, type CrossSection, type Lat, type Range, type Ref, type Span, type TrackDef, type Zone } from './types';

export type BuiltCourse = {
    def: TrackDef;
    kcl: Uint8Array;
    kmp: Uint8Array;
    meta: Record<string, unknown>;
    summary: string[];
};

type Frame = { S: number; c: V3; fwd: V3; left: V3; yaw: number; cb: number; sb: number; bankDeg: number };
type XSec = { roadL: number; roadR: number; wallL: number; wallR: number; isl: number };
type Line = { o0: number; o1: number; tag: string };

const FACE_DEPTH = 1500; // how far vertical faces at gap/lip edges reach down
const FALL_DEPTH_GAP = 1200; // fall boundary depth below the road in gaps
const FALL_DEPTH_EDGE = 1000; // fall boundary depth below open (wall-less) edges
const FALL_BAND = 6000; // lateral width of fall boundary bands outside open edges

/**
 * How high over a ramp's lip a kart flies and how far past it it can land (bot laps in all three
 * vehicles, on the line, in both lanes, full lock and angled off the lip, tricks, boosting): boost
 * ramps (speed forced to 100) rise ~1970 and land within ~8400, trick kickers rise up to ~820
 * (taken at 115 off a lane panel) and land within ~6300.
 */
const RAMP_FLIGHT = { boost: { rise: 2000, reach: 10000 }, trick: { rise: 900, reach: 7000 } };
/**
 * Half-pipe launches leave the lip at most 65 up (KartHalfPipe) under gravity 1.3: 65² / 2.6 above
 * it. The lip is vertical all along the pipe (its eased ends too), so a kart launched near the end
 * comes down past it: the bots flew up to ~4700 on (~2300 of it still above the barriers).
 */
const HALFPIPE_FLIGHT = { rise: 1625, reach: 8000 };
/**
 * An air room's floor rises from the barrier line to this far above it at the moved-out wall (at
 * most twice as steep as it is wide).
 */
const AIR_ROOM_FLOOR = 600;
/** Barriers (walls + invisible walls) must top the highest flight beside them by this much. */
const FLIGHT_CLEAR = 500;

/** Kart position height above the road (a bike at rest), used to place cannon flight paths. */
const CANNON_ENTRY_DY = 90;
/** Arc heights of KartMove's cannon parameter table. */
const CANNON_ARC = [0, 5000, 2000];

/**
 * Periodic monotone cubic (Fritsch–Butland slopes) through elevation knots on a closed loop of
 * length L. Flat where the profile changes direction; no overshoot between knots.
 */
function makeProfile(knots: { S: number; y: number }[], L: number): (S: number) => number {
    const k = [...knots].sort((a, b) => a.S - b.S);
    const n = k.length;
    if (n < 2) throw new Error('profile needs at least 2 knots');
    const h = (i: number) => {
        const a = k[i % n]!.S;
        const b = k[(i + 1) % n]!.S;
        return i + 1 >= n ? b + L - a : b - a;
    };
    const d = (i: number) => (k[(i + 1) % n]!.y - k[i % n]!.y) / h(i);
    const m = k.map((_, i) => {
        const i0 = (i - 1 + n) % n;
        const d0 = d(i0);
        const d1 = d(i);
        if (d0 * d1 <= 0) return 0;
        const h0 = h(i0);
        const h1 = h(i);
        return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    });
    return (S: number) => {
        S = ((S % L) + L) % L;
        let i = n - 1;
        for (let j = 0; j < n; ++j) if (k[j]!.S <= S) i = j;
        let x = S - k[i]!.S;
        if (x < 0) x += L;
        const hi = h(i);
        const t = x / hi;
        const y0 = k[i]!.y;
        const y1 = k[(i + 1) % n]!.y;
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * hi * m[i]! + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * hi * m[(i + 1) % n]!;
    };
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r1 = (v: number) => Math.round(v * 10) / 10;
const v3r = (v: V3): [number, number, number] => [r1(v[0]), r1(v[1]), r1(v[2])];

/** 0 outside [a, b]; cosine ramps of length `e` at both ends; 1 inside. */
function window(S: number, a: number, b: number, e: number): number {
    if (S <= a || S >= b) return 0;
    if (S < a + e) return (1 - Math.cos((Math.PI * (S - a)) / e)) / 2;
    if (S > b - e) return (1 - Math.cos((Math.PI * (b - S)) / e)) / 2;
    return 1;
}

/**
 * Control points for an explicit closed path: uniform arc-length samples of the polyline (plan
 * u = world z, v = world x) and the arc-length range of every named section.
 */
function pathControlPoints(path: NonNullable<TrackDef['path']>): { cps: ControlPoint[]; ranges: Record<string, [number, number]>; total: number } {
    const P: Vec2[] = path.pts.map(([x, z]) => [z, x]);
    const n = P.length;
    const cum: number[] = [0];
    for (let i = 1; i <= n; ++i) {
        const a = P[i - 1]!;
        const b = P[i % n]!;
        cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[n]!;
    const at = (S: number): Vec2 => {
        let i = 0;
        while (i + 1 < n && cum[i + 1]! <= S) ++i;
        const a = P[i]!;
        const b = P[(i + 1) % n]!;
        const w = (S - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
    };
    const secs = [...path.sections].sort((a, b) => a.at - b.at);
    if (secs[0]?.at !== 0) throw new Error('path: the first section must start at point 0');
    const ranges: Record<string, [number, number]> = {};
    secs.forEach((s, k) => {
        if (ranges[s.name]) throw new Error(`path: duplicate section ${s.name}`);
        ranges[s.name] = [cum[s.at]!, k + 1 < secs.length ? cum[secs[k + 1]!.at]! : total];
    });
    const secAt = (S: number) => {
        let name = secs[0]!.name;
        for (const s of secs) if (cum[s.at]! <= S) name = s.name;
        return name;
    };
    const m = Math.round(total / CP_SPACING);
    const cps: ControlPoint[] = [];
    for (let k = 0; k < m; ++k) {
        const S = (total * k) / m;
        cps.push({ p: at(S), s: S, seg: secAt(S) });
    }
    return { cps, ranges, total };
}

export function buildCourse(def: TrackDef): BuiltCourse {
    const summary: string[] = [];
    const ck = {
        spacing: 2500,
        maxTurnDeg: 20,
        keyCount: 4,
        margin: 300,
        openMargin: 1500,
        jugemEvery: 3,
        shortcutGap: 8000,
        ...def.checkpoints,
    };
    const baseY = def.baseY ?? 0;
    const XS: CrossSection = def.crossSection;

    // ---- centerline ----------------------------------------------------------------------------
    let ranges: Record<string, [number, number]>;
    let turtleTotal = 0;
    let cps: ControlPoint[];
    if (def.path) {
        // Explicit closed path (world x, z): control points at uniform spacing along it; named
        // sections take the place of turtle segments. Plan (u, v) = world (z, x).
        const r = pathControlPoints(def.path);
        ranges = r.ranges;
        turtleTotal = r.total;
        cps = r.cps;
    } else {
        if (!def.program || !def.closure) throw new Error(`${def.id}: needs a program + closure or a path`);
        const program: TurtleSeg[] = def.program.map((s, i) => {
            const name = s.name || `seg${i}`;
            return s.kind === 'straight'
                ? { kind: 'straight', len: s.len, name }
                : { kind: 'arc', radius: s.radius, deg: s.deg, name, ...(s.ease === false ? { ease: false } : {}) };
        });
        const segs = solveClosure(program, def.closure, def.validate?.turning);
        ranges = turtleRanges(segs);
        for (const v of Object.values(ranges)) turtleTotal = Math.max(turtleTotal, v[1]);
        cps = controlPoints(segs);
    }
    const pl: Polyline = sampleSpline(cps.map((c) => c.p));
    const L = pl.length;

    /** Map a turtle arc length to spline arc length through the control points. */
    const turtleToSpline = (s: number): number => {
        for (let k = 0; k < cps.length; ++k) {
            const s0 = cps[k]!.s;
            const s1 = k + 1 < cps.length ? cps[k + 1]!.s : turtleTotal;
            if (s >= s0 && s <= s1) {
                const S0 = pl.cpS[k]!;
                const S1 = k + 1 < cps.length ? pl.cpS[k + 1]! : L;
                return S0 + ((s - s0) / (s1 - s0)) * (S1 - S0);
            }
        }
        throw new Error(`turtleToSpline(${s})`);
    };
    const splineRangeCache = new Map<string, [number, number]>();
    const splineRange = (name: string): [number, number] => {
        let v = splineRangeCache.get(name);
        if (!v) {
            const r = ranges[name];
            if (!r) throw new Error(`${def.id}: unknown segment '${name}'`);
            v = [turtleToSpline(r[0]), turtleToSpline(r[1])];
            splineRangeCache.set(name, v);
        }
        return v;
    };
    const resolveRef = (ref: Ref): number => {
        const r = splineRange(ref.seg);
        const at = ref.at ?? 0;
        return at >= 0 ? r[0] + at : r[1] + at;
    };
    const resolveRange = (range: Range): [number, number] => {
        let out: [number, number];
        if (typeof range === 'string') out = splineRange(range);
        else if ('seg' in range) {
            const r = splineRange(range.seg);
            out = [
                range.from !== undefined ? resolveRef({ seg: range.seg, at: range.from }) : r[0],
                range.to !== undefined ? resolveRef({ seg: range.seg, at: range.to }) : r[1],
            ];
        } else out = [resolveRef(range.from), resolveRef(range.to)];
        if (!(out[0] < out[1]) || out[0] < 0 || out[1] > L) throw new Error(`${def.id}: bad range ${JSON.stringify(range)} -> ${out}`);
        return out;
    };
    const resolveSpan = (span: Span): [number, number] => {
        const c = resolveRef({ seg: span.seg, at: span.at });
        return [c - span.len / 2, c + span.len / 2];
    };

    // ---- zones ---------------------------------------------------------------------------------
    const zones: Zone[] = [];
    for (const s of def.program ?? []) {
        if (!s.name) continue;
        if (s.bump) zones.push({ kind: 'bump', range: s.name, height: s.bump });
        if (s.rise) zones.push({ kind: 'rise', range: s.name, dh: s.rise });
        if (s.bank && s.kind === 'arc') zones.push({ kind: 'bank', range: s.name, deg: Math.sign(s.deg) * s.bank });
    }
    zones.push(...def.zones);

    type RZ = { z: Zone; r: [number, number]; idx: number };
    const rz: RZ[] = zones.map((z, idx) => ({ z, idx, r: 'span' in z ? resolveSpan(z.span) : resolveRange(z.range) }));
    const byKind = <K extends Zone['kind']>(k: K) => rz.filter((x) => x.z.kind === k) as (RZ & { z: Extract<Zone, { kind: K }> })[];
    const inside = (S: number, r: [number, number]) => S > r[0] && S < r[1];
    const wrapS = (S: number) => ((S % L) + L) % L;

    const bumps = byKind('bump');
    const rises = byKind('rise');
    {
        const sum = rises.reduce((a, x) => a + x.z.dh, 0);
        if (Math.abs(sum) > 1e-6) throw new Error(`${def.id}: rises sum to ${sum}, must be 0`);
    }
    const profileY = def.profile ? makeProfile(def.profile.map((k) => ({ S: wrapS(resolveRef(k.at)), y: k.y })), L) : null;
    const cannons = byKind('cannon');
    if (cannons.length > 8) throw new Error(`${def.id}: at most 8 cannons (KCL variant bits)`);
    /** Cannon flight height (kart position) at S inside a cannon range, else null. */
    const cannonY = (S: number): number | null => {
        for (const c of cannons) {
            if (!inside(S, c.r)) continue;
            const tS = resolveRef(c.z.target.at);
            const y0 = baseElevation(c.r[0]) + CANNON_ENTRY_DY;
            const y1 = c.z.target.y;
            if (S <= tS) {
                const t = (S - c.r[0]) / (tS - c.r[0]);
                const pitch = Math.atan2(y1 - y0, tS - c.r[0]);
                const arc = CANNON_ARC[c.z.param ?? 1]! * Math.sin(Math.PI * t) * Math.cos(pitch);
                return y0 + (y1 - y0) * t + arc;
            }
            const t = (S - tS) / (c.r[1] - tS);
            return y1 + (baseElevation(c.r[1]) + CANNON_ENTRY_DY - y1) * t;
        }
        return null;
    };
    function elevation(S: number): number {
        S = wrapS(S);
        const cy = cannonY(S);
        return cy === null ? baseElevation(S) : cy - CANNON_ENTRY_DY;
    }
    function baseElevation(S: number): number {
        S = wrapS(S);
        let y = profileY ? profileY(S) : baseY;
        for (const b of bumps) {
            if (S <= b.r[0] || S >= b.r[1]) continue;
            const t = (S - b.r[0]) / (b.r[1] - b.r[0]);
            y = y + (b.z.height / 2) * (1 - Math.cos(2 * Math.PI * t));
        }
        for (const r of rises) {
            if (S <= r.r[0]) continue;
            if (S >= r.r[1]) {
                y = y + r.z.dh;
                continue;
            }
            const t = (S - r.r[0]) / (r.r[1] - r.r[0]);
            y = y + (r.z.dh * (1 - Math.cos(Math.PI * t))) / 2;
        }
        return y;
    }
    const grade = (S: number) => (elevation(S + 10) - elevation(S - 10)) / 20;

    const banks = byKind('bank');
    function bankDeg(S: number): number {
        S = wrapS(S);
        let d = 0;
        for (const b of banks) {
            const e = b.z.ease ?? Math.min(1500, (b.r[1] - b.r[0]) / 3);
            const w = window(S, b.r[0], b.r[1], e);
            if (w > 0) d += b.z.deg * w;
        }
        return d;
    }

    const widths = byKind('width');
    const islands = byKind('island');
    function xsec(S: number): XSec {
        S = wrapS(S);
        let road = XS.road;
        let offL = XS.offroadL;
        let offR = XS.offroadR;
        for (const w of widths) {
            const e = w.z.ease ?? Math.min(1500, (w.r[1] - w.r[0]) / 3);
            const k = window(S, w.r[0], w.r[1], e);
            if (k <= 0) continue;
            if (w.z.road !== undefined) road = road + (w.z.road - XS.road) * k;
            if (w.z.offroadL !== undefined) offL = offL + (w.z.offroadL - XS.offroadL) * k;
            if (w.z.offroadR !== undefined) offR = offR + (w.z.offroadR - XS.offroadR) * k;
        }
        let isl = 0;
        for (const is of islands) {
            const e = is.z.ease ?? Math.min(2500, (is.r[1] - is.r[0]) / 4);
            const k = window(S, is.r[0], is.r[1], e);
            if (k > 0) isl += is.z.half * k;
        }
        const roadL = isl > 0 ? road + isl : road;
        const roadR = -roadL;
        return { roadL, roadR, wallL: roadL + offL, wallR: roadR - offR, isl };
    }
    const wallOverrides = byKind('walls');
    const shortcuts = byKind('shortcut');
    const halfpipes = byKind('halfpipe');
    const airRooms = byKind('airRoom');
    /**
     * The air room on a side at S (airRoom zones): how far out the invisible wall stands (linear ease
     * in and out) and from what height above the road (null: the barrier's top).
     */
    const airRoomAt = (S: number, side: 1 | -1) => {
        let out = 0;
        let above: number | null = null;
        for (const a of airRooms) {
            if ((a.z.side === 'left' ? 1 : -1) !== side || S < a.r[0] || S > a.r[1]) continue;
            const t = Math.min(1, (S - a.r[0]) / (a.z.easeIn ?? 1), (a.r[1] - S) / (a.z.easeOut ?? 1));
            out = Math.max(out, a.z.out * Math.max(0, t));
            if (a.z.above !== undefined) above = a.z.above;
        }
        return { out, above };
    };
    /**
     * Wall presence and invisible wall height (above the walls) on each side at S (midpoint of an
     * interval). Shortcuts open the inner side.
     */
    function wallsAt(S: number): { left: boolean; right: boolean; invisibleL: number; invisibleR: number; slick: boolean } {
        let left = XS.wallL;
        let right = XS.wallR;
        let slick = false;
        let invisibleL = XS.invisibleWallH ?? 0;
        let invisibleR = invisibleL;
        for (const w of wallOverrides) {
            if (!inside(S, w.r)) continue;
            if (w.z.left !== undefined) left = w.z.left;
            if (w.z.right !== undefined) right = w.z.right;
            if (w.z.slick) slick = true;
            const ih = w.z.invisibleWallH;
            if (typeof ih === 'number') invisibleL = invisibleR = ih;
            else if (ih) {
                invisibleL = ih.left ?? invisibleL;
                invisibleR = ih.right ?? invisibleR;
            }
        }
        // Past a half-pipe's end the invisible walls top a launch off its last stretch.
        for (const hp of halfpipes) {
            const past = wrapS(S - hp.r[1]);
            if (past > 0 && past < HALFPIPE_FLIGHT.reach) {
                const h = (hp.z.height ?? 700) + HALFPIPE_FLIGHT.rise + FLIGHT_CLEAR - XS.wallH;
                invisibleL = Math.max(invisibleL, h);
                invisibleR = Math.max(invisibleR, h);
            }
        }
        for (const sc of shortcuts) {
            if (!inside(S, sc.r)) continue;
            if (sc.z.side === 'left') left = false;
            else right = false;
        }
        return { left, right, invisibleL, invisibleR, slick };
    }
    /** Fall band overrides for open edges (walls zones with `fall`): null = default band. */
    type FallBand = false | { depth: number; width: number };
    const fallBandAt = (S: number) => {
        let left: FallBand | null = null;
        let right: FallBand | null = null;
        for (const w of wallOverrides) {
            if (!inside(S, w.r) || w.z.fall === undefined || w.z.fall === true) continue;
            if (w.z.left === false) left = w.z.fall;
            if (w.z.right === false) right = w.z.fall;
        }
        return { left, right };
    };
    const openAt = (S: number) => {
        const w = wallsAt(S);
        let left = !w.left;
        let right = !w.right;
        for (const sc of shortcuts) {
            if (!inside(S, sc.r)) continue;
            if (sc.z.side === 'left') left = false;
            else right = false;
        }
        return { left, right };
    };

    const latOf = (lat: Lat | undefined, r: [number, number], dflt: 'road' | 'all' | [number, number]): [number, number] => {
        const mid = (r[0] + r[1]) / 2;
        const x = xsec(mid);
        if (lat === 'leftLane') return [x.isl, x.roadL];
        if (lat === 'rightLane') return [x.roadR, -x.isl];
        if (lat) return lat;
        if (dflt === 'road') return [x.roadR, x.roadL];
        if (dflt === 'all') return [-1e6, 1e6];
        return dflt;
    };

    type Overlay = { r: [number, number]; lat: [number, number]; attr: number; latLines: boolean };
    const overlays: Overlay[] = [];
    type RampZ = { r: [number, number]; lat: [number, number]; attr: number; height: number; exp: number; full: boolean };
    const ramps: RampZ[] = [];
    type GapZ = { r: [number, number]; lat: [number, number]; depth: number; full: boolean };
    const gaps: GapZ[] = [];
    for (const x of rz) {
        const z = x.z;
        if (z.kind === 'dashPanel') overlays.push({ r: x.r, lat: latOf(z.lat, x.r, [-600, 600]), attr: KCL.boostPanel, latLines: true });
        else if (z.kind === 'jumpPad') overlays.push({ r: x.r, lat: latOf(z.lat, x.r, 'road'), attr: KCL.jumpPad(z.variant), latLines: true });
        else if (z.kind === 'surface') overlays.push({ r: x.r, lat: latOf(z.lat, x.r, 'road'), attr: z.attr, latLines: !!z.lat });
        else if (z.kind === 'ramp')
            ramps.push({
                r: x.r,
                lat: latOf(z.lat, x.r, 'all'),
                attr: z.attr ?? KCL.boostRamp(1),
                height: z.height,
                exp: z.exp ?? 2,
                full: !z.lat,
            });
        else if (z.kind === 'gap') gaps.push({ r: x.r, lat: latOf(z.lat, x.r, 'all'), depth: z.depth ?? FALL_DEPTH_GAP, full: !z.lat });
    }
    const rampAt = (S: number) => ramps.find((r) => inside(S, r.r)) ?? null;
    const halfpipeAt = (S: number, side: 1 | -1) => halfpipes.find((h) => inside(S, h.r) && (h.z.side === 'left') === (side === 1)) ?? null;
    /**
     * Half-pipe height at S: full height, eased in and out over the zone's run-ins (`ease`) from a
     * 4% lip at the ends (a kerb-sized edge, so the lip line and the pipe's body run end to end).
     */
    const pipeHeight = (hp: (typeof halfpipes)[number], S: number) => {
        const H = hp.z.height ?? 700;
        const e = hp.z.ease ?? 0;
        if (!e) return H;
        const t = Math.min(1, Math.max(0, Math.min(S - hp.r[0], hp.r[1] - S) / e));
        return H * (0.04 + 0.96 * t * t * (3 - 2 * t));
    };
    const rampOffset = (rp: RampZ, S: number) => {
        const t = Math.min(1, Math.max(0, (S - rp.r[0]) / (rp.r[1] - rp.r[0])));
        return rp.height * Math.pow(t, rp.exp);
    };

    // ---- frames --------------------------------------------------------------------------------
    function frameAt(S: number): Frame {
        const { p, tan } = polyAt(pl, S);
        // plan (u, v) → world (x = v, z = u)
        const x = def.origin ? p[1] + def.origin[0] : p[1];
        const z = def.origin ? p[0] + def.origin[1] : p[0];
        const fx = tan[1];
        const fz = tan[0];
        const yaw = (Math.atan2(fx, fz) * 180) / Math.PI;
        const bd = bankDeg(S);
        const br = (bd * Math.PI) / 180;
        return { S, c: [x, elevation(S), z], fwd: [fx, 0, fz], left: [fz, 0, -fx], yaw, cb: Math.cos(br), sb: Math.sin(br), bankDeg: bd };
    }
    /** Surface point at lateral offset `off` (+left), with an optional ramp offset and extra dy. */
    function lateral(f: Frame, off: number, dy = 0, ramp: RampZ | null = null): V3 {
        const h = f.sb === 0 ? off : off * f.cb;
        let y = f.c[1];
        if (f.sb !== 0) y = y - off * f.sb;
        if (ramp) y = y + rampOffset(ramp, f.S);
        return [f.c[0] + f.left[0] * h, y + dy, f.c[2] + f.left[2] * h];
    }

    // ---- stations ------------------------------------------------------------------------------
    const dense = (def.stations?.dense ?? []).map((d) => ({ r: resolveRange(d.range), max: d.max }));
    function stationStep(S: number): number {
        const k = Math.abs(curvatureAt(pl, S, 200));
        const R = k > 1e-9 ? 1 / k : Infinity;
        let step = Math.min(def.stations?.max ?? 500, Math.max(150, R * (((def.stations?.deg ?? 3) * Math.PI) / 180)));
        for (const rp of ramps) if (S >= rp.r[0] - 1 && S < rp.r[1]) step = Math.min(step, 100);
        for (const d of dense) if (S >= d.r[0] - 1 && S < d.r[1]) step = Math.min(step, d.max);
        // Half-pipe run-ins: fine enough that the rising lip reads as a curve.
        for (const hp of halfpipes) {
            const e = hp.z.ease ?? 0;
            if (e && ((S >= hp.r[0] - 1 && S < hp.r[0] + e) || (S >= hp.r[1] - e - 1 && S < hp.r[1]))) step = Math.min(step, e / 5);
        }
        return step;
    }
    const forcedSet = new Set<number>();
    for (const o of overlays) o.r.forEach((v) => forcedSet.add(v));
    for (const rp of ramps) rp.r.forEach((v) => forcedSet.add(v));
    for (const g of gaps) g.r.forEach((v) => forcedSet.add(v));
    for (const sc of shortcuts) sc.r.forEach((v) => forcedSet.add(v));
    for (const is of islands) is.r.forEach((v) => forcedSet.add(v));
    for (const w of wallOverrides) w.r.forEach((v) => forcedSet.add(v));
    for (const c of cannons) c.r.forEach((v) => forcedSet.add(v));
    for (const hp of halfpipes) hp.r.forEach((v) => forcedSet.add(v));
    for (const a of airRooms) [a.r[0], a.r[0] + (a.z.easeIn ?? 0), a.r[1] - (a.z.easeOut ?? 0), a.r[1]].forEach((v) => forcedSet.add(v));
    const forced = [...forcedSet].sort((a, b) => a - b);
    const stationS: number[] = [];
    {
        let S = 0;
        let fi = 0;
        while (S < L - 1e-6) {
            stationS.push(S);
            let next = S + stationStep(S);
            if (fi < forced.length && next >= forced[fi]! - 1e-6) {
                next = forced[fi]!;
                ++fi;
                if (next - S < 1) {
                    stationS.pop();
                    stationS.push(next);
                    S = next;
                    continue;
                }
            }
            if (L - next < 0.5 * stationStep(S)) break;
            S = next;
        }
    }
    const frames = stationS.map(frameAt);
    const N = frames.length;

    // ---- KCL triangles -------------------------------------------------------------------------
    const tris: Tri[] = [];
    /** Adds triangle (a,b,c), flipping winding so that its normal has a positive dot with `want`. */
    function addTri(a: V3, b: V3, c: V3, attr: number, want: V3): void {
        const n = cross3(sub3(b, a), sub3(c, a));
        if (dot3(n, want) < 0) tris.push({ a, b: c, c: b, attr });
        else tris.push({ a, b, c, attr });
    }
    function addQuad(p0: V3, p1: V3, q1: V3, q0: V3, attr: number, want: V3): void {
        addTri(p0, p1, q1, attr, want);
        addTri(p0, q1, q0, attr, want);
    }
    const splits = XS.splits ?? [];
    const roadAttr = XS.roadAttr ?? KCL.road;
    const offroadAttr = XS.offroadAttr ?? KCL.offroad;
    let minRoadY = Infinity;
    let maxRoadY = -Infinity;

    for (let i = 0; i < N; ++i) {
        const f0 = frames[i]!;
        const f1 = frames[(i + 1) % N]!;
        const S1 = i + 1 < N ? f1.S : L;
        const midS = i + 1 < N ? (f0.S + f1.S) / 2 : (f0.S + L) / 2;
        if (cannons.some((c) => inside(midS, c.r))) continue; // cannon flight: no geometry
        const x0 = xsec(f0.S);
        const x1 = xsec(S1);
        const xm = xsec(midS);
        const islActive = islands.some((is) => inside(midS, is.r));
        const lines: Line[] = [
            { o0: x0.wallL, o1: x1.wallL, tag: 'wallL' },
            { o0: x0.roadL, o1: x1.roadL, tag: 'roadL' },
        ];
        if (islActive) lines.push({ o0: x0.isl, o1: x1.isl, tag: 'islL' }, { o0: -x0.isl, o1: -x1.isl, tag: 'islR' });
        for (const sp of splits) {
            if (islActive && Math.abs(sp) < xm.isl + 1) continue;
            lines.push({ o0: sp, o1: sp, tag: 'split' });
        }
        const activeOverlays = overlays.filter((o) => inside(midS, o.r));
        const ramp = rampAt(midS);
        const activeGaps = gaps.filter((g) => inside(midS, g.r));
        const addLat = (lat: [number, number]) => {
            for (const v of lat) if (Math.abs(v) < 1e5 && v < xm.wallL - 1 && v > xm.wallR + 1) lines.push({ o0: v, o1: v, tag: 'feature' });
        };
        for (const o of activeOverlays) if (o.latLines) addLat(o.lat);
        if (ramp && !ramp.full) addLat(ramp.lat);
        for (const g of activeGaps) if (!g.full) addLat(g.lat);
        lines.push({ o0: x0.roadR, o1: x1.roadR, tag: 'roadR' }, { o0: x0.wallR, o1: x1.wallR, tag: 'wallR' });
        lines.sort((a, b) => (b.o0 + b.o1) / 2 - (a.o0 + a.o1) / 2);
        const L2: Line[] = [];
        for (const ln of lines) {
            const prev = L2[L2.length - 1];
            if (prev && Math.abs(prev.o0 - ln.o0) < 1 && Math.abs(prev.o1 - ln.o1) < 1) continue;
            L2.push(ln);
        }

        // Strips (left → right).
        type Strip = { attr: number | null; ramp: RampZ | null; a0: V3; b0: V3; a1: V3; b1: V3 };
        const strips: Strip[] = [];
        for (let k = 0; k + 1 < L2.length; ++k) {
            const A = L2[k]!;
            const B = L2[k + 1]!;
            const midLat = (A.o0 + A.o1 + B.o0 + B.o1) / 4;
            let attr: number | null;
            if (islActive && Math.abs(midLat) < xm.isl) attr = islands.find((is) => inside(midS, is.r))!.z.attr ?? KCL.offroad;
            else if (midLat <= xm.roadL && midLat >= xm.roadR) attr = roadAttr;
            else attr = offroadAttr;
            for (const o of activeOverlays) if (midLat > o.lat[0] && midLat < o.lat[1]) attr = o.attr;
            let rp: RampZ | null = null;
            if (ramp && midLat > ramp.lat[0] && midLat < ramp.lat[1]) {
                rp = ramp;
                attr = ramp.attr;
            }
            for (const g of activeGaps) if (midLat > g.lat[0] && midLat < g.lat[1]) attr = null;
            const s1f: Frame = i + 1 < N ? f1 : { ...f1, S: L };
            strips.push({
                attr,
                ramp: rp,
                a0: lateral(f0, A.o0, 0, rp),
                b0: lateral(f0, B.o0, 0, rp),
                a1: lateral(s1f, A.o1, 0, rp),
                b1: lateral(s1f, B.o1, 0, rp),
            });
        }
        const leftDirHp: V3 = [f0.left[0] + f1.left[0], 0, f0.left[2] + f1.left[2]];
        const pipeSides = new Set<1 | -1>();
        for (const side of [1, -1] as const) {
            const hp = halfpipeAt(midS, side);
            if (!hp) continue;
            const k = side === 1 ? 0 : strips.length - 1;
            const st = strips[k]!;
            const A = L2[k]!;
            const B = L2[k + 1]!;
            if (st.attr === null || st.ramp) throw new Error(`${def.id}: halfpipe over a gap/ramp at S=${midS.toFixed(0)}`);
            // Outer (wall) line and inner (road edge) line of the outermost strip on this side.
            const outer = side === 1 ? A : B;
            const inner = side === 1 ? B : A;
            if (Math.abs(outer.o0 - inner.o0) < 100) throw new Error(`${def.id}: halfpipe needs an offroad strip (S=${midS.toFixed(0)})`);
            pipeSides.add(side);
            const NP = 8;
            const s1f: Frame = i + 1 < N ? f1 : { ...f1, S: L };
            const H0 = pipeHeight(hp, f0.S);
            const H1 = pipeHeight(hp, s1f.S);
            const inward: V3 = [-side * leftDirHp[0], 0, -side * leftDirHp[2]];
            const pt = (f: Frame, o0: number, o1: number, th: number): V3 => lateral(f, o0 + (o1 - o0) * Math.sin(th), (f === f0 ? H0 : H1) * (1 - Math.cos(th)));
            for (let j = 0; j < NP; ++j) {
                const ta = ((Math.PI / 2) * j) / NP;
                const tb = ((Math.PI / 2) * (j + 1)) / NP;
                const tm = (ta + tb) / 2;
                const want: V3 = [inward[0] * Math.sin(tm), Math.cos(tm), inward[2] * Math.sin(tm)];
                addQuad(pt(f0, inner.o0, outer.o0, ta), pt(s1f, inner.o1, outer.o1, ta), pt(s1f, inner.o1, outer.o1, tb), pt(f0, inner.o0, outer.o0, tb), KCL.halfPipe, want);
            }
            // Invisible half-pipe wall above the lip, a deck behind it and a back wall.
            const WH = hp.z.wallH ?? 4000;
            const DECK = 300;
            const lip0 = lateral(f0, outer.o0, H0);
            const lip1 = lateral(s1f, outer.o1, H1);
            addQuad(lip0, lip1, [lip1[0], lip1[1] + WH, lip1[2]], [lip0[0], lip0[1] + WH, lip0[2]], KCL.halfPipeWall, inward);
            const back0 = lateral(f0, outer.o0 + side * DECK, H0);
            const back1 = lateral(s1f, outer.o1 + side * DECK, H1);
            addQuad(lip0, lip1, back1, back0, offroadAttr, [0, 1, 0]);
            addQuad(back0, back1, [back1[0], back1[1] + XS.wallH, back1[2]], [back0[0], back0[1] + XS.wallH, back0[2]], KCL.wall, inward);
            if (XS.invisibleWallH) {
                const t0: V3 = [back0[0], back0[1] + XS.wallH, back0[2]];
                const t1: V3 = [back1[0], back1[1] + XS.wallH, back1[2]];
                addQuad(t0, t1, [t1[0], t1[1] + XS.invisibleWallH, t1[2]], [t0[0], t0[1] + XS.invisibleWallH, t0[2]], KCL.invisibleWall, inward);
            }
        }
        for (let k = 0; k < strips.length; ++k) {
            const st = strips[k]!;
            if (st.attr === null) continue;
            if ((k === 0 && pipeSides.has(1)) || (k === strips.length - 1 && pipeSides.has(-1))) continue;
            addTri(st.a0, st.b0, st.b1, st.attr, [0, 1, 0]);
            addTri(st.a0, st.b1, st.a1, st.attr, [0, 1, 0]);
            minRoadY = Math.min(minRoadY, st.a0[1], st.b0[1]);
            maxRoadY = Math.max(maxRoadY, st.a0[1], st.b0[1]);
        }
        const leftDir: V3 = [f0.left[0] + f1.left[0], 0, f0.left[2] + f1.left[2]];
        const down = (p: V3): V3 => [p[0], p[1] - FACE_DEPTH, p[2]];
        // Step faces between adjacent strips at different heights (partial ramps, lane gaps).
        for (let k = 0; k + 1 < strips.length; ++k) {
            const A = strips[k]!; // left of the line: its right edge is b
            const B = strips[k + 1]!; // right of the line: its left edge is a
            if (A.attr === null && B.attr === null) continue;
            if (A.attr !== null && B.attr !== null) {
                const d0 = A.b0[1] - B.a0[1];
                const d1 = A.b1[1] - B.a1[1];
                if (Math.abs(d0) < 1 && Math.abs(d1) < 1) continue;
                const want: V3 = d0 + d1 > 0 ? [-leftDir[0], 0, -leftDir[2]] : leftDir;
                addQuad(A.b0, A.b1, B.a1, B.a0, KCL.wall, want);
            } else if (A.attr !== null) {
                addQuad(A.b0, A.b1, down(A.b1), down(A.b0), KCL.wall, [-leftDir[0], 0, -leftDir[2]]);
            } else {
                addQuad(B.a0, B.a1, down(B.a1), down(B.a0), KCL.wall, leftDir);
            }
        }
        // Walls (normals face the track).
        const walls = wallsAt(midS);
        for (const side of [1, -1] as const) {
            if (side === 1 ? !walls.left : !walls.right) continue;
            if (pipeSides.has(side)) continue;
            const st = side === 1 ? strips[0]! : strips[strips.length - 1]!;
            const ln = side === 1 ? L2[0]! : L2[L2.length - 1]!;
            let p0: V3;
            let p1: V3;
            if (st.attr !== null) {
                p0 = side === 1 ? st.a0 : st.b0;
                p1 = side === 1 ? st.a1 : st.b1;
            } else {
                p0 = lateral(f0, ln.o0, -FACE_DEPTH);
                p1 = lateral(i + 1 < N ? f1 : { ...f1, S: L }, ln.o1, -FACE_DEPTH);
            }
            const q0: V3 = [p0[0], p0[1] + XS.wallH, p0[2]];
            const q1: V3 = [p1[0], p1[1] + XS.wallH, p1[2]];
            if (st.attr === null) {
                q0[1] += FACE_DEPTH;
                q1[1] += FACE_DEPTH;
            }
            const inward: V3 = [-side * leftDir[0], 0, -side * leftDir[2]];
            const wallAttr = walls.slick ? KCL.slickWall : KCL.wall;
            const invisibleAttr = walls.slick ? KCL.slickWall : KCL.invisibleWall;
            addTri(p0, p1, q1, wallAttr, inward);
            addTri(p0, q1, q0, wallAttr, inward);
            const up = side === 1 ? walls.invisibleL : walls.invisibleR;
            if (up) {
                const top0: V3 = [q0[0], q0[1] + up, q0[2]];
                const top1: V3 = [q1[0], q1[1] + up, q1[2]];
                const r0 = airRoomAt(f0.S, side);
                const r1 = airRoomAt(S1, side);
                if (!r0.out && !r1.out) addQuad(q0, q1, top1, top0, invisibleAttr, inward);
                else {
                    // Air room: the wall stands out by `out` (along each station's own lateral) from
                    // `above` the road up; below that (if higher than the barrier) it stays on the line.
                    // The room's floor slopes up and out from the line (AIR_ROOM_FLOOR), so a kart
                    // that comes down in it slides back in over the barrier instead of dropping
                    // outside it.
                    const lift = Math.max(0, (r0.above ?? r1.above ?? XS.wallH) - XS.wallH);
                    const at = (q: V3, f: Frame, o: number, dy: number): V3 => [q[0] + side * f.left[0] * o, q[1] + dy, q[2] + side * f.left[2] * o];
                    const rise0 = lift + Math.min(r0.out * 2, AIR_ROOM_FLOOR);
                    const rise1 = lift + Math.min(r1.out * 2, AIR_ROOM_FLOOR);
                    if (lift) addQuad(q0, q1, at(q1, f1, 0, lift), at(q0, f0, 0, lift), invisibleAttr, inward);
                    const floorWant: V3 = [inward[0], 1, inward[2]];
                    if (r1.out) addTri(at(q0, f0, 0, lift), at(q1, f1, 0, lift), at(q1, f1, r1.out, rise1), invisibleAttr, floorWant);
                    if (r0.out) addTri(at(q0, f0, 0, lift), at(q1, f1, r1.out, rise1), at(q0, f0, r0.out, rise0), invisibleAttr, floorWant);
                    addQuad(at(q0, f0, r0.out, rise0), at(q1, f1, r1.out, rise1), at(q1, f1, r1.out, up), at(q0, f0, r0.out, up), invisibleAttr, inward);
                }
            }
        }
        // Island walls (face the lanes).
        if (islActive) {
            const is = islands.find((x) => inside(midS, x.r))!;
            const wallH = is.z.wallH ?? 800;
            for (let k = 0; k < L2.length; ++k) {
                const ln = L2[k]!;
                if (ln.tag !== 'islL' && ln.tag !== 'islR') continue;
                // Lane strip: left of islL, right of islR.
                const lane = ln.tag === 'islL' ? strips[k - 1]! : strips[k]!;
                let p0: V3;
                let p1: V3;
                if (lane.attr !== null) {
                    p0 = ln.tag === 'islL' ? lane.b0 : lane.a0;
                    p1 = ln.tag === 'islL' ? lane.b1 : lane.a1;
                } else {
                    p0 = lateral(f0, ln.o0, -FACE_DEPTH);
                    p1 = lateral(i + 1 < N ? f1 : { ...f1, S: L }, ln.o1, -FACE_DEPTH);
                }
                const extra = lane.attr === null ? FACE_DEPTH : 0;
                const q0: V3 = [p0[0], p0[1] + wallH + extra, p0[2]];
                const q1: V3 = [p1[0], p1[1] + wallH + extra, p1[2]];
                const want: V3 = ln.tag === 'islL' ? leftDir : [-leftDir[0], 0, -leftDir[2]];
                addQuad(p0, p1, q1, q0, KCL.wall, want);
            }
        }
        // Fall boundaries: under gaps, and bands outside open (wall-less) edges.
        const open = openAt(midS);
        const f1e = i + 1 < N ? f1 : { ...f1, S: L };
        const kIn = curvatureAt(pl, midS, 200); // + = left turn (left side is inside)
        const bandW = (side: number, edge: number) => {
            const insideCurve = kIn * side > 0;
            if (!insideCurve || Math.abs(kIn) < 1e-9) return FALL_BAND;
            return Math.max(0, Math.min(FALL_BAND, 0.7 * (1 / Math.abs(kIn) - Math.abs(edge))));
        };
        for (const g of activeGaps) {
            let lo = Math.max(g.lat[0], L2[L2.length - 1]!.o0 < L2[L2.length - 1]!.o1 ? L2[L2.length - 1]!.o0 : L2[L2.length - 1]!.o1);
            let hi = Math.min(g.lat[1], Math.max(L2[0]!.o0, L2[0]!.o1));
            if (g.full) {
                if (open.left) hi += bandW(1, hi);
                if (open.right) lo -= bandW(-1, lo);
            }
            const y = Math.min(f0.c[1], f1e.c[1]) - g.depth;
            const P = (f: Frame, off: number): V3 => {
                const p = lateral(f, off);
                return [p[0], y, p[2]];
            };
            addQuad(P(f0, hi), P(f1e, hi), P(f1e, lo), P(f0, lo), KCL.fallBoundary, [0, 1, 0]);
        }
        for (const side of [1, -1]) {
            if (side === 1 ? !open.left : !open.right) continue;
            if (activeGaps.some((g) => g.full)) continue;
            const fb = fallBandAt(midS)[side === 1 ? 'left' : 'right'];
            if (fb === false) continue;
            const ln = side === 1 ? L2[0]! : L2[L2.length - 1]!;
            const w0 = fb ? fb.width : bandW(side, ln.o0);
            const w1 = fb ? fb.width : bandW(side, ln.o1);
            if (w0 < 500 || w1 < 500) continue;
            const depth = fb ? fb.depth : FALL_DEPTH_EDGE;
            const e0 = lateral(f0, ln.o0, -depth);
            const e1 = lateral(f1e, ln.o1, -depth);
            const o0 = lateral(f0, ln.o0 + side * w0, 0);
            const o1 = lateral(f1e, ln.o1 + side * w1, 0);
            o0[1] = e0[1];
            o1[1] = e1[1];
            addQuad(e0, e1, o1, o0, KCL.fallBoundary, [0, 1, 0]);
        }
    }

    // Ramp lips: vertical face from the lip down to the next surface (or into the gap).
    const frameAtS = (S: number) => frames.find((f) => Math.abs(f.S - S) < 1e-6) ?? frameAt(S);
    const featureMeta: Record<string, unknown>[] = [];
    for (const rp of ramps) {
        const f = frameAtS(rp.r[1]);
        const x = xsec(rp.r[1]);
        const lo = Math.max(rp.lat[0], x.wallR);
        const hi = Math.min(rp.lat[1], x.wallL);
        const nextGap = gaps.some((g) => Math.abs(g.r[0] - rp.r[1]) < 1);
        const top0 = lateral(f, hi, 0, rp);
        const top1 = lateral(f, lo, 0, rp);
        const bot0 = nextGap ? lateral(f, hi, -FACE_DEPTH) : lateral(f, hi);
        const bot1 = nextGap ? lateral(f, lo, -FACE_DEPTH) : lateral(f, lo);
        addQuad(top0, top1, bot1, bot0, KCL.wall, f.fwd);
    }
    // Gap edges: faces below the takeoff edge (if no ramp lip) and below the landing edge.
    for (const g of gaps) {
        const x0 = xsec(g.r[0]);
        const x1 = xsec(g.r[1]);
        const lipped = ramps.some((rp) => Math.abs(rp.r[1] - g.r[0]) < 1);
        const edge = (S: number, x: XSec, want: V3) => {
            const f = frameAtS(S);
            const lo = Math.max(g.lat[0], x.wallR);
            const hi = Math.min(g.lat[1], x.wallL);
            addQuad(lateral(f, hi), lateral(f, lo), lateral(f, lo, -FACE_DEPTH), lateral(f, hi, -FACE_DEPTH), KCL.wall, want);
        };
        if (!lipped) edge(g.r[0], x0, frameAtS(g.r[0]).fwd);
        const fb = frameAtS(g.r[1]).fwd;
        edge(g.r[1], x1, [-fb[0], 0, -fb[2]]);
    }
    // Shortcut fills: the region between the road's open edge (wall line) and the straight chord
    // joining the edge at the two ends, built as strips from each edge segment to its projection on
    // the chord (valid while the edge advances monotonically along the chord).
    const shortcutMeta: Record<string, unknown>[] = [];
    for (const sc of shortcuts) {
        const side = sc.z.side === 'left' ? 1 : -1;
        const pts: V3[] = [];
        for (const f of frames) {
            if (f.S < sc.r[0] - 1e-6 || f.S > sc.r[1] + 1e-6) continue;
            const x = xsec(f.S);
            pts.push(lateral(f, side === 1 ? x.wallL : x.wallR));
        }
        if (pts.length < 3) throw new Error(`${def.id}: shortcut too short`);
        const a0 = pts[0]!;
        const b0 = pts[pts.length - 1]!;
        const clen = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]);
        const cd = [(b0[0] - a0[0]) / clen, (b0[2] - a0[2]) / clen] as const;
        const proj = (p: V3): V3 => {
            const t = (p[0] - a0[0]) * cd[0] + (p[2] - a0[2]) * cd[1];
            return [a0[0] + cd[0] * t, p[1], a0[2] + cd[1] * t];
        };
        let lastT = -Infinity;
        for (const p of pts) {
            const t = (p[0] - a0[0]) * cd[0] + (p[2] - a0[2]) * cd[1];
            if (t < lastT - 50) throw new Error(`${def.id}: shortcut edge goes back ${(lastT - t).toFixed(0)} along its chord`);
            lastT = t;
        }
        const attr = sc.z.attr ?? KCL.heavyOffroad;
        const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        for (let k = 0; k + 1 < pts.length; ++k) {
            const p = pts[k]!;
            const q = pts[k + 1]!;
            const pp = proj(p);
            const qp = proj(q);
            // Split the strip (edge segment → chord) into pieces <= 1000 long (limits sliver length).
            const dist = Math.max(Math.hypot(p[0] - pp[0], p[2] - pp[2]), Math.hypot(q[0] - qp[0], q[2] - qp[2]));
            const n = Math.max(1, Math.ceil(dist / 1000));
            for (let j = 0; j < n; ++j) {
                const a0 = lerp3(p, pp, j / n);
                const a1 = lerp3(p, pp, (j + 1) / n);
                const b0 = lerp3(q, qp, j / n);
                const b1 = lerp3(q, qp, (j + 1) / n);
                if (Math.hypot(b0[0] - b1[0], b0[2] - b1[2]) > 1) addTri(a0, b0, b1, attr, [0, 1, 0]);
                if (Math.hypot(a0[0] - a1[0], a0[2] - a1[2]) > 1) addTri(a0, b1, a1, attr, [0, 1, 0]);
            }
        }
        const cen: V3 = [0, 0, 0];
        for (const p of pts) for (let k = 0; k < 3; ++k) cen[k] = cen[k]! + p[k]! / pts.length;
        // Chord wall (split per station so it follows the edge heights), facing the fill.
        const wh = sc.z.wallH ?? XS.wallH;
        const want: V3 = [cen[0] - (a0[0] + b0[0]) / 2, 0, cen[2] - (a0[2] + b0[2]) / 2];
        for (let k = 0; k + 1 < pts.length; ++k) {
            const pp = proj(pts[k]!);
            const qp = proj(pts[k + 1]!);
            if (Math.hypot(qp[0] - pp[0], qp[2] - pp[2]) < 1) continue;
            addQuad(pp, qp, [qp[0], qp[1] + wh, qp[2]], [pp[0], pp[1] + wh, pp[2]], KCL.wall, want);
        }
        shortcutMeta.push({
            type: 'shortcut',
            label: sc.z.label ?? 'shortcut',
            s: sc.r.map(r1),
            attr,
            pos: v3r(cen),
            polygon: [...pts.map((p) => v3r(p)), ...pts.map((p) => v3r(proj(p))).reverse()],
            chord: [v3r(a0), v3r(b0)],
        });
    }

    // Cannons: a trigger face across the road at the range start (facing the approaching kart) and
    // a CNPT at the target, aimed along the centerline.
    const cnpt: CnptEntry[] = [];
    const cannonMeta: Record<string, unknown>[] = [];
    cannons.forEach((c, ci) => {
        const f = frameAtS(c.r[0]);
        const x = xsec(c.r[0]);
        const lo = lateral(f, x.wallR);
        const hi = lateral(f, x.wallL);
        const TRIGGER_H = 2500;
        addQuad([hi[0], hi[1] - 500, hi[2]], [lo[0], lo[1] - 500, lo[2]], [lo[0], lo[1] + TRIGGER_H, lo[2]], [hi[0], hi[1] + TRIGGER_H, hi[2]], KCL.cannon(ci), [-f.fwd[0], 0, -f.fwd[2]]);
        const tS = resolveRef(c.z.target.at);
        if (!(tS > c.r[0] && tS < c.r[1])) throw new Error(`${def.id}: cannon target must lie inside the cannon range`);
        const ft = frameAt(tS);
        cnpt.push({ pos: [ft.c[0], c.z.target.y, ft.c[2]], rot: [0, ft.yaw, 0], id: ci, param: c.z.param ?? 1 });
        cannonMeta.push({
            type: 'cannon',
            s: c.r.map(r1),
            pos: v3r(f.c),
            yawDeg: r1(f.yaw),
            length: r1(c.r[1] - c.r[0]),
            width: r1(x.wallL - x.wallR),
            size: [r1(x.wallL - x.wallR), 0],
            target: v3r([ft.c[0], c.z.target.y, ft.c[2]]),
            targetS: r1(tS),
            param: c.z.param ?? 1,
        });
    });
    for (const hp of halfpipes) {
        const midS = (hp.r[0] + hp.r[1]) / 2;
        const f = frameAt(midS);
        const x = xsec(midS);
        const side = hp.z.side === 'left' ? 1 : -1;
        cannonMeta.push({
            type: 'halfpipe',
            side: hp.z.side,
            s: hp.r.map(r1),
            pos: v3r(lateral(f, side === 1 ? x.wallL : x.wallR)),
            yawDeg: r1(f.yaw),
            length: r1(hp.r[1] - hp.r[0]),
            height: hp.z.height ?? 700,
            ...(hp.z.ease ? { ease: hp.z.ease } : {}),
        });
    }

    const kcl = encodeKCL(tris, {
        prismThickness: 300,
        sphereRadius: 250,
        maxTrisPerLeaf: 12,
        minLeafShift: 8,
        rootShift: 12,
        margin: 2000,
        // Conservative leaves for thin triangles (f32 edge normals widen them slightly).
        leafSlack: 60,
    });

    // ---- checkpoints ---------------------------------------------------------------------------
    const FINISH_S = resolveRef(def.finish);
    const ckptS: number[] = [];
    {
        let S = FINISH_S;
        const end = FINISH_S + L;
        while (S < end - 1) {
            ckptS.push(S);
            // advance by <= spacing and <= max turning
            let step = 0;
            let turn = 0;
            const yaw0 = frameAt(S).yaw;
            while (step < ck.spacing) {
                step += 50;
                let d = frameAt(S + step).yaw - yaw0;
                d = ((d + 540) % 360) - 180;
                turn = Math.abs(d);
                if (turn > ck.maxTurnDeg) {
                    step -= 50;
                    break;
                }
            }
            // Cannon flights get one long checkpoint quad: a checkpoint just before the trigger and the
            // next one just past the range end.
            for (const c of cannons) {
                const a = c.r[0] - 300;
                const b = c.r[1] + 300;
                const w = wrapS(S);
                if (w < a - 100 && w + step > a) step = a - w;
                else if (w >= a - 100 && w < b) step = b - w;
            }
            step = Math.max(step, 50);
            const remaining = end - (S + step);
            if (remaining < step * 0.5) break;
            S += step;
        }
    }
    const NC = ckptS.length;
    if (NC > 255) throw new Error('too many checkpoints for u8 path indices');

    // Respawn-unsafe S ranges: ramps (approach → landing), gaps, jump pads (+ flight).
    const noRespawn: [number, number][] = [];
    for (const rp of ramps) noRespawn.push([rp.r[0] - 2500, rp.r[1] + 2500]);
    for (const g of gaps) noRespawn.push([g.r[0] - 3000, g.r[1] + 3000]);
    for (const x of byKind('jumpPad')) noRespawn.push([x.r[0] - 2000, x.r[1] + 7000]);
    for (const c of cannons) noRespawn.push([c.r[0] - 1500, c.r[1] + 4000]);
    const unsafe = (S: number) => {
        const w = wrapS(S);
        return noRespawn.some(([a, b]) => (w > a && w < b) || (w + L > a && w + L < b) || (w - L > a && w - L < b));
    };
    // Key checkpoints may not sit where a shortcut skips checkpoints.
    const noKeyRanges = (def.checkpoints?.noKey ?? []).map(resolveRange);
    const noKey = (S: number) => {
        const w = wrapS(S);
        return shortcuts.some((sc) => w > sc.r[0] - 3000 && w < sc.r[1] + 3000) || noKeyRanges.some((r) => w >= r[0] && w <= r[1]);
    };
    const keyIdx: number[] = [];
    for (let k = 0; k < ck.keyCount; ++k) {
        let idx = Math.round((NC * k) / ck.keyCount);
        for (let d = 0; d < NC && k > 0; ++d) {
            const cand = [idx + d, idx - d].find((c) => c > 0 && c < NC && !noKey(ckptS[c]!) && !keyIdx.includes(c));
            if (cand !== undefined) {
                idx = cand;
                break;
            }
        }
        keyIdx.push(idx);
    }
    keyIdx.sort((a, b) => a - b);

    // Stretches of road close to each other in plan (within `shortcutGap`, edge to edge; below, or
    // at most 3000 above: no jump climbs higher) that the lap only reaches much later (a hairpin's legs, a loop's way in and out): a key
    // checkpoint between them. The engine's checkpoint search stops at key checkpoints and a lap
    // only counts once every key has been reached in order, so getting from one to the other (over
    // the barriers, off a jump) moves a kart's lap progress no further than that key.
    let addedKeys = 0;
    {
        /** Checkpoint quad at S: the last checkpoint at or before it (from the finish line on). */
        const ckOf = (S: number) => {
            const w = wrapS(S - FINISH_S);
            let lo = 0;
            let hi = NC - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (ckptS[mid]! - FINISH_S <= w) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        };
        const pts: { S: number; x: number; y: number; z: number; w: number; c: number }[] = [];
        for (let S = 0; S < L; S += 250) {
            if (cannons.some((c) => S > c.r[0] && S < c.r[1])) continue;
            const f = frameAt(S);
            const x = xsec(S);
            pts.push({ S, x: f.c[0], y: f.c[1], z: f.c[2], w: Math.max(x.wallL, -x.wallR), c: ckOf(S) });
        }
        // Checkpoints [a, b] of which one must be a key: strictly after A's quad and before B's (B's
        // own quad is reachable from A even if it is a key's). Quads next to each other can't be split.
        const need = new Map<string, [number, number]>();
        for (const A of pts)
            for (const B of pts) {
                const skip = wrapS(B.S - A.S);
                if (skip < 6000 || skip > L - 6000 || B.y - A.y > 3000) continue;
                const d = Math.hypot(B.x - A.x, B.z - A.z);
                if (d - A.w - B.w > ck.shortcutGap || skip - d < 3000) continue;
                const n = (B.c - A.c + NC) % NC;
                if (n < 2) continue;
                const a = A.c + 1;
                const b = A.c + n - 1;
                if (b >= NC) continue; // crosses the finish line (key 0)
                need.set(`${a},${b}`, [a, b]);
            }
        for (const [a, b] of [...need.values()].sort((x, y) => x[1] - y[1])) {
            if (keyIdx.some((k) => k >= a && k <= b)) continue;
            let idx = -1;
            for (let c = b; c >= a && idx < 0; --c) if (!noKey(ckptS[c]!)) idx = c;
            if (idx < 0) throw new Error(`${def.id}: no checkpoint for a key between S=${wrapS(ckptS[a]!).toFixed(0)} and S=${wrapS(ckptS[b]!).toFixed(0)}`);
            keyIdx.push(idx);
            keyIdx.sort((x, y) => x - y);
            ++addedKeys;
        }
    }
    if (keyIdx.length > 127) throw new Error(`${def.id}: too many key checkpoints (${keyIdx.length})`);

    const islandLaneOffset = (S: number): number => {
        const w = wrapS(S);
        for (const is of islands) {
            if (w > is.r[0] - 1 && w < is.r[1] + 1) {
                const x = xsec(w);
                if (x.isl < 1) return 0;
                const lane = (x.isl + x.roadL) / 2;
                return is.z.respawnLane === 'left' ? lane : -lane;
            }
        }
        return 0;
    };
    // Respawn points: at every `jugemEvery`-th checkpoint and at the first checkpoint after each
    // respawn-unsafe stretch, never inside one. Each checkpoint respawns at the latest point at or
    // before it (wrapping around the finish line if needed).
    const jgpt: JgptEntry[] = [];
    const jgptS: number[] = [];
    const jgptAt: number[] = []; // checkpoint index → jgpt index placed there, or -1
    {
        let lastPlaced = -Infinity;
        let wasUnsafe = false;
        ckptS.forEach((S, i) => {
            const safe = !unsafe(S);
            jgptAt.push(-1);
            if (safe && (i - lastPlaced >= ck.jugemEvery || wasUnsafe)) {
                const f = frameAt(S);
                const off = islandLaneOffset(S);
                const p = off === 0 ? f.c : lateral(f, off);
                jgptAt[i] = jgpt.length;
                jgpt.push({ pos: [p[0], p[1], p[2]], rot: [0, f.yaw, 0], id: jgpt.length, range: -1 });
                jgptS.push(S);
                lastPlaced = i;
            }
            wasUnsafe = !safe;
        });
    }
    if (!jgpt.length) throw new Error(`${def.id}: no respawn points`);
    let lastJugem = jgpt.length - 1; // wraps: checkpoints before the first point use the last one
    const ckpt: CkptEntry[] = ckptS.map((S, i) => {
        const f = frameAt(S);
        if (jgptAt[i]! >= 0) lastJugem = jgptAt[i]!;
        const x = xsec(S);
        const op = openAt(S);
        // Cliff edges above a lower road (custom fall bands) keep the normal margin so the
        // checkpoint quads don't reach over the road below.
        const fb = fallBandAt(wrapS(S));
        const halfL = x.wallL + (op.left && fb.left === null ? ck.openMargin : ck.margin);
        const halfR = -x.wallR + (op.right && fb.right === null ? ck.openMargin : ck.margin);
        const l = [f.c[0] + f.left[0] * halfL, f.c[2] + f.left[2] * halfL];
        const r = [f.c[0] + f.left[0] * -halfR, f.c[2] + f.left[2] * -halfR];
        const ka = keyIdx.indexOf(i);
        return {
            left: [l[0]!, l[1]!],
            right: [r[0]!, r[1]!],
            jugem: lastJugem,
            checkArea: ka >= 0 ? ka : -1,
            prev: i === 0 ? 0xff : i - 1,
            next: i === NC - 1 ? 0xff : i + 1,
        };
    });
    if (ckpt[0]!.jugem < 0) throw new Error(`${def.id}: finish line has no respawn point`);

    const spawnF = frameAt(FINISH_S - (def.spawnBehind ?? 500));
    const finishF = frameAt(FINISH_S);

    const enpt: PointEntry[] = [];
    const itpt: PointEntry[] = [];
    ckptS.forEach((S, i) => {
        if (i % 2 !== 0) return;
        const f = frameAt(S);
        enpt.push({ pos: [f.c[0], f.c[1], f.c[2]], width: 1.0 });
        itpt.push({ pos: [f.c[0], f.c[1], f.c[2]], width: 1.0 });
    });

    const kmp = encodeKMP({
        ktpt: [{ pos: [spawnF.c[0], spawnF.c[1], spawnF.c[2]], rot: [0, spawnF.yaw, 0], playerIndex: -1 }],
        enpt,
        enph: [{ start: 0, len: enpt.length, prev: [0], next: [0] }],
        itpt,
        itph: [{ start: 0, len: itpt.length, prev: [0], next: [0] }],
        ckpt,
        ckph: [{ start: 0, len: NC, prev: [0], next: [0] }],
        jgpt,
        cnpt,
        stgi: { laps: def.laps, polePosition: 0, driverDistance: 0, lensFlare: 1, flareColor: 0x00e6e6e6, flareAlpha: 0x4b },
    });
    if (enpt.length > 255) throw new Error('too many points for u8 path indices');

    // ---- validation ----------------------------------------------------------------------------
    const problems: string[] = [];
    let minRatio = Infinity;
    let minR = Infinity;
    let minRAt = 0;
    for (let S = 0; S < L; S += 25) {
        const k = curvatureAt(pl, S, 200);
        const R = 1 / Math.abs(k);
        const x = xsec(S);
        const inner = k > 0 ? x.wallL : -x.wallR;
        if (R < minR) {
            minR = R;
            minRAt = S;
        }
        minRatio = Math.min(minRatio, R / inner);
        if (R < inner * 1.15) {
            problems.push(`radius ${R.toFixed(0)} < 1.15 x inner wall offset ${inner.toFixed(0)} at S=${S.toFixed(0)}`);
            break;
        }
    }
    let maxGrade = 0;
    let maxGradeAt = 0;
    for (let S = 0; S < L; S += 25) {
        if (gaps.some((g) => g.full && S > g.r[0] - 50 && S < g.r[1] + 50)) continue; // no road there
        if (cannons.some((c) => S > c.r[0] - 50 && S < c.r[1] + 50)) continue;
        const g = Math.abs(grade(S));
        if (g > maxGrade) {
            maxGrade = g;
            maxGradeAt = S;
        }
    }
    if (maxGrade > (def.validate?.maxGrade ?? 0.08)) problems.push(`max grade ${maxGrade} at S=${maxGradeAt.toFixed(0)}`);
    // Self-clearance: centerline points further than 14000 apart along the loop must be separated
    // by more than both half widths + minClearance (unless vertically separated by > 2500).
    let minClear = Infinity;
    let minClearAt = [0, 0];
    {
        const pts: { S: number; x: number; y: number; z: number; w: number }[] = [];
        for (let S = 0; S < L; S += 100) {
            if (cannons.some((c) => S > c.r[0] && S < c.r[1])) continue;
            const f = frameAt(S);
            const x = xsec(S);
            pts.push({ S, x: f.c[0], y: f.c[1], z: f.c[2], w: Math.max(x.wallL, -x.wallR) });
        }
        const need = def.validate?.minClearance ?? 1000;
        for (let i = 0; i < pts.length; ++i)
            for (let j = i + 1; j < pts.length; ++j) {
                const ds = Math.min(pts[j]!.S - pts[i]!.S, L - (pts[j]!.S - pts[i]!.S));
                if (ds < 14000) continue;
                if (Math.abs(pts[i]!.y - pts[j]!.y) > (def.validate?.vertSep ?? 2500)) continue;
                const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z) - pts[i]!.w - pts[j]!.w;
                if (d < minClear) {
                    minClear = d;
                    minClearAt = [pts[i]!.S, pts[j]!.S];
                }
            }
        if (minClear < need) problems.push(`self clearance ${minClear.toFixed(0)} < ${need} between S=${minClearAt[0]!.toFixed(0)} and S=${minClearAt[1]!.toFixed(0)}`);
    }
    {
        let turn = 0;
        let prev = frameAt(0).yaw;
        for (let S = 50; S <= L; S += 50) {
            const y = frameAt(S).yaw;
            let d = y - prev;
            d = ((d + 540) % 360) - 180;
            turn += d;
            prev = y;
        }
        const want = def.validate?.turning;
        if (want !== undefined ? Math.abs(turn - want) > 1 : Math.abs(Math.abs(turn) - 360) > 1) problems.push(`total turning ${turn}`);
    }
    // Checkpoint quads (i, i+1) must be convex and consistently oriented.
    for (let i = 0; i < NC; ++i) {
        const a = ckpt[i]!;
        const b = ckpt[(i + 1) % NC]!;
        const q = [a.left, b.left, b.right, a.right];
        let sgn = 0;
        for (let k = 0; k < 4; ++k) {
            const p0 = q[k]!;
            const p1 = q[(k + 1) % 4]!;
            const p2 = q[(k + 2) % 4]!;
            const c = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
            const s = Math.sign(c);
            if (sgn === 0) sgn = s;
            else if (s !== sgn) {
                problems.push(`checkpoint quad ${i}-${(i + 1) % NC} not convex (S=${ckptS[i]!.toFixed(0)})`);
                break;
            }
        }
    }
    // Fall boundaries must not sit where karts on another part of the road can reach them: flag
    // any fall-boundary triangle between 800 below and 3500 above a floor in the same 250-unit cell.
    {
        const CELL = 250;
        const floor = new Map<string, [number, number]>();
        const raster = (t: Tri, fn: (key: string, y: number) => void) => {
            const xs = [t.a[0], t.b[0], t.c[0]];
            const zs = [t.a[2], t.b[2], t.c[2]];
            const y = (t.a[1] + t.b[1] + t.c[1]) / 3;
            const cx0 = Math.floor(Math.min(...xs) / CELL);
            const cx1 = Math.floor(Math.max(...xs) / CELL);
            const cz0 = Math.floor(Math.min(...zs) / CELL);
            const cz1 = Math.floor(Math.max(...zs) / CELL);
            const ar = (t.b[0] - t.a[0]) * (t.c[2] - t.a[2]) - (t.b[2] - t.a[2]) * (t.c[0] - t.a[0]);
            if (Math.abs(ar) < 1) return;
            for (let cx = cx0; cx <= cx1; ++cx)
                for (let cz = cz0; cz <= cz1; ++cz) {
                    const px = (cx + 0.5) * CELL;
                    const pz = (cz + 0.5) * CELL;
                    const w0 = ((t.b[0] - t.a[0]) * (pz - t.a[2]) - (t.b[2] - t.a[2]) * (px - t.a[0])) / ar;
                    const w1 = ((t.c[0] - t.b[0]) * (pz - t.b[2]) - (t.c[2] - t.b[2]) * (px - t.b[0])) / ar;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    fn(`${cx},${cz}`, y);
                }
        };
        for (const t of tris) {
            const ty = t.attr & 0x1f;
            if (ty === KCL.wall || ty === KCL.slickWall || ty === KCL.invisibleWall || ty === KCL.fallBoundary) continue;
            raster(t, (k, y) => {
                const v = floor.get(k);
                floor.set(k, v ? [Math.min(v[0], y), Math.max(v[1], y)] : [y, y]);
            });
        }
        let bad = 0;
        let example = '';
        for (const t of tris) {
            if ((t.attr & 0x1f) !== KCL.fallBoundary) continue;
            raster(t, (k, y) => {
                const v = floor.get(k);
                if (!v) return;
                if (y > v[0] - 800 && y < v[1] + 3500) {
                    ++bad;
                    example ||= `cell ${k}: fall y ${y.toFixed(0)} vs floor ${v[0].toFixed(0)}..${v[1].toFixed(0)}`;
                }
            });
        }
        if (bad) problems.push(`${bad} fall-boundary cells too close to a floor (${example})`);
    }
    // Jumps: the barriers beside a ramp and its landing must top the flight, or karts fly out of the
    // course (or over onto another stretch). Half-pipes: the half-pipe wall must top the launch.
    for (const rp of ramps) {
        const fl = (rp.attr & 0x1f) === KCL.boostRamp(0) ? RAMP_FLIGHT.boost : RAMP_FLIGHT.trick;
        const want = rp.height + fl.rise + FLIGHT_CLEAR;
        for (let S = rp.r[0] + 50; S < rp.r[1] + fl.reach; S += 100) {
            const w = wallsAt(wrapS(S));
            const top = XS.wallH + Math.min(w.left ? w.invisibleL : Infinity, w.right ? w.invisibleR : Infinity);
            if ((w.left || w.right) && top < want) {
                problems.push(`barrier ${top} above the road at S=${wrapS(S).toFixed(0)} < ${want} for the jump off S=${rp.r[1].toFixed(0)} (raise invisibleWallH)`);
                break;
            }
        }
    }
    for (const hp of halfpipes)
        if ((hp.z.wallH ?? 4000) < HALFPIPE_FLIGHT.rise + FLIGHT_CLEAR) problems.push(`half-pipe wall ${hp.z.wallH} < ${HALFPIPE_FLIGHT.rise + FLIGHT_CLEAR} at S=${hp.r[0].toFixed(0)}`);
    if (minRoadY < 0) problems.push(`road surface below y=0 (${minRoadY.toFixed(0)}); karts below y=0 respawn`);
    if (problems.length) throw new Error(`${def.id}: VALIDATION FAILED:\n  ` + problems.join('\n  '));

    // ---- meta ----------------------------------------------------------------------------------
    for (const x of rz) {
        const z = x.z;
        const midS = (x.r[0] + x.r[1]) / 2;
        const f = frameAt(midS);
        const xs = xsec(midS);
        const base = { s: x.r.map(r1), yawDeg: r1(f.yaw), length: r1(x.r[1] - x.r[0]) };
        const size = (lat: [number, number]) => {
            const lo = Math.max(lat[0], xs.wallR);
            const hi = Math.min(lat[1], xs.wallL);
            return { lat: [r1(lo), r1(hi)], width: r1(hi - lo), pos: v3r(lateral(f, (lo + hi) / 2)) };
        };
        if (z.kind === 'dashPanel') {
            const s = size(latOf(z.lat, x.r, [-600, 600]));
            featureMeta.push({ type: 'dashPanel', ...base, ...s, size: [s.width, base.length] });
        } else if (z.kind === 'jumpPad') {
            const s = size(latOf(z.lat, x.r, 'road'));
            featureMeta.push({ type: 'jumpPad', variant: z.variant, ...base, ...s, size: [s.width, base.length] });
        } else if (z.kind === 'surface') {
            const s = size(latOf(z.lat, x.r, 'road'));
            featureMeta.push({ type: 'surface', label: z.label ?? `kcl 0x${z.attr.toString(16)}`, attr: z.attr, ...base, ...s, size: [s.width, base.length] });
        } else if (z.kind === 'ramp') {
            const rp = ramps.find((r) => r.r[0] === x.r[0])!;
            const s = size(rp.lat);
            const fl = frameAt(x.r[1]);
            const lip = lateral(fl, (Number(s.lat[0]) + Number(s.lat[1])) / 2, 0, rp);
            const angle = (Math.atan((rp.height * rp.exp) / (x.r[1] - x.r[0])) * 180) / Math.PI;
            const isBoost = (rp.attr & 0x1f) === 0x07;
            featureMeta.push({
                type: isBoost ? 'boostRamp' : 'ramp',
                attr: rp.attr,
                ...base,
                ...s,
                pos: v3r(lateral(f, (Number(s.lat[0]) + Number(s.lat[1])) / 2, 0, rp)),
                size: [s.width, base.length],
                height: rp.height,
                lipPos: v3r(lip),
                lipAngleDeg: r1(angle),
            });
        } else if (z.kind === 'gap') {
            const g = gaps.find((gg) => gg.r[0] === x.r[0])!;
            const s = size(g.lat);
            featureMeta.push({ type: 'gap', ...base, ...s, size: [s.width, base.length] });
        } else if (z.kind === 'airRoom') {
            featureMeta.push({ type: 'airRoom', ...base, side: z.side, out: z.out, easeIn: z.easeIn ?? 0, easeOut: z.easeOut ?? 0 });
        } else if (z.kind === 'island') {
            featureMeta.push({ type: 'island', ...base, pos: v3r(f.c), halfWidth: z.half, wallH: z.wallH ?? 800 });
        }
    }
    featureMeta.push(...shortcutMeta, ...cannonMeta);
    featureMeta.sort((a, b) => (a.s as number[])[0]! - (b.s as number[])[0]!);

    const v2 = (v: [number, number]): [number, number] => [r1(v[0]), r1(v[1])];
    const featureRanges: Record<string, [number, number]> = {};
    for (const name of Object.keys(ranges)) featureRanges[name] = splineRange(name).map(r1) as [number, number];
    let bbMin: V3 = [Infinity, Infinity, Infinity];
    let bbMax: V3 = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) {
        if ((t.attr & 0x1f) === KCL.fallBoundary) continue;
        for (const p of [t.a, t.b, t.c]) {
            bbMin = [Math.min(bbMin[0], p[0]), Math.min(bbMin[1], p[1]), Math.min(bbMin[2], p[2])];
            bbMax = [Math.max(bbMax[0], p[0]), Math.max(bbMax[1], p[1]), Math.max(bbMax[2], p[2])];
        }
    }
    const meta = {
        id: def.id,
        name: def.name,
        description: def.description,
        units: 'Engine world units; +Y up; right-handed; forward yaw = atan2(dir.x, dir.z) degrees; lateral offsets positive to the driver\'s left',
        length: r1(L),
        laps: def.laps,
        theme: def.theme,
        ...(def.extra ?? {}),
        groundY: def.groundY === undefined ? r1(minRoadY - 600) : def.groundY,
        bbox: { min: v3r(bbMin), max: v3r(bbMax) },
        crossSection: {
            roadHalfWidth: XS.road,
            offroadWidth: [XS.offroadL, XS.offroadR],
            wallHeight: XS.wallH,
            kcl: { road: roadAttr, offroad: offroadAttr, boostPanel: KCL.boostPanel, wall: KCL.wall, fallBoundary: KCL.fallBoundary },
        },
        start: { pos: v3r(finishF.c), angleDeg: r1(finishF.yaw), s: r1(FINISH_S), width: r1(xsec(FINISH_S).wallL - xsec(FINISH_S).wallR) },
        spawn: { pos: v3r(spawnF.c), angleDeg: r1(spawnF.yaw), s: r1(spawnF.S) },
        segments: featureRanges,
        features: featureMeta,
        elevation: { min: r1(minRoadY), max: r1(maxRoadY), maxGrade: Math.round(maxGrade * 10000) / 10000 },
        minCenterlineRadius: r1(minR),
        checkpoints: ckpt.map((c, i) => ({
            id: i,
            s: r1(wrapS(ckptS[i]!)),
            left: v2(c.left),
            right: v2(c.right),
            key: c.checkArea,
            jugem: c.jugem,
        })),
        respawns: jgpt.map((j, i) => ({ id: j.id, s: r1(wrapS(jgptS[i]!)), pos: v3r(j.pos), angleDeg: r1(j.rot[1]) })),
        centerline: frames.map((f) => {
            const x = xsec(f.S);
            const w = wallsAt(f.S + 1);
            return {
                s: r1(f.S),
                pos: v3r(f.c),
                // Unit vector, at fwd's precision: at 0.1 the direction steps by up to ~6°, and the
                // renderer's walls and edge lines (pos + right * offset) zig-zagged ~150 units off
                // the KCL's at the wall offset wherever the rounding flipped.
                right: [Math.round(-f.left[0] * 1e5) / 1e5, 0, Math.round(-f.left[2] * 1e5) / 1e5],
                fwd: [Math.round(f.fwd[0] * 1e5) / 1e5, 0, Math.round(f.fwd[2] * 1e5) / 1e5],
                halfWidth: r1(Math.max(x.wallL, -x.wallR)),
                edges: { wallL: r1(x.wallL), roadL: r1(x.roadL), roadR: r1(x.roadR), wallR: r1(x.wallR), island: r1(x.isl) },
                walls: [w.left, w.right],
                bankDeg: r1(f.bankDeg),
            };
        }),
    };

    summary.push(`${def.name} (${def.id}): length ${L.toFixed(0)}, ${N} stations, ${tris.length} triangles`);
    summary.push(
        `  KCL: ${kcl.prismCount} prisms, ${kcl.vertexCount} verts, ${kcl.normalCount} normals, ${kcl.leafCount} leaves (max ${kcl.maxLeafTris} tris), ${kcl.bytes.length} bytes`,
    );
    summary.push(
        `  KMP: ${NC} checkpoints (keys at ${keyIdx.join(',')}${addedKeys ? `; ${addedKeys} between nearby stretches` : ''}), ${jgpt.length} respawns, ${kmp.length} bytes`,
    );
    summary.push(
        `  min radius ${minR.toFixed(0)} @S=${minRAt.toFixed(0)} (min R/inner ${minRatio.toFixed(2)}), max grade ${(maxGrade * 100).toFixed(2)}%, ` +
            `self-clearance ${minClear.toFixed(0)}, road y ${minRoadY.toFixed(0)}..${maxRoadY.toFixed(0)}`,
    );
    summary.push(`  features: ${featureMeta.map((f) => f.type).join(', ') || 'none'}`);
    return { def, kcl: kcl.bytes, kmp, meta, summary };
}
