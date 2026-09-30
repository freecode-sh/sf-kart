/**
 * Run files (`SFKR` v1): one race as its inputs, a few KB. The pads a run took (Sim.recording) plus
 * what they were raced under, so anyone can replay the run exactly through the live path
 * (Sim.startRun) and the server can re-simulate it (resim.ts) and trust only the time it computes.
 * Shared by the app, the Node tools and the leaderboard Worker: no DOM or Node APIs, only
 * CompressionStream / DecompressionStream (browsers, Node 18+, Workers).
 *
 * Layout (little-endian):
 *   0   "SFKR"
 *   4   u8   version (1)
 *   5   32 B rules hash (RULES_HASH, SHA-256: the course, vehicles and rules the run was raced under)
 *   37  u8   vehicle (RUN_VEHICLES index)
 *   38  u8   input device (InputDevice)
 *   39  u8   flags (RUN_TUNED: raced with dev tuning; never ranked)
 *   40  u32  frame count (pads)
 *   44  u32  claimed finish frame (session frame, Sim.finishFrame; 0 = didn't finish)
 *   48  u8   split count, then u32 each (Sim.splits: session frame each section was entered)
 *   ..  body: deflate-raw of the pads, run-length encoded column by column: the buttons + trick,
 *       stick X, stick Y, each as (value u8, run length varint) until the runs cover every frame.
 *
 * Frame i is the i-th pad Sim.step took after Sim.start(): replayed from start() they drive the
 * same run. A run's time is whatever re-simulating it gives, never the claimed numbers.
 */

import type { RawPadState } from '../input';
import type { VehicleId } from '../vehicles';

export const RUN_VERSION = 1;
const MAGIC = [0x53, 0x46, 0x4b, 0x52]; // "SFKR"
const HEADER = 49;

/** Vehicle indices in run files (fixed: append new vehicles, never reorder). */
export const RUN_VEHICLES: readonly VehicleId[] = ['ebike', 'robotaxi', 'buggy'];

export const enum InputDevice {
    Keyboard = 0,
    Mouse = 1,
    Gamepad = 2,
}

/** Flag: raced with dev tuning (stats other than the vehicle data's). */
export const RUN_TUNED = 0x1;

/** Longest run a file may hold (frames): 10 minutes. */
export const MAX_RUN_FRAMES = 60 * 60 * 10;

export interface RunFile {
    /** SHA-256, hex. */
    rulesHash: string;
    vehicle: VehicleId;
    device: InputDevice;
    flags: number;
    /** Claimed finish frame (0: didn't finish). */
    finishFrame: number;
    /** Claimed section splits (Sim.splits). */
    splits: number[];
    /** The pads, one per frame from Sim.start(). */
    pads: RawPadState[];
}

/*
 * Body words, one per frame: buttons (4 bits), trick (3), d-pad trick (1) in the first column,
 * then stick X and stick Y. The d-pad flag only matters with a trick, so it's kept only then.
 */
const col0 = (p: RawPadState) => p.buttons | (p.trick << 4) | (p.explicitTrick && p.trick ? 0x80 : 0);

function checkPad(p: RawPadState, i: number): void {
    const ok = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
    if (!ok(p.buttons, 15) || !ok(p.stickXRaw, 14) || !ok(p.stickYRaw, 14) || !ok(p.trick, 4)) {
        throw new Error(`run file: pad ${i} out of range (${JSON.stringify(p)})`);
    }
}

function rle(out: number[], values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; ) {
        const v = values[i]!;
        let j = i + 1;
        while (j < values.length && values[j] === v) ++j;
        out.push(v);
        for (let n = j - i; ; n >>>= 7) {
            if (n < 0x80) {
                out.push(n);
                break;
            }
            out.push((n & 0x7f) | 0x80);
        }
        i = j;
    }
}

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
    const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(through).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) {
            await reader.cancel();
            throw new Error('run file: body too large');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

export async function encodeRun(run: RunFile): Promise<Uint8Array> {
    const n = run.pads.length;
    if (n > MAX_RUN_FRAMES) throw new Error(`run file: ${n} frames (max ${MAX_RUN_FRAMES})`);
    if (!/^[0-9a-f]{64}$/.test(run.rulesHash)) throw new Error('run file: rules hash must be 64 hex digits');
    const vehicle = RUN_VEHICLES.indexOf(run.vehicle);
    if (vehicle < 0) throw new Error(`run file: unknown vehicle ${run.vehicle}`);
    if (run.splits.length > 255) throw new Error('run file: too many splits');
    run.pads.forEach(checkPad);

    const cols = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)] as const;
    run.pads.forEach((p, i) => {
        cols[0][i] = col0(p);
        cols[1][i] = p.stickXRaw;
        cols[2][i] = p.stickYRaw;
    });
    const raw: number[] = [];
    for (const c of cols) rle(raw, c);
    const body = await pipe(new Uint8Array(raw), new CompressionStream('deflate-raw'), Infinity);

    const head = HEADER + run.splits.length * 4;
    const out = new Uint8Array(head + body.length);
    const d = new DataView(out.buffer);
    out.set(MAGIC, 0);
    d.setUint8(4, RUN_VERSION);
    for (let i = 0; i < 32; ++i) d.setUint8(5 + i, parseInt(run.rulesHash.slice(i * 2, i * 2 + 2), 16));
    d.setUint8(37, vehicle);
    d.setUint8(38, run.device);
    d.setUint8(39, run.flags);
    d.setUint32(40, n, true);
    d.setUint32(44, run.finishFrame, true);
    d.setUint8(48, run.splits.length);
    run.splits.forEach((s, i) => d.setUint32(HEADER + i * 4, s, true));
    out.set(body, head);
    return out;
}

/** Reads a run file; throws on anything malformed (bad magic or version, lengths, values). */
export async function decodeRun(bytes: Uint8Array): Promise<RunFile> {
    const bad = (why: string) => new Error(`run file: ${why}`);
    if (bytes.length < HEADER || MAGIC.some((m, i) => bytes[i] !== m)) throw bad('not a run file');
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (d.getUint8(4) !== RUN_VERSION) throw bad(`version ${d.getUint8(4)} (expected ${RUN_VERSION})`);
    let rulesHash = '';
    for (let i = 0; i < 32; ++i) rulesHash += d.getUint8(5 + i).toString(16).padStart(2, '0');
    const vehicle = RUN_VEHICLES[d.getUint8(37)];
    if (!vehicle) throw bad(`unknown vehicle ${d.getUint8(37)}`);
    const device = d.getUint8(38);
    if (device > InputDevice.Gamepad) throw bad(`unknown input device ${device}`);
    const n = d.getUint32(40, true);
    if (n > MAX_RUN_FRAMES) throw bad(`${n} frames (max ${MAX_RUN_FRAMES})`);
    const splitCount = d.getUint8(48);
    const head = HEADER + splitCount * 4;
    if (bytes.length < head) throw bad('truncated');
    const splits: number[] = [];
    for (let i = 0; i < splitCount; ++i) splits.push(d.getUint32(HEADER + i * 4, true));

    // At most (value + 3-byte length) per frame per column.
    const raw = await pipe(bytes.subarray(head), new DecompressionStream('deflate-raw'), n * 12 + 16);
    const cols = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)] as const;
    let o = 0;
    for (const c of cols) {
        for (let i = 0; i < n; ) {
            if (o >= raw.length) throw bad('body truncated');
            const v = raw[o++]!;
            let len = 0;
            for (let shift = 0; ; shift += 7) {
                if (o >= raw.length || shift > 21) throw bad('bad run length');
                const b = raw[o++]!;
                len += (b & 0x7f) * 2 ** shift;
                if (b < 0x80) break;
            }
            if (len === 0 || i + len > n) throw bad('runs overrun the frame count');
            c.fill(v, i, i + len);
            i += len;
        }
    }
    if (o !== raw.length) throw bad('trailing body bytes');
    const pads: RawPadState[] = [];
    for (let i = 0; i < n; ++i) {
        const a = cols[0][i]!;
        const pad: RawPadState = { buttons: a & 0xf, stickXRaw: cols[1][i]!, stickYRaw: cols[2][i]!, trick: (a >> 4) & 0x7 };
        if (a & 0x80) pad.explicitTrick = true;
        checkPad(pad, i);
        pads.push(pad);
    }
    return { rulesHash, vehicle, device, flags: d.getUint8(39), finishFrame: d.getUint32(44, true), splits, pads };
}

export function toBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
    return out;
}
