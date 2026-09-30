/**
 * The ride picker's stage: the three vehicles on fog-white turntables in a small studio scene of
 * their own (its own canvas, its own light), not the race's. The chosen one stands in the middle
 * turning slowly; the other two wait to its sides, further back and paler in the fog. Choosing
 * another slides them round; the camera frames whichever is in the middle.
 *
 *   const stage = new Showroom(canvas, 'robotaxi');
 *   stage.select('ebike');   // animates
 *   stage.start(); stage.stop(); stage.dispose();
 */

import * as THREE from 'three';
import { PICKER_ORDER, type VehicleId } from '../vehicles';
import { buildVehicleModel } from './vehicleModels';
import type { VehicleModel, VehicleState } from './vehicleModel';

/** The stage's fog: the colour the far vehicles fade into (tokens.css --ground). */
const FOG = 0xe9edf0;
/** How far apart the turntables stand, and how far back the side ones wait (world units). */
const SPACING = 540;
const BACK = 560;
/** How quickly things settle on their new places (1/s). */
const SETTLE = 5;

interface Seat {
    id: VehicleId;
    model: VehicleModel;
    root: THREE.Group;
    /** The vehicle's size (its bounding box), for the camera's framing. */
    size: THREE.Vector3;
    x: number;
    z: number;
    yaw: number;
}

export class Showroom {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(26, 16 / 9, 50, 20000);
    private readonly seats: Seat[];
    private readonly state: VehicleState = { timeSec: 0, steer: 0, speed: 0, drifting: 0, boosting: false, airborne: false, wheelie: false, trick: -1 };
    private selected: number;
    /** The camera's distance and aim, eased like the seats. */
    private dist = 0;
    private aimY = 0;
    private raf = 0;
    private last = 0;
    private readonly resize: ResizeObserver;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        vehicle: VehicleId,
    ) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene.fog = new THREE.Fog(FOG, 1500, 3600);

        // Soft studio light: a fog-white sky and a warm key from the upper left.
        this.scene.add(new THREE.HemisphereLight(0xf6f8fa, 0xb7bec4, 1.7));
        const key = new THREE.DirectionalLight(0xfff3e4, 2.3);
        key.position.set(-700, 1400, 900);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.radius = 6;
        key.shadow.bias = -0.0005;
        Object.assign(key.shadow.camera, { left: -1600, right: 1600, top: 1200, bottom: -1200, near: 100, far: 4000 });
        this.scene.add(key);

        // The floor only catches shadows; the stage's fog is the page behind the canvas.
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
        floor.receiveShadow = true;
        this.scene.add(floor);

        const disc = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 1 });
        this.seats = PICKER_ORDER.map((id) => {
            const model = buildVehicleModel(id);
            const lift = new THREE.Group();
            lift.add(model.body, ...model.wheels);
            model.update(this.state);
            // Stand it on the floor, centred over its turntable.
            const box = new THREE.Box3().setFromObject(lift);
            const size = box.getSize(new THREE.Vector3());
            const c = box.getCenter(new THREE.Vector3());
            lift.position.set(-c.x, -box.min.y + 4, -c.z);
            lift.traverse((o) => {
                if ((o as THREE.Mesh).isMesh) o.castShadow = true;
            });
            const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 4, 72), disc);
            const r = Math.max(size.x, size.z) * 0.56;
            table.scale.set(r, 1, r);
            table.position.y = 2;
            table.receiveShadow = true;
            const root = new THREE.Group();
            root.add(table, lift);
            this.scene.add(root);
            return { id, model, root, size, x: 0, z: 0, yaw: 0 };
        });
        this.selected = Math.max(0, PICKER_ORDER.indexOf(vehicle));
        this.place(1, 0);

        this.resize = new ResizeObserver(() => this.fit());
        this.resize.observe(canvas);
        this.fit();
    }

    select(vehicle: VehicleId): void {
        this.selected = Math.max(0, PICKER_ORDER.indexOf(vehicle));
    }

    /** Where a click lands: the side vehicle to the left (-1) or right (1), or the middle (0). */
    sideAt(clientX: number): -1 | 0 | 1 {
        const r = this.canvas.getBoundingClientRect();
        const u = (clientX - r.left) / r.width;
        return u < 0.3 ? -1 : u > 0.7 ? 1 : 0;
    }

    start(): void {
        if (this.raf) return;
        this.last = performance.now();
        const loop = (now: number) => {
            const dt = Math.min(0.1, (now - this.last) / 1000);
            this.last = now;
            this.place(1 - Math.exp(-SETTLE * dt), now / 1000);
            this.renderer.render(this.scene, this.camera);
            this.raf = requestAnimationFrame(loop);
        };
        this.raf = requestAnimationFrame(loop);
    }

    stop(): void {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    dispose(): void {
        this.stop();
        this.resize.disconnect();
        for (const s of this.seats) s.model.dispose();
        this.renderer.dispose();
        // (A second WebGL context: give it back rather than wait for the collector.)
        this.renderer.forceContextLoss();
    }

    /** Eases every seat (and the camera) `k` of the way to its place at time `t`. */
    private place(k: number, t: number): void {
        const n = this.seats.length;
        this.seats.forEach((s, i) => {
            // -1, 0 or 1: left of the chosen one, the chosen one, right of it (going round).
            const slot = ((i - this.selected + n + 1) % n) - 1;
            const x = slot * SPACING;
            const z = -Math.abs(slot) * BACK;
            // Three-quarters on, the chosen one turning slowly; the others turned towards the middle.
            const yaw = slot === 0 ? -0.55 + 0.35 * Math.sin(t * 0.45) : -0.55 - slot * 0.45;
            s.x += (x - s.x) * k;
            s.z += (z - s.z) * k;
            s.yaw += (yaw - s.yaw) * k;
            s.root.position.set(s.x, 0, s.z);
            s.root.rotation.y = s.yaw;
        });
        this.state.timeSec = t;
        for (const s of this.seats) s.model.update(this.state);
        // Frame the chosen one: its size sets the distance.
        const size = this.seats[this.selected]!.size;
        const dist = 300 + Math.max(size.x, size.z, size.y * 1.4) * 2.05;
        this.dist = this.dist ? this.dist + (dist - this.dist) * k : dist;
        this.aimY = this.aimY ? this.aimY + (size.y * 0.55 - this.aimY) * k : size.y * 0.55;
        this.camera.position.set(0, this.aimY + this.dist * 0.16, this.dist);
        this.camera.lookAt(0, this.aimY, 0);
    }

    private fit(): void {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
}
