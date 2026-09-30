/**
 * Port of Kinoko source/game/field/BoxColManager.{hh,cc}.
 * Spatial indexing manager for entities with dynamic collision.
 *
 * Pointer semantics: `const EGG::Vector3f *m_pos` is stored as a live reference to the owner's
 * position vector (it must be mutated in place by its owner, never replaced).
 */

import { TBitFlag } from '../../egg/core/BitFlag';
import { abs, fr } from '../../egg/math/Math';
import { Vector3f } from '../../egg/math/Vector';
import type { KartObject } from '../kart/KartObject';
import type { ObjectCollidable } from './obj/ObjectCollidable';
import type { ObjectDrivable } from './obj/ObjectDrivable';

/**
 * A bitfield that represents the state and type of a given BoxColUnit.
 * The lower 8 bits represent the type, while the remaining bits represent the state.
 */
export enum eBoxColFlag {
    Driver = 0,
    Object = 3,
    Drivable = 4,
    PermRecalcAABB = 8, ///< Recalculate this unit's spatial indexing every frame.
    Intangible = 9, ///< Ignore collision with the unit.
    Active = 10,
    TempRecalcAABB = 11, ///< Only recalculate once.
}

/** `typedef EGG::TBitFlag<u32, eBoxColFlag> BoxColFlag;` */
export class BoxColFlag extends TBitFlag<eBoxColFlag> {
    /** C++ `BoxColFlag(eBoxColFlag e)` constructor: sets only bit e. */
    static FromBit(e: eBoxColFlag): BoxColFlag {
        const f = new BoxColFlag();
        f.setBit(e);
        return f;
    }

    override clone(): BoxColFlag {
        return new BoxColFlag(this.bits);
    }
}

/** A representation of the boundaries of an entity that has dynamic collision. */
export class BoxColUnit {
    m_pos: Readonly<Vector3f> | null;
    m_radius: number;
    m_range: number;
    m_flag = new BoxColFlag();
    m_userData: unknown;
    m_highPointIdx = 0;
    m_lowPointIdx = 0;
    m_xMax = 0.0;
    m_xMin = 0.0;

    /** @addr{0x80786ED0} */
    constructor() {
        this.m_pos = null;
        this.m_radius = 0.0;
        this.m_range = 0.0;
        this.m_userData = null;
    }

    /** @addr{0x80786F34} */
    init(
        radius: number,
        maxSpeed: number,
        pos: Readonly<Vector3f>,
        flag: Readonly<BoxColFlag>,
        userData: unknown,
    ): void {
        this.m_pos = pos;
        this.m_radius = radius;
        this.m_range = fr(radius + maxSpeed);
        this.m_flag.copy(flag);
        this.m_flag.setBit(eBoxColFlag.Active);
        this.m_userData = userData;
        this.m_xMax = fr(pos.x + this.m_range);
        this.m_xMin = fr(pos.x - this.m_range);
    }

    /** @addr{0x80786F6C} */
    makeInactive(): void {
        this.m_flag.resetBit(eBoxColFlag.Active);
    }

    /** @addr{0x80786F7C} */
    resize(radius: number, maxSpeed: number): void {
        this.m_radius = radius;
        this.m_range = fr(radius + maxSpeed);
        this.m_flag.setBit(eBoxColFlag.TempRecalcAABB);
    }

    /** @addr{0x80786F98} */
    reinsert(): void {
        BoxColManager.Instance()!.reinsertUnit(this);
    }

    /** @addr{0x80786FA8} */
    search(flag: Readonly<BoxColFlag>): void {
        BoxColManager.Instance()!.search(this, flag);
    }
}

export class BoxColLowPoint {
    z = 0.0;
    highPoint = 0; // u8
    unitID = 0; // u8

    copy(rhs: BoxColLowPoint): void {
        this.z = rhs.z;
        this.highPoint = rhs.highPoint;
        this.unitID = rhs.unitID;
    }
}

export class BoxColHighPoint {
    z = 0.0;
    lowPoint = 0; // u8
    minLowPoint = 0; // u8

    copy(rhs: BoxColHighPoint): void {
        this.z = rhs.z;
        this.lowPoint = rhs.lowPoint;
        this.minLowPoint = rhs.minLowPoint;
    }
}

const MAX_UNIT_COUNT = 0x100;

const u8 = (x: number): number => x & 0xff;
const s16 = (x: number): number => (x << 16) >> 16;

let s_instance: BoxColManager | null = null; ///< @addr{0x809C2EF0}

const SPATIAL_BOUND = fr(999999.9);
const s_upperBound = Object.freeze(new Vector3f(SPATIAL_BOUND, SPATIAL_BOUND, SPATIAL_BOUND));
const s_lowerBound = Object.freeze(new Vector3f(-SPATIAL_BOUND, -SPATIAL_BOUND, -SPATIAL_BOUND));

export class BoxColManager {
    /** A unit's rightmost Z-axis point. */
    private m_highPoints: BoxColHighPoint[] = [];
    /** A unit's leftmost Z-axis point. */
    private m_lowPoints: BoxColLowPoint[] = [];
    /** Where all the units live. */
    private m_unitPool: BoxColUnit[] = [];
    /** Units within our search bounds. */
    private m_units: (BoxColUnit | null)[] = [];
    /** Specifies what unit to retrieve from the pool during allocation. */
    private m_unitIDs: number[] = [];

    private m_unitCount: number;
    private m_nextUnitID: number;
    private m_nextObjectID = 0;
    private m_nextDrivableID = 0;
    private m_maxID = 0;
    private m_cacheQueryUnit: BoxColUnit | null = null;
    private m_cachePoint = new Vector3f();
    private m_cacheRadius = 0.0;
    private m_cacheFlag = new BoxColFlag();

    /**
     * Creates two intangible units to represent the spatial bounds.
     * @addr{0x807856E0}
     */
    constructor() {
        for (let i = 0; i < MAX_UNIT_COUNT; ++i) {
            this.m_highPoints.push(new BoxColHighPoint());
            this.m_lowPoints.push(new BoxColLowPoint());
            this.m_unitPool.push(new BoxColUnit());
            this.m_units.push(null);
            // std::iota(m_unitIDs.begin(), m_unitIDs.end(), 1);
            this.m_unitIDs.push(i + 1);
        }

        this.m_unitCount = 0;
        this.m_nextUnitID = 0;

        this.clear();

        const flags = new BoxColFlag();
        this.insert(1.0, 0.0, s_upperBound, flags, null)!.m_flag.setBit(eBoxColFlag.Intangible);
        this.insert(1.0, 0.0, s_lowerBound, flags, null)!.m_flag.setBit(eBoxColFlag.Intangible);
    }

    /** @addr{0x8078597C} */
    clear(): void {
        this.m_nextObjectID = MAX_UNIT_COUNT;
        this.m_nextDrivableID = MAX_UNIT_COUNT;
        this.m_maxID = 0;
        this.m_cacheQueryUnit = null;
        this.m_cacheRadius = -1.0;
        this.m_cacheFlag.makeAllZero();
    }

    /**
     * Recalculate the bounds of all active units having PermRecalcAABB or TempRecalcAABB flag,
     * and then update the low and high points accordingly.
     * @addr{0x807859B0}
     */
    calc(): void {
        this.clear();

        // Update the AABB if necessary
        let activeUnitIdx = 0;
        for (const unit of this.m_unitPool) {
            // Unit is not active, so it's not factored into mUnitCount, skip it
            if (unit.m_flag.offBit(eBoxColFlag.Active)) {
                continue;
            }

            // Unit is active, but we don't need to recalc its AABB, move to the next unit
            if (unit.m_flag.onBit(eBoxColFlag.PermRecalcAABB, eBoxColFlag.TempRecalcAABB)) {
                const pos = unit.m_pos!;
                unit.m_xMax = fr(pos.x + unit.m_range);
                unit.m_xMin = fr(pos.x - unit.m_range);
                this.m_highPoints[unit.m_highPointIdx]!.z = fr(pos.z + unit.m_range);
                this.m_lowPoints[unit.m_lowPointIdx]!.z = fr(pos.z - unit.m_range);

                unit.m_flag.resetBit(eBoxColFlag.TempRecalcAABB);
            }

            // We're done with all of the active units, so we avoid iterating over the remaining
            // inactive units
            if (++activeUnitIdx >= this.m_unitCount) {
                break;
            }
        }

        // The loops use insertion sort.

        // Reorganize the high points
        const hp = this.m_highPoints;
        const lp = this.m_lowPoints;
        for (let i = 1; i < this.m_unitCount; ++i) {
            for (let j = i; j >= 1 && hp[j - 1]!.z > hp[j]!.z; --j) {
                // std::swap(upper, lower) swaps values; swapping the array slots is equivalent
                // since `upper`/`lower` below always refer to slots j and j - 1.
                const tmp = hp[j]!;
                hp[j] = hp[j - 1]!;
                hp[j - 1] = tmp;
                const upper = hp[j]!;
                const lower = hp[j - 1]!;

                const upperLow = lp[upper.lowPoint]!;
                const lowerLow = lp[lower.lowPoint]!;
                upperLow.highPoint = u8(upperLow.highPoint + 1);
                lowerLow.highPoint = u8(lowerLow.highPoint - 1);

                const upperUnit = this.m_unitPool[upperLow.unitID]!;
                upperUnit.m_highPointIdx = s16(upperUnit.m_highPointIdx + 1);
                const lowerUnit = this.m_unitPool[lowerLow.unitID]!;
                lowerUnit.m_highPointIdx = s16(lowerUnit.m_highPointIdx - 1);

                if (upper.minLowPoint === lower.lowPoint) {
                    do {
                        upper.minLowPoint = u8(upper.minLowPoint + 1);
                    } while (lp[upper.minLowPoint]!.highPoint < j);
                }

                lower.minLowPoint = Math.min(lower.minLowPoint, upper.lowPoint);
            }
        }

        // Reorganize the low points
        for (let i = 1; i < this.m_unitCount; ++i) {
            for (let j = i; j >= 1 && lp[j - 1]!.z > lp[j]!.z; --j) {
                const tmp = lp[j]!;
                lp[j] = lp[j - 1]!;
                lp[j - 1] = tmp;
                const upper = lp[j]!;
                const lower = lp[j - 1]!;

                const upperHigh = hp[upper.highPoint]!;
                upperHigh.lowPoint = u8(upperHigh.lowPoint + 1);
                const lowerHigh = hp[lower.highPoint]!;
                lowerHigh.lowPoint = u8(lowerHigh.lowPoint - 1);

                const upperUnit = this.m_unitPool[upper.unitID]!;
                upperUnit.m_lowPointIdx = s16(upperUnit.m_lowPointIdx + 1);
                const lowerUnit = this.m_unitPool[lower.unitID]!;
                lowerUnit.m_lowPointIdx = s16(lowerUnit.m_lowPointIdx - 1);

                if (upper.highPoint > lower.highPoint) {
                    let k = upper.highPoint;

                    while (k > lower.highPoint && hp[k]!.minLowPoint === j - 1) {
                        const h = hp[k--]!;
                        h.minLowPoint = u8(h.minLowPoint + 1);
                    }
                } else {
                    let k = lower.highPoint;

                    while (k > upper.highPoint && hp[k]!.minLowPoint === j) {
                        const h = hp[k--]!;
                        h.minLowPoint = u8(h.minLowPoint - 1);
                    }
                }
            }
        }
    }

    /** @addr{0x80785E5C} */
    getNextObject(): ObjectCollidable | null {
        const id = { value: this.m_nextObjectID };
        const res = this.getNextImpl(id, BoxColFlag.FromBit(eBoxColFlag.Object));
        this.m_nextObjectID = id.value;
        return res as ObjectCollidable | null;
    }

    /** @addr{0x80785EC4} */
    getNextDrivable(): ObjectDrivable | null {
        const id = { value: this.m_nextDrivableID };
        const res = this.getNextImpl(id, BoxColFlag.FromBit(eBoxColFlag.Drivable));
        this.m_nextDrivableID = id.value;
        return res as ObjectDrivable | null;
    }

    /** @addr{0x80785F2C} */
    resetIterators(): void {
        const obj = { value: -1 };
        this.iterate(obj, BoxColFlag.FromBit(eBoxColFlag.Object));
        this.m_nextObjectID = obj.value;

        const drv = { value: -1 };
        this.iterate(drv, BoxColFlag.FromBit(eBoxColFlag.Drivable));
        this.m_nextDrivableID = drv.value;
    }

    /** @addr{0x80786050} */
    insertDriver(
        radius: number,
        maxSpeed: number,
        pos: Readonly<Vector3f>,
        alwaysRecalc: boolean,
        kartObject: KartObject | null,
    ): BoxColUnit | null {
        const flag = BoxColFlag.FromBit(eBoxColFlag.Driver);

        if (alwaysRecalc) {
            flag.setBit(eBoxColFlag.PermRecalcAABB);
        }

        return this.insert(radius, maxSpeed, pos, flag, kartObject);
    }

    /** @addr{0x80786078} */
    insertObject(
        radius: number,
        maxSpeed: number,
        pos: Readonly<Vector3f>,
        alwaysRecalc: boolean,
        userData: unknown,
    ): BoxColUnit | null {
        const flag = BoxColFlag.FromBit(eBoxColFlag.Object);

        if (alwaysRecalc) {
            flag.setBit(eBoxColFlag.PermRecalcAABB);
        }

        return this.insert(radius, maxSpeed, pos, flag, userData);
    }

    /** @addr{0x80786120} */
    insertDrivable(
        radius: number,
        maxSpeed: number,
        pos: Readonly<Vector3f>,
        alwaysRecalc: boolean,
        userData: unknown,
    ): BoxColUnit | null {
        const flag = BoxColFlag.FromBit(eBoxColFlag.Drivable);

        if (alwaysRecalc) {
            flag.setBit(eBoxColFlag.PermRecalcAABB);
        }

        return this.insert(radius, maxSpeed, pos, flag, userData);
    }

    /** @addr{0x80786DBC} */
    reinsertUnit(unit: BoxColUnit): void {
        const radius = unit.m_radius;
        const maxSpeed = fr(unit.m_range - radius);
        const pos = unit.m_pos!;
        const flag = unit.m_flag.clone();
        const userData = unit.m_userData;

        this.remove({ value: unit });
        this.insert(radius, maxSpeed, pos, new BoxColFlag(), userData)!.m_flag.copy(flag);
    }

    /**
     * @addr{0x80786578}
     * @param unitRef C++ `BoxColUnit *&unit`; set to null on removal.
     */
    remove(unitRef: { value: BoxColUnit | null }): void {
        const unit = unitRef.value;
        if (!unit || unit.m_flag.offBit(eBoxColFlag.Active)) {
            return;
        }

        const highPointIdx = unit.m_highPointIdx;
        const lowPointIdx = unit.m_lowPointIdx;
        const hp = this.m_highPoints;
        const lp = this.m_lowPoints;

        // Update high points
        for (let i = highPointIdx; i < this.m_unitCount - 1; ++i) {
            const high = hp[i]!;
            high.copy(hp[i + 1]!);
            const low = lp[high.lowPoint]!;
            low.highPoint = u8(low.highPoint - 1);
            const lowUnit = this.m_unitPool[low.unitID]!;
            lowUnit.m_highPointIdx = s16(lowUnit.m_highPointIdx - 1);

            if (high.minLowPoint > lowPointIdx) {
                high.minLowPoint = u8(high.minLowPoint - 1);
            }
        }

        // Update low points
        for (let i = lowPointIdx; i < this.m_unitCount - 1; ++i) {
            const low = lp[i]!;
            low.copy(lp[i + 1]!);
            const high = hp[low.highPoint]!;
            high.lowPoint = u8(high.lowPoint - 1);
            const lowUnit = this.m_unitPool[low.unitID]!;
            lowUnit.m_lowPointIdx = s16(lowUnit.m_lowPointIdx - 1);

            if (low.highPoint >= highPointIdx) {
                continue;
            }

            let minLowPoint = hp[low.highPoint]!.minLowPoint;

            if (minLowPoint !== lowPointIdx) {
                continue;
            }

            for (let pLowPoint = minLowPoint; lp[pLowPoint]!.highPoint < low.highPoint; ++minLowPoint) {
                ++pLowPoint;
            }

            hp[low.highPoint]!.minLowPoint = u8(minLowPoint);
        }

        unit.makeInactive();
        const nextID = this.m_unitPool.indexOf(unit);
        this.m_unitIDs[nextID] = this.m_nextUnitID;
        this.m_nextUnitID = nextID;
        --this.m_unitCount;
        unitRef.value = null;
    }

    /**
     * C++ overloads `search(BoxColUnit *unit, const BoxColFlag &flag)` (@addr{0x80786774}) and
     * `search(f32 radius, const EGG::Vector3f &pos, const BoxColFlag &flag)` (@addr{0x80786B14}).
     */
    search(unit: BoxColUnit, flag: Readonly<BoxColFlag>): void;
    search(radius: number, pos: Readonly<Vector3f>, flag: Readonly<BoxColFlag>): void;
    search(
        a: BoxColUnit | number,
        b: Readonly<BoxColFlag> | Readonly<Vector3f>,
        c?: Readonly<BoxColFlag>,
    ): void {
        if (typeof a === 'number') {
            this.searchImplSphere(a, b as Readonly<Vector3f>, c!);
        } else {
            this.searchImplUnit(a, b as Readonly<BoxColFlag>);
        }
        this.resetIterators();
    }

    /** @addr{0x80786E60} */
    isSphereInSpatialCache(
        radius: number,
        pos: Readonly<Vector3f>,
        flag: Readonly<BoxColFlag>,
    ): boolean {
        if (this.m_cacheRadius === -1.0) {
            return false;
        }

        if (!this.m_cacheFlag.onAll(flag.bits)) {
            return false;
        }

        const radiusDiff = fr(this.m_cacheRadius - radius);
        const posDiff = pos.sub(this.m_cachePoint);

        return abs(posDiff.x) <= radiusDiff && abs(posDiff.z) <= radiusDiff;
    }

    /** @addr{0x807855DC} */
    static CreateInstance(): BoxColManager {
        if (s_instance) throw new Error('BoxColManager already exists');
        s_instance = new BoxColManager();
        return s_instance;
    }

    /** @addr{0x8078562C} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): BoxColManager {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** Helper function since the getters share all code except the flag. */
    private getNextImpl(id: { value: number }, flag: Readonly<BoxColFlag>): unknown {
        if (id.value === MAX_UNIT_COUNT) {
            return null;
        }

        const unit = this.m_units[id.value]!;
        this.iterate(id, flag);

        return unit.m_userData;
    }

    /** @addr{Inlined} */
    private iterate(iter: { value: number }, flag: Readonly<BoxColFlag>): void {
        while (++iter.value < this.m_maxID) {
            if (this.m_units[iter.value]!.m_flag.on(flag.bits)) {
                return;
            }
        }

        iter.value = MAX_UNIT_COUNT;
    }

    /** @addr{0x80786134} */
    private insert(
        radius: number,
        maxSpeed: number,
        pos: Readonly<Vector3f>,
        flag: Readonly<BoxColFlag>,
        userData: unknown,
    ): BoxColUnit | null {
        if (this.m_unitCount >= MAX_UNIT_COUNT) {
            return null;
        }

        const hp = this.m_highPoints;
        const lp = this.m_lowPoints;

        const unitID = this.m_nextUnitID;
        const unit = this.m_unitPool[unitID]!;
        unit.init(radius, maxSpeed, pos, flag, userData);
        this.m_nextUnitID = this.m_unitIDs[unitID]!;
        const range = fr(radius + maxSpeed);
        const zHigh = fr(pos.z + range);
        const zLow = fr(pos.z - range);

        if (this.m_unitCount === 0) {
            hp[0]!.lowPoint = 0;
            hp[0]!.minLowPoint = 0;
            lp[0]!.unitID = u8(unitID);
            hp[0]!.z = zHigh;
            lp[0]!.highPoint = 0;
            lp[0]!.unitID = u8(unitID);
            lp[0]!.z = zLow;
            this.m_unitPool[0]!.m_highPointIdx = 0;
            this.m_unitPool[0]!.m_lowPointIdx = 0;
            this.m_unitCount = 1;

            return unit;
        }

        // Binary search
        let highPointIdx = 0;
        let lowPointIdx = 0;
        let i = this.m_unitCount;

        while (true) {
            const highSearch = highPointIdx + i;
            const lowSearch = lowPointIdx + i;

            if (highSearch <= this.m_unitCount && zHigh > hp[highSearch - 1]!.z) {
                highPointIdx = highSearch;
            }

            if (lowSearch <= this.m_unitCount && zLow > lp[lowSearch - 1]!.z) {
                lowPointIdx = lowSearch;
            }

            if (i === 1) {
                break;
            }

            i = Math.trunc((i + 1) / 2);
        }

        unit.m_highPointIdx = s16(highPointIdx);
        unit.m_lowPointIdx = s16(lowPointIdx);

        // Update high points
        for (let i = this.m_unitCount; i > highPointIdx; --i) {
            const high = hp[i]!;
            high.copy(hp[i - 1]!);
            const low = lp[high.lowPoint]!;

            low.highPoint = u8(low.highPoint + 1);
            const lowUnit = this.m_unitPool[low.unitID]!;
            lowUnit.m_highPointIdx = s16(lowUnit.m_highPointIdx + 1);

            if (high.minLowPoint >= lowPointIdx) {
                high.minLowPoint = u8(high.minLowPoint + 1);
            }
        }

        hp[highPointIdx]!.lowPoint = u8(lowPointIdx);
        hp[highPointIdx]!.z = zHigh;

        // Update min low point
        if (highPointIdx === this.m_unitCount || hp[highPointIdx + 1]!.minLowPoint > lowPointIdx) {
            hp[highPointIdx]!.minLowPoint = u8(lowPointIdx);

            for (let i = highPointIdx - 1; i >= 0 && hp[i]!.minLowPoint > lowPointIdx; --i) {
                hp[i]!.minLowPoint = u8(lowPointIdx);
            }
        } else {
            hp[highPointIdx]!.minLowPoint = hp[highPointIdx + 1]!.minLowPoint;
        }

        // Update low points
        for (let i = this.m_unitCount; i > lowPointIdx; --i) {
            const low = lp[i]!;
            low.copy(lp[i - 1]!);
            const high = hp[low.highPoint]!;
            high.lowPoint = u8(high.lowPoint + 1);
            const lowUnit = this.m_unitPool[low.unitID]!;
            lowUnit.m_lowPointIdx = s16(lowUnit.m_lowPointIdx + 1);
        }

        lp[lowPointIdx]!.highPoint = u8(highPointIdx);
        lp[lowPointIdx]!.unitID = u8(unitID);
        lp[lowPointIdx]!.z = zLow;
        ++this.m_unitCount;

        return unit;
    }

    /** @addr{0x807868C0} */
    private searchImplUnit(unit: BoxColUnit, flag: Readonly<BoxColFlag>): void {
        if (unit.m_flag.offBit(eBoxColFlag.Active)) {
            return;
        }

        const hp = this.m_highPoints;
        const lp = this.m_lowPoints;

        let highPointIdx = unit.m_highPointIdx;
        let lowPointIdx = unit.m_lowPointIdx;
        const origLowPointIdx = unit.m_lowPointIdx;

        const highZPos = hp[highPointIdx]!.z;
        const lowZPos = lp[origLowPointIdx]!.z;

        const xMax = unit.m_xMax;
        const xMin = unit.m_xMin;

        const pos = unit.m_pos!;
        const radius = unit.m_radius;

        const zHigh = fr(pos.z + radius);
        const zLow = fr(pos.z - radius);
        const xHigh = fr(pos.x + radius);
        const xLow = fr(pos.x - radius);

        const maxIdx = this.m_unitCount - 1;

        this.m_maxID = 0;
        this.m_cacheQueryUnit = unit;
        this.m_cacheRadius = -1.0;
        this.m_cacheFlag.copy(flag);

        for (; highPointIdx > 7 && hp[highPointIdx - 8]!.z >= lowZPos; ) {
            highPointIdx -= 8;
        }

        for (; highPointIdx > 0 && hp[highPointIdx - 1]!.z >= lowZPos; ) {
            --highPointIdx;
        }

        for (; lowPointIdx < maxIdx - 7 && lp[lowPointIdx + 8]!.z <= highZPos; ) {
            lowPointIdx += 8;
        }

        for (; lowPointIdx < maxIdx && lp[lowPointIdx + 1]!.z <= highZPos; ) {
            ++lowPointIdx;
        }

        const minLowPoint = hp[highPointIdx]!.minLowPoint;

        for (let i = lowPointIdx; i >= minLowPoint; --i, --lowPointIdx) {
            const low = lp[i]!;

            if (low.highPoint >= highPointIdx && lowPointIdx !== origLowPointIdx) {
                const lowUnit = this.m_unitPool[low.unitID]!;

                if (lowUnit.m_xMax < xMin || lowUnit.m_xMin > xMax) {
                    continue;
                }

                if (
                    lowUnit.m_flag.off(flag.bits) ||
                    lowUnit.m_flag.onBit(eBoxColFlag.Intangible)
                ) {
                    continue;
                }

                const radius = lowUnit.m_radius;
                const lpos = lowUnit.m_pos!;
                if (fr(lpos.z + radius) < zLow || fr(lpos.z - radius) > zHigh) {
                    continue;
                }

                if (fr(lpos.x + radius) < xLow || fr(lpos.x - radius) > xHigh) {
                    continue;
                }

                this.m_units[this.m_maxID++] = lowUnit;

                if (this.m_maxID === MAX_UNIT_COUNT) {
                    break;
                }
            }

            if (lowPointIdx === 0) {
                break;
            }
        }
    }

    /** @addr{0x80786C60} */
    private searchImplSphere(
        radius: number,
        pos: Readonly<Vector3f>,
        flag: Readonly<BoxColFlag>,
    ): void {
        const hp = this.m_highPoints;
        const lp = this.m_lowPoints;

        // Binary search
        let highPointIdx = 0;
        let lowPointIdx = 0;
        const zHigh = fr(pos.z + radius);
        const zLow = fr(pos.z - radius);
        const xHigh = fr(pos.x + radius);
        const xLow = fr(pos.x - radius);

        this.m_maxID = 0;
        this.m_cacheQueryUnit = null;
        this.m_cachePoint.copy(pos);
        this.m_cacheRadius = radius;
        this.m_cacheFlag.copy(flag);

        let i = this.m_unitCount - 1;
        while (true) {
            const highSearch = highPointIdx + i;
            const lowSearch = lowPointIdx + i;
            if (highSearch <= this.m_unitCount && zLow > hp[highSearch - 1]!.z) {
                highPointIdx = highSearch;
            }

            if (lowSearch <= this.m_unitCount && zHigh >= lp[lowSearch]!.z) {
                lowPointIdx = lowSearch;
            }

            if (i === 1) {
                break;
            }

            i = Math.trunc((i + 1) / 2);
        }

        const minLowPoint = hp[highPointIdx]!.minLowPoint;

        for (i = lowPointIdx; i >= minLowPoint; --i, --lowPointIdx) {
            const low = lp[i]!;
            if (low.highPoint >= highPointIdx) {
                const unit = this.m_unitPool[low.unitID]!;

                if (unit.m_xMax < xLow || unit.m_xMin > xHigh) {
                    continue;
                }

                if (unit.m_flag.off(flag.bits) || unit.m_flag.onBit(eBoxColFlag.Intangible)) {
                    continue;
                }

                this.m_units[this.m_maxID++] = unit;

                if (this.m_maxID === MAX_UNIT_COUNT) {
                    break;
                }
            }

            if (lowPointIdx === 0) {
                break;
            }
        }
    }
}
