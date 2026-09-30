/** Port of Kinoko's egg/geom/Sphere.hh. */

import { fr } from '../math/Math';
import { Vector3f } from '../math/Vector';

export class Sphere3f {
    pos: Vector3f;
    radius: number;

    constructor(v: Readonly<Vector3f>, r: number) {
        this.pos = v.clone();
        this.radius = r;
    }

    /** @addr{0x8051A07C} @return True if this sphere is completely inside rhs. */
    isInsideOtherSphere(rhs: Readonly<Sphere3f>): boolean {
        const radiusDiff = fr(rhs.radius - this.radius);
        if (radiusDiff < 0.0) {
            return false;
        }
        return rhs.pos.ps_sqDistance(this.pos) < fr(radiusDiff * radiusDiff);
    }
}
