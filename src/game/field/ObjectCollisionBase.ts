/**
 * Port of Kinoko source/game/field/ObjectCollisionBase.{hh,cc}.
 *
 * C++ overloads `transform(mat, scale)` and `transform(mat, scale, speed)` are merged into one
 * method with an optional `speed` (undefined selects the two-argument overload).
 */

import { F32_EPSILON, F32_MAX, fmax, fr, u2f } from '../../egg/math/Math';
import type { Matrix34f } from '../../egg/math/Matrix';
import { Vector3f } from '../../egg/math/Vector';

/** Houses the state of an object in terms of the Gilbert–Johnson–Keerthi (GJK) algorithm. */
export class GJKState {
    m_flags = 0; // u32
    m_idx = 0; // u32
    m_mask = 0; // u32
    m_00c = 0; // s32
    m_s: Vector3f[] = [new Vector3f(), new Vector3f(), new Vector3f(), new Vector3f()];
    m_support1: Vector3f[] = [new Vector3f(), new Vector3f(), new Vector3f(), new Vector3f()];
    m_support2: Vector3f[] = [new Vector3f(), new Vector3f(), new Vector3f(), new Vector3f()];
    m_scales: number[][] = Array.from({ length: 16 }, () => [0.0, 0.0, 0.0, 0.0]);
}

/** std::sqrt(std::numeric_limits<f32>::max()) */
const INITIAL_MAX_VALUE = u2f(0x5f7fffff);
const NEAREST_EPSILON = fr(0.000001);

/** static std::array<std::array<f32, 4>, 4> s_dotProductCache (persists across calls, like C++). */
const s_dotProductCache: number[][] = [
    [0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0],
];

/**
 * The base class that all objects' collision inherits from.
 * Implementation is done via the GJK distance algorithm.
 */
export abstract class ObjectCollisionBase {
    protected m_translation = new Vector3f();
    private m_00 = new Vector3f();

    abstract transform(mat: Readonly<Matrix34f>, scale: Readonly<Vector3f>, speed?: Readonly<Vector3f>): void;
    abstract getSupport(v: Readonly<Vector3f>): Readonly<Vector3f>;
    abstract getBoundingRadius(): number;

    /** @addr{0x80834348} */
    check(rhs: ObjectCollisionBase, distance: Vector3f): boolean {
        const rad = fr(this.getBoundingRadius() + rhs.getBoundingRadius());
        const sqDist = fr(rad * rad);
        let max = INITIAL_MAX_VALUE;
        let lastRadius = 0.0;

        const D = new Vector3f(0.0, 0.0, 0.0);
        const v0 = new Vector3f();
        const v1 = new Vector3f();
        const state = new GJKState();

        do {
            for (state.m_idx = 0, state.m_mask = 1; state.m_flags & state.m_mask; state.m_mask = (state.m_mask * 2) >>> 0) {
                ++state.m_idx;
            }

            state.m_support1[state.m_idx]!.copy(this.getSupport(D.neg()));
            state.m_support2[state.m_idx]!.copy(rhs.getSupport(D));

            const A = state.m_support1[state.m_idx]!.sub(state.m_support2[state.m_idx]!);
            const max2 = fr(max * max);

            const dot = D.dot(A);
            if (dot > 0.0 && fr(dot * dot) > fr(sqDist * max2)) {
                return false;
            }

            lastRadius = fmax(lastRadius, fr(dot / max));

            if (this.inSimplex(state, A) || fr(max2 - dot) < fr(max2 * NEAREST_EPSILON)) {
                this.getNearestPoint2(state, state.m_flags, v0, v1);

                v0.subEq(D.mul(fr(this.getBoundingRadius() / max)));
                v1.addEq(D.mul(fr(rhs.getBoundingRadius() / max)));

                distance.copy(v1.sub(v0));

                this.m_00.copy(v0);
                rhs.m_00.copy(v1);

                return true;
            }

            state.m_s[state.m_idx]!.copy(A);
            state.m_00c = (state.m_flags | state.m_mask) | 0;

            if (!this.getNearestSimplex(state, D)) {
                this.getNearestPoint2(state, state.m_flags, v0, v1);

                v0.subEq(D.mul(fr(this.getBoundingRadius() / max)));
                v1.addEq(D.mul(fr(rhs.getBoundingRadius() / max)));

                distance.copy(v1.sub(v0));

                this.m_00.copy(v0);
                rhs.m_00.copy(v1);

                return true;
            }

            max = D.length();

            if (fr(max2 - fr(max * max)) <= fr(F32_EPSILON * max2)) {
                this.FUN_808350e4(state, D);
                this.getNearestPoint2(state, state.m_flags, v0, v1);
                const len = D.length();
                v0.subEq(D.mul(fr(this.getBoundingRadius() / len)));
                v1.addEq(D.mul(fr(rhs.getBoundingRadius() / len)));

                distance.copy(v1.sub(v0));

                this.m_00.copy(v1);
                rhs.m_00.copy(v1);

                return true;
            }
        } while (state.m_flags < 0xf && max > F32_EPSILON);

        return false;
    }

    /** @addr{0x80573520} */
    translation(): Readonly<Vector3f> {
        return this.m_translation;
    }

    /** @addr{0x8083504C} */
    private enclosesOrigin(state: GJKState, idx: number): boolean {
        let mask = 1;
        for (let i = 0; i < 4; ++i, mask *= 2) {
            if (idx & mask && state.m_scales[idx]![i]! <= 0.0) {
                return false;
            }
        }

        return true;
    }

    /** @addr{0x808350E4} */
    private FUN_808350e4(state: GJKState, v: Vector3f): void {
        let min = F32_MAX;

        for (let mask = state.m_00c >>> 0; mask !== 0; --mask) {
            if (mask !== (mask & state.m_00c) >>> 0 || !this.enclosesOrigin(state, mask)) {
                continue;
            }

            let sqLen = 0.0;
            const tmp = new Vector3f(0.0, 0.0, 0.0);
            this.getNearestPoint(state, mask, tmp);

            sqLen = tmp.squaredLength();
            if (sqLen < min) {
                state.m_flags = mask;
                v.copy(tmp);
                min = sqLen;
            }
        }
    }

    /** @addr{0x80835304} */
    private getNearestSimplex(state: GJKState, v: Vector3f): boolean {
        this.calcSimplex(state);

        for (let i = state.m_flags; i !== 0; --i) {
            if (i !== (i & state.m_flags) || !this.FUN_808357e4(state, (i | state.m_mask) >>> 0)) {
                continue;
            }

            state.m_flags = (i | state.m_mask) >>> 0;
            this.getNearestPoint(state, state.m_flags, v);
            return true;
        }

        if (this.FUN_808357e4(state, state.m_mask)) {
            state.m_flags = state.m_mask;
            v.copy(state.m_s[state.m_idx]!);

            return true;
        }

        return false;
    }

    /** @addr{0x80835650} C++ overload `getNearestPoint(GJKState &, u32, Vector3f &, Vector3f &)`. */
    private getNearestPoint2(state: GJKState, idx: number, v0: Vector3f, v1: Vector3f): void {
        v0.setZero();
        v1.setZero();
        let sum = 0.0;

        for (let i = 0, mask = 1; i < 4; ++i, mask *= 2) {
            if ((idx & mask) === 0) {
                continue;
            }

            const scale = state.m_scales[idx]![i]!;
            sum = fr(sum + scale);
            v0.addEq(state.m_support1[i]!.mul(scale));
            v1.addEq(state.m_support2[i]!.mul(scale));
        }

        v0.mulEq(fr(1.0 / sum));
        v1.mulEq(fr(1.0 / sum));
    }

    /** @addr{0x808357E4} @addr{0x808359A4} */
    private FUN_808357e4(state: GJKState, idx: number): boolean {
        for (let i = 0, mask = 1; i < 4; ++i, mask *= 2) {
            if ((state.m_00c & mask) === 0) {
                continue;
            }

            if (idx & mask) {
                if (state.m_scales[idx]![i]! <= 0.0) {
                    return false;
                }
            } else if (state.m_scales[idx | mask]![i]! > 0.0) {
                return false;
            }
        }

        return true;
    }

    /** @addr{0x808358CC} */
    private inSimplex(state: GJKState, v: Readonly<Vector3f>): boolean {
        for (let i = 0, mask = 1; i < 4; ++i, mask *= 2) {
            if (state.m_00c & mask && state.m_s[i]!.equals(v)) {
                return true;
            }
        }

        return false;
    }

    /** @addr{0x80835F34} C++ overload `getNearestPoint(const GJKState &, u32, Vector3f &)`. */
    private getNearestPoint(state: GJKState, idx: number, v: Vector3f): void {
        v.setZero();

        let sum = 0.0;

        for (let i = 0, mask = 1; i < 4; ++i, mask *= 2) {
            if ((idx & mask) === 0) {
                continue;
            }

            const scale = state.m_scales[idx]![i]!;
            sum = fr(sum + scale);
            v.addEq(state.m_s[i]!.mul(scale));
        }

        v.mulEq(fr(1.0 / sum));
    }

    /** @addr{0x80835A8C} */
    private calcSimplex(state: GJKState): void {
        const idx = state.m_idx;
        const c = s_dotProductCache;
        const sc = state.m_scales;

        for (let i = 0, mask = 1; i < 4; ++i, mask *= 2) {
            if ((state.m_flags & mask) === 0) {
                continue;
            }

            const result = state.m_s[i]!.dot(state.m_s[idx]!);
            c[idx]![i] = result;
            c[i]![idx] = result;
        }

        sc[state.m_mask]![idx] = 1.0;
        c[idx]![idx] = state.m_s[idx]!.squaredLength();

        for (let i = 0, iMask = 1; i < 4; ++i, iMask *= 2) {
            if ((state.m_flags & iMask) === 0) {
                continue;
            }

            const iStateMask = iMask | state.m_mask;

            sc[iStateMask]![i] = fr(c[idx]![idx]! - c[idx]![i]!);
            sc[iStateMask]![idx] = fr(c[i]![i]! - c[i]![idx]!);

            for (let j = 0, jMask = 1; j < i; ++j, jMask *= 2) {
                if ((state.m_flags & jMask) === 0) {
                    continue;
                }

                sc[jMask | iStateMask]![j] = fr(
                    fr(sc[iStateMask]![i]! * fr(c[i]![i]! - c[i]![j]!)) +
                        fr(sc[iStateMask]![idx]! * fr(c[idx]![i]! - c[idx]![j]!)),
                );
                sc[jMask | iStateMask]![i] = fr(
                    fr(sc[jMask | state.m_mask]![j]! * fr(c[j]![j]! - c[i]![j]!)) +
                        fr(sc[jMask | state.m_mask]![idx]! * fr(c[idx]![j]! - c[idx]![i]!)),
                );
                sc[jMask | iStateMask]![idx] = fr(
                    fr(sc[jMask | iMask]![j]! * fr(c[j]![j]! - c[j]![idx]!)) +
                        fr(sc[jMask | iMask]![i]! * fr(c[i]![j]! - c[i]![idx]!)),
                );
            }
        }

        if (state.m_00c !== 0xf) {
            return;
        }

        const _1_1 = fr(c[0]![0]! - c[0]![1]!);
        const _2_2 = fr(c[0]![0]! - c[0]![2]!);
        const _3_2 = fr(c[0]![0]! - c[0]![3]!);
        const _0_2 = fr(c[1]![1]! - c[1]![0]!);
        const _0_3 = fr(c[2]![1]! - c[2]![0]!);
        const _1_2 = fr(c[3]![0]! - c[3]![1]!);
        const _1_3 = fr(c[2]![0]! - c[2]![1]!);
        const _2_1 = fr(c[3]![0]! - c[3]![2]!);
        const _0_1 = fr(c[3]![1]! - c[3]![0]!);
        const _2_3 = fr(c[1]![0]! - c[1]![2]!);
        const _3_1 = fr(c[2]![0]! - c[2]![3]!);
        const _3_3 = fr(c[1]![0]! - c[1]![3]!);

        sc[15]![0] = fr(fr(_0_1 * sc[14]![3]!) + fr(fr(_0_2 * sc[14]![1]!) + fr(_0_3 * sc[14]![2]!)));
        sc[15]![1] = fr(fr(_1_2 * sc[13]![3]!) + fr(fr(_1_1 * sc[13]![0]!) + fr(_1_3 * sc[13]![2]!)));
        sc[15]![2] = fr(fr(_2_1 * sc[11]![3]!) + fr(fr(_2_2 * sc[11]![0]!) + fr(_2_3 * sc[11]![1]!)));
        sc[15]![3] = fr(fr(_3_1 * sc[7]![2]!) + fr(fr(_3_2 * sc[7]![0]!) + fr(_3_3 * sc[7]![1]!)));
    }
}
