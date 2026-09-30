/**
 * Port of Kinoko's egg/math/Vector.hh.
 *
 * Vectors are mutable objects, but C++ treats them as VALUE types. Conventions:
 *  - Non-mutating operations (add, sub, mul, ...) return new vectors.
 *  - Mutating operations are explicit and end in `Eq` (addEq, mulEq, ...) or are named after the
 *    C++ in-place method (normalise, normalise2, setZero, ...).
 *  - `copy(v)` implements C++ assignment `a = v` in-place; `clone()` implements copy-construction.
 *  - Static constants (Vector3f.zero, ...) are frozen; never mutate them.
 */

import { F32_EPSILON, fma, fr, frsqrt, sqrt } from './Math';

export class Vector2f {
    x: number;
    y: number;

    constructor(x = 0.0, y = 0.0) {
        this.x = x;
        this.y = y;
    }

    clone(): Vector2f {
        return new Vector2f(this.x, this.y);
    }

    copy(rhs: Vector2f): this {
        this.x = rhs.x;
        this.y = rhs.y;
        return this;
    }

    setAll(val: number): void {
        this.x = this.y = val;
    }

    set(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    neg(): Vector2f {
        return new Vector2f(-this.x, -this.y);
    }

    sub(rhs: Vector2f): Vector2f {
        return new Vector2f(fr(this.x - rhs.x), fr(this.y - rhs.y));
    }

    add(rhs: Vector2f): Vector2f {
        return new Vector2f(fr(this.x + rhs.x), fr(this.y + rhs.y));
    }

    addEq(rhs: Vector2f): this {
        this.x = fr(this.x + rhs.x);
        this.y = fr(this.y + rhs.y);
        return this;
    }

    mul(scalar: number): Vector2f {
        return new Vector2f(fr(this.x * scalar), fr(this.y * scalar));
    }

    mulEq(scalar: number): this {
        this.x = fr(this.x * scalar);
        this.y = fr(this.y * scalar);
        return this;
    }

    cross(rhs: Vector2f): number {
        return fr(fr(this.x * rhs.y) - fr(this.y * rhs.x));
    }

    dot(rhs: Vector2f = this): number {
        return fr(fr(this.x * rhs.x) + fr(this.y * rhs.y));
    }

    length(): number {
        return this.dot() > F32_EPSILON ? sqrt(this.dot()) : 0.0;
    }

    /** @addr{0x80243A00} */
    normalise(): number {
        const len = this.length();
        if (len !== 0.0) {
            const inv = fr(1.0 / len);
            this.mulEq(inv);
        }
        return len;
    }

    /** @addr{0x80243A78} */
    normalise2(): void {
        const sqLen = this.dot();
        if (sqLen > F32_EPSILON) {
            this.mulEq(frsqrt(sqLen));
        }
    }

    static readonly zero: Readonly<Vector2f> = Object.freeze(new Vector2f(0.0, 0.0));
    static readonly ex: Readonly<Vector2f> = Object.freeze(new Vector2f(1.0, 0.0));
    static readonly ey: Readonly<Vector2f> = Object.freeze(new Vector2f(0.0, 1.0));
}

export class Vector3f {
    x: number;
    y: number;
    z: number;

    constructor(x = 0.0, y = 0.0, z = 0.0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    clone(): Vector3f {
        return new Vector3f(this.x, this.y, this.z);
    }

    /** C++ assignment operator: `*this = rhs`. */
    copy(rhs: Readonly<Vector3f>): this {
        this.x = rhs.x;
        this.y = rhs.y;
        this.z = rhs.z;
        return this;
    }

    set(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    setZero(): void {
        this.setAll(0.0);
    }

    /** C++ `set(f32 val)`: sets all components. */
    setAll(val: number): void {
        this.x = this.y = this.z = val;
    }

    neg(): Vector3f {
        return new Vector3f(-this.x, -this.y, -this.z);
    }

    sub(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(fr(this.x - rhs.x), fr(this.y - rhs.y), fr(this.z - rhs.z));
    }

    subEq(rhs: Readonly<Vector3f>): this {
        this.x = fr(this.x - rhs.x);
        this.y = fr(this.y - rhs.y);
        this.z = fr(this.z - rhs.z);
        return this;
    }

    add(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(fr(this.x + rhs.x), fr(this.y + rhs.y), fr(this.z + rhs.z));
    }

    addEq(rhs: Readonly<Vector3f>): this {
        this.x = fr(this.x + rhs.x);
        this.y = fr(this.y + rhs.y);
        this.z = fr(this.z + rhs.z);
        return this;
    }

    /** C++ `operator+(f32)` */
    addScalar(val: number): Vector3f {
        return new Vector3f(fr(this.x + val), fr(this.y + val), fr(this.z + val));
    }

    addScalarEq(val: number): this {
        this.x = fr(this.x + val);
        this.y = fr(this.y + val);
        this.z = fr(this.z + val);
        return this;
    }

    /** C++ `operator*(const Vector3f &)`: component-wise multiply. */
    mulV(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(fr(this.x * rhs.x), fr(this.y * rhs.y), fr(this.z * rhs.z));
    }

    /** C++ `operator*(f32)` and `operator*(f32, const Vector3f &)`. */
    mul(scalar: number): Vector3f {
        return new Vector3f(fr(this.x * scalar), fr(this.y * scalar), fr(this.z * scalar));
    }

    mulEq(scalar: number): this {
        this.x = fr(this.x * scalar);
        this.y = fr(this.y * scalar);
        this.z = fr(this.z * scalar);
        return this;
    }

    div(scalar: number): Vector3f {
        return new Vector3f(fr(this.x / scalar), fr(this.y / scalar), fr(this.z / scalar));
    }

    divEq(scalar: number): this {
        this.x = fr(this.x / scalar);
        this.y = fr(this.y / scalar);
        this.z = fr(this.z / scalar);
        return this;
    }

    equals(rhs: Readonly<Vector3f>): boolean {
        return this.x === rhs.x && this.y === rhs.y && this.z === rhs.z;
    }

    /** @addr{0x80214968} */
    cross(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(
            fr(fr(this.y * rhs.z) - fr(this.z * rhs.y)),
            fr(fr(this.z * rhs.x) - fr(this.x * rhs.z)),
            fr(fr(this.x * rhs.y) - fr(this.y * rhs.x)),
        );
    }

    /** The dot product between the vector and itself. */
    squaredLength(): number {
        return fr(fr(fr(this.x * this.x) + fr(this.y * this.y)) + fr(this.z * this.z));
    }

    /** The dot product between two vectors. */
    dot(rhs: Readonly<Vector3f>): number {
        return fr(fr(fr(this.x * rhs.x) + fr(this.y * rhs.y)) + fr(this.z * rhs.z));
    }

    length(): number {
        return sqrt(this.squaredLength());
    }

    /** @addr{0x8019AC68} */
    ps_length(): number {
        const d = fma(this.z, this.z, fr(fr(this.x * this.x) + fr(this.y * this.y)));
        return d === 0.0 ? 0.0 : sqrt(d);
    }

    /** @addr{0x805AEB88} The projection of this vector onto rhs. */
    proj(rhs: Readonly<Vector3f>): Vector3f {
        return rhs.mul(rhs.dot(this));
    }

    /** @addr{0x805AEBD0} The rejection of this vector onto rhs. */
    rej(rhs: Readonly<Vector3f>): Vector3f {
        return this.sub(this.proj(rhs));
    }

    /** @addr{0x805AEC24} */
    projAndRej(rhs: Readonly<Vector3f>): [Vector3f, Vector3f] {
        return [this.proj(rhs), this.rej(rhs)];
    }

    abs(): Vector3f {
        return new Vector3f(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z));
    }

    sqDistance(rhs: Readonly<Vector3f>): number {
        return this.sub(rhs).squaredLength();
    }

    /** @addr{0x806A62A4} Multiplies a vector by the inverse of val. */
    multInv(val: number): Vector3f {
        return this.mul(fr(1.0 / val));
    }

    /** @addr{0x8019ACAC} Paired-singles dot product implementation. */
    ps_dot(rhs: Readonly<Vector3f> = this): number {
        const y_ = fr(this.y * rhs.y);
        const xy = fma(this.x, rhs.x, y_);
        return fr(xy + fr(this.z * rhs.z));
    }

    /** Differs from ps_dot due to variation in which operands are fused. */
    ps_squareMag(): number {
        const x_ = fr(this.x * this.x);
        const zx = fma(this.z, this.z, x_);
        return fr(zx + fr(this.y * this.y));
    }

    /** @addr{0x80243ADC} Normalizes the vector and returns the original length. */
    normalise(): number {
        let len = 0.0;
        if (this.squaredLength() > F32_EPSILON) {
            len = this.length();
            this.mulEq(fr(1.0 / len));
        }
        return len;
    }

    /** @addr{0x8019AC24} */
    ps_normalize(): Vector3f {
        const d = fr(fma(this.z, this.z, fr(this.x * this.x)) + fr(this.y * this.y));
        return this.mul(frsqrt(d));
    }

    /** @addr{0x80793F04} Returns [magnitude, normalized vector]. */
    ps_normalized(): [number, Vector3f] {
        const mag = this.ps_length();
        if (mag <= 0.0) {
            return [mag, new Vector3f(0.0, 0.0, 0.0)];
        }
        return [mag, this.mul(fr(1.0 / mag))];
    }

    /** @addr{0x80243B6C} */
    normalise2(): void {
        const sqLen = this.squaredLength();
        if (sqLen > F32_EPSILON) {
            this.mulEq(frsqrt(sqLen));
        }
    }

    /** @addr{0x80085580} */
    maximize(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(
            this.x > rhs.x ? this.x : rhs.x,
            this.y > rhs.y ? this.y : rhs.y,
            this.z > rhs.z ? this.z : rhs.z,
        );
    }

    /** @addr{0x800855C0} */
    minimize(rhs: Readonly<Vector3f>): Vector3f {
        return new Vector3f(
            this.x < rhs.x ? this.x : rhs.x,
            this.y < rhs.y ? this.y : rhs.y,
            this.z < rhs.z ? this.z : rhs.z,
        );
    }

    /** @addr{0x8019ADE0} */
    ps_sqDistance(rhs: Readonly<Vector3f>): number {
        return this.sub(rhs).ps_dot();
    }

    /** @addr{0x805AE9EC} */
    perpInPlane(rhs: Readonly<Vector3f>, normalise: boolean): Vector3f {
        if (Math.abs(this.dot(rhs)) === 1.0) {
            return new Vector3f(0.0, 0.0, 0.0);
        }

        const x = this.x;
        const y = this.y;
        const z = this.z;
        const _x = fr(
            fr(fr(fr(rhs.z * x) - fr(rhs.x * z)) * rhs.z) -
                fr(fr(fr(rhs.x * y) - fr(rhs.y * x)) * rhs.y),
        );
        const _y = fr(
            fr(fr(fr(rhs.x * y) - fr(rhs.y * x)) * rhs.x) -
                fr(fr(fr(rhs.y * z) - fr(rhs.z * y)) * rhs.z),
        );
        const _z = fr(
            fr(fr(fr(rhs.y * z) - fr(rhs.z * y)) * rhs.y) -
                fr(fr(fr(rhs.z * x) - fr(rhs.x * z)) * rhs.x),
        );

        const ret = new Vector3f(_x, _y, _z);
        if (normalise) {
            ret.normalise();
        }
        return ret;
    }

    toString(): string {
        return `[${this.x}, ${this.y}, ${this.z}]`;
    }

    static readonly zero: Readonly<Vector3f> = Object.freeze(new Vector3f(0.0, 0.0, 0.0));
    static readonly unit: Readonly<Vector3f> = Object.freeze(new Vector3f(1.0, 1.0, 1.0));
    static readonly ex: Readonly<Vector3f> = Object.freeze(new Vector3f(1.0, 0.0, 0.0));
    static readonly ey: Readonly<Vector3f> = Object.freeze(new Vector3f(0.0, 1.0, 0.0));
    static readonly ez: Readonly<Vector3f> = Object.freeze(new Vector3f(0.0, 0.0, 1.0));
    static readonly inf: Readonly<Vector3f> = Object.freeze(
        new Vector3f(Infinity, Infinity, Infinity),
    );
}
