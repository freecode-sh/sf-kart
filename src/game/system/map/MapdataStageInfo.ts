/** Port of Kinoko source/game/system/map/MapdataStageInfo.{hh,cc}. */

import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
} from './MapdataAccessorBase';

const SDATA_SIZE = 0xc;

export class MapdataStageInfo {
    private m_rawData: MapdataPointer;

    constructor(data: MapdataPointer) {
        this.m_rawData = data;
    }

    polePosition(): number {
        return this.m_rawData.data[this.m_rawData.offset + 1]!;
    }

    translationMode(): number {
        return this.m_rawData.data[this.m_rawData.offset + 2]!;
    }
}

export class MapdataStageInfoAccessor extends MapdataAccessorBase<MapdataStageInfo> {
    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataStageInfo(p),
        );
    }
}
