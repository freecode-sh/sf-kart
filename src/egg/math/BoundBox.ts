/** Port of Kinoko's egg/math/BoundBox.hh. */

import { F32_MAX } from './Math';
import { Vector2f, Vector3f } from './Vector';

export class BoundBox2f {
    min = new Vector2f();
    max = new Vector2f();

    /** @addr{0x802145F0} */
    resetBound(): void {
        this.min.setAll(F32_MAX);
        this.max.setAll(-F32_MAX);
    }

    setDirect(vMin: Readonly<Vector2f>, vMax: Readonly<Vector2f>): void {
        this.max.copy(vMax);
        this.min.copy(vMin);
    }

    setMin(v: Readonly<Vector2f>): void {
        this.min.copy(v);
    }

    setMax(v: Readonly<Vector2f>): void {
        this.max.copy(v);
    }
}

export class BoundBox3f {
    min = new Vector3f();
    max = new Vector3f();

    resetBound(): void {
        this.min.setAll(F32_MAX);
        this.max.setAll(-F32_MAX);
    }

    setZero(): void {
        this.min.setZero();
        this.max.setZero();
    }

    setDirect(vMin: Readonly<Vector3f>, vMax: Readonly<Vector3f>): void {
        this.max.copy(vMax);
        this.min.copy(vMin);
    }

    setMin(v: Readonly<Vector3f>): void {
        this.min.copy(v);
    }

    setMax(v: Readonly<Vector3f>): void {
        this.max.copy(v);
    }
}
