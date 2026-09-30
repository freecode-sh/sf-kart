/**
 * Ambient city traffic: cars driving along the OSM streets around the course (never on the race
 * road itself, which the baked streets are cut out of), and US 101 on its viaduct over the Vista
 * Point loop (three lanes each way; the other freeways are in cuttings, not on the terrain the
 * streets follow). Visual only. Sedan / SUV / van blocks in car-paint colors.
 *
 * Only the stretches of street near the course carry cars (further out they were never on screen):
 * where a stretch is cut off, its cars shrink away over the last few meters and come back.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nearCourse } from './courseNear';
import { SCALE, worldY } from './geo';
import { US101 } from './streets';
import type { SfWorld } from './world';

interface Lane {
    pts: [number, number][];
    cum: number[];
    len: number;
    /** Road height (world y) at each point, on a viaduct; else the ground's. */
    ys?: number[];
    /** The lane goes on past its start / end (cut off away from the course): fade out there. */
    cut?: [boolean, boolean];
}

interface Car {
    lane: Lane;
    s: number;
    speed: number;
    dir: 1 | -1;
    offset: number;
    /** One way round and round (the freeway), instead of back and forth at the street's ends. */
    loop?: boolean;
}

/** US 101: cars per lane per 100 m, and the lane centres' offsets from the median (m). */
const FREEWAY = { density: 1.8, lanes: [2.4, 6, 9.6] };
/**
 * City streets: how near the course (m) a stretch must be to carry cars, the shortest stretch kept
 * (m), cars per km of street, and the fade at a cut-off end (m).
 */
const STREETS = { near: 300, minLen: 80, perKm: 8, fade: 30 };

const COLORS = [0xf2f2f0, 0x1c1d20, 0x9aa3ad, 0x5b6470, 0x8c1c1c, 0x1f3f73, 0xd9d4c7, 0x2f4f3a, 0x6b6f75, 0xb8322a];

/** A car body in local space: +Z forward, length ~4.4 m, sitting on y = 0. */
function carGeometry(kind: number): THREE.BufferGeometry {
    const m = SCALE;
    const len = (kind === 2 ? 5.2 : 4.5) * m;
    const w = 1.85 * m;
    const h = (kind === 1 ? 1.1 : kind === 2 ? 1.5 : 0.8) * m;
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(w, h * 0.75, len, 1, 1, 1);
    body.translate(0, 0.35 * m + (h * 0.75) / 2, 0);
    parts.push(body);
    if (kind !== 2) {
        const cabin = new THREE.BoxGeometry(w * 0.86, h * 0.7, len * (kind === 1 ? 0.62 : 0.5), 1, 1, 1);
        cabin.translate(0, 0.35 * m + h * 0.75 + (h * 0.7) / 2 - 2, -len * 0.05);
        parts.push(cabin);
    }
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const wheel = new THREE.CylinderGeometry(0.34 * m, 0.34 * m, 0.3 * m, 10);
        wheel.rotateZ(Math.PI / 2);
        wheel.translate((x * w) / 2, 0.34 * m, (z * len) / 3);
        parts.push(wheel);
    }
    for (const p of parts) p.deleteAttribute('uv');
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    g.computeVertexNormals();
    return g;
}

export class Traffic {
    readonly group = new THREE.Group();
    private cars: Car[] = [];
    private meshes: THREE.InstancedMesh[] = [];
    private readonly m = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private readonly v = new THREE.Vector3();
    private readonly sc = new THREE.Vector3(1, 1, 1);
    private last = 0;
    private readonly mat: THREE.Material;
    private readonly geos: THREE.BufferGeometry[];

    constructor(
        private readonly world: SfWorld,
        centerline: readonly { pos: readonly number[] }[],
    ) {
        this.group.name = 'traffic';
        const near = nearCourse(centerline, STREETS.near * SCALE);
        const lanes: Lane[] = [];
        for (const st of world.json.streets) {
            if (st.kind !== 0 || st.w < 7 || st.w >= 13 || st.pts.length < 6) continue;
            const pts: [number, number][] = [];
            for (let k = 0; k + 1 < st.pts.length; k += 2) pts.push([st.pts[k]!, st.pts[k + 1]!]);
            if (length(pts) < 250 * SCALE) continue;
            // The stretches near the course (the street densified to 20 m, so none slips through).
            const dense: [number, number][] = [pts[0]!];
            for (let i = 1; i < pts.length; ++i) {
                const [ax, az] = pts[i - 1]!;
                const [bx, bz] = pts[i]!;
                const m = Math.ceil(Math.hypot(bx - ax, bz - az) / (20 * SCALE));
                for (let k = 1; k <= m; ++k) dense.push([ax + ((bx - ax) * k) / m, az + ((bz - az) * k) / m]);
            }
            let run: [number, number][] = [];
            let from = 0;
            dense.forEach((p, i) => {
                const keep = near(p[0], p[1]);
                if (keep) {
                    if (!run.length) from = i;
                    run.push(p);
                }
                if ((!keep || i === dense.length - 1) && run.length > 1) {
                    const to = keep ? i : i - 1;
                    if (length(run) >= STREETS.minLen * SCALE) lanes.push(lane(run, [from > 0, to < dense.length - 1]));
                }
                if (!keep) run = [];
            });
        }
        let seed = 17;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        const total = lanes.reduce((a, l) => a + l.len, 0);
        const N = Math.round((total / (1000 * SCALE)) * STREETS.perKm);
        for (let k = 0; k < N && lanes.length; ++k) {
            // Pick a lane weighted by length.
            let r = rnd() * total;
            let lane = lanes[0]!;
            for (const l of lanes) {
                r -= l.len;
                if (r <= 0) {
                    lane = l;
                    break;
                }
            }
            const dir = rnd() < 0.5 ? 1 : -1;
            this.cars.push({ lane, s: rnd() * lane.len, speed: (9 + rnd() * 6) * SCALE, dir, offset: dir * 1.8 * SCALE });
        }
        // US 101 over the Vista Point loop.
        {
            const fwy = lane(
                US101.map(([e, n]) => [e * SCALE, -n * SCALE]),
                [false, false],
            );
            fwy.ys = US101.map(([, , h]) => worldY(h));
            const n = Math.round((fwy.len / (100 * SCALE)) * FREEWAY.density);
            for (const dir of [1, -1] as const)
                for (const off of FREEWAY.lanes)
                    for (let k = 0; k < n; ++k)
                        this.cars.push({ lane: fwy, s: ((k + rnd() * 0.6) / n) * fwy.len, speed: (22 + off + rnd() * 4) * SCALE, dir, offset: dir * off * SCALE, loop: true });
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5 });
        this.mat = mat;
        this.geos = [0, 1, 2].map(carGeometry);
        for (let kind = 0; kind < 3; ++kind) {
            const cars = this.cars.filter((_, i) => i % 3 === kind);
            const inst = new THREE.InstancedMesh(this.geos[kind]!, mat, cars.length);
            const c = new THREE.Color();
            cars.forEach((_, i) => inst.setColorAt(i, c.setHex(COLORS[(i * 7 + kind) % COLORS.length]!)));
            inst.castShadow = false;
            inst.frustumCulled = false;
            inst.userData.cars = cars;
            this.meshes.push(inst);
            this.group.add(inst);
        }
    }

    update(timeSec: number): void {
        const dt = Math.min(0.1, Math.max(0, timeSec - this.last));
        this.last = timeSec;
        for (const inst of this.meshes) {
            const cars = inst.userData.cars as Car[];
            cars.forEach((car, i) => {
                // Drive to the end of the street, then come back the other way (the freeway: round again).
                car.s += car.dir * car.speed * dt;
                if (car.loop) car.s = ((car.s % car.lane.len) + car.lane.len) % car.lane.len;
                else if (car.s > car.lane.len) {
                    car.s = car.lane.len;
                    car.dir = -1;
                    car.offset = -Math.abs(car.offset);
                } else if (car.s < 0) {
                    car.s = 0;
                    car.dir = 1;
                    car.offset = Math.abs(car.offset);
                }
                const L = car.lane;
                let j = 0;
                while (j + 2 < L.cum.length && L.cum[j + 1]! < car.s) ++j;
                const a = L.pts[j]!;
                const b = L.pts[j + 1]!;
                const segLen = L.cum[j + 1]! - L.cum[j]! || 1;
                const t = (car.s - L.cum[j]!) / segLen;
                const dx = (b[0] - a[0]) / segLen;
                const dz = (b[1] - a[1]) / segLen;
                const x = a[0] + (b[0] - a[0]) * t + dz * car.offset;
                const z = a[1] + (b[1] - a[1]) * t - dx * car.offset;
                const y = (L.ys ? L.ys[j]! + (L.ys[j + 1]! - L.ys[j]!) * t : this.world.groundY(x, z)) + 14;
                this.q.setFromAxisAngle(this.up, Math.atan2(dx * car.dir, dz * car.dir));
                // (the freeway's cars, and the streets' where they're cut off, drive in and out of
                // sight, growing / shrinking over the last 30 m)
                const fade = STREETS.fade * SCALE;
                const k = Math.min(1, car.loop || L.cut?.[0] ? car.s / fade : 1, car.loop || L.cut?.[1] ? (L.len - car.s) / fade : 1);
                this.m.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(Math.max(0, k)));
                inst.setMatrixAt(i, this.m);
            });
            inst.instanceMatrix.needsUpdate = true;
        }
    }

    dispose(): void {
        for (const g of this.geos) g.dispose();
        this.mat.dispose();
        for (const m of this.meshes) m.dispose();
    }
}

function length(pts: [number, number][]): number {
    let len = 0;
    for (let i = 1; i < pts.length; ++i) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    return len;
}

function lane(pts: [number, number][], cut: [boolean, boolean]): Lane {
    const cum = [0];
    for (let i = 1; i < pts.length; ++i) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    return { pts, cum, len: cum[cum.length - 1]!, cut };
}
