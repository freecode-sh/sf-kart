/**
 * A ghost's pose track: the kart's position and rotation every other game frame, as CompareGhosts
 * (ghosts.ts) plays it. Recorded live during a race, or simulated from a run file in a worker
 * (ghostWorker.ts). Three.js math only, no DOM.
 */

import type * as THREE from 'three';
import type { VehicleId } from '../vehicles';

/** Game frames per sample. */
export const POSE_STRIDE = 2;
/** Floats per sample: position, rotation quaternion. */
export const POSE_FLOATS = 7;

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

/** Collects the kart's pose each game frame (keeps every POSE_STRIDE-th session frame). */
export class RunRecorder {
    private buf = new Float32Array(POSE_FLOATS * 4096);
    private n = 0;

    reset(): void {
        this.n = 0;
    }

    push(frame: number, pos: THREE.Vector3, rot: THREE.Quaternion): void {
        if (frame % POSE_STRIDE !== 0) return;
        const i = frame / POSE_STRIDE;
        if ((i + 1) * POSE_FLOATS > this.buf.length) {
            const b = new Float32Array(this.buf.length * 2);
            b.set(this.buf);
            this.buf = b;
        }
        // Fill any gap (a skipped frame) with this pose.
        for (let k = this.n; k <= i; ++k) this.buf.set([pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w], k * POSE_FLOATS);
        this.n = Math.max(this.n, i + 1);
    }

    samples(): Float32Array {
        return this.buf.slice(0, this.n * POSE_FLOATS);
    }

    run(vehicle: VehicleId, frames: number, splits: Record<string, number>, tune: string): GhostRun {
        return { vehicle, frames, stride: POSE_STRIDE, samples: this.samples(), splits, tune, date: Date.now() };
    }
}
