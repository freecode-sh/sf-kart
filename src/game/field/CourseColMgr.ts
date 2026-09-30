/**
 * Port of Kinoko source/game/field/CourseColMgr.{hh,cc}.
 * Manager for course KCL interactions. Credit: em-eight/mkw
 */

import { box, type Box } from '../../egg/core/Box';
import { BoundBox3f } from '../../egg/math/BoundBox';
import { fr } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';
import { ArchiveId, ResourceManager } from '../system/ResourceManager';
import { CollisionDirector } from './CollisionDirector';
import { CollisionInfo, CollisionInfoPartial, KColData } from './KColData';
import { KCL_ATTRIBUTE_TYPE_BIT, KCL_SOFT_WALL_MASK, KCL_TYPE_SOLID_SURFACE } from './KCollisionTypes';
import type { KCLTypeMask } from './KCollisionTypes';

/**
 * `typedef bool (KColData::*CollisionCheckFunc)(f32 *distOut, EGG::Vector3f *fnrmOut,
 * u16 *attributeOut);` In TS, a function taking the KColData instance first.
 */
export type CollisionCheckFunc = (
    data: KColData,
    distOut: Box<number> | null,
    fnrmOut: Vector3f | null,
    attributeOut: Box<number> | null,
) => boolean;

const checkPointCollision: CollisionCheckFunc = (data, d, f, a) =>
    data.checkPointCollision(d, f, a);
const checkSphereCollision: CollisionCheckFunc = (data, d, f, a) =>
    data.checkSphereCollision(d, f, a);

export class NoBounceWallColInfo {
    bbox = new BoundBox3f();
    tangentOff = new Vector3f();
    dist = 0.0;
    fnrm = new Vector3f();
}

let s_instance: CourseColMgr | null = null; ///< @addr{0x809C3C10}

/** @addr{0x809C3C10} */
export class CourseColMgr {
    static readonly NoBounceWallColInfo = NoBounceWallColInfo;

    private m_data: KColData | null;
    private m_kclScale: number;
    private m_noBounceWallInfo: NoBounceWallColInfo | null;
    private m_localMtx: Matrix34f | null;

    /** @addr{0x807C28D8} */
    init(): void {
        // In the base game, this file is loaded in CollisionDirector::CreateInstance and passed
        // into this function. It's simpler to just keep it here.
        const file = CourseColMgr.LoadFile('course.kcl');
        if (!file) {
            throw new Error('CourseColMgr: course.kcl not found in the course archive');
        }
        this.m_data = new KColData(file);
    }

    /** @addr{0x807C293C} */
    scaledNarrowScopeLocal(
        scale: number,
        radius: number,
        data: KColData | null,
        pos: Readonly<Vector3f>,
        mask: KCLTypeMask,
    ): void {
        if (!data) {
            data = this.m_data!;
        }

        const invScale = fr(1.0 / scale);
        data.narrowScopeLocal(pos.mul(invScale), fr(radius * invScale), mask);
    }

    /** @addr{0x807C2A60} */
    checkPointPartial(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfo(data, checkPointCollision, info, maskOut);
        }

        return this.doCheckMaskOnly(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C2DA0} */
    checkPointPartialPush(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfoPush(data, checkPointCollision, info, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C30E0} */
    checkPointFull(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithFullInfo(data, checkPointCollision, info, maskOut);
        }
        return this.doCheckMaskOnly(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C3554} */
    checkPointFullPush(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithFullInfoPush(data, checkPointCollision, info, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C39C8} */
    checkSpherePartial(
        scale: number,
        radius: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphere(fr(radius * invScale), v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfo(data, checkSphereCollision, info, maskOut);
        }
        return this.doCheckMaskOnly(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C3B5C} */
    checkSpherePartialPush(
        scale: number,
        radius: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphere(fr(radius * invScale), v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfoPush(data, checkSphereCollision, info, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C3CF0} */
    checkSphereFull(
        scale: number,
        radius: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphere(fr(radius * invScale), v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithFullInfo(data, checkSphereCollision, info, maskOut);
        }
        return this.doCheckMaskOnly(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C3E84} */
    checkSphereFullPush(
        scale: number,
        radius: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphere(fr(radius * invScale), v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithFullInfoPush(data, checkSphereCollision, info, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C4018} */
    checkPointCachedPartial(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfo(data, checkPointCollision, info, maskOut);
        }
        return this.doCheckMaskOnly(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C41A4} */
    checkPointCachedPartialPush(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (info) {
            return this.doCheckWithPartialInfoPush(data, checkPointCollision, info, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C4330} */
    checkPointCachedFull(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        pInfo: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (pInfo) {
            return this.doCheckWithFullInfo(data, checkPointCollision, pInfo, maskOut);
        }
        return this.doCheckMaskOnly(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C44BC} */
    checkPointCachedFullPush(
        scale: number,
        data: KColData | null,
        v0: Readonly<Vector3f>,
        v1: Readonly<Vector3f>,
        mask: KCLTypeMask,
        pInfo: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupPoint(v0.mul(invScale), v1.mul(invScale), mask);

        if (pInfo) {
            return this.doCheckWithFullInfoPush(data, checkPointCollision, pInfo, maskOut);
        }
        return this.doCheckMaskOnlyPush(data, checkPointCollision, maskOut);
    }

    /** @addr{0x807C4648} */
    checkSphereCachedPartial(
        scale: number,
        radius: number,
        data: KColData | null,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphereCached(
            pos.mul(invScale),
            prevPos.mul(invScale),
            mask,
            fr(radius * invScale),
        );

        if (info) {
            return this.doCheckWithPartialInfo(data, checkSphereCollision, info, maskOut);
        }

        return this.doCheckMaskOnly(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C47F0} */
    checkSphereCachedPartialPush(
        scale: number,
        radius: number,
        data: KColData | null,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        info: CollisionInfoPartial | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphereCached(
            pos.mul(invScale),
            prevPos.mul(invScale),
            mask,
            fr(radius * invScale),
        );

        if (info) {
            return this.doCheckWithPartialInfoPush(data, checkSphereCollision, info, maskOut);
        }

        return this.doCheckMaskOnlyPush(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C4998} */
    checkSphereCachedFull(
        scale: number,
        radius: number,
        data: KColData | null,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        pInfo: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphereCached(
            pos.mul(invScale),
            prevPos.mul(invScale),
            mask,
            fr(radius * invScale),
        );

        if (pInfo) {
            return this.doCheckWithFullInfo(data, checkSphereCollision, pInfo, maskOut);
        }

        return this.doCheckMaskOnly(data, checkSphereCollision, maskOut);
    }

    /** @addr{0x807C4B40} */
    checkSphereCachedFullPush(
        scale: number,
        radius: number,
        data: KColData | null,
        pos: Readonly<Vector3f>,
        prevPos: Readonly<Vector3f>,
        mask: KCLTypeMask,
        colInfo: CollisionInfo | null,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        if (!data) {
            data = this.m_data!;
        }

        if (data.prismCache(0) === 0) {
            return false;
        }

        this.m_kclScale = scale;

        const invScale = fr(1.0 / scale);
        data.lookupSphereCached(
            pos.mul(invScale),
            prevPos.mul(invScale),
            mask,
            fr(radius * invScale),
        );

        if (colInfo) {
            return this.doCheckWithFullInfoPush(data, checkSphereCollision, colInfo, maskOut);
        }

        return this.doCheckMaskOnlyPush(data, checkSphereCollision, maskOut);
    }

    // Setters

    setNoBounceWallInfo(info: NoBounceWallColInfo | null): void {
        this.m_noBounceWallInfo = info;
    }

    clearNoBounceWallInfo(): void {
        this.m_noBounceWallInfo = null;
    }

    setLocalMtx(mtx: Matrix34f | null): void {
        this.m_localMtx = mtx;
    }

    // Getters

    data(): KColData | null {
        return this.m_data;
    }

    noBounceWallInfo(): NoBounceWallColInfo | null {
        return this.m_noBounceWallInfo;
    }

    /** Loads a particular section of a .szs file */
    static LoadFile(filename: string): Uint8Array | null {
        const resMgr = ResourceManager.Instance()!;
        return resMgr.getFile(filename, null, ArchiveId.Course);
    }

    /** @addr{0x807C2824} */
    static CreateInstance(): CourseColMgr {
        if (s_instance) throw new Error('CourseColMgr already exists');
        s_instance = new CourseColMgr();
        return s_instance;
    }

    /** @addr{0x807C2884} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): CourseColMgr {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x807C29E4} */
    private constructor() {
        this.m_data = null;
        this.m_kclScale = 1.0;
        this.m_noBounceWallInfo = null;
        this.m_localMtx = null;
    }

    /** Shared handling of a soft wall hit for the no-bounce wall info. */
    private updateNoBounceWallInfo(fnrmIn: Vector3f, dist: number): void {
        const info = this.m_noBounceWallInfo!;
        let fnrm: Readonly<Vector3f> = fnrmIn;
        if (this.m_localMtx) {
            fnrm = this.m_localMtx.multVector33(fnrm);
            fnrmIn.copy(fnrm);
        }
        const offset = fnrm.mul(dist);
        info.bbox.min.copy(info.bbox.min.minimize(offset));
        info.bbox.max.copy(info.bbox.max.maximize(offset));
        if (info.dist < dist) {
            info.dist = dist;
            info.fnrm.copy(fnrm);
        }
    }

    /** @addr{0x807C2BD8} */
    private doCheckWithPartialInfo(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        info: CollisionInfoPartial,
        typeMask: Box<KCLTypeMask> | null,
    ): boolean {
        const distBox = box(0.0);
        const fnrm = new Vector3f();
        const attributeBox = box(0);
        let hasCol = false;

        while (collisionCheckFunc(data, distBox, fnrm, attributeBox)) {
            hasCol = true;
            distBox.value = fr(distBox.value * this.m_kclScale);
            const dist = distBox.value;
            const attribute = attributeBox.value;

            if (this.m_noBounceWallInfo && attribute & KCL_SOFT_WALL_MASK) {
                this.updateNoBounceWallInfo(fnrm, dist);
            } else {
                const flags = KCL_ATTRIBUTE_TYPE_BIT(attribute);
                if (typeMask) {
                    typeMask.value = (typeMask.value | flags) >>> 0;
                }
                if (flags & KCL_TYPE_SOLID_SURFACE) {
                    const offset = fnrm.mul(dist);
                    info.bbox.min.copy(info.bbox.min.minimize(offset));
                    info.bbox.max.copy(info.bbox.max.maximize(offset));
                }
            }
        }

        this.m_localMtx = null;

        return hasCol;
    }

    /** @addr{0x807C2F18} */
    private doCheckWithPartialInfoPush(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        info: CollisionInfoPartial,
        typeMask: Box<KCLTypeMask> | null,
    ): boolean {
        const distBox = box(0.0);
        const fnrm = new Vector3f();
        const attributeBox = box(0);
        let hasCol = false;

        while (collisionCheckFunc(data, distBox, fnrm, attributeBox)) {
            hasCol = true;
            distBox.value = fr(distBox.value * this.m_kclScale);
            const dist = distBox.value;
            const attribute = attributeBox.value;

            if (!this.m_noBounceWallInfo || !(attribute & KCL_SOFT_WALL_MASK)) {
                const flags = KCL_ATTRIBUTE_TYPE_BIT(attribute);
                if (typeMask) {
                    CollisionDirector.Instance()!.pushCollisionEntry(
                        dist,
                        typeMask,
                        flags,
                        attribute,
                    );
                }
                if (flags & KCL_TYPE_SOLID_SURFACE) {
                    const offset = fnrm.mul(dist);
                    info.bbox.min.copy(info.bbox.min.minimize(offset));
                    info.bbox.max.copy(info.bbox.max.maximize(offset));
                }
            } else {
                this.updateNoBounceWallInfo(fnrm, dist);
            }
        }

        this.m_localMtx = null;

        return hasCol;
    }

    /** @addr{0x807C3258} */
    private doCheckWithFullInfo(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        colInfo: CollisionInfo,
        flagsOut: Box<KCLTypeMask> | null,
    ): boolean {
        const distBox = box(0.0);
        const fnrm = new Vector3f();
        const attributeBox = box(0);
        let hasCol = false;

        while (collisionCheckFunc(data, distBox, fnrm, attributeBox)) {
            distBox.value = fr(distBox.value * this.m_kclScale);
            const dist = distBox.value;
            const attribute = attributeBox.value;

            if (this.m_noBounceWallInfo && attribute & KCL_SOFT_WALL_MASK) {
                this.updateNoBounceWallInfo(fnrm, dist);
            } else {
                const kclAttributeTypeBit = KCL_ATTRIBUTE_TYPE_BIT(attribute);
                if (flagsOut) {
                    flagsOut.value = (flagsOut.value | kclAttributeTypeBit) >>> 0;
                }
                if (kclAttributeTypeBit & KCL_TYPE_SOLID_SURFACE) {
                    colInfo.update(dist, fnrm.mul(dist), fnrm, kclAttributeTypeBit);
                }
            }

            hasCol = true;
        }

        this.m_localMtx = null;

        return hasCol;
    }

    /** @addr{0x807C36CC} */
    private doCheckWithFullInfoPush(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        colInfo: CollisionInfo,
        flagsOut: Box<KCLTypeMask> | null,
    ): boolean {
        const distBox = box(0.0);
        const fnrm = new Vector3f();
        const attributeBox = box(0);
        let hasCol = false;

        while (collisionCheckFunc(data, distBox, fnrm, attributeBox)) {
            distBox.value = fr(distBox.value * this.m_kclScale);
            const dist = distBox.value;
            const attribute = attributeBox.value;

            if (this.m_noBounceWallInfo && attribute & KCL_SOFT_WALL_MASK) {
                this.updateNoBounceWallInfo(fnrm, dist);
            } else {
                const kclAttributeTypeBit = KCL_ATTRIBUTE_TYPE_BIT(attribute);
                if (flagsOut) {
                    CollisionDirector.Instance()!.pushCollisionEntry(
                        dist,
                        flagsOut,
                        kclAttributeTypeBit,
                        attribute,
                    );
                }
                if (kclAttributeTypeBit & KCL_TYPE_SOLID_SURFACE) {
                    colInfo.update(dist, fnrm.mul(dist), fnrm, kclAttributeTypeBit);
                }
            }

            hasCol = true;
        }

        this.m_localMtx = null;

        return hasCol;
    }

    private doCheckMaskOnly(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        let hasCol = false;
        const distBox = box(0.0);
        const attributeBox = box(0);

        while (collisionCheckFunc(data, distBox, null, attributeBox)) {
            const attribute = attributeBox.value;
            if ((!this.m_noBounceWallInfo || !(attribute & KCL_SOFT_WALL_MASK)) && maskOut) {
                maskOut.value = (maskOut.value | KCL_ATTRIBUTE_TYPE_BIT(attribute)) >>> 0;
            }
            hasCol = true;
        }

        return hasCol;
    }

    private doCheckMaskOnlyPush(
        data: KColData,
        collisionCheckFunc: CollisionCheckFunc,
        maskOut: Box<KCLTypeMask> | null,
    ): boolean {
        let hasCol = false;
        const distBox = box(0.0);
        const attributeBox = box(0);

        while (collisionCheckFunc(data, distBox, null, attributeBox)) {
            const attribute = attributeBox.value;
            if ((!this.m_noBounceWallInfo || !(attribute & KCL_SOFT_WALL_MASK)) && maskOut) {
                CollisionDirector.Instance()!.pushCollisionEntry(
                    distBox.value,
                    maskOut,
                    KCL_ATTRIBUTE_TYPE_BIT(attribute),
                    attribute,
                );
            }
            hasCol = true;
        }

        return hasCol;
    }
}
