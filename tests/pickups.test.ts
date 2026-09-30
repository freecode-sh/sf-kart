/**
 * Speed-up pickups store a speed-up (rules/pickups.ts storeSpeedUp) in the engine's item stock: one
 * more per pickup, never past three, and the item button's uses take them away again.
 */

import { describe, expect, it } from 'vitest';
import { ItemId } from '../src/game/item/ItemId';
import { ItemInventory } from '../src/game/item/ItemInventory';
import { MAX_SPEED_UPS, storeSpeedUp } from '../src/app/rules/pickups';

/** A stock holding `n` speed-ups, the way the engine gets there (a triple, then uses). */
function stock(n: number): ItemInventory {
    const inv = new ItemInventory();
    if (n > 0) {
        inv.setItem(ItemId.TRIPLE_MUSHROOM);
        if (n < 3) inv.useItem(3 - n);
    }
    return inv;
}

describe('storeSpeedUp', () => {
    it('adds one speed-up to an empty stock', () => {
        const inv = stock(0);
        expect(inv.id()).toBe(ItemId.NONE);
        expect(storeSpeedUp(inv)).toBe(true);
        expect(inv.currentCount()).toBe(1);
        expect(inv.id()).toBe(ItemId.TRIPLE_MUSHROOM);
    });

    it('adds one to a partial stock', () => {
        const inv = stock(1);
        expect(storeSpeedUp(inv)).toBe(true);
        expect(inv.currentCount()).toBe(2);
        expect(storeSpeedUp(inv)).toBe(true);
        expect(inv.currentCount()).toBe(MAX_SPEED_UPS);
    });

    it('adds nothing to a full stock', () => {
        const inv = stock(3);
        expect(storeSpeedUp(inv)).toBe(false);
        expect(inv.currentCount()).toBe(3);
        expect(inv.id()).toBe(ItemId.TRIPLE_MUSHROOM);
    });

    it('refills what the item button used', () => {
        const inv = stock(3);
        // The item button: one speed-up per press (KartItem.calc), down to none.
        for (let n = 2; n >= 0; --n) {
            inv.useItem(1);
            expect(inv.currentCount()).toBe(n);
        }
        expect(inv.id()).toBe(ItemId.NONE);
        for (let n = 1; n <= 3; ++n) {
            expect(storeSpeedUp(inv)).toBe(true);
            expect(inv.currentCount()).toBe(n);
        }
        expect(storeSpeedUp(inv)).toBe(false);
        inv.useItem(1);
        expect(storeSpeedUp(inv)).toBe(true);
        expect(inv.currentCount()).toBe(3);
    });
});
