/** Port of Kinoko's game/kart/KartObject.{hh,cc}. The highest level abstraction for a kart. */

import { type Character, Vehicle } from '../../Common';
import { Vector3f } from '../../egg/math/Vector';

import { ObjectCollisionKart } from '../field/ObjectCollisionKart';
import { KartModelBike, KartModelKart } from '../render/KartModel';
import { CourseMap } from '../system/CourseMap';
import { RaceManager } from '../system/RaceManager';

import { type KartBody, KartBodyBike, KartBodyKart, KartBodyQuacker } from './KartBody';
import { KartAccessor, KartObjectProxy, LinkKartObjectProxy } from './KartObjectProxy';
import { KartParam } from './KartParam';
import { KartPhysics } from './KartPhysics';
import { KartSub } from './KartSub';
import {
    KartSuspension,
    KartSuspensionFrontBike,
    KartSuspensionRearBike,
} from './KartSuspension';
import { KartSuspensionPhysics } from './KartSuspensionPhysics';
import { KartTire, KartTireFront, KartTireFrontBike, KartTireRearBike } from './KartTire';

// TS-only: late-bind singletons used by KartObjectProxy (see the note in KartObjectProxy.ts).
LinkKartObjectProxy({
    raceManager: () => RaceManager.Instance(),
    courseMap: () => CourseMap.Instance(),
});

const LOCAL_20 = [2, 1, 1, 1] as const;
const LOCAL_28 = [2, 1, 1, 2] as const;

export class KartObject extends KartObjectProxy {
    protected m_pointers: KartAccessor = new KartAccessor();

    /** @addr{0x8058DDBC} */
    constructor(param: KartParam) {
        super();
        this.m_pointers.param = param;
    }

    /** @addr{0x8058EA0C} */
    createTires(): void {
        const BSP_WHEEL_INDICES = [0, 0, 1, 1, 2, 2, 3, 3];
        const X_MIRRORED_TIRE = [
            KartSuspensionPhysics.TireType.Kart,
            KartSuspensionPhysics.TireType.KartReflected,
            KartSuspensionPhysics.TireType.Kart,
            KartSuspensionPhysics.TireType.KartReflected,
            KartSuspensionPhysics.TireType.Kart,
            KartSuspensionPhysics.TireType.KartReflected,
            KartSuspensionPhysics.TireType.Kart,
            KartSuspensionPhysics.TireType.KartReflected,
        ];

        const bodyType = this.m_pointers.param.stats().body;
        let tireCount = this.m_pointers.param.tireCount();

        if (bodyType === KartParam.Stats.Body.Three_Wheel_Kart) {
            tireCount = 4;
        }

        for (let wheelIdx = 0, i = 0; i < tireCount; ++i) {
            if (bodyType === KartParam.Stats.Body.Three_Wheel_Kart && i === 0) {
                continue;
            }

            const bspWheelIdx = BSP_WHEEL_INDICES[i]!;
            const tireType = X_MIRRORED_TIRE[i]!;

            const sus = new KartSuspension();
            const tire =
                bspWheelIdx === 0
                    ? new KartTireFront(tireType, bspWheelIdx)
                    : new KartTire(tireType, bspWheelIdx);

            this.m_pointers.suspensions.push(sus);
            this.m_pointers.tires.push(tire);

            sus.init(wheelIdx++, tireType, bspWheelIdx);
        }
    }

    /** @addr{0x8058E5F8} */
    createBody(physics: KartPhysics): KartBody {
        return new KartBodyKart(physics);
    }

    /** @addr{0x8058E22C} */
    init(): void {
        this.prepareTiresAndSuspensions();
        this.createSub();
        const physics = KartPhysics.Create(this.m_pointers.param);
        const body = this.createBody(physics);
        this.m_pointers.body = body;
        this.createTires();
        for (let tireIdx = 0; tireIdx < this.m_pointers.param.tireCount(); ++tireIdx) {
            this.m_pointers.tires[tireIdx]!.init(tireIdx);
        }
        this.m_pointers.objectCollisionKart = new ObjectCollisionKart();
    }

    /** @addr{0x8058E188} */
    initImpl(): void {
        this.sub().initAABB(this.m_pointers, this);
        this.sub().init();
        this.objectCollisionKart().init(this.param().playerIdx());
    }

    /** @addr{0x8058EE48} Sets the initial position and rotation of the kart based off the track. */
    prepare(): void {
        const euler_angles_deg = new Vector3f();
        const position = new Vector3f();

        RaceManager.Instance().findKartStartPoint(position, euler_angles_deg);
        this.move().setInitialPhysicsValues(position, euler_angles_deg);
    }

    /** @addr{0x8058E804} */
    prepareTiresAndSuspensions(): void {
        const rBsp = this.m_pointers.param.bsp();
        const bodyWheels = this.m_pointers.param.stats().body;
        let wheelCount = 0;

        if (rBsp.wheels[0]!.enable !== 0) {
            wheelCount += LOCAL_20[bodyWheels]!;
        }
        if (rBsp.wheels[1]!.enable !== 0) {
            wheelCount += LOCAL_28[bodyWheels]!;
        }
        if (rBsp.wheels[2]!.enable !== 0) {
            wheelCount += LOCAL_20[bodyWheels]!;
        }
        if (rBsp.wheels[3]!.enable !== 0) {
            wheelCount += LOCAL_28[bodyWheels]!;
        }

        this.m_pointers.param.setTireCount(wheelCount);
        this.m_pointers.param.setSuspCount(wheelCount);
    }

    /** @addr{0x8058E724} */
    createSub(): void {
        this.m_pointers.sub = new KartSub();
        this.m_pointers.sub.createSubsystems(
            this.m_pointers.param.isBike(),
            this.m_pointers.param.stats(),
        );
    }

    /** @addr{0x8058F820} */
    createModel(): void {
        KartObjectProxy.proxyList().length = 0;

        if (this.isBike()) {
            this.m_pointers.model = new KartModelBike();
        } else {
            this.m_pointers.model = new KartModelKart();
        }

        KartObjectProxy.ApplyAll(this.m_pointers);

        this.m_pointers.model.init();
    }

    /** @addr{0x8058EEB4} */
    calcSub(): void {
        this.sub().calcPass0();
    }

    /** @addr{0x8058EEBC} */
    calc(): void {
        this.sub().calcPass1();
        this.model().calc();
    }

    accessor(): KartAccessor {
        return this.m_pointers;
    }

    /** @addr{0x8058F5B4} */
    static Create(character: Character, vehicle: Vehicle, playerIdx: number): KartObject {
        KartObjectProxy.proxyList().length = 0;

        const param = new KartParam(character, vehicle, playerIdx);

        let object: KartObject;
        if (vehicle < Vehicle.Standard_Bike_S) {
            object = new KartObject(param);
        } else {
            object = new KartObjectBike(param);
        }

        object.init();
        object.m_pointers.sub.copyPointers(object.m_pointers);

        // Applies a valid pointer to all of the proxies we create
        KartObjectProxy.ApplyAll(object.m_pointers);

        for (let i = 0; i < object.suspCount(); ++i) {
            object.suspension(i).initPhysics();
        }

        for (let i = 0; i < object.tireCount(); ++i) {
            object.tire(i).initBsp();
        }

        return object;
    }
}

/** The highest level abstraction for a bike. */
export class KartObjectBike extends KartObject {
    /** @addr{0x8058F20C} */
    constructor(param: KartParam) {
        super(param);
    }

    /** @addr{0x8058F260} */
    override createBody(physics: KartPhysics): KartBody {
        if (this.m_pointers.param.isVehicleRelativeBike()) {
            return new KartBodyQuacker(physics);
        } else {
            return new KartBodyBike(physics);
        }
    }

    /** @addr{0x8058F2E8} */
    override createTires(): void {
        for (let wheelIdx = 0; wheelIdx < this.m_pointers.param.suspCount(); ++wheelIdx) {
            let sus: KartSuspension;
            let tire: KartTire;

            if (wheelIdx === 0 || wheelIdx === 2) {
                sus = new KartSuspensionFrontBike();
                tire = new KartTireFrontBike(KartSuspensionPhysics.TireType.Bike, 0);
            } else {
                sus = new KartSuspensionRearBike();
                tire = new KartTireRearBike(KartSuspensionPhysics.TireType.Bike, 1);
            }

            this.m_pointers.suspensions.push(sus);
            this.m_pointers.tires.push(tire);

            sus.init(wheelIdx, KartSuspensionPhysics.TireType.Bike, wheelIdx);
        }
    }
}
