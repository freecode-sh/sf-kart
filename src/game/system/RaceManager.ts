/**
 * Port of Kinoko source/game/system/RaceManager.{hh,cc}.
 *
 * Manages the timers that track the stages of a race. Also acts as the interface between the
 * physics engine and CourseMap.
 */

import { box } from '../../egg/core/Box';
import { fmin, fr } from '../../egg/math/Math';
import { Vector2f, Vector3f } from '../../egg/math/Vector';
import { KartObjectManager } from '../kart/KartObjectManager';
import { eStatus } from '../kart/Status';
import { CourseMap } from './CourseMap';
import type { KPad } from './KPadController';
import { KPadDirector } from './KPadDirector';
import type { MapdataCheckPoint } from './map/MapdataCheckPoint';
import type { MapdataJugemPoint } from './map/MapdataJugemPoint';
import { Random } from './Random';
import { Timer, TimerManager } from './TimerManager';

const s8 = (x: number): number => (x << 24) >> 24;
const s16 = (x: number): number => (x << 16) >> 16;

const LAP_COMPLETION_INIT = fr(0.999999);
const RACE_COMPLETION_MAX_FRAC = fr(0.99999);
const LAP_DELTA_THRESHOLD = fr(0.95);

export class Player {
    private m_checkpointId: number; // u16
    private m_raceCompletion: number;
    /** The proportion of a lap for the current checkpoint */
    private m_checkpointFactor: number;
    private m_checkpointStartLapCompletion: number;
    private m_lapCompletion: number;
    private m_jugemId = 0; // s8
    private m_currentLap: number; // s16
    private m_maxLap: number; // s8
    private m_maxKcp: number; // s8
    private m_drivingWrongWay: boolean;
    private m_lapTimers: Timer[] = [new Timer(), new Timer(), new Timer()];
    private m_raceTimer = new Timer();
    private m_inputs: KPad;

    /** @addr{0x80533ED8} */
    constructor() {
        this.m_checkpointId = 0;
        this.m_raceCompletion = 0.0;
        this.m_checkpointFactor = -1.0;
        this.m_checkpointStartLapCompletion = 0.0;
        this.m_lapCompletion = LAP_COMPLETION_INIT;

        const courseMap = CourseMap.Instance()!;

        if (courseMap.getCheckPointCount() > 0 && courseMap.getCheckPathCount() > 0) {
            this.m_maxKcp = courseMap.checkPoint()!.lastKcpType();
        } else {
            this.m_maxKcp = -1;
        }

        this.m_currentLap = 0;
        this.m_maxLap = 1;
        this.m_drivingWrongWay = false;
        this.m_inputs = KPadDirector.Instance()!.playerInput();
    }

    /** @addr{0x80534194} */
    init(): void {
        const courseMap = CourseMap.Instance()!;

        if (courseMap.getCheckPointCount() !== 0 && courseMap.getCheckPathCount() !== 0) {
            const pos = KartObjectManager.Instance()!.object(0).pos();
            const distanceRatio = box(0.0);
            const checkpointId = courseMap.findSector(pos, 0, distanceRatio);

            this.m_checkpointId = Math.max(0, checkpointId) & 0xffff;
            this.m_jugemId = courseMap.getCheckPoint(this.m_checkpointId)!.jugemIndex();
        } else {
            this.m_jugemId = 0;
        }
    }

    /** @addr{0x80535304} */
    calc(): void {
        const courseMap = CourseMap.Instance()!;
        const kart = KartObjectManager.Instance()!.object(0);

        if (
            courseMap.getCheckPointCount() === 0 ||
            courseMap.getCheckPathCount() === 0 ||
            kart.status().onBit(eStatus.BeforeRespawn)
        ) {
            return;
        }

        const distanceRatio = box(0.0);
        const checkpointId = courseMap.findSector(kart.pos(), this.m_checkpointId, distanceRatio);

        if (checkpointId === -1) {
            return;
        }

        let checkpoint: MapdataCheckPoint | null = null;

        if (this.m_checkpointFactor < 0.0 || this.m_checkpointId !== checkpointId) {
            checkpoint = this.calcCheckpoint(checkpointId & 0xffff, distanceRatio.value);
        } else {
            checkpoint = CourseMap.Instance()!.getCheckPoint(this.m_checkpointId);
        }

        this.m_raceCompletion = fr(
            fr(this.m_currentLap) +
                fr(
                    this.m_checkpointStartLapCompletion +
                        fr(this.m_checkpointFactor * distanceRatio.value),
                ),
        );
        this.m_raceCompletion = fmin(
            this.m_raceCompletion,
            fr(fr(this.m_currentLap) + RACE_COMPLETION_MAX_FRAC),
        );

        const bodyFront = kart.bodyFront();
        if (bodyFront.x !== 0.0 && bodyFront.z !== 0.0) {
            const frontXZ = new Vector2f(bodyFront.x, bodyFront.z);
            frontXZ.normalise();
            this.m_drivingWrongWay = checkpoint!.dir().dot(frontXZ) <= -0.5;
        }
    }

    /**
     * @addr{0x8053572C}
     * Gets the lap split, which is the difference between the given lap and the previous one.
     * @param lap One-indexed lap.
     */
    getLapSplit(lap: number): Timer {
        if (lap < 2) {
            return this.m_lapTimers[0]!.clone();
        }

        const currentLap = this.m_lapTimers[lap - 1]!;
        const previousLap = this.m_lapTimers[lap - 2]!;
        if (!currentLap.valid || !previousLap.valid) {
            return new Timer(0xffff, 0, 0);
        }

        return currentLap.sub(previousLap);
    }

    checkpointId(): number {
        return this.m_checkpointId;
    }

    raceCompletion(): number {
        return this.m_raceCompletion;
    }

    jugemId(): number {
        return this.m_jugemId;
    }

    drivingWrongWay(): boolean {
        return this.m_drivingWrongWay;
    }

    lapTimers(): readonly Readonly<Timer>[] {
        return this.m_lapTimers;
    }

    lapTimer(idx: number): Readonly<Timer> {
        return this.m_lapTimers[idx]!;
    }

    raceTimer(): Readonly<Timer> {
        return this.m_raceTimer;
    }

    inputs(): KPad {
        return this.m_inputs;
    }

    /** TS addition (debug/UI): the current lap counter (s16). */
    currentLap(): number {
        return this.m_currentLap;
    }

    /** @addr{0x80534DF8} */
    private calcCheckpoint(checkpointId: number, distanceRatio: number): MapdataCheckPoint {
        const courseMap = CourseMap.Instance()!;

        const oldCheckpointId = this.m_checkpointId;
        this.m_checkpointId = checkpointId;

        const lapProportion = courseMap.checkPath()!.lapProportion();
        const checkPath = courseMap.checkPath()!.findCheckpathForCheckpoint(checkpointId)!;
        this.m_checkpointFactor = fr(checkPath.oneOverCount() * lapProportion);

        this.m_checkpointStartLapCompletion = fr(
            fr(fr(checkPath.depth()) * lapProportion) +
                fr(this.m_checkpointFactor * fr(checkpointId - checkPath.start())),
        );

        const newLapCompletion = fr(
            this.m_checkpointStartLapCompletion + fr(distanceRatio * this.m_checkpointFactor),
        );
        const deltaLapCompletion = fr(this.m_lapCompletion - newLapCompletion);

        const newCheckpoint = courseMap.getCheckPoint(checkpointId)!;
        const oldCheckpoint = courseMap.getCheckPoint(oldCheckpointId)!;

        const newJugemIdx = newCheckpoint.jugemIndex();
        if (newJugemIdx >= 0) {
            this.m_jugemId = newJugemIdx;
        }

        if (!newCheckpoint.isNormalCheckpoint()) {
            if (newCheckpoint.checkArea() > this.m_maxKcp) {
                this.m_maxKcp = newCheckpoint.checkArea();
            } else if (this.m_maxKcp === courseMap.checkPoint()!.lastKcpType()) {
                if (
                    (newCheckpoint.isFinishLine() &&
                        this.areCheckpointsSubsequent(oldCheckpoint, checkpointId)) ||
                    deltaLapCompletion > LAP_DELTA_THRESHOLD
                ) {
                    this.incrementLap();
                }
            }
        }

        if (
            (oldCheckpoint.isFinishLine() &&
                this.areCheckpointsSubsequent(newCheckpoint, oldCheckpointId)) ||
            deltaLapCompletion < -LAP_DELTA_THRESHOLD
        ) {
            this.decrementLap();
        }

        this.m_lapCompletion = newLapCompletion;

        return newCheckpoint;
    }

    /** @addr{Inlined in 0x80534DF8} */
    private areCheckpointsSubsequent(
        checkpoint: MapdataCheckPoint,
        nextCheckpointId: number,
    ): boolean {
        for (let i = 0; i < checkpoint.nextCount(); ++i) {
            if (nextCheckpointId === checkpoint.nextPoint(i).id()) {
                return true;
            }
        }

        return false;
    }

    /** @addr{0x80534D6C} */
    private decrementLap(): void {
        const courseMap = CourseMap.Instance()!;

        if (courseMap.getCheckPointCount() > 0 && courseMap.getCheckPathCount() > 0) {
            this.m_maxKcp = courseMap.checkPoint()!.lastKcpType();
        } else {
            this.m_maxKcp = -1;
        }

        this.m_currentLap = s16(this.m_currentLap - 1);
    }

    /** @addr{0x805349B8} */
    private incrementLap(): void {
        this.m_maxKcp = 0;
        this.m_currentLap = s16(this.m_currentLap + 1);
        if (this.m_currentLap <= this.m_maxLap) {
            return;
        }

        const kart = KartObjectManager.Instance()!.object(0);
        const addMs = CourseMap.Instance()!.getCheckPointEntryOffsetMs(
            this.m_checkpointId,
            kart.pos(),
            kart.prevPos(),
        );

        const currentTimer = RaceManager.Instance()!.timerManager().currentTimer();
        const timer = currentTimer.addMs(fr(addMs));

        if (this.m_maxLap - 1 >= this.m_lapTimers.length) {
            throw new Error('RaceManager: lap timer overflow');
        }
        this.m_lapTimers[this.m_maxLap - 1] = timer;

        if (this.m_maxLap >= RaceManager.lapsToFinish) {
            this.endRace(timer);
        } else {
            this.m_maxLap = s8(this.m_currentLap);
        }
    }

    /** @addr{0x805347F4} */
    private endRace(finishTime: Readonly<Timer>): void {
        this.m_raceTimer = finishTime.clone();
        RaceManager.Instance()!.endPlayerRace(0);
    }
}

export enum Stage {
    Intro = 0,
    Countdown = 1,
    Race = 2,
    FinishLocal = 3,
    FinishGlobal = 4,
}

const STAGE_COUNTDOWN_DURATION = 240;
const RNG_SEED = 0x74a1b095;
const STAGE_INTRO_DURATION = 172;

let s_instance: RaceManager | null = null; ///< @addr{0x809BD730}

/** @addr{0x809BD730} */
export class RaceManager {
    /** Laps to finish the race (Kinoko/Time Trials: 3). The app sets it per course; at most 3 (m_lapTimers). */
    static lapsToFinish = 3;
    static readonly Player = Player;
    static readonly Stage = Stage;
    static readonly STAGE_COUNTDOWN_DURATION = STAGE_COUNTDOWN_DURATION;

    private m_random: Random;
    private m_player: Player;
    private m_timerManager: TimerManager;
    private m_stage: Stage;
    private m_introTimer: number; // u16
    private m_timer: number; // u32

    /** @addr{0x80532F88} */
    init(): void {
        this.m_player.init();
    }

    /**
     * @addr{0x805362DC}
     * @param pos Out-param (mutated in place).
     * @param angles Out-param (mutated in place).
     */
    findKartStartPoint(pos: Vector3f, angles: Vector3f): void {
        const placement = 1;
        const playerCount = 1;
        const startPointIdx = 0;

        const kartpoint = CourseMap.Instance()!.getStartPoint(startPointIdx);

        if (kartpoint) {
            kartpoint.findKartStartPoint(pos, angles, placement - 1, playerCount);
        } else {
            pos.setZero();
            angles.copy(Vector3f.ex);
        }
    }

    /** @addr{0x80533C6C} */
    endPlayerRace(_idx: number): void {
        // We only have one player, so most of the logic is much simpler
        this.m_stage = Stage.FinishGlobal;
    }

    /** @addr{0x805331B4} */
    calc(): void {
        this.m_timerManager.calc();
        this.m_player.calc();

        switch (this.m_stage) {
            case Stage.Intro:
                this.m_introTimer = (this.m_introTimer + 1) & 0xffff;
                if (this.m_introTimer >= STAGE_INTRO_DURATION) {
                    this.m_stage = Stage.Countdown;
                    KPadDirector.Instance()!.startGhostProxies();
                }
                break;
            case Stage.Countdown:
                this.m_timer = (this.m_timer + 1) >>> 0;
                if (this.m_timer >= STAGE_COUNTDOWN_DURATION) {
                    this.m_timerManager.setStarted(true);
                    this.m_stage = Stage.Race;
                }
                break;
            case Stage.Race:
                this.m_timer = (this.m_timer + 1) >>> 0;
                break;
            default:
                break;
        }
    }

    /** @addr{0x80536230} */
    isStageReached(stage: Stage): boolean {
        return this.m_stage >= stage;
    }

    /** @addr{0x8053621C} */
    jugemPoint(): MapdataJugemPoint | null {
        const jugemId = Math.max(this.m_player.jugemId(), 0);
        return CourseMap.Instance()!.getJugemPoint(jugemId & 0xffff);
    }

    /** @addr{0x80533090} C++ returns int (STAGE_COUNTDOWN_DURATION - m_timer). */
    getCountdownTimer(): number {
        return (STAGE_COUNTDOWN_DURATION - this.m_timer) | 0;
    }

    random(): Random {
        return this.m_random;
    }

    player(): Player {
        return this.m_player;
    }

    timerManager(): TimerManager {
        return this.m_timerManager;
    }

    stage(): Stage {
        return this.m_stage;
    }

    timer(): number {
        return this.m_timer;
    }

    /** @addr{0x80532084} */
    static CreateInstance(): RaceManager {
        if (s_instance) throw new Error('RaceManager already exists');
        s_instance = new RaceManager();
        return s_instance;
    }

    /** @addr{0x805320D4} */
    static DestroyInstance(): void {
        s_instance = null;
    }

    static Instance(): RaceManager {
        // Non-null for convenience (C++ returns a possibly-null pointer).
        return s_instance!;
    }

    /** @addr{0x805327A0} */
    private constructor() {
        this.m_random = new Random(RNG_SEED);
        this.m_player = new Player();
        this.m_timerManager = new TimerManager();
        this.m_stage = Stage.Intro;
        this.m_introTimer = 0;
        this.m_timer = 0;
    }
}
