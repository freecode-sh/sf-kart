/**
 * Boots and steps a race the way Kinoko's host does (KReplaySystem / KTestSystem):
 *
 *   RootScene::enter  -> ResourceManager, KPadDirector, RaceConfig created; RaceConfig::init()
 *   RaceScene::enter  -> configure() (RaceConfig::initRace -> init callback -> controllers;
 *                        archives), then initScene() (createEngines, KPadDirector::reset,
 *                        initEngines)
 *   each frame        -> RaceScene::calc (KPadDirector::calc, calcEngines, KartCamera::calc)
 *
 * Frame numbering matches KTestSystem: frame 0 is the state right after init(); frame n is the
 * state after n calls to step().
 *
 * Usage (ghost replay):
 *   const session = new RaceSession();
 *   session.init(files, { type: 'ghost', rkg });
 *   while (!session.isFinished()) session.step();
 *
 * Usage (live play):
 *   session.init(files, { type: 'local', course, character, vehicle, driftIsAuto: false });
 *   // every frame, before step():
 *   session.hostController().setRawInputs(buttons, stickXRaw, stickYRaw, trick);
 *   session.step();
 */

import type { Character, Course, Vehicle } from '../../Common';
import type { KPadHostController } from '../system/KPadController';
import { KPadDirector } from '../system/KPadDirector';
import { PlayerType, RaceConfig } from '../system/RaceConfig';
import { RaceManager, Stage } from '../system/RaceManager';
import { ArchiveId, ResourceManager } from '../system/ResourceManager';
import { RaceScene } from './RaceScene';

/** A set of files keyed by archive path (e.g. "kartParam.bin", "/bsp/fr_bike.bsp"). */
export type FileSet = Map<string, Uint8Array> | Record<string, Uint8Array>;

export interface RaceSessionFiles {
    /**
     * Files of the Core archive ("/Race/Common"): at least kartParam.bin, driverParam.bin and
     * /bsp/<vehicle>.bsp (plus anything else the kart code loads from ArchiveId.Core).
     */
    core: FileSet;
    /** Files of the Course archive: course.kcl and course.kmp. */
    course: FileSet;
}

export type RaceSessionScenario =
    | {
          type: 'ghost';
          /** RKG ghost file (compressed or not). Course/character/vehicle come from the ghost. */
          rkg: Uint8Array;
      }
    | {
          type: 'local';
          course: Course;
          character: Character;
          vehicle: Vehicle;
          driftIsAuto: boolean;
      };

function entries(files: FileSet): [string, Uint8Array][] {
    return files instanceof Map ? [...files.entries()] : Object.entries(files);
}

export class RaceSession {
    private m_scene: RaceScene | null = null;
    private m_frame = 0;

    /** Sets up the root singletons, registers files, configures the scenario and inits the race. */
    init(files: RaceSessionFiles, scenario: RaceSessionScenario): void {
        // Singletons are global: tear down any previous race first.
        if (this.m_scene) {
            this.destroy();
        } else if (RaceManager.Instance() && KPadDirector.Instance()) {
            new RaceScene().deinitScene();
        }
        RaceSession.DestroyGlobals();

        // RootScene::allocate / RootScene::init
        const resMgr = ResourceManager.CreateInstance();
        KPadDirector.CreateInstance();
        const raceConfig = RaceConfig.CreateInstance();
        raceConfig.init();

        for (const [path, data] of entries(files.core)) {
            resMgr.registerFile(ArchiveId.Core, path, data);
        }
        for (const [path, data] of entries(files.course)) {
            resMgr.registerFile(ArchiveId.Course, path, data);
        }

        // Kinoko hosts configure the race through RaceConfig's init callback.
        RaceConfig.RegisterInitCallback((config) => {
            const player = config.raceScenario().players[0]!;
            if (scenario.type === 'ghost') {
                config.setGhost(scenario.rkg);
                player.type = PlayerType.Ghost;
            } else {
                const raceScenario = config.raceScenario();
                raceScenario.course = scenario.course;
                player.character = scenario.character;
                player.vehicle = scenario.vehicle;
                player.driftIsAuto = scenario.driftIsAuto;
                player.type = PlayerType.Local;
            }
        }, null);

        // SceneManager::createChildScene(Race) -> RaceScene::enter
        this.m_scene = new RaceScene();
        this.m_scene.enter();
        this.m_frame = 0;
    }

    /** Advances exactly one frame (Kinoko's SceneManager::calc -> RaceScene::calc). */
    step(): void {
        this.m_scene!.calc();
        ++this.m_frame;
    }

    /** Number of step() calls since init (KTestSystem frame index of the current state). */
    frame(): number {
        return this.m_frame;
    }

    /** KReplaySystem::calcEnd: the race finished or the timer reached 10 minutes. */
    isFinished(): boolean {
        const MAX_MINUTE_COUNT = 10;

        const raceManager = RaceManager.Instance()!;
        if (raceManager.stage() === Stage.FinishGlobal) {
            return true;
        }

        return raceManager.timerManager().currentTimer().min >= MAX_MINUTE_COUNT;
    }

    /** The host controller used for live play (scenario type 'local'). */
    hostController(): KPadHostController {
        return KPadDirector.Instance()!.hostController();
    }

    scene(): RaceScene | null {
        return this.m_scene;
    }

    /** Tears down the race scene and the root singletons. */
    destroy(): void {
        if (this.m_scene) {
            this.m_scene.exit();
            this.m_scene = null;
        }
        RaceSession.DestroyGlobals();
    }

    private static DestroyGlobals(): void {
        RaceConfig.RegisterInitCallback(null, null);
        if (RaceConfig.Instance()) RaceConfig.DestroyInstance();
        if (KPadDirector.Instance()) KPadDirector.DestroyInstance();
        if (ResourceManager.Instance()) ResourceManager.DestroyInstance();
    }
}
