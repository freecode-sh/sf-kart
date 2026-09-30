/**
 * Small binary helpers shared by the course and ghost tools.
 * All the formats are big-endian.
 */

export class BinWriter {
    private buf: Uint8Array;
    private view: DataView;
    pos = 0;
    length = 0;

    constructor(initial = 1024) {
        this.buf = new Uint8Array(initial);
        this.view = new DataView(this.buf.buffer);
    }

    private ensure(n: number): void {
        const need = this.pos + n;
        if (need <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < need) cap *= 2;
        const nb = new Uint8Array(cap);
        nb.set(this.buf);
        this.buf = nb;
        this.view = new DataView(nb.buffer);
    }

    private advance(n: number): void {
        this.pos += n;
        if (this.pos > this.length) this.length = this.pos;
    }

    u8(v: number): this {
        this.ensure(1);
        this.view.setUint8(this.pos, v & 0xff);
        this.advance(1);
        return this;
    }
    s8(v: number): this {
        this.ensure(1);
        this.view.setInt8(this.pos, v);
        this.advance(1);
        return this;
    }
    u16(v: number): this {
        this.ensure(2);
        this.view.setUint16(this.pos, v & 0xffff, false);
        this.advance(2);
        return this;
    }
    s16(v: number): this {
        this.ensure(2);
        this.view.setInt16(this.pos, v, false);
        this.advance(2);
        return this;
    }
    u32(v: number): this {
        this.ensure(4);
        this.view.setUint32(this.pos, v >>> 0, false);
        this.advance(4);
        return this;
    }
    f32(v: number): this {
        this.ensure(4);
        this.view.setFloat32(this.pos, v, false);
        this.advance(4);
        return this;
    }
    vec3(v: readonly [number, number, number]): this {
        return this.f32(v[0]).f32(v[1]).f32(v[2]);
    }
    bytes(b: Uint8Array): this {
        this.ensure(b.length);
        this.buf.set(b, this.pos);
        this.advance(b.length);
        return this;
    }
    zeros(n: number): this {
        this.ensure(n);
        this.buf.fill(0, this.pos, this.pos + n);
        this.advance(n);
        return this;
    }
    ascii(s: string): this {
        for (let i = 0; i < s.length; ++i) this.u8(s.charCodeAt(i));
        return this;
    }
    /** Patch a u32 at an absolute offset without moving the cursor. */
    patchU32(at: number, v: number): void {
        this.view.setUint32(at, v >>> 0, false);
    }
    finish(): Uint8Array {
        return this.buf.slice(0, this.length);
    }
}

// ---------------------------------------------------------------------------------------------
// CRC32 (IEEE 802.3, the zlib one) — used for the RKG footer.
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; ++n) {
        let c = n;
        for (let k = 0; k < 8; ++k) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; ++i) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** CRC-16/XMODEM (poly 0x1021, init 0) as used for the Mii data block in RKG headers. */
export function crc16ccitt(data: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < data.length; ++i) {
        crc ^= data[i]! << 8;
        for (let k = 0; k < 8; ++k) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
}
