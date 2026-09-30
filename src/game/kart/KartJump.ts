/** Port of Kinoko source/game/kart/KartJump.{hh,cc}. */

import { atan2, DEG2FIDX, DEG2RAD, fmax, fmin, fr, RAD2DEG, SinFIdx } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { Trick } from '../system/KPadController';
import { eSurfaceFlags } from './KartCollide';
import type { KartMove, KartMoveBike } from './KartMove';
import { KartObjectProxy } from './KartObjectProxy';
import { eStatus } from './Status';

/**
 * Determined by the KCL, this represents the variation of the trick that will be performed.
 * This is also directly used to determine the duration of the trick boost.
 */
export enum SurfaceVariant {
    /** RR ramps before figure-8 and last turn. */
    DoubleFlipTrick = 0,
    /** BC starting ramp. */
    SingleFlipTrick = 1,
    /** Think rMR ramp and pipe, MH after first turn, mushrooms, etc. */
    StuntTrick = 2,
}

/** Represents the type of trick that will be performed based on kart and player input. */
export enum TrickType {
    StuntTrickBasic = 0,
    BikeFlipTrickNose = 1,
    BikeFlipTrickTail = 2,
    FlipTrickYLeft = 3,
    FlipTrickYRight = 4,
    KartFlipTrickZ = 5,
    BikeSideStuntTrick = 6,
}

export interface TrickProperties {
    initialAngleDiff: number;
    angleDeltaMin: number;
    angleDeltaFactorMin: number;
    angleDiffMulDec: number;
}

export interface AngleProperties {
    targetAngle: number;
    rotAngle: number;
}

const TRICK_PROPERTIES: readonly Readonly<TrickProperties>[] = [
    {
        initialAngleDiff: 11.0,
        angleDeltaMin: 1.5,
        angleDeltaFactorMin: fr(0.9),
        angleDiffMulDec: fr(0.0018),
    },
    {
        initialAngleDiff: 14.0,
        angleDeltaMin: 1.5,
        angleDeltaFactorMin: fr(0.9),
        angleDiffMulDec: fr(0.0006),
    },
    {
        initialAngleDiff: 7.5,
        angleDeltaMin: 2.5,
        angleDeltaFactorMin: fr(0.93),
        angleDiffMulDec: fr(0.05),
    },
];

const FINAL_ANGLES: readonly number[] = [360.0, 720.0, 180.0];

function ap(targetAngle: number, rotAngle: number): Readonly<AngleProperties> {
    return { targetAngle, rotAngle };
}

const ANGLE_PROPERTIES: readonly (readonly Readonly<AngleProperties>[])[] = [
    [ap(40.0, 15.0), ap(45.0, 20.0), ap(45.0, 20.0)],
    [ap(36.0, 13.0), ap(42.0, 18.0), ap(42.0, 18.0)],
    [ap(32.0, 11.0), ap(39.0, 16.0), ap(39.0, 16.0)],
];

const TRICK_ALLOW_TIMER = 14;

/** Manages trick inputs and state. */
export class KartJump extends KartObjectProxy {
    protected m_type: TrickType = TrickType.StuntTrickBasic;
    protected m_variant: SurfaceVariant = SurfaceVariant.DoubleFlipTrick;
    protected m_nextTrick: Trick = Trick.None;
    protected m_rotSign = 0.0;
    protected m_properties: TrickProperties = {
        initialAngleDiff: 0.0,
        angleDeltaMin: 0.0,
        angleDeltaFactorMin: 0.0,
        angleDiffMulDec: 0.0,
    };
    protected m_angle = 0.0;
    protected m_angleDelta = 0.0;
    protected m_angleDeltaFactor = 0.0;
    protected m_angleDeltaFactorDec = 0.0;
    protected m_finalAngle = 0.0;
    /** s16 */
    protected m_cooldown = 0;
    protected m_rot = new Quatf();
    protected m_move: KartMove;

    /** s16 */
    private m_nextAllowTimer = 0;
    private m_boostRampEnabled = false;

    /** @addr{0x80575A44} */
    constructor(move: KartMove) {
        super();
        this.m_move = move;
        this.m_cooldown = 0;

        // The base game doesn't initialize this explicitly, since EGG::Heaps are memset to 0.
        this.m_nextAllowTimer = 0;
    }

    /** @addr{0x805764FC} */
    calcRot(): void {
        this.m_angleDelta = fr(this.m_angleDelta * this.m_angleDeltaFactor);
        this.m_angleDelta = fmax(this.m_angleDelta, this.m_properties.angleDeltaMin);
        this.m_angleDeltaFactor = fr(this.m_angleDeltaFactor - this.m_angleDeltaFactorDec);
        this.m_angleDeltaFactor = fmax(
            this.m_angleDeltaFactor,
            this.m_properties.angleDeltaFactorMin,
        );
        this.m_angle = fr(this.m_angle + this.m_angleDelta);
        this.m_angle = fmin(this.m_angle, this.m_finalAngle);

        switch (this.m_type) {
            case TrickType.KartFlipTrickZ:
                this.m_rot.setRPY3(0.0, 0.0, fr(-fr(this.m_angle * DEG2RAD) * this.m_rotSign));
                break;
            case TrickType.FlipTrickYLeft:
            case TrickType.FlipTrickYRight:
                this.m_rot.setRPY3(0.0, fr(fr(this.m_angle * DEG2RAD) * this.m_rotSign), 0.0);
                break;
            default:
                break;
        }

        this.physics().composeStuntRot(this.m_rot);
    }

    /** @addr{0x80576460} */
    setupProperties(): void {
        if (this.m_variant === SurfaceVariant.SingleFlipTrick) {
            this.m_properties = { ...TRICK_PROPERTIES[0]! };
            this.m_finalAngle = FINAL_ANGLES[0]!;
        } else if (this.m_variant === SurfaceVariant.StuntTrick) {
            this.m_properties = { ...TRICK_PROPERTIES[1]! };
            this.m_finalAngle = FINAL_ANGLES[1]!;
        } else if (this.m_type === TrickType.BikeSideStuntTrick) {
            this.m_properties = { ...TRICK_PROPERTIES[2]! };
            this.m_finalAngle = FINAL_ANGLES[2]!;
        }

        this.m_angleDelta = this.m_properties.initialAngleDiff;
        this.m_angleDeltaFactorDec = this.m_properties.angleDiffMulDec;
        this.m_angle = 0.0;
        this.m_angleDeltaFactor = 1.0;
        this.m_rot.copy(Quatf.ident);
    }

    /** @addr{0x80575AE8} */
    reset(): void {
        this.m_cooldown = 0;
    }

    /** @addr{0x80575D7C} */
    tryStart(left: Readonly<Vector3f>): void {
        const status = this.status();

        if (status.offBit(eStatus.TrickStart)) {
            return;
        }

        if (this.m_move.speedRatioCapped() > 0.5) {
            const boostRampType = this.state().boostRampType();

            if (boostRampType === 0) {
                this.m_variant = SurfaceVariant.StuntTrick;
            } else if (boostRampType === 1) {
                this.m_variant = SurfaceVariant.SingleFlipTrick;
            } else {
                this.m_variant = SurfaceVariant.DoubleFlipTrick;
            }

            this.start(left);
        }

        status.resetBit(eStatus.TrickStart);
    }

    /** @addr{0x805763E4} */
    calc(): void {
        this.m_cooldown = Math.max(0, this.m_cooldown - 1);

        if (this.status().onBit(eStatus.TrickRot)) {
            this.calcRot();
        }

        this.calcInput();
    }

    someFlagCheck(): boolean {
        return this.status().onBit(
            eStatus.InAction,
            eStatus.TrickStart,
            eStatus.InATrick,
            eStatus.OverZipper,
        );
    }

    /** @addr{0x80575B38} */
    calcInput(): void {
        const trick = this.inputs().currentState().trick;

        if (!this.someFlagCheck() && trick !== Trick.None) {
            this.m_nextTrick = trick;
            this.m_nextAllowTimer = TRICK_ALLOW_TIMER;
        }

        const status = this.status();

        const airtime = this.state().airtime();
        if (
            airtime === 0 ||
            this.m_nextAllowTimer < 1 ||
            airtime > 10 ||
            (status.offBit(eStatus.Trickable) && this.state().boostRampType() < 0) ||
            this.someFlagCheck()
        ) {
            this.m_nextAllowTimer = Math.max(0, this.m_nextAllowTimer - 1);
        } else {
            if (airtime > 2) {
                status.setBit(eStatus.TrickStart);
            }
            if (status.onBit(eStatus.RampBoost)) {
                this.m_boostRampEnabled = true;
            }
        }
        if (
            status.onBit(eStatus.TouchingGround) &&
            this.collide().surfaceFlags().offBit(eSurfaceFlags.BoostRamp)
        ) {
            this.m_boostRampEnabled = false;
        }
    }

    /** @addr{0x805766B8} */
    end(): void {
        const status = this.status();

        if (status.onBit(eStatus.TrickRot)) {
            this.physics().composeDecayingStuntRot(this.m_rot);
        }

        status.resetBit(eStatus.InATrick, eStatus.TrickRot);
        this.m_boostRampEnabled = false;
    }

    /** @addr{0x80576230} */
    setAngle(left: Readonly<Vector3f>): void {
        const vel1YDot = this.m_move.vel1Dir().dot(Vector3f.ey);
        const vel1YCross = this.m_move.vel1Dir().cross(Vector3f.ey);
        const vel1YCrossMag = vel1YCross.length();
        const pitch = Math.abs(atan2(vel1YCrossMag, vel1YDot));
        const angle = fr(90.0 - fr(pitch * RAD2DEG));
        const weightClass = this.param().stats().weightClass as number;
        const targetAngle = ANGLE_PROPERTIES[weightClass]![this.m_variant as number]!.targetAngle;

        if (this.status().onBit(eStatus.JumpPad) || angle > targetAngle) {
            return;
        }

        let rotAngle = ANGLE_PROPERTIES[weightClass]![this.m_variant as number]!.rotAngle;

        if (fr(angle + rotAngle) > targetAngle) {
            rotAngle = fr(targetAngle - angle);
        }

        const nextDir = new Matrix34f();
        nextDir.setAxisRotation(fr(-rotAngle * DEG2RAD), left);
        this.m_move.setDir(nextDir.ps_multVector(this.m_move.dir()));
        this.m_move.setVel1Dir(this.m_move.dir());
    }

    /** @addr{0x80575EE8} */
    protected start(left: Readonly<Vector3f>): void {
        this.init();
        this.setAngle(left);
        this.status().setBit(eStatus.InATrick);
        this.m_cooldown = 5;
    }

    /** @addr{0x8057616C} */
    protected init(): void {
        if (this.m_variant === SurfaceVariant.DoubleFlipTrick) {
            this.m_type = TrickType.StuntTrickBasic;
            return;
        }

        if (this.m_nextTrick < Trick.Left) {
            this.m_type = TrickType.KartFlipTrickZ;
            this.m_rotSign = this.m_nextTrick === Trick.Up ? -1.0 : 1.0;
        } else {
            this.m_type = this.m_nextTrick as number as TrickType;
            this.m_rotSign = this.m_type === TrickType.FlipTrickYRight ? -1.0 : 1.0;
        }

        this.setupProperties();
        this.status().setBit(eStatus.TrickRot);
    }

    setBoostRampEnabled(isSet: boolean): void {
        this.m_boostRampEnabled = isSet;
    }

    isBoostRampEnabled(): boolean {
        return this.m_boostRampEnabled;
    }

    type(): TrickType {
        return this.m_type;
    }

    variant(): SurfaceVariant {
        return this.m_variant;
    }

    cooldown(): number {
        return this.m_cooldown;
    }
}

/** Computed using double precision, so we hard-code it. */
const PI_OVER_9 = fr(0.34906584);
/** Computed using double precision, so we hard-code it. */
const PI_OVER_3 = fr(1.0471976);

const DOUBLE_FLIP_TRICK_FINAL_ANGLE = 180.0;

export class KartJumpBike extends KartJump {
    constructor(move: KartMove) {
        super(move);
    }

    /** @addr{0x80576994} */
    override calcRot(): void {
        this.m_angleDelta = fr(this.m_angleDelta * this.m_angleDeltaFactor);
        this.m_angleDelta = fmax(this.m_angleDelta, this.m_properties.angleDeltaMin);
        this.m_angleDeltaFactor = fr(this.m_angleDeltaFactor - this.m_angleDeltaFactorDec);
        this.m_angleDeltaFactor = fmax(
            this.m_angleDeltaFactor,
            this.m_properties.angleDeltaFactorMin,
        );
        this.m_angle = fr(this.m_angle + this.m_angleDelta);
        this.m_angle = fmin(this.m_angle, this.m_finalAngle);

        switch (this.m_type) {
            case TrickType.BikeFlipTrickNose:
            case TrickType.BikeFlipTrickTail:
                this.m_rot.setRPY3(fr(-fr(this.m_angle * DEG2RAD) * this.m_rotSign), 0.0, 0.0);
                break;
            case TrickType.FlipTrickYLeft:
            case TrickType.FlipTrickYRight:
                this.m_rot.setRPY3(0.0, fr(fr(this.m_angle * DEG2RAD) * this.m_rotSign), 0.0);
                break;
            case TrickType.BikeSideStuntTrick: {
                const sin = SinFIdx(fr(this.m_angle * DEG2FIDX));
                this.m_rot.setRPY3(
                    fr(sin * -PI_OVER_9),
                    fr(fr(sin * this.m_rotSign) * -PI_OVER_3),
                    fr(fr(sin * this.m_rotSign) * PI_OVER_9),
                );
                break;
            }
            default:
                break;
        }

        this.physics().composeStuntRot(this.m_rot);
    }

    /** @addr{0x80576758} */
    protected override start(left: Readonly<Vector3f>): void {
        super.start(left);

        const moveBike = this.m_move as KartMoveBike;
        moveBike.cancelWheelie();
    }

    /** @addr{0x8057689C} */
    protected override init(): void {
        if (this.m_variant === SurfaceVariant.DoubleFlipTrick) {
            if (this.m_nextTrick < Trick.Left) {
                return;
            }

            this.m_type = TrickType.BikeSideStuntTrick;
            this.m_rotSign = this.m_nextTrick === Trick.Right ? -1.0 : 1.0;
            this.setupProperties();
            this.m_finalAngle = DOUBLE_FLIP_TRICK_FINAL_ANGLE;
        } else {
            this.m_type = this.m_nextTrick as number as TrickType;
            this.m_rotSign =
                this.m_type === TrickType.FlipTrickYRight ||
                this.m_type === TrickType.BikeFlipTrickTail
                    ? -1.0
                    : 1.0;
            this.setupProperties();
        }

        this.status().setBit(eStatus.TrickRot);
    }
}
