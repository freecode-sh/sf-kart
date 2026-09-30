/** Port of Kinoko source/game/field/ObjectCollisionKart.{hh,cc}. */

import { Vehicle } from '../../Common';
import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import type { KartObject } from '../kart/KartObject';
import { KartObjectManager } from '../kart/KartObjectManager';
import { RaceConfig } from '../system/RaceConfig';
import { ObjectCollisionConvexHull } from './ObjectCollisionConvexHull';
import { ObjectDirector } from './ObjectDirector';

const v = (x: number, y: number, z: number): Readonly<Vector3f> =>
    Object.freeze(new Vector3f(fr(x), fr(y), fr(z)));

const VERT_STANDARD_KART_S: readonly Readonly<Vector3f>[] = [v(0.0, 35.0, -40.0), v(0.0, 35.0, 25.0)];
const VERT_STANDARD_KART_M: readonly Readonly<Vector3f>[] = [v(0.0, 60.0, 10.0), v(10.0, 35.0, -50.0), v(-10.0, 35.0, -50.0), v(0.0, 35.0, 65.0)];
const VERT_STANDARD_KART_L: readonly Readonly<Vector3f>[] = [v(0.0, 135.0, 30.0), v(25.0, 35.0, -95.0), v(-25.0, 35.0, -95.0), v(0.0, 35.0, 105.0)];
const VERT_BOOSTER_SEAT: readonly Readonly<Vector3f>[] = [v(0.0, 120.0, 0.0), v(0.0, 95.0, -55.0), v(0.0, 10.0, -15.0), v(0.0, 10.0, 20.0)];
const VERT_CLASSIC_DRAGSTER: readonly Readonly<Vector3f>[] = [v(0.0, 55.0, -25.0), v(20.0, -5.0, -85.0), v(-20.0, -5.0, -85.0), v(20.0, -5.0, 60.0), v(-20.0, -5.0, 60.0)];
const VERT_OFFROADER: readonly Readonly<Vector3f>[] = [v(0.0, 85.0, 30.0), v(60.0, 5.0, -95.0), v(-60.0, 5.0, -95.0), v(50.0, 5.0, 130.0), v(-50.0, 5.0, 130.0)];
const VERT_MINI_BEAST: readonly Readonly<Vector3f>[] = [v(0.0, 25.0, -10.0), v(0.0, 5.0, -60.0), v(0.0, 5.0, 40.0)];
const VERT_WILD_WING: readonly Readonly<Vector3f>[] = [v(0.0, 60.0, -10.0), v(15.0, 25.0, -80.0), v(-15.0, 25.0, -80.0), v(0.0, 25.0, 80.0)];
const VERT_FLAME_FLYER: readonly Readonly<Vector3f>[] = [v(0.0, 80.0, 0.0), v(30.0, 0.0, -105.0), v(-30.0, 0.0, -105.0), v(25.0, 0.0, 105.0), v(-25.0, 0.0, 105.0)];
const VERT_CHEEP_CHARGER: readonly Readonly<Vector3f>[] = [v(0.0, 40.0, 0.0), v(0.0, 25.0, -10.0), v(0.0, 25.0, 10.0)];
const VERT_SUPER_BLOOPER: readonly Readonly<Vector3f>[] = [v(0.0, 50.0, 0.0), v(0.0, 25.0, 50.0), v(-25.0, 25.0, -20.0), v(25.0, 25.0, -20.0)];
const VERT_PIRANHA_PROWLER: readonly Readonly<Vector3f>[] = [v(0.0, 95.0, -10.0), v(35.0, -25.0, -115.0), v(-35.0, -25.0, -115.0), v(35.0, -25.0, 85.0), v(-35.0, -25.0, 85.0)];
const VERT_TINY_TITAN: readonly Readonly<Vector3f>[] = [v(0.0, 55.0, -10.0), v(25.0, -10.0, -40.0), v(-25.0, -10.0, -40.0), v(-25.0, -10.0, 30.0), v(25.0, -10.0, 30.0)];
const VERT_DAYTRIPPER: readonly Readonly<Vector3f>[] = [v(0.0, 60.0, 0.0), v(12.0, 5.0, -55.0), v(-12.0, 5.0, -55.0), v(8.0, 5.0, 35.0), v(-8.0, 5.0, 35.0)];
const VERT_JETSETTER: readonly Readonly<Vector3f>[] = [v(0.0, 120.0, 30.0), v(25.0, 30.0, -75.0), v(-25.0, 30.0, -75.0), v(20.0, 30.0, 115.0), v(-20.0, 30.0, 115.0)];
const VERT_BLUE_FALCON: readonly Readonly<Vector3f>[] = [v(20.0, 20.0, -30.0), v(-20.0, 20.0, -30.0), v(0.0, 20.0, 80.0)];
const VERT_SPRINTER: readonly Readonly<Vector3f>[] = [v(0.0, 60.0, 0.0), v(25.0, 20.0, -60.0), v(-25.0, 20.0, -60.0), v(20.0, 20.0, 75.0), v(-20.0, 20.0, 75.0)];
const VERT_HONEYCOUPE: readonly Readonly<Vector3f>[] = [v(0.0, 100.0, 50.0), v(60.0, 20.0, -110.0), v(-60.0, 20.0, -110.0), v(60.0, -40.0, -110.0), v(-60.0, -40.0, -110.0), v(50.0, 0.0, 130.0), v(-50.0, 0.0, 130.0)];
const VERT_STANDARD_BIKE_S: readonly Readonly<Vector3f>[] = [v(0.0, 40.0, 0.0), v(0.0, 5.0, -15.0), v(0.0, 5.0, 20.0)];
const VERT_STANDARD_BIKE_M: readonly Readonly<Vector3f>[] = [v(0.0, 75.0, 10.0), v(0.0, 10.0, -20.0), v(0.0, 10.0, 20.0)];
const VERT_STANDARD_BIKE_L: readonly Readonly<Vector3f>[] = [v(0.0, 110.0, -15.0), v(0.0, -5.0, -35.0), v(0.0, -5.0, 40.0)];
const VERT_BULLET_BIKE: readonly Readonly<Vector3f>[] = [v(0.0, 25.0, 10.0), v(0.0, -10.0, -45.0), v(0.0, -10.0, 50.0)];
const VERT_MACH_BIKE: readonly Readonly<Vector3f>[] = [v(0.0, 50.0, 15.0), v(0.0, 5.0, -30.0), v(0.0, 5.0, 35.0)];
const VERT_FLAME_RUNNER: readonly Readonly<Vector3f>[] = [v(0.0, 105.0, -10.0), v(0.0, -5.0, -50.0), v(0.0, -5.0, 45.0)];
const VERT_BIT_BIKE: readonly Readonly<Vector3f>[] = [v(0.0, 40.0, -10.0), v(0.0, 15.0, -15.0), v(0.0, 15.0, 5.0)];
const VERT_SUGARSCOOT: readonly Readonly<Vector3f>[] = [v(0.0, 70.0, 10.0), v(0.0, 10.0, -40.0), v(0.0, 10.0, 15.0)];
const VERT_WARIO_BIKE: readonly Readonly<Vector3f>[] = [v(0.0, 110.0, 35.0), v(0.0, 70.0, -65.0), v(0.0, -10.0, -75.0), v(0.0, -5.0, 85.0)];
const VERT_QUACKER: readonly Readonly<Vector3f>[] = [v(0.0, 40.0, 0.0), v(0.0, 10.0, 20.0), v(0.0, 10.0, -5.0)];
const VERT_ZIP_ZIP: readonly Readonly<Vector3f>[] = [v(0.0, 75.0, 10.0), v(0.0, 10.0, -25.0), v(0.0, 10.0, 20.0)];
const VERT_SHOOTING_STAR: readonly Readonly<Vector3f>[] = [v(0.0, 120.0, 35.0), v(0.0, -15.0, -45.0), v(0.0, -15.0, 100.0)];
const VERT_MAGIKRUISER: readonly Readonly<Vector3f>[] = [v(0.0, 35.0, -20.0), v(0.0, 0.0, -70.0), v(0.0, 0.0, 20.0)];
const VERT_SNEAKSTER: readonly Readonly<Vector3f>[] = [v(0.0, 50.0, 20.0), v(0.0, 15.0, -50.0), v(0.0, 15.0, 30.0)];
const VERT_SPEAR: readonly Readonly<Vector3f>[] = [v(0.0, 105.0, -20.0), v(0.0, -15.0, -60.0), v(0.0, -15.0, 75.0)];
const VERT_JET_BUBBLE: readonly Readonly<Vector3f>[] = [v(0.0, 35.0, 10.0), v(0.0, -5.0, -45.0), v(0.0, -5.0, 50.0)];
const VERT_DOLPHIN_DASHER: readonly Readonly<Vector3f>[] = [v(0.0, 50.0, 20.0), v(0.0, -5.0, -35.0), v(0.0, -5.0, 42.0)];
const VERT_PHANTOM: readonly Readonly<Vector3f>[] = [v(0.0, 120.0, 35.0), v(20.0, -5.0, -85.0), v(-20.0, -5.0, -85.0), v(0.0, -5.0, 100.0)];
const VERT_DEFAULT: readonly Readonly<Vector3f>[] = [v(0.0, 140.0, 10.0), v(-60.0, 70.0, 40.0), v(60.0, 70.0, 40.0), v(0.0, -40.0, -160.0), v(-60.0, -40.0, 50.0), v(60.0, -40.0, 50.0), v(0.0, -40.0, 160.0)];

/** Relates a KartObject with its convex hull representation. */
export class ObjectCollisionKart {
    private m_hull: ObjectCollisionConvexHull | null = null;
    private m_kartObject: KartObject | null;
    private m_playerIdx = 0;

    /** @addr{0x8081E0CC} */
    constructor() {
        this.m_kartObject = null;
    }

    /** @addr{0x8081D090} */
    init(idx: number): void {
        if (this.m_kartObject) {
            return;
        }

        this.m_kartObject = KartObjectManager.Instance()!.object(idx);
        this.m_playerIdx = idx;

        const vehicle = RaceConfig.Instance()!.raceScenario().players[idx]!.vehicle;
        this.m_hull = new ObjectCollisionConvexHull(ObjectCollisionKart.GetVehicleVertices(vehicle));
    }

    /** @addr{0x8081E170} */
    checkCollision(mat: Readonly<Matrix34f>, vel: Readonly<Vector3f>): number {
        if (!this.m_hull) {
            return 0;
        }

        const scale = this.m_kartObject!.scale();
        this.m_hull.transform(mat, scale, vel);
        this.m_hull.setBoundingRadius(fr(scale.x * this.m_hull.initRadius()));

        return ObjectDirector.Instance()!.checkKartObjectCollision(this.m_kartObject!, this.m_hull);
    }

    /** @addr{0x80572544} */
    static GetHitDirection(objKartHit: number): Vector3f {
        const hitDepth = ObjectDirector.Instance()!.hitDepth(objKartHit).clone();
        hitDepth.normalise();
        return hitDepth;
    }

    /** Helper function to map between a vehicle and its set of convex hull vertices. */
    static GetVehicleVertices(vehicle: Vehicle): readonly Readonly<Vector3f>[] {
        switch (vehicle) {
        case Vehicle.Standard_Kart_S:
            return VERT_STANDARD_KART_S;
        case Vehicle.Standard_Kart_M:
            return VERT_STANDARD_KART_M;
        case Vehicle.Standard_Kart_L:
            return VERT_STANDARD_KART_L;
        case Vehicle.Baby_Booster:
            return VERT_BOOSTER_SEAT;
        case Vehicle.Classic_Dragster:
            return VERT_CLASSIC_DRAGSTER;
        case Vehicle.Offroader:
            return VERT_OFFROADER;
        case Vehicle.Mini_Beast:
            return VERT_MINI_BEAST;
        case Vehicle.Wild_Wing:
            return VERT_WILD_WING;
        case Vehicle.Flame_Flyer:
            return VERT_FLAME_FLYER;
        case Vehicle.Cheep_Charger:
            return VERT_CHEEP_CHARGER;
        case Vehicle.Super_Blooper:
            return VERT_SUPER_BLOOPER;
        case Vehicle.Piranha_Prowler:
            return VERT_PIRANHA_PROWLER;
        case Vehicle.Tiny_Titan:
            return VERT_TINY_TITAN;
        case Vehicle.Daytripper:
            return VERT_DAYTRIPPER;
        case Vehicle.Jetsetter:
            return VERT_JETSETTER;
        case Vehicle.Blue_Falcon:
            return VERT_BLUE_FALCON;
        case Vehicle.Sprinter:
            return VERT_SPRINTER;
        case Vehicle.Honeycoupe:
            return VERT_HONEYCOUPE;
        case Vehicle.Standard_Bike_S:
            return VERT_STANDARD_BIKE_S;
        case Vehicle.Standard_Bike_M:
            return VERT_STANDARD_BIKE_M;
        case Vehicle.Standard_Bike_L:
            return VERT_STANDARD_BIKE_L;
        case Vehicle.Bullet_Bike:
            return VERT_BULLET_BIKE;
        case Vehicle.Mach_Bike:
            return VERT_MACH_BIKE;
        case Vehicle.Flame_Runner:
            return VERT_FLAME_RUNNER;
        case Vehicle.Bit_Bike:
            return VERT_BIT_BIKE;
        case Vehicle.Sugarscoot:
            return VERT_SUGARSCOOT;
        case Vehicle.Wario_Bike:
            return VERT_WARIO_BIKE;
        case Vehicle.Quacker:
            return VERT_QUACKER;
        case Vehicle.Zip_Zip:
            return VERT_ZIP_ZIP;
        case Vehicle.Shooting_Star:
            return VERT_SHOOTING_STAR;
        case Vehicle.Magikruiser:
            return VERT_MAGIKRUISER;
        case Vehicle.Sneakster:
            return VERT_SNEAKSTER;
        case Vehicle.Spear:
            return VERT_SPEAR;
        case Vehicle.Jet_Bubble:
            return VERT_JET_BUBBLE;
        case Vehicle.Dolphin_Dasher:
            return VERT_DOLPHIN_DASHER;
        case Vehicle.Phantom:
            return VERT_PHANTOM;
        default:
            return VERT_DEFAULT;
        }
    }

    /** Instance alias: C++ calls the static via `objectCollisionKart()->GetHitDirection(i)`. */
    GetHitDirection(objKartHit: number): Vector3f {
        return ObjectCollisionKart.GetHitDirection(objKartHit);
    }

    /** Instance alias: C++ calls the static via `objectCollisionKart()->translation(idx)`. */
    translation(idx: number): Readonly<Vector3f> {
        return ObjectCollisionKart.translation(idx);
    }

    /** @addr{0x80573464} */
    static translation(idx: number): Readonly<Vector3f> {
        const objCol = ObjectDirector.Instance()!.collidingObject(idx)!.collision();
        return objCol ? objCol.translation() : Vector3f.zero;
    }
}
