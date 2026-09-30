/**
 * Leaderboard runs: the run file round-trips, and a run the game races (the live Sim, with its
 * easy-drift and hop-trick layers, the start boost and the pickups the way main.ts applies them)
 * races the same when the verifier replays its recorded engine inputs: same pickups, same
 * position, and for a full lap the same time.
 */

import { describe, expect, it } from 'vitest';
import { decodeRun, encodeRun } from '../src/app/run/runFile';
import { verifyRun } from '../src/app/run/verify';
import { data, liveRun } from './liveRun';

describe('leaderboard runs', () => {
    it('round-trips a run file', async () => {
        const inputs = Array.from({ length: 5000 }, (_, i) => ({ buttons: i % 16, stickX: i % 15, stickY: (i * 7) % 15, trick: i % 5 }));
        const bytes = await encodeRun({ vehicle: 'robotaxi', rules: '0123456789abcdef', timeMs: 171234, inputs });
        expect(await decodeRun(bytes)).toEqual({ vehicle: 'robotaxi', rules: '0123456789abcdef', timeMs: 171234, inputs });
    });

    it('rejects a malformed file', async () => {
        const bytes = await encodeRun({ vehicle: 'ebike', rules: '0123456789abcdef', timeMs: 1, inputs: [{ buttons: 1, stickX: 7, stickY: 7, trick: 0 }] });
        bytes[4] = 9;
        await expect(decodeRun(bytes)).rejects.toThrow();
        await expect(decodeRun(bytes.subarray(0, 10))).rejects.toThrow();
    });

    for (const vehicle of ['ebike', 'robotaxi'] as const) {
        it(`replays a live ${vehicle} run exactly (40 s)`, () => {
            const live = liveRun(vehicle, 2400);
            const v = verifyRun(data, vehicle, live.inputs);
            expect(live.pickups.length).toBeGreaterThan(0);
            expect(v.pickups).toEqual(live.pickups);
            expect(v.pos).toEqual(live.pos);
        }, 60_000);
    }

    it('verifies a full live lap with its time', () => {
        const live = liveRun('buggy', 20000);
        expect(live.finished).toBe(true);
        const v = verifyRun(data, 'buggy', live.inputs);
        expect(v.ok).toBe(true);
        expect(v.timeMs).toBe(live.timeMs);
        expect(v.pickups).toEqual(live.pickups);
        console.log(`buggy lap: ${v.timeMs} ms, ${v.frames} frames, ${v.pickups.length} pickups`);
        // One frame short never finishes.
        expect(verifyRun(data, 'buggy', live.inputs.slice(0, -1)).ok).toBe(false);
    }, 180_000);
});
