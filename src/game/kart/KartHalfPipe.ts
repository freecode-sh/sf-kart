/** Port of Kinoko source/game/kart/KartHalfPipe.{hh,cc}. */

import { box } from '../../egg/core/Box';
import { DEG2RAD, DEG2RAD360, fclamp, fmax, fmin, fr, RAD2DEG } from '../../egg/math/Math';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';
import { CollisionInfo } from '../field/KColData';
import {
    COL_TYPE_HALFPIPE_INVISIBLE_WALL,
    KCL_NONE,
    KCL_TYPE_ANY_INVISIBLE_WALL,
    KCL_TYPE_BIT,
    KCL_TYPE_DRIVER_FLOOR,
    KCL_TYPE_DRIVER_WALL,
} from '../field/KCollisionTypes';
import { Trick } from '../system/KPadController';
import { eSurfaceFlags } from './KartCollide';
import { KartObjectProxy } from './KartObjectProxy';
import { eStatus } from './Status';

enum StuntType {
    None = -1,
    Backflip = 0,
    Frontflip = 1,
    Side360 = 2,
    Backside = 3,
    Frontside = 4,
    Side720 = 5,
}

/** Angle properties corresponding with the stunts */
interface StuntProperties {
    angleDelta: number;
    angleDeltaMin: number;
    angleDeltaFactorMin: number;
    angleDeltaFactorDecr: number;
    finalAngleScalar: number;
    finalAngle: number;
}

function sp(
    angleDelta: number,
    angleDeltaMin: number,
    angleDeltaFactorMin: number,
    angleDeltaFactorDecr: number,
    finalAngleScalar: number,
    finalAngle: number,
): Readonly<StuntProperties> {
    return {
        angleDelta,
        angleDeltaMin,
        angleDeltaFactorMin,
        angleDeltaFactorDecr,
        finalAngleScalar,
        finalAngle,
    };
}

const STUNT_PROPERTIES: readonly Readonly<StuntProperties>[] = [
    sp(6.0, 2.5, fr(0.955), fr(0.01), fr(0.7), 360.0),
    sp(7.0, 3.0, fr(0.955), fr(0.01), fr(0.7), 360.0),
    sp(7.0, 3.0, fr(0.95), fr(0.01), fr(0.7), 360.0),
    sp(12.0, 2.5, fr(0.955), fr(0.01), 0.0, 360.0),
    sp(4.0, 4.0, fr(0.98), fr(0.01), 0.0, 360.0),
    sp(9.0, 3.0, fr(0.92), fr(0.01), fr(0.8), 720.0),
];

class StuntManager {
    angle = 0.0;
    angleDelta = 0.0;
    angleDeltaFactor = 0.0;
    angleDeltaFactorDecr = 0.0;
    finalAngle = 0.0;
    properties: StuntProperties = sp(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);

    calcAngle(): void {
        if (fr(this.finalAngle * this.properties.finalAngleScalar) < this.angle) {
            this.angleDelta = fmax(
                this.properties.angleDeltaMin,
                fr(this.angleDelta * this.angleDeltaFactor),
            );
            this.angleDeltaFactor = fmax(
                this.properties.angleDeltaFactorMin,
                fr(this.angleDeltaFactor - this.properties.angleDeltaFactorDecr),
            );
        }

        this.angle = fmin(this.finalAngle, fr(this.angle + this.angleDelta));
    }

    setProperties(idx: number): void {
        if (idx < 0 || idx >= STUNT_PROPERTIES.length) {
            throw new Error(`StuntManager::setProperties: invalid idx ${idx}`);
        }

        this.properties = { ...STUNT_PROPERTIES[idx]! };
        this.finalAngle = this.properties.finalAngle;
        this.angleDelta = this.properties.angleDelta;
        this.angleDeltaFactorDecr = this.properties.angleDeltaFactorDecr;
        this.angle = 0.0;
        this.angleDeltaFactor = 1.0;
    }
}

const LANDING_BOOST_DELAY = 3;
const TRICK_COOLDOWN = 10;

/** Handles the physics and boosts associated with zippers. */
export class KartHalfPipe extends KartObjectProxy {
    private m_touchingZipper = false;
    /** s16 */
    private m_timer = 0;
    private m_nextSign = 0.0;
    /** s32. When attempting a trick, tracks how long the animation would be. */
    private m_attemptedTrickTimer = 0;
    private m_rot = new Quatf();
    private m_prevPos: Vector3f;
    private m_stunt = StuntType.None;
    private m_rotSign = 0.0;
    /** s16 */
    private m_nextTimer = 0;
    private m_trick: Trick = Trick.None;
    private m_stuntRot = new Quatf();
    private m_stuntManager = new StuntManager();

    // Not in Kinoko (render only): halfpipe state the real game keeps for the camera
    // (NTSC-U KartHalfPipe::calc 0x805AEEC8, KartHalfPipe+0x14..0x40).
    /** Ramp tilt from vertical at takeoff, degrees in [0, 180] (+0x14). */
    m_camTilt = 0.0;
    /** Vertical speed at takeoff: vel1Dir.y * speed (+0x1C). */
    m_camTakeoffSpeedY = 0.0;
    /** "Up the ramp" direction, kept perpendicular to the kart's up in the air (+0x20). */
    readonly m_camUp = new Vector3f();
    /** Rotation axis for the camera orbit, kept perpendicular to m_camUp (+0x2C). */
    readonly m_camAxis = new Vector3f();
    /** m_camAxis at takeoff (+0x38). */
    readonly m_camTakeoffAxis = new Vector3f();

    /** Sign of the stunt rotation, also used by the real game's camera (+0x44). */
    nextSign(): number {
        return this.m_nextSign;
    }

    /** @addr{0x80574114} */
    constructor() {
        super();
        this.m_prevPos = Vector3f.zero.clone();
    }

    /** @addr{0x805741B0} */
    reset(): void {
        this.m_stunt = StuntType.None;
        this.m_touchingZipper = false;
        this.m_timer = 0;
    }

    /** @addr{0x80574340} */
    calc(): void {
        const status = this.status();

        if (this.state().airtime() > 15 && status.onBit(eStatus.OverZipper)) {
            this.m_timer = LANDING_BOOST_DELAY;
        }

        const isLanding = status.onBit(eStatus.HalfPipeRamp) && this.m_timer <= 0;

        this.calcTrick();

        if (
            status.offBit(eStatus.InAction) &&
            this.collide().surfaceFlags().offBit(eSurfaceFlags.StopHalfPipeState)
        ) {
            if (this.m_touchingZipper && status.onBit(eStatus.AirStart)) {
                this.dynamics().setExtVel(Vector3f.zero);
                status.setBit(eStatus.OverZipper);

                const upXZ = this.move().up().clone();
                upXZ.y = 0.0;
                upXZ.normalise();
                const up = this.move().dir().perpInPlane(upXZ, true);

                const local_64 = up.cross(this.bodyUp().perpInPlane(up, true));
                this.m_nextSign = local_64.dot(Vector3f.ey) > 0.0 ? 1.0 : -1.0;

                // Real game only (camera state).
                const rampDeg = fr(RAD2DEG * fr(Math.acos(fclamp(up.dot(Vector3f.ey), -1.0, 1.0))));
                this.m_camTilt = fclamp(fr(90.0 - rampDeg), 0.0, 180.0);
                this.m_camTakeoffSpeedY = fr(this.move().vel1Dir().y * this.move().speed());
                this.m_camUp.copy(up);
                this.m_camAxis.copy(this.bodyUp().perpInPlane(up, true));
                this.m_camTakeoffAxis.copy(this.m_camAxis);

                const velNorm = this.velocity().clone();
                velNorm.normalise();
                const rot = this.dynamics().mainRot().rotateVectorInv(velNorm);

                this.m_rot.makeVectorRotation(rot, Vector3f.ez);
                this.m_prevPos.copy(this.prevPos());

                this.calcLanding(false);

                const scaledDir = fmin(65.0, fr(this.move().dir().y * this.move().speed()));
                // std::max<s32>(0, f32) converts the float to s32 first.
                this.m_attemptedTrickTimer = Math.max(
                    0,
                    Math.trunc(fr(fr(fr(scaledDir * 2.0) / fr(1.3)) - 1.0)) | 0,
                );
            } else if (status.onBit(eStatus.OverZipper)) {
                this.dynamics().setGravity(fr(-1.3));

                const side = this.mainRot().rotateVector(Vector3f.ez);
                const velNorm = this.velocity().clone();
                velNorm.normalise();

                let sideRot = new Quatf();
                sideRot.makeVectorRotation(side, velNorm);
                sideRot = sideRot.multSwap(this.mainRot()).multSwap(this.m_rot);

                const t = this.move().calcSlerpRate(DEG2RAD360, this.mainRot(), sideRot);
                const slerp = this.mainRot().slerpTo(sideRot, t);
                this.dynamics().setFullRot(slerp);
                this.dynamics().setMainRot(slerp);

                this.m_attemptedTrickTimer = (this.m_attemptedTrickTimer - 1) | 0;

                this.calcRot();
                this.calcLanding(false);

                // Real game only (camera state).
                this.m_camUp.copy(this.m_camUp.perpInPlane(this.move().up(), true));
                this.m_camAxis.copy(this.m_camAxis.perpInPlane(this.m_camUp, true));
            } else if (status.onBit(eStatus.HalfPipeRamp)) {
                this.calcLanding(true);
            } else {
                status.resetBit(eStatus.HalfpipeMidair);
            }
        }

        this.m_timer = Math.max(0, this.m_timer - 1);
        this.m_touchingZipper = isLanding;
    }

    /** @addr{0x80574C90} */
    calcTrick(): void {
        const trick = this.inputs().currentState().trick;

        if (trick !== Trick.None) {
            this.m_nextTimer = TRICK_COOLDOWN;
            this.m_trick = trick;
        }

        const status = this.status();

        if (status.onBit(eStatus.OverZipper)) {
            if (
                status.offBit(eStatus.ZipperTrick) &&
                this.m_nextTimer > 0 &&
                this.state().airtime() > 3 &&
                this.state().airtime() < 10
            ) {
                this.activateTrick(this.m_attemptedTrickTimer, this.m_trick);
            }
        }

        this.m_nextTimer = Math.max(0, this.m_nextTimer - 1);
    }

    /** @addr{0x805750CC} */
    calcRot(): void {
        if (this.m_stunt === StuntType.None) {
            return;
        }

        this.m_stuntManager.calcAngle();

        const angle = fr(this.m_rotSign * fr(DEG2RAD * this.m_stuntManager.angle));

        switch (this.m_stunt) {
            case StuntType.Side360:
            case StuntType.Side720:
                this.m_stuntRot.setRPY3(0.0, angle, 0.0);
                break;
            case StuntType.Backside: {
                const rpy = Quatf.FromRPY3(
                    0.0,
                    fr(DEG2RAD * fr(fr(0.25 * -this.m_rotSign) * this.m_stuntManager.angle)),
                    0.0,
                );
                const rot = rpy.rotateVector(Vector3f.ez);
                this.m_stuntRot.setAxisRotation(angle, rot);
                break;
            }
            case StuntType.Frontside: {
                const rpy = Quatf.FromRPY3(
                    0.0,
                    0.0,
                    fr(DEG2RAD * fr(fr(fr(0.2) * -this.m_rotSign) * this.m_stuntManager.angle)),
                );
                const rot = rpy.rotateVector(Vector3f.ey);
                this.m_stuntRot.setAxisRotation(angle, rot);
                break;
            }
            case StuntType.Frontflip:
                this.m_stuntRot.setRPY3(fr(this.m_rotSign * angle), 0.0, 0.0);
                break;
            case StuntType.Backflip:
                this.m_stuntRot.setRPY3(fr(-this.m_rotSign * angle), 0.0, 0.0);
                break;
            default:
                break;
        }

        this.physics().composeStuntRot(this.m_stuntRot);
    }

    /** @addr{0x805752E8} */
    calcLanding(notAirborne: boolean): void {
        const LANDING_RADIUS = 150.0;
        const PREVIOUS_RADIUS = 200.0;
        const MIDAIR_RADIUS = 50.0;
        const WALL_RADIUS = 100.0;

        const COS_PI_OVER_4 = fr(0.707);

        const colInfo = new CollisionInfo();
        const colInfo2 = new CollisionInfo();
        const maskOut = box<number>(0);
        const pos = new Vector3f();
        const upLocal = new Vector3f();

        const status = this.status();
        let mask = KCL_TYPE_ANY_INVISIBLE_WALL;
        const overZipper = status.onBit(eStatus.OverZipper);
        if (!overZipper) {
            if (notAirborne && this.velocity().y < 0.0) {
                mask = KCL_NONE;
            } else {
                mask = KCL_TYPE_BIT(COL_TYPE_HALFPIPE_INVISIBLE_WALL);
            }
        }

        status.resetBit(eStatus.HalfpipeMidair);

        let prevPos = this.m_prevPos.add(Vector3f.ey.mul(PREVIOUS_RADIUS));

        const hasDriverFloorCollision = this.move().calcZipperCollision(
            LANDING_RADIUS,
            this.bsp().initialYPos,
            pos,
            upLocal,
            prevPos,
            colInfo,
            maskOut,
            KCL_TYPE_DRIVER_FLOOR,
        );

        prevPos = hasDriverFloorCollision ? Vector3f.inf.clone() : prevPos;

        if (overZipper) {
            if (
                !this.move().calcZipperCollision(
                    MIDAIR_RADIUS,
                    this.bsp().initialYPos,
                    pos,
                    upLocal,
                    prevPos,
                    colInfo2,
                    maskOut,
                    mask,
                )
            ) {
                mask = (mask | KCL_TYPE_DRIVER_WALL) >>> 0;
            }
        }

        if (
            this.move().calcZipperCollision(
                WALL_RADIUS,
                this.bsp().initialYPos,
                pos,
                upLocal,
                prevPos,
                colInfo2,
                maskOut,
                mask,
            )
        ) {
            if ((maskOut.value & ~KCL_TYPE_BIT(COL_TYPE_HALFPIPE_INVISIBLE_WALL)) === 0) {
                status.setBit(eStatus.HalfpipeMidair);
            }

            const up = this.move().up().clone();
            this.move().setUp(up.add(colInfo2.wallNrm.sub(up).mul(fr(0.2))));
            this.move().setSmoothedUp(this.move().up());

            const yScale = fr(this.bsp().initialYPos * this.scale().y);
            const newPos = pos
                .add(colInfo2.tangentOff)
                .add(colInfo2.wallNrm.mul(-WALL_RADIUS))
                .add(upLocal.mul(yScale));
            newPos.y = fr(newPos.y + this.move().hopPosY());

            this.dynamics().setPos(newPos);
            this.move().setDir(this.move().dir().perpInPlane(this.move().up(), true));
            this.move().setVel1Dir(this.move().dir());

            if (overZipper) {
                status.setBit(eStatus.ZipperStick);
            }

            this.m_prevPos.copy(newPos);
        } else {
            if (overZipper) {
                status.resetBit(eStatus.ZipperStick);
            }
        }

        if (
            !hasDriverFloorCollision ||
            status.onBit(eStatus.HalfpipeMidair) ||
            this.state().airtime() <= 5
        ) {
            return;
        }

        if (colInfo.floorNrm.dot(Vector3f.ey) <= COS_PI_OVER_4) {
            return;
        }

        if (status.onBit(eStatus.OverZipper)) {
            status.resetBit(eStatus.ZipperStick);
        }
    }

    /** @addr{0x80574E60} */
    activateTrick(duration: number, trick: Trick): void {
        if (duration < 51 || trick === Trick.None) {
            this.m_stunt = StuntType.None;
        } else {
            this.m_rotSign = this.m_nextSign;
            const timerThreshold = duration > 70;

            switch (trick) {
                case Trick.Up:
                    this.m_stunt = timerThreshold ? StuntType.Backside : StuntType.Backflip;
                    break;
                case Trick.Down:
                    this.m_stunt = timerThreshold ? StuntType.Frontside : StuntType.Frontflip;
                    break;
                case Trick.Left:
                case Trick.Right:
                    this.m_stunt = timerThreshold ? StuntType.Side720 : StuntType.Side360;
                    this.m_rotSign = trick === Trick.Left ? 1.0 : -1.0;
                    break;
                default:
                    break;
            }

            this.m_stuntManager.setProperties(this.m_stunt as number);

            this.status().setBit(eStatus.ZipperTrick);
        }

        this.m_stuntRot.copy(Quatf.ident);
    }

    /** @addr{0x805758E4} */
    end(boost: boolean): void {
        const status = this.status();
        const overZipper = status.onBit(eStatus.OverZipper);

        if (overZipper && this.state().airtime() > 5 && boost) {
            this.move().activateZipperBoost();
        }

        if (status.onBit(eStatus.ZipperTrick)) {
            this.physics().composeDecayingStuntRot(this.m_stuntRot);
        }

        if (overZipper) {
            this.move().setDir(this.mainRot().rotateVector(Vector3f.ez));
            this.move().setVel1Dir(this.move().dir());
        }

        status.resetBit(
            eStatus.OverZipper,
            eStatus.ZipperTrick,
            eStatus.ZipperStick,
            eStatus.HalfpipeMidair,
        );

        this.m_stunt = StuntType.None;
    }

    /** @addr{0x80574108} */
    static TerminalVelocity(): number {
        return 65.0;
    }
}
