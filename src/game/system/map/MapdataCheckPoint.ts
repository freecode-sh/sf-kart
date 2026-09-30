/** Port of Kinoko source/game/system/map/MapdataCheckPoint.{hh,cc}. */

import type { Box } from '../../../egg/core/Box';
import { fr } from '../../../egg/math/Math';
import { Vector2f, type Vector3f } from '../../../egg/math/Vector';
import type { RamStream } from '../../../egg/util/Stream';
import { CourseMap } from '../CourseMap';
import {
    MapdataAccessorBase,
    type MapdataPointer,
    type MapSectionHeader,
    readVector2f,
    streamAt,
} from './MapdataAccessorBase';

const SDATA_SIZE = 0x14;
const MAX_NEIGHBORS = 6;

const REFRESH_PERIOD = fr(1000.0 / fr(59.94));

export class LinkedCheckpoint {
    checkpoint: MapdataCheckPoint | null = null;
    p0diff = new Vector2f();
    p1diff = new Vector2f();
    distance = 0.0;
}

export enum SectorOccupancy {
    /** Player is inside the given checkpoint group */
    InsideSector,
    /** Player is outside the given checkpoint group */
    OutsideSector,
    /** Player is between sides of the checkpoint group but not between this checkpoint and next */
    BetweenSides,
}

export enum CheckArea {
    /** Only used for picking respawn position */
    NormalCheckpoint = -1,
    /** Triggers a lap change */
    FinishLine = 0,
}

export class MapdataCheckPoint {
    static readonly SectorOccupancy = SectorOccupancy;
    static readonly CheckArea = CheckArea;

    private m_rawData: MapdataPointer;
    private m_left = new Vector2f();
    private m_right = new Vector2f();
    /** Index of respawn point associated with this checkpoint. */
    private m_jugemIndex = 0; // s8
    /** -1: normal checkpoint, 0: finish line, 1-127: key checkpoint */
    private m_checkArea = 0; // s8
    private m_prevPt = 0; // u8
    private m_nextPt = 0; // u8
    private m_nextCount: number;
    private m_prevCount: number;
    private m_midpoint: Vector2f;
    private m_dir: Vector2f;
    private m_searched = false;
    private m_id = 0;
    private m_prevPoints: (MapdataCheckPoint | null)[] = new Array<MapdataCheckPoint | null>(
        MAX_NEIGHBORS,
    ).fill(null);
    private m_nextPoints: LinkedCheckpoint[] = Array.from(
        { length: MAX_NEIGHBORS },
        () => new LinkedCheckpoint(),
    );

    /** @addr{0x805154E4} */
    constructor(data: MapdataPointer) {
        this.m_rawData = data;
        this.m_nextCount = 0;
        this.m_prevCount = 0;
        const stream = streamAt(data, SDATA_SIZE);
        this.read(stream);
        this.m_midpoint = this.m_left.add(this.m_right).mul(0.5);
        this.m_dir = new Vector2f(
            fr(this.m_right.y - this.m_left.y),
            fr(this.m_left.x - this.m_right.x),
        );
        this.m_dir.normalise();
    }

    read(stream: RamStream): void {
        readVector2f(stream, this.m_left);
        readVector2f(stream, this.m_right);
        this.m_jugemIndex = stream.read_s8();
        this.m_checkArea = stream.read_s8();
        this.m_prevPt = stream.read_u8();
        this.m_nextPt = stream.read_u8();
    }

    /**
     * Calculates m_nextPoints and m_prevPoints from m_nextPt and m_prevPt.
     * @addr{0x80515624}
     */
    initCheckpointLinks(accessor: MapdataCheckPointAccessor, id: number): void {
        this.m_id = id & 0xffff;
        const checkPathAccessor = CourseMap.Instance()!.checkPath()!;

        // Calculate the quadrilateral's `m_prevPoints`. If the check point is the first in its
        // group, it has multiple previous checkpoints defined by its preceding checkpaths
        if (this.m_prevPt === 0xff) {
            const checkpath = checkPathAccessor.findCheckpathForCheckpoint(id);
            if (checkpath) {
                this.m_prevCount = 0;

                const prev = checkpath.prev();
                for (let i = 0; i < prev.length; ++i) {
                    const prevID = prev[i]!;
                    if (prevID === 0xff) {
                        continue;
                    }

                    this.m_prevPoints[i] = accessor.get(checkPathAccessor.get(prevID)!.end());
                    ++this.m_prevCount;
                }
            }
        } else {
            this.m_prevPoints[0] = accessor.get(this.m_prevPt);
            ++this.m_prevCount;
        }

        // Calculate the quadrilateral's `m_nextPoints`. If the checkpoint is the last in its
        // group, it can have multiple quadrilaterals (and nextCheckpoint) which are determined by
        // its next path(s)
        if (this.m_nextPt === 0xff) {
            const checkpath = checkPathAccessor.findCheckpathForCheckpoint(id);
            if (checkpath) {
                this.m_nextCount = 0;

                const next = checkpath.next();
                for (let i = 0; i < next.length; ++i) {
                    const nextID = next[i]!;
                    if (nextID === 0xff) {
                        continue;
                    }

                    this.m_nextPoints[i]!.checkpoint = accessor.get(
                        checkPathAccessor.get(nextID)!.start(),
                    );
                    ++this.m_nextCount;
                }
            }
        } else {
            this.m_nextPoints[0]!.checkpoint = accessor.get(this.m_nextPt);
            ++this.m_nextCount;
        }

        // Form the checkpoint's quadrilateral(s)
        for (let i = 0; i < this.m_nextPoints.length; ++i) {
            const next = this.m_nextPoints[i]!;
            if (i < this.m_nextCount) {
                const nextPoint = next.checkpoint!;

                next.distance = nextPoint.m_midpoint.sub(this.m_midpoint).normalise();
                next.p0diff = nextPoint.m_left.sub(this.m_left);
                next.p1diff = nextPoint.m_right.sub(this.m_right);
            } else {
                next.distance = 0.0;
                next.p0diff = Vector2f.zero.clone();
                next.p1diff = Vector2f.zero.clone();
            }
        }
    }

    /**
     * @addr{0x80510D7C}
     * @param distanceRatio C++ `f32 &` out-param.
     */
    checkSectorAndDistanceRatio(pos: Readonly<Vector3f>, distanceRatio: Box<number>): SectorOccupancy {
        let betweenSides = false;
        const p1 = this.m_right.clone();
        p1.y = fr(pos.z - p1.y);
        p1.x = fr(pos.x - p1.x);

        for (let i = 0; i < this.m_nextCount; ++i) {
            const next = this.m_nextPoints[i]!;
            const p0 = next.checkpoint!.m_left.clone();
            p0.y = fr(pos.z - p0.y);
            p0.x = fr(pos.x - p0.x);
            const result = this.checkSectorAndDistanceRatioLinked(next, p0, p1, distanceRatio);

            if (result === SectorOccupancy.InsideSector) {
                return SectorOccupancy.InsideSector;
            } else if (result === SectorOccupancy.BetweenSides) {
                betweenSides = true;
            }
        }

        return betweenSides ? SectorOccupancy.BetweenSides : SectorOccupancy.OutsideSector;
    }

    /**
     * Finds the offset between the two positions that enter the checkpoint.
     * @addr{0x80511EC8}
     * @return The earliest subdivision that crosses into the checkpoint, in the range [1, 17].
     */
    getEntryOffsetMs(prevPos: Readonly<Vector2f>, pos: Readonly<Vector2f>): number {
        const velocity = pos.sub(prevPos);
        velocity.mulEq(fr(1.0 / REFRESH_PERIOD));

        // d_k = p_0 - m + kv
        const displacement = prevPos.sub(this.m_midpoint).add(velocity);

        let k = 1;
        for (; fr(k) < REFRESH_PERIOD && displacement.dot(this.m_dir) < 0.0; k = (k + 1) & 0xffff) {
            displacement.addEq(velocity);
        }

        return k;
    }

    /** Finds the exact offset between the two positions that enter the checkpoint. */
    getEntryOffsetExact(prevPos: Readonly<Vector2f>, pos: Readonly<Vector2f>): number {
        const velocity = pos.sub(prevPos);
        velocity.mulEq(fr(1.0 / REFRESH_PERIOD));

        const x = this.m_midpoint.sub(prevPos).dot(this.m_dir);
        const y = velocity.dot(this.m_dir);

        // y = 0 => v is parallel to the checkpoint line
        return y !== 0.0 ? fr(x / y) : 0.0;
    }

    isNormalCheckpoint(): boolean {
        return this.m_checkArea === CheckArea.NormalCheckpoint;
    }

    isFinishLine(): boolean {
        return this.m_checkArea === CheckArea.FinishLine;
    }

    setSearched(): void {
        this.m_searched = true;
    }

    clearSearched(): void {
        this.m_searched = false;
    }

    searched(): boolean {
        return this.m_searched;
    }

    jugemIndex(): number {
        return this.m_jugemIndex;
    }

    checkArea(): number {
        return this.m_checkArea;
    }

    nextCount(): number {
        return this.m_nextCount;
    }

    prevCount(): number {
        return this.m_prevCount;
    }

    dir(): Readonly<Vector2f> {
        return this.m_dir;
    }

    id(): number {
        return this.m_id;
    }

    prevPoint(i: number): MapdataCheckPoint {
        return this.m_prevPoints[i]!;
    }

    nextPoint(i: number): MapdataCheckPoint {
        return this.m_nextPoints[i]!.checkpoint!;
    }

    /** @addr{0x80510C74} (C++ private overload of checkSectorAndDistanceRatio) */
    private checkSectorAndDistanceRatioLinked(
        next: LinkedCheckpoint,
        p0: Readonly<Vector2f>,
        p1: Readonly<Vector2f>,
        distanceRatio: Box<number>,
    ): SectorOccupancy {
        if (!this.checkSector(next, p0, p1)) {
            return SectorOccupancy.OutsideSector;
        }

        return this.checkDistanceRatio(next, p0, p1, distanceRatio)
            ? SectorOccupancy.InsideSector
            : SectorOccupancy.BetweenSides;
    }

    /**
     * @addr{0x0x80510B84}
     * @return Whether the player is between the two sides of the checkpoint quad.
     */
    private checkSector(
        next: LinkedCheckpoint,
        p0: Readonly<Vector2f>,
        p1: Readonly<Vector2f>,
    ): boolean {
        if (fr(fr(-next.p0diff.y * p0.x) + fr(next.p0diff.x * p0.y)) < 0.0) {
            return false;
        }

        if (fr(fr(next.p1diff.y * p1.x) - fr(next.p1diff.x * p1.y)) < 0.0) {
            return false;
        }

        return true;
    }

    /**
     * Sets the distance ratio, which is the progress of traversal through the checkpoint quad.
     * @addr{0x80510BF0}
     */
    private checkDistanceRatio(
        next: LinkedCheckpoint,
        p0: Readonly<Vector2f>,
        p1: Readonly<Vector2f>,
        distanceRatio: Box<number>,
    ): boolean {
        const d1 = this.m_dir.dot(p1);
        const d2 = -next.checkpoint!.m_dir.dot(p0);
        distanceRatio.value = fr(d1 / fr(d1 + d2));
        return distanceRatio.value >= 0.0 && distanceRatio.value <= 1.0;
    }
}

export class MapdataCheckPointAccessor extends MapdataAccessorBase<MapdataCheckPoint> {
    private m_lastKcpType = -1; // s8
    private m_finishLineCheckpointId = 0; // u16

    constructor(header: MapSectionHeader) {
        super(header);
        this.initEntries(
            this.m_sectionHeader.plus(1),
            this.m_sectionHeader.count(),
            SDATA_SIZE,
            (p) => new MapdataCheckPoint(p),
        );
        this.initLinks();
    }

    lastKcpType(): number {
        return this.m_lastKcpType;
    }

    /**
     * Initializes all checkpoint links, and finds the finish line and last key checkpoint.
     * @addr{0x80515244} (C++ `MapdataCheckPointAccessor::init()`)
     */
    private initLinks(): void {
        let lastKcpType = -1;
        let finishLineCheckpointId = -1;

        for (let ckptId = 0; ckptId < this.size(); ckptId++) {
            const checkpoint = this.get(ckptId)!;
            checkpoint.initCheckpointLinks(this, ckptId);

            if (checkpoint.isFinishLine()) {
                finishLineCheckpointId = ckptId;
            }

            lastKcpType = Math.max(lastKcpType, checkpoint.checkArea());
        }

        this.m_lastKcpType = lastKcpType;
        this.m_finishLineCheckpointId = finishLineCheckpointId & 0xffff;
    }
}
