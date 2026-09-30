/** Port of Kinoko's game/kart/KartSuspensionPhysics.{hh,cc}. */

import { DEG2RAD, fmax, fmin, fr } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';

import { CollisionGroup } from './CollisionGroup';
import { KartObjectProxy } from './KartObjectProxy';
import type { BSP } from './KartParam';
import { eStatus } from './Status';

const F_0_3 = fr(0.3);
const F_0_1 = fr(0.1);
const F_0_01 = fr(0.01);

/** Manages wheel physics and collision checks. */
export class WheelPhysics extends KartObjectProxy {
    private m_wheelIdx: number;
    private m_bspWheelIdx: number;
    private m_bspWheel: BSP.Wheel | null;
    private m_hitboxGroup: CollisionGroup = null!;
    private readonly m_pos = new Vector3f();
    private readonly m_lastPos = new Vector3f();
    private readonly m_lastPosDiff = new Vector3f();
    private m_suspTravel = 0.0;
    private readonly m_colVel = new Vector3f();
    private readonly m_speed = new Vector3f();
    private readonly m_wheelEdgePos = new Vector3f();
    private m_effectiveRadius = 0.0;
    private m_targetEffectiveRadius = 0.0;
    private m_74 = 0.0;
    private readonly m_topmostPos = new Vector3f();

    /** @addr{0x8059940C} */
    constructor(wheelIdx: number, bspWheelIdx: number) {
        super();
        this.m_wheelIdx = wheelIdx;
        this.m_bspWheelIdx = bspWheelIdx;
        this.m_bspWheel = null;
    }

    /** @addr{0x80599470} */
    init(): void {
        this.m_hitboxGroup = new CollisionGroup();
        this.m_hitboxGroup.createSingleHitbox(10.0, Vector3f.zero);
    }

    /** @addr{0x805994D4} */
    initBsp(): void {
        this.m_bspWheel = this.bsp().wheels[this.m_bspWheelIdx]!;
    }

    /** @addr{0x80599508} */
    reset(): void {
        this.m_pos.setZero();
        this.m_lastPos.setZero();
        this.m_lastPosDiff.setZero();
        this.m_suspTravel = 0.0;
        this.m_colVel.setZero();
        this.m_speed.setZero();
        this.m_wheelEdgePos.setZero();
        this.m_effectiveRadius = 0.0;
        this.m_targetEffectiveRadius = 0.0;
        this.m_74 = 0.0;
        this.m_topmostPos.setZero();

        if (this.m_bspWheel) {
            this.m_suspTravel = this.m_bspWheel.maxTravel;
            this.m_effectiveRadius = this.m_bspWheel.wheelRadius;
        }
    }

    /** @addr{0x80599AD0} */
    realign(bottom: Readonly<Vector3f>, vehicleMovement: Readonly<Vector3f>): void {
        const topmostPos = this.m_topmostPos.add(vehicleMovement);
        const scaledMaxTravel = fr(this.m_bspWheel!.maxTravel * this.sub().someScale());
        const suspTravel = bottom.dot(this.m_pos.sub(topmostPos));
        this.m_suspTravel = fmax(0.0, fmin(scaledMaxTravel, suspTravel));
        this.m_pos.copy(topmostPos.add(bottom.mul(this.m_suspTravel)));
        this.m_speed.copy(this.m_pos.sub(this.m_lastPos));
        this.m_speed.subEq(this.dynamics().intVel());
        this.m_speed.subEq(this.dynamics().movingObjVel());
        this.m_speed.subEq(this.dynamics().movingRoadVel());
        this.m_speed.subEq(this.collisionData().movement);
        this.m_speed.subEq(this.collide().movement());
        this.m_hitboxGroup.collisionData().vel.addEq(this.m_speed);
        this.m_lastPos.copy(this.m_pos);
        this.m_lastPosDiff.copy(this.m_pos.sub(topmostPos));
    }

    /** @addr{0x80599690} */
    updateCollision(bottom: Readonly<Vector3f>, topmostPos: Readonly<Vector3f>): void {
        const bspWheel = this.m_bspWheel!;
        this.m_targetEffectiveRadius = bspWheel.wheelRadius;
        const status = this.status();

        if (status.offBit(eStatus.SkipWheelCalc)) {
            const nextRadius = bspWheel.sphereRadius;
            let scalar = fr(
                fr(this.m_effectiveRadius * this.scale().y) -
                    fr(nextRadius * this.move().totalScale()),
            );

            const center = this.m_pos.add(bottom.mul(scalar));
            scalar = fr(fr(F_0_3 * fr(nextRadius * this.move().leanRot())) * this.move().totalScale());
            center.addEq(this.bodyForward().mul(scalar));

            if (status.onBit(eStatus.HalfpipeMidair, eStatus.InCannon)) {
                this.m_hitboxGroup.collisionData().reset();
            } else {
                this.m_hitboxGroup.setHitboxScale(this.move().totalScale());
                if (status.onBit(eStatus.SoftWallSuspension)) {
                    this.m_hitboxGroup.hitbox(0).setLastPos(this.dynamics().pos());
                }

                this.collide().calcWheelCollision(
                    this.m_wheelIdx,
                    this.m_hitboxGroup,
                    this.m_colVel,
                    center,
                    nextRadius,
                );
                const colData = this.m_hitboxGroup.collisionData();

                if (colData.bFloor || colData.bWall || colData.bWall3) {
                    this.m_pos.addEq(colData.tangentOff);
                    if (colData.intensity > -1) {
                        const sinkDepth = fr(3.0 * fr(colData.intensity));
                        this.m_targetEffectiveRadius = fr(bspWheel.wheelRadius - sinkDepth);
                        this.body().trySetTargetSinkDepth(sinkDepth);
                    }
                }
            }
            this.m_hitboxGroup.hitbox(0).setLastPos(center);
        }

        this.m_topmostPos.copy(topmostPos);
        this.m_wheelEdgePos.copy(
            this.m_pos.add(bottom.mul(fr(this.m_effectiveRadius * this.move().totalScale()))),
        );
        this.m_effectiveRadius = fr(
            this.m_effectiveRadius +
                fr(fr(this.m_targetEffectiveRadius - this.m_effectiveRadius) * F_0_1),
        );
        this.m_suspTravel = bottom.dot(this.m_pos.sub(topmostPos));

        if (this.m_suspTravel < 0.0) {
            this.m_74 = 1.0;
            const suspBottom = bottom.mul(this.m_suspTravel);
            this.sub().updateSuspOvertravel(suspBottom);
        } else {
            this.m_74 = 0.0;
        }
    }

    /** @addr{0x80599DC0} */
    calcSuspension(forward: Readonly<Vector3f>): void {
        const rate = this.status().onBit(eStatus.SoftWallPush)
            ? F_0_01
            : this.collide().floorMomentRate();

        this.collide().applySomeFloorMoment(
            F_0_1,
            rate,
            this.m_hitboxGroup,
            forward,
            this.move().dir(),
            this.m_speed,
            true,
            true,
            this.status().offBit(eStatus.LargeFlipHit, eStatus.WheelieRot),
        );
    }

    // Setters

    setSuspTravel(suspTravel: number): void {
        this.m_suspTravel = suspTravel;
    }

    override setPos(pos: Readonly<Vector3f>): void {
        this.m_pos.copy(pos);
    }

    setLastPos(pos: Readonly<Vector3f>): void {
        this.m_lastPos.copy(pos);
    }

    setLastPosDiff(pos: Readonly<Vector3f>): void {
        this.m_lastPosDiff.copy(pos);
    }

    setWheelEdgePos(pos: Readonly<Vector3f>): void {
        this.m_wheelEdgePos.copy(pos);
    }

    setColVel(vec: Readonly<Vector3f>): void {
        this.m_colVel.copy(vec);
    }

    // Getters

    override pos(): Vector3f {
        return this.m_pos;
    }

    lastPosDiff(): Vector3f {
        return this.m_lastPosDiff;
    }

    suspTravel(): number {
        return this.m_suspTravel;
    }

    topmostPos(): Vector3f {
        return this.m_topmostPos;
    }

    hitboxGroup(): CollisionGroup {
        return this.m_hitboxGroup;
    }

    /**
     * NOTE: hides KartObjectProxy::speed() (f32) exactly like the C++ does, but with a different
     * return type (the wheel's velocity vector).
     */
    // @ts-expect-error -- C++ name hiding: WheelPhysics::speed() returns a Vector3f.
    override speed(): Vector3f {
        return this.m_speed;
    }

    override wheelEdgePos(): Vector3f {
        return this.m_wheelEdgePos;
    }

    effectiveRadius(): number {
        return this.m_effectiveRadius;
    }

    _74(): number {
        return this.m_74;
    }
}

/** Physics for a single wheel's suspension. */
export class KartSuspensionPhysics extends KartObjectProxy {
    private m_bspWheel: BSP.Wheel = null!;
    private m_tirePhysics: WheelPhysics | null;
    private m_tireType: KartSuspensionPhysics.TireType;
    private m_bspWheelIdx: number;
    private m_wheelIdx: number;
    private readonly m_topmostPos = new Vector3f();
    private m_maxTravelScaled = 0.0;
    private readonly m_bottomDir = new Vector3f();

    /** @addr{0x80599ED4} */
    constructor(wheelIdx: number, tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number) {
        super();
        this.m_tirePhysics = null;
        this.m_tireType = tireType;
        this.m_bspWheelIdx = bspWheelIdx;
        this.m_wheelIdx = wheelIdx;
    }

    /** @addr{0x80599FA0} */
    init(): void {
        this.m_tirePhysics = this.tire(this.m_wheelIdx).wheelPhysics();
        this.m_bspWheel = this.bsp().wheels[this.m_bspWheelIdx]!;
    }

    /** @addr{0x80599F54} */
    reset(): void {
        this.m_topmostPos.setZero();
        this.m_maxTravelScaled = 0.0;
        this.m_bottomDir.setZero();
    }

    /** @addr{0x8059A02C} */
    setInitialState(): void {
        const tirePhysics = this.m_tirePhysics!;
        const relPos = this.m_bspWheel.relPosition.clone();
        if (this.m_tireType === KartSuspensionPhysics.TireType.KartReflected) {
            relPos.x = -relPos.x;
        }

        const rotatedRelPos = this.dynamics().fullRot().rotateVector(relPos).add(this.pos());
        const unitRotated = this.dynamics().fullRot().rotateVector(Vector3f.ey.neg());

        tirePhysics.setPos(rotatedRelPos.add(unitRotated.mul(this.m_bspWheel.maxTravel)));
        tirePhysics.setLastPos(rotatedRelPos.add(unitRotated.mul(this.m_bspWheel.maxTravel)));
        tirePhysics.setLastPosDiff(tirePhysics.pos().sub(rotatedRelPos));
        tirePhysics.setWheelEdgePos(
            tirePhysics
                .pos()
                .add(
                    unitRotated.mul(
                        fr(tirePhysics.effectiveRadius() * this.move().totalScale()),
                    ),
                ),
        );
        tirePhysics.hitboxGroup().hitbox(0).setWorldPos(tirePhysics.pos());
        tirePhysics.hitboxGroup().hitbox(0).setLastPos(this.pos().add(Vector3f.ey.mul(100)));
        this.m_topmostPos.copy(rotatedRelPos);
    }

    /** @addr{0x8059A278} */
    calcCollision(dt: number, gravity: Readonly<Vector3f>, mat: Readonly<Matrix34f>): void {
        const tirePhysics = this.m_tirePhysics!;
        this.m_maxTravelScaled = fr(this.m_bspWheel.maxTravel * this.sub().someScale());

        const scaledRelPos = this.m_bspWheel.relPosition.mulV(this.scale());
        if (this.m_tireType === KartSuspensionPhysics.TireType.KartReflected) {
            scaledRelPos.x = -scaledRelPos.x;
        }

        const topmostPos = mat.ps_multVector(scaledRelPos);
        const mStack_60 = new Matrix34f();
        const euler_angles = new Vector3f(fr(this.m_bspWheel.xRot * DEG2RAD), 0.0, 0.0);
        mStack_60.makeR(euler_angles);
        const local_ac = mStack_60.multVector33(new Vector3f(0.0, -1.0, 0.0));
        this.m_bottomDir.copy(mat.multVector33(local_ac));

        const y_down = fr(tirePhysics.suspTravel() + fr(5.0 * this.sub().someScale()));
        tirePhysics.setSuspTravel(fmax(0.0, fmin(this.m_maxTravelScaled, y_down)));
        tirePhysics.setColVel(gravity.mul(fr(dt * 10.0)));
        tirePhysics.setPos(topmostPos.add(this.m_bottomDir.mul(tirePhysics.suspTravel())));

        if (this.status().offBit(eStatus.SkipWheelCalc)) {
            tirePhysics.updateCollision(this.m_bottomDir, topmostPos);
            this.m_topmostPos.copy(topmostPos);
        }
    }

    /**
     * @addr{0x8059A574}
     * Calculates linear force and rotation from the kart's suspension.
     */
    calcSuspension(forward: Readonly<Vector3f>, vehicleMovement: Readonly<Vector3f>): void {
        const tirePhysics = this.m_tirePhysics!;
        const lastPosDiff = tirePhysics.lastPosDiff().clone();

        tirePhysics.realign(this.m_bottomDir, vehicleMovement);

        const collisionData = tirePhysics.hitboxGroup().collisionData();
        if (!collisionData.bFloor) {
            return;
        }

        const topDiff = tirePhysics.pos().sub(this.m_topmostPos);
        const yDown = fmax(0.0, this.m_bottomDir.dot(topDiff));
        const speed = lastPosDiff.sub(topDiff);
        const travel = fr(this.m_maxTravelScaled - yDown);
        const speedScalar = this.m_bottomDir.dot(speed);

        const springDamp = -fr(
            fr(this.m_bspWheel.springStiffness * travel) +
                fr(this.m_bspWheel.dampingFactor * speedScalar),
        );

        const fRot = this.m_bottomDir.mul(springDamp);

        if (this.isInRespawn()) {
            fRot.y = fmax(-1.0, fmin(1.0, fRot.y));
        }

        const fLinear = fRot.clone();
        let rotProj = fRot.clone();
        rotProj.y = 0.0;

        rotProj = rotProj.proj(collisionData.floorNrm);
        fLinear.y = fr(fLinear.y + rotProj.y);
        fLinear.y = fmin(fLinear.y, this.param().stats().maxNormalAcceleration);

        const status = this.status();

        if (this.dynamics().extVel().y > 5.0 || status.onBit(eStatus.JumpPadDisableYsusForce)) {
            fLinear.y = 0.0;
        }

        this.dynamics().applySuspensionWrench(
            this.m_topmostPos,
            fLinear,
            fRot,
            status.onBit(eStatus.WheelieRot),
        );

        tirePhysics.calcSuspension(forward);
    }
}

export namespace KartSuspensionPhysics {
    /** Every other kart tire is a mirror of the first. Bikes do not leverage this. */
    export enum TireType {
        Kart = 0,
        KartReflected = 1,
        Bike = 2,
    }
}
