/**
 * Port of Kinoko's game/kart/KartSuspension.{hh,cc}.
 * Doesn't do much besides hold a pointer to KartSuspensionPhysics.
 */

import { KartObjectProxy } from './KartObjectProxy';
import { KartSuspensionPhysics } from './KartSuspensionPhysics';

export class KartSuspension extends KartObjectProxy {
    private m_physics: KartSuspensionPhysics = null!;

    /** @addr{0x80598B08} */
    constructor() {
        super();
    }

    /** @addr{0x80598B60} */
    init(wheelIdx: number, tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number): void {
        this.m_physics = new KartSuspensionPhysics(wheelIdx, tireType, bspWheelIdx);
    }

    /** @addr{0x80598BD4} */
    initPhysics(): void {
        this.m_physics.init();
    }

    /** @addr{0x80598BE4} */
    setInitialState(): void {
        this.m_physics.setInitialState();
    }

    suspPhysics(): KartSuspensionPhysics {
        return this.m_physics;
    }
}

export class KartSuspensionFrontBike extends KartSuspension {
    constructor() {
        super();
    }
}

export class KartSuspensionRearBike extends KartSuspension {
    constructor() {
        super();
    }
}
