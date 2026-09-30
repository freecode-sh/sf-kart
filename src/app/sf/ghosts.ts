/**
 * Vehicle comparison: records the player's run (pose every other game frame plus section splits),
 * keeps the best run of each vehicle per course in localStorage, and plays those back as
 * translucent ghosts in their own vehicles during the next race.
 */

import * as THREE from 'three';
import { vehicleDef, type VehicleId } from '../vehicles';
import { nameTag } from './rivals';
import type { VehicleModel } from './vehicleModel';
import { buildVehicleModel } from './vehicleModels';

const STRIDE = 2;
/** Floats per sample: position, rotation quaternion. */
const F = 7;
const KEY = 'kart.ghost.v1';

export interface GhostRun {
    vehicle: VehicleId;
    /** Race time (game frames from the start). */
    frames: number;
    /** Game frames per sample (sample i is session frame i * stride). */
    stride: number;
    samples: Float32Array;
    /** Race frames spent in each course section. */
    splits: Record<string, number>;
    /** The vehicle's tune for this run (JSON), to flag runs made with other numbers. */
    tune: string;
    date: number;
}

/** Collects the player's pose each game frame (keeps every STRIDE-th session frame). */
export class RunRecorder {
    private buf = new Float32Array(F * 4096);
    private n = 0;

    reset(): void {
        this.n = 0;
    }

    push(frame: number, pos: THREE.Vector3, rot: THREE.Quaternion): void {
        if (frame % STRIDE !== 0) return;
        const i = frame / STRIDE;
        if ((i + 1) * F > this.buf.length) {
            const b = new Float32Array(this.buf.length * 2);
            b.set(this.buf);
            this.buf = b;
        }
        // Fill any gap (a skipped frame) with this pose.
        for (let k = this.n; k <= i; ++k) this.buf.set([pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w], k * F);
        this.n = Math.max(this.n, i + 1);
    }

    run(vehicle: VehicleId, frames: number, splits: Record<string, number>, tune: string): GhostRun {
        return { vehicle, frames, stride: STRIDE, samples: this.buf.slice(0, this.n * F), splits, tune, date: Date.now() };
    }
}

function toBase64(a: Float32Array): string {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function fromBase64(s: string): Float32Array {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
}

export function saveRun(courseId: string, run: GhostRun): void {
    const { samples, ...rest } = run;
    try {
        localStorage.setItem(`${KEY}:${courseId}@${run.vehicle}`, JSON.stringify({ ...rest, data: toBase64(samples) }));
    } catch (e) {
        console.warn('ghost not saved', e);
    }
}

export function loadRun(courseId: string, vehicle: VehicleId): GhostRun | null {
    try {
        const raw = localStorage.getItem(`${KEY}:${courseId}@${vehicle}`);
        if (!raw) return null;
        const o = JSON.parse(raw) as Omit<GhostRun, 'samples'> & { data: string };
        return { ...o, samples: fromBase64(o.data) };
    } catch {
        return null;
    }
}

interface Ghost {
    run: GhostRun;
    group: THREE.Group;
    model: VehicleModel;
    tag: THREE.Sprite;
    prevYaw: number;
    steer: number;
}

/** Plays stored runs back as translucent ghosts, each in its own vehicle. */
export class CompareGhosts {
    readonly group = new THREE.Group();
    private ghosts: Ghost[] = [];
    private readonly q = new THREE.Quaternion();
    private readonly q2 = new THREE.Quaternion();
    private readonly fwd = new THREE.Vector3();

    constructor(runs: { run: GhostRun; label: string }[]) {
        this.group.name = 'compare-ghosts';
        for (const { run, label } of runs) {
            const group = new THREE.Group();
            const tag = nameTag(label, vehicleDef(run.vehicle).color);
            group.add(tag);
            this.group.add(group);
            const m = buildVehicleModel(run.vehicle);
            const mats = new Set<THREE.Material>();
            for (const o of [m.body, ...m.wheels])
                o.traverse((x) => {
                    if (!(x instanceof THREE.Mesh)) return;
                    x.castShadow = false;
                    for (const mat of Array.isArray(x.material) ? x.material : [x.material]) mats.add(mat);
                });
            for (const mat of mats) {
                mat.transparent = true;
                mat.opacity = Math.min(mat.opacity, 0.42);
                mat.depthWrite = false;
            }
            group.add(m.body, ...m.wheels);
            this.ghosts.push({ run, group, model: m, tag, prevYaw: 0, steer: 0 });
        }
    }

    /** Poses every ghost at session frame `frame` (fractional for interpolation). */
    update(frame: number, timeSec: number, camera?: THREE.Vector3): void {
        for (const g of this.ghosts) {
            const d = g.run.samples;
            const n = d.length / F;
            const fi = Math.max(0, frame / g.run.stride);
            const i0 = Math.min(n - 1, Math.floor(fi));
            const i1 = Math.min(n - 1, i0 + 1);
            const t = Math.min(1, fi - i0);
            g.group.position.set(
                d[i0 * F]! * (1 - t) + d[i1 * F]! * t,
                d[i0 * F + 1]! * (1 - t) + d[i1 * F + 1]! * t,
                d[i0 * F + 2]! * (1 - t) + d[i1 * F + 2]! * t,
            );
            this.q.set(d[i0 * F + 3]!, d[i0 * F + 4]!, d[i0 * F + 5]!, d[i0 * F + 6]!).slerp(this.q2.set(d[i1 * F + 3]!, d[i1 * F + 4]!, d[i1 * F + 5]!, d[i1 * F + 6]!), t);
            g.group.quaternion.copy(this.q);
            const dx = d[i1 * F]! - d[i0 * F]!;
            const dz = d[i1 * F + 2]! - d[i0 * F + 2]!;
            const speed = i1 > i0 ? Math.hypot(dx, dz) / g.run.stride : 0;
            this.fwd.set(0, 0, 1).applyQuaternion(this.q);
            const yaw = Math.atan2(this.fwd.x, this.fwd.z);
            let dy = yaw - g.prevYaw;
            dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            g.prevYaw = yaw;
            g.steer += (Math.max(-1, Math.min(1, -dy * 40)) - g.steer) * 0.15;
            // Gone 60 samples (2 s) after its finish.
            g.group.visible = fi < n - 1 + 60;
            if (camera) g.tag.visible = g.group.position.distanceTo(camera) < 16000;
            g.model.update({ timeSec, steer: g.steer, speed, drifting: 0, boosting: false, airborne: false, wheelie: false, trick: -1, throttle: speed > 1 });
        }
    }

    /** Minimap dots, in the vehicle's color. */
    dots(): { x: number; z: number; color: string }[] {
        return this.ghosts.filter((g) => g.group.visible).map((g) => ({ x: g.group.position.x, z: g.group.position.z, color: vehicleDef(g.run.vehicle).color }));
    }

    dispose(): void {
        for (const g of this.ghosts) {
            g.model.dispose();
            (g.tag.material as THREE.SpriteMaterial).map?.dispose();
            g.tag.material.dispose();
        }
        this.group.removeFromParent();
    }
}
