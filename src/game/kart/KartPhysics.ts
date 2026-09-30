/**
 * Port of Kinoko's game/kart/KartPhysics.{hh,cc}.
 * Manages the lifecycle of KartDynamics, handles moving floors and trick rotation.
 */

import { F32_EPSILON, fmin, fr } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';

import { CollisionGroup } from './CollisionGroup';
import { KartDynamics, KartDynamicsBike } from './KartDynamics';
import type { KartParam } from './KartParam';

const F_0_1 = fr(0.1);

export class KartPhysics {
    private m_dynamics: KartDynamics;
    private m_hitboxGroup: CollisionGroup;
    private readonly m_pos = new Vector3f();
    private readonly m_decayingStuntRot = new Quatf();
    private readonly m_instantaneousStuntRot = new Quatf();
    private readonly m_specialRot = new Quatf();
    /** Rotation that occurs when landing from a trick. */
    private readonly m_decayingExtraRot = new Quatf();
    private readonly m_instantaneousExtraRot = new Quatf();
    private readonly m_extraRot = new Quatf();
    private readonly m_movingObjVel = new Vector3f();
    private readonly m_movingRoadVel = new Vector3f();
    /** The kart's current rotation and position. */
    private readonly m_pose = new Matrix34f();
    /** The first column of the pose. */
    private readonly m_xAxis = new Vector3f();
    /** The second column of the pose. */
    private readonly m_yAxis = new Vector3f();
    /** The third column of the pose. */
    private readonly m_zAxis = new Vector3f();
    /** Copied from KartDynamics. */
    private readonly m_velocity = new Vector3f();
    private m_fc = 0.0;

    /** @addr{0x8059F5BC} */
    constructor(isBike: boolean) {
        this.m_pose.copy(Matrix34f.ident);
        this.m_dynamics = isBike ? new KartDynamicsBike() : new KartDynamics();
        this.m_hitboxGroup = new CollisionGroup();
        this.m_fc = 50.0; // set immediately after in KartPhysics::Create()
    }

    /** @addr{0x8059F7C8} */
    reset(): void {
        this.m_dynamics.init();
        this.m_hitboxGroup.reset();
        this.m_decayingStuntRot.copy(Quatf.ident);
        this.m_instantaneousStuntRot.copy(Quatf.ident);
        this.m_specialRot.copy(Quatf.ident);
        this.m_decayingExtraRot.copy(Quatf.ident);
        this.m_instantaneousExtraRot.copy(Quatf.ident);
        this.m_extraRot.copy(Quatf.ident);
        this.m_movingObjVel.setZero();
        this.m_movingRoadVel.setZero();
        this.m_pose.copy(Matrix34f.ident);
        const p = this.m_pose;
        this.m_xAxis.set(p.get(0, 0), p.get(1, 0), p.get(2, 0));
        this.m_yAxis.set(p.get(0, 1), p.get(1, 1), p.get(2, 1));
        this.m_zAxis.set(p.get(0, 2), p.get(1, 2), p.get(2, 2));
        this.m_pos.copy(this.m_dynamics.pos());
        this.m_velocity.copy(this.m_dynamics.velocity());
    }

    /** @addr{0x805A0340} Constructs a transformation matrix from rotation and position. */
    updatePose(): void {
        this.m_pose.makeQT(this.m_dynamics.fullRot(), this.m_dynamics.pos());
        const p = this.m_pose;
        this.m_xAxis.set(p.get(0, 0), p.get(1, 0), p.get(2, 0));
        this.m_yAxis.set(p.get(0, 1), p.get(1, 1), p.get(2, 1));
        this.m_zAxis.set(p.get(0, 2), p.get(1, 2), p.get(2, 2));
    }

    /**
     * @addr{0x8059F968}
     * Computes trick rotation and calls to KartDynamics::calc().
     * @param dt delta time. It's always 1.0f.
     * @param maxSpeed 120.0f, unless we're in a bullet (145.0f)
     */
    calc(dt: number, maxSpeed: number, scale: Readonly<Vector3f>, air: boolean): void {
        this.m_specialRot.copy(this.m_instantaneousStuntRot.mul(this.m_decayingStuntRot));
        this.m_extraRot.copy(this.m_instantaneousExtraRot.mul(this.m_decayingExtraRot));

        this.m_dynamics.setSpecialRot(this.m_specialRot);
        this.m_dynamics.setExtraRot(this.m_extraRot);
        this.m_dynamics.setScale(scale);

        this.m_dynamics.calc(dt, maxSpeed, air);

        this.m_decayingStuntRot.copy(this.m_decayingStuntRot.slerpTo(Quatf.ident, F_0_1));
        this.m_decayingExtraRot.copy(this.m_decayingExtraRot.slerpTo(Quatf.ident, F_0_1));

        this.m_instantaneousStuntRot.copy(Quatf.ident);
        this.m_instantaneousExtraRot.copy(Quatf.ident);
    }

    // Setters

    setPos(pos: Readonly<Vector3f>): void {
        this.m_pos.copy(pos);
    }

    setVelocity(vel: Readonly<Vector3f>): void {
        this.m_velocity.copy(vel);
    }

    set_fc(val: number): void {
        this.m_fc = val;
    }

    /** @addr{0x8059FC48} */
    composeStuntRot(rot: Readonly<Quatf>): void {
        this.m_instantaneousStuntRot.mulEq(rot);
    }

    /** @addr{0x8059FD0C} */
    composeExtraRot(rot: Readonly<Quatf>): void {
        this.m_instantaneousExtraRot.mulEq(rot);
    }

    /** @addr{0x8059FDD0} */
    composeDecayingStuntRot(rot: Readonly<Quatf>): void {
        this.m_decayingStuntRot.mulEq(rot);
    }

    /** @addr{0x8059FE94} */
    composeDecayingExtraRot(rot: Readonly<Quatf>): void {
        this.m_decayingExtraRot.mulEq(rot);
    }

    /** @addr{0x805A0050} */
    composeMovingObjVel(vel: Readonly<Vector3f>, t: number): void {
        this.m_movingObjVel.addEq(vel.sub(this.m_movingObjVel).mul(t));
        this.dynamics().setMovingObjVel(this.m_movingObjVel);
    }

    /** @addr{0x805A00D0} */
    composeDecayingMovingObjVel(floorScalar: number, airScalar: number, floor: boolean): void {
        this.m_movingObjVel.mulEq(floor ? floorScalar : airScalar);
        this.dynamics().setMovingObjVel(this.m_movingObjVel);
    }

    /** @addr{0x805A014C} */
    composeMovingRoadVel(vel: Readonly<Vector3f>, t: number): void {
        this.m_movingRoadVel.addEq(vel.sub(this.m_movingRoadVel).mul(t));
        this.dynamics().setMovingRoadVel(this.m_movingRoadVel);
    }

    /** @addr{0x805A01CC} */
    shiftDecayMovingRoadVel(v: Readonly<Vector3f>, maxPullSpeed: number): void {
        this.m_movingRoadVel.addEq(v);

        if (this.m_movingRoadVel.squaredLength() > F32_EPSILON) {
            const speed = fmin(maxPullSpeed, this.m_movingRoadVel.normalise());
            this.m_movingRoadVel.mulEq(speed);
            this.m_dynamics.setMovingRoadVel(this.m_movingRoadVel);
        }
    }

    /** @addr{0x805A02B8} */
    decayMovingRoadVel(floorScalar: number, airScalar: number, floor: boolean): void {
        this.m_movingRoadVel.mulEq(floor ? floorScalar : airScalar);
        this.m_movingRoadVel.y = 0.0;
        this.dynamics().setMovingRoadVel(this.m_movingRoadVel);
    }

    /** @addr{0x805A0410} */
    clearDecayingRot(): void {
        this.m_decayingStuntRot.copy(Quatf.ident);
        this.m_decayingExtraRot.copy(Quatf.ident);
    }

    // Getters

    dynamics(): KartDynamics {
        return this.m_dynamics;
    }

    pose(): Matrix34f {
        return this.m_pose;
    }

    hitboxGroup(): CollisionGroup {
        return this.m_hitboxGroup;
    }

    xAxis(): Vector3f {
        return this.m_xAxis;
    }

    yAxis(): Vector3f {
        return this.m_yAxis;
    }

    zAxis(): Vector3f {
        return this.m_zAxis;
    }

    pos(): Vector3f {
        return this.m_pos;
    }

    fc(): number {
        return this.m_fc;
    }

    /** @addr{0x805A04A0} */
    static Create(param: KartParam): KartPhysics {
        const physics = new KartPhysics(param.isBike());

        const bsp = param.bsp();

        physics.set_fc(physics.hitboxGroup().initHitboxes(bsp.hitboxes));

        physics
            .dynamics()
            .setBspParams(bsp.angVel0Factor, bsp.cuboids[0], bsp.cuboids[1], false);

        return physics;
    }
}
