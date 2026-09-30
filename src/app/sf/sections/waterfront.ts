/**
 * The start/finish waterfront: Crissy Field, round the Palace of Fine Arts and along Marina Green
 * (sections crissy, palace, marina). The city around it stays real; the race pieces on it are
 * road-work pieces: low concrete K-rail along the track edge (so the lawn, the beach and the bay
 * show over it) with orange / white chevron boards on the outside of the corners, white rumble
 * paint on the asphalt edge through the corners, the start/finish gantry, and the lagoon jump as
 * a Boost Lane ramp over a real channel of water with a marked landing.
 *
 * `carveWaterfront` runs on the terrain before it's built: it floods the Crissy Field lagoon (the
 * lidar has its surface a little above the sea plane, so it showed as mud) and cuts the inlet
 * channel under the jump gap through to the bay.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Station } from '../road';
import type { SfWorld } from '../world';
import { PAD_LOOKS, padMaterial } from '../padMaterial';

type V3 = [number, number, number];
type WStation = Station & { fwd: V3 };

export interface WaterfrontMeta {
    centerline: Station[];
    segments?: Record<string, [number, number]>;
    features?: { type: string; s?: number[]; pos?: number[]; lipPos?: number[]; height?: number; lat?: number[] }[];
    start?: { pos: [number, number, number]; angleDeg?: number; s?: number };
}

const SECTIONS = ['crissy', 'palace', 'marina'];
/** K-rail: sloped face up to BODY, a steeper top up to BODY + CAP (road.ts's jersey is 230). */
const BODY = 90;
const CAP = 45;
const TOP = 60;
const STRIPE = 450;
/** Rumble paint: on the asphalt at the edge, through corners tighter than KERB_R. */
const KERB_W = 150;
const KERB_R = 12000;
const KERB_STRIPE = 300;
const LIFT = 3;
/** Start gantry height (the banner beam's top): low enough that the banner sits at the top of the chase camera's view from the grid. */
const GANTRY_H = 1400;

const ranges = (meta: WaterfrontMeta): [number, number][] => SECTIONS.map((n) => meta.segments?.[n]).filter((r): r is [number, number] => !!r);

/** Stretches whose barriers this module draws (road.ts skips them). */
export function waterfrontWalls(meta: WaterfrontMeta): (s: number) => boolean {
    const rs = ranges(meta);
    return (s) => rs.some(([a, b]) => s >= a && s <= b);
}

/** The lagoon jump: its boost ramp and the gap after it (in the marina section). */
function lagoonJump(meta: WaterfrontMeta) {
    const m = meta.segments?.marina;
    if (!m) return null;
    const inM = (f: { s?: number[] }) => f.s && f.s[0]! > m[0] && f.s[1]! <= m[1];
    const ramp = (meta.features ?? []).find((f) => f.type === 'boostRamp' && inM(f));
    const gap = (meta.features ?? []).find((f) => f.type === 'gap' && inM(f));
    return ramp && gap ? { ramp, gap } : null;
}

/** Station interpolated at s (pos, right, fwd lerped; the stations are close enough). */
function stationAt(cl: WStation[], s: number): WStation {
    let i = 0;
    while (i + 1 < cl.length && cl[i + 1]!.s < s) ++i;
    const A = cl[i]!;
    const B = cl[Math.min(i + 1, cl.length - 1)]!;
    const t = B.s > A.s ? Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s))) : 0;
    const l = (a: number[], b: number[]) => a.map((v, k) => v + (b[k]! - v) * t) as V3;
    const e = (k: keyof Station['edges']) => A.edges[k] + (B.edges[k] - A.edges[k]) * t;
    return {
        s,
        pos: l(A.pos, B.pos),
        right: l(A.right, B.right),
        fwd: l(A.fwd, B.fwd),
        edges: { wallL: e('wallL'), roadL: e('roadL'), roadR: e('roadR'), wallR: e('wallR'), island: e('island') },
        walls: A.walls,
        bankDeg: A.bankDeg,
    };
}

/** Stations from s0 to s1, with extra samples at every multiple of `step` (crisp stripe ends). */
function resample(cl: WStation[], s0: number, s1: number, step: number): WStation[] {
    const ss = new Set<number>([s0, s1]);
    for (const c of cl) if (c.s > s0 && c.s < s1) ss.add(c.s);
    for (let s = Math.ceil(s0 / step) * step; s < s1; s += step) ss.add(s);
    return [...ss].sort((a, b) => a - b).map((s) => stationAt(cl, s));
}

const at = (st: Station, off: number, dy: number): V3 => [st.pos[0] - st.right[0] * off, st.pos[1] + dy + LIFT, st.pos[2] - st.right[2] * off];

// ---------------------------------------------------------------------------------------------
// Terrain: the lagoon and the inlet channel under the jump.
// ---------------------------------------------------------------------------------------------

const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Crissy Field lagoon (meters e/n) and the edge band over which the flooding fades out. */
const LAGOON = { e0: 1530, e1: 1960, n0: -770, n1: -598, fade: 25 };

export function carveWaterfront(world: SfWorld, meta: WaterfrontMeta): void {
    const t = world.json.terrain;
    const S = world.json.scale;
    const sea = world.json.seaY;
    // Lagoon: ground within ~0.5 m of the sea (its lidar surface) goes under the water plane.
    const flood = (e: number, n: number, y: number): number => {
        if (y >= sea + 60 || e < LAGOON.e0 || e > LAGOON.e1 || n < LAGOON.n0 || n > LAGOON.n1) return y;
        const w = smooth(0, LAGOON.fade, Math.min(e - LAGOON.e0, LAGOON.e1 - e, n - LAGOON.n0, LAGOON.n1 - n));
        return y - 50 * w * (1 - smooth(sea + 30, sea + 60, y));
    };
    // Inlet channel: across the road under the gap, from the lagoon (left) through the beach to the bay.
    const jump = lagoonJump(meta);
    let channel: ((x: number, z: number) => number) | null = null;
    if (jump) {
        const cl = meta.centerline as WStation[];
        const a = stationAt(cl, jump.gap.s![0]!);
        const b = stationAt(cl, jump.gap.s![1]!);
        const cx = (a.pos[0] + b.pos[0]) / 2;
        const cz = (a.pos[2] + b.pos[2]) / 2;
        const half = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]) / 2;
        const dx = (b.pos[0] - a.pos[0]) / (2 * half);
        const dz = (b.pos[2] - a.pos[2]) / (2 * half);
        const bed = sea - 40;
        const flat = half - 150;
        const top = a.pos[1] - 70;
        const road = Math.max(a.edges.wallL, -a.edges.wallR) + 150;
        channel = (x, z) => {
            const along = Math.abs((x - cx) * dx + (z - cz) * dz);
            // Lateral: + to the driver's right (the bay), - to the left (the lagoon).
            const lat = (x - cx) * -dz + (z - cz) * dx;
            if (lat < -6500 || lat > 9000) return Infinity;
            // Under the road the banks stand at the gap's ends (the abutments); either side of it
            // the channel funnels open toward the lagoon and the bay, with sloped banks (~17 m) and
            // rounded ends.
            const out = Math.max(0, Math.abs(lat) - road);
            const width = flat + out * 0.35;
            const run = 150 + 850 * smooth(0, 600, out);
            const d = Math.hypot(Math.max(0, along - width), Math.max(0, lat - 7000, -4500 - lat));
            return bed + d * ((top - bed) / run);
        };
    }
    for (let j = 0; j < t.cz; ++j)
        for (let i = 0; i < t.cx; ++i) {
            const h = world.cells[j * t.cx + i];
            if (!h) continue;
            const e0 = t.e0 + i * t.cell;
            const n0 = t.n1 - j * t.cell;
            // Only cells near the lagoon / the channel.
            if (e0 + t.cell < LAGOON.e0 - 200 || e0 > LAGOON.e1 + 200 || n0 < LAGOON.n0 - 200 || n0 - t.cell > LAGOON.n1 + 250) continue;
            const st = t.steps[t.levels[j * t.cx + i]!]!;
            const m = t.cell / st + 1;
            for (let r = 0; r < m; ++r)
                for (let c = 0; c < m; ++c) {
                    const e = e0 + c * st;
                    const n = n0 - r * st;
                    const k = r * m + c;
                    let y = flood(e, n, h[k]!);
                    if (channel) y = Math.min(y, channel(e * S, -n * S));
                    h[k] = y;
                }
        }
}

// ---------------------------------------------------------------------------------------------
// Textures.
// ---------------------------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d')!);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

/** Light concrete with a little aggregate noise. */
const concreteTex = () =>
    canvasTex(128, 128, (g) => {
        g.fillStyle = '#e4e1da';
        g.fillRect(0, 0, 128, 128);
        const img = g.getImageData(0, 0, 128, 128);
        let seed = 91;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let k = 0; k < img.data.length; k += 4) {
            const n = (rnd() - 0.5) * 16;
            for (let c = 0; c < 3; ++c) img.data[k + c] = img.data[k + c]! + n;
        }
        g.putImageData(img, 0, 0);
    });

/** Road-work chevron board: white chevrons pointing right (+u) on Signal Orange, a white rim. */
const boardTex = () =>
    canvasTex(
        256,
        256,
        (g) => {
            g.fillStyle = '#f4f4f0';
            g.fillRect(0, 0, 256, 256);
            g.fillStyle = '#ff6a1f';
            g.fillRect(10, 10, 236, 236);
            g.fillStyle = '#f4f4f0';
            for (const x0 of [44, 128]) {
                g.beginPath();
                g.moveTo(x0, 36);
                g.lineTo(x0 + 34, 36);
                g.lineTo(x0 + 88, 128);
                g.lineTo(x0 + 34, 220);
                g.lineTo(x0, 220);
                g.lineTo(x0 + 54, 128);
                g.closePath();
                g.fill();
            }
        },
        false,
    );

/** Yellow / black hazard stripes. */
const hazardTex = () =>
    canvasTex(64, 64, (g) => {
        g.fillStyle = '#ffc400';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#16161a';
        for (let k = -64; k < 64; k += 32) {
            g.beginPath();
            g.moveTo(k, 64);
            g.lineTo(k + 16, 64);
            g.lineTo(k + 80, 0);
            g.lineTo(k + 64, 0);
            g.fill();
        }
    });

function bannerTex(): THREE.CanvasTexture {
    return canvasTex(
        2048,
        256,
        (g) => {
            g.fillStyle = '#c0362c';
            g.fillRect(0, 0, 2048, 256);
            const sq = 32;
            for (let x = 0; x < 2048; x += sq)
                for (const [y, o] of [
                    [0, 0],
                    [sq, 1],
                    [256 - 2 * sq, 0],
                    [256 - sq, 1],
                ] as const) {
                    g.fillStyle = (x / sq + o) % 2 ? '#111' : '#fff';
                    g.fillRect(x, y, sq, sq);
                }
            g.font = 'italic 900 118px ui-sans-serif, system-ui, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.lineJoin = 'round';
            g.lineWidth = 16;
            g.strokeStyle = '#5a130c';
            g.strokeText('GOLDEN GATE GRAND PRIX', 1024, 132);
            g.fillStyle = '#fff6e0';
            g.fillText('GOLDEN GATE GRAND PRIX', 1024, 132);
        },
        false,
    );
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers.
// ---------------------------------------------------------------------------------------------

class Builder {
    pos: number[] = [];
    uv: number[] = [];
    col: number[] = [];
    quad(a: V3, b: V3, c: V3, d: V3, uv: [number, number, number, number] = [0, 0, 1, 1], color: number[] = [1, 1, 1]): void {
        // a b (near: one side, other side) / c d (far): triangles a b c, b d c.
        const [u0, v0, u1, v1] = uv;
        this.pos.push(...a, ...b, ...c, ...b, ...d, ...c);
        this.uv.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
        for (let k = 0; k < 6; ++k) this.col.push(...color);
    }
    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.computeVertexNormals();
        return g;
    }
}

/**
 * Paint on the concrete texture (sRGB hex → linear vertex colour, divided by the concrete's own
 * tone so it shows as painted).
 */
const paint = (hex: number): number[] => {
    const c = new THREE.Color(hex);
    return [c.r / 0.776, c.g / 0.753, c.b / 0.701];
};
/** K-rail: pale concrete top band with road.ts's Signal Orange reflective stripe and an amber reflector per 900. */
const BAND = [0.95, 0.94, 0.91];
const SIGNAL_ORANGE = paint(0xff6a1f);
const AMBER = paint(0xffd23f);
/** Rumble paint white / asphalt grey. */
const WHITE = [0.96, 0.96, 0.94];
const GREY = [0.3, 0.3, 0.32];

// ---------------------------------------------------------------------------------------------
// The part.
// ---------------------------------------------------------------------------------------------

export interface WaterfrontPart {
    group: THREE.Group;
    dispose(): void;
}

/** `groundY`: terrain height, so the barriers' backs reach down to it (a seawall over the water). */
export function buildWaterfront(meta: WaterfrontMeta, groundY: (x: number, z: number) => number): WaterfrontPart {
    const seg = meta.segments ?? {};
    // Stations, closing the lap (the finish stretch runs from the last station round to s = 0).
    const lap = Math.max(...Object.values(seg).map((r) => r[1]));
    const cl0 = meta.centerline as WStation[];
    const cl = lap > cl0[cl0.length - 1]!.s ? [...cl0, { ...cl0[0]!, s: lap }] : cl0;
    const group = new THREE.Group();
    group.name = 'waterfront';
    const rs = ranges(meta);
    const gaps = (meta.features ?? []).filter((f) => f.type === 'gap' && f.s).map((f) => f.s as [number, number]);
    const inGap = (s: number) => gaps.some(([a, b]) => s > a && s < b);
    // Barrier height: rises to meet road.ts's jersey barriers where a waterfront section meets another.
    const ends = rs.flat();
    const edges = ends.filter((s) => s > 1 && s < lap - 1 && ends.filter((x) => Math.abs(x - s) < 1).length === 1);
    const heightScale = (s: number) => {
        let k = 1;
        for (const e of edges) k = Math.max(k, 1 + (230 / (BODY + CAP) - 1) * (1 - smooth(0, 2500, Math.abs(s - e))));
        return k;
    };

    // ---- barriers ----
    const wall = new Builder();
    const cap = new Builder();
    for (const [s0, s1] of rs) {
        const sts = resample(cl, s0, s1, STRIPE);
        for (let i = 0; i + 1 < sts.length; ++i) {
            const A = sts[i]!;
            const B = sts[i + 1]!;
            const mid = (A.s + B.s) / 2;
            if (inGap(mid)) continue;
            const hA = heightScale(A.s);
            const hB = heightScale(B.s);
            const reflector = Math.floor(mid / STRIPE) % 2 === 0;
            for (const side of [1, -1] as const) {
                if (!A.walls[side === 1 ? 0 : 1]) continue;
                const oA = side === 1 ? A.edges.wallL : A.edges.wallR;
                const oB = side === 1 ? B.edges.wallL : B.edges.wallR;
                // (lateral offset outward from the wall line, height) — face, cap, top, back.
                const face: [number, number][] = [
                    [0, 0],
                    [8, 25],
                    [18, BODY],
                ];
                // The cap's face: pale, the stripe, pale; then the top and its back edge.
                const capLo: [number, number][] = [
                    [18, BODY],
                    [18, BODY + CAP * 0.25],
                ];
                const capStripe: [number, number][] = [
                    [18, BODY + CAP * 0.25],
                    [18, BODY + CAP * 0.85],
                ];
                const capHi: [number, number][] = [
                    [18, BODY + CAP * 0.85],
                    [18, BODY + CAP],
                    [TOP, BODY + CAP],
                    [TOP, BODY],
                ];
                const strip = (b: Builder, prof: [number, number][], color: number[]) => {
                    for (let k = 0; k + 1 < prof.length; ++k) {
                        const [o0, y0] = prof[k]!;
                        const [o1, y1] = prof[k + 1]!;
                        b.quad(
                            at(A, oA + side * o0, y0 * hA),
                            at(A, oA + side * o1, y1 * hA),
                            at(B, oB + side * o0, y0 * hB),
                            at(B, oB + side * o1, y1 * hB),
                            [o0 / 300 + y0 / 300, A.s / 300, o1 / 300 + y1 / 300, B.s / 300],
                            color,
                        );
                    }
                };
                strip(wall, face, [1, 1, 1]);
                strip(cap, capLo, BAND);
                strip(cap, capStripe, SIGNAL_ORANGE);
                strip(cap, capHi, BAND);
                if (reflector) {
                    // Just proud of the stripe, 1.2 m long, mid-segment.
                    const R0 = stationAt(cl, mid - 36);
                    const R1 = stationAt(cl, mid + 36);
                    const o0 = (side === 1 ? R0.edges.wallL : R0.edges.wallR) + side * 17;
                    const o1 = (side === 1 ? R1.edges.wallL : R1.edges.wallR) + side * 17;
                    const h = heightScale(mid);
                    const [y0, y1] = [(BODY + CAP * 0.32) * h, (BODY + CAP * 0.78) * h];
                    cap.quad(at(R0, o0, y0), at(R0, o0, y1), at(R1, o1, y0), at(R1, o1, y1), undefined, AMBER);
                }
                // Back: down to the ground behind (at least 120 under the road; deeper where it
                // falls away to the water, like a seawall).
                const foot = (st: WStation, o: number) => {
                    const p = at(st, o + side * TOP, 0);
                    return Math.min(-120, groundY(p[0], p[2]) - p[1] - 40);
                };
                const fA = foot(A, oA);
                const fB = foot(B, oB);
                wall.quad(at(A, oA + side * TOP, BODY * hA), at(A, oA + side * TOP, fA), at(B, oB + side * TOP, BODY * hB), at(B, oB + side * TOP, fB), [BODY / 300, A.s / 300, fA / 300, B.s / 300], [0.86, 0.85, 0.82]);
            }
        }
    }

    // ---- rumble paint: white / grey on the asphalt edge through the corners ----
    const kerb = new Builder();
    const ang = (c: WStation) => Math.atan2(c.fwd[0], c.fwd[2]);
    const tight: [number, number][] = [];
    for (let i = 1; i + 1 < cl.length; ++i) {
        const a = cl[i - 1]!;
        const b = cl[i + 1]!;
        const d = Math.abs(((ang(b) - ang(a) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        const r = d > 1e-6 ? (b.s - a.s) / d : Infinity;
        const s = cl[i]!.s;
        if (r < KERB_R && rs.some(([s0, s1]) => s >= s0 && s <= s1)) {
            const last = tight[tight.length - 1];
            if (last && s - 1500 <= last[1]) last[1] = s + 1200;
            else tight.push([s - 1200, s + 1200]);
        }
    }
    for (const [k0, k1] of tight) {
        const sts = resample(cl, k0, k1, KERB_STRIPE);
        for (let i = 0; i + 1 < sts.length; ++i) {
            const A = sts[i]!;
            const B = sts[i + 1]!;
            const mid = (A.s + B.s) / 2;
            if (inGap(mid)) continue;
            const color = Math.floor(mid / KERB_STRIPE) % 2 ? WHITE : GREY;
            // Fade in / out at the ends (narrower), so they don't start as a hard block.
            const wA = KERB_W * smooth(k0, k0 + 600, A.s) * (1 - smooth(k1 - 600, k1, A.s));
            const wB = KERB_W * smooth(k0, k0 + 600, B.s) * (1 - smooth(k1 - 600, k1, B.s));
            kerb.quad(at(A, A.edges.roadL, 4), at(A, A.edges.roadL - wA, 4), at(B, B.edges.roadL, 4), at(B, B.edges.roadL - wB, 4), undefined, color);
            kerb.quad(at(A, A.edges.roadR + wA, 4), at(A, A.edges.roadR, 4), at(B, B.edges.roadR + wB, 4), at(B, B.edges.roadR, 4), undefined, color);
        }
    }

    // ---- chevron boards on posts behind the K-rail, on the outside of the corners ----
    const boards = new Builder();
    const posts = new Builder();
    for (const [k0, k1] of tight) {
        for (let s = k0 + 700; s <= k1 - 700; s += 900) {
            if (inGap(s) || !rs.some(([a, b]) => s >= a && s <= b)) continue;
            const st = stationAt(cl, s);
            const a = stationAt(cl, s - 600);
            const b = stationAt(cl, s + 600);
            // Turning right when the heading swings toward the right vector; the outside is the left.
            const right = (b.fwd[0] - a.fwd[0]) * st.right[0] + (b.fwd[2] - a.fwd[2]) * st.right[2] > 0;
            const side = right ? 1 : -1;
            if (!st.walls[side === 1 ? 0 : 1]) continue;
            const c = (side === 1 ? st.edges.wallL : st.edges.wallR) + side * 110;
            const h = heightScale(s) * (BODY + CAP);
            const [b0, b1] = [h + 20, h + 200];
            // u runs left to right as the driver sees it; the chevrons point into the turn.
            boards.quad(at(st, c + 100, b0), at(st, c - 100, b0), at(st, c + 100, b1), at(st, c - 100, b1), right ? [0, 0, 1, 1] : [1, 0, 0, 1]);
            for (const o of [-60, 60]) posts.quad(at(st, c + o + 7, -60), at(st, c + o - 7, -60), at(st, c + o + 7, b0), at(st, c + o - 7, b0));
        }
    }

    // ---- the lagoon jump: a glowing lip and hazard-marked gap edges (the ramp itself is drawn by
    // kclExtras.ts in the same pad look as the bridge's jump) ----
    const hazard = hazardTex();
    const hazardB = new Builder();
    const glowB = new Builder();
    const jump = lagoonJump(meta);
    if (jump) {
        const [r0, r1] = jump.ramp.s as [number, number];
        const base = stationAt(cl, r0);
        const f: V3 = [base.fwd[0], 0, base.fwd[2]];
        const fl = Math.hypot(f[0], f[2]);
        f[0] /= fl;
        f[2] /= fl;
        // Glowing lip edge.
        const lip = stationAt(cl, r1);
        const rise = jump.ramp.height ?? 600;
        const [la, lb] = (jump.ramp.lat ?? [-1600, 1600]) as [number, number];
        const lipAt = (off: number, dy: number, back: number): V3 => {
            const p = at(lip, off, rise + dy);
            return [p[0] - f[0] * back, p[1], p[2] - f[2] * back];
        };
        // (Just in front of the KCL lip face.)
        glowB.quad(lipAt(lb, 0, -4), lipAt(la, 0, -4), lipAt(lb, -70, -4), lipAt(la, -70, -4));
        // Hazard bands: on the landing's road edge and down its face, and down the lip's face.
        const g1 = jump.gap.s![1]!;
        const land = stationAt(cl, g1);
        const land2 = stationAt(cl, g1 + 220);
        const L = land.edges.wallL;
        const R = land.edges.wallR;
        const hw = (L - R) / 128;
        hazardB.quad(at(land, L, 5), at(land, R, 5), at(land2, L, 5), at(land2, R, 5), [0, 0, hw, 220 / 128]);
        // Down the landing's face (just in front of it, over the gap) and the lip's.
        const fa = (p: V3): V3 => [p[0] - f[0] * 4, p[1], p[2] - f[2] * 4];
        hazardB.quad(fa(at(land, L, 0)), fa(at(land, R, 0)), fa(at(land, L, -160)), fa(at(land, R, -160)), [0, 0, hw, 160 / 128]);
        hazardB.quad(lipAt(la, -70, -4), lipAt(lb, -70, -4), lipAt(la, -rise - 200, -4), lipAt(lb, -rise - 200, -4), [0, 0, (lb - la) / 128, (rise + 130) / 128]);
        // Concrete abutments under both road ends, down into the channel (a bridge gap, not a sand
        // cliff): a face across the road and a little past it, just in front of the terrain's cut.
        const g0 = jump.gap.s![0]!;
        const mid = stationAt(cl, (g0 + g1) / 2);
        const bottom = groundY(mid.pos[0], mid.pos[2]) - 60;
        for (const [st, dir] of [
            [stationAt(cl, g0), 1],
            [land, -1],
        ] as const) {
            const L2 = st.edges.wallL + 300;
            const R2 = st.edges.wallR - 300;
            const fa = (p: V3): V3 => [p[0] + f[0] * 2 * dir, p[1], p[2] + f[2] * 2 * dir];
            const dy = bottom - st.pos[1];
            const [p0, p1, p2, p3] = dir > 0 ? [at(st, R2, -2), at(st, L2, -2), at(st, R2, dy), at(st, L2, dy)] : [at(st, L2, -2), at(st, R2, -2), at(st, L2, dy), at(st, R2, dy)];
            wall.quad(fa(p0), fa(p1), fa(p2), fa(p3), [0, 0, (L2 - R2) / 300, -dy / 300], [0.8, 0.78, 0.74]);
        }
    }

    // ---- dash panels: the Boost Lane (dashPanels.ts skips the ones in this section) ----
    const dashB = new Builder();
    /** Each dash vertex's pad size (width, length; see padMaterial.ts). */
    const dashSize: number[] = [];
    for (const f of meta.features ?? []) {
        if (f.type !== 'dashPanel' || !f.s || !rs.some(([a, b]) => f.s![0]! >= a && f.s![1]! <= b)) continue;
        const [d0, d1] = f.s as [number, number];
        const [la, lb] = (f.lat ?? [-600, 600]) as [number, number];
        const sts = resample(cl, d0, d1, 100);
        for (let i = 0; i + 1 < sts.length; ++i) {
            const A = sts[i]!;
            const B = sts[i + 1]!;
            dashB.quad(at(A, lb, 6), at(A, la, 6), at(B, lb, 6), at(B, la, 6), [1, (A.s - d0) / (d1 - d0), 0, (B.s - d0) / (d1 - d0)]);
            for (let q = 0; q < 6; ++q) dashSize.push(lb - la, d1 - d0);
        }
    }

    // ---- start / finish gantry: orange lattice towers (the bridge's colour) and a banner beam ----
    const gantry = new THREE.Group();
    const trussParts: THREE.BufferGeometry[] = [];
    const darkParts: THREE.BufferGeometry[] = [];
    const footParts: THREE.BufferGeometry[] = [];
    let banner: THREE.Mesh | null = null;
    const bannerMap = bannerTex();
    if (meta.start) {
        // On the checkered line itself (renderer.ts draws it at meta.start.pos): the nearest
        // station is up to half a station spacing (~10 m) off it.
        const sp = meta.start.pos;
        const st = meta.start.s !== undefined ? stationAt(cl, meta.start.s) : cl.reduce((a, c) => (Math.hypot(c.pos[0] - sp[0], c.pos[2] - sp[2]) < Math.hypot(a.pos[0] - sp[0], a.pos[2] - sp[2]) ? c : a));
        const half = Math.max(st.edges.wallL, -st.edges.wallR) + 260;
        gantry.position.set(sp[0], sp[1], sp[2]);
        gantry.rotation.y = ((meta.start.angleDeg ?? 0) * Math.PI) / 180;
        const H = GANTRY_H;
        const T = 150; // tower half-width
        const boxAt = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
            const g = new THREE.BoxGeometry(w, h, d);
            if (rx) g.rotateX(rx);
            if (rz) g.rotateZ(rz);
            g.translate(x, y, z);
            list.push(g);
        };
        for (const side of [-1, 1]) {
            const x = side * half;
            // Corner chords.
            for (const cx of [-T, T]) for (const cz of [-T, T]) boxAt(trussParts, 36, H, 36, x + cx, H / 2, cz);
            // Bracing: horizontal rings and X diagonals on the four faces, every 460.
            const step = 460;
            for (let y = 60; y < H; y += step) {
                for (const cz of [-T, T]) boxAt(trussParts, 2 * T, 22, 22, x, y, cz);
                for (const cx of [-T, T]) boxAt(trussParts, 22, 22, 2 * T, x + cx, y, 0);
                if (y + step > H) break;
                const diag = Math.hypot(2 * T, step);
                const a = Math.atan2(step, 2 * T);
                for (const cz of [-T, T]) for (const sgn of [-1, 1]) boxAt(trussParts, diag, 16, 16, x, y + step / 2, cz, sgn * a);
                for (const cx of [-T, T]) for (const sgn of [-1, 1]) boxAt(trussParts, 16, 16, diag, x + cx, y + step / 2, 0, 0, sgn * a);
            }
            // Concrete footing and a cap plate.
            boxAt(footParts, 2 * T + 180, 160, 2 * T + 180, x, 40, 0);
            boxAt(darkParts, 2 * T + 60, 40, 2 * T + 60, x, H + 20, 0);
        }
        // Beam: the banner box (texture both faces), with a truss chord above and below.
        const bw = half * 2 + 2 * T + 60;
        banner = new THREE.Mesh(new THREE.BoxGeometry(bw, 520, 70), [
            new THREE.MeshBasicMaterial({ color: 0x8e2a20 }),
            new THREE.MeshBasicMaterial({ color: 0x8e2a20 }),
            new THREE.MeshBasicMaterial({ color: 0x8e2a20 }),
            new THREE.MeshBasicMaterial({ color: 0x8e2a20 }),
            new THREE.MeshBasicMaterial({ map: bannerMap }),
            new THREE.MeshBasicMaterial({ map: bannerMap }),
        ]);
        banner.position.set(0, H - 330, 0);
        banner.castShadow = true;
        gantry.add(banner);
        for (const y of [H - 40, H - 620]) for (const z of [-90, 90]) boxAt(trussParts, bw, 40, 40, 0, y, z);
    }

    // ---- meshes / materials ----
    const concrete = concreteTex();
    const board = boardTex();
    const mats = {
        wall: new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
        // Matte, so the grazing low sun and sky don't wash the orange out to peach. (Both sides: the
        // left rail's profile is the right one mirrored.)
        cap: new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.9, envMapIntensity: 0.4, side: THREE.DoubleSide }),
        kerb: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
        board: new THREE.MeshStandardMaterial({ map: board, emissive: 0xffffff, emissiveMap: board, emissiveIntensity: 0.35, roughness: 0.5, side: THREE.DoubleSide }),
        // Boost Lane (unlit: flat on the road, looking into the low sun, a lit panel reflects to white).
        dash: padMaterial(PAD_LOOKS.dash),
        glow: new THREE.MeshBasicMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide }),
        hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide }),
        truss: new THREE.MeshStandardMaterial({ color: 0xc0362c, roughness: 0.5, metalness: 0.35 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.5, metalness: 0.4 }),
        foot: new THREE.MeshStandardMaterial({ map: concrete, color: 0xcfcac0, roughness: 0.9 }),
    };
    const meshes: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry | null, key: keyof typeof mats, parent: THREE.Object3D = group, shadow = false) => {
        if (!geo || !geo.getAttribute('position')?.count) return;
        const m = new THREE.Mesh(geo, mats[key]);
        m.receiveShadow = true;
        m.castShadow = shadow;
        meshes.push(m);
        parent.add(m);
    };
    const merged = (list: THREE.BufferGeometry[]) => (list.length ? mergeGeometries(list.map((g) => g.toNonIndexed())) : null);
    add(wall.geometry(), 'wall', group, true);
    add(cap.geometry(), 'cap', group, true);
    add(kerb.geometry(), 'kerb');
    add(boards.geometry(), 'board', group, true);
    add(posts.geometry(), 'dark', group, true);
    const dashGeo = dashB.geometry();
    dashGeo.setAttribute('padSize', new THREE.Float32BufferAttribute(dashSize, 2));
    add(dashGeo, 'dash');
    add(glowB.geometry(), 'glow');
    add(hazardB.geometry(), 'hazard');
    add(merged(trussParts), 'truss', gantry, true);
    add(merged(darkParts), 'dark', gantry, true);
    add(merged(footParts), 'foot', gantry, true);
    if (meta.start) group.add(gantry);
    for (const mesh of meshes) if (mesh.parent === group) mesh.frustumCulled = false;

    return {
        group,
        dispose() {
            for (const mesh of meshes) mesh.geometry.dispose();
            if (banner) {
                banner.geometry.dispose();
                for (const m of banner.material as THREE.Material[]) m.dispose();
            }
            for (const t of [hazard, bannerMap, concrete, board]) t.dispose();
            for (const m of Object.values(mats)) m.dispose();
        },
    };
}
