/** Port of Kinoko source/game/system/map/MapdataGeoObj.{hh,cc}. */

import { Vector3f } from '../../../egg/math/Vector';
import type { RamStream } from '../../../egg/util/Stream';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    readVector3f,
    streamAt,
} from './MapdataAccessorBase';

const SDATA_SIZE = 0x3c;

export class MapdataGeoObj {
    private m_rawData: MapdataPointer;
    private m_id = 0;
    private m_pos = new Vector3f();
    private m_rot = new Vector3f();
    private m_scale = new Vector3f();
    private m_pathId = 0;
    private m_settings: number[] = new Array<number>(8).fill(0);
    private m_presenceFlag = 0;

    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
    }

    read(stream: RamStream): void {
        this.m_id = stream.read_u16();
        stream.skip(2);
        readVector3f(stream, this.m_pos);
        readVector3f(stream, this.m_rot);
        readVector3f(stream, this.m_scale);
        this.m_pathId = stream.read_s16();

        for (let i = 0; i < this.m_settings.length; ++i) {
            this.m_settings[i] = stream.read_u16();
        }

        this.m_presenceFlag = stream.read_u16();
    }

    id(): number {
        return this.m_id;
    }

    pos(): Readonly<Vector3f> {
        return this.m_pos;
    }

    rot(): Readonly<Vector3f> {
        return this.m_rot;
    }

    scale(): Readonly<Vector3f> {
        return this.m_scale;
    }

    pathId(): number {
        return this.m_pathId;
    }

    setting(idx: number): number {
        return this.m_settings[idx]!;
    }

    presenceFlag(): number {
        return this.m_presenceFlag;
    }
}

export class MapdataGeoObjAccessor extends MapdataAccessorBase<MapdataGeoObj> {
    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataGeoObj(p),
        );
    }
}
