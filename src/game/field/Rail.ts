/** Port of Kinoko source/game/field/Rail.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import type { MapdataPointInfo } from '../system/map/MapdataPointInfo';
import { Point } from '../system/map/MapdataPointInfo';
import { CollisionDirector } from './CollisionDirector';
import { CollisionInfo, F32_MIN } from './KColData';
import { KCL_TYPE_FLOOR } from './KCollisionTypes';

export class RailLineTransition {
    m_length = 0.0;
    m_lengthInv = 0.0;
    m_dir = new Vector3f();
}

export class RailSplineTransition {
    m_p0 = new Vector3f();
    m_p1 = new Vector3f();
    m_p2 = new Vector3f();
    m_p3 = new Vector3f();
    m_length = 0.0;
    m_lengthInv = 0.0;
}

/** C++ `owning_span<Point>` deep copy of a span of points. */
function copyPoints(points: readonly Point[]): Point[] {
    return points.map((p) => new Point(p.pos.clone(), [p.setting[0], p.setting[1]]));
}

const EMPTY_PERCENTAGES: readonly number[] = Object.freeze([]);
const EMPTY_LINE_TRANSITIONS: readonly RailLineTransition[] = Object.freeze([]);
const EMPTY_SPLINE_TRANSITIONS: readonly RailSplineTransition[] = Object.freeze([]);

export abstract class Rail {
    protected m_pointCount: number; // u16
    protected m_isOscillating: boolean;
    protected m_points: Point[];
    protected m_someScale: number;

    private m_idx: number; // u16
    private m_pointCapacity: number; // u16
    private m_hasCheckedCol: boolean;
    private m_floorNrms: Vector3f[] = [];

    /** @addr{0x806EC9A4} */
    constructor(idx: number, info: MapdataPointInfo) {
        this.m_idx = idx;
        this.m_pointCapacity = info.pointCount();
        this.m_pointCount = info.pointCount();
        this.m_isOscillating = info.setting(1) === 1;
        this.m_points = copyPoints(info.points());
        this.m_hasCheckedCol = false;
        this.m_someScale = fr(0.1);
    }

    abstract getPathLength(): number;
    abstract getLinearTransitions(): readonly RailLineTransition[];
    abstract getSplineTransitions(): readonly RailSplineTransition[];
    abstract getEstimatorSampleCount(): number;
    abstract getEstimatorStep(): number;
    abstract getPathPercentages(): readonly number[];

    /** @addr{0x806ED110} */
    addPoint(scale: number, point: Readonly<Vector3f>): void {
        this.m_points[this.m_points.length - 1]!.pos.copy(point);
        this.m_someScale = scale;
        this.onPointAdded();
    }

    /** @addr{0x806ECCC0} */
    checkSphereFull(): void {
        if (this.m_hasCheckedCol) {
            return;
        }

        this.m_floorNrms = Array.from({ length: this.m_pointCount }, () => new Vector3f());

        for (let i = 0; i < this.m_pointCount; ++i) {
            const info = new CollisionInfo();
            info.bbox.setZero();

            const hasCourseCol = CollisionDirector.Instance()!.checkSphereFull(
                100.0,
                this.m_points[i]!.pos,
                Vector3f.inf,
                KCL_TYPE_FLOOR,
                info,
                null,
                0,
            );

            if (hasCourseCol) {
                if (info.floorDist > F32_MIN) {
                    this.m_floorNrms[i]!.copy(info.floorNrm);
                }
            } else {
                this.m_floorNrms[i]!.copy(Vector3f.ey);
            }
        }

        this.m_hasCheckedCol = true;
    }

    pointCount(): number {
        return this.m_pointCount;
    }

    isOscillating(): boolean {
        return this.m_isOscillating;
    }

    points(): readonly Point[] {
        return this.m_points;
    }

    /** @addr{0x806ED150} */
    pointPos(idx: number): Readonly<Vector3f> {
        return this.m_points[idx]!.pos;
    }

    floorNrm(idx: number): Readonly<Vector3f> {
        return this.m_floorNrms[idx]!;
    }

    idx(): number {
        return this.m_idx;
    }

    protected abstract onPointsChanged(): void;
    protected abstract onPointAdded(): void;
}

export class RailLine extends Rail {
    private m_dirCount: number; // u16
    private m_transitions: RailLineTransition[];
    private m_pathLength: number;

    /** @addr{0x806EF9B4} */
    constructor(idx: number, info: MapdataPointInfo) {
        super(idx, info);
        this.m_dirCount = this.m_isOscillating ? this.m_pointCount - 1 : this.m_pointCount;
        this.m_transitions = Array.from({ length: this.m_dirCount }, () => new RailLineTransition());
        this.m_pathLength = 0.0;

        for (let i = 0; i < this.m_pointCount - 1; ++i) {
            const transition = this.m_transitions[i]!;
            transition.m_dir.copy(this.m_points[i + 1]!.pos.sub(this.m_points[i]!.pos));
            transition.m_length = transition.m_dir.normalise();
            transition.m_lengthInv = fr(1.0 / transition.m_length);
            this.m_pathLength = fr(this.m_pathLength + transition.m_length);
        }

        if (!this.m_isOscillating) {
            const transition = this.m_transitions[this.m_transitions.length - 1]!;
            transition.m_dir.copy(this.m_points[0]!.pos.sub(this.m_points[this.m_points.length - 1]!.pos));
            transition.m_length = transition.m_dir.normalise();
            transition.m_lengthInv = fr(1.0 / transition.m_length);
            this.m_pathLength = fr(this.m_pathLength + transition.m_length);
        }
    }

    /** @addr{0x806F09A8} */
    getEstimatorSampleCount(): number {
        return 0;
    }

    /** @addr{0x806F099C} */
    getEstimatorStep(): number {
        return 0.0;
    }

    /** @addr{0x806F0994} In the base game we return a nullptr. To mimic this, return an empty array. */
    getPathPercentages(): readonly number[] {
        return EMPTY_PERCENTAGES;
    }

    /** @addr{0x806F09C0} */
    getPathLength(): number {
        return this.m_pathLength;
    }

    /** @addr{0x806F09B8} */
    getLinearTransitions(): readonly RailLineTransition[] {
        return this.m_transitions;
    }

    /** @addr{0x806F09B0} In the base game we return a nullptr. To mimic this, return an empty array. */
    getSplineTransitions(): readonly RailSplineTransition[] {
        return EMPTY_SPLINE_TRANSITIONS;
    }

    protected onPointsChanged(): void {}
    protected onPointAdded(): void {}
}

export class RailSpline extends Rail {
    private m_transitionCount: number; // u16
    private m_transitions: RailSplineTransition[];
    private m_estimatorSampleCount: number; // u32
    private m_estimatorStep: number;
    private m_pathPercentages: number[] = [];
    private m_segmentCount = 0; // s32
    private m_pathLength: number;
    private m_doNotAllocatePathPercentages: boolean;

    /** @addr{0x806ED57C} */
    constructor(idx: number, info: MapdataPointInfo) {
        super(idx, info);
        this.m_transitionCount = this.m_isOscillating ? this.m_pointCount - 1 : this.m_pointCount;
        this.m_transitions = Array.from({ length: this.m_transitionCount }, () => new RailSplineTransition());
        this.m_estimatorSampleCount = 10;
        this.m_estimatorStep = fr(1.0 / fr(this.m_estimatorSampleCount));

        // This is normally not set until AFTER the call to invalidateTransitions,
        // but the expected behavior requires that this is set to false.
        // This misordering was probably never noticed since EGG::Heap zeroes memory.
        this.m_doNotAllocatePathPercentages = false;

        this.invalidateTransitions(false);

        this.m_pathLength = 0.0;

        for (let i = 0; i < this.m_transitionCount; ++i) {
            this.m_pathLength = fr(this.m_pathLength + this.m_transitions[i]!.m_length);
        }
    }

    /** @addr{0x806EF994} */
    getEstimatorSampleCount(): number {
        return this.m_estimatorSampleCount;
    }

    /** @addr{0x806EF98C} */
    getEstimatorStep(): number {
        return this.m_estimatorStep;
    }

    /** @addr{0x806EF984} */
    getPathPercentages(): readonly number[] {
        return this.m_pathPercentages;
    }

    /** @addr{0x806EF9AC} */
    getPathLength(): number {
        return this.m_pathLength;
    }

    /** @addr{0x806EF9A4} */
    getLinearTransitions(): readonly RailLineTransition[] {
        return EMPTY_LINE_TRANSITIONS;
    }

    /** @addr{0x806EF99C} */
    getSplineTransitions(): readonly RailSplineTransition[] {
        return this.m_transitions;
    }

    /** @addr{0x806ED8BC} */
    protected onPointsChanged(): void {
        this.m_doNotAllocatePathPercentages = true;
        this.m_transitionCount = this.m_isOscillating ? this.m_pointCount - 1 : this.m_pointCount;

        this.invalidateTransitions(false);

        this.m_pathLength = 0.0;

        for (const transition of this.m_transitions) {
            this.m_pathLength = fr(this.m_pathLength + transition.m_length);
        }
    }

    /** @addr{0x806ED960} */
    protected onPointAdded(): void {
        this.m_doNotAllocatePathPercentages = true;
        this.m_transitionCount = this.m_isOscillating ? this.m_pointCount - 1 : this.m_pointCount;

        this.invalidateTransitions(true);

        this.m_pathLength = 0.0;

        for (const transition of this.m_transitions) {
            this.m_pathLength = fr(this.m_pathLength + transition.m_length);
        }
    }

    /** @addr{0x806EDA04} */
    private invalidateTransitions(lastOnly: boolean): void {
        if (!this.m_doNotAllocatePathPercentages) {
            const count = this.m_estimatorSampleCount * this.m_transitionCount + 1;
            // owning_span<f32>(count) does not initialize its elements; every slot that is read is
            // written by estimateLength first.
            this.m_pathPercentages = new Array<number>(count).fill(0.0);
        }

        this.m_segmentCount = 0;

        const pts = this.m_points;
        const n = this.m_transitionCount;

        if (this.m_isOscillating) {
            if (!lastOnly) {
                const firstTransition = this.m_transitions[0]!;
                firstTransition.m_p0.copy(pts[0]!.pos);
                firstTransition.m_p1.copy(pts[1]!.pos.sub(pts[0]!.pos).multInv(4.0).add(pts[0]!.pos));
                firstTransition.m_p2.copy(this.calcCubicBezierP2(pts[0]!.pos, pts[1]!.pos, pts[2]!.pos));
                firstTransition.m_p3.copy(pts[1]!.pos);
                firstTransition.m_length = this.estimateLength(firstTransition, this.m_estimatorSampleCount);
                firstTransition.m_lengthInv = fr(1.0 / firstTransition.m_length);

                for (let i = 1; i < n - 1; ++i) {
                    this.calcCubicBezierControlPoints(
                        pts[i - 1]!.pos,
                        pts[i]!.pos,
                        pts[i + 1]!.pos,
                        pts[i + 2]!.pos,
                        this.m_estimatorSampleCount,
                        this.m_transitions[i]!,
                    );
                }
            }

            const lastTransition = this.m_transitions[this.m_transitions.length - 1]!;
            lastTransition.m_p0.copy(pts[n - 1]!.pos);
            lastTransition.m_p1.copy(this.calcCubicBezierP1(pts[n - 2]!.pos, pts[n - 1]!.pos, pts[n]!.pos));
            lastTransition.m_p2.copy(pts[n - 1]!.pos.sub(pts[n]!.pos).multInv(4.0).add(pts[n]!.pos));
            lastTransition.m_p3.copy(pts[n]!.pos);
            lastTransition.m_length = this.estimateLength(lastTransition, this.m_estimatorSampleCount);
            lastTransition.m_lengthInv = fr(1.0 / lastTransition.m_length);
        } else {
            if (!lastOnly) {
                const firstTransition = this.m_transitions[0]!;
                firstTransition.m_p0.copy(pts[0]!.pos);
                firstTransition.m_p1.copy(this.calcCubicBezierP1(pts[n - 1]!.pos, pts[0]!.pos, pts[1]!.pos));
                firstTransition.m_p2.copy(this.calcCubicBezierP2(pts[0]!.pos, pts[1]!.pos, pts[2]!.pos));
                firstTransition.m_p3.copy(pts[1]!.pos);
                firstTransition.m_length = this.estimateLength(firstTransition, this.m_estimatorSampleCount);
                firstTransition.m_lengthInv = fr(1.0 / firstTransition.m_length);

                for (let i = 1; i < n - 1; ++i) {
                    if (i + 2 !== n) {
                        this.calcCubicBezierControlPoints(
                            pts[i - 1]!.pos,
                            pts[i]!.pos,
                            pts[i + 1]!.pos,
                            pts[i + 2]!.pos,
                            this.m_estimatorSampleCount,
                            this.m_transitions[i]!,
                        );
                    } else {
                        this.calcCubicBezierControlPoints(
                            pts[i - 1]!.pos,
                            pts[i]!.pos,
                            pts[i + 1]!.pos,
                            pts[0]!.pos,
                            this.m_estimatorSampleCount,
                            this.m_transitions[i]!,
                        );
                    }
                }
            }

            const lastTransition = this.m_transitions[this.m_transitions.length - 1]!;
            lastTransition.m_p0.copy(pts[n - 1]!.pos);
            lastTransition.m_p1.copy(this.calcCubicBezierP1(pts[n - 2]!.pos, pts[n - 1]!.pos, pts[0]!.pos));
            lastTransition.m_p2.copy(this.calcCubicBezierP2(pts[n - 1]!.pos, pts[0]!.pos, pts[1]!.pos));
            lastTransition.m_p3.copy(pts[0]!.pos);
            lastTransition.m_length = this.estimateLength(lastTransition, this.m_estimatorSampleCount);
            lastTransition.m_lengthInv = fr(1.0 / lastTransition.m_length);
        }
    }

    /** @addr{0x806EE27C} */
    private calcCubicBezierControlPoints(
        p0: Readonly<Vector3f>,
        p1: Readonly<Vector3f>,
        p2: Readonly<Vector3f>,
        p3: Readonly<Vector3f>,
        count: number,
        transition: RailSplineTransition,
    ): void {
        transition.m_p0.copy(p1);
        transition.m_p1.copy(this.calcCubicBezierP1(p0, p1, p2));
        transition.m_p2.copy(this.calcCubicBezierP2(p1, p2, p3));
        transition.m_p3.copy(p2);
        transition.m_length = this.estimateLength(transition, count);
        transition.m_lengthInv = fr(1.0 / transition.m_length);
    }

    /** @addr{0x806EE56C} */
    private estimateLength(transition: RailSplineTransition, count: number): number {
        const waypoints: Vector3f[] = [];

        for (let i = 0; i < count + 1; ++i) {
            waypoints[i] = this.cubicBezier(fr(this.m_estimatorStep * fr(i)), transition);
        }
        let length = 0.0;

        // Numerator loop
        for (let i = 0; i < count; ++i) {
            this.m_pathPercentages[this.m_segmentCount++] = length;
            length = fr(length + waypoints[i]!.sub(waypoints[i + 1]!).length());
        }

        // Denominator loop
        for (let i = this.m_segmentCount - 1; i > this.m_segmentCount - count - 1; --i) {
            this.m_pathPercentages[i] = fr(this.m_pathPercentages[i]! / length);
        }

        return length;
    }

    /** @addr{0x806EE408} */
    private calcCubicBezierP1(p0: Readonly<Vector3f>, p1: Readonly<Vector3f>, p2: Readonly<Vector3f>): Vector3f {
        const res = p2.sub(p0);
        const len = res.length();
        res.normalise2();
        return p1.add(res.mul(fr(len * this.m_someScale)));
    }

    /** @addr{0x806EE4B8} */
    private calcCubicBezierP2(p0: Readonly<Vector3f>, p1: Readonly<Vector3f>, p2: Readonly<Vector3f>): Vector3f {
        const res = p0.sub(p2);
        const len = res.length();
        res.normalise2();
        return p1.add(res.mul(fr(len * this.m_someScale)));
    }

    /** @addr{0x806EE72C} */
    private cubicBezier(t: number, transition: RailSplineTransition): Vector3f {
        const dt = fr(1.0 - t);

        const res = transition.m_p0.mul(fr(fr(dt * dt) * dt));
        res.addEq(transition.m_p1.mul(fr(fr(3.0 * t) * fr(dt * dt))));
        res.addEq(transition.m_p2.mul(fr(fr(3.0 * fr(t * t)) * dt)));
        res.addEq(transition.m_p3.mul(fr(fr(t * t) * t)));

        return res;
    }
}
