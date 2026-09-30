/**
 * Run files end to end in Node: a scripted, noisy human-ish lap (tools/lib/padDriver.ts) raced
 * through the live path the way main.ts races (Sim.step with the course's rules; start, the quick
 * start to the countdown, a pad per frame), written as a run file, then verified by re-simulating it
 * (rules/resim.ts): the same positions every frame, finish frame and splits, with the speed-up
 * pickups it collected stored and used on the same frames. Tampering is rejected.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ItemDirector } from '../src/game/item/ItemDirector';
import { checkRun, rulesSim } from '../src/app/rules/resim';
import { rulesHash } from '../src/app/rules/hash';
import { decodeRun, encodeRun, InputDevice, type RunFile } from '../src/app/rules/runfile';
import { loadRulesData } from '../tools/lib/rulesFiles';
import { PadDriver } from '../tools/lib/padDriver';

const data = loadRulesData();
/** The speed-ups the kart holds (the engine's item stock). */
const stockNow = () => ItemDirector.Instance()!.kartItem(0).inventory().currentCount();

describe('run replay and verification', () => {
    let lap: RunFile;
    /** Kart positions after every frame the driver raced. */
    const trace: number[] = [];
    /** Stored speed-ups after every frame; pickups collected (stored or full) and speed-ups used. */
    const stock: number[] = [];
    const pickups = { stored: 0, full: 0, used: 0 };
    let file: Uint8Array;

    beforeAll(async () => {
        // Races a lap on the e-bike; the run file main.ts would write at the finish.
        const sim = rulesSim(data, 'ebike');
        sim.start();
        sim.skipToCountdown();
        const driver = new PadDriver(data.meta.centerline, 7);
        for (let i = 0; i < 60 * 60 * 5 && sim.finishFrame === null; ++i) {
            sim.step(driver.pad(sim.kartPos(), sim.kartForward(), sim.racing()));
            for (const ev of sim.events) {
                if (ev.type === 'itemBox') ++pickups[ev.stored ? 'stored' : 'full'];
                if (ev.type === 'speedUp') ++pickups.used;
            }
            sim.events.length = 0;
            trace.push(sim.kartPos().x, sim.kartPos().y, sim.kartPos().z);
            stock.push(stockNow());
        }
        lap = { rulesHash: await rulesHash(data), vehicle: 'ebike', device: InputDevice.Mouse, flags: 0, finishFrame: sim.finishFrame ?? 0, splits: sim.splits(), pads: sim.recording.slice() };
        file = await encodeRun(lap);
    }, 30_000);

    it('re-simulates a raced lap bit for bit and verifies it', async () => {
        expect(lap.finishFrame).toBeGreaterThan(0);
        // Every section entered, in lap order.
        expect(lap.splits.every((f, i) => f > 0 && (i === 0 || f > lap.splits[i - 1]!))).toBe(true);
        expect(file.length).toBeLessThan(8 * 1024);

        const run = await decodeRun(file);
        const replayed: number[] = [];
        const replayedStock: number[] = [];
        const check = await checkRun(run, data, (sim) => {
            replayed.push(sim.kartPos().x, sim.kartPos().y, sim.kartPos().z);
            replayedStock.push(stockNow());
        });
        // The same position after every frame (the quick-start countdown frames come first).
        expect(replayed.slice(replayed.length - trace.length)).toEqual(trace);
        // Pickups stored (and some collected with the stock full), speed-ups used, never more than
        // three held, and the same stock after every frame of the replay.
        expect(pickups.stored).toBeGreaterThan(0);
        expect(pickups.used).toBeGreaterThan(3);
        expect(Math.max(...stock)).toBeLessThanOrEqual(3);
        expect(replayedStock.slice(replayedStock.length - stock.length)).toEqual(stock);
        expect(check.errors).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.finishFrame).toBe(lap.finishFrame);
        expect(check.splits).toEqual(lap.splits);
        expect(check.raceMs).toBeGreaterThan(120_000);
    }, 30_000);

    it("rejects a run whose claims, rules or inputs don't match", async () => {
        const run = await decodeRun(file);
        const claims = await checkRun({ ...run, finishFrame: run.finishFrame - 60, splits: run.splits.map((f, i) => (i === 5 ? f - 1 : f)), rulesHash: '0'.repeat(64) }, data);
        expect(claims.ok).toBe(false);
        expect(claims.errors.join('\n')).toMatch(/rules hash/);
        expect(claims.errors.join('\n')).toMatch(/finishes on frame \d+, not the claimed/);
        expect(claims.errors.join('\n')).toMatch(/splits .* are not the claimed/);
        // Edited inputs (the throttle off for 100 frames) race differently.
        const pads = run.pads.map((p, i) => (i > 3000 && i < 3100 ? { ...p, buttons: 0 } : p));
        const edited = await checkRun({ ...run, pads }, data);
        expect(edited.ok).toBe(false);
        expect(edited.finishFrame).not.toBe(run.finishFrame);
    }, 30_000);
});
