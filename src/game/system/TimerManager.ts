/** Port of Kinoko source/game/system/TimerManager.{hh,cc}. */

import { fr } from '../../egg/math/Math';

const s16 = (x: number): number => (x << 16) >> 16;

/** A simple struct to represent a lap or race finish time. */
export class Timer {
    min: number; // u16
    sec: number; // u8
    mil: number; // u16
    valid: boolean;

    /**
     * C++ overloads: `Timer()` (zeroed, invalid), `Timer(u16 min, u8 sec, u16 mil)` (valid), and
     * `Timer(u32 data)` (parses an RKG 3-byte time; use Timer.FromData).
     */
    constructor(min_?: number, sec_?: number, mil_?: number) {
        if (min_ === undefined) {
            this.min = 0;
            this.sec = 0;
            this.mil = 0;
            this.valid = false;
        } else {
            this.min = min_ & 0xffff;
            this.sec = sec_! & 0xff;
            this.mil = mil_! & 0xffff;
            this.valid = true;
        }
    }

    /** Parses a time from an RKG's 3 byte time format. */
    static FromData(data: number): Timer {
        const t = new Timer();
        t.min = (data >>> 0x19) & 0xffff;
        t.sec = ((data >>> 0x12) & 0xff) & 0x7f;
        t.mil = ((data >>> 8) & 0xffff) & 0x3ff;
        t.valid = true;
        return t;
    }

    clone(): Timer {
        const t = new Timer();
        t.copy(this);
        return t;
    }

    copy(rhs: Readonly<Timer>): this {
        this.min = rhs.min;
        this.sec = rhs.sec;
        this.mil = rhs.mil;
        this.valid = rhs.valid;
        return this;
    }

    /** C++ `operator<=>`: returns <0, 0, >0. */
    compare(rhs: Readonly<Timer>): number {
        if (this.min !== rhs.min) return this.min < rhs.min ? -1 : 1;
        if (this.sec !== rhs.sec) return this.sec < rhs.sec ? -1 : 1;
        if (this.mil !== rhs.mil) return this.mil < rhs.mil ? -1 : 1;
        if (this.valid !== rhs.valid) return Number(this.valid) - Number(rhs.valid);
        return 0;
    }

    equals(rhs: Readonly<Timer>): boolean {
        return (
            this.min === rhs.min &&
            this.sec === rhs.sec &&
            this.mil === rhs.mil &&
            this.valid === rhs.valid
        );
    }

    /** @addr{0x807EE860} C++ `operator-`. */
    sub(rhs: Readonly<Timer>): Timer {
        let addMin = 0;
        let addSec = 0;

        let newMs = s16(this.mil - rhs.mil);
        if (newMs < 0) {
            addSec = -1;
            newMs = s16(newMs + 1000);
        }

        let newSec = s16(addSec + this.sec - rhs.sec);
        if (newSec < 0) {
            addMin = -1;
            newSec = s16(newSec + 60);
        }

        let newMin = s16(addMin + this.min - rhs.min);
        if (newMin < 0) {
            newMin = 0;
            newSec = 0;
            newMs = 0;
        }

        return new Timer(newMin, newSec, newMs);
    }

    /** C++ `operator+(f32 ms)`. */
    addMs(ms: number): Timer {
        let addMin = 0;
        let addSec = 0;

        let newMs = s16(Math.trunc(fr(ms + fr(this.mil))));
        if (newMs > 999) {
            addSec = 1;
            newMs = s16(newMs - 1000);
        }

        let newSec = s16(addSec + this.sec);
        if (newSec > 59) {
            addMin = 1;
            newSec = s16(newSec - 60);
        }

        let newMin = s16(addMin + this.min);
        if (newMin > 999) {
            newMin = 999;
            newSec = 59;
            newMs = 999;
        }

        return new Timer(newMin, newSec, newMs);
    }
}

const REFRESH_PERIOD = fr(1000.0 / fr(59.94));
const MILLISECONDS_TO_MINUTES = fr(1.0 / 60000.0);
const MILLISECONDS_TO_SECONDS = fr(1.0 / 1000.0);
const SECONDS_TO_MILLISECONDS = 1000.0;
const MINUTES_TO_MILLISECONDS = 60000.0;

/** C++ static_cast<u32>(f32) for non-negative values. */
const f2u32 = (f: number): number => Math.trunc(f) >>> 0;

/** Manages the race timer to create lap splits and final times. */
export class TimerManager {
    private m_currentTimer = new Timer();
    private m_started = false;
    private m_frameCounter = 0;

    /** @addr{Inlined in 0x805327A0} */
    constructor() {
        this.init();
    }

    /** @addr{0x80535864} */
    init(): void {
        this.m_currentTimer.min = 0;
        this.m_currentTimer.sec = 0;
        this.m_currentTimer.mil = 0;
        this.m_currentTimer.valid = true;

        this.m_started = false;
        this.m_frameCounter = 0;
    }

    /** @addr{0x80535904} */
    calc(): void {
        if (!this.m_started) {
            return;
        }

        const minutesMs = f2u32(fr(fr(this.m_frameCounter) * REFRESH_PERIOD));
        const minutes = f2u32(fr(fr(minutesMs) * MILLISECONDS_TO_MINUTES)) & 0xffff;
        const secondsMs = f2u32(fr(fr(minutesMs) - fr(fr(minutes) * MINUTES_TO_MILLISECONDS)));
        const seconds = f2u32(fr(fr(secondsMs) * MILLISECONDS_TO_SECONDS)) & 0xff;
        const milliseconds =
            f2u32(fr(fr(secondsMs) - fr(fr(seconds) * SECONDS_TO_MILLISECONDS))) & 0xffff;

        this.m_currentTimer.min = minutes;
        this.m_currentTimer.sec = seconds;
        this.m_currentTimer.mil = milliseconds;
        this.m_currentTimer.valid = true;

        this.m_frameCounter = (this.m_frameCounter + 1) >>> 0;
    }

    currentTimer(): Readonly<Timer> {
        return this.m_currentTimer;
    }

    setStarted(isSet: boolean): void {
        this.m_started = isSet;
    }
}
