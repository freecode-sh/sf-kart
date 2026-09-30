/**
 * Port of Kinoko source/game/field/obj/ObjectHeyho.{hh,cc}: the Shy Guys on DK Summit.
 *
 * C++ `class ObjectHeyho : public ObjectCollidable, public StateManager`. TS has single
 * inheritance, so the StateManager base is a member (`m_stateMgr`); `m_currentStateId` and
 * `StateManager::calc()` forward to it.
 */

import { box } from '../../../egg/core/Box';
import { abs, DEG2RAD, F32_EPSILON, fmax, fr, sqrt } from '../../../egg/math/Math';
import { Matrix34f } from '../../../egg/math/Matrix';
import { Vector3f } from '../../../egg/math/Vector';
import { AnmType } from '../../render/AnmMgr';
import type { MapdataGeoObj } from '../../system/map/MapdataGeoObj';
import { CollisionDirector } from '../CollisionDirector';
import { CollisionInfo, F32_MIN } from '../KColData';
import {
    COL_TYPE_INVISIBLE_WALL,
    KCL_NONE,
    KCL_TYPE_BIT,
    KCL_TYPE_FLOOR,
    KCL_TYPE_VEHICLE_COLLIDEABLE,
    type KCLTypeMask,
} from '../KCollisionTypes';
import { RailInterpolatorStatus } from '../RailInterpolator';
import { RailManager } from '../RailManager';
import { StateEntry, StateManager, type StateManagerEntry } from '../StateManager';
import { ObjectCollidable } from './ObjectCollidable';

export enum HeyhoAnimation {
    Move = 1,
    Jump = 2,
    Jumped = 3,
}

const s16 = (x: number): number => (x << 16) >> 16;

const COLLISION_OFFSET: Readonly<Vector3f> = Object.freeze(new Vector3f(0.0, 10.0, 0.0));
const COLLISION_RADIUS = 100.0;
const SEGMENT_T_JUMP = fr(0.6);
const INTERP_RATE = fr(0.2);
const MIN_SQ_VEL = fr(0.001);
const FLOOR_OFFSET = 60.0;

/** The StateManager base subobject of ObjectHeyho. */
class HeyhoStateManager extends StateManager<ObjectHeyho> {
    constructor(obj: ObjectHeyho, entries: readonly StateManagerEntry<ObjectHeyho>[]) {
        super(obj, entries);
    }

    currentStateId(): number {
        return this.m_currentStateId;
    }

    setCurrentStateId(id: number): void {
        this.m_currentStateId = id & 0xffff;
    }

    calcState(): void {
        this.calc();
    }
}

/** Shy guys on DK Summit. */
export class ObjectHeyho extends ObjectCollidable {
    private m_stateMgr: HeyhoStateManager;

    private readonly m_color: number; // s32
    private m_apex: number;
    private m_midpoint: Vector3f;
    private m_transformOffset = new Vector3f();
    private m_currentVel = 0.0;
    private m_accel: number;
    private m_maxVelSq: number;
    private m_up = new Vector3f();
    private m_forward = new Vector3f();
    private m_floorNrm = new Vector3f();
    private m_floorCollision = false;
    /** Uninitialized in C++ (zero-filled heap); set by init(). */
    private m_currentAnim = 0 as HeyhoAnimation;
    private m_freeFall = false;
    private m_launchVel = 0.0;
    private m_spinFrame = 0; // s16

    private static readonly STATE_ENTRIES: readonly StateManagerEntry<ObjectHeyho>[] = [
        StateEntry<ObjectHeyho>(0, (o) => o.enterMove(), (o) => o.calcMove()),
        StateEntry<ObjectHeyho>(1, (o) => o.enterJump(), (o) => o.calcJump()),
    ];

    /** @addr{0x806CE828} */
    constructor(params: MapdataGeoObj) {
        super(params);
        this.m_stateMgr = new HeyhoStateManager(this, ObjectHeyho.STATE_ENTRIES);
        this.m_color = params.setting(1);

        const rail = RailManager.Instance()!.rail(params.pathId());
        const railPts = rail.points();

        // The two endpoints are candidates for the highest Y coordinate in the route
        // The midpoint's Y coordinate should be the lowest in the route
        this.m_apex = fmax(railPts[0]!.pos.y, railPts[railPts.length - 1]!.pos.y);
        this.m_midpoint = railPts[Math.trunc(railPts.length / 2)]!.pos.clone();

        // The object should speed up as we approach the low point and slow down as we leave it
        // We form an acceleration constant so multiplying with (pos - center) gives v^2
        // This way, we can inversely correlate height difference with speed
        if (!(fr(this.m_apex - this.m_midpoint.y) > F32_EPSILON)) {
            throw new Error('ObjectHeyho: apex must be above the midpoint');
        }
        const maxVel = fr(s16(params.setting(0)));
        this.m_maxVelSq = fr(maxVel * maxVel);
        this.m_accel = fr(this.m_maxVelSq / fr(this.m_apex - this.m_midpoint.y));
    }

    /** @addr{0x806CEB90} */
    override init(): void {
        const railInterpolator = this.m_railInterpolator!;
        railInterpolator.init(0.0, Math.trunc(railInterpolator.pointCount() / 2));
        this.setPos(railInterpolator.curPos());
        this.m_currentVel = sqrt(
            fr(this.m_maxVelSq - fr(this.m_accel * fr(railInterpolator.curPos().y - this.m_midpoint.y))),
        );

        this.m_transformOffset.copy(railInterpolator.curTangentDir().mul(this.m_currentVel));
        this.m_floorCollision = false;
        this.m_up.copy(Vector3f.ey);
        this.m_forward.copy(Vector3f.ez);
        this.m_freeFall = false;
        this.m_spinFrame = 0;

        this.changeAnimation(HeyhoAnimation.Move);
    }

    /** @addr{0x806CEDF8} */
    override calc(): void {
        this.calcStateTransition();
        this.calcMotion();
        this.m_stateMgr.calcState();
        this.calcInterp();
    }

    /** @addr{0x806D02B4} */
    override loadFlags(): number {
        return 3;
    }

    /** @addr{0x806D013C} */
    override loadAnims(): void {
        const names = ['body_color', 'move', 'jump', 'jump_ed'];

        const types = [AnmType.Pat, AnmType.Chr, AnmType.Chr, AnmType.Chr];

        this.linkAnims(names, types);
    }

    /** @addr{0x806D01D4} */
    override calcCollisionTransform(): void {
        const objCol = this.collision();
        if (!objCol) {
            return;
        }

        const tm = new Matrix34f();
        tm.makeT(new Vector3f(0.0, 100.0, 0.0));
        this.calcTransform();
        const m = this.transform().multiplyTo(tm);
        objCol.transform(m, this.scale(), this.m_transformOffset);
    }

    private changeAnimation(anim: HeyhoAnimation): void {
        this.m_drawMdl!.anmMgr()!.playAnim(0.0, 1.0, anim as number);
        this.m_currentAnim = anim;
    }

    // State methods

    /** @addr{0x806CF4CC} */
    private enterMove(): void {}

    /** @addr{0x806CF714} */
    private enterJump(): void {
        this.m_spinFrame = 0;
    }

    /** @addr{0x806CF4D0} */
    private calcMove(): void {
        const railInterpolator = this.m_railInterpolator!;
        this.m_forward.copy(railInterpolator.nextPoint().pos.sub(railInterpolator.curPoint().pos));
        this.m_floorCollision = false;

        const info = new CollisionInfo();

        if (
            CollisionDirector.Instance()!.checkSphereFull(
                COLLISION_RADIUS,
                this.pos().add(COLLISION_OFFSET),
                Vector3f.inf,
                KCL_TYPE_FLOOR,
                info,
                null,
                0,
            )
        ) {
            this.m_floorCollision = true;
            if (info.floorDist > -F32_MIN) {
                this.m_floorNrm.copy(info.floorNrm);
            }

            this.setPos(this.pos().add(info.tangentOff).sub(this.m_floorNrm.mul(FLOOR_OFFSET)));

            if (this.m_currentAnim === HeyhoAnimation.Jumped) {
                const anim = this.m_drawMdl!.anmMgr()!.activeAnim(AnmType.Chr)!;
                if (anim.frame() >= anim.frameCount()) {
                    this.changeAnimation(HeyhoAnimation.Move);
                }
            }
        }
    }

    /** @addr{0x806CF72C} */
    private calcJump(): void {
        const SPIN_DELAY_FRAMES = 5;
        const SPIN_RATE = 12; // degrees per frame
        const SPIN_DEGREES = 720;

        const railInterpolator = this.m_railInterpolator!;

        this.m_floorCollision = false;

        const info = new CollisionInfo();
        const flags = box<KCLTypeMask>(KCL_NONE);

        if (
            CollisionDirector.Instance()!.checkSphereFull(
                COLLISION_RADIUS,
                this.pos().add(COLLISION_OFFSET),
                Vector3f.inf,
                KCL_TYPE_VEHICLE_COLLIDEABLE,
                info,
                flags,
                0,
            )
        ) {
            this.m_floorCollision = true;
            if (info.floorDist > -F32_MIN) {
                this.m_floorNrm.copy(info.floorNrm);
            }

            // Not m_pos += info.tangentOff - m_floorNrm * 60.0f
            // The former requires m_pos to be the last addition to occur
            const xPos = fr(fr(this.pos().x + info.tangentOff.x) - fr(this.m_floorNrm.x * FLOOR_OFFSET));
            const zPos = fr(fr(this.pos().z + info.tangentOff.z) - fr(this.m_floorNrm.z * FLOOR_OFFSET));
            this.setPos(new Vector3f(xPos, this.pos().y, zPos));

            if (!(flags.value & KCL_TYPE_BIT(COL_TYPE_INVISIBLE_WALL)) && this.m_currentAnim !== HeyhoAnimation.Move) {
                this.m_forward.copy(railInterpolator.nextPoint().pos.sub(railInterpolator.curPoint().pos));
                if (this.m_currentAnim === HeyhoAnimation.Jump) {
                    this.m_currentAnim = HeyhoAnimation.Jumped;
                }
            } else {
                this.m_floorCollision = false;
                const curPos = railInterpolator.curPoint().pos;
                const nextPos = railInterpolator.nextPoint().pos;

                this.m_forward.copy((nextPos.y > curPos.y ? nextPos : curPos).sub(this.m_midpoint));

                // Red shy guys do a spin. Yes, this is based on color, and no, it's not an animation
                // We couldn't possibly use even one of the six unused settings for this
                if (this.m_color === 0) {
                    const frame = s16(this.m_spinFrame - SPIN_DELAY_FRAMES);
                    if (frame >= 0 && frame <= Math.trunc(SPIN_DEGREES / SPIN_RATE)) {
                        const m = new Matrix34f();
                        m.setAxisRotation(fr(fr(frame) * fr(fr(-SPIN_RATE) * DEG2RAD)), this.m_up);
                        m.setBase(3, Vector3f.zero);
                        this.m_forward.copy(m.ps_multVector(this.m_forward));
                    }
                }

                this.m_spinFrame = s16(this.m_spinFrame + 1);
            }
        }

        if (railInterpolator.segmentT() > SEGMENT_T_JUMP && this.m_currentAnim === HeyhoAnimation.Move) {
            this.changeAnimation(HeyhoAnimation.Jump);
        }
    }

    /** @addr{0x806CFD48} */
    private calcStateTransition(): void {
        const railInterpolator = this.m_railInterpolator!;
        if (railInterpolator.curPoint().setting[1] === 0 || railInterpolator.nextPoint().setting[1] === 0) {
            if (this.m_stateMgr.currentStateId() !== 0) {
                this.m_stateMgr.setCurrentStateId(0);
            }
        } else {
            if (this.m_stateMgr.currentStateId() !== 1) {
                this.m_stateMgr.setCurrentStateId(1);
            }
        }
    }

    /** @addr{0x806CFDB0} */
    private calcMotion(): void {
        const railInterpolator = this.m_railInterpolator!;
        if (!this.m_freeFall) {
            let sqVel = fr(this.m_maxVelSq - fr(this.m_accel * fr(this.pos().y - this.m_midpoint.y)));
            if (sqVel <= 0.0) {
                sqVel = MIN_SQ_VEL;
            }
            this.m_currentVel = sqrt(sqVel);
            railInterpolator.setCurrVel(this.m_currentVel);

            if (railInterpolator.calc() === RailInterpolatorStatus.ChangingDirection) {
                // We have an edgecase where the endpoint heights aren't the same
                // While the current velocity reaches 0 at the apex, it's higher on the other side
                // To counter this, the object goes off the rail and into free fall until we land
                this.m_launchVel = this.m_currentVel;
                if (this.m_currentVel > 1.0) {
                    this.m_freeFall = true;
                }
            }

            if (this.m_stateMgr.currentStateId() === 0 && !this.m_floorCollision) {
                const curPos = railInterpolator.curPos();
                this.setPos(new Vector3f(curPos.x, this.pos().y, curPos.z));
            } else {
                this.setPos(railInterpolator.curPos());
            }
        } else {
            this.m_currentVel = fr(this.m_currentVel - 1.0);
            this.setPos(new Vector3f(this.pos().x, fr(this.m_currentVel + this.pos().y), this.pos().z));
        }

        // m_currentVel < 0.0f => either we're in free fall or we just snapped to the rail
        // If we would land back on the rail on the next frame, just let it snap to the rail instead
        if (
            this.m_currentVel < 0.0 &&
            abs(fr(this.pos().y - railInterpolator.curPos().y)) <= -this.m_currentVel
        ) {
            this.m_currentVel = this.m_launchVel;
            this.m_freeFall = false;
        }
    }

    /** @addr{0x806CFFB0} */
    private calcInterp() {
        this.m_up.copy(ObjectHeyho.Interpolate(INTERP_RATE, this.m_up, this.m_floorNrm));
        this.m_up.normalise2();
        this.m_forward.normalise2();
        this.setMatrixTangentTo(this.m_up, this.m_forward);
    }
}
