/**
 * The page's side of the ghost simulator (ghostWorker.ts): run files in, pose tracks out, one at a
 * time in a Web Worker (~1-2 s a lap) while the race runs here.
 */

import type { RulesData } from '../rules/resim';
import type { VehicleTune } from '../tuning';
import type { GhostRequest, GhostResponse } from './ghostWorker';

export interface GhostTrack {
    samples: Float32Array;
    stride: number;
    /** What the simulation gave (null: the run didn't finish). */
    finishFrame: number | null;
    splits: number[];
    raceMs: number | null;
}

export class GhostSim {
    private readonly worker = new Worker(new URL('./ghostWorker.ts', import.meta.url), { type: 'module' });
    private next = 0;
    private readonly pending = new Map<number, { resolve: (t: GhostTrack) => void; reject: (e: Error) => void }>();

    /** `data`: the course and vehicle data the runs are simulated with (copied to the worker). */
    constructor(data: RulesData) {
        this.worker.onmessage = (e: MessageEvent<GhostResponse>) => {
            const m = e.data;
            const p = this.pending.get(m.id);
            this.pending.delete(m.id);
            if ('error' in m) p?.reject(new Error(m.error));
            else p?.resolve(m);
        };
        this.worker.onerror = (e) => {
            for (const p of this.pending.values()) p.reject(new Error(`ghost worker: ${e.message}`));
            this.pending.clear();
        };
        this.post({ type: 'init', data });
    }

    private post(m: GhostRequest): void {
        this.worker.postMessage(m);
    }

    /** The pose track of a run file (`tune`: the dev tuning it was raced with). */
    track(file: Uint8Array, tune?: VehicleTune): Promise<GhostTrack> {
        const id = ++this.next;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.post({ type: 'run', id, file, tune });
        });
    }

    dispose(): void {
        this.worker.terminate();
    }
}
