/**
 * Port of Kinoko source/game/scene/RaceScene.{hh,cc} (plus the GameScene parts that drive it:
 * enter/initScene/calc/exit). Scene/heap plumbing (EGG::Scene, SceneManager, heaps, ScopeLock)
 * is dropped.
 */

import { BoxColManager } from '../field/BoxColManager';
import { CollisionDirector } from '../field/CollisionDirector';
import { JugemDirector } from '../field/jugem/JugemDirector';
import { ObjectDirector } from '../field/ObjectDirector';
import { RailManager } from '../field/RailManager';
import { ItemDirector } from '../item/ItemDirector';
import { KartObjectManager } from '../kart/KartObjectManager';
import { KartCamera } from '../render/KartCamera';
import { CourseMap } from '../system/CourseMap';
import { KPadDirector } from '../system/KPadDirector';
import { RaceConfig } from '../system/RaceConfig';
import { RaceManager } from '../system/RaceManager';
import { ResourceManager } from '../system/ResourceManager';

/** Represents an instance of a race */
export class RaceScene {
    // ---- GameScene ----

    /** @addr{0x8051A1E0} GameScene::calc: pads, engines, then camera. */
    calc(): void {
        KPadDirector.Instance()!.calc();
        this.calcEngines();
        RaceScene.calcCamera();
    }

    /** GameScene::enter */
    enter(): void {
        this.configure();
        this.initScene();
    }

    /** GameScene::exit (resources stay registered in the in-memory ResourceManager). */
    exit(): void {
        this.deinitScene();
        this.unmountResources();
    }

    /** GameScene::reinit (restarts the race with the same configuration). */
    reinit(): void {
        this.exit();
        this.onReinit();
        this.initScene();
    }

    /** GameScene::initCamera */
    static initCamera(): void {
        KartCamera.Instance()!.init();
    }

    /** @addr{0x805A1AF0} GameScene::calcCamera */
    static calcCamera(): void {
        KartCamera.Instance()!.calc();
    }

    /** @addr{0x8051A4DC} GameScene::initScene */
    initScene(): void {
        this.createEngines();
        KPadDirector.Instance()!.reset();
        this.initEngines();
    }

    /** GameScene::deinitScene */
    deinitScene(): void {
        this.destroyEngines();
        KPadDirector.Instance()!.clear();
    }

    /** GameScene::unmountResources */
    unmountResources(): void {
        // In-memory archives persist; nothing to unmount.
    }

    // ---- RaceScene ----

    /** @addr{0x80554208} */
    createEngines(): void {
        KartCamera.CreateInstance();
        CourseMap.CreateInstance().init();
        RaceManager.CreateInstance();
        BoxColManager.CreateInstance();
        JugemDirector.CreateInstance();
        KartObjectManager.CreateInstance();
        CollisionDirector.CreateInstance();
        ItemDirector.CreateInstance();
        RailManager.CreateInstance();
        ObjectDirector.CreateInstance();
    }

    /** @addr{0x8055472C} */
    initEngines(): void {
        KartObjectManager.Instance()!.init();
        RaceScene.initCamera();
        RaceManager.Instance()!.init();
        ItemDirector.Instance()!.init();
        ObjectDirector.Instance()!.init();
        JugemDirector.Instance()!.init();
    }

    /**
     * @addr{0x80554E6C}
     * In Kinoko, it is not possible to pause the race scene, so this is really the base game's
     * `calcEnginesUnpaused` located at `0x80554AD4`.
     */
    calcEngines(): void {
        const raceMgr = RaceManager.Instance()!;
        raceMgr.calc();
        BoxColManager.Instance()!.calc();
        ObjectDirector.Instance()!.calc();
        KartObjectManager.Instance()!.calc();
        JugemDirector.Instance()!.calc();
        ItemDirector.Instance()!.calc();
        raceMgr.random().next();
    }

    /** @addr{0x805549B0} */
    destroyEngines(): void {
        KPadDirector.Instance()!.endGhostProxies();
        KartCamera.DestroyInstance();
        KartObjectManager.DestroyInstance();
        JugemDirector.DestroyInstance();
        ObjectDirector.DestroyInstance();
        RailManager.DestroyInstance();
        CollisionDirector.DestroyInstance();
        ItemDirector.DestroyInstance();
        BoxColManager.DestroyInstance();
        RaceManager.DestroyInstance();
        CourseMap.DestroyInstance();
    }

    /**
     * Retrieves Common.szs and the course archive.
     * @addr{0x80553C50}
     */
    configure(): void {
        const raceCfg = RaceConfig.Instance()!;
        const resMgr = ResourceManager.Instance()!;

        raceCfg.initRace();

        resMgr.load(0, null);
        resMgr.load(raceCfg.raceScenario().course);
    }

    /**
     * This is called on race shutdown in order to prep for the next race.
     * @addr{0x80554A94}
     */
    onReinit(): void {
        this.configure();
    }
}
