/** Port of Kinoko source/game/field/obj/ObjectNoImpl.{hh,cc}. */

import type { MapdataGeoObj } from '../../system/map/MapdataGeoObj';
import { ObjectDirector } from '../ObjectDirector';
import { ObjectBase } from './ObjectBase';

export class ObjectNoImpl extends ObjectBase {
    constructor(params: MapdataGeoObj) {
        super(params);
    }

    load(): void {
        ObjectDirector.Instance()!.addObjectNoImpl(this);
    }

    createCollision(): void {}
    calcCollisionTransform(): void {}
}
