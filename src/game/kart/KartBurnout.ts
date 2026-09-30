/** Port of Kinoko source/game/kart/KartBurnout.{hh,cc}. */

import { DEG2RAD, fr, SinFIdx } from '../../egg/math/Math';
import { Quatf } from '../../egg/math/Quat';
import { KartObjectProxy } from './KartObjectProxy';
import { eStatus } from './Status';

const BURNOUT_DURATION = 120;

const PHASE_INCREMENT = 800;
const PHASE_TO_FIDX = fr(1.0 / 256.0);
const AMPLITUDE_FACTOR = 40.0;
const DAMPENING_THRESHOLD = 30.0;
const DAMPENING_FACTOR = fr(0.97);

/**
 * Calculates the duration of burnout and rotation induced when holding acceleration too long
 * during the race countdown.
 */
export class KartBurnout extends KartObjectProxy {
    /** u32 */
    private m_timer = 0;
    /** u16 */
    private m_phase = 0;
    private m_amplitude = 0.0;
    private m_pitch = 0.0;

    /** @addr{inlined in 0x80577FC4} */
    constructor() {
        super();
    }

    /** @addr{0x805890B0} */
    start(): void {
        this.activate();
        this.m_timer = 0;
        this.m_phase = 0;
        this.m_amplitude = 1.0;
    }

    /** @addr{0x80589118} */
    calc(): void {
        if (!this.isActive()) {
            return;
        }

        this.calcRotation();

        if (this.calcEnd(BURNOUT_DURATION)) {
            this.deactivate();
        }
    }

    pitch(): number {
        return this.m_pitch;
    }

    /** @addr{0x80589308} */
    private calcRotation(): void {
        this.m_phase = (this.m_phase + PHASE_INCREMENT) & 0xffff;

        const sin = SinFIdx(fr(this.m_phase * PHASE_TO_FIDX));

        // Apply a dampening effect after burning out for 30 frames
        if (fr(this.m_timer) > DAMPENING_THRESHOLD) {
            this.m_amplitude = fr(this.m_amplitude * DAMPENING_FACTOR);
        }

        this.m_pitch = fr(fr(DEG2RAD * fr(AMPLITUDE_FACTOR * sin)) * this.m_amplitude);

        this.physics().composeStuntRot(Quatf.FromRPY3(0.0, this.m_pitch, 0.0));
    }

    /** @addr{0x8058920C} */
    private calcEnd(duration: number): boolean {
        this.m_timer = (this.m_timer + 1) >>> 0;
        return this.m_timer >= duration;
    }

    /** @addr{0x80589844} */
    private activate(): void {
        this.status().setBit(eStatus.Burnout);
    }

    /** @addr{0x80589818} */
    private deactivate(): void {
        this.status().resetBit(eStatus.Burnout);
    }

    /** @addr{0x80589830} */
    private isActive(): boolean {
        return this.status().onBit(eStatus.Burnout);
    }
}
