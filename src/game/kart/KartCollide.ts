/** Port of Kinoko's game/kart/KartCollide.{hh,cc}. */

import { TBitFlag } from '../../egg/core/BitFlag';
import { box, type Box } from '../../egg/core/Box';
import { BoundBox3f } from '../../egg/math/BoundBox';
import { F32_EPSILON, fmax, fmin, fr } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import type { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { CollisionDirector } from '../field/CollisionDirector';
import { CourseColMgr, NoBounceWallColInfo } from '../field/CourseColMgr';
import { CollisionInfo, CollisionInfoPartial } from '../field/KColData';
import {
    COL_TYPE_BOOST_PAD,
    COL_TYPE_BOOST_RAMP,
    COL_TYPE_CANNON_TRIGGER,
    COL_TYPE_EFFECT_TRIGGER,
    COL_TYPE_FALL_BOUNDARY,
    COL_TYPE_HALFPIPE_INVISIBLE_WALL,
    COL_TYPE_HALFPIPE_RAMP,
    COL_TYPE_JUMP_PAD,
    COL_TYPE_MOVING_WATER,
    COL_TYPE_SOLID_OOB,
    COL_TYPE_STICKY_ROAD,
    COL_TYPE_WALL_2,
    KCL_NONE,
    KCL_TYPE_4010D000,
    KCL_TYPE_ANY_INVISIBLE_WALL,
    KCL_TYPE_BIT,
    KCL_TYPE_DIRECTIONAL,
    KCL_TYPE_DRIVER_SOLID_SURFACE,
    KCL_TYPE_DRIVER_WALL,
    KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL,
    KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL2,
    KCL_TYPE_FLOOR,
    KCL_TYPE_NON_DIRECTIONAL,
    KCL_TYPE_VEHICLE_COLLIDEABLE,
    KCL_TYPE_WALL,
} from '../field/KCollisionTypes';
import { ObjectId } from '../field/obj/ObjectId';
import { ObjectCollisionKart } from '../field/ObjectCollisionKart';
import { ObjectDirector } from '../field/ObjectDirector';
import type { CollisionData, CollisionGroup, Hitbox } from './CollisionGroup';
import { Action, KartAction } from './KartAction';
import { KartMove } from './KartMove';
import { KartObjectProxy } from './KartObjectProxy';
import { KartPullPath } from './KartPullPath';
import { KartCamera } from '../render/KartCamera';
import { eStatus } from './Status';

/** std::numeric_limits<f32>::min() (smallest positive normal f32). */
const F32_MIN = fr(1.1754943508222875e-38);

export enum Reaction {
    None = 0,
    UNK_3 = 3,
    UNK_4 = 4,
    UNK_5 = 5,
    UNK_7 = 7,
    WallAllSpeed = 8,
    SpinAllSpeed = 9,
    SpinSomeSpeed = 10,
    FireSpin = 11,
    ClipThroughSomeSpeed = 12,
    SmallLaunch = 13,
    KnockbackSomeSpeedLoseItem = 14,
    LaunchSpinLoseItem = 15,
    KnockbackBumpLoseItem = 16,
    LongCrushLoseItem = 17,
    SmallBump = 18,
    BigBump = 19,
    SpinShrink = 20,
    HighLaunchLoseItem = 21,
    SpinHitSomeSpeed = 22,
    WeakWall = 23,
    Wall = 24,
    LaunchSpin = 25,
    WallSpark = 26,
    RubberWall = 27,
    Wall2 = 28,
    UntrickableJumpPad = 29,
    ShortCrushLoseItem = 30,
    CrushRespawn = 31,
    ExplosionLoseItem = 32,
}

/** KartCollide::eSurfaceFlags. Also reachable as `KartCollide.eSurfaceFlags`. */
export enum eSurfaceFlags {
    Wall = 0,
    SolidOOB = 1,
    ObjectWall = 2,
    ObjectWall3 = 3,
    BoostRamp = 4,
    Offroad = 6, ///< @unused
    GroundBoostPanelOrRamp = 7,
    Trickable = 11,
    NotTrickable = 12,
    StopHalfPipeState = 16,
}

export type SurfaceFlags = TBitFlag<eSurfaceFlags>;

type ObjectCollisionHandler = (self: KartCollide, idx: number) => Action;

function s16(x: number): number {
    return (x << 16) >> 16;
}

/** Manages body+wheel collision and its influence on position/velocity/etc. */
export class KartCollide extends KartObjectProxy {
    static readonly eSurfaceFlags = eSurfaceFlags;

    private m_pullPath: KartPullPath;
    private m_boundingRadius: number;
    private m_floorMomentRate = 0.0;
    private m_totalReactionWallNrm = new Vector3f();
    private m_surfaceFlags: SurfaceFlags = new TBitFlag<eSurfaceFlags>();
    private m_tangentOff = new Vector3f();
    private m_movement = new Vector3f();
    private m_respawnTimer = 0; ///< s16
    private m_solidOobTimer = 0; ///< s16
    private m_shrinkTimer = 0; ///< s16
    private m_smoothedBack = 0.0; // 0x50
    private m_sumHitboxBottomHeightSoftWall = 0.0;
    private m_numSoftWallCollisions = 0; ///< u16
    private m_sumHitboxBottomHeightFloorOnly = 0.0;
    private m_numFloorOnlyCollisions = 0; ///< u16
    private m_poleAngVelTimer = 0; ///< s16
    private m_poleYaw = 0.0;
    private m_colPerpendicularity = 0.0;

    /** @addr{0x8056E56C} */
    constructor() {
        super();
        this.m_pullPath = new KartPullPath();
        this.m_boundingRadius = 100.0;
        this.m_surfaceFlags.makeAllZero();
    }

    /** @addr{0x8056E624} */
    init(): void {
        this.m_pullPath.init();
        this.calcBoundingRadius();
        this.m_floorMomentRate = fr(0.8);
        this.m_surfaceFlags.makeAllZero();
        this.m_respawnTimer = 0;
        this.m_solidOobTimer = 0;
        this.m_shrinkTimer = 0;
        this.m_smoothedBack = 0.0;
        this.m_sumHitboxBottomHeightFloorOnly = 0.0;
        this.m_sumHitboxBottomHeightSoftWall = 0.0;
        this.m_numFloorOnlyCollisions = 0;
        this.m_numSoftWallCollisions = 0;
        this.m_poleAngVelTimer = 0;
        this.m_poleYaw = 0.0;
        this.m_colPerpendicularity = 0.0;
    }

    /** @addr{0x805730D4} */
    resetHitboxes(): void {
        const hitboxGroup = this.physics().hitboxGroup();
        for (let idx = 0; idx < hitboxGroup.hitboxCount(); ++idx) {
            hitboxGroup.hitbox(idx).setLastPos(this.scale(), this.pose());
        }
    }

    /**
     * @addr{0x8056EE24}
     * On each frame, calculates the positions for each hitbox.
     */
    calcHitboxes(): void {
        const hitboxGroup = this.physics().hitboxGroup();
        for (let idx = 0; idx < hitboxGroup.hitboxCount(); ++idx) {
            hitboxGroup
                .hitbox(idx)
                .calc(
                    this.move().totalScale(),
                    this.body().sinkDepth(),
                    this.scale(),
                    this.fullRot(),
                    this.pos(),
                );
        }
    }

    /** @addr{0x80572C20} */
    findCollision(): void {
        const wasHalfPipe = this.status().onBit(eStatus.EndHalfPipe, eStatus.ActionMidZipper);
        const rot = wasHalfPipe ? this.mainRot() : this.fullRot();
        this.calcBodyCollision(this.move().totalScale(), this.body().sinkDepth(), rot, this.scale());

        const colData = this.collisionData();
        const existingWallCollision = colData.bWall || colData.bWall3;
        const newWallCollision = this.m_surfaceFlags.onBit(
            eSurfaceFlags.ObjectWall,
            eSurfaceFlags.ObjectWall3,
        );
        if (existingWallCollision || newWallCollision) {
            if (!existingWallCollision) {
                colData.wallNrm.copy(this.m_totalReactionWallNrm);
                if (this.m_surfaceFlags.onBit(eSurfaceFlags.ObjectWall)) {
                    colData.bWall = true;
                } else if (this.m_surfaceFlags.onBit(eSurfaceFlags.ObjectWall3)) {
                    colData.bWall3 = true;
                }
            } else if (newWallCollision) {
                colData.wallNrm.addEq(this.m_totalReactionWallNrm);
                if (this.m_surfaceFlags.onBit(eSurfaceFlags.ObjectWall)) {
                    colData.bWall = true;
                } else if (this.m_surfaceFlags.onBit(eSurfaceFlags.ObjectWall3)) {
                    colData.bWall3 = true;
                }
            }

            colData.wallNrm.normalise();
        }

        this.FUN_80572F4C();
    }

    /**
     * @addr{0x80572F4C}
     * @rename
     */
    FUN_80572F4C(): void {
        let fVar1: number;

        const status = this.status();

        if (
            this.isInRespawn() ||
            status.onBit(
                eStatus.Boost,
                eStatus.OverZipper,
                eStatus.ZipperInvisibleWall,
                eStatus.NoSparkInvisibleWall,
                eStatus.HalfPipeRamp,
            )
        ) {
            fVar1 = 0.0;
        } else {
            fVar1 = fr(0.05);
        }

        const resetXZ =
            fVar1 > 0.0 &&
            status.onBit(eStatus.AirtimeOver20) &&
            this.dynamics().velocity().y < -50.0;

        this.FUN_805B72B8(
            status.onBit(eStatus.InAction) ? fr(0.3) : fr(0.01),
            fVar1,
            resetXZ,
            status.offBit(eStatus.JumpPadDisableYsusForce),
        );
    }

    /**
     * @addr{0x805B72B8}
     * Affects velocity when landing from airtime.
     * @rename
     */
    FUN_805B72B8(param_1: number, param_2: number, lockXZ: boolean, addExtVelY: boolean): void {
        const colData = this.collisionData();

        if (!colData.bFloor && !colData.bWall && !colData.bWall3) {
            return;
        }

        const collisionDir = colData.floorNrm.add(colData.wallNrm);
        collisionDir.normalise();

        const directionalVelocity = colData.vel.dot(collisionDir);
        if (directionalVelocity >= 0.0) {
            return;
        }

        let rotMat = new Matrix34f();

        rotMat.makeQ(this.dynamics().mainRot());
        const rotMatTrans = rotMat.transpose();
        rotMat = rotMat.multiplyTo(this.dynamics().invInertiaTensor()).multiplyTo(rotMatTrans);

        const relPos = colData.relPos.clone();
        if (lockXZ) {
            relPos.x = 0.0;
            relPos.z = 0.0;
        }

        const step1 = relPos.cross(collisionDir);
        const step2 = rotMat.multVector33(step1);
        const step3 = step2.cross(relPos);
        const val = fr(
            fr(-directionalVelocity * fr(1.0 + param_2)) / fr(1.0 + collisionDir.dot(step3)),
        );
        const step4 = collisionDir.cross(colData.vel.neg());
        const step5 = step4.cross(collisionDir);
        step5.normalise();

        const fVar1 = fr(param_1 * Math.abs(val));
        const otherVal = fr(fr(val * colData.vel.dot(step5)) / directionalVelocity);

        let fVar3 = otherVal;
        if (fVar1 < Math.abs(otherVal)) {
            fVar3 = fVar1;
            if (otherVal < 0.0) {
                fVar3 = fr(-param_1 * Math.abs(val));
            }
        }

        const step6 = collisionDir.mul(val).add(step5.mul(fVar3));

        let local_1d0 = step6.y;
        if (!addExtVelY) {
            local_1d0 = 0.0;
        } else if (colData.bFloor) {
            let velY = this.intVel().y;
            if (velY > 0.0) {
                velY = fr(velY + this.extVel().y);
                if (velY < 0.0) {
                    const newExtVel = this.extVel().clone();
                    newExtVel.y = velY;
                    this.dynamics().setExtVel(newExtVel);
                }
            }
        }

        const prevExtVelY = this.extVel().y;
        const extVelAdd = step6.clone();
        extVelAdd.y = local_1d0;
        this.dynamics().setExtVel(this.extVel().add(extVelAdd));

        if (prevExtVelY < 0.0 && this.extVel().y > 0.0 && this.extVel().y < 10.0) {
            const extVelNoY = this.extVel().clone();
            extVelNoY.y = 0.0;
            this.dynamics().setExtVel(extVelNoY);
        }

        const step7 = relPos.cross(step6);
        const step8 = rotMat.multVector33(step7);
        const step9 = this.mainRot().rotateVectorInv(step8);
        step9.y = 0.0;
        this.dynamics().setAngVel0(this.dynamics().angVel0().add(step9));
    }

    /**
     * @addr{0x805B6724}
     * Checks and acts on collision for each kart hitbox.
     */
    calcBodyCollision(
        totalScale: number,
        sinkDepth: number,
        rot: Readonly<Quatf>,
        scale: Readonly<Vector3f>,
    ): void {
        const hitboxGroup = this.physics().hitboxGroup();
        const collisionData = hitboxGroup.collisionData();
        collisionData.reset();

        const posRel = Vector3f.zero.clone();
        const count = box(0);
        const colInfo = new CollisionInfo();
        colInfo.bbox.setDirect(Vector3f.zero, Vector3f.zero);
        const maskOut = box(0);
        const noBounceWallInfo = new NoBounceWallColInfo();
        const minMax = new BoundBox3f();
        minMax.setZero();
        let bVar1 = false;

        for (let hitboxIdx = 0; hitboxIdx < hitboxGroup.hitboxCount(); ++hitboxIdx) {
            let flags = KCL_TYPE_DRIVER_SOLID_SURFACE;
            const hitbox = hitboxGroup.hitbox(hitboxIdx);

            if (hitbox.bspHitbox().wallsOnly !== 0) {
                flags = 0x4a109000;
                CourseColMgr.Instance()!.setNoBounceWallInfo(noBounceWallInfo);
            }

            hitbox.calc(totalScale, sinkDepth, scale, rot, this.pos());

            if (
                CollisionDirector.Instance()!.checkSphereCachedFullPush(
                    hitbox.radius(),
                    hitbox.worldPos(),
                    hitbox.lastPos(),
                    flags,
                    colInfo,
                    maskOut,
                    0,
                )
            ) {
                if ((maskOut.value & KCL_TYPE_VEHICLE_COLLIDEABLE) !== 0) {
                    CollisionDirector.Instance()!.findClosestCollisionEntry(
                        maskOut,
                        KCL_TYPE_VEHICLE_COLLIDEABLE,
                    );
                }

                if (
                    !this.FUN_805B6A9C(
                        collisionData,
                        hitbox,
                        minMax,
                        posRel,
                        count,
                        maskOut.value,
                        colInfo,
                    )
                ) {
                    bVar1 = true;

                    if (colInfo.movingFloorDist > -F32_MIN) {
                        collisionData.bHasRoadVel = true;
                        collisionData.roadVelocity.copy(colInfo.roadVelocity);
                    }

                    this.processBody(collisionData, hitbox, colInfo, maskOut);
                }
            }
        }

        if (bVar1) {
            const movement = minMax.min.add(minMax.max);
            this.applyBodyCollision(collisionData, movement, posRel, count.value);
        } else {
            collisionData.speedFactor = 1.0;
            collisionData.rotFactor = 1.0;
        }
    }

    /** @addr{0x80571634} */
    calcFloorEffect(): void {
        if (this.status().onBit(eStatus.TouchingGround)) {
            this.m_surfaceFlags.setBit(eSurfaceFlags.Offroad, eSurfaceFlags.GroundBoostPanelOrRamp);
        }

        this.m_sumHitboxBottomHeightFloorOnly = 0.0;
        this.m_surfaceFlags.resetBit(
            eSurfaceFlags.Wall,
            eSurfaceFlags.SolidOOB,
            eSurfaceFlags.BoostRamp,
            eSurfaceFlags.Offroad,
            eSurfaceFlags.Trickable,
            eSurfaceFlags.NotTrickable,
            eSurfaceFlags.StopHalfPipeState,
        );
        this.m_sumHitboxBottomHeightSoftWall = 0.0;
        this.m_numFloorOnlyCollisions = 0;
        this.m_numSoftWallCollisions = 0;

        const mask = box<number>(KCL_NONE);
        this.calcTriggers(mask, this.pos(), false);

        const colDir = CollisionDirector.Instance()!;

        if (
            this.m_solidOobTimer >= 3 &&
            this.m_surfaceFlags.onBit(eSurfaceFlags.SolidOOB) &&
            this.m_surfaceFlags.offBit(eSurfaceFlags.Wall)
        ) {
            if ((mask.value & KCL_TYPE_BIT(COL_TYPE_SOLID_OOB)) !== 0) {
                colDir.findClosestCollisionEntry(mask, KCL_TYPE_BIT(COL_TYPE_SOLID_OOB));
            }

            this.activateOob(true, mask, false, false);
        }

        mask.value = KCL_NONE;
        this.calcTriggers(mask, this.pos(), true);

        this.m_solidOobTimer = this.m_surfaceFlags.onBit(eSurfaceFlags.SolidOOB)
            ? Math.min(3, this.m_solidOobTimer + 1)
            : 0;

        if (this.status().onBit(eStatus.Wall3Collision, eStatus.WallCollision)) {
            const maskOut = box<number>(KCL_NONE);

            if (
                colDir.checkSphereCachedPartialPush(
                    this.m_boundingRadius,
                    this.pos(),
                    Vector3f.inf,
                    KCL_TYPE_BIT(COL_TYPE_FALL_BOUNDARY),
                    null,
                    maskOut,
                    0,
                )
            ) {
                this.calcFallBoundary(maskOut, true);
            }
        }
    }

    /** @addr{0x805718D4} */
    calcTriggers(mask: Box<number>, pos: Readonly<Vector3f>, twoPoint: boolean): void {
        const v1 = twoPoint ? this.physics().pos().clone() : Vector3f.inf.clone();
        const typeMask = twoPoint ? KCL_TYPE_DIRECTIONAL : KCL_TYPE_NON_DIRECTIONAL;
        const radius = twoPoint ? 80.0 : fr(100.0 * this.move().totalScale());
        let scalar = fr(fr(-this.bsp().initialYPos * this.move().totalScale()) * fr(0.3));
        const scaledPos = pos.add(this.componentYAxis().mul(scalar));
        const back = this.dynamics().mainRot().rotateVector(Vector3f.ez);

        this.m_smoothedBack = fr(
            this.m_smoothedBack +
                fr(fr(back.dot(this.move().smoothedUp()) - this.m_smoothedBack) * fr(0.3)),
        );

        scalar = fr(
            fr(fr(this.m_smoothedBack * -this.physics().fc()) * fr(1.8)) *
                this.move().totalScale(),
        );
        scaledPos.addEq(back.mul(scalar));

        const collide = CollisionDirector.Instance()!.checkSphereCachedPartialPush(
            radius,
            scaledPos,
            v1,
            typeMask,
            null,
            mask,
            0,
        );

        if (!collide) {
            return;
        }

        if (twoPoint) {
            this.handleTriggers(mask);
        } else {
            if ((mask.value & KCL_TYPE_FLOOR) !== 0) {
                CollisionDirector.Instance()!.findClosestCollisionEntry(mask, KCL_TYPE_FLOOR);
            }

            if ((mask.value & KCL_TYPE_WALL) !== 0) {
                this.m_surfaceFlags.setBit(eSurfaceFlags.Wall);
            }

            if ((mask.value & KCL_TYPE_BIT(COL_TYPE_SOLID_OOB)) !== 0) {
                this.m_surfaceFlags.setBit(eSurfaceFlags.SolidOOB);
            }
        }
    }

    /** @addr{0x8056F510} */
    handleTriggers(mask: Box<number>): void {
        this.calcFallBoundary(mask, false);
        this.processCannon(mask);

        if ((mask.value & KCL_TYPE_BIT(COL_TYPE_EFFECT_TRIGGER)) !== 0) {
            const colDir = CollisionDirector.Instance()!;
            if (colDir.findClosestCollisionEntry(mask, KCL_TYPE_BIT(COL_TYPE_EFFECT_TRIGGER))) {
                if (colDir.closestCollisionEntry()!.variant() === 4) {
                    this.halfPipe().end(true);
                    this.status().setBit(eStatus.EndHalfPipe);
                    this.m_surfaceFlags.setBit(eSurfaceFlags.StopHalfPipeState);
                }
            }
        }
    }

    /** @addr{0x80571D98} */
    calcFallBoundary(mask: Box<number>, shortBoundary: boolean): void {
        if ((mask.value & KCL_TYPE_BIT(COL_TYPE_FALL_BOUNDARY)) === 0) {
            return;
        }

        const colDir = CollisionDirector.Instance()!;
        if (!colDir.findClosestCollisionEntry(mask, KCL_TYPE_BIT(COL_TYPE_FALL_BOUNDARY))) {
            return;
        }

        let safe = false;
        const entry = colDir.closestCollisionEntry()!;

        if (shortBoundary) {
            if (entry.variant() !== 7) {
                safe = true;
            }
        }

        if (!safe) {
            // Real game (not in Kinoko, render only; NTSC-U 0x8056D03C): the fall camera, which
            // stays put while the kart falls (and rises for fall boundary variants 1-3).
            if (this.status().offBit(eStatus.BeforeRespawn)) {
                const variant = entry.variant();
                KartCamera.Instance()?.startFallCamera(variant >= 1 && variant <= 3);
            }
            this.activateOob(false, mask, false, false);
        }
    }

    /** @addr{0x80573ED4} */
    calcBeforeRespawn(): void {
        if (this.pos().y < 0.0) {
            this.activateOob(true, null, false, false);
        }

        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn)) {
            this.m_respawnTimer = s16(this.m_respawnTimer - 1);
            if (this.m_respawnTimer > 0) {
                return;
            }

            status.resetBit(eStatus.BeforeRespawn);
            this.m_respawnTimer = 0;
            this.move().triggerRespawn();
        }

        this.m_shrinkTimer = s16(Math.max(0, this.m_shrinkTimer - 1));
    }

    /** @addr{0x80573B00} */
    activateOob(
        _detachCamera: boolean,
        _mask: Box<number> | null,
        _somethingCPU: boolean,
        _somethingBullet: boolean,
    ): void {
        const RESPAWN_TIME = 130;

        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn)) {
            return;
        }

        this.move().initOob();

        this.m_respawnTimer = RESPAWN_TIME;
        status.setBit(eStatus.BeforeRespawn);
    }

    /**
     * @addr{0x805B6F4C}
     * Checks wheel hitbox collision and stores position/velocity info.
     * @param colVel The wheel's velocity. In the base game, it is always (0, -13, 0).
     */
    calcWheelCollision(
        _wheelIdx: number,
        hitboxGroup: CollisionGroup,
        colVel: Readonly<Vector3f>,
        center: Readonly<Vector3f>,
        radius: number,
    ): void {
        const firstHitbox = hitboxGroup.hitbox(0);
        const bspHitbox = firstHitbox.bspHitbox();
        bspHitbox.radius = radius;
        hitboxGroup.resetCollision();
        firstHitbox.setWorldPos(center);

        const colInfo = new CollisionInfo();
        colInfo.bbox.setZero();
        const kclOut = box(0);
        const noBounceWallInfo = new NoBounceWallColInfo();
        CourseColMgr.Instance()!.setNoBounceWallInfo(noBounceWallInfo);

        const collided = CollisionDirector.Instance()!.checkSphereCachedFullPush(
            firstHitbox.radius(),
            firstHitbox.worldPos(),
            firstHitbox.lastPos(),
            KCL_TYPE_VEHICLE_COLLIDEABLE,
            colInfo,
            kclOut,
            0,
        );

        const collisionData = hitboxGroup.collisionData();

        if (!collided) {
            collisionData.speedFactor = 1.0;
            collisionData.rotFactor = 1.0;
            return;
        }

        collisionData.tangentOff.copy(colInfo.tangentOff);

        if (noBounceWallInfo.dist > F32_MIN) {
            collisionData.tangentOff.addEq(noBounceWallInfo.tangentOff);
            collisionData.noBounceWallNrm.copy(noBounceWallInfo.fnrm);
            collisionData.bSoftWall = true;
        }

        if ((kclOut.value & KCL_TYPE_FLOOR) !== 0) {
            collisionData.bFloor = true;
            collisionData.floorNrm.copy(colInfo.floorNrm);
        }

        collisionData.relPos.copy(firstHitbox.worldPos().sub(this.pos()));
        collisionData.vel.copy(colVel);

        if (colInfo.movingFloorDist > -F32_MIN) {
            collisionData.bHasRoadVel = true;
            collisionData.roadVelocity.copy(colInfo.roadVelocity);
        }

        this.processWheel(collisionData, firstHitbox, colInfo, kclOut);

        if ((kclOut.value & KCL_TYPE_VEHICLE_COLLIDEABLE) === 0) {
            return;
        }

        CollisionDirector.Instance()!.findClosestCollisionEntry(kclOut, KCL_TYPE_VEHICLE_COLLIDEABLE);
    }

    /** @addr{0x8056F26C} */
    calcSideCollision(collisionData: CollisionData, hitbox: Hitbox, colInfo: CollisionInfo): void {
        if (colInfo.perpendicularity <= 0.0) {
            return;
        }

        this.m_colPerpendicularity = fmax(this.m_colPerpendicularity, colInfo.perpendicularity);

        if (collisionData.bWallAtLeftCloser || collisionData.bWallAtRightCloser) {
            return;
        }

        const bspPosX = hitbox.bspHitbox().position.x;
        if (Math.abs(bspPosX) > 10.0) {
            if (bspPosX > 0.0) {
                collisionData.bWallAtLeftCloser = true;
            } else {
                collisionData.bWallAtRightCloser = true;
            }

            collisionData.colPerpendicularity = colInfo.perpendicularity;

            return;
        }

        const right = this.dynamics().mainRot().rotateVector(Vector3f.ex);
        const tangents = [0.0, 0.0];

        // The loop is just to do left/right wall
        for (let i = 0; i < tangents.length; ++i) {
            const sign = i === 1 ? -1.0 : 1.0;
            const effectiveRadius = fr(sign * hitbox.radius());
            const effectivePos = hitbox.worldPos().add(right.mul(effectiveRadius));
            const tempColInfo = new CollisionInfoPartial();

            if (
                CollisionDirector.Instance()!.checkSphereCachedPartial(
                    hitbox.radius(),
                    effectivePos,
                    hitbox.lastPos(),
                    KCL_TYPE_DRIVER_WALL,
                    tempColInfo,
                    null,
                    0,
                )
            ) {
                tangents[i] = colInfo.tangentOff.squaredLength();
            }
        }

        if (tangents[0]! > tangents[1]!) {
            collisionData.bWallAtLeftCloser = true;
            collisionData.colPerpendicularity = colInfo.perpendicularity;
        } else if (tangents[1]! > tangents[0]!) {
            collisionData.bWallAtRightCloser = true;
            collisionData.colPerpendicularity = colInfo.perpendicularity;
        }
    }

    /** @addr{0x8056E70C} */
    calcBoundingRadius(): void {
        this.m_boundingRadius = fr(this.collisionGroup().boundingRadius() * this.move().hitboxScale());
    }

    /** @addr{0x80571F10} */
    calcObjectCollision(): void {
        const COS_PI_OVER_4 = fr(0.707);
        const DUMMY_POLE_ANG_VEL_TIME = 3;
        const DUMMY_POLE_ANG_VEL = fr(0.005);
        const SHRINK_TIME = 60;

        this.m_totalReactionWallNrm.copy(Vector3f.zero);
        this.m_surfaceFlags.resetBit(eSurfaceFlags.ObjectWall, eSurfaceFlags.ObjectWall3);

        const objColKart = this.objectCollisionKart();
        const collisionCount = objColKart.checkCollision(this.pose(), this.velocity());

        const objectDirector = ObjectDirector.Instance()!;

        for (let i = 0; i < collisionCount; ++i) {
            const reaction = objectDirector.reaction(i);
            if (reaction !== Reaction.None && reaction !== Reaction.UNK_7) {
                const handlerIdx = reaction as number;
                const newAction = s_objectCollisionHandlers[handlerIdx]!(this, i);

                if (reaction === Reaction.SpinShrink && this.m_shrinkTimer === 0) {
                    this.m_shrinkTimer = SHRINK_TIME;
                    this.move().activateShrink();
                    this.move().applyForce(30.0, ObjectCollisionKart.GetHitDirection(i), false);
                } else if (reaction !== Reaction.SmallBump && reaction !== Reaction.BigBump) {
                    const hitDepth = objectDirector.hitDepth(i);
                    this.m_tangentOff.addEq(hitDepth);
                    this.m_movement.addEq(hitDepth);

                    if (newAction !== Action.None) {
                        this.action().setHitDepth(objectDirector.hitDepth(i));
                        this.action().start(newAction);
                    }
                }
            }

            if (objectDirector.collidingObject(i)!.id() === ObjectId.DummyPole) {
                const hitDirection = ObjectCollisionKart.GetHitDirection(i);
                const lastDir = this.move().lastDir();

                if (lastDir.dot(hitDirection) < -COS_PI_OVER_4) {
                    const angVel = hitDirection.cross(lastDir);
                    const sign = angVel.y > 0.0 ? -1.0 : 1.0;

                    this.m_poleAngVelTimer = DUMMY_POLE_ANG_VEL_TIME;
                    this.m_poleYaw = fr(DUMMY_POLE_ANG_VEL * sign);
                }
            }
        }

        this.calcPoleTimer();
    }

    /** @addr{Inlined in 0x80571F10} */
    calcPoleTimer(): void {
        if (this.m_poleAngVelTimer > 0 && this.status().onBit(eStatus.Accelerate, eStatus.Brake)) {
            const angVel2 = this.dynamics().angVel2().clone();
            angVel2.y = fr(angVel2.y + this.m_poleYaw);
            this.dynamics().setAngVel2(angVel2);
        }

        this.m_poleAngVelTimer = s16(Math.max(0, this.m_poleAngVelTimer - 1));
    }

    /**
     * @addr{0x8056E8D4}
     * Processes moving water and floor collision effects.
     */
    processWheel(
        collisionData: CollisionData,
        hitbox: Hitbox,
        colInfo: CollisionInfo | null,
        maskOut: Box<number>,
    ): void {
        this.processMovingWater(collisionData, maskOut);
        this.processFloor(collisionData, hitbox, colInfo, maskOut, true);
    }

    /** @addr{0x8056E764} */
    processBody(
        collisionData: CollisionData,
        hitbox: Hitbox,
        colInfo: CollisionInfo,
        maskOut: Box<number>,
    ): void {
        this.processMovingWater(collisionData, maskOut);

        const hasWallCollision = this.processWall(collisionData, maskOut);

        this.processFloor(collisionData, hitbox, colInfo, maskOut, false);

        if (hasWallCollision) {
            this.calcSideCollision(collisionData, hitbox, colInfo);
        }

        this.processCannon(maskOut);
    }

    /** @addr{0x8056E930} */
    processMovingWater(collisionData: CollisionData, maskOut: Box<number>): void {
        if ((maskOut.value & KCL_TYPE_BIT(COL_TYPE_MOVING_WATER)) === 0) {
            return;
        }

        const colDir = CollisionDirector.Instance()!;
        if (!colDir.findClosestCollisionEntry(maskOut, KCL_TYPE_BIT(COL_TYPE_MOVING_WATER))) {
            return;
        }

        this.state().status().setBit(eStatus.StickyRoad);

        const entry = colDir.closestCollisionEntry()!;
        switch (entry.variant()) {
            case 1:
                collisionData.bMovingWaterMomentum = true;
                collisionData.bMovingWaterStickyRoad = true;
                collisionData.bMovingWaterDisableAccel = true;
                break;
            case 2:
                collisionData.bMovingWaterDecaySpeed = true;
                break;
            case 3:
                collisionData.bMovingWaterDecaySpeed = true;
                collisionData.bMovingWaterDisableAccel = true;
                collisionData.bMovingWaterVertical = true;
                break;
            default:
                collisionData.bMovingWaterMomentum = true;
                break;
        }
    }

    /** @addr{0x8056F184} */
    processWall(collisionData: CollisionData, maskOut: Box<number>): boolean {
        if ((maskOut.value & KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL2) === 0) {
            return false;
        }

        const colDirector = CollisionDirector.Instance()!;
        if (
            !colDirector.findClosestCollisionEntry(maskOut, KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL2)
        ) {
            return false;
        }

        if (
            (maskOut.value & KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL) !== 0 &&
            colDirector.findClosestCollisionEntry(maskOut, KCL_TYPE_DRIVER_WALL_NO_INVISIBLE_WALL)
        ) {
            const entry = colDirector.closestCollisionEntry()!;

            collisionData.closestWallFlags = entry.baseType();
            collisionData.closestWallSettings = entry.variant();

            if (entry.attribute.onBit(CollisionDirector.eCollisionAttribute.Soft)) {
                collisionData.bSoftWall = true;
            }
        }

        return true;
    }

    /**
     * @addr{0x8056EA04}
     * Processes the floor triangles' attributes.
     * @param wheel Differentiates between body and wheel floor collision (boost panels)
     */
    processFloor(
        collisionData: CollisionData,
        hitbox: Hitbox,
        _colInfo: CollisionInfo | null,
        maskOut: Box<number>,
        wheel: boolean,
    ): void {
        const BOOST_RAMP_MASK = KCL_TYPE_BIT(COL_TYPE_BOOST_RAMP);

        if (collisionData.bSoftWall) {
            this.m_numSoftWallCollisions = (this.m_numSoftWallCollisions + 1) & 0xffff;
            this.m_sumHitboxBottomHeightSoftWall = fr(
                this.m_sumHitboxBottomHeightSoftWall +
                    fr(hitbox.worldPos().y - hitbox.radius()),
            );
        }

        if ((maskOut.value & KCL_TYPE_FLOOR) === 0) {
            return;
        }

        const colDirector = CollisionDirector.Instance()!;

        if (!colDirector.findClosestCollisionEntry(maskOut, KCL_TYPE_FLOOR)) {
            return;
        }

        let closestColEntry = colDirector.closestCollisionEntry()!;

        if (closestColEntry.attribute.offBit(CollisionDirector.eCollisionAttribute.Trickable)) {
            this.m_surfaceFlags.setBit(eSurfaceFlags.NotTrickable);
        } else {
            collisionData.bTrickable = true;
            this.m_surfaceFlags.setBit(eSurfaceFlags.Trickable);
        }

        collisionData.speedFactor = fmin(
            collisionData.speedFactor,
            this.param().stats().kclSpeed[closestColEntry.baseType()]!,
        );

        collisionData.intensity = closestColEntry.intensity();
        collisionData.rotFactor = fr(
            collisionData.rotFactor + this.param().stats().kclRot[closestColEntry.baseType()]!,
        );

        const status = this.status();

        if (closestColEntry.attribute.onBit(CollisionDirector.eCollisionAttribute.RejectRoad)) {
            status.setBit(eStatus.RejectRoad);
        }

        collisionData.closestFloorFlags = closestColEntry.typeMask;
        collisionData.closestFloorSettings = closestColEntry.variant();

        if (wheel && (maskOut.value & KCL_TYPE_BIT(COL_TYPE_BOOST_PAD)) !== 0) {
            this.move().padType().setBit(KartMove.ePadType.BoostPanel);
        }

        if (
            (maskOut.value & BOOST_RAMP_MASK) !== 0 &&
            colDirector.findClosestCollisionEntry(maskOut, BOOST_RAMP_MASK)
        ) {
            closestColEntry = colDirector.closestCollisionEntry()!;
            this.move().padType().setBit(KartMove.ePadType.BoostRamp);
            this.state().setBoostRampType(closestColEntry.variant());
            this.m_surfaceFlags.setBit(eSurfaceFlags.BoostRamp, eSurfaceFlags.Trickable);
        } else {
            this.state().setBoostRampType(-1);
            this.m_surfaceFlags.setBit(eSurfaceFlags.NotTrickable);
        }

        if (!collisionData.bSoftWall) {
            this.m_numFloorOnlyCollisions = (this.m_numFloorOnlyCollisions + 1) & 0xffff;
            this.m_sumHitboxBottomHeightFloorOnly = fr(
                this.m_sumHitboxBottomHeightFloorOnly +
                    fr(hitbox.worldPos().y - hitbox.radius()),
            );
        }

        if ((maskOut.value & KCL_TYPE_BIT(COL_TYPE_STICKY_ROAD)) !== 0) {
            status.setBit(eStatus.StickyRoad);
        }

        const halfPipeRampMask = KCL_TYPE_BIT(COL_TYPE_HALFPIPE_RAMP);
        if (
            (maskOut.value & halfPipeRampMask) !== 0 &&
            colDirector.findClosestCollisionEntry(maskOut, halfPipeRampMask)
        ) {
            status.setBit(eStatus.HalfPipeRamp);
            this.state().setHalfPipeInvisibilityTimer(2);
            if (colDirector.closestCollisionEntry()!.variant() === 1) {
                this.move().padType().setBit(KartMove.ePadType.BoostPanel);
            }
        }

        const jumpPadMask = KCL_TYPE_BIT(COL_TYPE_JUMP_PAD);
        if (
            (maskOut.value & jumpPadMask) !== 0 &&
            colDirector.findClosestCollisionEntry(maskOut, jumpPadMask)
        ) {
            if (
                status.offAnyBit(eStatus.TouchingGround, eStatus.JumpPad) &&
                status.offBit(eStatus.JumpPadMushroomVelYInc)
            ) {
                this.move().padType().setBit(KartMove.ePadType.JumpPad);
                closestColEntry = colDirector.closestCollisionEntry()!;
                this.state().setJumpPadVariant(closestColEntry.variant());
            }
            collisionData.bTrickable = true;
        }
    }

    /**
     * @addr{0x8056F490}
     * Checks if we are colliding with a cannon trigger and sets the state flag if so.
     */
    processCannon(maskOut: Box<number>): void {
        const colDirector = CollisionDirector.Instance()!;
        if (colDirector.findClosestCollisionEntry(maskOut, KCL_TYPE_BIT(COL_TYPE_CANNON_TRIGGER))) {
            this.state().setCannonPointId(colDirector.closestCollisionEntry()!.variant());
            this.status().setBit(eStatus.CannonStart);
        }
    }

    /**
     * @addr{0x805B7928}
     * Applies external and angular velocity based on the collision with the floor.
     * @param down Always 0.1f
     * @param rate Downward velocity? Related to suspension stiffness
     * @param hitboxGroup Used to retrieve CollisionData reference
     * @param forward Current world facing direction of the kart
     * @param nextDir Updated facing direction of the kart
     * @param speed Tire speed
     */
    applySomeFloorMoment(
        down: number,
        rate: number,
        hitboxGroup: CollisionGroup,
        forward: Readonly<Vector3f>,
        nextDir: Readonly<Vector3f>,
        speed: Readonly<Vector3f>,
        b1: boolean,
        b2: boolean,
        b3: boolean,
    ): void {
        const colData = hitboxGroup.collisionData();
        if (!colData.bFloor) {
            return;
        }

        const velDotFloorNrm = colData.vel.dot(colData.floorNrm);

        if (velDotFloorNrm >= 0.0) {
            return;
        }

        const rotMat = new Matrix34f();
        rotMat.makeQ(this.dynamics().mainRot());
        let tmp = rotMat.multiplyTo(this.dynamics().invInertiaTensor());
        const rotMatTrans = rotMat.transpose();
        tmp = tmp.multiplyTo(rotMatTrans);

        let crossVec = colData.relPos.cross(colData.floorNrm);
        crossVec = tmp.multVector(crossVec);
        crossVec = crossVec.cross(colData.relPos);

        const scalar = fr(-velDotFloorNrm / fr(1.0 + colData.floorNrm.dot(crossVec)));
        const negSpeed = speed.neg();
        crossVec = colData.floorNrm.cross(negSpeed);
        crossVec = crossVec.cross(colData.floorNrm);

        if (F32_EPSILON >= crossVec.squaredLength()) {
            return;
        }

        crossVec.normalise();
        const speedDot = fmin(0.0, speed.dot(crossVec));
        crossVec.mulEq(fr(fr(scalar * speedDot) / velDotFloorNrm));

        const [proj, rej] = crossVec.projAndRej(forward);

        const projNorm = proj.length();
        const rejNorm = rej.length();
        let projNorm_ = projNorm;
        let rejNorm_ = rejNorm;

        const dVar7 = fr(down * Math.abs(scalar));
        if (dVar7 < Math.abs(projNorm)) {
            projNorm_ = dVar7;
            if (projNorm < 0.0) {
                projNorm_ = fr(-down * Math.abs(scalar));
            }
        }

        const dVar5 = fr(rate * Math.abs(scalar));
        if (Math.abs(rejNorm) > dVar5) {
            rejNorm_ = dVar5;
            if (rejNorm < 0.0) {
                rejNorm_ = fr(-rate * Math.abs(scalar));
            }
        }

        proj.normalise();
        rej.normalise();

        proj.mulEq(projNorm_);
        rej.mulEq(rejNorm_);

        let projRejSum = proj.add(rej);
        const projRejSumOrig = projRejSum.clone();

        if (!b1) {
            projRejSum.x = 0.0;
            projRejSum.z = 0.0;
        }
        if (!b2) {
            projRejSum.y = 0.0;
        }

        projRejSum = projRejSum.rej(nextDir);

        this.dynamics().setExtVel(this.dynamics().extVel().add(projRejSum));

        if (b3) {
            const rotation = colData.relPos.cross(projRejSumOrig);
            const rotation2 = this.dynamics().mainRot().rotateVectorInv(tmp.multVector(rotation));

            const angVel = rotation2.clone();
            angVel.y = 0.0;
            if (!b1) {
                angVel.x = 0.0;
            }
            this.dynamics().setAngVel0(this.dynamics().angVel0().add(angVel));
        }
    }

    /**
     * @addr{0x805B6A9C}
     * Called on collision of a new KCL type??? This only happens after airtime so far.
     * @rename
     */
    FUN_805B6A9C(
        collisionData: CollisionData,
        hitbox: Hitbox,
        minMax: BoundBox3f,
        relPos: Vector3f,
        count: Box<number>,
        maskOut: number,
        colInfo: Readonly<CollisionInfo>,
    ): boolean {
        if ((maskOut & KCL_TYPE_WALL) !== 0) {
            if (
                (maskOut & KCL_TYPE_FLOOR) === 0 &&
                this.status().onBit(eStatus.HWG) &&
                this.state().softWallSpeed().dot(colInfo.wallNrm) < fr(0.3)
            ) {
                return true;
            }

            let skipWalls = false;

            collisionData.wallNrm.addEq(colInfo.wallNrm);

            if ((maskOut & KCL_TYPE_ANY_INVISIBLE_WALL) !== 0) {
                collisionData.bInvisibleWall = true;

                if ((maskOut & KCL_TYPE_4010D000) === 0) {
                    collisionData.bInvisibleWallOnly = true;

                    if ((maskOut & KCL_TYPE_BIT(COL_TYPE_HALFPIPE_INVISIBLE_WALL)) !== 0) {
                        skipWalls = true;
                    }
                }
            }

            if (!skipWalls) {
                if ((maskOut & KCL_TYPE_BIT(COL_TYPE_WALL_2)) !== 0) {
                    collisionData.bWall3 = true;
                } else {
                    collisionData.bWall = true;
                }
            }
        }

        if ((maskOut & KCL_TYPE_FLOOR) !== 0) {
            collisionData.floorNrm.addEq(colInfo.floorNrm);
            collisionData.bFloor = true;
        }

        const tangentOff = colInfo.tangentOff.clone();
        minMax.min.copy(minMax.min.minimize(tangentOff));
        minMax.max.copy(minMax.max.maximize(tangentOff));
        tangentOff.normalise();

        relPos.addEq(hitbox.relPos());
        relPos.addEq(tangentOff.mul(-hitbox.radius()));
        count.value = (count.value + 1) | 0;

        return false;
    }

    /**
     * @addr{0x805B6D48}
     * Saves collision info when vehicle body collision occurs.
     */
    applyBodyCollision(
        collisionData: CollisionData,
        movement: Readonly<Vector3f>,
        posRel: Readonly<Vector3f>,
        count: number,
    ): void {
        this.setPos(this.pos().add(movement));

        if (!collisionData.bFloor && (collisionData.bWall || collisionData.bWall3)) {
            collisionData.movement.copy(movement);
        }

        const rotFactor = fr(1.0 / fr(count));
        const scaledRelPos = posRel.mul(rotFactor);
        collisionData.rotFactor = fr(collisionData.rotFactor * rotFactor);

        const scaledAngVel0 = this.dynamics().angVel0().mul(this.dynamics().angVel0Factor());
        const local_48 = this.mainRot().rotateVectorInv(scaledRelPos);
        let local_30 = scaledAngVel0.cross(local_48);
        local_30 = this.mainRot().rotateVector(local_30);
        local_30.addEq(this.extVel());

        collisionData.vel.copy(local_30);
        collisionData.relPos.copy(scaledRelPos);

        if (collisionData.bFloor) {
            const intVelY = this.dynamics().intVel().y;
            if (intVelY > 0.0) {
                collisionData.vel.y = fr(collisionData.vel.y + intVelY);
            }
            collisionData.floorNrm.normalise();
        }
    }

    /** @addr{0x805713D8} */
    startFloorMomentRate(): void {
        this.m_floorMomentRate = fr(0.01);
    }

    /** @addr{0x805713FC} */
    calcFloorMomentRate(): void {
        this.m_floorMomentRate =
            this.status().onBit(eStatus.InAction) &&
            this.action().flags().onBit(KartAction.eFlags.Rotating)
                ? fr(0.01)
                : fmin(fr(this.m_floorMomentRate + fr(0.01)), fr(0.8));
    }

    /** @addr{0x8056E564} */
    handleReactNone(_idx: number): Action {
        return Action.None;
    }

    /** @addr{0x8057363C} */
    handleReactWallAllSpeed(idx: number): Action {
        this.m_totalReactionWallNrm.addEq(ObjectCollisionKart.GetHitDirection(idx));
        this.m_surfaceFlags.setBit(eSurfaceFlags.ObjectWall);

        return Action.None;
    }

    /** @addr{0x805733CC} */
    handleReactSpinAllSpeed(_idx: number): Action {
        return Action.UNK_0;
    }

    /** @addr{0x805733D4} */
    handleReactSpinSomeSpeed(_idx: number): Action {
        return Action.UNK_1;
    }

    /** @addr{0x805735AC} */
    handleReactFireSpin(_idx: number): Action {
        return Action.UNK_9;
    }

    /** @addr{0x805733C4} */
    handleReactSmallLaunch(_idx: number): Action {
        return Action.UNK_2;
    }

    /** @addr{0x805733DC} */
    handleReactKnockbackSomeSpeedLoseItem(_idx: number): Action {
        return Action.UNK_3;
    }

    /** @addr{0x8057353C} */
    handleReactLaunchSpinLoseItem(_idx: number): Action {
        return Action.UNK_6;
    }

    /** @addr{0x805733EC} */
    handleReactKnockbackBumpLoseItem(_idx: number): Action {
        return Action.UNK_4;
    }

    /** @addr{0x805735B4} */
    handleReactLongCrushLoseItem(_idx: number): Action {
        return Action.UNK_12;
    }

    /** @addr{0x805737B8} */
    handleReactSmallBump(idx: number): Action {
        this.move().applyForce(30.0, ObjectCollisionKart.GetHitDirection(idx), false);
        return Action.None;
    }

    /** @addr{0x805735BC} */
    handleReactSpinShrink(_idx: number): Action {
        return this.m_shrinkTimer <= 0 ? Action.UNK_15 : Action.None;
    }

    /** @addr{0x805733E4} */
    handleReactHighLaunchLoseItem(_idx: number): Action {
        return Action.UNK_8;
    }

    /** @addr{0x80573754} */
    handleReactWeakWall(_idx: number): Action {
        this.move().setSpeed(fr(this.move().speed() * fr(0.82)));
        return Action.None;
    }

    /** @addr{0x80573790} */
    handleReactOffroad(_idx: number): Action {
        this.status().setBit(eStatus.CollidingOffroad);
        this.m_surfaceFlags.setBit(eSurfaceFlags.Offroad);
        return Action.None;
    }

    /** @addr{0x805733F4} */
    handleReactLaunchSpin(idx: number): Action {
        this.action().setTranslation(ObjectCollisionKart.translation(idx));
        return Action.UNK_5;
    }

    /** @addr{0x805736C8} */
    handleReactWallSpark(idx: number): Action {
        this.m_totalReactionWallNrm.addEq(ObjectCollisionKart.GetHitDirection(idx));
        this.m_surfaceFlags.setBit(eSurfaceFlags.ObjectWall3);

        return Action.None;
    }

    /** @addr{0x80573A2C} */
    handleReactRubberWall(idx: number): Action {
        const BASE_DIR_FORCE_SCALAR = fr(0.95);
        const DIR_FORCE_SCALAR = fr(0.050000012);
        const MAX_FORCE = 70.0;

        const hitDir = ObjectCollisionKart.GetHitDirection(idx);
        const zAxis = this.componentZAxis();

        const force = fr(
            BASE_DIR_FORCE_SCALAR + fr(DIR_FORCE_SCALAR * Math.abs(hitDir.dot(zAxis))),
        );
        this.move().applyForce(fr(MAX_FORCE * force), hitDir, true);

        return Action.None;
    }

    /** @addr{0x805735EC} */
    handleReactUntrickableJumpPad(_idx: number): Action {
        this.move().setPadType(TBitFlag.fromBits(KartMove.ePadType.JumpPad));
        this.state().setJumpPadVariant(0);

        return Action.None;
    }

    /** @addr{0x805735D4} */
    handleReactShortCrushLoseItem(_idx: number): Action {
        return Action.UNK_14;
    }

    /** @addr{0x805735DC} */
    handleReactCrushRespawn(_idx: number): Action {
        return Action.UNK_16;
    }

    /** @addr{0x805735E4} */
    handleReactExplosionLoseItem(_idx: number): Action {
        return Action.UNK_7;
    }

    setFloorColInfo(
        collisionData: CollisionData,
        relPos: Readonly<Vector3f>,
        vel: Readonly<Vector3f>,
        floorNrm: Readonly<Vector3f>,
    ): void {
        collisionData.relPos.copy(relPos);
        collisionData.vel.copy(vel);
        collisionData.floorNrm.copy(floorNrm);
        collisionData.bFloor = true;
    }

    setTangentOff(v: Readonly<Vector3f>): void {
        this.m_tangentOff.copy(v);
    }

    setMovement(v: Readonly<Vector3f>): void {
        this.m_movement.copy(v);
    }

    pullPath(): KartPullPath {
        return this.m_pullPath;
    }

    boundingRadius(): number {
        return this.m_boundingRadius;
    }

    floorMomentRate(): number {
        return this.m_floorMomentRate;
    }

    surfaceFlags(): Readonly<SurfaceFlags> {
        return this.m_surfaceFlags;
    }

    tangentOff(): Readonly<Vector3f> {
        return this.m_tangentOff;
    }

    movement(): Readonly<Vector3f> {
        return this.m_movement;
    }

    sumHitboxBottomHeightSoftWall(): number {
        return this.m_sumHitboxBottomHeightSoftWall;
    }

    numSoftWallCollisions(): number {
        return this.m_numSoftWallCollisions;
    }

    sumHitboxBottomHeightFloorOnly(): number {
        return this.m_sumHitboxBottomHeightFloorOnly;
    }

    numFloorOnlyCollisions(): number {
        return this.m_numFloorOnlyCollisions;
    }

    colPerpendicularity(): number {
        return this.m_colPerpendicularity;
    }
}

const s_objectCollisionHandlers: readonly ObjectCollisionHandler[] = [
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactWallAllSpeed(i),
    (c, i) => c.handleReactSpinAllSpeed(i),
    (c, i) => c.handleReactSpinSomeSpeed(i),
    (c, i) => c.handleReactFireSpin(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactSmallLaunch(i),
    (c, i) => c.handleReactKnockbackSomeSpeedLoseItem(i),
    (c, i) => c.handleReactLaunchSpinLoseItem(i),
    (c, i) => c.handleReactKnockbackBumpLoseItem(i),
    (c, i) => c.handleReactLongCrushLoseItem(i),
    (c, i) => c.handleReactSmallBump(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactSpinShrink(i),
    (c, i) => c.handleReactHighLaunchLoseItem(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactWeakWall(i),
    (c, i) => c.handleReactOffroad(i),
    (c, i) => c.handleReactLaunchSpin(i),
    (c, i) => c.handleReactWallSpark(i),
    (c, i) => c.handleReactRubberWall(i),
    (c, i) => c.handleReactNone(i),
    (c, i) => c.handleReactUntrickableJumpPad(i),
    (c, i) => c.handleReactShortCrushLoseItem(i),
    (c, i) => c.handleReactCrushRespawn(i),
    (c, i) => c.handleReactExplosionLoseItem(i),
];
