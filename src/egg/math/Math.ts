/**
 * Port of Kinoko's egg/math/Math.hh.
 *
 * All game values are IEEE-754 single precision floats (f32). JavaScript numbers are doubles, so
 * every arithmetic result MUST be rounded with `fr` (Math.fround). For +, -, *, / and sqrt,
 * computing in double and then rounding to f32 gives the exact same result as native f32
 * arithmetic, so `fr(a * b)` is bit-identical to C++ `a * b` on f32 operands.
 */

import { ATAN_TBL_RAW, FRES_TABLE, RSQRTE_TABLE, SIN_COS_TBL_RAW } from './MathTables';

const F32_MIN_NORMAL = 1.1754943508222875e-38; // 2^-126

/**
 * Rounds to f32 with flush-to-zero. Kinoko's host enables FTZ/DAZ at startup (FPCR.FZ on arm64,
 * DAZ on x86) to match the Wii, whose real-game dumps contain exact zeros where IEEE arithmetic
 * would produce subnormals. Subnormal results therefore become a signed zero.
 */
export function fr(x: number): number {
    const r = Math.fround(x);
    return r > -F32_MIN_NORMAL && r < F32_MIN_NORMAL ? r * 0 : r;
}

/** std::numeric_limits<f32>::epsilon() */
export const F32_EPSILON = fr(1 / 8388608);
/** std::numeric_limits<f32>::max() */
export const F32_MAX = fr(3.4028234663852886e38);

export const F_PI = fr(3.1415927);
export const F_TAU = fr(6.2831855);
export const DEG2RAD = fr(0.017453292);
export const DEG2RAD360 = fr(0.034906585);
export const RAD2DEG = fr(57.2957795);
export const DEG2FIDX = fr(256.0 / 360.0);
export const RAD2FIDX = fr(128.0 / F_PI);
export const FIDX2RAD = fr(F_PI / 128.0);
export const HALF_PI = fr(F_PI / 2.0);

// Scratch buffers for bit manipulation.
const scratch = new DataView(new ArrayBuffer(8));

/** Reinterpret f32 bits as u32. */
export function f2u(x: number): number {
    scratch.setFloat32(0, x);
    return scratch.getUint32(0);
}

/** Reinterpret u32 bits as f32. */
export function u2f(x: number): number {
    scratch.setUint32(0, x >>> 0);
    return scratch.getFloat32(0);
}

function f64Hi(x: number): number {
    scratch.setFloat64(0, x);
    return scratch.getUint32(0);
}

function f64Lo(x: number): number {
    scratch.setFloat64(0, x);
    return scratch.getUint32(4);
}

function f64FromWords(hi: number, lo: number): number {
    scratch.setUint32(0, hi >>> 0);
    scratch.setUint32(4, lo >>> 0);
    return scratch.getFloat64(0);
}

/**
 * Mimics the Wii FPU's handling of double-precision numbers passed into single-precision operands.
 * Rounds the mantissa at bit 27.
 */
export function force25Bit(x: number): number {
    scratch.setFloat64(0, x);
    let hi = scratch.getUint32(0);
    const lo = scratch.getUint32(4);
    let newLo = (lo & 0xf8000000) >>> 0;
    newLo += (lo & 0x08000000) >>> 0;
    if (newLo >= 0x100000000) {
        newLo -= 0x100000000;
        hi = (hi + 1) >>> 0;
    }
    return f64FromWords(hi, newLo);
}

/** Fused multiply-add as performed by the Wii (64-bit intermediate). Args are f32. */
export function fma(x: number, y: number, z: number): number {
    return fr(x * force25Bit(y) + z);
}

/** Fused multiply-subtract as performed by the Wii (64-bit intermediate). Args are f32. */
export function fms(x: number, y: number, z: number): number {
    return fr(x * force25Bit(y) - z);
}

// Tables, pre-rounded to f32.
const SIN_COS_TBL = Float32Array.from(SIN_COS_TBL_RAW);
const ATAN_TBL = Float32Array.from(ATAN_TBL_RAW);

function sinVal(i: number): number {
    return SIN_COS_TBL[i * 4]!;
}
function cosVal(i: number): number {
    return SIN_COS_TBL[i * 4 + 1]!;
}
function sinDt(i: number): number {
    return SIN_COS_TBL[i * 4 + 2]!;
}
function cosDt(i: number): number {
    return SIN_COS_TBL[i * 4 + 3]!;
}

/** @addr{0x80085110} */
export function SinFIdx(fidx: number): number {
    let absFidx = Math.abs(fidx);
    while (absFidx >= 65536.0) {
        absFidx = fr(absFidx - 65536.0);
    }
    let idx = Math.trunc(absFidx) & 0xffff;
    const r = fr(absFidx - idx);
    idx &= 0xff;
    const val = fr(sinVal(idx) + fr(r * sinDt(idx)));
    return fidx < 0.0 ? -val : val;
}

/** @addr{0x80085180} */
export function CosFIdx(fidx: number): number {
    let absFidx = Math.abs(fidx);
    while (absFidx >= 65536.0) {
        absFidx = fr(absFidx - 65536.0);
    }
    let idx = Math.trunc(absFidx) & 0xffff;
    const r = fr(absFidx - idx);
    idx &= 0xff;
    return fr(cosVal(idx) + fr(r * cosDt(idx)));
}

/** @addr{0x800851E0} Returns [sin, cos]. */
export function SinCosFIdx(fidx: number): [number, number] {
    let absFidx = Math.abs(fidx);
    while (absFidx >= 65536.0) {
        absFidx = fr(absFidx - 65536.0);
    }
    let idx = Math.trunc(absFidx) & 0xffff;
    const r = fr(absFidx - idx);
    idx &= 0xff;
    const cos = fma(cosDt(idx), r, cosVal(idx));
    let sin = fma(sinDt(idx), r, sinVal(idx));
    if (fidx < 0.0) {
        sin = -sin;
    }
    return [sin, cos];
}

function AtanFIdx_(x: number): number {
    x = fr(x * 32.0);
    const idx = Math.trunc(x) & 0xffff;
    const r = fr(x - idx);
    return fr(ATAN_TBL[idx * 2]! + fr(r * ATAN_TBL[idx * 2 + 1]!));
}

/** @addr{0x800853C0} */
export function Atan2FIdx(y: number, x: number): number {
    if (x === 0.0 && y === 0.0) {
        return 0.0;
    }

    if (x >= 0.0) {
        if (y >= 0.0) {
            if (x >= y) {
                return fr(0.0 + AtanFIdx_(fr(y / x)));
            } else {
                return fr(64.0 - AtanFIdx_(fr(x / y)));
            }
        } else {
            if (x >= -y) {
                return fr(0.0 - AtanFIdx_(fr(-y / x)));
            } else {
                return fr(-64.0 + AtanFIdx_(fr(x / -y)));
            }
        }
    } else {
        if (y >= 0.0) {
            if (-x >= y) {
                return fr(128.0 - AtanFIdx_(fr(y / -x)));
            } else {
                return fr(64.0 + AtanFIdx_(fr(-x / y)));
            }
        } else {
            if (-x >= -y) {
                return fr(-128.0 + AtanFIdx_(fr(-y / -x)));
            } else {
                return fr(-64.0 - AtanFIdx_(fr(-x / -y)));
            }
        }
    }
}

/** Takes in radians. @addr{0x8022F860} */
export function sin(x: number): number {
    return SinFIdx(fr(x * RAD2FIDX));
}

/** Takes in radians. @addr{0x8022F86C} */
export function cos(x: number): number {
    return CosFIdx(fr(x * RAD2FIDX));
}

/** @addr{0x8022F89C} */
export function asin(x: number): number {
    return fr(Math.asin(x));
}

/** @addr{0x8022F8C0} */
export function acos(x: number): number {
    return fr(Math.acos(x));
}

/** @addr{0x8022F8E4} */
export function atan2(y: number, x: number): number {
    return fr(Atan2FIdx(y, x) * FIDX2RAD);
}

export function abs(x: number): number {
    return Math.abs(x);
}

/**
 * Emulates the PowerPC frsqrte instruction (reciprocal square root estimate).
 * Input and output are doubles. Courtesy of Geotale via Kinoko.
 */
export function frsqrte(val: number): number {
    const hi = f64Hi(val);
    const lo = f64Lo(val);
    const sign = (hi & 0x80000000) !== 0;
    const expHi = hi & 0x7ff00000;
    const mantHi = hi & 0x000fffff;

    // Handle 0 case
    if (mantHi === 0 && lo === 0 && expHi === 0) {
        return sign ? -Infinity : Infinity;
    }

    // Handle NaN-like
    if (expHi === 0x7ff00000) {
        if (mantHi === 0 && lo === 0) {
            return sign ? NaN : 0.0;
        }
        return val;
    }

    // Handle negative inputs
    if (sign) {
        return NaN;
    }

    if (expHi === 0) {
        // Denormal doubles never occur for f32-derived inputs.
        throw new Error('frsqrte: denormal double input is not supported');
    }

    // key = (exponent | mantissa) >> 37
    const key = (hi & 0x7fffffff) >>> 5;
    const newExpHi = ((0xbfc00000 - expHi) >>> 1) & 0x7ff00000;

    const entry = RSQRTE_TABLE[0x1f & (key >>> 11)]!;
    const newMantissa = entry[0] + entry[1] * (key & 0x7ff);

    const mHi = Math.floor(newMantissa / 0x100000000);
    const mLo = newMantissa - mHi * 0x100000000;
    return f64FromWords((newExpHi | mHi) >>> 0, mLo);
}

/** Emulates the PowerPC fres instruction (reciprocal estimate). Input and output are f32. */
export function fres(val: number): number {
    const hi = f64Hi(val);
    const lo = f64Lo(val);

    const mantissa = (((hi << 3) | (lo >>> 29)) & 0x007fffff) >>> 0;
    const exponent = ((hi >>> 20) & 0x7ff) - 0x380;
    const sign = (hi & 0x80000000) >>> 0;

    if (exponent < -1) {
        // NOTE: The original code checks `bits.u & !SIGN_MASK_F64`, which is always 0.
        return sign ? -Infinity : Infinity;
    }

    if ((hi & 0x7ff00000) >>> 0 >= 0x47d00000) {
        const isNaNLike = (hi & 0x7ff00000) >>> 0 === 0x7ff00000;
        if (mantissa === 0 || !isNaNLike) {
            return sign ? -0.0 : 0.0;
        } else if ((hi & 0x00080000) !== 0) {
            return val;
        } else {
            return NaN;
        }
    }

    const key = mantissa >>> 18;
    const newExp = 253 - exponent;
    const entry = FRES_TABLE[key]!;

    const preShift = (entry[0] + entry[1] * ((mantissa >>> 8) & 0x3ff)) >>> 0;
    const newMantissa = preShift >>> 1;

    if (newExp <= 0) {
        return u2f(sign);
    }
    return u2f((sign | (newExp << 23) | newMantissa) >>> 0);
}

/** CREDIT: Hanachan. @addr{0x80085040} */
export function frsqrt(x: number): number {
    // frsqrte instruction
    const est = frsqrte(x);

    // Newton-Raphson refinement
    const tmp0 = fr(est * force25Bit(est));
    const tmp1 = fr(est * 0.5);
    const tmp2 = fr(3.0 - tmp0 * x);
    return fr(tmp1 * tmp2);
}

/** @addr{0x8022F80C} */
export function sqrt(x: number): number {
    return x > 0.0 ? fr(x * frsqrt(x)) : 0.0;
}

/**
 * @addr{0x800867C0}
 * Returns [rootCount, root1, root2]. Roots that are not written by the original function are
 * returned as `undefined`, so callers should fall back to the previous value of their out-params.
 */
export function FindRootsQuadratic(
    a: number,
    b: number,
    c: number,
): [number, number | undefined, number | undefined] {
    const EPSILON = fr(0.0002);

    if (b === 0.0) {
        const x = fr(-c / a);
        if (x > EPSILON) {
            const root1 = fr(x * frsqrt(x));
            return [2, root1, -root1];
        }

        if (x >= -EPSILON) {
            return [1, 0.0, undefined];
        }

        return [0, undefined, undefined];
    }

    const halfBOverA = fr(b / fr(2.0 * a));
    const normalizedC = fr(c / fr(halfBOverA * fr(a * halfBOverA)));
    const normalizedDiscriminant = fr(1.0 - normalizedC);

    if (normalizedDiscriminant > EPSILON) {
        const sqrtNormalizedDiscriminant = fr(
            normalizedDiscriminant * frsqrt(normalizedDiscriminant),
        );
        const root2 = fr(fr(halfBOverA * normalizedC) / fr(-1.0 - sqrtNormalizedDiscriminant));
        const root1 = fr(halfBOverA * fr(-1.0 - sqrtNormalizedDiscriminant));
        return [2, root1, root2];
    }

    if (normalizedDiscriminant >= -EPSILON) {
        return [1, -halfBOverA, undefined];
    }

    return [0, undefined, undefined];
}

/** Fused Newton-Raphson operation. */
export function finv(x: number): number {
    const inv = fres(x);
    const invDouble = fr(inv + inv);
    const invSquare = fr(inv * inv);
    return -fms(x, invSquare, invDouble);
}

/** @addr{0x80085070} Evaluates a cubic Hermite curve at a given parameter t. */
export function Hermite(p0: number, m0: number, p1: number, m1: number, t: number): number {
    const t2 = fr(t * t);
    const t2_less_t = fr(t2 - t);
    const h3 = fr(t2_less_t * t);
    const f0 = fr(2.0 * h3);
    const h2 = fr(h3 - t2_less_t);
    const h1 = fr(t2 - f0);

    return fr(
        fr(h3 * m1) + fr(fr(h2 * m0) + fr(fr(p0 - fr(h1 * p0)) + fr(h1 * p1))),
    );
}

/** Convenience: std::min for f32 values (returns lhs when equal, like std::min(a, b)). */
export function fmin(a: number, b: number): number {
    return b < a ? b : a;
}

/** Convenience: std::max for f32 values (returns lhs when equal, like std::max(a, b)). */
export function fmax(a: number, b: number): number {
    return a < b ? b : a;
}

/** std::clamp */
export function fclamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : hi < v ? hi : v;
}
