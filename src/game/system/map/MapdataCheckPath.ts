/** Port of Kinoko source/game/system/map/MapdataCheckPath.{hh,cc}. */

import { fr } from '../../../egg/math/Math';
import type { RamStream } from '../../../egg/util/Stream';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    streamAt,
} from './MapdataAccessorBase';

const SDATA_SIZE = 0x10;
export const CHECKPATH_MAX_NEIGHBORS = 6;

const s8 = (x: number): number => (x << 24) >> 24;

export class MapdataCheckPath {
    static readonly MAX_NEIGHBORS = CHECKPATH_MAX_NEIGHBORS;

    private m_rawData: MapdataPointer;
    /** Index of the first checkpoint in this checkpath */
    private m_start = 0;
    /** Number of checkpoints in this checkpath */
    private m_size = 0;
    /** Indices of previous connected checkpaths */
    private m_prev: number[] = new Array<number>(CHECKPATH_MAX_NEIGHBORS).fill(0);
    /** Indices of next connected checkpaths */
    private m_next: number[] = new Array<number>(CHECKPATH_MAX_NEIGHBORS).fill(0);
    /** Number of checkpaths away from first checkpath (i.e. distance from start) */
    private m_depth: number;
    private m_oneOverCount: number;

    /** @addr{0x80515098} */
    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        this.m_depth = -1;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
        this.m_oneOverCount = fr(1.0 / fr(this.m_size));
    }

    read(stream: RamStream): void {
        this.m_start = stream.read_u8();
        this.m_size = stream.read_u8();
        for (let i = 0; i < CHECKPATH_MAX_NEIGHBORS; ++i) {
            this.m_prev[i] = stream.read_u8();
        }

        for (let i = 0; i < CHECKPATH_MAX_NEIGHBORS; ++i) {
            this.m_next[i] = stream.read_u8();
        }
    }

    /**
     * Performs DFS to calculate m_depth for all subsequent checkpaths.
     * @addr{0x805150E0}
     */
    findDepth(depth: number, accessor: MapdataCheckPathAccessor): void {
        if (this.m_depth !== -1) {
            return;
        }

        this.m_depth = s8(depth);

        for (const nextID of this.m_next) {
            if (nextID === 0xff) {
                continue;
            }

            accessor.get(nextID)!.findDepth(s8(depth + 1), accessor);
        }
    }

    isPointInPath(checkpointId: number): boolean {
        return this.m_start <= checkpointId && checkpointId <= this.end();
    }

    start(): number {
        return this.m_start;
    }

    /** C++ returns u8 `m_start + m_size - 1`. */
    end(): number {
        return (this.m_start + this.m_size - 1) & 0xff;
    }

    next(): readonly number[] {
        return this.m_next;
    }

    prev(): readonly number[] {
        return this.m_prev;
    }

    depth(): number {
        return this.m_depth;
    }

    oneOverCount(): number {
        return this.m_oneOverCount;
    }
}

export class MapdataCheckPathAccessor extends MapdataAccessorBase<MapdataCheckPath> {
    /**
     * Minimum proportion of a lap a checkpath can be. Calculated as 1/(maxDepth+1).
     */
    private m_lapProportion = 0.0;

    /** @addr{Inlined in 0x8051377C} */
    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataCheckPath(p),
        );

        if (this.m_entryCount === 0) {
            return;
        }

        // Maximum number of paths one could traverse through in a lap
        let maxDepth = -1;
        this.get(0)!.findDepth(0, this);

        for (let i = 0; i < this.size(); ++i) {
            maxDepth = Math.max(maxDepth, this.get(i)!.depth());
        }

        this.m_lapProportion = fr(1.0 / fr(fr(maxDepth) + 1.0));
    }

    /** @addr{0x80515014} */
    findCheckpathForCheckpoint(checkpointId: number): MapdataCheckPath | null {
        for (let i = 0; i < this.size(); ++i) {
            const checkpath = this.get(i)!;
            if (checkpath.isPointInPath(checkpointId)) {
                return checkpath;
            }
        }

        return null;
    }

    lapProportion(): number {
        return this.m_lapProportion;
    }
}
