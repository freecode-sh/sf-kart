/** Port of Kinoko source/game/field/jugem/JugemDirector.{hh,cc}. */

import { KartObjectManager } from '../../kart/KartObjectManager';
import { JugemUnit } from './JugemUnit';

let s_instance: JugemDirector | null = null; ///< @addr{0x809C28B8}

/** Manager class for the lifecycle of Jugem objects for players. */
export class JugemDirector {
    /** Assumes 1 Lakitu because 1 player */
    private m_unit: JugemUnit | null;

    /** @addr{0x8071E638} */
    init(): void {
        this.createUnits();
        this.m_unit!.init();
    }

    /** @addr{8071E6C0} */
    calc(): void {
        this.m_unit!.calc();
    }

    /** @addr{0x8071E270} */
    static CreateInstance(): JugemDirector {
        if (s_instance) throw new Error('JugemDirector already exists');
        s_instance = new JugemDirector();
        return s_instance;
    }

    /** @addr{0x809C28B8} */
    static Instance(): JugemDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8071E2FC} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    /** @addr{0x8071E330} */
    private constructor() {
        this.m_unit = null;
    }

    /** @addr{0x8071E480} */
    private createUnits(): void {
        // Assumes one unit
        const kartObj = KartObjectManager.Instance()!.object(0);
        this.m_unit = new JugemUnit(kartObj);

        this.m_unit.createSwitchRace();
    }
}
