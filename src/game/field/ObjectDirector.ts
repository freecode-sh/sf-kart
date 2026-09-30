/**
 * Port of Kinoko source/game/field/ObjectDirector.{hh,cc}.
 *
 * Ported concrete objects: ObjectHeyho (DK Summit Shy Guys), ObjectNoImpl (every ID Kinoko does
 * not implement). Every other ID that Kinoko's createObject() maps to a concrete class, and the
 * rGV2 / Moonview / sun / Shy Guy Beach managers, raise "not supported" instead of silently
 * diverging.
 *
 * TS deviations:
 *  - The flow/hit tables are read from the Core archive when present. Our generated courses boot
 *    from a Core archive without them (and have no objects); a missing table only throws on use.
 */

import { Course } from '../../Common';
import { box } from '../../egg/core/Box';
import { fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import type { KartObject } from '../kart/KartObject';
import { Reaction } from '../kart/KartCollide';
import { CourseMap } from '../system/CourseMap';
import type { MapdataGeoObj } from '../system/map/MapdataGeoObj';
import { RaceConfig } from '../system/RaceConfig';
import { BoxColManager } from './BoxColManager';
import type { ObjectCollisionConvexHull } from './ObjectCollisionConvexHull';
import { ObjectDrivableDirector } from './ObjectDrivableDirector';
import { ObjectFlowTable } from './ObjectFlowTable';
import { ObjectHitTable } from './ObjectHitTable';
import type { ObjectBase } from './obj/ObjectBase';
import type { ObjectCollidable } from './obj/ObjectCollidable';
import { ObjectHeyho } from './obj/ObjectHeyho';
import { IsObjectBlacklisted, ObjectId } from './obj/ObjectId';
import { ObjectNoImpl } from './obj/ObjectNoImpl';

const MAX_UNIT_COUNT = 0x100;
/** Maximum number of managed objects */
const MAX_MANAGED_OBJECTS = 400;

let s_instance: ObjectDirector | null = null; ///< @addr{0x809C4330}
let s_wanwanMaxPitch = 0.0; ///< @addr{0x808C70E8}

/** Opaque stand-in for Kinoko's ObjectPsea (rising water). Never present on our course. */
export interface ObjectPsea {
    pos(): Readonly<Vector3f>;
}

/** Reaction value 0 (Kart::Reaction::None); used as the zero-initialized array value. */
const REACTION_ZERO = 0 as Reaction;

const RISING_WATER_KILL_PLANE_OFFSET = 260.0;

/**
 * IDs that ObjectDirector::createObject maps to a concrete implementation. Every other ID becomes
 * an ObjectNoImpl (no collision, no calc), which has no effect on physics. Of these, only
 * ObjectId.Heyho is ported; the rest throw in createObject.
 */
const IMPLEMENTED_OBJECT_IDS: ReadonlySet<number> = new Set<number>([
    ObjectId.Psea,
    ObjectId.Woodbox,
    ObjectId.WLWallGC,
    ObjectId.CarA1,
    ObjectId.CarA2,
    ObjectId.CarA3,
    ObjectId.Basabasa,
    ObjectId.HeyhoShipGBA,
    ObjectId.KartTruck,
    ObjectId.CarBody,
    ObjectId.KoopaBall,
    ObjectId.W_Woodbox,
    ObjectId.SunDS,
    ObjectId.ItemboxLine,
    ObjectId.VolcanoBall,
    ObjectId.PenguinS,
    ObjectId.PenguinM,
    ObjectId.Dossunc,
    ObjectId.Boble,
    ObjectId.Hanachan,
    ObjectId.Seagull,
    ObjectId.Crab,
    ObjectId.Hwanwan,
    ObjectId.HeyhoBallGBA,
    ObjectId.DokanSFC,
    ObjectId.Pylon,
    ObjectId.OilSFC,
    ObjectId.ParasolR,
    ObjectId.KoopaFigure64,
    ObjectId.Kuribo,
    ObjectId.Choropu,
    ObjectId.Choropu2,
    ObjectId.Cow,
    ObjectId.PakkunF,
    ObjectId.WLFirebarGC,
    ObjectId.KoopaFirebar,
    ObjectId.Wanwan,
    ObjectId.Poihana,
    ObjectId.Propeller,
    ObjectId.DKRockGC,
    ObjectId.Sanbo,
    ObjectId.TruckWagon,
    ObjectId.Heyho,
    ObjectId.Press,
    ObjectId.WLFireRingGC,
    ObjectId.FireSnake,
    ObjectId.FireSnakeV,
    ObjectId.PuchiPakkun,
    ObjectId.KinokoUd,
    ObjectId.KinokoBend,
    ObjectId.VolcanoRock,
    ObjectId.BulldozerL,
    ObjectId.BulldozerR,
    ObjectId.KinokoNm,
    ObjectId.Crane,
    ObjectId.VolcanoPiece,
    ObjectId.FlamePole,
    ObjectId.TwistedWay,
    ObjectId.TownBridge,
    ObjectId.DKShip64,
    ObjectId.Turibashi,
    ObjectId.Aurora,
    ObjectId.DCPillar,
    ObjectId.Sandcone,
    ObjectId.FlamePoleV,
    ObjectId.FlamePoleVBig,
    ObjectId.Ami,
    ObjectId.BeltEasy,
    ObjectId.BeltCrossing,
    ObjectId.BeltCurveA,
    ObjectId.Escalator,
    ObjectId.EscalatorGroup,
    ObjectId.DummyPole,
    ObjectId.CastleTree1c,
    ObjectId.MarioTreeGCc,
    ObjectId.PeachTreeGCc,
    ObjectId.MarioGo64c,
    ObjectId.KinokoT1,
    ObjectId.PalmTree,
    ObjectId.Parasol,
    ObjectId.HeyhoTreeGBAc,
    ObjectId.GardenTreeDSc,
    ObjectId.DKtreeA64c,
    ObjectId.DKTreeB64c,
    ObjectId.TownTreeDsc,
    ObjectId.PakkunDokan,
    ObjectId.WLDokanGC,
    ObjectId.Mdush,
]);

export class ObjectDirector {
    private m_flowTable: ObjectFlowTable;
    private m_hitTableKart: ObjectHitTable;
    private m_hitTableKartObject: ObjectHitTable;

    /** All objects live here */
    private m_objects: ObjectBase[] = [];
    /** Objects needing calc() live here too. */
    private m_calcObjects: ObjectBase[] = [];
    /** Objects having collision live here too */
    private m_collisionObjects: ObjectBase[] = [];

    /** Objects we are currently colliding with */
    private m_collidingObjects: (ObjectCollidable | null)[] = [];
    private m_hitDepths: Vector3f[] = [];
    private m_reactions: Reaction[] = [];
    private m_psea: ObjectPsea | null;
    private m_managedObjects: ObjectCollidable[] = [];

    /** @addr{0x8082A2B4} */
    init(): void {
        for (const obj of this.m_objects) {
            obj.init();
            obj.calcModel();
        }

        ObjectDrivableDirector.Instance()!.init();
    }

    /** @addr{0x8082A8F4} */
    calc(): void {
        for (const obj of this.m_calcObjects) {
            obj.calc();
        }

        for (const obj of this.m_calcObjects) {
            obj.calcModel();
        }

        ObjectDrivableDirector.Instance()!.calc();
    }

    /** @addr{0x8082B0E8} */
    addObject(obj: ObjectCollidable): void {
        const loadFlags = obj.loadFlags();

        if (loadFlags & 1) {
            this.m_calcObjects.push(obj);
        }

        const set = this.m_flowTable.set(this.m_flowTable.slot(obj.id()));

        // In the base game, it's possible an object here will access slot -1 (e.g. Moonview Highway
        // cars). We add a nullptr check here to prevent this.
        if (set && set.mode !== 0) {
            if (obj.collision()) {
                this.m_collisionObjects.push(obj);
            }
        }

        this.m_objects.push(obj);
    }

    addObjectNoImpl(obj: ObjectBase): void {
        this.m_objects.push(obj);
    }

    /** @addr{0x806C4ED4} */
    addManagedObject(obj: ObjectCollidable): void {
        if (this.m_managedObjects.length >= MAX_MANAGED_OBJECTS) {
            throw new Error('ObjectDirector: too many managed objects');
        }
        this.m_managedObjects.push(obj);
    }

    /** @addr{0x8082AB04} */
    checkKartObjectCollision(kartObj: KartObject, convexHull: ObjectCollisionConvexHull): number {
        let count = 0;

        for (
            let obj = BoxColManager.Instance()!.getNextObject();
            obj;
            obj = BoxColManager.Instance()!.getNextObject()
        ) {
            const objCollision = obj.collision();
            if (!objCollision) {
                continue;
            }

            obj.calcCollisionTransform();
            if (!obj.checkCollision(convexHull, this.m_hitDepths[count]!)) {
                continue;
            }

            // We have a collision, process it
            // Assume that we are not in a star, mega, or bullet
            const reactionOnKart = box<Reaction>(
                this.m_hitTableKart.reaction(this.m_hitTableKart.slot(obj.id())),
            );
            const reactionOnObj = box<Reaction>(
                this.m_hitTableKartObject.reaction(this.m_hitTableKartObject.slot(obj.id())),
            );

            // The object might change the reaction states
            obj.processKartReactions(kartObj, reactionOnKart, reactionOnObj);

            const reaction = obj.onCollision(
                kartObj,
                reactionOnKart.value,
                reactionOnObj.value,
                this.m_hitDepths[count]!,
            );
            this.m_reactions[count] = reaction;

            if (reaction === Reaction.WallAllSpeed || reaction === Reaction.WallSpark) {
                obj.onWallCollision(kartObj, this.m_hitDepths[count]!);
            } else {
                obj.onObjectCollision(kartObj);
            }

            this.m_collidingObjects[count] = obj;
            if (this.m_hitDepths[count]!.y < 0.0) {
                this.m_hitDepths[count]!.y = 0.0;
            }

            ++count;
        }

        return count;
    }

    flowTable(): ObjectFlowTable {
        return this.m_flowTable;
    }

    hitTableKart(): ObjectHitTable {
        return this.m_hitTableKart;
    }

    collidingObject(idx: number): ObjectCollidable | null {
        return this.m_collidingObjects[idx]!;
    }

    reaction(idx: number): Reaction {
        return this.m_reactions[idx]!;
    }

    hitDepth(idx: number): Readonly<Vector3f> {
        return this.m_hitDepths[idx]!;
    }

    managedObjects(): ObjectCollidable[] {
        return this.m_managedObjects;
    }

    setPsea(psea: ObjectPsea | null): void {
        this.m_psea = psea;
    }

    psea(): ObjectPsea | null {
        return this.m_psea;
    }

    /** @addr{0x8082B3EC} */
    distAboveRisingWater(offset: number): number {
        return fr(offset - this.m_psea!.pos().y);
    }

    /** @addr{0x8082B400} */
    risingWaterKillPlaneHeight(): number {
        return fr(this.m_psea!.pos().y - RISING_WATER_KILL_PLANE_OFFSET);
    }

    /** @addr{0x808C70E8} */
    static WanwanMaxPitch(): number {
        return s_wanwanMaxPitch;
    }

    /** @addr{0x8082A784} */
    static CreateInstance(): ObjectDirector {
        if (s_instance) throw new Error('ObjectDirector already exists');
        s_instance = new ObjectDirector();

        ObjectDrivableDirector.CreateInstance();

        s_instance.createObjects();

        return s_instance;
    }

    /** @addr{0x8082A824} */
    static DestroyInstance(): void {
        s_instance = null;

        ObjectDrivableDirector.DestroyInstance();
    }

    static Instance(): ObjectDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8082A38C} */
    private constructor() {
        this.m_flowTable = new ObjectFlowTable('ObjFlow.bin');
        this.m_hitTableKart = new ObjectHitTable('GeoHitTableKart.bin');
        this.m_hitTableKartObject = new ObjectHitTable('GeoHitTableKartObj.bin');
        for (let i = 0; i < MAX_UNIT_COUNT; ++i) {
            this.m_collidingObjects.push(null);
            this.m_hitDepths.push(new Vector3f());
            this.m_reactions.push(REACTION_ZERO);
        }
        this.m_psea = null;
    }

    /** @addr{0x80826E8C} */
    private createObjects(): void {
        const courseMap = CourseMap.Instance()!;
        const objectCount = courseMap.getGeoObjCount();

        const course = RaceConfig.Instance()!.raceScenario().course;
        const rGV2 = course === Course.SNES_Ghost_Valley_2;
        let sun = false;

        // The max pitch of the Chain Chomp only needs to be set once,
        // so we set it here instead of in the Chain Chomp constructor.
        s_wanwanMaxPitch = course === Course.GCN_Mario_Circuit ? -20.0 : -30.0;

        for (let i = 0; i < objectCount; ++i) {
            const pObj = courseMap.getGeoObj(i)!;

            // Assume one player - if the presence flag isn't set, don't construct it
            if (!(pObj.presenceFlag() & 1)) {
                continue;
            }

            // Prevent construction of objects with disabled or no collision
            if (IsObjectBlacklisted(pObj.id())) {
                continue;
            }

            // rGV2's blocks are created outside of the factory function
            if (rGV2) {
                switch (pObj.id() as ObjectId) {
                    case ObjectId.ObakeBlockSFCc:
                    case ObjectId.ObakeBlock2SFCc:
                    case ObjectId.ObakeBlock3SFCc:
                        throw new Error('ObjectDirector: rGV2 ObakeManager / ObakeBlock is not supported');
                    default:
                        break;
                }
            } else {
                const object = this.createObject(pObj);
                object.load();
            }

            if ((pObj.id() as ObjectId) === ObjectId.SunDS) {
                sun = true;
            }
        }

        if (course === Course.Moonview_Highway) {
            throw new Error('ObjectDirector: ObjectHighwayManager is not supported');
        }

        if (sun) {
            throw new Error('ObjectDirector: ObjectSunManager is not supported');
        }

        if (course === Course.GBA_Shy_Guy_Beach) {
            throw new Error('ObjectDirector: ObjectHeyhoShipManager is not supported');
        }
    }

    /** @addr{0x80821E14} */
    private createObject(params: MapdataGeoObj): ObjectBase {
        const id = params.id() as ObjectId;
        switch (id) {
            case ObjectId.Heyho:
                return new ObjectHeyho(params);
            default:
                if (IMPLEMENTED_OBJECT_IDS.has(id)) {
                    throw new Error(`ObjectDirector: course object 0x${id.toString(16)} is not supported`);
                }
                return new ObjectNoImpl(params);
        }
    }
}
