/**
 * The Golden Gate Bridge, procedural and PBR: Art Deco towers with fluted legs / setbacks / portal
 * struts, catenary cables with bands and paired suspenders, stiffening truss + floor system, Fort
 * Point arch, concrete pylons, anchorages and piers, railings and lamps (merged per material +
 * instancing).
 *
 * buildGoldenGateBridge() returns the structure only, in world space (no drivable road surface, no
 * water). It stays out of the drivable volume: nothing at |lateral| < 2410 units from the axis
 * between the deck surface and 1800 units above it; railings at 2410..2560 (<= 220 tall), the
 * median barrier at |lateral| < 95 (200 tall); a concrete slab 30..130 units under the road.
 */

import * as THREE from 'three';
import { SEA_Y } from './geo';
import { stations } from './bridgeParts/common';
import { type CenterlinePoint, LEN, deckY, onDeck, useCourseCenterline } from './bridgeParts/frame';
import { buildConstruction } from './bridgeParts/construction';
import { loadLidarOverlay } from './bridgeParts/lidarOverlay';
import { type CourseFeature, boostKickers, cutGaps, useCourseFeatures } from './bridgeParts/features';
import { buildBridgeModel } from './bridgeParts/real';
import { stats } from './landmarks/kit';
import { DATA_BASE } from '../paths';

export type BridgeOptions = {
    /**
     * The course's baked centerline (course_meta.json `centerline`). When given, the deck-hugging
     * parts (slab, railings, median, sidewalks, trusses, suspenders) follow the course's actual
     * road heights per carriageway and stop where the carriageways diverge at the ends; otherwise
     * they follow geo.ts deckHeightM (which differs from the current bake by up to ~150 units).
     */
    centerline?: readonly CenterlinePoint[];
    /**
     * The course's features (course_meta.json `features`). A `gap` on the bridge cuts a real
     * opening in that carriageway's deck (slab, stringers, floor beams, curb, sidewalk, railings)
     * dressed as a construction zone; a `boostRamp` gets a support bent under its lip.
     */
    features?: readonly CourseFeature[];
};

/**
 * The returned group has `userData.update(timeSeconds)` (call it every frame: it blinks the
 * construction zone's warning lights; a no-op without a gap).
 */
export function buildGoldenGateBridge(opts: BridgeOptions = {}): THREE.Group {
    useCourseCenterline(opts.centerline);
    useCourseFeatures(opts.features);
    try {
        const g = buildBridgeModel();
        const work = buildConstruction();
        if (work) g.add(work);
        g.userData.update = (t: number) => (work?.userData.update as ((t: number) => void) | undefined)?.(t);
        return g;
    } finally {
        useCourseCenterline(null);
        useCourseFeatures(null);
    }
}

/** Placeholder road surfaces (two carriageways) for the viewer. */
function placeholderRoad(): THREE.Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    const strip = (ss: number[], l0: number, l1: number, h: (s: number) => number) => {
        const base = pos.length / 3;
        for (const s of ss) {
            const a = onDeck(s, l0, h(s));
            const b = onDeck(s, l1, h(s));
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        for (let i = 0; i + 1 < ss.length; ++i) {
            const a = base + i * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    };
    for (const [l0, l1] of [
        [-2410, -110],
        [110, 2410],
    ] as const)
        for (const [a, e] of cutGaps([[-150 * 60, LEN + 150 * 60]], l0 + l1)) strip(stations(a, e, 600), l0, l1, () => 0);
    // The kicker ramps (the game draws its own): a quadratic ramp surface up to the lip.
    for (const k of boostKickers()) {
        const ss = stations(Math.min(k.s0, k.lipS), Math.max(k.s0, k.lipS), 100);
        strip(ss, k.lc - k.width / 2, k.lc + k.width / 2, (s) => k.lipH * ((s - k.s0) / (k.lipS - k.s0)) ** 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#46484d', roughness: 0.9, side: THREE.DoubleSide }));
    m.name = 'placeholder-road';
    m.receiveShadow = true;
    return m;
}

export async function viewerBuild(): Promise<{ object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } }> {
    const root = new THREE.Group();
    let centerline: CenterlinePoint[] | undefined;
    let features: CourseFeature[] | undefined;
    try {
        const meta = (await (await fetch(`${DATA_BASE}/courses/golden_gate/course_meta.json`)).json()) as { centerline: CenterlinePoint[]; features?: CourseFeature[] };
        centerline = meta.centerline;
        features = meta.features;
    } catch {
        centerline = undefined;
    }
    const bridge = buildGoldenGateBridge({ centerline, features });
    // The viewer has no per-frame hook: blink the lights from a timer.
    const t0 = performance.now();
    setInterval(() => (bridge.userData.update as (t: number) => void)((performance.now() - t0) / 1000), 100);
    root.add(bridge);
    useCourseCenterline(centerline);
    useCourseFeatures(features);
    root.add(placeholderRoad());
    useCourseCenterline(null);
    useCourseFeatures(null);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000), new THREE.MeshStandardMaterial({ color: '#2f5f7c', roughness: 0.35, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(-6000, SEA_Y, -60000);
    water.name = 'placeholder-water';
    root.add(water);
    // Debug: the lidar points over the model (sfviewer.html?model=bridge&lidar=1), if baked.
    if (new URLSearchParams(location.search).get('lidar') === '1') {
        const pts = await loadLidarOverlay();
        if (pts) root.add(pts);
    }
    // Stats for the console / screenshot tool.
    const { meshes: draws, tris } = stats(bridge);
    (globalThis as Record<string, unknown>).__bridgeStats = { draws, tris };
    console.log(`bridge: ${draws} draw calls, ${tris} triangles`);
    const mid = onDeck(LEN / 2, 0);
    return {
        object: root,
        camera: { pos: [34000, 8000, 24000], target: [mid.x, deckY(LEN / 2) + 3000, mid.z] },
    };
}
