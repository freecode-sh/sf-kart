/** Port of Kinoko's egg/geom/Plane.hh. Represents n.dot(x) = d for point x on the plane. */

import { fr } from '../math/Math';
import { Vector3f } from '../math/Vector';

export class Plane3f {
    n = new Vector3f();
    d = 0.0;

    /** @addr{0x805AEF6C} */
    static fromPointNormal(point: Readonly<Vector3f>, normal: Readonly<Vector3f>): Plane3f {
        const p = new Plane3f();
        p.set(point, normal);
        return p;
    }

    /** @addr{0x805AF048} */
    set(point: Readonly<Vector3f>, normal: Readonly<Vector3f>): void {
        this.n.copy(normal);
        this.d = -normal.dot(point);
    }

    /** @addr{0x805AF0F0} */
    testPoint(point: Readonly<Vector3f>): boolean {
        return fr(this.d + this.n.dot(point)) <= 0.0;
    }
}
