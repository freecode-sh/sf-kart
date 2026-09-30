/**
 * Port of Kinoko source/game/system/CourseMap.{hh,cc}.
 * Contains course metadata (KMP), notably the starting position.
 */

import type { Box } from '../../egg/core/Box';
import { Vector2f, type Vector3f } from '../../egg/math/Vector';
import { ArchiveId, ResourceManager } from './ResourceManager';
import type { MapSectionHeader } from './map/MapdataAccessorBase';
import { type MapdataAreaBase, MapdataAreaAccessor, type Type as AreaType } from './map/MapdataArea';
import { type MapdataCannonPoint, MapdataCannonPointAccessor } from './map/MapdataCannonPoint';
import { type MapdataCheckPath, MapdataCheckPathAccessor } from './map/MapdataCheckPath';
import {
    type MapdataCheckPoint,
    MapdataCheckPointAccessor,
    SectorOccupancy,
} from './map/MapdataCheckPoint';
import { MapdataFileAccessor } from './map/MapdataFileAccessor';
import { type MapdataGeoObj, MapdataGeoObjAccessor } from './map/MapdataGeoObj';
import { type MapdataJugemPoint, MapdataJugemPointAccessor } from './map/MapdataJugemPoint';
import { type MapdataPointInfo, MapdataPointInfoAccessor } from './map/MapdataPointInfo';
import { type MapdataStageInfo, MapdataStageInfoAccessor } from './map/MapdataStageInfo';
import { type MapdataStartPoint, MapdataStartPointAccessor } from './map/MapdataStartPoint';

const AREA_SIGNATURE = 0x41524541;
const CANNON_POINT_SIGNATURE = 0x434e5054;
const CHECK_PATH_SIGNATURE = 0x434b5048;
const CHECK_POINT_SIGNATURE = 0x434b5054;
const GEO_OBJ_SIGNATURE = 0x474f424a;
const JUGEM_POINT_SIGNATURE = 0x4a475054;
const START_POINT_SIGNATURE = 0x4b545054;
const POINT_INFO_SIGNATURE = 0x504f5449;
const STAGE_INFO_SIGNATURE = 0x53544749;

const s16 = (x: number): number => (x << 16) >> 16;

let s_instance: CourseMap | null = null; ///< @addr{0x809BD6E8}

/** @addr{0x809BD6E8} */
export class CourseMap {
    private m_course: MapdataFileAccessor | null;
    private m_startPoint: MapdataStartPointAccessor | null;
    private m_checkPath: MapdataCheckPathAccessor | null = null;
    private m_checkPoint: MapdataCheckPointAccessor | null = null;
    private m_pointInfo: MapdataPointInfoAccessor | null = null;
    private m_geoObj: MapdataGeoObjAccessor | null = null;
    private m_area: MapdataAreaAccessor | null = null;
    private m_jugemPoint: MapdataJugemPointAccessor | null = null;
    private m_cannonPoint: MapdataCannonPointAccessor | null = null;
    private m_stageInfo: MapdataStageInfoAccessor | null;

    private m_startTmpAngle: number;
    private m_startTmp0: number;
    private m_startTmp1: number;
    private m_startTmp2: number;
    private m_startTmp3: number;

    /** @addr{0x805127EC} */
    init(): void {
        const buffer = CourseMap.LoadFile('course.kmp');
        if (!buffer) {
            throw new Error('CourseMap: course.kmp not found in the course archive');
        }
        this.m_course = new MapdataFileAccessor(buffer);

        this.m_startPoint = this.parseMapdata(
            START_POINT_SIGNATURE,
            (h) => new MapdataStartPointAccessor(h),
        );
        this.m_checkPath = this.parseMapdata(
            CHECK_PATH_SIGNATURE,
            (h) => new MapdataCheckPathAccessor(h),
        );
        this.m_checkPoint = this.parseMapdata(
            CHECK_POINT_SIGNATURE,
            (h) => new MapdataCheckPointAccessor(h),
        );
        this.m_geoObj = this.parseMapdata(GEO_OBJ_SIGNATURE, (h) => new MapdataGeoObjAccessor(h));
        this.m_pointInfo = this.parseMapdata(
            POINT_INFO_SIGNATURE,
            (h) => new MapdataPointInfoAccessor(h),
        );
        this.m_area = this.parseMapdata(AREA_SIGNATURE, (h) => new MapdataAreaAccessor(h));
        this.m_jugemPoint = this.parseMapdata(
            JUGEM_POINT_SIGNATURE,
            (h) => new MapdataJugemPointAccessor(h),
        );
        this.m_cannonPoint = this.parseMapdata(
            CANNON_POINT_SIGNATURE,
            (h) => new MapdataCannonPointAccessor(h),
        );
        this.m_stageInfo = this.parseMapdata(
            STAGE_INFO_SIGNATURE,
            (h) => new MapdataStageInfoAccessor(h),
        );

        if (!this.m_area) {
            throw new Error('CourseMap: missing AREA section');
        }
        this.m_area.sort();

        const stageInfo = this.getStageInfo();
        const TRANSLATION_MODE_NARROW = 1;
        if (stageInfo && stageInfo.translationMode() === TRANSLATION_MODE_NARROW) {
            this.m_startTmpAngle = 25.0;
            this.m_startTmp2 = 250.0;
            this.m_startTmp3 = 0.0;
        } else {
            this.m_startTmpAngle = 30.0;
            this.m_startTmp2 = 400.0;
            this.m_startTmp3 = 100.0;
        }

        this.m_startTmp0 = 800.0;
        this.m_startTmp1 = 1200.0;
    }

    /** C++ `template <MapdataDerived T> T *parseMapdata(u32 sectionName) const`. */
    parseMapdata<T>(sectionName: number, ctor: (header: MapSectionHeader) => T): T | null {
        const sectionPtr = this.m_course!.findSection(sectionName);
        return sectionPtr ? ctor(sectionPtr) : null;
    }

    /**
     * @addr{0x80511500}
     * @param distanceRatio C++ `f32 &` out-param.
     */
    findSector(pos: Readonly<Vector3f>, checkpointIdx: number, distanceRatio: Box<number>): number {
        this.clearSectorChecked();

        const checkpoint = this.getCheckPoint(checkpointIdx)!;
        let id = -1;

        const occupancy = checkpoint.checkSectorAndDistanceRatio(pos, distanceRatio);
        checkpoint.setSearched();

        switch (occupancy) {
            // The player is fully inside the current checkpoint, so just set to current checkpoint
            case SectorOccupancy.InsideSector:
                id = checkpoint.id();
                break;

            // The player is between the sides of the quad, but NOT between this checkpoint and
            // next; player is likely in the same checkpoint group
            case SectorOccupancy.BetweenSides:
                id = this.findSectorBetweenSides(pos, checkpoint, distanceRatio);
                break;

            // The player is not between the sides of the quad (may still be between this
            // checkpoint and next); player is likely in a different checkpoint group
            case SectorOccupancy.OutsideSector:
                id = this.findSectorOutsideSector(pos, checkpoint, distanceRatio);
                break;

            default:
                break;
        }

        return s16(id > -1 ? id : this.findSectorRegional(pos, checkpoint, distanceRatio));
    }

    /** @addr{0x80511110} */
    findRecursiveSector(
        pos: Readonly<Vector3f>,
        depth: number,
        searchBackwardsFirst: boolean,
        checkpoint: MapdataCheckPoint,
        distanceRatio: Box<number>,
        playerIsForwards: boolean,
    ): number {
        const MAX_DEPTH = 6;

        if (depth >= 0 && depth > MAX_DEPTH) {
            return -1;
        }

        let completion = SectorOccupancy.OutsideSector;

        if (!checkpoint.searched()) {
            completion = checkpoint.checkSectorAndDistanceRatio(pos, distanceRatio);
            checkpoint.setSearched();
        }

        // If player is inside current checkpoint, stop searching
        if (completion === SectorOccupancy.InsideSector) {
            return checkpoint.id();
        }

        // Search type 0: Search forwards first, then backwards
        if (!searchBackwardsFirst) {
            // If "player is forwards" but completion < 0, force completion to 0 and return
            // current checkpoint (GHOST CHECKPOINT!)
            if (
                playerIsForwards &&
                completion === SectorOccupancy.BetweenSides &&
                distanceRatio.value < 0.0
            ) {
                distanceRatio.value = 0.0;
                return checkpoint.id();
            }

            // Stop if current checkpoint is a KCP
            if (checkpoint.checkArea() >= 0) {
                return -1;
            }

            // If player is between the sides of the quad but NOT between this checkpoint and
            // next, AND completion > 0, then "player is forwards"
            const forward =
                completion === SectorOccupancy.BetweenSides && distanceRatio.value > 0.0;

            // Search forwards, including checkpoints already searched
            const id = this.searchNextCheckpoint(pos, depth, checkpoint, distanceRatio, forward, false);

            // If that fails, search backwards, excluding checkpoints already searched
            return id === -1
                ? this.searchPrevCheckpoint(pos, depth, checkpoint, distanceRatio, forward, true)
                : id;
        }

        // Search type 1: Search backwards first, then forwards

        // If "player is backwards" flag is true but completion > 1, force completion to 1 and
        // return current checkpoint (GHOST CHECKPOINT!)
        if (
            playerIsForwards &&
            completion === SectorOccupancy.BetweenSides &&
            distanceRatio.value > 1.0
        ) {
            distanceRatio.value = 1.0;
            return checkpoint.id();
        }

        // Stop if current checkpoint is a KCP (skipped for online players, but they aren't
        // supported)
        if (checkpoint.checkArea() >= 0) {
            return -1;
        }

        // If player is between the sides of the quad but NOT between this checkpoint and next,
        // AND completion < 0, then set "player is backwards" flag
        const forward = completion === SectorOccupancy.BetweenSides && distanceRatio.value < 0.0;

        // Search backwards, including checkpoints already searched
        const id = this.searchPrevCheckpoint(pos, depth, checkpoint, distanceRatio, forward, false);

        // If that fails, search forwards, excluding checkpoints already searched
        return id === -1
            ? this.searchNextCheckpoint(pos, depth, checkpoint, distanceRatio, forward, true)
            : id;
    }

    /** @addr{0x80511E7C} */
    getCheckPointEntryOffsetMs(
        i: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
    ): number {
        const prevPos_ = new Vector2f(prevPos.x, prevPos.z);
        const pos_ = new Vector2f(pos.x, pos.z);

        const checkPoint = this.getCheckPoint(i)!;
        return checkPoint.getEntryOffsetMs(prevPos_, pos_);
    }

    getCheckPointEntryOffsetExact(
        i: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
    ): number {
        const prevPos_ = new Vector2f(prevPos.x, prevPos.z);
        const pos_ = new Vector2f(pos.x, pos.z);

        const checkPoint = this.getCheckPoint(i)!;
        return checkPoint.getEntryOffsetExact(prevPos_, pos_);
    }

    /** @addr{0x80516808} */
    getCurrentAreaID(i: number, pos: Readonly<Vector3f>, type: AreaType): number {
        // Check if we're colliding with the provided area ID
        if (i >= 0) {
            const area = this.getArea(i)!;
            if (area.type() === type && area.test(pos)) {
                return i;
            }
        }

        // Search all areas of the same type
        for (i = 0; i < this.getAreaCount(); ++i) {
            const area = this.getAreaSorted(i)!;
            if (area.type() === type && area.test(pos)) {
                return area.index();
            }
        }

        return -1;
    }

    /** @addr{0x80518AE0} */
    getCannonPoint(i: number): MapdataCannonPoint | null {
        i &= 0xffff; // u16 parameter
        return i < this.getCannonPointCount() ? this.m_cannonPoint!.get(i) : null;
    }

    /** @addr{0x80515C70} */
    getCheckPath(i: number): MapdataCheckPath | null {
        i &= 0xffff; // u16 parameter
        return i < this.getCheckPathCount() ? this.m_checkPath!.get(i) : null;
    }

    /** @addr{0x80515C24} */
    getCheckPoint(i: number): MapdataCheckPoint | null {
        i &= 0xffff; // u16 parameter
        return i < this.getCheckPointCount() ? this.m_checkPoint!.get(i) : null;
    }

    /** @addr{0x80514148} */
    getGeoObj(i: number): MapdataGeoObj | null {
        i &= 0xffff; // u16 parameter
        return i < this.getGeoObjCount() ? this.m_geoObj!.get(i) : null;
    }

    /** @addr{0x80516768} */
    getArea(i: number): MapdataAreaBase | null {
        i &= 0xffff; // u16 parameter
        return i < this.getAreaCount() ? this.m_area!.get(i) : null;
    }

    /** @addr{0x805167B4} */
    getAreaSorted(i: number): MapdataAreaBase | null {
        i &= 0xffff; // u16 parameter
        return i < this.getAreaCount() ? this.m_area!.getSorted(i) : null;
    }

    /** @addr{0x80515E04} */
    getPointInfo(i: number): MapdataPointInfo | null {
        i &= 0xffff; // u16 parameter
        return i < this.getPointInfoCount() ? this.m_pointInfo!.get(i) : null;
    }

    /** @addr{0x80518920} */
    getJugemPoint(i: number): MapdataJugemPoint | null {
        i &= 0xffff; // u16 parameter
        return i < this.getJugemPointCount() ? this.m_jugemPoint!.get(i) : null;
    }

    /** @addr{0x80518B78} */
    getStageInfo(): MapdataStageInfo | null {
        return this.getStageInfoCount() !== 0 ? this.m_stageInfo!.get(0) : null;
    }

    /** @addr{0x80514B30} */
    getStartPoint(i: number): MapdataStartPoint | null {
        i &= 0xffff; // u16 parameter
        return i < this.getStartPointCount() ? this.m_startPoint!.get(i) : null;
    }

    getCannonPointCount(): number {
        return this.m_cannonPoint ? this.m_cannonPoint.size() : 0;
    }

    getCheckPathCount(): number {
        return this.m_checkPath ? this.m_checkPath.size() : 0;
    }

    getCheckPointCount(): number {
        return this.m_checkPoint ? this.m_checkPoint.size() : 0;
    }

    getGeoObjCount(): number {
        return this.m_geoObj ? this.m_geoObj.size() : 0;
    }

    /** @addr{0x80512CB4} */
    getAreaCount(): number {
        return this.m_area ? this.m_area.size() : 0;
    }

    getPointInfoCount(): number {
        return this.m_pointInfo ? this.m_pointInfo.size() : 0;
    }

    getJugemPointCount(): number {
        return this.m_jugemPoint ? this.m_jugemPoint.size() : 0;
    }

    getStageInfoCount(): number {
        return this.m_stageInfo ? this.m_stageInfo.size() : 0;
    }

    getStartPointCount(): number {
        return this.m_startPoint ? this.m_startPoint.size() : 0;
    }

    version(): number {
        return this.m_course!.version();
    }

    checkPath(): MapdataCheckPathAccessor | null {
        return this.m_checkPath;
    }

    checkPoint(): MapdataCheckPointAccessor | null {
        return this.m_checkPoint;
    }

    startTmpAngle(): number {
        return this.m_startTmpAngle;
    }

    startTmp0(): number {
        return this.m_startTmp0;
    }

    startTmp1(): number {
        return this.m_startTmp1;
    }

    startTmp2(): number {
        return this.m_startTmp2;
    }

    startTmp3(): number {
        return this.m_startTmp3;
    }

    /** @addr{0x80512694} */
    static CreateInstance(): CourseMap {
        if (s_instance) throw new Error('CourseMap already exists');
        s_instance = new CourseMap();
        return s_instance;
    }

    /** @addr{0x8051271C} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): CourseMap {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8051276C} */
    private constructor() {
        this.m_course = null;
        this.m_startPoint = null;
        this.m_stageInfo = null;
        this.m_startTmpAngle = 0.0;
        this.m_startTmp0 = 0.0;
        this.m_startTmp1 = 0.0;
        this.m_startTmp2 = 0.0;
        this.m_startTmp3 = 0.0;
    }

    private findSectorBetweenSides(
        pos: Readonly<Vector3f>,
        checkpoint: MapdataCheckPoint,
        distanceRatio: Box<number>,
    ): number {
        let id = -1;

        // Search order varies depending on whether player is closer to the next or previous
        // checkpoint.
        if (distanceRatio.value > 0.5) {
            // Step 1: Starting at current checkpoint, search forwards
            id = this.searchNextCheckpoint(pos, 0, checkpoint, distanceRatio, false, false);

            if (id !== -1) {
                return id;
            }

            // Step 2: If step 1 fails, start at next checkpoint(s) and search backwards
            for (let i = 0; i < checkpoint.nextCount(); ++i) {
                const next = checkpoint.nextPoint(i);

                for (let j = 0; j < next.prevCount(); ++j) {
                    const prev = next.prevPoint(j);

                    if (prev === checkpoint) {
                        continue;
                    }

                    id = this.findRecursiveSector(pos, 1, true, prev, distanceRatio, false);
                    if (id !== -1) {
                        return id;
                    }
                }
            }

            // Step 3: If step 2 fails, start at previous checkpoint(s) and search forwards
            for (let i = 0; i < checkpoint.prevCount(); ++i) {
                const prev = checkpoint.prevPoint(i);

                for (let j = 0; j < prev.nextCount(); ++j) {
                    const next = prev.nextPoint(j);

                    if (next === checkpoint) {
                        continue;
                    }

                    id = this.findRecursiveSector(pos, 1, false, next, distanceRatio, false);
                    if (id !== -1) {
                        return id;
                    }
                }
            }

            // Step 4: If step 3 fails, start at current checkpoint and search backwards
            return this.searchPrevCheckpoint(pos, 0, checkpoint, distanceRatio, false, false);
        } else {
            // Step 1: Starting at current checkpoint, search backwards
            id = this.searchPrevCheckpoint(pos, 0, checkpoint, distanceRatio, false, false);

            if (id !== -1) {
                return id;
            }

            // Step 2: If step 1 fails, start at prev checkpoint(s) and search forwards
            for (let i = 0; i < checkpoint.prevCount(); ++i) {
                const prev = checkpoint.prevPoint(i);

                for (let j = 0; j < prev.nextCount(); ++j) {
                    const next = prev.nextPoint(j);

                    if (next === checkpoint) {
                        continue;
                    }

                    id = this.findRecursiveSector(pos, 1, false, next, distanceRatio, false);

                    if (id !== -1) {
                        return id;
                    }
                }
            }

            // Step 3: If step 2 fails, start at next checkpoint(s) and search backwards
            for (let i = 0; i < checkpoint.nextCount(); ++i) {
                const next = checkpoint.nextPoint(i);

                for (let j = 0; j < next.prevCount(); ++j) {
                    const prev = next.prevPoint(j);

                    if (prev === checkpoint) {
                        continue;
                    }

                    id = this.findRecursiveSector(pos, 1, true, prev, distanceRatio, false);

                    if (id !== -1) {
                        return id;
                    }
                }
            }

            // Step 4: If step 3 fails, start at current checkpoint and search forwards
            return this.searchNextCheckpoint(pos, 0, checkpoint, distanceRatio, false, false);
        }
    }

    private findSectorOutsideSector(
        pos: Readonly<Vector3f>,
        checkpoint: MapdataCheckPoint,
        distanceRatio: Box<number>,
    ): number {
        let id = -1;

        // Step 1: Starting at next checkpoint(s), search backwards
        for (let i = 0; i < checkpoint.nextCount(); ++i) {
            const next = checkpoint.nextPoint(i);

            for (let j = 0; j < next.prevCount(); ++j) {
                const prev = next.prevPoint(j);

                if (prev === checkpoint) {
                    continue;
                }

                id = this.findRecursiveSector(pos, 1, true, prev, distanceRatio, false);

                if (id !== -1) {
                    return id;
                }
            }
        }

        // Step 2: If step 1 fails, start at prev checkpoint(s) and search forwards
        for (let i = 0; i < checkpoint.prevCount(); ++i) {
            const prev = checkpoint.prevPoint(i);

            for (let j = 0; j < prev.nextCount(); ++j) {
                const next = prev.nextPoint(j);

                if (next === checkpoint) {
                    continue;
                }

                id = this.findRecursiveSector(pos, 1, false, next, distanceRatio, false);

                if (id !== -1) {
                    return id;
                }
            }
        }

        // Step 3: If step 2 fails, start at next checkpoint(s) and search forwards
        for (let i = 0; i < checkpoint.nextCount(); ++i) {
            id = this.findRecursiveSector(
                pos,
                1,
                false,
                checkpoint.nextPoint(i),
                distanceRatio,
                false,
            );

            if (id !== -1) {
                return id;
            }
        }

        // Step 4: If step 3 fails, start at prev checkpoint(s) and search backwards
        for (let i = 0; i < checkpoint.prevCount(); ++i) {
            id = this.findRecursiveSector(
                pos,
                1,
                true,
                checkpoint.prevPoint(i),
                distanceRatio,
                false,
            );

            if (id !== -1) {
                return id;
            }
        }

        return id;
    }

    /** If local search fails, remove depth limit and search all "loaded" checkpoints */
    private findSectorRegional(
        pos: Readonly<Vector3f>,
        checkpoint: MapdataCheckPoint,
        distanceRatio: Box<number>,
    ): number {
        let id = -1;

        // Step 1: Search all next checkpoints until player or key checkpoint is found
        for (let i = 0; i < checkpoint.nextCount(); ++i) {
            id = this.findRecursiveSector(
                pos,
                -1,
                false,
                checkpoint.nextPoint(i),
                distanceRatio,
                false,
            );

            if (id !== -1) {
                return id;
            }
        }

        // Step 2: Search all previous checkpoints until player or key checkpoint is found
        for (let i = 0; i < checkpoint.prevCount(); ++i) {
            id = this.findRecursiveSector(
                pos,
                -1,
                true,
                checkpoint.prevPoint(i),
                distanceRatio,
                false,
            );

            if (id !== -1) {
                return id;
            }
        }

        return id;
    }

    /** @addr{0x80510F58} */
    private searchNextCheckpoint(
        pos: Readonly<Vector3f>,
        depth: number,
        checkpoint: MapdataCheckPoint,
        completion: Box<number>,
        playerIsForwards: boolean,
        useCache: boolean,
    ): number {
        let id = -1;
        depth = depth >= 0 ? s16(depth + 1) : -1;

        for (let i = 0; i < checkpoint.nextCount(); ++i) {
            const next = checkpoint.nextPoint(i);

            if (!useCache || !next.searched()) {
                id = this.findRecursiveSector(pos, depth, false, next, completion, playerIsForwards);

                if (id !== -1) {
                    return id;
                }
            }
        }

        return id;
    }

    /** @addr{0x80511034} */
    private searchPrevCheckpoint(
        pos: Readonly<Vector3f>,
        depth: number,
        checkpoint: MapdataCheckPoint,
        completion: Box<number>,
        playerIsForwards: boolean,
        useCache: boolean,
    ): number {
        let id = -1;
        depth = depth >= 0 ? s16(depth + 1) : -1;

        for (let i = 0; i < checkpoint.prevCount(); ++i) {
            const prev = checkpoint.prevPoint(i);

            if (!useCache || !prev.searched()) {
                id = this.findRecursiveSector(pos, depth, true, prev, completion, playerIsForwards);

                if (id !== -1) {
                    return id;
                }
            }
        }

        return id;
    }

    /** @addr{0x80511E00} */
    private clearSectorChecked(): void {
        for (let i = 0; i < this.m_checkPoint!.size(); ++i) {
            this.getCheckPoint(i)!.clearSearched();
        }
    }

    /** @addr{0x80512C10} */
    private static LoadFile(filename: string): Uint8Array | null {
        return ResourceManager.Instance()!.getFile(filename, null, ArchiveId.Course);
    }
}
