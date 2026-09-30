/**
 * Adapter between the browser app and the ported physics engine: owns the RaceSession, feeds it
 * raw controller input every frame, and extracts render/HUD state.
 */

import * as THREE from 'three';
import { KartObjectManager } from '../game/kart/KartObjectManager';
import { DriftState } from '../game/kart/KartMove';
import type { KartParam } from '../game/kart/KartParam';
import { eStatus } from '../game/kart/Status';
import { KartCamera } from '../game/render/KartCamera';
import { RaceSession, type RaceSessionScenario } from '../game/scene/RaceSession';
import { KPadHostController } from '../game/system/KPadController';
import { RaceManager, Stage } from '../game/system/RaceManager';
import { ItemDirector } from '../game/item/ItemDirector';
import type { AudioFrame, SimEvent } from './audio';
import type { HudData } from './hud';
import type { RawPadState } from './input';
import { BUTTON_ACCELERATE, BUTTON_BRAKE, BUTTON_DRIFT, BUTTON_ITEM, TrickDir } from './input';
import { EasyDrift } from './easyDrift';
import { startRace } from './raceStart';
import { COURSE_SLOT, finishTimeMs, isGoFrame, raceFiles, stepRace, type EngineInput } from './run/race';
import { DRIVER_SLOT, vehicleSlot } from './vehicleData';
import type { CameraState, KartVisualState } from './renderer';

const MT_CHARGE_MAX = 270;
/** Countdown frames left when "3" appears. */
const COUNTDOWN_SHOWN = 181;
/** Frames of a trick's flourish (the vehicle's own trick animation, see renderer.ts). */
const TRICK_FLOURISH = 34;

interface TrickTrack {
    /** Frame the trick started (-1: none yet). */
    start: number;
    /** Frame it ended (landed or cancelled), or -1 while in the air. */
    end: number;
    dir: TrickDir;
    /** The engine rotates the kart itself (boost-ramp flips, bike side swings, half-pipe stunts). */
    engineRot: boolean;
}
const NO_TRICK: TrickTrack = { start: -1, end: -1, dir: TrickDir.None, engineRot: false };

interface Snapshot {
    pos: THREE.Vector3;
    rot: THREE.Quaternion;
    wheels: THREE.Vector3[];
    camPos: THREE.Vector3;
    camTarget: THREE.Vector3;
    camUp: THREE.Vector3;
}

export interface SimView {
    kart: KartVisualState;
    camera: CameraState;
    hud: Omit<HudData, 'paused' | 'debug'>;
}

export class Sim {
    private session = new RaceSession();
    private prevButtons = 0;
    private prev: Snapshot | null = null;
    private cur: Snapshot | null = null;
    /** The current run's engine inputs, one per frame stepped (live play only): a run file's body (run/runFile.ts). */
    readonly recording: EngineInput[] = [];
    /** Events produced by the most recent step() calls; drained by the app. */
    readonly events: SimEvent[] = [];
    private lastPad: RawPadState = { buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: 0 };
    private prevFlags = new Map<string, boolean>();
    private prevLap = 1;
    private prevStage = Stage.Intro;
    private prevCountdown = 999;
    private prevDriftState = DriftState.NotDrifting;
    private airFrames = 0;
    /** Camera FOV (degrees), as the engine's camera eases it; NaN until the first frame. */
    private fov = Number.NaN;
    private prevFov = Number.NaN;
    private prevSpeed = 0;
    /** Steering smoothed per game frame, for the driver's lean pose. */
    private driverSteer = 0;
    /** Hop-button tricks (hopTrick): the button held last frame, a trick armed on a ramp, the hop held back. */
    private hopHeld = false;
    private trickArmed = false;
    private hopSuppressed = false;
    /** The trick in progress, for the animations and the trickLand event (see trackTrick). */
    private trick: TrickTrack = { ...NO_TRICK };

    /** Engine slots (vehicleData.ts packs our data into them). */
    character = DRIVER_SLOT;
    vehicle = vehicleSlot('ebike');
    /** Easy drifting on the engine's manual drift (easyDrift.ts). */
    readonly drift = new EasyDrift();

    /** kartParam.bin with the vehicle's stat adjustments (tuning.ts); null = the packed file as is. */
    private kartParam: Uint8Array | null = null;

    setKartParam(bytes: Uint8Array | null): void {
        this.kartParam = bytes;
    }

    /**
     * Dev tuning: puts `stats` (the vehicle's stats with new adjustments, as vehicleData.ts's
     * engineStats unpacks them) into the running race right away, without a restart. Everything the
     * engine reads from its stats each frame changes on the next frame; the base speed it caches at
     * the start is updated too. A run tuned mid-race isn't reproducible from its inputs.
     */
    applyLiveStats(stats: KartParam.Stats): void {
        const k = this.kart();
        const live = k.param().stats() as unknown as Record<string, unknown>;
        for (const [key, v] of Object.entries(stats)) {
            if (Array.isArray(v)) (live[key] as number[]).splice(0, v.length, ...(v as number[]));
            else live[key] = v;
        }
        (k.move() as unknown as { m_baseSpeed: number }).m_baseSpeed = stats.speed;
    }

    /** Laps to finish (the app sets the course's own count before starting). */
    laps = 3;

    constructor(
        private readonly common: Map<string, Uint8Array>,
        private readonly course: Map<string, Uint8Array>,
    ) {}

    /** Ghost replay (RKG) instead of live input; start()/startGhost() switch modes. */
    private ghost: Uint8Array | null = null;

    /** Replays an RKG ghost on the current course (its course/character/vehicle come from the ghost). */
    startGhost(rkg: Uint8Array): void {
        this.ghost = rkg;
        this.start();
    }

    isReplay(): boolean {
        return this.ghost !== null;
    }

    stopReplay(): void {
        this.ghost = null;
    }

    start(): void {
        const files = raceFiles(this.common, this.course, this.kartParam);
        const scenario: RaceSessionScenario = this.ghost
            ? { type: 'ghost', rkg: this.ghost }
            : { type: 'local', course: COURSE_SLOT, character: this.character, vehicle: this.vehicle, driftIsAuto: false };
        RaceManager.lapsToFinish = this.laps;
        startRace(this.session, files, scenario);
        this.drift.reset();
        this.prevButtons = 0;
        this.recording.length = 0;
        this.events.length = 0;
        this.prevFlags.clear();
        this.prevLap = 1;
        this.prevCountdown = 999;
        this.prevDriftState = DriftState.NotDrifting;
        this.airFrames = 0;
        this.prevSpeed = 0;
        this.fov = Number.NaN;
        this.prevFov = Number.NaN;
        this.driverSteer = 0;
        this.hopHeld = false;
        this.trickArmed = false;
        this.hopSuppressed = false;
        this.trick = { ...NO_TRICK };
        this.lastPad = { buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: 0 };
        this.prevStage = RaceManager.Instance()!.stage();
        this.cur = this.capture();
        this.prev = this.cur;
    }

    step(pad: RawPadState): void {
        if (this.ghost) {
            // Replay: the ghost controller feeds the recorded inputs.
            this.session.step();
            this.lastPad = pad;
            this.prev = this.cur;
            this.cur = this.capture();
            this.detectEvents();
            this.updateVisuals();
            return;
        }
        // Brake and drift both drive the engine's brake button; the controller layer derives the drift
        // (hop) bit from it being pressed while accelerating. The easy-drift layer decides when it's held.
        const accel = (pad.buttons & BUTTON_ACCELERATE) !== 0;
        // The hop button tricks off ramps (hopTrick); on a ramp it doesn't hop.
        const hopTrick = this.hopTrick(pad);
        let brake = (pad.buttons & BUTTON_BRAKE) !== 0 || ((pad.buttons & BUTTON_DRIFT) !== 0 && !this.hopSuppressed);
        brake = this.drift.update(brake, accel, (pad.stickXRaw - 7) / 7, this.driftKart());
        // Start boost: everyone gets one. On the GO frame the engine doesn't see the accelerator (so
        // no charge-timed boost or burnout of its own) and the best start boost is applied (stepRace).
        const buttons = KPadHostController.MakeGhostButtons(accel && !isGoFrame(), brake, (pad.buttons & BUTTON_ITEM) !== 0, this.prevButtons);
        this.prevButtons = buttons;
        let trick = this.trickFor(pad);
        if (trick === TrickDir.None) trick = hopTrick;
        const input: EngineInput = { buttons, stickX: pad.stickXRaw, stickY: pad.stickYRaw, trick };
        this.recording.push(input);
        stepRace(this.session, input);
        this.lastPad = pad;
        this.prev = this.cur;
        this.cur = this.capture();
        this.detectEvents();
        this.updateVisuals();
    }

    /**
     * Quick start: runs the race intro and the quiet first second of the countdown straight away
     * (same frames, just not shown), so a race opens on "3".
     */
    skipToCountdown(): void {
        const rm = RaceManager.Instance()!;
        const idle: RawPadState = { buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: 0 };
        while (rm.stage() === Stage.Intro || (rm.stage() === Stage.Countdown && rm.getCountdownTimer() > COUNTDOWN_SHOWN)) this.step(idle);
        this.events.length = 0;
        this.prev = this.cur;
        this.prevCountdown = 999;
    }

    /** The kart as the easy-drift layer sees it, before the next frame. */
    private driftKart() {
        const k = this.kart();
        const st = k.status();
        return {
            grounded: st.onBit(eStatus.TouchingGround),
            drifting: st.onBit(eStatus.DriftManual),
            hopping: st.onBit(eStatus.Hop),
            fast: k.move().speed() > 0.55 * k.param().stats().speed,
        };
    }

    /**
     * Keyboard tricks: the trick key sends an Up trick (a wheelie on the ground); with steering
     * held it sends a Left/Right trick instead, like pressing that way on the d-pad. On normal jump
     * ramps a side trick is the bike's sideways swing, where an Up trick is only a pose (the game
     * flips bikes only off boost ramps). The game buffers a trick press for 14 frames, so pressing
     * just before the lip works. D-pad tricks (gamepad, the Arrows scheme) are sent as pressed.
     */
    private trickFor(pad: RawPadState): TrickDir {
        if (pad.explicitTrick || pad.trick !== TrickDir.Up || pad.stickXRaw === 7) return pad.trick;
        return pad.stickXRaw < 7 ? TrickDir.Left : TrickDir.Right;
    }

    /**
     * Where a trick can be done right now, from the kart before the next frame: 'ramp' on (or just
     * off) a trick ramp or boost ramp at trick speed, 'air' in the engine's trick window after
     * leaving one (airtime 1..9: the engine starts a trick at airtime 3..10, off a Trickable
     * surface, a boost ramp or a half-pipe), else null.
     */
    private trickWindow(): 'ramp' | 'air' | null {
        const k = this.kart();
        const st = k.status();
        if (st.onBit(eStatus.InATrick, eStatus.TrickStart, eStatus.ZipperTrick, eStatus.InRespawn)) return null;
        const ramp = st.onBit(eStatus.Trickable) || k.state().boostRampType() >= 0;
        if (st.onBit(eStatus.TouchingGround)) return ramp && st.offBit(eStatus.Hop) && k.move().speedRatioCapped() > 0.5 ? 'ramp' : null;
        const air = k.state().airtime();
        // Half-pipes: only a launch high enough for a stunt (KartHalfPipe.activateTrick).
        const halfPipe = st.onBit(eStatus.OverZipper) && (k.halfPipe() as unknown as { m_attemptedTrickTimer: number }).m_attemptedTrickTimer >= 51;
        return air >= 1 && air <= 9 && (ramp || halfPipe) ? 'air' : null;
    }

    /**
     * Hop-button tricks, as in modern kart racers: press hop in the air off a ramp and it's a trick
     * (Up; Left / Right when steering, Down with the stick down). Pressed on the ramp itself, before
     * the lip, it doesn't hop: the trick is armed and sent the first frame the kart is in the air,
     * and the button reaches the drift layer again only once airborne (so a tap never hops or
     * drifts; holding it through the landing while steering drifts, like any held drift button).
     * Tricks only ever go out in the air, so a hop press never starts a bike's wheelie.
     *
     * Deterministic: a function of the raw inputs and the kart state. The trick it sends is what
     * sim.recording stores (the engine input), so a recorded run replays without this layer.
     */
    private hopTrick(pad: RawPadState): TrickDir {
        const held = (pad.buttons & BUTTON_DRIFT) !== 0;
        const press = held && !this.hopHeld;
        this.hopHeld = held;
        const w = this.trickWindow();
        // The held-back hop comes back on release, or once in the air (where a press can't hop).
        if (!held || this.kart().status().offBit(eStatus.TouchingGround)) this.hopSuppressed = false;
        if (pad.trick !== TrickDir.None) {
            // A trick input of its own (the trick key, the d-pad, a replayed recording).
            this.trickArmed = false;
            return TrickDir.None;
        }
        if (press && w === 'ramp') {
            this.trickArmed = true;
            this.hopSuppressed = true;
            return TrickDir.None;
        }
        if (w === 'air' && (press || this.trickArmed)) {
            // Not to the drift layer until it's clearly airborne: this very frame could land.
            if (press) this.hopSuppressed = true;
            // One frame off the ground could be a bump: wait for the next to send it.
            if (this.kart().state().airtime() < 2) {
                this.trickArmed = true;
                return TrickDir.None;
            }
            this.trickArmed = false;
            // Any steering makes it a side trick (the same rule as trickFor, so a replayed recording
            // sends the same trick).
            if (pad.stickXRaw !== 7) return pad.stickXRaw < 7 ? TrickDir.Left : TrickDir.Right;
            return pad.stickYRaw <= 3 ? TrickDir.Down : TrickDir.Up;
        }
        if (w !== 'ramp') this.trickArmed = false;
        return TrickDir.None;
    }

    /** Follows the trick in progress (the engine's KartJump / KartHalfPipe) for the animations; true on a landing with its boost. */
    private trackTrick(): boolean {
        const k = this.kart();
        const st = k.status();
        const f = this.session.frame();
        const on = st.onBit(eStatus.InATrick, eStatus.ZipperTrick);
        const tr = this.trick;
        const active = tr.start >= 0 && tr.end < 0;
        let landed = false;
        if (on && !active) {
            const half = st.onBit(eStatus.ZipperTrick);
            const next = half ? (k.halfPipe() as unknown as { m_trick: number }).m_trick : (k.jump() as unknown as { m_nextTrick: number }).m_nextTrick;
            tr.start = f;
            tr.end = -1;
            tr.dir = (next as TrickDir) || TrickDir.Up;
            tr.engineRot = half || st.onBit(eStatus.TrickRot);
        } else if (!on && active) {
            tr.end = f;
            // Landing a trick gives its boost on the same frame (KartMove.landTrick, KartHalfPipe.end).
            if (st.onBit(eStatus.TouchingGround) && st.onBit(eStatus.Boost, eStatus.ZipperBoost)) {
                landed = true;
            }
        }
        return landed;
    }

    /** Per-frame visual state: the driver's smoothed steering and the camera FOV (KartCamera.calcFov: the engine's boost widening). */
    private updateVisuals(): void {
        this.driverSteer += (this.kart().state().stickX() - this.driverSteer) * 0.25;
        this.prevFov = Number.isNaN(this.fov) ? KartCamera.Instance()!.m_fov : this.fov;
        this.fov = KartCamera.Instance()!.m_fov;
    }

    private edge(name: string, value: boolean): boolean {
        const was = this.prevFlags.get(name) ?? false;
        this.prevFlags.set(name, value);
        return value && !was;
    }

    private detectEvents(): void {
        const k = this.kart();
        const status = k.status();
        const move = k.move();
        const rm = RaceManager.Instance()!;
        const ev = this.events;
        const stage = rm.stage();

        if (stage === Stage.Countdown) {
            const left = rm.getCountdownTimer();
            for (const mark of [180, 120, 60]) {
                if (this.prevCountdown > mark && left <= mark) ev.push({ type: 'countdown', n: mark / 60 });
            }
            this.prevCountdown = left;
        }
        if (stage === Stage.Race && this.prevStage === Stage.Countdown) ev.push({ type: 'go' });
        if (stage >= Stage.FinishLocal && this.prevStage < Stage.FinishLocal) ev.push({ type: 'finish' });
        this.prevStage = stage;

        const lap = rm.player().currentLap();
        if (lap > this.prevLap && lap >= 2 && lap <= this.laps) ev.push({ type: 'lap', lap, final: lap === this.laps });
        this.prevLap = lap;

        const speedUp = status.onBit(eStatus.MushroomBoost);
        const boost = status.onBit(eStatus.Boost);
        const trickLanded = this.trackTrick();
        if (trickLanded) ev.push({ type: 'trickLand' });
        if (this.edge('speedUp', speedUp)) ev.push({ type: 'speedUp' });
        if (this.edge('boost', boost) && !speedUp && !trickLanded) {
            if (move.padType().onBit(0)) ev.push({ type: 'dashPanel' });
            else if (stage === Stage.Race && rm.timer() < 5) ev.push({ type: 'startBoost' });
            else ev.push({ type: 'mtBoost' });
        }
        if (this.edge('hop', status.onBit(eStatus.Hop))) ev.push({ type: 'hop' });
        if (this.edge('burnout', status.onBit(eStatus.Burnout))) ev.push({ type: 'burnout' });
        // (TrickStart only lasts within a frame: the trick itself is InATrick, or ZipperTrick on a half-pipe.)
        if (this.edge('trick', status.onBit(eStatus.InATrick, eStatus.ZipperTrick))) ev.push({ type: 'trick' });
        if (this.edge('wheelie', status.onBit(eStatus.Wheelie)) && stage === Stage.Race) ev.push({ type: 'wheelie' });
        if (this.edge('respawn', status.onBit(eStatus.InRespawn))) ev.push({ type: 'respawn' });
        if (this.edge('wall', status.onBit(eStatus.WallCollisionStart))) {
            ev.push({ type: 'wall', strength: Math.abs(this.prevSpeed) });
        }

        const grounded = status.onBit(eStatus.TouchingGround);
        if (!grounded) this.airFrames++;
        if (grounded && this.airFrames > 8) {
            ev.push({ type: 'land', strength: Math.min(40, this.airFrames) });
        }
        if (!grounded && this.airFrames === 8) ev.push({ type: 'takeoff' });
        if (grounded) this.airFrames = 0;

        const ds = move.driftState();
        if (ds >= DriftState.ChargedMt && this.prevDriftState < DriftState.ChargedMt) ev.push({ type: 'mtCharged' });
        if (ds >= DriftState.ChargedSmt && this.prevDriftState < DriftState.ChargedSmt) ev.push({ type: 'mtCharged' });
        this.prevDriftState = ds;
        this.prevSpeed = move.speed();
    }

    audioFrame(): AudioFrame {
        const k = this.kart();
        const status = k.status();
        const move = k.move();
        const stage = RaceManager.Instance()!.stage();
        return {
            speed: move.speed(),
            throttle: (this.lastPad.buttons & BUTTON_ACCELERATE) !== 0,
            grounded: status.onBit(eStatus.TouchingGround),
            drifting: status.onBit(eStatus.DriftManual, eStatus.DriftAuto),
            mtChargeRatio: Math.min(1, move.mtCharge() / MT_CHARGE_MAX),
            boosting: status.onBit(eStatus.Boost, eStatus.MushroomBoost),
            offroad: move.kclSpeedFactor() < 1 && status.onBit(eStatus.TouchingGround),
            racing: stage >= Stage.Race,
        };
    }

    frame(): number {
        return this.session.frame();
    }

    private kart() {
        return KartObjectManager.Instance()!.object(0);
    }

    /** The kart's position after the last frame. */
    kartPos(): THREE.Vector3 {
        return this.cur!.pos;
    }

    /** The kart's full rotation after the last frame. */
    kartRot(): THREE.Quaternion {
        return this.cur!.rot;
    }

    /** Race stage (for app-side gameplay such as the speed-up pickups). */
    racing(): boolean {
        return RaceManager.Instance()!.stage() === Stage.Race;
    }

    /**
     * Speed-up pickup (app-side): an instant boost, as strong as a stored speed-up. Applied after a frame from the
     * kart's position only, in live play and ghost replays alike, so replays stay in sync.
     */
    pickupBoost(): void {
        this.kart().move().activateMushroom();
    }

    /** The kart's forward direction (horizontal, unit). */
    kartForward(): THREE.Vector3 {
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.cur!.rot);
        f.y = 0;
        return f.normalize();
    }

    private capture(): Snapshot {
        const k = this.kart();
        const p = k.pos();
        const q = k.fullRot();
        const wheels: THREE.Vector3[] = [];
        for (let i = 0; i < k.tireCount(); ++i) {
            const w = k.tirePhysics(i).pos();
            wheels.push(new THREE.Vector3(w.x, w.y, w.z));
        }
        const cam = KartCamera.Instance()!;
        // The engine's chase camera: position, look-at point and up vector (KartCamera).
        const target = new THREE.Vector3(cam.m_viewAt.x, cam.m_viewAt.y, cam.m_viewAt.z);
        return {
            pos: new THREE.Vector3(p.x, p.y, p.z),
            rot: new THREE.Quaternion(q.v.x, q.v.y, q.v.z, q.w),
            wheels,
            camPos: new THREE.Vector3(cam.m_viewPos.x, cam.m_viewPos.y, cam.m_viewPos.z),
            camTarget: target,
            camUp: new THREE.Vector3(cam.m_up.x, cam.m_up.y, cam.m_up.z),
        };
    }

    view(alpha: number): SimView {
        const a = this.prev!;
        const b = this.cur!;
        const t = Math.max(0, Math.min(1, alpha));
        const k = this.kart();
        const move = k.move();
        const status = k.status();
        const cam = KartCamera.Instance()!;

        const pos = a.pos.clone().lerp(b.pos, t);
        const rot = a.rot.clone().slerp(b.rot, t);
        const wheels = b.wheels.map((w, i) => (a.wheels[i] ? a.wheels[i]!.clone().lerp(w, t) : w.clone()));

        const driftState = move.driftState();
        const drifting = status.onBit(eStatus.DriftManual, eStatus.DriftAuto);
        const hopX = move.hopStickX();
        const mtCharge = move.mtCharge();

        const kartState: KartVisualState = {
            pos,
            rot,
            wheels,
            // hopStickX is -1 for a right drift, +1 for a left one.
            driftDir: drifting ? (hopX < 0 ? 1 : -1) : 0,
            mtTier: driftState >= DriftState.ChargedSmt ? 2 : driftState >= DriftState.ChargedMt ? 1 : 0,
            mtChargeRatio: mtCharge / MT_CHARGE_MAX,
            boosting: status.onBit(eStatus.Boost, eStatus.MushroomBoost),
            wheelie: status.onBit(eStatus.Wheelie),
            airborne: status.offBit(eStatus.TouchingGround),
            ...this.trickVisual(t),
            steer: this.driverSteer,
            throttle: status.onBit(eStatus.Accelerate),
            braking: status.onBit(eStatus.Brake) && status.offBit(eStatus.Accelerate) && move.speed() > 1,
            speed: move.speed(),
        };

        const camera: CameraState = {
            pos: a.camPos.clone().lerp(b.camPos, t),
            target: a.camTarget.clone().lerp(b.camTarget, t),
            up: a.camUp.clone().lerp(b.camUp, t).normalize(),
            fov: Number.isNaN(this.fov) ? cam.m_camParams!.fov : this.prevFov + (this.fov - this.prevFov) * t,
        };

        const rm = RaceManager.Instance()!;
        const player = rm.player();
        const stage = rm.stage();
        // After the finish the running timer keeps counting: show the race's final time instead
        // (unrounded, so it reads the same as the lap splits and the results board).
        const done = stage >= Stage.FinishLocal && player.raceTimer().valid;
        const timer = done ? player.raceTimer() : rm.timerManager().currentTimer();
        const timerMs = (timer.min * 60 + timer.sec) * 1000 + timer.mil;
        const raceFrames = stage >= Stage.Race ? (done ? (timerMs * 59.94) / 1000 : Math.round(timerMs * 0.05994)) : null;

        let countdown: string | null = null;
        if (stage === Stage.Countdown) {
            const left = rm.getCountdownTimer();
            countdown = left > 180 ? '' : left > 120 ? '3' : left > 60 ? '2' : '1';
            if (countdown === '') countdown = null;
        } else if (stage === Stage.Race && rm.timer() < 60) {
            countdown = 'GO!';
        } else if (stage >= Stage.FinishLocal) {
            countdown = 'FINISH!';
        }

        const lapTimes: number[] = [];
        const splits = player.lapTimers();
        let prevMs = 0;
        for (const s of splits) {
            if (!s.valid) break;
            const ms = (s.min * 60 + s.sec) * 1000 + s.mil;
            lapTimes.push(((ms - prevMs) * 59.94) / 1000);
            prevMs = ms;
        }

        let speedUps = 0;
        try {
            speedUps = ItemDirector.Instance()!.kartItem(0).inventory().currentCount();
        } catch {
            speedUps = 0;
        }

        const hud: SimView['hud'] = {
            raceFrames,
            lap: player.currentLap(),
            maxLap: this.laps,
            lapTimes,
            speed: move.speed(),
            mtCharge,
            mtChargeMax: MT_CHARGE_MAX,
            mtCharged: driftState >= DriftState.ChargedMt,
            tags: [
                { label: 'DRIFT', on: drifting },
                { label: 'MT READY', on: driftState >= DriftState.ChargedMt },
                { label: 'BOOST', on: status.onBit(eStatus.Boost) },
                { label: 'SPEED-UP', on: status.onBit(eStatus.MushroomBoost) },
                { label: 'WHEELIE', on: status.onBit(eStatus.Wheelie) },
                { label: 'HOP', on: status.onBit(eStatus.Hop) },
                { label: 'AIR', on: status.offBit(eStatus.TouchingGround) },
                { label: 'OFFROAD', on: move.kclSpeedFactor() < 1 && status.onBit(eStatus.TouchingGround) },
                { label: 'SSMT', on: status.onBit(eStatus.ChargingSSMT) },
            ],
            countdown,
            speedUps,
        };

        return { kart: kartState, camera, hud };
    }

    /**
     * The trick for the renderer: its direction, the flourish's progress (0..1 over TRICK_FLOURISH
     * frames; a landing before the end hurries it to the end) and whether the engine rotates the
     * kart itself. `alpha` interpolates between frames.
     */
    private trickVisual(alpha: number): Pick<KartVisualState, 'trickDir' | 'trickT' | 'trickEngineRot'> {
        const tr = this.trick;
        if (tr.start < 0) return { trickDir: 0, trickT: -1, trickEngineRot: false };
        const f = this.session.frame() - 1 + alpha;
        let t: number;
        if (tr.end < 0) t = (f - tr.start) / TRICK_FLOURISH;
        else {
            const atEnd = Math.min(1, (tr.end - tr.start) / TRICK_FLOURISH);
            t = atEnd + ((f - tr.end) * 4) / TRICK_FLOURISH;
            if (t > 1.2) return { trickDir: 0, trickT: -1, trickEngineRot: false };
        }
        return { trickDir: tr.dir, trickT: Math.max(0, Math.min(1, t)), trickEngineRot: tr.engineRot };
    }

    debugText(): string {
        const k = this.kart();
        const m = k.move();
        const p = k.pos();
        const v = k.extVel();
        const iv = k.intVel();
        const f = (x: number, d = 3) => x.toFixed(d).padStart(10);
        return [
            `frame          ${this.frame()}`,
            `pos        ${f(p.x, 2)} ${f(p.y, 2)} ${f(p.z, 2)}`,
            `extVel     ${f(v.x)} ${f(v.y)} ${f(v.z)}`,
            `intVel     ${f(iv.x)} ${f(iv.y)} ${f(iv.z)}`,
            `speed      ${f(m.speed(), 4)}`,
            `accel      ${f(m.acceleration(), 4)}`,
            `softLimit  ${f(m.softSpeedLimit(), 4)}`,
            `hardLimit  ${f(m.hardSpeedLimit(), 4)}`,
            `mtCharge   ${f(m.mtCharge(), 0)}`,
            `drift      ${DriftState[m.driftState()]}`,
            `hopStickX  ${f(m.hopStickX(), 0)}`,
            `kclSpeed   ${f(m.kclSpeedFactor(), 4)}`,
            `airtime    ${f(k.state().airtime(), 0)}`,
            `inputs     ${this.recording.length} frames recorded`,
        ].join('\n');
    }
}
