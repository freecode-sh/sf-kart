/**
 * Port of Kinoko's game/kart/KartObjectManager.{hh,cc}.
 * Responsible for the lifecycle and calculation of KartObjects.
 */

import { Vector3f } from '../../egg/math/Vector';

import { RaceConfig } from '../system/RaceConfig';

import { KartObject } from './KartObject';
import { KartObjectProxy, LinkKartObjectProxy } from './KartObjectProxy';
import { KartParamFileManager } from './KartParamFileManager';

/** Placeholder for Abstract::g3d::ResAnmChr (scale animations are not loaded in this port). */
export type ResAnmChr = unknown;

/** @addr{0x809C18F8} */
let s_instance: KartObjectManager | null = null;

// TS-only: late-bind this singleton for KartObjectProxy::apply (see KartObjectProxy.ts).
LinkKartObjectProxy({ kartObjectManager: () => KartObjectManager.Instance() });

export class KartObjectManager {
    private m_count: number;
    private m_objects: KartObject[];

    /** @addr{0x809C18A0} */
    private static s_thunderScaleUpAnmChr: ResAnmChr | null = null;
    /** @addr{0x809C18A4} */
    private static s_thunderScaleDownAnmChr: ResAnmChr | null = null;
    /** @addr{0x809C18B0} */
    private static s_pressScaleUpAnmChr: ResAnmChr | null = null;

    /** @addr{0x8058FEE0} */
    init(): void {
        for (let i = 0; i < this.m_count; ++i) {
            this.m_objects[i]!.initImpl();
            this.m_objects[i]!.prepare();
        }
    }

    /** @addr{0x8058FFE8} */
    calc(): void {
        for (let i = 0; i < this.m_count; ++i) {
            const object = this.m_objects[i]!;
            object.collide().setTangentOff(Vector3f.zero.clone());
            object.collide().setMovement(Vector3f.zero.clone());
        }

        for (let i = 0; i < this.m_count; ++i) {
            const object = this.m_objects[i]!;
            object.calcSub();
            object.calc();
        }
    }

    /** @addr{0x80590100} */
    object(i: number): KartObject {
        if (i >= this.m_count) throw new Error('KartObjectManager: index out of range');
        return this.m_objects[i]!;
    }

    /** @addr{0x8058FAA8} */
    static CreateInstance(): KartObjectManager {
        if (s_instance) throw new Error('KartObjectManager already created');
        s_instance = new KartObjectManager();
        return s_instance;
    }

    /** @addr{0x8058FAF8} */
    static DestroyInstance(): void {
        if (!s_instance) throw new Error('KartObjectManager not created');
        const instance = s_instance;
        s_instance = null;
        instance.destroy();
    }

    static ThunderScaleUpAnmChr(): ResAnmChr | null {
        return KartObjectManager.s_thunderScaleUpAnmChr;
    }

    static ThunderScaleDownAnmChr(): ResAnmChr | null {
        return KartObjectManager.s_thunderScaleDownAnmChr;
    }

    static PressScaleUpAnmChr(): ResAnmChr | null {
        return KartObjectManager.s_pressScaleUpAnmChr;
    }

    static Instance(): KartObjectManager {
        return s_instance!;
    }

    /** @addr{0x8058FB2C} */
    private constructor() {
        const raceScenario = RaceConfig.Instance().raceScenario();
        this.m_count = raceScenario.playerCount;
        this.m_objects = [];
        KartParamFileManager.CreateInstance();

        this.loadScaleAnimations();

        for (let i = 0; i < this.m_count; ++i) {
            const player = raceScenario.players[i]!;
            const object = KartObject.Create(player.character, player.vehicle, i);
            object.createModel();
            this.m_objects[i] = object;
        }
    }

    /** @addr{0x8058FDD4} Destructor equivalent. */
    private destroy(): void {
        if (s_instance) {
            s_instance = null;
        }

        KartParamFileManager.DestroyInstance();

        this.m_objects = [];

        KartObjectManager.s_thunderScaleUpAnmChr = null;
        KartObjectManager.s_thunderScaleDownAnmChr = null;
        KartObjectManager.s_pressScaleUpAnmChr = null;

        KartObjectProxy.proxyList().length = 0;
    }

    /**
     * @addr{0x8056AB6C}
     * STUB: Kinoko loads thunder_scale_up / thunder_scale_down / press_scale_up from driver.brres.
     * They are only used for shock/crush scaling, which is not ported; the statics stay null.
     */
    private loadScaleAnimations(): void {}
}
