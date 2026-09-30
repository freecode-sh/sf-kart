/**
 * Road elevation along the Golden Gate course from the 1 m lidar terrain, smoothed so it drives well.
 *
 *   1. Sample the bare earth under the road every STEP meters (median across the street, so curbs,
 *      walls and the odd bluff edge don't pull it around).
 *   2. Drop samples on structures: OSM bridges / viaducts / tunnels the lap drives along (bare earth
 *      is the ground under a viaduct or the hill over a tunnel), and designed sections (the Golden
 *      Gate deck, the Vista Point dip) whose knots are given.
 *   3. Keep the waterfront above the sea (seawalls, the Fort Point loop, the lagoon inlet jump).
 *   4. Fill the gaps, smooth (Gaussian), cap the grade, and soften crests and sags until karts
 *      neither take off over the top nor slam into the bottom.
 *   5. Emit knots every KNOT meters; the course builder's monotone cubic runs through them.
 */

import type { HeightModel } from './heights';
import type { OsmElement } from './osm';
import { SCALE, toMeters } from './geo';

/** Sample spacing (m). */
const STEP = 5;
/** Knot spacing (m). */
const KNOT = 10;
/** Lowest road height on the waterfront (m above mean sea level). */
const MIN_Y = 2.8;
/** Narrowest feature of the ground the road follows (m); narrower bumps are structures. */
const OPEN = 110;
/** Steepest allowed grade (the builder validates <= 12%). */
const MAX_GRADE = 0.095;
/** Tightest crest / sag radius (m). At ~30 m/s a crest under ~v^2/g = 90 m lifts the kart off. */
const MIN_CREST_R = 260;
const MIN_SAG_R = 140;

export type Knot = { seg: string; at: number; y: number };

export type StructSeg = { ax: number; an: number; bx: number; bn: number };

/** Highway ways on a structure (meters): bridges, viaducts, tunnels, covered roads (or bridges only). */
export function structureSegments(els: OsmElement[], bridgesOnly = false): StructSeg[] {
    const out: StructSeg[] = [];
    for (const el of els) {
        if (el.type !== 'way' || !el.tags?.highway) continue;
        const t = el.tags;
        const bridge = (t.bridge && t.bridge !== 'no') || t.man_made === 'bridge';
        const onStructure = bridge || (!bridgesOnly && ((t.tunnel && t.tunnel !== 'no') || t.covered === 'yes'));
        if (!onStructure) continue;
        const pts = el.geometry.map((g) => toMeters(g.lat, g.lon));
        for (let i = 0; i + 1 < pts.length; ++i) out.push({ ax: pts[i]![0], an: pts[i]![1], bx: pts[i + 1]![0], bn: pts[i + 1]![1] });
    }
    return out;
}

/** True if a structure segment runs along the road at (e, n) heading (de, dn) (unit). */
export function onStructure(segs: StructSeg[], e: number, n: number, de: number, dn: number, reach: number): boolean {
    for (const s of segs) {
        const vx = s.bx - s.ax;
        const vn = s.bn - s.an;
        const L = Math.hypot(vx, vn);
        if (L < 1) continue;
        const t = Math.max(0, Math.min(1, ((e - s.ax) * vx + (n - s.an) * vn) / (L * L)));
        const d = Math.hypot(s.ax + vx * t - e, s.an + vn * t - n);
        if (d > reach) continue;
        // Parallel (either direction), not an overpass crossing the lap.
        if (Math.abs((vx * de + vn * dn) / L) > 0.9) return true;
    }
    return false;
}

/** Monotone cubic (Fritsch–Butland) through sorted knots, clamped flat outside them. */
function monotoneCubic(k: { S: number; y: number }[]): (S: number) => number {
    const n = k.length;
    const d = (i: number) => (k[i + 1]!.y - k[i]!.y) / (k[i + 1]!.S - k[i]!.S);
    const m = k.map((_, i) => {
        if (i === 0 || i === n - 1) return 0;
        const d0 = d(i - 1);
        const d1 = d(i);
        if (d0 * d1 <= 0) return 0;
        const h0 = k[i]!.S - k[i - 1]!.S;
        const h1 = k[i + 1]!.S - k[i]!.S;
        return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    });
    return (S: number) => {
        if (S <= k[0]!.S) return k[0]!.y;
        if (S >= k[n - 1]!.S) return k[n - 1]!.y;
        let i = 0;
        while (k[i + 1]!.S <= S) ++i;
        const h = k[i + 1]!.S - k[i]!.S;
        const t = (S - k[i]!.S) / h;
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * k[i]!.y + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * k[i + 1]!.y + (t3 - t2) * h * m[i + 1]!;
    };
}

function gaussian(y: Float64Array, sigma: number, lock: Uint8Array): Float64Array {
    const r = Math.ceil((sigma * 3) / STEP);
    const w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-(((k - r) * STEP) ** 2) / (2 * sigma * sigma)));
    const n = y.length;
    const out = new Float64Array(n);
    for (let i = 0; i < n; ++i) {
        if (lock[i]) {
            out[i] = y[i]!;
            continue;
        }
        let a = 0;
        let ws = 0;
        for (let k = -r; k <= r; ++k) {
            const v = y[(i + k + n) % n]!;
            a += v * w[k + r]!;
            ws += w[k + r]!;
        }
        out[i] = a / ws;
    }
    return out;
}

export interface ProfileInput {
    /** Closed centerline, world units (x, z). */
    pts: [number, number][];
    /** Cumulative length at each point (world units). */
    cum: number[];
    /** Section name → [start, end) in world units along the lap. */
    sections: Record<string, [number, number]>;
    heights: HeightModel;
    osm: OsmElement[];
    /** Sections whose heights are designed (given as `fixed` knots), not sampled. */
    fixedSections: string[];
    fixed: Knot[];
    /** Extra ranges (world units along the lap) to treat as structures, e.g. jumps over water. */
    skip?: [number, number][];
    /** Per section: where the street is relative to the lap (m, + = driver's left), for carriageways. */
    streetOffset?: Record<string, number>;
}

export interface ProfileResult {
    knots: Knot[];
    /** Diagnostics per sample (meters): S, ground, road, structure flag. */
    samples: { s: number; ground: number; road: number; masked: boolean }[];
}

export function roadProfile(inp: ProfileInput): ProfileResult {
    const L = inp.cum.at(-1)! + Math.hypot(inp.pts[0]![0] - inp.pts.at(-1)![0], inp.pts[0]![1] - inp.pts.at(-1)![1]);
    const N = Math.floor(L / SCALE / STEP);
    const segs = structureSegments(inp.osm);
    const secOf = (S: number) => Object.entries(inp.sections).find(([, [a, b]]) => S >= a && S < b)?.[0] ?? '';
    // Designed heights (meters) for the fixed sections, by the same monotone cubic the course builder
    // runs through the knots (interior of the fixed stretch; the ends meet the sampled knots).
    const fixedAbs = inp.fixed
        .map((k) => ({ S: inp.sections[k.seg]![0] + (k.at >= 0 ? k.at : inp.sections[k.seg]![1] - inp.sections[k.seg]![0] + k.at), y: k.y }))
        .sort((a, b) => a.S - b.S);
    const fixedAt = monotoneCubic(fixedAbs);

    // Point along the path at S (world units): position and heading.
    let seg = 0;
    const along = (S: number): [number, number, number, number] => {
        while (seg + 1 < inp.cum.length && inp.cum[seg + 1]! <= S) ++seg;
        const a = inp.pts[seg]!;
        const b = inp.pts[(seg + 1) % inp.pts.length]!;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const t = Math.max(0, Math.min(1, (S - inp.cum[seg]!) / l));
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };

    const ground = new Float64Array(N);
    const y = new Float64Array(N);
    const valid = new Uint8Array(N);
    const lock = new Uint8Array(N);
    const masked = new Uint8Array(N);
    for (let i = 0; i < N; ++i) {
        const S = i * STEP * SCALE;
        const [x, z, dx, dz] = along(S);
        const e = x / SCALE;
        const n = -z / SCALE;
        const de = dx;
        const dn = -dz;
        const sec = secOf(S);
        // Median across the street (+-8 m); left of travel is (-dn, de).
        const off = inp.streetOffset?.[sec] ?? 0;
        const across: number[] = [];
        for (let o = off - 8; o <= off + 8; o += 2) across.push(inp.heights.at(e - dn * o, n + de * o));
        across.sort((a, b) => a - b);
        const g = across[Math.floor(across.length / 2)]!;
        ground[i] = g;
        if (inp.fixedSections.includes(sec)) {
            y[i] = fixedAt(S);
            valid[i] = 1;
            lock[i] = 1;
            continue;
        }
        const struct = onStructure(segs, e, n, de, dn, 30) || (inp.skip ?? []).some(([a, b]) => S >= a && S <= b);
        masked[i] = struct ? 1 : 0;
        if (struct) continue;
        y[i] = Math.max(MIN_Y, g);
        valid[i] = 1;
    }
    // Opening (erode, then dilate) over OPEN m: shaves off anything narrower than that standing on
    // the ground (the fort, bridge pylons and abutments that the bare earth keeps), not hills.
    {
        const r = Math.round(OPEN / 2 / STEP);
        const ero = new Float64Array(N);
        for (let i = 0; i < N; ++i) {
            let m = Infinity;
            for (let k = -r; k <= r; ++k) if (valid[(i + k + N) % N] && !lock[(i + k + N) % N]) m = Math.min(m, y[(i + k + N) % N]!);
            ero[i] = m;
        }
        for (let i = 0; i < N; ++i) {
            if (!valid[i] || lock[i]) continue;
            let m = -Infinity;
            for (let k = -r; k <= r; ++k) if (Number.isFinite(ero[(i + k + N) % N]!)) m = Math.max(m, ero[(i + k + N) % N]!);
            if (Number.isFinite(m)) y[i] = Math.min(y[i]!, m);
        }
    }
    // Structures: pad by 20 m (abutments), then fill gaps linearly between the valid ends.
    const pad = Math.round(20 / STEP);
    const m2 = Uint8Array.from(masked);
    for (let i = 0; i < N; ++i) if (masked[i]) for (let k = -pad; k <= pad; ++k) m2[(i + k + N) % N] = lock[(i + k + N) % N] ? 0 : 1;
    for (let i = 0; i < N; ++i) if (m2[i] && !lock[i]) valid[i] = 0;
    const first = valid.indexOf(1);
    for (let k = 0; k < N; ) {
        const i = (first + k) % N;
        if (valid[i]) {
            ++k;
            continue;
        }
        let j = k;
        while (j < N && !valid[(first + j) % N]) ++j;
        const a = (first + k - 1 + N) % N;
        const b = (first + j) % N;
        const span = j - k + 1;
        for (let q = k; q < j; ++q) y[(first + q) % N] = y[a]! + ((y[b]! - y[a]!) * (q - k + 1)) / span;
        k = j;
    }

    // Smooth, then cap grades and curvature (locked samples stay put).
    let s = gaussian(y, 22, lock);
    for (let iter = 0; iter < 3000; ++iter) {
        let worst = 0;
        // Grade: pull both ends of a too-steep step toward each other.
        for (let i = 0; i < N; ++i) {
            const j = (i + 1) % N;
            const d = s[j]! - s[i]!;
            const lim = MAX_GRADE * STEP;
            if (Math.abs(d) <= lim) continue;
            const ex = (Math.abs(d) - lim) * Math.sign(d);
            worst = Math.max(worst, Math.abs(ex));
            if (!lock[i] && !lock[j]) {
                s[i] = s[i]! + ex / 2;
                s[j] = s[j]! - ex / 2;
            } else if (!lock[i]) s[i] = s[i]! + ex;
            else if (!lock[j]) s[j] = s[j]! - ex;
        }
        // Curvature: y'' = 1 / R. Crests (y'' < 0) need R >= MIN_CREST_R, sags R >= MIN_SAG_R. At a
        // fixed sample next to a sampled one, the sampled side gives way.
        for (let i = 0; i < N; ++i) {
            const a = (i - 1 + N) % N;
            const b = (i + 1) % N;
            const c = (s[a]! - 2 * s[i]! + s[b]!) / (STEP * STEP);
            const lim = c < 0 ? 1 / MIN_CREST_R : 1 / MIN_SAG_R;
            if (Math.abs(c) <= lim) continue;
            const ex = (Math.abs(c) - lim) * Math.sign(c) * STEP * STEP;
            if (!lock[i]) s[i] = s[i]! + (ex / 2) * 0.6;
            else if (!lock[b]) s[b] = s[b]! - ex * 0.6;
            else if (!lock[a]) s[a] = s[a]! - ex * 0.6;
            else continue;
            worst = Math.max(worst, Math.abs(ex));
        }
        if (worst < 1e-3) break;
    }
    // The waterfront floor again (smoothing can dip below it next to the jumps).
    for (let i = 0; i < N; ++i) if (!lock[i]) s[i] = Math.max(MIN_Y, s[i]!);

    // Knots: sampled sections every KNOT m (dense, so the builder's cubic can't overshoot the
    // grade cap between them); the fixed sections keep their own knots.
    const knots: Knot[] = [...inp.fixed];
    const every = Math.round(KNOT / STEP);
    // Every sample within 60 m of a fixed stretch, where the grade changes fastest.
    const near = Math.round(60 / STEP);
    for (let i = 0; i < N; ++i) {
        if (lock[i]) continue;
        let nearLock = false;
        for (let k = -near; k <= near; ++k) if (lock[(i + k + N) % N]) nearLock = true;
        if (!nearLock && i % every) continue;
        const S = i * STEP * SCALE;
        const sec = secOf(S);
        knots.push({ seg: sec, at: Math.round(S - inp.sections[sec]![0]), y: Math.round(s[i]! * 100) / 100 });
    }
    return {
        knots,
        samples: Array.from({ length: N }, (_, i) => ({ s: i * STEP, ground: ground[i]!, road: s[i]!, masked: !!m2[i] && !lock[i] })),
    };
}
