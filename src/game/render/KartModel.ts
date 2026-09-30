/**
 * Port of Kinoko's game/render/KartModel.{hh,cc}.
 * Included because it mysteriously sets an angle member variable in KartBody.
 */

import { Course } from '../../Common';
import { fmax, fmin, fr } from '../../egg/math/Math';

import { KartObjectProxy } from '../kart/KartObjectProxy';
import { KartParam } from '../kart/KartParam';
import { eStatus } from '../kart/Status';
import { RaceConfig } from '../system/RaceConfig';

const F_75 = 75.0;
const F_0_2 = fr(0.2);
const F_0_04 = fr(0.04);
const F_0_9 = fr(0.9);
const F_0_02 = fr(0.02);
const F_0_1 = fr(0.1);
const F_0_8 = fr(0.8);
const F_0_05 = fr(0.05);

export class KartModel extends KartObjectProxy {
    private m_somethingLeft: boolean;
    private m_somethingRight: boolean;
    private _54: number;
    private _58: number;
    private _5c: number;
    private _64: number;
    private m_isInsideDrift = false;
    private _2e8: number;

    constructor() {
        super();
        this.m_somethingLeft = false;
        this.m_somethingRight = false;
        this._58 = 0.0;
        this._54 = 1.0;
        this._5c = 0.0;
        this._64 = 0.0;
        this._2e8 = 0.0;
    }

    /** @addr{0x807CD32C} */
    vf_1c(): void {
        const status = this.status();

        if (status.onBit(eStatus.Burnout)) {
            this._54 = 1.0;

            const pitch = this.move().burnout().pitch();
            const fVar2 = fr(pitch + fr(F_75 * fr(pitch - this._2e8)));
            let fVar4 = fmin(F_0_2, fr(F_0_04 * Math.abs(fVar2)));
            fVar4 = fVar2 > 0.0 ? fVar4 : -fVar4;

            this._2e8 = pitch;
            this._58 = fr(this._58 + fVar4);
        } else {
            this._2e8 = 0.0;
            this._58 = fr(this._58 * F_0_9);
        }

        const frozenInIce =
            RaceConfig.Instance().raceScenario().course === Course.N64_Sherbet_Land &&
            status.onBit(eStatus.InRespawn, eStatus.AfterRespawn);
        let xStick = frozenInIce ? 0.0 : this.inputs().currentState().stick.x;
        const isInCannon = status.onBit(eStatus.InCannon);
        let fVar2 = isInCannon ? F_0_02 : F_0_1;

        const local_f31 = this._58;
        if (xStick <= F_0_2) {
            if (xStick < -F_0_2) {
                this._58 = fr(this._58 - fVar2);
            }
        } else {
            this._58 = fr(this._58 + fVar2);
        }

        xStick = Math.abs(xStick);

        if (isInCannon) {
            xStick = fr(xStick * F_0_8);
            fVar2 = F_0_05;
        }

        this._54 = fr(this._54 + fr(fVar2 * fr(xStick - this._54)));

        if (local_f31 < -this._54 || this._54 < local_f31) {
            if (-this._54 <= this._58) {
                if (this._54 < this._58) {
                    this._58 = fr(this._58 - F_0_1);
                }
            } else {
                this._58 = fr(this._58 + F_0_1);
            }
        } else if (-this._54 <= this._58) {
            this._58 = fmin(this._54, this._58);
        } else {
            this._58 = -this._54;
        }

        let dVar13 = this._58;

        if (this.isBike()) {
            if (this.state().isDrifting()) {
                dVar13 = this.m_isInsideDrift ? 5.0 : 20.0;
            } else {
                dVar13 = 15.0;
            }
        } else {
            dVar13 = 15.0;
        }

        let dVar12 = 0.0;
        this._64 = fr(dVar13 * F_0_1);

        if (this.isBike()) {
            dVar12 = fr(-this._58 * dVar13);

            if (this.m_somethingLeft) {
                dVar12 = fr(dVar12 + (this.m_isInsideDrift ? 5.0 : 10.0));
            } else if (this.m_somethingRight) {
                dVar12 = fr(dVar12 - (this.m_isInsideDrift ? 5.0 : 10.0));
            }
        } else {
            if (!this.m_somethingLeft && this.m_somethingRight) {
                dVar12 = fr(dVar12 - 5.0);
            } else {
                dVar12 = fr(dVar12 + 5.0);
            }
        }

        if (dVar12 <= this._5c) {
            this._5c = fr(this._5c - this._64);
            this._5c = fmax(this._5c, dVar12);
        } else {
            this._5c = fr(this._5c + this._64);
            this._5c = fmin(this._5c, dVar12);
        }

        this.body().setAngle(this._5c);
    }

    /** @addr{0x807C8758} */
    init(): void {
        this.FUN_807C7828(this.param().playerIdx(), this.isBike());

        this._2e8 = 0.0;
    }

    /** @addr{0x807CB360} */
    calc(): void {
        this.FUN_807CB530();
    }

    /** @addr{0x807CB198} */
    FUN_807CB198(): void {
        this.m_somethingRight = false;
        this.m_somethingLeft = false;
        const status = this.status();

        const turnInput = status.onBit(eStatus.StickLeft, eStatus.StickRight);
        if (this.state().isDrifting() || (status.onBit(eStatus.ChargingSSMT) && turnInput)) {
            if (this.move().hopStickX() === 1) {
                this.m_somethingLeft = true;
            } else {
                if (this.move().hopStickX() === -1) {
                    this.m_somethingRight = true;
                } else if (status.offBit(eStatus.StickLeft)) {
                    this.m_somethingRight = true;
                } else {
                    this.m_somethingLeft = true;
                }
            }
        }
    }

    /** @addr{0x807CB530} */
    FUN_807CB530(): void {
        this.FUN_807CB198();
        this.vf_1c();
    }

    /** @addr{0x807C7828} */
    FUN_807C7828(_playerIdx: number, _isBike: boolean): void {
        this.m_isInsideDrift =
            this.param().stats().driftType === KartParam.Stats.DriftType.Inside_Drift_Bike;
    }
}

export class KartModelKart extends KartModel {
    /** @addr{0x807C7364} */
    constructor() {
        super();
    }
}

export class KartModelBike extends KartModel {
    /** @addr{0x807CDCCC} */
    constructor() {
        super();
    }
}
