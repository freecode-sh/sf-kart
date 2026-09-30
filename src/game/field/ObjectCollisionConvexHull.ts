/** Port of Kinoko source/game/field/ObjectCollisionConvexHull.{hh,cc}. */

import { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { ObjectCollisionBase } from './ObjectCollisionBase';

/** Smallest convex shape that encloses a given set of points. */
export class ObjectCollisionConvexHull extends ObjectCollisionBase {
    protected m_points: Vector3f[];
    private readonly m_initRadius: number;
    private m_worldPoints: Vector3f[];
    private m_worldRadius: number;

    /**
     * @addr{0x808364E0}
     * C++ has two overloads: one taking a span of points, one taking a count.
     */
    constructor(pointsOrCount: readonly Readonly<Vector3f>[] | number) {
        super();
        if (typeof pointsOrCount === 'number') {
            this.m_initRadius = 70.0;
            this.m_worldRadius = 70.0;
            this.m_points = Array.from({ length: pointsOrCount }, () => new Vector3f());
            this.m_worldPoints = Array.from({ length: pointsOrCount }, () => new Vector3f());
        } else {
            this.m_points = pointsOrCount.map((p) => p.clone());
            this.m_initRadius = 70.0;
            this.m_worldPoints = Array.from({ length: pointsOrCount.length }, () => new Vector3f());
            this.m_worldRadius = 70.0;
        }
    }

    /**
     * C++ overloads `transform(mat, scale)` (@addr{0x808366D0}) and
     * `transform(mat, scale, speed)` (@addr{0x808367C4}).
     */
    transform(mat: Readonly<Matrix34f>, scale: Readonly<Vector3f>, speed?: Readonly<Vector3f>): void {
        if (speed === undefined) {
            if (scale.x !== 1.0) {
                let temp = new Matrix34f();
                temp.makeS(new Vector3f(scale.x, scale.x, scale.x));
                temp = mat.multiplyTo(temp);

                for (let i = 0; i < this.m_points.length; ++i) {
                    this.m_worldPoints[i]!.copy(temp.ps_multVector(this.m_points[i]!));
                }
            } else {
                for (let i = 0; i < this.m_points.length; ++i) {
                    this.m_worldPoints[i]!.copy(mat.ps_multVector(this.m_points[i]!));
                }
            }
            return;
        }

        this.m_translation.copy(speed);

        if (scale.x === 0.0) {
            for (let i = 0; i < this.m_points.length; ++i) {
                this.m_worldPoints[i]!.copy(mat.ps_multVector(this.m_points[i]!));
            }
        } else {
            let temp = new Matrix34f();
            temp.makeS(new Vector3f(scale.x, scale.x, scale.x));
            temp = mat.multiplyTo(temp);

            for (let i = 0; i < this.m_points.length; ++i) {
                this.m_worldPoints[i]!.copy(temp.ps_multVector(this.m_points[i]!));
            }
        }
    }

    /** @addr{0x80836628} */
    getSupport(v: Readonly<Vector3f>): Readonly<Vector3f> {
        let result = this.m_worldPoints[0]!;
        let maxDot = v.dot(result);

        for (let i = 1; i < this.m_worldPoints.length; ++i) {
            const iter = this.m_worldPoints[i]!;
            const iterDot = v.dot(iter);

            if (maxDot < iterDot) {
                result = iter;
                maxDot = iterDot;
            }
        }

        return result;
    }

    /** @addr{0x807F957C} */
    getBoundingRadius(): number {
        return this.m_worldRadius;
    }

    /** @addr{0x8081E254} */
    initRadius(): number {
        return this.m_initRadius;
    }

    /** @addr{0x8080C414} */
    setBoundingRadius(val: number): void {
        this.m_worldRadius = val;
    }
}
