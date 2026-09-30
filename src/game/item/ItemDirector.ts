/** Port of Kinoko source/game/item/ItemDirector.{hh,cc}. */

import { RaceConfig } from '../system/RaceConfig';
import { ItemId } from './ItemId';
import type { ItemInventory } from './ItemInventory';
import { type KartItem, KartItemClass } from './KartItem';

let s_instance: ItemDirector | null = null; ///< @addr{0x809C3618}

/** @addr{0x809C3618} */
export class ItemDirector {
    private m_karts: KartItem[];

    /** @addr{0x80799794} */
    init(): void {
        for (const kart of this.m_karts) {
            kart.inventory().setItem(ItemId.TRIPLE_MUSHROOM);
        }
    }

    /** @addr{0x80799850} */
    calc(): void {
        for (const kart of this.m_karts) {
            kart.calc();
        }
    }

    kartItem(idx: number): KartItem {
        return this.m_karts[idx]!;
    }

    itemInventory(idx: number): Readonly<ItemInventory> {
        return this.m_karts[idx]!.inventory();
    }

    /** @addr{0x80799138} */
    static CreateInstance(): ItemDirector {
        if (s_instance) throw new Error('ItemDirector already exists');
        s_instance = new ItemDirector();
        return s_instance;
    }

    /** @addr{0x80799188} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): ItemDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x807992D8} */
    private constructor() {
        const playerCount = RaceConfig.Instance()!.raceScenario().playerCount;
        this.m_karts = [];
        for (let i = 0; i < playerCount; ++i) {
            this.m_karts.push(new (KartItemClass())());
        }

        for (let i = 0; i < playerCount; ++i) {
            this.m_karts[i]!.init(i);
        }
    }
}
