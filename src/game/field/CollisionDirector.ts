/**
 * Port of Kinoko source/game/field/CollisionDirector.{hh,cc}.
 * Manages the caching of colliding KCL triangles and exposes queries for collision checks.
 */

import type { Box } from '../../egg/core/Box';
import { TBitFlag } from '../../egg/core/BitFlag';
import type { Vector3f } from '../../egg/math/Vector';
import { CourseColMgr } from './CourseColMgr';
import { F32_MIN, type CollisionInfo, type CollisionInfoPartial } from './KColData';
import { KCL_NONE, type KCLTypeMask } from './KCollisionTypes';
import { ObjectDrivableDirector } from './ObjectDrivableDirector';

export const COLLISION_ARR_LENGTH = 0x40;

/**
 * Collision Entry Attribute fields.
 * |  0 - 4   |  5 - 7  | 8 | 9 | 10 |  11 - 12  |     13    |   14    |  15  |
 * | BaseType | Variant |   |   |    | Intensity | Trickable | Offroad | Soft |
 */
export enum eCollisionAttribute {
    Trickable = 13,
    RejectRoad = 14,
    Soft = 15,
}

/** `typedef EGG::TBitFlag<u16, eCollisionAttribute> CollisionAttribute;` */
export type CollisionAttribute = TBitFlag<eCollisionAttribute>;

export class CollisionEntry {
    typeMask: KCLTypeMask = 0;
    attribute: CollisionAttribute = new TBitFlag<eCollisionAttribute>();
    dist = 0.0;

    baseType(): number {
        return this.attribute.bits & 0x1f;
    }

    variant(): number {
        return (this.attribute.bits >>> 5) & 7;
    }

    intensity(): number {
        return (this.attribute.bits >>> 11) & 3;
    }

    setVariant(variant: number): void {
        const current = this.attribute.bits & 0xffff;
        this.attribute.setDirect(((current & ~0xe0) | ((variant & 7) << 5)) & 0xffff);
    }
}

let s_instance: CollisionDirector | null = null; ///< @addr{0x809C2F44}

/** @addr{0x809C2F44} */
export class CollisionDirector {
    static readonly eCollisionAttribute = eCollisionAttribute;
    static readonly CollisionEntry = CollisionEntry;

    private m_closestCollisionEntry: CollisionEntry | null;
    private m_entries: CollisionEntry[];
    private m_collisionEntryCount: number;

    /** @addr{0x8078E4F0} */
    checkCourseColNarrScLocal(
        radius: number,
        pos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        timeOffset: number,
    ): void {
        CourseColMgr.Instance()!.scaledNarrowScopeLocal(1.0, radius, null, pos, mask);
        ObjectDrivableDirector.Instance()!.colNarScLocal(radius, pos, mask, timeOffset);
    }

    /** @addr{0x8078F320} */
    checkSpherePartialPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        flags: KCLTypeMask,
        info: CollisionInfoPartial | null,
        typeMaskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (info) {
            info.bbox.setZero();
        }

        if (typeMaskOut) {
            typeMaskOut.value = KCL_NONE;
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const noBounceInfo = courseColMgr.noBounceWallInfo();
        if (noBounceInfo) {
            noBounceInfo.bbox.setZero();
            noBounceInfo.dist = F32_MIN;
        }

        let colliding =
            flags !== 0 &&
            courseColMgr.checkSpherePartialPush(
                1.0,
                radius,
                null,
                pos,
                prevPos,
                flags,
                info,
                typeMaskOut,
            );

        const objColliding = ObjectDrivableDirector.Instance()!.checkSpherePartialPush(
            radius,
            pos,
            prevPos,
            flags,
            info,
            typeMaskOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        if (colliding) {
            if (info) {
                info.tangentOff.copy(info.bbox.min.add(info.bbox.max));
            }

            if (noBounceInfo) {
                noBounceInfo.tangentOff.copy(noBounceInfo.bbox.min.add(noBounceInfo.bbox.max));
            }
        }

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x8078F500} */
    checkSphereFull(
        radius: number,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        flags: KCLTypeMask,
        pInfo: CollisionInfo | null,
        pFlagsOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (pInfo) {
            pInfo.reset();
        }

        if (pFlagsOut) {
            pFlagsOut.value = KCL_NONE;
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const noBounceInfo = courseColMgr.noBounceWallInfo();
        if (noBounceInfo) {
            noBounceInfo.bbox.setZero();
            noBounceInfo.dist = F32_MIN;
        }

        let colliding =
            flags !== 0 &&
            courseColMgr.checkSphereFull(1.0, radius, null, v0, v1, flags, pInfo, pFlagsOut);

        const objColliding = ObjectDrivableDirector.Instance()!.checkSphereFull(
            radius,
            v0,
            v1,
            flags,
            pInfo,
            pFlagsOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        if (colliding) {
            if (pInfo) {
                pInfo.tangentOff.copy(pInfo.bbox.min.add(pInfo.bbox.max));
            }

            if (noBounceInfo) {
                noBounceInfo.tangentOff.copy(noBounceInfo.bbox.min.add(noBounceInfo.bbox.max));
            }
        }

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x8078F784} */
    checkSphereFullPush(
        radius: number,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        flags: KCLTypeMask,
        pInfo: CollisionInfo | null,
        pFlagsOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (pInfo) {
            pInfo.reset();
        }

        if (pFlagsOut) {
            this.resetCollisionEntries(pFlagsOut);
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const noBounceInfo = courseColMgr.noBounceWallInfo();
        if (noBounceInfo) {
            noBounceInfo.bbox.setZero();
            noBounceInfo.dist = F32_MIN;
        }

        let colliding =
            flags !== 0 &&
            courseColMgr.checkSphereFullPush(1.0, radius, null, v0, v1, flags, pInfo, pFlagsOut);

        const objColliding = ObjectDrivableDirector.Instance()!.checkSphereFullPush(
            radius,
            v0,
            v1,
            flags,
            pInfo,
            pFlagsOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        if (colliding) {
            if (pInfo) {
                pInfo.tangentOff.copy(pInfo.bbox.min.add(pInfo.bbox.max));
            }

            if (noBounceInfo) {
                noBounceInfo.tangentOff.copy(noBounceInfo.bbox.min.add(noBounceInfo.bbox.max));
            }
        }

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x807901F0} */
    checkSphereCachedPartial(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        typeMask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        typeMaskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (info) {
            info.bbox.setZero();
        }

        if (typeMaskOut) {
            typeMaskOut.value = KCL_NONE;
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const noBounceInfo = courseColMgr.noBounceWallInfo();
        if (noBounceInfo) {
            noBounceInfo.bbox.setZero();
            noBounceInfo.dist = F32_MIN;
        }

        let colliding = courseColMgr.checkSphereCachedPartial(
            1.0,
            radius,
            null,
            pos,
            prevPos,
            typeMask,
            info,
            typeMaskOut,
        );

        const objColliding = ObjectDrivableDirector.Instance()!.checkSphereCachedPartial(
            radius,
            pos,
            prevPos,
            typeMask,
            info,
            typeMaskOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        if (colliding) {
            if (info) {
                info.tangentOff.copy(info.bbox.min.add(info.bbox.max));
            }

            if (noBounceInfo) {
                noBounceInfo.tangentOff.copy(noBounceInfo.bbox.min.add(noBounceInfo.bbox.max));
            }
        }

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x807903BC} */
    checkSphereCachedPartialPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        typeMask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        typeMaskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (info) {
            info.bbox.setZero();
        }

        if (typeMaskOut) {
            this.resetCollisionEntries(typeMaskOut);
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const noBounceInfo = courseColMgr.noBounceWallInfo();
        if (noBounceInfo) {
            noBounceInfo.bbox.setZero();
            noBounceInfo.dist = F32_MIN;
        }

        let colliding = courseColMgr.checkSphereCachedPartialPush(
            1.0,
            radius,
            null,
            pos,
            prevPos,
            typeMask,
            info,
            typeMaskOut,
        );

        const objColliding = ObjectDrivableDirector.Instance()!.checkSphereCachedPartialPush(
            radius,
            pos,
            prevPos,
            typeMask,
            info,
            typeMaskOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x807907F8} */
    checkSphereCachedFullPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        typeMask: KCLTypeMask,
        colInfo: CollisionInfo | null,
        typeMaskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (colInfo) {
            colInfo.reset();
        }

        if (typeMaskOut) {
            this.resetCollisionEntries(typeMaskOut);
        }

        const courseColMgr = CourseColMgr.Instance()!;
        const info = courseColMgr.noBounceWallInfo();
        if (info) {
            info.bbox.setZero();
            info.dist = F32_MIN;
        }

        let colliding = courseColMgr.checkSphereCachedFullPush(
            1.0,
            radius,
            null,
            pos,
            prevPos,
            typeMask,
            colInfo,
            typeMaskOut,
        );

        const objColliding = ObjectDrivableDirector.Instance()!.checkSphereCachedFullPush(
            radius,
            pos,
            prevPos,
            typeMask,
            colInfo,
            typeMaskOut,
            timeOffset,
        );
        colliding = colliding || objColliding;

        if (colliding) {
            if (colInfo) {
                colInfo.tangentOff.copy(colInfo.bbox.min.add(colInfo.bbox.max));
            }

            if (info) {
                info.tangentOff.copy(info.bbox.min.add(info.bbox.max));
            }
        }

        courseColMgr.clearNoBounceWallInfo();

        return colliding;
    }

    /** @addr{0x807BDA7C} */
    resetCollisionEntries(ptr: Box<KCLTypeMask>): void {
        ptr.value = 0;
        this.m_collisionEntryCount = 0;
        this.m_closestCollisionEntry = null;
    }

    /**
     * Called when we find a piece of collision we are touching and want to save it temporarily.
     * @addr{0x807BDA9C}
     * @param attribute The full u16 KCL attribute (C++ takes a CollisionAttribute bitflag).
     */
    pushCollisionEntry(
        dist: number,
        typeMask: Box<KCLTypeMask>,
        kclTypeBit: KCLTypeMask,
        attribute: number | CollisionAttribute,
    ): void {
        typeMask.value = (typeMask.value | kclTypeBit) >>> 0;
        if (this.m_collisionEntryCount >= this.m_entries.length) {
            this.m_collisionEntryCount = this.m_entries.length - 1;
        }

        // C++ copy-assigns a new CollisionEntry into the slot; we write the slot in place so that
        // pointers to it (m_closestCollisionEntry) keep C++ semantics.
        const entry = this.m_entries[this.m_collisionEntryCount++]!;
        entry.typeMask = kclTypeBit;
        entry.attribute.setDirect(
            (typeof attribute === 'number' ? attribute : attribute.bits) & 0xffff,
        );
        entry.dist = dist;
    }

    /** @addr{0x807BDB5C} */
    setCurrentCollisionVariant(attribute: number): void {
        this.m_entries[this.m_collisionEntryCount - 1]!.setVariant(attribute);
    }

    /** @addr{0x807BDBC4} */
    setCurrentCollisionTrickable(trickable: boolean): void {
        const entry = this.m_entries[this.m_collisionEntryCount - 1]!;
        entry.attribute.changeBit(trickable, eCollisionAttribute.Trickable);
    }

    /**
     * Finds the closest KCL triangle out of the list of tris we are colliding with
     * @addr{0x807BD96C}
     * @param _typeMask Unused (C++ `KCLTypeMask *`); accepts a Box or null.
     * @param type Filters the result for particular KCL types
     */
    findClosestCollisionEntry(_typeMask: Box<KCLTypeMask> | null, type: KCLTypeMask): boolean {
        this.m_closestCollisionEntry = null;
        let minDist = -F32_MIN;

        for (let i = 0; i < this.m_collisionEntryCount; ++i) {
            const entry = this.m_entries[i]!;
            const typeMask = (entry.typeMask & type) >>> 0;
            if (typeMask !== 0 && entry.dist > minDist) {
                minDist = entry.dist;
                this.m_closestCollisionEntry = entry;
            }
        }

        return !!this.m_closestCollisionEntry;
    }

    closestCollisionEntry(): Readonly<CollisionEntry> | null {
        return this.m_closestCollisionEntry;
    }

    /** @addr{0x8078DFE8} */
    static CreateInstance(): CollisionDirector {
        if (s_instance) throw new Error('CollisionDirector already exists');
        s_instance = new CollisionDirector();
        return s_instance;
    }

    /** @addr{0x8078E124} */
    static DestroyInstance(): void {
        s_instance = null;
        CourseColMgr.DestroyInstance();
    }

    static Instance(): CollisionDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8078E33C} */
    private constructor() {
        this.m_entries = [];
        for (let i = 0; i < COLLISION_ARR_LENGTH; ++i) {
            this.m_entries.push(new CollisionEntry());
        }
        this.m_collisionEntryCount = 0;
        this.m_closestCollisionEntry = null;
        CourseColMgr.CreateInstance().init();
    }
}
