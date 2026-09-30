/** Port of Kinoko source/game/item/ItemInventory.{hh,cc}. */

import { ItemId } from './ItemId';

const MUSHROOM_COUNT = 3;

export class ItemInventory {
    private m_currentId: ItemId = ItemId.NONE;
    private m_currentCount = 0;

    /** @addr{0x807BC940} */
    setItem(id: ItemId): void {
        this.m_currentId = id;
        this.m_currentCount = MUSHROOM_COUNT;
    }

    /** @addr{0x807BC97C} */
    useItem(count: number): void {
        this.m_currentCount -= count;
        if (this.m_currentCount > 0) {
            return;
        }

        this.clear();
    }

    /** @addr{0x807BC9C0} */
    clear(): void {
        this.m_currentId = ItemId.NONE;
        this.m_currentCount = 0;
    }

    currentCount(): number {
        return this.m_currentCount;
    }

    id(): ItemId {
        return this.m_currentId;
    }
}
