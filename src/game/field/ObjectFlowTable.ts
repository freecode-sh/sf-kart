/** Port of Kinoko source/game/field/ObjectFlowTable.{hh,cc}. */

import { ArchiveId, ResourceManager } from '../system/ResourceManager';
import { ObjectId } from './obj/ObjectId';

/** Maps to SObjectCollisionSet::mode. Determines what type of collision an object has. */
export enum CollisionMode {
    None = 0,
    Sphere = 1,
    Cylinder = 2,
    Box = 3,
    Ground = 4,
    Original = 5,
}

/** sizeof(SObjectCollisionSet) */
const SET_SIZE = 0x74;
/** offsetof(SFile, sets) */
const SETS_OFFSET = 0x2;
const SLOT_COUNT = 0x2f4;

/**
 * Structure of the ObjFlow.bin table entry. Contains dependencies and collision parameters.
 * C++ reads the fields in place with `parse<>`; here they are decoded once.
 */
export class SObjectCollisionSet {
    id = 0; // u16
    name = ''; // char[32]
    resources = ''; // char[64]
    mode = 0; // s16
    /** C++ `params` union: sphere.radius, cylinder.{radius,height} and box.{x,y,z} alias these. */
    params = {
        sphere: { radius: 0 },
        cylinder: { radius: 0, height: 0 },
        box: { x: 0, y: 0, z: 0 },
    };

    static Read(view: DataView, off: number, bytes: Uint8Array): SObjectCollisionSet {
        const set = new SObjectCollisionSet();
        set.id = view.getUint16(off, false);
        set.name = cString(bytes, off + 0x2, 32);
        set.resources = cString(bytes, off + 0x22, 64);
        set.mode = view.getInt16(off + 0x6a, false);
        const p0 = view.getInt16(off + 0x6c, false);
        const p1 = view.getInt16(off + 0x6e, false);
        const p2 = view.getInt16(off + 0x70, false);
        set.params.sphere.radius = p0;
        set.params.cylinder.radius = p0;
        set.params.cylinder.height = p1;
        set.params.box.x = p0;
        set.params.box.y = p1;
        set.params.box.z = p2;
        return set;
    }
}

function cString(bytes: Uint8Array, off: number, max: number): string {
    let s = '';
    for (let i = 0; i < max && bytes[off + i] !== 0; ++i) {
        s += String.fromCharCode(bytes[off + i]!);
    }
    return s;
}

export class ObjectFlowTable {
    private m_count: number;
    private m_sets: SObjectCollisionSet[];
    private m_slots: number[];
    private m_loaded: boolean;

    /**
     * @addr{0x8082C10C}
     * TS deviation: C++ dereferences the Core archive's file unconditionally. Our generated
     * courses boot from a Core archive without ObjFlow.bin (they have no objects), so a missing
     * file leaves the table empty and any lookup throws.
     */
    constructor(filename: string) {
        const file = ResourceManager.Instance()!.getFile(filename, null, ArchiveId.Core);

        this.m_count = 0;
        this.m_sets = [];
        this.m_slots = [];
        this.m_loaded = file !== null;

        if (!file) {
            return;
        }

        const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
        this.m_count = view.getInt16(0, false);
        for (let i = 0; i < this.m_count; ++i) {
            this.m_sets.push(SObjectCollisionSet.Read(view, SETS_OFFSET + i * SET_SIZE, file));
        }
        const slotsOffset = SETS_OFFSET + this.m_count * SET_SIZE;
        for (let i = 0; i < SLOT_COUNT; ++i) {
            this.m_slots.push(view.getInt16(slotsOffset + i * 2, false));
        }
    }

    set(slot: number): SObjectCollisionSet | null {
        this.checkLoaded();
        return slot === -1 ? null : slot < this.m_count ? this.m_sets[slot]! : null;
    }

    slot(id: ObjectId): number {
        this.checkLoaded();
        const i = id as number;
        return i < SLOT_COUNT ? this.m_slots[i]! : -1;
    }

    /** @addr{0x8082C178} */
    getIdFromName(name: string): ObjectId {
        this.checkLoaded();
        for (let i = 0; i < this.m_count; ++i) {
            const curSet = this.set(i)!;

            // strncmp(name, curSet->name, sizeof(curSet->name)) == 0
            if (name.slice(0, 32) === curSet.name) {
                return curSet.id as ObjectId;
            }
        }

        return ObjectId.None;
    }

    private checkLoaded(): void {
        if (!this.m_loaded) {
            throw new Error('ObjectFlowTable: ObjFlow.bin is not in the Core archive');
        }
    }
}
