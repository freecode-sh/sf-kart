/** Port of Kinoko source/game/system/KPadDirector.{hh,cc}. */

import { KPadGhostController, KPadHostController, KPadPlayer } from './KPadController';

let s_instance: KPadDirector | null = null; ///< @addr{0x809BD70C}

/**
 * The highest level abstraction for controller processing.
 * @addr{0x809BD70C}
 */
export class KPadDirector {
    private m_playerInput: KPadPlayer;
    private m_ghostController: KPadGhostController;
    private m_hostController: KPadHostController;

    /** @addr{0x805238F0} */
    calc(): void {
        this.calcPads();
        this.m_playerInput.calc();
    }

    /** @addr{0x805237E8} */
    calcPads(): void {
        this.m_ghostController.calc();
        this.m_hostController.calc();
    }

    /** @addr{0x80523724} */
    clear(): void {}

    /** @addr{0x80523690} */
    reset(): void {
        this.m_playerInput.reset();
    }

    /** @addr{0x80524580} */
    startGhostProxies(): void {
        this.m_playerInput.startGhostProxy();
    }

    /** @addr{0x805245DC} */
    endGhostProxies(): void {
        this.m_playerInput.endGhostProxy();
    }

    playerInput(): KPadPlayer {
        return this.m_playerInput;
    }

    hostController(): KPadHostController {
        return this.m_hostController;
    }

    /** @addr{0x8052453C} */
    setGhostPad(inputs: Uint8Array | null, driftIsAuto: boolean): void {
        this.m_playerInput.setGhostController(this.m_ghostController, inputs, driftIsAuto);
    }

    setHostPad(driftIsAuto: boolean): void {
        this.m_playerInput.setHostController(this.m_hostController, driftIsAuto);
    }

    /** @addr{0x8052313C} */
    static CreateInstance(): KPadDirector {
        if (s_instance) throw new Error('KPadDirector already exists');
        return (s_instance = new KPadDirector());
    }

    /** @addr{0x8052318C} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): KPadDirector {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x805232F0} */
    private constructor() {
        this.m_playerInput = new KPadPlayer();
        this.m_ghostController = new KPadGhostController();
        this.m_hostController = new KPadHostController();
    }
}
