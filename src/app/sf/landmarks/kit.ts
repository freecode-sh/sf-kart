/**
 * Small geometry kit for the San Francisco landmarks: a per-material geometry batch that merges
 * everything into one mesh per material, prisms / caps / lathes with sensible UVs, and helpers.
 *
 * Landmarks are modelled in local meters (x east, y up, z south = -north) and their group is
 * scaled by SCALE (60 units per meter) and placed in the world.
 */

import * as THREE from 'three';

export type V2 = [number, number];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix: scale, then rotate (x, y, z Euler, 'YXZ'), then translate. */
export function mat(x: number, y: number, z: number, ry = 0, s: number | [number, number, number] = 1, rx = 0, rz = 0): THREE.Matrix4 {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    if (typeof s === 'number') _s.set(s, s, s);
    else _s.set(s[0], s[1], s[2]);
    return new THREE.Matrix4().compose(_p, _q, _s);
}

export type AddOpts = {
    /** Transform applied to the piece. */
    m?: THREE.Matrix4;
    /** Vertex color (multiplies the material color when the material uses vertexColors). */
    color?: THREE.ColorRepresentation;
    /**
     * UV re-projection: 'box' projects along the dominant normal axis in the piece's own frame
     * (before `m`), scaled by `tile` meters per texture repeat ([u, v]).
     */
    uv?: 'box' | 'boxWorld';
    tile?: [number, number];
    uvOffset?: [number, number];
};

type Part = { pos: Float32Array; nor: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint32Array };

/** Collects geometry per material key and merges it into one mesh per key. */
export class Batch {
    private parts = new Map<string, Part[]>();
    private _col = new THREE.Color();

    add(key: string, geo: THREE.BufferGeometry, o: AddOpts = {}): this {
        const g = geo;
        const pa = g.getAttribute('position') as THREE.BufferAttribute;
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const na = g.getAttribute('normal') as THREE.BufferAttribute;
        const ua = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
        const n = pa.count;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        const uv = new Float32Array(n * 2);
        const col = new Float32Array(n * 3);
        const c = this._col.set(o.color ?? 0xffffff);
        // Geometry vertex colors are kept when no color is given.
        const ca = o.color === undefined ? (g.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
        const tile = o.tile ?? [1, 1];
        const off = o.uvOffset ?? [0, 0];
        const nm = o.m ? new THREE.Matrix3().getNormalMatrix(o.m) : null;
        const v = new THREE.Vector3();
        const nn = new THREE.Vector3();
        const project = (i: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
            const ax = Math.abs(nx);
            const ay = Math.abs(ny);
            const az = Math.abs(nz);
            let u: number;
            let w: number;
            if (ay >= ax && ay >= az) {
                u = px / tile[0];
                w = pz / tile[0];
            } else if (ax >= az) {
                u = (nx > 0 ? -pz : pz) / tile[0];
                w = py / tile[1];
            } else {
                u = (nz > 0 ? px : -px) / tile[0];
                w = py / tile[1];
            }
            uv[i * 2] = u + off[0];
            uv[i * 2 + 1] = w + off[1];
        };
        for (let i = 0; i < n; ++i) {
            v.fromBufferAttribute(pa, i);
            nn.fromBufferAttribute(na, i);
            if (o.uv === 'box') project(i, v.x, v.y, v.z, nn.x, nn.y, nn.z);
            if (o.m) {
                v.applyMatrix4(o.m);
                nn.applyMatrix3(nm!).normalize();
            }
            if (o.uv === 'boxWorld') project(i, v.x, v.y, v.z, nn.x, nn.y, nn.z);
            pos[i * 3] = v.x;
            pos[i * 3 + 1] = v.y;
            pos[i * 3 + 2] = v.z;
            nor[i * 3] = nn.x;
            nor[i * 3 + 1] = nn.y;
            nor[i * 3 + 2] = nn.z;
            if (!o.uv) {
                uv[i * 2] = ua ? ua.getX(i) + off[0] : 0;
                uv[i * 2 + 1] = ua ? ua.getY(i) + off[1] : 0;
            }
            col[i * 3] = ca ? ca.getX(i) : c.r;
            col[i * 3 + 1] = ca ? ca.getY(i) : c.g;
            col[i * 3 + 2] = ca ? ca.getZ(i) : c.b;
        }
        let idx: Uint32Array;
        if (g.index) idx = Uint32Array.from(g.index.array as ArrayLike<number>);
        else {
            idx = new Uint32Array(n);
            for (let i = 0; i < n; ++i) idx[i] = i;
        }
        const list = this.parts.get(key) ?? [];
        list.push({ pos, nor, uv, col, idx });
        this.parts.set(key, list);
        return this;
    }

    has(key: string): boolean {
        return this.parts.has(key);
    }

    geometry(key: string): THREE.BufferGeometry | null {
        const list = this.parts.get(key);
        if (!list || !list.length) return null;
        let nv = 0;
        let ni = 0;
        for (const p of list) {
            nv += p.pos.length / 3;
            ni += p.idx.length;
        }
        const pos = new Float32Array(nv * 3);
        const nor = new Float32Array(nv * 3);
        const uv = new Float32Array(nv * 2);
        const col = new Float32Array(nv * 3);
        const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
        let ov = 0;
        let oi = 0;
        for (const p of list) {
            pos.set(p.pos, ov * 3);
            nor.set(p.nor, ov * 3);
            uv.set(p.uv, ov * 2);
            col.set(p.col, ov * 3);
            for (let i = 0; i < p.idx.length; ++i) idx[oi + i] = p.idx[i]! + ov;
            ov += p.pos.length / 3;
            oi += p.idx.length;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        return g;
    }

    /** One mesh per key that has a material. */
    build(mats: Record<string, THREE.Material>, name: string, shadows = false): THREE.Group {
        const group = new THREE.Group();
        group.name = name;
        for (const key of this.parts.keys()) {
            const mat = mats[key];
            if (!mat) throw new Error(`landmarks: no material '${key}'`);
            const g = this.geometry(key)!;
            const mesh = new THREE.Mesh(g, mat);
            mesh.name = `${name}:${key}`;
            mesh.castShadow = shadows;
            mesh.receiveShadow = shadows;
            mesh.matrixAutoUpdate = false;
            group.add(mesh);
        }
        return group;
    }
}

// ---------------------------------------------------------------- primitives (base at y = 0)

export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);

export const cyl = (rTop: number, rBot: number, h: number, seg: number, open = false): THREE.BufferGeometry =>
    new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open).translate(0, h / 2, 0);

/** Cylinder whose facets are flat-shaded (non-indexed). */
export const facetCyl = (rTop: number, rBot: number, h: number, seg: number, open = false, rot = 0): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open, rot).translate(0, h / 2, 0).toNonIndexed();
    g.computeVertexNormals();
    return g;
};

export const cone = (r: number, h: number, seg: number): THREE.BufferGeometry => facetCyl(0.0001, r, h, seg);

export const sphere = (r: number, ws: number, hs: number, flat = false): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(r, ws, hs);
    if (!flat) return g;
    const f = g.toNonIndexed();
    f.computeVertexNormals();
    return f;
};

/** Regular polygon (x, z) with n vertices at radius r, first vertex at angle rot (radians from +x toward -z). */
export function regPoly(r: number, n: number, rot = 0): V2[] {
    const out: V2[] = [];
    for (let i = 0; i < n; ++i) {
        const a = rot + (i / n) * Math.PI * 2;
        out.push([r * Math.cos(a), -r * Math.sin(a)]);
    }
    return out;
}

/** Signed area of a polygon in the (x, z) plane (positive: counterclockwise seen from +y). */
export function areaXZ(p: V2[]): number {
    let a = 0;
    for (let i = 0; i < p.length; ++i) {
        const [x0, z0] = p[i]!;
        const [x1, z1] = p[(i + 1) % p.length]!;
        a += x1 * z0 - x0 * z1;
    }
    return a / 2;
}

/** Offset a simple polygon outward by d (miter joins; d < 0 insets). */
export function offsetPoly(p: V2[], d: number): V2[] {
    const ccw = areaXZ(p) > 0;
    const n = p.length;
    const out: V2[] = [];
    for (let i = 0; i < n; ++i) {
        const a = p[(i + n - 1) % n]!;
        const b = p[i]!;
        const c = p[(i + 1) % n]!;
        const on = (u: V2, w: V2): V2 => {
            const dx = w[0] - u[0];
            const dz = w[1] - u[1];
            const l = Math.hypot(dx, dz) || 1;
            // Outward normal of a ccw (seen from +y) polygon edge is (-dz, dx).
            return ccw ? [-dz / l, dx / l] : [dz / l, -dx / l];
        };
        const n0 = on(a, b);
        const n1 = on(b, c);
        const mx = n0[0] + n1[0];
        const mz = n0[1] + n1[1];
        const ml = Math.hypot(mx, mz) || 1;
        const cos = (mx / ml) * n0[0] + (mz / ml) * n0[1];
        const k = d / Math.max(0.3, cos);
        out.push([b[0] + (mx / ml) * k, b[1] + (mz / ml) * k]);
    }
    return out;
}

export type PrismOpts = {
    /** Meters per texture repeat along the wall and vertically. */
    tile?: [number, number];
    /** v at y = 0 (so tiers line up with a reference height). */
    vBase?: number;
    top?: boolean;
    bottom?: boolean;
    /** Walls face into the polygon (courtyards). */
    inward?: boolean;
    /** Closed ring (default) or open polyline. */
    closed?: boolean;
};

/**
 * Vertical walls along a polygon from y0 to y1 with flat normals; u runs along the wall in meters
 * / tile[0], v = (y - vBase) / tile[1].
 */
export function prism(poly: V2[], y0: number, y1: number, o: PrismOpts = {}): THREE.BufferGeometry {
    const tile = o.tile ?? [1, 1];
    const vb = o.vBase ?? 0;
    const closed = o.closed ?? true;
    const ccw = areaXZ(poly) > 0;
    // Winding (a0, b0, b1) faces (-dz, dx), which is outward for a ccw polygon.
    const out = ccw !== !!o.inward ? 1 : -1;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    let run = 0;
    const n = poly.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; ++i) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const nx = (-dz / len) * out;
        const nz = (dx / len) * out;
        const u0 = run / tile[0];
        const u1 = (run + len) / tile[0];
        run += len;
        const v0 = (y0 - vb) / tile[1];
        const v1 = (y1 - vb) / tile[1];
        const A = [a[0], y0, a[1]];
        const B = [b[0], y0, b[1]];
        const C = [b[0], y1, b[1]];
        const D = [a[0], y1, a[1]];
        const quad = out > 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C];
        const quv = out > 0 ? [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1] : [u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1];
        for (const q of quad) pos.push(q[0]!, q[1]!, q[2]!);
        for (let k = 0; k < 6; ++k) nor.push(nx, 0, nz);
        uv.push(...quv);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const parts = [g];
    if (o.top) parts.push(cap(poly, y1, true, tile[0]));
    if (o.bottom) parts.push(cap(poly, y0, false, tile[0]));
    return parts.length === 1 ? g : merge(parts);
}

/** Horizontal cap of a polygon (with optional holes) at height y, facing up or down. */
export function cap(poly: V2[], y: number, up = true, tile = 1, holes: V2[][] = []): THREE.BufferGeometry {
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const hv = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hv);
    const all = [...poly, ...holes.flat()];
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    for (const t of tris) {
        const [a, b, c] = t.map((i) => all[i]!) as [V2, V2, V2];
        // Normal y of (a, b, c) = (b - a) x (c - a) . y = dz1*dx2 - dx1*dz2
        const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        const order = ny > 0 === up ? [a, b, c] : [a, c, b];
        for (const p of order) {
            pos.push(p[0], y, p[1]);
            uv.push(p[0] / tile, p[1] / tile);
            nor.push(0, up ? 1 : -1, 0);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
}

/** Concatenate non-indexed / indexed geometries with position, normal, uv. */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const b = new Batch();
    for (const g of list) b.add('x', g);
    const g = b.geometry('x')!;
    g.deleteAttribute('color');
    return g;
}

/** Lathe around +y from (radius, y) profile points; u around, v along the profile (0..1). */
export function lathe(profile: V2[], seg: number, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
    return new THREE.LatheGeometry(
        profile.map((p) => new THREE.Vector2(Math.max(1e-4, p[0]), p[1])),
        seg,
        phiStart,
        phiLength,
    );
}

/** A beam (box) from point a to point b (x, z) with width w, from y0 to y1. */
export function beam(a: V2, b: V2, w: number, y0: number, y1: number): { geo: THREE.BufferGeometry; m: THREE.Matrix4 } {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    return { geo: box(len, y1 - y0, w), m: mat((a[0] + b[0]) / 2, y0, (a[1] + b[1]) / 2, ry) };
}

/** Thin tube between two 3D points (for cables, legs). */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5): { geo: THREE.BufferGeometry; m: THREE.Matrix4 } {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return { geo: g, m: new THREE.Matrix4().compose(a.clone(), q, new THREE.Vector3(1, 1, 1)) };
}

/** Triangle count of everything under an object (instanced meshes counted per instance). */
export function stats(root: THREE.Object3D): { meshes: number; tris: number } {
    let meshes = 0;
    let tris = 0;
    root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        ++meshes;
        const g = m.geometry;
        const t = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        tris += t * ((m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1);
    });
    return { meshes, tris: Math.round(tris) };
}
