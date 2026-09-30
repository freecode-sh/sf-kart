/** Port of Kinoko source/game/kart/KartBoost.{hh,cc}. */

import { fr } from '../../egg/math/Math';

/** C++ `KartBoost::Type`. Also reachable as `KartBoost.Type`. */
export enum Type {
    AllMt = 0,
    MushroomAndBoostPanel = 1,
    TrickAndZipper = 2,
    Max = 3,
}

// We need to evaluate this expression early for the array initialization
const BOOST_TYPE_COUNT = Type.Max as number;

const MULTIPLIERS: readonly number[] = [fr(0.2), fr(0.4), fr(0.3)];
const ACCELERATIONS: readonly number[] = [3.0, 7.0, 6.0];
const LIMITS: readonly number[] = [-1.0, 115.0, -1.0];

/** State management for boosts (start boost, mushrooms, mini-turbos) */
export class KartBoost {
    static readonly Type = Type;

    /** Durations for the different boost types. (s16) */
    private m_timers: number[];
    /** Whether the different boost types are active. */
    private m_active: boolean[];
    /** Multiplier applied to vehicle speed. */
    private m_multiplier: number;
    private m_acceleration: number;
    private m_speedLimit: number;

    /** @addr{0x80588D28} */
    constructor() {
        this.m_timers = new Array<number>(BOOST_TYPE_COUNT).fill(0);
        this.m_active = new Array<boolean>(BOOST_TYPE_COUNT).fill(false);
        this.m_multiplier = 1.0;
        this.m_acceleration = 1.0;
        this.m_speedLimit = -1.0;
    }

    /**
     * @addr{0x80588DB0}
     * Starts/restarts a boost of the given type. Returns whether the boost was activated.
     */
    activate(type: Type, frames: number): boolean {
        let activated = false;

        const t = type as number;
        if (!this.m_active[t] || this.m_timers[t]! < frames) {
            this.m_timers[t] = frames;
            activated = true;
            this.m_active[t] = true;
        }

        return activated;
    }

    /**
     * @addr{0x80588E24}
     * Computes the current frame's boost multiplier, acceleration, and speed limit.
     * Returns whether a boost is active.
     */
    calc(): boolean {
        this.m_multiplier = 1.0;
        this.m_acceleration = 1.0;
        this.m_speedLimit = -1.0;

        for (let i = 0; i < BOOST_TYPE_COUNT; ++i) {
            if (!this.m_active[i]) {
                continue;
            }

            this.m_multiplier = fr(1.0 + MULTIPLIERS[i]!);
            this.m_acceleration = ACCELERATIONS[i]!;
            this.m_speedLimit = LIMITS[i]!;

            this.m_timers[i] = ((this.m_timers[i]! - 1) << 16) >> 16;
            if (this.m_timers[i]! <= 0) {
                this.m_active[i] = false;
            }
        }

        return this.m_multiplier > 1.0 || this.m_speedLimit > 0.0;
    }

    /** @addr{0x80588D74} */
    reset(): void {
        this.m_timers.fill(0);
        this.m_multiplier = 1.0;
        this.m_acceleration = 1.0;
        this.m_speedLimit = -1.0;
    }

    /** @addr{0x80588E18} */
    resetActive(): void {
        this.m_active.fill(false);
    }

    multiplier(): number {
        return this.m_multiplier;
    }

    acceleration(): number {
        return this.m_acceleration;
    }

    speedLimit(): number {
        return this.m_speedLimit;
    }
}
