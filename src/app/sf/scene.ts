/**
 * The San Francisco course's scene: terrain, road, streets, buildings, trees, sky and water, the
 * Golden Gate Bridge and the landmarks (aerial imagery, PBR materials, a physically based sky at
 * golden hour, ACES tone mapping).
 *
 * Loads its data asynchronously; `ready` resolves once everything is in the scene.
 */

import * as THREE from 'three';
import { buildBuildings, type BuildingMeshes } from './buildings';
import { buildParkedCars } from './parkedCars';
import { buildRoad, type RoadMeshes, type RoadMeta } from './road';
import { buildSkyWater, LIGHTING, SUN_DIR, type SkyWater } from './sky';
import { buildStreets, type StreetMeshes } from './streets';
import type { StreetDetailPart } from './streetDetail';
import { buildTerrain, type TerrainMeshes } from './terrain';
import { buildTrees, treeFootprints, type TreeMeshes } from './trees';
import { buildGroundMaps } from './groundMaps';
import { ItemBoxes } from './itemBoxes';
import { pickupRows } from '../rules/pickups';
import { Rivals } from './rivals';
import { buildKclExtras } from './kclExtras';
import { buildFortPointSection } from './sections/fortPoint';
import { buildParkway, raiseTunnelTops } from './sections/parkway';
import { buildDashPanels } from './dashPanels';
import { Traffic } from './traffic';
import { carveUnderBridge } from './sections/bridge';
import { buildVistaGore } from './sections/vista';
import { LANDCOVER, SfWorld } from './world';
import { buildWaterfront, carveWaterfront, waterfrontWalls } from './sections/waterfront';
import { buriedUnderRoad, carveRoadbed } from './sections/roadbed';
import { floodPalaceLagoon } from './sections/palaceLagoon';

interface Part {
    group: THREE.Object3D;
    dispose?(): void;
}

/** Optional modules (bridge, landmarks), loaded if present. */
const optional = import.meta.glob(['./bridge.ts', './landmarks.ts']) as Record<string, () => Promise<Record<string, unknown>>>;

export interface SfLights {
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
}

export class SfScene {
    readonly group = new THREE.Group();
    world: SfWorld | null = null;
    readonly ready: Promise<void>;
    private parts: Part[] = [];
    private sky: SkyWater | null = null;
    private updaters: ((t: number) => void)[] = [];
    private disposed = false;
    private trees: TreeMeshes | null = null;
    /** Speed-up pickups (collected by the app after each game frame). */
    items: ItemBoxes | null = null;
    /** Recorded CPU rivals. */
    rivals: Rivals | null = null;

    constructor(
        private readonly meta: RoadMeta & { segments?: Record<string, [number, number]> },
        private readonly renderer: THREE.WebGLRenderer,
        private readonly scene: THREE.Scene,
        private readonly lights: SfLights,
        private readonly kcl: Uint8Array,
    ) {
        this.group.name = 'sf';
        this.ready = this.init();
    }

    private async init(): Promise<void> {
        // (The rivals' recordings and the bridge's and landmarks' code load while the rest is built.)
        const rivalsLoad = Rivals.load('courses/golden_gate');
        const modules = Object.entries(optional).map(([path, load]) => ({
            path,
            mod: load().catch((e: unknown) => {
                console.warn(`sf: ${path} failed`, e);
                return null;
            }),
        }));
        const world = await SfWorld.load();
        if (this.disposed) {
            world.dispose();
            void rivalsLoad.then((r) => r?.dispose());
            return;
        }
        this.world = world;
        carveUnderBridge(world, this.meta.centerline);
        const seg = this.meta.segments ?? {};
        const onBridge = (s: number) => ['bridge_nb', 'bridge_sb'].some((n) => seg[n] && s > seg[n]![0] && s < seg[n]![1]);
        const road: RoadMeshes = buildRoad(this.meta, onBridge, waterfrontWalls(this.meta));
        carveWaterfront(world, this.meta);
        carveRoadbed(world, this.meta.centerline);
        floodPalaceLagoon(world);
        raiseTunnelTops(world, this.meta as unknown as Parameters<typeof raiseTunnelTops>[1]);
        // The carves edit samples pointwise: re-join the cells of different spacing.
        world.stitch();
        const ground = buildGroundMaps(world, treeFootprints(world.json, world.crownAt), this.meta.centerline);
        // (Not the ground the road hides: none over the jump gaps, which have no road.)
        const gaps = (this.meta.features ?? []).filter((f) => f.type === 'gap' && f.s).map((f) => f.s as [number, number]);
        const buried = buriedUnderRoad(world, this.meta.centerline, (s) => gaps.some(([g0, g1]) => s > g0 - 800 && s < g1 + 800));
        const terrain: TerrainMeshes = buildTerrain(world, ground, buried);
        const buildings: BuildingMeshes = buildBuildings(world.json);
        const trees: TreeMeshes = buildTrees(world.json, world.crownAt, ground.photoAt, {
            y: world.groundY,
            understory: (x, z) => {
                const c = world.landcoverAt(x, z);
                return c === LANDCOVER.forest || c === LANDCOVER.scrub || ground.woods(x / world.json.scale, -z / world.json.scale) > 0.3;
            },
        });
        this.trees = trees;
        const streets: StreetMeshes = buildStreets(world);
        const d = world.json.depth;
        this.sky = buildSkyWater(world.json.seaY, d && world.depth ? { ...d, data: world.depth, scale: world.json.scale } : undefined);
        this.items = new ItemBoxes(this.meta.centerline, pickupRows(seg));
        const rivals = await rivalsLoad;
        if (this.disposed) {
            rivals?.dispose();
            return;
        }
        this.rivals = rivals;
        const extras = buildKclExtras(this.kcl, this.meta, onBridge);
        const parkway = buildParkway(this.meta as unknown as Parameters<typeof buildParkway>[0], world, this.kcl, terrain);
        // Dash panels course-wide, except where a section draws its own (the waterfront).
        const dash = buildDashPanels(this.meta, waterfrontWalls(this.meta));
        this.updaters.push((t) => dash.update(t));
        const traffic = new Traffic(world, this.meta.centerline);
        this.updaters.push((t) => traffic.update(t));
        const fortPoint = buildFortPointSection(this.meta, world);
        this.updaters.push((t) => fortPoint.update(t));
        const waterfront = buildWaterfront(this.meta, world.groundY);
        this.parts.push(road, terrain, buildings, buildParkedCars(world, this.meta.centerline), trees, streets, buildVistaGore(world.groundY), this.sky, this.items, extras, parkway, dash, traffic, fortPoint, waterfront);
        if (this.rivals) this.parts.push(this.rivals);
        for (const p of this.parts) this.group.add(p.group);

        // Bridge + landmarks.
        for (const { path, mod: loading } of modules) {
            try {
                const mod = await loading;
                if (!mod) continue;
                let obj: THREE.Object3D | null = null;
                if (path.endsWith('bridge.ts') && typeof mod.buildGoldenGateBridge === 'function')
                    obj = (mod.buildGoldenGateBridge as (o: { centerline: RoadMeta['centerline']; features?: unknown }) => THREE.Object3D)({
                        centerline: this.meta.centerline,
                        features: (this.meta as { features?: unknown }).features,
                    });
                if (path.endsWith('landmarks.ts') && typeof mod.buildLandmarks === 'function')
                    obj = (mod.buildLandmarks as (o: { groundY: (x: number, z: number) => number }) => THREE.Object3D)({ groundY: world.groundY });
                if (!obj) continue;
                const upd = obj.userData.update as ((t: number) => void) | undefined;
                if (upd) this.updaters.push(upd);
                this.group.add(obj);
            } catch (e) {
                console.warn(`sf: ${path} failed`, e);
            }
        }
        this.light();
        // Every shader now (in parallel where the browser can), not the first time each thing
        // comes into view mid-race.
        await this.renderer.compileAsync(this.scene, this.compileCamera);
    }

    private readonly compileCamera = new THREE.PerspectiveCamera();

    /** Sky, environment, fog, tone mapping and the sun / ambient lights (golden hour). */
    private light(): void {
        this.sky!.attach(this.renderer, this.scene);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = LIGHTING.exposure;
        const { sun, hemi } = this.lights;
        sun.color.setHex(LIGHTING.sun);
        sun.intensity = LIGHTING.sunIntensity;
        hemi.color.setHex(LIGHTING.hemiSky);
        hemi.groundColor.setHex(LIGHTING.hemiGround);
        hemi.intensity = LIGHTING.hemiIntensity;
        // Shader programs depend on tone mapping.
        this.scene.traverse((o) => {
            const m = (o as THREE.Mesh).material;
            if (!m) return;
            for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
        });
    }

    // Street detail (DataSF crosswalks, sidewalks, bike lanes, meters; streetDetail.ts): loaded the
    // first time it's turned on, then a part like the others.
    private streetDetailOn = false;
    private streetDetail: StreetDetailPart | null = null;
    private streetDetailLoading: Promise<void> | null = null;

    setStreetDetail(on: boolean): void {
        this.streetDetailOn = on;
        if (this.streetDetail) {
            this.streetDetail.setVisible(on);
            return;
        }
        if (!on || this.streetDetailLoading) return;
        this.streetDetailLoading = this.ready
            .then(async () => {
                const mod = await import('./streetDetail');
                const detail = await mod.loadStreetDetail();
                if (this.disposed || !this.world) return;
                const part = mod.buildStreetDetail(detail, this.world.groundY, this.meta.centerline);
                part.setVisible(this.streetDetailOn);
                this.streetDetail = part;
                this.parts.push(part);
                this.group.add(part.group);
                await this.renderer.compileAsync(part.group, this.compileCamera, this.scene);
            })
            .catch((e) => {
                console.warn('sf: street detail failed', e);
                this.streetDetailLoading = null;
            });
    }

    /** Sun position for the shadow camera: along SUN_DIR from the kart. */
    sunDir(): THREE.Vector3 {
        return SUN_DIR;
    }

    update(timeSec: number, camera: THREE.Camera, frame = 0): void {
        this.sky?.update(timeSec, camera);
        this.trees?.update(camera);
        this.items?.update(timeSec, frame);
        this.rivals?.update(frame, timeSec, camera.position);
        for (const u of this.updaters) u(timeSec);
    }

    dispose(): void {
        this.disposed = true;
        for (const p of this.parts) p.dispose?.();
        this.world?.dispose();
        this.scene.environment = null;
    }
}
