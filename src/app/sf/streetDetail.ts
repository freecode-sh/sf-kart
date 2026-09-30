/**
 * Optional street detail from DataSF (public/data/sf/detail.json, baked by
 * tools/sf/bakeStreetDetail.ts): crosswalks, sidewalks with curbs, traffic islands, bike lanes,
 * center lines, curb ramps and parking meters. Draped on the terrain at build time (heights come
 * from groundY, never from the file), merged into three meshes: paint (decals), raised concrete
 * (sidewalks, curbs, islands) and meters, in ~600 m chunks the camera's frustum can drop. Only
 * within REACH of the course: farther out it's never seen from the road (under a pixel if at all).
 */

import * as THREE from 'three';
import { loadDataJson } from '../data';
import { chunkMesh } from './chunks';
import { nearCourse } from './courseNear';

type Runs = { n: number[]; pts: number[] };

export interface StreetDetailJson {
    attribution: string;
    scale: number;
    /** x, z, heading (tenths of a degree), half length, continental (stride 5). */
    crosswalks: number[];
    /** Curb lines; the sidewalk (width per vertex) lies on the (-dz, dx) side. */
    sidewalks: Runs & { w: number[] };
    curbs: Runs;
    islands: Runs;
    bike: Runs;
    center: Runs;
    /** x, z, heading (degrees), raised (stride 4). */
    ramps: number[];
    /** x, z, heading (degrees), kind (0 post, 1 pay station), cap color index, raised (stride 6). */
    meters: number[];
    caps: string[];
}

export interface StreetDetailPart {
    group: THREE.Group;
    setVisible(on: boolean): void;
    dispose(): void;
}

export function loadStreetDetail(root = 'sf'): Promise<StreetDetailJson> {
    return loadDataJson<StreetDetailJson>(`${root}/detail.json`);
}

/** Sizes (world units, 60 per meter) and colors. */
const L = {
    /** Street level above the terrain (meters off the sidewalk stand on it); paint goes just above. */
    road: 14,
    paint: 17,
    /** Sidewalk top above the terrain. */
    walk: 20,
    curbW: 14,
    barW: 36,
    barPitch: 72,
    barLen: 180,
    lineW: 18,
    bikeW: 90,
    bikeLineW: 9,
    centerW: 7,
    rampW: 72,
    rampL: 90,
    meterScale: 1,
    c: {
        paint: 0xe9e8e2,
        yellow: 0xd9a92a,
        bike: 0x3b8a4c,
        walk: 0xaaa69d,
        curbTop: 0xc9c5bc,
        curbFace: 0x8d8981,
        island: 0x8c9479,
        ramp: 0xbdb8ad,
        pad: 0xd8b224,
        post: 0x2c2e31,
        head: 0x51565c,
        station: 0x33373c,
    },
    caps: { Grey: 0x7c8085, Green: 0x2f8a3c, Yellow: 0xd8b424, Red: 0xb32a24, Black: 0x1c1c1e, Blue: 0x2f5fb0, Purple: 0x6b3c9a, Brown: 0x6a4a2c } as Record<string, number>,
};

/** Resample step along lines (world units) so they follow the terrain. */
const STEP = 300;
/** Built within this distance of the course's centerline (~400 m). */
const REACH = 24_000;
/** Chunk size of the merged meshes (~600 m). */
const CHUNK = 36_000;

class Builder {
    pos: number[] = [];
    col: number[] = [];
    private c = new THREE.Color();
    constructor(
        private readonly gy: (x: number, z: number) => number,
        private readonly keep: (x: number, z: number) => boolean,
    ) {}
    color(hex: number): [number, number, number] {
        this.c.setHex(hex);
        return [this.c.r, this.c.g, this.c.b];
    }
    tri(a: number[], b: number[], c: number[], col: [number, number, number]): void {
        if (!this.keep((a[0]! + b[0]! + c[0]!) / 3, (a[2]! + b[2]! + c[2]!) / 3)) return;
        this.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
        for (let k = 0; k < 3; ++k) this.col.push(col[0], col[1], col[2]);
    }
    quad(a: number[], b: number[], c: number[], d: number[], col: [number, number, number]): void {
        this.tri(a, b, c, col);
        this.tri(a, c, d, col);
    }
    /** A flat quad draped on the ground at `lift`: corners (x, z). */
    flat(p: [number, number][], lift: number, col: [number, number, number]): void {
        const v = p.map(([x, z]) => [x, this.gy(x, z) + lift, z]);
        this.quad(v[0]!, v[1]!, v[2]!, v[3]!, col);
    }
    /** An oriented box: center (x, z), forward heading h (world atan2(dx, dz)), from y0 to y1. */
    box(x: number, z: number, h: number, w: number, d: number, y0: number, y1: number, col: [number, number, number]): void {
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        const rx = fz;
        const rz = -fx;
        const P = (u: number, v: number, y: number) => [x + rx * u * w * 0.5 + fx * v * d * 0.5, y, z + rz * u * w * 0.5 + fz * v * d * 0.5];
        const c = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ] as const;
        for (let k = 0; k < 4; ++k) {
            const [u0, v0] = c[k]!;
            const [u1, v1] = c[(k + 1) % 4]!;
            this.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), col);
        }
        this.quad(P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), col);
    }
    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
    }
}

type Pt = { x: number; z: number; w: number; nx: number; nz: number };

/** Run k of a Runs block, resampled at STEP, with miter normals on the (-dz, dx) side. */
function* runs(r: Runs, widths?: number[]): Generator<Pt[]> {
    let off = 0;
    for (const n of r.n) {
        const src: { x: number; z: number; w: number }[] = [];
        for (let i = 0; i < n; ++i) src.push({ x: r.pts[(off + i) * 2]!, z: r.pts[(off + i) * 2 + 1]!, w: widths ? widths[off + i]! : 0 });
        off += n;
        if (src.length < 2) continue;
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < src.length; ++i) {
            const a = src[i]!;
            const b = src[i + 1]!;
            const m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
            for (let k = 0; k < m; ++k) {
                const t = k / m;
                pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t, nx: 0, nz: 0 });
            }
        }
        const last = src[src.length - 1]!;
        pts.push({ x: last.x, z: last.z, w: last.w, nx: 0, nz: 0 });
        const closed = Math.hypot(pts[0]!.x - last.x, pts[0]!.z - last.z) < 1;
        const segN = (i: number): [number, number] => {
            const a = pts[i]!;
            const b = pts[i + 1]!;
            const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            return [-(b.z - a.z) / L, (b.x - a.x) / L];
        };
        for (let i = 0; i < pts.length; ++i) {
            const prev = i > 0 ? segN(i - 1) : closed && pts.length > 2 ? segN(pts.length - 2) : segN(0);
            const next = i + 1 < pts.length ? segN(i) : closed && pts.length > 2 ? segN(0) : segN(i - 1);
            let mx = prev[0] + next[0];
            let mz = prev[1] + next[1];
            const L = Math.hypot(mx, mz) || 1;
            mx /= L;
            mz /= L;
            const s = 1 / Math.max(0.35, mx * next[0] + mz * next[1]);
            pts[i]!.nx = mx * s;
            pts[i]!.nz = mz * s;
        }
        yield pts;
    }
}

function build(d: StreetDetailJson, gy: (x: number, z: number) => number, keep: (x: number, z: number) => boolean): THREE.Group {
    const paint = new Builder(gy, keep);
    const raised = new Builder(gy, keep);
    const posts = new Builder(gy, keep);
    const C = (h: number) => paint.color(h);
    const cPaint = C(L.c.paint);
    const cYellow = C(L.c.yellow);
    const cBike = C(L.c.bike);
    const cWalk = C(L.c.walk);
    const cCurbTop = C(L.c.curbTop);
    const cCurbFace = C(L.c.curbFace);
    const cIsland = C(L.c.island);
    const cRamp = C(L.c.ramp);
    const cPad = C(L.c.pad);
    const cPost = C(L.c.post);
    const cHead = C(L.c.head);
    const cStation = C(L.c.station);
    const at = (p: Pt, o: number): [number, number] => [p.x + p.nx * o, p.z + p.nz * o];
    /** A ribbon between offsets a and b along a run, `lift` above the ground. */
    const ribbon = (b: Builder, pts: Pt[], a0: (p: Pt) => number, a1: (p: Pt) => number, lift: number, col: [number, number, number]) => {
        for (let i = 0; i + 1 < pts.length; ++i) {
            const p = pts[i]!;
            const q = pts[i + 1]!;
            const v = [at(p, a0(p)), at(p, a1(p)), at(q, a1(q)), at(q, a0(q))].map(([x, z]) => [x, gy(x, z) + lift, z]);
            b.quad(v[0]!, v[1]!, v[2]!, v[3]!, col);
        }
    };
    /** A raised vertical face at offset o, from the ground (a little below) up to `top`. */
    const face = (pts: Pt[], o: (p: Pt) => number, top: number, col: [number, number, number]) => {
        for (let i = 0; i + 1 < pts.length; ++i) {
            const [x0, z0] = at(pts[i]!, o(pts[i]!));
            const [x1, z1] = at(pts[i + 1]!, o(pts[i + 1]!));
            const g0 = gy(x0, z0);
            const g1 = gy(x1, z1);
            raised.quad([x0, g0 - 6, z0], [x1, g1 - 6, z1], [x1, g1 + top, z1], [x0, g0 + top, z0], col);
        }
    };

    // ---- sidewalks: curb top strip + concrete band, curb face on the street side, skirt inside ----
    for (const pts of runs(d.sidewalks, d.sidewalks.w)) {
        const cw = (p: Pt) => Math.min(L.curbW, p.w * 0.5);
        ribbon(raised, pts, () => 0, cw, L.walk, cCurbTop);
        ribbon(raised, pts, cw, (p) => p.w, L.walk, cWalk);
        face(pts, () => 0, L.walk, cCurbFace);
        face(pts, (p) => p.w, L.walk, cWalk);
    }
    // ---- open curb lines: a raised strip ----
    for (const pts of runs(d.curbs)) {
        const hw = L.curbW / 2;
        ribbon(raised, pts, () => -hw, () => hw, L.walk, cCurbTop);
        face(pts, () => -hw, L.walk, cCurbFace);
        face(pts, () => hw, L.walk, cCurbFace);
    }
    // ---- islands: raised, filled ----
    {
        let off = 0;
        for (const n of d.islands.n) {
            const ring: THREE.Vector2[] = [];
            for (let i = 0; i < n; ++i) ring.push(new THREE.Vector2(d.islands.pts[(off + i) * 2]!, d.islands.pts[(off + i) * 2 + 1]!));
            off += n;
            const tris = THREE.ShapeUtils.triangulateShape(ring, []);
            const v = ring.map((p) => [p.x, gy(p.x, p.y) + L.walk, p.y]);
            for (const [a, b, c] of tris) raised.tri(v[a!]!, v[b!]!, v[c!]!, cIsland);
            const closed: Runs = { n: [n + 1], pts: [...ring.flatMap((p) => [p.x, p.y]), ring[0]!.x, ring[0]!.y] };
            for (const pts of runs(closed)) {
                ribbon(raised, pts, () => 0, () => L.curbW, L.walk + 1, cCurbTop);
                face(pts, () => 0, L.walk, cCurbFace);
            }
        }
    }

    // ---- crosswalks ----
    const cw = d.crosswalks;
    for (let i = 0; i + 4 < cw.length; i += 5) {
        const x = cw[i]!;
        const z = cw[i + 1]!;
        const h = (cw[i + 2]! / 10) * (Math.PI / 180);
        const hl = cw[i + 3]!;
        const continental = cw[i + 4]! === 1;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        const rx = fz;
        const rz = -fx;
        // Rectangle: u across the street, v along it.
        const rect = (u0: number, u1: number, v0: number, v1: number, col: [number, number, number]) =>
            paint.flat(
                [
                    [x + rx * u0 + fx * v0, z + rz * u0 + fz * v0],
                    [x + rx * u1 + fx * v0, z + rz * u1 + fz * v0],
                    [x + rx * u1 + fx * v1, z + rz * u1 + fz * v1],
                    [x + rx * u0 + fx * v1, z + rz * u0 + fz * v1],
                ],
                L.paint,
                col,
            );
        const half = L.barLen / 2;
        if (continental) {
            const n = Math.max(2, Math.floor((2 * hl) / L.barPitch));
            const u0 = -((n - 1) * L.barPitch) / 2;
            for (let k = 0; k < n; ++k) {
                const u = u0 + k * L.barPitch;
                rect(u - L.barW / 2, u + L.barW / 2, -half, half, cPaint);
            }
        } else {
            // Two transverse lines, split into pieces so they follow the ground.
            const pieces = Math.max(1, Math.ceil((2 * hl) / STEP));
            for (let k = 0; k < pieces; ++k) {
                const a = -hl + (2 * hl * k) / pieces;
                const b = -hl + (2 * hl * (k + 1)) / pieces;
                rect(a, b, -half, -half + L.lineW, cPaint);
                rect(a, b, half - L.lineW, half, cPaint);
            }
        }
    }

    // ---- bike lanes: white lines; green paint, like SF, in the conflict zones near the
    // intersections at both ends of each run ----
    for (const pts of runs(d.bike)) {
        const hw = L.bikeW / 2;
        const s: number[] = [0];
        for (let i = 1; i < pts.length; ++i) s.push(s[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
        const total = s[s.length - 1]!;
        const ZONE = 1500;
        for (let i = 0; i + 1 < pts.length; ++i)
            if (s[i]! < ZONE || s[i + 1]! > total - ZONE) ribbon(paint, [pts[i]!, pts[i + 1]!], () => -hw, () => hw, L.paint, cBike);
        // The traffic side is towards the street centerline; lanes are drawn on both sides of it,
        // so put a line on both edges (the curb-side one reads as the parking / gutter line).
        ribbon(paint, pts, () => -hw - L.bikeLineW, () => -hw, L.paint, cPaint);
        ribbon(paint, pts, () => hw, () => hw + L.bikeLineW, L.paint, cPaint);
    }
    // ---- center lines: double yellow ----
    for (const pts of runs(d.center)) {
        const w = L.centerW;
        ribbon(paint, pts, () => -w * 1.5, () => -w * 0.5, L.paint, cYellow);
        ribbon(paint, pts, () => w * 0.5, () => w * 1.5, L.paint, cYellow);
    }

    // ---- curb ramps: a concrete plate with a yellow tactile pad at the street end ----
    const rp = d.ramps;
    for (let i = 0; i + 3 < rp.length; i += 4) {
        const x = rp[i]!;
        const z = rp[i + 1]!;
        const h = rp[i + 2]! * (Math.PI / 180);
        const lift = rp[i + 3] ? L.walk + 2 : L.paint;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        const rx = fz;
        const rz = -fx;
        const w = L.rampW / 2;
        const rect = (v0: number, v1: number, lft: number, col: [number, number, number]) =>
            paint.flat(
                [
                    [x - rx * w + fx * v0, z - rz * w + fz * v0],
                    [x + rx * w + fx * v0, z + rz * w + fz * v0],
                    [x + rx * w + fx * v1, z + rz * w + fz * v1],
                    [x - rx * w + fx * v1, z - rz * w + fz * v1],
                ],
                lft,
                col,
            );
        rect(-L.rampL / 2, L.rampL / 2, lift, cRamp);
        rect(L.rampL / 2 - 36, L.rampL / 2, lift + 1, cPad);
    }

    // ---- parking meters ----
    const mt = d.meters;
    const s = L.meterScale;
    for (let i = 0; i + 5 < mt.length; i += 6) {
        const x = mt[i]!;
        const z = mt[i + 1]!;
        const h = mt[i + 2]! * (Math.PI / 180);
        const kind = mt[i + 3]!;
        const cap = C(L.caps[d.caps[mt[i + 4]!] ?? 'Grey'] ?? L.caps.Grey!);
        const y0 = gy(x, z) + (mt[i + 5] ? L.walk : L.road) - 2;
        if (kind === 1) {
            // Pay station: a tall box with a colored top.
            posts.box(x, z, h, 27 * s, 18 * s, y0, y0 + 90 * s, cStation);
            posts.box(x, z, h, 29 * s, 20 * s, y0 + 90 * s, y0 + 96 * s, cap);
        } else {
            posts.box(x, z, h, 5 * s, 5 * s, y0, y0 + 64 * s, cPost);
            posts.box(x, z, h, 13 * s, 11 * s, y0 + 64 * s, y0 + 84 * s, cHead);
            posts.box(x, z, h, 14 * s, 12 * s, y0 + 84 * s, y0 + 89 * s, cap);
        }
    }

    const mat = (offsetUnits: number, offsetFactor: number) =>
        new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            side: THREE.DoubleSide,
            polygonOffset: offsetUnits !== 0,
            polygonOffsetFactor: offsetFactor,
            polygonOffsetUnits: offsetUnits,
        });
    const group = new THREE.Group();
    group.name = 'streetDetail';
    const add = (b: Builder, m: THREE.Material, name: string, cast: boolean) => {
        if (!b.pos.length) return;
        const mesh = new THREE.Mesh(b.geometry(), m);
        mesh.name = name;
        mesh.receiveShadow = true;
        mesh.castShadow = cast;
        for (const piece of chunkMesh(mesh, CHUNK)) group.add(piece);
    };
    // Paint over the terrain's streets and the sidewalks.
    add(paint, mat(-10, -4), 'paint', false);
    add(raised, mat(-6, 0), 'raised', false);
    add(posts, mat(0, 0), 'meters', true);
    return group;
}

/** The street detail part, built at creation; `setVisible` turns it on or off. */
export function buildStreetDetail(detail: StreetDetailJson, groundY: (x: number, z: number) => number, centerline: readonly { pos: readonly number[] }[]): StreetDetailPart {
    const group = build(detail, groundY, nearCourse(centerline, REACH));
    return {
        group,
        setVisible(on) {
            group.visible = on;
        },
        dispose() {
            group.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                    o.geometry.dispose();
                    (o.material as THREE.Material).dispose();
                }
            });
            group.clear();
        },
    };
}
