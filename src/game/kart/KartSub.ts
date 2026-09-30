/**
 * Port of Kinoko's game/kart/KartSub.{hh,cc}.
 * Hosts a few classes and the high level per-frame calc functions.
 */

import { Course } from '../../Common';
import { fmax, fmin, fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';

import { BoxColFlag, BoxColManager, eBoxColFlag } from '../field/BoxColManager';
import { CollisionDirector } from '../field/CollisionDirector';
import { KCL_TYPE_VEHICLE_INTERACTABLE } from '../field/KCollisionTypes';
import { RaceConfig } from '../system/RaceConfig';
import { RaceManager } from '../system/RaceManager';

import type { CollisionData } from './CollisionGroup';
import { KartAction } from './KartAction';
import { KartCollide } from './KartCollide';
import { KartMove, KartMoveBike } from './KartMove';
import type { KartObject } from './KartObject';
import { type KartAccessor, KartObjectProxy } from './KartObjectProxy';
import type { KartParam } from './KartParam';
import { KartState } from './KartState';
import { eStatus } from './Status';

const SIDE_COLLISION_TIME = 5;
const DECAY_FLOOR_SCALAR = fr(0.7);
const DECAY_AIR_SCALAR = 0.5;
const DECAY_KC_AIR_SCALAR = fr(0.3);

const F_1_3 = fr(1.3);
const F_0_9 = fr(0.9);
const F_0_8 = fr(0.8);
const F_0_7 = fr(0.7);
const F_0_2 = fr(0.2);

export class KartSub extends KartObjectProxy {
    private m_move: KartMove = null!;
    private m_action: KartAction = null!;
    private m_collide: KartCollide = null!;
    private m_state: KartState = null!;
    private readonly m_maxSuspOvertravel = new Vector3f();
    private readonly m_minSuspOvertravel = new Vector3f();
    private m_floorCollisionCount = 0; // u16
    private m_movingObjCollisionCount = 0; // u16
    private m_movingWaterCollisionCount = 0; // u16
    private readonly m_objVel = new Vector3f();
    /** Number of frames to apply movement from wall collision (s16). */
    private m_sideCollisionTimer = 0;
    /** Dot product between floor and colliding wall normals. */
    private m_colPerpendicularity = 0.0;
    private m_someScale = 0.0;

    /** Delta time. */
    static readonly DT = 1.0;

    constructor() {
        super();
    }

    /** @addr{0x80595D48} */
    createSubsystems(isBike: boolean, stats: KartParam.Stats): void {
        this.m_move = isBike ? new KartMoveBike() : new KartMove();
        this.m_action = new KartAction();
        this.m_move.createSubsystems(stats);
        this.m_state = new KartState();
        this.m_collide = new KartCollide();
    }

    /**
     * @addr{0x80596454}
     * Called during static construction of KartObject to synchronize the pointers.
     */
    copyPointers(pointers: KartAccessor): void {
        pointers.collide = this.m_collide;
        pointers.state = this.m_state;
        pointers.move = this.m_move;
        pointers.action = this.m_action;
    }

    /** @addr{0x80595F78} */
    init(): void {
        this.resetPhysics();
        this.body().reset();
        this.m_state.init();
        this.move().setTurnParams();
        this.action().init();
        this.m_collide.init();
    }

    /** @addr{0x8059828C} */
    initAABB(accessor: KartAccessor, object: KartObject): void {
        const radius = fr(25.0 + this.collide().boundingRadius());
        const hardSpeedLimit = this.move().hardSpeedLimit();

        // NOTE: C++ passes &pos(), i.e. a pointer to KartDynamics::m_pos (a stable object here).
        accessor.boxColUnit = BoxColManager.Instance()!.insertDriver(
            radius,
            hardSpeedLimit,
            this.pos(),
            true,
            object,
        )!;
    }

    /** @addr{0x80597934} */
    initPhysicsValues(): void {
        this.physics().updatePose();
        this.collide().resetHitboxes();
    }

    /** @addr{0x8059617C} */
    resetPhysics(): void {
        this.physics().reset();
        this.physics().updatePose();
        this.collide().resetHitboxes();

        for (let wheelIdx = 0; wheelIdx < this.suspCount(); ++wheelIdx) {
            this.suspensionPhysics(wheelIdx).reset();
        }
        for (let tireIdx = 0; tireIdx < this.tireCount(); ++tireIdx) {
            this.tirePhysics(tireIdx).reset();
        }
        this.m_move.setKartSpeedLimit();

        this.resizeAABB(1.0);

        this.m_sideCollisionTimer = 0;
        this.m_someScale = 1.0;
        this.m_maxSuspOvertravel.setZero();
        this.m_minSuspOvertravel.setZero();
    }

    /**
     * @addr{0x80596480}
     * The first phase of physics computations on each frame. Handles input processing,
     * subsequent position/speed updates, as well as responding to last frame's collisions.
     */
    calcPass0(): void {
        const status = this.status();

        if (status.onBit(eStatus.CannonStart)) {
            this.physics().hitboxGroup().reset();
            for (let i = 0; i < this.tireCount(); ++i) {
                this.tirePhysics(i).hitboxGroup().reset();
            }
            this.move().enterCannon();
        }

        this.state().calc();

        if (status.onBit(eStatus.TriggerRespawn)) {
            this.setInertiaScale(new Vector3f(1.0, 1.0, 1.0));
            this.resetPhysics();
            this.state().reset();
            this.move().setTurnParams();
            this.move().calcRespawnStart();
        }

        this.physics().setPos(this.dynamics().pos());
        this.physics().setVelocity(this.dynamics().velocity());
        this.dynamics().setGravity(-F_1_3);
        this.dynamics().setAngVel0YFactor(F_0_9);

        this.state().calcInput();
        this.move().calc();
        this.action().calc();
        this.collide().pullPath().calc();

        if (status.onBit(eStatus.SkipWheelCalc)) {
            for (let tireIdx = 0; tireIdx < this.tireCount(); ++tireIdx) {
                this.tirePhysics(tireIdx).setLastPos(this.pos());
            }
            return;
        }

        this.tryEndHWG();

        this.dynamics().setTop(this.move().up());

        // Pertains to startslides / leaning in stage 0 and 1
        const raceManager = RaceManager.Instance();
        if (!raceManager.isStageReached(RaceManager.Stage.Race)) {
            this.dynamics().setIntVel(Vector3f.zero);

            let killExtVel = this.dynamics().extVel().clone();
            if (this.isBike()) {
                killExtVel = killExtVel.rej(this.move().smoothedUp());
            } else {
                killExtVel.x = 0.0;
                killExtVel.z = 0.0;
            }

            this.dynamics().setExtVel(killExtVel);
        }

        const maxSpeed = this.move().hardSpeedLimit();
        this.physics().calc(
            KartSub.DT,
            maxSpeed,
            this.scale(),
            status.offBit(eStatus.TouchingGround),
        );

        this.move().calcRejectRoad();

        if (status.offBit(eStatus.InCannon)) {
            this.collide().calcHitboxes();
            this.collisionGroup().setHitboxScale(this.move().totalScale());
        }
    }

    /**
     * @addr{0x80596CFC}
     * The second phase of physics computations on each frame. This mainly includes collision
     * detection, as well as suspension physics.
     */
    calcPass1(): void {
        this.state().resetEjection();

        this.m_movingWaterCollisionCount = 0;
        this.m_movingObjCollisionCount = 0;
        this.m_floorCollisionCount = 0;
        this.m_objVel.setZero();
        this.m_maxSuspOvertravel.setZero();
        this.m_minSuspOvertravel.setZero();

        // The flag is really 0x1f, but we only care about objects.
        const flags = new BoxColFlag();
        flags.setBit(eBoxColFlag.Drivable, eBoxColFlag.Object);
        this.boxColUnit().search(flags);

        this.collide().calcObjectCollision();
        this.dynamics().setPos(this.pos().add(this.collide().tangentOff()));

        const status = this.status();

        if (status.onBit(eStatus.SoftWallPush)) {
            const softWallSpeed = this.state().softWallSpeed();
            let speedFactor = 5.0;
            let effectiveSpeed: Vector3f;

            if (status.onBit(eStatus.HWG)) {
                speedFactor = 10.0;
                effectiveSpeed = softWallSpeed.clone();
            } else {
                effectiveSpeed = softWallSpeed.perpInPlane(this.move().smoothedUp(), true);
                const speedDotUp = softWallSpeed.dot(this.move().smoothedUp());
                if (speedDotUp < 0.0) {
                    speedFactor = fr(speedFactor + fr(-speedDotUp * 10.0));
                }
            }

            effectiveSpeed.mulEq(fr(speedFactor * this.scale().y));
            this.setPos(this.pos().add(effectiveSpeed));
            this.collide().setMovement(this.collide().movement().add(effectiveSpeed));
        }

        const colData = this.collisionData();
        if (
            colData.bWallAtLeftCloser ||
            colData.bWallAtRightCloser ||
            this.m_sideCollisionTimer > 0
        ) {
            const right = this.dynamics().mainRot().rotateVector(Vector3f.ex);

            if (colData.bWallAtLeftCloser || colData.bWallAtRightCloser) {
                const sign = colData.bWallAtRightCloser ? 1.0 : -1.0;
                this.m_colPerpendicularity = fr(sign * colData.colPerpendicularity);
                this.m_sideCollisionTimer = SIDE_COLLISION_TIME;
            }

            const colPerpBounceDir = right.mul(
                fr(fr(2.0 * this.m_colPerpendicularity) * this.scale().x),
            );
            colPerpBounceDir.y = 0.0;
            this.setPos(this.pos().add(colPerpBounceDir));
            this.collide().setMovement(this.collide().movement().add(colPerpBounceDir));
        }

        this.m_sideCollisionTimer = Math.max(this.m_sideCollisionTimer - 1, 0);

        this.body().calcSinkDepth();

        CollisionDirector.Instance()!.checkCourseColNarrScLocal(
            250.0,
            this.pos(),
            KCL_TYPE_VEHICLE_INTERACTABLE,
            0,
        );

        if (status.offBit(eStatus.InCannon)) {
            if (status.offBit(eStatus.ZipperStick)) {
                this.collide().findCollision();
                this.body().calcTargetSinkDepth();

                if (colData.bWall || colData.bWall3) {
                    this.collide().setMovement(this.collide().movement().add(colData.movement));
                }
            } else {
                colData.reset();
            }

            this.collide().calcFloorEffect();
            this.collide().calcFloorMomentRate();

            if (colData.bFloor) {
                // Update floor count
                this.addFloor(colData, false);
            }
        }

        const forward = this.fullRot().rotateVector(Vector3f.ez);
        this.m_someScale = fmax(this.scale().y, this.param().stats().shrinkScale);

        const gravity = new Vector3f(0.0, -F_1_3, 0.0);
        let speedFactor = 1.0;
        let handlingFactor = 0.0;
        for (let i = 0; i < this.suspCount(); ++i) {
            const wheelMatrix = this.body().wheelMatrix(i);
            this.suspensionPhysics(i).calcCollision(KartSub.DT, gravity, wheelMatrix);

            const colData = this.tirePhysics(i).hitboxGroup().collisionData();

            speedFactor = fmin(speedFactor, colData.speedFactor);

            if (colData.bFloor) {
                handlingFactor = fr(handlingFactor + colData.rotFactor);
                this.addFloor(colData, false);
            }
        }

        if (status.offBit(eStatus.SkipWheelCalc)) {
            const vehicleCompensation = this.m_maxSuspOvertravel.add(this.m_minSuspOvertravel);
            this.dynamics().setPos(this.dynamics().pos().add(vehicleCompensation));

            if (!this.collisionData().bFloor) {
                const relPos = Vector3f.zero.clone();
                const vel = Vector3f.zero.clone();
                const floorNrm = Vector3f.zero.clone();
                let count = 0;

                for (let wheelIdx = 0; wheelIdx < this.tireCount(); ++wheelIdx) {
                    const wheelPhysics = this.tirePhysics(wheelIdx);
                    if (wheelPhysics._74() === 0.0) {
                        continue;
                    }

                    const colData = wheelPhysics.hitboxGroup().collisionData();
                    relPos.addEq(colData.relPos);
                    vel.addEq(colData.vel);
                    floorNrm.addEq(colData.floorNrm);
                    ++count;
                }

                if (count > 0) {
                    const scalar = fr(1.0 / fr(count));
                    floorNrm.normalise();

                    this.collide().setFloorColInfo(
                        this.collisionData(),
                        relPos.mul(scalar),
                        vel.mul(scalar),
                        floorNrm,
                    );

                    this.collide().FUN_80572F4C();
                }
            }

            for (let wheelIdx = 0; wheelIdx < this.suspCount(); ++wheelIdx) {
                this.suspensionPhysics(wheelIdx).calcSuspension(forward, vehicleCompensation);
            }

            this.move().calcHopPhysics();
        }

        if (status.onBit(eStatus.CollidingOffroad)) {
            const stats = this.param().stats();
            speedFactor = stats.kclSpeed[3]!;
            handlingFactor = stats.kclRot[3]!;
        }

        this.move().setKCLWheelSpeedFactor(speedFactor);
        this.move().setKCLWheelRotFactor(handlingFactor);

        this.move().setFloorCollisionCount(this.m_floorCollisionCount);

        this.calcMovingObj();
        this.calcMovingWater();

        this.physics().updatePose();

        this.collide().resetHitboxes();

        // calcRotation() is only ever used for gfx rendering, so skip
    }

    /** @addr{0x80598338} */
    resizeAABB(radiusScale: number): void {
        const radius = fr(radiusScale * this.collisionGroup().boundingRadius());
        this.boxColUnit().resize(fr(radius + 25.0), this.move().hardSpeedLimit());
    }

    /** @addr{0x805980D8} */
    addFloor(colData: CollisionData, _unused: boolean): void {
        this.m_floorCollisionCount = (this.m_floorCollisionCount + 1) & 0xffff;

        if (colData.bHasRoadVel) {
            this.m_movingObjCollisionCount = (this.m_movingObjCollisionCount + 1) & 0xffff;
            this.m_objVel.addEq(colData.roadVelocity);
        }

        const status = this.status();
        if (colData.bMovingWaterMomentum || colData.bMovingWaterDecaySpeed) {
            this.m_movingWaterCollisionCount = (this.m_movingWaterCollisionCount + 1) & 0xffff;

            status.changeBit(colData.bMovingWaterDecaySpeed, eStatus.MovingWaterDecaySpeed);
            status.changeBit(colData.bMovingWaterDisableAccel, eStatus.DisableAcceleration);
            status.changeBit(colData.bMovingWaterVertical, eStatus.MovingWaterVertical);
        } else {
            status.resetBit(
                eStatus.MovingWaterDecaySpeed,
                eStatus.DisableAcceleration,
                eStatus.MovingWaterVertical,
            );
        }

        status.changeBit(colData.bMovingWaterStickyRoad, eStatus.MovingWaterStickyRoad);
    }

    /** @addr{0x805979EC} */
    updateSuspOvertravel(suspOvertravel: Readonly<Vector3f>): void {
        this.m_maxSuspOvertravel.copy(this.m_maxSuspOvertravel.minimize(suspOvertravel));
        this.m_minSuspOvertravel.copy(this.m_minSuspOvertravel.maximize(suspOvertravel));
    }

    /** @addr{0x80598744} */
    tryEndHWG(): void {
        const status = this.status();

        if (status.onBit(eStatus.SoftWallUnlockRotation)) {
            if (
                Math.abs(this.move().speed()) > 15.0 ||
                status.onBit(eStatus.AirtimeOver20, eStatus.AllWheelsCollision)
            ) {
                status.resetBit(eStatus.SoftWallUnlockRotation);
            } else if (status.onBit(eStatus.TouchingGround)) {
                if (Math.abs(this.componentXAxis().dot(Vector3f.ey)) > F_0_8) {
                    status.resetBit(eStatus.SoftWallUnlockRotation);
                }
            }
        }

        if (status.onBit(eStatus.HWG) && status.offBit(eStatus.SoftWallPush)) {
            if (
                status.offBit(eStatus.WallCollision, eStatus.Wall3Collision) ||
                status.onBit(eStatus.AllWheelsCollision)
            ) {
                status.resetBit(eStatus.HWG);
            }
        }

        if (status.offBit(eStatus.InAction)) {
            this.dynamics().setForceUpright(status.offBit(eStatus.SoftWallUnlockRotation));
        }
    }

    /** @addr{0x80597A88} */
    calcMovingObj(): void {
        if (this.m_movingObjCollisionCount === 0) {
            const scalar = this.state().airtime() < 20 ? 1.0 : F_0_9;
            this.physics().composeDecayingMovingObjVel(
                F_0_7,
                scalar,
                this.m_floorCollisionCount !== 0,
            );
        } else {
            this.m_objVel.mulEq(fr(1.0 / fr(this.m_floorCollisionCount)));
            this.physics().composeMovingObjVel(this.m_objVel, F_0_2);
        }
    }

    /** @addr{0x80597D4C} */
    calcMovingWater(): void {
        const status = this.status();
        const pullPath = this.collide().pullPath();

        if (this.m_movingWaterCollisionCount > 0) {
            const ratio = fr(
                fr(this.m_movingWaterCollisionCount) / fr(this.m_floorCollisionCount),
            );
            const dir = pullPath.pullDirection().perpInPlane(this.move().smoothedUp(), true);

            if (status.offBit(eStatus.MovingWaterDecaySpeed)) {
                const vel = dir.mul(pullPath.pullSpeed()).mul(ratio);
                this.physics().composeMovingRoadVel(vel, F_0_2);
            } else {
                const vel = dir.mul(pullPath.pullSpeed());
                this.physics().shiftDecayMovingRoadVel(vel, pullPath.maxPullSpeed());
            }
        } else {
            let airScalar = status.onBit(eStatus.MovingWaterStickyRoad) ? DECAY_AIR_SCALAR : 1.0;
            if (
                RaceConfig.Instance().raceScenario().course === Course.Koopa_Cape &&
                status.onBit(eStatus.MovingWaterDecaySpeed)
            ) {
                airScalar = DECAY_KC_AIR_SCALAR;
            }

            this.physics().decayMovingRoadVel(
                DECAY_FLOOR_SCALAR,
                airScalar,
                this.m_floorCollisionCount > 0,
            );
        }

        if (status.onBit(eStatus.MovingWaterStickyRoad)) {
            const dir = pullPath.pullDirection().perpInPlane(this.move().smoothedUp(), true);
            dir.y = fr(dir.y * 50.0);
            const vel = this.dynamics().movingRoadVel();
            this.dynamics().setMovingRoadVel(new Vector3f(vel.x, dir.y, vel.z));
        }
    }

    someScale(): number {
        return this.m_someScale;
    }
}
