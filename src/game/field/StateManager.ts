/** Port of Kinoko source/game/field/StateManager.hh. */

export interface StateManagerEntry<T> {
    id: number;
    onEnter: (obj: T) => void;
    onCalc: (obj: T) => void;
}

/** `StateEntry<T, &T::Enter, &T::Calc>(id)` */
export function StateEntry<T>(
    id: number,
    enter: (obj: T) => void,
    calc: (obj: T) => void,
): StateManagerEntry<T> {
    return { id, onEnter: enter, onCalc: calc };
}

/** Base class that represents different "states" for an object. */
export abstract class StateManager<T> {
    protected m_currentStateId: number; // u16
    protected m_nextStateId: number; // s32
    protected m_currentFrame: number; // u32
    protected m_entryIds: number[];
    protected m_entries: readonly StateManagerEntry<T>[];
    protected m_obj: T;

    /** @param obj The owning object; pass null to use `this` (C++ passes `this` from a subclass). */
    protected constructor(obj: T | null, entries: readonly StateManagerEntry<T>[]) {
        this.m_currentStateId = 0;
        this.m_nextStateId = -1;
        this.m_currentFrame = 0;
        this.m_entries = entries;
        this.m_obj = obj ?? (this as unknown as T);

        // The base game initializes all entries to 0xffff, possibly to avoid an uninitialized value
        this.m_entryIds = new Array<number>(entries.length).fill(0xffff);

        for (let i = 0; i < this.m_entryIds.length; ++i) {
            this.m_entryIds[this.m_entries[i]!.id] = i;
        }
    }

    protected calc(): void {
        if (this.m_nextStateId >= 0) {
            this.m_currentStateId = this.m_nextStateId & 0xffff;
            this.m_nextStateId = -1;
            this.m_currentFrame = 0;

            const enterFunc = this.m_entries[this.m_entryIds[this.m_currentStateId]!]!.onEnter;
            enterFunc(this.m_obj);
        } else {
            this.m_currentFrame = (this.m_currentFrame + 1) >>> 0;
        }

        const calcFunc = this.m_entries[this.m_entryIds[this.m_currentStateId]!]!.onCalc;
        calcFunc(this.m_obj);
    }
}
