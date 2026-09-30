/** Port of Kinoko's game/kart/KartPullPath.{hh,cc}. */

import { box, type Box } from '../../egg/core/Box';
import { Plane3f } from '../../egg/geom/Plane';
import { fr, sqrt } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import { CourseMap } from '../system/CourseMap';
import { MapdataAreaBase } from '../system/map/MapdataArea';
import type { MapdataPointInfo } from '../system/map/MapdataPointInfo';
import { KartObjectProxy } from './KartObjectProxy';

function s16(x: number): number {
    return (x << 16) >> 16;
}

enum KartPullPathTrackerType {
    Global,
    Regional,
}

enum SearchDirection {
    Current,
    Next,
    Previous,
}

/**
 * Tracks the kart's progress along the pull path.
 * This implementation merges the global and regional tracker into one class.
 */
export class KartPullPathTracker extends KartObjectProxy {
    static readonly Type = KartPullPathTrackerType;

    private m_type: KartPullPathTrackerType; ///< Replaces inheritance for calc.
    private m_currentIdx: number; ///< s16
    private m_pointInfo: MapdataPointInfo | null;
    private m_handle: KartPullPath;

    /** @addr{0x8059308C} */
    constructor(handle: KartPullPath, type: KartPullPathTrackerType) {
        super();
        this.m_type = type;
        this.m_currentIdx = 0;
        this.m_pointInfo = null;
        this.m_handle = handle;
    }

    calc(): void {
        if (this.m_type === KartPullPathTrackerType.Global) {
            this.calcTrackerGlobal();
        } else if (this.m_type === KartPullPathTrackerType.Regional) {
            this.calcTrackerRegional();
        }
    }

    setCurrentIdx(idx: number): void {
        this.m_currentIdx = idx;
    }

    setPointInfo(info: MapdataPointInfo | null): void {
        this.m_pointInfo = info;
        this.m_currentIdx = 0;
    }

    /** @addr{0x80593138} */
    private calcTrackerGlobal(): void {
        const idx = box(0);
        const point = new Vector3f();
        const dir = new Vector3f();
        if (this.search(SearchDirection.Current, idx, point, dir)) {
            this.m_handle.changePoint(idx.value, this.getDistance(point, dir));
        }

        // static_cast<size_t>(++m_currentIdx) >= pointCount() - 1
        this.m_currentIdx = s16(this.m_currentIdx + 1);
        if (this.m_currentIdx < 0 || this.m_currentIdx >= this.m_pointInfo!.pointCount() - 1) {
            this.m_currentIdx = 0;
        }
    }

    /** @addr{0x80593814} */
    private calcTrackerRegional(): void {
        if (this.m_handle.incomingIdx() < 0) {
            return;
        }

        const idx = box(0);
        const point = new Vector3f();
        const dir = new Vector3f();

        if (this.search(SearchDirection.Current, idx, point, dir)) {
            this.m_handle.changePoint(idx.value, this.getDistance(point, dir));
            return;
        }

        this.m_handle.resetDistance();
        if (this.search(SearchDirection.Next, idx, point, dir)) {
            this.m_handle.changePoint(idx.value, this.getDistance(point, dir));
            return;
        }

        if (this.search(SearchDirection.Previous, idx, point, dir)) {
            this.m_handle.changePoint(idx.value, this.getDistance(point, dir));
        }
    }

    /**
     * @addr{0x80593310}
     * Gets the distance from the line formed by the point and direction.
     */
    private getDistance(point: Readonly<Vector3f>, dir: Readonly<Vector3f>): number {
        const diff = this.pos().sub(point);
        const dist = diff.length();
        const x = Math.abs(diff.dot(dir));
        return sqrt(fr(fr(dist * dist) - fr(x * x)));
    }

    /** @addr{0x8059345C} */
    private search(
        searchDirection: SearchDirection,
        idx: Box<number>,
        point: Vector3f,
        dir: Vector3f,
    ): boolean {
        let p: number;
        let c: number;
        let n: number;
        switch (searchDirection) {
            case SearchDirection.Current:
                idx.value = this.m_currentIdx;
                p = -1;
                c = 0;
                n = 1;
                break;
            case SearchDirection.Next:
                idx.value = s16(this.m_currentIdx + 1);
                p = 0;
                c = 1;
                n = 2;
                break;
            case SearchDirection.Previous:
                idx.value = s16(this.m_currentIdx - 1);
                p = -2;
                c = -1;
                n = 0;
                break;
            default:
                throw new Error('Invalid search direction!');
        }

        const points = this.m_pointInfo!.points();
        const size = points.length;

        // There always needs to be a current point and a next point to get the direction
        if (this.m_currentIdx + c < 0 || this.m_currentIdx + c >= size) {
            return false;
        }

        if (this.m_currentIdx + n < 0 || this.m_currentIdx + n >= size) {
            return false;
        }

        const currentPos = points[this.m_currentIdx + c]!.pos;
        const nextPos = points[this.m_currentIdx + n]!.pos;

        let back = currentPos.sub(nextPos);
        back.normalise();
        const front = back.neg();

        if (this.m_currentIdx + p >= 0 && this.m_currentIdx + p < size) {
            const prevPos = points[this.m_currentIdx + p]!.pos;
            back = prevPos.sub(currentPos);
            back.normalise();
        }

        const backPlane = Plane3f.fromPointNormal(currentPos, back);
        const frontPlane = Plane3f.fromPointNormal(nextPos, front);

        if (backPlane.testPoint(this.pos()) && frontPlane.testPoint(this.pos())) {
            point.copy(currentPos);
            dir.copy(front);
            return true;
        }

        return false;
    }
}

/**
 * Manages areas pulling the kart along a given path.
 * This implementation merges the base class with the water derived class.
 */
export class KartPullPath extends KartObjectProxy {
    private m_distance = 0.0;
    private m_pointInfo: MapdataPointInfo | null = null;
    private m_incomingIdx = 0; ///< s16
    private m_currentIdx = 0; ///< s16
    private m_pullDirection = new Vector3f();
    private m_pullSpeed = 0.0;
    private m_maxPullSpeed = 0.0;
    private m_globalTracker: KartPullPathTracker;
    private m_regionalTracker: KartPullPathTracker;
    private m_roadSpeedDecay = 0.0;
    private m_areaId = 0; ///< s16

    /** @addr{0x80593FA4} */
    constructor() {
        super();
        this.m_globalTracker = new KartPullPathTracker(this, KartPullPathTrackerType.Global);
        this.m_regionalTracker = new KartPullPathTracker(this, KartPullPathTrackerType.Regional);
        this.init();
    }

    /** @addr{0x805940D4} */
    init(): void {
        this.reset();
        this.m_areaId = -1;
        this.m_roadSpeedDecay = 1.0;
    }

    /**
     * @addr{0x80593CB8}
     * This was the init function in the base class, but it gets inlined in calcArea.
     */
    reset(): void {
        this.m_distance = -1.0;
        this.m_currentIdx = -1;
        this.m_incomingIdx = -1;
        this.m_pointInfo = null;
        this.m_pullDirection.copy(Vector3f.zero);
        this.m_pullSpeed = 0.0;
        this.m_maxPullSpeed = 0.0;
    }

    /** @addr{0x80594134} */
    calc(): void {
        if (!this.calcArea()) {
            return;
        }

        if (this.m_pointInfo!.pointCount() > 2) {
            this.calcTrackers();
        }
    }

    /** @addr{0x80593DBC} */
    changePoint(idx: number, distance: number): void {
        if ((this.m_distance >= 0.0 || distance >= 3000.0) && distance >= this.m_distance) {
            return;
        }

        this.m_incomingIdx = idx;
        this.m_distance = distance;
        this.m_regionalTracker.setCurrentIdx(idx);
        this.calcPointChange();
    }

    /** @addr{0x80593E08} */
    resetDistance(): void {
        this.m_distance = -1.0;
    }

    incomingIdx(): number {
        return this.m_incomingIdx;
    }

    pullDirection(): Readonly<Vector3f> {
        return this.m_pullDirection;
    }

    pullSpeed(): number {
        return this.m_pullSpeed;
    }

    maxPullSpeed(): number {
        return this.m_maxPullSpeed;
    }

    roadSpeedDecay(): number {
        return this.m_roadSpeedDecay;
    }

    /** @addr{0x805941BC} */
    private calcArea(): boolean {
        const courseMap = CourseMap.Instance()!;

        const prevAreaId = this.m_areaId;
        this.m_areaId = CourseMap.Instance()!.getCurrentAreaID(
            this.m_areaId,
            this.pos(),
            MapdataAreaBase.Type.MovingRoad,
        );

        if (this.m_areaId >= 0) {
            if (prevAreaId < 0 || prevAreaId !== this.m_areaId) {
                this.reset();
                const area = courseMap.getArea(this.m_areaId)!;
                const pointInfo = area.getPointInfo()!;
                this.m_pointInfo = pointInfo;
                if (pointInfo.pointCount() > 2) {
                    this.setTrackerPointInfo(pointInfo);
                } else {
                    this.m_incomingIdx = 0;
                    this.calcPointChange();
                }
                this.m_roadSpeedDecay = fr(fr(0.9) + fr(fr(0.001) * fr(area.param(0))));
                this.m_maxPullSpeed = fr(area.param(1));
            }
        } else {
            this.m_areaId = -1;
            this.m_currentIdx = -1;
            this.m_incomingIdx = -1;
            this.m_pullDirection.copy(Vector3f.zero);
        }

        return this.m_areaId >= 0;
    }

    /** @addr{0x80593E18} */
    private calcPointChange(): void {
        if (this.m_currentIdx === this.m_incomingIdx) {
            return;
        }

        const points = this.m_pointInfo!.points();

        const currentPos = points[this.m_incomingIdx]!.pos;
        const nextPos = points[this.m_incomingIdx + 1]!.pos;
        this.m_pullSpeed = fr(points[this.m_incomingIdx]!.setting[0]!);
        const pullInfluence = points[this.m_incomingIdx + 1]!.setting[1]!;

        this.m_pullDirection.copy(nextPos.sub(currentPos));
        this.m_pullDirection.normalise();

        // If the pull influence is 0, the pull direction moves forward, so do nothing
        // If the pull influence is 1, the pull direction moves left
        if (pullInfluence === 1) {
            this.m_pullDirection.copy(this.getPullUnitNormal().mul(-1.0));
        }

        // If the pull influence is 2, the pull direction moves right
        else if (pullInfluence === 2) {
            this.m_pullDirection.copy(this.getPullUnitNormal());
        }

        this.m_currentIdx = this.m_incomingIdx;
    }

    /** @addr{0x80593D54} */
    private calcTrackers(): void {
        this.m_globalTracker.calc();
        this.m_regionalTracker.calc();
    }

    /**
     * @addr{0x805AEAD8}
     * This isn't a part of KartPullPath, but is only called from this class.
     */
    private getPullUnitNormal(): Vector3f {
        // Dot product of two unit vectors being 1.0f => angle between them is 0
        // They're the same vector, just return zero
        if (Vector3f.ey.dot(this.m_pullDirection) === 1.0) {
            return Vector3f.zero.clone();
        }

        const nrm = Vector3f.ey.cross(this.m_pullDirection);
        nrm.normalise();
        return nrm;
    }

    /** @addr{0x80593D1C} */
    private setTrackerPointInfo(info: MapdataPointInfo): void {
        this.m_globalTracker.setPointInfo(info);
        this.m_regionalTracker.setPointInfo(info);
    }
}
