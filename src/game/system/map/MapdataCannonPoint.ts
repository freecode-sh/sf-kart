/** Port of Kinoko source/game/system/map/MapdataCannonPoint.{hh,cc}. */

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

export class MapdataCannonPoint {
    private m_rawData: MapdataPointer;
    private m_pos = new Vector3f();
    private m_rot = new Vector3f();
    private m_id = 0; // u16
    /** Index into the table of cannon properties. Used to determine speed, height, and decel */
    private m_parameterIdx = 0; // s16

    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
    }

    read(stream: RamStream): void {
        readVector3f(stream, this.m_pos);
        readVector3f(stream, this.m_rot);
        this.m_id = stream.read_u16();
        this.m_parameterIdx = stream.read_s16();
    }

    pos(): Readonly<Vector3f> {
        return this.m_pos;
    }

    rot(): Readonly<Vector3f> {
        return this.m_rot;
    }

    id(): number {
        return this.m_id;
    }

    parameterIdx(): number {
        return this.m_parameterIdx;
    }
}

export class MapdataCannonPointAccessor extends MapdataAccessorBase<MapdataCannonPoint> {
    /** @addr{Inlined at 0x80512FA4} */
    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataCannonPoint(p),
        );
    }
}
