/** Port of Kinoko's egg/math/Quat.hh. Same value-type conventions as Vector3f. */

import { acos, cos, F32_EPSILON, fr, sin, sqrt } from './Math';
import { Vector3f } from './Vector';

export class Quatf {
    v: Vector3f;
    w: number;

    constructor(w = 0.0, x = 0.0, y = 0.0, z = 0.0) {
        this.v = new Vector3f(x, y, z);
        this.w = w;
    }

    static fromWV(w: number, v: Readonly<Vector3f>): Quatf {
        return new Quatf(w, v.x, v.y, v.z);
    }

    clone(): Quatf {
        return new Quatf(this.w, this.v.x, this.v.y, this.v.z);
    }

    /** C++ assignment operator. */
    copy(q: Readonly<Quatf>): this {
        this.w = q.w;
        this.v.copy(q.v);
        return this;
    }

    add(rhs: Readonly<Quatf>): Quatf {
        return Quatf.fromWV(fr(this.w + rhs.w), this.v.add(rhs.v));
    }

    addEq(rhs: Readonly<Quatf>): this {
        return this.copy(this.add(rhs));
    }

    /** C++ `operator*(const Vector3f &)` */
    mulVec(vec: Readonly<Vector3f>): Quatf {
        const cross = this.v.cross(vec);
        const scale = vec.mul(this.w);
        return Quatf.fromWV(-this.v.dot(vec), cross.add(scale));
    }

    /** C++ `operator*(f32)` */
    mulScalar(scalar: number): Quatf {
        return Quatf.fromWV(fr(this.w * scalar), this.v.mul(scalar));
    }

    mulScalarEq(scalar: number): this {
        return this.copy(this.mulScalar(scalar));
    }

    /** C++ `operator*(const Quatf &)` */
    mul(rhs: Readonly<Quatf>): Quatf {
        const v = this.v;
        const w = this.w;
        const _w = fr(
            fr(fr(fr(w * rhs.w) - fr(v.x * rhs.v.x)) - fr(v.y * rhs.v.y)) - fr(v.z * rhs.v.z),
        );
        const _x = fr(
            fr(fr(v.y * rhs.v.z) + fr(fr(v.x * rhs.w) + fr(w * rhs.v.x))) - fr(v.z * rhs.v.y),
        );
        const _y = fr(
            fr(fr(v.z * rhs.v.x) + fr(fr(v.y * rhs.w) + fr(w * rhs.v.y))) - fr(v.x * rhs.v.z),
        );
        const _z = fr(
            fr(fr(v.x * rhs.v.y) + fr(fr(v.z * rhs.w) + fr(w * rhs.v.z))) - fr(v.y * rhs.v.x),
        );
        return new Quatf(_w, _x, _y, _z);
    }

    mulEq(q: Readonly<Quatf>): this {
        return this.copy(this.mul(q));
    }

    equals(rhs: Readonly<Quatf>): boolean {
        return this.w === rhs.w && this.v.equals(rhs.v);
    }

    /** @addr{0x80239E10} Sets roll, pitch, and yaw. */
    setRPY(rpy: Readonly<Vector3f>): void {
        this.setRPY3(rpy.x, rpy.y, rpy.z);
    }

    setRPY3(r: number, p: number, y: number): void {
        const cy = cos(fr(y * 0.5));
        const cp = cos(fr(p * 0.5));
        const cr = cos(fr(r * 0.5));
        const sy = sin(fr(y * 0.5));
        const sp = sin(fr(p * 0.5));
        const sr = sin(fr(r * 0.5));

        this.w = fr(fr(fr(cy * cp) * cr) + fr(fr(sy * sp) * sr));
        this.v.x = fr(fr(fr(cy * cp) * sr) - fr(fr(sy * sp) * cr));
        this.v.y = fr(fr(fr(cy * sp) * cr) + fr(fr(sy * cp) * sr));
        this.v.z = fr(fr(fr(sy * cp) * cr) - fr(fr(cy * sp) * sr));
    }

    /** @addr{0x8023A168} Scales the quaternion to a unit length. */
    normalise(): void {
        const len = this.squaredNorm() > F32_EPSILON ? this.norm() : 0.0;
        if (len !== 0.0) {
            const inv = fr(1.0 / len);
            this.w = fr(this.w * inv);
            this.v.mulEq(inv);
        }
    }

    /** @addr{0x8023A788} Captures rotation between two vectors. */
    makeVectorRotation(from: Readonly<Vector3f>, to: Readonly<Vector3f>): void {
        let t0 = fr(fr(from.dot(to) + 1) * 2.0);
        t0 = 0.0 < t0 ? t0 : 0.0; // std::max(0.0f, t0)
        t0 = sqrt(t0);

        if (t0 <= F32_EPSILON) {
            this.copy(Quatf.ident);
        } else {
            const inv = fr(1.0 / t0);
            this.w = fr(t0 * 0.5);
            this.v.copy(from.cross(to).mul(inv));
        }
    }

    conjugate(): Quatf {
        return Quatf.fromWV(this.w, this.v.neg());
    }

    /** @addr{0x8023A2D0} Rotates a vector based on the quat. */
    rotateVector(vec: Readonly<Vector3f>): Vector3f {
        const conj = this.conjugate();
        const res = this.mulVec(vec);
        const c = conj.v;
        const cw = conj.w;
        const r = res.v;
        const rw = res.w;
        return new Vector3f(
            fr(fr(fr(r.y * c.z) + fr(fr(r.x * cw) + fr(rw * c.x))) - fr(r.z * c.y)),
            fr(fr(fr(r.z * c.x) + fr(fr(r.y * cw) + fr(rw * c.y))) - fr(r.x * c.z)),
            fr(fr(fr(r.x * c.y) + fr(fr(r.z * cw) + fr(rw * c.z))) - fr(r.y * c.x)),
        );
    }

    /** @addr{0x8023A404} Rotates a vector on the inverse quat. */
    rotateVectorInv(vec: Readonly<Vector3f>): Vector3f {
        const conj = this.conjugate();
        const res = conj.mulVec(vec);
        const v = this.v;
        const w = this.w;
        const r = res.v;
        const rw = res.w;
        return new Vector3f(
            fr(fr(fr(r.y * v.z) + fr(fr(r.x * w) + fr(rw * v.x))) - fr(r.z * v.y)),
            fr(fr(fr(r.z * v.x) + fr(fr(r.y * w) + fr(rw * v.y))) - fr(r.x * v.z)),
            fr(fr(fr(r.x * v.y) + fr(fr(r.z * w) + fr(rw * v.z))) - fr(r.y * v.x)),
        );
    }

    /** @addr{0x8023A5C4} Performs spherical linear interpolation. */
    slerpTo(q1: Readonly<Quatf>, t: number): Quatf {
        let d = this.dot(q1);
        d = d < 1.0 ? d : 1.0; // std::min(1.0f, d)
        d = -1.0 < d ? d : -1.0; // std::max(-1.0f, d)
        const bDot = d < 0.0;
        d = Math.abs(d);

        const a = acos(d);
        const s_ = sin(a);

        let s: number;
        if (Math.abs(s_) < fr(0.00001)) {
            s = fr(1.0 - t);
        } else {
            const invSin = fr(1.0 / s_);
            const tmp0 = fr(t * a);
            s = fr(invSin * sin(fr(a - tmp0)));
            t = fr(invSin * sin(tmp0));
        }

        if (bDot) {
            t = -t;
        }

        return Quatf.fromWV(fr(fr(s * this.w) + fr(t * q1.w)), this.v.mul(s).add(q1.v.mul(t)));
    }

    /** @addr{0x8023A138} */
    squaredNorm(): number {
        return fr(fr(this.w * this.w) + this.v.squaredLength());
    }

    norm(): number {
        return sqrt(this.squaredNorm());
    }

    dot(q: Readonly<Quatf>): number {
        return fr(fr(this.w * q.w) + this.v.dot(q.v));
    }

    /** @addr{0x8023A0A0} Set the quat given angle and axis. */
    setAxisRotation(angle: number, axis: Readonly<Vector3f>): void {
        const halfAngle = fr(angle * 0.5);
        const c = cos(halfAngle);
        const s = sin(halfAngle);

        this.w = c;
        this.v.copy(axis.mul(s));
    }

    /** C++ `multSwap(const Vector3f &)` */
    multSwapVec(vec: Readonly<Vector3f>): Quatf {
        const v = this.v;
        const w = this.w;
        const _w = -v.dot(vec);
        const _x = fr(fr(fr(w * vec.x) + fr(v.y * vec.z)) - fr(v.z * vec.y));
        const _y = fr(fr(fr(w * vec.y) + fr(v.z * vec.x)) - fr(v.x * vec.z));
        const _z = fr(fr(fr(w * vec.z) + fr(v.x * vec.y)) - fr(v.y * vec.x));
        return new Quatf(_w, _x, _y, _z);
    }

    /** C++ `multSwap(const Quatf &)` */
    multSwap(q: Readonly<Quatf>): Quatf {
        const v = this.v;
        const w = this.w;
        const _w = fr(fr(fr(fr(w * q.w) - fr(v.x * q.v.x)) - fr(v.y * q.v.y)) - fr(v.z * q.v.z));
        const _x = fr(fr(fr(v.y * q.v.z) + fr(fr(v.x * q.w) + fr(w * q.v.x))) - fr(v.z * q.v.y));
        const _y = fr(fr(fr(v.z * q.v.x) + fr(fr(v.y * q.w) + fr(w * q.v.y))) - fr(v.x * q.v.z));
        const _z = fr(fr(fr(v.x * q.v.y) + fr(fr(v.z * q.w) + fr(w * q.v.z))) - fr(v.y * q.v.x));
        return new Quatf(_w, _x, _y, _z);
    }

    static FromRPY(rpy: Readonly<Vector3f>): Quatf {
        const ret = new Quatf();
        ret.setRPY(rpy);
        return ret;
    }

    static FromRPY3(r: number, p: number, y: number): Quatf {
        const ret = new Quatf();
        ret.setRPY3(r, p, y);
        return ret;
    }

    toString(): string {
        return `[${this.v.x}, ${this.v.y}, ${this.v.z}, ${this.w}]`;
    }

    static readonly ident: Readonly<Quatf> = freezeQuat(new Quatf(1.0, 0.0, 0.0, 0.0));
}

function freezeQuat(q: Quatf): Readonly<Quatf> {
    Object.freeze(q.v);
    return Object.freeze(q);
}
