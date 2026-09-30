/** Port of Kinoko source/game/system/map/MapdataFileAccessor.{hh,cc}. */

import { MapSectionHeader } from './MapdataAccessorBase';

export class MapdataFileAccessor {
    private m_rawData: Uint8Array;
    private m_view: DataView;
    /** Byte offset of the section offset table (C++ `const u32 *m_sectionDef`). */
    private m_sectionDef: number;
    private m_version: number;
    private m_sectionDefOffset: number;

    /** @addr{0x80512C2C} */
    constructor(data: Uint8Array) {
        this.m_rawData = data;
        this.m_view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const offset = (this.headerSize() - this.sectionCount() * 4) >>> 0;
        this.m_sectionDefOffset = offset;
        this.m_sectionDef = offset;
        this.m_version = offset > 12 ? this.m_view.getUint32(this.m_sectionDef - 4, false) : 0;
    }

    /** @addr{0x80514208} */
    findSection(signature: number): MapSectionHeader | null {
        let sectionPtr: MapSectionHeader | null = null;

        for (let i = 0; i < this.sectionCount(); ++i) {
            const sectionOffset = this.m_view.getUint32(this.m_sectionDef + i * 4, false);
            const headerOffset = this.headerSize() + sectionOffset;
            const header = new MapSectionHeader(this.m_rawData, headerOffset);
            if (header.magic() >>> 0 === signature >>> 0) {
                sectionPtr = header;
                break;
            }
        }

        return sectionPtr;
    }

    version(): number {
        return this.m_version;
    }

    private sectionCount(): number {
        return this.m_view.getUint16(0x8, false);
    }

    private headerSize(): number {
        return this.m_view.getUint16(0xa, false);
    }
}
