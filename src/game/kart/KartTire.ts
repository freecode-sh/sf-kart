/**
 * Port of Kinoko's game/kart/KartTire.{hh,cc}.
 * A holder for a wheel's physics data.
 */

import { type KartSuspensionPhysics, WheelPhysics } from './KartSuspensionPhysics';

export class KartTire {
    protected m_tireType: KartSuspensionPhysics.TireType;
    protected m_bspWheelIdx: number;
    protected m_wheelPhysics: WheelPhysics = null!;

    /** @addr{0x8059AA44} */
    constructor(tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number) {
        this.m_tireType = tireType;
        this.m_bspWheelIdx = bspWheelIdx;
    }

    /** @addr{0x8059AB14} */
    createPhysics(tireIdx: number): void {
        this.m_wheelPhysics = new WheelPhysics(tireIdx, 1);
    }

    /** @addr{0x8059AAB0} */
    init(tireIdx: number): void {
        this.createPhysics(tireIdx);
        this.m_wheelPhysics.init();
    }

    /** @addr{0x8059AB68} */
    initBsp(): void {
        this.m_wheelPhysics.initBsp();
    }

    wheelPhysics(): WheelPhysics {
        return this.m_wheelPhysics;
    }
}

/** A holder for a kart's front tire's physics data. */
export class KartTireFront extends KartTire {
    /** @addr{Inlined in 0x8058EA0C} */
    constructor(tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number) {
        super(tireType, bspWheelIdx);
    }

    /** @addr{0x8059AC1C} */
    override createPhysics(tireIdx: number): void {
        this.m_wheelPhysics = new WheelPhysics(tireIdx, 0);
    }
}

/** A holder for a bike's front tire's physics data. */
export class KartTireFrontBike extends KartTire {
    constructor(tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number) {
        super(tireType, bspWheelIdx);
    }

    /** @addr{0x8059B038} */
    override createPhysics(tireIdx: number): void {
        this.m_wheelPhysics = new WheelPhysics(tireIdx, 0);
    }
}

/** A holder for a bike's rear tire's physics data. */
export class KartTireRearBike extends KartTire {
    constructor(tireType: KartSuspensionPhysics.TireType, bspWheelIdx: number) {
        super(tireType, bspWheelIdx);
    }

    /** @addr{0x8059B1FC} */
    override createPhysics(tireIdx: number): void {
        this.m_wheelPhysics = new WheelPhysics(tireIdx, 1);
    }
}
