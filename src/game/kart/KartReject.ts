/** Port of Kinoko source/game/kart/KartReject.{hh,cc}. */

import { box } from '../../egg/core/Box';
import { atan2, DEG2RAD, fmax, fmin, fr, RAD2DEG } from '../../egg/math/Math';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { CollisionDirector, eCollisionAttribute } from '../field/CollisionDirector';
import { CollisionInfo } from '../field/KColData';
import {
    COL_TYPE_HALFPIPE_INVISIBLE_WALL,
    KCL_NONE,
    KCL_TYPE_B0E82DFF,
    KCL_TYPE_BIT,
    KCL_TYPE_DRIVER_FLOOR,
    KCL_TYPE_INVISIBLE_WALL,
} from '../field/KCollisionTypes';
import { KartObjectProxy } from './KartObjectProxy';
import { eStatus } from './Status';

/** Pertains to handling reject road. */
export class KartReject extends KartObjectProxy {
    private m_rejectSign = 0.0;

    /** @addr{Inlined in 0x80577FC4} */
    constructor() {
        super();
    }

    /** @addr{0x80585AE8} */
    reset(): void {
        this.m_rejectSign = 0.0;
    }

    /** @addr{0x80585AF8} */
    calcRejectRoad(): void {
        const status = this.status();

        if (status.onBit(eStatus.InAction)) {
            return;
        }

        if (status.onBit(eStatus.RejectRoadTrigger)) {
            let down = Vector3f.ey.neg();
            down = down.perpInPlane(this.move().up(), true);
            const cos = down.dot(this.move().lastDir());
            const sin = down.cross(this.move().lastDir()).length();
            let angle = atan2(sin, cos);
            angle = angle > 0.0 ? angle : -angle;

            let minAngle = 60.0;
            angle = fr(angle * RAD2DEG);
            let dVar11 = 1.0;

            if (this.move().up().dot(Vector3f.ey) < fr(-0.7)) {
                minAngle = fr(minAngle * 0.5);
                dVar11 = fr(dVar11 * 2.0);
            }

            if (angle > minAngle) {
                angle = fr(fr(0.05) * fr(angle - 60.0));
                const rot = Quatf.FromRPY3(
                    0.0,
                    fr(
                        fr(
                            fr(fr(1.0 + fr(angle * this.move().speedRatio())) * dVar11) *
                                DEG2RAD,
                        ) * this.m_rejectSign,
                    ),
                    0.0,
                );
                const local_78 = this.mainRot().multSwap(rot);
                local_78.normalise();

                this.dynamics().setAngVel0(Vector3f.zero);
                this.dynamics().setFullRot(local_78);
                this.dynamics().setMainRot(local_78);
            }

            status.resetBit(eStatus.Hop);

            const didReject = this.calcRejection();

            if (status.offBit(eStatus.NoSparkInvisibleWall) && !didReject) {
                this.move().clearRejectRoad();
            }

            return;
        }

        if (
            status.onBit(eStatus.RejectRoad) &&
            status.offBit(eStatus.ZipperInvisibleWall, eStatus.OverZipper, eStatus.HalfPipeRamp)
        ) {
            const upXZ = this.move().up().clone();
            upXZ.y = 0.0;

            if (upXZ.length() > 0.0 && this.speed() > 0.0) {
                upXZ.normalise();
                const local_88 = this.move().lastDir().perpInPlane(upXZ, true);

                if (local_88.y > 0.0) {
                    const upCross = Vector3f.ey.cross(local_88);
                    this.m_rejectSign = upCross.dot(this.move().up()) > 0.0 ? 1.0 : -1.0;

                    status.resetBit(eStatus.Hop).setBit(eStatus.RejectRoadTrigger);
                }
            }
        }
    }

    /** @addr{0x805860BC} */
    calcRejection(): boolean {
        const colInfo = new CollisionInfo();
        const mask = box<number>(KCL_NONE);
        const status = this.status();
        status.resetBit(eStatus.NoSparkInvisibleWall);
        const worldUpPos = this.dynamics().pos().add(this.bodyUp().mul(100.0));
        let posScalar = 100.0;
        let radius = posScalar;

        for (let i = 0; i < 2; ++i) {
            const local_d0 = this.dynamics().mainRot().rotateVector(Vector3f.ey);
            const worldPos = this.pos().add(
                local_d0.mul(fr(-posScalar * this.move().scale().y)),
            );

            const colDir = CollisionDirector.Instance()!;
            if (
                !colDir.checkSphereFullPush(
                    radius,
                    worldPos,
                    worldUpPos,
                    KCL_TYPE_B0E82DFF,
                    colInfo,
                    mask,
                    0,
                )
            ) {
                if (i === 0) {
                    posScalar = 0.0;
                }

                continue;
            }

            const tangentOff = Vector3f.zero.clone();

            if (!this.calcCollision(colInfo, mask.value, tangentOff)) {
                continue;
            }

            const tangentUp = tangentOff.sub(this.move().up()).mul(1.0);
            this.move().setUp(this.move().up().add(tangentUp));
            this.move().setSmoothedUp(this.move().up());

            const bVar15 = tangentOff.dot(Vector3f.ey) < fr(-0.17);
            if (bVar15 || this.extVel().y < 0.0 || status.onBit(eStatus.NoSparkInvisibleWall)) {
                radius = -radius;
                colInfo.tangentOff.addEq(worldPos);

                const yOffset = fr(this.bsp().initialYPos * this.scale().y);
                // static_cast<f32>(static_cast<f64>(|speed| * 0.01f) - 0.3)
                let speedScalar = bVar15 ? 1.0 : fr(fr(Math.abs(this.speed()) * fr(0.01)) - 0.3);
                speedScalar = fmin(1.0, fmax(0.0, speedScalar));

                const posOffset = colInfo.tangentOff
                    .add(tangentOff.mul(radius))
                    .add(tangentOff.mul(yOffset));
                posOffset.y = fr(posOffset.y + this.move().hopPosY());
                posOffset.subEq(this.pos());
                this.setPos(this.pos().add(posOffset.mul(speedScalar)));
            }

            const local_13c = this.move().lastDir().perpInPlane(this.move().smoothedUp(), true);
            this.move().setDir(local_13c);
            this.move().setVel1Dir(local_13c);

            return true;
        }

        return false;
    }

    private calcCollision(colInfo: CollisionInfo, mask_: number, tangentOff: Vector3f): boolean {
        const colDir = CollisionDirector.Instance()!;
        // `mask` is a by-value parameter in C++ whose address is taken below.
        const mask = box<number>(mask_);

        if ((mask.value & KCL_TYPE_INVISIBLE_WALL) !== 0) {
            if (
                colDir.findClosestCollisionEntry(mask, KCL_TYPE_INVISIBLE_WALL) &&
                colDir.closestCollisionEntry()!.variant() === 0
            ) {
                tangentOff.copy(colInfo.wallNrm);
                this.status().setBit(eStatus.NoSparkInvisibleWall);
                return true;
            }
        }

        const halfPipeInvisMask = KCL_TYPE_BIT(COL_TYPE_HALFPIPE_INVISIBLE_WALL);
        if ((mask.value & halfPipeInvisMask) !== 0) {
            if (colDir.findClosestCollisionEntry(mask, halfPipeInvisMask)) {
                tangentOff.copy(colInfo.wallNrm);
                this.status().setBit(eStatus.NoSparkInvisibleWall);
                return true;
            }
        }

        if ((mask.value & KCL_TYPE_DRIVER_FLOOR) !== 0) {
            if (
                colDir.findClosestCollisionEntry(mask, KCL_TYPE_DRIVER_FLOOR) &&
                colDir
                    .closestCollisionEntry()!
                    .attribute.onBit(eCollisionAttribute.RejectRoad)
            ) {
                tangentOff.copy(colInfo.floorNrm);
                return true;
            }
        }

        return false;
    }
}
