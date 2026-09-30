/** Port of Kinoko source/abstract/g3d/ResFile.hh. Credit: kiwi515/ogws. */

import { ResAnmChr } from './ResAnmChr';
import { RES_BLOCK_HEADER_SIZE, RES_FILE_HEADER_SIZE, type ResPtr } from './ResCommon';
import { ResDic } from './ResDic';

/** offsetof(ResFile::Data, dict.topLevel) */
const TOP_LEVEL_DIC_OFFSET = RES_FILE_HEADER_SIZE + RES_BLOCK_HEADER_SIZE;

/**
 * Represents a binary resource file which contains object models, textures, and animations.
 * All resource files start with a header of length 0x10, followed by a root section which uses a
 * ResDic to point to the different sections of the file.
 */
export class ResFile {
    private readonly m_data: ResPtr;

    constructor(data: Uint8Array) {
        this.m_data = { data, offset: 0 };
    }

    /** @addr{0x8004C780} Retrieves the AnmChr section from the binary file. */
    resAnmChr(pName: string): ResAnmChr {
        const dic = new ResDic({ data: this.m_data.data, offset: this.m_data.offset + TOP_LEVEL_DIC_OFFSET });
        const dicData = dic.at('AnmChr(NW4R)');
        if (!dicData) {
            throw new Error('ResFile::resAnmChr: no AnmChr(NW4R) section');
        }
        const anmChrData = new ResDic(dicData).at(pName);
        if (!anmChrData) {
            throw new Error(`ResFile::resAnmChr: no CHR0 named ${pName}`);
        }
        return new ResAnmChr(anmChrData);
    }
}
