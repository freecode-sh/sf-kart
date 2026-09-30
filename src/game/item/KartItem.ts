/**
 * Port of Kinoko source/game/item/KartItem.{hh,cc}. State management for item usage.
 *
 * Module-cycle note: KartItem extends KartObjectProxy, and the kart modules import ItemDirector
 * (which instantiates KartItem). To avoid a TDZ error when KartObjectProxy's module graph is
 * evaluated first, the class is defined lazily on first use (`KartItemClass()`). `KartItem` is
 * exported as the instance type.
 */

import { TBitFlag } from '../../egg/core/BitFlag';
import { KartObjectProxy } from '../kart/KartObjectProxy';
import { eStatus } from '../kart/Status';
import { RaceManager, Stage } from '../system/RaceManager';
import { ItemId } from './ItemId';
import { ItemInventory } from './ItemInventory';

enum eFlags {
    Lockout = 10,
    ItemButtonHold = 12,
    ItemButtonActivation = 14,
}

function defineKartItem() {
    return class KartItem extends KartObjectProxy {
        private m_flags = new TBitFlag<eFlags>();
        private m_inventory = new ItemInventory();

        /** @addr{0x8079754C} */
        constructor() {
            super();
            this.m_flags.makeAllZero();
        }

        /** @addr{0x807976E0} */
        init(playerIdx: number): void {
            this.apply(playerIdx);
        }

        /**
         * Calculates item activation based on the controller input state
         * @addr{0x80797928}
         */
        calc(): void {
            const prevButton = this.m_flags.onBit(eFlags.ItemButtonHold);
            this.m_flags.resetBit(eFlags.ItemButtonHold, eFlags.ItemButtonActivation);

            const currentInputs = this.inputs().currentState();
            if (currentInputs.item()) {
                this.m_flags
                    .setBit(eFlags.ItemButtonHold)
                    .changeBit(!prevButton, eFlags.ItemButtonActivation);
            }

            const status = this.status();

            if (this.m_flags.onBit(eFlags.Lockout)) {
                if (
                    status.offBit(
                        eStatus.BeforeRespawn,
                        eStatus.InAction,
                        eStatus.TriggerRespawn,
                        eStatus.CannonStart,
                        eStatus.InCannon,
                        eStatus.AfterCannon,
                    )
                ) {
                    this.m_flags.resetBit(eFlags.Lockout);
                }
            } else {
                if (
                    status.onBit(
                        eStatus.InRespawn,
                        eStatus.InAction,
                        eStatus.TriggerRespawn,
                        eStatus.CannonStart,
                        eStatus.InCannon,
                    )
                ) {
                    this.m_flags.setBit(eFlags.Lockout);
                } else {
                    const raceMgr = RaceManager.Instance()!;
                    let canUse = this.m_flags.onBit(eFlags.ItemButtonActivation);
                    canUse = canUse && raceMgr.isStageReached(Stage.Race);
                    canUse = canUse && status.offBit(eStatus.InAction, eStatus.Burnout);
                    canUse = canUse && this.m_inventory.id() !== ItemId.NONE;

                    if (canUse) {
                        // For now, assume only time trials are valid and use a mushroom
                        this.useMushroom();
                    }
                }
            }
        }

        /** @addr{0x80798848} */
        clear(): void {
            if (this.m_inventory.id() !== ItemId.NONE) {
                this.m_inventory.clear();
            }
        }

        /** @addr{0x8079864C} */
        activateMushroom(): void {
            this.move().activateMushroom();
        }

        /** @addr{0x807A9D3C} */
        useMushroom(): void {
            this.activateMushroom();
            this.m_inventory.useItem(1);
        }

        inventory(): ItemInventory {
            return this.m_inventory;
        }
    };
}

export type KartItem = InstanceType<ReturnType<typeof defineKartItem>>;

let s_KartItemClass: ReturnType<typeof defineKartItem> | null = null;

/** Returns the KartItem class, defining it on first use. */
export function KartItemClass(): ReturnType<typeof defineKartItem> {
    if (!s_KartItemClass) {
        s_KartItemClass = defineKartItem();
    }
    return s_KartItemClass;
}
