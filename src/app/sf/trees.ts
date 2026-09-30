/**
 * Trees (baked positions, heights and crowns, tools/sf/treesBake.ts): Monterey cypress, eucalyptus,
 * pine, broadleaf street trees and palms, instanced. Trees far from the course (type + 8) never get
 * the most detailed version; trees out of view aren't drawn (see buildTrees). Leaf-card trees
 * (treeCards.ts) at each tree's lidar height and crown, coloured like the crowns in the aerial photo.
 * Low vegetation (brush, low green, dune grass) with the understory shrubs.
 */

import * as THREE from 'three';
import type { TreeFootprint } from './groundMaps';
import { SUN_DIR } from './sky';
import { ASPECT, CROWN, SHRUB, shrubTemplate, treeAtlas, treeMaterial, treeTemplate } from './treeCards';
import type { WorldJson } from './world';

/** Height per type (units, at 100 %). */
const TREE_H = [950, 1700, 1250, 650, 1100];
const TYPES = TREE_H.length;
/** Added to the type of trees far from the course (they only ever get the low-detail canopy). */
const FAR = 8;
/** Trees near the course get the detailed version within this distance of the camera (~400 m). */
const DETAIL_DIST = 24_000;
/** Beyond this distance trees are a few big cards (~1.6 km). */
const DISTANT = 96_000;
/** Trees this close to the camera cast shadows (the shadow map covers ~50 m around the kart). */
const SHADOW_DIST = 4_500;
/** Understory shrubs are drawn within this distance (~250 m). */
const SHRUB_DIST = 15_000;
/** Room for this many shadow-casting trees (per type and variant) and shrubs in view. */
const CAST_MAX = 400;
const SHRUB_MAX = 8000;
/** Understory colour (sRGB albedo). */
const SHRUB_COLOR = 0x3b4a2a;
/** Baked low vegetation's colour per kind (brush, low green on the slopes, dune grass). */
const SHRUB_KIND_COLOR = [SHRUB_COLOR, 0x4a5a2c, 0x8a875a];
/** Trees this close to the camera are always drawn (whatever the view direction). */
const NEAR_ALL = 6_000;
/** Culling cone: the view's half-diagonal plus this margin, so a refresh every few frames keeps up. */
const CONE_MARGIN = THREE.MathUtils.degToRad(22);
/** Refresh when the camera has moved / turned this much since the last one (units / radians). */
const MOVE = 600;
const TURN = THREE.MathUtils.degToRad(4);

export interface TreeMeshes {
    group: THREE.Group;
    /** Picks the trees in view and their detail for the camera (only when it has moved or turned). */
    update(camera: THREE.Camera): void;
    dispose(): void;
}

/** One level of detail of one tree type: its mesh, with room for every tree of the type. */
interface Lod {
    mesh: THREE.InstancedMesh;
    count: number;
}

/** Crown radius (m): the lidar's, kept near the species' shape (the templates stretch with it). */
function crownOf(type: number, h: number, r: number | undefined): number {
    const A = ASPECT[type]!;
    return Math.max(h / (A * 1.6), Math.min(h / (A / 1.6), r ?? h / A));
}

/** Each tree's crown radius and height (m), for the ground under it (groundMaps.ts). */
export function treeFootprints(json: WorldJson, crownAt: (x: number, z: number) => number | undefined): TreeFootprint[] {
    const tr = json.trees;
    const out: TreeFootprint[] = [];
    for (let k = 0; k + 4 < tr.length; k += 5) {
        const type = tr[k + 4]! % FAR;
        const h = ((tr[k + 3]! / 100) * TREE_H[type]!) / json.scale;
        out.push({ e: tr[k]! / json.scale, n: -tr[k + 2]! / json.scale, h, r: crownOf(type, h, crownAt(tr[k]!, tr[k + 2]!)) });
    }
    return out;
}

/**
 * The trees are re-picked on the CPU as the camera moves: those outside a (widened) view cone are
 * dropped and the rest sorted into levels of detail by distance, written compactly into the instance
 * buffers. Instanced meshes aren't culled per instance, so without this every one of the ~15k trees
 * would be drawn every frame, at full detail along the whole course. The levels: trees right by the
 * camera (casting shadows), course-side trees near it (two variants per species), far, and distant
 * ones; and shrubs near the camera: under the trees in woods and scrub (`ground`), and the baked low
 * vegetation (tools/sf/shrubsBake.ts).
 */
export function buildTrees(
    json: WorldJson,
    crownAt: (x: number, z: number) => number | undefined,
    photoAt?: (e: number, n: number, r: number, out: THREE.Color) => THREE.Color | null,
    ground?: { y(x: number, z: number): number; understory(x: number, z: number): boolean },
): TreeMeshes {
    const trees = json.trees;
    const N = trees.length / 5;
    const group = new THREE.Group();
    group.name = 'trees';
    // Per tree: its instance matrix and crown colour, type, whether it's by the course, a variant,
    // and position / size for the culling.
    const matrices = new Float32Array(N * 16);
    const colors = new Float32Array(N * 3);
    const types = new Uint8Array(N);
    const byCourse = new Uint8Array(N);
    const variant = new Uint8Array(N);
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const count = new Array<number>(TYPES).fill(0);
    const countNear = new Array<number>(TYPES).fill(0);
    const atlas = treeAtlas();
    {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const col = new THREE.Color();
        const photo = new THREE.Color();
        const want = new THREE.Color();
        const frac = (v: number, m: number) => (((v % m) + m) % m) / m;
        for (let i = 0; i < N; ++i) {
            const k = i * 5;
            const x = trees[k]!;
            const y = trees[k + 1]!;
            const z = trees[k + 2]!;
            const code = trees[k + 4]!;
            const type = code % FAR;
            const s = (trees[k + 3]! / 100) * TREE_H[type]!;
            const h1 = frac(x * 13 + z * 7, 1000);
            const h2 = frac(x * 7 + z * 31, 997);
            const v = frac(x * 31 + z * 17, 100);
            // A unit template scaled to the tree's crown and height, leaning a little.
            const r = crownOf(type, s / json.scale, crownAt(x, z)) * json.scale;
            e.set((h2 - 0.5) * 0.08, h1 * Math.PI * 2, (h1 - 0.5) * 0.08);
            q.setFromEuler(e);
            m.compose(new THREE.Vector3(x, y - 30, z), q, new THREE.Vector3(r * (0.92 + h2 * 0.16), s, r * (0.92 + (1 - h2) * 0.16)));
            m.toArray(matrices, i * 16);
            // The crown colour: the species', blended with the photo's where the photo shows foliage
            // there; a tint over the atlas's leaves.
            want.setHex(CROWN[type]!).offsetHSL((v - 0.5) * 0.03, (h2 - 0.5) * 0.12, (h1 - 0.5) * 0.08);
            if (photoAt?.(x / json.scale, -z / json.scale, r / json.scale / 2, photo)) {
                const leafy = photo.g >= photo.r * 0.95 && photo.g >= photo.b * 0.95 && photo.g > 0.012;
                if (leafy) want.lerp(photo, 0.35);
            }
            const lm = atlas.leafMean[type]!;
            const tint = (c: number, l: number) => Math.min(1.8, Math.max(0.35, c / Math.max(0.005, l)));
            col.setRGB(tint(want.r, lm.r), tint(want.g, lm.g), tint(want.b, lm.b));
            col.toArray(colors, i * 3);
            types[i] = type;
            byCourse[i] = code < FAR ? 1 : 0;
            variant[i] = h2 < 0.5 ? 0 : 1;
            pos.set([x, y + s * 0.6, z], i * 3);
            size[i] = Math.max(s * 0.6, r);
            ++count[type]!;
            if (code < FAR) ++countNear[type]!;
        }
    }

    // Understory: a few shrubs under each tree in woods and scrub, clear of the trunk; and the baked
    // low vegetation.
    const shrubs: number[] = [];
    if (ground) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const col = new THREE.Color();
        const lm = atlas.leafMean[SHRUB]!;
        for (let i = 0; i < N; ++i) {
            const k = i * 5;
            const x = trees[k]!;
            const z = trees[k + 2]!;
            if (types[i] === 4 || !ground.understory(x, z)) continue;
            const r = Math.min(size[i]!, 6 * json.scale);
            const n = 3 + (((x * 7 + z * 3) % 3) + 3) % 3;
            for (let j = 0; j < n; ++j) {
                const h = (a: number) => (((Math.sin(x * 0.0123 + z * 0.0071 + j * 12.9898 + a * 78.233) * 43758.5453) % 1) + 1) % 1;
                const ang = h(1) * Math.PI * 2;
                const d = r * (0.25 + 0.75 * h(2));
                const sx = x + Math.cos(ang) * d;
                const sz = z + Math.sin(ang) * d;
                const rad = (0.8 + 1.6 * h(3)) * json.scale;
                q.setFromAxisAngle(up, h(4) * Math.PI * 2);
                m.compose(new THREE.Vector3(sx, ground.y(sx, sz) - 15, sz), q, new THREE.Vector3(rad, rad * (0.6 + 0.5 * h(5)), rad));
                col.setHex(SHRUB_COLOR).offsetHSL((h(6) - 0.5) * 0.05, (h(7) - 0.5) * 0.15, (h(8) - 0.5) * 0.08);
                shrubs.push(...m.elements, col.r / lm.r, col.g / lm.g, col.b / lm.b);
            }
        }
        // Low vegetation away from the trees (tools/sf/shrubsBake.ts): the lidar's brush, low green on
        // the slopes, the dunes' grass; the brush takes a little of the photo's colour.
        const sh = json.shrubs ?? [];
        const photo = new THREE.Color();
        for (let k = 0; k + 2 < sh.length; k += 3) {
            const x = sh[k]!;
            const z = sh[k + 1]!;
            const kind = sh[k + 2]! % 4;
            const size = (sh[k + 2]! - kind) / 4;
            const rad = ((size % 32) / 10) * json.scale;
            const ht = (Math.floor(size / 32) / 10) * json.scale;
            const h = (a: number) => (((Math.sin(x * 0.0123 + z * 0.0071 + a * 78.233) * 43758.5453) % 1) + 1) % 1;
            q.setFromAxisAngle(up, h(1) * Math.PI * 2);
            m.compose(new THREE.Vector3(x, ground.y(x, z) - 15, z), q, new THREE.Vector3(rad * (0.9 + 0.2 * h(2)), ht, rad * (0.9 + 0.2 * h(3))));
            col.setHex(SHRUB_KIND_COLOR[kind]!).offsetHSL((h(6) - 0.5) * 0.05, (h(7) - 0.5) * 0.15, (h(8) - 0.5) * 0.08);
            if (kind === 0 && photoAt?.(x / json.scale, -z / json.scale, rad / json.scale, photo) && photo.g >= photo.r * 0.95 && photo.g >= photo.b) col.lerp(photo, 0.25);
            shrubs.push(...m.elements, col.r / lm.r, col.g / lm.g, col.b / lm.b);
        }
    }
    const NS = shrubs.length / 19;

    const disposables: { dispose(): void }[] = [atlas.texture];
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        mesh.count = 0;
        // The instances change as the camera moves: no bounds to cull by.
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.visible = false;
        group.add(mesh);
        disposables.push(mesh);
        return mesh;
    };
    // Leaf-card templates, all in one material.
    const time = { value: 0 };
    const mat = treeMaterial(atlas.texture, SUN_DIR, time);
    disposables.push(mat);
    const levels: { cast: Lod[][]; near: Lod[][]; far: Lod[]; distant: Lod[] } = { cast: [], near: [], far: [], distant: [] };
    for (let type = 0; type < TYPES; ++type) {
        const near = [0, 1].map((v) => treeTemplate(type, 0, v));
        const far = treeTemplate(type, 1);
        const distant = treeTemplate(type, 2);
        disposables.push(...near, far, distant);
        levels.cast.push(
            near.map((g) => {
                const mesh = inst(g, mat, Math.min(count[type]!, CAST_MAX));
                mesh.castShadow = mesh.receiveShadow = true;
                return { mesh, count: 0 };
            }),
        );
        levels.near.push(
            near.map((g) => {
                const mesh = inst(g, mat, Math.max(1, countNear[type]!));
                mesh.receiveShadow = true;
                return { mesh, count: 0 };
            }),
        );
        levels.far.push({ mesh: inst(far, mat, count[type]!), count: 0 });
        levels.distant.push({ mesh: inst(distant, mat, count[type]!), count: 0 });
    }
    const shrubGeo = shrubTemplate();
    disposables.push(shrubGeo);
    const understory: Lod = { mesh: inst(shrubGeo, mat, Math.max(1, Math.min(NS, SHRUB_MAX))), count: 0 };
    understory.mesh.receiveShadow = true;
    const shrubMats = new Float32Array(NS * 16);
    const shrubCols = new Float32Array(NS * 3);
    for (let i = 0; i < NS; ++i) {
        shrubMats.set(shrubs.slice(i * 19, i * 19 + 16), i * 16);
        shrubCols.set(shrubs.slice(i * 19 + 16, i * 19 + 19), i * 3);
    }
    const lods: Lod[] = [...levels.cast.flat(), ...levels.near.flat(), ...levels.far, ...levels.distant, understory];

    const lastPos = new THREE.Vector3(Infinity, 0, 0);
    const lastDir = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const add = (l: Lod, i: number, mats: Float32Array, col: Float32Array) => {
        if (l.count >= l.mesh.instanceMatrix.count) return;
        const j = l.count++;
        const m = l.mesh.instanceMatrix.array;
        for (let k = 0; k < 16; ++k) m[j * 16 + k] = mats[i * 16 + k]!;
        const c = l.mesh.instanceColor!.array;
        for (let k = 0; k < 3; ++k) c[j * 3 + k] = col[i * 3 + k]!;
    };
    const refresh = (camera: THREE.Camera) => {
        for (const l of lods) l.count = 0;
        let cosA = 0;
        if (camera instanceof THREE.PerspectiveCamera) {
            const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.hypot(1, camera.aspect));
            cosA = Math.cos(Math.min(half + CONE_MARGIN, Math.PI / 2));
        }
        for (let i = 0; i < N; ++i) {
            const dx = pos[i * 3]! - camPos.x;
            const dy = pos[i * 3 + 1]! - camPos.y;
            const dz = pos[i * 3 + 2]! - camPos.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const t = types[i]!;
            // The trees right by the camera cast shadows, even just out of view.
            if (d < SHADOW_DIST) {
                add(levels.cast[t]![variant[i]!]!, i, matrices, colors);
                continue;
            }
            if (d > NEAR_ALL && dx * camDir.x + dy * camDir.y + dz * camDir.z < d * cosA - size[i]!) continue;
            const near = byCourse[i] && d < DETAIL_DIST;
            add(near ? levels.near[t]![variant[i]!]! : d < DISTANT ? levels.far[t]! : levels.distant[t]!, i, matrices, colors);
        }
        for (let i = 0; i < NS; ++i) {
            const dx = shrubMats[i * 16 + 12]! - camPos.x;
            const dy = shrubMats[i * 16 + 13]! - camPos.y;
            const dz = shrubMats[i * 16 + 14]! - camPos.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > SHRUB_DIST || (d > NEAR_ALL && dx * camDir.x + dy * camDir.y + dz * camDir.z < d * cosA - 200)) continue;
            add(understory, i, shrubMats, shrubCols);
        }
        for (const { mesh, count: n } of lods) {
            mesh.count = n;
            mesh.visible = n > 0;
            mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(0, n * 16);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.clearUpdateRanges();
            mesh.instanceColor!.addUpdateRange(0, n * 3);
            mesh.instanceColor!.needsUpdate = true;
        }
    };

    return {
        group,
        update(camera) {
            time.value = performance.now() / 1000;
            camera.getWorldPosition(camPos);
            camera.getWorldDirection(camDir);
            if (camPos.distanceTo(lastPos) < MOVE && camDir.angleTo(lastDir) < TURN) return;
            lastPos.copy(camPos);
            lastDir.copy(camDir);
            refresh(camera);
        },
        dispose() {
            for (const d of disposables) d.dispose();
        },
    };
}
