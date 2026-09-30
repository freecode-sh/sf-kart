/**
 * The Presidio Parkway section: the structures the road ribbon doesn't draw.
 *
 *   Viaducts   where OpenStreetMap has the parkway on a bridge over a valley (tools/sf/corridor.ts
 *              `osmViaducts`, baked into world.json; the terrain is left alone under them): a
 *              concrete box-girder deck under the road, twin-column piers down to the lidar ground,
 *              abutment walls at the ends.
 *   Tunnels    the Battery and Main Post tunnels (course_meta `tunnels`) as the real ones: cut-and-cover
 *              concrete boxes with a flat roof, light tiled walls under a continuous light strip at
 *              each side of the ceiling, jet fans and emergency exits; board-formed concrete portals
 *              (a headwall with a gently arched parapet over a flat lintel, wing walls down the open
 *              cut) and the Presidio Tunnel Tops park on the roof. The park is the terrain itself,
 *              raised at load time (`raiseTunnelTops`) so its lawns, paths and trees are the world's
 *              own imagery and trees; the box's walls hide the step down to the road, and where the
 *              ground beside falls away (or buildings stand close) the box's side shows as an overlook
 *              wall with a railing.
 *   Kickers    the trick ramps out in the open get the skate-kicker look (padMaterial.ts: yellow /
 *              black stripes, a white lip line) over their KCL surfaces, and every kicker a bright
 *              white bar along its lip (the ones in the tunnels are drawn by kclExtras.ts).
 *
 * The tunnel interiors are unlit (their lighting painted in): the low golden-hour sun shines straight
 * down the tunnels, and the kart's shadow map only reaches ~50 m.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { readKclTriangles } from '../../kclMesh';
import type { Station } from '../road';
import type { TerrainMeshes } from '../terrain';
import type { SfWorld } from '../world';
import { PAD_LOOKS, PIECE_COLORS, padMaterial } from '../padMaterial';

export interface ParkwayMeshes {
    group: THREE.Group;
    dispose(): void;
}

interface Meta {
    centerline: Station[];
    segments?: Record<string, [number, number]>;
    features?: { type: string; s?: number[]; side?: string; attr?: number; lipPos?: number[]; yawDeg?: number; width?: number; length?: number }[];
    /** Tunnels (tools/course/tracks/golden_gate.ts): spline units from a segment's start (negative: from its end). */
    tunnels?: { seg: string; from: number; to: number; name: string }[];
}

type V3 = [number, number, number];

/** Tunnel box: inner walls this far past the barrier line; the flat ceiling's height over the road. */
const TUN_MARGIN = 90;
/**
 * Clears the mid-tunnel kickers' jumps (golden_gate.ts, 190 high): a bot lap tops out ~610 above the
 * road (kart origin; its roof ~150 higher), and even a jump taken at 120 (boosting) peaks ~1150.
 */
const TUNNEL_CEIL = 1250;
/** Side and wing walls' thickness: the terrain steps up to the park inside it. */
const WALL_T = 400;
/** Park (Tunnel Tops) level over the road: ceiling, roof slab, soil. */
const TOP = TUNNEL_CEIL + 190;
/** The terrain is raised from this far into the side walls and the headwalls (so its step's triangles stay inside them). */
const RAISE_IN = 200;
/** The park: flat this far past the walls, then banks down to the ground (run per rise). */
const PARK_FLAT = 1300;
const PARK_RUN = 2.0;
/** ...and never over a building: down to its base this far out from its footprint, at this run. */
const BUILDING_CLEAR = 250;
const BUILDING_RUN = 2.2;
/** Headwall: its lateral reach past the walls, the parapet over the park and its arch's rise. */
const HEAD_OUT = 80;
const PARAPET = 110;
const ARCH = 170;
/** Interior: panel length (joints, texture repeat), jet fan pairs and emergency exits' spacing. */
const PANEL = 1200;
const FAN_EVERY = 5400;
const EXIT_EVERY = 4800;
/** Viaduct pier spacing (world units) and box girder depth below the road. */
const PIER_EVERY = 3000;
const GIRDER_DEEP = 420;
const GIRDER_SHALLOW = 240;

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return [cv, cv.getContext('2d')!];
}

function toTexture(cv: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

function rng(seed: number): () => number {
    return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Precast / cast concrete: fine noise, faint horizontal form lines, a little weathering. */
function concreteTexture(base: string): THREE.CanvasTexture {
    const [cv, g] = canvas(256, 256);
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    const img = g.getImageData(0, 0, 256, 256);
    const rnd = rng(91);
    for (let k = 0; k < img.data.length; k += 4) {
        const y = Math.floor(k / 4 / 256);
        const n = (rnd() - 0.5) * 16 + (y % 64 === 0 ? -8 : 0) + Math.sin(y * 0.19) * 2;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    // Rain streaks.
    for (let i = 0; i < 26; ++i) {
        const x = rnd() * 256;
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, 'rgba(60,58,52,0.06)');
        grad.addColorStop(1, 'rgba(60,58,52,0)');
        g.fillStyle = grad;
        g.fillRect(x, 0, 2 + rnd() * 5, 120 + rnd() * 136);
    }
    return toTexture(cv);
}

/**
 * Board-formed concrete (u along the wall, v up it; 600 units a repeat): 24 horizontal boards, each
 * its own shade with a little grain, dark seams between them, staggered butt joints, rain streaks.
 */
function boardTexture(): THREE.CanvasTexture {
    const N = 512;
    const [cv, g] = canvas(N, N);
    const rnd = rng(17);
    const boards = 24;
    const bh = N / boards;
    for (let b = 0; b < boards; ++b) {
        const y0 = b * bh;
        const tone = 178 + (rnd() - 0.5) * 14;
        g.fillStyle = `rgb(${tone + 1},${tone},${tone - 3})`;
        g.fillRect(0, y0, N, bh);
        // Grain: faint streaks along the board.
        for (let k = 0; k < 10; ++k) {
            g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,250' : '66,66,64'},${(0.02 + rnd() * 0.03).toFixed(3)})`;
            g.fillRect(rnd() * N, y0 + rnd() * bh, 40 + rnd() * 200, 1 + rnd() * 1.5);
        }
        // Seam under the board, lit edge over it.
        g.fillStyle = 'rgba(52,48,42,0.45)';
        g.fillRect(0, y0 + bh - 1.5, N, 1.5);
        g.fillStyle = 'rgba(255,252,244,0.14)';
        g.fillRect(0, y0, N, 1);
        // Butt joints, staggered.
        const off = rnd() * N;
        for (let x = off % 170; x < N; x += 170) {
            g.fillStyle = 'rgba(52,48,42,0.35)';
            g.fillRect(x, y0, 1.5, bh);
        }
    }
    // Fine noise.
    const img = g.getImageData(0, 0, N, N);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 12;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    // Rain streaks down from the top (canvas y runs down: v = 1 is the top row).
    for (let i = 0; i < 14; ++i) {
        const x = rnd() * N;
        const grad = g.createLinearGradient(0, 0, 0, N);
        grad.addColorStop(0, 'rgba(58,56,52,0.06)');
        grad.addColorStop(1, 'rgba(58,54,46,0)');
        g.fillStyle = grad;
        g.fillRect(x, 0, 2 + rnd() * 6, 120 + rnd() * 300);
    }
    return toTexture(cv);
}

/**
 * The tunnel's side walls, painted lit (u: height over the road, 0..TUNNEL_CEIL; v: along one wall
 * panel): a grimy kerb, light tiles, a slate band, then light concrete panels brightening up to the
 * light strip, and the strip's shadow line at the top.
 */
function tunnelWallTexture(): THREE.CanvasTexture {
    const W = 256;
    const H = 128;
    const [cv, g] = canvas(W, H);
    const tileTop = 0.42;
    const tileH = 0.042;
    for (let x = 0; x < W; ++x) {
        const h = (x + 0.5) / W;
        let c: V3;
        if (h < 0.035) c = [74, 74, 76];
        else if (h < tileTop) {
            c = [226, 224, 216];
            // Road grime up the lowest tiles; the lamps' light fading down the wall.
            const grime = Math.min(1, (h - 0.035) / 0.16);
            const k = (0.72 + 0.28 * grime) * (0.9 + 0.1 * (h / tileTop));
            c = c.map((v) => v * k) as V3;
            // Grout lines between tile courses.
            if (((h - 0.035) / tileH) % 1 < 0.1) c = c.map((v) => v * 0.86) as V3;
        } else if (h < tileTop + 0.03) c = [86, 94, 102];
        else if (h < 0.965) {
            const t = (h - tileTop - 0.03) / (0.965 - tileTop - 0.03);
            c = ([190, 191, 188] as V3).map((v) => v * (0.82 + 0.3 * t * t)) as V3;
        } else c = [128, 128, 126];
        g.fillStyle = `rgb(${c.map((v) => Math.min(255, Math.round(v))).join(',')})`;
        g.fillRect(x, 0, 1, H);
    }
    // Tile joints across the panel (vertical grout every 1/8 panel), and the panel joint at its end.
    g.fillStyle = 'rgba(40,40,40,0.13)';
    for (let k = 0; k < 8; ++k) g.fillRect(Math.round(W * 0.035), (k * H) / 8, Math.round(W * (tileTop - 0.035)), 1);
    g.fillStyle = 'rgba(30,30,30,0.35)';
    g.fillRect(Math.round(W * (tileTop + 0.03)), 0, W, 2);
    const t = toTexture(cv);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
}

/** The ceiling (u across, 0..1 wall to wall; v along one panel): concrete lit by the strips at its sides. */
function tunnelCeilingTexture(): THREE.CanvasTexture {
    const W = 256;
    const H = 64;
    const [cv, g] = canvas(W, H);
    const base: V3 = [104, 106, 108];
    for (let x = 0; x < W; ++x) {
        const u = (x + 0.5) / W;
        const d = Math.min(u, 1 - u);
        const glow = Math.exp(-(((d - 0.1) / 0.07) ** 2)) * 0.6 + Math.exp(-((d / 0.05) ** 2)) * 0.2;
        const c = base.map((v) => v * (0.85 + glow));
        g.fillStyle = `rgb(${c.map((v) => Math.min(255, Math.round(v))).join(',')})`;
        g.fillRect(x, 0, 1, H);
    }
    // Joint between the roof panels.
    g.fillStyle = 'rgba(20,22,26,0.45)';
    g.fillRect(0, 0, W, 2);
    const t = toTexture(cv);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
}

/** Jet fans (u round the barrel, v along it): galvanised steel, dark grilles at both ends. */
function fanTexture(): THREE.CanvasTexture {
    const [cv, g] = canvas(64, 64);
    for (let x = 0; x < 64; ++x) {
        // u = 0.75 faces down (cylinder uv), where the light from the road bounces.
        const a = (x / 64) * Math.PI * 2;
        const k = 0.62 + 0.3 * Math.max(0, -Math.cos(a - Math.PI * 1.5 + Math.PI)) + 0.08 * Math.sin(a * 3);
        g.fillStyle = `rgb(${Math.round(170 * k)},${Math.round(174 * k)},${Math.round(178 * k)})`;
        g.fillRect(x, 0, 1, 64);
    }
    g.fillStyle = 'rgba(20,22,24,0.85)';
    g.fillRect(0, 0, 64, 7);
    g.fillRect(0, 57, 64, 7);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const y of [16, 48]) g.fillRect(0, y, 64, 2);
    return toTexture(cv);
}

/** Emergency exit (v 0..0.7 the door, 0.74..1 its lit sign): a green steel door, a green running-man sign. */
function exitTexture(): THREE.CanvasTexture {
    const [cv, g] = canvas(128, 256);
    // Canvas y runs down: the sign is the top 26%.
    g.fillStyle = '#2a2f33';
    g.fillRect(0, 66, 128, 190);
    g.fillStyle = '#1e7a4c';
    g.fillRect(10, 76, 108, 180);
    g.fillStyle = '#e8ece8';
    g.fillRect(18, 150, 92, 8);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(10, 76, 108, 4);
    g.fillStyle = '#0fb35e';
    g.fillRect(0, 0, 128, 60);
    g.fillStyle = '#ffffff';
    // Running figure and an arrow.
    g.beginPath();
    g.arc(40, 14, 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.moveTo(36, 22);
    g.lineTo(30, 38);
    g.lineTo(20, 50);
    g.moveTo(30, 38);
    g.lineTo(42, 44);
    g.lineTo(44, 54);
    g.moveTo(34, 26);
    g.lineTo(48, 32);
    g.moveTo(34, 26);
    g.lineTo(22, 30);
    g.stroke();
    g.beginPath();
    g.moveTo(66, 30);
    g.lineTo(104, 30);
    g.moveTo(92, 18);
    g.lineTo(106, 30);
    g.lineTo(92, 42);
    g.stroke();
    const t = toTexture(cv, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Triangle soup with uvs. */
class Soup {
    pos: number[] = [];
    uv: number[] = [];
    tri(a: V3, b: V3, c: V3, ua: number[], ub: number[], uc: number[]): void {
        this.pos.push(...a, ...b, ...c);
        this.uv.push(...ua, ...ub, ...uc);
    }
    /** Quad a b / c d (a, b on one station; c, d on the next). */
    quad(a: V3, b: V3, c: V3, d: V3, ua: number[], ub: number[], uc: number[], ud: number[]): void {
        this.tri(a, b, c, ua, ub, uc);
        this.tri(b, d, c, ub, ud, uc);
    }
    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.computeVertexNormals();
        return g;
    }
}

/** Point at a lateral offset (+ = the driver's left) and height above a station. */
const at = (st: Station, off: number, dy: number): V3 => [st.pos[0] - st.right[0] * off, st.pos[1] + dy, st.pos[2] - st.right[2] * off];
/** Horizontal forward (unit) at a station. */
const fwdOf = (st: Station): V3 => {
    const l = Math.hypot(st.right[0], st.right[2]) || 1;
    return [st.right[2] / l, 0, -st.right[0] / l];
};
const half = (st: Station) => Math.max(st.edges.wallL, -st.edges.wallR);

/** Texture coordinates for a swept vertex: its station, offset, height and arc length along the profile (and the profile's length). */
type SweepUv = (st: Station, off: number, dy: number, arc: number, len: number) => [number, number];
/** World-scale uvs: along the profile, along the road (600 units a repeat). */
const arcUv: SweepUv = (st, _o, _y, arc) => [arc / 600, st.s / 600];
/** World-scale uvs for walls: along the road, up the wall (so board lines stay level). */
const wallUv: SweepUv = (st, _o, y) => [st.s / 600, y / 600];

/** Sweeps a cross-section (offset, height) along stations. */
function sweep(out: Soup, sts: Station[], prof: (st: Station) => [number, number][], uv: SweepUv = arcUv): void {
    const profs = sts.map(prof);
    const arcs = profs.map((p) => {
        const u = [0];
        for (let k = 1; k < p.length; ++k) u.push(u[k - 1]! + Math.hypot(p[k]![0] - p[k - 1]![0], p[k]![1] - p[k - 1]![1]));
        return u;
    });
    for (let i = 0; i + 1 < sts.length; ++i) {
        const A = sts[i]!;
        const B = sts[i + 1]!;
        const pa = profs[i]!;
        const pb = profs[i + 1]!;
        const ua = (k: number) => uv(A, pa[k]![0], pa[k]![1], arcs[i]![k]!, arcs[i]!.at(-1)!);
        const ub = (k: number) => uv(B, pb[k]![0], pb[k]![1], arcs[i + 1]![k]!, arcs[i + 1]!.at(-1)!);
        for (let k = 0; k + 1 < pa.length; ++k)
            out.quad(at(A, pa[k]![0], pa[k]![1]), at(A, pa[k + 1]![0], pa[k + 1]![1]), at(B, pb[k]![0], pb[k]![1]), at(B, pb[k + 1]![0], pb[k + 1]![1]), ua(k), ua(k + 1), ub(k), ub(k + 1));
    }
}

/** A box between two points (a bar of width w and height h, centred on the segment). */
function bar(a: V3, b: V3, w: number, h: number): THREE.BufferGeometry {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const g = new THREE.BoxGeometry(w, h, L);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...b), new THREE.Vector3(...a), new THREE.Vector3(0, 1, 0));
    m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    g.applyMatrix4(m);
    return g;
}

const merge = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (!geos.length) return null;
    const flat = geos.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        n.clearGroups();
        if (!n.getAttribute('normal')) n.computeVertexNormals();
        return n;
    });
    const m = mergeGeometries(flat);
    for (const g of geos) g.dispose();
    return m;
};

/** A station interpolated at S (straight between stations). */
function stationAt(cl: Station[], s: number): Station {
    let lo = 0;
    let hi = cl.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cl[mid]!.s <= s) lo = mid;
        else hi = mid - 1;
    }
    const A = cl[lo]!;
    const B = cl[lo + 1]!;
    const t = Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s || 1)));
    const l = (a: number[], b: number[]) => a.map((v, k) => v + (b[k]! - v) * t) as V3;
    return { ...A, s, pos: l(A.pos, B.pos), right: l(A.right, B.right) };
}

// ---------------------------------------------------------------------------------------------
// Tunnels: extents and the park over them
// ---------------------------------------------------------------------------------------------

interface Tunnel {
    name: string;
    /** Portals (centerline S). */
    s0: number;
    s1: number;
    /** Inner wall offset (either side). */
    W: number;
}

function tunnelsOf(meta: Meta): Tunnel[] {
    const cl = meta.centerline;
    const out: Tunnel[] = [];
    for (const t of meta.tunnels ?? []) {
        const sg = meta.segments?.[t.seg];
        if (!sg) continue;
        const s = (v: number) => (v < 0 ? sg[1] + v : sg[0] + v);
        const s0 = s(t.from);
        const s1 = s(t.to);
        const sts = cl.filter((c) => c.s >= s0 && c.s <= s1);
        if (sts.length < 2) continue;
        out.push({ name: t.name, s0, s1, W: Math.max(...sts.map(half)) + TUN_MARGIN });
    }
    return out.sort((a, b) => a.s0 - b.s0);
}

/** Nearest point on a centerline run to (x, z): its S, the road height there and the distance. */
function nearestOn(sts: Station[], x: number, z: number): { s: number; y: number; d: number } {
    let bd = Infinity;
    let bs = 0;
    let by = 0;
    for (let k = 0; k + 1 < sts.length; ++k) {
        const A = sts[k]!;
        const C = sts[k + 1]!;
        const ex = C.pos[0] - A.pos[0];
        const ez = C.pos[2] - A.pos[2];
        const u = Math.max(0, Math.min(1, ((x - A.pos[0]) * ex + (z - A.pos[2]) * ez) / (ex * ex + ez * ez || 1)));
        const d2 = (A.pos[0] + ex * u - x) ** 2 + (A.pos[2] + ez * u - z) ** 2;
        if (d2 < bd) {
            bd = d2;
            bs = A.s + (C.s - A.s) * u;
            by = A.pos[1] + (C.pos[1] - A.pos[1]) * u;
        }
    }
    return { s: bs, y: by, d: Math.sqrt(bd) };
}

/** Every terrain sample in a world-space box: `fn` returns its new height (or undefined to keep it). */
function editSamples(world: SfWorld, x0: number, x1: number, z0: number, z1: number, fn: (x: number, z: number, y: number) => number | undefined): void {
    const t = world.json.terrain;
    const S = world.json.scale;
    const i0 = Math.max(0, Math.floor((x0 / S - t.e0) / t.cell));
    const i1 = Math.min(t.cx - 1, Math.floor((x1 / S - t.e0) / t.cell));
    const j0 = Math.max(0, Math.floor((t.n1 + z0 / S) / t.cell));
    const j1 = Math.min(t.cz - 1, Math.floor((t.n1 + z1 / S) / t.cell));
    for (let j = j0; j <= j1; ++j)
        for (let i = i0; i <= i1; ++i) {
            const h = world.cells[j * t.cx + i];
            if (!h) continue;
            const st = t.steps[t.levels[j * t.cx + i]!]!;
            const m = t.cell / st + 1;
            const ce0 = t.e0 + i * t.cell;
            const cn1 = t.n1 - j * t.cell;
            for (let b = 0; b < m; ++b) {
                const z = -(cn1 - b * st) * S;
                if (z < z0 || z > z1) continue;
                for (let a = 0; a < m; ++a) {
                    const x = (ce0 + a * st) * S;
                    if (x < x0 || x > x1) continue;
                    const y = fn(x, z, h[b * m + a]!);
                    if (y !== undefined) h[b * m + a] = y;
                }
            }
        }
}

/**
 * The Presidio Tunnel Tops: raises the terrain over each tunnel (before the terrain, trees and ground
 * maps are built; world.stitch() after) to a park at the roof's level, flat a little way past the
 * box's walls, then banking down to the ground. Never inside the walls (the road stays open) nor in
 * front of the portals' headwalls (which face the park's end), never lower than the ground was, and
 * falling away to the base of any building near it. Trees over the box and at the portals go; the
 * rest stand on the new ground.
 */
export function raiseTunnelTops(world: SfWorld, meta: Meta): void {
    const cl = meta.centerline;
    // Building footprints (world x, z) with their base.
    const B = world.json.buildings;
    const blds: { cx: number; cz: number; r: number; base: number; pts: number[] }[] = [];
    for (let i = 0, k = 0; i < B.n.length; k += 2 * B.n[i]!, ++i) {
        const pts = B.pts.slice(k, k + 2 * B.n[i]!);
        let cx = 0;
        let cz = 0;
        for (let q = 0; q < pts.length; q += 2) {
            cx += pts[q]!;
            cz += pts[q + 1]!;
        }
        cx /= pts.length / 2;
        cz /= pts.length / 2;
        let r = 0;
        for (let q = 0; q < pts.length; q += 2) r = Math.max(r, Math.hypot(pts[q]! - cx, pts[q + 1]! - cz));
        blds.push({ cx, cz, r, base: B.base[i]!, pts });
    }
    /** Distance from (x, z) to a footprint (0 inside). */
    const footDist = (x: number, z: number, p: number[]): number => {
        let inside = false;
        let d2 = Infinity;
        for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
            const ax = p[a]!;
            const az = p[a + 1]!;
            const bx = p[b]!;
            const bz = p[b + 1]!;
            if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
            const ex = bx - ax;
            const ez = bz - az;
            const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
            d2 = Math.min(d2, (ax + ex * u - x) ** 2 + (az + ez * u - z) ** 2);
        }
        return inside ? 0 : Math.sqrt(d2);
    };

    const trees = world.json.trees;
    for (const tn of tunnelsOf(meta)) {
        const { s0, s1, W } = tn;
        const sts = [stationAt(cl, s0), ...cl.filter((c) => c.s > s0 && c.s < s1), stationAt(cl, s1)];
        const reach = W + WALL_T + PARK_FLAT + (TOP + 3000) * PARK_RUN;
        const xs = sts.map((c) => c.pos[0]);
        const zs = sts.map((c) => c.pos[2]);
        const box = [Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...zs) - reach, Math.max(...zs) + reach] as const;
        const near = blds.filter((o) => o.cx + o.r > box[0] && o.cx - o.r < box[1] && o.cz + o.r > box[2] && o.cz - o.r < box[3]);
        // Behind both portals' planes (the headwalls face the park's end along them).
        const planes = [sts[0]!, sts.at(-1)!].map((P, k) => ({ P, f: fwdOf(P), sign: k ? -1 : 1 }));
        const behind = (x: number, z: number) => planes.every(({ P, f, sign }) => sign * ((x - P.pos[0]) * f[0] + (z - P.pos[2]) * f[2]) > RAISE_IN);
        editSamples(world, ...box, (x, z, y0) => {
            if (!behind(x, z)) return undefined;
            const n = nearestOn(sts, x, z);
            if (n.d < W + RAISE_IN || n.d > reach) return undefined;
            let y = n.y + TOP - Math.max(0, n.d - (W + WALL_T + PARK_FLAT)) / PARK_RUN;
            if (y <= y0) return undefined;
            for (const o of near) {
                const dc = Math.hypot(x - o.cx, z - o.cz) - o.r;
                if (o.base + Math.max(0, dc - BUILDING_CLEAR) / BUILDING_RUN >= y) continue;
                y = Math.min(y, o.base + Math.max(0, footDist(x, z, o.pts) - BUILDING_CLEAR) / BUILDING_RUN);
            }
            return y > y0 ? y : undefined;
        });
        const kept: number[] = [];
        for (let k = 0; k + 4 < trees.length; k += 5) {
            const x = trees[k]!;
            const z = trees[k + 2]!;
            let y = trees[k + 1]!;
            if (x > box[0] && x < box[1] && z > box[2] && z < box[3]) {
                // Standing in a headwall's way (near a portal's plane)?
                if (
                    [sts[0]!, sts.at(-1)!].some((P) => {
                        const f = fwdOf(P);
                        const along = (x - P.pos[0]) * f[0] + (z - P.pos[2]) * f[2];
                        const lat = (x - P.pos[0]) * f[2] - (z - P.pos[2]) * f[0];
                        return Math.abs(along) < 500 && Math.abs(lat) < reach;
                    })
                )
                    continue;
                const n = nearestOn(sts, x, z);
                if (n.s > s0 && n.s < s1) {
                    if (n.d < W + WALL_T + 250) continue;
                    y = Math.max(y, world.groundY(x, z));
                }
            }
            kept.push(x, y, z, trees[k + 3]!, trees[k + 4]!);
        }
        trees.length = 0;
        for (const v of kept) trees.push(v);
    }
}

// ---------------------------------------------------------------------------------------------

type Key = 'concrete' | 'deck' | 'board' | 'trim' | 'rail' | 'tunWall' | 'tunCeil' | 'lamp' | 'fan' | 'door' | 'sign' | 'shade' | 'kicker' | 'lipBar';

export function buildParkway(meta: Meta, world: SfWorld, kcl: Uint8Array, terrain: TerrainMeshes): ParkwayMeshes {
    const group = new THREE.Group();
    group.name = 'parkway';
    const cl = meta.centerline;
    const park = meta.segments?.parkway;
    const range = (s0: number, s1: number) => cl.filter((c) => c.s >= s0 && c.s <= s1);
    const geos: Partial<Record<Key, THREE.BufferGeometry[]>> = {};
    const put = (key: Key, g: THREE.BufferGeometry | null) => g && (geos[key] ??= []).push(g);

    // ---- viaducts ----
    const viaducts = (world.json as { viaducts?: [number, number][] }).viaducts ?? [];
    for (const [s0, s1] of viaducts) {
        const sts = range(s0, s1);
        if (sts.length < 2) continue;
        // Clearance over the ground along the span decides the girder depth (the low viaduct by the
        // Marina is only a few meters up).
        const clear = Math.max(...sts.map((st) => st.pos[1] - world.groundY(st.pos[0], st.pos[2])));
        const D = clear > 900 ? GIRDER_DEEP : GIRDER_SHALLOW;
        // Box girder: parapet fascia outside the barrier, cantilevered deck, sloped webs, soffit.
        const deck = new Soup();
        sweep(deck, sts, (st) => {
            const L = st.edges.wallL;
            const R = st.edges.wallR;
            return [
                [L + 96, 30],
                [L + 96, -D * 0.4],
                [L - 500, -D * 0.52],
                [L - 820, -D],
                [R + 820, -D],
                [R + 500, -D * 0.52],
                [R - 96, -D * 0.4],
                [R - 96, 30],
            ];
        });
        put('deck', deck.geometry());
        // Piers: twin columns under the webs, a cap beam between them; evenly spaced.
        const n = Math.max(1, Math.round((s1 - s0) / PIER_EVERY));
        const cols: THREE.BufferGeometry[] = [];
        for (let k = 1; k < n; ++k) {
            const s = s0 + ((s1 - s0) * k) / n;
            const st = cl.reduce((a, c) => (Math.abs(c.s - s) < Math.abs(a.s - s) ? c : a));
            const f = fwdOf(st);
            const yaw = Math.atan2(f[0], f[2]);
            const top = st.pos[1] - D;
            const feet: V3[] = [];
            for (const o of [st.edges.wallL - 1050, st.edges.wallR + 1050]) {
                const p = at(st, o, 0);
                const gy = world.groundY(p[0], p[2]);
                feet.push([p[0], gy, p[2]]);
            }
            if (feet.some((p) => top - p[1] < 250)) continue;
            for (const p of feet) {
                const h = top - p[1] + 80;
                const c = new THREE.CylinderGeometry(1, 1.12, h, 12, 1, true);
                c.scale(170, 1, 260);
                c.rotateY(yaw);
                c.translate(p[0], p[1] - 80 + h / 2, p[2]);
                cols.push(c);
            }
            // Cap beam under the soffit.
            put('concrete', bar(at(st, st.edges.wallL - 700, -D - 120), at(st, st.edges.wallR + 700, -D - 120), 520, 240));
        }
        put('concrete', merge(cols));
        // Abutments: a wall from the deck down to the ground at each end.
        for (const [st, dir] of [
            [sts[0]!, 1],
            [sts[sts.length - 1]!, -1],
        ] as const) {
            const w = new Soup();
            const L = st.edges.wallL + 96;
            const R = st.edges.wallR - 96;
            const steps = 8;
            const f = fwdOf(st);
            const back = dir * 60;
            for (let k = 0; k < steps; ++k) {
                const oa = L + ((R - L) * k) / steps;
                const ob = L + ((R - L) * (k + 1)) / steps;
                const pa = at(st, oa, 0);
                const pb = at(st, ob, 0);
                const ga = world.groundY(pa[0], pa[2]) - 120;
                const gb = world.groundY(pb[0], pb[2]) - 120;
                const ta: V3 = [pa[0] + f[0] * back, st.pos[1] - 20, pa[2] + f[2] * back];
                const tb: V3 = [pb[0] + f[0] * back, st.pos[1] - 20, pb[2] + f[2] * back];
                w.quad(ta, tb, [ta[0], Math.min(ga, ta[1] - 200), ta[2]], [tb[0], Math.min(gb, tb[1] - 200), tb[2]], [oa / 600, 0], [ob / 600, 0], [oa / 600, (st.pos[1] - ga) / 600], [ob / 600, (st.pos[1] - gb) / 600]);
            }
            put('concrete', w.geometry());
        }
    }

    // ---- tunnels ----
    const tunnels = tunnelsOf(meta);
    /** Ground under a point beside a station, relative to the road there. */
    const groundRel = (st: Station, off: number, along = 0): number => {
        const p = at(st, off, 0);
        const f = fwdOf(st);
        return world.groundY(p[0] + f[0] * along, p[2] + f[2] * along) - st.pos[1];
    };
    const lawns: THREE.BufferGeometry[] = [];
    const railing = (pts: V3[]) => {
        // Posts every ~300 along a polyline (their feet), a top rail and a mid rail.
        const H = 190;
        let run = 0;
        for (let k = 0; k < pts.length; ++k) {
            const p = pts[k]!;
            if (k > 0) run += Math.hypot(p[0] - pts[k - 1]![0], p[2] - pts[k - 1]![2]);
            if (k === 0 || k === pts.length - 1 || run >= 300) {
                put('rail', bar(p, [p[0], p[1] + H, p[2]], 18, 18));
                run = 0;
            }
            if (k > 0) {
                const q = pts[k - 1]!;
                put('rail', bar([q[0], q[1] + H, q[2]], [p[0], p[1] + H, p[2]], 14, 22));
                put('rail', bar([q[0], q[1] + H * 0.5, q[2]], [p[0], p[1] + H * 0.5, p[2]], 8, 8));
            }
        }
    };
    for (const tn of tunnels) {
        const { W, s0, s1 } = tn;
        const Wr = W + WALL_T;
        const sts = [stationAt(cl, s0), ...cl.filter((c) => c.s > s0 + 20 && c.s < s1 - 20), stationAt(cl, s1)];

        // Interior: side walls, ceiling, a continuous light strip along each side of the ceiling.
        const walls = new Soup();
        for (const side of [1, -1]) sweep(walls, sts, () => [[side * W, -80], [side * W, TUNNEL_CEIL]], (st, _o, y) => [Math.max(0, y) / TUNNEL_CEIL, st.s / PANEL]);
        put('tunWall', walls.geometry());
        const ceil = new Soup();
        sweep(ceil, sts, () => [[W, TUNNEL_CEIL], [-W, TUNNEL_CEIL]], (st, o) => [(W - o) / (2 * W), st.s / PANEL]);
        put('tunCeil', ceil.geometry());
        const lamps = new Soup();
        for (const side of [1, -1])
            sweep(lamps, sts, () => [
                [side * (W - 150), TUNNEL_CEIL],
                [side * (W - 165), TUNNEL_CEIL - 40],
                [side * (W - 305), TUNNEL_CEIL - 40],
                [side * (W - 320), TUNNEL_CEIL],
            ]);
        put('lamp', lamps.geometry());
        // The floor in the tunnel's shade (a dark veil over the road ribbon).
        const floor = new Soup();
        sweep(floor, sts, (st) => [[st.edges.roadL, 8], [st.edges.roadR, 8]]);
        put('shade', floor.geometry());

        // Jet fans in pairs hung from the roof over the outer lanes (clear of the kicker's flight in
        // the middle), and emergency exits along both walls.
        const mid = (s0 + s1) / 2;
        for (let s = s0 + 1800; s < s1 - 1200; s += FAN_EVERY) {
            if (s > mid - 3000 && s < mid + 5200) continue;
            const st = stationAt(cl, s);
            const f = fwdOf(st);
            const yaw = Math.atan2(f[0], f[2]);
            for (const side of [1, -1]) {
                for (const o of [W - 700, W - 1020]) {
                    const p = at(st, side * o, TUNNEL_CEIL - 190);
                    const c = new THREE.CylinderGeometry(120, 120, 780, 14, 1);
                    c.rotateX(Math.PI / 2);
                    c.rotateY(yaw);
                    c.translate(...p);
                    put('fan', c);
                    // Hangers.
                    for (const a of [-240, 240]) {
                        const q: V3 = [p[0] + f[0] * a, p[1] + 100, p[2] + f[2] * a];
                        put('fan', bar(q, [q[0], TUNNEL_CEIL + st.pos[1], q[2]], 30, 30));
                    }
                }
            }
        }
        const doors = new Soup();
        const signs = new Soup();
        for (let s = s0 + EXIT_EVERY / 2; s < s1 - 1000; s += EXIT_EVERY) {
            for (const side of [1, -1]) {
                const A = stationAt(cl, s - 190);
                const Bs = stationAt(cl, s + 190);
                const o = side * (W - 8);
                // Seen from the road, u runs along the driving direction on both walls.
                doors.quad(at(A, o, 20), at(Bs, o, 20), at(A, o, 520), at(Bs, o, 520), [0, 0], [1, 0], [0, 0.72], [1, 0.72]);
                signs.quad(at(A, o, 560), at(Bs, o, 560), at(A, o, 700), at(Bs, o, 700), [0, 0.765], [1, 0.765], [0, 1], [1, 1]);
            }
        }
        put('door', doors.geometry());
        put('sign', signs.geometry());

        // Outside: the box's sides (board-formed where they show above the park or the ground), the
        // lawn over the roof (the terrain's imagery), and a coping and railing where the side stands
        // as an overlook wall over lower ground.
        const outer = new Soup();
        for (const side of [1, -1]) {
            sweep(
                outer,
                sts,
                (st) => {
                    const g = Math.min(groundRel(st, side * (Wr + 150)), groundRel(st, side * (Wr + 500)));
                    return [
                        [side * Wr, Math.min(-200, g - 150)],
                        [side * Wr, TOP + 25],
                    ];
                },
                wallUv,
            );
            // Overlook runs: the ground just outside well below the park.
            let run: Station[] = [];
            const flush = () => {
                if (run.length > 1) {
                    const cope = new Soup();
                    sweep(cope, run, () => [
                        [side * (Wr + 45), TOP - 20],
                        [side * (Wr + 45), TOP + 75],
                        [side * (Wr - 160), TOP + 75],
                        [side * (Wr - 160), TOP + 25],
                    ]);
                    put('trim', cope.geometry());
                    railing(run.map((st) => at(st, side * (Wr - 50), TOP + 75)));
                }
                run = [];
            };
            for (const st of sts) {
                if (groundRel(st, side * (Wr + 300)) < TOP - 160) run.push(st);
                else flush();
            }
            flush();
        }
        put('board', outer.geometry());
        {
            const lawn = new Soup();
            sweep(lawn, sts, () => [1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1].map((f) => [f * Wr, TOP + 25] as [number, number]));
            lawns.push(lawn.geometry());
        }

        // Portals: a board-formed headwall facing the park's end: a flat lintel over the opening with a
        // slightly proud frame round it, a gently arched parapet over the portal, and on out to either
        // side stepping down with the park's banks (its cross-section at the portal) to the ground in
        // front; a coping along its top, a railing where it stands over a drop.
        for (const [s, dir] of [
            [s0, 1],
            [s1, -1],
        ] as const) {
            const st = stationAt(cl, s);
            const f = fwdOf(st);
            const HW = Wr + HEAD_OUT;
            const archTop = (o: number) => TOP + PARAPET + ARCH * (1 - (o / HW) ** 2);
            // Portal-local offsets (o, + = left looking into the tunnel): the park just behind the face and
            // the ground in front of it.
            const behind = (o: number) => groundRel(st, dir * o, dir * (RAISE_IN + 350));
            const front = (o: number) => Math.min(groundRel(st, dir * o, -dir * 150), groundRel(st, dir * o, -dir * 700));
            const edge = (sign: 1 | -1): { o: number; top: number; low: number }[] => {
                const out: { o: number; top: number; low: number }[] = [];
                for (let o = 0; o <= HW; o += 150) out.push({ o: sign * o, top: archTop(o), low: Math.min(-250, front(sign * o) - 150) });
                for (let o = Math.ceil(HW / 150) * 150; o < 14000; o += 150) {
                    const b = behind(sign * o);
                    const g = front(sign * o);
                    if (b - g < 40) {
                        out.push({ o: sign * o, top: g + 40, low: g - 150 });
                        break;
                    }
                    out.push({ o: sign * o, top: b + 50, low: g - 150 });
                }
                return out;
            };
            const prof = [...edge(-1).reverse(), ...edge(1).slice(1)];
            const shape = new THREE.Shape();
            prof.forEach((p, k) => (k ? shape.lineTo(p.o, p.top) : shape.moveTo(p.o, p.top)));
            for (let k = prof.length - 1; k >= 0; --k) shape.lineTo(prof[k]!.o, prof[k]!.low);
            shape.closePath();
            const CH = 90;
            const opening = (w: number, h: number, bottom: number) =>
                [
                    [-w, bottom],
                    [w, bottom],
                    [w, h - CH],
                    [w - CH, h],
                    [-w + CH, h],
                    [-w, h - CH],
                ].map(([o, y]) => new THREE.Vector2(o, y));
            const hole = new THREE.Path(opening(W, TUNNEL_CEIL, -100).reverse());
            hole.closePath();
            shape.holes.push(hole);
            const left = new THREE.Vector3(-st.right[0], 0, -st.right[2]).normalize();
            const fw = new THREE.Vector3(f[0], 0, f[2]);
            const up = new THREE.Vector3(0, 1, 0);
            const into = fw.clone().multiplyScalar(dir);
            const side = dir === 1 ? left : left.clone().negate();
            /** Portal-local shape (o, y), extruded from `along` into the tunnel → world; world-scale uvs. */
            const place = (g: THREE.BufferGeometry, along: number) => {
                g.applyMatrix4(new THREE.Matrix4().makeBasis(side, up, into).setPosition(new THREE.Vector3(...st.pos).addScaledVector(into, along)));
                const pos = g.getAttribute('position');
                const uv = g.getAttribute('uv');
                for (let k = 0; k < pos.count; ++k) uv.setXY(k, (pos.getX(k) + pos.getZ(k)) / 600, pos.getY(k) / 600);
                return g;
            };
            const extrude = (sh: THREE.Shape, depth: number) => new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 2 });
            put('board', place(extrude(shape, 520), 0));
            // Frame round the opening, standing 70 proud of the face.
            const frame = new THREE.Shape(opening(W + 170, TUNNEL_CEIL + 170, -60));
            frame.holes.push(new THREE.Path(opening(W, TUNNEL_CEIL, -60).reverse()));
            put('trim', place(extrude(frame, 70), -70));
            // Coping along the top, overhanging both faces.
            const cope = new THREE.Shape();
            prof.forEach((p, k) => (k ? cope.lineTo(p.o, p.top + 60) : cope.moveTo(p.o, p.top + 60)));
            for (let k = prof.length - 1; k >= 0; --k) cope.lineTo(prof[k]!.o, prof[k]!.top - 20);
            cope.closePath();
            put('trim', place(extrude(cope, 600), -40));
            // Railings over the drops (always over the portal: the park's overlook onto the road).
            let run: V3[] = [];
            const flush = () => {
                if (run.length > 1) railing(run);
                run = [];
            };
            for (const p of prof) {
                if (Math.abs(p.o) <= HW || p.top - Math.max(p.low + 150, front(p.o)) > 350) {
                    const q = at(st, dir * p.o, p.top + 60);
                    run.push([q[0] + into.x * 260, q[1], q[2] + into.z * 260]);
                } else flush();
            }
            flush();
        }
    }

    // ---- kicker faces (out in the open), over the KCL surfaces ----
    {
        const tris = readKclTriangles(kcl);
        const inTunnel = (s: number) => tunnels.some((t) => s > t.s0 - 500 && s < t.s1 + 500);
        const parkKickers = (meta.features ?? []).filter((f) => f.type === 'ramp' && f.attr === 0x2000 && f.s && f.lipPos && park && f.s[0]! >= park[0] && f.s[1]! <= park[1]);
        const kickers = parkKickers.filter((f) => !inTunnel(f.s![0]!));
        const kick = new Soup();
        /** Each kicker vertex's pad size (width, length; see padMaterial.ts). */
        const kickSize: number[] = [];
        const P = tris.positions;
        for (let t = 0; t < tris.attributes.length; ++t) {
            const attr = tris.attributes[t]!;
            const v: V3[] = [0, 1, 2].map((k) => [P[t * 9 + k * 3]!, P[t * 9 + k * 3 + 1]!, P[t * 9 + k * 3 + 2]!]);
            const cx = (v[0]![0] + v[1]![0] + v[2]![0]) / 3;
            const cz = (v[0]![2] + v[1]![2] + v[2]![2]) / 3;
            const nx = tris.normals[t * 3]!;
            const ny = tris.normals[t * 3 + 1]!;
            const nz = tris.normals[t * 3 + 2]!;
            if (attr & 0x2000) {
                const kk = kickers.find((f) => Math.hypot(f.lipPos![0]! - cx, f.lipPos![2]! - cz) < (f.length ?? 1800) + 400);
                if (!kk) continue;
                const yaw = ((kk.yawDeg ?? 0) * Math.PI) / 180;
                const dir: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
                const lat: V3 = [dir[2], 0, -dir[0]];
                const L = kk.length ?? 1800;
                const Wd = kk.width ?? 3200;
                const lp = kk.lipPos!;
                const uv = (p: V3) => {
                    const dx = p[0] - lp[0]!;
                    const dz = p[2] - lp[2]!;
                    return [(dx * lat[0] + dz * lat[2]) / Wd + 0.5, 1 + (dx * dir[0] + dz * dir[2]) / L];
                };
                const off = (p: V3): V3 => [p[0] + nx * 6, p[1] + ny * 6 + 4, p[2] + nz * 6];
                kick.tri(off(v[0]!), off(v[1]!), off(v[2]!), uv(v[0]!), uv(v[1]!), uv(v[2]!));
                for (let q = 0; q < 3; ++q) kickSize.push(Wd, L);
            }
        }
        if (kick.pos.length) {
            const g = kick.geometry();
            g.setAttribute('padSize', new THREE.Float32BufferAttribute(kickSize, 2));
            put('kicker', g);
        }
        // Bright white lip bars across all the parkway's kickers (the tunnels' too).
        const lips: THREE.BufferGeometry[] = [];
        for (const k of parkKickers) {
            const yaw = ((k.yawDeg ?? 0) * Math.PI) / 180;
            const g = new THREE.BoxGeometry((k.width ?? 3200) - 20, 36, 70);
            g.rotateY(yaw);
            g.translate(k.lipPos![0]!, k.lipPos![1]! + 26, k.lipPos![2]!);
            lips.push(g);
        }
        put('lipBar', merge(lips));
    }

    // ---- materials ----
    const noLight = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
    const tex = {
        concrete: concreteTexture('#b3aea3'),
        board: boardTexture(),
        trim: concreteTexture('#c4c2bc'),
        wall: tunnelWallTexture(),
        ceil: tunnelCeilingTexture(),
        fan: fanTexture(),
        exit: exitTexture(),
    };
    const polyOff = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const kicker = padMaterial(PAD_LOOKS.trick);
    const mats: Record<Key, THREE.Material> = {
        concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, color: 0xd6d0c4, roughness: 0.88, side: THREE.DoubleSide }),
        deck: new THREE.MeshStandardMaterial({ map: tex.concrete, color: 0xc9c3b6, roughness: 0.85, side: THREE.DoubleSide }),
        board: new THREE.MeshStandardMaterial({ map: tex.board, color: 0xbcbdbb, roughness: 0.92, side: THREE.DoubleSide }),
        trim: new THREE.MeshStandardMaterial({ map: tex.trim, color: 0xdcdad4, roughness: 0.8, side: THREE.DoubleSide }),
        rail: new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.5, metalness: 0.6 }),
        tunWall: noLight(0xffffff, { map: tex.wall, side: THREE.DoubleSide }),
        tunCeil: noLight(0xffffff, { map: tex.ceil, side: THREE.DoubleSide }),
        lamp: noLight(0xfff8ec, { toneMapped: false, side: THREE.DoubleSide }),
        fan: noLight(0xffffff, { map: tex.fan }),
        door: noLight(0xffffff, { map: tex.exit, side: THREE.DoubleSide, ...polyOff }),
        sign: noLight(0xffffff, { map: tex.exit, toneMapped: false, side: THREE.DoubleSide, ...polyOff }),
        shade: noLight(0x000000, { transparent: true, opacity: 0.42, depthWrite: false, ...polyOff }),
        kicker,
        lipBar: noLight(PIECE_COLORS.paintWhite, { toneMapped: false }),
    };

    // The lawns over the roofs wear the terrain's own imagery materials.
    const lawnMeshes: THREE.Mesh[] = [];
    if (lawns.length) {
        // Split the lawn by the terrain's base image under each triangle, uvs into that image.
        const all = mergeGeometries(lawns)!;
        for (const g of lawns) g.dispose();
        const P = all.getAttribute('position');
        const parts = new Map<THREE.Material, { pos: number[]; uv: number[] }>();
        for (let t = 0; t < P.count; t += 3) {
            const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3;
            const cz = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3;
            const { material, uv } = terrain.imageryAt(cx, cz);
            let part = parts.get(material);
            if (!part) parts.set(material, (part = { pos: [], uv: [] }));
            for (let k = t; k < t + 3; ++k) {
                part.pos.push(P.getX(k), P.getY(k), P.getZ(k));
                part.uv.push(...uv(P.getX(k), P.getZ(k)));
            }
        }
        all.dispose();
        for (const [material, part] of parts) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(part.pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
            const mesh = new THREE.Mesh(g, material);
            mesh.receiveShadow = true;
            lawnMeshes.push(mesh);
        }
    }

    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of Object.entries(geos) as [Key, THREE.BufferGeometry[]][]) {
        const g = merge(list);
        if (!g) continue;
        const m = new THREE.Mesh(g, mats[key]);
        const lit = key === 'concrete' || key === 'deck' || key === 'board' || key === 'trim' || key === 'rail';
        m.castShadow = lit;
        m.receiveShadow = lit || key === 'kicker';
        meshes.push(m);
        group.add(m);
    }
    for (const mesh of lawnMeshes) group.add(mesh);

    return {
        group,
        dispose() {
            for (const mesh of [...meshes, ...lawnMeshes]) mesh.geometry.dispose();
            for (const t of Object.values(tex)) t.dispose();
            for (const m of Object.values(mats)) m.dispose();
        },
    };
}
