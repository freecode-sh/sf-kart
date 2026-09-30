import { describe, expect, it } from 'vitest';
import { decodeRun, encodeRun, fromBase64, InputDevice, RUN_TUNED, toBase64, type RunFile } from '../src/app/rules/runfile';
import type { RawPadState } from '../src/app/input';

const HASH = 'ab'.repeat(32);

/** xorshift32 in [0, 1). */
function rng(seed: number): () => number {
    let x = seed >>> 0 || 1;
    return () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return (x >>> 0) / 0x100000000;
    };
}

/**
 * A 3-minute race as a person with a mouse drives it: steering through corners with a hand that's
 * never still (the quantized stick changes on ~30% of frames), the drift button held through the
 * corners, hop taps, trick presses, speed-ups and the odd lift off the throttle.
 */
function humanRun(seed: number, frames = 3 * 60 * 60): RawPadState[] {
    const r = rng(seed);
    const pads: RawPadState[] = [];
    let mouse = 0;
    let target = 0;
    let corner = 0;
    let drift = 0;
    let tap = 0;
    let lift = 0;
    for (let i = 0; i < frames; ++i) {
        if (corner-- <= 0) {
            corner = 60 + Math.floor(r() * 240);
            target = r() < 0.4 ? 0 : (r() - 0.5) * 1.8;
        }
        mouse += (target - mouse) * 0.1 + (r() < 0.6 ? (r() - 0.5) * 0.25 : 0);
        mouse = Math.max(-1, Math.min(1, mouse));
        let buttons = 0x1;
        if (lift > 0) {
            lift--;
            buttons = 0;
        } else if (r() < 0.002) lift = 10 + Math.floor(r() * 20);
        if (drift > 0) drift--;
        else if (Math.abs(target) > 0.5 && r() < 0.05) drift = 30 + Math.floor(r() * 90);
        if (tap > 0) tap--;
        else if (r() < 0.01) tap = 1 + Math.floor(r() * 4);
        if (drift > 0 || tap > 0) buttons |= 0x8;
        if (r() < 0.004) buttons |= 0x4;
        const trick = r() < 0.003 ? 1 + Math.floor(r() * 4) : 0;
        pads.push({ buttons, stickXRaw: Math.round(7 + mouse * 7), stickYRaw: r() < 0.01 ? 2 : 7, trick, explicitTrick: trick > 1 });
    }
    return pads;
}

const run = (pads: RawPadState[], extra: Partial<RunFile> = {}): RunFile => ({
    rulesHash: HASH,
    vehicle: 'robotaxi',
    device: InputDevice.Mouse,
    flags: 0,
    finishFrame: pads.length + 412,
    splits: [412, 1039, 1543, 2254, 9888],
    pads,
    ...extra,
});

/** A pad as it comes back from a file: the d-pad flag only with a trick. */
const normal = (p: RawPadState): RawPadState => ({ buttons: p.buttons, stickXRaw: p.stickXRaw, stickYRaw: p.stickYRaw, trick: p.trick, ...(p.explicitTrick && p.trick ? { explicitTrick: true } : {}) });

describe('run files (SFKR)', () => {
    it('round-trips the header and every pad', async () => {
        const pads = humanRun(5, 5000);
        const back = await decodeRun(await encodeRun(run(pads, { flags: RUN_TUNED, device: InputDevice.Gamepad, vehicle: 'buggy' })));
        expect(back.rulesHash).toBe(HASH);
        expect(back.vehicle).toBe('buggy');
        expect(back.device).toBe(InputDevice.Gamepad);
        expect(back.flags).toBe(RUN_TUNED);
        expect(back.finishFrame).toBe(5412);
        expect(back.splits).toEqual([412, 1039, 1543, 2254, 9888]);
        expect(back.pads).toEqual(pads.map(normal));
    });

    it('round-trips every pad value and long runs', async () => {
        const pads: RawPadState[] = [];
        for (let b = 0; b < 16; ++b) for (let x = 0; x < 15; ++x) for (let t = 0; t < 5; ++t) pads.push({ buttons: b, stickXRaw: x, stickYRaw: 14 - x, trick: t, explicitTrick: t > 0 && x % 2 === 0 });
        for (let i = 0; i < 20000; ++i) pads.push({ buttons: 1, stickXRaw: 7, stickYRaw: 7, trick: 0 });
        const back = await decodeRun(await encodeRun(run(pads, { splits: [] })));
        expect(back.pads).toEqual(pads.map(normal));
        expect(back.splits).toEqual([]);
    });

    it('keeps a 3-minute mouse-steered run at a few KB', async () => {
        for (const seed of [1, 2, 3]) {
            const pads = humanRun(seed);
            let changes = 0;
            for (let i = 1; i < pads.length; ++i) if (pads[i]!.stickXRaw !== pads[i - 1]!.stickXRaw) ++changes;
            expect(changes / pads.length).toBeGreaterThan(0.25);
            const bytes = await encodeRun(run(pads));
            console.log(`3-minute mouse run (seed ${seed}): ${bytes.length} bytes, stick X changes on ${Math.round((100 * changes) / pads.length)}% of frames`);
            expect(bytes.length).toBeGreaterThan(2000);
            expect(bytes.length).toBeLessThan(8 * 1024);
        }
    });

    it('rejects malformed files', async () => {
        const good = await encodeRun(run(humanRun(9, 600)));
        await expect(decodeRun(good.slice(0, 20))).rejects.toThrow(/not a run file/);
        const magic = good.slice();
        magic[0] = 0x58;
        await expect(decodeRun(magic)).rejects.toThrow(/not a run file/);
        const version = good.slice();
        version[4] = 9;
        await expect(decodeRun(version)).rejects.toThrow(/version/);
        // Claims more frames than the body holds.
        const frames = good.slice();
        new DataView(frames.buffer).setUint32(40, 700, true);
        await expect(decodeRun(frames)).rejects.toThrow(/truncated|overrun/);
        // Claims fewer.
        new DataView(frames.buffer).setUint32(40, 500, true);
        await expect(decodeRun(frames)).rejects.toThrow(/overrun/);
        await expect(decodeRun(good.slice(0, good.length - 5))).rejects.toThrow();
        await expect(encodeRun(run([{ buttons: 1, stickXRaw: 15, stickYRaw: 7, trick: 0 }]))).rejects.toThrow(/out of range/);
    });

    it('survives base64', async () => {
        const bytes = await encodeRun(run(humanRun(4, 300)));
        expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    });
});
