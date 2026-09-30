/**
 * Three.js presentation layer: the San Francisco course scene (src/app/sf), the vehicle model, drift
 * sparks and the boost flame. Physics state is read-only here.
 */

import * as THREE from 'three';
import { SfScene } from './sf/scene';
import type { RoadMeta } from './sf/road';
import type { VehicleModel } from './sf/vehicleModel';
import { buildVehicleModel } from './sf/vehicleModels';
import { trickFlourish } from './sf/vehicleModel';
import type { VehicleId } from './vehicles';
import { RenderScale } from './renderScale';

export interface CourseMeta {
    name?: string;
    centerline?: { pos: [number, number, number]; right?: [number, number, number] }[];
    start?: { pos: [number, number, number]; angleDeg?: number };
    [key: string]: unknown;
}

export interface KartVisualState {
    pos: THREE.Vector3;
    rot: THREE.Quaternion;
    /** World-space wheel centers in tire order (bike: front, rear; kart: front L/R, rear L/R). */
    wheels: THREE.Vector3[];
    driftDir: number; // -1 left, 0 none, 1 right
    /** Mini-turbo tier reached in this drift: 0 charging, 1 mini-turbo (blue), 2 super (orange). */
    mtTier: number;
    mtChargeRatio: number;
    boosting: boolean;
    wheelie: boolean;
    airborne?: boolean;
    /** Steering (kart state stick X, -1 left .. 1 right). */
    steer?: number;
    /** Accelerator held. */
    throttle?: boolean;
    /** Braking (or reversing): the brake without the accelerator while rolling. */
    braking?: boolean;
    /** The trick in progress: its direction (input.ts TrickDir: 1 up, 2 down, 3 left, 4 right; 0 none). */
    trickDir?: number;
    /** Progress of the trick's flourish, 0..1 (-1: no trick). */
    trickT?: number;
    /** The engine rotates the kart itself in this trick (boost-ramp flips, bike side swings, half-pipes). */
    trickEngineRot?: boolean;
    speed: number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface CameraState {
    pos: THREE.Vector3;
    target: THREE.Vector3;
    fov: number;
    /** Camera up vector (the engine's camera rolls over half-pipes); default world up. */
    up?: THREE.Vector3;
}

export class Renderer {
    readonly renderer: THREE.WebGLRenderer;
    /** The drawing buffer's pixel ratio, adapted to the frame rate (main.ts updates it once per frame). */
    readonly scale: RenderScale;
    readonly scene = new THREE.Scene();
    readonly camera: THREE.PerspectiveCamera;
    private kart!: THREE.Group;
    /** Holds the vehicle (body and wheels) under the kart; the trick flourishes turn it. */
    private trickRoot!: THREE.Group;
    private kartBody!: THREE.Group;
    private sparks!: THREE.Group;
    private sparkMats: THREE.MeshBasicMaterial[] = [];
    private flame!: THREE.Mesh;
    private sun!: THREE.DirectionalLight;
    private hemi!: THREE.HemisphereLight;
    /** The San Francisco course's own scene (terrain, streets, bridge...); null without course meta. */
    sf: SfScene | null = null;
    /** Current game frame (app-side animations keyed to the simulation, e.g. the speed-up pickups). */
    frame = 0;
    /** Scratch for render() (no allocations per frame). */
    private readonly localWheels: THREE.Vector3[] = [];
    private courseGroup = new THREE.Group();
    /** The vehicle model (src/app/sf: the e-bike and rider, or a car). */
    private rider!: VehicleModel;
    private riderVehicle: VehicleId = 'ebike';
    /** World to kart-local space, for placing the wheels. */
    private readonly toKart = new THREE.Matrix4();

    constructor(private readonly canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.scale = new RenderScale(this.renderer);
        this.renderer.shadowMap.enabled = true;
        // (PCF: three dropped PCFSoftShadowMap and fell back to it anyway, with a warning.)
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.camera = new THREE.PerspectiveCamera(55, 1, 10, 400000);
        this.scene.background = new THREE.Color(0x8ecbff);
        this.scene.fog = new THREE.Fog(0x8ecbff, 30000, 160000);

        const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 1.1);
        this.hemi = hemi;
        this.scene.add(hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
        this.sun.position.set(20000, 40000, 10000);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        const sc = this.sun.shadow.camera;
        sc.left = -3000;
        sc.right = 3000;
        sc.top = 3000;
        sc.bottom = -3000;
        sc.near = 100;
        sc.far = 100000;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);

        this.scene.add(this.courseGroup);
        this.buildKart();
        this.setRider();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize(): void {
        this.scale.setMax(window.devicePixelRatio);
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Replaces the drawn course: the San Francisco scene (src/app/sf) draws its own road, terrain, city and sky. */
    setCourse(kcl: Uint8Array, meta: CourseMeta | null): void {
        this.courseGroup.clear();
        this.sf?.dispose();
        this.sf = null;
        this.scene.environment = null;
        this.camera.far = 3_000_000;
        this.camera.updateProjectionMatrix();
        if (!meta) return;
        this.sf = new SfScene(meta as unknown as RoadMeta, this.renderer, this.scene, { sun: this.sun, hemi: this.hemi }, kcl);
        this.courseGroup.add(this.sf.group);
        // (Its dash panels are drawn by the course too: src/app/sf/dashPanels.ts.)
        if (meta.start) this.addStartLine(meta);
    }

    /** Checkered start/finish line. */
    private addStartLine(meta: CourseMeta): void {
        const s = meta.start;
        if (!s) return;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 32;
        const g = canvas.getContext('2d')!;
        for (let x = 0; x < 16; ++x)
            for (let y = 0; y < 2; ++y) {
                g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
                g.fillRect(x * 16, y * 16, 16, 16);
            }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(3200, 400), new THREE.MeshBasicMaterial({ map: tex }));
        const holder = new THREE.Group();
        holder.position.set(s.pos[0], s.pos[1] + 5, s.pos[2]);
        holder.rotation.y = ((s.angleDeg ?? 0) * Math.PI) / 180;
        line.rotation.x = -Math.PI / 2;
        holder.add(line);
        this.courseGroup.add(holder);
    }

    private buildKart(): void {
        this.kart = new THREE.Group();
        this.trickRoot = new THREE.Group();
        this.trickRoot.matrixAutoUpdate = false;
        this.kart.add(this.trickRoot);
        this.kartBody = new THREE.Group();
        this.trickRoot.add(this.kartBody);

        // Drift sparks (behind the rear wheel).
        this.sparks = new THREE.Group();
        for (let i = 0; i < 6; ++i) {
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
            this.sparkMats.push(mat);
            const s = new THREE.Mesh(new THREE.OctahedronGeometry(6 + (i % 3) * 3), mat);
            this.sparks.add(s);
        }
        this.kart.add(this.sparks);

        // Boost flame.
        this.flame = new THREE.Mesh(
            new THREE.ConeGeometry(18, 110, 10),
            new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8 }),
        );
        this.flame.rotation.x = -Math.PI / 2;
        this.trickRoot.add(this.flame);

        this.scene.add(this.kart);
    }

    /** Switches the drawn vehicle. */
    setRider(vehicle: VehicleId = this.riderVehicle): void {
        if (this.rider) {
            this.kartBody.remove(this.rider.body);
            for (const w of this.rider.wheels) this.trickRoot.remove(w);
            this.rider.dispose();
        }
        this.riderVehicle = vehicle;
        this.rider = buildVehicleModel(vehicle);
        this.kartBody.add(this.rider.body);
        for (const w of this.rider.wheels) this.trickRoot.add(w);
        // The boost flame comes out of the vehicle's exhaust.
        this.flame.position.copy(this.rider.exhaust).add(new THREE.Vector3(0, 0, -55));
    }

    render(kart: KartVisualState, cam: CameraState, timeSec: number): void {
        this.kart.position.copy(kart.pos);
        this.kart.quaternion.copy(kart.rot);
        // Trick flourish (visual only, on top of the physics pose; not when the engine rotates the kart itself).
        const trickT = kart.trickT ?? -1;
        const trickDir = kart.trickDir ?? 0;
        let tuck = 0;
        if (trickT >= 0 && trickDir > 0 && !kart.trickEngineRot) {
            tuck = trickFlourish(this.riderVehicle === 'ebike', trickDir, trickT, this.trickRoot.matrix);
        } else this.trickRoot.matrix.identity();
        this.trickRoot.matrixWorldNeedsUpdate = true;

        this.kart.updateMatrixWorld(true);
        const inv = this.toKart.copy(this.kart.matrixWorld).invert();
        const wheelMeshes = this.rider.wheels;
        if (this.rider.placeWheels) {
            const local = this.localWheels;
            while (local.length < kart.wheels.length) local.push(new THREE.Vector3());
            local.length = kart.wheels.length;
            kart.wheels.forEach((w, i) => local[i]!.copy(w).applyMatrix4(inv).setY(local[i]!.y + tuck));
            this.rider.placeWheels(local);
        } else {
            for (let i = 0; i < wheelMeshes.length; ++i) {
                const w = kart.wheels[i];
                const mesh = wheelMeshes[i]!;
                if (!w) {
                    mesh.visible = false;
                    continue;
                }
                mesh.visible = true;
                mesh.position.copy(w).applyMatrix4(inv);
                mesh.position.y += tuck;
            }
        }
        // The vehicle poses itself and spins its wheels.
        this.rider.update({
            timeSec,
            steer: kart.steer ?? 0,
            speed: kart.speed,
            drifting: kart.driftDir,
            boosting: kart.boosting,
            airborne: !!kart.airborne,
            wheelie: kart.wheelie,
            trick: trickT >= 0 && trickDir > 0 ? trickDir : -1,
            trickT,
            trickEngineRot: !!kart.trickEngineRot,
            throttle: kart.throttle,
            braking: !!kart.braking,
        });

        // Sparks: white while charging, blue at a mini-turbo, orange at a super mini-turbo; from the
        // rear wheel (bike) or both rear wheels (karts).
        const drifting = kart.driftDir !== 0;
        this.sparks.visible = drifting && kart.mtChargeRatio > 0.05;
        if (this.sparks.visible) {
            const n = wheelMeshes.length;
            const rears = n >= 3 ? [wheelMeshes[n - 2]!.position, wheelMeshes[n - 1]!.position] : [wheelMeshes[n - 1]!.position];
            const tier = kart.mtTier;
            const color = tier >= 2 ? 0xff8a1f : tier === 1 ? 0x3aa0ff : 0xfff6d0;
            this.sparks.children.forEach((s, i) => {
                const t = timeSec * 18 + i * 1.7;
                const rear = rears[i % rears.length]!;
                s.scale.setScalar(tier >= 1 ? 1.35 : 0.8);
                s.position.set(
                    rear.x + Math.sin(t) * 18 + (rears.length > 1 ? 0 : i % 2 ? 16 : -16),
                    rear.y - 10 + Math.abs(Math.cos(t * 1.3)) * 18,
                    rear.z - 30 - ((t * 20) % 40),
                );
                this.sparkMats[i]!.color.setHex(color);
            });
        }

        this.flame.visible = kart.boosting;
        if (kart.boosting) {
            const f = 0.8 + Math.sin(timeSec * 60) * 0.2;
            this.flame.scale.set(f, 1 + Math.sin(timeSec * 45) * 0.25, f);
        }

        this.camera.position.copy(cam.pos);
        this.camera.up.copy(cam.up ?? WORLD_UP);
        this.camera.lookAt(cam.target);
        if (Math.abs(this.camera.fov - cam.fov) > 0.01) {
            this.camera.fov = cam.fov;
            this.camera.updateProjectionMatrix();
        }

        // Keep the shadow camera around the kart.
        if (this.sf) {
            const d = this.sf.sunDir();
            this.sun.position.set(kart.pos.x + d.x * 20000, kart.pos.y + d.y * 20000, kart.pos.z + d.z * 20000);
            this.sf.update(timeSec, this.camera, this.frame);
        } else this.sun.position.set(kart.pos.x + 6000, kart.pos.y + 12000, kart.pos.z + 3000);
        this.sun.target.position.copy(kart.pos);

        this.renderer.render(this.scene, this.camera);
    }
}
