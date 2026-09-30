/**
 * Minimal port of Kinoko source/game/field/obj/ObjectDrivable.hh (interface only; no drivable
 * objects are present on our course).
 */

import type { Box } from '../../../egg/core/Box';
import type { Vector3f } from '../../../egg/math/Vector';
import type { CollisionInfo, CollisionInfoPartial } from '../KColData';
import type { KCLTypeMask } from '../KCollisionTypes';
import { ObjectBase } from './ObjectBase';

type V = Readonly<Vector3f>;
type M = Box<KCLTypeMask> | null;

export abstract class ObjectDrivable extends ObjectBase {
    initCollision(): void {}

    checkSpherePartial(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfoPartial | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSpherePartialPush(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfoPartial | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSphereFull(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfo | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSphereFullPush(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfo | null, _o: M, _t: number): boolean {
        return false;
    }
    narrScLocal(_radius: number, _pos: V, _mask: KCLTypeMask, _timeOffset: number): void {}
    checkSphereCachedPartial(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfoPartial | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSphereCachedPartialPush(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfoPartial | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSphereCachedFull(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfo | null, _o: M, _t: number): boolean {
        return false;
    }
    checkSphereCachedFullPush(_r: number, _p: V, _pp: V, _m: KCLTypeMask, _i: CollisionInfo | null, _o: M, _t: number): boolean {
        return false;
    }
}
