/**
 * The Robotaxi: a white electric crossover with a roof sensor dome (its lidar spins with speed and
 * faster on boost), sensor pods on the fenders and corners, and nobody in the driver's seat. The
 * steering wheel turns by itself; a passenger rides in the back. Hazards blink while it slides, the
 * tail lights brighten on the brakes. Tricks: the lidar pops up on its mast and spins flat out, the
 * empty steering wheel spins round, and the passenger braces both hands on the roof (flips) or
 * waves out of the window (spins).
 *
 * Drives as a heavy kart (see vehicles.ts); built around that kart's wheel layout (physics wheel
 * centers at x ±61, z 87 / -100, radius 28 / 31, ground at kart-local y ~ -58). Generic by design:
 * no brand, logo or lettering.
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
    type CarPose,
    type FigureBones,
} from './carKit';
import { ellipsoid, Kit, lerp, rbox, sideSolid, SIDES, tube, V } from './modelKit';

/** Kart-local height of the ground under the car. */
const GROUND_Y = -58;
const FRONT = { z: 87, y: 28, r: 28, x: 61 };
const REAR = { z: -100, y: 31, r: 31, x: 61 };

const B_WHEEL = 1;
const B_LIDAR = 2;
const FIG: FigureBones = { pelvis: 3, torso: 4, head: 5, uarm: [6, 7], farm: [8, 9] };
const BONES = 10;

/** Steering wheel (driver on the left, +X), its column pointing up and back at the empty seat. */
const WHEEL_C = V(31, 95, 36);
const WHEEL_AXIS = V(0, 0.5, -0.87).normalize();
const WHEEL_R = 13;
/** Lidar head on top of the dome. */
const LIDAR = V(0, 148, -36);
/** The passenger's seat (in the back, on the right). */
const SEAT = V(-30, 56, -80);

const c = (x: number | string) => new THREE.Color(x);

class Robotaxi extends CarRig {
    readonly exhaust = V(0, 30 + GROUND_Y, -150);
    protected override steerWheels = [0, 1];
    protected override steerMax = 0.34;
    private lidarSpin = 0;
    private wheelSpin = 0;

    constructor() {
        super(GROUND_Y, BONES);
        const q = this.q;
        const kit = new Kit(q);
        const add = kit.add.bind(kit);
        const P = {
            paint: c(0xf1f2ef),
            clad: c(0x2b2e33),
            black: c(0x16181b),
            trim: c(0x3a3f46),
            glass: c(0x9fc6e0),
            head: c(0xfff6e0),
            tail: c(0xff2a1c),
            amber: c(0xffa020),
            teal: c(0x2fd0c4),
            seat: c(0x3b3f47),
            chrome: c(0xd8dde3),
        };

        // --- Body: one side outline with the wheel arches cut in, rounded across the width.
        const sill = 18;
        const body: [number, number][] = [
            [138, 24],
            [128, sill],
            ...archCut(FRONT.z, FRONT.y, FRONT.r + 9, sill, 14),
            ...archCut(REAR.z, REAR.y, REAR.r + 9, sill, 14),
            [-144, sill + 2],
            [-151, 36],
            [-153, 66],
            [-149, 88],
            [-120, 91],
            [-40, 89],
            [40, 87],
            [62, 85],
            [92, 79],
            [120, 72],
            [136, 64],
            [144, 52],
            [145, 38],
        ];
        const bodyW = (z: number, y: number) => {
            let w = 75;
            if (z > 98) w -= (z - 98) ** 2 * 0.0058;
            if (z < -118) w -= (-118 - z) ** 2 * 0.0085;
            if (y > 66) w -= (y - 66) * 0.32;
            if (y < 28) w -= (28 - y) * 0.25;
            return Math.max(8, w);
        };
        add(sideSolid(q, body, bodyW, 10, false), 'gloss', P.paint);
        // Dark wheel wells (nothing to see through) and cladding bands over the arches.
        for (const w of [FRONT, REAR]) {
            add(rbox(q, V(96, 30, (w.r + 8) * 2), V(0, w.y + 6, w.z), undefined, 4), 'matte', P.black);
            for (const s of SIDES) add(archBand(q, s * (bodyW(w.z, 40) + 1), w.z, w.y, w.r + 10, 0.05, Math.PI - 0.05, 3.2, 5), 'satin', P.clad);
        }
        // Lower cladding along the sills and the bumpers.
        for (const s of SIDES) add(rbox(q, V(5, 9, 104), V(s * 71, 22, -6), undefined, 2), 'satin', P.clad);
        add(rbox(q, V(100, 10, 8), V(0, 25, 134), new THREE.Euler(0.35, 0, 0), 4), 'satin', P.clad);
        add(rbox(q, V(108, 10, 8), V(0, 26, -143), new THREE.Euler(-0.35, 0, 0), 4), 'satin', P.clad);

        // --- Greenhouse: tinted glass all round (you can see there's no driver), black pillars, a white roof.
        const glass: [number, number][] = [[66, 82], [14, 126], [-100, 126], [-138, 92], [-138, 82]];
        const glassW = (z: number, y: number) => 68 - (y - 82) * 0.26 - Math.max(0, -112 - z) * 0.25;
        add(sideSolid(q, glass, glassW, 6, false), 'glass', P.glass);
        const roof: [number, number][] = [[18, 123], [-102, 123], [-108, 128], [-100, 132], [12, 133], [20, 128]];
        add(sideSolid(q, roof, () => 57.5, 4, false), 'gloss', P.paint);
        for (const s of SIDES) {
            add(tube(q, V(s * 66, 83, 64), V(s * 57, 125, 16), 3.6), 'gloss', P.black); // A
            add(tube(q, V(s * 67.5, 83, -34), V(s * 57.5, 125, -34), 4.2), 'gloss', P.black); // B
            add(tube(q, V(s * 66, 84, -126), V(s * 57, 125, -100), 6), 'gloss', P.black); // C
            add(rbox(q, V(2.5, 3, 200), V(s * 69, 84, -36), undefined, 1), 'gloss', P.black); // belt trim
        }

        // --- Doors, handles, mirrors (each with a camera pod).
        for (const s of SIDES) {
            for (const z of [50, -34, -104]) add(rbox(q, V(1.4, 58, 1.4), V(s * (bodyW(z, 55) + 0.2), 55, z), undefined, 0.6), 'matte', P.trim);
            for (const z of [18, -66]) add(rbox(q, V(2, 3, 14), V(s * (bodyW(z, 72) + 0.8), 72, z), undefined, 1.2), 'satin', P.chrome);
            add(tube(q, V(s * 66, 88, 56), V(s * 76, 92, 54), 2), 'gloss', P.black);
            add(ellipsoid(q, V(s * 80, 94, 53), V(8, 6, 5)), 'gloss', P.paint);
            add(ellipsoid(q, V(s * 83, 90, 55), V(3, 3, 3), undefined, true), 'gloss', P.black);
        }

        // --- Lights: slim wraparound headlights, a full-width tail bar, amber corners (blink).
        for (const s of SIDES) {
            add(rbox(q, V(30, 5, 6), V(s * 46, 61, 138.5), new THREE.Euler(0.45, s * 0.5, 0), 2.2), 'light', P.head);
            add(rbox(q, V(10, 3, 4), V(s * 64, 58, 126), new THREE.Euler(0, s * 1.05, 0), 1.4), 'blink', P.amber);
            add(rbox(q, V(10, 4, 4), V(s * 67, 80, -141), new THREE.Euler(0, -s * 0.9, 0), 1.4), 'blink', P.amber);
            add(rbox(q, V(16, 5, 4), V(s * 60, 80, -146.5), new THREE.Euler(0, -s * 0.5, 0), 1.6), 'brake', P.tail);
        }
        add(rbox(q, V(92, 3, 3), V(0, 81, -150.5), undefined, 1), 'brake', P.tail);
        add(rbox(q, V(76, 5, 3), V(0, 37, 144), new THREE.Euler(0.3, 0, 0), 2), 'satin', P.black); // intake

        // --- Sensors: the roof dome with a spinning lidar and a teal status ring, fender pods, corner
        // radars, a nose puck.
        add(new THREE.CylinderGeometry(25, 27, 8, q.cyl * 2).translate(0, 136, -36), 'satin', P.black);
        add(new THREE.TorusGeometry(25.5, 1.4, 6, q.cyl * 2).rotateX(Math.PI / 2).translate(0, 137, -36), 'light', P.teal);
        add(new THREE.LatheGeometry([[0.1, 140], [24, 140], [23.5, 144], [18, 148.5], [0.1, 149]].map(([r, y]) => new THREE.Vector2(r, y)), q.lathe * 2).translate(0, 0, -36), 'gloss', P.paint);
        for (const s of SIDES) {
            // Fender pods: a white housing on the wing with a dark lens and a small lidar on top.
            add(rbox(q, V(11, 14, 20), V(s * 64, 90, 84), new THREE.Euler(0, 0, -s * 0.12), 4.5), 'gloss', P.paint);
            add(ellipsoid(q, V(s * 69, 91, 86), V(3, 5.5, 8)), 'gloss', P.black);
            add(new THREE.CylinderGeometry(4.2, 4.6, 5, q.cyl).translate(s * 64, 99, 84), 'satin', P.black);
            // Rear corner pods on the shoulders.
            add(rbox(q, V(9, 10, 13), V(s * 62, 93, -132), undefined, 3.5), 'gloss', P.paint);
            add(ellipsoid(q, V(s * 65.5, 93, -135), V(3, 4, 5)), 'gloss', P.black);
            add(rbox(q, V(10, 8, 4), V(s * 55, 36, 141), new THREE.Euler(0, s * 0.3, 0), 2), 'satin', P.black);
        }
        add(new THREE.CylinderGeometry(5.5, 6, 6, q.cyl).rotateX(Math.PI / 2).translate(0, 55, 146), 'satin', P.black);
        // Lidar head (spins): a black drum with a bright scan window, on a mast that stays inside the
        // dome until a trick pops it up.
        add(new THREE.CylinderGeometry(5, 6, 20, q.cyl).translate(0, -10, 0), 'chrome', P.chrome, B_LIDAR);
        add(new THREE.CylinderGeometry(12.5, 13.5, 13, q.cyl * 2).translate(0, 6.5, 0), 'satin', P.black, B_LIDAR);
        add(new THREE.CylinderGeometry(13.6, 13.6, 4, q.cyl * 2, 1, true, -0.5, 1).translate(0, 7, 0), 'light', P.teal, B_LIDAR);
        add(new THREE.CylinderGeometry(10, 12.5, 3, q.cyl * 2).translate(0, 14.5, 0), 'gloss', P.paint, B_LIDAR);

        // --- Interior (above the beltline): dash, the empty driver's seat, the wheel, seats, screens.
        add(rbox(q, V(126, 12, 26), V(0, 86, 52), new THREE.Euler(-0.15, 0, 0), 5), 'matte', P.seat);
        add(rbox(q, V(26, 1.5, 10), V(-26, 92.5, 48), new THREE.Euler(-0.5, 0, 0), 0.6), 'light', P.teal);
        for (const s of SIDES) {
            add(rbox(q, V(40, 42, 10), V(s * 31, 98, -14), new THREE.Euler(-0.18, 0, 0), 5), 'matte', P.seat);
            add(rbox(q, V(24, 12, 10), V(s * 31, 124, -20), new THREE.Euler(-0.18, 0, 0), 4), 'matte', P.seat);
            add(rbox(q, V(26, 15, 1.2), V(s * 31, 101, -20.5), new THREE.Euler(-0.18, 0, 0), 0.5), 'light', P.teal.clone().multiplyScalar(0.55));
            add(rbox(q, V(40, 30, 10), V(s * 31, 94, -104), new THREE.Euler(-0.25, 0, 0), 5), 'matte', P.seat);
        }
        buildSteeringWheel(kit, B_WHEEL, WHEEL_R, P.black, P.trim);

        // --- The passenger.
        buildFigure(kit, FIG, {
            top: c(0x3a5a8c),
            bottom: c(0x2d3340),
            skin: c(0xc98f68),
            hair: c(0x2a1d16),
            shoes: c(0xf0f0f0),
        });

        const wheel = (f: typeof FRONT, face: number) =>
            buildCarWheel(q, this.mats, { r: f.r, width: 26, tire: c(0x1b1b1e), rim: c(0xb9bec6), rimFinish: 'satin', hub: P.black, spokes: 5, rimFrac: 0.7, turbine: true, face });
        this.finish(kit, [
            { obj: wheel(FRONT, 1), center: V(FRONT.x, FRONT.y, FRONT.z), r: FRONT.r },
            { obj: wheel(FRONT, -1), center: V(-FRONT.x, FRONT.y, FRONT.z), r: FRONT.r },
            { obj: wheel(REAR, 1), center: V(REAR.x, REAR.y, REAR.z), r: REAR.r },
            { obj: wheel(REAR, -1), center: V(-REAR.x, REAR.y, REAR.z), r: REAR.r },
        ]);
    }

    protected pose(p: CarPose): void {
        const { t, st, dr, tw, tuck, spd } = p;
        // The steering wheel turns itself (a lot: it's a real steering ratio); in a trick nobody holds
        // it and it spins round, settling back to the steering once the pose lets go.
        this.wheelSpin = tw > 0.02 ? this.wheelSpin + p.dt * 14 * tw : this.wheelSpin * Math.max(0, 1 - p.dt * 6);
        const mW = steeringM(WHEEL_C, WHEEL_AXIS, -st * 2.1 - dr * 0.6 + this.wheelSpin);
        this.bones[B_WHEEL]!.matrixWorld.copy(mW);
        // Lidar: always scanning, faster with speed and much faster on boost; a trick pops it up on
        // its mast, spinning flat out.
        this.lidarSpin = (this.lidarSpin + p.dt * (5 + spd * 10) * (1 + tuck * 2 + tw * 5)) % (Math.PI * 2);
        this.bones[B_LIDAR]!.matrixWorld.makeRotationY(this.lidarSpin).setPosition(LIDAR.clone().add(V(0, tw * 15, 0)));
        // Hazards while sliding.
        this.blink(Math.abs(p.raw.drifting) > 0 && Math.sin(t * Math.PI * 3) > 0 ? 1 : 0);

        // The passenger: sits back, looks out of the window, sways in turns, is pressed into the seat
        // on boosts and bounces on landings. Tricks: both hands braced on the roof on a flip, a wave out of the
        // window on a spin.
        const d = FIGURE_DIMS;
        const seat = SEAT.clone().add(V(-st * 1.5 - dr * 2.5, -p.land * 3, 0));
        const look = Math.sin(t * 0.37) * 0.5 + Math.sin(t * 0.11) * 0.4;
        const lap: [THREE.Vector3, THREE.Vector3] = [V(seat.x + 9, seat.y + 6, seat.z + 22), V(seat.x - 9, seat.y + 6, seat.z + 22)];
        const spin = p.trickType >= 3;
        const up = spin ? 0 : tw;
        const wv = spin ? tw : 0;
        const sway = Math.sin(t * 12) * 4;
        const raised: [THREE.Vector3, THREE.Vector3] = [V(seat.x + 14 + sway, seat.y + d.torso + 28, seat.z + 10), V(seat.x - 14 + sway, seat.y + d.torso + 28, seat.z + 10)];
        const wave = V(seat.x - 24 + Math.sin(t * 14) * 5, seat.y + d.torso + 26, seat.z + 14);
        const hands: [THREE.Vector3, THREE.Vector3] = [lap[0].clone().lerp(raised[0], up), lap[1].clone().lerp(raised[1], up).lerp(wave, wv)];
        poseFigure(this.bones, FIG, {
            seat,
            pitch: lerp(-0.12, 0.05, wv) - up * 0.1 - tuck * 0.12 + p.land * 0.08,
            roll: st * 0.09 + dr * 0.14,
            headYaw: lerp(lerp(look, -0.9, wv), 0, up) - st * 0.25,
            headPitch: 0.05 - up * 0.3,
            hands,
            poles: [V(lerp(0.7, 1, up), lerp(-1, 0.1, up), -0.4).normalize(), V(lerp(-0.7, -1, tw), lerp(-1, 0.2, tw), -0.4).normalize()],
        });
    }
}

export function buildRobotaxi(): Robotaxi {
    return new Robotaxi();
}

/** Standalone viewer (sfviewer.html?model=robotaxi[&steer=1&drift=1&boost=1&brake=1&speed=80][&trick=1..4[&trickT=0.5][&rot=1]]; see vehicleModel.ts viewerTrick). */
export function viewerBuild(): { object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } } {
    return carViewer(new Robotaxi(), GROUND_Y);
}
