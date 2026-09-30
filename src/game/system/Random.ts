/**
 * Port of Kinoko source/game/system/Random.hh.
 * Based off https://github.com/em-eight/mkw/blob/master/source/game/util/Random.cpp
 */

import { fr } from '../../egg/math/Math';

const A = 0x690379b2b2e3d431n;
const C = 0x508ebdn;
const MUL = fr(1.0 / 4294967296.0); // 1 / (2 ^ 32)

export class Random {
    private m_x: bigint;
    private m_seed: bigint;

    /** C++ `Random(u32 seed)`; pass another Random to copy-construct. */
    constructor(seedOrRhs: number | Random) {
        if (seedOrRhs instanceof Random) {
            this.m_x = seedOrRhs.m_x;
            this.m_seed = seedOrRhs.m_seed;
        } else {
            this.m_x = BigInt(seedOrRhs >>> 0);
            this.m_seed = BigInt(seedOrRhs >>> 0);
        }
    }

    next(): void {
        this.m_x = BigInt.asUintN(64, A * this.m_x + C);
    }

    /** C++ overloads `getU32()` and `getU32(u32 range)`. */
    getU32(range?: number): number {
        this.next();
        if (range === undefined) {
            return Number(this.m_x >> 32n);
        }
        return Number(BigInt.asUintN(64, (this.m_x >> 32n) * BigInt(range >>> 0)) >> 32n);
    }

    /** C++ overloads `getF32()` and `getF32(f32 range)`. */
    getF32(range?: number): number {
        if (range === undefined) {
            return fr(MUL * fr(this.getU32()));
        }
        return fr(range * this.getF32());
    }
}
