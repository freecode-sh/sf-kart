/**
 * Ghost simulator (a Web Worker, since the engine's singletons allow one simulation per JS realm and
 * the page's is racing): a run file in, the ghost's pose track out (ghostTrack.ts, what
 * CompareGhosts plays), simulated from the run's pads through the live path (rules/resim.ts).
 * ghostSim.ts is the page's side.
 *
 * Messages in:  { type: 'init', data: RulesData }, then { id, file, tune? } per run.
 * Messages out: { id, samples, stride, finishFrame, splits, raceMs } or { id, error }.
 */

import { resim, type RulesData } from '../rules/resim';
import { decodeRun } from '../rules/runfile';
import type { VehicleTune } from '../tuning';
import { POSE_STRIDE, RunRecorder } from './ghostTrack';

export type GhostRequest = { type: 'init'; data: RulesData } | { type: 'run'; id: number; file: Uint8Array; tune?: VehicleTune };

export type GhostResponse =
    | { id: number; samples: Float32Array; stride: number; finishFrame: number | null; splits: number[]; raceMs: number | null }
    | { id: number; error: string };

const scope = self as unknown as {
    onmessage: ((e: MessageEvent<GhostRequest>) => void) | null;
    postMessage(msg: GhostResponse, transfer?: Transferable[]): void;
};

let data: RulesData | null = null;

scope.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
        data = m.data;
        return;
    }
    try {
        if (!data) throw new Error('ghost worker: no course data yet');
        const run = await decodeRun(m.file);
        const rec = new RunRecorder();
        const r = resim(run, data, (sim) => rec.push(sim.frame(), sim.kartPos(), sim.kartRot()), m.tune);
        const samples = rec.samples();
        scope.postMessage({ id: m.id, samples, stride: POSE_STRIDE, finishFrame: r.finishFrame, splits: r.splits, raceMs: r.raceMs }, [samples.buffer]);
    } catch (err) {
        scope.postMessage({ id: m.id, error: String((err as Error).message ?? err) });
    }
};
