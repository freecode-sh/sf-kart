/**
 * Shared toolkit for the procedural San Francisco vehicle models (ebike.ts, robotaxi.ts, buggy.ts): geometry
 * helpers, the material set and baking parts into one mesh per material.
 *
 * Models are built in "ground space" (ground at y = 0, +Z forward, +X is the driver's left) out of
 * pieces collected in a Kit, each with a finish, a color and (for skinned models) a bone.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * 'blink' is an unlit light whose material color the model switches (turn signals, hazards, flashes);
 * 'brake' likewise for the tail lights (dim running lights, bright when braking: setBrakeLights).
 */
export type Finish = 'gloss' | 'chrome' | 'satin' | 'matte' | 'glass' | 'visor' | 'light' | 'blink' | 'brake';
export type V3 = THREE.Vector3;
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const SIDES = [1, -1]; // left, right (x sign)

/** Tessellation per model. */
export interface Q {
    sph: [number, number];
    cyl: number;
    lathe: number;
    curve: number;
    bevel: number;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

export interface Piece {
    geo: THREE.BufferGeometry;
    finish: Finish;
    color: THREE.Color;
    bone: number;
}

/** Collects parts, then bakes one mesh per finish. */
export class Kit {
    readonly pieces: Piece[] = [];
    constructor(readonly q: Q) {}
    add(geo: THREE.BufferGeometry, finish: Finish, color: THREE.Color, bone = 0, m?: THREE.Matrix4): THREE.BufferGeometry {
        if (m) geo.applyMatrix4(m);
        this.pieces.push({ geo, finish, color, bone });
        return geo;
    }
}

/** Smooth normals across duplicated vertices (extrusions, grids after custom deformation). */
export function smooth(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    const g = mergeVertices(geo, 1e-3);
    g.computeVertexNormals();
    return g;
}

/** Matrix whose +Y runs along `dir` from `origin`, +X as close as possible to `xRef`. */
export function frameM(origin: V3, dir: V3, xRef: V3 = V(1, 0, 0), out = new THREE.Matrix4()): THREE.Matrix4 {
    const y = dir.clone().normalize();
    let x = xRef.clone().addScaledVector(y, -xRef.dot(y));
    if (x.lengthSq() < 1e-6) x = V(0, 0, 1).addScaledVector(y, -y.z);
    x.normalize();
    const z = V().crossVectors(x, y);
    return out.makeBasis(x, y, z).setPosition(origin);
}

export const M = {
    t: (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z),
    trs: (p: V3, e: THREE.Euler, s: V3 = V(1, 1, 1)) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(e), s),
};

export function ellipsoid(q: Q, c: V3, r: V3, e = new THREE.Euler(), small = false): THREE.BufferGeometry {
    const [w, h] = small ? [10, 6] : q.sph;
    return new THREE.SphereGeometry(1, w, h).applyMatrix4(M.trs(c, e, r));
}

/** Cylinder from a to b (radius r0 at a, r1 at b). */
export function tube(q: Q, a: V3, b: V3, r0: number, r1 = r0, seg = q.cyl): THREE.BufferGeometry {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.translate(0, len / 2, 0);
    return g.applyMatrix4(frameM(a, b.clone().sub(a)));
}

/** Capsule from a to b (rounded ends reach r past them). */
export function capsule(q: Q, a: V3, b: V3, r: number): THREE.BufferGeometry {
    const len = a.distanceTo(b);
    const g = new THREE.CapsuleGeometry(r, len, 4, q.cyl);
    g.translate(0, len / 2, 0);
    return g.applyMatrix4(frameM(a, b.clone().sub(a)));
}

/** A rounded box. */
export function rbox(q: Q, size: V3, c: V3, e = new THREE.Euler(), radius = 2, segs = 1): THREE.BufferGeometry {
    const r = Math.min(radius, size.x / 2 - 0.01, size.y / 2 - 0.01, size.z / 2 - 0.01);
    const g = new RoundedBoxGeometry(size.x, size.y, size.z, segs, r);
    return g.applyMatrix4(M.trs(c, e));
}

/** Indexed grid over (u, v) in [0, 1]^2; faces point along d/du x d/dv. */
export function grid(nu: number, nv: number, fn: (u: number, v: number, out: V3) => void): THREE.BufferGeometry {
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const p = V();
    let k = 0;
    for (let j = 0; j <= nv; ++j)
        for (let i = 0; i <= nu; ++i) {
            fn(i / nu, j / nv, p);
            pos[k++] = p.x;
            pos[k++] = p.y;
            pos[k++] = p.z;
        }
    const idx: number[] = [];
    for (let j = 0; j < nv; ++j)
        for (let i = 0; i < nu; ++i) {
            const a = j * (nu + 1) + i;
            const b = a + 1;
            const c = a + nu + 1;
            const d = c + 1;
            idx.push(a, b, c, b, d, c);
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
}

/**
 * A pillowy solid from a side-view outline (points are [z, y]), extruded across X with rounded
 * edges; halfW(z, y) is the half width at each point of the outline.
 */
export function sideSolid(q: Q, pts: [number, number][], halfW: (z: number, y: number) => number, bevel = 6, curvy = true): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0]![0], pts[0]![1]);
    if (curvy) shape.splineThru([...pts.slice(1), pts[0]!].map(([z, y]) => new THREE.Vector2(z, y)));
    else {
        for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
        shape.closePath();
    }
    const bt = 0.7;
    const g = new THREE.ExtrudeGeometry(shape, {
        depth: 2,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: bt,
        bevelSize: bevel,
        bevelOffset: -bevel,
        bevelSegments: q.bevel,
        curveSegments: curvy ? q.curve : 1,
    });
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; ++i) {
        const sz = pos.getX(i);
        const sy = pos.getY(i);
        const u = (pos.getZ(i) - 1) / (1 + bt);
        // (x, y, z) <- (-u, y, x): a rotation, so the winding stays outward.
        pos.setXYZ(i, -u * halfW(sz, sy), sy, sz);
    }
    return smooth(g);
}

/** Lathe around the X axis (wheel parts); profile points are [radius, x]. */
export function latheX(q: Q, prof: [number, number][], segs = q.lathe * 2): THREE.BufferGeometry {
    const g = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x)), segs);
    g.rotateZ(-Math.PI / 2);
    return g;
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

let envTex: THREE.Texture | null = null;
/** A small painted sky/city/ground panorama: reflections for paint, chrome and the visor. */
function environment(): THREE.Texture | null {
    if (envTex) return envTex;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 128);
    sky.addColorStop(0, '#3f78c0');
    sky.addColorStop(0.7, '#a9cdef');
    sky.addColorStop(1, '#f2f6fa');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 128);
    const ground = g.createLinearGradient(0, 128, 0, 256);
    ground.addColorStop(0, '#77736a');
    ground.addColorStop(0.3, '#4a4744');
    ground.addColorStop(1, '#262422');
    g.fillStyle = ground;
    g.fillRect(0, 128, 512, 128);
    // A skyline along the horizon, a few clouds and the sun.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = 0; x < 512; ) {
        const w = 6 + rnd() * 22;
        const h = 4 + rnd() * rnd() * 34;
        g.fillStyle = `rgb(${60 + rnd() * 50},${66 + rnd() * 50},${80 + rnd() * 50})`;
        g.fillRect(x, 128 - h, w, h);
        x += w + rnd() * 4;
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 9; ++i) {
        g.beginPath();
        g.ellipse(rnd() * 512, 30 + rnd() * 60, 20 + rnd() * 40, 4 + rnd() * 6, 0, 0, Math.PI * 2);
        g.fill();
    }
    const sun = g.createRadialGradient(150, 40, 0, 150, 40, 30);
    sun.addColorStop(0, 'rgba(255,255,245,1)');
    sun.addColorStop(1, 'rgba(255,255,245,0)');
    g.fillStyle = sun;
    g.fillRect(100, 0, 100, 90);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    envTex = tex;
    return tex;
}

export function materials(): Record<Finish, THREE.Material> {
    const env = environment();
    return {
        gloss: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.8 }),
        chrome: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 1, envMap: env, envMapIntensity: 1.25 }),
        satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55, envMap: env, envMapIntensity: 0.6 }),
        matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0xa8c4d8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
        visor: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.85, envMap: env, envMapIntensity: 1.5, iridescence: 0.9, iridescenceIOR: 1.6, clearcoat: 1 }),
        light: new THREE.MeshBasicMaterial({ vertexColors: true }),
        blink: new THREE.MeshBasicMaterial({ vertexColors: true }),
        brake: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
}

/** Tail lights: `on` 0 (running lights, dimmed) .. 1 (braking, bright). */
export function setBrakeLights(mats: Record<Finish, THREE.Material>, on: number): void {
    (mats.brake as THREE.MeshBasicMaterial).color.setScalar(0.42 + on * 0.9);
}

/** Normalizes a part and adds color / skin attributes. */
function prep(p: Piece, skinned: boolean): THREE.BufferGeometry {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const k of Object.keys(g.attributes)) {
        if (k !== 'position' && k !== 'normal' && k !== 'skinIndex' && k !== 'skinWeight') g.deleteAttribute(k);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.clearGroups();
    g.morphAttributes = {};
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) p.color.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (skinned && !g.getAttribute('skinIndex')) {
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; ++i) {
            si[i * 4] = p.bone;
            sw[i * 4] = 1;
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    if (!skinned) {
        g.deleteAttribute('skinIndex');
        g.deleteAttribute('skinWeight');
    }
    if (g === p.geo) g = g.clone();
    return g;
}

/** Bounds of a skinned model in ground space, whatever its pose (rider and tricks included). */
const SKINNED_BOUNDS = new THREE.Sphere(V(0, 100, 0), 450);

export function bake(kit: Kit, mats: Record<Finish, THREE.Material>, skeleton: THREE.Skeleton | null): THREE.Mesh[] {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const p of kit.pieces) {
        const m = mats[p.finish];
        if (!byMat.has(m)) byMat.set(m, []);
        byMat.get(m)!.push(prep(p, !!skeleton));
    }
    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of byMat) {
        const geo = mergeGeometries(geos, false);
        if (!geo) throw new Error('modelKit: merge failed');
        geos.forEach((g) => g.dispose());
        let mesh: THREE.Mesh;
        if (skeleton) {
            const sm = new THREE.SkinnedMesh(geo, mat);
            sm.bindMode = THREE.DetachedBindMode;
            sm.bind(skeleton, new THREE.Matrix4());
            // The bones pose the parts in ground space, so the model never leaves this sphere: the
            // camera's and the shadow's frustums can drop it (rivals and ghosts out of view).
            sm.boundingSphere = SKINNED_BOUNDS.clone();
            mesh = sm;
        } else mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = !(mat as THREE.MeshStandardMaterial).transparent;
        mesh.receiveShadow = true;
        out.push(mesh);
    }
    for (const p of kit.pieces) p.geo.dispose();
    return out;
}

/** Triangles and draw calls of a model (the viewers show them). */
export function modelStats(roots: THREE.Object3D[]): { triangles: number; drawCalls: number } {
    let triangles = 0;
    let drawCalls = 0;
    for (const root of roots)
        root.traverse((m) => {
            if (!(m instanceof THREE.Mesh)) return;
            const g = m.geometry as THREE.BufferGeometry;
            triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
            drawCalls++;
        });
    return { triangles, drawCalls };
}

/** Frees a baked model: the meshes' geometry under `roots`, its materials and its skeleton. */
export function disposeModel(roots: THREE.Object3D[], mats: Record<Finish, THREE.Material>, skeleton: THREE.Skeleton): void {
    const geos = new Set<THREE.BufferGeometry>();
    for (const root of roots) root.traverse((o) => o instanceof THREE.Mesh && geos.add(o.geometry));
    geos.forEach((g) => g.dispose());
    new Set(Object.values(mats)).forEach((m) => m.dispose());
    skeleton.dispose();
}

/** Two-bone IK: joint position for a limb from root a toward target t, bending toward pole. */
export function ik(a: V3, t: V3, l1: number, l2: number, pole: V3, outMid: V3, outEnd: V3): void {
    const d = t.clone().sub(a);
    let dist = d.length();
    const dir = dist > 1e-6 ? d.divideScalar(dist) : V(0, -1, 0);
    dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
    p.normalize();
    outMid.copy(a).addScaledVector(dir, along).addScaledVector(p, h);
    outEnd.copy(a).addScaledVector(dir, dist);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
