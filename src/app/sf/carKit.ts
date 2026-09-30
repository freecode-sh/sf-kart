/**
 * Shared parts of the San Francisco cars (robotaxi.ts, buggy.ts): the rig that poses and bakes a
 * car like the e-bike in ebike.ts (one skinned mesh per material over a detached bone hierarchy),
 * car wheels, and seated people.
 *
 * Ground space as in ebike.ts: ground at y = 0, +Z forward, +X is the driver's left. Bone 0 is the
 * car body; its matrix adds a little body roll and pitch on top of the physics.
 */

import * as THREE from 'three';
import { bake, capsule, clamp, disposeModel, ellipsoid, frameM, grid, ik, Kit, latheX, lerp, materials, modelStats, rbox, setBrakeLights, smooth, tube, V, type Finish, type Q, type V3 } from './modelKit';
import { viewerTrick, type VehicleModel, type VehicleState } from './vehicleModel';

const CAR_Q: Q = { sph: [16, 10], cyl: 12, lathe: 16, curve: 4, bevel: 3 };

const B_BODY = 0;

// ---------------------------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------------------------

// Scratch for the per-frame posing (update(), poseFigure(), steeringM()).
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _qT = new THREE.Quaternion();
const _qP = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _mT = new THREE.Matrix4();
const ONE = V(1, 1, 1);

/** Smoothed pose inputs, shared by the cars' pose functions. */
export interface CarPose {
    t: number;
    dt: number;
    /** Steering, -1 left .. 1 right. */
    st: number;
    /** Drift direction (smoothed), -1 left .. 1 right. */
    dr: number;
    /** Boost (0..1). */
    tuck: number;
    air: number;
    /** Trick pose weight (0..1, held through the air, released on landing) and the trick's direction (1 up, 2 down, 3 left, 4 right). */
    tw: number;
    trickType: number;
    /** The trick's flourish progress 0..1, or -1. */
    trickU: number;
    /** Landing squash: > 0 compressed (a spring kicked by landings). */
    land: number;
    /** Speed, 0 .. ~1.4 of a fast kart. */
    spd: number;
    /** Raw state this frame. */
    raw: VehicleState;
}

export abstract class CarRig implements VehicleModel {
    readonly body = new THREE.Group();
    wheels: THREE.Object3D[] = [];
    abstract readonly exhaust: THREE.Vector3;
    protected readonly q: Q;
    protected readonly bones: THREE.Bone[] = [];
    protected readonly skeleton: THREE.Skeleton;
    protected readonly mats: Record<Finish, THREE.Material>;
    /** Rolling radius of each wheel (spin rate). */
    protected wheelR: number[] = [];
    /** Wheels that steer, and by how much at full lock (radians). */
    protected steerWheels: number[] = [];
    protected steerMax = 0.32;
    private lastT = NaN;
    private spin: number[] = [];
    /** Landing spring (squash, velocity), time in the air, brake-light level. */
    private landV = 0;
    private airSec = 0;
    private brake = 0;
    private readonly p: CarPose;
    private readonly bodyM = new THREE.Matrix4();

    constructor(
        protected readonly groundY: number,
        boneCount: number,
    ) {
        this.q = CAR_Q;
        this.mats = materials();
        for (let i = 0; i < boneCount; ++i) {
            const b = new THREE.Bone();
            b.matrixAutoUpdate = false;
            b.matrixWorldAutoUpdate = false;
            this.bones.push(b);
        }
        this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
        const raw: VehicleState = { timeSec: 0, steer: 0, speed: 0, drifting: 0, boosting: false, airborne: false, wheelie: false, trick: -1 };
        this.p = { t: 0, dt: 0, st: 0, dr: 0, tuck: 0, air: 0, tw: 0, trickType: 1, trickU: -1, land: 0, spd: 0, raw };
    }

    /** Bakes the kit into the body and adds the wheels (ground-space centers). */
    protected finish(kit: Kit, wheels: { obj: THREE.Object3D; center: V3; r: number }[]): void {
        const holder = new THREE.Group();
        holder.position.y = this.groundY;
        for (const m of bake(kit, this.mats, this.skeleton)) holder.add(m);
        this.body.add(holder);
        this.wheels = wheels.map((w) => {
            w.obj.position.copy(w.center).add(V(0, this.groundY, 0));
            return w.obj;
        });
        this.wheelR = wheels.map((w) => w.r);
        this.spin = wheels.map(() => 0);
        this.update(this.p.raw);
    }

    /** Sets a 'blink' light on (1) or off (0). */
    protected blink(on: number): void {
        const m = this.mats.blink as THREE.MeshBasicMaterial;
        m.color.setScalar(lerp(0.16, 1.25, on));
    }

    update(s: VehicleState): void {
        const t = s.timeSec;
        // First frame or a jump in time (frame stepping, a hidden tab): snap to the targets.
        const first = Number.isNaN(this.lastT) || t - this.lastT > 0.25 || t < this.lastT;
        const dt = first ? 0 : t - this.lastT;
        this.lastT = t;
        const k = (rate: number) => (first ? 1 : 1 - Math.exp(-rate * dt));
        const p = this.p;
        p.t = t;
        p.dt = dt;
        p.raw = s;
        p.st += (clamp(s.steer, -1, 1) - p.st) * k(9);
        p.dr += (Math.sign(s.drifting) - p.dr) * k(5);
        p.tuck += ((s.boosting ? 1 : 0) - p.tuck) * k(6);
        p.air += ((s.airborne ? 1 : 0) - p.air) * k(5);
        if (s.trick >= 0) p.trickType = s.trick;
        // The pose holds through the air and lets go on landing.
        const posing = s.trick >= 0 && s.airborne;
        p.tw += ((posing ? 1 : 0) - p.tw) * k(posing ? 10 : 6);
        p.trickU = s.trick >= 0 ? (s.trickT ?? 0) : -1;
        p.spd += (clamp(Math.abs(s.speed) / 90, 0, 1.4) - p.spd) * k(3);

        // Landing: the suspension squashes (harder after a long jump) and springs back.
        if (s.airborne) this.airSec += dt;
        else {
            if (this.airSec > 0.2) this.landV += Math.min(1.6, this.airSec * 1.8) * 9;
            this.airSec = 0;
        }
        const h = Math.min(dt, 0.05);
        this.landV += (-p.land * 190 - this.landV * 13) * h;
        p.land = clamp(p.land + this.landV * h, -0.4, 1.2);

        // Brake lights: bright while braking or reversing.
        this.brake += ((s.braking ? 1 : 0) - this.brake) * k(18);
        setBrakeLights(this.mats, this.brake);

        // Wheels roll (capped so they don't strobe); the front ones steer.
        this.wheels.forEach((w, i) => {
            const omega = clamp((s.speed * 60) / this.wheelR[i]!, -27, 27);
            this.spin[i] = (this.spin[i]! + omega * dt) % (Math.PI * 2);
            w.rotation.x = this.spin[i]!;
            w.rotation.y = this.steerWheels.includes(i) ? -p.st * this.steerMax : 0;
        });

        // Body: leans out of turns and slides, squats under boost, bobs at rest.
        // Nose dives a touch under braking and on landing.
        const roll = -(p.st * 0.022 + p.dr * 0.035) * Math.min(1, p.spd * 1.5);
        const pitch = -p.tuck * 0.025 + p.air * 0.02 + this.brake * 0.018 * Math.min(1, p.spd * 2) + p.land * 0.02 + Math.sin(t * 2.1) * 0.003 * (1 - Math.min(1, p.spd));
        const bodyM = this.bodyM
            .makeTranslation(0, 40 - p.land * 5, 0)
            .multiply(_m.makeRotationFromEuler(_e.set(pitch, 0, roll, 'ZXY')))
            .multiply(_m.makeTranslation(0, -40, 0));
        this.pose(p, bodyM);
        for (const b of this.bones) b.matrixWorld.premultiply(bodyM);
        this.bones[B_BODY]!.matrixWorld.copy(bodyM);
        this.skeleton.update();
    }

    /** Sets every bone's matrix (ground space, before the body roll that update() applies). */
    protected abstract pose(p: CarPose, bodyM: THREE.Matrix4): void;

    placeWheels?(centers: readonly THREE.Vector3[]): void;

    stats(): { triangles: number; drawCalls: number } {
        return modelStats([this.body, ...this.wheels]);
    }

    dispose(): void {
        disposeModel([this.body, ...this.wheels], this.mats, this.skeleton);
    }
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Points on an arc (side view [z, y]) around (zc, yc), from angle a0 to a1 (radians, 0 = +Z). */
export function arc(zc: number, yc: number, r: number, a0: number, a1: number, n: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; ++i) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push([zc + Math.cos(a) * r, yc + Math.sin(a) * r]);
    }
    return out;
}

/**
 * A wheel arch cut into a side outline running rearward along a sill at y = sill: the arc over a
 * wheel at (z, y) with radius r, from where it leaves the sill in front to where it meets it behind.
 */
export function archCut(z: number, y: number, r: number, sill: number, n: number): [number, number][] {
    const a = Math.asin(clamp((sill - y) / r, -1, 1));
    return arc(z, y, r, a, Math.PI - a, n);
}

/** A band over a wheel arch (flare / fender), ground space, on the side x (sign = side). */
export function archBand(q: Q, x: number, z: number, y: number, r: number, from: number, to: number, thick: number, width: number): THREE.BufferGeometry {
    const g = new THREE.TorusGeometry(r, thick, 6, 20, to - from);
    // Torus in XY (angle from +X) → the ZY plane (angle from +Z), starting at `from`.
    g.scale(1, 1, width / thick);
    g.rotateZ(from);
    g.rotateY(-Math.PI / 2);
    g.translate(x, y, z);
    return g;
}

// ---------------------------------------------------------------------------------------------
// Wheels (wheel-local: center at origin, axle along X)
// ---------------------------------------------------------------------------------------------

export interface WheelSpec {
    r: number;
    width: number;
    tire: THREE.Color;
    rim: THREE.Color;
    rimFinish: Finish;
    hub: THREE.Color;
    spokes: number;
    /** Rim radius as a fraction of the tire radius. */
    rimFrac?: number;
    /** Twisted "turbine" spokes (robotaxi) instead of straight ones. */
    turbine?: boolean;
    /** Side the outer face is on (+1 / -1), or 0 for both. */
    face?: number;
}

export function buildCarWheel(q: Q, mats: Record<Finish, THREE.Material>, w: WheelSpec): THREE.Group {
    const kit = new Kit(q);
    const hw = w.width / 2;
    const rIn = w.r * (w.rimFrac ?? 0.66);
    const rc = (w.r + rIn) / 2;
    const ar = (w.r - rIn) / 2;
    const se = (x: number, n: number) => Math.sign(x) * Math.abs(x) ** (2 / n);
    // Tire: a squarish cross-section swept around the axle.
    const tire = grid(40, 10, (u, v, o) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI * 2;
        const r = rc + ar * se(Math.cos(ph), 3.6);
        const x = hw * se(Math.sin(ph), 4);
        o.set(x, r * Math.cos(th), r * Math.sin(th));
    });
    kit.add(smooth(tire), 'matte', w.tire);
    // Rim barrel and faces.
    kit.add(latheX(q, [[rIn - 2, -hw + 2], [rIn + 0.5, -hw + 1.5], [rIn + 0.5, hw - 1.5], [rIn - 2, hw - 2], [rIn - 2, -hw + 2]], 36), w.rimFinish, w.rim);
    const faces = w.face ? [w.face] : [1, -1];
    for (const s of faces) {
        const x = s * (hw - 2.5);
        for (let k = 0; k < w.spokes; ++k) {
            const th = (k / w.spokes) * Math.PI * 2;
            const twist = w.turbine ? 0.45 : 0;
            const a = V(x, Math.cos(th) * rIn * 0.28, Math.sin(th) * rIn * 0.28);
            const b = V(x, Math.cos(th + twist) * (rIn - 1), Math.sin(th + twist) * (rIn - 1));
            kit.add(tube(q, a, b, 2.4, 1.8, 6), w.rimFinish, w.rim);
        }
        kit.add(new THREE.CylinderGeometry(rIn * 0.3, rIn * 0.34, 3, q.cyl).rotateZ(Math.PI / 2).translate(x, 0, 0), 'gloss', w.hub);
        // Dark disc behind the spokes (the brake and the inside of the wheel).
        kit.add(new THREE.CylinderGeometry(rIn - 1, rIn - 1, 1, q.cyl * 2).rotateZ(Math.PI / 2).translate(x - s * 4, 0, 0), 'matte', new THREE.Color(0x202124));
    }
    const g = new THREE.Group();
    for (const m of bake(kit, mats, null)) g.add(m);
    g.rotation.order = 'YXZ'; // steer (Y) outside the spin (X)
    return g;
}

// ---------------------------------------------------------------------------------------------
// Seated people
// ---------------------------------------------------------------------------------------------

export interface FigureBones {
    pelvis: number;
    torso: number;
    head: number;
    uarm: [number, number];
    farm: [number, number];
    /** Hat on its own bone (it bounces), else none. */
    hat?: number;
}

export interface FigureLook {
    top: THREE.Color;
    bottom: THREE.Color;
    skin: THREE.Color;
    hair: THREE.Color;
    shoes: THREE.Color;
    hat?: { kind: 'bucket'; color: THREE.Color; band: THREE.Color };
    sunglasses?: boolean;
    /** A camera in the right hand. */
    camera?: boolean;
}

/** Proportions of the seated people (torso length, head radius, limb lengths, shoulder / hip offsets). */
export const FIGURE_DIMS = { torso: 36, headR: 12.5, uarm: 23, farm: 21, thigh: 30, shin: 30, shoulder: 15, hip: 7 };

export function buildFigure(kit: Kit, b: FigureBones, look: FigureLook): void {
    const q = kit.q;
    const add = kit.add.bind(kit);
    const d = FIGURE_DIMS;
    // Pelvis and legs, sitting: thighs forward, shins down to the floor.
    add(ellipsoid(q, V(0, 2, 0), V(13, 9, 12)), 'matte', look.bottom, b.pelvis);
    for (const s of [1, -1]) {
        const hip = V(s * d.hip, 0, 2);
        const knee = V(s * (d.hip + 1), 1, d.thigh);
        const foot = V(s * (d.hip + 1), -d.shin, d.thigh + 5);
        add(capsule(q, hip, knee, 7), 'matte', look.bottom, b.pelvis);
        add(capsule(q, knee, foot, 5.5), 'matte', look.skin, b.pelvis);
        add(rbox(q, V(9, 6, 16), foot.clone().add(V(0, -2, 5)), undefined, 2.5), 'matte', look.shoes, b.pelvis);
    }
    // Torso: a lathe along +Y (front is +Z), wider across the shoulders.
    const T = d.torso;
    const prof: [number, number][] = [[0.1, -2], [10, 0], [11.5, T * 0.3], [12, T * 0.62], [12.5, T * 0.84], [9, T * 0.98], [0.1, T + 1]];
    add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), q.lathe).applyMatrix4(new THREE.Matrix4().makeScale(1.3, 1, 0.82)), 'matte', look.top, b.torso);
    for (const s of [1, -1]) add(ellipsoid(q, V(s * d.shoulder, T - 5, -1), V(6.5, 6, 6.5)), 'matte', look.top, b.torso);
    // Head: skin, hair, a nose, eyes (or sunglasses), a neck.
    const R = d.headR;
    add(new THREE.SphereGeometry(R, q.sph[0] + 2, q.sph[1] + 2).scale(0.92, 1, 0.98), 'matte', look.skin, b.head);
    add(new THREE.SphereGeometry(R * 1.05, q.sph[0] + 2, q.sph[1], 0, Math.PI * 2, 0, 1.25).scale(0.94, 1, 1).rotateX(-0.35), 'matte', look.hair, b.head);
    add(ellipsoid(q, V(0, -R * 0.08, R * 0.95), V(R * 0.14, R * 0.2, R * 0.16), undefined, true), 'matte', look.skin, b.head);
    if (look.sunglasses) {
        add(rbox(q, V(R * 1.5, R * 0.3, R * 0.2), V(0, R * 0.2, R * 0.86), undefined, 1), 'gloss', new THREE.Color(0x111318), b.head);
    } else {
        for (const s of [1, -1]) add(ellipsoid(q, V(s * R * 0.33, R * 0.18, R * 0.88), V(R * 0.11, R * 0.14, R * 0.08), undefined, true), 'gloss', new THREE.Color(0x1a1a1e), b.head);
    }
    add(capsule(q, V(0, -R * 1.25, -1), V(0, -R * 0.6, -1), 5), 'matte', look.skin, b.head);
    if (look.hat) {
        const hb = b.hat ?? b.head;
        // Bucket hat: a slightly flared crown and a drooping brim.
        add(new THREE.CylinderGeometry(R * 0.86, R * 0.98, R * 0.62, q.cyl + 4).translate(0, R * 0.62, 0), 'matte', look.hat.color, hb);
        add(new THREE.CylinderGeometry(R * 0.99, R * 0.99, R * 0.16, q.cyl + 4).translate(0, R * 0.42, 0), 'matte', look.hat.band, hb);
        add(new THREE.CylinderGeometry(R * 1.02, R * 1.5, R * 0.3, q.cyl + 6, 1, true).translate(0, R * 0.2, 0), 'matte', look.hat.color, hb);
        add(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.6, q.cyl + 4).translate(0, R * 0.94, 0), 'matte', look.hat.color, hb);
    }
    // Arms (forearm frame: +Y from the elbow to the hand).
    for (const i of [0, 1]) {
        add(capsule(q, V(0, 0, 0), V(0, d.uarm, 0), 5.2), 'matte', look.top, b.uarm[i]!);
        add(capsule(q, V(0, 0, 0), V(0, d.farm - 2, 0), 4.3), 'matte', look.skin, b.farm[i]!);
        add(ellipsoid(q, V(0, d.farm + 1.5, 0.5), V(4.4, 5.5, 4.6)), 'matte', look.skin, b.farm[i]!);
    }
    if (look.camera) {
        const f = b.farm[1]!;
        add(rbox(q, V(15, 10, 8), V(0, d.farm + 5, 5), undefined, 2), 'satin', new THREE.Color(0x26282c), f);
        add(new THREE.CylinderGeometry(3.6, 4, 7, q.cyl).rotateX(Math.PI / 2).translate(0, d.farm + 5, 11), 'satin', new THREE.Color(0x111214), f);
        add(rbox(q, V(4, 3, 2), V(4.5, d.farm + 11, 6), undefined, 0.6), 'blink', new THREE.Color(0xffffff), f);
    }
}

export interface FigurePose {
    /** Pelvis (seat) position, ground space. */
    seat: V3;
    /** Torso lean forward (+) / back (-), and roll (+ = toward -X, the right). */
    pitch: number;
    roll: number;
    twist?: number;
    headYaw: number;
    headPitch: number;
    /** Hand targets, ground space [left (+X), right (-X)]. */
    hands: [V3, V3];
    /** Elbow directions [left, right]. */
    poles?: [V3, V3];
    /** Hat offset above its seat on the head, and tilt. */
    hatLift?: number;
    hatTilt?: number;
}

export function poseFigure(bones: THREE.Bone[], b: FigureBones, p: FigurePose): void {
    const d = FIGURE_DIMS;
    const qT = _qT.setFromEuler(_e.set(p.pitch, p.twist ?? 0, -p.roll, 'ZXY'));
    const qP = _qP.setFromEuler(_e.set(0, 0, -p.roll * 0.4, 'ZXY'));
    const mT = _mT.compose(p.seat, qT, ONE);
    bones[b.pelvis]!.matrixWorld.compose(p.seat, qP, ONE);
    bones[b.torso]!.matrixWorld.copy(mT);
    const qH = _qH.setFromEuler(_e.set(p.headPitch, p.headYaw, -p.roll * 0.4, 'ZYX'));
    const neck = V(0, d.torso + 1, 0).applyMatrix4(mT);
    const head = neck.clone().add(V(0, d.headR * 1.12, d.headR * 0.05).applyQuaternion(qH));
    bones[b.head]!.matrixWorld.compose(head, qH, ONE);
    if (b.hat !== undefined) {
        const qHat = qH.clone().multiply(_qP.setFromEuler(_e.set(-(p.hatTilt ?? 0), 0, (p.hatTilt ?? 0) * 0.5, 'XYZ')));
        bones[b.hat]!.matrixWorld.compose(head.clone().add(V(0, p.hatLift ?? 0, 0)), qHat, ONE);
    }
    const mid = V();
    const end = V();
    for (const i of [0, 1]) {
        const s = i === 0 ? 1 : -1;
        const shoulder = V(s * d.shoulder, d.torso - 5, -1).applyMatrix4(mT);
        const pole = p.poles?.[i] ?? V(s * 0.7, -1, -0.4).normalize();
        ik(shoulder, p.hands[i]!, d.uarm, d.farm, pole, mid, end);
        frameM(shoulder, mid.clone().sub(shoulder), V(1, 0, 0), bones[b.uarm[i]!]!.matrixWorld);
        frameM(mid, end.clone().sub(mid), V(1, 0, 0), bones[b.farm[i]!]!.matrixWorld);
    }
}

// ---------------------------------------------------------------------------------------------
// Steering wheel (bone-local: center at the origin, the column along +Y toward the driver)
// ---------------------------------------------------------------------------------------------

export function buildSteeringWheel(kit: Kit, bone: number, r: number, rim: THREE.Color, hub: THREE.Color): void {
    const q = kit.q;
    kit.add(new THREE.TorusGeometry(r, 1.9, 8, 24).rotateX(Math.PI / 2), 'matte', rim, bone);
    kit.add(new THREE.CylinderGeometry(r * 0.32, r * 0.36, 3, q.cyl).translate(0, 0.5, 0), 'satin', hub, bone);
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const dir = V(Math.sin(a + Math.PI), 0, Math.cos(a + Math.PI));
        kit.add(tube(q, dir.clone().multiplyScalar(r * 0.3), dir.clone().multiplyScalar(r), 1.5), 'satin', hub, bone);
    }
    kit.add(new THREE.CylinderGeometry(2.2, 2.4, 16, q.cyl).translate(0, -8, 0), 'satin', hub, bone);
}

/** Matrix of a steering wheel at `center` whose column points along `axis`, turned by `angle`. */
export function steeringM(center: V3, axis: V3, angle: number, out = new THREE.Matrix4()): THREE.Matrix4 {
    frameM(center, axis, V(1, 0, 0), out);
    return out.multiply(_m.makeRotationY(angle));
}

/** Grip points (left, right) of a steering wheel posed by `m` (at 10 and 2 o'clock). */
export function wheelGrips(m: THREE.Matrix4, r: number): [V3, V3] {
    return [V(r * 0.87, 0, r * 0.5).applyMatrix4(m), V(-r * 0.87, 0, r * 0.5).applyMatrix4(m)];
}

// ---------------------------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------------------------

/** Shows a car on a turntable of road with its state from the URL (shared by the car viewers). */
export function carViewer(car: CarRig, groundY: number): { object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } } {
    const root = new THREE.Group();
    const lift = new THREE.Group();
    lift.position.y = -groundY;
    lift.add(car.body, ...car.wheels);
    root.add(lift);
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(420, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.9 }),
    );
    ground.receiveShadow = true;
    root.add(ground);
    const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
    const state: VehicleState = {
        timeSec: 0,
        steer: num('steer', 0),
        speed: num('speed', 60),
        drifting: num('drift', 0),
        boosting: num('boost', 0) > 0,
        airborne: num('air', 0) > 0,
        wheelie: false,
        trick: -1,
        braking: num('brake', 0) > 0,
    };
    const trick = viewerTrick(q, state, lift, groundY, false);
    const w = globalThis as unknown as Record<string, unknown>;
    w.__car = state;
    w.__carStats = car.stats();
    const t0 = performance.now();
    ground.onBeforeRender = () => {
        state.timeSec = (performance.now() - t0) / 1000;
        trick();
        car.update(state);
    };
    return { object: root, camera: { pos: [-420, 260, 520], target: [0, 70, 0] } };
}
