/**
 * Port of Kinoko source/game/field/RailInterpolator.{hh,cc}.
 *
 * Primitive out-params of `getPathLocation(f32 t, s16 &idx, f32 &len)` use Box<number>.
 */

import type { Box } from '../../egg/core/Box';
import { box } from '../../egg/core/Box';
import { fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import type { Point } from '../system/map/MapdataPointInfo';
import type { RailLineTransition, RailSplineTransition } from './Rail';
import { RailManager } from './RailManager';

export enum RailInterpolatorStatus {
    InProgress = 0,
    SegmentEnd = 1,
    ChangingDirection = 2,
}

const s16 = (x: number): number => (x << 16) >> 16;
const u16 = (x: number): number => x & 0xffff;

export abstract class RailInterpolator {
    static readonly Status = RailInterpolatorStatus;

    protected m_railIdx: number; // s16
    protected m_pointCount: number; // u16
    protected m_points: readonly Point[];
    protected m_isOscillating: boolean;
    protected m_speed: number;
    protected m_usePerPointVelocities = false;
    protected m_curPos = new Vector3f();
    protected m_curTangentDir = new Vector3f();
    protected m_currVel: number;
    protected m_prevPointVel = 0.0;
    protected m_nextPointVel = 0.0;
    protected m_currSegmentVel = 0.0;
    protected m_segmentT = 0.0;
    protected m_movementDirectionForward = false;
    protected m_currPointIdx = 0; // s16
    protected m_nextPointIdx = 0; // s16
    protected m_4a = false;

    /** @addr{0x806ED160} */
    constructor(speed: number, idx: number) {
        this.m_points = RailManager.Instance()!.rail(idx).points();
        this.m_currVel = 0.0;
        this.m_railIdx = s16(idx);
        const rail = RailManager.Instance()!.rail(idx);
        this.m_pointCount = rail.pointCount();
        this.m_isOscillating = rail.isOscillating();
        this.m_speed = speed;
    }

    abstract init(t: number, idx: number): void;
    abstract calc(): RailInterpolatorStatus;
    abstract setCurrVel(speed: number): void;

    abstract getCurrVel(): number;
    abstract evalCubicBezierOnPath(t: number, currDir: Vector3f, curTangentDir: Vector3f): void;
    abstract getPathLocation(t: number, idx: Box<number>, len: Box<number>): void;

    abstract getCurrSegmentLength(): number;

    setPerPointVelocities(isSet: boolean): void {
        this.m_usePerPointVelocities = isSet;
    }

    /** @addr{0x806C63A8} */
    setT(t: number): void {
        this.m_segmentT = t;
    }

    /** @addr{0x806ED204} */
    reverseDirection(): void {
        this.m_movementDirectionForward = !this.m_movementDirectionForward;
        const tmp = this.m_currPointIdx;
        this.m_currPointIdx = this.m_nextPointIdx;
        this.m_nextPointIdx = tmp;
        this.m_segmentT = fr(1.0 - this.m_segmentT);
    }

    /** @addr{0806ED24C} */
    floorNrm(idx: number): Readonly<Vector3f> {
        return RailManager.Instance()!.rail(this.m_railIdx).floorNrm(idx);
    }

    /** @addr{0x806ED30C} */
    railLength(): number {
        return RailManager.Instance()!.rail(this.m_railIdx).getPathLength();
    }

    curPoint(): Point {
        return this.m_points[this.m_currPointIdx]!;
    }

    nextPoint(): Point {
        return this.m_points[this.m_nextPointIdx]!;
    }

    railIdx(): number {
        return this.m_railIdx;
    }

    pointCount(): number {
        return this.m_pointCount;
    }

    speed(): number {
        return this.m_speed;
    }

    curPos(): Readonly<Vector3f> {
        return this.m_curPos;
    }

    curTangentDir(): Readonly<Vector3f> {
        return this.m_curTangentDir;
    }

    currVel(): number {
        return this.m_currVel;
    }

    segmentT(): number {
        return this.m_segmentT;
    }

    isMovementDirectionForward(): boolean {
        return this.m_movementDirectionForward;
    }

    curPointIdx(): number {
        return this.m_currPointIdx;
    }

    nextPointIdx(): number {
        return this.m_nextPointIdx;
    }

    /** @addr{0x806ED3E4} */
    protected updateVel(): void {
        const t = this.m_segmentT;
        this.setCurrVel(fr(fr(fr(1.0 - t) * this.m_prevPointVel) + fr(t * this.m_nextPointVel)));
    }

    /** @addr{0x806ED34C} */
    protected calcVelocities(): void {
        this.m_prevPointVel = fr(this.m_points[this.m_currPointIdx]!.setting[0]);
        this.m_nextPointVel = this.shouldChangeDirection()
            ? 0.0
            : fr(this.m_points[this.m_nextPointIdx]!.setting[0]);

        if (this.m_prevPointVel === 0.0) {
            this.m_prevPointVel = this.m_speed;
        }

        if (this.m_nextPointVel === 0.0) {
            this.m_nextPointVel = this.m_speed;
        }

        // @bug This is callable with an invalid m_nextPointIdx, so we need a safeguard
        // This invalid state is resolved very shortly after, but the vel propagates to the next
        // frame. If t is ever not 0, this leads to undefined behavior, so we guard against it here
        if (this.shouldChangeDirection() && this.m_segmentT !== 0.0) {
            throw new Error('RailInterpolator::calcVelocities: direction change with t != 0');
        }
    }

    /** @addr{0x806F0814} */
    protected shouldChangeDirection(): boolean {
        if (!this.m_isOscillating) {
            return this.m_pointCount === this.m_nextPointIdx;
        }

        return this.m_movementDirectionForward
            ? this.m_nextPointIdx === this.m_pointCount
            : this.m_nextPointIdx === -1;
    }

    /** @addr{0x806F0880} */
    protected calcDirectionChange(): void {
        if (!this.m_isOscillating) {
            return;
        }

        if (this.m_movementDirectionForward) {
            this.m_nextPointIdx = s16(this.m_nextPointIdx - 2);
        } else {
            this.m_nextPointIdx = s16(this.m_nextPointIdx + 2);
        }

        this.m_movementDirectionForward = !this.m_movementDirectionForward;
    }

    protected calcNextIndices(): void {
        if (this.m_movementDirectionForward) {
            this.m_currPointIdx = s16(this.m_currPointIdx + 1);
            this.m_nextPointIdx = s16(this.m_nextPointIdx + 1);
        } else {
            this.m_currPointIdx = s16(this.m_currPointIdx - 1);
            this.m_nextPointIdx = s16(this.m_nextPointIdx - 1);
        }

        if (!this.m_isOscillating) {
            if (this.m_nextPointIdx === this.m_pointCount) {
                this.m_nextPointIdx = 0;
            }

            if (this.m_currPointIdx === this.m_pointCount) {
                this.m_currPointIdx = 0;
            }
        }
    }
}

export class RailLinearInterpolator extends RailInterpolator {
    private m_currentDirection = new Vector3f();
    private m_transitions: readonly RailLineTransition[];

    /** @addr{0x806EFDC4} */
    constructor(speed: number, idx: number) {
        super(speed, idx);
        this.m_transitions = RailManager.Instance()!.rail(this.m_railIdx).getLinearTransitions();
        this.init(0.0, 0);
    }

    /** @addr{0x806EFEAC} */
    init(t: number, idx: number): void {
        this.m_segmentT = t;
        this.m_currPointIdx = s16(idx);

        const isLastPoint = u16(idx) === this.m_pointCount - 1;
        this.m_nextPointIdx = s16(isLastPoint ? idx - 1 : idx + 1);
        this.m_movementDirectionForward = isLastPoint ? !this.m_isOscillating : true;

        this.m_curPos.copy(this.m_points[this.m_currPointIdx]!.pos);
        this.m_currentDirection.copy(this.m_points[this.m_nextPointIdx]!.pos.sub(this.m_curPos));
        this.m_curTangentDir.copy(this.m_currentDirection);
        this.m_curTangentDir.normalise2();
        this.m_currVel = this.m_speed;
        this.m_prevPointVel = this.m_speed;
        this.m_nextPointVel = this.m_speed;
        this.m_4a = false;
        this.m_usePerPointVelocities = false;
        this.m_currSegmentVel = fr(this.m_speed / this.m_currentDirection.length());
    }

    /** @addr{0x806F0050} */
    calc(): RailInterpolatorStatus {
        if (this.m_4a) {
            this.m_curPos.copy(this.m_points[this.m_pointCount - 1]!.pos);

            return RailInterpolatorStatus.ChangingDirection;
        }

        if (this.m_usePerPointVelocities) {
            this.updateVel();
        }

        this.m_segmentT = fr(this.m_segmentT + this.m_currSegmentVel);
        this.m_curPos.copy(this.lerp(this.m_segmentT, this.m_currPointIdx, this.m_nextPointIdx));

        if (this.m_segmentT <= 1.0) {
            return RailInterpolatorStatus.InProgress;
        }

        let status = RailInterpolatorStatus.SegmentEnd;

        this.calcNextSegment();

        if (this.shouldChangeDirection()) {
            status = RailInterpolatorStatus.ChangingDirection;

            this.calcDirectionChange();
        }

        this.m_currentDirection.copy(
            this.m_points[this.m_nextPointIdx]!.pos.sub(this.m_points[this.m_currPointIdx]!.pos),
        );
        this.m_curTangentDir.copy(this.m_currentDirection);
        this.m_currSegmentVel = fr(this.m_currVel / this.m_currentDirection.length());
        this.m_curTangentDir.normalise2();

        return status;
    }

    /** @addr{0x806EFFF4} */
    setCurrVel(speed: number): void {
        this.m_currVel = speed;
        this.m_currSegmentVel = fr(this.m_currVel / this.m_currentDirection.length());
    }

    /** @addr{0x806F0944} */
    getCurrVel(): number {
        return this.m_currVel;
    }

    /** @addr{0x806F02EC} */
    evalCubicBezierOnPath(t: number, currDir: Vector3f, curTangentDir: Vector3f): void {
        const currIdx = box(0);
        const len = box(0.0);

        this.getPathLocation(t, currIdx, len);

        let nextIdx = s16(currIdx.value + 1);
        if (nextIdx === this.m_pointCount) {
            nextIdx = 0;
        }

        currDir.copy(
            this.m_points[currIdx.value]!.pos.mul(fr(1.0 - len.value)).add(
                this.m_points[nextIdx]!.pos.mul(len.value),
            ),
        );
        curTangentDir.copy(this.m_transitions[currIdx.value]!.m_dir);
    }

    /** @addr{0x806F041C} */
    getPathLocation(t: number, idx: Box<number>, len: Box<number>): void {
        if (!this.m_movementDirectionForward) {
            return;
        }

        let dist = fr(this.m_segmentT * this.m_transitions[this.m_currPointIdx]!.m_length);
        if (t <= dist) {
            idx.value = this.m_currPointIdx;
            len.value = fr(fr(dist - t) * this.m_transitions[this.m_currPointIdx]!.m_lengthInv);
            return;
        }

        for (let i = 0; i < this.m_pointCount; ++i) {
            let currIdx = this.m_currPointIdx - 1;
            if (currIdx === -1) {
                currIdx = this.m_pointCount - 1;
            }

            currIdx -= i;
            if (currIdx < 0) {
                currIdx += this.m_pointCount;
            }

            dist = fr(dist + this.m_transitions[currIdx]!.m_length);
            if (t <= dist) {
                idx.value = s16(currIdx);
                len.value = fr(fr(dist - t) * this.m_transitions[currIdx]!.m_lengthInv);
                return;
            }
        }
    }

    /** @addr{0x806F050C} */
    getCurrSegmentLength(): number {
        const idx = this.m_movementDirectionForward ? this.m_currPointIdx : this.m_nextPointIdx;
        return this.m_transitions[idx]!.m_length;
    }

    /** @addr{0x806F0610} */
    private calcNextSegment(): void {
        this.calcNextIndices();

        // @bug The game accesses POTI points out-of-bounds, but then course-corrects by
        // setting m_segmentT to 0.0f once it detects an invalid nextPointIdx, but after
        // it already read from undefined memory.
        if (this.shouldChangeDirection()) {
            this.m_segmentT = 0.0;
        } else {
            const prevDirLength = this.m_currentDirection.length();
            this.m_currentDirection.copy(
                this.m_points[this.m_nextPointIdx]!.pos.sub(this.m_points[this.m_currPointIdx]!.pos),
            );
            this.m_segmentT = fr(
                fr(fr(this.m_segmentT - 1.0) * prevDirLength) / this.m_currentDirection.length(),
            );

            if (this.m_segmentT > 1.0) {
                this.m_segmentT = fr(0.99);
            }
        }

        if (this.m_usePerPointVelocities) {
            this.calcVelocities();
        }
    }

    /** @addr{0x806F0540} */
    private lerp(t: number, currIdx: number, nextIdx: number): Vector3f {
        return this.m_points[currIdx]!.pos.mul(fr(1.0 - t)).add(this.m_points[nextIdx]!.pos.mul(t));
    }
}

export class RailSmoothInterpolator extends RailInterpolator {
    private m_transitions: readonly RailSplineTransition[];
    private m_estimatorSampleCount: number; // u32
    private m_estimatorStep: number;
    private m_pathPercentages: readonly number[];
    private m_prevPos = new Vector3f();
    private m_velocity = 0.0;

    /** @addr{0x806EE830} */
    constructor(speed: number, idx: number) {
        super(speed, idx);
        const rail = RailManager.Instance()!.rail(this.m_railIdx);
        this.m_transitions = rail.getSplineTransitions();
        this.m_estimatorSampleCount = rail.getEstimatorSampleCount() >>> 0;
        this.m_estimatorStep = rail.getEstimatorStep();
        this.m_pathPercentages = rail.getPathPercentages();

        this.init(0.0, 0);
    }

    /** @addr{0x806EE924} */
    init(t: number, idx: number): void {
        this.m_segmentT = t;

        this.m_currPointIdx = s16(idx);

        if (idx >>> 0 === ((this.m_pointCount - 1) >>> 0) && this.m_isOscillating) {
            this.m_nextPointIdx = s16(this.m_currPointIdx - 1);
            this.m_movementDirectionForward = false;
            this.m_curTangentDir.copy(
                this.calcCubicBezierTangentDir(this.m_segmentT, this.m_transitions[this.m_currPointIdx]!),
            );
            this.m_currSegmentVel = fr(this.m_currVel * this.m_transitions[this.m_nextPointIdx]!.m_lengthInv);
        } else {
            this.m_nextPointIdx = s16(idx + 1 === this.m_pointCount ? 0 : idx + 1);
            this.m_movementDirectionForward = true;
            this.m_curTangentDir.copy(
                this.calcCubicBezierTangentDir(this.m_segmentT, this.m_transitions[this.m_currPointIdx]!),
            );
            this.m_currSegmentVel = fr(this.m_currVel * this.m_transitions[this.m_currPointIdx]!.m_lengthInv);
        }

        this.m_curPos.copy(this.m_points[this.m_currPointIdx]!.pos);
        this.m_prevPos.copy(this.m_points[this.m_currPointIdx]!.pos);
        this.m_currVel = this.m_speed;
        this.m_prevPointVel = this.m_speed;
        this.m_nextPointVel = this.m_speed;
        this.m_velocity = 0.0;
        this.m_4a = false;
        this.m_usePerPointVelocities = false;
    }

    /** @addr{0x806EEBEC} */
    calc(): RailInterpolatorStatus {
        if (this.m_4a) {
            this.m_curPos.copy(this.m_transitions[this.m_pointCount - 2]!.m_p3);

            return RailInterpolatorStatus.ChangingDirection;
        }

        if (this.m_usePerPointVelocities) {
            this.updateVel();
        }

        this.m_prevPos.copy(this.m_curPos);

        const t = this.m_movementDirectionForward
            ? this.calcT(this.m_segmentT)
            : this.calcT(fr(1.0 - this.m_segmentT));

        this.calcCubicBezier(t, this.m_currPointIdx, this.m_nextPointIdx, this.m_curPos, this.m_curTangentDir);

        const deltaPos = this.m_curPos.sub(this.m_prevPos);
        this.m_velocity = deltaPos.length();
        this.m_segmentT = fr(this.m_segmentT + this.m_currSegmentVel);

        if (this.m_segmentT <= 1.0) {
            return RailInterpolatorStatus.InProgress;
        }

        let status = RailInterpolatorStatus.SegmentEnd;

        this.calcNextSegment();

        if (this.shouldChangeDirection()) {
            status = RailInterpolatorStatus.ChangingDirection;

            this.calcDirectionChange();
        }

        if (this.m_movementDirectionForward) {
            this.m_currSegmentVel = fr(this.m_currVel * this.m_transitions[this.m_currPointIdx]!.m_lengthInv);
        } else {
            this.m_currSegmentVel = fr(this.m_currVel * this.m_transitions[this.m_nextPointIdx]!.m_lengthInv);
        }

        return status;
    }

    /** @addr{0x806EEB94} */
    setCurrVel(speed: number): void {
        this.m_currVel = speed;

        if (this.m_movementDirectionForward) {
            this.m_currSegmentVel = fr(speed * this.m_transitions[this.m_currPointIdx]!.m_lengthInv);
        } else {
            this.m_currSegmentVel = fr(speed * this.m_transitions[this.m_nextPointIdx]!.m_lengthInv);
        }
    }

    /** @addr{0x806EF93C} */
    getCurrVel(): number {
        return this.m_velocity;
    }

    /** @addr{0x806EEEBC} */
    evalCubicBezierOnPath(t: number, currDir: Vector3f, curTangentDir: Vector3f): void {
        const currIdx = box(0);
        const len = box(0.0);

        this.getPathLocation(t, currIdx, len);

        let nextIdx = s16(currIdx.value + 1);
        if (nextIdx === this.m_pointCount) {
            nextIdx = 0;
        }

        len.value = this.m_movementDirectionForward ? this.calcT(len.value) : this.calcT(fr(1.0 - len.value));

        this.calcCubicBezier(len.value, currIdx.value, nextIdx, currDir, curTangentDir);
    }

    /** @addr{0x806EEFA0} */
    getPathLocation(t: number, idx: Box<number>, len: Box<number>): void {
        if (!this.m_movementDirectionForward) {
            return;
        }

        let dist = fr(this.m_segmentT * this.m_transitions[this.m_currPointIdx]!.m_length);
        if (t <= dist) {
            idx.value = this.m_currPointIdx;
            len.value = fr(fr(dist - t) * this.m_transitions[this.m_currPointIdx]!.m_lengthInv);
            return;
        }

        for (let i = 0; i < this.m_pointCount; ++i) {
            let currIdx = this.m_currPointIdx - 1;
            if (currIdx === -1) {
                currIdx = this.m_pointCount - 1;
            }

            currIdx -= i;
            if (currIdx < 0) {
                currIdx += this.m_pointCount;
            }

            dist = fr(dist + this.m_transitions[currIdx]!.m_length);
            if (t <= dist) {
                idx.value = s16(currIdx);
                len.value = fr(fr(dist - t) * this.m_transitions[currIdx]!.m_lengthInv);
                return;
            }
        }
    }

    /** @addr{0x806EF09C} */
    getCurrSegmentLength(): number {
        const idx = this.m_movementDirectionForward ? this.m_currPointIdx : this.m_nextPointIdx;
        return this.m_transitions[idx]!.m_length;
    }

    /** @addr{0x806EF224} */
    private calcCubicBezier(t: number, currIdx: number, nextIdx: number, pos: Vector3f, dir: Vector3f): void {
        const transition = this.m_movementDirectionForward
            ? this.m_transitions[currIdx]!
            : this.m_transitions[nextIdx]!;

        pos.copy(this.calcCubicBezierPos(t, transition));
        dir.copy(this.calcCubicBezierTangentDir(t, transition));
    }

    /** @addr{0x806EF350} */
    private calcCubicBezierPos(t: number, trans: RailSplineTransition): Vector3f {
        const dt = fr(1.0 - t);

        const res = trans.m_p0.mul(fr(fr(dt * dt) * dt));
        res.addEq(trans.m_p1.mul(fr(fr(3.0 * t) * fr(dt * dt))));
        res.addEq(trans.m_p2.mul(fr(fr(3.0 * fr(t * t)) * dt)));
        res.addEq(trans.m_p3.mul(fr(fr(t * t) * t)));

        return res;
    }

    /** @addr{0x806EF454} */
    private calcCubicBezierTangentDir(t: number, trans: RailSplineTransition): Vector3f {
        const c1 = trans.m_p0.mul(-1.0).add(trans.m_p1.mul(3.0)).sub(trans.m_p2.mul(3.0)).add(trans.m_p3);
        const c2 = trans.m_p0.mul(3.0).sub(trans.m_p1.mul(6.0)).add(trans.m_p2.mul(3.0));
        const c3 = trans.m_p0.mul(-3.0).add(trans.m_p1.mul(3.0));
        const ret = c1.mul(3.0).mul(fr(t * t)).add(c2.mul(2.0).mul(t)).add(c3);

        ret.normalise2();

        if (!this.m_movementDirectionForward) {
            ret.mulEq(-1.0);
        }

        return ret;
    }

    /** @addr{0x806EF0F8} */
    private calcT(t: number): number {
        const sampleIdx = u16(
            this.m_movementDirectionForward
                ? this.m_currPointIdx * this.m_estimatorSampleCount
                : this.m_nextPointIdx * this.m_estimatorSampleCount,
        );

        let delta = 0.0;
        let idx = 0; // u16

        for (let i = 0; i < this.m_estimatorSampleCount - 1; ++i) {
            const currPercent = this.m_pathPercentages[sampleIdx + i]!;
            const nextPercent = this.m_pathPercentages[sampleIdx + i + 1]!;

            if (currPercent <= t && nextPercent > t) {
                delta = fr(fr(t - currPercent) / fr(nextPercent - currPercent));
                idx = i;
            }
        }

        const lastPercent = this.m_pathPercentages[sampleIdx + this.m_estimatorSampleCount - 1]!;

        if (lastPercent <= t && 1.0 >= t) {
            idx = u16(this.m_estimatorSampleCount - 1);
            delta = fr(fr(t - lastPercent) / fr(1.0 - lastPercent));
        }

        return fr(fr(this.m_estimatorStep * fr(idx)) + fr(this.m_estimatorStep * delta));
    }

    /** @addr{0x806EF664} */
    private calcNextSegment(): void {
        const nextT = fr(this.m_segmentT - 1.0);

        if (this.m_isOscillating) {
            if (this.m_nextPointIdx === 0 || this.m_nextPointIdx === this.m_pointCount - 1) {
                this.m_segmentT = 0.0;
            } else if (this.m_movementDirectionForward) {
                this.m_segmentT = fr(
                    fr(nextT * this.m_transitions[this.m_currPointIdx]!.m_length) *
                        this.m_transitions[this.m_nextPointIdx]!.m_lengthInv,
                );
            } else {
                this.m_segmentT = fr(
                    fr(nextT * this.m_transitions[this.m_currPointIdx - 1]!.m_length) *
                        this.m_transitions[this.m_nextPointIdx - 1]!.m_lengthInv,
                );
            }
        } else {
            this.m_segmentT = fr(
                fr(nextT * this.m_transitions[this.m_currPointIdx]!.m_length) *
                    this.m_transitions[this.m_nextPointIdx]!.m_lengthInv,
            );
        }

        if (this.m_segmentT > 1.0) {
            this.m_segmentT = fr(0.99);
        }

        this.calcNextIndices();

        if (this.m_usePerPointVelocities) {
            this.calcVelocities();
        }
    }
}
