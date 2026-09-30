/**
 * Port of Kinoko source/game/field/ObjectDrivableDirector.{hh,cc}.
 *
 * Faithful control flow; with no drivable objects on our course, m_objects is empty and every
 * query returns early. The rGV2 ObakeManager is not ported.
 */

import type { Box } from '../../egg/core/Box';
import type { Vector3f } from '../../egg/math/Vector';
import type { MapdataGeoObj } from '../system/map/MapdataGeoObj';
import { BoxColFlag, BoxColManager, eBoxColFlag } from './BoxColManager';
import type { CollisionInfo, CollisionInfoPartial } from './KColData';
import type { KCLTypeMask } from './KCollisionTypes';
import type { ObjectDrivable } from './obj/ObjectDrivable';

let s_instance: ObjectDrivableDirector | null = null; ///< @addr{0x809C4310}

const MAX_OBJECTS = 400;

export class ObjectDrivableDirector {
    /** All objects live here */
    private m_objects: ObjectDrivable[] = [];
    /** Objects needing calc() live here too. */
    private m_calcObjects: ObjectDrivable[] = [];
    /** Manages rGV2 blocks and spatial indexing (not ported). */
    private m_obakeManager: unknown = null;

    /** @addr{0x8081B500} */
    init(): void {
        for (const obj of this.m_objects) {
            obj.init();
            obj.calcModel();
        }
    }

    /** @addr{0x8081B618} */
    calc(): void {
        for (const obj of this.m_calcObjects) {
            obj.calc();
        }

        for (const obj of this.m_calcObjects) {
            obj.calcModel();
        }
    }

    /** @addr{0x8081B6C8} */
    addObject(obj: ObjectDrivable): void {
        if (this.m_objects.length >= MAX_OBJECTS) {
            throw new Error('ObjectDrivableDirector: too many objects');
        }

        if (obj.loadFlags() & 1) {
            this.m_calcObjects.push(obj);
        }

        this.m_objects.push(obj);
    }

    /** Creates the rGV2 block manager. Not ported (course objects are unsupported). */
    createObakeManager(_params: MapdataGeoObj): void {
        throw new Error('ObjectDrivableDirector::createObakeManager is not ported');
    }

    /** @addr{0x8081BC98} */
    checkSpherePartial(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        let hasCollision = false;
        const boxColMgr = BoxColManager.Instance()!;
        boxColMgr.search(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable));

        for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
            const res = obj.checkSpherePartial(radius, pos, prevPos, mask, info, maskOut, timeOffset);
            hasCollision = hasCollision || res;
        }

        return hasCollision;
    }

    /** @addr{0x8081BD70} */
    checkSpherePartialPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        let hasCollision = false;
        const boxColMgr = BoxColManager.Instance()!;
        boxColMgr.search(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable));

        for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
            const res = obj.checkSpherePartialPush(
                radius,
                pos,
                prevPos,
                mask,
                info,
                maskOut,
                timeOffset,
            );
            hasCollision = hasCollision || res;
        }

        return hasCollision;
    }

    /** @addr{0x8081BE48} */
    checkSphereFull(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        let hasCollision = false;
        const boxColMgr = BoxColManager.Instance()!;
        boxColMgr.search(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable));

        for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
            const res = obj.checkSphereFull(radius, pos, prevPos, mask, info, maskOut, timeOffset);
            hasCollision = hasCollision || res;
        }

        return hasCollision;
    }

    /** @addr{0x8081BFA0} */
    checkSphereFullPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        let hasCollision = false;
        const boxColMgr = BoxColManager.Instance()!;
        boxColMgr.search(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable));

        for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
            const res = obj.checkSphereFullPush(
                radius,
                pos,
                prevPos,
                mask,
                info,
                maskOut,
                timeOffset,
            );
            hasCollision = hasCollision || res;
        }

        return hasCollision;
    }

    /** @addr{0x8081C5A0} */
    checkSphereCachedPartial(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        const boxColMgr = BoxColManager.Instance()!;

        if (boxColMgr.isSphereInSpatialCache(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable))) {
            boxColMgr.resetIterators();

            let hasCollision = false;
            for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
                const res = obj.checkSphereCachedPartial(
                    radius,
                    pos,
                    prevPos,
                    mask,
                    info,
                    maskOut,
                    timeOffset,
                );
                hasCollision = hasCollision || res;
            }

            return hasCollision;
        }

        return this.checkSpherePartial(radius, pos, prevPos, mask, info, maskOut, timeOffset);
    }

    /** @addr{0x8081C6B4} */
    checkSphereCachedPartialPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        const boxColMgr = BoxColManager.Instance()!;

        if (boxColMgr.isSphereInSpatialCache(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable))) {
            boxColMgr.resetIterators();

            let hasCollision = false;
            for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
                const res = obj.checkSphereCachedPartialPush(
                    radius,
                    pos,
                    prevPos,
                    mask,
                    info,
                    maskOut,
                    timeOffset,
                );
                hasCollision = hasCollision || res;
            }

            return hasCollision;
        }

        return this.checkSpherePartialPush(radius, pos, prevPos, mask, info, maskOut, timeOffset);
    }

    /** @addr{0x8081C958} */
    checkSphereCachedFullPush(
        radius: number,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
        timeOffset: number,
    ): boolean {
        if (this.m_objects.length === 0) {
            return false;
        }

        const boxColMgr = BoxColManager.Instance()!;

        if (boxColMgr.isSphereInSpatialCache(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable))) {
            let hasCollision = false;
            boxColMgr.resetIterators();

            for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
                const res = obj.checkSphereCachedFullPush(
                    radius,
                    pos,
                    prevPos,
                    mask,
                    info,
                    maskOut,
                    timeOffset,
                );
                hasCollision = hasCollision || res;
            }

            return hasCollision;
        }

        return this.checkSphereFullPush(radius, pos, prevPos, mask, info, maskOut, timeOffset);
    }

    /** @addr{0x8081B7CC} */
    colNarScLocal(
        radius: number,
        pos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        timeOffset: number,
    ): void {
        if (this.m_objects.length === 0) {
            return;
        }

        const boxColMgr = BoxColManager.Instance()!;
        boxColMgr.search(radius, pos, BoxColFlag.FromBit(eBoxColFlag.Drivable));

        for (let obj = boxColMgr.getNextDrivable(); obj; obj = boxColMgr.getNextDrivable()) {
            obj.narrScLocal(radius, pos, mask, timeOffset);
        }
    }

    obakeManager(): unknown {
        return this.m_obakeManager;
    }

    /** @addr{0x8081B428} */
    static CreateInstance(): ObjectDrivableDirector {
        if (s_instance) throw new Error('ObjectDrivableDirector already exists');
        s_instance = new ObjectDrivableDirector();
        return s_instance;
    }

    /** @addr{0x8081B4B0} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): ObjectDrivableDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8081B324} */
    private constructor() {}
}
