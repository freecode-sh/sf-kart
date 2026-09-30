/**
 * Port of Kinoko source/abstract/g3d/ResCommon.hh.
 *
 * Pointer representation: C++ keeps raw pointers into the resource file. In TS a pointer is the
 * pair (file bytes, byte offset).
 */

/** A `const void *` into a resource file. */
export interface ResPtr {
    readonly data: Uint8Array;
    readonly offset: number;
}

/** sizeof(ResBlockHeaderData) (u32 signature, u32 size). */
export const RES_BLOCK_HEADER_SIZE = 0x8;

/** sizeof(ResFileHeaderData) (u32 signature, u16 byteOrder, u16 version, u32 fileSize, u16 headerSize, u16 dataBlocks). */
export const RES_FILE_HEADER_SIZE = 0x10;

/** Big-endian view over the resource bytes at `ptr + rel`. */
export function resView(ptr: ResPtr, rel = 0): DataView {
    return new DataView(ptr.data.buffer, ptr.data.byteOffset + ptr.offset + rel);
}

/** C++ `reinterpret_cast<uintptr_t>(ptr) + n`. */
export function resOffset(ptr: ResPtr, n: number): ResPtr {
    return { data: ptr.data, offset: ptr.offset + n };
}
