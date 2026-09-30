/** Port of Kinoko source/game/render/DrawMdl.{hh,cc}. */

import type { ResFile } from '../../abstract/g3d/ResFile';
import { AnmMgr, type AnmType } from './AnmMgr';

export class DrawMdl {
    private m_anmMgr: AnmMgr | null;

    constructor() {
        this.m_anmMgr = null;
    }

    /** @addr{0x8055DDEC} */
    linkAnims(idx: number, resFile: ResFile, name: string, anmType: AnmType): void {
        if (!this.m_anmMgr) {
            this.m_anmMgr = new AnmMgr(this);
        }

        this.m_anmMgr.linkAnims(idx, resFile, name, anmType);
    }

    anmMgr(): AnmMgr | null {
        return this.m_anmMgr;
    }
}
