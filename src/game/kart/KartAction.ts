/** Port of Kinoko's game/kart/KartAction.{hh,cc}. */

import { TBitFlag } from '../../egg/core/BitFlag';
import { DEG2FIDX, DEG2RAD, F32_EPSILON, fmin, fr, SinFIdx } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { ItemDirector } from '../item/ItemDirector';
import { KartObjectProxy } from './KartObjectProxy';
import { eStatus } from './Status';

export enum Action {
    None = -1,
    UNK_0 = 0,
    UNK_1 = 1,
    UNK_2 = 2,
    UNK_3 = 3,
    UNK_4 = 4,
    UNK_5 = 5,
    UNK_6 = 6,
    UNK_7 = 7,
    UNK_8 = 8,
    UNK_9 = 9,
    UNK_12 = 12,
    UNK_14 = 14,
    UNK_15 = 15,
    UNK_16 = 16,
    Max = 18,
}

/** KartAction::eFlags. Also reachable as `KartAction.eFlags`. */
export enum eKartActionFlags {
    Landing = 0,
    LargeFlip = 2,
    Rotating = 3,
    LandingFromFlip = 5,
}

/** Parameters specific to an action ID. */
interface ActionParams {
    startSpeedMult: number;
    calcSpeedMult: number;
    priority: number; ///< s16
}

interface RotationParams {
    initialAngleIncrement: number;
    minAngleIncrement: number;
    minMultiplier: number;
    initialMultiplierDecrement: number;
    slowdownThreshold: number;
    finalAngle: number;
}

// The player index sent into StartActionFunc is assumed to be cosmetic
type StartActionFunc = (self: KartAction) => void;
type CalcActionFunc = (self: KartAction) => boolean;
type EndActionFunc = (self: KartAction, arg: boolean) => void;

const MAX_ACTION = Action.Max as number;

export class KartAction extends KartObjectProxy {
    static readonly eFlags = eKartActionFlags;

    private m_side = new Vector3f();
    private m_currentAction: Action;
    private m_rotationDirection = 0.0;
    private m_targetRot = 0.0;
    private m_hitDepth: Vector3f;
    private m_rotAxis = new Vector3f();
    private m_translation: Vector3f;

    private m_velPitch = 0.0;
    private m_pitch = 0.0;
    private m_deltaPitch = 0.0;
    private m_flipPhase = 0.0;
    private m_groundStartLaunchTimer = 0; ///< s32

    private m_onStart: StartActionFunc | null;
    private m_onCalc: CalcActionFunc | null;
    private m_onEnd: EndActionFunc | null;

    private m_rotation = new Quatf();
    private m_actionParams: ActionParams | null;
    private m_frame = 0; ///< u32
    private m_crushTimer = 0; ///< u32
    private m_flags = new TBitFlag<eKartActionFlags>();
    private m_currentAngle = 0.0;
    private m_angleIncrement = 0.0;
    private m_multiplier = 0.0;
    private m_multiplierDecrement = 0.0;
    private m_finalAngle = 0.0;
    private m_rotationParams: RotationParams | null;
    private m_up = new Vector3f();
    private m_framesFlipping = 0; ///< u16
    private m_priority: number; ///< s16

    /** @addr{0x805672CC} */
    constructor() {
        super();
        this.m_currentAction = Action.None;
        this.m_hitDepth = Vector3f.zero.clone();
        this.m_translation = Vector3f.ez.clone();
        this.m_onStart = null;
        this.m_onCalc = null;
        this.m_onEnd = null;
        this.m_actionParams = null;
        this.m_rotationParams = null;
        this.m_priority = 0;
    }

    /** @addr{0x8056739C} */
    init(): void {
        this.m_currentAction = Action.None;
        this.m_flags.makeAllZero();
    }

    /** @addr{0x805673B0} */
    calc(): void {
        if (this.m_currentAction === Action.None || !this.m_onCalc) {
            return;
        }

        if (this.calcCurrentAction()) {
            this.calcEndAction(false);
        }
    }

    /** @addr{0x80567CE4} */
    calcVehicleSpeed(): void {
        this.move().setSpeed(fr(this.m_actionParams!.calcSpeedMult * this.move().speed()));
    }

    /**
     * @addr{0x805675DC}
     * Starts an action.
     * @return Whether or not the action was started.
     */
    start(action: Action): boolean {
        const status = this.status();

        if (
            status.onBit(
                eStatus.InRespawn,
                eStatus.AfterRespawn,
                eStatus.BeforeRespawn,
                eStatus.InCannon,
            )
        ) {
            return false;
        }

        if (status.onBit(eStatus.ZipperStick)) {
            switch (action) {
                case Action.UNK_2:
                case Action.UNK_3:
                case Action.UNK_4:
                case Action.UNK_5:
                case Action.UNK_6:
                    action = Action.UNK_1;
                    break;
                default:
                    break;
            }
        }

        const actionIdx = action as number;

        if (
            this.m_currentAction !== Action.None &&
            s_actionParams[actionIdx]!.priority <= this.m_priority
        ) {
            return false;
        }

        this.calcEndAction(true);
        this.m_currentAction = action;
        this.m_actionParams = s_actionParams[actionIdx]!;
        this.m_priority = this.m_actionParams.priority;
        this.m_onStart = s_onStart[actionIdx]!;
        this.m_onCalc = s_onCalc[actionIdx]!;
        this.m_onEnd = s_onEnd[actionIdx]!;
        status.setBit(eStatus.InAction);
        this.m_frame = 0;
        this.m_flags.makeAllZero();
        this.m_up.copy(this.move().up());
        this.move().clear();

        this.applyStartSpeed();
        this.m_onStart(this);
        return true;
    }

    /**
     * @addr{0x80567D3C}
     * Initializes rotation parameters.
     * @warning The parameter is supposed to be an enum, but we discard it.
     * This results in the arguments being off-by-one. Beware of zero!
     */
    startRotation(idx: number): void {
        this.m_rotation.copy(Quatf.ident);

        let dir = this.move().dir().clone();
        if (this.speed() < 0.0) {
            dir = dir.neg();
        }

        this.m_rotationDirection = dir.cross(this.bodyFront()).dot(this.bodyUp()) > 0.0 ? 1.0 : -1.0;
        this.setRotation(idx);
        this.m_flags.setBit(eKartActionFlags.Rotating);
    }

    setHitDepth(hitDepth: Readonly<Vector3f>): void {
        this.m_hitDepth.copy(hitDepth);
    }

    setTranslation(v: Readonly<Vector3f>): void {
        this.m_translation.copy(v);
    }

    flags(): Readonly<TBitFlag<eKartActionFlags>> {
        return this.m_flags;
    }

    /** @addr{0x80569AE8} */
    private calcSideFromHitDepth(): void {
        this.m_hitDepth.normalise();
        this.m_side.copy(this.m_hitDepth.perpInPlane(this.move().smoothedUp(), true));

        if (this.m_side.squaredLength() <= F32_EPSILON) {
            this.m_side.copy(Vector3f.ey);
        }
    }

    /** @addr{0x80569B94} */
    private calcSideFromHitDepthAndTranslation(): void {
        this.calcSideFromHitDepth();

        const cross = this.m_translation.cross(this.m_side);
        const sign = cross.y > 0.0 ? 1.0 : -1.0;

        const worldSide = Vector3f.ey.cross(this.m_translation);
        worldSide.normalise();

        this.m_side.copy(worldSide.perpInPlane(this.move().smoothedUp(), true));

        if (this.m_side.squaredLength() > F32_EPSILON) {
            this.m_side.mulEq(sign);
        } else {
            this.m_side.copy(Vector3f.ey);
        }
    }

    /** @addr{0x80567B98} */
    private end(): void {
        this.status().resetBit(eStatus.InAction, eStatus.LargeFlipHit);
        this.dynamics().setForceUpright(true);

        this.m_currentAction = Action.None;
        this.m_priority = 0;
        this.m_flags.makeAllZero();
    }

    /**
     * @addr{0x80567A54}
     * Executes a frame of the current action.
     * @return Whether or not the action should end.
     */
    private calcCurrentAction(): boolean {
        this.m_frame = (this.m_frame + 1) >>> 0;
        return this.m_onCalc!(this);
    }

    /** @addr{0x80567A88} */
    private calcEndAction(endArg: boolean): void {
        if (this.m_currentAction === Action.None) {
            return;
        }

        if (this.m_onEnd) {
            this.m_onEnd(this, endArg);
            this.end();
        }
    }

    /** @addr{0x80569DFC} */
    private calcRotation(): boolean {
        const params = this.m_rotationParams;
        if (!params) {
            return false;
        }

        // Slow the rotation down as we approach the end of the spinout
        if (this.m_currentAngle > fr(this.m_finalAngle * params.slowdownThreshold)) {
            this.m_angleIncrement = fr(this.m_angleIncrement * this.m_multiplier);
            if (params.minAngleIncrement > this.m_angleIncrement) {
                this.m_angleIncrement = params.minAngleIncrement;
            }

            this.m_multiplier = fr(this.m_multiplier - this.m_multiplierDecrement);
            if (params.minMultiplier > this.m_multiplier) {
                this.m_multiplier = params.minMultiplier;
            }
        }

        this.m_currentAngle = fr(this.m_currentAngle + this.m_angleIncrement);
        if (this.m_finalAngle < this.m_currentAngle) {
            this.m_currentAngle = this.m_finalAngle;
            return true;
        }

        return false;
    }

    /** @addr{0x80569E9C} */
    private calcUp(): void {
        this.m_up.addEq(this.move().up().sub(this.m_up).mul(fr(0.3)));
        this.m_up.normalise();
    }

    private calcLanding(): void {
        if (this.m_currentAngle < this.m_targetRot || this.status().offBit(eStatus.TouchingGround)) {
            return;
        }

        this.m_flags.setBit(eKartActionFlags.Landing);

        if (!this.isBike()) {
            this.dynamics().setForceUpright(false);
        }

        this.physics().composeDecayingExtraRot(this.m_rotation);
    }

    /** @addr{0x80568794} */
    private startLaunch(
        extVelScalar: number,
        extVelKart: number,
        extVelBike: number,
        numRotations: number,
        param6: number,
    ): void {
        this.m_targetRot = fr(360.0 * numRotations);

        const extVel = Vector3f.zero.clone();
        extVel.y = this.isBike() ? extVelBike : extVelKart;

        if (param6 === 0) {
            this.m_hitDepth.copy(this.move().dir());
            this.calcSideFromHitDepth();
        } else if (param6 === 1) {
            this.calcSideFromHitDepth();
            extVel.addEq(this.m_side.mul(extVelScalar));
        } else if (param6 === 2) {
            this.calcSideFromHitDepthAndTranslation();
            extVel.addEq(this.m_side.mul(extVelScalar));
        }

        this.setRotation(Math.trunc(fr(numRotations + 3.0)));
        this.m_groundStartLaunchTimer = 0;
        this.m_rotAxis.copy(this.move().smoothedUp().cross(this.m_side));

        this.dynamics().setExtVel(this.dynamics().extVel().add(extVel));
    }

    /** @addr{0x805696CC} */
    private activateCrush(timer: number): void {
        this.move().activateCrush((this.m_crushTimer + timer) & 0xffff);
        ItemDirector.Instance()!.kartItem(0).clear();
    }

    /** @addr{0x80567C68} */
    private applyStartSpeed(): void {
        this.move().setSpeed(fr(this.m_actionParams!.startSpeedMult * this.move().speed()));
        if (this.m_actionParams!.startSpeedMult === 0.0) {
            this.move().clearDrift();
        }
    }

    /** @addr{0x80569DB4} */
    private setRotation(idx: number): void {
        const params = s_rotationParams[--idx];
        if (params === undefined) {
            throw new Error(`KartAction::setRotation: invalid idx ${idx + 1}`);
        }
        this.m_rotationParams = params;

        this.m_finalAngle = params.finalAngle;
        this.m_angleIncrement = params.initialAngleIncrement;
        this.m_multiplierDecrement = params.initialMultiplierDecrement;
        this.m_currentAngle = 0.0;
        this.m_multiplier = 1.0;
    }

    /* ================================ *
     *     START FUNCTIONS
     * ================================ */

    startStub(): void {}

    /** @addr{0x80567FB4} */
    startAction1(): void {
        this.startRotation(2);
    }

    /** @addr{0x8056865C} */
    startAction2(): void {
        const EXT_VEL_SCALAR = 0.0;
        const EXT_VEL_KART = 30.0;
        const EXT_VEL_BIKE = 30.0;
        const NUM_ROTATIONS = 1.0;

        this.startLaunch(EXT_VEL_SCALAR, EXT_VEL_KART, EXT_VEL_BIKE, NUM_ROTATIONS, 0);
    }

    /** @addr{0x80568718} */
    startAction3(): void {
        const EXT_VEL_SCALAR = 25.0;
        const EXT_VEL_KART = 30.0;
        const EXT_VEL_BIKE = 30.0;
        const NUM_ROTATIONS = 1.0;

        this.startLaunch(EXT_VEL_SCALAR, EXT_VEL_KART, EXT_VEL_BIKE, NUM_ROTATIONS, 1);
        ItemDirector.Instance()!.kartItem(0).clear();
    }

    /** @addr{0x80568CB8} */
    startAction4(): void {
        const EXT_VEL_SCALAR = 25.0;
        const EXT_VEL_KART = 30.0;
        const EXT_VEL_BIKE = 30.0;
        const NUM_ROTATIONS = 2.0;

        this.startLaunch(EXT_VEL_SCALAR, EXT_VEL_KART, EXT_VEL_BIKE, NUM_ROTATIONS, 1);
        ItemDirector.Instance()!.kartItem(0).clear();
    }

    /** @addr{0x80568FA4} */
    startAction5(): void {
        const EXT_VEL_SCALAR = 13.0;
        const EXT_VEL_KART = 40.0;
        const EXT_VEL_BIKE = 45.0;
        const NUM_ROTATIONS = 1.0;

        this.startLaunch(EXT_VEL_SCALAR, EXT_VEL_KART, EXT_VEL_BIKE, NUM_ROTATIONS, 2);
    }

    /** @addr{0x805690A0} */
    startLargeFlipAction(): void {
        const INIT_VEL = new Vector3f(0.0, 60.0, 0.0);

        this.dynamics().setExtVel(INIT_VEL);
        this.dynamics().setAngVel0(Vector3f.zero.clone());

        if (this.m_currentAction === Action.UNK_8) {
            this.calcSideFromHitDepth();
            this.dynamics().setExtVel(this.dynamics().extVel().add(this.m_side.mul(-20.0)));
        }

        ItemDirector.Instance()!.kartItem(0).clear();

        this.m_deltaPitch = 0.0;
        this.m_pitch = 0.0;
        this.m_velPitch = 22.0;
        this.m_flipPhase = 0.0;
        this.m_framesFlipping = 0;

        this.status().setBit(eStatus.LargeFlipHit);
    }

    /** @addr{0x80568000} */
    startAction9(): void {
        this.startRotation(2);
    }

    /** @addr{0x80569774} */
    startLongPressAction(): void {
        const ACTION_DURATION = 90;
        const CRUSH_DURATION = 480;

        this.m_crushTimer = ACTION_DURATION;
        this.activateCrush(CRUSH_DURATION);
    }

    /** @addr{0x80569978} */
    startShortPressAction(): void {
        const ACTION_DURATION = 30;
        const CRUSH_DURATION = 240;

        this.m_crushTimer = ACTION_DURATION;
        this.activateCrush(CRUSH_DURATION);
    }

    /** @addr{0x80568058} */
    startSpinShrinkAction(): void {
        this.startRotation(1);
    }

    /* ================================ *
     *     CALC FUNCTIONS
     * ================================ */

    calcStub(): boolean {
        return false;
    }

    /** @addr{0x80568204} */
    calcAction1(): boolean {
        this.calcUp();
        const finished = this.calcRotation();

        this.m_rotation.setAxisRotation(
            fr(DEG2RAD * fr(this.m_currentAngle * this.m_rotationDirection)),
            this.m_up,
        );
        this.physics().composeExtraRot(this.m_rotation);
        return finished;
    }

    /** @addr{0x80568AA8} */
    calcLaunchAction(): boolean {
        const ACTION_DURATION = 100;

        if (this.m_flags.offBit(eKartActionFlags.Landing)) {
            this.calcRotation();
            this.calcLanding();
        }

        const actionEnded = this.m_frame >= ACTION_DURATION;

        if (actionEnded) {
            if (this.m_flags.offBit(eKartActionFlags.Landing)) {
                this.physics().composeDecayingExtraRot(this.m_rotation);
            }
        } else if (this.m_flags.offBit(eKartActionFlags.Landing)) {
            this.m_rotation.setAxisRotation(fr(DEG2RAD * this.m_currentAngle), this.m_rotAxis);
            this.physics().composeExtraRot(this.m_rotation);
        }

        return actionEnded;
    }

    /** @addr{0x80568D34} */
    calcAction4(): boolean {
        const ACTION_DURATION = 140;

        const status = this.state().status();
        if (status.onBit(eStatus.GroundStart)) {
            if (this.m_groundStartLaunchTimer++ === 0) {
                const extVel = this.dynamics().extVel().clone();
                extVel.y = 25.0;
                this.dynamics().setExtVel(extVel);
            }
        }

        if (this.m_flags.offBit(eKartActionFlags.Landing)) {
            this.calcRotation();
            this.calcLanding();
        }

        const actionEnded = this.m_frame >= ACTION_DURATION;

        if (actionEnded) {
            if (this.m_flags.offBit(eKartActionFlags.Landing)) {
                this.physics().composeDecayingExtraRot(this.m_rotation);
            }
        } else if (this.m_flags.offBit(eKartActionFlags.Landing)) {
            this.m_rotation.setAxisRotation(fr(DEG2RAD * this.m_currentAngle), this.m_rotAxis);
            this.physics().composeExtraRot(this.m_rotation);
        }

        return actionEnded;
    }

    /** @addr{0x805692B4} */
    calcLargeFlipAction(): boolean {
        const PITCH_DECAY = fr(0.971);
        const TOTAL_DELTA_PITCH = 720.0;
        const PHASE_DELTA = 4.0;
        const WOBBLE_AMPLITUDE = fr(18.1);
        const BOUNCE_FACTOR = 5.0;

        let decayingRot = false;
        let stuntRot = false;

        if (this.m_flags.onBit(eKartActionFlags.LargeFlip)) {
            this.m_framesFlipping = (this.m_framesFlipping + 1) & 0xffff;
        } else {
            if (this.m_deltaPitch < TOTAL_DELTA_PITCH) {
                this.m_deltaPitch = fr(this.m_deltaPitch + this.m_velPitch);
                this.m_pitch = fr(this.m_pitch - this.m_velPitch);
                this.m_velPitch = fr(this.m_velPitch * (this.m_velPitch > 1.0 ? PITCH_DECAY : 1.0));
            } else {
                this.m_pitch = 0.0;
            }

            let sin: number;

            if (Math.abs(this.m_flipPhase) < 360.0) {
                this.m_flipPhase = fr(this.m_flipPhase + PHASE_DELTA);
                sin = SinFIdx(fr(DEG2FIDX * this.m_flipPhase));
            } else {
                sin = 0.0;
            }

            const mat = new Matrix34f();
            mat.setAxisRotation(fr(DEG2RAD * fr(WOBBLE_AMPLITUDE * sin)), Vector3f.ez);
            this.m_rotation.setAxisRotation(
                fr(DEG2RAD * this.m_pitch),
                mat.ps_multVector(Vector3f.ex),
            );

            stuntRot = true;
        }

        let actionEnded = false;
        const status = this.status();
        const touchingGround = status.onBit(eStatus.TouchingGround);

        if (
            this.m_flags.offBit(eKartActionFlags.LandingFromFlip) &&
            touchingGround &&
            this.move().up().y > 0.0 &&
            this.m_frame > 50
        ) {
            this.m_flags.setBit(eKartActionFlags.LandingFromFlip);
            this.dynamics().setExtVel(this.move().up().proj(Vector3f.ey).mul(BOUNCE_FACTOR));
        }

        if ((this.m_currentAction !== Action.UNK_8 && this.m_frame < 10) || !touchingGround) {
            this.dynamics().setExtVel(new Vector3f(0.0, this.dynamics().extVel().y, 0.0));
        }

        if ((touchingGround && this.move().up().dot(Vector3f.ey) > 0.0) || this.m_frame >= 300) {
            if (this.m_frame >= 40) {
                status.resetBit(eStatus.LargeFlipHit);
            }

            if (this.m_frame <= 120) {
                if (this.m_flags.onBit(eKartActionFlags.LargeFlip)) {
                    if (this.m_framesFlipping > 30) {
                        actionEnded = true;
                    }
                } else {
                    if (this.m_frame >= 40 && this.m_frame <= 80) {
                        decayingRot = true;
                        this.m_flags.setBit(eKartActionFlags.LargeFlip);
                        status.resetBit(eStatus.LargeFlipHit);
                    }
                }
            } else {
                actionEnded = true;
            }
        }

        if (decayingRot) {
            this.physics().composeDecayingStuntRot(this.m_rotation);
        } else if (stuntRot) {
            this.physics().composeStuntRot(this.m_rotation);
        }

        return actionEnded;
    }

    /** @addr{0x80569A1C} */
    calcPressAction(): boolean {
        const extVel = this.extVel().clone();
        extVel.y = fmin(0.0, extVel.y);
        this.dynamics().setExtVel(extVel);

        return this.m_frame > this.m_crushTimer;
    }

    /* ================================ *
     *     END FUNCTIONS
     * ================================ */

    endStub(_arg: boolean): void {}

    /** @addr{0x8056837C} */
    endAction1(arg: boolean): void {
        if (arg) {
            this.physics().composeDecayingExtraRot(this.m_rotation);
        }
    }

    /** @addr{0x80568C7C} @addr{0x805686DC} @addr{0x80568F68} */
    endLaunchAction(arg: boolean): void {
        if (arg) {
            this.physics().composeDecayingExtraRot(this.m_rotation);
        }
    }
}

/* ================================ *
 *     ACTION TABLES
 * ================================ */

function ap(startSpeedMult: number, calcSpeedMult: number, priority: number): ActionParams {
    return { startSpeedMult: fr(startSpeedMult), calcSpeedMult: fr(calcSpeedMult), priority };
}

const s_actionParams: readonly ActionParams[] = [
    ap(0.98, 0.98, 1),
    ap(0.98, 0.98, 2),
    ap(0.96, 0.96, 4),
    ap(0.0, 0.96, 4),
    ap(0.0, 0.98, 4),
    ap(0.0, 0.96, 4),
    ap(0.0, 0.96, 4),
    ap(0.0, 0.0, 6),
    ap(0.0, 0.99, 6),
    ap(0.98, 0.98, 3),
    ap(0.98, 0.98, 3),
    ap(1.0, 1.0, 5),
    ap(0.0, 0.0, 3),
    ap(0.0, 0.0, 3),
    ap(0.0, 0.0, 3),
    ap(0.98, 0.98, 3),
    ap(0.0, 0.0, 3),
    ap(0.98, 0.98, 3),
];

function rp(
    initialAngleIncrement: number,
    minAngleIncrement: number,
    minMultiplier: number,
    initialMultiplierDecrement: number,
    slowdownThreshold: number,
    finalAngle: number,
): RotationParams {
    return {
        initialAngleIncrement: fr(initialAngleIncrement),
        minAngleIncrement: fr(minAngleIncrement),
        minMultiplier: fr(minMultiplier),
        initialMultiplierDecrement: fr(initialMultiplierDecrement),
        slowdownThreshold: fr(slowdownThreshold),
        finalAngle: fr(finalAngle),
    };
}

const s_rotationParams: readonly RotationParams[] = [
    rp(10.0, 1.5, 0.9, 0.005, 0.6, 360.0),
    rp(11.0, 1.5, 0.9, 0.0028, 0.7, 720.0),
    rp(11.0, 1.5, 0.9, 0.0028, 0.8, 1080.0),
    rp(7.0, 1.5, 0.9, 0.005, 0.6, 450.0),
    rp(9.0, 1.5, 0.9, 0.0028, 0.7, 810.0),
];

const startStub: StartActionFunc = (a) => a.startStub();
const startAction1: StartActionFunc = (a) => a.startAction1();
const startAction2: StartActionFunc = (a) => a.startAction2();
const startAction3: StartActionFunc = (a) => a.startAction3();
const startAction4: StartActionFunc = (a) => a.startAction4();
const startAction5: StartActionFunc = (a) => a.startAction5();
const startLargeFlipAction: StartActionFunc = (a) => a.startLargeFlipAction();
const startAction9: StartActionFunc = (a) => a.startAction9();
const startLongPressAction: StartActionFunc = (a) => a.startLongPressAction();
const startShortPressAction: StartActionFunc = (a) => a.startShortPressAction();
const startSpinShrinkAction: StartActionFunc = (a) => a.startSpinShrinkAction();

const s_onStart: readonly StartActionFunc[] = [
    startStub,
    startAction1,
    startAction2,
    startAction3,
    startAction4,
    startAction5,
    startStub,
    startLargeFlipAction,
    startLargeFlipAction,
    startAction9,
    startStub,
    startStub,
    startLongPressAction,
    startStub,
    startShortPressAction,
    startSpinShrinkAction,
    startStub,
    startStub,
];

const calcStub: CalcActionFunc = (a) => a.calcStub();
const calcAction1: CalcActionFunc = (a) => a.calcAction1();
const calcLaunchAction: CalcActionFunc = (a) => a.calcLaunchAction();
const calcAction4: CalcActionFunc = (a) => a.calcAction4();
const calcLargeFlipAction: CalcActionFunc = (a) => a.calcLargeFlipAction();
const calcPressAction: CalcActionFunc = (a) => a.calcPressAction();

const s_onCalc: readonly CalcActionFunc[] = [
    calcStub,
    calcAction1,
    calcLaunchAction,
    calcLaunchAction,
    calcAction4,
    calcLaunchAction,
    calcStub,
    calcLargeFlipAction,
    calcLargeFlipAction,
    calcAction1,
    calcStub,
    calcStub,
    calcPressAction,
    calcStub,
    calcPressAction,
    calcAction1,
    calcStub,
    calcStub,
];

const endStub: EndActionFunc = (a, arg) => a.endStub(arg);
const endAction1: EndActionFunc = (a, arg) => a.endAction1(arg);
const endLaunchAction: EndActionFunc = (a, arg) => a.endLaunchAction(arg);

const s_onEnd: readonly EndActionFunc[] = [
    endStub,
    endAction1,
    endLaunchAction,
    endLaunchAction,
    endLaunchAction,
    endLaunchAction,
    endStub,
    endStub,
    endStub,
    endAction1,
    endStub,
    endStub,
    endStub,
    endStub,
    endStub,
    endAction1,
    endStub,
    endStub,
];

if (
    s_actionParams.length !== MAX_ACTION ||
    s_onStart.length !== MAX_ACTION ||
    s_onCalc.length !== MAX_ACTION ||
    s_onEnd.length !== MAX_ACTION
) {
    throw new Error('KartAction: action table size mismatch');
}
