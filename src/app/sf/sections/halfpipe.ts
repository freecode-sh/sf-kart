/**
 * Half-pipes, dressed as poured-concrete skate bowls: the riding surface straight from the KCL
 * triangles in smooth light concrete (trowel marks, a darker transition at the foot, a Signal
 * Orange stripe painted under the lip, a few big painted numbers and green Boost Lanes up the face,
 * pipeLanes.ts); a round steel coping along the lip; and a solid body behind it (the deck and the
 * low back wall the KCL has there, an orange fascia, a retaining wall down into the ground or the
 * sea, end caps), so a half-pipe reads as a skate ramp built onto the street rather than a thin shell.
 *
 * Pipes with a run-in (the course's `ease`) rise from a kerb-sized lip to full height at each end;
 * the coping, deck and back wall grow with them out of the barrier line, which the pipe hides once
 * it's taller than the barrier.
 *
 *   const pipes = new HalfpipeBuilder(centerline, halfpipeFeatures);
 *   pipes.addTri(kcl.positions, t);   // each half-pipe (KCL type 0x13) triangle
 *   const { group, dispose } = pipes.build();
 */

import * as THREE from 'three';
import type { Station } from '../road';
import { buildPipeLanes } from './pipeLanes';

/** Half-pipe height (default) and the deck / back wall behind the lip (tools/course/lib/course.ts). */
const H = 700;
const DECK = 300;
const BACK_H = 90;
const BACK_T = 70;
/** How far the retaining wall reaches below the pipe's foot. */
const FOOT_DEPTH = 900;
/** Along-track length of one texture tile (four trowel panels and one painted number). */
const TILE = 4400;
const COPING_R = 38;
/** Depth of the painted fascia band below the deck on the outer face. */
const TRIM = 170;

type V3 = [number, number, number];

/** Canvas top = the lip (v = 1), bottom = the foot (v = 0); one tile along the track. */
function pipeTexture(): THREE.CanvasTexture {
    const W = 1024;
    const HT = 512;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = HT;
    const g = cv.getContext('2d')!;
    // Poured concrete: light, a little warmer toward the lip, darker at the foot's transition.
    const grad = g.createLinearGradient(0, HT, 0, 0);
    grad.addColorStop(0, '#a9a49b');
    grad.addColorStop(0.18, '#c9c4ba');
    grad.addColorStop(1, '#d9d4ca');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, HT);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // Trowel marks: faint overlapping arcs.
    g.lineWidth = 3;
    for (let k = 0; k < 90; ++k) {
        const x = rnd() * W;
        const y = HT * 0.15 + rnd() * HT * 0.7;
        const r = 30 + rnd() * 70;
        g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,55,48,0.08)';
        g.beginPath();
        g.arc(x, y, r, Math.PI * (1.1 + rnd() * 0.3), Math.PI * (1.6 + rnd() * 0.3));
        g.stroke();
    }
    // Control joints between the pours (four panels per tile).
    g.fillStyle = 'rgba(55,50,44,0.35)';
    for (let x = 0; x < W; x += W / 4) g.fillRect(x, HT * 0.12, 3, HT * 0.88);
    // Fine grain.
    const img = g.getImageData(0, 0, W, HT);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 14;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    // Painted numbers (ones that read the same mirrored: the pipes on both sides share the tile).
    g.font = '900 150px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(244,244,240,0.8)';
    for (const [x, n] of [
        [0.125, '8'],
        [0.625, '0'],
    ] as const) {
        g.save();
        g.translate(W * x, HT * 0.5);
        g.scale(1, 1.5);
        g.fillText(n, 0, 0);
        g.restore();
    }
    // Signal Orange stripe under the lip (below the coping), with a thin dark shadow line.
    g.fillStyle = '#ff6a1f';
    g.fillRect(0, HT * 0.02, W, HT * 0.07);
    g.fillStyle = 'rgba(40,36,30,0.5)';
    g.fillRect(0, 0, W, HT * 0.02);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
}

/** Board-formed concrete for the body: grain and horizontal form lines. */
function bodyTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#c3bdb1';
    g.fillRect(0, 0, 256, 256);
    const img = g.getImageData(0, 0, 256, 256);
    let seed = 31;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 20;
        img.data[k] = img.data[k]! + n;
        img.data[k + 1] = img.data[k + 1]! + n;
        img.data[k + 2] = img.data[k + 2]! + n;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(70,64,56,0.28)';
    for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 2);
    g.fillStyle = 'rgba(70,64,56,0.18)';
    for (let x = 0; x < 256; x += 128) g.fillRect(x, 0, 2, 256);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

/**
 * Smooth normals for a triangle soup (the pipe surface comes straight from the KCL, one flat
 * triangle at a time): each vertex gets the area-weighted normal of every triangle sharing its
 * position, so the curve shades as a curve instead of in bright and dark facets in low sun.
 */
function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const key = (i: number) => `${Math.round(pos.getX(i))},${Math.round(pos.getY(i))},${Math.round(pos.getZ(i))}`;
    const sum = new Map<string, THREE.Vector3>();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let t = 0; t + 2 < pos.count; t += 3) {
        a.fromBufferAttribute(pos, t);
        b.fromBufferAttribute(pos, t + 1);
        c.fromBufferAttribute(pos, t + 2);
        // Unnormalized: its length is twice the triangle's area.
        n.subVectors(c, b).cross(a.clone().sub(b));
        // Face the same way as the triangle's own (flat) normal.
        if (n.dot(new THREE.Vector3().fromBufferAttribute(nrm, t)) < 0) n.negate();
        for (let k = 0; k < 3; ++k) {
            const id = key(t + k);
            const s = sum.get(id);
            if (s) s.add(n);
            else sum.set(id, n.clone());
        }
    }
    for (let i = 0; i < pos.count; ++i) {
        const s = sum.get(key(i))!;
        const l = s.length();
        if (l > 0) nrm.setXYZ(i, s.x / l, s.y / l, s.z / l);
    }
    nrm.needsUpdate = true;
    return g;
}

type Slot = 'surface' | 'coping' | 'trim' | 'body';

function materials(): Record<Slot, THREE.Material> {
    const tex = pipeTexture();
    return {
        surface: new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1, roughness: 0.8, side: THREE.DoubleSide }),
        // Steel coping pipe.
        coping: new THREE.MeshStandardMaterial({ color: 0xc4cad0, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.28, metalness: 0.85 }),
        // Signal Orange fascia and back wall.
        trim: new THREE.MeshStandardMaterial({ color: 0xff6a1f, roughness: 0.6, side: THREE.DoubleSide }),
        body: new THREE.MeshStandardMaterial({ map: bodyTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    };
}

/** A half-pipe feature from course_meta.json: its S range, height and run-in. */
export interface PipeFeature {
    s: [number, number];
    height?: number;
    ease?: number;
}

interface LipVertex {
    p: V3;
    /** The pipe's height here (less than H in the run-ins). */
    h: number;
    /** Horizontal unit vector away from the track. */
    out: [number, number];
    along: number;
    links: number;
}

export class HalfpipeBuilder {
    private readonly grid = new Map<string, number[]>();
    private readonly cell = 4000;
    private readonly surface: number[] = [];
    private readonly surfaceUv: number[] = [];
    /** Every pipe vertex (for the end caps' profiles). */
    private readonly verts = new Map<string, { p: V3; v: number }>();
    private readonly lips = new Map<string, LipVertex>();
    private readonly segs = new Map<string, [string, string]>();

    constructor(
        private readonly cl: Station[],
        private readonly features: PipeFeature[] = [],
    ) {
        cl.forEach((c, i) => {
            const k = `${Math.floor(c.pos[0] / this.cell)},${Math.floor(c.pos[2] / this.cell)}`;
            let l = this.grid.get(k);
            if (!l) this.grid.set(k, (l = []));
            l.push(i);
        });
    }

    /**
     * The centerline under (x, y, z): its S, height and point there, interpolated between stations.
     * Nearest in 3D, so a pipe under a bridge deck (Fort Point) doesn't pick the deck's stations.
     */
    private track(x: number, y: number, z: number): { s: number; y: number; cx: number; cz: number } {
        let bi = -1;
        let bd = Infinity;
        const gx = Math.floor(x / this.cell);
        const gz = Math.floor(z / this.cell);
        for (let dx = -1; dx <= 1; ++dx)
            for (let dz = -1; dz <= 1; ++dz)
                for (const i of this.grid.get(`${gx + dx},${gz + dz}`) ?? []) {
                    const c = this.cl[i]!;
                    const d = (c.pos[0] - x) ** 2 + (c.pos[1] + H / 2 - y) ** 2 + (c.pos[2] - z) ** 2;
                    if (d < bd) {
                        bd = d;
                        bi = i;
                    }
                }
        const A = this.cl[bi]!;
        // Project onto the centerline segment toward the side the point is on.
        const nb = this.cl[bi + 1] && (this.cl[bi + 1]!.pos[0] - A.pos[0]) * (x - A.pos[0]) + (this.cl[bi + 1]!.pos[2] - A.pos[2]) * (z - A.pos[2]) > 0 ? bi + 1 : bi - 1;
        const B = this.cl[nb];
        if (!B) return { s: A.s, y: A.pos[1], cx: A.pos[0], cz: A.pos[2] };
        const ex = B.pos[0] - A.pos[0];
        const ez = B.pos[2] - A.pos[2];
        const t = Math.max(0, Math.min(1, ((x - A.pos[0]) * ex + (z - A.pos[2]) * ez) / (ex * ex + ez * ez)));
        return { s: A.s + (B.s - A.s) * t, y: A.pos[1] + (B.pos[1] - A.pos[1]) * t, cx: A.pos[0] + ex * t, cz: A.pos[2] + ez * t };
    }

    /** Pipe height at S, as tools/course/lib/course.ts builds it (smoothstep run-ins from a 4% lip). */
    private heightAt(S: number): number {
        const f = this.features.find((p) => S > p.s[0] - 50 && S < p.s[1] + 50);
        const full = f?.height ?? H;
        if (!f?.ease) return full;
        const t = Math.min(1, Math.max(0, Math.min(S - f.s[0], f.s[1] - S) / f.ease));
        return full * (0.04 + 0.96 * t * t * (3 - 2 * t));
    }

    /** Adds KCL triangle `t` (9 floats from `pos[t * 9]`). */
    addTri(pos: ArrayLike<number>, t: number): void {
        const keys: string[] = [];
        const lip: boolean[] = [];
        for (let k = 0; k < 3; ++k) {
            const p: V3 = [pos[t * 9 + k * 3]!, pos[t * 9 + k * 3 + 1]!, pos[t * 9 + k * 3 + 2]!];
            const tr = this.track(p[0], p[1], p[2]);
            // Height up the wall → angle round the quarter pipe (0 at the foot, 1 at the lip).
            const hs = this.heightAt(tr.s);
            const h = Math.max(0, Math.min(hs, p[1] - tr.y));
            const v = hs > 1 ? Math.acos(1 - h / hs) / (Math.PI / 2) : 0;
            this.surface.push(p[0], p[1] + 4, p[2]);
            this.surfaceUv.push(tr.s / TILE, v);
            const key = `${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])}`;
            keys.push(key);
            this.verts.set(key, { p, v });
            lip.push(v > 0.95);
            if (v > 0.95 && !this.lips.has(key)) {
                const ox = p[0] - tr.cx;
                const oz = p[2] - tr.cz;
                const l = Math.hypot(ox, oz) || 1;
                this.lips.set(key, { p, h: hs, out: [ox / l, oz / l], along: tr.s, links: 0 });
            }
        }
        for (let k = 0; k < 3; ++k) {
            const a = keys[k]!;
            const b = keys[(k + 1) % 3]!;
            if (!lip[k] || !lip[(k + 1) % 3] || a === b) continue;
            const id = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (this.segs.has(id)) continue;
            this.segs.set(id, [a, b]);
            this.lips.get(a)!.links++;
            this.lips.get(b)!.links++;
        }
    }

    build(): { group: THREE.Group; dispose(): void } {
        const coping: number[] = [];
        const trim: number[] = [];
        const body: number[] = [];
        const bodyUv: number[] = [];
        const bodyShade: number[] = [];
        /** The retaining wall's foot below lip L (FOOT_DEPTH under the pipe's foot). */
        const bottom = (L: LipVertex) => -L.h - FOOT_DEPTH;
        const at = (L: LipVertex, o: number, dy: number): V3 => [L.p[0] + L.out[0] * o, L.p[1] + dy, L.p[2] + L.out[1] * o];
        /** A body vertex `o` out from lip L and `dy` above it; weathered darker toward the foot. */
        const put = (L: LipVertex, o: number, dy: number, u: number, v: number, band = false) => {
            if (band) {
                trim.push(...at(L, o, dy));
                return;
            }
            body.push(...at(L, o, dy));
            bodyUv.push(u, v);
            const b = bottom(L);
            const t = Math.max(0, Math.min(1, (dy - b) / -b));
            const k = 0.42 + 0.58 * t * t;
            bodyShade.push(k, k * 0.97, k * 0.93);
        };
        // Body cross-section behind the lip (offset out, height above the lip), inner to outer; the
        // back wall and a band below the deck are painted (the trim). In a run-in the back wall
        // grows with the pipe and the fascia band stays above the road.
        const prof = (L: LipVertex): [number, number][] => {
            const k = Math.min(1, L.h / H);
            return [
                [10, 2],
                [DECK, 2],
                [DECK, BACK_H * k],
                [DECK + BACK_T, BACK_H * k],
                [DECK + BACK_T, -Math.min(TRIM, L.h)],
                [DECK + BACK_T, bottom(L)],
            ];
        };
        const isTrim = (k: number) => k >= 1 && k <= 3;
        const ring = 8;
        for (const [ka, kb] of this.segs.values()) {
            const A = this.lips.get(ka)!;
            const B = this.lips.get(kb)!;
            const pa = prof(A);
            const pb = prof(B);
            for (let k = 0; k + 1 < pa.length; ++k) {
                const [oa0, ya0] = pa[k]!;
                const [oa1, ya1] = pa[k + 1]!;
                const [ob0, yb0] = pb[k]!;
                const [ob1, yb1] = pb[k + 1]!;
                // u along the track, v across the profile (world-ish scale).
                const ua = A.along / 400;
                const ub = B.along / 400;
                const band = isTrim(k);
                put(A, oa0, ya0, ua, (oa0 + ya0) / 400, band);
                put(B, ob0, yb0, ub, (ob0 + yb0) / 400, band);
                put(B, ob1, yb1, ub, (ob1 + yb1) / 400, band);
                put(A, oa0, ya0, ua, (oa0 + ya0) / 400, band);
                put(B, ob1, yb1, ub, (ob1 + yb1) / 400, band);
                put(A, oa1, ya1, ua, (oa1 + ya1) / 400, band);
            }
            // Coping: a round bar just outside the lip.
            for (let r = 0; r < ring; ++r) {
                const a0 = (r / ring) * Math.PI * 2;
                const a1 = ((r + 1) / ring) * Math.PI * 2;
                const pt = (L: LipVertex, a: number): V3 => at(L, 22 + Math.cos(a) * COPING_R, 8 + Math.sin(a) * COPING_R);
                coping.push(...pt(A, a0), ...pt(B, a0), ...pt(B, a1), ...pt(A, a0), ...pt(B, a1), ...pt(A, a1));
            }
        }
        // End caps where a lip chain ends: the pipe's profile there, closed off by the body.
        const all = [...this.verts.values()];
        for (const L of this.lips.values()) {
            if (L.links !== 1) continue;
            const px = -L.out[1];
            const pz = L.out[0];
            const sec: [number, number][] = [];
            for (const { p } of all) {
                const dx = p[0] - L.p[0];
                const dz = p[2] - L.p[2];
                if (Math.abs(dx * px + dz * pz) > 25) continue;
                const o = dx * L.out[0] + dz * L.out[1];
                if (o > 5 || o < -900) continue;
                if (!sec.some(([so, sy]) => Math.abs(so - o) < 3 && Math.abs(sy - (p[1] - L.p[1])) < 3)) sec.push([o, p[1] - L.p[1]]);
            }
            if (sec.length < 3) continue;
            sec.sort((a, b) => a[1] - b[1]);
            const foot = sec[0]!;
            const shape: [number, number][] = [...sec, ...prof(L).slice(1), [foot[0], bottom(L)]];
            const tris = THREE.ShapeUtils.triangulateShape(
                shape.map(([o, y]) => new THREE.Vector2(o, y)),
                [],
            );
            for (const tri of tris)
                for (const i of tri) {
                    const [o, y] = shape[i]!;
                    put(L, o, y, o / 400, y / 400);
                }
        }

        const mk = (pos: number[], uv?: number[], color?: number[]) => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
            g.computeVertexNormals();
            return g;
        };
        const mats = materials();
        const group = new THREE.Group();
        group.name = 'halfpipes';
        const meshes: THREE.Mesh[] = [];
        for (const [slot, geo, shadow] of [
            ['surface', smoothNormals(mk(this.surface, this.surfaceUv)), false],
            ['coping', mk(coping), true],
            ['trim', mk(trim), true],
            ['body', mk(body, bodyUv, bodyShade), true],
        ] as const) {
            if (!geo.getAttribute('position').count) continue;
            const m = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geo, mats[slot]);
            m.receiveShadow = true;
            m.castShadow = shadow;
            meshes.push(m);
            group.add(m);
        }
        // Boost Lanes up the faces (pipeLanes.ts), on the surface's triangles.
        const lanes = buildPipeLanes(
            this.surface,
            this.surfaceUv.filter((_, i) => i % 2 === 0).map((u) => u * TILE),
            this.surfaceUv.filter((_, i) => i % 2 === 1),
            this.features,
        );
        if (lanes) group.add(lanes.mesh);
        return {
            group,
            dispose() {
                lanes?.dispose();
                for (const mesh of meshes) mesh.geometry.dispose();
                for (const m of Object.values(mats)) {
                    (m as THREE.MeshStandardMaterial).map?.dispose();
                    m.dispose();
                }
            },
        };
    }
}
