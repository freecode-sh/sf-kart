/**
 * The Share E-Bike: a silver bike-share e-bike (fat oval step-through frame with the battery in the
 * downtube, a frame-mounted front basket with a sourdough loaf, full fenders, an enclosed chaincase,
 * a rear hub motor, a comfy saddle) and its rider (half-shell helmet, hoodie, backpack, jeans,
 * sneakers and a scarf for the fog). It's an e-bike: the rider pedals pulling away and at low speed,
 * then the motor carries it and the feet rest level on the pedals (no pedaling when coasting, in the
 * air or in tricks). The rider leans into turns, looks into them, puts the inside foot down in a
 * drift and soaks up landings with the knees; the loaf bounces; the tail light brightens on the
 * brakes. Tricks: a superman (Up), a no-hander (Down), a leg kick with a fist pump to the side the
 * bike swings (Left / Right). Generic by design: no brand, logo or lettering, and silver, not a
 * brand color.
 *
 * Built like the other SF vehicles (vehicleModel.ts): one skinned mesh per material over a detached
 * bone hierarchy posed every frame, wheels as separate objects at the physics wheel centers.
 * Ground space: ground at y = 0, wheel centers at y = 34, +Z forward, +X is the rider's left;
 * `body` shifts that down by GROUND_Y into the kart's local frame (the bike's wheel centers sit at
 * kart-local y ~ -25).
 */

import * as THREE from 'three';
import { archBand, arc } from './carKit';
import { bake, capsule, clamp, disposeModel, ellipsoid, frameM, grid, ik, Kit, latheX, lerp, materials, modelStats, rbox, setBrakeLights, sideSolid, SIDES, smooth, tube, V, type Finish, type Q, type V3 } from './modelKit';
import { DEFAULT_LIVERY, viewerTrick, type Livery, type VehicleModel, type VehicleState } from './vehicleModel';

/** Kart-local height of the ground under the bike. */
const GROUND_Y = -59;
const WHEEL_R = 34;
const FRONT = V(0, WHEEL_R, 81);
const REAR = V(0, WHEEL_R, -75);

// Frame geometry (ground space).
const BB = V(0, 31, -14);
const CRANK_R = 16;
const STEER_AXIS = V(0, 84, -24).normalize();
const HEAD_BOT = FRONT.clone().addScaledVector(STEER_AXIS, 63);
const HEAD_TOP = FRONT.clone().addScaledVector(STEER_AXIS, 88);
const STEM_TOP = FRONT.clone().addScaledVector(STEER_AXIS, 98);
const STEER_PIVOT = HEAD_TOP;
const SEAT_CLUSTER = V(0, 78, -30.5);
const SEAT_TOP = V(0, 99, -38);
const GRIPS = [V(25, 131, 33), V(-25, 131, 33)];
const BASKET = V(0, 101, 92); // center of the basket floor
const EXHAUST = V(0, 58, -98);
/** Speed (units/frame; top speed ~85) up to which the rider pedals; above, the motor carries it. */
const PEDAL_UNTIL = 46;

// Bones.
const B_ROOT = 0;
const B_STEER = 1;
const B_PELVIS = 2;
const B_TORSO = 3;
const B_HEAD = 4;
const B_UARM = [5, 6]; // [left (+X), right (-X)]
const B_FARM = [7, 8];
const B_THIGH = [9, 10];
const B_SHIN = [11, 12];
const B_FOOT = [13, 14];
const B_CRANK = 15;
const B_LOAF = 16;
const SCARF_SEGS = 6;
const B_SCARF = [17, 17 + SCARF_SEGS + 1];
const BONES = 17 + 2 * (SCARF_SEGS + 1);

// Rider dimensions.
const SEAT = V(0, 110, -42);
const TORSO_LEN = 44;
const HEAD_R = 16;
const SHOULDER = V(18, 40, -1); // torso frame (x mirrored)
const HIP = V(9, -2, 1); // pelvis frame
const UARM = 34;
const FARM = 32;
const THIGH = 50;
const SHIN = 48;
const SCARF_LEN = 11;
const SCARF_ROOT = V(4, 47, -10);

const BIKE_Q: Q = { sph: [16, 10], cyl: 10, lathe: 16, curve: 4, bevel: 2 };

interface Palette {
    frame: THREE.Color;
    frameDark: THREE.Color;
    accent: THREE.Color;
    hoodie: THREE.Color;
    hoodieDark: THREE.Color;
    scarf: THREE.Color;
    jeans: THREE.Color;
    skin: THREE.Color;
    hair: THREE.Color;
    shoe: THREE.Color;
    rubber: THREE.Color;
    black: THREE.Color;
    chrome: THREE.Color;
    head: THREE.Color;
    tail: THREE.Color;
    crust: THREE.Color;
    crumb: THREE.Color;
    screen: THREE.Color;
}

function palette(l: Livery): Palette {
    const c = (s: string | number) => new THREE.Color(s);
    return {
        frame: c(0xc3c8cf),
        frameDark: c(0x3b4048),
        accent: c(l.primary),
        hoodie: c(l.accent),
        hoodieDark: c(l.accent).multiplyScalar(0.75),
        scarf: c(l.secondary),
        jeans: c(0x3d5a80),
        skin: c(0xe0ac85),
        hair: c(0x3a271c),
        shoe: c(0xf3f3f1),
        rubber: c(0x1b1b1e),
        black: c(0x1d1f24),
        chrome: c(0xe3e7ec),
        head: c(0xfff3d2),
        tail: c(0xff2418),
        crust: c(0xb9783f),
        crumb: c(0xf0d3a0),
        screen: c(0x2fd0c4),
    };
}

/** A thick flat beam along a side-view centerline (points [z, y]), `thick` tall, 2 * halfW wide. */
function beam(q: Q, pts: [number, number][], thick: number, halfW: number, shift = 0): THREE.BufferGeometry {
    const top: [number, number][] = [];
    const bot: [number, number][] = [];
    pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)]!;
        const b = pts[Math.min(pts.length - 1, i + 1)]!;
        const dz = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dz, dy) || 1;
        const nz = -dy / l;
        const ny = dz / l;
        top.push([p[0] + nz * (thick / 2 + shift), p[1] + ny * (thick / 2 + shift)]);
        bot.push([p[0] - nz * (thick / 2 - shift), p[1] - ny * (thick / 2 - shift)]);
    });
    return sideSolid(q, [...top, ...bot.reverse()], () => halfW, Math.min(thick * 0.3, 4), true);
}

/** The downtube: from under the head tube, swooping low to the bottom bracket (step-through). */
const DOWNTUBE: [number, number][] = [
    [HEAD_BOT.z + 1, HEAD_BOT.y + 3],
    [54, 84],
    [40, 63],
    [24, 45],
    [6, 34],
    [BB.z, BB.y],
];

function buildBike(kit: Kit, P: Palette): void {
    const q = kit.q;
    const add = kit.add.bind(kit);

    // --- Frame: the fat oval downtube (battery on top, an accent stripe), seat tube, stays, head tube.
    add(beam(q, DOWNTUBE, 15, 5.8), 'satin', P.frame);
    add(beam(q, DOWNTUBE.slice(1, 5), 3, 6.1, 3.5), 'gloss', P.accent);
    // The battery rides on top of the downtube (-9 along its normal: up and back).
    add(beam(q, [[52, 81], [42, 66], [31, 52]], 8, 6.6, -9), 'satin', P.frameDark);
    add(rbox(q, V(3, 5, 5), V(6.8, 64.5, 29), new THREE.Euler(0.95, 0, 0), 1), 'gloss', P.accent); // battery lock
    for (let i = 0; i < 4; ++i) add(ellipsoid(q, V(6.9, 80.5 - i * 2.9, 40.5 - i * 2.1), V(0.6, 1.1, 1.1), undefined, true), 'light', P.screen); // charge LEDs
    add(tube(q, BB, SEAT_CLUSTER, 5.2, 4.6), 'satin', P.frame);
    add(tube(q, SEAT_CLUSTER, SEAT_TOP, 2.6), 'chrome', P.chrome);
    add(new THREE.TorusGeometry(5, 1.6, 8, q.cyl + 4).rotateX(Math.PI / 2 - 0.34).translate(SEAT_CLUSTER.x, SEAT_CLUSTER.y + 1, SEAT_CLUSTER.z), 'gloss', P.accent); // QR clamp
    add(tube(q, HEAD_BOT.clone().addScaledVector(STEER_AXIS, -3), HEAD_TOP, 6.2, 5.8), 'satin', P.frame);
    add(rbox(q, V(8, 11, 8), HEAD_BOT.clone().add(V(0, -2, 8)), new THREE.Euler(-0.28, 0, 0), 2), 'satin', P.frameDark); // dock tongue
    for (const s of SIDES) {
        add(tube(q, V(s * 6, BB.y, BB.z - 2), V(s * 7, REAR.y, REAR.z + 2), 2.6, 2.2), 'satin', P.frame);
        add(tube(q, V(s * 4, SEAT_CLUSTER.y - 2, SEAT_CLUSTER.z - 1), V(s * 7, REAR.y + 3, REAR.z + 3), 2.2, 1.9), 'satin', P.frame);
        add(rbox(q, V(2, 9, 9), V(s * 7.5, REAR.y, REAR.z), undefined, 1), 'satin', P.frameDark); // dropouts
    }
    add(new THREE.CylinderGeometry(3.5, 3.5, 26, q.cyl).rotateZ(Math.PI / 2).translate(REAR.x, REAR.y, REAR.z), 'chrome', P.chrome);

    // --- Chaincase (right side), kickstand (left), fenders, rear rack with the tail light.
    const chain: [number, number][] = [
        ...arc(BB.z, BB.y, 12, Math.PI / 2, -Math.PI / 2, 10),
        ...arc(REAR.z, REAR.y, 7.5, -Math.PI / 2, -Math.PI * 1.5, 8),
    ];
    add(sideSolid(q, chain, () => 2.2, 1.6, false).translate(-10, 0, 0), 'satin', P.frameDark);
    add(tube(q, V(7, 29, -24), V(9, 23, -56), 1.8), 'satin', P.black);
    add(archBand(q, 0, REAR.z, REAR.y, WHEEL_R + 5, 0.75, Math.PI - 0.05, 1.6, 9), 'satin', P.frame);
    for (const s of SIDES) {
        add(tube(q, V(s * 7, 82, -46), V(s * 7, 82, -104), 1.5), 'satin', P.frameDark);
        add(tube(q, V(s * 7, 82, -96), V(s * 8, REAR.y + 2, REAR.z - 2), 1.4), 'satin', P.frameDark);
    }
    for (const z of [-60, -76, -92]) add(tube(q, V(7, 82, z), V(-7, 82, z), 1.2), 'satin', P.frameDark);
    add(tube(q, V(0, 82, -46), V(0, SEAT_CLUSTER.y + 1, SEAT_CLUSTER.z - 3), 1.4), 'satin', P.frameDark);
    add(rbox(q, V(10, 6, 4), V(0, 78, -105), undefined, 1.5), 'satin', P.black);
    add(rbox(q, V(8, 4, 1.5), V(0, 78, -107.3), undefined, 0.8), 'brake', P.tail);

    // --- Saddle (wide, padded) on the seatpost.
    const saddle: [number, number][] = [[-22, 103], [-30, 105.5], [-46, 106], [-54, 104], [-54, 99], [-44, 98.5], [-26, 99.5]];
    add(sideSolid(q, saddle, (z) => Math.max(4, 12 - Math.max(0, z + 38) * 0.45), 4), 'matte', P.black);

    // --- Front basket (on the frame, it doesn't steer), headlight, the loaf's crate.
    const bw = 22;
    const bd = 16;
    const bh = 18;
    const b = BASKET;
    add(rbox(q, V(bw * 2, 2, bd * 2), b.clone().add(V(0, 1, 0)), undefined, 1), 'satin', P.black);
    // Wire basket: posts and rails.
    const rail = (y: number) => {
        const pts = [V(bw, y, bd), V(-bw, y, bd), V(-bw, y, -bd), V(bw, y, -bd), V(bw, y, bd)].map((p) => p.add(b));
        for (let i = 0; i < 4; ++i) add(tube(q, pts[i]!, pts[i + 1]!, y === bh ? 1.3 : 0.8, undefined, 6), 'satin', P.black);
    };
    rail(bh);
    rail(bh * 0.5);
    for (let k = 0; k <= 8; ++k) {
        const x = -bw + (k * bw * 2) / 8;
        for (const s of SIDES) add(tube(q, b.clone().add(V(x, 1, s * bd)), b.clone().add(V(x, bh, s * bd)), 0.7, undefined, 5), 'satin', P.black);
    }
    for (let k = 1; k < 6; ++k) {
        const z = -bd + (k * bd * 2) / 6;
        for (const s of SIDES) add(tube(q, b.clone().add(V(s * bw, 1, z)), b.clone().add(V(s * bw, bh, z)), 0.7, undefined, 5), 'satin', P.black);
    }
    // Bungee across the top (accent), struts to the head tube.
    add(tube(q, b.clone().add(V(-bw, bh + 1, 4)), b.clone().add(V(bw, bh + 1, -4)), 1.1), 'gloss', P.accent);
    for (const s of SIDES) {
        add(tube(q, b.clone().add(V(s * 12, 0, -bd + 2)), HEAD_TOP.clone().add(V(s * 3, -4, 2)), 1.6), 'satin', P.frameDark);
        add(tube(q, b.clone().add(V(s * 10, 0, 2)), HEAD_BOT.clone().add(V(s * 4, 0, 3)), 1.6), 'satin', P.frameDark);
    }
    add(rbox(q, V(12, 8, 5), b.clone().add(V(0, 6, bd + 3)), undefined, 2), 'satin', P.black);
    add(ellipsoid(q, b.clone().add(V(0, 6, bd + 5.4)), V(4.5, 3.2, 1)), 'light', P.head);

    // --- Steering assembly (steer bone): fork, front fender, stem, swept-back bar, grips, bell, display.
    const st = B_STEER;
    add(rbox(q, V(20, 5, 8), HEAD_BOT.clone().addScaledVector(STEER_AXIS, -4), new THREE.Euler(-0.28, 0, 0), 2), 'satin', P.frame, st);
    for (const s of SIDES) add(tube(q, V(s * 8, FRONT.y, FRONT.z), HEAD_BOT.clone().add(V(s * 8, 0, 0)).addScaledVector(STEER_AXIS, -4), 2.6, 3.2), 'satin', P.frame, st);
    add(new THREE.CylinderGeometry(2.6, 2.6, 20, q.cyl).rotateZ(Math.PI / 2).translate(FRONT.x, FRONT.y, FRONT.z), 'chrome', P.chrome, st);
    add(archBand(q, 0, FRONT.z, FRONT.y, WHEEL_R + 5, 0.3, Math.PI - 0.55, 1.6, 9), 'satin', P.frame, st);
    add(tube(q, HEAD_TOP, STEM_TOP, 3.2), 'satin', P.frame, st);
    const bar = new THREE.CatmullRomCurve3([V(30, 131, 28), V(20, 130.4, 40), V(9, 129.5, 47), V(0, 129, 49), V(-9, 129.5, 47), V(-20, 130.4, 40), V(-30, 131, 28)]);
    add(new THREE.TubeGeometry(bar, 30, 1.8, 8, false), 'satin', P.frameDark, st);
    for (const [i, s] of SIDES.entries()) {
        const g = GRIPS[i]!;
        add(capsule(q, g.clone().add(V(-s * 4, -0.2, 5)), g.clone().add(V(s * 4, 0.2, -5)), 3.6), 'matte', P.black, st);
        add(tube(q, g.clone().add(V(-s * 7, 1, 8)), g.clone().add(V(s * 1, -1, 12)), 1), 'satin', P.frameDark, st); // brake lever
    }
    add(new THREE.SphereGeometry(3.2, q.sph[0], q.sph[1], 0, Math.PI * 2, 0, Math.PI / 2).translate(14, 131.5, 44), 'chrome', P.chrome, st); // bell
    add(rbox(q, V(12, 3, 9), V(0, 131.5, 50), new THREE.Euler(-0.5, 0, 0), 1.5), 'satin', P.black, st);
    add(rbox(q, V(9, 0.8, 6), V(0, 133.2, 49.6), new THREE.Euler(-0.5, 0, 0), 0.4), 'light', P.screen, st);

    // --- Cranks (crank bone, origin at the bottom bracket; the pedals ride under the feet).
    add(tube(q, V(-13, 0, 0), V(13, 0, 0), 2.6), 'satin', P.frameDark, B_CRANK);
    add(rbox(q, V(3, CRANK_R + 5, 5), V(12.5, -CRANK_R / 2, 0), undefined, 1.2), 'satin', P.frameDark, B_CRANK);
    add(rbox(q, V(3, CRANK_R + 5, 5), V(-12.5, CRANK_R / 2, 0), undefined, 1.2), 'satin', P.frameDark, B_CRANK);

    // --- The loaf (loaf bone, origin on the basket floor): a scored sourdough boule and a baguette.
    add(ellipsoid(q, V(-3, 8, 2), V(11, 8, 10.5)), 'matte', P.crust, B_LOAF);
    add(ellipsoid(q, V(-3, 15.2, 2), V(8, 1.2, 1.6), new THREE.Euler(0, 0.6, 0), true), 'matte', P.crumb, B_LOAF);
    add(ellipsoid(q, V(-3, 15.2, 2), V(8, 1.2, 1.6), new THREE.Euler(0, -0.9, 0), true), 'matte', P.crumb, B_LOAF);
    add(capsule(q, V(12, 4, -10), V(16, 26, 6), 3.4), 'matte', P.crust.clone().offsetHSL(0, 0, 0.08), B_LOAF);
}

function buildWheel(q: Q, P: Palette, mats: Record<Finish, THREE.Material>, front: boolean): THREE.Group {
    const kit = new Kit(q);
    const hw = 7.5; // fat tires
    const rIn = 26;
    const rc = (WHEEL_R + rIn) / 2;
    const ar = (WHEEL_R - rIn) / 2;
    const se = (x: number, n: number) => Math.sign(x) * Math.abs(x) ** (2 / n);
    const tire = grid(44, 10, (u, v, o) => {
        const th = u * Math.PI * 2;
        const ph = v * Math.PI * 2;
        const r = rc + ar * se(Math.cos(ph), 2.6);
        const x = hw * se(Math.sin(ph), 2.8);
        o.set(x, r * Math.cos(th), r * Math.sin(th));
    });
    kit.add(smooth(tire), 'matte', P.rubber);
    // Reflective sidewall stripes.
    for (const s of SIDES) kit.add(new THREE.TorusGeometry(rc + 1, 0.6, 3, 40).rotateY(Math.PI / 2).translate(s * (hw - 0.4), 0, 0), 'matte', new THREE.Color(0xc9ccd1));
    // Rim, spokes, hub (a fat hub motor at the back).
    kit.add(latheX(q, [[rIn - 3, -hw * 0.6], [rIn + 0.5, -hw * 0.6], [rIn + 0.5, hw * 0.6], [rIn - 3, hw * 0.6], [rIn - 3, -hw * 0.6]], 40), 'satin', P.frame);
    const hubR = front ? 5 : 10;
    const n = 16;
    for (const s of SIDES)
        for (let k = 0; k < n; ++k) {
            const th = ((k + (s > 0 ? 0 : 0.5)) / n) * Math.PI * 2;
            const a = V(s * 4, Math.cos(th + 0.35) * hubR * 0.8, Math.sin(th + 0.35) * hubR * 0.8);
            const b2 = V(s * 1.2, Math.cos(th) * (rIn - 2.5), Math.sin(th) * (rIn - 2.5));
            kit.add(tube(q, a, b2, 0.45, 0.45, 3), 'chrome', P.chrome);
        }
    kit.add(new THREE.CylinderGeometry(hubR, hubR, front ? 12 : 13, q.cyl + 2).rotateZ(Math.PI / 2), 'satin', front ? P.frame : P.frameDark);
    kit.add(new THREE.CylinderGeometry(hubR * 0.55, hubR * 0.55, front ? 14 : 15, q.cyl).rotateZ(Math.PI / 2), 'chrome', P.chrome);
    const g = new THREE.Group();
    g.name = front ? 'ebike-front-wheel' : 'ebike-rear-wheel';
    for (const m of bake(kit, mats, null)) g.add(m);
    g.rotation.order = 'YXZ'; // steer (Y) outside the spin (X)
    return g;
}

function buildRiderParts(kit: Kit, P: Palette): void {
    const q = kit.q;
    const add = kit.add.bind(kit);

    add(ellipsoid(q, V(0, -1, -3), V(15, 11, 17)), 'matte', P.jeans, B_PELVIS);

    // Hoodie: a lathe along +Y (front is +Z), wider across the shoulders; pocket, hood, drawstrings.
    const prof: [number, number][] = [[0.1, -6], [14, -4], [16, 6], [17, 20], [18.5, 32], [17.5, 40], [13, 46], [8, 50], [0.1, 51]];
    add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), q.lathe).applyMatrix4(new THREE.Matrix4().makeScale(1.28, 1, 0.85)), 'matte', P.hoodie, B_TORSO);
    add(rbox(q, V(24, 11, 3), V(0, 9, 13.6), new THREE.Euler(-0.05, 0, 0), 2), 'matte', P.hoodieDark, B_TORSO);
    add(new THREE.TorusGeometry(9, 5, 8, 16).rotateX(Math.PI / 2 - 0.5).scale(1.35, 1, 1).translate(0, 46, -6), 'matte', P.hoodie, B_TORSO);
    for (const s of SIDES) add(tube(q, V(s * 4, 46, 12), V(s * 5, 33, 15.5), 0.7), 'matte', P.scarf, B_TORSO);
    for (const s of SIDES) add(ellipsoid(q, V(s * SHOULDER.x, SHOULDER.y, SHOULDER.z), V(9.5, 8, 9.5)), 'matte', P.hoodie, B_TORSO);
    // Backpack.
    add(rbox(q, V(26, 30, 12), V(0, 25, -18), new THREE.Euler(0.05, 0, 0), 4), 'matte', P.black, B_TORSO);
    add(rbox(q, V(20, 2.5, 12.4), V(0, 18, -18.2), undefined, 1), 'gloss', P.accent, B_TORSO);

    // Head: face, hair, the helmet (half shell with vents and a peak), neck.
    const R = HEAD_R;
    add(new THREE.SphereGeometry(R, q.sph[0] + 2, q.sph[1] + 2).scale(0.92, 1, 0.98), 'matte', P.skin, B_HEAD);
    add(new THREE.SphereGeometry(R * 1.03, q.sph[0] + 2, q.sph[1], 0, Math.PI * 2, 0, 1.9).rotateX(-0.9), 'matte', P.hair, B_HEAD);
    for (const s of SIDES) add(ellipsoid(q, V(s * R * 0.33, R * 0.08, R * 0.88), V(R * 0.1, R * 0.13, R * 0.08), undefined, true), 'gloss', new THREE.Color(0x1a1a1e), B_HEAD);
    add(ellipsoid(q, V(0, -R * 0.15, R * 0.96), V(R * 0.13, R * 0.19, R * 0.15), undefined, true), 'matte', P.skin, B_HEAD);
    const helmet = new THREE.SphereGeometry(R * 1.16, q.sph[0] + 4, q.sph[1] + 2, 0, Math.PI * 2, 0, 1.5).scale(1, 0.92, 1.14).rotateX(-0.15).translate(0, R * 0.08, -R * 0.06);
    add(helmet, 'gloss', P.accent, B_HEAD);
    for (const x of [-0.35, 0, 0.35]) add(rbox(q, V(R * 0.14, R * 0.12, R * 0.7), V(x * R, R * 1.12, -R * 0.05), new THREE.Euler(0, 0, -x * 0.9), 0.8), 'matte', P.black, B_HEAD);
    add(rbox(q, V(R * 1.2, R * 0.08, R * 0.34), V(0, R * 0.52, R * 1.08), new THREE.Euler(0.25, 0, 0), 0.6), 'matte', P.black, B_HEAD);
    add(capsule(q, V(0, -R * 1.3, -2), V(0, -R * 0.6, -2), 6.5), 'matte', P.skin, B_HEAD);

    // Arms: sleeves, cuffs, hands (forearm frame: +Y from the elbow to the hand).
    for (const i of [0, 1]) {
        add(capsule(q, V(0, 0, 0), V(0, UARM, 0), 7.2), 'matte', P.hoodie, B_UARM[i]!);
        add(capsule(q, V(0, 0, 0), V(0, FARM - 5, 0), 6.4), 'matte', P.hoodie, B_FARM[i]!);
        add(tube(q, V(0, FARM - 7, 0), V(0, FARM - 3, 0), 6.6, 6.4), 'matte', P.hoodieDark, B_FARM[i]!);
        add(ellipsoid(q, V(0, FARM + 1, 0.5), V(5.2, 6.5, 5.6)), 'matte', P.skin, B_FARM[i]!);
    }
    // Legs: jeans, sneakers (accent heel tab) on the pedals (the pedals ride under the feet).
    for (const i of [0, 1]) {
        add(capsule(q, V(0, 0, 0), V(0, THIGH, 0), 9), 'matte', P.jeans, B_THIGH[i]!);
        add(capsule(q, V(0, 0, 0), V(0, SHIN, 0), 7), 'matte', P.jeans, B_SHIN[i]!);
        add(tube(q, V(0, SHIN - 4, 0), V(0, SHIN + 1, 0), 7.8, 8), 'matte', P.jeans.clone().multiplyScalar(0.8), B_SHIN[i]!);
        add(rbox(q, V(12, 9, 25), V(0, -3, 6), undefined, 3.5, 2), 'matte', P.shoe, B_FOOT[i]!);
        add(rbox(q, V(12.6, 2.4, 25.6), V(0, -7.4, 6), undefined, 1), 'matte', P.black.clone().lerp(P.shoe, 0.4), B_FOOT[i]!);
        add(rbox(q, V(6, 6, 3), V(0, 0, -6.5), undefined, 1), 'gloss', P.accent, B_FOOT[i]!);
        add(rbox(q, V(15, 2.6, 10), V(0, -10, 5), undefined, 0.8), 'satin', P.black, B_FOOT[i]!);
    }

    // Scarf: two tails, each ring bound to its chain bone (a continuous ribbon).
    for (const t of [0, 1]) {
        const n = SCARF_SEGS;
        const g = grid(n, 4, (u, v, o) => {
            const w = 6.5 * (1 - 0.3 * u);
            const th = 1.1;
            const corner = Math.round(v * 4) % 4;
            o.set(corner === 0 || corner === 3 ? w : -w, 0, corner < 2 ? th : -th);
        });
        const count = g.getAttribute('position').count;
        const si = new Uint16Array(count * 4);
        const sw = new Float32Array(count * 4);
        const nrm = new Float32Array(count * 3);
        for (let k = 0; k < count; ++k) {
            const i = k % (n + 1);
            const j = Math.floor(k / (n + 1));
            si[k * 4] = B_SCARF[t]! + i;
            sw[k * 4] = 1;
            const corner = j % 4;
            const nv = V(corner === 0 || corner === 3 ? 0.35 : -0.35, 0, corner < 2 ? 1 : -1).normalize();
            nrm.set([nv.x, nv.y, nv.z], k * 3);
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        add(g, 'matte', P.scarf, B_SCARF[t]!);
    }
}

// Scratch for pose() (reused every frame).
const _steerM = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _mPelvis = new THREE.Matrix4();
const _mTorso = new THREE.Matrix4();
const _qPelvis = new THREE.Quaternion();
const _qTorso = new THREE.Quaternion();
const _qHead = new THREE.Quaternion();
const _qFoot = new THREE.Quaternion();
const _e = new THREE.Euler();
const ONE = V(1, 1, 1);

class EBike implements VehicleModel {
    readonly body = new THREE.Group();
    readonly wheels: THREE.Object3D[];
    readonly exhaust = EXHAUST.clone().add(V(0, GROUND_Y, 0));
    private readonly bones: THREE.Bone[] = [];
    private readonly skeleton: THREE.Skeleton;
    private readonly finishes: Record<Finish, THREE.Material>;
    // Smoothed pose inputs.
    private lastT = NaN;
    private spin = 0;
    private crank = 0;
    private cadence = 0;
    private st = 0;
    private dr = 0;
    private tuck = 0;
    private wh = 0;
    private air = 0;
    private tw = 0;
    private trickType = 1;
    private spd = 0;
    private loaf = 0;
    private loafV = 0;
    /** Landing absorb (a spring kicked by landings), time in the air, brake-light level. */
    private land = 0;
    private landV = 0;
    private airSec = 0;
    private brake = 0;

    constructor(livery: Livery) {
        const q = BIKE_Q;
        const P = palette(livery);
        const mats = materials();
        this.finishes = mats;
        for (let i = 0; i < BONES; ++i) {
            const b = new THREE.Bone();
            b.matrixAutoUpdate = false;
            b.matrixWorldAutoUpdate = false;
            this.bones.push(b);
        }
        this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
        const kit = new Kit(q);
        buildBike(kit, P);
        buildRiderParts(kit, P);
        const holder = new THREE.Group();
        holder.position.y = GROUND_Y;
        for (const m of bake(kit, mats, this.skeleton)) holder.add(m);
        this.body.add(holder);
        this.body.name = 'ebike';
        this.wheels = [buildWheel(q, P, mats, true), buildWheel(q, P, mats, false)];
        this.wheels[0]!.position.copy(FRONT).add(V(0, GROUND_Y, 0));
        this.wheels[1]!.position.copy(REAR).add(V(0, GROUND_Y, 0));
        this.update({ timeSec: 0, steer: 0, speed: 0, drifting: 0, boosting: false, airborne: false, wheelie: false, trick: -1 });
    }

    stats(): { triangles: number; drawCalls: number } {
        return modelStats([this.body, ...this.wheels]);
    }

    dispose(): void {
        disposeModel([this.body, ...this.wheels], this.finishes, this.skeleton);
    }

    update(s: VehicleState): void {
        const t = s.timeSec;
        // First frame or a jump in time (frame stepping, a hidden tab): snap to the targets.
        const first = Number.isNaN(this.lastT) || t - this.lastT > 0.25 || t < this.lastT;
        const dt = first ? 0 : t - this.lastT;
        this.lastT = t;
        const k = (rate: number) => (first ? 1 : 1 - Math.exp(-rate * dt));
        this.st += (clamp(s.steer, -1, 1) - this.st) * k(9);
        this.dr += (Math.sign(s.drifting) - this.dr) * k(6);
        this.tuck += ((s.boosting ? 1 : 0) - this.tuck) * k(7);
        this.wh += ((s.wheelie ? 1 : 0) - this.wh) * k(6);
        this.air += ((s.airborne ? 1 : 0) - this.air) * k(5);
        if (s.trick >= 0) this.trickType = s.trick;
        // The trick pose holds through the air and lets go on landing.
        const posing = s.trick >= 0 && s.airborne;
        this.tw += ((posing ? 1 : 0) - this.tw) * k(posing ? 10 : 6);
        this.spd += (clamp(Math.abs(s.speed) / 90, 0, 1.4) - this.spd) * k(3);

        // Landing: the rider soaks it up with the knees (harder after a long jump).
        if (s.airborne) this.airSec += dt;
        else {
            if (this.airSec > 0.2) this.landV += Math.min(1.6, this.airSec * 1.8) * 9;
            this.airSec = 0;
        }
        const hl = Math.min(dt, 0.05);
        this.landV += (-this.land * 170 - this.landV * 12) * hl;
        this.land = clamp(this.land + this.landV * hl, -0.4, 1.2);

        this.brake += ((s.braking ? 1 : 0) - this.brake) * k(18);
        setBrakeLights(this.finishes, this.brake);

        // Wheels roll (capped so they don't strobe), the front one steers.
        const omega = clamp((s.speed * 60) / WHEEL_R, -27, 27);
        this.spin = (this.spin + omega * dt) % (Math.PI * 2);
        for (const w of this.wheels) w.rotation.x = this.spin;
        this.wheels[0]!.rotation.y = -this.st * 0.25;

        // Pedaling: it's an e-bike. The rider pedals pulling away and at low speed (cadence following
        // speed); from about half speed the motor carries it and the feet rest level on the pedals.
        // No pedaling when coasting, braking, in the air or in a trick.
        const v = Math.abs(s.speed);
        const assist = clamp((PEDAL_UNTIL - v) / 14, 0, 1);
        const pedal = (s.throttle ?? v > 1) && !s.braking && !s.airborne && s.trick < 0 && assist > 0;
        const cad = pedal ? (3 + Math.min(1, v / PEDAL_UNTIL) * 5.5) * Math.max(0.35, assist) : 0;
        this.cadence += (cad - this.cadence) * k(4);
        if (this.cadence > 1.4) this.crank = (this.crank + this.cadence * dt) % (Math.PI * 2);
        else {
            // Feet level (cranks horizontal), easing round to the nearest level position going forward.
            const level = Math.ceil((this.crank - Math.PI / 2 - 0.05) / Math.PI) * Math.PI + Math.PI / 2;
            this.crank += (level - this.crank) * k(5);
            this.crank %= Math.PI * 2;
        }

        // The loaf: a springy bounce, kicked by landings and road buzz.
        const target = this.air * 3.5;
        const h = Math.min(dt, 0.05);
        this.loafV += ((target - this.loaf) * 260 - this.loafV * 7) * h + Math.sin(t * 31) * this.spd * 6 * h;
        this.loaf = clamp(this.loaf + this.loafV * h, -1.5, 9);

        this.pose(t);
        this.skeleton.update();
    }

    private pose(t: number): void {
        const { st, dr, tuck, wh, air, tw, spd, land } = this;
        // Tricks: Up a "superman" (legs out behind, body flat over the bars), Down a no-hander
        // (standing, arms spread), Left / Right a leg kick and a fist pump to the side of the swing.
        const sup = this.trickType === 1 ? tw : 0;
        const nohand = this.trickType === 2 ? tw : 0;
        const kick = this.trickType >= 3 ? tw : 0;
        const kickSide = this.trickType === 3 ? 1 : -1; // +X = left
        const stand = nohand + kick * 0.6; // up off the saddle
        const breath = Math.sin(t * 2.2) * (1 - Math.min(1, spd)) * 0.025;
        const vib = Math.sin(t * 37) * 0.3 * Math.min(1, spd);

        // Steering assembly, cranks, loaf.
        const steerM = _steerM
            .makeTranslation(STEER_PIVOT.x, STEER_PIVOT.y, STEER_PIVOT.z)
            .multiply(_m.makeRotationAxis(STEER_AXIS, -st * 0.25))
            .multiply(_m.makeTranslation(-STEER_PIVOT.x, -STEER_PIVOT.y, -STEER_PIVOT.z));
        this.bones[B_ROOT]!.matrixWorld.identity();
        this.bones[B_STEER]!.matrixWorld.copy(steerM);
        this.bones[B_CRANK]!.matrixWorld.makeRotationX(this.crank).setPosition(BB);
        this.bones[B_LOAF]!.matrixWorld.makeRotationZ(this.loafV * 0.004).setPosition(BASKET.clone().add(V(0, this.loaf, 0)));

        // Pelvis and torso: an upright commuter seat; tucks on boost, sits back in a wheelie.
        const lean = st * 0.22 + dr * 0.24; // + = lean right (toward -X)
        const roll = lerp(lean, 0, tw);
        let pitch = 0.3 + tuck * 0.32 - wh * 0.38 + breath + air * 0.06 + land * 0.22 - this.brake * 0.06;
        pitch = lerp(pitch, lerp(0.2, 0.02, nohand), stand);
        pitch = lerp(pitch, 1.3, sup);
        const pelvis = SEAT.clone().add(V(-(st * 3 + dr * 8), vib - tuck * 1.5 + air * 2 - land * 6, -tuck * 3 - wh * 4 - this.brake * 3));
        pelvis.add(V(-kickSide * kick * 6, stand * 20 + sup * 12, stand * 8 - sup * 4));
        const qTorso = _qTorso.setFromEuler(_e.set(pitch, -st * 0.08, -roll, 'ZXY'));
        const qPelvis = _qPelvis.setFromEuler(_e.set(pitch * 0.25, 0, -roll * 0.5, 'ZXY'));
        const mPelvis = _mPelvis.compose(pelvis, qPelvis, ONE);
        const mTorso = _mTorso.compose(pelvis, qTorso, ONE);
        this.bones[B_PELVIS]!.matrixWorld.copy(mPelvis);
        this.bones[B_TORSO]!.matrixWorld.copy(mTorso);

        // Head: stays roughly level, looks into the turn.
        const R = HEAD_R;
        const look = lerp(-(st * 0.38 + dr * 0.25), kickSide * 0.6, kick) + Math.sin(t * 0.7) * 0.06 * (1 - Math.min(1, spd));
        const headPitch = lerp(-0.1 + tuck * 0.1 - wh * 0.08 - pitch * 0.25, -0.3, nohand) + sup * -0.25 - kick * 0.15;
        const qHead = _qHead.setFromEuler(_e.set(headPitch, look, -roll * 0.45, 'ZYX'));
        const neck = V(0, TORSO_LEN + 3, 0).applyMatrix4(mTorso);
        const head = neck.clone().add(V(0, R * 1.18, R * 0.12).applyQuaternion(qHead));
        this.bones[B_HEAD]!.matrixWorld.compose(head, qHead, ONE);

        // Arms to the grips; off them in the no-hander (spread wide) and the leg kick (a fist pump on
        // the kick side).
        const mid = V();
        const end = V();
        for (const i of [0, 1]) {
            const s = SIDES[i]!;
            const shoulder = V(s * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(mTorso);
            let target = GRIPS[i]!.clone().applyMatrix4(steerM);
            const flap = Math.sin(t * 9 + i) * 5;
            if (nohand > 0) target = target.lerp(shoulder.clone().add(V(s * 58, 16 + flap, 6)), nohand);
            const pump = s === kickSide ? kick : 0;
            if (pump > 0) target = target.lerp(shoulder.clone().add(V(s * 14 + Math.sin(t * 13) * 5, 58, 10)), pump);
            const pole = V(s * lerp(0.9, 0.5, tuck), lerp(-0.8, -1, tuck), -0.5).normalize();
            pole.lerp(V(0, -1, -0.6), nohand);
            pole.lerp(V(s, 0, 0.3), pump);
            ik(shoulder, target, UARM, FARM, pole, mid, end);
            frameM(shoulder, mid.clone().sub(shoulder), V(1, 0, 0), this.bones[B_UARM[i]!]!.matrixWorld);
            frameM(mid, end.clone().sub(mid), V(1, 0, 0), this.bones[B_FARM[i]!]!.matrixWorld);
        }

        // Legs on the pedals; in a drift the inside foot comes off and dabs out, motocross style.
        for (const i of [0, 1]) {
            const s = SIDES[i]!;
            const hip = V(s * HIP.x, HIP.y, HIP.z).applyMatrix4(mPelvis);
            const a = this.crank + (i === 0 ? 0 : Math.PI);
            const pedal = BB.clone().add(V(s * 17, -Math.cos(a) * CRANK_R, -Math.sin(a) * CRANK_R));
            let ankle = pedal.add(V(0, 8, -2));
            const inside = Math.max(0, -dr * s) * (1 - tw);
            ankle.lerp(V(s * 38, 20, 14), inside * 0.9);
            // Superman: legs out behind in a V (it reads from the chase camera).
            ankle = ankle.lerp(hip.clone().add(V(s * 30, 10 + Math.sin(t * 9 + i * 2) * 5, -THIGH - SHIN + 12)), sup);
            // Leg kick: the leg on the kick side swings off the pedal, out wide and back.
            const kl = s === kickSide ? kick : 0;
            ankle = ankle.lerp(hip.clone().add(V(s * (THIGH + SHIN) * 0.7, 4 + Math.sin(t * 10) * 4, -38)), kl);
            const pole = V(s * (0.12 + inside * 1.4 + stand * 0.3 + kl * 0.3), 0.1 + kl * 0.8, 1).normalize();
            ik(hip, ankle, THIGH, SHIN, pole, mid, end);
            frameM(hip, mid.clone().sub(hip), V(1, 0, 0), this.bones[B_THIGH[i]!]!.matrixWorld);
            frameM(mid, end.clone().sub(mid), V(1, 0, 0), this.bones[B_SHIN[i]!]!.matrixWorld);
            const heel = 0.1 + Math.sin(a) * 0.18 * (1 - inside);
            const qFoot = _qFoot.setFromEuler(_e.set(lerp(heel + inside * 0.3, 2.7, sup), s * inside * 0.4, s * (inside * 0.3 + kl * 0.6), 'XYZ'));
            this.bones[B_FOOT[i]!]!.matrixWorld.compose(end, qFoot, ONE);
        }

        // Scarf tails: streaming back with speed, waving, swept out of turns.
        const wind = clamp(spd + tuck * 0.2 + air * 0.3 + tw * 0.4, 0, 1.5);
        const baseTh = lerp(0.6, 1.62, Math.min(1, wind));
        const freq = 5 + 13 * Math.min(1.3, wind);
        const amp = 0.14 + 0.2 * Math.min(1, wind);
        const p = V();
        const dirs: V3[] = [];
        for (const tail of [0, 1]) {
            const s = tail ? -1 : 1;
            p.copy(V(s * SCARF_ROOT.x, SCARF_ROOT.y, SCARF_ROOT.z)).applyMatrix4(mTorso);
            dirs.length = 0;
            for (let i = 0; i < SCARF_SEGS; ++i) {
                const f = (i + 1) / SCARF_SEGS;
                const ph = t * freq - i * 0.95 + tail * 1.7;
                const th = baseTh + Math.sin(ph) * amp * f + (tail ? -0.08 : 0.04);
                const yaw = Math.sin(ph * 0.73 + 0.6) * amp * 0.7 * f + st * 0.35 * f * Math.min(1, wind) + s * 0.22;
                dirs.push(V(0, -Math.cos(th), -Math.sin(th)).applyAxisAngle(V(0, 1, 0), yaw));
            }
            for (let i = 0; i <= SCARF_SEGS; ++i) {
                const a = dirs[Math.max(0, i - 1)]!;
                const b = dirs[Math.min(SCARF_SEGS - 1, i)]!;
                frameM(p, a.clone().add(b), V(1, 0, 0), this.bones[B_SCARF[tail]! + i]!.matrixWorld);
                if (i < SCARF_SEGS) p.addScaledVector(dirs[i]!, SCARF_LEN);
            }
        }
    }
}

export function buildEBike(livery: Livery = DEFAULT_LIVERY): VehicleModel {
    return new EBike(livery);
}

/**
 * Standalone viewer (sfviewer.html?model=ebike[&steer=1&drift=1&boost=1&wheelie=1&brake=1&speed=80&air=1]
 * [&trick=1..4[&trickT=0.5][&rot=1]]: 1 up, 2 down, 3 left, 4 right; see vehicleModel.ts viewerTrick).
 */
export function viewerBuild(): { object: THREE.Object3D; camera?: { pos: [number, number, number]; target: [number, number, number] } } {
    const bike = new EBike(DEFAULT_LIVERY);
    const root = new THREE.Group();
    const lift = new THREE.Group();
    lift.position.y = -GROUND_Y;
    lift.add(bike.body, ...bike.wheels);
    root.add(lift);
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(320, 64).rotateX(-Math.PI / 2),
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
        wheelie: num('wheelie', 0) > 0,
        trick: -1,
        throttle: num('throttle', 1) > 0,
        braking: num('brake', 0) > 0,
    };
    const trick = viewerTrick(q, state, lift, GROUND_Y, true);
    const w = globalThis as unknown as Record<string, unknown>;
    w.__rider = state;
    w.__riderStats = bike.stats();
    const t0 = performance.now();
    ground.onBeforeRender = () => {
        state.timeSec = (performance.now() - t0) / 1000;
        trick();
        bike.update(state);
    };
    return { object: root, camera: { pos: [-380, 190, 300], target: [0, 90, 0] } };
}
