/** Port of Kinoko source/game/render/AnmMgr.{hh,cc}. */

import { AnmObjChrRes } from '../../abstract/g3d/ResAnmChr';
import type { ResFile } from '../../abstract/g3d/ResFile';
import type { DrawMdl } from './DrawMdl';

export enum AnmType {
    Empty = -1,
    Chr = 0,
    Clr = 1,
    Srt = 2,
    Pat = 3,
    Shp = 4,
    Max = 5,
}

export class AnmNodeChr {
    private m_anmObjChrRes: AnmObjChrRes;
    private m_anmType: AnmType;
    private m_idx: number;

    constructor(anmObjChrRes: AnmObjChrRes, anmType: AnmType, idx: number) {
        this.m_anmObjChrRes = anmObjChrRes;
        this.m_anmType = anmType;
        this.m_idx = idx;
    }

    /** @addr{0x8055AE90} */
    frameCount(): number {
        return this.m_anmObjChrRes.frameCount();
    }

    /** @addr{0x8055ADFC} */
    frame(): number {
        return this.m_anmObjChrRes.frame();
    }
}

export class AnmMgr {
    private m_parent: DrawMdl;
    private m_anmList: AnmNodeChr[] = [];
    private m_activeAnims: (AnmNodeChr | null)[] = [null, null, null, null];

    /** @addr{0x80555750} */
    constructor(drawMdl: DrawMdl) {
        this.m_parent = drawMdl;
    }

    /** @addr{0x8055597C} */
    linkAnims(idx: number, resFile: ResFile, name: string, anmType: AnmType): void {
        // For now, we only care about Chr
        switch (anmType) {
            case AnmType.Chr:
                this.m_anmList.push(new AnmNodeChr(new AnmObjChrRes(resFile.resAnmChr(name)), anmType, idx));
                break;
            default:
                break;
        }
    }

    /** @addr{0x805573CC} */
    playAnim(_frame: number, _rate: number, idx: number): void {
        if (idx >= this.m_anmList.length) {
            throw new Error(`AnmMgr::playAnim: index ${idx} out of range (${this.m_anmList.length})`);
        }
        this.m_activeAnims[AnmType.Chr] = this.m_anmList[idx]!;
    }

    /** @addr{0x80557340} */
    activeAnim(anmType: AnmType): AnmNodeChr | null {
        return this.m_activeAnims[anmType]!;
    }
}
