/**
 * CPU rivals: recorded bot runs (tools/sf/rivals.ts) played back in sync with the race's game frame,
 * each in its own vehicle (e-bike riders in the rival's colours), with a name tag. A time trial: they
 * don't collide (the physics engine is single-player); race positions come from their progress
 * along the lap.
 */

import * as THREE from 'three';
import type { VehicleId } from '../vehicles';
import { DEFAULT_LIVERY, type VehicleModel } from './vehicleModel';
import { buildVehicleModel } from './vehicleModels';

interface RivalInfo {
    name: string;
    color: string;
    accent: string;
    vehicle: VehicleId;
    frames: number;
    stride: number;
    finishFrame: number;
    offset: number;
}

interface Rival {
    info: RivalInfo;
    data: DataView;
    group: THREE.Group;
    body: THREE.Group;
    rider: VehicleModel;
    tag: THREE.Sprite;
    prevYaw: number;
    steer: number;
    dist: number;
    lateral: number;
}

const RACE_START = 412;

export function nameTag(name: string, color: string): THREE.Sprite {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 64;
    const g = cv.getContext('2d')!;
    g.font = 'bold 34px ui-sans-serif, system-ui, sans-serif';
    const w = Math.min(248, g.measureText(name).width + 28);
    g.fillStyle = 'rgba(10,16,28,0.72)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 8, w, 48, 22);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc((256 - w) / 2 + 18, 32, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, 128 + 8, 33);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Constant size on screen (fraction of the view height).
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, fog: false, sizeAttenuation: false }));
    s.scale.set(0.13, 0.0325, 1);
    s.position.set(0, 300, 0);
    return s;
}

export class Rivals {
    readonly group = new THREE.Group();
    private rivals: Rival[] = [];
    private readonly q = new THREE.Quaternion();
    private readonly q2 = new THREE.Quaternion();
    private readonly fwd = new THREE.Vector3();
    private readonly right = new THREE.Vector3();

    static async load(dir: string): Promise<Rivals | null> {
        try {
            const [json, bin] = await Promise.all([fetch(`${dir}/rivals.json`).then((r) => (r.ok ? r.json() : null)), fetch(`${dir}/rivals.bin`).then((r) => (r.ok ? r.arrayBuffer() : null))]);
            if (!json || !bin) return null;
            return new Rivals((json as { rivals: RivalInfo[] }).rivals, bin);
        } catch {
            return null;
        }
    }

    private constructor(infos: RivalInfo[], bin: ArrayBuffer) {
        this.group.name = 'rivals';
        infos.forEach((info, k) => {
            const n = Math.ceil(info.frames / info.stride);
            const group = new THREE.Group();
            const body = new THREE.Group();
            group.add(body);
            const tag = nameTag(info.name, info.color);
            group.add(tag);
            const rider = buildVehicleModel(info.vehicle, { ...DEFAULT_LIVERY, primary: info.color, accent: info.accent });
            body.add(rider.body);
            for (const w of rider.wheels) group.add(w);
            rider.body.traverse((o) => (o.castShadow = true));
            this.group.add(group);
            this.rivals.push({
                info,
                data: new DataView(bin, info.offset, n * 24),
                group,
                body,
                rider,
                tag,
                prevYaw: 0,
                steer: 0,
                dist: -1e9,
                // Starting grid: spread across the road, fading into their own lines after the start.
                lateral: (k % 2 ? 1 : -1) * (320 + 330 * Math.floor(k / 2)),
            });
        });
    }

    /** Pose + progress of every rival at game frame `frame` (fractional for interpolation). */
    update(frame: number, timeSec: number, camera?: THREE.Vector3): void {
        for (const r of this.rivals) {
            // Name tags only for rivals nearby (far ones pile up on the horizon).
            if (camera) r.tag.visible = r.group.position.distanceTo(camera) < 16000;
            const n = r.data.byteLength / 24;
            const fi = Math.max(0, frame / r.info.stride);
            const i0 = Math.min(n - 1, Math.floor(fi));
            const i1 = Math.min(n - 1, i0 + 1);
            const t = Math.min(1, fi - i0);
            const d = r.data;
            const px = d.getFloat32(i0 * 24, true) * (1 - t) + d.getFloat32(i1 * 24, true) * t;
            const py = d.getFloat32(i0 * 24 + 4, true) * (1 - t) + d.getFloat32(i1 * 24 + 4, true) * t;
            const pz = d.getFloat32(i0 * 24 + 8, true) * (1 - t) + d.getFloat32(i1 * 24 + 8, true) * t;
            const quat = (i: number, out: THREE.Quaternion) =>
                out.set(d.getInt16(i * 24 + 12, true) / 32767, d.getInt16(i * 24 + 14, true) / 32767, d.getInt16(i * 24 + 16, true) / 32767, d.getInt16(i * 24 + 18, true) / 32767).normalize();
            quat(i0, this.q).slerp(quat(i1, this.q2), t);
            const dist0 = d.getFloat32(i0 * 24 + 20, true);
            const dist1 = d.getFloat32(i1 * 24 + 20, true);
            const speed = ((dist1 - dist0) / r.info.stride) * (i1 > i0 ? 1 : 0);
            r.dist = dist0 * (1 - t) + dist1 * t;
            r.group.position.set(px, py, pz);
            r.group.quaternion.copy(this.q);
            // Grid spread, fading out over the first ~6 s of racing.
            const fade = Math.max(0, Math.min(1, 1 - (frame - RACE_START - 60) / 300));
            this.fwd.set(0, 0, 1).applyQuaternion(this.q);
            if (fade > 0) {
                // Horizontal sideways direction (the kart's own X axis includes its roll).
                this.right.set(this.fwd.z, 0, -this.fwd.x).normalize();
                r.group.position.addScaledVector(this.right, r.lateral * fade);
            }
            const yaw = Math.atan2(this.fwd.x, this.fwd.z);
            let dy = yaw - r.prevYaw;
            dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            r.prevYaw = yaw;
            r.steer += (Math.max(-1, Math.min(1, -dy * 40)) - r.steer) * 0.15;
            r.group.visible = frame < r.info.frames + 120;
            r.rider.update({ timeSec, steer: r.steer, speed: speed || 60, drifting: 0, boosting: speed > 88, airborne: false, wheelie: false, trick: -1, throttle: true });
        }
    }

    /** Race position (1-based) of a player at lap distance `dist` (same units as the rivals'). */
    position(dist: number, frame: number, playerFinishFrame: number | null): number {
        let ahead = 0;
        for (const r of this.rivals) {
            const rivalDone = frame >= r.info.finishFrame;
            if (playerFinishFrame !== null) ahead += r.info.finishFrame < playerFinishFrame ? 1 : 0;
            else if (rivalDone || r.dist > dist) ++ahead;
        }
        return ahead + 1;
    }

    count(): number {
        return this.rivals.length;
    }

    /** Minimap dots. */
    dots(): { x: number; z: number; color: string }[] {
        return this.rivals.filter((r) => r.group.visible).map((r) => ({ x: r.group.position.x, z: r.group.position.z, color: r.info.color }));
    }

    /** Finish times (frames from the race start) for the results table. */
    finishes(): { name: string; color: string; frames: number }[] {
        return this.rivals.map((r) => ({ name: r.info.name, color: r.info.color, frames: r.info.finishFrame - RACE_START }));
    }

    dispose(): void {
        for (const r of this.rivals) {
            r.rider.dispose();
            (r.tag.material as THREE.SpriteMaterial).map?.dispose();
            r.tag.material.dispose();
        }
    }
}
