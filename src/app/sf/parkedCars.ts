/**
 * Cars parked along the city's kerbs (the OSM streets in world.json, which are already cut out of
 * the course): a car every ~6 m on both sides of the residential streets, some gaps, none near the
 * ends of a street (intersections, where it meets the course), only near the course. A street
 * without parked cars reads as a model railway; with them it reads as San Francisco.
 *
 * One instanced mesh of a very low-poly car (36 triangles: body, glasshouse with a painted roof,
 * dark tyre / shadow block), paint colours per instance.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SCALE } from './geo';
import { LANDCOVER, type SfWorld } from './world';

const COLORS = [0xe9e9e6, 0x1c1d20, 0x9aa3ad, 0x5b6470, 0x7d1d1d, 0x1f3f73, 0xcfc9bb, 0x2f4f3a, 0x6b6f75, 0x3a3c40, 0xb7b9bb, 0x8a6d4f];

/** Land cover classes where cars park. */
const PARK_LC = new Set<number>([LANDCOVER.urban, LANDCOVER.paved]);

function box(w: number, h: number, l: number, y: number, z: number, side: number, top: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
    g.translate(0, y + h / 2, z);
    g.deleteAttribute('uv');
    // Face order: +x, -x, +y, -y, +z, -z (6 vertices each).
    const c: number[] = [];
    for (let f = 0; f < 6; ++f) for (let v = 0; v < 6; ++v) c.push(...(f === 2 ? [top, top, top] : [side, side, side]));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return g;
}

/** Local space: +Z forward, on y = 0; vertex colour multiplies the instance's paint. */
function carGeometry(): THREE.BufferGeometry {
    const m = SCALE;
    const g = mergeGeometries([box(1.8 * m, 0.55 * m, 4.4 * m, 0.3 * m, 0, 1, 1), box(1.55 * m, 0.55 * m, 2.3 * m, 0.85 * m, -0.2 * m, 0.13, 1), box(1.7 * m, 0.34 * m, 3.9 * m, 0, 0, 0.06, 0.06)])!;
    g.computeVertexNormals();
    return g;
}

/** Only within this distance of the course (world units): further out they'd be specks. */
const NEAR = 180 * SCALE;

export function buildParkedCars(world: SfWorld, centerline: { pos: [number, number, number] }[]): { group: THREE.Group; dispose(): void } {
    // The course's centerline in a coarse grid, for the distance test.
    const CELL = NEAR;
    const grid = new Map<string, [number, number][]>();
    for (const c of centerline) {
        const k = `${Math.floor(c.pos[0] / CELL)},${Math.floor(c.pos[2] / CELL)}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push([c.pos[0], c.pos[2]]);
    }
    const nearCourse = (x: number, z: number) => {
        const gx = Math.floor(x / CELL);
        const gz = Math.floor(z / CELL);
        for (let i = -1; i <= 1; ++i) for (let j = -1; j <= 1; ++j) for (const p of grid.get(`${gx + i},${gz + j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < NEAR) return true;
        return false;
    };
    const spots: { x: number; z: number; yaw: number }[] = [];
    let seed = 29;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const SPACING = 6.2 * SCALE;
    const END = 11 * SCALE;
    for (const st of world.json.streets) {
        if (st.kind !== 0 || st.w < 7 || st.w >= 13) continue;
        const off = (st.w / 2 - 1.2) * SCALE;
        const p = st.pts;
        let total = 0;
        for (let k = 0; k + 3 < p.length; k += 2) total += Math.hypot(p[k + 2]! - p[k]!, p[k + 3]! - p[k + 1]!);
        let along = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
            const ax = p[k]!;
            const az = p[k + 1]!;
            const len = Math.hypot(p[k + 2]! - ax, p[k + 3]! - az);
            const dx = (p[k + 2]! - ax) / (len || 1);
            const dz = (p[k + 3]! - az) / (len || 1);
            for (let s = SPACING / 2; s < len; s += SPACING) {
                const t = along + s;
                if (t < END || total - t < END) continue;
                for (const side of [1, -1]) {
                    if (rnd() < 0.3) continue;
                    const x = ax + dx * s - dz * off * side;
                    const z = az + dz * s + dx * off * side;
                    if (!PARK_LC.has(world.landcoverAt(x, z)) || !nearCourse(x, z)) continue;
                    if (world.groundY(x, z) < world.json.seaY + 0.5 * SCALE) continue;
                    spots.push({ x, z, yaw: Math.atan2(dx, dz) + (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.06 });
                }
            }
            along += len;
        }
    }
    const geo = carGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    spots.forEach((c, i) => {
        q.setFromAxisAngle(up, c.yaw);
        m.compose(v.set(c.x, world.groundY(c.x, c.z) + 10, c.z), q, one);
        mesh.setMatrixAt(i, m);
    });
    const col = new THREE.Color();
    spots.forEach((_, i) => mesh.setColorAt(i, col.setHex(COLORS[Math.floor(((i * 7919) % 1000) / 1000 * COLORS.length)]!)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.name = 'parkedCars';
    group.add(mesh);
    return {
        group,
        dispose() {
            geo.dispose();
            mat.dispose();
            mesh.dispose();
        },
    };
}
