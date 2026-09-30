/**
 * The US 101 viaduct north of the bridge (streets.ts's US101 line), which the course passes under at
 * Vista Point: seen from below at kart height, so built like the real thing rather than a slab —
 * a deck slab on six precast I-girders with cross diaphragms, edge beams and jersey parapets, on
 * hammerhead caps over round columns. Board-formed, weathered concrete (bridgeParts/textures.ts,
 * weathering.ts), darker underneath where the sky doesn't reach. One merged mesh.
 */

import * as THREE from 'three';
import { SCALE, worldY } from './geo';
import { concreteTextures } from './bridgeParts/textures';
import { weatherConcrete } from './weathering';

/** Texture repeat (world units) of the concrete textures. */
const REP = 240;

class Geo {
    pos: number[] = [];
    uv: number[] = [];
    col: number[] = [];
    private quad(p: THREE.Vector3[], uv: number[][], shade: number): void {
        for (const i of [0, 1, 2, 0, 2, 3]) {
            this.pos.push(p[i]!.x, p[i]!.y, p[i]!.z);
            this.uv.push(uv[i]![0]!, uv[i]![1]!);
            this.col.push(shade, shade, shade);
        }
    }
    /**
     * An oriented box: centre c, unit axes t (along), s (across), u (up), half sizes. `shade`
     * multiplies the concrete per face: [sides, top, bottom].
     */
    box(c: THREE.Vector3, t: THREE.Vector3, s: THREE.Vector3, u: THREE.Vector3, ht: number, hs: number, hu: number, shade: [number, number, number]): void {
        const P = (a: number, b: number, d: number) => c.clone().addScaledVector(t, a * ht).addScaledVector(s, b * hs).addScaledVector(u, d * hu);
        const L = (2 * ht) / REP;
        const S = (2 * hs) / REP;
        const H = (2 * hu) / REP;
        // Sides along t (±s), ends (±t), top, bottom.
        for (const sg of [-1, 1]) {
            const q = [P(-sg, sg, -1), P(sg, sg, -1), P(sg, sg, 1), P(-sg, sg, 1)];
            this.quad(q, [[0, 0], [L, 0], [L, H], [0, H]], shade[0]);
            const e = [P(sg, sg, -1), P(sg, -sg, -1), P(sg, -sg, 1), P(sg, sg, 1)];
            this.quad(e, [[0, 0], [S, 0], [S, H], [0, H]], shade[0]);
        }
        this.quad([P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1)], [[0, 0], [S, 0], [S, L], [0, L]], shade[1]);
        this.quad([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], [[0, 0], [L, 0], [L, S], [0, S]], shade[2]);
    }
    /** A vertical round column from y0 to y1 at (x, z), with grime towards the ground. */
    column(x: number, z: number, r: number, y0: number, y1: number, seg = 12): void {
        const H = (y1 - y0) / REP;
        for (let k = 0; k < seg; ++k) {
            const a0 = (k / seg) * Math.PI * 2;
            const a1 = ((k + 1) / seg) * Math.PI * 2;
            const u0 = (a0 * r) / REP;
            const u1 = (a1 * r) / REP;
            const p = [
                new THREE.Vector3(x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r),
                new THREE.Vector3(x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r),
                new THREE.Vector3(x + Math.cos(a1) * r, y1, z + Math.sin(a1) * r),
                new THREE.Vector3(x + Math.cos(a0) * r, y1, z + Math.sin(a0) * r),
            ];
            const uv = [[u0, 0], [u1, 0], [u1, H], [u0, H]];
            // Counterclockwise from outside.
            for (const i of [0, 2, 1, 0, 3, 2]) {
                this.pos.push(p[i]!.x, p[i]!.y, p[i]!.z);
                this.uv.push(uv[i]![0]!, uv[i]![1]!);
                const g = i === 0 || i === 1 ? 0.62 : 0.95;
                this.col.push(g, g, g);
            }
        }
    }
    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
    }
}

/**
 * line: deck surface points (m east, m north, m above sea); width in world units. groundY for the
 * piers (a pier at every point but the last, where the deck stands high enough).
 */
export function buildViaduct101(
    line: [number, number, number][],
    width: number,
    groundY: (x: number, z: number) => number,
): { group: THREE.Group; dispose(): void } {
    const geo = new Geo();
    const up = new THREE.Vector3(0, 1, 0);
    const DEPTH = 180; // deck top to girder soffit
    const SLAB = 35;
    const FLANGE = 25;
    const half = width / 2;
    for (let i = 0; i + 1 < line.length; ++i) {
        const [e0, n0, h0] = line[i]!;
        const [e1, n1, h1] = line[i + 1]!;
        const a = new THREE.Vector3(e0 * SCALE, worldY(h0), -n0 * SCALE);
        const b = new THREE.Vector3(e1 * SCALE, worldY(h1), -n1 * SCALE);
        const t = new THREE.Vector3().subVectors(b, a);
        const len = t.length() + 40;
        t.normalize();
        const s = new THREE.Vector3().crossVectors(t, up).normalize();
        const u = new THREE.Vector3().crossVectors(s, t).normalize();
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const at = (along: number, across: number, down: number) => mid.clone().addScaledVector(t, along).addScaledVector(s, across).addScaledVector(u, -down);
        // Deck slab (sunlit top, a dark soffit).
        geo.box(at(0, 0, SLAB / 2), t, s, u, len / 2, half, SLAB / 2, [0.95, 0.95, 0.5]);
        // Edge beams (fascia) and jersey parapets.
        for (const sg of [-1, 1]) {
            geo.box(at(0, sg * (half - 25), 60), t, s, u, len / 2, 25, 60, [1, 0.95, 0.6]);
            geo.box(at(0, sg * (half - 22), -33), t, s, u, len / 2, 20, 33, [1, 1, 1]);
        }
        // Six I-girders: web and bottom flange.
        const girders = 6;
        for (let k = 0; k < girders; ++k) {
            const across = -half + 240 + ((width - 480) * k) / (girders - 1);
            const webH = DEPTH - SLAB - FLANGE;
            geo.box(at(0, across, SLAB + webH / 2), t, s, u, len / 2, 10, webH / 2, [0.7, 0.6, 0.6]);
            geo.box(at(0, across, DEPTH - FLANGE / 2), t, s, u, len / 2, 32, FLANGE / 2, [0.72, 0.7, 0.62]);
        }
        // Cross diaphragms every ~15 m.
        const nd = Math.max(1, Math.round(len / 900));
        for (let k = 0; k <= nd; ++k) {
            const along = -len / 2 + 60 + ((len - 120) * k) / nd;
            geo.box(at(along, 0, SLAB + 55), t, s, u, 12, half - 250, 55, [0.62, 0.55, 0.55]);
        }
        // Pier at the segment start: a hammerhead cap on two round columns, kept narrow (the course
        // passes close by at Vista Point).
        const gy = groundY(a.x, a.z);
        const capTop = a.y - DEPTH;
        if (capTop - gy > 150) {
            const capC = a.clone().addScaledVector(up, -DEPTH - 55);
            geo.box(capC, t, s, up, 70, half * 0.86, 55, [0.9, 0.8, 0.6]);
            for (const k of [-1, 1]) {
                const p = a.clone().addScaledVector(s, k * 250);
                geo.column(p.x, p.z, 55, groundY(p.x, p.z) - 60, capTop - 110);
            }
        }
    }
    const g = geo.geometry();
    const tex = concreteTextures();
    const mat = weatherConcrete(
        new THREE.MeshStandardMaterial({
            color: 0xc4beb3,
            roughness: 1,
            vertexColors: true,
            ...(tex ? { map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap } : {}),
        }),
    );
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.name = 'viaduct101';
    group.add(mesh);
    return {
        group,
        dispose() {
            g.dispose();
            mat.dispose();
        },
    };
}
