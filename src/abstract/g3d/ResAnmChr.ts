/**
 * Port of Kinoko source/abstract/g3d/ResAnmChr.{hh,cc} (the parts objects use). Credit:
 * kiwi515/ogws.
 *
 * Only the CHR0 header (InfoData: frame count, play policy) is read; that is all
 * Render::AnmMgr / AnmNodeChr expose to game code. `getAnmResult` (keyframe sampling, used by
 * KartScale's thunder/press scale animations) is not ported here.
 */

import { AnmPolicy, FrameCtrl, GetAnmPlayPolicy } from './AnmObj';
import { type ResPtr, resView } from './ResCommon';

/** offsetof(ResAnmChr::Data, info) */
const DATA_INFO_OFFSET = 0x20;

export class InfoData {
    numFrame = 0; // u16
    numNode = 0; // u16
    policy = AnmPolicy.OneTime;
    scalingRule = 0; // u32
}

/** Represents the CHR0 file format, which pertains to model movement animations. */
export class ResAnmChr {
    private m_rawData: ResPtr;
    private m_infoData = new InfoData();

    constructor(data: ResPtr) {
        this.m_rawData = data;
        this.read();
    }

    /** C++ `read(EGG::Stream &)`: `stream.jump(offsetof(Data, info)); m_infoData.read(stream);` */
    read(): void {
        const v = resView(this.m_rawData, DATA_INFO_OFFSET);
        this.m_infoData.numFrame = v.getUint16(0x0, false);
        this.m_infoData.numNode = v.getUint16(0x2, false);
        this.m_infoData.policy = v.getUint32(0x4, false) as AnmPolicy;
        this.m_infoData.scalingRule = v.getUint32(0x8, false);
    }

    frameCount(): number {
        return this.m_infoData.numFrame;
    }

    policy(): AnmPolicy {
        return this.m_infoData.policy;
    }
}

export class AnmObjChrRes extends FrameCtrl {
    private m_resAnmChr: ResAnmChr;

    constructor(chr: ResAnmChr) {
        super(0.0, chr.frameCount(), GetAnmPlayPolicy(chr.policy()));
        this.m_resAnmChr = chr;
    }

    frameCount(): number {
        return this.m_resAnmChr.frameCount();
    }
}
