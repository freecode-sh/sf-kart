/**
 * Port of Kinoko's game/kart/KartObjectProxy.{hh,cc}.
 *
 * IMPORTANT: this module is the hub that nearly every kart class extends. It must NOT import any
 * module at runtime other than the egg math primitives, otherwise ES module cycles would evaluate a
 * subclass (`class X extends KartObjectProxy`) before this class exists. Singletons the C++ calls
 * directly (KartObjectManager, RaceManager, CourseMap) are reached through late-bound links that
 * are registered by KartObject.ts / KartObjectManager.ts (see `LinkKartObjectProxy`).
 */

import { DEG2RAD } from '../../egg/math/Math';
import { Matrix34f } from '../../egg/math/Matrix';
import type { Quatf } from '../../egg/math/Quat';
import { Vector3f } from '../../egg/math/Vector';

import type { BoxColUnit } from '../field/BoxColManager';
import type { KCLTypeMask } from '../field/KCollisionTypes';
import type { ObjectCollisionKart } from '../field/ObjectCollisionKart';
import type { KartModel } from '../render/KartModel';
import type { CourseMap } from '../system/CourseMap';
import type { KPad } from '../system/KPadController';
import type { RaceManager } from '../system/RaceManager';

import type { CollisionData, CollisionGroup } from './CollisionGroup';
import type { KartAction } from './KartAction';
import type { KartBody } from './KartBody';
import type { KartCollide } from './KartCollide';
import type { KartDynamics } from './KartDynamics';
import type { KartHalfPipe } from './KartHalfPipe';
import type { KartJump } from './KartJump';
import type { KartMove } from './KartMove';
import type { KartObjectManager } from './KartObjectManager';
import type { BSP, KartParam } from './KartParam';
import type { KartPhysics } from './KartPhysics';
import type { KartScale } from './KartScale';
import type { KartState } from './KartState';
import type { KartSub } from './KartSub';
import type { KartSuspension } from './KartSuspension';
import type { KartSuspensionPhysics, WheelPhysics } from './KartSuspensionPhysics';
import type { KartTire } from './KartTire';
import type { Status } from './Status';

/** Shared between classes who inherit KartObjectProxy so they can access one another. */
export class KartAccessor {
    param: KartParam = null!;
    body: KartBody = null!;
    model: KartModel = null!;
    sub: KartSub = null!;
    move: KartMove = null!;
    action: KartAction = null!;
    collide: KartCollide = null!;
    objectCollisionKart: ObjectCollisionKart = null!;
    state: KartState = null!;

    suspensions: KartSuspension[] = [];
    tires: KartTire[] = [];

    boxColUnit: BoxColUnit = null!;
}

/**
 * Late-bound singleton accessors. TS-only: breaks the runtime import cycle between the hub and the
 * managers. Registered at module load by KartObject.ts (raceManager, courseMap) and
 * KartObjectManager.ts (kartObjectManager).
 */
interface KartObjectProxyLinks {
    kartObjectManager: (() => KartObjectManager) | null;
    raceManager: (() => RaceManager) | null;
    courseMap: (() => CourseMap) | null;
}

const s_links: KartObjectProxyLinks = {
    kartObjectManager: null,
    raceManager: null,
    courseMap: null,
};

export function LinkKartObjectProxy(links: Partial<KartObjectProxyLinks>): void {
    Object.assign(s_links, links);
}

function raceManagerInstance(): RaceManager {
    if (!s_links.raceManager) throw new Error('KartObjectProxy: RaceManager link not registered');
    return s_links.raceManager();
}

function courseMapInstance(): CourseMap {
    if (!s_links.courseMap) throw new Error('KartObjectProxy: CourseMap link not registered');
    return s_links.courseMap();
}

function kartObjectManagerInstance(): KartObjectManager {
    if (!s_links.kartObjectManager) {
        throw new Error('KartObjectProxy: KartObjectManager link not registered');
    }
    return s_links.kartObjectManager();
}

/** @addr{0x809C1900} List of all KartObjectProxy children. */
const s_proxyList: KartObjectProxy[] = [];

/** Base class for most kart-related objects. */
export class KartObjectProxy {
    private m_accessor: KartAccessor | null;

    /** @addr{0x8059018C} */
    constructor() {
        this.m_accessor = null;
        s_proxyList.push(this);
    }

    /** Non-null accessor (C++ dereferences the raw pointer). */
    private __acc(): KartAccessor {
        return this.m_accessor!;
    }

    /** @addr{0x80590238} */
    setPos(pos: Readonly<Vector3f>): void {
        this.dynamics().setPos(pos);
    }

    /** @addr{0x80590288} */
    setRot(q: Readonly<Quatf>): void {
        this.dynamics().setFullRot(q);
        this.dynamics().setMainRot(q);
    }

    /** @addr{0x80591664} */
    setInertiaScale(scale: Readonly<Vector3f>): void {
        const cuboids = this.__acc().param.bsp().cuboids;
        this.dynamics().setInertia(cuboids[0].mulV(scale), cuboids[1].mulV(scale));
    }

    /** @addr{0x80590D20} */
    action(): KartAction {
        return this.__acc().action;
    }

    /** @addr{0x8059069C} */
    body(): KartBody {
        return this.__acc().body;
    }

    /** @addr{0x8059084C} */
    collide(): KartCollide {
        return this.__acc().collide;
    }

    /** @addr{0x805907D8} */
    collisionGroup(): CollisionGroup {
        return this.__acc().body.physics().hitboxGroup();
    }

    /** @addr{0x8059077C} */
    move(): KartMove {
        return this.__acc().move;
    }

    halfPipe(): KartHalfPipe {
        return this.__acc().move.halfPipe();
    }

    kartScale(): KartScale {
        return this.__acc().move.kartScale();
    }

    /** @addr{0x80591914} */
    jump(): KartJump {
        return this.__acc().move.jump();
    }

    /** @addr{0x80590864} */
    param(): KartParam {
        return this.__acc().param;
    }

    /** @addr{0x80590888} */
    bsp(): BSP {
        return this.__acc().param.bsp();
    }

    /** @addr{0x805903AC} */
    physics(): KartPhysics {
        return this.__acc().body.physics();
    }

    /** @addr{0x805903E0} */
    dynamics(): KartDynamics {
        return this.__acc().body.physics().dynamics();
    }

    state(): KartState {
        return this.__acc().state;
    }

    /** @addr{0x80590764} */
    sub(): KartSub {
        return this.__acc().sub;
    }

    /** @addr{0x805906B4} */
    suspension(suspIdx: number): KartSuspension {
        return this.__acc().suspensions[suspIdx]!;
    }

    /** @addr{0x80590704} */
    suspensionPhysics(suspIdx: number): KartSuspensionPhysics {
        return this.__acc().suspensions[suspIdx]!.suspPhysics();
    }

    /** @addr{0x805906DC} */
    tire(tireIdx: number): KartTire {
        return this.__acc().tires[tireIdx]!;
    }

    /** @addr{0x80590734} */
    tirePhysics(tireIdx: number): WheelPhysics {
        return this.__acc().tires[tireIdx]!.wheelPhysics();
    }

    /**
     * @addr{0x8059081C} collisionData() -> the body's collision data.
     * @addr{0x80590834} collisionData(tireIdx) -> the given tire's collision data.
     */
    collisionData(tireIdx?: number): CollisionData {
        if (tireIdx === undefined) {
            return this.__acc().body.physics().hitboxGroup().collisionData();
        }
        return this.__acc().tires[tireIdx]!.wheelPhysics().hitboxGroup().collisionData();
    }

    /** @addr{0x805903F4} */
    inputs(): KPad {
        return raceManagerInstance().player().inputs();
    }

    /** @addr{0x80590A40} */
    model(): KartModel {
        return this.__acc().model;
    }

    /** @addr{0x805907C0} */
    objectCollisionKart(): ObjectCollisionKart {
        return this.__acc().objectCollisionKart;
    }

    /** @addr{0x80591520} */
    boxColUnit(): BoxColUnit {
        return this.__acc().boxColUnit;
    }

    /** @addr{0x805914BC} */
    scale(): Vector3f {
        return this.__acc().move.scale();
    }

    /** @addr{0x80590264} */
    pose(): Matrix34f {
        return this.__acc().body.physics().pose();
    }

    /** @addr{0x80590C94} Returns the third column of the rotation matrix (facing vector). */
    bodyFront(): Vector3f {
        const mtx = this.__acc().body.physics().pose();
        return new Vector3f(mtx.get(0, 2), mtx.get(1, 2), mtx.get(2, 2));
    }

    /** @addr{0x80590C44} Returns the first column of the rotation matrix ("right"). */
    bodyForward(): Vector3f {
        const mtx = this.__acc().body.physics().pose();
        return new Vector3f(mtx.get(0, 0), mtx.get(1, 0), mtx.get(2, 0));
    }

    /** @addr{0x80590C6C} Returns the second column of the rotation matrix ("up"). */
    bodyUp(): Vector3f {
        const mtx = this.__acc().body.physics().pose();
        return new Vector3f(mtx.get(0, 1), mtx.get(1, 1), mtx.get(2, 1));
    }

    /** @addr{0x80590CBC} */
    componentXAxis(): Vector3f {
        return this.__acc().body.physics().xAxis();
    }

    /** @addr{0x80590CD0} */
    componentYAxis(): Vector3f {
        return this.__acc().body.physics().yAxis();
    }

    /** @addr{0x80590CE4} */
    componentZAxis(): Vector3f {
        return this.__acc().body.physics().zAxis();
    }

    /** @addr{0x8059020C} */
    pos(): Vector3f {
        return this.dynamics().pos();
    }

    /** @addr{0x80590224} */
    prevPos(): Vector3f {
        return this.__acc().body.physics().pos();
    }

    fullRot(): Quatf {
        return this.dynamics().fullRot();
    }

    extVel(): Vector3f {
        return this.dynamics().extVel();
    }

    intVel(): Vector3f {
        return this.dynamics().intVel();
    }

    velocity(): Vector3f {
        return this.dynamics().velocity();
    }

    /** @addr{0x80590CF8} */
    speed(): number {
        return this.__acc().move.speed();
    }

    acceleration(): number {
        return this.__acc().move.acceleration();
    }

    softSpeedLimit(): number {
        return this.__acc().move.softSpeedLimit();
    }

    mainRot(): Quatf {
        return this.dynamics().mainRot();
    }

    angVel2(): Vector3f {
        return this.dynamics().angVel2();
    }

    /** @addr{0x80590A6C} */
    isBike(): boolean {
        return this.__acc().param.isBike();
    }

    /** @addr{0x805902DC} */
    suspCount(): number {
        return this.__acc().param.suspCount();
    }

    /** @addr{0x805902EC} */
    tireCount(): number {
        return this.__acc().param.tireCount();
    }

    /** @addr{0x80590338} */
    hasFloorCollision(wheelPhysics: WheelPhysics): boolean {
        return wheelPhysics.hitboxGroup().collisionData().bFloor;
    }

    /** @addr{0x8058539C} Returns [pos, rot] (C++ std::pair). */
    getCannonPosRot(): [Vector3f, Vector3f] {
        const cannon = courseMapInstance().getCannonPoint(this.__acc().state.cannonPointId())!;
        const cannonPos = cannon.pos();
        let cannonRot = cannon.rot().clone();
        const radRot = cannon.rot().mul(DEG2RAD);
        const rotMat = new Matrix34f();
        rotMat.makeR(radRot);
        cannonRot = rotMat.multVector33(Vector3f.ez);
        const distance_to_cannon = this.dynamics().pos().sub(cannonPos);
        distance_to_cannon.y = 0.0;
        const local60 = Vector3f.ey.cross(cannonRot);
        const temp0 = local60.dot(distance_to_cannon);
        return [cannonPos.add(local60.mul(temp0)), cannonRot];
    }

    /** @addr{0x80590DD0} */
    speedRatio(): number {
        return this.__acc().move.speedRatio();
    }

    /** @addr{0x80590DC0} */
    speedRatioCapped(): number {
        return this.__acc().move.speedRatioCapped();
    }

    /** @addr{0x805914F4} */
    isInRespawn(): boolean {
        const move = this.__acc().move;
        return move.respawnTimer() > 0 || move.respawnPostLandTimer() > 0;
    }

    /** @addr{0x805911A8} */
    wallKclType(): KCLTypeMask {
        return this.collisionData().closestWallFlags;
    }

    /** @addr{0x805911C0} */
    wallKclVariant(): number {
        return this.collisionData().closestWallSettings;
    }

    status(): Status {
        return this.__acc().state.status();
    }

    /** @addr{0x8059031C} */
    wheelPos(idx: number): Vector3f {
        return this.tirePhysics(idx).pos();
    }

    /** @addr{0x80590390} */
    wheelEdgePos(idx: number): Vector3f {
        return this.tirePhysics(idx).wheelEdgePos();
    }

    /** @addr{0x805909C8} */
    cameraDistY(): number {
        const param = this.__acc().param;
        if (param.isBike()) {
            return param.bikeDisp().m_cameraDistY;
        } else {
            return param.kartDisp().m_cameraDistY;
        }
    }

    /** @addr{0x805909F4} */
    hopStickX(): number {
        return this.__acc().move.hopStickX();
    }

    /** @addr{0x80590A10} */
    vehicleType(): KartParam.Stats.DriftType {
        return this.__acc().param.stats().driftType;
    }

    static proxyList(): KartObjectProxy[] {
        return s_proxyList;
    }

    /** @addr{0x805901D0} */
    protected apply(idx: number): void {
        this.m_accessor = kartObjectManagerInstance().object(idx).accessor();
    }

    /**
     * @addr{0x80590138}
     * For all proxies in the static list, synchronizes all pointers to the KartAccessor.
     */
    protected static ApplyAll(pointers: KartAccessor): void {
        for (const proxy of s_proxyList) {
            proxy.m_accessor = pointers;
        }
    }
}
