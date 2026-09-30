/** Port of Kinoko source/game/field/jugem/JugemMove.{hh,cc}. */

import {
    abs,
    CosFIdx,
    F32_EPSILON,
    F_TAU,
    fclamp,
    fmin,
    fr,
    RAD2FIDX,
    SinFIdx,
} from '../../../egg/math/Math';
import { Matrix34f } from '../../../egg/math/Matrix';
import { Vector3f } from '../../../egg/math/Vector';
import type { KartObject } from '../../kart/KartObject';

const VEC_809C28FC = Object.freeze(new Vector3f(0.0, 40.0, 0.0));
const VEC_809C28E4 = Object.freeze(new Vector3f(0.0, 100.0, 0.0));
const CALC_LERP_STEP = fr(fr(0.8) - fr(0.4));

/** Manages state information related to Lakitu movement. */
export class JugemMove {
    private m_kartObj: KartObject;
    private m_pos = new Vector3f();
    private m_transPos = new Vector3f();
    private m_anchorPos = new Vector3f();
    private m_28 = new Matrix34f();
    private m_58 = new Matrix34f();
    private m_88 = new Matrix34f();
    private m_transform = new Matrix34f();
    /** Left/right oscillation phase */
    private m_phaseX = 0.0;
    /** Up/down oscillation phase */
    private m_phaseY = 0.0;
    private m_lastKartObjPos = new Vector3f();
    private m_velDir = new Vector3f();
    /** Velocity of Lakitu once he leaves by rising upwards */
    private m_riseVel = new Vector3f();
    private m_dir = new Vector3f();
    /** The current direction that Lakitu is at */
    private m_currForward = new Vector3f();
    /** The direction that Lakitu wants to move to */
    private m_targetForward = new Vector3f();
    private m_forwardInterpRate = 0.0;
    private m_isAwayOrDescending = false;
    private m_velDirInterpRate = 0.0;
    private m_isDescending = false;
    private m_isRising = false;

    /** @addr{0x8071E9B4} */
    constructor(kartObj: KartObject) {
        this.m_kartObj = kartObj;
    }

    /** @addr{0x8071EB6C} */
    init(): void {
        this.m_28.copy(Matrix34f.ident);
        this.m_58.copy(Matrix34f.ident);
        this.m_88.copy(Matrix34f.ident);
        this.m_transform.copy(Matrix34f.ident);
        this.m_phaseX = 0.0;
        this.m_phaseY = 0.0;
        this.m_pos.setZero();
        this.m_transPos.setZero();
        this.m_lastKartObjPos.copy(this.m_kartObj.pos());
        this.m_velDir.setZero();
        this.m_riseVel.setZero();
        this.m_dir.setZero();
        this.m_anchorPos.setZero();
        this.m_currForward.setZero();
        this.m_targetForward.copy(Vector3f.ez);
        this.m_isAwayOrDescending = false;
        this.m_velDirInterpRate = 1.0;
        this.m_forwardInterpRate = fr(0.08);
        this.m_isDescending = true;
        this.m_isRising = false;
    }

    /** @addr{0x8071F404} */
    calc(): void {
        const pos = this.m_kartObj.pos();
        let fVar2 = fr(fr(abs(fr(this.m_anchorPos.y - this.m_pos.y)) - 200.0) / 100.0);
        let fVar7 = fclamp(fVar2, 0.0, 1.0);

        let dVar6 = fr(fr(0.4) + fr(fVar7 * CALC_LERP_STEP));
        let dVar5 = fclamp(dVar6, 0.0, 1.0);

        const kartObjPosDelta = pos.sub(this.m_lastKartObjPos);
        kartObjPosDelta.y = fr(dVar5 * fr(pos.y - this.m_lastKartObjPos.y));
        const local_74 = this.m_anchorPos.sub(kartObjPosDelta).sub(this.m_pos);
        const local_80 = local_74.clone();

        fVar7 = local_80.normalise();
        if (fVar7 > 200.0) {
            fVar2 = 0.75;
        } else {
            fVar2 = 0.5;
        }
        local_80.mulEq(fVar2);

        if (!this.m_isAwayOrDescending) {
            this.m_velDirInterpRate = 0.0;

            if (fVar7 > 100.0) {
                this.m_velDir.addEq(local_80);
            } else {
                if (fr(this.m_velDir.x * local_80.x) < 0.0) {
                    this.m_velDir.x = fr(this.m_velDir.x + local_80.x);
                }
                if (fr(this.m_velDir.y * local_80.y) < 0.0) {
                    this.m_velDir.y = fr(this.m_velDir.y + local_80.y);
                }
                if (fr(this.m_velDir.z * local_80.z) < 0.0) {
                    this.m_velDir.z = fr(this.m_velDir.z + local_80.z);
                }
            }

            fVar7 = 8.0;
        } else {
            this.m_velDirInterpRate = fmin(1.0, fr(this.m_velDirInterpRate + fr(0.02)));
            this.m_velDir.copy(JugemMove.Interpolate(this.m_velDirInterpRate, local_80, local_74));
            fVar7 = 25.0;
        }

        dVar6 = fVar7;
        fVar7 = this.m_velDir.normalise();
        dVar5 = fVar7;
        if (this.m_isDescending && dVar6 < dVar5) {
            dVar5 = dVar6;
        }

        this.m_velDir.mulEq(dVar5);

        if (!this.m_isRising) {
            this.m_pos.addEq(kartObjPosDelta);
        }

        this.m_58.copy(this.calcOrthonormalBasis());
        const local_d4 = this.calcOscillation(this.m_58);
        const local_8c = local_d4.clone();

        if (this.m_isRising) {
            const local_a4 = new Vector3f(kartObjPosDelta.x, 0.0, kartObjPosDelta.z);
            this.m_pos.copy(this.m_pos.add(this.m_riseVel).add(local_a4));
            this.m_isRising = false;
        } else {
            this.m_pos.addEq(this.m_velDir);
        }

        const local_b0 = this.m_pos.add(local_8c);
        this.m_28.copy(this.FUN_807202BC());

        this.m_58.setBase(3, VEC_809C28FC);
        this.m_28.setBase(3, local_b0);

        let local_50 = Matrix34f.ident.clone();
        local_50 = local_50.multiplyTo(this.m_28);
        local_50 = local_50.multiplyTo(this.m_58);
        local_50 = local_50.multiplyTo(this.m_88);

        this.m_transform.copy(local_50);
        this.m_transPos.copy(this.m_transform.base(3));
        this.m_lastKartObjPos.copy(pos);
    }

    /** @addr{0x8071EFA8} */
    setPos(pos: Readonly<Vector3f>, transPos: boolean): void {
        this.m_pos.copy(pos);

        if (transPos) {
            this.m_transPos.copy(pos);
        }
    }

    /** @addr{0x8071F0CC} */
    setForwardFromKartObjPosDelta(setCurr: boolean): void {
        const FAST_INTERP_DIST = 250.0;
        const SLOW_INTERP_RATE = fr(0.03);
        const FAST_INTERP_RATE = fr(0.08);

        let forward = this.m_kartObj.pos().sub(this.m_pos);
        forward.y = 0.0;
        const dist = forward.normalise();

        if (forward.squaredLength() <= F32_EPSILON) {
            forward = Vector3f.ez.clone();
        }

        if (setCurr) {
            this.m_currForward.copy(forward);
        }

        this.m_targetForward.copy(forward);
        this.m_forwardInterpRate = dist < FAST_INTERP_DIST ? SLOW_INTERP_RATE : FAST_INTERP_RATE;
    }

    /** @addr{0x8071F204} */
    setForwardFromKartObjMainRot(setCurr: boolean): void {
        let forward = this.m_kartObj.mainRot().rotateVector(Vector3f.ez);
        forward.y = 0.0;
        forward.mulEq(-1.0);
        forward.normalise2();

        if (forward.squaredLength() <= F32_EPSILON) {
            forward = Vector3f.ez.clone();
        }

        if (setCurr) {
            this.m_currForward.copy(forward);
        }

        this.m_targetForward.copy(forward);
    }

    /** @addr{0x8071EFD8} */
    setAnchorPos(v: Readonly<Vector3f>): void {
        this.m_anchorPos.copy(v);
    }

    setRiseVel(v: Readonly<Vector3f>): void {
        this.m_riseVel.copy(v);
    }

    setAwayOrDescending(isSet: boolean): void {
        this.m_isAwayOrDescending = isSet;
    }

    setDescending(isSet: boolean): void {
        this.m_isDescending = isSet;
    }

    setRising(isSet: boolean): void {
        this.m_isRising = isSet;
    }

    transPos(): Readonly<Vector3f> {
        return this.m_transPos;
    }

    transform(): Readonly<Matrix34f> {
        return this.m_transform;
    }

    /** @addr{0x80720024} */
    private calcOrthonormalBasis(): Matrix34f {
        this.m_currForward.copy(
            JugemMove.Interpolate(this.m_forwardInterpRate, this.m_currForward, this.m_targetForward),
        );
        this.m_currForward.normalise();

        const up = Vector3f.ey;
        let forward = this.m_currForward.clone();

        if (forward.squaredLength() <= F32_EPSILON) {
            forward = Vector3f.ez.clone();
        }

        const right = up.cross(forward);
        right.normalise();

        forward = right.cross(up);
        forward.normalise();

        const mat = Matrix34f.ident.clone();
        mat.setBase(0, right);
        mat.setBase(1, up);
        mat.setBase(2, forward);

        return mat;
    }

    /** @addr{0x807201B0} */
    private calcOscillation(mat: Readonly<Matrix34f>): Vector3f {
        const PHASE_X_STEP = fr(0.04);
        const PHASE_Y_STEP = fr(0.08);
        const AMPLITUDE_X = 80.0;
        const AMPLITUDE_Y = 30.0;

        this.m_phaseX = fr(this.m_phaseX + PHASE_X_STEP);
        this.m_phaseY = fr(this.m_phaseY + PHASE_Y_STEP);

        if (this.m_phaseX > F_TAU) {
            this.m_phaseX = fr(this.m_phaseX - F_TAU);
        }

        if (this.m_phaseY > F_TAU) {
            this.m_phaseY = fr(this.m_phaseY - F_TAU);
        }

        const cosX = CosFIdx(fr(RAD2FIDX * this.m_phaseX));
        const sinY = SinFIdx(fr(RAD2FIDX * this.m_phaseY));
        const v = new Vector3f(fr(AMPLITUDE_X * cosX), fr(AMPLITUDE_Y * sinY), 0.0);

        return mat.ps_multVector(v);
    }

    /** @addr{0x807202BC} */
    private FUN_807202BC(): Matrix34f {
        this.m_dir.copy(JugemMove.Interpolate(fr(0.1), this.m_dir, this.m_velDir));
        let fVar2 = this.m_dir.normalise();
        fVar2 = fmin(20.0, fVar2);

        this.m_dir.mulEq(fVar2);
        const avStack_38 = this.m_dir.mul(1.5);
        let up = VEC_809C28E4.sub(avStack_38);
        fVar2 = VEC_809C28E4.length();
        let dVar1 = fVar2;
        fVar2 = up.length();
        dVar1 = fr(fVar2 / dVar1);
        up.normalise();

        up.mulEq(dVar1);
        if (up.squaredLength() <= F32_EPSILON) {
            up = Vector3f.ey.clone();
        }

        const mat = Matrix34f.ident.clone();
        mat.setBase(0, Vector3f.ex);
        mat.setBase(1, up);
        mat.setBase(2, Vector3f.ez);

        return mat;
    }

    private static Interpolate(
        t: number,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
    ): Vector3f {
        return v0.add(v1.sub(v0).mul(t));
    }
}
