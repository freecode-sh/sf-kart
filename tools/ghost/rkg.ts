/**
 * RKG ghost writer (the engine's ghost file format). Layout as read by Kinoko System::GhostFile /
 * RawGhostFile:
 *
 *   0x00 "RKGD"
 *   0x04 u32  finish time: min(7) << 25 | sec(7) << 18 | ms(10) << 8 | course(6) << 2 | 0
 *   0x08 u32  vehicle(6) << 26 | character(6) << 20 | year(7) << 13 | month(4) << 9 | day(5) << 4 | controller(4)
 *   0x0C u32  (unused 4) | compressed(1) << 27 | (unused 2) | ghostType(7) << 18 | driftIsAuto(1) << 17 | 0 | inputDataSize(16)
 *   0x10 u8   lap count
 *   0x11 5 x 3-byte lap splits (min 7 | sec 7 | ms 10)
 *   0x20 20 bytes (unused) + 0x34 u8 location + 7 bytes
 *   0x3C 0x4A bytes driver profile, 0x86 u16 CRC-16/XMODEM of the profile
 *   0x88 input data (uncompressed: 0x2774 bytes, zero padded)
 *   0x27FC u32 CRC32 of everything before it  → total 0x2800 bytes
 *
 * Input data section: u16 faceCount, u16 stickCount, u16 trickCount, u16 pad, then three
 * run-length streams of (value, frames) byte pairs:
 *   face  value: 0x01 accelerate (A), 0x02 brake (B), 0x04 item, 0x08 drift (set with B while A is held)
 *   stick value: stickX << 4 | stickY, raw 0..14 (7 = neutral)
 *   trick value: trick << 4 | (frames >> 8), second byte frames & 0xFF (runs up to 0xFFF frames);
 *                trick 0 none, 1 up, 2 down, 3 left, 4 right
 * Face/stick runs are at most 255 frames. The first frame of input is consumed on the first frame
 * of the countdown (race frame 173, after the 172-frame intro).
 */

import { BinWriter, crc16ccitt, crc32 } from '../lib/bin';

export type InputFrame = {
    buttons: number; // face bits as above
    stickX: number; // raw 0..14
    stickY: number; // raw 0..14
    trick: number; // 0..4
};

const RKG_HEADER_SIZE = 0x88;
const RKG_INPUT_SECTION_SIZE = 0x2774;
const RKG_FILE_SIZE = 0x2800;

function encodeInputs(frames: InputFrame[]): Uint8Array {
    const face: [number, number][] = [];
    const stick: [number, number][] = [];
    const trick: [number, number][] = [];
    const push = (runs: [number, number][], v: number, max: number) => {
        const last = runs[runs.length - 1];
        if (last && last[0] === v && last[1] < max) last[1]++;
        else runs.push([v, 1]);
    };
    for (const f of frames) {
        if (f.stickX < 0 || f.stickX > 14 || f.stickY < 0 || f.stickY > 14) throw new Error('stick out of range');
        if (f.buttons & ~0xf) throw new Error('bad buttons');
        push(face, f.buttons, 0xff);
        push(stick, (f.stickX << 4) | f.stickY, 0xff);
        push(trick, f.trick, 0xfff);
    }
    const w = new BinWriter(8 + 2 * (face.length + stick.length + trick.length));
    w.u16(face.length).u16(stick.length).u16(trick.length).u16(0);
    for (const [v, n] of face) w.u8(v).u8(n);
    for (const [v, n] of stick) w.u8(v).u8(n);
    for (const [v, n] of trick) w.u8((v << 4) | (n >> 8)).u8(n & 0xff);
    const out = w.finish();
    if (out.length > RKG_INPUT_SECTION_SIZE) throw new Error(`input data too large (${out.length} bytes)`);
    return out;
}

export type RkgOptions = {
    /** Engine slots (src/Common.ts: Course, Vehicle, Character). */
    course: number;
    vehicle: number;
    character: number;
    driftIsAuto: boolean;
    /** Controller type, 0..3 (default 2; the engine doesn't read it). */
    controller?: number;
    date?: { year: number; month: number; day: number }; // year relative to 2000
    ghostType?: number;
    finishTime?: { min: number; sec: number; ms: number };
    lapTimes?: { min: number; sec: number; ms: number }[];
    lapCount?: number;
    name?: string;
};

const timeBits = (t: { min: number; sec: number; ms: number }) => ((t.min & 0x7f) << 17) | ((t.sec & 0x7f) << 10) | (t.ms & 0x3ff);

export function buildRKG(frames: InputFrame[], o: RkgOptions): Uint8Array {
    const inputs = encodeInputs(frames);
    const date = o.date ?? { year: 26, month: 9, day: 23 };
    const time = o.finishTime ?? { min: 0, sec: 0, ms: 0 };
    const w = new BinWriter(RKG_FILE_SIZE);
    w.ascii('RKGD');
    w.u32(((timeBits(time) << 8) | ((o.course & 0x3f) << 2)) >>> 0);
    w.u32(
        (((o.vehicle & 0x3f) << 26) |
            ((o.character & 0x3f) << 20) |
            ((date.year & 0x7f) << 13) |
            ((date.month & 0xf) << 9) |
            ((date.day & 0x1f) << 4) |
            ((o.controller ?? 2) & 0xf)) >>>
            0,
    );
    w.u32((((o.ghostType ?? 0x26) & 0x7f) << 18) | ((o.driftIsAuto ? 1 : 0) << 17) | (inputs.length & 0xffff));
    w.u8(o.lapCount ?? 3);
    for (let i = 0; i < 5; ++i) {
        const t = o.lapTimes?.[i] ?? { min: 0, sec: 0, ms: 0 };
        const b = timeBits(t);
        w.u8((b >> 16) & 0xff).u8((b >> 8) & 0xff).u8(b & 0xff);
    }
    // 0x20: user data (unused by the game here) — store the ghost name as UTF-16BE, max 10 chars.
    const name = (o.name ?? 'SF Kart').slice(0, 10);
    for (let i = 0; i < 10; ++i) w.u16(i < name.length ? name.charCodeAt(i) : 0);
    // 0x34: location / country etc.
    w.u8(0xff).u8(0xff).zeros(6);
    // 0x3C: driver profile (0x4A bytes): blank but for the name; CRC follows.
    const profile = new BinWriter(0x4a);
    profile.u16(0x0000); // flags
    for (let i = 0; i < 10; ++i) profile.u16(i < name.length ? name.charCodeAt(i) : 0);
    profile.zeros(0x4a - profile.pos);
    const profileBytes = profile.finish();
    if (w.pos !== 0x3c) throw new Error(`profile offset ${w.pos.toString(16)}`);
    w.bytes(profileBytes);
    w.u16(crc16ccitt(profileBytes));
    if ((w.pos as number) !== RKG_HEADER_SIZE) throw new Error('header size');
    w.bytes(inputs);
    w.zeros(RKG_INPUT_SECTION_SIZE - inputs.length);
    const body = w.finish();
    const out = new BinWriter(RKG_FILE_SIZE);
    out.bytes(body).u32(crc32(body));
    const bytes = out.finish();
    if (bytes.length !== RKG_FILE_SIZE) throw new Error('rkg size');
    return bytes;
}
