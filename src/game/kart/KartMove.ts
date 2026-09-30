/** Port of Kinoko source/game/kart/KartMove.{hh,cc} (KartMove and KartMoveBike). */

import { TBitFlag } from '../../egg/core/BitFlag';
import { box, type Box } from '../../egg/core/Box';
import {
    acos,
    atan2,
    DEG2FIDX,
    DEG2RAD,
    F32_EPSILON,
    fmax,
    fmin,
    fr,
    RAD2DEG,
    SinFIdx,
} from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { CollisionDirector } from '../field/CollisionDirector';
import { CollisionInfo } from '../field/KColData';
import {
    COL_TYPE_MOVING_WATER,
    COL_TYPE_SPECIAL_WALL,
    COL_TYPE_STICKY_ROAD,
    KCL_ANY,
    KCL_NONE,
    KCL_TYPE_BIT,
    KCL_TYPE_FLOOR,
} from '../field/KCollisionTypes';
import { ObjectDirector } from '../field/ObjectDirector';
import { ItemDirector } from '../item/ItemDirector';
import { KartCamera } from '../render/KartCamera';
import { CourseMap } from '../system/CourseMap';
import { RaceManager, Stage } from '../system/RaceManager';
import { Action, eKartActionFlags } from './KartAction';
import { KartBoost, Type as KartBoostType } from './KartBoost';
import { KartBurnout } from './KartBurnout';
import { eSurfaceFlags } from './KartCollide';
import { KartHalfPipe } from './KartHalfPipe';
import { KartJump, KartJumpBike, TrickType } from './KartJump';
import { KartObjectProxy } from './KartObjectProxy';
import { Stats } from './KartParam';
import { KartReject } from './KartReject';
import { KartScale } from './KartScale';
import { eStatus } from './Status';

// ---------------------------------------------------------------------------------------------
// Header types (KartMove.hh)
// ---------------------------------------------------------------------------------------------

/** C++ `KartMove::ePadType`. Also reachable as `KartMove.ePadType`. */
export enum ePadType {
    BoostPanel = 0,
    BoostRamp = 1,
    JumpPad = 2,
}

/** C++ `KartMove::DriftState`. Also reachable as `KartMove.DriftState`. */
export enum DriftState {
    NotDrifting = 0,
    ChargingMt = 1,
    ChargedMt = 2,
    ChargingSmt = 2,
    ChargedSmt = 3,
}

/** C++ `KartMove::PadType` */
export type PadType = TBitFlag<ePadType>;

/** C++ `KartMove::eFlags` (protected). */
enum eFlags {
    /** Set when Lakitu lets go of the player, cleared when landing. */
    Respawned = 0,
    /** Set when a wall bonk should cancel your drift. */
    DriftReset = 1,
    /** Set after holding a stand-still mini-turbo for 75 frames. */
    SsmtCharged = 2,
    LaunchBoost = 4,
    /** If set, activates SSMT when not pressing A or B. */
    SsmtLeeway = 5,
    /** Set when driving on a trickable surface. */
    TrickableSurface = 6,
    /** Set when our speed loss from wall collision is > 30.0f. */
    WallBounce = 8,
}

/** The direction the player is currently driving in. */
enum DrivingDirection {
    Forwards = 0,
    Braking = 1,
    /** Holding reverse but waiting on a 15 frame delay. */
    WaitingForBackwards = 2,
    Backwards = 3,
}

export interface JumpPadProperties {
    minSpeed: number;
    maxSpeed: number;
    velY: number;
}

/** Houses parameters that vary between the drift type (inward bike, outward bike, kart). */
export interface DriftingParameters {
    hopVelY: number;
    stabilizationFactor: number;
    _8: number;
    boostRotFactor: number;
}

/** Represents turning information which differs only between inside/outside drift. */
export interface TurningParameters {
    leanRotShallowFactor: number;
    leanRotIncRace: number;
    leanRotCapRace: number;
    driftStickXFactor: number;
    leanRotMaxDrift: number;
    leanRotMinDrift: number;
    leanRotIncCountdown: number;
    leanRotCapCountdown: number;
    leanRotIncSSMT: number;
    leanRotCapSSMT: number;
    leanRotDecayFactor: number;
    /** u16 */
    maxWheelieFrames: number;
}

const MINIMUM_DRIFT_THRESOLD = fr(0.55);

// ---------------------------------------------------------------------------------------------
// Constant tables (KartMove.cc)
// ---------------------------------------------------------------------------------------------

interface CannonParameter {
    speed: number;
    height: number;
    decelFactor: number;
    endDecel: number;
}

const CANNON_PARAMETERS: readonly Readonly<CannonParameter>[] = [
    { speed: 500.0, height: 0.0, decelFactor: 6000.0, endDecel: -1.0 },
    { speed: 500.0, height: 5000.0, decelFactor: 6000.0, endDecel: -1.0 },
    { speed: 120.0, height: 2000.0, decelFactor: 1000.0, endDecel: 45.0 },
];

function dp(
    hopVelY: number,
    stabilizationFactor: number,
    _8: number,
    boostRotFactor: number,
): Readonly<DriftingParameters> {
    return Object.freeze({ hopVelY, stabilizationFactor, _8, boostRotFactor });
}

const DRIFTING_PARAMS_ARRAY: readonly Readonly<DriftingParameters>[] = [
    dp(10.0, 0.5, 0.5, 1.0),
    dp(10.0, 0.5, 0.5, fr(0.2)),
    dp(10.0, fr(0.22), 0.5, fr(0.2)),
];

function jpp(minSpeed: number, maxSpeed: number, velY: number): Readonly<JumpPadProperties> {
    return Object.freeze({ minSpeed, maxSpeed, velY });
}

const JUMP_PAD_PROPERTIES: readonly Readonly<JumpPadProperties>[] = [
    jpp(50.0, 50.0, 35.0),
    jpp(50.0, 50.0, 47.0),
    jpp(59.0, 59.0, 30.0),
    jpp(73.0, 73.0, 45.0),
    jpp(73.0, 73.0, 53.0),
    jpp(56.0, 56.0, 50.0),
    jpp(55.0, 55.0, 35.0),
    jpp(56.0, 56.0, 50.0),
];

const JUMP_PAD_PROPERTIES_SHROOM_BOOST: readonly Readonly<JumpPadProperties>[] = [
    jpp(100.0, 100.0, 70.0),
    jpp(100.0, 100.0, 65.0),
];

const KART_TRICK_BOOST_DURATION: readonly number[] = [40, 70, 85];
const BIKE_TRICK_BOOST_DURATION: readonly number[] = [45, 80, 95];

function tp(
    leanRotShallowFactor: number,
    leanRotIncRace: number,
    leanRotCapRace: number,
    driftStickXFactor: number,
    leanRotMaxDrift: number,
    leanRotMinDrift: number,
    leanRotIncCountdown: number,
    leanRotCapCountdown: number,
    leanRotIncSSMT: number,
    leanRotCapSSMT: number,
    leanRotDecayFactor: number,
    maxWheelieFrames: number,
): Readonly<TurningParameters> {
    return Object.freeze({
        leanRotShallowFactor,
        leanRotIncRace,
        leanRotCapRace,
        driftStickXFactor,
        leanRotMaxDrift,
        leanRotMinDrift,
        leanRotIncCountdown,
        leanRotCapCountdown,
        leanRotIncSSMT,
        leanRotCapSSMT,
        leanRotDecayFactor,
        maxWheelieFrames,
    });
}

const TURNING_PARAMS_ARRAY: readonly Readonly<TurningParameters>[] = [
    tp(
        fr(0.8),
        fr(0.08),
        1.0,
        fr(0.1),
        fr(1.2),
        fr(0.8),
        fr(0.08),
        fr(0.6),
        fr(0.15),
        fr(1.6),
        fr(0.9),
        180,
    ),
    tp(
        1.0,
        fr(0.1),
        1.0,
        fr(0.05),
        1.5,
        fr(0.7),
        fr(0.08),
        fr(0.6),
        fr(0.15),
        fr(1.3),
        fr(0.9),
        180,
    ),
];

// Frequently used f32 literals.
const F_0_01 = fr(0.01);
const F_0_03 = fr(0.03);
const F_0_05 = fr(0.05);
const F_0_1 = fr(0.1);
const F_0_2 = fr(0.2);
const F_0_3 = fr(0.3);
const F_0_4 = fr(0.4);
const F_0_6 = fr(0.6);
const F_0_7 = fr(0.7);
const F_0_8 = fr(0.8);
const F_0_9 = fr(0.9);
const F_0_95 = fr(0.95);
const F_0_98 = fr(0.98);
const F_0_99 = fr(0.99);
const F_0_999 = fr(0.999);
const F_0_015 = fr(0.015);
const F_0_15 = fr(0.15);
const F_1_3 = fr(1.3);
const F_1_4 = fr(1.4);

/** s16 conversion */
function s16(x: number): number {
    return (x << 16) >> 16;
}

/** u16 conversion */
function u16(x: number): number {
    return x & 0xffff;
}

/** Responsible for reacting to player inputs and moving the kart. */
export class KartMove extends KartObjectProxy {
    static readonly ePadType = ePadType;
    static readonly DriftState = DriftState;
    static readonly MINIMUM_DRIFT_THRESOLD = MINIMUM_DRIFT_THRESOLD;

    /** The speed associated with the current character/vehicle stats. */
    protected m_baseSpeed = 0.0;
    /** Base speed + boosts + wheelies, restricted to the hard speed limit. */
    protected m_softSpeedLimit = 0.0;
    /** Current speed, restricted to the soft speed limit. */
    protected m_speed = 0.0;
    /** Last frame's speed, cached to calculate angular velocity. */
    protected m_lastSpeed = 0.0;
    /** Offset 0x28. It's only ever just a copy of m_speed. */
    protected m_processedSpeed = 0.0;
    /** Absolute speed cap. It's 120, unless you're in a bullet (140). */
    protected m_hardSpeedLimit = 0.0;
    /** Captures the acceleration from player input and boosts. */
    protected m_acceleration = 0.0;
    /** After 5 frames of airtime, this causes speed to slowly decay. */
    protected m_speedDragMultiplier = 0.0;
    /** A smoothed up vector, mostly used after significant airtime. */
    protected m_smoothedUp = new Vector3f();
    /** Vector perpendicular to the floor, pointing upwards. */
    protected m_up = new Vector3f();
    protected m_landingDir = new Vector3f();
    protected m_dir = new Vector3f();
    /** m_speed from the previous frame but with signed magnitude. */
    protected m_lastDir = new Vector3f();
    protected m_vel1Dir = new Vector3f();
    protected m_smoothedForward = new Vector3f();
    protected m_dirDiff = new Vector3f();
    protected m_hasLandingDir = false;
    /** The facing angle of an outward-drifting vehicle. */
    protected m_outsideDriftAngle = 0.0;
    protected m_landingAngle = 0.0;
    /** Used to compute the next m_outsideDriftAngle. */
    protected m_outsideDriftLastDir = new Vector3f();
    /** m_speedRatio but capped at 1.0f. */
    protected m_speedRatioCapped = 0.0;
    /** The ratio between current speed and the player's base speed stat. */
    protected m_speedRatio = 0.0;
    /** Float between 0-1 that scales the player's speed on offroad. */
    protected m_kclSpeedFactor = 0.0;
    /** Float between 0-1 that scales the player's turning radius on offroad. */
    protected m_kclRotFactor = 0.0;
    /** The slowest speed multiplier of each wheel's floor collision. */
    protected m_kclWheelSpeedFactor = 0.0;
    /** The slowest rotation multiplier of each wheel's floor collision. */
    protected m_kclWheelRotFactor = 0.0;
    /** u16. The number of tires colliding with the floor. */
    protected m_floorCollisionCount = 0;
    /** s32. A ternary for the direction of our hop, 0 if still neutral hopping. */
    protected m_hopStickX = 0;
    /** s32. A timer that can prevent subsequent hops until reset. */
    protected m_hopFrame = 0;
    /** The up vector when hopping. */
    protected m_hopUp = new Vector3f();
    /** Used for outward drift. Tracks the forward vector of our rotation. */
    protected m_hopDir = new Vector3f();
    /** Induces x-axis angular velocity based on up/down stick input. */
    protected m_divingRot = 0.0;
    protected m_standStillBoostRot = 0.0;
    protected m_driftState = DriftState.NotDrifting;
    /** u16. A value between 0 and 270 representing current MT charge. */
    protected m_mtCharge = 0;
    /** u16. A value between 0 and 300 representing current SMT charge. */
    protected m_smtCharge = 0;
    /** Added to angular velocity when outside drifting. */
    protected m_outsideDriftBonus = 0.0;
    protected m_boost = new KartBoost();
    /** s16 */
    protected m_zipperBoostTimer = 0;
    /** s16 */
    protected m_zipperBoostMax = 0;
    protected m_reject = new KartReject();
    /** s16. How many frames until the player is affected by offroad. */
    protected m_offroadInvincibility = 0;
    /** s16. Increments every frame up to 75 when charging stand-still MT. */
    protected m_ssmtCharge = 0;
    /** s16. Frames to forgive letting go of A before clearing SSMT charge. */
    protected m_ssmtLeewayTimer = 0;
    /** s16. Counter that tracks delay before starting to reverse. */
    protected m_ssmtDisableAccelTimer = 0;
    /** The "true" turn magnitude. Equal to m_weightedTurn unless drifting. */
    protected m_realTurn = 0.0;
    /** Magnitude+direction of stick input, factoring in the kart's stats. */
    protected m_weightedTurn = 0.0;
    /** Normally the unit vector, but may vary due to crush animations. */
    protected m_scale = new Vector3f();
    /** @unused Always 1.0f */
    protected m_totalScale = 0.0;
    protected m_hitboxScale = 0.0;
    protected m_shockSpeedMultiplier = 0.0;
    /** u16. Number of frames until the mushroom boost runs out. */
    protected m_mushroomBoostTimer = 0;
    protected m_invScale = 0.0;
    /** u16 */
    protected m_shockTimer = 0;
    /** u16. Number of frames until player will be uncrushed. */
    protected m_crushTimer = 0;
    /** u32 */
    protected m_nonZipperAirtime = 0;
    /** Snaps the player to a minimum speed when first touching a jump pad. */
    protected m_jumpPadMinSpeed = 0.0;
    protected m_jumpPadMaxSpeed = 0.0;
    protected m_jumpPadBoostMultiplier = 0.0;
    protected m_jumpPadSoftSpeedLimit = 0.0;
    protected m_jumpPadProperties: Readonly<JumpPadProperties> | null = null;
    /** u16 */
    protected m_rampBoost = 0;
    protected m_autoDriftAngle = 0.0;
    /** s16 */
    protected m_autoDriftStartFrameCounter = 0;
    protected m_cannonEntryOfsLength = 0.0;
    protected m_cannonEntryPos = new Vector3f();
    protected m_cannonEntryOfs = new Vector3f();
    protected m_cannonOrthog = new Vector3f();
    protected m_cannonProgress = new Vector3f();
    /** Relative velocity due to a hop. Starts at 10 and decreases with gravity. */
    protected m_hopVelY = 0.0;
    /** Relative position as the result of a hop. Starts at 0. */
    protected m_hopPosY = 0.0;
    /** Always main gravity (-1.3f). */
    protected m_hopGravity = 0.0;
    /** s16. The number of frames elapsed after position snap from respawn. */
    protected m_timeInRespawn = 0;
    /** s16. Counts down from 4 when pressing A before landing from respawn. */
    protected m_respawnPreLandTimer = 0;
    /** s16. Counts up to 4 if not accelerating after respawn landing. */
    protected m_respawnPostLandTimer = 0;
    /** s16 */
    protected m_respawnTimer = 0;
    /** s16. Set when a Reaction::SmallBump collision occurs. */
    protected m_bumpTimer = 0;
    /** Current state of driver's direction. */
    protected m_drivingDirection = DrivingDirection.Forwards;
    /** s16. Tracks the 15f delay before reversing. */
    protected m_backwardsAllowCounter = 0;
    protected m_padType: PadType = new TBitFlag<ePadType>();
    protected m_flags = new TBitFlag<eFlags>();
    protected m_jump!: KartJump;
    /** Pertains to zipper physics. */
    protected m_halfPipe!: KartHalfPipe;
    /** Manages scaling due to TF stompers and MH cars. */
    protected m_kartScale!: KartScale;
    /** Manages the state of start boost burnout. */
    protected m_burnout = new KartBurnout();
    /** Drift-type-specific parameters. */
    protected m_driftingParams: Readonly<DriftingParameters> = DRIFTING_PARAMS_ARRAY[0]!;
    /** Float in range [-1, 1]. Represents stick magnitude + direction. */
    protected m_rawTurn = 0.0;

    /** @addr{0x80577FC4} */
    constructor() {
        super();
        this.m_smoothedUp.copy(Vector3f.ey);
        this.m_scale.set(1.0, 1.0, 1.0);
        this.m_totalScale = 1.0;
        this.m_hitboxScale = 1.0;
        this.m_shockSpeedMultiplier = 1.0;
        this.m_invScale = 1.0;
        this.m_padType.makeAllZero();
        this.m_flags.makeAllZero();
    }

    /** @addr{0x8057821C} */
    createSubsystems(stats: Readonly<Stats>): void {
        this.m_jump = new KartJump(this);
        this.m_halfPipe = new KartHalfPipe();
        this.m_kartScale = new KartScale(stats);
    }

    /**
     * @addr{0x8057A8B4}
     * Each frame, looks at player input and kart stats. Saves turn-related info.
     */
    calcTurn(): void {
        this.m_realTurn = 0.0;
        this.m_rawTurn = 0.0;

        const status = this.status();

        if (
            status.onBit(
                eStatus.InAction,
                eStatus.CannonStart,
                eStatus.InCannon,
                eStatus.OverZipper,
            )
        ) {
            return;
        }

        if (status.onBit(eStatus.BeforeRespawn)) {
            return;
        }

        if (status.offBit(eStatus.Hop) || this.m_hopStickX === 0) {
            this.m_rawTurn = -this.state().stickX();
            if (status.onBit(eStatus.JumpPadMushroomCollision)) {
                this.m_rawTurn = fr(this.m_rawTurn * fr(0.35));
            } else if (status.onBit(eStatus.AirtimeOver20)) {
                this.m_rawTurn = fr(this.m_rawTurn * F_0_01);
            }
        } else {
            this.m_rawTurn = fr(this.m_hopStickX);
        }

        let reactivity: number;
        if (this.state().isDrifting()) {
            reactivity = this.param().stats().driftReactivity;
        } else {
            reactivity = this.param().stats().handlingReactivity;
        }

        this.m_weightedTurn = fr(
            fr(this.m_rawTurn * reactivity) + fr(this.m_weightedTurn * fr(1.0 - reactivity)),
        );
        this.m_weightedTurn = fmax(-1.0, fmin(1.0, this.m_weightedTurn));

        this.m_realTurn = this.m_weightedTurn;

        if (!this.state().isDrifting()) {
            return;
        }

        this.m_realTurn = fr(fr(this.m_weightedTurn + fr(this.m_hopStickX)) * 0.5);
        this.m_realTurn = fr(fr(this.m_realTurn * F_0_8) + fr(F_0_2 * fr(this.m_hopStickX)));
        this.m_realTurn = fmax(-1.0, fmin(1.0, this.m_realTurn));
    }

    /** @addr{0x8057829C} */
    setTurnParams(): void {
        this.init(false, false);
        this.m_dir.copy(this.bodyFront());
        this.m_lastDir.copy(this.m_dir);
        this.m_vel1Dir.copy(this.m_dir);
        this.m_landingDir.copy(this.m_dir);
        this.m_smoothedForward.copy(this.m_dir);
        this.m_outsideDriftLastDir.copy(this.m_dir);
        this.m_driftingParams =
            DRIFTING_PARAMS_ARRAY[this.param().stats().driftType as number]!;
        this.m_kartScale.reset();
    }

    /** @addr{0x805784D4} */
    init(b1: boolean, b2: boolean): void {
        this.m_lastSpeed = 0.0;
        this.m_baseSpeed = this.param().stats().speed;
        this.m_jumpPadSoftSpeedLimit = this.m_softSpeedLimit = this.param().stats().speed;
        this.m_speed = 0.0;
        this.setKartSpeedLimit();
        this.m_acceleration = 0.0;
        this.m_speedDragMultiplier = 1.0;
        this.m_up.copy(Vector3f.ey);
        this.m_smoothedUp.copy(Vector3f.ey);
        this.m_smoothedForward.copy(Vector3f.ez);
        this.m_vel1Dir.copy(Vector3f.ez);
        this.m_lastDir.copy(Vector3f.ez);
        this.m_dir.copy(Vector3f.ez);
        this.m_landingDir.copy(Vector3f.ez);
        this.m_dirDiff.copy(Vector3f.zero);
        this.m_hasLandingDir = false;
        this.m_outsideDriftAngle = 0.0;
        this.m_landingAngle = 0.0;
        this.m_outsideDriftLastDir.copy(Vector3f.ez);
        this.m_speedRatio = 0.0;
        this.m_speedRatioCapped = 0.0;
        this.m_kclSpeedFactor = 1.0;
        this.m_kclRotFactor = 1.0;
        this.m_kclWheelSpeedFactor = 1.0;
        this.m_kclWheelRotFactor = 1.0;

        if (!b2) {
            this.m_floorCollisionCount = 0;
        }

        this.m_hopStickX = 0;
        this.m_hopFrame = 0;
        this.m_hopUp.copy(Vector3f.ey);
        this.m_hopDir.copy(Vector3f.ez);
        this.m_divingRot = 0.0;
        this.m_standStillBoostRot = 0.0;
        this.m_driftState = DriftState.NotDrifting;
        this.m_smtCharge = 0;
        this.m_mtCharge = 0;
        this.m_outsideDriftBonus = 0.0;
        this.m_boost.reset();
        this.m_zipperBoostTimer = 0;
        this.m_zipperBoostMax = 0;
        this.m_reject.reset();
        this.m_offroadInvincibility = 0;
        this.m_ssmtCharge = 0;
        this.m_ssmtLeewayTimer = 0;
        this.m_ssmtDisableAccelTimer = 0;
        this.m_nonZipperAirtime = 0;
        this.m_realTurn = 0.0;
        this.m_weightedTurn = 0.0;

        if (!b1) {
            this.m_scale.setAll(1.0);
            this.m_totalScale = 1.0;
            this.m_hitboxScale = 1.0;
            this.m_shockSpeedMultiplier = 1.0;
            this.m_invScale = 1.0;
            this.m_mushroomBoostTimer = 0;
            this.m_shockTimer = 0;
            this.m_crushTimer = 0;
        }

        this.m_jumpPadMinSpeed = 0.0;
        this.m_jumpPadMaxSpeed = 0.0;
        this.m_jumpPadBoostMultiplier = 0.0;
        this.m_jumpPadProperties = null;
        this.m_rampBoost = 0;
        this.m_autoDriftAngle = 0.0;
        this.m_autoDriftStartFrameCounter = 0;

        this.m_cannonEntryOfsLength = 0.0;
        this.m_cannonEntryPos.setZero();
        this.m_cannonEntryOfs.setZero();
        this.m_cannonOrthog.setZero();
        this.m_cannonProgress.setZero();

        this.m_hopVelY = 0.0;
        this.m_hopPosY = 0.0;
        this.m_hopGravity = 0.0;
        this.m_timeInRespawn = 0;
        this.m_respawnPreLandTimer = 0;
        this.m_respawnPostLandTimer = 0;
        this.m_respawnTimer = 0;
        this.m_bumpTimer = 0;
        this.m_drivingDirection = DrivingDirection.Forwards;
        this.m_padType.makeAllZero();
        this.m_flags.makeAllZero();
        this.m_jump.reset();
        this.m_halfPipe.reset();
        this.m_rawTurn = 0.0;
    }

    /** @addr{0x8058348C} */
    clear(): void {
        const status = this.status();

        if (status.onBit(eStatus.OverZipper)) {
            status.setBit(eStatus.ActionMidZipper);
        }

        this.clearBoost();
        this.clearJumpPad();
        this.clearRampBoost();
        this.clearZipperBoost();
        this.clearSsmt();
        this.clearOffroadInvincibility();
        this.m_halfPipe.end(false);
        this.m_jump.end();
        this.clearRejectRoad();
    }

    /**
     * @addr{0x80584044}
     * Initializes the kart's position and rotation. Calls tire suspension initializers.
     */
    setInitialPhysicsValues(position: Readonly<Vector3f>, angles: Readonly<Vector3f>): void {
        const quaternion = Quatf.FromRPY(angles.mul(DEG2RAD));
        let newPos = position.clone();
        const info = new CollisionInfo();
        const kcl_flags = box<number>(KCL_NONE);

        const bColliding = CollisionDirector.Instance()!.checkSphereFullPush(
            100.0,
            newPos,
            Vector3f.inf,
            KCL_ANY,
            info,
            kcl_flags,
            0,
        );

        if (bColliding && (kcl_flags.value & KCL_TYPE_FLOOR) !== 0) {
            newPos = newPos.add(info.tangentOff).add(info.floorNrm.mul(-100.0));
            newPos.addEq(info.floorNrm.mul(this.bsp().initialYPos));
        }

        this.setPos(newPos);
        this.setRot(quaternion);

        this.sub().initPhysicsValues();

        this.physics().setPos(this.pos());
        this.physics().setVelocity(this.dynamics().velocity());

        this.m_landingDir.copy(this.bodyFront());
        this.m_dir.copy(this.bodyFront());
        this.m_smoothedForward.copy(this.bodyFront());
        this.m_up.copy(this.bodyUp());
        this.dynamics().setTop(this.m_up);

        for (let tireIdx = 0; tireIdx < this.suspCount(); ++tireIdx) {
            this.suspension(tireIdx).setInitialState();
        }
    }

    /**
     * @addr{0x805788DC}
     * Each frame, calculates the kart's movement.
     */
    calc(): void {
        const status = this.status();

        if (status.onBit(eStatus.InRespawn)) {
            this.calcInRespawn();
            return;
        }

        this.dynamics().resetInternalVelocity();
        this.m_burnout.calc();
        this.calcSsmtStart();
        this.m_halfPipe.calc();
        this.calcTop();
        this.tryEndJumpPad();
        this.calcRespawnBoost();
        this.calcSpecialFloor();
        this.m_jump.calc();

        this.m_bumpTimer = Math.max(this.m_bumpTimer - 1, 0);

        this.calcAutoDrift();
        this.calcDirs();
        this.calcStickyRoad();
        this.calcOffroad();
        this.calcTurn();

        if (status.offBit(eStatus.AutoDrift)) {
            this.calcManualDrift();
        }

        this.calcWheelie();
        this.calcSsmt();
        this.calcBoost();
        this.calcMushroomBoost();
        this.calcZipperBoost();
        this.calcShock();
        this.calcCrushed();
        this.calcScale();

        if (status.onBit(eStatus.InCannon)) {
            this.calcCannon();
        }

        this.calcOffroadInvincibility();
        this.calcVehicleSpeed();
        this.calcAcceleration();
        this.calcRotation();
    }

    /** @addr{0x80584334} */
    calcRespawnStart(): void {
        const RESPAWN_HEIGHT = 700.0;

        const jugemPoint = RaceManager.Instance()!.jugemPoint()!;
        const jugemPos = jugemPoint.pos();
        const jugemRot = jugemPoint.rot();

        const respawnPos = jugemPos.clone();
        respawnPos.y = fr(respawnPos.y + RESPAWN_HEIGHT);
        const respawnRot = new Vector3f(0.0, jugemRot.y, 0.0);

        this.setInitialPhysicsValues(respawnPos, respawnRot);
        // Real game (not in Kinoko, render only; NTSC-U 0x8057DBF4): snap the camera behind the kart.
        KartCamera.Instance()?.respawn();

        ItemDirector.Instance()!.kartItem(0).clear();

        this.status().resetBit(eStatus.TriggerRespawn).setBit(eStatus.InRespawn);
    }

    /** @addr{0x80579A50} */
    calcInRespawn(): void {
        const LAKITU_VELOCITY = 1.5;
        const RESPAWN_DURATION = 110;

        const status = this.status();

        if (status.offBit(eStatus.InRespawn)) {
            return;
        }

        const newPos = this.pos().clone();
        newPos.y = fr(newPos.y - LAKITU_VELOCITY);
        this.dynamics().setPos(newPos);
        this.dynamics().setNoGravity(true);

        this.m_timeInRespawn = s16(this.m_timeInRespawn + 1);
        if (this.m_timeInRespawn > RESPAWN_DURATION) {
            status
                .resetBit(eStatus.InRespawn)
                .setBit(eStatus.AfterRespawn, eStatus.RespawnKillY);
            this.m_timeInRespawn = 0;
            this.m_flags.setBit(eFlags.Respawned);
            this.dynamics().setNoGravity(false);
        }
    }

    /** @addr{0x80581C90} */
    calcRespawnBoost(): void {
        const RESPAWN_BOOST_DURATION = 30;
        const RESPAWN_BOOST_INPUT_LENIENCY = 4;

        const status = this.status();

        if (status.onBit(eStatus.AfterRespawn)) {
            if (status.onBit(eStatus.TouchingGround)) {
                if (this.m_respawnPreLandTimer > 0) {
                    if (status.offBit(eStatus.BeforeRespawn, eStatus.InAction)) {
                        this.activateBoost(KartBoostType.AllMt, RESPAWN_BOOST_DURATION);
                        this.m_respawnTimer = RESPAWN_BOOST_DURATION;
                    }
                } else {
                    this.m_respawnPostLandTimer = RESPAWN_BOOST_INPUT_LENIENCY;
                }

                status.resetBit(eStatus.AfterRespawn);
                this.m_flags.resetBit(eFlags.Respawned);
            }

            this.m_respawnPreLandTimer = Math.max(0, this.m_respawnPreLandTimer - 1);

            if (this.m_flags.onBit(eFlags.Respawned) && status.onBit(eStatus.AccelerateStart)) {
                this.m_respawnPreLandTimer = RESPAWN_BOOST_INPUT_LENIENCY;
                this.m_flags.resetBit(eFlags.Respawned);
            }
        } else {
            if (this.m_respawnPostLandTimer > 0) {
                if (status.onBit(eStatus.AccelerateStart)) {
                    if (status.offBit(eStatus.BeforeRespawn, eStatus.InAction)) {
                        this.activateBoost(KartBoostType.AllMt, RESPAWN_BOOST_DURATION);
                        this.m_respawnTimer = RESPAWN_BOOST_DURATION;
                    }

                    this.m_respawnPostLandTimer = 0;
                }

                this.m_respawnPostLandTimer = Math.max(0, this.m_respawnPostLandTimer - 1);
            } else {
                status.resetBit(eStatus.RespawnKillY);
            }
        }

        this.m_respawnTimer = Math.max(0, this.m_respawnTimer - 1);
    }

    /** @addr{0x8057D398} */
    calcTop(): void {
        let stabilizationFactor = F_0_1;
        this.m_hasLandingDir = false;
        let inputTop = this.state().top().clone();
        const status = this.status();

        if (status.onBit(eStatus.GroundStart) && this.m_nonZipperAirtime >= 3) {
            this.m_smoothedUp.copy(inputTop);
            this.m_up.copy(inputTop);
            this.m_landingDir.copy(this.m_dir.perpInPlane(this.m_smoothedUp, true));
            this.m_dirDiff.copy(this.m_landingDir.proj(this.m_landingDir));
            this.m_hasLandingDir = true;
        } else {
            if (status.onBit(eStatus.Hop) && this.m_hopPosY > 0.0) {
                stabilizationFactor = this.m_driftingParams.stabilizationFactor;
            } else if (status.onBit(eStatus.TouchingGround)) {
                if (
                    (this.m_flags.onBit(eFlags.TrickableSurface) ||
                        this.state().trickableTimer() > 0) &&
                    inputTop.dot(this.m_dir) > 0.0 &&
                    this.m_speed > 50.0 &&
                    this.collide().surfaceFlags().onBit(eSurfaceFlags.NotTrickable)
                ) {
                    inputTop = this.m_up.clone();
                } else {
                    this.m_up.copy(inputTop);
                }

                let scalar = F_0_8;

                if (
                    status.onBit(eStatus.HalfPipeRamp) ||
                    (status.offBit(
                        eStatus.Boost,
                        eStatus.RampBoost,
                        eStatus.Wheelie,
                        eStatus.OverZipper,
                    ) &&
                        (status.offBit(eStatus.ZipperBoost) || this.m_zipperBoostTimer > 15))
                ) {
                    const topDotZ = fr(
                        F_0_8 - fr(6.0 * Math.abs(inputTop.dot(this.componentZAxis()))),
                    );
                    scalar = fmin(F_0_8, fmax(F_0_3, topDotZ));
                }

                this.m_smoothedUp.addEq(inputTop.sub(this.m_smoothedUp).mul(scalar));
                this.m_smoothedUp.normalise();

                const bodyDotFront = this.bodyFront().dot(this.m_smoothedUp);

                if (bodyDotFront < -F_0_1) {
                    stabilizationFactor = fr(
                        stabilizationFactor + fmin(F_0_2, fr(Math.abs(bodyDotFront) * 0.5)),
                    );
                }

                if (this.collide().surfaceFlags().onBit(eSurfaceFlags.BoostRamp)) {
                    stabilizationFactor = F_0_4;
                }
            } else {
                this.calcAirtimeTop();
            }
        }

        this.dynamics().setStabilizationFactor(stabilizationFactor);

        this.m_nonZipperAirtime = status.onBit(eStatus.OverZipper) ? 0 : this.state().airtime();
        this.m_flags.changeBit(
            this.collide().surfaceFlags().onBit(eSurfaceFlags.Trickable),
            eFlags.TrickableSurface,
        );
    }

    /**
     * @addr{0x8057D888}
     * Calculates rotation of the bike due to excessive airtime.
     */
    calcAirtimeTop(): void {
        const status = this.status();

        if (status.onBit(eStatus.OverZipper) || status.offBit(eStatus.AirtimeOver20)) {
            return;
        }

        if (this.m_smoothedUp.y <= F_0_99) {
            this.m_smoothedUp.addEq(Vector3f.ey.sub(this.m_smoothedUp).mul(F_0_03));
            this.m_smoothedUp.normalise();
        } else {
            this.m_smoothedUp.copy(Vector3f.ey);
        }

        if (this.m_up.y <= F_0_99) {
            this.m_up.addEq(Vector3f.ey.sub(this.m_up).mul(F_0_03));
            this.m_up.normalise();
        } else {
            this.m_up.copy(Vector3f.ey);
        }
    }

    /**
     * @addr{0x80587590}
     * Every frame, calculates any boost resulting from a boost panel.
     */
    calcSpecialFloor(): void {
        const raceMgr = RaceManager.Instance()!;
        if (!raceMgr.isStageReached(Stage.Race)) {
            return;
        }

        if (this.m_padType.onBit(ePadType.BoostPanel)) {
            this.tryStartBoostPanel();
        }

        if (this.m_padType.onBit(ePadType.BoostRamp)) {
            this.tryStartBoostRamp();
        }

        if (this.m_padType.onBit(ePadType.JumpPad)) {
            this.tryStartJumpPad();
        }

        this.m_padType.makeAllZero();
    }

    /** @addr{0x8057A140} */
    calcDirs(): void {
        const right = this.dynamics().mainRot().rotateVector(Vector3f.ex);
        const local_88 = right.cross(this.m_smoothedUp);
        local_88.normalise();
        this.m_flags.setBit(eFlags.LaunchBoost);
        const status = this.status();

        if (
            status.offBit(eStatus.InATrick, eStatus.OverZipper) &&
            (((status.onBit(eStatus.TouchingGround) ||
                status.offBit(eStatus.RampBoost) ||
                !this.m_jump.isBoostRampEnabled()) &&
                status.offBit(eStatus.JumpPad) &&
                this.state().airtime() <= 5) ||
                status.onBit(eStatus.JumpPadMushroomCollision, eStatus.NoSparkInvisibleWall))
        ) {
            let local_94 = local_88.clone();
            if (status.onBit(eStatus.Hop)) {
                local_94 = this.m_hopDir.clone();
            }

            const mat = new Matrix34f();
            mat.setAxisRotation(
                fr(
                    DEG2RAD *
                        fr(fr(this.m_autoDriftAngle + this.m_outsideDriftAngle) + this.m_landingAngle),
                ),
                this.m_smoothedUp,
            );
            let local_b8 = mat.multVector(local_94);
            local_b8 = local_b8.perpInPlane(this.m_smoothedUp, true);

            const dirDiff = local_b8.sub(this.m_dir);

            if (dirDiff.squaredLength() <= F32_EPSILON) {
                this.m_dir.copy(local_b8);
                this.m_dirDiff.setZero();
            } else {
                const origDirCross = this.m_dir.cross(local_b8);
                this.m_dirDiff.addEq(dirDiff.mul(this.m_kclRotFactor));
                this.m_dir.addEq(this.m_dirDiff);
                this.m_dir.normalise();
                this.m_dirDiff.mulEq(F_0_1);
                const newDirCross = this.m_dir.cross(local_b8);

                if (origDirCross.dot(newDirCross) < 0.0) {
                    this.m_dir.copy(local_b8);
                    this.m_dirDiff.setZero();
                }
            }

            this.m_vel1Dir.copy(this.m_dir.perpInPlane(this.m_smoothedUp, true));
            this.m_flags.resetBit(eFlags.LaunchBoost);
        } else {
            this.m_vel1Dir.copy(this.m_dir);
        }

        if (status.offBit(eStatus.OverZipper)) {
            this.m_jump.tryStart(this.m_smoothedUp.cross(this.m_dir));
        }

        const nextDir = this.m_up.cross(local_88);
        this.m_smoothedForward.copy(nextDir.cross(this.m_up));
        this.m_smoothedForward.normalise();

        if (this.m_hasLandingDir) {
            const dot = this.m_dir.dot(this.m_landingDir);
            const cross = this.m_dir.cross(this.m_landingDir);
            const crossDot = cross.length();
            let angle = atan2(crossDot, dot);
            angle = Math.abs(angle);

            let fVar4 = 1.0;
            if (cross.dot(this.m_smoothedUp) < 0.0) {
                fVar4 = -1.0;
            }

            this.m_landingAngle = fr(this.m_landingAngle + fr(fr(angle * RAD2DEG) * fVar4));
        }

        if (this.m_landingAngle <= 0.0) {
            if (this.m_landingAngle < 0.0) {
                this.m_landingAngle = fmin(0.0, fr(this.m_landingAngle + 2.0));
            }
        } else {
            this.m_landingAngle = fmax(0.0, fr(this.m_landingAngle - 2.0));
        }
    }

    /** @addr{0x80583B88} */
    calcStickyRoad(): void {
        const STICKY_RADIUS = 200.0;
        const STICKY_MASK =
            (KCL_TYPE_BIT(COL_TYPE_STICKY_ROAD) | KCL_TYPE_BIT(COL_TYPE_MOVING_WATER)) >>> 0;

        const status = this.status();

        if (status.onBit(eStatus.OverZipper)) {
            status.resetBit(eStatus.StickyRoad);
            return;
        }

        if (
            (status.offBit(eStatus.StickyRoad) &&
                this.collide().surfaceFlags().offBit(eSurfaceFlags.Trickable)) ||
            Math.abs(this.m_speed) <= 20.0
        ) {
            return;
        }

        const pos = this.dynamics().pos().clone();
        const vel = this.dynamics().movingObjVel().add(this.m_vel1Dir.mul(this.m_speed));
        const colInfo = new CollisionInfo();
        colInfo.bbox.setZero();
        const kcl_flags = box<number>(KCL_NONE);
        let stickyRoad = false;

        for (let i = 0; i < 3; ++i) {
            const newPos = pos.add(vel);
            if (
                CollisionDirector.Instance()!.checkSphereFull(
                    STICKY_RADIUS,
                    newPos,
                    Vector3f.inf,
                    STICKY_MASK,
                    colInfo,
                    kcl_flags,
                    0,
                )
            ) {
                this.m_vel1Dir.copy(this.m_vel1Dir.perpInPlane(colInfo.floorNrm, true));
                this.dynamics().setMovingObjVel(
                    this.dynamics().movingObjVel().rej(colInfo.floorNrm),
                );
                this.dynamics().setMovingRoadVel(
                    this.dynamics().movingRoadVel().rej(colInfo.floorNrm),
                );

                if (status.onBit(eStatus.MovingWaterStickyRoad)) {
                    this.m_up.copy(colInfo.floorNrm);
                    this.m_smoothedUp.copy(colInfo.floorNrm);
                }

                stickyRoad = true;

                break;
            }
            vel.mulEq(0.5);
            pos.addEq(this.componentYAxis().mul(-STICKY_RADIUS));
        }

        if (!stickyRoad) {
            status.resetBit(eStatus.StickyRoad);
        }
    }

    /**
     * @addr{0x8057C3D4}
     * Each frame, computes rotation and speed scalars from the floor KCL.
     */
    calcOffroad(): void {
        const status = this.status();

        if (status.onBit(eStatus.BoostOffroadInvincibility)) {
            this.m_kclSpeedFactor = 1.0;
            this.m_kclRotFactor = this.param().stats().kclRot[0]!;
        } else {
            const anyWheel = status.onBit(eStatus.AnyWheelCollision);
            if (anyWheel) {
                this.m_kclSpeedFactor = this.m_kclWheelSpeedFactor;
                this.m_floorCollisionCount =
                    this.m_floorCollisionCount !== 0 ? this.m_floorCollisionCount : 1;
                this.m_kclRotFactor = fr(
                    this.m_kclWheelRotFactor / fr(this.m_floorCollisionCount),
                );
            }

            if (status.onBit(eStatus.VehicleBodyFloorCollision)) {
                const colData = this.collisionData();
                if (anyWheel) {
                    if (colData.speedFactor < this.m_kclWheelSpeedFactor) {
                        this.m_kclSpeedFactor = colData.speedFactor;
                    }
                    this.m_kclRotFactor = fr(
                        fr(this.m_kclWheelRotFactor + colData.rotFactor) /
                            fr(this.m_floorCollisionCount + 1),
                    );
                } else {
                    this.m_kclSpeedFactor = colData.speedFactor;
                    this.m_kclRotFactor = colData.rotFactor;
                }
            }
        }

        this.calcRisingWater();
    }

    /** @addr{0x8058677C} */
    calcRisingWater(): void {
        const objDir = ObjectDirector.Instance()!;
        const psea = objDir.psea();
        if (!psea) {
            return;
        }

        let pos = this.wheelPos(0).y;
        const count = this.tireCount();
        for (let wheelIdx = 0; wheelIdx < count; ++wheelIdx) {
            const tmp = this.wheelEdgePos(wheelIdx).y;
            if (wheelIdx === 0 || tmp < pos) {
                pos = tmp;
            }
        }

        if (objDir.risingWaterKillPlaneHeight() > pos) {
            this.collide().activateOob(true, null, false, false);
        }

        const dist = -objDir.distAboveRisingWater(pos);
        if (dist > 0.0 && this.status().offBit(eStatus.BoostOffroadInvincibility)) {
            const speedScale = fmin(1.0, fr(dist / 100.0));
            this.m_kclSpeedFactor = fr(
                1.0 - fr(fr(1.0 - this.param().stats().kclSpeed[3]!) * speedScale),
            );
        }
    }

    /** @addr{0x80582694} */
    calcBoost(): void {
        const status = this.status();

        if (this.m_boost.calc()) {
            status.setBit(eStatus.Accelerate);
        } else {
            status.resetBit(eStatus.Boost);
        }

        this.calcRampBoost();
    }

    /** @addr{0x80582804} */
    calcRampBoost(): void {
        const status = this.status();

        if (status.offBit(eStatus.RampBoost)) {
            return;
        }

        status.setBit(eStatus.Accelerate);
        this.m_rampBoost = u16(this.m_rampBoost - 1);
        if (this.m_rampBoost < 1) {
            this.m_rampBoost = 0;
            status.resetBit(eStatus.RampBoost);
        }
    }

    /**
     * @addr{Inlined in 0x805828CC}
     * Computes the current cooldown duration between braking and reversing.
     */
    calcDisableBackwardsAccel(): void {
        const status = this.status();

        if (status.offBit(eStatus.DisableBackwardsAccel)) {
            return;
        }

        this.m_ssmtDisableAccelTimer = s16(this.m_ssmtDisableAccelTimer - 1);
        if (
            this.m_ssmtDisableAccelTimer < 0 ||
            (this.m_flags.offBit(eFlags.SsmtLeeway) && status.offBit(eStatus.Brake))
        ) {
            status.resetBit(eStatus.DisableBackwardsAccel);
            this.m_ssmtDisableAccelTimer = 0;
        }
    }

    /**
     * @addr{0x805828CC}
     * Calculates standstill mini-turbo components, if applicable.
     */
    calcSsmt(): void {
        const MAX_SSMT_CHARGE = 75;
        const SSMT_BOOST_FRAMES = 30;
        const LEEWAY_FRAMES = 1;
        const DISABLE_ACCEL_FRAMES = 20;

        this.calcDisableBackwardsAccel();

        const status = this.status();

        if (status.onBit(eStatus.ChargingSSMT)) {
            this.m_ssmtCharge = s16(this.m_ssmtCharge + 1);
            if (this.m_ssmtCharge > MAX_SSMT_CHARGE) {
                this.m_ssmtCharge = MAX_SSMT_CHARGE;
                this.m_flags.setBit(eFlags.SsmtCharged);
                this.m_ssmtLeewayTimer = 0;
            }

            return;
        }

        this.m_ssmtCharge = 0;

        if (this.m_flags.offBit(eFlags.SsmtCharged)) {
            return;
        }

        if (this.m_flags.onBit(eFlags.SsmtLeeway)) {
            this.m_ssmtLeewayTimer = s16(this.m_ssmtLeewayTimer - 1);
            if (this.m_ssmtLeewayTimer < 0) {
                this.m_ssmtLeewayTimer = 0;
                this.m_flags.resetBit(eFlags.SsmtCharged, eFlags.SsmtLeeway);
                this.m_ssmtDisableAccelTimer = DISABLE_ACCEL_FRAMES;
                status.setBit(eStatus.DisableBackwardsAccel);
            } else {
                if (status.offBit(eStatus.Accelerate, eStatus.Brake)) {
                    this.activateBoost(KartBoostType.AllMt, SSMT_BOOST_FRAMES);
                    this.m_ssmtLeewayTimer = 0;
                    this.m_flags.resetBit(eFlags.SsmtCharged, eFlags.SsmtLeeway);
                }
            }
        } else {
            if (status.onBit(eStatus.Accelerate) && status.offBit(eStatus.Brake)) {
                this.activateBoost(KartBoostType.AllMt, SSMT_BOOST_FRAMES);
                this.m_ssmtLeewayTimer = 0;
                this.m_flags.resetBit(eFlags.SsmtCharged, eFlags.SsmtLeeway);
            } else {
                this.m_ssmtLeewayTimer = LEEWAY_FRAMES;
                this.m_flags.setBit(eFlags.SsmtLeeway);
                status.setBit(eStatus.DisableBackwardsAccel);
                this.m_ssmtDisableAccelTimer = LEEWAY_FRAMES;
            }
        }
    }

    /**
     * @addr{0x8057E804}
     * Each frame, checks for hop or slipdrift. Computes drift direction based on player input.
     * Returns whether or not we are hopping or slipdrifting.
     */
    calcPreDrift(): boolean {
        const status = this.status();

        if (status.offBit(eStatus.TouchingGround, eStatus.Hop, eStatus.DriftManual)) {
            if (status.onBit(eStatus.StickLeft, eStatus.StickRight)) {
                if (status.offBit(eStatus.DriftInput)) {
                    status.resetBit(eStatus.SlipdriftCharge);
                } else if (status.offBit(eStatus.SlipdriftCharge)) {
                    if (this.m_hopStickX === 0) {
                        if (status.onBit(eStatus.StickRight)) {
                            this.m_hopStickX = -1;
                        } else if (status.onBit(eStatus.StickLeft)) {
                            this.m_hopStickX = 1;
                        }
                        status.setBit(eStatus.SlipdriftCharge);
                        this.onHop();
                    }
                }
            }
        }

        if (status.onBit(eStatus.Hop)) {
            if (this.m_hopStickX === 0) {
                if (status.onBit(eStatus.StickRight)) {
                    this.m_hopStickX = -1;
                } else if (status.onBit(eStatus.StickLeft)) {
                    this.m_hopStickX = 1;
                }
            }
            if (this.m_hopFrame < 3) {
                ++this.m_hopFrame;
            }
        } else if (status.onBit(eStatus.SlipdriftCharge)) {
            this.m_hopFrame = 0;
        }

        return status.onBit(eStatus.Hop, eStatus.SlipdriftCharge);
    }

    /**
     * @addr{0x8057EA50}
     * Clears drift state. Called when touching ground and drift is canceled.
     */
    resetDriftManual(): void {
        this.m_hopStickX = 0;
        this.m_hopFrame = 0;
        this.status().resetBit(eStatus.Hop, eStatus.DriftManual);
        this.m_driftState = DriftState.NotDrifting;
        this.m_smtCharge = 0;
        this.m_mtCharge = 0;
    }

    /** @addr{0x8057E348} */
    clearDrift(): void {
        this.m_flags.resetBit(eFlags.DriftReset);
        this.m_outsideDriftAngle = 0.0;
        this.m_hopStickX = 0;
        this.m_hopFrame = 0;
        this.m_driftState = DriftState.NotDrifting;
        this.m_smtCharge = 0;
        this.m_mtCharge = 0;
        this.m_outsideDriftBonus = 0.0;
        this.status().resetBit(
            eStatus.Hop,
            eStatus.SlipdriftCharge,
            eStatus.DriftManual,
            eStatus.DriftAuto,
        );
        this.m_autoDriftAngle = 0.0;
        this.m_hopStickX = 0;
        this.m_autoDriftStartFrameCounter = 0;
    }

    /** @addr{0x80582DB4} */
    clearJumpPad(): void {
        this.m_jumpPadMinSpeed = 0.0;
        this.status().resetBit(eStatus.JumpPad);
    }

    /** @addr{0x80582DD8} */
    clearRampBoost(): void {
        this.m_rampBoost = 0;
        this.status().resetBit(eStatus.RampBoost);
    }

    /** @addr{0x80582F38} */
    clearZipperBoost(): void {
        this.m_zipperBoostTimer = 0;
        this.status().resetBit(eStatus.ZipperBoost);
    }

    /** @addr{0x80582D94} */
    clearBoost(): void {
        this.m_boost.resetActive();
        this.status().resetBit(eStatus.Boost);
    }

    /** @addr{0x80582F58} */
    clearSsmt(): void {
        this.m_ssmtCharge = 0;
        this.m_ssmtLeewayTimer = 0;
        this.m_ssmtDisableAccelTimer = 0;
        this.m_flags.resetBit(eFlags.SsmtCharged, eFlags.SsmtLeeway);
    }

    /** @addr{0x80582F7C} */
    clearOffroadInvincibility(): void {
        this.m_offroadInvincibility = 0;
        this.status().resetBit(eStatus.BoostOffroadInvincibility);
    }

    clearRejectRoad(): void {
        this.status().resetBit(eStatus.RejectRoadTrigger, eStatus.NoSparkInvisibleWall);
    }

    /**
     * @addr{0x8057E0DC}
     * Each frame, handles automatic transmission drifting.
     */
    calcAutoDrift(): void {
        const AUTO_DRIFT_START_DELAY = 12;

        const status = this.status();

        if (status.offBit(eStatus.AutoDrift)) {
            return;
        }

        if (
            this.canStartDrift() &&
            status.offBit(eStatus.OverZipper, eStatus.RejectRoadTrigger, eStatus.Wheelie) &&
            Math.abs(this.state().stickX()) > fr(0.85)
        ) {
            this.m_autoDriftStartFrameCounter = Math.min(
                AUTO_DRIFT_START_DELAY,
                s16(this.m_autoDriftStartFrameCounter + 1),
            );
        } else {
            this.m_autoDriftStartFrameCounter = 0;
        }

        if (this.m_autoDriftStartFrameCounter >= AUTO_DRIFT_START_DELAY) {
            status.setBit(eStatus.DriftAuto);

            if (status.onBit(eStatus.TouchingGround)) {
                if (this.state().stickX() < 0.0) {
                    this.m_hopStickX = 1;
                    this.m_autoDriftAngle = fr(
                        this.m_autoDriftAngle -
                            fr(30.0 * this.param().stats().driftAutomaticTightness),
                    );
                } else {
                    this.m_hopStickX = -1;
                    this.m_autoDriftAngle = fr(
                        this.m_autoDriftAngle +
                            fr(30.0 * this.param().stats().driftAutomaticTightness),
                    );
                }
            }

            const halfTarget = fr(0.5 * this.param().stats().driftOutsideTargetAngle);
            this.m_autoDriftAngle = fmin(halfTarget, fmax(-halfTarget, this.m_autoDriftAngle));
        } else {
            status.resetBit(eStatus.DriftAuto);
            this.m_hopStickX = 0;

            if (this.m_autoDriftAngle > 0.0) {
                this.m_autoDriftAngle = fmax(
                    0.0,
                    fr(this.m_autoDriftAngle - this.param().stats().driftOutsideDecrement),
                );
            } else {
                this.m_autoDriftAngle = fmin(
                    0.0,
                    fr(this.m_autoDriftAngle + this.param().stats().driftOutsideDecrement),
                );
            }
        }

        const angleAxis = new Quatf();
        angleAxis.setAxisRotation(fr(-this.m_autoDriftAngle * DEG2RAD), this.m_up);
        this.physics().composeExtraRot(angleAxis);
    }

    /**
     * @addr{0x8057DC44}
     * Each frame, handles hopping, drifting, and mini-turbos.
     */
    calcManualDrift(): void {
        let isHopping = this.calcPreDrift();
        const status = this.status();

        if (status.offBit(eStatus.OverZipper)) {
            const rotZ = this.dynamics().mainRot().rotateVector(Vector3f.ez);

            if (
                status.offBit(eStatus.TouchingGround) &&
                this.param().stats().driftType !== Stats.DriftType.Inside_Drift_Bike &&
                status.offBit(eStatus.JumpPadMushroomCollision) &&
                status.onBit(eStatus.DriftManual, eStatus.SlipdriftCharge) &&
                this.m_flags.onBit(eFlags.LaunchBoost)
            ) {
                const up = this.dynamics().mainRot().rotateVector(Vector3f.ey);
                const driftRej = this.m_outsideDriftLastDir.rej(up);

                if (driftRej.normalise() !== 0.0) {
                    const rejCrossDirMag = driftRej.cross(rotZ).length();
                    const angle = atan2(rejCrossDirMag, driftRej.dot(rotZ));
                    let sign = 1.0;
                    if (
                        fr(
                            fr(rotZ.z * fr(rotZ.x - driftRej.x)) -
                                fr(rotZ.x * fr(rotZ.z - driftRej.z)),
                        ) > 0.0
                    ) {
                        sign = -1.0;
                    }

                    this.m_outsideDriftAngle = fr(
                        this.m_outsideDriftAngle + fr(fr(angle * RAD2DEG) * sign),
                    );
                }
            }

            this.m_outsideDriftLastDir.copy(rotZ);
        }

        // TODO: Is this backwards/inverted?
        if (
            ((status.offBit(eStatus.Hop) || this.m_hopFrame < 3) &&
                status.offBit(eStatus.SlipdriftCharge)) ||
            status.onBit(eStatus.InAction) ||
            status.offBit(eStatus.TouchingGround)
        ) {
            if (this.canHop()) {
                this.hop();
                isHopping = true;
            }
        } else {
            this.startManualDrift();
            isHopping = false;
        }

        this.m_flags.resetBit(eFlags.DriftReset);

        if (status.offBit(eStatus.DriftManual)) {
            if (!isHopping && status.onBit(eStatus.TouchingGround)) {
                this.resetDriftManual();

                if (
                    this.action().flags().offBit(eKartActionFlags.Rotating) ||
                    this.m_speed <= 20.0
                ) {
                    const driftAngleDecr = this.param().stats().driftOutsideDecrement;
                    if (this.m_outsideDriftAngle > 0.0) {
                        this.m_outsideDriftAngle = fmax(
                            0.0,
                            fr(this.m_outsideDriftAngle - driftAngleDecr),
                        );
                    } else if (this.m_outsideDriftAngle < 0.0) {
                        this.m_outsideDriftAngle = fmin(
                            0.0,
                            fr(this.m_outsideDriftAngle + driftAngleDecr),
                        );
                    }
                }
            }
        } else {
            // This is a different comparison than KartMove::canStartDrift().
            const canStartDrift = this.m_speed > fr(MINIMUM_DRIFT_THRESOLD * this.m_baseSpeed);

            if (
                status.offBit(eStatus.OverZipper) &&
                (status.offAnyBit(eStatus.DriftInput, eStatus.Accelerate) ||
                    status.onBit(
                        eStatus.InAction,
                        eStatus.RejectRoadTrigger,
                        eStatus.Wall3Collision,
                        eStatus.WallCollision,
                    ) ||
                    !canStartDrift)
            ) {
                if (canStartDrift) {
                    this.releaseMt();
                }

                this.resetDriftManual();
                this.m_flags.setBit(eFlags.DriftReset);
            } else {
                this.controlOutsideDriftAngle();
            }
        }
    }

    /**
     * @addr{0x8057E3F4}
     * Called when the player lands from a drift hop, or to start a slipdrift.
     */
    startManualDrift(): void {
        const OUTSIDE_DRIFT_BONUS = 0.5;

        const stats = this.param().stats();
        const status = this.status();

        if (stats.driftType !== Stats.DriftType.Inside_Drift_Bike) {
            let driftAngle = 0.0;

            if (status.onBit(eStatus.Hop)) {
                const rotZ = this.dynamics().mainRot().rotateVector(Vector3f.ez);
                const rotRej = rotZ.rej(this.m_hopUp);

                if (rotRej.normalise() !== 0.0) {
                    const hopCrossRot = this.m_hopDir.cross(rotRej);
                    driftAngle = fr(
                        atan2(hopCrossRot.length(), this.m_hopDir.dot(rotRej)) * RAD2DEG,
                    );
                }
            }

            this.m_outsideDriftAngle = fr(
                this.m_outsideDriftAngle + fr(driftAngle * fr(-this.m_hopStickX)),
            );
            this.m_outsideDriftAngle = fmax(-60.0, fmin(60.0, this.m_outsideDriftAngle));
        }

        status.resetBit(eStatus.Hop, eStatus.SlipdriftCharge);

        if (status.offBit(eStatus.DriftInput)) {
            return;
        }

        if (this.getAppliedHopStickX() === 0) {
            return;
        }

        status.setBit(eStatus.DriftManual).resetBit(eStatus.Hop);
        this.m_driftState = DriftState.ChargingMt;
        this.m_outsideDriftBonus = fr(
            OUTSIDE_DRIFT_BONUS * fr(this.m_speedRatioCapped * stats.driftManualTightness),
        );
    }

    /**
     * @addr{0x80582F9C}
     * Stops charging a mini-turbo, and applies boost if charged.
     */
    releaseMt(): void {
        const SMT_LENGTH_FACTOR = 3.0;

        const status = this.status();

        if (this.m_driftState < DriftState.ChargedMt || status.onBit(eStatus.Brake)) {
            this.m_driftState = DriftState.NotDrifting;
            return;
        }

        let mtLength = u16(this.param().stats().miniTurbo);

        if (this.m_driftState === DriftState.ChargedSmt) {
            mtLength = u16(Math.trunc(fr(mtLength * SMT_LENGTH_FACTOR)));
        }

        if (status.offBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            this.activateBoost(KartBoostType.AllMt, s16(mtLength));
        }

        this.m_driftState = DriftState.NotDrifting;
    }

    /**
     * @addr{0x8057EAB8}
     * Every frame, handles mini-turbo charging and outside drifting bike rotation.
     */
    controlOutsideDriftAngle(): void {
        if (this.state().airtime() > 5) {
            return;
        }

        if (this.param().stats().driftType !== Stats.DriftType.Inside_Drift_Bike) {
            if (this.m_hopStickX === -1) {
                const angle = this.m_outsideDriftAngle;
                const targetAngle = this.param().stats().driftOutsideTargetAngle;
                if (angle > targetAngle) {
                    this.m_outsideDriftAngle = fmax(
                        fr(this.m_outsideDriftAngle - 2.0),
                        targetAngle,
                    );
                } else if (angle < targetAngle) {
                    this.m_outsideDriftAngle = fr(
                        this.m_outsideDriftAngle +
                            fr(150.0 * this.param().stats().driftManualTightness),
                    );
                    this.m_outsideDriftAngle = fmin(this.m_outsideDriftAngle, targetAngle);
                }
            } else if (this.m_hopStickX === 1) {
                const angle = this.m_outsideDriftAngle;
                const targetAngle = -this.param().stats().driftOutsideTargetAngle;
                if (targetAngle > angle) {
                    this.m_outsideDriftAngle = fmin(
                        fr(this.m_outsideDriftAngle + 2.0),
                        targetAngle,
                    );
                } else if (targetAngle < angle) {
                    this.m_outsideDriftAngle = fr(
                        this.m_outsideDriftAngle -
                            fr(150.0 * this.param().stats().driftManualTightness),
                    );
                    this.m_outsideDriftAngle = fmax(this.m_outsideDriftAngle, targetAngle);
                }
            }
        }

        this.calcMtCharge();
    }

    /**
     * @addr{0x8057C69C}
     * Every frame, calculates kart rotation based on player input.
     */
    calcRotation(): void {
        let turn: number;
        const status = this.status();
        const drifting =
            this.state().isDrifting() && status.offBit(eStatus.JumpPadMushroomCollision);
        const autoDrift = status.onBit(eStatus.AutoDrift);
        const stats = this.param().stats();

        if (drifting) {
            turn = autoDrift ? stats.driftAutomaticTightness : stats.driftManualTightness;
        } else {
            turn = autoDrift ? stats.handlingAutomaticTightness : stats.handlingManualTightness;
        }

        if (drifting && stats.driftType !== Stats.DriftType.Inside_Drift_Bike) {
            this.m_outsideDriftBonus = fr(this.m_outsideDriftBonus * F_0_99);
            turn = fr(turn + this.m_outsideDriftBonus);
        }

        let forwards = true;
        if (status.onBit(eStatus.Brake) && this.m_speed <= 0.0) {
            forwards = false;
        }

        turn = fr(turn * this.m_realTurn);
        if (status.onBit(eStatus.ChargingSSMT)) {
            turn = fr(this.m_realTurn * fr(0.04));
        } else {
            if (status.onBit(eStatus.Hop) && this.m_hopPosY > 0.0) {
                turn = fr(turn * F_1_4);
            }

            if (!drifting) {
                let noTurn = false;
                if (
                    status.offBit(eStatus.WallCollision, eStatus.Wall3Collision) &&
                    Math.abs(this.m_speed) < 1.0
                ) {
                    if (!(status.onBit(eStatus.Hop) && this.m_hopPosY > 0.0)) {
                        turn = 0.0;
                        noTurn = true;
                    }
                }
                if (forwards && !noTurn) {
                    if (this.m_speed >= 20.0) {
                        turn = fr(turn * 0.5);
                        if (this.m_speed < 70.0) {
                            turn = fr(
                                turn + fr(fr(1.0 - fr(fr(this.m_speed - 20.0) / 50.0)) * turn),
                            );
                        }
                    } else {
                        turn = fr(
                            fr(turn * F_0_4) + fr(fr(this.m_speed / 20.0) * fr(turn * F_0_6)),
                        );
                    }
                }
            }

            if (!forwards) {
                turn = -turn;
            }

            if (status.onBit(eStatus.ZipperBoost) && status.offBit(eStatus.DriftManual)) {
                turn = fr(turn * 2.0);
            }

            let stickX = Math.abs(this.state().stickX());
            if (autoDrift && stickX > F_0_3) {
                const stickScalar = fr(fr(stickX - F_0_3) / F_0_7);
                stickX = drifting ? F_0_2 : 0.5;
                turn = fr(
                    turn + fr(stickScalar * fr(fr(turn * stickX) * this.m_speedRatioCapped)),
                );
            }
        }

        if (status.offBit(eStatus.InAction, eStatus.ZipperTrick)) {
            if (status.offBit(eStatus.TouchingGround)) {
                if (status.onBit(eStatus.RampBoost) && this.m_jump.isBoostRampEnabled()) {
                    turn = 0.0;
                } else if (status.offBit(eStatus.JumpPadMushroomCollision)) {
                    const airtime = this.state().airtime();
                    if (airtime >= 70) {
                        turn = 0.0;
                    } else if (airtime >= 30) {
                        turn = fmax(
                            0.0,
                            fr(turn * fr(1.0 - fr(fr((airtime - 30) >>> 0) * fr(0.025)))),
                        );
                    }
                }
            }

            const forward = this.dynamics().mainRot().rotateVector(Vector3f.ez);
            let angle = atan2(forward.cross(this.m_dir).length(), forward.dot(this.m_dir));
            angle = fr(Math.abs(angle) * RAD2DEG);

            if (angle > 60.0) {
                turn = fr(turn * fmax(0.0, fr(1.0 - fr(fr(angle - 60.0) / 40.0))));
            }
        }

        this.calcVehicleRotation(turn);
    }

    /**
     * @addr{0x8057AB68}
     * Every frame, computes speed based on acceleration and any active boosts.
     */
    calcVehicleSpeed(): void {
        const raceMgr = RaceManager.Instance()!;
        const status = this.status();

        if (raceMgr.isStageReached(Stage.Race)) {
            const speedFix = this.dynamics().speedFix();
            if (
                status.onBit(eStatus.InAction) ||
                ((status.onBit(eStatus.WallCollisionStart) ||
                    this.state().wallBonkTimer() === 0 ||
                    Math.abs(speedFix) >= 3.0) &&
                    status.offBit(eStatus.DriftManual))
            ) {
                this.m_speed = fr(this.m_speed + speedFix);
            }
        }

        if (this.m_speed < -20.0) {
            this.m_speed = fr(this.m_speed + 0.5);
        }

        let water = false;

        if (
            status.onBit(eStatus.MovingWaterVertical) ||
            (status.onBit(eStatus.MovingWaterDecaySpeed) &&
                status.offBit(eStatus.MushroomBoost) &&
                Math.abs(this.m_speed) > 5.0)
        ) {
            water = true;
            this.m_speed = fr(this.m_speed * this.collide().pullPath().roadSpeedDecay());
        }

        this.m_acceleration = 0.0;
        this.m_speedDragMultiplier = 1.0;

        if (status.onBit(eStatus.InAction)) {
            this.action().calcVehicleSpeed();
            return;
        }

        if (
            (status.onAllBit(eStatus.SoftWallPush, eStatus.TouchingGround) &&
                status.offBit(eStatus.AnyWheelCollision)) ||
            status.offBit(eStatus.TouchingGround) ||
            status.onBit(eStatus.DisableAcceleration, eStatus.ChargingSSMT)
        ) {
            if (status.onBit(eStatus.RampBoost) && this.state().airtime() < 4) {
                this.m_acceleration = 7.0;
            } else {
                if (status.onBit(eStatus.JumpPad) && status.offBit(eStatus.Accelerate)) {
                    this.m_speedDragMultiplier = F_0_99;
                } else {
                    if (status.onBit(eStatus.OverZipper)) {
                        this.m_speedDragMultiplier = F_0_999;
                    } else {
                        if (this.state().airtime() > 5) {
                            this.m_speedDragMultiplier = F_0_999;
                        }
                    }
                }
                this.m_speed = fr(this.m_speed * this.m_speedDragMultiplier);
            }
        } else if (status.offBit(eStatus.Boost)) {
            if (status.offBit(eStatus.JumpPad, eStatus.RampBoost)) {
                if (status.onBit(eStatus.Accelerate)) {
                    this.m_acceleration = status.onBit(eStatus.HalfPipeRamp)
                        ? 5.0
                        : this.calcVehicleAcceleration();
                } else {
                    if (
                        status.offBit(eStatus.Brake) ||
                        status.onBit(eStatus.DisableBackwardsAccel, eStatus.SoftWallPush)
                    ) {
                        this.m_speed = fr(this.m_speed * (this.m_speed > 0.0 ? F_0_98 : F_0_95));
                    } else if (this.m_drivingDirection === DrivingDirection.Braking) {
                        this.m_acceleration = -1.5;
                    } else if (this.m_drivingDirection === DrivingDirection.WaitingForBackwards) {
                        this.m_backwardsAllowCounter = s16(this.m_backwardsAllowCounter + 1);
                        if (this.m_backwardsAllowCounter > 15) {
                            this.m_drivingDirection = DrivingDirection.Backwards;
                        }
                    } else if (this.m_drivingDirection === DrivingDirection.Backwards) {
                        this.m_acceleration = -2.0;
                    }
                }

                if (status.offBit(eStatus.Boost, eStatus.DriftManual, eStatus.AutoDrift)) {
                    const stats = this.param().stats();

                    const x = fr(1.0 - fr(Math.abs(this.m_weightedTurn) * this.m_speedRatioCapped));
                    this.m_speed = fr(
                        this.m_speed *
                            fr(stats.turningSpeed + fr(fr(1.0 - stats.turningSpeed) * x)),
                    );
                }
            } else {
                this.m_acceleration = water ? this.calcVehicleAcceleration() : 7.0;
            }
        } else {
            this.m_acceleration = water
                ? this.calcVehicleAcceleration()
                : this.m_boost.acceleration();
        }
    }

    /** @addr{0x8057B028} */
    calcDeceleration(): void {
        let vel = 0.0;
        let initialVel = fr(1.0 - this.m_smoothedUp.y);
        if (Math.abs(this.m_speed) < 30.0 && this.m_smoothedUp.y > 0.0 && initialVel > 0.0) {
            initialVel = fmin(fr(initialVel * 2.0), 2.0);
            vel = fr(vel + initialVel);
            vel = fr(vel * fmin(0.5, fmax(-0.5, -this.bodyFront().y)));
        }
        this.m_speed = fr(this.m_speed + vel);
    }

    /**
     * @addr{0x8057B868}
     * Every frame, computes acceleration based off the character/vehicle stats.
     */
    calcVehicleAcceleration(): number {
        const ratio = fr(this.m_speed / this.m_softSpeedLimit);
        if (ratio < 0.0) {
            return 1.0;
        }

        let as: ArrayLike<number>;
        let ts: ArrayLike<number>;
        if (this.state().isDrifting()) {
            as = this.param().stats().accelerationDriftA;
            ts = this.param().stats().accelerationDriftT;
        } else {
            as = this.param().stats().accelerationStandardA;
            ts = this.param().stats().accelerationStandardT;
        }

        let i = 0;
        let acceleration = 0.0;
        let t_curr = 0.0;
        for (; i < ts.length; ++i) {
            if (ratio < ts[i]!) {
                acceleration = fr(
                    as[i]! +
                        fr(
                            fr(fr(as[i + 1]! - as[i]!) / fr(ts[i]! - t_curr)) *
                                fr(ratio - t_curr),
                        ),
                );
                break;
            }

            t_curr = ts[i]!;
        }

        return i < ts.length ? acceleration : as[as.length - 1]!;
    }

    /**
     * @addr{0x8057B9BC}
     * Every frame, applies acceleration to the kart's internal velocity.
     */
    calcAcceleration(): void {
        const ROTATION_SCALAR_NORMAL = 0.5;
        const ROTATION_SCALAR_MIDAIR = F_0_2;
        const ROTATION_SCALAR_BOOST_RAMP = 4.0;
        const OOB_SLOWDOWN_RATE = F_0_95;
        const TERMINAL_VELOCITY = 90.0;

        this.m_lastSpeed = this.m_speed;
        const status = this.status();

        if (status.offBit(eStatus.InAction)) {
            this.dynamics().setKillExtVelY(status.onBit(eStatus.RespawnKillY));
        }

        if (status.onBit(eStatus.Burnout)) {
            this.m_speed = 0.0;
        } else {
            if (this.m_acceleration < 0.0) {
                if (this.m_speed < -20.0) {
                    this.m_acceleration = 0.0;
                } else {
                    if (fr(this.m_speed + this.m_acceleration) <= -20.0) {
                        this.m_acceleration = fr(-20.0 - this.m_speed);
                    }
                }
            }

            this.m_speed = fr(this.m_speed + this.m_acceleration);
        }

        if (status.onBit(eStatus.BeforeRespawn)) {
            this.m_speed = fr(this.m_speed * OOB_SLOWDOWN_RATE);
        } else {
            if (status.onBit(eStatus.ChargingSSMT)) {
                this.m_speed = fr(this.m_speed * F_0_8);
            } else {
                if (this.m_drivingDirection === DrivingDirection.Braking && this.m_speed < 0.0) {
                    this.m_speed = 0.0;
                    this.m_drivingDirection = DrivingDirection.WaitingForBackwards;
                    this.m_backwardsAllowCounter = 0;
                }
            }
        }

        let speedLimit = status.onBit(eStatus.JumpPad) ? this.m_jumpPadMaxSpeed : this.m_baseSpeed;
        const boostMultiplier = this.m_boost.multiplier();
        const boostSpdLimit = this.m_boost.speedLimit();
        this.m_jumpPadBoostMultiplier = boostMultiplier;

        let scaleMultiplier = this.m_shockSpeedMultiplier;
        if (status.onBit(eStatus.Crushed)) {
            scaleMultiplier = fr(scaleMultiplier * F_0_7);
        }

        const wheelieBonus = fr(boostMultiplier + this.getWheelieSoftSpeedLimitBonus());
        speedLimit = fr(
            speedLimit *
                (status.onBit(eStatus.JumpPadFixedSpeed)
                    ? 1.0
                    : fr(scaleMultiplier * fr(wheelieBonus * this.m_kclSpeedFactor))),
        );

        const ignoreScale = status.onBit(
            eStatus.RampBoost,
            eStatus.ZipperInvisibleWall,
            eStatus.OverZipper,
            eStatus.HalfPipeRamp,
        );
        let boostSpeed = ignoreScale ? 1.0 : scaleMultiplier;
        boostSpeed = fr(boostSpeed * fr(boostSpdLimit * this.m_kclSpeedFactor));

        if (status.offBit(eStatus.JumpPad) && boostSpeed > 0.0 && boostSpeed > speedLimit) {
            speedLimit = boostSpeed;
        }

        this.m_jumpPadSoftSpeedLimit = fr(boostSpdLimit * this.m_kclSpeedFactor);

        if (status.onBit(eStatus.RampBoost)) {
            speedLimit = fmax(speedLimit, 100.0);
        }

        this.m_lastDir.copy(this.m_speed > 0.0 ? this.m_dir.mul(1.0) : this.m_dir.mul(-1.0));

        const local_c8 = box(1.0);
        speedLimit = fr(speedLimit * this.calcWallCollisionSpeedFactor(local_c8));

        if (this.m_softSpeedLimit <= speedLimit) {
            this.m_softSpeedLimit = speedLimit;
        } else if (status.offBit(eStatus.WallCollision, eStatus.Wall3Collision)) {
            this.m_softSpeedLimit = fmax(fr(this.m_softSpeedLimit - 3.0), speedLimit);
        } else {
            this.m_softSpeedLimit = speedLimit;
        }

        this.m_softSpeedLimit = fmin(this.m_hardSpeedLimit, this.m_softSpeedLimit);

        this.m_speed = fmin(this.m_softSpeedLimit, fmax(-this.m_softSpeedLimit, this.m_speed));

        if (status.onBit(eStatus.JumpPad)) {
            this.m_speed = fmax(this.m_speed, this.m_jumpPadMinSpeed);
        }

        this.calcWallCollisionStart(local_c8.value);

        this.m_speedRatio = Math.abs(fr(this.m_speed / this.m_baseSpeed));
        this.m_speedRatioCapped = fmin(1.0, this.m_speedRatio);

        let crossVec = this.m_smoothedUp.cross(this.m_dir);
        if (this.m_speed < 0.0) {
            crossVec = crossVec.neg();
        }

        let rotationScalar = ROTATION_SCALAR_NORMAL;
        if (this.collide().surfaceFlags().onBit(eSurfaceFlags.BoostRamp)) {
            rotationScalar = ROTATION_SCALAR_BOOST_RAMP;
        } else if (status.offBit(eStatus.TouchingGround)) {
            rotationScalar = ROTATION_SCALAR_MIDAIR;
        }

        const local_90 = new Matrix34f();
        local_90.setAxisRotation(fr(DEG2RAD * rotationScalar), crossVec);
        this.m_vel1Dir.copy(local_90.multVector33(this.m_vel1Dir));

        const raceMgr = RaceManager.Instance()!;
        if (
            status.offBit(eStatus.InAction, eStatus.DisableBackwardsAccel, eStatus.Accelerate) &&
            status.onBit(eStatus.TouchingGround) &&
            raceMgr.isStageReached(Stage.Race)
        ) {
            this.calcDeceleration();
        }

        this.m_processedSpeed = this.m_speed;
        const nextSpeed = this.m_vel1Dir.mul(this.m_speed);

        const maxSpeedY = status.onBit(eStatus.OverZipper)
            ? KartHalfPipe.TerminalVelocity()
            : TERMINAL_VELOCITY;
        nextSpeed.y = fmin(nextSpeed.y, maxSpeedY);

        this.dynamics().setIntVel(this.dynamics().intVel().add(nextSpeed));

        if (
            status.onBit(eStatus.TouchingGround) &&
            status.offBit(eStatus.DriftManual, eStatus.Hop)
        ) {
            if (status.onBit(eStatus.Brake)) {
                if (this.m_drivingDirection === DrivingDirection.Forwards) {
                    this.m_drivingDirection =
                        this.m_processedSpeed > 5.0
                            ? DrivingDirection.Braking
                            : DrivingDirection.Backwards;
                }
            } else {
                if (this.m_processedSpeed >= 0.0) {
                    this.m_drivingDirection = DrivingDirection.Forwards;
                }
            }
        } else {
            this.m_drivingDirection = DrivingDirection.Forwards;
        }
    }

    /**
     * @addr{0x8057B108}
     * Every frame, computes a speed scalar if we are colliding with a wall.
     * `f1` is a C++ `f32 &` out-param.
     */
    calcWallCollisionSpeedFactor(f1: Box<number>): number {
        const status = this.status();

        if (status.offBit(eStatus.WallCollision, eStatus.Wall3Collision)) {
            return 1.0;
        }

        this.onWallCollision();

        if (status.onBit(eStatus.ZipperInvisibleWall, eStatus.OverZipper)) {
            return 1.0;
        }

        const wallNrm = this.collisionData().wallNrm.clone();
        if (wallNrm.y > 0.0) {
            wallNrm.y = 0.0;
            wallNrm.normalise();
        }

        const dot = this.m_lastDir.dot(wallNrm);

        if (dot < 0.0) {
            f1.value = fmax(0.0, fr(dot + 1.0));

            return fmin(
                1.0,
                fr(f1.value * (status.onBit(eStatus.WallCollision) ? F_0_4 : F_0_7)),
            );
        }

        return 1.0;
    }

    /**
     * @addr{0x8057B2A0}
     * If we started to collide with a wall this frame, applies rotation.
     */
    calcWallCollisionStart(param_2: number): void {
        this.m_flags.resetBit(eFlags.WallBounce);

        const status = this.status();

        if (status.offBit(eStatus.WallCollisionStart)) {
            return;
        }

        this.m_outsideDriftAngle = 0.0;
        if (status.offBit(eStatus.InAction)) {
            this.m_dir.copy(this.bodyFront());
            this.m_vel1Dir.copy(this.m_dir);
            this.m_landingDir.copy(this.m_dir);
            this.m_smoothedForward.copy(this.m_dir);
        }

        if (status.offBit(eStatus.ZipperInvisibleWall, eStatus.OverZipper) && param_2 < F_0_9) {
            let speedDiff = fr(this.m_lastSpeed - this.m_speed);
            const colData = this.collisionData();

            if (speedDiff > 30.0) {
                this.m_flags.setBit(eFlags.WallBounce);
                const newPos = colData.relPos.add(this.pos());
                const dot = fr(-this.bodyUp().dot(colData.relPos) * 0.5);
                const scaledUp = this.bodyUp().mul(dot);
                newPos.subEq(scaledUp);

                speedDiff = fmin(60.0, speedDiff);
                const scaledWallNrm = colData.wallNrm.mul(speedDiff);

                let [proj, rej] = scaledWallNrm.projAndRej(this.m_vel1Dir);
                proj.mulEq(F_0_3);
                rej.mulEq(F_0_9);

                if (status.onBit(eStatus.Boost)) {
                    proj = Vector3f.zero.clone();
                    rej = Vector3f.zero.clone();
                }

                if (this.bodyFront().dot(colData.wallNrm) > 0.0) {
                    proj = Vector3f.zero.clone();
                }
                rej.mulEq(F_0_9);

                const projRejSum = proj.add(rej);
                let bumpDeviation = 0.0;
                if (this.m_flags.offBit(eFlags.DriftReset) && status.onBit(eStatus.TouchingGround)) {
                    bumpDeviation = this.param().stats().bumpDeviationLevel;
                }

                this.dynamics().applyWrenchScaled(newPos, projRejSum, bumpDeviation);
            } else if (this.wallKclType() === COL_TYPE_SPECIAL_WALL && this.wallKclVariant() === 2) {
                this.dynamics().addForce(colData.wallNrm.mul(15.0));
                this.collide().startFloorMomentRate();
            }

            if (this.wallKclType() === COL_TYPE_SPECIAL_WALL && this.wallKclVariant() === 0) {
                this.dynamics().addForce(colData.wallNrm.mul(15.0));
                this.collide().startFloorMomentRate();
            }
        }
    }

    /**
     * @addr{0x8057D1D4}
     * Computes the x-component of angular velocity based on the kart's speed.
     */
    calcStandstillBoostRot(): void {
        let next = 0.0;
        let scalar = 1.0;

        const status = this.status();

        if (status.onBit(eStatus.TouchingGround)) {
            if (RaceManager.Instance()!.stage() === Stage.Countdown) {
                next = fr(F_0_015 * -this.state().startBoostCharge());
            } else if (status.offBit(eStatus.ChargingSSMT)) {
                if (
                    status.offBit(
                        eStatus.JumpPad,
                        eStatus.RampBoost,
                        eStatus.SoftWallUnlockRotation,
                    )
                ) {
                    const speedDiff = fr(this.m_lastSpeed - this.m_speed);
                    scalar = fmin(3.0, fmax(speedDiff, -3.0));

                    if (status.onBit(eStatus.MushroomBoost)) {
                        next = fr(fr(scalar * F_0_15) * 0.25);
                        if (status.onBit(eStatus.Wheelie)) {
                            next = fr(next * 0.5);
                        }
                    } else {
                        next = fr(fr(scalar * F_0_15) * fr(0.08));
                    }
                    scalar = this.m_driftingParams.boostRotFactor;
                }
            } else {
                const MAX_SSMT_CHARGE = 75;
                next = fr(F_0_015 * fr(-fr(this.m_ssmtCharge) / fr(MAX_SSMT_CHARGE)));
            }
        }

        if (this.m_flags.onBit(eFlags.WallBounce)) {
            this.m_standStillBoostRot = this.isBike() ? fr(next * 3.0) : fr(next * 10.0);
        } else {
            this.m_standStillBoostRot = fr(
                this.m_standStillBoostRot +
                    fr(scalar * fr(fr(next * this.m_invScale) - this.m_standStillBoostRot)),
            );
        }
    }

    /**
     * @addr{0x805869DC}
     * Responds to player input to handle up/down kart tilt mid-air.
     */
    calcDive(): void {
        const DIVE_LIMIT = F_0_8;

        this.m_divingRot = fr(this.m_divingRot * fr(0.96));

        const status = this.status();

        if (
            status.onBit(
                eStatus.TouchingGround,
                eStatus.CannonStart,
                eStatus.InCannon,
                eStatus.InAction,
                eStatus.OverZipper,
            )
        ) {
            return;
        }

        let stickY = this.state().stickY();

        if (
            status.onBit(eStatus.InATrick) &&
            this.m_jump.type() === TrickType.BikeSideStuntTrick
        ) {
            stickY = fmin(1.0, fr(stickY + F_0_4));
        }

        const airtime = this.state().airtime();

        if (airtime > 50) {
            if (Math.abs(stickY) < F_0_1) {
                this.m_divingRot = fr(
                    this.m_divingRot + fr(F_0_05 * fr(-fr(0.025) - this.m_divingRot)),
                );
            }
        } else {
            stickY = fr(stickY * fr(fr(airtime) / 50.0));
        }

        this.m_divingRot = fmax(
            -DIVE_LIMIT,
            fmin(DIVE_LIMIT, fr(this.m_divingRot + fr(stickY * fr(0.005)))),
        );

        const angVel2 = this.dynamics().angVel2().clone();
        angVel2.x = fr(angVel2.x + this.m_divingRot);
        this.dynamics().setAngVel2(angVel2);

        if (this.state().airtime() < 50) {
            return;
        }

        const topRotated = this.dynamics().mainRot().rotateVector(Vector3f.ey);
        const forwardRotated = this.dynamics().mainRot().rotateVector(Vector3f.ez);
        const upDotTop = this.m_up.dot(topRotated);
        const upCrossTop = this.m_up.cross(topRotated);
        const crossNorm = upCrossTop.length();
        const angle = Math.abs(atan2(crossNorm, upDotTop));

        const fVar1 = fr(fr(angle * RAD2DEG) - 20.0);
        if (fVar1 <= 0.0) {
            return;
        }

        const mult = fmin(1.0, fr(fVar1 / 20.0));
        if (forwardRotated.y > 0.0) {
            this.dynamics().setGravity(
                fr(fr(1.0 - fr(F_0_2 * mult)) * this.dynamics().gravity()),
            );
        } else {
            this.dynamics().setGravity(
                fr(fr(fr(F_0_2 * mult) + 1.0) * this.dynamics().gravity()),
            );
        }
    }

    /**
     * @addr{Inlined in 0x805788DC}
     * Calculates whether we are starting a standstill mini-turbo.
     */
    calcSsmtStart(): void {
        const status = this.status();

        if (
            Math.abs(this.m_speed) >= 10.0 ||
            status.onBit(eStatus.Boost, eStatus.RampBoost) ||
            status.offAnyBit(eStatus.Accelerate, eStatus.Brake)
        ) {
            status.resetBit(eStatus.ChargingSSMT);
            return;
        }

        status.setBit(eStatus.ChargingSSMT).resetBit(eStatus.HopStart, eStatus.DriftInput);
    }

    /** @addr{0x80579968} */
    calcHopPhysics(): void {
        this.m_hopVelY = fr(fr(this.m_hopVelY * fr(0.998)) + this.m_hopGravity);
        this.m_hopPosY = fr(this.m_hopPosY + this.m_hopVelY);

        if (this.m_hopPosY < 0.0) {
            this.m_hopPosY = 0.0;
            this.m_hopVelY = 0.0;
        }
    }

    /** @addr{0x80579960} */
    calcRejectRoad(): void {
        this.m_reject.calcRejectRoad();
    }

    /**
     * @addr{0x80583F2C}
     * `pos` and `upLocal` are C++ `EGG::Vector3f &` out-params (mutated in place). `colInfo` and
     * `maskOut` are nullable pointers.
     */
    calcZipperCollision(
        radius: number,
        scale: number,
        pos: Vector3f,
        upLocal: Vector3f,
        prevPos: Readonly<Vector3f>,
        colInfo: CollisionInfo | null,
        maskOut: Box<number> | null,
        flags: number,
    ): boolean {
        upLocal.copy(this.mainRot().rotateVector(Vector3f.ey));
        pos.copy(this.dynamics().pos().add(upLocal.mul(fr(-scale * this.m_scale.y))));

        const colDir = CollisionDirector.Instance()!;
        return colDir.checkSphereFullPush(radius, pos, prevPos, flags, colInfo, maskOut, 0);
    }

    /** @addr{0x805879A4} */
    calcSlerpRate(scale: number, from: Readonly<Quatf>, to: Readonly<Quatf>): number {
        const dotNorm = fmax(-1.0, fmin(1.0, from.dot(to)));
        const acos_ = acos(dotNorm);
        return acos_ > 0.0 ? fmin(F_0_1, fr(scale / acos_)) : F_0_1;
    }

    /** @addr{0x80586DB4} */
    applyForce(force: number, hitDir: Readonly<Vector3f>, stop: boolean): void {
        const BUMP_COOLDOWN = 5;

        if (this.m_bumpTimer >= 1) {
            return;
        }

        this.dynamics().addForce(hitDir.perpInPlane(this.m_up, true).mul(force));
        this.collide().startFloorMomentRate();

        this.m_bumpTimer = BUMP_COOLDOWN;

        if (stop) {
            this.m_speed = 0.0;
        }
    }

    /**
     * @addr{0x8057CF0C}
     * Every frame, calculates rotation, EV, and angular velocity for the kart.
     */
    calcVehicleRotation(turn: number): void {
        let tiltMagnitude = 0.0;
        const status = this.status();

        if (
            status.offBit(eStatus.InAction, eStatus.SoftWallUnlockRotation) &&
            status.onBit(eStatus.AnyWheelCollision)
        ) {
            let front = this.componentZAxis().clone();
            front = front.perpInPlane(this.m_up, true);
            const frontSpeed = this.velocity().rej(front).perpInPlane(this.m_up, false);
            let magnitude = tiltMagnitude;

            if (frontSpeed.squaredLength() > F32_EPSILON) {
                magnitude = frontSpeed.length();

                if (fr(fr(front.z * frontSpeed.x) - fr(front.x * frontSpeed.z)) > 0.0) {
                    magnitude = -magnitude;
                }

                tiltMagnitude = -1.0;
                if (-1.0 <= magnitude) {
                    tiltMagnitude = fmin(1.0, magnitude);
                }
            }
        } else if (status.offBit(eStatus.Hop) || this.m_hopPosY <= 0.0) {
            const angVel0 = this.dynamics().angVel0().clone();
            angVel0.z = fr(angVel0.z * F_0_98);
            this.dynamics().setAngVel0(angVel0);
        }

        const lean = fr(
            this.m_invScale *
                fr(
                    fr(tiltMagnitude * this.param().stats().tilt) *
                        Math.abs(this.m_weightedTurn),
                ),
        );

        this.calcStandstillBoostRot();

        const angVel0 = this.dynamics().angVel0().clone();
        angVel0.x = fr(angVel0.x + this.m_standStillBoostRot);
        angVel0.z = fr(angVel0.z + lean);
        this.dynamics().setAngVel0(angVel0);

        const angVel2 = this.dynamics().angVel2().clone();
        angVel2.y = fr(angVel2.y + turn);
        this.dynamics().setAngVel2(angVel2);

        this.calcDive();
    }

    /**
     * @addr{0x8057EE50}
     * Every frame during a drift, calculates MT/SMT charge based on player input.
     */
    calcMtCharge(): void {
        // TODO: Some of these are shared between the base and derived class implementations.
        const MAX_MT_CHARGE = 270;
        const MAX_SMT_CHARGE = 300;
        const BASE_MT_CHARGE = 2;
        const BASE_SMT_CHARGE = 2;
        const BONUS_CHARGE_STICK_THRESHOLD = F_0_4;
        const EXTRA_MT_CHARGE = 3;

        if (this.m_driftState === DriftState.ChargedSmt) {
            return;
        }

        const stickX = this.state().stickX();

        if (this.m_driftState === DriftState.ChargingMt) {
            this.m_mtCharge = u16(this.m_mtCharge + BASE_MT_CHARGE);

            if (-BONUS_CHARGE_STICK_THRESHOLD <= stickX) {
                if (BONUS_CHARGE_STICK_THRESHOLD < stickX && this.m_hopStickX === -1) {
                    this.m_mtCharge = u16(this.m_mtCharge + EXTRA_MT_CHARGE);
                }
            } else if (this.m_hopStickX !== -1) {
                this.m_mtCharge = u16(this.m_mtCharge + EXTRA_MT_CHARGE);
            }

            if (this.m_mtCharge > MAX_MT_CHARGE) {
                this.m_mtCharge = MAX_MT_CHARGE;
                this.m_driftState = DriftState.ChargingSmt;
            }
        }

        if (this.m_driftState !== DriftState.ChargingSmt) {
            return;
        }

        this.m_smtCharge = u16(this.m_smtCharge + BASE_SMT_CHARGE);

        if (-BONUS_CHARGE_STICK_THRESHOLD <= stickX) {
            if (BONUS_CHARGE_STICK_THRESHOLD < stickX && this.m_hopStickX === -1) {
                this.m_smtCharge = u16(this.m_smtCharge + EXTRA_MT_CHARGE);
            }
        } else if (this.m_hopStickX !== -1) {
            this.m_smtCharge = u16(this.m_smtCharge + EXTRA_MT_CHARGE);
        }

        if (this.m_smtCharge > MAX_SMT_CHARGE) {
            this.m_smtCharge = MAX_SMT_CHARGE;
            this.m_driftState = DriftState.ChargedSmt;
        }
    }

    /** @addr{0x80583658} */
    initOob(): void {
        this.clearBoost();
        this.clearJumpPad();
        this.clearRampBoost();
        this.clearZipperBoost();
        this.clearSsmt();
        this.clearOffroadInvincibility();
    }

    /**
     * @addr{0x8057DA5C}
     * Initializes hop information, resets upwards EV and clears upwards force.
     */
    hop(): void {
        this.status().setBit(eStatus.Hop).resetBit(eStatus.DriftManual);
        this.onHop();

        this.m_hopUp.copy(this.dynamics().mainRot().rotateVector(Vector3f.ey));
        this.m_hopDir.copy(this.dynamics().mainRot().rotateVector(Vector3f.ez));
        this.m_driftState = DriftState.NotDrifting;
        this.m_smtCharge = 0;
        this.m_mtCharge = 0;
        this.m_hopStickX = 0;
        this.m_hopFrame = 0;
        this.m_hopPosY = 0.0;
        this.m_hopGravity = this.dynamics().gravity();
        this.m_hopVelY = this.m_driftingParams.hopVelY;
        this.m_outsideDriftBonus = 0.0;

        const extVel = this.dynamics().extVel().clone();
        extVel.y = fr(0.0 + this.m_hopVelY);
        this.dynamics().setExtVel(extVel);

        const totalForce = this.dynamics().totalForce().clone();
        totalForce.y = 0.0;
        this.dynamics().setTotalForce(totalForce);
    }

    /** @addr{Inlined at 0x80587590} */
    tryStartBoostPanel(): void {
        const BOOST_PANEL_DURATION = 60;

        if (this.status().onBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            return;
        }

        this.activateBoost(KartBoostType.MushroomAndBoostPanel, BOOST_PANEL_DURATION);
        this.setOffroadInvincibility(BOOST_PANEL_DURATION);
    }

    /**
     * @addr{Inlined at 0x80587590}
     * Sets offroad invincibility and enables the ramp boost bitfield flag.
     */
    tryStartBoostRamp(): void {
        const BOOST_RAMP_DURATION = 60;

        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            return;
        }

        status.setBit(eStatus.RampBoost);
        this.m_rampBoost = BOOST_RAMP_DURATION;
        this.setOffroadInvincibility(BOOST_RAMP_DURATION);
    }

    /**
     * @addr{0x8057FD18}
     * Applies calculations to start interacting with a jump pad.
     */
    tryStartJumpPad(): void {
        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn, eStatus.InAction, eStatus.HalfPipeRamp)) {
            return;
        }

        status.setBit(eStatus.JumpPad);
        const jumpPadVariant = this.state().jumpPadVariant();
        this.m_jumpPadProperties = JUMP_PAD_PROPERTIES[jumpPadVariant]!;

        if (jumpPadVariant === 3 || jumpPadVariant === 4) {
            if (this.m_jumpPadBoostMultiplier > F_1_3 || this.m_jumpPadSoftSpeedLimit > 110.0) {
                // Set speed to 100 if the player has boost from a boost panel or mushroom(item)
                // before hitting the jump pad
                this.m_jumpPadProperties =
                    JUMP_PAD_PROPERTIES_SHROOM_BOOST[Number(jumpPadVariant !== 3)]!;
            }

            status.setBit(eStatus.JumpPadFixedSpeed);
        }

        if (jumpPadVariant === 4) {
            status.setBit(
                eStatus.JumpPadMushroomTrigger,
                eStatus.JumpPadMushroomVelYInc,
                eStatus.JumpPadMushroomCollision,
            );
        } else {
            const extVel = this.dynamics().extVel().clone();
            const totalForce = this.dynamics().totalForce().clone();

            extVel.y = this.m_jumpPadProperties.velY;
            totalForce.y = 0.0;

            this.dynamics().setExtVel(extVel);
            this.dynamics().setTotalForce(totalForce);

            if (jumpPadVariant !== 3) {
                const dir = this.m_dir.clone();
                dir.y = 0.0;
                dir.normalise();
                this.m_speed = fr(this.m_speed * this.m_dir.dot(dir));
                this.m_dir.copy(dir);
                this.m_vel1Dir.copy(dir);
                status.setBit(eStatus.JumpPadDisableYsusForce);
            }
        }

        this.m_jumpPadMinSpeed = this.m_jumpPadProperties.minSpeed;
        this.m_jumpPadMaxSpeed = this.m_jumpPadProperties.maxSpeed;
        this.m_speed = fmax(this.m_speed, this.m_jumpPadMinSpeed);
    }

    /** @addr{0x80582530} */
    tryEndJumpPad(): void {
        const status = this.status();
        if (status.onBit(eStatus.JumpPadMushroomTrigger)) {
            if (status.onBit(eStatus.GroundStart)) {
                status.resetBit(
                    eStatus.JumpPadMushroomTrigger,
                    eStatus.JumpPadFixedSpeed,
                    eStatus.JumpPadMushroomVelYInc,
                );
            }

            if (status.onBit(eStatus.JumpPadMushroomVelYInc)) {
                const newExtVel = this.dynamics().extVel().clone();
                newExtVel.y = fr(newExtVel.y + 20.0);
                if (this.m_jumpPadProperties!.velY < newExtVel.y) {
                    newExtVel.y = this.m_jumpPadProperties!.velY;
                    status.resetBit(eStatus.JumpPadMushroomVelYInc);
                }
                this.dynamics().setExtVel(newExtVel);
            }
        }

        if (status.onBit(eStatus.GroundStart) && status.offBit(eStatus.JumpPadMushroomTrigger)) {
            this.cancelJumpPad();
        }
    }

    /** @addr{0x80582DB4} */
    cancelJumpPad(): void {
        this.m_jumpPadMinSpeed = 0.0;
        this.status().resetBit(eStatus.JumpPad);
    }

    /** @addr{0x8057F090} `frames` is s16. */
    activateBoost(type: KartBoostType, frames: number): void {
        if (this.m_boost.activate(type, frames)) {
            this.status().setBit(eStatus.Boost);
        }
    }

    /** @addr{0x8058212C} */
    applyStartBoost(frames: number): void {
        this.activateBoost(KartBoostType.AllMt, frames);
    }

    /** @addr{0x8057F3D8} */
    activateMushroom(): void {
        const MUSHROOM_DURATION = 90;

        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            return;
        }

        this.activateBoost(KartBoostType.MushroomAndBoostPanel, MUSHROOM_DURATION);

        this.m_mushroomBoostTimer = MUSHROOM_DURATION;
        status.setBit(eStatus.MushroomBoost);
        this.setOffroadInvincibility(MUSHROOM_DURATION);
    }

    /** @addr{0x8057F96C} */
    activateZipperBoost(): void {
        const BASE_DURATION = 50;
        const TRICK_DURATION = 100;

        const status = this.status();

        if (status.onBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            return;
        }

        const boostDuration = status.onBit(eStatus.ZipperTrick) ? TRICK_DURATION : BASE_DURATION;
        this.activateBoost(KartBoostType.TrickAndZipper, boostDuration);

        this.setOffroadInvincibility(boostDuration);
        this.m_zipperBoostTimer = 0;
        this.m_zipperBoostMax = boostDuration;
        status.setBit(eStatus.ZipperBoost);
    }

    /**
     * @addr{0x805824C8}
     * Ignores offroad KCL collision for a set amount of time. `timer` is s16.
     */
    setOffroadInvincibility(timer: number): void {
        if (timer > this.m_offroadInvincibility) {
            this.m_offroadInvincibility = timer;
        }

        this.status().setBit(eStatus.BoostOffroadInvincibility);
    }

    /**
     * @addr{0x805824F0}
     * Checks a timer to see if we are still ignoring offroad slowdown.
     */
    calcOffroadInvincibility(): void {
        const status = this.status();

        if (status.offBit(eStatus.BoostOffroadInvincibility)) {
            return;
        }

        this.m_offroadInvincibility = s16(this.m_offroadInvincibility - 1);
        if (this.m_offroadInvincibility > 0) {
            return;
        }

        status.resetBit(eStatus.BoostOffroadInvincibility);
    }

    /** Checks a timer to see if we are still boosting from a mushroom. */
    calcMushroomBoost(): void {
        const status = this.status();

        if (status.offBit(eStatus.MushroomBoost)) {
            return;
        }

        this.m_mushroomBoostTimer = u16(this.m_mushroomBoostTimer - 1);
        if (this.m_mushroomBoostTimer > 0) {
            return;
        }

        status.resetBit(eStatus.MushroomBoost);
    }

    /** @addr{0x80582E34} */
    calcZipperBoost(): void {
        const status = this.status();

        if (status.offBit(eStatus.ZipperBoost)) {
            return;
        }

        status.setBit(eStatus.Accelerate);

        if (status.offBit(eStatus.OverZipper)) {
            this.m_zipperBoostTimer = s16(this.m_zipperBoostTimer + 1);
            if (this.m_zipperBoostTimer >= this.m_zipperBoostMax) {
                this.m_zipperBoostTimer = 0;
                status.resetBit(eStatus.ZipperBoost);
            }
        }

        if (this.m_zipperBoostTimer < 10) {
            const angVel = this.dynamics().angVel0().clone();
            angVel.y = 0.0;
            this.dynamics().setAngVel0(angVel);
        }
    }

    /** @addr{0x8057F7A8} */
    landTrick(): void {
        if (this.status().onBit(eStatus.BeforeRespawn, eStatus.InAction)) {
            return;
        }

        let duration: number;
        if (this.isBike()) {
            duration = BIKE_TRICK_BOOST_DURATION[this.m_jump.variant() as number]!;
        } else {
            duration = KART_TRICK_BOOST_DURATION[this.m_jump.variant() as number]!;
        }

        this.activateBoost(KartBoostType.TrickAndZipper, duration);
    }

    /** @addr{0x80580F28} `timer` is u16. */
    activateCrush(timer: number): void {
        this.status().setBit(eStatus.Crushed);
        this.m_crushTimer = timer;
        this.m_kartScale.startCrush();
    }

    /** @addr{0x80580F9C} */
    calcCrushed(): void {
        if (this.status().offBit(eStatus.Crushed)) {
            return;
        }

        this.m_crushTimer = u16(this.m_crushTimer - 1);
        if (this.m_crushTimer === 0) {
            this.status().resetBit(eStatus.Crushed);
            this.m_kartScale.endCrush();
        }
    }

    /** @addr{0x8058160C} */
    calcScale(): void {
        this.m_kartScale.calc();

        const sizeScale = this.m_kartScale.sizeScale().clone();
        this.setScale(this.m_kartScale.pressScale().mulV(sizeScale));
        this.m_totalScale = this.m_shockSpeedMultiplier;
        this.m_hitboxScale = fmax(sizeScale.z, this.m_totalScale);

        if (sizeScale.z !== 1.0) {
            this.setInertiaScale(this.m_scale);
        }

        this.m_invScale = this.m_scale.z > 1.0 ? fr(1.0 / this.m_scale.z) : 1.0;
    }

    /** @addr{0x80580768} */
    activateShrink(): void {
        this.applyShrink(300);
    }

    /** @addr{0x80580778} `timer` is u16. */
    applyShrink(timer: number): void {
        const status = this.state().status();

        if (status.onBit(eStatus.InRespawn, eStatus.AfterRespawn, eStatus.CannonStart)) {
            return;
        }

        this.action().start(Action.UNK_15);
        ItemDirector.Instance()!.kartItem(0).clear();
        status.setBit(eStatus.Shocked);

        if (timer > this.m_shockTimer) {
            this.m_shockTimer = timer;
            this.m_kartScale.startShrink(0);
        }
    }

    /** @addr{0x80580998} */
    calcShock(): void {
        const status = this.state().status();

        if (status.onBit(eStatus.Shocked)) {
            this.m_shockTimer = u16(this.m_shockTimer - 1);
            if (this.m_shockTimer === 0) {
                this.deactivateShock(false);
            }

            this.m_shockSpeedMultiplier = fmax(F_0_7, fr(this.m_shockSpeedMultiplier - F_0_03));
        } else {
            this.m_shockSpeedMultiplier = fmin(1.0, fr(this.m_shockSpeedMultiplier + F_0_05));
        }
    }

    /** @addr{0x80580A84} */
    deactivateShock(resetSpeed: boolean): void {
        this.status().resetBit(eStatus.Shocked);
        this.m_shockTimer = 0;
        this.m_kartScale.endShrink(0);

        if (resetSpeed) {
            this.m_shockSpeedMultiplier = 1.0;
        }
    }

    /** @addr{0x8058498C} */
    enterCannon(): void {
        this.init(true, true);
        this.physics().clearDecayingRot();
        this.m_boost.resetActive();

        const status = this.status();

        status.resetBit(eStatus.Boost);

        this.cancelJumpPad();
        this.clearRampBoost();
        this.clearZipperBoost();
        this.clearSsmt();
        this.clearOffroadInvincibility();

        this.dynamics().reset();

        this.clearDrift();

        status
            .resetBit(eStatus.Hop, eStatus.CannonStart)
            .setBit(eStatus.InCannon, eStatus.SkipWheelCalc);

        const [cannonPos] = this.getCannonPosRot();
        this.m_cannonEntryPos.copy(this.pos());
        this.m_cannonEntryOfs.copy(cannonPos.sub(this.pos()));
        this.m_cannonEntryOfsLength = this.m_cannonEntryOfs.normalise();
        this.m_cannonEntryOfs.normalise();
        this.m_dir.copy(this.m_cannonEntryOfs);
        this.m_vel1Dir.copy(this.m_cannonEntryOfs);
        this.m_cannonOrthog.copy(Vector3f.ey.perpInPlane(this.m_cannonEntryOfs, true));
        this.m_cannonProgress.setZero();
    }

    /** @addr{0x80584D58} */
    calcCannon(): void {
        const [cannonPos] = this.getCannonPosRot();
        const forwardXZ = cannonPos.sub(this.m_cannonEntryPos).sub(this.m_cannonProgress);
        const forward = forwardXZ.clone();
        const forwardLength = forward.normalise();
        forwardXZ.y = 0;
        forwardXZ.normalise();
        const local94 = this.m_cannonEntryOfs.clone();
        local94.y = 0;
        local94.normalise();
        this.m_speedRatioCapped = 1.0;
        this.m_speedRatio = 1.5;
        const cannonOrientation = new Matrix34f();
        cannonOrientation.makeOrthonormalBasis(forward, Vector3f.ey);
        const up = cannonOrientation.multVector33(Vector3f.ey);
        this.m_smoothedUp.copy(up);
        this.m_up.copy(up);

        if (forwardLength < 30.0 || local94.dot(forwardXZ) <= 0.0) {
            this.exitCannon();
            return;
        }

        this.m_smoothedForward.copy(cannonOrientation.multVector33(Vector3f.ez));
        this.m_speed = this.m_baseSpeed;
        const cannonPoint = CourseMap.Instance()!.getCannonPoint(this.state().cannonPointId())!;
        const cannonParameterIdx = Math.max(0, cannonPoint.parameterIdx());
        if (cannonParameterIdx >= CANNON_PARAMETERS.length) {
            throw new Error(`KartMove::calcCannon: invalid cannon parameter ${cannonParameterIdx}`);
        }
        const cannonParams = CANNON_PARAMETERS[cannonParameterIdx]!;
        let newSpeed = cannonParams.speed;
        if (forwardLength < cannonParams.decelFactor) {
            const factor = fmax(0.0, fr(forwardLength / cannonParams.decelFactor));

            newSpeed = cannonParams.endDecel;
            if (newSpeed <= 0.0) {
                newSpeed = this.m_baseSpeed;
            }

            newSpeed = fr(newSpeed + fr(factor * fr(cannonParams.speed - newSpeed)));
            if (cannonParams.endDecel > 0.0) {
                this.m_speed = fmin(newSpeed, this.m_speed);
            }
        }

        this.m_cannonProgress.addEq(this.m_cannonEntryOfs.mul(newSpeed));

        let newPos = Vector3f.zero.clone();
        if (cannonParams.height > 0.0) {
            const fVar9 = SinFIdx(
                fr(
                    fr(fr(1.0 - fr(forwardLength / this.m_cannonEntryOfsLength)) * 180.0) *
                        DEG2FIDX,
                ),
            );
            newPos = this.m_cannonOrthog.mul(fr(fVar9 * cannonParams.height));
        }

        this.dynamics().setPos(this.m_cannonEntryPos.add(this.m_cannonProgress).add(newPos));
        this.m_dir.copy(this.m_cannonEntryOfs);
        this.m_vel1Dir.copy(this.m_cannonEntryOfs);

        this.calcRotCannon(forward);

        this.dynamics().setExtVel(Vector3f.zero);
    }

    /** @addr{0x805855BC} */
    calcRotCannon(forward: Readonly<Vector3f>): void {
        const local48 = forward.clone();
        local48.normalise();
        const local54 = this.bodyFront().clone();
        const local60 = local54.add(local48.sub(local54).mul(F_0_3));
        local54.normalise();
        local60.normalise();
        // also local70, localA8
        const local80 = new Quatf();
        local80.makeVectorRotation(local54, local60);
        local80.mulEq(this.dynamics().fullRot());
        local80.normalise();
        const localB8 = new Quatf();
        localB8.makeVectorRotation(local80.rotateVector(Vector3f.ey), this.smoothedUp());
        const newRot = local80.slerpTo(localB8.multSwap(local80), F_0_3);
        this.dynamics().setFullRot(newRot);
        this.dynamics().setMainRot(newRot);
    }

    /** @addr{0x805852C8} */
    exitCannon(): void {
        const status = this.status();

        if (status.offBit(eStatus.InCannon)) {
            return;
        }

        status
            .resetBit(eStatus.InCannon, eStatus.SkipWheelCalc)
            .setBit(eStatus.AfterCannon);
        this.dynamics().setIntVel(this.m_cannonEntryOfs.mul(this.m_speed));
    }

    /** @addr{0x805799AC} */
    triggerRespawn(): void {
        this.m_timeInRespawn = 0;
        this.status().setBit(eStatus.TriggerRespawn);
    }

    // -----------------------------------------------------------------------------------------
    // Inline virtuals / helpers from KartMove.hh
    // -----------------------------------------------------------------------------------------

    calcWheelie(): void {}

    /** @addr{0x8058974C} */
    leanRot(): number {
        return 0.0;
    }

    onHop(): void {}

    onWallCollision(): void {}

    /**
     * @addr{0x8057C3C8}
     * Returns the % speed boost from wheelies. For karts, this is always 0.
     */
    getWheelieSoftSpeedLimitBonus(): number {
        return 0.0;
    }

    /** @addr{0x8058758C} */
    canWheelie(): boolean {
        return false;
    }

    /** @addr{0x8057DA18} */
    canHop(): boolean {
        const status = this.status();

        if (status.offAnyBit(eStatus.HopStart, eStatus.TouchingGround)) {
            return false;
        }

        if (status.onBit(eStatus.InAction)) {
            return false;
        }

        return true;
    }

    /**
     * @addr{0x8057EA94}
     * This doesn't bytematch the base game (which uses >); see Kinoko for details.
     */
    canStartDrift(): boolean {
        return this.m_speed >= fr(MINIMUM_DRIFT_THRESOLD * this.m_baseSpeed);
    }

    // Setters

    setSpeed(val: number): void {
        this.m_speed = val;
    }

    setSmoothedUp(v: Readonly<Vector3f>): void {
        this.m_smoothedUp.copy(v);
    }

    setUp(v: Readonly<Vector3f>): void {
        this.m_up.copy(v);
    }

    setDir(v: Readonly<Vector3f>): void {
        this.m_dir.copy(v);
    }

    setVel1Dir(v: Readonly<Vector3f>): void {
        this.m_vel1Dir.copy(v);
    }

    /** `count` is u16. */
    setFloorCollisionCount(count: number): void {
        this.m_floorCollisionCount = count;
    }

    setKCLWheelSpeedFactor(val: number): void {
        this.m_kclWheelSpeedFactor = val;
    }

    setKCLWheelRotFactor(val: number): void {
        this.m_kclWheelRotFactor = val;
    }

    /** @addr{0x8057B9AC} */
    setKartSpeedLimit(): void {
        const LIMIT = 120.0;
        this.m_hardSpeedLimit = LIMIT;
    }

    /** @addr{0x80581720} */
    setScale(v: Readonly<Vector3f>): void {
        this.m_scale.copy(v);
    }

    setPadType(type: Readonly<PadType>): void {
        this.m_padType.copy(type as PadType);
    }

    // Getters

    driftState(): DriftState {
        return this.m_driftState;
    }

    mtCharge(): number {
        return this.m_mtCharge;
    }

    kclSpeedFactor(): number {
        return this.m_kclSpeedFactor;
    }

    kclRotFactor(): number {
        return this.m_kclRotFactor;
    }

    /**
     * @addr{0x8057EFF8}
     * Factors in vehicle speed to retrieve our hop direction and magnitude.
     */
    getAppliedHopStickX(): number {
        return this.canStartDrift() ? this.m_hopStickX : 0;
    }

    override softSpeedLimit(): number {
        return this.m_softSpeedLimit;
    }

    override speed(): number {
        return this.m_speed;
    }

    override acceleration(): number {
        return this.m_acceleration;
    }

    override scale(): Readonly<Vector3f> {
        return this.m_scale;
    }

    hardSpeedLimit(): number {
        return this.m_hardSpeedLimit;
    }

    smoothedUp(): Readonly<Vector3f> {
        return this.m_smoothedUp;
    }

    up(): Readonly<Vector3f> {
        return this.m_up;
    }

    totalScale(): number {
        return this.m_totalScale;
    }

    hitboxScale(): number {
        return this.m_hitboxScale;
    }

    dir(): Readonly<Vector3f> {
        return this.m_dir;
    }

    lastDir(): Readonly<Vector3f> {
        return this.m_lastDir;
    }

    vel1Dir(): Readonly<Vector3f> {
        return this.m_vel1Dir;
    }

    smoothedForward(): Readonly<Vector3f> {
        return this.m_smoothedForward;
    }

    override speedRatioCapped(): number {
        return this.m_speedRatioCapped;
    }

    override speedRatio(): number {
        return this.m_speedRatio;
    }

    floorCollisionCount(): number {
        return this.m_floorCollisionCount;
    }

    override hopStickX(): number {
        return this.m_hopStickX;
    }

    hopPosY(): number {
        return this.m_hopPosY;
    }

    respawnTimer(): number {
        return this.m_respawnTimer;
    }

    respawnPostLandTimer(): number {
        return this.m_respawnPostLandTimer;
    }

    /** Returns the internal flag (C++ `PadType &`); callers may mutate it. */
    padType(): PadType {
        return this.m_padType;
    }

    override jump(): KartJump {
        return this.m_jump;
    }

    override halfPipe(): KartHalfPipe {
        return this.m_halfPipe;
    }

    override kartScale(): KartScale {
        return this.m_kartScale;
    }

    burnout(): KartBurnout {
        return this.m_burnout;
    }
}

const WHEELIE_SPEED_BONUS = fr(0.15);
const WHEELIE_ROTATION_FACTOR = fr(0.2);
const WHEELIE_THRESHOLD = fr(0.3);

/**
 * Responsible for reacting to player inputs and moving the bike.
 * This derived class has specialized behavior for bikes, such as wheelies and leaning.
 */
export class KartMoveBike extends KartMove {
    /** Z-axis rotation of the bike from leaning. */
    private m_leanRot = 0.0;
    /** The maximum leaning rotation. */
    private m_leanRotCap = 0.0;
    /** The incrementor for leaning rotation. */
    private m_leanRotInc = 0.0;
    /** X-axis rotation from wheeling. */
    private m_wheelieRot = 0.0;
    /** The maximum wheelie rotation. */
    private m_maxWheelieRot = 0.0;
    /** u32. Tracks wheelie duration and cancels the wheelie after 180 frames. */
    private m_wheelieFrames = 0;
    /** s16. The number of frames before another wheelie can start. */
    private m_wheelieCooldown = 0;
    /** The wheelie rotation decrementor, used after a wheelie has ended. */
    private m_wheelieRotDec = 0.0;
    /** s16 */
    private m_autoHardStickXFrames = 0;
    /** Inside/outside drifting bike turn info. */
    private m_turningParams: Readonly<TurningParameters> = TURNING_PARAMS_ARRAY[0]!;

    /** @addr{0x80587B30} */
    constructor() {
        super();
        this.m_leanRot = 0.0;
    }

    /**
     * @addr{0x80588350}
     * Sets the wheelie bit flag and some wheelie-related variables.
     */
    startWheelie(): void {
        const MAX_WHEELIE_ROTATION = fr(0.07);
        const WHEELIE_COOLDOWN = 20;

        this.status().setBit(eStatus.Wheelie);
        this.m_wheelieFrames = 0;
        this.m_maxWheelieRot = MAX_WHEELIE_ROTATION;
        this.m_wheelieCooldown = WHEELIE_COOLDOWN;
        this.m_wheelieRotDec = 0.0;
        this.m_autoHardStickXFrames = 0;
    }

    /**
     * @addr{0x805883C4}
     * Clears the wheelie bit flag and resets the rotation decrement.
     */
    cancelWheelie(): void {
        this.status().resetBit(eStatus.Wheelie);
        this.m_wheelieRotDec = 0.0;
        this.m_autoHardStickXFrames = 0;
    }

    /** @addr{0x80587BB8} */
    override createSubsystems(stats: Readonly<Stats>): void {
        this.m_jump = new KartJumpBike(this);
        this.m_halfPipe = new KartHalfPipe();
        this.m_kartScale = new KartScale(stats);
    }

    /**
     * @addr{0x80587D68}
     * Every frame, calculates rotation, EV, and angular velocity for the bike.
     */
    override calcVehicleRotation(turn: number): void {
        let leanRotInc = this.m_turningParams.leanRotIncRace;
        let leanRotCap = this.m_turningParams.leanRotCapRace;
        const raceManager = RaceManager.Instance()!;

        const status = this.status();

        if (status.offBit(eStatus.ChargingSSMT)) {
            if (!raceManager.isStageReached(Stage.Race) || Math.abs(this.m_speed) < 5.0) {
                leanRotInc = this.m_turningParams.leanRotIncCountdown;
                leanRotCap = this.m_turningParams.leanRotCapCountdown;
            }
        } else {
            leanRotInc = this.m_turningParams.leanRotIncSSMT;
            leanRotCap = this.m_turningParams.leanRotCapSSMT;
        }

        this.m_leanRotCap = fr(this.m_leanRotCap + fr(F_0_3 * fr(leanRotCap - this.m_leanRotCap)));
        this.m_leanRotInc = fr(this.m_leanRotInc + fr(F_0_3 * fr(leanRotInc - this.m_leanRotInc)));

        const stickX = this.state().stickX();
        let extVelXFactor = 0.0;
        let leanRotMin = -this.m_leanRotCap;
        let leanRotMax = this.m_leanRotCap;

        if (
            status.onBit(
                eStatus.BeforeRespawn,
                eStatus.InAction,
                eStatus.Wheelie,
                eStatus.OverZipper,
                eStatus.RejectRoadTrigger,
                eStatus.AirtimeOver20,
                eStatus.SoftWallUnlockRotation,
                eStatus.SoftWallPush,
                eStatus.HWG,
                eStatus.CannonStart,
                eStatus.InCannon,
            )
        ) {
            this.m_leanRot = fr(this.m_leanRot * this.m_turningParams.leanRotDecayFactor);
        } else if (!this.state().isDrifting()) {
            if (stickX <= F_0_2) {
                if (stickX >= -F_0_2) {
                    this.m_leanRot = fr(this.m_leanRot * this.m_turningParams.leanRotDecayFactor);
                } else {
                    this.m_leanRot = fr(this.m_leanRot - this.m_leanRotInc);
                    extVelXFactor = this.m_turningParams.leanRotShallowFactor;
                }
            } else {
                this.m_leanRot = fr(this.m_leanRot + this.m_leanRotInc);
                extVelXFactor = -this.m_turningParams.leanRotShallowFactor;
            }
        } else {
            leanRotMax = this.m_turningParams.leanRotMaxDrift;
            leanRotMin = this.m_turningParams.leanRotMinDrift;

            if (this.m_hopStickX === 1) {
                leanRotMin = -leanRotMax;
                leanRotMax = -this.m_turningParams.leanRotMinDrift;
            }
            if (this.m_hopStickX === -1) {
                if (stickX === 0.0) {
                    this.m_leanRot = fr(this.m_leanRot + fr(fr(0.5 - this.m_leanRot) * F_0_05));
                } else {
                    this.m_leanRot = fr(
                        this.m_leanRot + fr(this.m_turningParams.driftStickXFactor * stickX),
                    );
                    extVelXFactor = fr(-this.m_turningParams.leanRotShallowFactor * stickX);
                }
            } else if (stickX === 0.0) {
                this.m_leanRot = fr(this.m_leanRot + fr(fr(-0.5 - this.m_leanRot) * F_0_05));
            } else {
                this.m_leanRot = fr(
                    this.m_leanRot + fr(this.m_turningParams.driftStickXFactor * stickX),
                );
                extVelXFactor = fr(-this.m_turningParams.leanRotShallowFactor * stickX);
            }
        }

        let capped = false;
        if (leanRotMin <= this.m_leanRot) {
            if (leanRotMax < this.m_leanRot) {
                this.m_leanRot = leanRotMax;
                capped = true;
            }
        } else {
            this.m_leanRot = leanRotMin;
            capped = true;
        }

        if (!capped) {
            this.dynamics().setExtVel(
                this.dynamics().extVel().add(this.componentXAxis().mul(extVelXFactor)),
            );
        }

        const leanRotScalar = this.state().isDrifting() ? fr(0.065) : F_0_05;

        this.calcStandstillBoostRot();

        this.dynamics().setAngVel2(
            this.dynamics()
                .angVel2()
                .add(
                    new Vector3f(
                        this.m_standStillBoostRot,
                        fr(turn * this.wheelieRotFactor()),
                        fr(this.m_leanRot * leanRotScalar),
                    ),
                ),
        );

        this.calcDive();

        let top = this.m_up.clone();

        if (status.offBit(eStatus.RejectRoad, eStatus.HalfPipeRamp, eStatus.OverZipper)) {
            let scalar = this.m_speed >= 0.0 ? fr(this.m_speedRatioCapped * 2.0) : 0.0;
            scalar = fmin(1.0, scalar);
            top = this.m_up.mul(scalar).add(Vector3f.ey.mul(fr(1.0 - scalar)));

            if (F32_EPSILON < top.squaredLength()) {
                top.normalise();
            }
        }

        this.dynamics().setTop_(top);
    }

    /**
     * @addr{0x80587C54}
     * On init, sets the bike's lean rotation cap and increment. Also called when falling OOB.
     */
    override setTurnParams(): void {
        super.setTurnParams();

        if (this.param().stats().driftType === Stats.DriftType.Outside_Drift_Bike) {
            this.m_turningParams = TURNING_PARAMS_ARRAY[0]!;
        } else if (this.param().stats().driftType === Stats.DriftType.Inside_Drift_Bike) {
            this.m_turningParams = TURNING_PARAMS_ARRAY[1]!;
        }

        if (RaceManager.Instance()!.isStageReached(Stage.Race)) {
            this.m_leanRotInc = this.m_turningParams.leanRotIncRace;
            this.m_leanRotCap = this.m_turningParams.leanRotCapRace;
        } else {
            this.m_leanRotInc = this.m_turningParams.leanRotIncCountdown;
            this.m_leanRotCap = this.m_turningParams.leanRotCapCountdown;
        }
    }

    /** @addr{0x80587D00} */
    override init(b1: boolean, b2: boolean): void {
        super.init(b1, b2);

        this.m_leanRot = 0.0;
        this.m_leanRotCap = 0.0;
        this.m_leanRotInc = 0.0;
        this.m_wheelieRot = 0.0;
        this.m_maxWheelieRot = 0.0;
        this.m_wheelieFrames = 0;
        this.m_wheelieCooldown = 0;
        this.m_autoHardStickXFrames = 0;
    }

    /** @addr{0x80588950} */
    override clear(): void {
        super.clear();
        this.cancelWheelie();
    }

    /**
     * @addr{0x805883F4}
     * Every frame, checks player input for wheelies and computes wheelie rotation.
     */
    override calcWheelie(): void {
        const FAILED_WHEELIE_FRAMES = 15;
        const AUTO_WHEELIE_CANCEL_STICK_THRESHOLD = fr(0.85);

        this.tryStartWheelie();
        this.m_wheelieCooldown = Math.max(0, this.m_wheelieCooldown - 1);

        const status = this.status();

        if (status.onBit(eStatus.Wheelie)) {
            let cancelAutoWheelie = false;

            if (
                status.offBit(eStatus.AutoDrift) ||
                Math.abs(this.state().stickX()) <= AUTO_WHEELIE_CANCEL_STICK_THRESHOLD
            ) {
                this.m_autoHardStickXFrames = 0;
            } else {
                this.m_autoHardStickXFrames = s16(this.m_autoHardStickXFrames + 1);
                if (this.m_autoHardStickXFrames > 15) {
                    cancelAutoWheelie = true;
                }
            }

            this.m_wheelieFrames = (this.m_wheelieFrames + 1) >>> 0;
            if (
                this.m_turningParams.maxWheelieFrames < this.m_wheelieFrames ||
                cancelAutoWheelie ||
                (!this.canWheelie() && FAILED_WHEELIE_FRAMES <= this.m_wheelieFrames)
            ) {
                this.cancelWheelie();
            } else {
                this.m_wheelieRot = fr(this.m_wheelieRot + F_0_01);
                const angVel0 = this.dynamics().angVel0().clone();
                angVel0.x = fr(angVel0.x * F_0_9);
                this.dynamics().setAngVel0(angVel0);
            }
        } else if (0.0 < this.m_wheelieRot) {
            this.m_wheelieRotDec = fr(this.m_wheelieRotDec - fr(0.001));
            this.m_wheelieRotDec = fmax(-F_0_03, this.m_wheelieRotDec);
            this.m_wheelieRot = fr(this.m_wheelieRot + this.m_wheelieRotDec);
        }

        this.m_wheelieRot = fmax(0.0, fmin(this.m_wheelieRot, this.m_maxWheelieRot));

        const vel1DirUp = this.m_vel1Dir.dot(Vector3f.ey);

        if (this.m_wheelieRot > 0.0) {
            if (vel1DirUp <= 0.5 || this.m_wheelieFrames < FAILED_WHEELIE_FRAMES) {
                const angVel2 = this.dynamics().angVel2().clone();
                angVel2.x = fr(
                    angVel2.x - fr(this.m_wheelieRot * fr(1.0 - Math.abs(vel1DirUp))),
                );
                this.dynamics().setAngVel2(angVel2);
            } else {
                this.cancelWheelie();
            }

            status.setBit(eStatus.WheelieRot);
        } else {
            status.resetBit(eStatus.WheelieRot);
        }
    }

    /**
     * @addr{0x80588B30}
     * Virtual function that just cancels wheelies when you hop.
     */
    override onHop(): void {
        if (this.status().onBit(eStatus.AutoDrift)) {
            return;
        }

        this.cancelWheelie();
    }

    /** Called when you collide with a wall. All it does for bikes is cancel wheelies. */
    override onWallCollision(): void {
        this.cancelWheelie();
    }

    /**
     * @addr{0x80588888}
     * Every frame during a drift, calculates MT charge based on player input.
     */
    override calcMtCharge(): void {
        const MAX_MT_CHARGE = 270;
        const BASE_MT_CHARGE = 2;
        const BONUS_CHARGE_STICK_THRESHOLD = F_0_4;
        const EXTRA_MT_CHARGE = 3;

        if (this.m_driftState !== DriftState.ChargingMt) {
            return;
        }

        this.m_mtCharge = u16(this.m_mtCharge + BASE_MT_CHARGE);

        const stickX = this.state().stickX();
        if (-BONUS_CHARGE_STICK_THRESHOLD <= stickX) {
            if (BONUS_CHARGE_STICK_THRESHOLD < stickX && this.m_hopStickX === -1) {
                this.m_mtCharge = u16(this.m_mtCharge + EXTRA_MT_CHARGE);
            }
        } else if (this.m_hopStickX !== -1) {
            this.m_mtCharge = u16(this.m_mtCharge + EXTRA_MT_CHARGE);
        }

        if (this.m_mtCharge > MAX_MT_CHARGE) {
            this.m_mtCharge = MAX_MT_CHARGE;
            this.m_driftState = DriftState.ChargedMt;
        }
    }

    /** @addr{0x80588B58} */
    override initOob(): void {
        super.initOob();
        this.cancelWheelie();
    }

    /**
     * @addr{0x80588798}
     * Every frame, checks player input to see if we should start or stop a wheelie.
     */
    tryStartWheelie(): void {
        const COOLDOWN_FRAMES = 20;
        const dpadUp = this.inputs().currentState().trickUp();
        const status = this.status();

        if (status.offBit(eStatus.Wheelie)) {
            if (dpadUp && status.onBit(eStatus.TouchingGround)) {
                if (
                    status.onBit(
                        eStatus.DriftManual,
                        eStatus.WallCollision,
                        eStatus.Wall3Collision,
                        eStatus.Hop,
                        eStatus.DriftAuto,
                        eStatus.InAction,
                    )
                ) {
                    return;
                }

                if (this.m_wheelieCooldown > 0) {
                    return;
                }

                this.startWheelie();
            }
        } else if (this.inputs().currentState().trickDown() && this.m_wheelieCooldown <= 0) {
            this.cancelWheelie();
            this.m_wheelieCooldown = COOLDOWN_FRAMES;
        }
    }

    // Inline header methods

    /**
     * @addr{0x80588324}
     * Returns what % to raise the speed cap when wheeling.
     */
    override getWheelieSoftSpeedLimitBonus(): number {
        return this.status().onBit(eStatus.Wheelie) ? WHEELIE_SPEED_BONUS : 0.0;
    }

    /** @addr{0x80588860} */
    wheelieRotFactor(): number {
        return this.status().onBit(eStatus.Wheelie) ? WHEELIE_ROTATION_FACTOR : 1.0;
    }

    /** @addr{0x805896BC} */
    override leanRot(): number {
        return this.m_leanRot;
    }

    /**
     * @addr{0x80588FE0}
     * Checks if the kart is going fast enough to wheelie.
     */
    override canWheelie(): boolean {
        return this.m_speedRatioCapped >= WHEELIE_THRESHOLD && this.m_speed >= 0.0;
    }
}
