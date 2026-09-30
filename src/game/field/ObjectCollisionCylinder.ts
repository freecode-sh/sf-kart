/** Port of Kinoko source/game/field/ObjectCollisionCylinder.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { ObjectCollisionBase } from './ObjectCollisionBase';

export class ObjectCollisionCylinder extends ObjectCollisionBase {
    private m_radius: number;
    private m_height: number;
    private m_pos: Vector3f;

    private m_worldRadius: number;
    private m_worldHeight: number;
    private m_worldPos: Vector3f;

    private m_center: Vector3f;
    private m_top: Vector3f;
    private m_bottom: Vector3f;

    /** @addr{0x80836068} */
    constructor(radius: number, height: number, center: Readonly<Vector3f>) {
        super();
        this.m_radius = radius;
        this.m_height = height;
        this.m_pos = center.clone();

        this.m_worldRadius = radius;
        this.m_worldHeight = height;
        this.m_worldPos = center.clone();

        this.m_center = center.clone();
        this.m_top = center.add(Vector3f.ey.mul(height));
        this.m_bottom = center.sub(Vector3f.ey.mul(height));
    }

    /**
     * C++ overloads `transform(mat, scale)` (@addr{0x808361F0}) and
     * `transform(mat, scale, speed)` (@addr{0x80836334}), which sets the translation and then
     * calls the two-argument overload.
     */
    transform(mat: Readonly<Matrix34f>, scale: Readonly<Vector3f>, speed?: Readonly<Vector3f>): void {
        if (speed !== undefined) {
            this.m_translation.copy(speed);
        }

        this.m_worldPos.copy(this.m_pos.mul(scale.x));
        this.m_worldHeight = fr(this.m_height * scale.y);
        this.m_worldRadius = fr(this.m_radius * scale.x);

        this.m_center.copy(mat.ps_multVector(this.m_worldPos));
        this.m_top.copy(mat.ps_multVector(this.m_worldPos.add(Vector3f.ey.mul(this.m_worldHeight))));
        this.m_bottom.copy(mat.ps_multVector(this.m_worldPos.sub(Vector3f.ey.mul(this.m_worldHeight))));
    }

    /** @addr{0x8083618C} */
    getSupport(v: Readonly<Vector3f>): Readonly<Vector3f> {
        return this.m_top.dot(v) > this.m_bottom.dot(v) ? this.m_top : this.m_bottom;
    }

    /** @addr{0x80836498} */
    getBoundingRadius(): number {
        return this.m_worldRadius;
    }
}
