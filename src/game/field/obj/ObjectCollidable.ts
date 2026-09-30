/**
 * Port of Kinoko source/game/field/obj/ObjectCollidable.{hh,cc}.
 *
 * C++ overloads `loadAABB(f32 maxSpeed)` and `loadAABB(f32 radius, f32 maxSpeed)` are merged
 * into one method with an optional second argument.
 */

import type { Box } from '../../../egg/core/Box';
import { fmax, fr } from '../../../egg/math/Math';
import { Vector3f } from '../../../egg/math/Vector';
import type { KartObject } from '../../kart/KartObject';
import { Reaction } from '../../kart/KartCollide';
import type { MapdataGeoObj } from '../../system/map/MapdataGeoObj';
import { BoxColManager } from '../BoxColManager';
import type { ObjectCollisionBase } from '../ObjectCollisionBase';
import { ObjectCollisionBox } from '../ObjectCollisionBox';
import { ObjectCollisionCylinder } from '../ObjectCollisionCylinder';
import { ObjectCollisionSphere } from '../ObjectCollisionSphere';
import { ObjectDirector } from '../ObjectDirector';
import { CollisionMode } from '../ObjectFlowTable';
import { ObjectBase } from './ObjectBase';

export class ObjectCollidable extends ObjectBase {
    protected m_collision: ObjectCollisionBase | null;

    /**
     * @addr{0x8081EFEC} `ObjectCollidable(const System::MapdataGeoObj &params)`
     * @addr{0x8081F064} `ObjectCollidable(const char *name, pos, rot, scale)`
     */
    constructor(params: MapdataGeoObj);
    constructor(name: string, pos: Readonly<Vector3f>, rot: Readonly<Vector3f>, scale: Readonly<Vector3f>);
    constructor(
        a: MapdataGeoObj | string,
        pos?: Readonly<Vector3f>,
        rot?: Readonly<Vector3f>,
        scale?: Readonly<Vector3f>,
    ) {
        if (typeof a === 'string') {
            super(a, pos!, rot!, scale!);
        } else {
            super(a);
        }
        this.m_collision = null;
    }

    /** @addr{0x8081F0A0} */
    load(): void {
        this.loadGraphics();
        this.loadAnims();
        this.createCollision();

        if (this.m_collision) {
            this.loadAABB(0.0);
        }

        this.loadRail();

        ObjectDirector.Instance()!.addObject(this);
    }

    /** @addr{0x8081F7C8} */
    calcCollisionTransform(): void {
        this.calcTransform();
        this.m_collision!.transform(this.transform(), this.scale(), this.getCollisionTranslation());
    }

    /**
     * @addr{0x806815A0}
     * Finds the radius that fits fully in a BoxColUnit. The collision parameters are referred to
     * as a box due to its use of axes; this does not imply that all collidable objects are boxes.
     */
    override getCollisionRadius(): number {
        const flowTable = ObjectDirector.Instance()!.flowTable();
        const collisionSet = flowTable.set(flowTable.slot(this.id()))!;

        const zRadius = fr(this.scale().z * fr(collisionSet.params.box.z));
        const xRadius = fr(this.scale().x * fr(collisionSet.params.box.x));

        return fmax(xRadius, zRadius);
    }

    /**
     * C++ overloads `loadAABB(f32 maxSpeed)` (@addr{0x806816D8}) and
     * `loadAABB(f32 radius, f32 maxSpeed)` (@addr{0x8081F180}).
     */
    loadAABB(a: number, b?: number): void {
        if (b === undefined) {
            this.loadAABB(this.getCollisionRadius(), a);
            return;
        }

        const radius = a;
        const maxSpeed = b;
        const boxColMgr = BoxColManager.Instance()!;
        const pos = this.getPosition();
        const alwaysRecalc = (this.loadFlags() & 0x5) !== 0;
        this.m_boxColUnit = boxColMgr.insertObject(radius, maxSpeed, pos, alwaysRecalc, this);
    }

    /** @addr{0x8081F66C} */
    processKartReactions(kartObj: KartObject, reactionOnKart: Box<Reaction>, reactionOnObj: Box<Reaction>): void {
        // Process the reaction on kart
        if (kartObj.speedRatioCapped() < 0.5) {
            if (reactionOnKart.value === Reaction.SpinSomeSpeed) {
                reactionOnKart.value = Reaction.WallAllSpeed;
            } else if (reactionOnKart.value === Reaction.SpinHitSomeSpeed) {
                reactionOnKart.value = Reaction.None;
            }
        } else {
            if (reactionOnKart.value === Reaction.SpinHitSomeSpeed) {
                reactionOnKart.value = Reaction.SpinSomeSpeed;
            }
        }

        // Process the reaction on object
        if (reactionOnObj.value === Reaction.UNK_3 || reactionOnObj.value === Reaction.UNK_4) {
            reactionOnObj.value = Reaction.None;
        }
    }

    /** @addr{0x8068179C} */
    onCollision(_kartObj: KartObject, reactionOnKart: Reaction, _reactionOnObj: Reaction, _hitDepth: Vector3f): Reaction {
        return reactionOnKart;
    }

    onWallCollision(_kartObj: KartObject, _hitDepth: Readonly<Vector3f>): void {}
    onObjectCollision(_kartObj: KartObject): void {}

    /** @addr{0x80681748} */
    checkCollision(lhs: ObjectCollisionBase, dist: Vector3f): boolean {
        return lhs.check(this.collision()!, dist);
    }

    /** @addr{0x8068173C} */
    getCollisionTranslation(): Readonly<Vector3f> {
        return Vector3f.zero;
    }

    /** @addr{0x80573518} */
    collision(): ObjectCollisionBase | null {
        return this.m_collision;
    }

    /** @addr{0x8081F224} */
    createCollision(): void {
        const flowTable = ObjectDirector.Instance()!.flowTable();
        const collisionSet = flowTable.set(flowTable.slot(this.id()));

        if (!collisionSet) {
            throw new Error(`Invalid object ID when creating primitive collision! ID: ${this.id()}`);
        }

        switch (collisionSet.mode as CollisionMode) {
            case CollisionMode.Sphere:
                this.m_collision = new ObjectCollisionSphere(
                    fr(collisionSet.params.sphere.radius),
                    this.collisionCenter(),
                );
                break;
            case CollisionMode.Cylinder:
                this.m_collision = new ObjectCollisionCylinder(
                    fr(collisionSet.params.cylinder.radius),
                    fr(collisionSet.params.cylinder.height),
                    this.collisionCenter(),
                );
                break;
            case CollisionMode.Box:
                this.m_collision = new ObjectCollisionBox(
                    fr(collisionSet.params.box.x),
                    fr(collisionSet.params.box.y),
                    fr(collisionSet.params.box.z),
                    this.collisionCenter(),
                );
                break;
            default:
                throw new Error(
                    `Invalid collision mode when creating primitive collision! ID: ${this.id()}; Mode: ${collisionSet.mode}`,
                );
        }
    }

    /** @addr{0x806816B8} */
    protected collisionCenter(): Readonly<Vector3f> {
        return Vector3f.zero;
    }

    /** @addr{0x8081F170} */
    protected registerManagedObject(): void {
        ObjectDirector.Instance()!.addManagedObject(this);
    }
}
