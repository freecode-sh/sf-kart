/** Port of Kinoko's game/kart/KartState.{hh,cc}. */

import { fmax, fmin, fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import { COL_TYPE_SPECIAL_WALL } from '../field/KCollisionTypes';
import { RaceManager } from '../system/RaceManager';
import { Action } from './KartAction';
import { eSurfaceFlags } from './KartCollide';
import { KartObjectProxy } from './KartObjectProxy';
import { createStatus, eStatus, type Status } from './Status';

interface StartBoostEntry {
    range: number;
    frames: number; ///< s16
}

/**
 * @addr{0x808B64F8}
 * @memberof KartState
 */
const START_BOOST_ENTRIES: readonly StartBoostEntry[] = [
    { range: fr(0.85), frames: 0 },
    { range: fr(0.88), frames: 10 },
    { range: fr(0.905), frames: 20 },
    { range: fr(0.925), frames: 30 },
    { range: fr(0.94), frames: 45 },
    { range: fr(0.95), frames: 70 },
];

/** Stand-in for std::numeric_limits<size_t>::max(). Only compared for equality / `<= 0`. */
const SIZE_T_MAX = Number.MAX_SAFE_INTEGER;

function s16(x: number): number {
    return (x << 16) >> 16;
}

/**
 * Houses various flags and other variables to preserve the kart's state.
 * Most notably, this class is the direct observer of the input state, and sets the appropriate
 * flags for KartMove to act upon the input state. This class also is responsible for managing
 * calculations of the start boost duration.
 */
export class KartState extends KartObjectProxy {
    private m_status: Status = createStatus();
    private m_airtime = 0; ///< u32
    private m_top = new Vector3f();
    private m_softWallSpeed = new Vector3f();
    private m_hwgTimer = 0; ///< s32
    private m_cannonPointId = 0; ///< u16
    private m_boostRampType = 0; ///< s32
    private m_jumpPadVariant = 0; ///< s32
    private m_halfPipeInvisibilityTimer = 0; ///< s16
    private m_stickX = 0.0; ///< One of 15 discrete stick values from [-1.0, 1.0].
    private m_stickY = 0.0; ///< One of 15 discrete stick values from [-1.0, 1.0].
    private m_startBoostCharge = 0.0; ///< 0-1 representation of start boost charge.
    private m_startBoostIdx = 0; ///< size_t. Maps m_startBoostCharge to a start boost duration.
    private m_wallBonkTimer = 0; ///< s16. 2f counter that stunts your speed after hitting a wall.
    private m_trickableTimer = 0; ///< s16

    /** @addr{0x805943B4} */
    constructor() {
        super();
        this.m_status.makeAllZero();

        this.m_status.changeBit(this.inputs().driftIsAuto(), eStatus.AutoDrift);

        this.m_airtime = 0;
        this.m_cannonPointId = 0;
        this.m_startBoostIdx = 0;
    }

    /** @addr{0x8059455C} */
    init(): void {
        this.reset();
    }

    /** @addr{0x80594594} */
    reset(): void {
        // In the base game, we only wipe bitfield 0, 1, 2, and 3, so we need to bring back
        // bitfield4.
        const isAutoDrift = this.m_status.onBit(eStatus.AutoDrift);
        this.m_status.makeAllZero().changeBit(isAutoDrift, eStatus.AutoDrift);

        this.m_airtime = 0;
        this.m_top.setZero();
        this.m_hwgTimer = 0;
        this.m_boostRampType = -1;
        this.m_jumpPadVariant = -1;
        this.m_halfPipeInvisibilityTimer = 0;
        this.m_startBoostCharge = 0.0;
        this.m_stickX = 0.0;
        this.m_wallBonkTimer = 0;
        this.m_trickableTimer = 0;
    }

    /**
     * @addr{0x8059487C}
     * Each frame, read input and save related bit flags. Also handles start boosts.
     */
    calcInput(): void {
        const raceMgr = RaceManager.Instance()!;
        if (raceMgr.isStageReached(RaceManager.Stage.Race)) {
            if (
                this.m_status.offBit(
                    eStatus.InAction,
                    eStatus.BeforeRespawn,
                    eStatus.CannonStart,
                    eStatus.InCannon,
                    eStatus.OverZipper,
                )
            ) {
                const currentState = this.inputs().currentState();
                const lastState = this.inputs().lastState();
                this.m_stickX = currentState.stick.x;
                this.m_stickY = currentState.stick.y;

                if (this.m_status.offBit(eStatus.RejectRoadTrigger)) {
                    if (this.m_stickX < 0.0) {
                        this.m_status.setBit(eStatus.StickLeft);
                    } else if (this.m_stickX > 0.0) {
                        this.m_status.setBit(eStatus.StickRight);
                    }
                }

                if (this.m_status.offBit(eStatus.Burnout)) {
                    this.m_status
                        .changeBit(currentState.accelerate(), eStatus.Accelerate)
                        .changeBit(
                            currentState.accelerate() && !lastState.accelerate(),
                            eStatus.AccelerateStart,
                        )
                        .changeBit(currentState.brake(), eStatus.Brake);

                    if (this.m_status.offBit(eStatus.AutoDrift)) {
                        this.m_status
                            .changeBit(currentState.drift(), eStatus.DriftInput)
                            .changeBit(
                                currentState.drift() && !lastState.drift(),
                                eStatus.HopStart,
                            );
                    }
                }
            }

            this.calcHandleStartBoost();
        } else {
            if (!raceMgr.isStageReached(RaceManager.Stage.Countdown)) {
                return;
            }

            const currentState = this.inputs().currentState();
            this.m_stickX = currentState.stick.x;
            this.m_status.changeBit(currentState.accelerate(), eStatus.ChargeStartBoost);

            this.calcStartBoost();
        }
    }

    /**
     * @addr{0x8059474C}
     * Every frame, resets the input state and saves collision-related bit flags.
     */
    calc(): void {
        this.resetFlags();

        this.collide().calcBeforeRespawn();

        this.calcCollisions();
        this.collide().calcBoundingRadius();
    }

    /** @addr{0x80594704} */
    resetFlags(): void {
        this.m_status.resetBit(
            eStatus.Accelerate,
            eStatus.Brake,
            eStatus.DriftInput,
            eStatus.HopStart,
            eStatus.AccelerateStart,
            eStatus.GroundStart,
            eStatus.StickLeft,
            eStatus.WallCollisionStart,
            eStatus.AirStart,
            eStatus.StickRight,
            eStatus.ZipperInvisibleWall,
            eStatus.JumpPadDisableYsusForce,
            eStatus.CollidingOffroad,
            eStatus.JumpPadDisableYsusForce,
        );

        this.m_stickY = 0.0;
        this.m_stickX = 0.0;
    }

    /**
     * @addr{0x80594BD4}
     * Each frame, checks for collision and saves relevant bit flags.
     */
    calcCollisions(): void {
        const wasTouchingGround = this.m_status.onBit(eStatus.TouchingGround);
        const wasWallCollision = this.m_status.onBit(
            eStatus.WallCollision,
            eStatus.Wall3Collision,
        );

        this.m_status.resetBit(
            eStatus.Wall3Collision,
            eStatus.WallCollision,
            eStatus.VehicleBodyFloorCollision,
            eStatus.AnyWheelCollision,
            eStatus.AllWheelsCollision,
            eStatus.TouchingGround,
        );

        if (this.m_hwgTimer > 0) {
            this.m_hwgTimer = (this.m_hwgTimer - 1) | 0;
            if (this.m_hwgTimer === 0) {
                this.m_status.resetBit(eStatus.SoftWallSuspension, eStatus.SoftWallPush);
            }
        }

        this.m_top.setZero();
        let softWallCollision = false;

        const collide = this.collide();
        if (collide.numSoftWallCollisions() > 0) {
            if (collide.numFloorOnlyCollisions() === 0) {
                softWallCollision = true;
            } else {
                const avgSoftWallColHeight = fr(
                    collide.sumHitboxBottomHeightSoftWall() /
                        fr(collide.numSoftWallCollisions()),
                );
                const avgFloorOnlyColHeight = fr(
                    collide.sumHitboxBottomHeightFloorOnly() /
                        fr(collide.numFloorOnlyCollisions()),
                );

                if (fr(avgSoftWallColHeight - avgFloorOnlyColHeight) >= 40.0) {
                    this.m_status.resetBit(eStatus.SoftWallUnlockRotation);
                } else {
                    softWallCollision = true;
                }
            }
        }

        let wheelCollisions = 0; ///< u16
        let effectiveSoftWallCount = 0; ///< u16
        const wallNrm = Vector3f.zero.clone();
        let trickable = false;

        for (let tireIdx = 0; tireIdx < this.tireCount(); ++tireIdx) {
            const colData = this.collisionData(tireIdx);
            if (this.hasFloorCollision(this.tirePhysics(tireIdx))) {
                this.m_top.addEq(colData.floorNrm);
                trickable = trickable || colData.bTrickable;
                ++wheelCollisions;
            }

            if (softWallCollision && colData.bSoftWall) {
                ++effectiveSoftWallCount;
                wallNrm.addEq(colData.noBounceWallNrm);
            }
        }

        if (wheelCollisions > 0) {
            this.m_status.setBit(eStatus.AnyWheelCollision);
            if (wheelCollisions === this.tireCount()) {
                this.m_status.setBit(eStatus.AllWheelsCollision);
            }
        }

        const colData = this.collisionData();
        if (colData.bFloor) {
            this.m_status.setBit(eStatus.VehicleBodyFloorCollision);
            this.m_top.addEq(colData.floorNrm);
            trickable = trickable || colData.bTrickable;

            if (this.m_status.onBit(eStatus.OverZipper) && this.m_status.offBit(eStatus.HalfpipeMidair)) {
                this.halfPipe().end(true);
            }
        }

        let bodySoftWallCollision = false;
        if (softWallCollision && colData.bSoftWall) {
            bodySoftWallCollision = true;
            ++effectiveSoftWallCount;
            wallNrm.addEq(colData.wallNrm);
        }

        const bVar3 = colData.bInvisibleWallOnly && this.m_halfPipeInvisibilityTimer > 0;
        this.m_halfPipeInvisibilityTimer = s16(Math.max(0, this.m_halfPipeInvisibilityTimer - 1));

        this.m_wallBonkTimer = s16(Math.max(0, this.m_wallBonkTimer - 1));

        let hwg = false;

        if ((colData.bWall || colData.bWall3) && !bVar3) {
            if (colData.bWall) {
                this.status().setBit(eStatus.WallCollision);
            }

            if (colData.bWall3) {
                this.m_status.setBit(eStatus.Wall3Collision);
            }

            if (!wasWallCollision) {
                this.m_status.setBit(eStatus.WallCollisionStart);

                if (this.wallKclType() === COL_TYPE_SPECIAL_WALL && this.wallKclVariant() === 0) {
                    if (
                        this.m_status.offBit(
                            eStatus.TriggerRespawn,
                            eStatus.InRespawn,
                            eStatus.AfterRespawn,
                            eStatus.BeforeRespawn,
                            eStatus.InAction,
                            eStatus.CannonStart,
                            eStatus.InCannon,
                        )
                    ) {
                        this.action().start(Action.UNK_1);
                    }
                }
            }

            this.m_wallBonkTimer = 2;

            if (this.m_hwgTimer === 0 && colData.movement.y > 1.0) {
                const movement = colData.movement.clone();
                movement.normalise();

                if (
                    movement.dot(Vector3f.ey) > fr(0.8) &&
                    colData.wallNrm.dot(Vector3f.ey) > fr(0.85) &&
                    (fr(
                        fr(movement.x * colData.wallNrm.x) + fr(movement.z * colData.wallNrm.z),
                    ) < 0.0 ||
                        this.collide().colPerpendicularity() >= 1.0)
                ) {
                    colData.wallNrm.y = 0.0;
                    colData.wallNrm.normalise();
                    wallNrm.copy(colData.wallNrm);

                    if (wallNrm.length() < fr(0.05)) {
                        wallNrm.copy(movement);
                        wallNrm.y = 0.0;
                    }

                    hwg = true;
                }
            }
        }

        if (
            colData.bInvisibleWall &&
            this.m_status.onBit(eStatus.HalfPipeRamp) &&
            this.collide().surfaceFlags().offBit(eSurfaceFlags.StopHalfPipeState)
        ) {
            this.m_status.setBit(eStatus.ZipperInvisibleWall);
        }

        if (effectiveSoftWallCount > 0 || hwg) {
            this.m_status.setBit(eStatus.SoftWallSuspension);
            this.m_softWallSpeed.copy(wallNrm);
            this.m_softWallSpeed.normalise();
            if (effectiveSoftWallCount > 0 && this.m_status.offBit(eStatus.Hop)) {
                this.m_status.setBit(eStatus.SoftWallUnlockRotation);
            }

            if (hwg) {
                this.m_status.setBit(eStatus.HWG);
            }

            if (bodySoftWallCollision || hwg || this.isBike()) {
                this.m_status.setBit(eStatus.SoftWallPush);
                this.m_hwgTimer = 10;

                if (hwg) {
                    this.m_hwgTimer *= 2;
                }
            }
        }

        this.m_status.resetBit(eStatus.AirtimeOver20);
        this.m_trickableTimer = s16(Math.max(0, this.m_trickableTimer - 1));

        if (wheelCollisions < 1 && !colData.bFloor) {
            if (wasTouchingGround) {
                this.m_status.setBit(eStatus.AirStart);
            }

            this.m_airtime = (this.m_airtime + 1) >>> 0;
            if (this.m_airtime > 20) {
                this.m_status.setBit(eStatus.AirtimeOver20);
            }
        } else {
            this.m_top.normalise();

            this.m_status.setBit(eStatus.TouchingGround).resetBit(eStatus.AfterCannon);

            if (this.m_status.offBit(eStatus.InAction)) {
                this.m_status.resetBit(eStatus.ActionMidZipper, eStatus.EndHalfPipe);
            }

            if (this.m_status.onBit(eStatus.OverZipper)) {
                this.halfPipe().end(true);
            }

            if (trickable) {
                this.m_trickableTimer = 3;
            }

            this.m_status.changeBit(this.m_trickableTimer > 0, eStatus.Trickable);

            if (this.m_status.offBit(eStatus.JumpPad)) {
                this.m_status.resetBit(eStatus.JumpPadMushroomCollision);
            }

            if (!wasTouchingGround) {
                this.m_status.setBit(eStatus.GroundStart);
            }

            if (this.m_status.onBit(eStatus.InATrick) && this.jump().cooldown() === 0) {
                this.move().landTrick();
                this.dynamics().setForceUpright(true);
                this.jump().end();
            }

            this.m_airtime = 0;
        }
    }

    /**
     * @addr{0x80595918}
     * STAGE 1 - Each frame, calculates the start boost charge.
     */
    calcStartBoost(): void {
        const START_BOOST_DELTA_ONE = fr(0.02);
        const START_BOOST_DELTA_TWO = fr(0.002);
        const START_BOOST_FALLOFF = fr(0.96);

        if (this.m_status.onBit(eStatus.ChargeStartBoost)) {
            this.m_startBoostCharge = fr(
                this.m_startBoostCharge +
                    fr(
                        START_BOOST_DELTA_ONE -
                            fr(
                                fr(START_BOOST_DELTA_ONE - START_BOOST_DELTA_TWO) *
                                    this.m_startBoostCharge,
                            ),
                    ),
            );
        } else {
            this.m_startBoostCharge = fr(this.m_startBoostCharge * START_BOOST_FALLOFF);
        }

        this.m_startBoostCharge = fmax(0.0, fmin(1.0, this.m_startBoostCharge));
    }

    /**
     * @addr{0x805959D4}
     * On countdown end, calculates and applies our start boost charge.
     */
    calcHandleStartBoost(): void {
        if (RaceManager.Instance()!.getCountdownTimer() !== 0) {
            return;
        }

        if (this.m_status.onBit(eStatus.Accelerate)) {
            if (this.m_startBoostCharge > START_BOOST_ENTRIES[START_BOOST_ENTRIES.length - 1]!.range) {
                this.m_startBoostIdx = SIZE_T_MAX;
            } else if (this.m_startBoostCharge > START_BOOST_ENTRIES[0]!.range) {
                // Ranges are exclusive on the lower bound and inclusive on the upper bound
                for (let i = 1; i < START_BOOST_ENTRIES.length; ++i) {
                    if (
                        this.m_startBoostCharge > START_BOOST_ENTRIES[i - 1]!.range &&
                        this.m_startBoostCharge <= START_BOOST_ENTRIES[i]!.range
                    ) {
                        this.m_startBoostIdx = i;
                        break;
                    }
                }
            }
        }

        if (this.m_startBoostIdx <= 0) {
            return;
        }

        this.handleStartBoost(this.m_startBoostIdx);
        this.m_status.resetBit(eStatus.ChargeStartBoost);
    }

    /**
     * @addr{0x80595AF8}
     * Applies the relevant start boost duration.
     */
    handleStartBoost(idx: number): void {
        if (this.m_startBoostIdx === SIZE_T_MAX) {
            this.move().burnout().start();
        } else {
            this.move().applyStartBoost(START_BOOST_ENTRIES[idx]!.frames);
        }
    }

    /**
     * @addr{0x805958F0}
     * Resets certain bitfields pertaining to ejections (reject road, half pipe zippers, etc.)
     */
    resetEjection(): void {
        this.m_status.resetBit(eStatus.HalfPipeRamp, eStatus.RejectRoad);
    }

    setCannonPointId(val: number): void {
        this.m_cannonPointId = val;
    }

    setBoostRampType(val: number): void {
        this.m_boostRampType = val;
    }

    setJumpPadVariant(val: number): void {
        this.m_jumpPadVariant = val;
    }

    setHalfPipeInvisibilityTimer(val: number): void {
        this.m_halfPipeInvisibilityTimer = val;
    }

    setTrickableTimer(val: number): void {
        this.m_trickableTimer = val;
    }

    isDrifting(): boolean {
        return this.m_status.onBit(eStatus.DriftManual, eStatus.DriftAuto);
    }

    cannonPointId(): number {
        return this.m_cannonPointId;
    }

    boostRampType(): number {
        return this.m_boostRampType;
    }

    jumpPadVariant(): number {
        return this.m_jumpPadVariant;
    }

    stickX(): number {
        return this.m_stickX;
    }

    stickY(): number {
        return this.m_stickY;
    }

    airtime(): number {
        return this.m_airtime;
    }

    top(): Readonly<Vector3f> {
        return this.m_top;
    }

    softWallSpeed(): Readonly<Vector3f> {
        return this.m_softWallSpeed;
    }

    startBoostCharge(): number {
        return this.m_startBoostCharge;
    }

    wallBonkTimer(): number {
        return this.m_wallBonkTimer;
    }

    trickableTimer(): number {
        return this.m_trickableTimer;
    }

    override status(): Status {
        return this.m_status;
    }
}
