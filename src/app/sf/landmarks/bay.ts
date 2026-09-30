/**
 * Bay life: sailboats cruising slow loops in the strait either side of the bridge and a container
 * ship inbound through the Gate, both rocking on the swell, where the race camera looks (ahead from
 * Crissy Field and the Marina Green, from the switchbacks and the Vista Point loop). The Marina's
 * harbours: their docks and the boats moored along them (sails furled). World-space objects (instanced where it pays), animated
 * through the returned update(timeSec).
 */

import * as THREE from 'three';
import { SCALE, worldXZ, worldY } from '../geo';
import { Batch, beam, box, cyl, mat, offsetPoly, prism, rng, type V2 } from './kit';
import { materials } from './mats';

type GroundY = (x: number, z: number) => number;

/** Boat loops: center e/n, radii (m), size scale. */
const BOATS: [number, number, number, number, number][] = [
    [700, 330, 200, 110, 1.1],
    [1300, 480, 260, 130, 1.2],
    [400, 820, 220, 120, 1.0],
    [1100, 1000, 280, 140, 1.3],
    [2000, 650, 260, 120, 1.15],
    [2600, 1000, 300, 150, 1.2],
    [600, 1500, 220, 110, 1.0],
    [-800, 700, 220, 110, 1.1],
    [-1200, 1250, 280, 140, 1.25],
    [-600, 1150, 200, 100, 1.0],
];
/**
 * The ship's lane (m e/n) in from the ocean, under the bridge's main span and on past Alcatraz,
 * round and round (m/s; `start`: where it is at t = 0, just west of the bridge, so a first lap sees
 * it under the main span from Crissy Field and the switchbacks, and east of the bridge from the
 * Marina Green).
 */
const SHIP = { from: [-5500, 700] as V2, to: [4200, 1250] as V2, speed: 7, start: 0.495 };

/**
 * The Marina's small-craft harbours, traced off the aerial photo (the water plane hides the photo's
 * docks and boats): dock lines a → b (m e/n) and the side boats are moored on (1: left of a → b,
 * -1: right, 0: both).
 */
const DOCKS: [V2, V2, number][] = [
    // West Harbor: the south pier along Marina Blvd, the middle pier, the west dock, the diagonal
    // pier off the breakwater and three fingers.
    [[2727, -552], [3075, -497], 1],
    [[2800, -490], [3070, -450], 0],
    [[2657, -557], [2670, -452], -1],
    [[2690, -437], [2947, -350], 0],
    [[2945, -407], [2947, -460], 0],
    [[2960, -395], [2962, -452], 0],
    [[3005, -377], [3007, -430], 0],
    // East Harbor: fingers off the breakwater and off the south pier.
    [[2985, -312], [2990, -347], 0],
    [[3022, -310], [3025, -332], 0],
    [[3067, -360], [3075, -407], 0],
    [[3115, -350], [3120, -397], 0],
    [[3170, -342], [3172, -387], 0],
    [[3220, -335], [3225, -377], 0],
    [[3070, -412], [3240, -385], 1],
];
/** Berth pitch along a dock and the share of berths taken; the dock's width (m). */
const BERTH = { pitch: 5, taken: 0.7, dock: 2.4 };

// ------------------------------------------------------------------------------ geometry

const HULL_OUTLINE: V2[] = [
    [-5, -1.45],
    [-2.5, -1.9],
    [0.5, -1.9],
    [3, -1.3],
    [4.6, -0.6],
    [5.6, 0],
    [4.6, 0.6],
    [3, 1.3],
    [0.5, 1.9],
    [-2.5, 1.9],
    [-5, 1.45],
];

function boatGeo(): THREE.BufferGeometry {
    const b = new Batch();
    b.add('x', prism(HULL_OUTLINE, -0.6, 1.1, { top: true }), { color: 0xf7f7f4 });
    b.add('x', prism(offsetPoly(HULL_OUTLINE, 0.03), -0.6, -0.05, {}), { color: 0x1d2b4a });
    b.add('x', box(3.6, 0.75, 2.3), { m: mat(-0.7, 1.1, 0), color: 0xece9e0 });
    b.add('x', box(3.7, 0.2, 2.4), { m: mat(-0.7, 1.85, 0), color: 0xd9d4c6 });
    b.add('x', cyl(0.07, 0.11, 14.5, 6), { m: mat(0.9, 1.1, 0), color: 0xc8ccd0 });
    b.add('x', box(4.6, 0.14, 0.14), { m: mat(-1.4, 2.3, 0), color: 0xc8ccd0 });
    return b.geometry('x')!;
}

function sailGeo(): THREE.BufferGeometry {
    // Main (luff on the mast, foot on the boom) and jib, each a fan around a bellied center.
    const pos: number[] = [];
    const tri = (pts: [number, number][], belly: number) => {
        const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3;
        const cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
        for (let i = 0; i < 3; ++i) {
            const a = pts[i]!;
            const c = pts[(i + 1) % 3]!;
            pos.push(a[0], a[1], 0, c[0], c[1], 0, cx, cy, belly);
        }
    };
    tri(
        [
            [0.95, 2.45],
            [0.95, 15.2],
            [-3.6, 2.45],
        ],
        0.45,
    );
    tri(
        [
            [1.2, 13.4],
            [5.35, 1.4],
            [1.25, 1.7],
        ],
        0.35,
    );
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const b = new Batch();
    b.add('x', g, { color: 0xffffff });
    return b.geometry('x')!;
}

function shipBatch(): Batch {
    const b = new Batch();
    const L = 290;
    const B = 40;
    const hull: V2[] = [
        [-L / 2 + 4, B / 2],
        [-L / 2, B / 2 - 6],
        [-L / 2, -B / 2 + 6],
        [-L / 2 + 4, -B / 2],
        [L / 2 - 60, -B / 2],
        [L / 2 - 25, -B / 2 + 5],
        [L / 2 - 5, -5],
        [L / 2, 0],
        [L / 2 - 5, 5],
        [L / 2 - 25, B / 2 - 5],
        [L / 2 - 60, B / 2],
    ];
    b.add('hull', prism(hull, -12, 0.6, {}), { color: 0x8f2a22 });
    b.add('hull', prism(hull, 0.6, 12, { top: true }), { color: 0x1c2530 });
    b.add('plain', prism(offsetPoly(hull, 0.05), 11.3, 12.2, {}), { color: 0xd8d8d0 });
    // Containers: bays along the deck, sub-stacks across.
    const r = rng(404);
    const colors = [0x2f6fa8, 0xa8352c, 0xc9782c, 0x3f7a4a, 0x8a8f94, 0xd8d4c8, 0x2a4d7a, 0x7a2f2a, 0xcfa23a];
    for (let x = -92; x < 118; x += 13.2) {
        for (let k = 0; k < 5; ++k) {
            const z = -B / 2 + 3 + k * 6.9 + 3.3;
            const tiers = 2 + Math.floor(r() * 5);
            // Sub-stacks of a couple of colors.
            let y = 12;
            let left = tiers;
            while (left > 0) {
                const n = Math.min(left, 1 + Math.floor(r() * 3));
                b.add('plain', box(12.2, n * 2.6 - 0.1, 6.7), { m: mat(x, y, z), color: colors[Math.floor(r() * colors.length)]! });
                y += n * 2.6;
                left -= n;
            }
        }
    }
    // Accommodation block, bridge wings, funnel, forecastle.
    const ax = -L / 2 + 30;
    b.add('facade', box(16, 26, 34), { m: mat(ax, 12, 0), uv: 'box', tile: [10, 11], color: 0xf1f1ec });
    b.add('plain', box(9, 2.6, 44), { m: mat(ax + 4, 35.5, 0), color: 0xf1f1ec });
    b.add('glass', box(9.1, 1.6, 44.1), { m: mat(ax + 4, 36.0, 0), color: 0x404a52 });
    b.add('plain', box(8, 13, 8), { m: mat(ax - 16, 12, 0), color: 0x2a2e33 });
    b.add('plain', box(8.1, 2.2, 8.1), { m: mat(ax - 16, 21, 0), color: 0xb0352c });
    b.add('plain', box(20, 3, B - 10), { m: mat(L / 2 - 22, 12, 0), color: 0xd8d8d0 });
    b.add('metal', cyl(0.25, 0.3, 14, 6), { m: mat(ax + 2, 38, 0), color: 0xdddddd });
    return b;
}

// ------------------------------------------------------------------------------ build

export function buildBay(groundY: GroundY, flat = false): { object: THREE.Group; update: (t: number) => void } {
    const mats = materials();
    const group = new THREE.Group();
    group.name = 'bay';
    const sea = worldY(0);
    const water = (e: number, n: number) => {
        if (flat) return true;
        const [x, z] = worldXZ(e, n);
        return groundY(x, z) < worldY(-2);
    };

    // ---- sailboats ----
    type Boat = { c: V2; a: number; b: number; s: number; w: number; ph: number };
    const r = rng(2024);
    const boats: Boat[] = [];
    for (const [e, n, a0, b0, s] of BOATS) {
        for (const k of [1, 0.5, 0.25]) {
            const a = a0 * k;
            const bb = b0 * k;
            let ok = true;
            for (let i = 0; i < 16 && ok; ++i) {
                const t = (i / 16) * Math.PI * 2;
                ok = water(e + a * Math.cos(t), n + bb * Math.sin(t));
            }
            if (ok) {
                boats.push({ c: [e, n], a, b: bb, s, w: (2.6 / ((a + bb) / 2)) * (r() < 0.5 ? 1 : -1), ph: r() * Math.PI * 2 });
                break;
            }
        }
    }
    const hullMesh = new THREE.InstancedMesh(boatGeo(), mats.hull!, Math.max(1, boats.length));
    const sailMesh = new THREE.InstancedMesh(sailGeo(), mats.sail!, Math.max(1, boats.length));
    hullMesh.count = sailMesh.count = boats.length;
    const sailColors = [0xfbfaf6, 0xf4f2ea, 0xfbfaf6, 0xe9e4d6];
    const c = new THREE.Color();
    boats.forEach((_, i) => sailMesh.setColorAt(i, c.set(i === 3 ? 0xc4462f : sailColors[i % sailColors.length]!)));
    for (const m of [hullMesh, sailMesh]) {
        m.frustumCulled = false;
        m.castShadow = false;
        group.add(m);
    }
    hullMesh.name = 'bay:boats';
    sailMesh.name = 'bay:sails';

    // ---- the Marina's docks and moored boats (static) ----
    const docks = new Batch();
    type Berth = { e: number; n: number; yaw: number; s: number };
    const berths: Berth[] = [];
    const rb = rng(1915);
    for (const [a, b, side] of DOCKS) {
        // (the kit's x, z: e, -n)
        const plank = beam([a[0], -a[1]], [b[0], -b[1]], BERTH.dock, 0.3, 0.75);
        docks.add('plain', plank.geo, { m: plank.m, color: 0x9a9185 });
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const de = (b[0] - a[0]) / len;
        const dn = (b[1] - a[1]) / len;
        for (const sg of side ? [side] : [1, -1])
            for (let d = 3; d < len - 2; d += BERTH.pitch) {
                if (rb() > BERTH.taken) continue;
                const sc = 0.65 + rb() * 0.35;
                // Bow in, the stern out from the dock (the hull's bow is at +5.6).
                const ne = -dn * sg;
                const nn = de * sg;
                const off = BERTH.dock / 2 + 0.4 + 5.6 * sc;
                const e = a[0] + de * d + ne * off;
                const n = a[1] + dn * d + nn * off;
                if (water(e, n)) berths.push({ e, n, yaw: Math.atan2(-nn, -ne), s: sc });
            }
    }
    const dockMesh = docks.build(mats, 'bay:docks');
    dockMesh.scale.setScalar(SCALE);
    dockMesh.position.y = sea;
    group.add(dockMesh);
    const moored = new THREE.InstancedMesh(boatGeo(), mats.hull!, Math.max(1, berths.length));
    moored.count = berths.length;
    moored.name = 'bay:moored';
    {
        const m = new THREE.Matrix4();
        const hullColors = [0xf7f7f4, 0xf1eee4, 0xf7f7f4, 0xe6e2d6, 0xf7f7f4, 0x33465e];
        const col = new THREE.Color();
        berths.forEach((bt, i) => {
            const [x, z] = worldXZ(bt.e, bt.n);
            m.compose(new THREE.Vector3(x, sea, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bt.yaw, 0)), new THREE.Vector3().setScalar(SCALE * bt.s));
            moored.setMatrixAt(i, m);
            moored.setColorAt(i, col.set(hullColors[i % hullColors.length]!));
        });
    }
    moored.castShadow = false;
    group.add(moored);

    // ---- container ship ----
    const ship = shipBatch().build(mats, 'bay:ship', false);
    ship.scale.setScalar(SCALE);
    group.add(ship);
    const sd: V2 = [SHIP.to[0] - SHIP.from[0], SHIP.to[1] - SHIP.from[1]];
    const sLen = Math.hypot(sd[0], sd[1]);
    const shipYaw = Math.atan2(sd[1], sd[0]);

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const update = (t: number) => {
        boats.forEach((bt, i) => {
            const th = bt.ph + bt.w * t;
            const e = bt.c[0] + bt.a * Math.cos(th);
            const n = bt.c[1] + bt.b * Math.sin(th);
            const de = -bt.a * Math.sin(th) * Math.sign(bt.w);
            const dn = bt.b * Math.cos(th) * Math.sign(bt.w);
            const yaw = Math.atan2(dn, de);
            // Heel away from a westerly wind, plus swell.
            const heel = 0.2 * Math.sin(yaw) + 0.05 * Math.sin(t * 1.1 + bt.ph);
            const pitch = 0.035 * Math.sin(t * 1.4 + bt.ph * 2);
            p.set(e * SCALE, sea + SCALE * (0.12 * Math.sin(t * 1.3 + bt.ph)), -n * SCALE);
            eul.set(heel, yaw, pitch, 'YXZ');
            q.setFromEuler(eul);
            sc.setScalar(SCALE * bt.s);
            m4.compose(p, q, sc);
            hullMesh.setMatrixAt(i, m4);
            sailMesh.setMatrixAt(i, m4);
        });
        hullMesh.instanceMatrix.needsUpdate = true;
        sailMesh.instanceMatrix.needsUpdate = true;
        // Ship: steady progress along its lane, a gentle roll.
        const f = (SHIP.start + (SHIP.speed * t) / sLen) % 1;
        ship.position.set((SHIP.from[0] + sd[0] * f) * SCALE, sea + SCALE * 0.3 * Math.sin(t * 0.35), -(SHIP.from[1] + sd[1] * f) * SCALE);
        ship.rotation.set(0.012 * Math.sin(t * 0.3), shipYaw, 0.004 * Math.sin(t * 0.21), 'YXZ');
    };
    update(0);
    return { object: group, update };
}
