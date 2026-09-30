/** Port of Kinoko source/abstract/g3d/ResDic.{hh,cc}. Credit: kiwi515/ogws. */

import { type ResPtr, resOffset, resView } from './ResCommon';

/** sizeof(ResDic::NodeData) */
const NODE_SIZE = 0x10;
/** offsetof(ResDic::Data, data) */
const DATA_OFFSET = 0x8;

/** A decoded `ResDic::NodeData` (u16 ref, u16 flag, u16 idxLeft, u16 idxRight, s32 ofsString, s32 ofsData). */
interface NodeData {
    ref: number;
    flag: number;
    idxLeft: number;
    idxRight: number;
    ofsString: number;
    ofsData: number;
}

/** Essentially a lookup table to find different sections within the resource file. */
export class ResDic {
    private readonly m_data: ResPtr | null;

    constructor(data: ResPtr | null) {
        this.m_data = data;
    }

    /**
     * C++ overloads `operator[](const char *name)` (@addr{0x8004C050}) and
     * `operator[](size_t idx)`.
     */
    at(key: string | number): ResPtr | null {
        if (typeof key === 'number') {
            if (!this.m_data) {
                return null;
            }

            const node = this.node(key + 1);

            return resOffset(this.m_data, node.ofsData);
        }

        if (!this.m_data) {
            return null;
        }

        const node = this.get(key, key.length);

        if (node) {
            return resOffset(this.m_data, node.ofsData);
        }

        return null;
    }

    /** @addr{0x8004BF70} */
    private get(pName: string, len: number): NodeData | null {
        let c = this.node(0);
        let x = this.node(c.idxLeft);

        while (c.ref > x.ref) {
            c = x;

            const wd = x.ref >>> 3;
            const pos = x.ref & 7;

            if (wd < len && (pName.charCodeAt(wd) >> pos) & 1) {
                x = this.node(x.idxRight);
            } else {
                x = this.node(x.idxLeft);
            }
        }

        const stringOffset = x.ofsString;

        if (stringOffset !== 0) {
            const xName = readCString(this.m_data!, stringOffset);

            if (pName === xName) {
                return x;
            }
        }

        return null;
    }

    private node(idx: number): NodeData {
        const v = resView(this.m_data!, DATA_OFFSET + idx * NODE_SIZE);
        return {
            ref: v.getUint16(0x0, false),
            flag: v.getUint16(0x2, false),
            idxLeft: v.getUint16(0x4, false),
            idxRight: v.getUint16(0x6, false),
            ofsString: v.getInt32(0x8, false),
            ofsData: v.getInt32(0xc, false),
        };
    }
}

function readCString(ptr: ResPtr, rel: number): string {
    const bytes = ptr.data;
    let i = ptr.offset + rel;
    let s = '';
    while (i < bytes.byteLength && bytes[i] !== 0) {
        s += String.fromCharCode(bytes[i]!);
        ++i;
    }
    return s;
}
