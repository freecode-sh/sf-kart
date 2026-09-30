/** Port of Kinoko source/game/field/ObjectCollisionSphere.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { ObjectCollisionBase } from './ObjectCollisionBase';

export class ObjectCollisionSphere extends ObjectCollisionBase {
    private m_hasTranslation: boolean;
    private m_radius: number;
    private m_pos: Vector3f;
    private m_scaledRadius: number;
    private m_scaledPos: Vector3f;
    private m_worldPos: Vector3f;
    private m_center = new Vector3f();

    /** @addr{0x808368D0} */
    constructor(radius: number, center: Readonly<Vector3f>) {
        super();
        this.m_hasTranslation = false;
        this.m_radius = radius;
        this.m_pos = center.clone();
        this.m_scaledRadius = radius;
        this.m_scaledPos = center.clone();
        this.m_worldPos = center.clone();
    }

    /**
     * C++ overloads `transform(mat, scale)` (@addr{0x80836998}) and
     * `transform(mat, scale, speed)` (@addr{0x80836A50}).
     */
    transform(mat: Readonly<Matrix34f>, scale: Readonly<Vector3f>, speed?: Readonly<Vector3f>): void {
        if (speed === undefined) {
            this.m_hasTranslation = false;

            if (scale.x !== 1.0) {
                this.m_scaledPos.copy(this.m_pos.mul(scale.x));
                this.m_scaledRadius = fr(this.m_radius * scale.x);
            }

            this.m_worldPos.copy(mat.multVector(this.m_scaledPos));
            return;
        }

        this.m_hasTranslation = true;
        this.m_translation.copy(speed);

        if (scale.x !== 1.0) {
            this.m_scaledPos.copy(this.m_pos.mul(scale.x));
            this.m_scaledRadius = fr(this.m_radius * scale.x);
        }

        this.m_worldPos.copy(mat.multVector(this.m_scaledPos));

        this.m_center.copy(this.m_worldPos.sub(speed));
    }

    /** @addr{0x80836920} */
    getSupport(v: Readonly<Vector3f>): Readonly<Vector3f> {
        if (!this.m_hasTranslation) {
            return this.m_worldPos;
        }

        return this.m_worldPos.dot(v) > this.m_center.dot(v) ? this.m_worldPos : this.m_center;
    }

    /** @addr{0x80836B54} */
    getBoundingRadius(): number {
        return this.m_scaledRadius;
    }
}
