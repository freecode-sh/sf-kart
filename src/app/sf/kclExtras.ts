/**
 * The parts of the course's collision (KCL) that the smooth road ribbon doesn't draw: boost ramps and
 * trick kickers, half-pipes (dressed in sections/halfpipe.ts), traffic islands and ramp lips.
 * Drawn straight from the KCL triangles so they match the physics exactly, in the game-piece kit
 * (padMaterial.ts, mapped onto each ramp from its feature's extent): boost ramps as Boost Lanes
 * (green, white chevrons), trick kickers as yellow / black skate kickers with a white lip line,
 * islands and lips in yellow / black hazard stripes. Ramps that span a carriageway get solid dark
 * side panels down to the road along the barrier lines (the KCL has only the barrier there), so
 * they read as solid wedges rather than sheets floating over the barriers.
 */

import * as THREE from 'three';
import { readKclTriangles } from '../kclMesh';
import type { Station } from './road';
import { HalfpipeBuilder } from './sections/halfpipe';
import { PAD_LOOKS, padMaterial } from './padMaterial';

export interface ExtraMeshes {
    group: THREE.Group;
    dispose(): void;
}

type V3 = [number, number, number];
type Kind = 'boost' | 'trick' | 'wall' | 'side';

function stripeTexture(a: string, b: string): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = a;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = b;
    for (let k = -64; k < 64; k += 32) {
        g.beginPath();
        g.moveTo(k, 64);
        g.lineTo(k + 16, 64);
        g.lineTo(k + 80, 0);
        g.lineTo(k + 64, 0);
        g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

/**
 * `bare(s)`: course stretches whose gap faces (the vertical collision faces hanging under a jump's
 * lip and landing) are left undrawn because the scenery shows its own cut structure there (the
 * Golden Gate Bridge's deck gap).
 */
export function buildKclExtras(
    kcl: Uint8Array,
    meta: { centerline: Station[]; features?: { type: string; s?: number[]; lat?: number[]; height?: number; ease?: number }[] },
    bare: (s: number) => boolean = () => false,
): ExtraMeshes {
    const tris = readKclTriangles(kcl);
    const cl = meta.centerline;
    // Special stretches (S ranges) where walls inside the road are drawn: islands, ramps, gaps.
    const special = (meta.features ?? []).filter((f) => ['island', 'ramp', 'boostRamp', 'gap', 'halfpipe'].includes(f.type) && f.s).map((f) => [f.s![0]! - 400, f.s![1]! + 400] as [number, number]);
    const gapFaces = (meta.features ?? []).filter((f) => f.type === 'gap' && f.s && bare((f.s[0]! + f.s[1]!) / 2)).map((f) => [f.s![0]! - 400, f.s![1]! + 400] as [number, number]);
    // Station lookup grid for "which S / how far from the centerline".
    const cell = 4000;
    const grid = new Map<string, number[]>();
    cl.forEach((c, i) => {
        const k = `${Math.floor(c.pos[0] / cell)},${Math.floor(c.pos[2] / cell)}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
    });
    // Nearest in 3D (`d` is the horizontal distance): the bridge deck runs over the Fort Point loop,
    // so the kickers above it mustn't pick the loop's stations 60 m below.
    const nearest = (x: number, y: number, z: number): { st: Station; i: number; d: number } | null => {
        let best = -1;
        let bd = Infinity;
        const gx = Math.floor(x / cell);
        const gz = Math.floor(z / cell);
        for (let dx = -1; dx <= 1; ++dx)
            for (let dz = -1; dz <= 1; ++dz)
                for (const i of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
                    const c = cl[i]!;
                    const d = (c.pos[0] - x) ** 2 + (c.pos[1] - y) ** 2 + (c.pos[2] - z) ** 2;
                    if (d < bd) {
                        bd = d;
                        best = i;
                    }
                }
        if (best < 0) return null;
        const st = cl[best]!;
        return { st, i: best, d: Math.hypot(st.pos[0] - x, st.pos[2] - z) };
    };
    // Course coordinates of a point: S along the centerline and the lateral offset (positive to the
    // left, as in road.ts), projected onto the centerline segment beside it (the stations' `right`
    // vectors are a few degrees off the polyline, enough to shear a ramp's chevrons).
    const project = (x: number, y: number, z: number): { s: number; lat: number } | null => {
        const n = nearest(x, y, z);
        if (!n) return null;
        const A = n.st;
        const next = cl[n.i + 1];
        const fwd = next && (next.pos[0] - A.pos[0]) * (x - A.pos[0]) + (next.pos[2] - A.pos[2]) * (z - A.pos[2]) > 0;
        const B = fwd ? next : cl[n.i - 1];
        if (!B) {
            // Forward is the right vector turned a quarter (the engine's frame).
            const ds = (x - A.pos[0]) * A.right[2] - (z - A.pos[2]) * A.right[0];
            return { s: A.s + ds, lat: -((x - A.pos[0]) * A.right[0] + (z - A.pos[2]) * A.right[2]) };
        }
        const ex = B.pos[0] - A.pos[0];
        const ez = B.pos[2] - A.pos[2];
        const l = Math.hypot(ex, ez) || 1;
        const t = ((x - A.pos[0]) * ex + (z - A.pos[2]) * ez) / (l * l);
        return { s: A.s + (B.s - A.s) * t, lat: (((x - A.pos[0]) * ez - (z - A.pos[2]) * ex) / l) * (fwd ? 1 : -1) };
    };
    // Boost ramps and trick kickers get pad coordinates from their feature's extent.
    const pads = (meta.features ?? []).filter((f) => (f.type === 'boostRamp' || f.type === 'ramp') && f.s && f.lat);
    const padOf = (S: number, boost: boolean) => pads.find((f) => (f.type === 'boostRamp') === boost && S > f.s![0]! - 300 && S < f.s![1]! + 300);
    const buckets: Record<Kind, number[]> = { boost: [], trick: [], wall: [], side: [] };
    const uvs: Record<Kind, number[]> = { boost: [], trick: [], wall: [], side: [] };
    const sizes: Record<Kind, number[]> = { boost: [], trick: [], wall: [], side: [] };
    // Ramp surface points along each ramp's left / right edge (for the side panels).
    const rims = new Map<(typeof pads)[number], { l: [number, V3][]; r: [number, V3][] }>();
    const pipes = new HalfpipeBuilder(
        cl,
        (meta.features ?? []).filter((f) => f.type === 'halfpipe' && f.s).map((f) => ({ s: [f.s![0]!, f.s![1]!], height: f.height, ease: f.ease })),
    );
    for (let t = 0; t < tris.attributes.length; ++t) {
        const attr = tris.attributes[t]!;
        const type = attr & 0x1f;
        let kind: Kind | null = null;
        if (type === 0x07) kind = 'boost';
        else if (attr & 0x2000) kind = 'trick';
        else if (type === 0x13) {
            pipes.addTri(tris.positions, t);
            continue;
        }
        else if (type === 0x0c) {
            const cx = (tris.positions[t * 9]! + tris.positions[t * 9 + 3]! + tris.positions[t * 9 + 6]!) / 3;
            const cy = (tris.positions[t * 9 + 1]! + tris.positions[t * 9 + 4]! + tris.positions[t * 9 + 7]!) / 3;
            const cz = (tris.positions[t * 9 + 2]! + tris.positions[t * 9 + 5]! + tris.positions[t * 9 + 8]!) / 3;
            const n = nearest(cx, cy, cz);
            if (n && special.some(([a, b]) => n.st.s > a && n.st.s < b) && !gapFaces.some(([a, b]) => n.st.s > a && n.st.s < b)) {
                // Inside the road (islands, ramp lips, gap faces), not the outer barriers.
                const half = Math.max(n.st.edges.wallL, -n.st.edges.wallR);
                if (n.d < half - 120) kind = 'wall';
            }
        }
        if (!kind) continue;
        // The ramp this triangle belongs to (by its centre), for the pad mapping.
        let pad: (typeof pads)[number] | undefined;
        if (kind !== 'wall') {
            const cx = (tris.positions[t * 9]! + tris.positions[t * 9 + 3]! + tris.positions[t * 9 + 6]!) / 3;
            const cy = (tris.positions[t * 9 + 1]! + tris.positions[t * 9 + 4]! + tris.positions[t * 9 + 7]!) / 3;
            const cz = (tris.positions[t * 9 + 2]! + tris.positions[t * 9 + 5]! + tris.positions[t * 9 + 8]!) / 3;
            const c = project(cx, cy, cz);
            pad = c ? padOf(c.s, kind === 'boost') : undefined;
        }
        for (let v = 0; v < 3; ++v) {
            const x = tris.positions[t * 9 + v * 3]!;
            const y = tris.positions[t * 9 + v * 3 + 1]!;
            const z = tris.positions[t * 9 + v * 3 + 2]!;
            buckets[kind].push(x, y + 4, z);
            const c = pad ? project(x, y, z) : null;
            if (pad && c) {
                // u from the right edge, v along the ramp (see padMaterial.ts).
                const [s0, s1] = pad.s as [number, number];
                const [l0, l1] = pad.lat as [number, number];
                uvs[kind].push((c.lat - l0) / (l1 - l0), (c.s - s0) / (s1 - s0));
                sizes[kind].push(l1 - l0, s1 - s0);
                let rim = rims.get(pad);
                if (!rim) rims.set(pad, (rim = { l: [], r: [] }));
                if (Math.abs(c.lat - l1) < 25) rim.l.push([c.s, [x, y, z]]);
                if (Math.abs(c.lat - l0) < 25) rim.r.push([c.s, [x, y, z]]);
            } else {
                uvs[kind].push((x + z) / 500, y / 500);
                sizes[kind].push(1e5, 1e5);
            }
        }
    }
    // Side panels: from each ramp edge that runs along a wall line down to the road (a little below).
    const stationAt = (S: number): Station => {
        let lo = 0;
        let hi = cl.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cl[mid]!.s <= S) lo = mid;
            else hi = mid - 1;
        }
        return cl[lo]!;
    };
    for (const rim of rims.values())
        for (const [side, pts] of [
            [1, rim.l],
            [-1, rim.r],
        ] as const) {
            pts.sort((a, b) => a[0] - b[0]);
            const run = pts.filter((p, i) => i === 0 || p[0] - pts[i - 1]![0] > 5);
            for (let i = 0; i + 1 < run.length; ++i) {
                const [sa, a] = run[i]!;
                const [sb, b] = run[i + 1]!;
                const st = stationAt((sa + sb) / 2);
                const wall = side === 1 ? st.edges.wallL : st.edges.wallR;
                const c = project(a[0], a[1], a[2]);
                if (!c || Math.abs(c.lat - wall) > 40 || !st.walls[side === 1 ? 0 : 1]) continue;
                const ya = stationAt(sa).pos[1] - 20;
                const yb = stationAt(sb).pos[1] - 20;
                const quad: V3[] = [
                    [a[0], a[1] + 4, a[2]],
                    [b[0], b[1] + 4, b[2]],
                    [b[0], yb, b[2]],
                    [a[0], a[1] + 4, a[2]],
                    [b[0], yb, b[2]],
                    [a[0], ya, a[2]],
                ];
                const ss = [sa, sb, sb, sa, sb, sa];
                quad.forEach((p, k) => {
                    buckets.side.push(...p);
                    uvs.side.push(ss[k]! / 400, p[1] / 400);
                    sizes.side.push(1e5, 1e5);
                });
            }
        }
    const group = new THREE.Group();
    group.name = 'kclExtras';
    const mats: Record<Kind, THREE.Material> = {
        boost: padMaterial(PAD_LOOKS.boostRamp, { side: THREE.DoubleSide }),
        trick: padMaterial(PAD_LOOKS.trick, { side: THREE.DoubleSide }),
        wall: new THREE.MeshStandardMaterial({ map: stripeTexture('#ffc400', '#16161a'), roughness: 0.7, side: THREE.DoubleSide }),
        side: new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    };
    const meshes: THREE.Mesh[] = [];
    for (const kind of Object.keys(buckets) as Kind[]) {
        if (!buckets[kind].length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(buckets[kind], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs[kind], 2));
        g.setAttribute('padSize', new THREE.Float32BufferAttribute(sizes[kind], 2));
        g.computeVertexNormals();
        const m = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(g, mats[kind]);
        m.receiveShadow = true;
        m.castShadow = true;
        meshes.push(m);
        group.add(m);
    }
    const pipeMeshes = pipes.build();
    group.add(pipeMeshes.group);
    return {
        group,
        dispose() {
            pipeMeshes.dispose();
            for (const mesh of meshes) mesh.geometry.dispose();
            for (const m of Object.values(mats)) {
                (m as THREE.MeshStandardMaterial).map?.dispose();
                m.dispose();
            }
        },
    };
}
