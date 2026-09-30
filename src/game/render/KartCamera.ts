/**
 * Port of Kinoko's game/render/KartCamera.{hh,cc}.
 * Manager class for the forward and backwards cameras. Responsible for setting the camera state
 * and performing camera collision checks.
 *
 * Fields are left public (C++ has `friend class Host::Context`) so the renderer can read them.
 */

import { box } from '../../egg/core/Box';
import { acos, atan2, DEG2RAD, F32_EPSILON, fclamp, fmax, fmin, fr, RAD2DEG, sqrt } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';

import { CollisionDirector } from '../field/CollisionDirector';
import { CourseColMgr, NoBounceWallColInfo } from '../field/CourseColMgr';
import {
    COL_TYPE_FALL_BOUNDARY,
    COL_TYPE_SOLID_OOB,
    COL_TYPE_WEAK_WALL,
    KCL_TYPE_BIT,
    KCL_TYPE_CAMERA_COLLIDABLE,
    KCL_TYPE_FLOOR,
    KCL_TYPE_WALL,
    type KCLTypeMask,
} from '../field/KCollisionTypes';
import { CollisionInfo, F32_MIN } from '../field/KColData';
import { KartObjectManager } from '../kart/KartObjectManager';
import type { KartHalfPipe } from '../kart/KartHalfPipe';
import type { KartObjectProxy } from '../kart/KartObjectProxy';
import { KartParam } from '../kart/KartParam';
import { eStatus } from '../kart/Status';

// KartCamera::calc
const HOP_POS_INTERP_RATE = fr(0.8);
const FORWARD_INTERP_RATE = fr(0.35);
const HORIZ_POS_INTERP_RATE = fr(0.05);
const VERT_POS_INTERP_RATE = fr(0.03);
const FAST_VERT_POS_INTERP_RATE = fr(0.1);

// KartCamera::calcDriftOffset
const MAX_DRIFT_YAW_AUTOMATIC = 10.0;
const MAX_DRIFT_YAW_MANUAL = 15.0;
const YAW_STEP_AUTOMATIC = 0.5;
const YAW_STEP_MANUAL = 1.0;

// KartCamera::calcCamera
const BIG_AIR_PITCH_CAP = fr(89.0 * DEG2RAD);

// KartCamera::calcAirtimeHeight
const BIG_AIR_HEIGHT_CAP = 300.0;

// KartCamera::calcCollision
const FRONT_RADIUS = 80.0;
const BACK_RADIUS = 140.0;

const F_0_1 = fr(0.1);
const F_0_6 = fr(0.6);
const F_0_2 = fr(0.2);
const F_0_3 = fr(0.3);
const F_0_005 = fr(0.005);
const F_0_03 = fr(0.03);
const F_0_05 = fr(0.05);
const F_0_02 = fr(0.02);
const F_0_7 = fr(0.7);
const F_0_01 = fr(0.01);
const F_0_06 = fr(0.06);
const F_0_8 = fr(0.8);
const F_0_97 = fr(0.97);
const F_0_15 = fr(0.15);
const F_0_04 = fr(0.04);
const HALF_PI = fr(1.5707963);

// Not in Kinoko: wall avoidance line-of-sight probe (NTSC-U 0x8059A510 / 0x8059A794).
const PROBE_STEP = 78.0;
const PROBE_RADIUS = 80.0;

// Not in Kinoko (NTSC-U RaceCamera::calcCamera 0x80598478): the camera sits lower in a cannon.
const CANNON_POS_Y = 200.0;

/** Tracks the current state of the front and backwards player cameras. */
export class KartCameraState {
    readonly m_pos = new Vector3f();
    /** Additional camera height applied after 20 frames of airtime. */
    m_bigAirHeight = 0.0;
    /** TODO: Seems to be related to boost-induced pitch. */
    m_1c = 0.0;
    readonly m_prevPos = new Vector3f();
    /** Distance away from TODO. */
    m_dist = 0.0;
    /** Height applied once you start falling after 20 frames of airtime. */
    m_bigAirFallPitch = 0.0;
    /** The position the camera looks towards. */
    readonly m_targetPos = new Vector3f();
    /** Not in Kinoko: half-pipe sideways camera shift and its target (state+0x44/+0x48). */
    m_zipperShift = 0.0;
    m_zipperShiftTarget = 0.0;

    // ---- Not in Kinoko: the real game's camera collision response and wall avoidance ----------
    // (NTSC-U 0x8059AD38 / 0x80599DFC; RaceCamera state offsets in brackets.)
    /** Yaw away from a wall the camera is scraping (+0x5C). */
    m_wallYaw = 0.0;
    /** Frames to not push the camera out of a wall it hit while moving fast (+0x64). */
    m_wallTimer = 0;
    /** Line-of-sight probe offsets from the kart and from the camera (+0x70/+0x74). */
    readonly m_probeOffset = [0.0, 0.0];
    /** Yaw/pitch that swing the camera around an obstruction, and their targets (+0x78..+0x84). */
    m_avoidYaw = 0.0;
    m_avoidPitch = 0.0;
    m_avoidYawTarget = 0.0;
    m_avoidPitchTarget = 0.0;
    /** Frames an obstruction was last seen from the kart / camera side (+0x94/+0x96). */
    readonly m_probeTimer = [0, 0];
    /** Frames to keep the "boxed in" overhead pitch (+0x98). */
    m_avoidPitchTimer = 0;
    /** Half-pipe wall normal and push-out rate (+0xB8/+0xC4/+0xC8). */
    readonly m_zipperWallNrm = new Vector3f();
    m_zipperPushRate = 0.1;
    m_zipperPushRising = false;
    /** The last collision response hit a wall (+0x28). */
    m_wallHit = false;

    constructor() {
        this.m_pos.setZero();
        this.m_bigAirHeight = 0.0;
        this.m_1c = 0.0;
        this.m_prevPos.setZero();
        this.m_dist = 0.0;
        this.m_bigAirFallPitch = 0.0;
        this.m_targetPos.setZero();
    }

    /** @addr{0x805A1C3C} (Kinoko resets only the first two; the rest are the real game's.) */
    init(): void {
        this.m_dist = 0.0;
        this.m_bigAirFallPitch = 0.0;
        this.m_wallYaw = 0.0;
        this.m_wallTimer = 0;
        this.m_probeOffset[0] = this.m_probeOffset[1] = 0.0;
        this.m_avoidYaw = this.m_avoidPitch = 0.0;
        this.m_avoidYawTarget = this.m_avoidPitchTarget = 0.0;
        this.m_probeTimer[0] = this.m_probeTimer[1] = 0;
        this.m_avoidPitchTimer = 0;
        this.m_zipperWallNrm.setZero();
        this.m_zipperPushRate = F_0_1;
        this.m_zipperPushRising = false;
        this.m_wallHit = false;
    }
}

let s_instance: KartCamera | null = null;

export class KartCamera {
    /** Rotation induced when drifting. */
    m_driftYaw = 0.0;
    /** Induces a downwards camera position offset. */
    m_hopPosY: number;
    readonly m_forward = new Vector3f();
    readonly m_right = new Vector3f();

    /** Kinoko assumes the use of the 16:9 camera. */
    m_camParams: KartParam.KartCameraParam | null;

    /** Forward camera state. */
    readonly m_forwardCamera = new KartCameraState();
    /** Rear camera state. */
    readonly m_backwardCamera = new KartCameraState();

    // ---- Not in Kinoko: the look-at point (RaceCamera::calcTarget, NTSC-U 0x80597CC4) ----------
    // Kinoko only ports what the physics needs; the renderer needs where the camera looks.

    /** targetPosY eased from 100 (RaceCamera+0x344). */
    m_targetPosY = 100.0;
    /** Extra look-at height from the kart's pitch: eases to 130 * |smoothedForward.y| (+0x104). */
    m_pitchHeight = 0.0;
    /** Look-at drop while over a half-pipe zipper: eases to -100 (+0x10C). */
    m_zipperHeight = 0.0;
    /** Look-at shift along the camera's up while falling off a half-pipe (+0x110). */
    m_zipperFallHeight = 0.0;
    /** Look-at height above targetPos (+0x108). */
    m_targetHeight = 0.0;
    /** The point the camera looks at (targetPos + m_targetHeight up). */
    readonly m_lookAt = new Vector3f();
    /** Not in Kinoko: extra half-pipe orbit rotation while falling, eased (RaceCamera+0x118). */
    m_zipperFallBlend = 0.0;
    /**
     * The rendered camera position (RaceCamera+0xA0): the forward camera's position before this
     * frame's collision response, which only moves it for the next frame.
     */
    readonly m_viewPos = new Vector3f();
    /** The rendered look-at point (RaceCamera+0x70): m_lookAt moved along m_up on half-pipes. */
    readonly m_viewAt = new Vector3f();
    /** The rendered camera up vector (RaceCamera+0x7C); tilts (rolls) over half-pipes. */
    readonly m_up = new Vector3f(0.0, 1.0, 0.0);
    /** Up direction the camera rolls toward (+0x150), previous / smoothed up (+0x15C/+0x168). */
    readonly m_upTarget = new Vector3f(0.0, 1.0, 0.0);
    readonly m_prevUp = new Vector3f(0.0, 1.0, 0.0);
    readonly m_smoothUp = new Vector3f(0.0, 1.0, 0.0);
    /** Blend toward the new up and the rotation used when the up is near horizontal (+0x174/+0x178). */
    m_upBlend = 1.0;
    m_upRot = new Quatf(1.0, 0.0, 0.0, 0.0);

    /**
     * Not in Kinoko: camera mode flags (RaceCamera+0x334). The fall camera is set when the kart
     * falls into a fall boundary: FALL keeps the camera where it is while the kart falls; FALL_RISE
     * (fall boundary variants 1-3) also freezes the look-at point and lifts the camera up to 800
     * while lowering the look-at. Cleared when the kart respawns (initPos).
     */
    m_flags = 0;
    static readonly FLAG_FALL = 0x8;
    static readonly FLAG_FALL_RISE = 0x10;
    /** Fall camera rise and look-at drop so far (+0x124/+0x128). */
    m_fallRise = 0.0;
    m_fallDrop = 0.0;

    /** Not in Kinoko: the camera FOV (RaceCamera+0x11C) and its boost widening (+0x120). */
    m_fov = 0.0;
    m_fovBoost = 0.0;
    private m_prevBoostKinds = [false, false, false, false];

    /** @addr{0x805A2034} */
    init(): void {
        const param = KartObjectManager.Instance().object(0).param();
        this.m_camParams = param.camera();

        this.initPos();

        // Real game (NTSC-U 0x80597148): after initPos.
        this.m_fovBoost = 0.0;
        this.m_fov = this.m_camParams.fov;
        this.m_targetPosY = 100.0;
        this.m_flags = 0;
    }

    /** Not in Kinoko: the kart's fall camera (NTSC-U 0x8058A6D4 / 0x8058A6F4, from KartCollide). */
    startFallCamera(rise: boolean): void {
        this.m_flags |= rise ? KartCamera.FLAG_FALL | KartCamera.FLAG_FALL_RISE : KartCamera.FLAG_FALL;
    }

    /** Not in Kinoko: the kart respawned; snap the camera behind it (NTSC-U 0x8058A604 → initPos). */
    respawn(): void {
        this.initPos();
    }

    /** @addr{0x805A21D0} */
    calc(): void {
        const kartObj = KartObjectManager.Instance().object(0);
        const targetPos = kartObj.pos().clone();
        this.m_hopPosY = fr(
            this.m_hopPosY + fr(HOP_POS_INTERP_RATE * fr(kartObj.move().hopPosY() - this.m_hopPosY)),
        );
        targetPos.y = fr(targetPos.y - this.m_hopPosY);

        this.calcForward(FORWARD_INTERP_RATE, kartObj);
        this.calcTarget(F_0_03, 130.0, F_0_2, kartObj, targetPos);
        this.calcDriftOffset(kartObj);

        this.calcCamera(
            HORIZ_POS_INTERP_RATE,
            VERT_POS_INTERP_RATE,
            FAST_VERT_POS_INTERP_RATE,
            this.m_forwardCamera,
            false,
            kartObj,
            targetPos,
        );
        this.calcCamera(
            HORIZ_POS_INTERP_RATE,
            VERT_POS_INTERP_RATE,
            FAST_VERT_POS_INTERP_RATE,
            this.m_backwardCamera,
            true,
            kartObj,
            targetPos,
        );

        // Real game order (NTSC-U 0x80597198): view position, then per camera the collision
        // response and wall avoidance.
        const fwd = this.m_forwardCamera;
        if (this.m_flags & KartCamera.FLAG_FALL) {
            if (this.m_flags & (KartCamera.FLAG_FALL_RISE | 0x100)) {
                const rise = fr(this.m_fallRise + fr(F_0_04 * fr(800.0 - this.m_fallRise)));
                this.m_viewPos.y = fr(this.m_viewPos.y + fr(rise - this.m_fallRise));
                this.m_fallRise = rise;
                const drop = fr(this.m_fallDrop + fr(F_0_04 * fr(this.m_camParams!.targetPosY - this.m_fallDrop)));
                this.m_lookAt.y = fr(this.m_lookAt.y - fr(drop - this.m_fallDrop));
                this.m_fallDrop = drop;
            }
            if (fwd.m_avoidPitchTarget > 0.5 || fwd.m_wallHit) {
                this.m_viewPos.x = fwd.m_pos.x;
                this.m_viewPos.z = fwd.m_pos.z;
            }
        } else {
            this.m_viewPos.copy(fwd.m_pos);
        }
        const forward = kartObj.move().smoothedForward();
        this.calcCollision(this.m_forwardCamera, false, kartObj, forward);
        this.calcWallAvoid(this.m_forwardCamera, false, kartObj);
        this.calcCollision(this.m_backwardCamera, true, kartObj, forward.neg());
        this.calcWallAvoid(this.m_backwardCamera, true, kartObj);
        this.calcUp(F_0_1, kartObj);
        this.calcFov(kartObj);
    }

    /**
     * Not in Kinoko (NTSC-U 0x80599CD8 / 0x80599D84 / 0x80599DA4). A boost starting widens the FOV
     * by 12 * ratio (keeping the larger of a running one): 6 for a mini-turbo, start boost or boost
     * ramp, 10.2 for a trick / half-pipe boost, 12 for a mushroom or dash panel; when no boost is
     * active it's cleared. The FOV eases 10% of the way while widened, 3% otherwise. (The game sets
     * this from the boost code; here the starts are read off the kart's boost state.)
     */
    private calcFov(proxy: KartObjectProxy): void {
        const status = proxy.status();
        const active = (proxy.move() as unknown as { m_boost: { m_active: boolean[] } }).m_boost.m_active;
        const kinds = [active[0]!, active[1]!, active[2]!, status.onBit(eStatus.RampBoost)];
        const extra = [6.0, 12.0, 10.2, 6.0];
        kinds.forEach((on, i) => {
            if (on && !this.m_prevBoostKinds[i]) this.m_fovBoost = Math.max(this.m_fovBoost, fr(extra[i]!));
        });
        if (!kinds.some(Boolean) && status.offBit(eStatus.Boost)) this.m_fovBoost = 0.0;
        this.m_prevBoostKinds = kinds;
        const rate = this.m_fovBoost > 0.0 ? F_0_1 : F_0_03;
        const target = fr(this.m_fovBoost + this.m_camParams!.fov);
        this.m_fov = fr(this.m_fov + fr(rate * fr(target - this.m_fov)));
    }

    /**
     * Not in Kinoko (NTSC-U 0x80599098). The camera's up vector: normally world up (no roll), but
     * over a steep, fast half-pipe jump it rolls toward the ramp's up (rising) or axis (falling).
     * When the new up is near horizontal it turns there by a quaternion slerp instead of a lerp.
     * Also moves the rendered look-at point along it while falling off the half-pipe.
     */
    private calcUp(rate: number, proxy: KartObjectProxy, at: Readonly<Vector3f> = this.m_lookAt): void {
        const view = at.sub(this.m_viewPos);
        view.normalise();
        let target: Readonly<Vector3f> = Vector3f.ey;
        if (proxy.status().onBit(eStatus.OverZipper)) {
            const hp = proxy.halfPipe();
            if (hp.m_camTilt > 20.0 && hp.m_camTakeoffSpeedY > 30.0) {
                if (proxy.velocity().y > 0.0) {
                    target = hp.m_camUp;
                } else {
                    rate = F_0_01;
                    target = hp.m_camAxis;
                }
            }
        }
        this.m_upTarget.addEq(target.sub(this.m_upTarget).mul(rate));
        const side = this.m_upTarget.cross(view);
        side.normalise();
        const up = view.cross(side);

        const turn = new Quatf();
        turn.makeVectorRotation(this.m_prevUp, up);
        const identity = new Quatf(1.0, 0.0, 0.0, 0.0);
        if (up.dot(Vector3f.ey) < F_0_15) {
            this.m_upRot = identity.slerpTo(turn, rate);
            this.m_smoothUp.copy(this.m_upRot.rotateVector(this.m_prevUp));
            this.m_upBlend = rate;
        } else {
            this.m_upRot = this.m_upRot.slerpTo(identity, this.m_upBlend);
            this.m_smoothUp.addEq(up.sub(this.m_smoothUp).mul(this.m_upBlend));
            this.m_upBlend = fmin(fr(this.m_upBlend + F_0_02), 1.0);
        }
        this.m_up.copy(this.m_smoothUp);
        this.m_up.normalise();
        this.m_prevUp.copy(this.m_up);
        this.m_viewAt.copy(this.m_lookAt.add(this.m_up.mul(this.m_zipperFallHeight)));
    }

    /** @addr{0x805A1D10} */
    constructor() {
        this.m_hopPosY = 0;
        this.m_forward.copy(Vector3f.zero);
        this.m_camParams = null;
    }

    static CreateInstance(): KartCamera {
        if (s_instance) throw new Error('KartCamera already created');
        s_instance = new KartCamera();
        return s_instance;
    }

    static DestroyInstance(): void {
        if (!s_instance) throw new Error('KartCamera not created');
        s_instance = null;
    }

    static Instance(): KartCamera {
        return s_instance!;
    }

    /** @addr{0x805A2B84} */
    private calcForward(t: number, proxy: KartObjectProxy): void {
        this.m_forward.copy(
            KartCamera.Interpolate(t, this.m_forward, proxy.move().smoothedForward()),
        );
        this.m_right.copy(Vector3f.ey.perpInPlane(this.m_forward, true));
    }

    /**
     * Not in Kinoko (NTSC-U 0x80597CC4). The look-at height eases toward
     * targetPosY - cameraDistY + 130 * |smoothedForward.y| (so the camera looks higher on slopes)
     * and drops while over a half-pipe zipper.
     */
    private calcTarget(
        rate: number,
        pitchHeightScale: number,
        heightRate: number,
        proxy: KartObjectProxy,
        targetPos: Readonly<Vector3f>,
    ): void {
        if (this.m_flags & KartCamera.FLAG_FALL_RISE) return;
        const camParams = this.m_camParams!;
        this.m_targetPosY = fr(
            this.m_targetPosY + fr(F_0_05 * fr(camParams.targetPosY - this.m_targetPosY)),
        );
        const baseHeight = fr(this.m_targetPosY - proxy.cameraDistY());
        const pitchHeight = fr(
            pitchHeightScale * Math.abs(proxy.move().smoothedForward().dot(Vector3f.ey)),
        );
        const overZipper = proxy.status().onBit(eStatus.OverZipper);
        const zipperHeight = overZipper ? -100.0 : 0.0;
        const fallHeight = overZipper && proxy.velocity().y < 0.0 ? fr(100.0 * this.m_zipperFallBlend) : 0.0;
        this.m_zipperHeight = fr(
            this.m_zipperHeight + fr(rate * fr(zipperHeight - this.m_zipperHeight)),
        );
        this.m_zipperFallHeight = fr(
            this.m_zipperFallHeight + fr(rate * fr(fallHeight - this.m_zipperFallHeight)),
        );
        this.m_pitchHeight = fr(
            this.m_pitchHeight + fr(fr(pitchHeight - this.m_pitchHeight) * rate),
        );
        const height = fr(fr(baseHeight + this.m_pitchHeight) + this.m_zipperHeight);
        this.m_targetHeight = fr(
            this.m_targetHeight + fr(heightRate * fr(height - this.m_targetHeight)),
        );
        this.m_lookAt.set(targetPos.x, fr(targetPos.y + this.m_targetHeight), targetPos.z);
    }

    /** @addr{0x805A3070} */
    private calcDriftOffset(proxy: KartObjectProxy): void {
        const status = proxy.status();
        if (status.onBit(eStatus.DriftManual, eStatus.Hop)) {
            let yaw = fr(fr(proxy.hopStickX()) * -0.5);
            if (proxy.vehicleType() === KartParam.Stats.DriftType.Inside_Drift_Bike) {
                yaw = fr(yaw * -1.0);
            }
            this.m_driftYaw = fr(this.m_driftYaw + yaw);

            let yawMax = status.onBit(eStatus.AutoDrift)
                ? MAX_DRIFT_YAW_AUTOMATIC
                : MAX_DRIFT_YAW_MANUAL;
            const pitch = fr(90.0 - fr(RAD2DEG * acos(this.m_forward.dot(Vector3f.ey))));
            if (pitch < 0.0) {
                yawMax = fr(yawMax + fr(F_0_1 * Math.abs(pitch)));
            }

            this.m_driftYaw = fclamp(this.m_driftYaw, -yawMax, yawMax);
        } else if (this.m_driftYaw !== 0.0) {
            const yawStep = status.onBit(eStatus.AutoDrift) ? YAW_STEP_AUTOMATIC : YAW_STEP_MANUAL;
            if (this.m_driftYaw > 0.0) {
                this.m_driftYaw = fmax(0.0, fr(this.m_driftYaw - yawStep));
            } else {
                this.m_driftYaw = fmin(0.0, fr(this.m_driftYaw + yawStep));
            }
        }
    }

    /** @addr{0x805A34B0} */
    private calcCamera(
        horizInterpRate: number,
        vertInterpRate: number,
        fastVertInterpRate: number,
        state: KartCameraState,
        isBackwards: boolean,
        proxy: KartObjectProxy,
        targetPos: Readonly<Vector3f>,
    ): void {
        const camParams = this.m_camParams!;
        const forwardDir = isBackwards ? this.m_forward.neg() : this.m_forward.clone();
        const pitchAxis = this.m_right.cross(forwardDir);
        pitchAxis.normalise();

        let driftYaw = fr(DEG2RAD * this.m_driftYaw);

        const status = proxy.status();
        if (status.onBit(eStatus.AutoDrift)) {
            driftYaw = fr(driftYaw * -1.0);
        }
        // Real game (not Kinoko): wall yaw / avoidance offsets add to the orbit rotation.
        driftYaw = fr(state.m_avoidYaw + fr(driftYaw + state.m_wallYaw));
        const bigAirPitch = fmin(BIG_AIR_PITCH_CAP, fr(state.m_bigAirFallPitch + state.m_avoidPitch));

        const bigAirPitchMat = new Matrix34f();
        const yawRotMat = new Matrix34f();
        yawRotMat.setAxisRotation(driftYaw, this.m_right);
        bigAirPitchMat.setAxisRotation(bigAirPitch, pitchAxis);
        let orbitDir = yawRotMat.ps_multVector(bigAirPitchMat.ps_multVector(forwardDir));

        const pitch = fr(
            90.0 - fr(RAD2DEG * acos(fclamp(orbitDir.dot(Vector3f.ey), -1.0, 1.0))),
        );

        // If camera is looking downwards
        if (pitch > 0.0) {
            const downPitchMat = new Matrix34f();
            const fVar16 = status.onBit(eStatus.TouchingGround) ? F_0_1 : F_0_6;
            state.m_1c = fr(state.m_1c + fr(F_0_2 * fr(fVar16 - state.m_1c)));
            downPitchMat.setAxisRotation(fr(fr(DEG2RAD * pitch) * state.m_1c), pitchAxis);
            orbitDir = downPitchMat.ps_multVector(orbitDir);
        }
        orbitDir.mulEq(-1.0);

        // Real game (not Kinoko), NTSC-U 0x805986CC..0x80598818: over a half-pipe the forward
        // camera orbits around the ramp's "up" direction, and shifts sideways as the kart turns.
        // (The real backward camera takes a separate path there; it isn't rendered.)
        let zipperShift = isBackwards && status.onBit(eStatus.OverZipper);
        if (!isBackwards && status.onBit(eStatus.OverZipper)) {
            const hp = proxy.halfPipe();
            orbitDir = this.calcZipperOrbit(hp.m_camUp.neg(), proxy, hp);
            const axisTurn = fr(RAD2DEG * KartCamera.AngleBetween(hp.m_camAxis, hp.m_camTakeoffAxis));
            if (axisTurn > 0.0 && hp.m_camTakeoffAxis.dot(hp.m_camUp) > 0.0) {
                state.m_zipperShiftTarget = fmin(fr(F_0_7 * axisTurn), 100.0);
                state.m_zipperShift = fr(
                    state.m_zipperShift + fr(F_0_1 * fr(state.m_zipperShiftTarget - state.m_zipperShift)),
                );
                state.m_pos.addEq(hp.m_camAxis.mul(-state.m_zipperShift));
                zipperShift = true;
            }
        } else if (!status.onBit(eStatus.OverZipper)) {
            this.m_zipperFallBlend = 0.0;
        }
        if (!zipperShift) {
            state.m_zipperShift = 0.0;
        }

        this.calcAirtimeHeight(state, proxy);
        state.m_pos.addEq(targetPos.sub(state.m_targetPos));
        const posOffset = orbitDir.mul(state.m_dist);
        // The real game (not Kinoko) uses a lower camera height in a cannon and 60% of it on a
        // zipper boost.
        const posY = status.onBit(eStatus.InCannon) ? CANNON_POS_Y : camParams.posY;
        let height = fr(fr(posY - proxy.cameraDistY()) + state.m_bigAirHeight);
        if (status.onBit(eStatus.ZipperBoost)) height = fr(height * F_0_6);
        posOffset.y = fr(posOffset.y + height);

        const horizDelta = targetPos.add(posOffset).sub(state.m_pos);
        const vertDelta = horizDelta.y;
        horizDelta.y = 0.0;
        // Real game: the camera follows twice as fast horizontally while charging an SSMT.
        const horizRate = status.onBit(eStatus.ChargingSSMT) ? fr(horizInterpRate * 2.0) : horizInterpRate;
        state.m_pos.addEq(horizDelta.mul(horizRate));

        if (
            (status.onBit(eStatus.TouchingGround) && proxy.speed() > 30.0 && pitch > 15.0) ||
            status.onBit(eStatus.ZipperBoost, eStatus.OverZipper)
        ) {
            vertInterpRate = fastVertInterpRate;
        }
        state.m_pos.y = fr(state.m_pos.y + fr(vertDelta * vertInterpRate));

        const targetDelta = state.m_pos.sub(targetPos);
        if (targetDelta.ps_length() !== 0.0) {
            state.m_pos.copy(targetPos.add(targetDelta.ps_normalize().mul(state.m_dist)));
        }

        state.m_targetPos.copy(targetPos);
    }

    /**
     * Not in Kinoko (NTSC-U 0x8059976C). Rotates the half-pipe orbit direction about the ramp axis
     * by the takeoff tilt, a bit further while falling from a steep, fast takeoff.
     */
    private calcZipperOrbit(orbitDir: Vector3f, proxy: KartObjectProxy, hp: KartHalfPipe): Vector3f {
        const tilt = fclamp(fr(fr(hp.m_camTilt - 20.0) / 60.0), 0.0, 1.0);
        const speed = fclamp(fr(fr(hp.m_camTakeoffSpeedY - 30.0) / 35.0), 0.0, 1.0);
        const blend = proxy.velocity().y < 0.0 ? fr(tilt * speed) : 0.0;
        this.m_zipperFallBlend = fr(this.m_zipperFallBlend + fr(F_0_02 * fr(blend - this.m_zipperFallBlend)));
        const scale = fr(1.0 + this.m_zipperFallBlend);
        const angle = fr(hp.nextSign() * fr(DEG2RAD * fr(scale * hp.m_camTilt)));
        const rot = new Matrix34f();
        rot.setAxisRotation(angle, hp.m_camAxis);
        return rot.ps_multVector(orbitDir);
    }

    /** Unsigned angle between two vectors (radians), as the real game computes it. */
    private static AngleBetween(a: Readonly<Vector3f>, b: Readonly<Vector3f>): number {
        const c = a.cross(b);
        const len = sqrt(fr(fr(c.x * c.x) + fr(c.y * c.y)) + fr(c.z * c.z));
        return Math.abs(atan2(len, a.dot(b)));
    }

    /** @addr{0x805A463C} */
    private calcAirtimeHeight(state: KartCameraState, proxy: KartObjectProxy): void {
        let targetPitch = 0.0;
        let interpRate = F_0_2;
        const status = proxy.status();

        // Real game (NTSC-U 0x80599604), which Kinoko simplifies: no big-air camera while in an
        // action or a cannon, and the fall pitch only eases slowly while actually falling.
        let bigAir = false;
        if (!status.onBit(eStatus.InAction, eStatus.InCannon) && status.onBit(eStatus.AirtimeOver20)) {
            state.m_bigAirHeight = fmin(BIG_AIR_HEIGHT_CAP, fr(state.m_bigAirHeight + 10.0));
            bigAir = true;

            const vel = proxy.velocity();
            if (vel.y < 0.0) {
                targetPitch = fmin(F_0_3, fr(F_0_005 * -vel.y));
                interpRate = F_0_03;
            }
        }
        if (!bigAir) {
            state.m_bigAirHeight = 0.0;
        }

        state.m_bigAirFallPitch = fr(
            state.m_bigAirFallPitch + fr(interpRate * fr(targetPitch - state.m_bigAirFallPitch)),
        );
    }

    /**
     * @addr{0x805A49BC} The real game's version (NTSC-U 0x80599984; Kinoko ports the part that
     * positions the forward camera): also resets the look-at state and the camera flags and snaps
     * the look-at point and the up vector. Called at race start and when the kart respawns.
     */
    private initPos(): void {
        const FORWARD_INTERP_RATE = 1.0;
        const HORIZ_POS_INTERP_RATE = 1.0;
        const VERT_POS_INTERP_RATE = 1.0;
        const FAST_VERT_POS_INTERP_RATE = 1.0;

        const camParams = this.m_camParams!;
        this.m_zipperHeight = 0.0;
        this.m_pitchHeight = 0.0;
        this.m_driftYaw = 0.0;
        this.m_flags = 0;
        this.m_forwardCamera.init();
        this.m_backwardCamera.init();
        this.m_backwardCamera.m_dist = camParams.dist;
        this.m_forwardCamera.m_dist = camParams.dist;

        const kartObj = KartObjectManager.Instance().object(0);
        this.calcForward(FORWARD_INTERP_RATE, kartObj);
        this.calcTarget(1.0, 0.0, 1.0, kartObj, kartObj.pos());
        const oldAt = this.m_viewAt.clone();
        this.m_viewPos.copy(kartObj.pos());
        this.calcCamera(
            HORIZ_POS_INTERP_RATE,
            VERT_POS_INTERP_RATE,
            FAST_VERT_POS_INTERP_RATE,
            this.m_forwardCamera,
            false,
            kartObj,
            kartObj.pos(),
        );
        this.m_upTarget.copy(Vector3f.ey);
        this.m_smoothUp.copy(Vector3f.ey);
        this.m_prevUp.copy(Vector3f.ey);
        this.m_upRot = new Quatf(1.0, 0.0, 0.0, 0.0);
        this.m_upBlend = 1.0;
        this.calcUp(1.0, kartObj, oldAt);
        this.m_viewPos.copy(this.m_forwardCamera.m_pos);
        this.m_viewAt.copy(this.m_lookAt);
        this.m_fallRise = 0.0;
        this.m_fallDrop = 0.0;
    }

    /**
     * @addr{0x805A5D70} The real game's full version (NTSC-U 0x8059AD38); Kinoko only keeps
     * m_prevPos. The camera sphere is pushed out of floors and ceilings; out of walls only when not
     * scraping along them fast (then it yaws away instead). Over a half-pipe it eases toward the
     * pushed-out position.
     */
    private calcCollision(
        state: KartCameraState,
        isBackwards: boolean,
        proxy: KartObjectProxy,
        forward: Readonly<Vector3f>,
    ): void {
        const radius = isBackwards ? BACK_RADIUS : FRONT_RADIUS;
        const status = proxy.status();
        let floorHit = false;
        let ceilingHit = false;
        let wallHit = false;
        let push = new Vector3f();
        let wallNrm = new Vector3f();
        state.m_wallHit = false;
        state.m_wallTimer = Math.max(0, state.m_wallTimer - 1);

        if (status.onBit(eStatus.InCannon, eStatus.AfterCannon)) {
            state.m_prevPos.copy(state.m_pos);
        } else {
            const info = new CollisionInfo();
            const mask = box<KCLTypeMask>(0);
            const hit = CollisionDirector.Instance()!.checkSphereFull(
                radius,
                state.m_pos,
                state.m_prevPos,
                KCL_TYPE_CAMERA_COLLIDABLE,
                info,
                mask,
                0,
            );
            if (!hit) {
                state.m_prevPos.copy(state.m_pos);
            } else {
                push = info.tangentOff.clone();
                state.m_prevPos.copy(state.m_pos.add(push));
                const types = mask.value;
                const ignored = KCL_TYPE_BIT(COL_TYPE_FALL_BOUNDARY) | KCL_TYPE_BIT(COL_TYPE_SOLID_OOB);
                if (types & ignored) {
                    // no response
                } else if (status.onBit(eStatus.OverZipper)) {
                    if (types & KCL_TYPE_WALL) {
                        const prevNrm = state.m_zipperWallNrm;
                        if (prevNrm.dot(prevNrm) > F32_EPSILON) {
                            const hp = proxy.halfPipe();
                            const turn = hp.m_camAxis.cross(info.wallNrm.cross(prevNrm));
                            if (turn.dot(hp.m_camUp) > 0.0) {
                                const change = fclamp(fr(1.0 - info.wallNrm.dot(prevNrm)), 0.0, 1.0);
                                if (change > F_0_01) state.m_zipperPushRising = true;
                                if (state.m_zipperPushRising) {
                                    state.m_zipperPushRate = fmin(fr(state.m_zipperPushRate + F_0_03), F_0_8);
                                }
                            }
                        }
                        state.m_zipperWallNrm.copy(info.wallNrm);
                    }
                    state.m_pos.addEq(state.m_prevPos.sub(state.m_pos).mul(state.m_zipperPushRate));
                } else {
                    if (types & KCL_TYPE_WALL) {
                        wallNrm = info.wallNrm.clone();
                        state.m_wallHit = true;
                        const dir = push.clone();
                        if (dir.normalise() > 0.0) {
                            if (wallNrm.y < -0.3) ceilingHit = true;
                            else wallHit = true;
                            if (dir.dot(forward) < 0.3) {
                                if (proxy.speed() > 50.0 || status.onBit(eStatus.DriftManual)) {
                                    state.m_wallTimer = 5;
                                }
                                // (NTSC-U 0x8059B240: an SSMT-charging special case is not ported.)
                            }
                        }
                    }
                    if (types & KCL_TYPE_FLOOR) floorHit = true;
                }
            }
        }

        if (!status.onBit(eStatus.OverZipper)) {
            state.m_zipperWallNrm.setZero();
            state.m_zipperPushRate = F_0_1;
            state.m_zipperPushRising = false;
        }

        let apply: boolean;
        if (floorHit || ceilingHit) apply = true;
        else if (state.m_avoidPitchTimer > 0) apply = false;
        else apply = wallHit && state.m_wallTimer === 0;
        if (apply) state.m_pos.addEq(push);

        if (state.m_avoidPitchTimer > 0) state.m_prevPos.copy(proxy.pos());

        if (wallHit && state.m_wallTimer <= 0) {
            const side = this.m_right.cross(wallNrm);
            let sign = side.dot(this.m_forward) < 0.0 ? -1.0 : 1.0;
            if (isBackwards) sign = -sign;
            const facing = Math.abs(wallNrm.dot(proxy.move().lastDir()));
            state.m_wallYaw = fr(
                fr(state.m_wallYaw + fr(facing * fr(F_0_06 * sign))) * fr(F_0_6 + fr(F_0_3 * facing)),
            );
        } else {
            state.m_wallYaw = fr(state.m_wallYaw * F_0_97);
        }
    }

    /**
     * Not in Kinoko (NTSC-U 0x80599DFC). Probes the line between the kart and where the camera
     * would be straight behind it, 78 units per frame from each end; when it's blocked from both
     * ends the camera swings (yaws) around the obstruction, and when the kart is slow and boxed
     * in, it tilts up to look down on the kart.
     */
    private calcWallAvoid(state: KartCameraState, isBackwards: boolean, proxy: KartObjectProxy): void {
        const status = proxy.status();
        const check = !status.onBit(eStatus.OverZipper, eStatus.InCannon, eStatus.DriftManual);
        const forward = isBackwards ? this.m_forward.neg() : this.m_forward.clone();
        const kartPos = proxy.pos();

        const delta = state.m_pos.sub(kartPos);
        const along = this.m_right.mul(this.m_right.dot(delta));
        const perp = delta.sub(along);
        const perpLen = sqrt(fr(fr(fr(perp.x * perp.x) + fr(perp.y * perp.y)) + fr(perp.z * perp.z)));
        const ideal = forward.mul(-perpLen).add(kartPos).add(along);

        state.m_probeTimer[0] = Math.max(0, state.m_probeTimer[0]! - 1);
        state.m_probeTimer[1] = Math.max(0, state.m_probeTimer[1]! - 1);
        state.m_avoidPitchTimer = Math.max(0, state.m_avoidPitchTimer - 1);

        if (state.m_probeTimer[0]! > 0 && state.m_probeTimer[1]! > 0) {
            state.m_avoidYaw = fr(state.m_avoidYaw + fr(F_0_1 * fr(state.m_avoidYawTarget - state.m_avoidYaw)));
        } else {
            state.m_avoidYaw = fr(state.m_avoidYaw + fr(F_0_05 * fr(0.0 - state.m_avoidYaw)));
        }
        const pitchTarget = state.m_avoidPitchTimer > 0 ? state.m_avoidPitchTarget : 0.0;
        state.m_avoidPitch = fr(state.m_avoidPitch + fr(F_0_1 * fr(pitchTarget - state.m_avoidPitch)));

        let dir = ideal.sub(kartPos);
        let back = dir.neg();
        dir.normalise();

        let kartSideHit = false;
        let cameraSideFloor = false;
        let kartSidePoint = new Vector3f();
        let cameraSidePoint = new Vector3f();
        if (check) {
            for (let side = 0; side < 2; ++side) {
                if (side === 1) {
                    dir = dir.neg();
                    back = back.neg();
                }
                const tries = state.m_probeTimer[side]! > 0 ? 3 : 1;
                for (let i = 0; i < tries; ++i) {
                    const probe = this.probeLine(state, side, i, ideal, dir, back, kartPos);
                    if (!probe) continue;
                    if (side === 0) kartSidePoint = probe.point;
                    else cameraSidePoint = probe.point;
                    const res = this.probeHit(state, side, probe.point, dir, ideal, isBackwards, kartPos);
                    if (res.floor) cameraSideFloor = true;
                    if (res.hit) {
                        state.m_probeOffset[side] = probe.offset;
                        state.m_probeTimer[side] = 3;
                        if (side === 0) kartSideHit = true;
                        break;
                    }
                }
            }
        }

        if (state.m_probeTimer[0]! <= 0 || state.m_probeTimer[1]! <= 0) {
            state.m_avoidYawTarget = 0.0;
        }

        let boxedIn = false;
        if (
            status.offBit(eStatus.OverZipper) &&
            proxy.state().airtime() > 3 &&
            cameraSideFloor &&
            kartSideHit &&
            Math.abs(proxy.speed()) < 20.0
        ) {
            const a = kartSidePoint.sub(state.m_pos).dot(dir);
            const b = cameraSidePoint.sub(state.m_pos).dot(dir);
            boxedIn = Math.abs(a) > Math.abs(b);
        }
        if (boxedIn) {
            state.m_avoidPitchTimer = 15;
        } else if (state.m_avoidPitchTimer <= 0) {
            state.m_avoidPitchTarget = 0.0;
        }
    }

    /** NTSC-U 0x8059A510: next probe point on the kart-camera line (side 0 from the kart). */
    private probeLine(
        state: KartCameraState,
        side: number,
        attempt: number,
        ideal: Readonly<Vector3f>,
        dir: Readonly<Vector3f>,
        back: Readonly<Vector3f>,
        kartPos: Readonly<Vector3f>,
    ): { offset: number; point: Vector3f } | null {
        const timer = state.m_probeTimer[side]!;
        let offset: number;
        if (timer > 0) {
            offset = attempt === 0 ? state.m_probeOffset[side]! : attempt === 1 ? PROBE_STEP : -PROBE_STEP;
            if (offset < 0.0) return null;
        } else {
            state.m_probeOffset[side] = fr(state.m_probeOffset[side]! + PROBE_STEP);
            offset = state.m_probeOffset[side]!;
        }
        const start = side === 1 ? ideal : kartPos;
        const end = side === 1 ? kartPos : ideal;
        if (start.add(dir.mul(offset)).sub(end).dot(back) < 0.0) {
            if (timer > 0) return null;
            state.m_probeOffset[side] = 0.0;
            offset = 0.0;
        }
        return { offset, point: start.add(dir.mul(offset)) };
    }

    /** NTSC-U 0x8059A794: is the probe point blocked, and where should the camera swing? */
    private probeHit(
        state: KartCameraState,
        side: number,
        point: Readonly<Vector3f>,
        dir: Readonly<Vector3f>,
        ideal: Readonly<Vector3f>,
        isBackwards: boolean,
        kartPos: Readonly<Vector3f>,
    ): { hit: boolean; floor: boolean } {
        const colDir = CollisionDirector.Instance()!;
        let mask = KCL_TYPE_CAMERA_COLLIDABLE;
        if (side === 0) mask = (mask & ~KCL_TYPE_FLOOR) >>> 0;
        const info = new CollisionInfo();
        const types = box<KCLTypeMask>(0);
        let hit = false;
        let floor = false;
        if (colDir.checkSphereFull(PROBE_RADIUS, point, side === 1 ? ideal : kartPos, mask, info, types, 0)) {
            if (types.value & KCL_TYPE_WALL) {
                const n = info.wallNrm;
                if (n.dot(dir) < 0.0 && n.dot(Vector3f.ey) > -0.1) {
                    if (side === 0) this.setAvoidYaw(state, n, dir);
                    hit = true;
                }
            }
            if (side !== 0 && types.value & KCL_TYPE_FLOOR && point.sub(kartPos).length() > 100.0) {
                const f = isBackwards ? this.m_forward.clone() : this.m_forward.neg();
                state.m_avoidPitchTarget = KartCamera.AngleBetween(f, Vector3f.ey);
                floor = true;
            }
        }
        if (!hit && side === 0) {
            const soft = new NoBounceWallColInfo();
            CourseColMgr.Instance()!.setNoBounceWallInfo(soft);
            const softMask = KCL_TYPE_BIT(COL_TYPE_WEAK_WALL);
            if (colDir.checkSphereFull(PROBE_RADIUS, point, ideal, softMask, info, types, 0) && soft.dist > -F32_MIN) {
                this.setAvoidYaw(state, soft.fnrm, dir);
                hit = true;
            }
        }
        return { hit, floor };
    }

    /** Yaw target that turns the camera line parallel to the wall with normal n. */
    private setAvoidYaw(state: KartCameraState, n: Readonly<Vector3f>, dir: Readonly<Vector3f>): void {
        const yaw = fr(KartCamera.AngleBetween(n, dir) - HALF_PI);
        state.m_avoidYawTarget = dir.cross(n).dot(this.m_right) < 0.0 ? -yaw : yaw;
    }

    /** @addr{0x805A2C34} */
    private static Interpolate(
        t: number,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
    ): Vector3f {
        return v0.add(v1.sub(v0).mul(t));
    }
}
