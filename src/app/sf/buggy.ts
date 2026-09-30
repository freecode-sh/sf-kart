/**
 * The Tour Kart: a bright yellow open two-seater on three wheels (one steering wheel up front, two
 * at the back under their own fenders) with a roll bar and a tour speaker. The driver is a tourist
 * in a bucket hat and sunglasses who leans into the turns (the hat bounces on jumps); the passenger
 * snaps photos on tricks. The turn signals blink while it slides, the tail lights brighten on the
 * brakes, and both are pressed back into their seats on boosts. Tricks: rollercoaster hands up on
 * a flip (the driver lets go of the wheel), a fist pump out of the spin on a side trick.
 *
 * Drives as a heavy kart (see vehicles.ts). The physics keeps that kart's four wheels (x ±63 front
 * at z 75, radius 19; ±70 rear at z -84, radius 26; ground at kart-local y ~ -21): the single
 * front wheel is drawn between the two front physics wheels. Generic by design: no brand, logo or
 * lettering.
 */

import * as THREE from 'three';
import {
    archBand,
    archCut,
    buildCarWheel,
    buildFigure,
    buildSteeringWheel,
    carViewer,
    CarRig,
    FIGURE_DIMS,
    poseFigure,
    steeringM,
    wheelGrips,
    type CarPose,
    type FigureBones,
} from './carKit';
import { clamp, ellipsoid, grid, Kit, lerp, rbox, sideSolid, SIDES, tube, V } from './modelKit';

/** Kart-local height of the ground under the buggy. */
const GROUND_Y = -21;
const PHYS_FRONT_Y = 19;
const FRONT = { z: 75, y: 22, r: 22 };
const REAR = { z: -84, y: 26, r: 26, x: 70 };

const B_WHEEL = 1;
const DRIVER: FigureBones = { pelvis: 2, torso: 3, head: 4, uarm: [5, 6], farm: [7, 8], hat: 9 };
const RIDER: FigureBones = { pelvis: 10, torso: 11, head: 12, uarm: [13, 14], farm: [15, 16] };
const BONES = 17;

/** Driver on the left (+X). */
const WHEEL_C = V(25, 90, 14);
const WHEEL_AXIS = V(0, 0.62, -0.78).normalize();
const WHEEL_R = 12;
/** Seat height of the driver and the passenger. */
const SEAT_Y = 64;

const c = (x: number | string) => new THREE.Color(x);

class Buggy extends CarRig {
    readonly exhaust = V(-22, 30 + GROUND_Y, -118);
    protected override steerWheels = [0];
    protected override steerMax = 0.4;
    /** Bucket hat spring (lift, velocity). */
    private hat = 0;
    private hatV = 0;

    constructor() {
        super(GROUND_Y, BONES);
        const q = this.q;
        const kit = new Kit(q);
        const add = kit.add.bind(kit);
        const P = {
            paint: c(0xf6c21a),
            black: c(0x17181b),
            trim: c(0x2f3237),
            chrome: c(0xdfe4ea),
            glass: c(0xb9dcf2),
            seat: c(0x2a2c31),
            head: c(0xfff4d6),
            tail: c(0xff2a1c),
            amber: c(0xffa020),
            cream: c(0xf6efe0),
        };

        // --- The tub: a side outline (nose over the front wheel, a low cockpit rim, the engine deck).
        const tub: [number, number][] = [
            [112, 50],
            [104, 40],
            ...archCut(FRONT.z, FRONT.y, FRONT.r + 6, 40, 12),
            [48, 34],
            [40, 16],
            [30, 13],
            [-94, 13],
            [-108, 22],
            [-114, 42],
            [-112, 62],
            [-98, 71],
            [-64, 73],
            [-58, 63],
            [26, 63],
            [36, 72],
            [50, 82],
            [66, 81],
            [86, 75],
            [102, 67],
            [111, 59],
        ];
        const tubW = (z: number, y: number) => {
            let w = 54;
            if (z > 20) w -= (z - 20) * 0.42;
            if (z < -92) w -= (-92 - z) * 0.75;
            if (y < 24) w -= (24 - y) * 0.6;
            if (y > 66 && z > 30) w -= (y - 66) * 0.3;
            return Math.max(8, w);
        };
        add(sideSolid(q, tub, tubW, 9, false), 'gloss', P.paint);
        add(archBand(q, 0, FRONT.z, FRONT.y, FRONT.r + 5, 0.6, Math.PI - 0.6, 2, tubW(FRONT.z, 44) - 2), 'matte', P.black); // front wheel well
        for (const s of SIDES) {
            add(rbox(q, V(3, 7, 150), V(s * (tubW(-20, 36) + 0.6), 36, -22), undefined, 2), 'satin', P.trim); // rub rail
            add(rbox(q, V(1.5, 3, 150), V(s * (tubW(-20, 56) + 0.4), 56, -22), undefined, 1), 'gloss', P.black); // pinstripe
            add(new THREE.CylinderGeometry(8, 8, 1.2, q.cyl * 2).rotateZ(Math.PI / 2).translate(s * (tubW(-80, 48) + 0.4), 48, -80), 'gloss', P.cream); // roundel
            add(new THREE.CylinderGeometry(9.5, 9.5, 1, q.cyl * 2).rotateZ(Math.PI / 2).translate(s * (tubW(-80, 48) + 0.2), 48, -80), 'gloss', P.black);
        }

        // --- Rear wheels hang outside the tub on fenders and stays.
        for (const s of SIDES) {
            add(archBand(q, s * REAR.x, REAR.z, REAR.y, REAR.r + 6, 0.2, Math.PI - 0.2, 3, 12), 'gloss', P.paint);
            add(rbox(q, V(20, 6, 10), V(s * 60, 52, REAR.z), undefined, 2), 'satin', P.trim);
            add(rbox(q, V(6, 4, 8), V(s * 74, 50, REAR.z - REAR.r - 3), undefined, 1.5), 'brake', P.tail);
        }

        // --- Nose: round headlamp with a chrome bezel, blinkers, a little windscreen and dash.
        add(ellipsoid(q, V(0, 64, 110), V(9, 9, 5)), 'light', P.head);
        add(new THREE.TorusGeometry(9.5, 1.8, 6, q.cyl * 2).translate(0, 64, 111), 'chrome', P.chrome);
        for (const s of SIDES) add(ellipsoid(q, V(s * 17, 58, 105), V(3.5, 2.6, 3), undefined, true), 'blink', P.amber);
        add(
            grid(10, 5, (u, v, o) => {
                const x = (u * 2 - 1) * 36 * (1 - 0.15 * v);
                o.set(x, 82 + v * 22, 50 - v * 8 - x * x * 0.004);
            }),
            'glass',
            P.glass,
        );
        add(rbox(q, V(76, 8, 14), V(0, 84, 38), new THREE.Euler(-0.2, 0, 0), 3), 'matte', P.black);
        add(new THREE.CylinderGeometry(4.5, 4.5, 2, q.cyl).rotateX(1.2).translate(-12, 88.5, 36), 'gloss', P.cream);

        // --- Cockpit: two bucket seats, the roll bar and the tour speaker.
        for (const s of SIDES) {
            add(rbox(q, V(34, 7, 32), V(s * 25, 64, -26), undefined, 3), 'matte', P.seat);
            add(rbox(q, V(34, 40, 8), V(s * 25, 84, -46), new THREE.Euler(-0.2, 0, 0), 4), 'matte', P.seat);
        }
        const hoop = new THREE.CatmullRomCurve3([V(50, 60, -56), V(49, 110, -56), V(40, 128, -56), V(0, 131, -56), V(-40, 128, -56), V(-49, 110, -56), V(-50, 60, -56)]);
        add(new THREE.TubeGeometry(hoop, 36, 2.8, 10, false), 'chrome', P.chrome);
        add(rbox(q, V(24, 15, 12), V(0, 139, -56), undefined, 3), 'satin', P.black);
        add(new THREE.CylinderGeometry(5, 5, 1, q.cyl).rotateX(Math.PI / 2).translate(-5, 139, -49.6), 'satin', P.trim);
        add(new THREE.CylinderGeometry(5, 5, 1, q.cyl).rotateX(Math.PI / 2).translate(5, 139, -49.6), 'satin', P.trim);

        // --- Engine deck vents and a little exhaust.
        for (let i = 0; i < 3; ++i) add(rbox(q, V(56, 1.5, 5), V(0, 72.5 - i * 0.5, -76 - i * 9), new THREE.Euler(-0.08, 0, 0), 0.6), 'satin', P.black);
        add(tube(q, V(-22, 30, -104), V(-22, 30, -118), 3.6), 'chrome', P.chrome);

        buildSteeringWheel(kit, B_WHEEL, WHEEL_R, P.black, P.trim);
        buildFigure(kit, DRIVER, {
            top: c(0x1f9e89),
            bottom: c(0xc2a878),
            skin: c(0xf1c7a3),
            hair: c(0x7b4a2a),
            shoes: c(0xf4f4f4),
            hat: { kind: 'bucket', color: c(0xd9c7a0), band: c(0x6b5a3e) },
            sunglasses: true,
        });
        buildFigure(kit, RIDER, {
            top: c(0xf07e5c),
            bottom: c(0x3b5b8c),
            skin: c(0x8d5a3b),
            hair: c(0x1b1411),
            shoes: c(0x2b2b2e),
            camera: true,
        });

        const rim = c(0xe9e4d6);
        const tire = c(0x1b1b1e);
        this.finish(kit, [
            { obj: buildCarWheel(q, this.mats, { r: FRONT.r, width: 18, tire, rim, rimFinish: 'gloss', hub: P.chrome, spokes: 6, rimFrac: 0.62 }), center: V(0, FRONT.y, FRONT.z), r: FRONT.r },
            { obj: buildCarWheel(q, this.mats, { r: REAR.r, width: 22, tire, rim, rimFinish: 'gloss', hub: P.chrome, spokes: 6, rimFrac: 0.62, face: 1 }), center: V(REAR.x, REAR.y, REAR.z), r: REAR.r },
            { obj: buildCarWheel(q, this.mats, { r: REAR.r, width: 22, tire, rim, rimFinish: 'gloss', hub: P.chrome, spokes: 6, rimFrac: 0.62, face: -1 }), center: V(-REAR.x, REAR.y, REAR.z), r: REAR.r },
        ]);
    }

    /** One front wheel between the two front physics wheels; the rear ones where the physics has them. */
    override placeWheels(centers: readonly THREE.Vector3[]): void {
        const [fl, fr, rl, rr] = centers;
        if (!fl || !fr || !rl || !rr) return;
        this.wheels[0]!.position.copy(fl).add(fr).multiplyScalar(0.5).add(V(0, FRONT.r - PHYS_FRONT_Y, 0));
        this.wheels[1]!.position.copy(rl);
        this.wheels[2]!.position.copy(rr);
    }

    protected pose(p: CarPose): void {
        const { t, dt, st, dr, tw, tuck, air, spd } = p;
        const spin = p.trickType >= 3;
        const side = p.trickType === 3 ? 1 : -1; // the side the spin turns toward (+X = left)
        const flip = spin ? 0 : tw;
        const pump = spin ? tw : 0;
        const mW = steeringM(WHEEL_C, WHEEL_AXIS, -st * 1.6 - dr * 0.5);
        this.bones[B_WHEEL]!.matrixWorld.copy(mW);
        const flash = tw > 0.6 && Math.sin(t * 23) > 0.75 ? 1 : 0;
        const blinker = Math.abs(p.raw.drifting) > 0 && Math.sin(t * Math.PI * 3) > 0 ? 1 : 0;
        this.blink(Math.max(flash, blinker));

        // Hat on a spring: it lifts off on jumps and wobbles back down.
        const target = air * 9 + tw * 12;
        this.hatV += ((target - this.hat) * 120 - this.hatV * 9) * Math.min(dt, 0.05);
        this.hat += this.hatV * Math.min(dt, 0.05);
        this.hat = clamp(this.hat, -2, 16);

        const d = FIGURE_DIMS;
        const y = SEAT_Y - p.land * 4;
        // Driver: hands on the wheel, leans into the turn, pressed back on boost. Tricks: both hands
        // up on a flip; on a spin the outside hand punches up and out.
        const dSeat = V(25 - st * 2 - dr * 3, y, -28);
        const grips = wheelGrips(mW, WHEEL_R);
        const wob = Math.sin(t * 11) * 4;
        const handsUp: [THREE.Vector3, THREE.Vector3] = [dSeat.clone().add(V(30 + wob, d.torso + 40, 14)), dSeat.clone().add(V(-22 + wob, d.torso + 42, 14))];
        const fist = dSeat.clone().add(V(-side * 30, d.torso + 36, 4 + wob));
        const pumpHand = side > 0 ? 1 : 0; // the hand on the outside of the spin
        const dHands: [THREE.Vector3, THREE.Vector3] = [grips[0].clone().lerp(handsUp[0], flip), grips[1].clone().lerp(handsUp[1], flip)];
        dHands[pumpHand]!.lerp(fist, pump);
        poseFigure(this.bones, DRIVER, {
            seat: dSeat,
            pitch: 0.06 - tuck * 0.1 - air * 0.05 - flip * 0.12 + p.land * 0.08,
            roll: st * 0.16 + dr * 0.2 + pump * side * 0.12,
            headYaw: -st * 0.35 - dr * 0.2 + Math.sin(t * 0.3) * 0.08 * (1 - Math.min(1, spd)),
            headPitch: 0.04 - flip * 0.2,
            hands: dHands,
            poles: [V(lerp(0.7, 1, tw), lerp(-1, 0, tw), -0.4).normalize(), V(lerp(-0.7, -1, tw), lerp(-1, 0, tw), -0.4).normalize()],
            hatLift: this.hat,
            hatTilt: this.hat * 0.03 + Math.sin(t * 9) * this.hatV * 0.002,
        });
        // Passenger: sightseeing (looks off to the right), camera up for a photo on tricks.
        const seat = V(-25 - st * 2 - dr * 3, y, -28);
        const face = seat.clone().add(V(3, d.torso + 12, 22));
        const rest: [THREE.Vector3, THREE.Vector3] = [seat.clone().add(V(14, 8, 24)), V(-52, y + 2, -10)];
        const snap: [THREE.Vector3, THREE.Vector3] = [face.clone().add(V(10, -3, 2)), face.clone().add(V(-2, -2, 3))];
        poseFigure(this.bones, RIDER, {
            seat,
            pitch: lerp(-0.04, 0.06, tw) - tuck * 0.1 + p.land * 0.08,
            roll: st * 0.14 + dr * 0.18,
            headYaw: lerp(-0.45 + Math.sin(t * 0.45) * 0.55 - st * 0.2, 0, tw),
            headPitch: lerp(0.02, 0.1, tw),
            hands: [rest[0].lerp(snap[0], tw), rest[1].lerp(snap[1], tw)],
            poles: [V(0.8, -1, -0.3).normalize(), V(lerp(-1, -0.6, tw), lerp(-0.6, -1, tw), -0.2).normalize()],
        });
    }
}

export function buildBuggy(): Buggy {
    return new Buggy();
}

/** Standalone viewer (sfviewer.html?model=buggy[&steer=1&drift=1&boost=1&brake=1&speed=80&air=1][&trick=1..4[&trickT=0.5][&rot=1]]; see vehicleModel.ts viewerTrick). */
export function viewerBuild(): { object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } } {
    return carViewer(new Buggy(), GROUND_Y);
}
