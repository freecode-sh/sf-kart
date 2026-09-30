/** Port of Kinoko source/game/kart/KartScale.{hh,cc}. */

import { fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import { KartObjectProxy } from './KartObjectProxy';
import type { Stats } from './KartParam';

enum CrushState {
    None = -1,
    Crush = 0,
    Uncrush = 1,
}

const CRUSH_SCALE = fr(0.3);

const s_baseScaleStart: readonly number[] = [0.5, 1.0, 1.0, 2.0];
const s_baseScaleTarget: readonly number[] = [1.0, 0.5, 2.0, 1.0];

/**
 * TODO: Stand-in for `Abstract::g3d::ResAnmChr` from driver.brres (ThunderScaleUp/Down and
 * PressScaleUp), which we cannot load. Sampling always returns an unscaled result (1, 1, 1) and
 * the animations are treated as zero frames long. These only matter for lightning/crush events.
 */
class StubScaleAnmChr {
    constructor(private readonly m_frameCount: number) {}

    /** Returns `getAnmResult(frame, idx).scale()`. */
    getAnmResultScale(_frame: number, _idx: number): Vector3f {
        return new Vector3f(1.0, 1.0, 1.0);
    }

    /** u16 */
    frameCount(): number {
        return this.m_frameCount;
    }
}

// TODO: KartObjectManager::ThunderScaleUpAnmChr / ThunderScaleDownAnmChr / PressScaleUpAnmChr.
const THUNDER_SCALE_UP_ANM_CHR = new StubScaleAnmChr(0);
const THUNDER_SCALE_DOWN_ANM_CHR = new StubScaleAnmChr(0);
const PRESS_SCALE_UP_ANM_CHR = new StubScaleAnmChr(0);

/** Mainly responsible for calculating scaling for the squish/unsquish animation. */
export class KartScale extends KartObjectProxy {
    /** s32 */
    private m_type = 0;
    private m_scaleTransformOffset = new Vector3f();
    private m_scaleTransformSlope = new Vector3f();
    private m_sizeScale = new Vector3f();
    private m_scaleAnmActive = false;
    private m_anmFrame = 0.0;
    private m_scaleTarget: number[] = [0.0, 0.0, 0.0, 0.0];
    /** Specifies the current crush/uncrush state */
    private m_crushState = CrushState.None;
    /** Set while crush scaling is occurring */
    private m_calcCrush = false;
    /** Current frame of the unsquish animation */
    private m_uncrushAnmFrame = 0.0;
    private m_pressScale = new Vector3f();

    static readonly CRUSH_SCALE = CRUSH_SCALE;

    /** @addr{0x8056AD44} */
    constructor(stats: Readonly<Stats>) {
        super();
        this.reset();

        for (let i = 0; i < 4; ++i) {
            this.m_scaleTarget[i] = s_baseScaleTarget[i]!;

            switch (i) {
                case 1:
                    this.m_scaleTarget[i] = stats.shrinkScale;
                    break;
                case 2:
                    this.m_scaleTarget[i] = stats.megaScale;
                    break;
                default:
                    break;
            }
        }
    }

    /** @addr{0x8056AF10} */
    reset(): void {
        this.m_type = -1;
        this.m_sizeScale.copy(Vector3f.unit);
        this.m_scaleTransformOffset.setZero();
        this.m_scaleTransformSlope.setZero();
        this.m_scaleAnmActive = false;
        this.m_anmFrame = 0.0;
        this.m_crushState = CrushState.None;
        this.m_calcCrush = false;
        this.m_uncrushAnmFrame = 0.0;
        this.m_pressScale.copy(Vector3f.unit);
    }

    /** @addr{0x8056B218} */
    calc(): void {
        if (this.m_scaleAnmActive) {
            let scaleAnm: StubScaleAnmChr;
            if (this.m_type === 0) {
                scaleAnm = THUNDER_SCALE_UP_ANM_CHR;
            } else if (this.m_type === 1) {
                scaleAnm = THUNDER_SCALE_DOWN_ANM_CHR;
            } else {
                throw new Error('Invalid scale type');
            }

            const anmResultScale = scaleAnm.getAnmResultScale(this.m_anmFrame, 0);
            this.m_sizeScale.copy(
                this.m_scaleTransformOffset.add(this.m_scaleTransformSlope.mulV(anmResultScale)),
            );

            this.m_anmFrame = fr(this.m_anmFrame + 1.0);
            if (this.m_anmFrame > scaleAnm.frameCount()) {
                this.m_scaleAnmActive = false;
                this.m_sizeScale.setAll(this.m_scaleTarget[this.m_type]!);
                this.m_scaleTransformOffset.setZero();
                this.m_scaleTransformSlope.setZero();
            }
        }

        this.calcCrush();
    }

    /** @addr{0x8056B060} */
    startCrush(): void {
        this.m_crushState = CrushState.Crush;
        this.m_pressScale.copy(new Vector3f(1.0, 1.0, 1.0));
        this.m_uncrushAnmFrame = 0.0;
        this.m_calcCrush = true;
    }

    /** @addr{0x8056B094} */
    endCrush(): void {
        this.m_crushState = CrushState.Uncrush;
        this.m_pressScale.copy(new Vector3f(1.0, CRUSH_SCALE, 1.0));
        this.m_uncrushAnmFrame = 0.0;
        this.m_calcCrush = true;
    }

    /** @addr{0x8056AFB4} */
    startShrink(unk: number): void {
        this.m_type = unk > 0 ? 2 : 1;
        this.m_anmFrame = 0.0;
        this.m_scaleAnmActive = true;
        const tmp = this.m_scaleTarget[this.m_type]!;
        this.m_scaleTransformSlope.copy(
            new Vector3f(tmp, tmp, tmp)
                .sub(this.m_sizeScale)
                .div(fr(s_baseScaleTarget[this.m_type]! - s_baseScaleStart[this.m_type]!)),
        );
        this.m_scaleTransformOffset.copy(
            this.m_sizeScale.sub(this.m_scaleTransformSlope.mul(s_baseScaleStart[this.m_type]!)),
        );
    }

    /** @addr{0x8056B168} */
    endShrink(unk: number): void {
        this.m_type = unk > 0 ? 3 : 0;
        this.m_anmFrame = 0.0;
        this.m_scaleAnmActive = true;
        const tmp = this.m_scaleTarget[this.m_type]!;
        this.m_scaleTransformSlope.copy(
            new Vector3f(tmp, tmp, tmp)
                .sub(this.m_sizeScale)
                .div(fr(s_baseScaleTarget[this.m_type]! - s_baseScaleStart[this.m_type]!)),
        );
        this.m_scaleTransformOffset.copy(
            this.m_sizeScale.sub(this.m_scaleTransformSlope.mul(s_baseScaleStart[this.m_type]!)),
        );
    }

    /** @addr{0x8056B45C} */
    private calcCrush(): void {
        const SCALE_SPEED = fr(0.2);

        if (!this.m_calcCrush || this.m_crushState === CrushState.None) {
            return;
        }

        if (this.m_crushState === CrushState.Crush) {
            this.m_pressScale.y = fr(this.m_pressScale.y - SCALE_SPEED);
            if (this.m_pressScale.y < CRUSH_SCALE) {
                this.m_pressScale.y = CRUSH_SCALE;
                this.m_calcCrush = false;
            }
        } else {
            this.m_pressScale.copy(this.getAnmScale(this.m_uncrushAnmFrame));

            const scaleAnm = PRESS_SCALE_UP_ANM_CHR;

            this.m_uncrushAnmFrame = fr(this.m_uncrushAnmFrame + 1.0);
            if (this.m_uncrushAnmFrame > fr(scaleAnm.frameCount())) {
                this.m_calcCrush = false;
            }
        }
    }

    /** @addr{0x8056ACF4} TODO: animation sampling stubbed to (1, 1, 1); see StubScaleAnmChr. */
    private getAnmScale(frame: number): Vector3f {
        const scaleAnm = PRESS_SCALE_UP_ANM_CHR;
        return scaleAnm.getAnmResultScale(frame, 0);
    }

    sizeScale(): Readonly<Vector3f> {
        return this.m_sizeScale;
    }

    pressScale(): Readonly<Vector3f> {
        return this.m_pressScale;
    }
}
