/**
 * Course centerlines.
 *
 * A layout is a "turtle" program (straights + constant-radius arcs) in a 2D plan plane (u, v) with
 * the usual math orientation (heading θ, positive θ = LEFT turn). Control points are taken from
 * that program at uniform arc-length spacing and a closed centripetal Catmull-Rom spline through
 * them is the final centerline.
 *
 * Plan → world mapping: world X = v, world Z = u, world Y = elevation. This mapping is a
 * reflection, which turns plan-plane CCW turning into world LEFT turns (facing +Z, +X is the
 * driver's left in the engine's right-handed Y-up frame). Yaw ψ (degrees, rotation about +Y, KMP
 * convention) of a direction (x, z) is atan2(x, z).
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type TurtleSeg =
    | { kind: 'straight'; len: number; name: string }
    | { kind: 'arc'; radius: number; deg: number; name: string; ease?: boolean };

type TurtleState = { p: Vec2; th: number };

/**
 * Replace each arc by a short spiral-like easing (1.6R, 1.25R, R, 1.25R, 1.6R) so the curvature does
 * not jump from 0 to 1/R; this keeps the Catmull-Rom from overshooting at arc entries/exits.
 * The total turning angle of every corner is unchanged; sub-arcs keep the corner's name.
 */
export function expandEasing(segs: TurtleSeg[]): TurtleSeg[] {
    const out: TurtleSeg[] = [];
    const EASE: [number, number][] = [
        [1.6, 0.06],
        [1.25, 0.07],
        [1.0, 0.74],
        [1.25, 0.07],
        [1.6, 0.06],
    ];
    for (const s of segs) {
        if (s.kind === 'straight' || s.ease === false) {
            out.push({ ...s });
            continue;
        }
        for (const [rm, am] of EASE) out.push({ kind: 'arc', radius: s.radius * rm, deg: s.deg * am, name: s.name });
    }
    return out;
}

export function segLength(seg: TurtleSeg): number {
    return seg.kind === 'straight' ? seg.len : (seg.radius * Math.abs(seg.deg) * Math.PI) / 180;
}

/** Runs the program from the origin heading +u; returns the end state and the heading at each segment start. */
export function runTurtle(segs: TurtleSeg[]): { end: TurtleState; headings: number[] } {
    let p: Vec2 = [0, 0];
    let th = 0;
    const headings: number[] = [];
    for (const s of segs) {
        headings.push(th);
        if (s.kind === 'straight') {
            p = [p[0] + s.len * Math.cos(th), p[1] + s.len * Math.sin(th)];
        } else {
            const sign = Math.sign(s.deg);
            const a = (Math.abs(s.deg) * Math.PI) / 180;
            // center on the left (sign>0) or right (sign<0)
            const c: Vec2 = [p[0] - sign * s.radius * Math.sin(th), p[1] + sign * s.radius * Math.cos(th)];
            const th2 = th + sign * a;
            p = [c[0] + sign * s.radius * Math.sin(th2), c[1] - sign * s.radius * Math.cos(th2)];
            th = th2;
        }
    }
    return { end: { p, th }, headings };
}

/** cos/sin with values within 1e-12 of 0/±1 snapped (keeps axis-aligned closure solves exact). */
function snappedDir(th: number): Vec2 {
    const snap = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);
    return [snap(Math.cos(th)), snap(Math.sin(th))];
}

/**
 * Expands easing and solves the lengths of the two named straights so the loop closes exactly.
 * The straights must not be parallel. Total turning must be ±360° (or `turning`, e.g. 0 for a
 * figure eight).
 */
export function solveClosure(program: TurtleSeg[], closure: [string, string], turning?: number): TurtleSeg[] {
    const segs = expandEasing(program);
    const iA = segs.findIndex((s) => s.name === closure[0]);
    const iB = segs.findIndex((s) => s.name === closure[1]);
    if (iA < 0 || iB < 0) throw new Error(`closure straights not found: ${closure}`);
    const A = segs[iA]!;
    const B = segs[iB]!;
    if (A.kind !== 'straight' || B.kind !== 'straight') throw new Error('closure segments must be straights');
    A.len = 0;
    B.len = 0;
    const r0 = runTurtle(segs);
    const turn = (r0.end.th * 180) / Math.PI;
    if (turning !== undefined ? Math.abs(turn - turning) > 1e-6 : Math.abs(Math.abs(turn) - 360) > 1e-6)
        throw new Error(`total turning ${turn}°, expected ${turning ?? '±360'}`);
    const e0 = r0.end.p;
    const [cA, sA] = snappedDir(r0.headings[iA]!);
    const [cB, sB] = snappedDir(r0.headings[iB]!);
    // a * dA + b * dB = -e0
    const det = cA * sB - sA * cB;
    if (Math.abs(det) < 1e-6) throw new Error('closure straights are parallel');
    A.len = (-e0[0] * sB + e0[1] * cB) / det;
    B.len = (-e0[1] * cA + e0[0] * sA) / det;
    const e = runTurtle(segs).end;
    if (Math.hypot(e.p[0], e.p[1]) > 1e-6) throw new Error(`turtle does not close: ${e.p}`);
    for (const s of segs) if (s.kind === 'straight' && s.len < 0) throw new Error(`negative straight ${s.name} (${s.len.toFixed(0)})`);
    return segs;
}

export type ControlPoint = { p: Vec2; s: number; seg: string };

/** Exact point + segment name on the turtle program at arc length S (0 <= S < total). */
export function turtleAt(segs: TurtleSeg[], S: number): { p: Vec2; seg: string } {
    let p: Vec2 = [0, 0];
    let th = 0;
    let s = 0;
    for (const seg of segs) {
        const len = segLength(seg);
        const d = Math.min(Math.max(S - s, 0), len);
        const inside = S < s + len;
        if (seg.kind === 'straight') {
            const q: Vec2 = [p[0] + d * Math.cos(th), p[1] + d * Math.sin(th)];
            if (inside) return { p: q, seg: seg.name };
            p = [p[0] + len * Math.cos(th), p[1] + len * Math.sin(th)];
        } else {
            const sign = Math.sign(seg.deg);
            const c: Vec2 = [p[0] - sign * seg.radius * Math.sin(th), p[1] + sign * seg.radius * Math.cos(th)];
            const t = th + (sign * d) / seg.radius;
            if (inside) return { p: [c[0] + sign * seg.radius * Math.sin(t), c[1] - sign * seg.radius * Math.cos(t)], seg: seg.name };
            th += (sign * len) / seg.radius;
            p = [c[0] + sign * seg.radius * Math.sin(th), c[1] - sign * seg.radius * Math.cos(th)];
        }
        s += len;
    }
    return { p, seg: segs[segs.length - 1]!.name };
}

/**
 * Control points: the turtle program sampled at uniform arc-length spacing (~CP_SPACING units).
 * Uniform spacing keeps the centripetal Catmull-Rom's curvature close to the designed radii.
 */
export const CP_SPACING = 500;

export function controlPoints(segs: TurtleSeg[], spacing = CP_SPACING): ControlPoint[] {
    const r = turtleRanges(segs);
    let total = 0;
    for (const v of Object.values(r)) total = Math.max(total, v[1]);
    const n = Math.round(total / spacing);
    const pts: ControlPoint[] = [];
    for (let k = 0; k < n; ++k) {
        const S = (total * k) / n;
        const t = turtleAt(segs, S);
        pts.push({ p: t.p, s: S, seg: t.seg });
    }
    return pts;
}

/** [start, end] turtle arc length of every named segment (sub-arcs of an eased corner merge). */
export function turtleRanges(segs: TurtleSeg[]): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    let s = 0;
    for (const seg of segs) {
        const len = segLength(seg);
        const prev = out[seg.name];
        out[seg.name] = prev ? [prev[0], s + len] : [s, s + len];
        s += len;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Closed centripetal Catmull-Rom
// ---------------------------------------------------------------------------------------------
function crPoint(P0: Vec2, P1: Vec2, P2: Vec2, P3: Vec2, u: number): Vec2 {
    const alpha = 0.5;
    const tj = (a: Vec2, b: Vec2) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha);
    const t0 = 0;
    const t1 = t0 + tj(P0, P1);
    const t2 = t1 + tj(P1, P2);
    const t3 = t2 + tj(P2, P3);
    const t = t1 + (t2 - t1) * u;
    const lerp = (A: Vec2, B: Vec2, ta: number, tb: number): Vec2 => {
        const w = (t - ta) / (tb - ta);
        return [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w];
    };
    const A1 = lerp(P0, P1, t0, t1);
    const A2 = lerp(P1, P2, t1, t2);
    const A3 = lerp(P2, P3, t2, t3);
    const B1 = lerp(A1, A2, t0, t2);
    const B2 = lerp(A2, A3, t1, t3);
    return lerp(B1, B2, t1, t2);
}

export type Polyline = { pts: Vec2[]; s: number[]; cpS: number[]; length: number };

/** Densely samples the closed spline; returns arc lengths and the arc length of each control point. */
export function sampleSpline(cps: Vec2[], perSeg = 200): Polyline {
    const n = cps.length;
    const pts: Vec2[] = [];
    const cpIdx: number[] = [];
    for (let i = 0; i < n; ++i) {
        const P0 = cps[(i - 1 + n) % n]!;
        const P1 = cps[i]!;
        const P2 = cps[(i + 1) % n]!;
        const P3 = cps[(i + 2) % n]!;
        cpIdx.push(pts.length);
        for (let k = 0; k < perSeg; ++k) pts.push(crPoint(P0, P1, P2, P3, k / perSeg));
    }
    const s: number[] = [0];
    for (let i = 1; i <= pts.length; ++i) {
        const a = pts[i - 1]!;
        const b = pts[i % pts.length]!;
        s.push(s[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const length = s[pts.length]!;
    s.pop();
    return { pts, s, cpS: cpIdx.map((k) => s[k]!), length };
}

/** Position on the closed polyline at arc length S (linear interpolation) + smooth unit tangent. */
export function polyAt(pl: Polyline, S: number): { p: Vec2; tan: Vec2 } {
    const p = polyAtRaw(pl, S);
    // Smooth tangent: central difference over +-20 units.
    const d = 20;
    const pa = polyAtRaw(pl, S - d);
    const pb = polyAtRaw(pl, S + d);
    const tl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    return { p, tan: [(pb[0] - pa[0]) / tl, (pb[1] - pa[1]) / tl] };
}

export function polyAtRaw(pl: Polyline, S: number): Vec2 {
    const L = pl.length;
    S = ((S % L) + L) % L;
    let lo = 0;
    let hi = pl.s.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pl.s[mid]! <= S) lo = mid;
        else hi = mid - 1;
    }
    const i = lo;
    const j = (i + 1) % pl.pts.length;
    const a = pl.pts[i]!;
    const b = pl.pts[j]!;
    const segLen = (j === 0 ? L : pl.s[j]!) - pl.s[i]!;
    const w = segLen > 0 ? (S - pl.s[i]!) / segLen : 0;
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}

/** Signed curvature (left positive, plan frame) at S via three-point circle over +-h. */
export function curvatureAt(pl: Polyline, S: number, h = 150): number {
    const a = polyAtRaw(pl, S - h);
    const b = polyAtRaw(pl, S);
    const c = polyAtRaw(pl, S + h);
    const ab = [b[0] - a[0], b[1] - a[1]];
    const bc = [c[0] - b[0], c[1] - b[1]];
    const cross = ab[0]! * bc[1]! - ab[1]! * bc[0]!;
    const la = Math.hypot(ab[0]!, ab[1]!);
    const lb = Math.hypot(bc[0]!, bc[1]!);
    const lc = Math.hypot(c[0] - a[0], c[1] - a[1]);
    return (2 * cross) / (la * lb * lc);
}
