/**
 * Vehicle comparison: plays the best run of each vehicle back as translucent ghosts in their own
 * vehicles during the race, from their pose tracks (ghostTrack.ts: recorded live, or simulated from
 * the run files kept in runStore.ts).
 */

import * as THREE from 'three';
import { vehicleDef } from '../vehicles';
import { POSE_FLOATS as F, type GhostRun } from './ghostTrack';
import { nameTag } from './rivals';
import type { VehicleModel } from './vehicleModel';
import { buildVehicleModel } from './vehicleModels';

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
