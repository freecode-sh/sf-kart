/** Port of Kinoko's egg/util/Stream.hh (RamStream). Big-endian by default. */

export class RamStream {
    private view: DataView;
    private m_index = 0;
    private littleEndian = false;

    constructor(
        private readonly m_buffer: Uint8Array,
        private readonly m_size: number = m_buffer.byteLength,
    ) {
        this.view = new DataView(m_buffer.buffer, m_buffer.byteOffset, m_size);
    }

    /** Creates a stream from an ArrayBuffer or Uint8Array view (sub-range supported). */
    static from(data: ArrayBuffer | Uint8Array, offset = 0, size?: number): RamStream {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const len = size ?? bytes.byteLength - offset;
        return new RamStream(bytes.subarray(offset, offset + len), len);
    }

    setEndian(little: boolean): void {
        this.littleEndian = little;
    }

    index(): number {
        return this.m_index;
    }

    eof(): boolean {
        return this.m_index === this.m_size;
    }

    safe(size: number): boolean {
        return this.m_index + size <= this.m_size;
    }

    bad(): boolean {
        return this.m_index > this.m_size;
    }

    skip(count: number): void {
        this.m_index += count;
    }

    jump(index: number): void {
        this.m_index = index;
    }

    data(): Uint8Array {
        return this.m_buffer;
    }

    dataAtIndex(): Uint8Array {
        return this.m_buffer.subarray(this.m_index);
    }

    /** Returns a stream over the next `size` bytes and advances past them. */
    split(size: number): RamStream {
        const s = new RamStream(this.m_buffer.subarray(this.m_index, this.m_index + size), size);
        s.setEndian(this.littleEndian);
        this.m_index += size;
        return s;
    }

    private check(size: number): void {
        if (!this.safe(size)) throw new Error('RamStream: read out of bounds');
    }

    read_u8(): number {
        this.check(1);
        return this.view.getUint8(this.m_index++);
    }

    read_s8(): number {
        this.check(1);
        return this.view.getInt8(this.m_index++);
    }

    read_u16(): number {
        this.check(2);
        const v = this.view.getUint16(this.m_index, this.littleEndian);
        this.m_index += 2;
        return v;
    }

    read_s16(): number {
        this.check(2);
        const v = this.view.getInt16(this.m_index, this.littleEndian);
        this.m_index += 2;
        return v;
    }

    read_u32(): number {
        this.check(4);
        const v = this.view.getUint32(this.m_index, this.littleEndian);
        this.m_index += 4;
        return v;
    }

    read_s32(): number {
        this.check(4);
        const v = this.view.getInt32(this.m_index, this.littleEndian);
        this.m_index += 4;
        return v;
    }

    read_f32(): number {
        this.check(4);
        const v = this.view.getFloat32(this.m_index, this.littleEndian);
        this.m_index += 4;
        return v;
    }

    read_f64(): number {
        this.check(8);
        const v = this.view.getFloat64(this.m_index, this.littleEndian);
        this.m_index += 8;
        return v;
    }

    /** Reads a NUL-terminated string. */
    read_string(): string {
        let s = '';
        for (;;) {
            const c = this.read_u8();
            if (c === 0) break;
            s += String.fromCharCode(c);
        }
        return s;
    }
}
