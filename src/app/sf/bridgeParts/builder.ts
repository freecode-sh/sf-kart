/**
 * Tiny world-space mesh builder: flat-shaded boxes / beams / prisms and smooth tubes, merged into
 * one BufferGeometry per material. UVs are world-scale planar projections (1 / uvScale units per
 * texture repeat), vertical faces map v to height so vertical detail lines up.
 */

import * as THREE from 'three';
import type { Frame } from './frame';

type V3 = THREE.Vector3;
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();

export class GeoBuilder {
    private pos: number[] = [];
    private nrm: number[] = [];
    private uvs: number[] = [];
    private idx: number[] = [];

    constructor(
        private readonly origin: V3,
        private readonly uvScale = 1 / 240,
    ) {}

    get triangles(): number {
        return this.idx.length / 3;
    }

    private vert(p: V3, n: V3, u: number, v: number): number {
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(n.x, n.y, n.z);
        this.uvs.push(u, v);
        return this.pos.length / 3 - 1;
    }

    /** Planar convex polygon; `out` (optional) is a direction the face should point along. */
    face(pts: V3[], out?: V3): void {
        // Newell normal.
        _n.set(0, 0, 0);
        for (let i = 0; i < pts.length; ++i) {
            const a = pts[i]!;
            const b = pts[(i + 1) % pts.length]!;
            _n.x += (a.y - b.y) * (a.z + b.z);
            _n.y += (a.z - b.z) * (a.x + b.x);
            _n.z += (a.x - b.x) * (a.y + b.y);
        }
        if (_n.lengthSq() < 1e-12) return;
        _n.normalize();
        let P = pts;
        if (out && _n.dot(out) < 0) {
            P = [...pts].reverse();
            _n.negate();
        }
        const n = _n.clone();
        const s = this.uvScale;
        const o = this.origin;
        let uAxis: V3;
        let vAxis: V3 | null = null;
        if (Math.abs(n.y) > 0.75) uAxis = new THREE.Vector3(1, 0, 0);
        else uAxis = new THREE.Vector3(n.z, 0, -n.x).normalize();
        if (Math.abs(n.y) > 0.75) vAxis = new THREE.Vector3(0, 0, 1);
        const base = this.pos.length / 3;
        for (const p of P) {
            _t.subVectors(p, o);
            this.vert(p, n, _t.dot(uAxis) * s, (vAxis ? _t.dot(vAxis) : _t.y) * s);
        }
        for (let i = 1; i + 1 < P.length; ++i) this.idx.push(base, base + i, base + i + 1);
    }

    /** Hexahedron from 8 corners, index = iu | iv << 1 | ih << 2. */
    hexa(c: V3[]): void {
        const ctr = new THREE.Vector3();
        for (const p of c) ctr.add(p);
        ctr.multiplyScalar(1 / 8);
        const F = [
            [0, 2, 6, 4],
            [1, 5, 7, 3],
            [0, 4, 5, 1],
            [2, 3, 7, 6],
            [0, 1, 3, 2],
            [4, 6, 7, 5],
        ];
        for (const f of F) {
            const pts = f.map((i) => c[i]!);
            const fc = new THREE.Vector3();
            for (const p of pts) fc.add(p);
            fc.multiplyScalar(0.25).sub(ctr);
            this.face(pts, fc);
        }
    }

    /** Axis-aligned box in a frame (u, v in frame units, y absolute). */
    box(f: Frame, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number): void {
        this.hexa([f.p(u0, v0, y0), f.p(u1, v0, y0), f.p(u0, v1, y0), f.p(u1, v1, y0), f.p(u0, v0, y1), f.p(u1, v0, y1), f.p(u0, v1, y1), f.p(u1, v1, y1)]);
    }

    /** Tapered box: bottom rectangle [u0,u1]x[v0,v1] at y0, top [tu0,tu1]x[tv0,tv1] at y1. */
    taper(f: Frame, b: [number, number, number, number], t: [number, number, number, number], y0: number, y1: number): void {
        this.hexa([f.p(b[0], b[2], y0), f.p(b[1], b[2], y0), f.p(b[0], b[3], y0), f.p(b[1], b[3], y0), f.p(t[0], t[2], y1), f.p(t[1], t[2], y1), f.p(t[0], t[3], y1), f.p(t[1], t[3], y1)]);
    }

    /** Rectangular beam from a to b: width w (horizontal-ish), height h (in the plane of `up`). */
    beam(a: V3, b: V3, w: number, h: number, up: V3 = Y): void {
        const d = _a.subVectors(b, a).normalize();
        const side = _b.crossVectors(d, up);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        side.normalize();
        const upv = new THREE.Vector3().crossVectors(side, d).normalize();
        const sw = side.clone().multiplyScalar(w / 2);
        const uh = upv.multiplyScalar(h / 2);
        const c: V3[] = [];
        for (let k = 0; k < 8; ++k) {
            const e = k & 1 ? b : a;
            const p = e.clone();
            p.addScaledVector(sw, k & 2 ? 1 : -1);
            p.addScaledVector(uh, k & 4 ? 1 : -1);
            c.push(p);
        }
        this.hexa(c);
    }

    /** Beam whose cross-section is aligned to the frame-ish horizontal `side` direction. */
    beamSide(a: V3, b: V3, w: number, h: number, side: V3): void {
        const d = _a.subVectors(b, a).normalize();
        const up = new THREE.Vector3().crossVectors(side, d).normalize();
        this.beam(a, b, w, h, up.lengthSq() > 0.5 ? up : Y);
    }

    /** Prism: polygon (frame u, v) extruded from y0 to y1, flat sides. */
    prism(f: Frame, poly: [number, number][], y0: number, y1: number, caps = true): void {
        const bot = poly.map(([u, v]) => f.p(u, v, y0));
        const top = poly.map(([u, v]) => f.p(u, v, y1));
        const ctr = f.p(poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length, (y0 + y1) / 2);
        for (let i = 0; i < poly.length; ++i) {
            const j = (i + 1) % poly.length;
            const q = [bot[i]!, bot[j]!, top[j]!, top[i]!];
            const fc = new THREE.Vector3().addVectors(bot[i]!, bot[j]!).multiplyScalar(0.5).sub(ctr);
            fc.y = 0;
            this.face(q, fc);
        }
        if (caps) {
            this.face(top, Y);
            this.face(bot, new THREE.Vector3(0, -1, 0));
        }
    }

    /** Ring wall between an outer and an inner polygon (same vertex count), with a top cap. */
    ring(f: Frame, outer: [number, number][], inner: [number, number][], y0: number, y1: number): void {
        const n = outer.length;
        const P = (q: [number, number], y: number) => f.p(q[0], q[1], y);
        const c = f.p(0, 0, 0);
        for (let i = 0; i < n; ++i) {
            const j = (i + 1) % n;
            const o0 = outer[i]!;
            const o1 = outer[j]!;
            const i0 = inner[i]!;
            const i1 = inner[j]!;
            const mo = P(o0, 0).add(P(o1, 0)).multiplyScalar(0.5).sub(c);
            this.face([P(o0, y0), P(o1, y0), P(o1, y1), P(o0, y1)], mo);
            this.face([P(i0, y0), P(i1, y0), P(i1, y1), P(i0, y1)], mo.clone().negate());
            this.face([P(o0, y1), P(o1, y1), P(i1, y1), P(i0, y1)], Y);
        }
    }

    /** Smooth tube along a path (radius r, seg sides), with optional flat end caps. */
    tube(path: V3[], r: number, seg: number, caps = false): void {
        const n = path.length;
        const frames: { t: V3; s: V3; u: V3 }[] = [];
        for (let i = 0; i < n; ++i) {
            const t = new THREE.Vector3().subVectors(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!).normalize();
            let s = new THREE.Vector3().crossVectors(t, Y);
            if (s.lengthSq() < 1e-6) s = new THREE.Vector3(1, 0, 0);
            s.normalize();
            const u = new THREE.Vector3().crossVectors(s, t).normalize();
            frames.push({ t, s, u });
        }
        const sc = this.uvScale;
        let len = 0;
        const base = this.pos.length / 3;
        for (let i = 0; i < n; ++i) {
            if (i > 0) len += path[i]!.distanceTo(path[i - 1]!);
            const { s, u } = frames[i]!;
            for (let k = 0; k <= seg; ++k) {
                const a = (k / seg) * Math.PI * 2;
                const nn = new THREE.Vector3().addScaledVector(s, Math.cos(a)).addScaledVector(u, Math.sin(a));
                this.vert(path[i]!.clone().addScaledVector(nn, r), nn, len * sc, (k / seg) * 2 * Math.PI * r * sc);
            }
        }
        for (let i = 0; i + 1 < n; ++i)
            for (let k = 0; k < seg; ++k) {
                const a = base + i * (seg + 1) + k;
                const b = a + seg + 1;
                this.idx.push(a, b, a + 1, a + 1, b, b + 1);
            }
        if (caps)
            for (const [i, sgn] of [
                [0, -1],
                [n - 1, 1],
            ] as const) {
                const { s, u, t } = frames[i]!;
                const ring: V3[] = [];
                for (let k = 0; k < seg; ++k) {
                    const a = (k / seg) * Math.PI * 2;
                    ring.push(path[i]!.clone().addScaledVector(s, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r));
                }
                this.face(ring, t.clone().multiplyScalar(sgn));
            }
    }

    /** Vertical n-gon column (tapered), centered at c (bottom), radius r0 → r1. */
    column(c: V3, r0: number, r1: number, h: number, seg: number, caps = true): void {
        const bot: V3[] = [];
        const top: V3[] = [];
        for (let k = 0; k < seg; ++k) {
            const a = ((k + 0.5) / seg) * Math.PI * 2;
            bot.push(new THREE.Vector3(c.x + Math.cos(a) * r0, c.y, c.z + Math.sin(a) * r0));
            top.push(new THREE.Vector3(c.x + Math.cos(a) * r1, c.y + h, c.z + Math.sin(a) * r1));
        }
        for (let k = 0; k < seg; ++k) {
            const j = (k + 1) % seg;
            const out = new THREE.Vector3().addVectors(bot[k]!, bot[j]!).multiplyScalar(0.5).sub(c);
            out.y = 0;
            this.face([bot[k]!, bot[j]!, top[j]!, top[k]!], out);
        }
        if (caps) {
            this.face(top, Y);
            this.face(bot, new THREE.Vector3(0, -1, 0));
        }
    }

    /** Merges an arbitrary geometry (transformed by m). */
    add(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
        const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
        if (!g.attributes.normal) g.computeVertexNormals();
        const P = g.attributes.position!;
        const N = g.attributes.normal!;
        const UV = g.attributes.uv;
        const base = this.pos.length / 3;
        for (let i = 0; i < P.count; ++i) {
            this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
            this.nrm.push(N.getX(i), N.getY(i), N.getZ(i));
            this.uvs.push(UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0);
            this.idx.push(base + i);
        }
    }

    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
        g.computeBoundingBox();
        g.computeBoundingSphere();
        return g;
    }
}
