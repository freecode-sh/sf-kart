/**
 * Run files (SFKR): a finished run as its engine inputs (race.ts), all a verifier needs to race it
 * again and get the same time. About 3-6 KB for a lap.
 *
 *   header (24 bytes, little-endian)
 *     0  "SFKR"
 *     4  u8   version (1)
 *     5  u8   vehicle (index in VEHICLES)
 *     6  u16  0
 *     8  8 B  rules id (rules.ts; its 16 hex digits as 8 bytes)
 *     16 u32  frames (inputs)
 *     20 u32  the claimed time (ms)
 *   body: deflate-raw of one u16 per frame: buttons | stickX << 4 | stickY << 8 | trick << 12
 */

import { VEHICLES, type VehicleId } from '../vehicles';
import type { EngineInput } from './race';
import { hex } from './rules';

export interface Run {
    vehicle: VehicleId;
    rules: string;
    timeMs: number;
    inputs: EngineInput[];
}

const MAGIC = 0x524b4653; // "SFKR"
const VERSION = 1;
const HEADER = 24;
/** Longest run a file may hold (5 minutes of frames and some). */
export const MAX_FRAMES = 20000;

export async function encodeRun(run: Run): Promise<Uint8Array> {
    const body = new Uint8Array(run.inputs.length * 2);
    const bv = new DataView(body.buffer);
    run.inputs.forEach((f, i) => bv.setUint16(i * 2, (f.buttons & 0xf) | ((f.stickX & 0xf) << 4) | ((f.stickY & 0xf) << 8) | ((f.trick & 0x7) << 12), true));
    const packed = await transform(body, new CompressionStream('deflate-raw'));
    const out = new Uint8Array(HEADER + packed.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, MAGIC, true);
    v.setUint8(4, VERSION);
    v.setUint8(5, VEHICLES.findIndex((d) => d.id === run.vehicle));
    if (!/^[0-9a-f]{16}$/.test(run.rules)) throw new Error('bad rules id');
    for (let i = 0; i < 8; ++i) out[8 + i] = parseInt(run.rules.slice(i * 2, i * 2 + 2), 16);
    v.setUint32(16, run.inputs.length, true);
    v.setUint32(20, run.timeMs, true);
    out.set(packed, HEADER);
    return out;
}

/** Throws on anything malformed. */
export async function decodeRun(bytes: Uint8Array): Promise<Run> {
    if (bytes.length < HEADER) throw new Error('short file');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(0, true) !== MAGIC || v.getUint8(4) !== VERSION) throw new Error('not an SFKR v1 file');
    const vehicle = VEHICLES[v.getUint8(5)]?.id;
    if (!vehicle) throw new Error('unknown vehicle');
    const rules = hex(bytes.subarray(8, 16));
    const frames = v.getUint32(16, true);
    if (frames > MAX_FRAMES) throw new Error('too long');
    const body = await transform(bytes.subarray(HEADER), new DecompressionStream('deflate-raw'), frames * 2);
    if (body.length !== frames * 2) throw new Error('frame count mismatch');
    const bv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const inputs: EngineInput[] = [];
    for (let i = 0; i < frames; ++i) {
        const w = bv.getUint16(i * 2, true);
        const f = { buttons: w & 0xf, stickX: (w >> 4) & 0xf, stickY: (w >> 8) & 0xf, trick: (w >> 12) & 0x7 };
        if (f.stickX > 14 || f.stickY > 14 || f.trick > 4) throw new Error(`bad input at frame ${i}`);
        inputs.push(f);
    }
    return { vehicle, rules, timeMs: v.getUint32(20, true), inputs };
}

/** A run file's id: the first 16 hex digits of its SHA-256. */
export async function runId(bytes: Uint8Array): Promise<string> {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)).subarray(0, 8));
}


/** Pipes bytes through a (de)compression stream; stops reading past `limit` bytes (a zip bomb guard). */
async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => {});
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
        if (n > limit) {
            await reader.cancel();
            throw new Error('body too long');
        }
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}
