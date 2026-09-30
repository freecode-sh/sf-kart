/** Port of Kinoko source/game/system/map/MapdataJugemPoint.{hh,cc}. Course respawn positions. */

import { Vector3f } from '../../../egg/math/Vector';
import type { RamStream } from '../../../egg/util/Stream';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    readVector3f,
    streamAt,
} from './MapdataAccessorBase';

const SDATA_SIZE = 0x1c;

export class MapdataJugemPoint {
    private m_rawData: MapdataPointer;
    private m_pos = new Vector3f();
    private m_rot = new Vector3f();

    /** @addr{0x805183A8} */
    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
    }

    read(stream: RamStream): void {
        readVector3f(stream, this.m_pos);
        readVector3f(stream, this.m_rot);
    }

    pos(): Readonly<Vector3f> {
        return this.m_pos;
    }

    rot(): Readonly<Vector3f> {
        return this.m_rot;
    }
}

export class MapdataJugemPointAccessor extends MapdataAccessorBase<MapdataJugemPoint> {
    /** @addr{Inlined at 0x805130C4} */
    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataJugemPoint(p),
        );
    }
}
