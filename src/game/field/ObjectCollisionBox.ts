/** Port of Kinoko source/game/field/ObjectCollisionBox.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { ObjectCollisionConvexHull } from './ObjectCollisionConvexHull';

/** Inherits ObjectCollisionConvexHull, as a box is a convex hull of its vertices. */
export class ObjectCollisionBox extends ObjectCollisionConvexHull {
    private m_dimensions: Vector3f;
    private m_center: Vector3f;
    private m_scale: Vector3f;

    /** @addr{0x80833840} */
    constructor(x: number, y: number, z: number, center: Readonly<Vector3f>) {
        super(8);
        this.m_dimensions = new Vector3f(x, y, z);
        this.m_center = center.clone();
        this.m_scale = Vector3f.unit.clone();

        const radius = this.getBoundingRadius();
        const scaledDims = this.m_dimensions.sub(new Vector3f(radius, radius, radius));

        this.setPoints(scaledDims);
    }

    /**
     * C++ overloads `transform(mat, scale)` (@addr{0x80833B00}) and
     * `transform(mat, scale, speed)` (@addr{0x80833EEC}).
     */
    override transform(mat: Readonly<Matrix34f>, scale: Readonly<Vector3f>, speed?: Readonly<Vector3f>): void {
        const radius = this.getBoundingRadius();
        this.m_scale.copy(scale);

        const scaledDims = this.m_dimensions.mulV(this.m_scale).sub(new Vector3f(radius, radius, radius));

        this.setPoints(scaledDims);

        if (speed === undefined) {
            super.transform(mat, Vector3f.unit);
        } else {
            super.transform(mat, Vector3f.unit, speed);
        }
    }

    /** The eight corner assignments shared (inlined) by the constructor and both transforms. */
    private setPoints(scaledDims: Readonly<Vector3f>): void {
        const c = this.m_center;
        const p = this.m_points;
        const y2 = fr(2.0 * scaledDims.y);

        p[0]!.x = fr(c.x + scaledDims.x);
        p[0]!.y = fr(c.y + y2);
        p[0]!.z = fr(c.z + scaledDims.z);

        p[1]!.x = fr(c.x + scaledDims.x);
        p[1]!.y = fr(c.y + y2);
        p[1]!.z = fr(c.z - scaledDims.z);

        p[2]!.x = fr(c.x + scaledDims.x);
        p[2]!.y = fr(c.y - y2);
        p[2]!.z = fr(c.z + scaledDims.z);

        p[3]!.x = fr(c.x - scaledDims.x);
        p[3]!.y = fr(c.y + y2);
        p[3]!.z = fr(c.z + scaledDims.z);

        p[4]!.x = fr(c.x + scaledDims.x);
        p[4]!.y = fr(c.y - y2);
        p[4]!.z = fr(c.z - scaledDims.z);

        p[5]!.x = fr(c.x - scaledDims.x);
        p[5]!.y = fr(c.y + y2);
        p[5]!.z = fr(c.z - scaledDims.z);

        p[6]!.x = fr(c.x - scaledDims.x);
        p[6]!.y = fr(c.y - y2);
        p[6]!.z = fr(c.z + scaledDims.z);

        p[7]!.x = fr(c.x - scaledDims.x);
        p[7]!.y = fr(c.y - y2);
        p[7]!.z = fr(c.z - scaledDims.z);
    }
}
