/** Port of Kinoko source/game/system/map/MapdataPointInfo.{hh,cc}. */

import { Vector3f } from '../../../egg/math/Vector';
import type { RamStream } from '../../../egg/util/Stream';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    readVector3f,
    streamAt,
} from './MapdataAccessorBase';

const SDATA_HEADER_SIZE = 0x4; // offsetof(SData, points)
const POINT_SIZE = 0x10;

export class Point {
    pos: Vector3f;
    setting: [number, number];

    constructor(pos: Vector3f = new Vector3f(), setting: [number, number] = [0, 0]) {
        this.pos = pos;
        this.setting = setting;
    }
}

export class MapdataPointInfo {
    static readonly Point = Point;

    private m_rawData: MapdataPointer;
    private m_settings: [number, number] = [0, 0];
    private m_points: Point[] = [];

    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        const view = new DataView(data.data.buffer, data.data.byteOffset + data.offset, 2);
        const pointCount = view.getUint16(0, false);
        const stream = streamAt(data, SDATA_HEADER_SIZE + pointCount * POINT_SIZE);
        this.read(stream);
    }

    read(stream: RamStream): void {
        const count = stream.read_u16();

        this.m_points = new Array<Point>(count);

        for (let i = 0; i < 2; ++i) {
            this.m_settings[i] = stream.read_u8();
        }

        for (let i = 0; i < count; ++i) {
            const pos = readVector3f(stream);

            const s0 = stream.read_u16();
            const s1 = stream.read_u16();

            this.m_points[i] = new Point(pos, [s0, s1]);
        }
    }

    pointCount(): number {
        return this.m_points.length;
    }

    setting(idx: number): number {
        return this.m_settings[idx]!;
    }

    points(): readonly Point[] {
        return this.m_points;
    }
}

export class MapdataPointInfoAccessor extends MapdataAccessorBase<MapdataPointInfo> {
    /** @addr{0x80515D3C} */
    constructor(header: MapSectionHeader) {
        super(header);
        this.initPointInfo(this.m_sectionHeader.plus(1), this.m_sectionHeader.count());
    }

    /** C++ `MapdataPointInfoAccessor::init` (variable-size entries). */
    private initPointInfo(start: MapdataPointer, count: number): void {
        if (count !== 0) {
            this.m_entryCount = count;
            this.m_entries = new Array<MapdataPointInfo>(count);
        }

        let data = start.offset;

        for (let i = 0; i < count; ++i) {
            const entry = new MapdataPointInfo({ data: start.data, offset: data });
            this.m_entries[i] = entry;
            data += entry.pointCount() * POINT_SIZE + SDATA_HEADER_SIZE;
        }
    }
}
