/**
 * The bridge's own coordinate frame: along (world units from the south end, following the same
 * polyline axis the course bakes its carriageways from: south end → SF tower → Marin tower → north
 * end, with the same vertex normals as tools/sf/route.ts offsetLine), lateral (world units, + =
 * east / right going north) and the deck height profile.
 */

import * as THREE from 'three';
import { BRIDGE, SCALE, deckHeightM, worldY } from '../geo';

type P2 = [number, number];
const lerp2 = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

const { southEnd: SE, sfTower: TS, marinTower: TM, northEnd: NE } = BRIDGE;
/** Axis vertices (meters east/north), exactly as route.ts bridgeLine(). */
const AX: P2[] = [SE, lerp2(SE, TS, 0.5), TS, lerp2(TS, TM, 0.5), TM, NE];
const CUM: number[] = [0];
for (let i = 1; i < AX.length; ++i) CUM.push(CUM[i - 1]! + Math.hypot(AX[i]![0] - AX[i - 1]![0], AX[i]![1] - AX[i - 1]![1]));
/** Right-hand (east-ish) unit normals at the vertices, like offsetLine (central differences). */
const NRM: P2[] = AX.map((_, i) => {
    const a = AX[Math.max(0, i - 1)]!;
    const b = AX[Math.min(AX.length - 1, i + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    return [dy / L, -dx / L];
});

/** Total axis length (world units). */
export const LEN = CUM[CUM.length - 1]! * SCALE;
/** Stations (world units along) of the SF and Marin towers. */
export const S_SF = CUM[2]! * SCALE;
export const S_MARIN = CUM[4]! * SCALE;
/** Meters → world units. */
export const M = SCALE;

/** World (x, z) at along s, lateral l (both world units). Extrapolates past the ends. */
export function xz(s: number, l: number): [number, number] {
    const sm = s / SCALE;
    const lm = l / SCALE;
    let i = 0;
    while (i < AX.length - 2 && sm > CUM[i + 1]!) ++i;
    const t = (sm - CUM[i]!) / (CUM[i + 1]! - CUM[i]!);
    const a = AX[i]!;
    const b = AX[i + 1]!;
    const na = NRM[i]!;
    const nb = NRM[i + 1]!;
    const e = (a[0] + na[0] * lm) * (1 - t) + (b[0] + nb[0] * lm) * t;
    const n = (a[1] + na[1] * lm) * (1 - t) + (b[1] + nb[1] * lm) * t;
    return [e * SCALE, -n * SCALE];
}

/** Road surface world y at along s from geo.ts (the course maps its deck knots by fraction of the length). */
function geoDeckY(s: number): number {
    return worldY(deckHeightM(((s / SCALE) * 2330) / (LEN / SCALE)));
}

/** A course centerline sample (course_meta.json `centerline[]`). */
export type CenterlinePoint = { pos: number[] | readonly number[] };

type Profile = {
    /** Road height per carriageway: [southbound (west, l < 0), northbound (east, l > 0)]. */
    h: [(s: number) => number, (s: number) => number];
    /** Along ranges where each carriageway runs parallel to the axis (before it diverges at the ends). */
    range: [[number, number], [number, number]];
};

const DEFAULT_PROFILE: Profile = {
    h: [geoDeckY, geoDeckY],
    range: [
        [26 * SCALE, 2290 * SCALE],
        [44 * SCALE, 2300 * SCALE],
    ],
};
let profile: Profile = DEFAULT_PROFILE;

/** Along / lateral (world units) of a world (x, z), projecting on the straight axis segments. */
export function toAxis(x: number, z: number): { s: number; l: number } {
    const e = x / SCALE;
    const n = -z / SCALE;
    const last = AX.length - 2;
    for (let i = 0; i <= last; ++i) {
        const a = AX[i]!;
        const b = AX[i + 1]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        const t = ((e - a[0]) * dx + (n - a[1]) * dy) / (L * L);
        if ((t >= -0.02 || i === 0) && (t <= 1.02 || i === last)) return { s: (CUM[i]! + t * L) * SCALE, l: (((e - a[0]) * dy - (n - a[1]) * dx) / L) * SCALE };
    }
    return { s: 0, l: 0 };
}

/**
 * Fits the deck heights (per carriageway) and the carriageways' parallel ranges to the course's
 * actual centerline, so the structure hugs the baked road exactly. Null restores the geo.ts profile.
 */
export function useCourseCenterline(cl: readonly CenterlinePoint[] | null | undefined): void {
    if (!cl || cl.length === 0) {
        profile = DEFAULT_PROFILE;
        return;
    }
    const rows: [number[], number[]][] = [
        [[], []],
        [[], []],
    ];
    const range: [[number, number], [number, number]] = [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
    ];
    for (const p of cl) {
        const [x, y, z] = [p.pos[0]!, p.pos[1]!, p.pos[2]!];
        const { s, l } = toAxis(x, z);
        if (s < -60 * SCALE || s > LEN + 60 * SCALE) continue;
        if (Math.abs(y - geoDeckY(s)) > 12 * SCALE) continue;
        const side = l > 0 ? 1 : 0;
        const off = Math.abs(Math.abs(l) - 21 * SCALE);
        if (off > 12 * SCALE) continue;
        rows[side]![0].push(s);
        rows[side]![1].push(y);
        if (off < 40) {
            range[side]![0] = Math.min(range[side]![0], s);
            range[side]![1] = Math.max(range[side]![1], s);
        }
    }
    const fn = (side: 0 | 1): ((s: number) => number) => {
        const [S, Y] = rows[side]!;
        if (S.length < 8) return geoDeckY;
        const order = S.map((_, i) => i).sort((a, b) => S[a]! - S[b]!);
        const ss = order.map((i) => S[i]!);
        const ys = order.map((i) => Y[i]!);
        return (s: number) => {
            if (s <= ss[0]!) return ys[0]!;
            if (s >= ss[ss.length - 1]!) return ys[ys.length - 1]!;
            let lo = 0;
            let hi = ss.length - 1;
            while (hi - lo > 1) {
                const m = (lo + hi) >> 1;
                if (ss[m]! <= s) lo = m;
                else hi = m;
            }
            const t = (s - ss[lo]!) / Math.max(1e-6, ss[hi]! - ss[lo]!);
            return ys[lo]! + (ys[hi]! - ys[lo]!) * t;
        };
    };
    const ok = (r: [number, number], d: [number, number]): [number, number] => (Number.isFinite(r[0]) && r[1] > r[0] ? [r[0] + 8 * SCALE, r[1] - 8 * SCALE] : d);
    profile = { h: [fn(0), fn(1)], range: [ok(range[0], DEFAULT_PROFILE.range[0]), ok(range[1], DEFAULT_PROFILE.range[1])] };
}

/** Road surface world y at along s, lateral l (each carriageway has its own profile; the median blends). */
export function deckY(s: number, l = 0): number {
    const a = profile.h[0](s);
    const b = profile.h[1](s);
    if (l <= -110) return a;
    if (l >= 110) return b;
    return a + ((b - a) * (l + 110)) / 220;
}

/** Highest road surface across the deck at along s. */
export function deckTop(s: number): number {
    return Math.max(profile.h[0](s), profile.h[1](s));
}

/** Along range where the carriageway on side sg (-1 west / southbound, +1 east / northbound) is parallel. */
export function sideRange(sg: number): [number, number] {
    return profile.range[sg > 0 ? 1 : 0];
}

/** World point at along s, lateral l, `dy` units above the deck surface there. */
export function onDeck(s: number, l: number, dy = 0): THREE.Vector3 {
    const [x, z] = xz(s, l);
    return new THREE.Vector3(x, deckY(s, l) + dy, z);
}

/** World point at along s, lateral l, absolute world y. */
export function at(s: number, l: number, y: number): THREE.Vector3 {
    const [x, z] = xz(s, l);
    return new THREE.Vector3(x, y, z);
}

/** A rigid horizontal frame: u along the bridge, v lateral (+ east), y absolute world height. */
export class Frame {
    constructor(
        readonly o: THREE.Vector3,
        readonly u: THREE.Vector3,
        readonly v: THREE.Vector3,
    ) {}
    p(u: number, v: number, y: number): THREE.Vector3 {
        return new THREE.Vector3(this.o.x + this.u.x * u + this.v.x * v, y, this.o.z + this.u.z * u + this.v.z * v);
    }
}

/** Frame centered at along s. At the tower vertices it is aligned with the vertex normal. */
export function frameAt(s: number): Frame {
    const [x0, z0] = xz(s, 0);
    const [x1, z1] = xz(s, 1000);
    const v = new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize();
    // u = direction of increasing s (north): v rotated so that (u, up, v) matches (fwd, up, right).
    const u = new THREE.Vector3(v.z, 0, -v.x);
    return new Frame(new THREE.Vector3(x0, 0, z0), u, v);
}
