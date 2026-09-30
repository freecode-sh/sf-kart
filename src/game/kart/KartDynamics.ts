/**
 * Port of Kinoko's game/kart/KartDynamics.{hh,cc}.
 * State management for most components of a kart's physics.
 */

import { F32_EPSILON, fmax, fmin, fr, sqrt } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';

const TWELFTH = fr(1.0 / 12.0);
const TERMINAL_Y_VEL = 120.0;
const F_0_9999 = fr(0.9999);
const F_0_998 = fr(0.998);
const F_0_98 = fr(0.98);
const F_0_4 = fr(0.4);
const F_0_8 = fr(0.8);
const F_0_1 = fr(0.1);

export class KartDynamics {
    /** Resistance to rotational change, as a 3x3 matrix. */
    protected readonly m_inertiaTensor = new Matrix34f();
    /** The inverse of m_inertiaTensor. */
    protected readonly m_invInertiaTensor = new Matrix34f();
    /** Scalar for damping angular velocity. */
    protected m_angVel0Factor = 0.0;
    /** The vehicle's position. */
    protected readonly m_pos = new Vector3f();
    /** Velocity induced by collisions. */
    protected readonly m_extVel = new Vector3f();
    /** Basically just m_totalForce. */
    protected readonly m_acceleration = new Vector3f();
    /** Angular velocity from m_totalTorque. */
    protected readonly m_angVel0 = new Vector3f();
    /** Velocity from things like TF conveyers. */
    protected readonly m_movingObjVel = new Vector3f();
    /** @unused */
    protected readonly m_angVel1 = new Vector3f();
    /** Velocity from Koopa Cape water. */
    protected readonly m_movingRoadVel = new Vector3f();
    /** Sum of the linear velocities. */
    protected readonly m_velocity = new Vector3f();
    /** Min of the max speed and m_velocity magnitude. */
    protected m_speedNorm = 0.0;
    /** The main component of angular velocity. */
    protected readonly m_angVel2 = new Vector3f();
    /** Rotation based on the angular velocities. */
    protected readonly m_mainRot = new Quatf();
    /** The combination of the other rotations. */
    protected readonly m_fullRot = new Quatf();
    /** Basically just gravity. */
    protected readonly m_totalForce = new Vector3f();
    /** Torque from linear motion and rotation. */
    protected readonly m_totalTorque = new Vector3f();
    /** Rotation from trick animations. Copied from KartPhysics. */
    protected readonly m_specialRot = new Quatf();
    /** @unused */
    protected readonly m_extraRot = new Quatf();
    /** Usually -1.3f, also affected by KartMove::calcDive. */
    protected m_gravity = 0.0;
    /** What you typically consider to be the vehicle's speed. */
    protected readonly m_intVel = new Vector3f();
    /** The unit vector pointing up from the vehicle. */
    protected readonly m_top = new Vector3f();
    /** Scalar for damping the main rotation. */
    protected m_stabilizationFactor = 0.0;
    protected m_speedFix = 0.0;
    /** Basically m_top biased towards absolute up. */
    protected readonly m_top_ = new Vector3f();

    /** Scalar for damping angular velocity. */
    protected m_angVel0YFactor = 0.0;
    protected readonly m_scale = new Vector3f();
    /** Specifies if we should return the vehicle to upwards orientation. */
    protected m_forceUpright = false;
    /** Disables gravity. Relevant when respawning. */
    protected m_noGravity = false;
    /** Caps external velocity at 0. */
    protected m_killExtVelY = false;

    /** @addr{0x805B4AF8} */
    constructor() {
        this.m_angVel0Factor = 1.0;
        this.m_inertiaTensor.copy(Matrix34f.ident);
        this.m_invInertiaTensor.copy(Matrix34f.ident);
        this.init();
    }

    forceUpright(): void {}

    /** @addr{0x805B5B68} Stabilizes the kart by rotating towards the y-axis unit vector. */
    stabilize(): void {
        const top = this.m_mainRot.rotateVector(Vector3f.ey);
        if (Math.abs(top.dot(this.m_top)) >= F_0_9999) {
            return;
        }

        const q = new Quatf();
        q.makeVectorRotation(top, this.m_top);
        this.m_mainRot.copy(
            this.m_mainRot.slerpTo(q.multSwap(this.m_mainRot), this.m_stabilizationFactor),
        );
    }

    /** @addr{0x805B4B54} */
    init(): void {
        this.m_pos.copy(Vector3f.zero);
        this.m_extVel.copy(Vector3f.zero);
        this.m_acceleration.copy(Vector3f.zero);
        this.m_angVel0.copy(Vector3f.zero);
        this.m_movingObjVel.copy(Vector3f.zero);
        this.m_angVel1.copy(Vector3f.zero);
        this.m_movingRoadVel.copy(Vector3f.zero);
        this.m_velocity.copy(Vector3f.zero);
        this.m_speedNorm = 0.0;
        this.m_angVel2.copy(Vector3f.zero);
        this.m_mainRot.copy(Quatf.ident);
        this.m_fullRot.copy(Quatf.ident);
        this.m_totalForce.copy(Vector3f.zero);
        this.m_totalTorque.copy(Vector3f.zero);
        this.m_specialRot.copy(Quatf.ident);
        this.m_extraRot.copy(Quatf.ident);
        this.m_gravity = -1.0;
        this.m_intVel.copy(Vector3f.zero);
        this.m_top.copy(Vector3f.ey);
        this.m_forceUpright = true;
        this.m_noGravity = false;
        this.m_killExtVelY = false;
        this.m_stabilizationFactor = F_0_1;
        this.m_top_.copy(Vector3f.ey);
        this.m_speedFix = 0.0;
        this.m_angVel0YFactor = 0.0;
        this.m_scale.copy(Vector3f.unit);
    }

    resetInternalVelocity(): void {
        this.m_intVel.setZero();
    }

    /** @addr{0x805B4E84} */
    setInertia(m: Readonly<Vector3f>, n: Readonly<Vector3f>): void {
        const t = this.m_inertiaTensor;
        t.copy(Matrix34f.zero);
        t.set(
            0,
            0,
            fr(
                fr(TWELFTH * fr(fr(m.y * m.y) + fr(m.z * m.z))) +
                    fr(fr(n.y * n.y) + fr(n.z * n.z)),
            ),
        );
        t.set(
            1,
            1,
            fr(
                fr(TWELFTH * fr(fr(m.z * m.z) + fr(m.x * m.x))) +
                    fr(fr(n.z * n.z) + fr(n.x * n.x)),
            ),
        );
        t.set(
            2,
            2,
            fr(
                fr(TWELFTH * fr(fr(m.x * m.x) + fr(m.y * m.y))) +
                    fr(fr(n.x * n.x) + fr(n.y * n.y)),
            ),
        );
        t.inverseTo33(this.m_invInertiaTensor);
    }

    /**
     * @addr{0x805B4DC4}
     * On init, takes elements from the kart's BSP and computes the moment of inertia tensor.
     */
    setBspParams(
        rotSpeed: number,
        m: Readonly<Vector3f>,
        n: Readonly<Vector3f>,
        skipInertia: boolean,
    ): void {
        this.m_angVel0Factor = rotSpeed;

        if (skipInertia) {
            return;
        }

        this.setInertia(m, n);
    }

    /**
     * @addr{0x805B5170}
     * Every frame, computes acceleration, velocity, position and rotation of the kart.
     */
    calc(dt: number, maxSpeed: number, air: boolean): void {
        if (!this.m_noGravity) {
            this.m_totalForce.y = fr(this.m_totalForce.y + this.m_gravity);
        }

        this.m_acceleration.copy(this.m_totalForce);
        this.m_extVel.addEq(this.m_acceleration.mul(dt));

        if (this.m_killExtVelY) {
            this.m_extVel.y = fmin(0.0, this.m_extVel.y);
        }

        this.m_extVel.mulEq(F_0_998);
        this.m_angVel0.mulEq(F_0_98);

        const playerBack = this.m_mainRot.rotateVector(Vector3f.ez);
        const playerBackHoriz = playerBack.clone();
        playerBackHoriz.y = 0.0;

        if (playerBackHoriz.squaredLength() > F32_EPSILON) {
            playerBackHoriz.normalise();
            const [proj, rej] = this.m_extVel.projAndRej(playerBackHoriz);
            const speedBack = proj;
            this.m_extVel.copy(rej);

            let norm = speedBack.squaredLength();
            norm = norm > F32_EPSILON ? sqrt(norm) : 0.0;

            this.m_speedFix = fr(norm * playerBack.dot(playerBackHoriz));
            if (speedBack.dot(playerBackHoriz) < 0.0) {
                this.m_speedFix = -this.m_speedFix;
            }
        }

        if (air) {
            this.m_intVel.y = fmin(TERMINAL_Y_VEL, this.m_intVel.y);
        }

        this.m_velocity.copy(
            this.m_extVel
                .mul(dt)
                .add(this.m_intVel)
                .add(this.m_movingObjVel)
                .add(this.m_movingRoadVel),
        );

        if (this.m_scale.z > 1.0) {
            maxSpeed = fr(maxSpeed * this.m_scale.z);
        }

        this.m_speedNorm = fmin(this.m_velocity.normalise(), maxSpeed);
        this.m_velocity.mulEq(this.m_speedNorm);
        this.m_pos.addEq(this.m_velocity);

        const t1 = this.m_invInertiaTensor.multVector33(this.m_totalTorque).mul(dt);
        this.m_angVel0.addEq(
            t1
                .add(this.m_invInertiaTensor.multVector33(t1.add(this.m_totalTorque)).mul(dt))
                .mul(0.5),
        );

        this.m_angVel0.x = fmin(F_0_4, fmax(-F_0_4, this.m_angVel0.x));
        this.m_angVel0.y = fr(fmin(F_0_4, fmax(-F_0_4, this.m_angVel0.y)) * this.m_angVel0YFactor);
        this.m_angVel0.z = fmin(F_0_8, fmax(-F_0_8, this.m_angVel0.z));

        if (this.m_forceUpright) {
            this.forceUpright();
        }

        const angVelSum = this.m_angVel2
            .add(this.m_angVel1)
            .add(this.m_angVel0.mul(this.m_angVel0Factor));

        if (angVelSum.squaredLength() > F32_EPSILON) {
            this.m_mainRot.addEq(this.m_mainRot.multSwapVec(angVelSum).mulScalar(fr(dt * 0.5)));

            if (Math.abs(this.m_mainRot.squaredNorm()) > F32_EPSILON) {
                this.m_mainRot.normalise();
            } else {
                this.m_mainRot.copy(Quatf.ident);
            }
        }

        if (this.m_forceUpright) {
            this.stabilize();
        }

        if (Math.abs(this.m_mainRot.squaredNorm()) > F32_EPSILON) {
            this.m_mainRot.normalise();
        } else {
            this.m_mainRot.copy(Quatf.ident);
        }

        this.m_fullRot.copy(this.m_extraRot.multSwap(this.m_mainRot).multSwap(this.m_specialRot));
        this.m_fullRot.normalise();

        this.m_totalForce.setZero();
        this.m_totalTorque.setZero();
        this.m_angVel2.setZero();
    }

    /** @addr{0x805B4D24} */
    reset(): void {
        this.m_extVel.setZero();
        this.m_acceleration.setZero();
        this.m_angVel0.setZero();
        this.m_movingObjVel.setZero();
        this.m_angVel1.setZero();
        this.m_movingRoadVel.setZero();
        this.m_angVel2.setZero();
        this.m_totalForce.setZero();
        this.m_totalTorque.setZero();
        this.m_intVel.setZero();
    }

    /**
     * @addr{0x805B6150}
     * Every frame, computes torque from linear motion and rotation.
     */
    applySuspensionWrench(
        p: Readonly<Vector3f>,
        Flinear: Readonly<Vector3f>,
        Frot: Readonly<Vector3f>,
        ignoreX: boolean,
    ): void {
        this.m_totalForce.y = fr(this.m_totalForce.y + Flinear.y);
        const fBody = this.m_fullRot.rotateVectorInv(Frot);
        const rBody = this.m_fullRot.rotateVectorInv(p.sub(this.m_pos));
        const torque = rBody.cross(fBody);

        if (ignoreX) {
            torque.x = 0.0;
        }
        torque.y = 0.0;
        this.m_totalTorque.addEq(torque);
    }

    /** @addr{0x805B5CE8} Applies a force linearly and rotationally to the kart. */
    applyWrenchScaled(p: Readonly<Vector3f>, f: Readonly<Vector3f>, scale: number): void {
        this.m_totalForce.addEq(f);

        const invForceRot = this.m_fullRot.rotateVectorInv(f);
        const relPos = p.sub(this.m_pos);
        const invPosRot = this.m_fullRot.rotateVectorInv(relPos);

        this.m_totalTorque.addEq(invPosRot.cross(invForceRot).mul(scale));
    }

    /** @addr{0x805B6388} */
    addForce(pos: Readonly<Vector3f>): void {
        this.m_totalForce.addEq(pos);
    }

    // Setters

    setPos(pos: Readonly<Vector3f>): void {
        this.m_pos.copy(pos);
    }

    setGravity(gravity: number): void {
        this.m_gravity = gravity;
    }

    setMainRot(q: Readonly<Quatf>): void {
        this.m_mainRot.copy(q);
    }

    setFullRot(q: Readonly<Quatf>): void {
        this.m_fullRot.copy(q);
    }

    setSpecialRot(q: Readonly<Quatf>): void {
        this.m_specialRot.copy(q);
    }

    setExtraRot(q: Readonly<Quatf>): void {
        this.m_extraRot.copy(q);
    }

    setIntVel(v: Readonly<Vector3f>): void {
        this.m_intVel.copy(v);
    }

    setTop(v: Readonly<Vector3f>): void {
        this.m_top.copy(v);
    }

    setStabilizationFactor(val: number): void {
        this.m_stabilizationFactor = val;
    }

    setTotalForce(v: Readonly<Vector3f>): void {
        this.m_totalForce.copy(v);
    }

    setExtVel(v: Readonly<Vector3f>): void {
        this.m_extVel.copy(v);
    }

    setAngVel0(v: Readonly<Vector3f>): void {
        this.m_angVel0.copy(v);
    }

    setMovingObjVel(v: Readonly<Vector3f>): void {
        this.m_movingObjVel.copy(v);
    }

    setMovingRoadVel(v: Readonly<Vector3f>): void {
        this.m_movingRoadVel.copy(v);
    }

    setAngVel2(v: Readonly<Vector3f>): void {
        this.m_angVel2.copy(v);
    }

    setAngVel0YFactor(val: number): void {
        this.m_angVel0YFactor = val;
    }

    setScale(v: Readonly<Vector3f>): void {
        this.m_scale.copy(v);
    }

    setTop_(v: Readonly<Vector3f>): void {
        this.m_top_.copy(v);
    }

    setForceUpright(isSet: boolean): void {
        this.m_forceUpright = isSet;
    }

    setNoGravity(isSet: boolean): void {
        this.m_noGravity = isSet;
    }

    setKillExtVelY(isSet: boolean): void {
        this.m_killExtVelY = isSet;
    }

    // Getters (returned objects are internal; callers must not mutate them)

    invInertiaTensor(): Matrix34f {
        return this.m_invInertiaTensor;
    }

    angVel0Factor(): number {
        return this.m_angVel0Factor;
    }

    pos(): Vector3f {
        return this.m_pos;
    }

    velocity(): Vector3f {
        return this.m_velocity;
    }

    gravity(): number {
        return this.m_gravity;
    }

    intVel(): Vector3f {
        return this.m_intVel;
    }

    mainRot(): Quatf {
        return this.m_mainRot;
    }

    fullRot(): Quatf {
        return this.m_fullRot;
    }

    totalForce(): Vector3f {
        return this.m_totalForce;
    }

    extVel(): Vector3f {
        return this.m_extVel;
    }

    angVel0(): Vector3f {
        return this.m_angVel0;
    }

    movingObjVel(): Vector3f {
        return this.m_movingObjVel;
    }

    movingRoadVel(): Vector3f {
        return this.m_movingRoadVel;
    }

    angVel2(): Vector3f {
        return this.m_angVel2;
    }

    speedFix(): number {
        return this.m_speedFix;
    }
}

/**
 * State management for most components of a bike's physics. Sharing the same members as
 * KartDynamics, this class overrides some functions to specifically handle bike physics.
 */
export class KartDynamicsBike extends KartDynamics {
    constructor() {
        super();
    }

    /** @addr{0x805B6438} */
    override forceUpright(): void {
        this.m_angVel0.z = 0.0;
    }

    /** @addr{0x805B6448} Stabilizes the bike by rotating towards the y-axis unit vector. */
    override stabilize(): void {
        const forward = this.m_top
            .cross(this.m_mainRot.rotateVector(Vector3f.ez))
            .cross(this.m_top);
        forward.normalise();
        const local_4c = forward.cross(this.m_top_.cross(forward));
        local_4c.normalise();

        const top = this.m_mainRot.rotateVector(Vector3f.ey);
        if (Math.abs(top.dot(local_4c)) >= F_0_9999) {
            return;
        }

        const q = new Quatf();
        q.makeVectorRotation(top, local_4c);
        this.m_mainRot.copy(
            this.m_mainRot.slerpTo(q.multSwap(this.m_mainRot), this.m_stabilizationFactor),
        );
    }
}
