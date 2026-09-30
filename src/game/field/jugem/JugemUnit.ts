/** Port of Kinoko source/game/field/jugem/JugemUnit.{hh,cc}. */

import { box } from '../../../egg/core/Box';
import {
    F32_EPSILON,
    fclamp,
    fr,
    HALF_PI,
    RAD2FIDX,
    SinFIdx,
} from '../../../egg/math/Math';
import { Matrix34f } from '../../../egg/math/Matrix';
import { Vector3f } from '../../../egg/math/Vector';
import type { KartObject } from '../../kart/KartObject';
import { CollisionDirector } from '../CollisionDirector';
import { CollisionInfoPartial } from '../KColData';
import { KCL_TYPE_FLOOR } from '../KCollisionTypes';
import { StateEntry, StateManager, type StateManagerEntry } from '../StateManager';
import { JugemMove } from './JugemMove';
import { JugemSwitchReverse, type JugemSwitch } from './JugemSwitch';

class InterpKeyframe {
    m_interpRate = 0.0;
    m_time = 0.0;
}

/** Manages interpolation keyframes for the Lakitu's position when ascending and descending. */
export class JugemInterp {
    private m_keyframes: InterpKeyframe[];
    private m_numKeyframes = 0;
    private m_time: number;
    private m_rate: number;

    constructor(count: number) {
        this.m_keyframes = Array.from({ length: count }, () => new InterpKeyframe());
        this.m_time = 0.0;
        this.m_rate = 0.0;
    }

    /** @addr{0x8072370C} */
    initKeyframes(startRate: number, endRate: number, tDelta: number, param4: number): void {
        this.m_numKeyframes = 0;

        this.setStartKeyframe(startRate);
        this.addKeyframe(endRate, tDelta, param4);

        this.m_rate = startRate;
        this.m_time = 0.0;
    }

    /** @addr{0x80723AF8} */
    calc(tDelta: number): boolean {
        this.m_rate = this.calcInterpRate(this.m_time);
        this.m_time = fr(this.m_time + tDelta);

        const endOfKeyframe = this.m_time > this.m_keyframes[1]!.m_time;
        if (endOfKeyframe) {
            this.m_time = this.m_keyframes[1]!.m_time;
        }

        return endOfKeyframe;
    }

    /** @addr{0x8074C048} */
    setStartKeyframe(param1: number): void {
        const kf = this.m_keyframes[this.m_numKeyframes]!;
        kf.m_interpRate = param1;
        kf.m_time = 0.0;
        ++this.m_numKeyframes;
    }

    /** @addr{0x8074C0B4} */
    addKeyframe(rate: number, tDelta: number, _param4: number): void {
        const kf = this.m_keyframes[this.m_numKeyframes]!;
        kf.m_interpRate = rate;
        kf.m_time = fr(tDelta + this.m_keyframes[this.m_numKeyframes - 1]!.m_time);
        ++this.m_numKeyframes;
    }

    /** @addr{0x8074C1E0} */
    calcInterpRate(time: number): number {
        let currKeyframe: InterpKeyframe | null = null;
        let nextKeyframe: InterpKeyframe | null = null;
        const iVar5 = 0;

        for (let idx = 0; idx < this.m_numKeyframes - 1; ++idx) {
            currKeyframe = this.m_keyframes[iVar5]!;
            nextKeyframe = this.m_keyframes[iVar5 + 1]!;
            if (currKeyframe.m_time <= time && time < nextKeyframe.m_time) {
                break;
            }
        }

        let timePastKeyframe = fr(time - currKeyframe!.m_time);
        const keyframeDuration = fr(nextKeyframe!.m_time - currKeyframe!.m_time);

        timePastKeyframe = fclamp(timePastKeyframe, 0.0, keyframeDuration);

        return JugemInterp.Lerp(
            currKeyframe!.m_interpRate,
            nextKeyframe!.m_interpRate,
            fr(timePastKeyframe / keyframeDuration),
        );
    }

    rate(): number {
        return this.m_rate;
    }

    /** @addr{0x8074C3F0} */
    private static Lerp(a: number, b: number, t: number): number {
        const sin = SinFIdx(fr(RAD2FIDX * fr(-HALF_PI + fr(t * fr(HALF_PI - -HALF_PI)))));
        const interpFactor = fclamp(fr(0.5 * fr(1.0 + sin)), 0.0, 1.0);

        return fr(a + fr(interpFactor * fr(b - a)));
    }
}

enum State {
    Away = 0,
    Descending = 1,
    Stay = 2,
    Ascending = 3,
}

const INIT_POS_OFFSET = Object.freeze(new Vector3f(0.0, 2000.0, 0.0));
const AWAY_LOCAL_POS = Object.freeze(new Vector3f(0.0, 2000.0, 0.0));
const DESCEND_LOCAL_POS = Object.freeze(new Vector3f(0.0, 500.0, 0.0));
const SLOW_RISE_VEL = Object.freeze(new Vector3f(0.0, 30.0, 0.0));
const FAST_RISE_VEL = Object.freeze(new Vector3f(0.0, 80.0, 0.0));
const STAY_LOCAL_POS = Object.freeze(new Vector3f(0.0, 250.0, 350.0));

const INTERP_RATE_START = 0.0;
const INTERP_RATE_END = 1.0;
const AWAY_INTERP_RATE_DURATION = 40.0;
const STAY_INTERP_RATE_DURATION = 70.0;

/** Represents a single Lakitu and houses some state management members. */
export class JugemUnit extends StateManager<JugemUnit> {
    private m_kartObj: KartObject;
    private m_pos = new Vector3f();
    private m_state: State = State.Away;
    /** How long Lakitu has been disappearing/ascending for */
    private m_ascendTimer = 0;
    private m_switchReverse: JugemSwitch | null;
    private m_move: JugemMove;
    private m_interp: JugemInterp;

    private static readonly STATE_ENTRIES: readonly StateManagerEntry<JugemUnit>[] = [
        StateEntry<JugemUnit>(
            0,
            (o) => o.enterIdle(),
            (o) => o.calcIdle(),
        ),
        StateEntry<JugemUnit>(
            1,
            (o) => o.enterReverse(),
            (o) => o.calcReverse(),
        ),
    ];

    /** @addr{0x80721514} */
    constructor(kartObj: KartObject) {
        super(null, JugemUnit.STATE_ENTRIES);
        this.m_kartObj = kartObj;
        this.m_switchReverse = null;
        this.m_move = new JugemMove(kartObj);
        this.m_interp = new JugemInterp(2);
    }

    /** @addr{0x80721EC0} */
    createSwitchRace(): void {
        this.m_switchReverse = new JugemSwitchReverse();
    }

    /** @addr{0x80722100} */
    init(): void {
        this.m_pos.setZero();
        this.m_move.init();
    }

    /** @addr{0x807221C4} */
    override calc(): void {
        this.calcSwitches();

        super.calc();

        // Perform a collision check if Lakitu is not idle
        if (this.m_currentStateId !== 0) {
            this.setPosFromTransform(this.m_move.transform());
            this.calcCollision();
        }
    }

    /** @addr{0x80723458} */
    private enterIdle(): void {
        this.m_state = State.Away;
        this.m_ascendTimer = 0;
    }

    /** @addr{0x80724794} */
    private enterReverse(): void {
        this.m_state = State.Descending;
        this.m_interp.initKeyframes(0.0, 1.0, 40.0, 3);
        this.m_move.init();
        const pos = this.transformLocalToWorldUpright(INIT_POS_OFFSET);
        this.m_move.setPos(pos, true);
        this.m_move.setForwardFromKartObjPosDelta(true);
        this.m_move.setDescending(false);
    }

    /** @addr{0x807234A4} */
    private calcIdle(): void {
        if (this.m_switchReverse && this.m_switchReverse.isOn()) {
            this.m_nextStateId = 1;
        }
    }

    /** @addr{0x80724880} */
    private calcReverse(): void {
        const local_40 = this.m_kartObj.pos().sub(this.m_move.transPos());

        switch (this.m_state) {
            case State.Away: {
                const isDoneInterpolating = this.m_interp.calc(1.0);
                const localPos = JugemUnit.Interpolate(
                    this.m_interp.rate(),
                    AWAY_LOCAL_POS,
                    DESCEND_LOCAL_POS,
                );
                this.m_move.setAwayOrDescending(true);
                this.m_move.setAnchorPos(this.transformLocalToWorldUpright(localPos));
                this.m_move.setForwardFromKartObjMainRot(true);

                if (isDoneInterpolating) {
                    this.m_move.setDescending(true);
                    this.m_interp.initKeyframes(
                        INTERP_RATE_START,
                        INTERP_RATE_END,
                        AWAY_INTERP_RATE_DURATION,
                        3,
                    );
                    this.m_state = State.Descending;
                }
                break;
            }
            case State.Descending: {
                const isDoneInterpolating = this.m_interp.calc(1.0);
                const localPos = JugemUnit.Interpolate(
                    this.m_interp.rate(),
                    DESCEND_LOCAL_POS,
                    STAY_LOCAL_POS,
                );
                this.m_move.setAwayOrDescending(true);
                this.m_move.setAnchorPos(this.transformLocalToWorldUpright(localPos));
                this.m_move.setForwardFromKartObjMainRot(true);

                if (isDoneInterpolating) {
                    this.m_state = State.Stay;
                }
                break;
            }
            case State.Stay: {
                this.m_move.setAwayOrDescending(false);
                this.m_move.setAnchorPos(this.transformLocalToWorldUpright(STAY_LOCAL_POS));
                this.m_move.setForwardFromKartObjPosDelta(false);

                if (!this.m_switchReverse!.isOn() || local_40.length() > 2000.0) {
                    this.m_interp.initKeyframes(
                        INTERP_RATE_START,
                        INTERP_RATE_END,
                        STAY_INTERP_RATE_DURATION,
                        3,
                    );
                    this.m_move.setDescending(false);
                    this.m_ascendTimer = 0;
                    this.m_state = State.Ascending;
                }
                break;
            }
            case State.Ascending: {
                const isDoneInterpolating = this.m_interp.calc(1.0);

                this.m_move.setRiseVel(
                    (this.m_ascendTimer = (this.m_ascendTimer + 1) >>> 0) < 10
                        ? SLOW_RISE_VEL
                        : FAST_RISE_VEL,
                );
                this.m_move.setRising(true);

                if (isDoneInterpolating) {
                    this.m_nextStateId = 0;
                }
                break;
            }
        }

        this.m_move.calc();
    }

    /** @addr{0x80722ED8} */
    private calcSwitches(): void {
        if (this.m_switchReverse) {
            this.m_switchReverse.calc();
        }
    }

    /** @addr{0x80722F6C} */
    private setPosFromTransform(mat: Readonly<Matrix34f>): void {
        this.m_pos.copy(mat.base(3));
        this.m_pos.y = this.m_kartObj.pos().y;
    }

    /** @addr{0x807230D4} */
    private transformLocalToWorldUpright(v: Readonly<Vector3f>): Vector3f {
        const vel1Dir = this.m_kartObj.move().vel1Dir();
        const mainRot = this.m_kartObj.mainRot();

        const vStack88 = mainRot.rotateVector(Vector3f.ez);
        const pos = this.m_kartObj.pos();
        const up = Vector3f.ey.clone();
        const local_a0 = vel1Dir.add(vStack88);
        local_a0.normalise2();
        let right = up.cross(local_a0);
        right.normalise2();

        if (right.squaredLength() <= F32_EPSILON) {
            right = Vector3f.ex.clone();
        }

        const forward = right.cross(up);
        forward.normalise2();

        const mat = new Matrix34f();
        mat.setBase(0, right);
        mat.setBase(1, up);
        mat.setBase(2, forward);
        mat.setBase(3, pos);

        return mat.ps_multVector(v);
    }

    /** @addr{0x807232E4} */
    private calcCollision(): void {
        const RADIUS = 150.0;

        const colInfo = new CollisionInfoPartial();
        const maskOut = box(0);

        // We ignore the result of the collision check. This check is simply here so that any
        // resulting collisions can cause updates to nearby objects.
        CollisionDirector.Instance()!.checkSpherePartialPush(
            RADIUS,
            this.m_pos,
            Vector3f.inf,
            KCL_TYPE_FLOOR,
            colInfo,
            maskOut,
            0,
        );
    }

    private static Interpolate(
        t: number,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
    ): Vector3f {
        return v0.add(v1.sub(v0).mul(t));
    }
}
