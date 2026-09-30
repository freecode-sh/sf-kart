/**
 * Spatial chunks for big merged meshes. A mesh merged over kilometres has one bounding sphere round
 * all of it, so the camera (and the shadow camera, whose box is only ~100 m across) draws the whole
 * thing whenever any part is in view. Split by the square cell each triangle's centre falls in, the
 * frustums drop the pieces out of view. The pieces keep every attribute; the picture is the same.
 */

import * as THREE from 'three';

/** `geo` split into one geometry per `cell` x `cell` square (world XZ, by triangle centre). */
export function splitByCell(geo: THREE.BufferGeometry, cell: number): THREE.BufferGeometry[] {
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const nTri = (index ? index.count : pos.count) / 3;
    const vert = (k: number) => (index ? index.getX(k) : k);
    const buckets = new Map<string, number[]>();
    for (let t = 0; t < nTri; ++t) {
        let x = 0;
        let z = 0;
        for (let c = 0; c < 3; ++c) {
            const v = vert(t * 3 + c);
            x += pos.getX(v);
            z += pos.getZ(v);
        }
        const key = `${Math.floor(x / 3 / cell)},${Math.floor(z / 3 / cell)}`;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(t);
    }
    if (buckets.size <= 1) return [geo];
    const remap = new Int32Array(pos.count).fill(-1);
    const out: THREE.BufferGeometry[] = [];
    for (const tris of buckets.values()) {
        const used: number[] = [];
        const idx = new Uint32Array(tris.length * 3);
        tris.forEach((t, i) => {
            for (let c = 0; c < 3; ++c) {
                const v = vert(t * 3 + c);
                if (remap[v]! < 0) {
                    remap[v] = used.length;
                    used.push(v);
                }
                idx[i * 3 + c] = remap[v]!;
            }
        });
        const g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geo.attributes) as [string, THREE.BufferAttribute][]) {
            const n = attr.itemSize;
            const src = attr.array;
            const arr = new (src.constructor as new (len: number) => typeof src)(used.length * n);
            used.forEach((v, i) => {
                for (let k = 0; k < n; ++k) arr[i * n + k] = src[v * n + k]!;
            });
            g.setAttribute(name, new THREE.BufferAttribute(arr, n, attr.normalized));
        }
        g.setIndex(new THREE.BufferAttribute(used.length > 65535 ? idx : Uint16Array.from(idx), 1));
        g.computeBoundingBox();
        g.computeBoundingSphere();
        for (const v of used) remap[v] = -1;
        out.push(g);
    }
    geo.dispose();
    return out;
}

/** Meshes like `mesh` (material, shadows, name) over its geometry's cells; `mesh` is left empty. */
export function chunkMesh(mesh: THREE.Mesh, cell: number): THREE.Mesh[] {
    const pieces = splitByCell(mesh.geometry, cell);
    if (pieces.length === 1) return [mesh];
    return pieces.map((g) => {
        const m = new THREE.Mesh(g, mesh.material);
        m.name = mesh.name;
        m.castShadow = mesh.castShadow;
        m.receiveShadow = mesh.receiveShadow;
        m.renderOrder = mesh.renderOrder;
        return m;
    });
}
