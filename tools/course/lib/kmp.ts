/**
 * KMP writer (big-endian, revision 2520). Layout (see Kinoko System::MapdataFileAccessor):
 *
 *   0x00 "RKMD" | u32 fileSize | u16 sectionCount | u16 headerSize | u32 revision
 *   0x10 u32 sectionOffsets[sectionCount] (relative to the end of the header)
 *   sections: "MAGC" | u16 entryCount | u16 extra | entries...
 *
 * Entry layouts (sizes in bytes):
 *   KTPT 0x1C: f32[3] pos, f32[3] rot (deg), s16 playerIndex, u16 pad
 *   ENPT 0x14: f32[3] pos, f32 width, u16 setting1, u8 setting2, u8 setting3
 *   ENPH 0x10: u8 start, u8 len, u8 prev[6], u8 next[6], u16 pad
 *   ITPT 0x14: f32[3] pos, f32 width, u16 setting1, u16 setting2
 *   ITPH 0x10: same as ENPH
 *   CKPT 0x14: f32[2] left (x,z), f32[2] right (x,z), s8 jugemIndex, s8 checkArea, u8 prev, u8 next
 *   CKPH 0x10: same as ENPH
 *   GOBJ 0x3C, POTI (variable), AREA 0x30, CAME 0x48, MSPT 0x1C
 *   CNPT 0x1C: f32[3] pos, f32[3] rot (deg), u16 id, s16 parameter index (KartMove cannon table)
 *   JGPT 0x1C: f32[3] pos, f32[3] rot, u16 id, s16 range
 *   STGI 0x0C: u8 laps, u8 polePosition, u8 driverDistance, u8 lensFlare, u32 flareColor,
 *              u8 flareAlpha, u8 pad, u16 speedModifier (upper half of an f32; 0 = 1.0x)
 */

import { BinWriter } from '../../lib/bin';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type KtptEntry = { pos: Vec3; rot: Vec3; playerIndex: number };
export type PointEntry = { pos: Vec3; width: number };
export type PathEntry = { start: number; len: number; prev: number[]; next: number[] };
export type CkptEntry = { left: Vec2; right: Vec2; jugem: number; checkArea: number; prev: number; next: number };
export type JgptEntry = { pos: Vec3; rot: Vec3; id: number; range: number };
export type CnptEntry = { pos: Vec3; rot: Vec3; id: number; param: number };
export type StgiEntry = { laps: number; polePosition: number; driverDistance: number; lensFlare: number; flareColor: number; flareAlpha: number };

export type KmpData = {
    ktpt: KtptEntry[];
    enpt: PointEntry[];
    enph: PathEntry[];
    itpt: PointEntry[];
    itph: PathEntry[];
    ckpt: CkptEntry[];
    ckph: PathEntry[];
    jgpt: JgptEntry[];
    cnpt?: CnptEntry[];
    stgi: StgiEntry;
};

const REVISION = 2520;

function pathBytes(w: BinWriter, p: PathEntry): void {
    w.u8(p.start).u8(p.len);
    for (let i = 0; i < 6; ++i) w.u8(p.prev[i] ?? 0xff);
    for (let i = 0; i < 6; ++i) w.u8(p.next[i] ?? 0xff);
    w.u16(0);
}

export function encodeKMP(d: KmpData): Uint8Array {
    type Section = { magic: string; count: number; extra: number; body: Uint8Array };
    const sections: Section[] = [];
    const sec = (magic: string, count: number, extra: number, fill: (w: BinWriter) => void) => {
        const w = new BinWriter(256);
        fill(w);
        sections.push({ magic, count, extra, body: w.finish() });
    };

    sec('KTPT', d.ktpt.length, 0, (w) => {
        for (const e of d.ktpt) w.vec3(e.pos).vec3(e.rot).s16(e.playerIndex).u16(0);
    });
    sec('ENPT', d.enpt.length, 0, (w) => {
        for (const e of d.enpt) w.vec3(e.pos).f32(e.width).u16(0).u8(0).u8(0);
    });
    sec('ENPH', d.enph.length, 0, (w) => d.enph.forEach((p) => pathBytes(w, p)));
    sec('ITPT', d.itpt.length, 0, (w) => {
        for (const e of d.itpt) w.vec3(e.pos).f32(e.width).u16(0).u16(0);
    });
    sec('ITPH', d.itph.length, 0, (w) => d.itph.forEach((p) => pathBytes(w, p)));
    sec('CKPT', d.ckpt.length, 0, (w) => {
        for (const e of d.ckpt) {
            w.f32(e.left[0]).f32(e.left[1]).f32(e.right[0]).f32(e.right[1]);
            w.s8(e.jugem).s8(e.checkArea).u8(e.prev).u8(e.next);
        }
    });
    sec('CKPH', d.ckph.length, 0, (w) => d.ckph.forEach((p) => pathBytes(w, p)));
    sec('GOBJ', 0, 0, () => {});
    sec('POTI', 0, 0, () => {}); // extra = total point count
    sec('AREA', 0, 0, () => {});
    sec('CAME', 0, 0, () => {}); // extra = opening-pan / video camera indices (u8, u8)
    sec('JGPT', d.jgpt.length, 0, (w) => {
        for (const e of d.jgpt) w.vec3(e.pos).vec3(e.rot).u16(e.id).s16(e.range);
    });
    sec('CNPT', d.cnpt?.length ?? 0, 0, (w) => {
        for (const e of d.cnpt ?? []) w.vec3(e.pos).vec3(e.rot).u16(e.id).s16(e.param);
    });
    sec('MSPT', 0, 0, () => {});
    sec('STGI', 1, 0, (w) => {
        const s = d.stgi;
        w.u8(s.laps).u8(s.polePosition).u8(s.driverDistance).u8(s.lensFlare);
        w.u32(s.flareColor).u8(s.flareAlpha).u8(0).u16(0);
    });

    const headerSize = 0x10 + sections.length * 4;
    const w = new BinWriter(4096);
    w.ascii('RKMD').u32(0).u16(sections.length).u16(headerSize).u32(REVISION);
    const offTable = w.pos;
    w.zeros(sections.length * 4);
    sections.forEach((s, i) => {
        w.patchU32(offTable + i * 4, w.pos - headerSize);
        w.ascii(s.magic).u16(s.count).u16(s.extra).bytes(s.body);
    });
    w.patchU32(4, w.length);
    return w.finish();
}
