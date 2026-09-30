/**
 * Port of Kinoko source/game/system/RaceConfig.{hh,cc}.
 *
 * Initializes the player with parameters specified in the provided ghost file, or (TS usage) with
 * a directly configured scenario for live play:
 *
 *   const scenario = RaceConfig.Instance()!.raceScenario();
 *   scenario.course = Course.Luigi_Circuit;
 *   scenario.players[0]!.type = PlayerType.Local;
 *   scenario.players[0]!.character = Character.Mario;
 *   scenario.players[0]!.vehicle = Vehicle.Flame_Runner;
 *   scenario.players[0]!.driftIsAuto = false;
 *
 * Kinoko applies these from an init callback during RaceConfig::initRace (see
 * RegisterInitCallback); RaceSession wraps this.
 */

import { Character, Course, Vehicle } from '../../Common';
import { GhostFile, RawGhostFile } from './GhostFile';
import { KPadDirector } from './KPadDirector';

export enum PlayerType {
    Local = 0, // Inputs managed by the host (live play)
    Ghost = 3, // Inputs managed by ghost
    None = 5,
}

export class Player {
    static readonly Type = PlayerType;

    character: Character = Character.Mario;
    vehicle: Vehicle = Vehicle.Standard_Kart_M;
    type: PlayerType = PlayerType.None;
    driftIsAuto = false;
}

export enum GameMode {
    Time_Trial = 2,
    Ghost_Race = 5,
}

export class Scenario {
    static readonly GameMode = GameMode;

    players: Player[] = Array.from({ length: 12 }, () => new Player());
    playerCount = 0; // u8
    course: Course = Course.GCN_Mario_Circuit;

    /** @addr{Inlined in 0x8052DD40} */
    init(): void {
        this.playerCount = 0;
        this.course = Course.GCN_Mario_Circuit;

        for (const player of this.players) {
            player.character = Character.Mario;
            player.vehicle = Vehicle.Standard_Kart_M;
            player.type = PlayerType.None;
        }
    }
}

export type InitCallback = (config: RaceConfig, arg: unknown) => void;

let s_instance: RaceConfig | null = null; ///< @addr{0x809BD728}
let s_onInitCallback: InitCallback | null = null;
/** The argument sent into the callback. */
let s_onInitCallbackArg: unknown = null;

/** @addr{0x809BD728} */
export class RaceConfig {
    static readonly Player = Player;
    static readonly Scenario = Scenario;

    private m_raceScenario = new Scenario();
    private m_ghost = new RawGhostFile();

    /** @addr{0x8052DD40} */
    init(): void {
        this.m_raceScenario.init();
    }

    /**
     * @addr{0x805302C4}
     * Normally we copy the menu scenario into the race scenario.
     * However, Kinoko doesn't support menus, so we use a callback.
     */
    initRace(): void {
        this.m_raceScenario.playerCount = 1;

        if (s_onInitCallback) {
            s_onInitCallback(this, s_onInitCallbackArg);
        }

        this.initControllers();
    }

    /** @addr{0x8052F4E8} Initializes the controllers. */
    initControllers(): void {
        const player = this.m_raceScenario.players[0]!;
        switch (player.type) {
            case PlayerType.Ghost:
                this.initGhost();
                break;
            case PlayerType.Local:
                KPadDirector.Instance()!.setHostPad(player.driftIsAuto);
                break;
            default:
                throw new Error('Players must be either local or ghost!');
        }
    }

    /** @addr{0x8052EEF0} Initializes the ghost. */
    initGhost(): void {
        const ghost = new GhostFile(this.m_ghost);

        this.m_raceScenario.course = ghost.course();
        const player = this.m_raceScenario.players[0]!;
        player.character = ghost.character();
        player.vehicle = ghost.vehicle();
        player.driftIsAuto = ghost.driftIsAuto();

        KPadDirector.Instance()!.setGhostPad(ghost.inputs(), ghost.driftIsAuto());
    }

    raceScenario(): Scenario {
        return this.m_raceScenario;
    }

    /** Sets the (possibly compressed) RKG ghost file. C++ `RawGhostFile &operator=(const u8 *)`. */
    setGhost(rkg: Uint8Array): void {
        this.m_ghost.init(rkg);
    }

    static RegisterInitCallback(callback: InitCallback | null, arg: unknown): void {
        s_onInitCallback = callback;
        s_onInitCallbackArg = arg;
    }

    /** @addr{0x8052FE58} */
    static CreateInstance(): RaceConfig {
        if (s_instance) throw new Error('RaceConfig already exists');
        s_instance = new RaceConfig();
        return s_instance;
    }

    /** @addr{0x8052FFE8} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): RaceConfig {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x8053015C} */
    private constructor() {}
}
