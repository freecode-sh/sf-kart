/** Port of Kinoko source/game/field/ObjectHitTable.{hh,cc}. */

import { box } from '../../egg/core/Box';
import { RamStream } from '../../egg/util/Stream';
import type { Reaction } from '../kart/KartCollide';
import { ArchiveId, ResourceManager } from '../system/ResourceManager';
import type { ObjectId } from './obj/ObjectId';

const SLOT_COUNT = 0x2f4;

export class ObjectHitTable {
    private m_count = 0;
    private m_fieldCount = 0;
    private m_reactions: number[] = [];
    private m_slots: number[] = [];
    private m_loaded: boolean;

    /**
     * @addr{0x807F9278}
     * TS deviation: a missing file (Core archives of our generated, object-free courses) leaves
     * the table empty; any lookup then throws.
     */
    constructor(filename: string) {
        const size = box(0);
        const file = ResourceManager.Instance()!.getFile(filename, size, ArchiveId.Core);
        this.m_loaded = file !== null;
        if (!file) {
            return;
        }

        const stream = new RamStream(file, size.value);

        this.m_count = stream.read_s16();
        this.m_fieldCount = stream.read_s16();
        this.m_reactions = new Array<number>(this.m_count).fill(0);

        for (let i = 0; i < this.m_reactions.length; ++i) {
            stream.skip(0x2);
            this.m_reactions[i] = stream.read_s16();
            stream.skip(this.m_fieldCount * 2 - 2);
        }

        // m_slots = reinterpret_cast<const s16 *>(stream.dataAtIndex());
        const slots = stream.dataAtIndex();
        const view = new DataView(slots.buffer, slots.byteOffset, slots.byteLength);
        for (let i = 0; i < SLOT_COUNT; ++i) {
            this.m_slots.push(view.getInt16(i * 2, false));
        }
    }

    reaction(i: number): Reaction {
        if (!this.m_loaded) {
            throw new Error('ObjectHitTable: hit table is not in the Core archive');
        }
        if (i === -1 || i >= this.m_count) {
            throw new Error(`ObjectHitTable::reaction: invalid slot ${i}`);
        }
        return this.m_reactions[i]! as Reaction;
    }

    slot(id: ObjectId): number {
        if (!this.m_loaded) {
            throw new Error('ObjectHitTable: hit table is not in the Core archive');
        }
        const i = id as number;
        return i < SLOT_COUNT ? this.m_slots[i]! : -1;
    }
}
