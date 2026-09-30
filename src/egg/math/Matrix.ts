/** Port of Kinoko's egg/math/Matrix.hh. Same value-type conventions as Vector3f. */

import { asin, atan2, cos, finv, fma, fms, fr, HALF_PI, sin } from './Math';
import { Quatf } from './Quat';
import { Vector3f } from './Vector';

/** A 3 x 4 row-major matrix. Element (row, col) lives at index row * 4 + col. */
export class Matrix34f {
    readonly a: number[];

    constructor(
        e00 = 0.0,
        e01 = 0.0,
        e02 = 0.0,
        e03 = 0.0,
        e10 = 0.0,
        e11 = 0.0,
        e12 = 0.0,
        e13 = 0.0,
        e20 = 0.0,
        e21 = 0.0,
        e22 = 0.0,
        e23 = 0.0,
    ) {
        this.a = [e00, e01, e02, e03, e10, e11, e12, e13, e20, e21, e22, e23];
    }

    clone(): Matrix34f {
        const m = new Matrix34f();
        for (let i = 0; i < 12; ++i) m.a[i] = this.a[i]!;
        return m;
    }

    /** C++ assignment operator. */
    copy(rhs: Readonly<Matrix34f>): this {
        for (let i = 0; i < 12; ++i) this.a[i] = rhs.a[i]!;
        return this;
    }

    equals(rhs: Readonly<Matrix34f>): boolean {
        for (let i = 0; i < 12; ++i) if (this.a[i] !== rhs.a[i]) return false;
        return true;
    }

    /** C++ `operator[](row, col)` read. */
    get(row: number, col: number): number {
        return this.a[row * 4 + col]!;
    }

    /** C++ `operator[](row, col)` write. */
    set(row: number, col: number, val: number): void {
        this.a[row * 4 + col] = val;
    }

    /** @addr{0x80230118} Sets matrix from rotation and position. */
    makeQT(q: Readonly<Quatf>, t: Readonly<Vector3f>): void {
        this.makeQ(q);
        this.a[3] = t.x;
        this.a[7] = t.y;
        this.a[11] = t.z;
    }

    /** @addr{0x8023030C} Sets rotation matrix from quaternion. */
    makeQ(q: Readonly<Quatf>): void {
        const yy = fr(fr(2.0 * q.v.y) * q.v.y);
        const zz = fr(fr(2.0 * q.v.z) * q.v.z);
        const xx = fr(fr(2.0 * q.v.x) * q.v.x);
        const xy = fr(fr(2.0 * q.v.x) * q.v.y);
        const xz = fr(fr(2.0 * q.v.x) * q.v.z);
        const yz = fr(fr(2.0 * q.v.y) * q.v.z);
        const wz = fr(fr(2.0 * q.w) * q.v.z);
        const wx = fr(fr(2.0 * q.w) * q.v.x);
        const wy = fr(fr(2.0 * q.w) * q.v.y);

        const a = this.a;
        a[0] = fr(fr(1.0 - yy) - zz);
        a[1] = fr(xy - wz);
        a[2] = fr(xz + wy);

        a[4] = fr(xy + wz);
        a[5] = fr(fr(1.0 - xx) - zz);
        a[6] = fr(yz - wx);

        a[8] = fr(xz - wy);
        a[9] = fr(yz + wx);
        a[10] = fr(fr(1.0 - xx) - yy);

        a[3] = 0.0;
        a[7] = 0.0;
        a[11] = 0.0;
    }

    /** @addr{0x8022FE14} Sets rotation-translation matrix. */
    makeRT(r: Readonly<Vector3f>, t: Readonly<Vector3f>): void {
        this.makeR(r);
        this.a[3] = t.x;
        this.a[7] = t.y;
        this.a[11] = t.z;
    }

    /** @addr{0x8022FF98} Sets 3x3 rotation matrix from a vector of Euler angles. */
    makeR(r: Readonly<Vector3f>): void {
        const s = new Vector3f(sin(r.x), sin(r.y), sin(r.z));
        const c = new Vector3f(cos(r.x), cos(r.y), cos(r.z));

        const c0_c2 = fr(c.x * c.z);
        const s0_s1 = fr(s.x * s.y);
        const c0_s2 = fr(c.x * s.z);

        const a = this.a;
        a[0] = fr(c.y * c.z);
        a[4] = fr(c.y * s.z);
        a[8] = -s.y;

        a[1] = fr(fr(s0_s1 * c.z) - c0_s2);
        a[5] = fr(fr(s0_s1 * s.z) + c0_c2);
        a[9] = fr(s.x * c.y);

        a[2] = fr(fr(c0_c2 * s.y) + fr(s.x * s.z));
        a[6] = fr(fr(c0_s2 * s.y) - fr(s.x * c.z));
        a[10] = fr(c.x * c.y);

        a[3] = 0.0;
        a[7] = 0.0;
        a[11] = 0.0;
    }

    /** @addr{0x80230280} */
    makeS(s: Readonly<Vector3f>): void {
        this.makeZero();
        this.a[0] = s.x;
        this.a[5] = s.y;
        this.a[10] = s.z;
    }

    /** @addr{0x802302C4} */
    makeT(t: Readonly<Vector3f>): void {
        const a = this.a;
        a[0] = 1.0;
        a[1] = 0.0;
        a[2] = 0.0;
        a[4] = 0.0;
        a[5] = 1.0;
        a[6] = 0.0;
        a[8] = 0.0;
        a[9] = 0.0;
        a[10] = 1.0;
        a[3] = t.x;
        a[7] = t.y;
        a[11] = t.z;
    }

    makeZero(): void {
        for (let i = 0; i < 12; ++i) this.a[i] = 0.0;
    }

    /** @addr{0x805AE7B4} Sets a 3x3 orthonormal basis for a local coordinate system. */
    makeOrthonormalBasis(forward: Readonly<Vector3f>, up: Readonly<Vector3f>): void {
        const x = up.cross(forward);
        x.normalise();
        const y = forward.cross(x);
        y.normalise();

        this.setBase(0, x);
        this.setBase(1, y);
        this.setBase(2, forward);
    }

    /** @addr{0x80537740} Arguments are taken by value. */
    makeOrthonormalBasisLocal(forwardIn: Readonly<Vector3f>, upIn: Readonly<Vector3f>): void {
        const forward = forwardIn.clone();
        forward.normalise2();
        const right = upIn.cross(forward);
        right.normalise2();
        const up = forward.cross(right);

        this.setBase(3, Vector3f.zero);
        this.setBase(0, right);
        this.setBase(1, up);
        this.setBase(2, forward);
    }

    /** @addr{0x802303BC} Rotates the matrix about an axis. */
    setAxisRotation(angle: number, axis: Readonly<Vector3f>): void {
        const q = new Quatf();
        q.setAxisRotation(angle, axis);
        this.makeQ(q);
    }

    /** Multiplies one row of a 3x3 matrix by a vector. */
    mulRow33(rowIdx: number, row: Readonly<Vector3f>): void {
        const a = this.a;
        a[rowIdx * 4] = fr(a[rowIdx * 4]! * row.x);
        a[rowIdx * 4 + 1] = fr(a[rowIdx * 4 + 1]! * row.y);
        a[rowIdx * 4 + 2] = fr(a[rowIdx * 4 + 2]! * row.z);
    }

    /** Sets one column of a matrix. */
    setBase(col: number, base: Readonly<Vector3f>): void {
        this.a[col] = base.x;
        this.a[4 + col] = base.y;
        this.a[8 + col] = base.z;
    }

    /** @addr{0x80230410} @addr{0x80199D64} Multiplies two matrices. */
    multiplyTo(rhs: Readonly<Matrix34f>): Matrix34f {
        const m = (r: number, c: number) => this.a[r * 4 + c]!;
        const R = (r: number, c: number) => rhs.a[r * 4 + c]!;
        const mat = new Matrix34f();
        const o = mat.a;

        for (let row = 0; row < 3; ++row) {
            for (let col = 0; col < 3; ++col) {
                o[row * 4 + col] = fma(
                    R(2, col),
                    m(row, 2),
                    fma(R(1, col), m(row, 1), fr(R(0, col) * m(row, 0))),
                );
            }
            o[row * 4 + 3] = fma(
                1.0,
                m(row, 3),
                fma(R(2, 3), m(row, 2), fma(R(1, 3), m(row, 1), fr(R(0, 3) * m(row, 0)))),
            );
        }

        return mat;
    }

    /** Multiplies a vector by a matrix. */
    multVector(vec: Readonly<Vector3f>): Vector3f {
        const a = this.a;
        const row = (r: number) =>
            fr(
                fr(fr(fr(a[r * 4]! * vec.x) + a[r * 4 + 3]!) + fr(a[r * 4 + 1]! * vec.y)) +
                    fr(a[r * 4 + 2]! * vec.z),
            );
        return new Vector3f(row(0), row(1), row(2));
    }

    /** @addr{0x802303F8} Paired-singles impl. of multVector. */
    ps_multVector(vec: Readonly<Vector3f>): Vector3f {
        const a = this.a;
        const row = (r: number) =>
            fr(
                fma(a[r * 4 + 2]!, vec.z, fr(a[r * 4]! * vec.x)) +
                    fma(a[r * 4 + 3]!, 1.0, fr(a[r * 4 + 1]! * vec.y)),
            );
        return new Vector3f(row(0), row(1), row(2));
    }

    /** @addr{0x8059A4F8} Multiplies a 3x3 matrix by a vector. */
    multVector33(vec: Readonly<Vector3f>): Vector3f {
        const a = this.a;
        const row = (r: number) =>
            fr(fr(a[r * 4 + 2]! * vec.z) + fr(fr(a[r * 4]! * vec.x) + fr(a[r * 4 + 1]! * vec.y)));
        return new Vector3f(row(0), row(1), row(2));
    }

    /** @addr{0x8067EAEC} @addr{0x8022FB04} */
    calcRPY(): Vector3f {
        const GIMBAL_LOCK_THRESHOLD = fr(0.999999);

        const xAxisBasis = this.base(0);
        const absZ = Math.abs(xAxisBasis.z);

        if (absZ > GIMBAL_LOCK_THRESHOLD) {
            const y = fr(fr(xAxisBasis.z / absZ) * -HALF_PI);
            const z = atan2(-this.get(0, 1), fr(-xAxisBasis.z * this.get(0, 2)));
            return new Vector3f(0.0, y, z);
        }

        const x = atan2(this.get(2, 1), this.get(2, 2));
        const y = asin(-xAxisBasis.z);
        const z = atan2(xAxisBasis.y, xAxisBasis.x);

        return new Vector3f(x, y, z);
    }

    /** @addr{0x8019A970} Paired-singles impl. of multVector33. */
    ps_multVector33(vec: Readonly<Vector3f>): Vector3f {
        const a = this.a;
        const row = (r: number) =>
            fma(a[r * 4 + 2]!, vec.z, fr(fr(a[r * 4]! * vec.x) + fr(a[r * 4 + 1]! * vec.y)));
        return new Vector3f(row(0), row(1), row(2));
    }

    /**
     * @addr{0x8022F90C} Inverts the 3x3 portion of the 3x4 matrix.
     * If the determinant is 0, then this function returns the identity matrix.
     */
    inverseTo33(out: Matrix34f): void {
        const m = (r: number, c: number) => this.a[r * 4 + c]!;

        const determinant = fr(
            fr(
                fr(
                    fr(
                        fr(m(2, 1) * fr(m(0, 2) * m(1, 0))) +
                            fr(
                                fr(m(2, 2) * fr(m(0, 0) * m(1, 1))) +
                                    fr(m(2, 0) * fr(m(0, 1) * m(1, 2))),
                            ),
                    ) - fr(m(0, 2) * fr(m(2, 0) * m(1, 1))),
                ) - fr(m(2, 2) * fr(m(1, 0) * m(0, 1))),
            ) - fr(m(1, 2) * fr(m(0, 0) * m(2, 1))),
        );

        if (determinant === 0.0) {
            out.copy(Matrix34f.ident);
            return;
        }

        const invDet = fr(1.0 / determinant);
        const d = (a: number, b: number, c: number, e: number) => fr(fr(a * b) - fr(c * e));

        out.set(0, 2, fr(d(m(0, 1), m(1, 2), m(1, 1), m(0, 2)) * invDet));
        out.set(1, 2, fr(-d(m(0, 0), m(1, 2), m(0, 2), m(1, 0)) * invDet));
        out.set(2, 1, fr(-d(m(0, 0), m(2, 1), m(2, 0), m(0, 1)) * invDet));
        out.set(2, 2, fr(d(m(0, 0), m(1, 1), m(1, 0), m(0, 1)) * invDet));
        out.set(2, 0, fr(d(m(1, 0), m(2, 1), m(2, 0), m(1, 1)) * invDet));
        out.set(0, 0, fr(d(m(1, 1), m(2, 2), m(2, 1), m(1, 2)) * invDet));
        out.set(0, 1, fr(-d(m(0, 1), m(2, 2), m(2, 1), m(0, 2)) * invDet));
        out.set(1, 0, fr(-d(m(1, 0), m(2, 2), m(2, 0), m(1, 2)) * invDet));
        out.set(1, 1, fr(d(m(0, 0), m(2, 2), m(2, 0), m(0, 2)) * invDet));
    }

    /**
     * @addr{0x80199FC8}
     * The out matrix will not be initialized if the matrix is singular.
     * @return Whether or not the matrix is invertible.
     */
    ps_inverse(out: Matrix34f): boolean {
        const m = (r: number, c: number) => this.a[r * 4 + c]!;

        const fVar14 = fms(m(0, 1), m(1, 2), fr(m(1, 1) * m(0, 2)));
        const fVar15 = fms(m(1, 1), m(2, 2), fr(m(2, 1) * m(1, 2)));
        const fVar13 = fms(m(2, 1), m(0, 2), fr(m(0, 1) * m(2, 2)));
        const determinant = fma(m(2, 0), fVar14, fma(m(1, 0), fVar13, fr(m(0, 0) * fVar15)));

        if (determinant === 0.0) {
            return false;
        }

        const invDet = finv(determinant);

        out.set(0, 0, fr(fVar15 * invDet));
        out.set(0, 1, fr(fVar13 * invDet));
        out.set(1, 0, fr(fms(m(1, 2), m(2, 0), fr(m(2, 2) * m(1, 0))) * invDet));
        out.set(1, 1, fr(fms(m(2, 2), m(0, 0), fr(m(0, 2) * m(2, 0))) * invDet));
        out.set(2, 0, fr(fms(m(1, 0), m(2, 1), fr(m(1, 1) * m(2, 0))) * invDet));
        out.set(2, 1, fr(fms(m(0, 1), m(2, 0), fr(m(0, 0) * m(2, 1))) * invDet));
        out.set(2, 2, fr(fms(m(0, 0), m(1, 1), fr(m(0, 1) * m(1, 0))) * invDet));
        out.set(0, 2, fr(fVar14 * invDet));
        out.set(
            0,
            3,
            -fma(
                out.get(0, 2),
                m(2, 3),
                fma(out.get(0, 1), m(1, 3), fr(out.get(0, 0) * m(0, 3))),
            ),
        );
        out.set(1, 2, fr(fms(m(0, 2), m(1, 0), fr(m(1, 2) * m(0, 0))) * invDet));
        out.set(
            1,
            3,
            -fma(
                out.get(1, 2),
                m(2, 3),
                fma(out.get(1, 1), m(1, 3), fr(out.get(1, 0) * m(0, 3))),
            ),
        );
        out.set(
            2,
            3,
            -fma(
                out.get(2, 2),
                m(2, 3),
                fma(out.get(2, 1), m(1, 3), fr(out.get(2, 0) * m(0, 3))),
            ),
        );

        return true;
    }

    /** Transposes the 3x3 portion of the matrix. */
    transpose(): Matrix34f {
        const ret = this.clone();
        ret.set(0, 1, this.get(1, 0));
        ret.set(0, 2, this.get(2, 0));
        ret.set(1, 0, this.get(0, 1));
        ret.set(1, 2, this.get(2, 1));
        ret.set(2, 0, this.get(0, 2));
        ret.set(2, 1, this.get(1, 2));
        return ret;
    }

    translation(): Vector3f {
        return new Vector3f(this.a[3]!, this.a[7]!, this.a[11]!);
    }

    /** @addr{0x80537B80} Get a particular column from a matrix. */
    base(col: number): Vector3f {
        return new Vector3f(this.a[col]!, this.a[4 + col]!, this.a[8 + col]!);
    }

    static readonly ident: Readonly<Matrix34f> = freezeMtx(
        new Matrix34f(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0),
    );

    static readonly zero: Readonly<Matrix34f> = freezeMtx(new Matrix34f());
}

function freezeMtx(m: Matrix34f): Readonly<Matrix34f> {
    Object.freeze(m.a);
    return Object.freeze(m);
}
