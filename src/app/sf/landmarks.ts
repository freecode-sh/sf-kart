/**
 * San Francisco landmarks around the Golden Gate course:
 * Palace of Fine Arts, Fort Point, the bridge toll plaza, Alcatraz, the distant skyline
 * (Transamerica, Coit Tower, Salesforce Tower, downtown, the Bay Bridge) and bay life
 * (sailboats, a container ship, the Marina's moored boats; animated through group.userData.update(timeSec)).
 *
 *   buildLandmarks({ groundY }) → world-space THREE.Group
 *   viewerBuild()               → for sfviewer.html?model=landmarks[&only=palace]
 */

import * as THREE from 'three';
import { SCALE, worldXZ, worldY } from './geo';
import { ALCATRAZ, buildAlcatraz } from './landmarks/alcatraz';
import { buildBay } from './landmarks/bay';
import { buildFort, FORT } from './landmarks/fort';
import { type Batch, stats } from './landmarks/kit';
import { materials } from './landmarks/mats';
import { buildPalace, PALACE } from './landmarks/palace';
import { buildSkyline, SKY } from './landmarks/skyline';
import { buildToll, TOLL } from './landmarks/toll';

export type LandmarkOpts = {
    /** World-space terrain height at world (x, z). */
    groundY: (x: number, z: number) => number;
    /** Build only these landmarks (default: all). */
    only?: LandmarkName[];
    /** Flat test ground (the viewer): skip the land / water placement tests. */
    flat?: boolean;
};

export type LandmarkName = 'palace' | 'fort' | 'toll' | 'alcatraz' | 'skyline' | 'bay';
const LANDMARK_NAMES: LandmarkName[] = ['palace', 'fort', 'toll', 'alcatraz', 'skyline', 'bay'];

/** Local ground (meters relative to y0) for a landmark anchored at (e, n) with base world y0. */
const localGround =
    (groundY: LandmarkOpts['groundY'], e: number, n: number, y0: number) =>
    (lx: number, lz: number): number => {
        const [x, z] = worldXZ(e, n);
        return (groundY(x + lx * SCALE, z + lz * SCALE) - y0) / SCALE;
    };

function place(b: Batch, name: string, e: number, n: number, y: number, shadows: boolean, ry = 0): THREE.Group {
    const g = b.build(materials(), name, shadows);
    const [x, z] = worldXZ(e, n);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.scale.setScalar(SCALE);
    g.updateMatrixWorld(true);
    g.traverse((o) => (o.matrixAutoUpdate = false));
    return g;
}

export function buildLandmarks(opts: LandmarkOpts): THREE.Group {
    const { groundY } = opts;
    // The near landmarks cast and receive shadows; the distant ones don't.
    const shadows = true;
    const want = new Set(opts.only ?? LANDMARK_NAMES);
    const root = new THREE.Group();
    root.name = 'landmarks';
    const updates: ((t: number) => void)[] = [];

    if (want.has('palace')) {
        const [x, z] = worldXZ(PALACE.e, PALACE.n);
        const y0 = groundY(x, z);
        root.add(place(buildPalace(localGround(groundY, PALACE.e, PALACE.n, y0)), 'palace', PALACE.e, PALACE.n, y0, shadows));
    }
    if (want.has('fort')) {
        const [x, z] = worldXZ(FORT.e, FORT.n);
        const y0 = groundY(x, z);
        root.add(place(buildFort(localGround(groundY, FORT.e, FORT.n, y0)), 'fort', FORT.e, FORT.n, y0, shadows));
    }
    if (want.has('toll')) {
        const [x, z] = worldXZ(TOLL.e, TOLL.n);
        const y0 = groundY(x, z);
        root.add(place(buildToll(localGround(groundY, TOLL.e, TOLL.n, y0)), 'toll', TOLL.e, TOLL.n, y0, shadows));
    }
    if (want.has('alcatraz')) root.add(place(buildAlcatraz(), 'alcatraz', ALCATRAZ.e, ALCATRAZ.n, worldY(0), false));
    if (want.has('skyline')) {
        root.add(place(buildSkyline(groundY, !!opts.flat), 'skyline', SKY.e, SKY.n, worldY(0), false));
    }
    if (want.has('bay')) {
        const bay = buildBay(groundY, !!opts.flat);
        root.add(bay.object);
        updates.push(bay.update);
    }
    root.userData.update = (t: number) => {
        for (const u of updates) u(t);
    };
    return root;
}

// ------------------------------------------------------------------------------ viewer

type Cam = { pos: [number, number, number]; target: [number, number, number] };

/** Camera looking at (e, n, h m) from distance d (m) at bearing (deg, 0 = from north) and height hc (m). */
function camAt(e: number, n: number, h: number, d: number, bearing: number, hc: number): Cam {
    const b = (bearing * Math.PI) / 180;
    const [tx, tz] = worldXZ(e, n);
    const [cx, cz] = worldXZ(e + Math.sin(b) * d, n + Math.cos(b) * d);
    return { pos: [cx, worldY(hc), cz], target: [tx, worldY(h), tz] };
}

export function viewerBuild(): { object: THREE.Object3D; camera?: Cam } {
    const q = new URLSearchParams(location.search);
    const onlyQ = q.get('only');
    const only = onlyQ ? (onlyQ.split(',') as LandmarkName[]) : undefined;
    const flat = worldY(3);
    const root = new THREE.Group();
    const t0 = performance.now();
    const lm = buildLandmarks({ groundY: () => flat, only, flat: true });
    const ms = performance.now() - t0;
    root.add(lm);
    // Context: sea and a land plate at 3 m under the near landmarks.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d6b86, roughness: 0.35 }));
    sea.scale.set(3e6, 1, 3e6);
    sea.position.set(300000, worldY(0), 0);
    root.add(sea);
    const land = new THREE.MeshStandardMaterial({ color: 0x7d8c63, roughness: 1 });
    for (const [e, n, w, h] of [
        [2530, -840, 420, 400],
        [30, -15, 260, 240],
        [180, -390, 300, 300],
        [6800, -2300, 3200, 2600],
    ] as const) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w * SCALE, h * SCALE).rotateX(-Math.PI / 2), land);
        const [x, z] = worldXZ(e, n);
        p.position.set(x, flat - 3, z);
        root.add(p);
    }
    const s = stats(lm);
    const info = { buildMs: Math.round(ms), ...s };
    console.log('landmarks', JSON.stringify(info));
    (window as unknown as Record<string, unknown>).__lm = info;
    (window as unknown as Record<string, unknown>).__lmRoot = lm;
    const t1 = performance.now();
    const tick = () => {
        (lm.userData.update as (t: number) => void)((performance.now() - t1) / 1000);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (q.get('check')) void clearanceCheck(lm);

    const cams: Record<string, Cam> = {
        palace: camAt(2600, -844, 15, 260, 110, 25),
        fort: camAt(33, -5, 8, 150, 150, 20),
        toll: camAt(180, -390, 58, 170, 150, 70),
        alcatraz: camAt(ALCATRAZ.e, ALCATRAZ.n, 20, 1500, 225, 60),
        skyline: camAt(6800, -1900, 100, 5000, 290, 80),
        bay: camAt(2000, 700, 0, 2500, 200, 60),
    };
    const camera = (only && only.length === 1 && cams[only[0]!]) || camAt(2500, 0, 0, 7000, 250, 1500);
    return { object: root, camera };
}

/**
 * Dev check (viewer ?check=1): minimum horizontal distance (m) from every landmark vertex to the
 * course centerline (bridge decks excluded), per landmark. Result in window.__check.
 */
async function clearanceCheck(root: THREE.Object3D): Promise<void> {
    const r = await fetch('/tools/course/tracks/golden_gate.path.json');
    const j = (await r.json()) as { pts: [number, number][]; sections: { name: string; at: number }[] };
    const at = (n: string) => j.sections.find((s) => s.name === n)!.at;
    const skip0 = at('bridge_nb');
    const skip1 = at('plaza_sb');
    const cell = 50 * SCALE;
    const grid = new Map<string, number[]>();
    j.pts.forEach(([x, z], i) => {
        if (i >= skip0 && i < skip1) return;
        const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        const l = grid.get(k) ?? [];
        l.push(i);
        grid.set(k, l);
    });
    const out: Record<string, { min: number; at: [number, number, number] }> = {};
    const v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        const name = m.name.split(':')[0]!;
        const pos = m.geometry.getAttribute('position');
        const rec = (out[name] ??= { min: Infinity, at: [0, 0, 0] });
        for (let i = 0; i < pos.count; i += 1) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            const cx = Math.floor(v.x / cell);
            const cz = Math.floor(v.z / cell);
            for (let dx = -1; dx <= 1; ++dx)
                for (let dz = -1; dz <= 1; ++dz)
                    for (const k of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
                        const [px, pz] = j.pts[k]!;
                        const d = Math.hypot(px - v.x, pz - v.z) / SCALE;
                        if (d < rec.min) rec.min = d;
                        if (d === rec.min) rec.at = [Math.round(v.x / SCALE), Math.round((v.y - worldY(0)) / SCALE), Math.round(-v.z / SCALE)];
                    }
        }
    });
    console.log('clearance', JSON.stringify(out));
    (window as unknown as Record<string, unknown>).__check = out;
}
