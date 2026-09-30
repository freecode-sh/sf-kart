/**
 * Port of Kinoko source/game/system/map/MapdataAccessorBase.hh.
 *
 * Pointer representation: C++ keeps `const SData *` pointers into the KMP file. In TS a pointer
 * is the pair (file bytes, byte offset); see MapdataPointer.
 */

import { Vector2f, Vector3f } from '../../../egg/math/Vector';
import { RamStream } from '../../../egg/util/Stream';

/** A `const T *` into the KMP file. */
export interface MapdataPointer {
    readonly data: Uint8Array;
    readonly offset: number;
}

/** sizeof(MapSectionHeader) == 8 (s32 magic, u16 count, 2 bytes padding). */
export const MAP_SECTION_HEADER_SIZE = 8;

export class MapSectionHeader implements MapdataPointer {
    constructor(
        readonly data: Uint8Array,
        readonly offset: number,
    ) {}

    magic(): number {
        return this.view().getInt32(0, false);
    }

    count(): number {
        return this.view().getUint16(4, false);
    }

    /** C++ `m_sectionHeader + n` (pointer arithmetic in units of MapSectionHeader). */
    plus(n: number): MapdataPointer {
        return { data: this.data, offset: this.offset + n * MAP_SECTION_HEADER_SIZE };
    }

    private view(): DataView {
        return new DataView(this.data.buffer, this.data.byteOffset + this.offset, 6);
    }
}

/** Creates a big-endian RamStream over `size` bytes at the pointer. */
export function streamAt(ptr: MapdataPointer, size: number): RamStream {
    const avail = Math.max(0, Math.min(size, ptr.data.byteLength - ptr.offset));
    return RamStream.from(ptr.data, ptr.offset, avail);
}

/** C++ `EGG::Vector3f::read(stream)`. */
export function readVector3f(stream: RamStream, out: Vector3f = new Vector3f()): Vector3f {
    out.x = stream.read_f32();
    out.y = stream.read_f32();
    out.z = stream.read_f32();
    return out;
}

/** C++ `EGG::Vector2f::read(stream)`. */
export function readVector2f(stream: RamStream, out: Vector2f = new Vector2f()): Vector2f {
    out.x = stream.read_f32();
    out.y = stream.read_f32();
    return out;
}

export abstract class MapdataAccessorBase<T> {
    protected m_entries: T[] = [];
    protected m_entryCount = 0;
    protected m_sectionHeader: MapSectionHeader;

    constructor(header: MapSectionHeader) {
        this.m_sectionHeader = header;
    }

    get(i: number): T | null {
        i &= 0xffff; // u16 parameter
        return i < this.m_entryCount ? this.m_entries[i]! : null;
    }

    size(): number {
        return this.m_entryCount;
    }

    /**
     * C++ `init(const TData *start, u16 count)`; `stride` is sizeof(TData) and `factory` is
     * `egg_new<T>(&start[i])`.
     */
    protected initEntries(
        start: MapdataPointer,
        count: number,
        stride: number,
        factory: (ptr: MapdataPointer) => T,
    ): void {
        if (count !== 0) {
            this.m_entryCount = count;
            this.m_entries = new Array<T>(count);
        }

        for (let i = 0; i < count; ++i) {
            this.m_entries[i] = factory({ data: start.data, offset: start.offset + i * stride });
        }
    }
}
