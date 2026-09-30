/**
 * Browser entry point: loads data, runs the physics at the engine's 59.94 Hz frame rate with a fixed
 * timestep, and renders with Three.js.
 */

import * as THREE from 'three';
import { AudioEngine } from './audio';
import { formatFrames, Hud } from './hud';
import { BUTTON_ACCELERATE, BUTTON_BRAKE, InputManager, type RawPadState, type SchemeId } from './input';
import { DEV_TOOLS } from './devMode';
import { effectiveTune, loadMenuState, Menu } from './menu';
import { Renderer, type CameraState, type CourseMeta } from './renderer';
import { ScaleMoment } from './renderScale';
import { Sim } from './sim';
import { SfHud, type SfHudMeta } from './sf/sfHud';
import { SfMusic } from './sf/music';
import { CompareGhosts } from './sf/ghosts';
import { RunRecorder, type GhostRun } from './sf/ghostTrack';
import { GhostSim } from './sf/ghostSim';
import { dropPoseGhosts, loadRuns, storeRun, type StoredRun } from './sf/runStore';
import { pickupKindFor } from './sf/itemBoxes';
import { DevTuning } from './devTuning';
import type { SplitColumn } from './sf/sfHud';
import { isStock, STOCK_TUNE, summarize, tuneStats, type StatSummary, type VehicleTune } from './tuning';
import { engineStats, packKartParam, packVehicleFiles, VEHICLE_DATA, vehicleSlot, type VehicleDataFile } from './vehicleData';
import { VEHICLES, vehicleDef, type VehicleId } from './vehicles';
import { dataProgress, loadData, loadDataJson } from './data';
import { prefetchBoot } from './bootData';
import { loadingScreen } from './ui/identity';
import { titleShot } from './sf/titleShots';
import { Onboarding, type LoadState, type Screen } from './ui/onboarding';
import type { BoardEntry } from './ui/leaderboard';
import { OnlineBoard } from './leaderboard/leaderboard';
import { RACE_START, type RivalInfo } from './sf/rivals';
import { CourseRules, CourseTracker, type RulesMeta } from './rules/course';
import { rulesMeta } from './rules/hash';
import { decodeRun, encodeRun, fromBase64, InputDevice, RUN_TUNED, toBase64 } from './rules/runfile';
import { RULES_HASH } from 'virtual:sfkart-rules-hash';

const FRAME_SEC = 1 / 59.94;

/** The course: San Francisco, Golden Gate (built by tools/course/build.ts golden_gate). */
const COURSE_ID = 'golden_gate';
const COURSE_DIR = `courses/${COURSE_ID}`;

async function fetchBytes(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

const BEST_KEY = 'kart.best.v1';

/** Best-time key: per course, and per vehicle for the cars (the e-bike's is the bare course id). */
const bestKey = (courseId: string, vehicle: VehicleId) => (vehicle === 'ebike' ? courseId : `${courseId}@${vehicle}`);

function loadBests(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>;
    } catch {
        return {};
    }
}

/** The loading line while the data downloads (`core`: the course is in, the city still loading). */
function downloadState(core: boolean): LoadState {
    const p = dataProgress();
    const got = p.expected > 0 ? Math.min(1, p.received / p.expected) : 0;
    if (p.pending > 0 || !core) return { fraction: 0.9 * got, status: `Loading San Francisco… ${Math.floor(got * 100)}%`, ready: false };
    return { fraction: 0.95, status: 'Building the city…', ready: false };
}

async function main(): Promise<void> {
    const saved = loadMenuState();
    prefetchBoot(saved.streetDetail);
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const hudRoot = document.getElementById('hud') as HTMLElement;

    // The way in (title, vehicle, controls, welcome) shows at once; the game loads behind it and
    // fills in its hooks (`late`) as it goes.
    const late: {
        vehicle?: (id: VehicleId) => void;
        scheme?: (id: SchemeId) => void;
        race?: (vehicle: VehicleId, scheme: SchemeId) => void;
        load?: () => LoadState;
    } = {};
    /** The camera drifts through shots of the course (sf/titleShots.ts) behind the title and the ride picker, since this time. */
    let titleSince: number | null = null;
    let shownVeil = -1;
    const onboarding = new Onboarding(saved.vehicle, saved.scheme, {
        onVehicle: (id) => late.vehicle?.(id),
        onScheme: (id) => late.scheme?.(id),
        onScreen: (screen: Screen | null) => {
            titleSince = screen === 'title' || screen === 'vehicle' ? (titleSince ?? performance.now()) : null;
        },
        onRace: ({ vehicle, scheme }) => late.race?.(vehicle, scheme),
        loadState: () => late.load?.() ?? downloadState(false),
    });

    const [vehicleData, course] = await Promise.all([
        loadDataJson<VehicleDataFile>(VEHICLE_DATA),
        (async () => {
            const [kcl, kmp, meta] = await Promise.all([
                loadData(`${COURSE_DIR}/course.kcl`),
                loadData(`${COURSE_DIR}/course.kmp`),
                loadDataJson<CourseMeta>(`${COURSE_DIR}/course_meta.json`).catch(() => null),
            ]);
            return { files: new Map([['course.kcl', new Uint8Array(kcl)], ['course.kmp', new Uint8Array(kmp)]]), meta };
        })(),
    ]);
    // The engine's parameter files, packed from our vehicle data.
    const common = packVehicleFiles(vehicleData);
    const courseId = COURSE_ID;

    const renderer = new Renderer(canvas);
    const hud = new Hud(hudRoot);
    const input = new InputManager(canvas);
    const audio = new AudioEngine();
    const bests = loadBests();
    /** Procedural soundtrack for the San Francisco course. */
    const sfMusic = new SfMusic();

    const state0 = loadMenuState();
    renderer.setCourse(course.files.get('course.kcl')!, course.meta);
    /** The course HUD (minimap, section banners, position, results). */
    let sfHud: SfHud | null = null;
    const setupSfHud = () => {
        sfHud?.dispose();
        sfHud = renderer.sf && course.meta ? new SfHud(hudRoot, course.meta as unknown as SfHudMeta) : null;
        document.body.classList.toggle('sf', !!sfHud);
        renderer.sf?.setStreetDetail(state0.streetDetail);
        renderer.setRider(state0.vehicle);
    };
    setupSfHud();
    const sim = new Sim(common, course.files);
    // The course's rules (speed-up pickups, section splits): run by the sim after every frame.
    const rulesCourse = course.meta?.segments ? rulesMeta(course.meta as unknown as RulesMeta) : null;
    sim.setRules(rulesCourse ? new CourseRules(rulesCourse) : null);
    /** The vehicle the current race runs with (the menu's choice applies on the next start). */
    let vehicle: VehicleId = state0.vehicle;
    /** The tune (JSON) the current race runs with. */
    let raceTune = '';
    /** What makes runs comparable: the vehicle's tune (and the drift layer's version). */
    const runSig = (id: VehicleId) => `${JSON.stringify(effectiveTune(state0, id))}|drift|v${vehicleData.version}`;
    const tunedParams = new Map<string, Uint8Array>();
    /** kartParam.bin with `id`'s stats adjusted by `tune` (cached). */
    const kartParamFor = (id: VehicleId, tune: VehicleTune) => {
        const key = `${id}:${JSON.stringify(tune)}`;
        let b = tunedParams.get(key);
        if (!b) {
            b = packKartParam(vehicleData, { [id]: tuneStats(vehicleData.vehicles[id].stats, tune) });
            tunedParams.set(key, b);
        }
        return b;
    };
    const statsCache = new Map<string, StatSummary>();
    const statsFor = (id: VehicleId, tune: VehicleTune): StatSummary => {
        const key = `${id}:${JSON.stringify(tune)}`;
        let st = statsCache.get(key);
        if (!st) {
            st = summarize(tuneStats(vehicleData.vehicles[id].stats, tune));
            statsCache.set(key, st);
        }
        return st;
    };
    const applyVehicle = (id: VehicleId) => {
        const def = vehicleDef(id);
        const tune = effectiveTune(state0, id);
        sim.vehicle = vehicleSlot(id);
        sim.setKartParam(kartParamFor(id, tune));
        raceTune = runSig(id);
        audio.setEngineVoice(def.engineVoice);
        if (id !== vehicle) renderer.setRider(id);
        hud.setPickup(pickupKindFor(id));
        vehicle = id;
    };
    applyVehicle(vehicle);
    sim.laps = typeof course.meta?.laps === 'number' ? course.meta.laps : 1;
    sim.start();
    /** San Francisco's scenery is built (or there is none): a race can start. */
    let sceneReady = !renderer.sf;
    void renderer.sf?.ready.then(() => (sceneReady = true));
    late.load = () => (sceneReady ? { fraction: 1, status: 'Ready to race', ready: true } : downloadState(true));

    let paused = false;
    /** Debug free camera (window.__kart.look); null = the game camera. */
    let freeCam: CameraState | null = null;
    let showDebug = false;
    let acc = 0;
    let last = performance.now();
    let simTime = 0;
    let finishedFrames: number | null = null;
    let interpolate = false;

    // Vehicle comparison: this run's recording, its section splits, and the best runs as ghosts.
    const recorder = new RunRecorder();
    /** The stats were changed mid-race (dev tuning): the run can't be reproduced, so it isn't kept. */
    let liveTuned = false;
    let saveReplays = false;
    /** The last finished run as a run file (rules/runfile.ts), for the dev hook's lastRun(). */
    let lastRun: Promise<Uint8Array> | null = null;
    let ghosts: CompareGhosts | null = null;
    /** Your best run of each vehicle (kept as run files, runStore.ts) and their ghosts' pose tracks. */
    const bestRuns = new Map<VehicleId, StoredRun>();
    const ghostTracks = new Map<VehicleId, GhostRun>();
    const ghostLabel = (id: VehicleId, frames: number, tune: string) =>
        `${vehicleDef(id).short} ${formatFrames(frames).slice(0, -2)}${tune !== runSig(id) ? '*' : ''}`;
    const setupGhosts = () => {
        ghosts?.dispose();
        ghosts = null;
        if (!state0.ghosts || !renderer.sf) return;
        const runs = VEHICLES.map((v) => ghostTracks.get(v.id))
            .filter((r) => r !== undefined)
            .map((run) => ({ run, label: ghostLabel(run.vehicle, run.frames, run.tune) }));
        if (!runs.length) return;
        ghosts = new CompareGhosts(runs);
        renderer.scene.add(ghosts.group);
    };
    /** Simulates run files into ghosts, in a worker (made on first use). */
    let ghostSim: GhostSim | null = null;
    const ghostSimulator = () =>
        (ghostSim ??= new GhostSim({ kcl: course.files.get('course.kcl')!, kmp: course.files.get('course.kmp')!, meta: rulesCourse!, vehicles: vehicleData }));
    // The stored best runs: their ghosts are simulated from the files and join the race when ready.
    dropPoseGhosts();
    void loadRuns(courseId, VEHICLES.map((v) => v.id)).then((runs) => {
        for (const r of runs) {
            if (bestRuns.has(r.vehicle) || !rulesCourse) continue;
            bestRuns.set(r.vehicle, r);
            ghostSimulator()
                .track(r.file, r.tune)
                .then((t) => {
                    if (bestRuns.get(r.vehicle) !== r) return;
                    ghostTracks.set(r.vehicle, { vehicle: r.vehicle, frames: r.frames, stride: t.stride, samples: t.samples, splits: r.splits, tune: r.sig, date: r.date });
                    setupGhosts();
                })
                .catch((e) => console.warn(`${r.vehicle} ghost not simulated`, e));
        }
    });

    const applySettings = (s: typeof state0) => {
        input.setScheme(s.scheme);
        input.settings.smoothSteer = s.smoothSteer;
        interpolate = s.interpolate;
        input.settings.mouseSensitivity = s.mouseSensitivity;
        audio.setVolume(s.volume);
        audio.setMuted(s.muted);
        sfMusic.setVolume(s.muted ? 0 : s.volume * 0.8);
        renderer.sf?.setStreetDetail(s.streetDetail);
    };
    applySettings(state0);

    const restart = () => {
        sfMusic.stop(0.1);
        sim.start();
        sim.skipToCountdown();
        recorder.reset();
        liveTuned = false;
        input.usedGamepad = false;
        setupGhosts();
        renderer.sf?.items?.reset();
        renderer.sf?.items?.setKind(pickupKindFor(vehicle));
        sfHud?.resetSection();
        hudTrack?.reset();
        prevS = -1;
        sLaps = 0;
        finishFrame = null;
        finishShot = null;
        acc = 0;
        paused = false;
        finishedFrames = null;
        input.recenterMouse();
    };

    const menu = new Menu(state0, {
        onChange: applySettings,
        statsFor,
        onStart: async (s) => {
            audio.unlock();
            sfMusic.unlock();
            // The San Francisco scenery streams in after the menu shows: wait for it.
            const waitSf = async () => {
                if (!renderer.sf) return;
                const note = loadingScreen('Loading San Francisco…');
                document.body.appendChild(note);
                await renderer.sf.ready;
                note.remove();
            };
            applyVehicle(s.vehicle);
            applySettings(s);
            devTuning?.refresh();
            await waitSf();
            restart();
            if (s.scheme === 'mouse') void canvas.requestPointerLock();
        },
    });
    // The way in: the vehicle and scheme picked there, then the race.
    late.vehicle = (id) => {
        menu.set('vehicle', id);
        applyVehicle(id);
    };
    late.scheme = (id) => menu.set('scheme', id);
    late.race = (id, scheme) => {
        menu.set('vehicle', id);
        menu.set('scheme', scheme);
        menu.start();
    };
    onboarding.setFacts({ statsFor: (id) => statsFor(id, effectiveTune(state0, id)) });
    // The leaderboard: the rivals' laps and your best in each vehicle (until the online board).
    const yourLaps = (): BoardEntry[] =>
        VEHICLES.flatMap((v) => {
            const b = bests[bestKey(courseId, v.id)];
            return b !== undefined ? [{ name: 'You', vehicle: v.id, frames: b, you: true }] : [];
        });
    // The online board's top times join them (with SFK_API: leaderboard/).
    let rivalLaps: BoardEntry[] = [];
    let onlineLaps: BoardEntry[] = [];
    const showBoard = () => onboarding.setBoard([...rivalLaps, ...onlineLaps, ...yourLaps()]);
    showBoard();
    void loadDataJson<{ rivals: RivalInfo[] }>(`${COURSE_DIR}/rivals.json`)
        .then(({ rivals }) => {
            rivalLaps = rivals.map((r) => ({ name: r.name, vehicle: r.vehicle, frames: r.finishFrame - RACE_START }));
            showBoard();
        })
        .catch(() => {});
    const online = OnlineBoard.enabled() ? new OnlineBoard() : null;
    if (online) {
        online.onRows = (rows) => {
            onlineLaps = rows.map((r) => ({ name: r.name, vehicle: r.vehicle, frames: (r.timeMs * 59.94) / 1000 }));
            showBoard();
        };
    }

    // Dev tuning (dev tools only): stat adjustments applied to the running race, no restart.
    const devTuning = DEV_TOOLS
        ? new DevTuning({
              vehicle: () => vehicle,
              tune: (id) => effectiveTune(state0, id),
              statsFor,
              setTune: (id, tune) => {
                  menu.setTuneLive(id, tune);
                  if (id !== vehicle) return;
                  const t = effectiveTune(state0, id);
                  sim.setKartParam(kartParamFor(id, t));
                  sim.applyLiveStats(engineStats(tuneStats(vehicleData.vehicles[id].stats, t)));
                  raceTune = runSig(id);
                  if (sim.racing()) liveTuned = true;
              },
              switchVehicle: (id) => {
                  menu.set('vehicle', id);
                  menu.start();
                  hud.flash(`Vehicle: ${vehicleDef(id).name}`);
                  devTuning?.refresh();
              },
              tuneJson: () => menu.tuneJson(),
          })
        : null;

    window.addEventListener('keydown', (e) => {
        // (The way in handles its own keys.)
        if (onboarding.isOpen()) return;
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
        if (e.code === 'Enter' && menu.isOpen()) {
            e.preventDefault();
            menu.start();
        } else if (e.code === 'Enter' && finishedFrames !== null) {
            e.preventDefault();
            restart();
        } else if (e.code === 'Escape') {
            if (menu.isOpen()) menu.resume();
            else {
                menu.open();
                audio.quiet();
            }
        }
    });

    /** The kart's course S for the HUD (and the nearest centerline station: hudTrack.station). */
    const hudTrack = course.meta?.centerline ? new CourseTracker(course.meta as unknown as SfHudMeta) : null;
    let prevS = -1;
    let sLaps = 0;
    let finishFrame: number | null = null;
    const fwd = new THREE.Vector3();
    const updateSfHud = (view: ReturnType<Sim['view']>) => {
        const meta = course.meta as unknown as SfHudMeta;
        const p = view.kart.pos;
        const S = hudTrack!.update(p);
        const startS = meta.start?.s ?? 0;
        // Unwrap across the start of the centerline (only there: S = 0 is near the finish line).
        const nearWrap = (x: number) => x < 30000 || x > meta.length - 30000;
        if (prevS >= 0 && nearWrap(S) && nearWrap(prevS)) {
            if (S < prevS - meta.length / 2) ++sLaps;
            if (S > prevS + meta.length / 2) --sLaps;
        }
        prevS = S;
        const dist = sLaps * meta.length + S - startS;
        const rivals = renderer.sf?.rivals ?? null;
        fwd.set(0, 0, 1).applyQuaternion(view.kart.rot);
        sfHud!.update(
            {
                kart: { x: p.x, z: p.z, yawRad: Math.atan2(fwd.x, fwd.z) },
                progress: view.hud.raceFrames === null ? 0 : (((S - startS) % meta.length) + meta.length) % meta.length / meta.length,
                speed: view.hud.speed,
                racing: view.hud.raceFrames !== null,
                rivals: [...(rivals?.dots() ?? []), ...(ghosts?.dots() ?? [])],
            },
            S,
        );
        sfHud!.setPosition(rivals && view.hud.raceFrames !== null ? rivals.position(dist, sim.frame(), finishFrame) : null, (rivals?.count() ?? 0) + 1);
        const sec = Object.entries(meta.segments).find(([, r]) => S >= r[0] && S < r[1])?.[0] ?? '';
        sfMusic.intensity = ['palace', 'marina'].includes(sec) ? 2 : ['bridge_nb', 'vista', 'bridge_sb', 'parkway'].includes(sec) ? 1 : 0;
    };

    const courseName = () => course.meta?.name ?? courseId;

    const onFinish = () => {
        const lapTimes = sim.view(1).hud.lapTimes;
        const total = lapTimes.reduce((a, b) => a + b, 0);
        finishedFrames = total;
        finishFrame = sim.frame();
        const rivals = renderer.sf?.rivals;
        const key = bestKey(courseId, vehicle);
        // Section durations from the frames the sim saw the kart enter each (in lap order; the
        // last one runs to the finish).
        const names = Object.keys(rulesCourse?.segments ?? {});
        const entries = sim.splits().flatMap((f, i) => (f > 0 ? [[names[i]!, f] as const] : []));
        const splits: Record<string, number> = {};
        entries.forEach(([k, f], i) => (splits[k] = (entries[i + 1]?.[1] ?? entries[0]![1] + total) - f));
        // The run as a run file: its pads, what they were raced under, the claimed finish and splits.
        if (sim.recording.length) {
            const device = input.usedGamepad ? InputDevice.Gamepad : input.scheme().mouseSteer ? InputDevice.Mouse : InputDevice.Keyboard;
            const tuned = liveTuned || !isStock(effectiveTune(state0, vehicle));
            lastRun = encodeRun({ rulesHash: RULES_HASH, vehicle, device, flags: tuned ? RUN_TUNED : 0, finishFrame: sim.finishFrame ?? finishFrame, splits: sim.splits(), pads: sim.recording.slice() });
            lastRun.catch((e) => console.warn('run file not written', e));
            // The online board: posted if it beats your time there (the server races it again).
            const ms = sim.raceMs();
            if (online && !tuned && !sim.isReplay() && ms !== null) void online.finished(vehicle, ms, lastRun);
        }
        const prevBest = bestRuns.get(vehicle);
        // (Ghost replays count only when asked to, from the debug hook.)
        const newBest = total > 0 && !liveTuned && (!sim.isReplay() || saveReplays) && (!prevBest || total < prevBest.frames || prevBest.sig !== raceTune);
        if (newBest) {
            // The ghost from this run's poses right away; the run itself kept as its run file.
            ghostTracks.set(vehicle, recorder.run(vehicle, total, splits, raceTune));
            bestRuns.delete(vehicle);
            const id = vehicle;
            const at = sim.finishFrame;
            const keep = { course: courseId, vehicle: id, frames: total, splits, sig: raceTune, tune: effectiveTune(state0, id), date: Date.now() };
            void lastRun?.then((file) => {
                const r: StoredRun = { ...keep, file };
                bestRuns.set(id, r);
                void storeRun(r);
                // Dev check: the run simulated from its file (in another JS realm) finishes the same.
                if (DEV_TOOLS && rulesCourse) void ghostSimulator().track(file, r.tune).then((t) => {
                    if (t.finishFrame !== at) console.warn(`run replay diverged: finishes on frame ${t.finishFrame}, not ${at}`);
                    else console.info(`run replay checked: finishes on frame ${at}`);
                });
            });
        }
        if (total > 0 && !liveTuned && (!sim.isReplay() || saveReplays) && (bests[key] === undefined || total < bests[key]!)) {
            bests[key] = total;
            localStorage.setItem(BEST_KEY, JSON.stringify(bests));
        }
        // Compare: this run and the best run of every vehicle.
        const cols: SplitColumn[] = [{ name: `This run`, color: vehicleDef(vehicle).color, splits, total, current: true, note: vehicleDef(vehicle).name + (liveTuned ? ' · tuned mid-race, not kept' : newBest ? ' · new best' : '') }];
        for (const v of VEHICLES) {
            const r = v.id === vehicle && newBest ? null : bestRuns.get(v.id);
            if (r) cols.push({ name: `${v.name} best`, color: v.color, splits: r.splits, total: r.frames, note: r.sig !== runSig(v.id) ? 'other tune/drift' : undefined });
        }
        const results = sfHud && rivals ? [...rivals.finishes(), { name: `You · ${vehicleDef(vehicle).name}`, color: '#ffcc00', frames: total, you: true }] : null;
        // The board comes up after FINISH! (finishCamera).
        finishShot = renderer.sf ? { t0: simTime, ang0: 0, delta: 0, dist0: 0, h0: 0, tgt0: new THREE.Vector3(), started: false, results, compare: cols } : null;
    };

    // The finish (San Francisco), arcade style: FINISH! for a moment, then the results board; the
    // camera swings round from behind the rider to a low three-quarter view of their front (on the
    // road side, framed left of the board) and keeps circling slowly. Timed in race time, so
    // stepped replays (playthrough recordings) show it the same.
    let finishShot: {
        t0: number;
        ang0: number;
        delta: number;
        dist0: number;
        h0: number;
        tgt0: THREE.Vector3;
        started: boolean;
        results: Parameters<SfHud['showResults']>[0] | null;
        compare: SplitColumn[];
    } | null = null;
    const SWING_SEC = 2.8;
    const RESULTS_SEC = 1.5;
    /** Where the shot's target settles: above the kart. */
    const SHOT_LOOK = new THREE.Vector3(0, 80, 0);
    const shotPos = new THREE.Vector3();
    const shotTarget = new THREE.Vector3();
    const finishCamera = (view: ReturnType<Sim['view']>): CameraState | null => {
        const shot = finishShot;
        if (!shot || !renderer.sf) return null;
        const t = Math.max(0, simTime - shot.t0);
        if (shot.results && t > RESULTS_SEC) {
            sfHud?.showResults(shot.results, formatFrames, shot.compare, online?.status);
            shot.results = null;
        }
        const k = view.kart.pos;
        const c = view.camera;
        if (!shot.started) {
            shot.started = true;
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(view.kart.rot);
            shot.ang0 = Math.atan2(c.pos.x - k.x, c.pos.z - k.z);
            shot.dist0 = Math.hypot(c.pos.x - k.x, c.pos.z - k.z);
            shot.h0 = c.pos.y - k.y;
            shot.tgt0.copy(c.target).sub(k);
            // Ahead of the kart, a little to the side with more road (the kart may be on its way into a wall).
            const st = (course.meta as unknown as { centerline: { pos: number[]; right: number[] }[] }).centerline[hudTrack?.station ?? 0];
            const onRight = st ? (k.x - st.pos[0]!) * st.right[0]! + (k.z - st.pos[2]!) * st.right[2]! > 0 : true;
            let d = Math.atan2(fwd.x, fwd.z) + (onRight ? 0.55 : -0.55) - shot.ang0;
            d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            shot.delta = d;
        }
        const x = Math.min(1, t / SWING_SEC);
        const e = x * x * (3 - 2 * x);
        const ang = shot.ang0 + shot.delta * e + Math.sign(shot.delta) * 0.08 * Math.max(0, t - SWING_SEC);
        const dist = shot.dist0 + (620 - shot.dist0) * e;
        const pos = shotPos.set(k.x + Math.sin(ang) * dist, k.y + shot.h0 + (190 - shot.h0) * e, k.z + Math.cos(ang) * dist);
        const world = renderer.sf.world;
        if (world) pos.y = Math.max(pos.y, world.groundY(pos.x, pos.z) + 120);
        const target = shotTarget.copy(shot.tgt0).lerp(SHOT_LOOK, e).add(k);
        // Frame the rider left of centre: the results board is on the right.
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        target.x -= (dz / dl) * dist * 0.32 * e;
        target.z += (dx / dl) * dist * 0.32 * e;
        return { pos, target, fov: c.fov };
    };

    // ...while the game drives the kart on: along the course line at a cruise, then
    // braking to a stop, so the shot doesn't end against a wall (nor the kart run into a second finish).
    const autoPrev = new THREE.Vector3();
    const finishPad = (shot: NonNullable<typeof finishShot>): RawPadState => {
        const cl = (course.meta as unknown as SfHudMeta).centerline;
        const p = sim.kartPos();
        const f = sim.kartForward();
        // Forward speed (units per frame; negative when reversing).
        const speed = (p.x - autoPrev.x) * f.x + (p.z - autoPrev.z) * f.z;
        autoPrev.copy(p);
        let j = hudTrack?.station ?? 0;
        for (let ahead = 0, n = 0; ahead < 1800 && n < cl.length; ++n) {
            const k = (j + 1) % cl.length;
            ahead += Math.hypot(cl[k]!.pos[0] - cl[j]!.pos[0], cl[k]!.pos[2] - cl[j]!.pos[2]);
            j = k;
        }
        let alpha = Math.atan2(cl[j]!.pos[0] - p.x, cl[j]!.pos[2] - p.z) - Math.atan2(f.x, f.z);
        alpha = ((alpha + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const t = simTime - shot.t0;
        // (Braking only while it's still rolling forward: held at a standstill it would reverse.)
        const buttons = t > 8 ? (speed > 4 ? BUTTON_BRAKE : 0) : speed < 55 ? BUTTON_ACCELERATE : 0;
        return { buttons, stickXRaw: Math.round(Math.max(-1, Math.min(1, -4 * alpha)) * 7) + 7, stickYRaw: 7, trick: 0 };
    };

    // The speed-up pickups' bursts (the sim collects them and stores the speed-ups: rules/course.ts).
    const showPickups = () => {
        if (renderer.sf?.items && sim.racing()) renderer.sf.items.check(sim.kartPos(), sim.frame());
    };

    const stepOnce = () => {
        sim.step(finishShot && course.meta ? finishPad(finishShot) : input.sample());
        simTime += FRAME_SEC;
        recorder.push(sim.frame(), sim.kartPos(), sim.kartRot());
        showPickups();
        for (const ev of sim.events) {
            audio.event(ev);
            if (ev.type === 'finish') onFinish();
            if (ev.type === 'itemBox') hud.pickupFlash(ev.stored);
            if (renderer.sf) {
                if (ev.type === 'go') sfMusic.play();
                else if (ev.type === 'finish') sfMusic.stop(2.5);
            }
        }
        sim.events.length = 0;
    };

    const frame = (now: number) => {
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        const inMenu = menu.isOpen() || onboarding.isOpen();
        input.enabled = !inMenu;

        if (!inMenu) {
            if (input.consumePress('Backspace')) restart();
            if (input.consumePress('KeyP')) paused = !paused;
            if (DEV_TOOLS && input.consumePress('Backquote')) showDebug = !showDebug;
            // B: street detail (DataSF crosswalks, sidewalks, bike lanes, meters) on / off.
            if (input.consumePress('KeyB') && renderer.sf) {
                const on = !menu.state.streetDetail;
                menu.set('streetDetail', on);
                renderer.sf.setStreetDetail(on);
                hud.flash(on ? 'Street detail: On' : 'Street detail: Off');
            }
            // K (dev tools): the live tuning panel.
            if (devTuning && input.consumePress('KeyK')) devTuning.toggle();
            // C: the next vehicle (restarts), for back-to-back comparisons.
            if (input.consumePress('KeyC')) {
                const next = VEHICLES[(VEHICLES.findIndex((v) => v.id === state0.vehicle) + 1) % VEHICLES.length]!;
                menu.set('vehicle', next.id);
                menu.start();
                hud.flash(`Vehicle: ${next.name}`);
            }
        }

        if (inMenu || paused) sfMusic.pause();
        else sfMusic.resume();
        if (inMenu || paused) {
            if (DEV_TOOLS && !inMenu && input.consumePress('Period')) stepOnce();
            acc = 0;
            audio.quiet();
        } else {
            acc += dt;
            while (acc >= FRAME_SEC) {
                stepOnce();
                acc -= FRAME_SEC;
            }
            audio.update(sim.audioFrame());
        }
        input.endFrame();

        const view = sim.view(inMenu || paused || !interpolate ? 1 : acc / FRAME_SEC);
        // Render resolution (presentation only): steps up only while nothing races on screen.
        renderer.scale.update(dt * 1000, inMenu || paused ? ScaleMoment.Idle : sim.racing() ? ScaleMoment.Racing : ScaleMoment.Calm);
        renderer.frame = sim.frame();
        ghosts?.update(sim.frame(), simTime, (freeCam ?? view.camera).pos);
        const title = titleSince !== null && renderer.sf ? titleShot((now - titleSince) / 1000) : null;
        const veil = title && sceneReady ? title.veil : 0;
        if (Math.abs(veil - shownVeil) > 0.004) document.documentElement.style.setProperty('--veil', (shownVeil = veil).toFixed(3));
        renderer.render(view.kart, freeCam ?? title?.camera ?? finishCamera(view) ?? view.camera, simTime);
        if (sfHud && course.meta) updateSfHud(view);
        hud.update(
            {
                ...view.hud,
                // San Francisco: FINISH! gives way to the results board (finishCamera).
                countdown: sfHud && finishShot && simTime - finishShot.t0 > RESULTS_SEC ? null : view.hud.countdown,
                paused: paused && !inMenu,
                debug: showDebug ? `${sim.debugText()}\n${renderer.scale.debugText()}` : null,
            },
            {
                mouseStick: input.mouseStickValue(),
                pointerLocked: input.pointerLocked(),
                itemKey: input.scheme().quick.find(([, a]) => a === 'Speed-up')?.[0] ?? 'E',
            },
        );

        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // Debug hook for automated testing (dev tools only): step frames with a scripted pad state and render.
    if (DEV_TOOLS) (window as unknown as Record<string, unknown>).__kart = {
        sim,
        menu,
        renderer,
        /** Steps n frames with `pad` (pickups, recording and the finish as in play); `draw`: render the result. */
        step(n: number, pad: Partial<ReturnType<InputManager['sample']>> = {}, draw = true) {
            paused = true;
            onboarding.close();
            if (menu.isOpen()) menu.close();
            for (let i = 0; i < n; ++i) {
                sim.step({ buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: 0, ...pad });
                simTime += FRAME_SEC;
                showPickups();
                // The finish still counts (results board, final place; playthrough recordings).
                if (sim.events.some((ev) => ev.type === 'finish')) onFinish();
                sim.events.length = 0;
            }
            if (!draw) return sim.frame();
            const view = sim.view(1);
            renderer.frame = sim.frame();
            renderer.render(view.kart, finishCamera(view) ?? view.camera, simTime);
            return sim.debugText();
        },
        /** Runs n game frames through the full race loop (events, recording, splits) without drawing. */
        fastForward(n: number) {
            paused = true;
            onboarding.close();
            if (menu.isOpen()) menu.close();
            for (let i = 0; i < n; ++i) {
                stepOnce();
                if (sfHud && course.meta) updateSfHud(sim.view(1));
            }
            const view = sim.view(1);
            renderer.frame = sim.frame();
            ghosts?.update(sim.frame(), simTime, view.camera.pos);
            renderer.render(view.kart, view.camera, simTime);
            return sim.frame();
        },
        /** The last finished run's run file (rules/runfile.ts), base64; null before one finishes. */
        async lastRun() {
            return lastRun ? toBase64(await lastRun) : null;
        },
        /**
         * Watches a run file (base64) through the live path (Sim.startRun): the run's vehicle with its
         * stock numbers and its pads from the start. watch(null) returns to live play.
         */
        async watch(file: string | null) {
            finishShot = null;
            finishFrame = null;
            if (file) {
                const run = await decodeRun(fromBase64(file));
                applyVehicle(run.vehicle);
                sim.setKartParam(kartParamFor(run.vehicle, STOCK_TUNE));
                sim.startRun(run.pads);
            } else {
                sim.stopReplay();
                applyVehicle(state0.vehicle);
            }
            restart();
            return 'ok';
        },
        /** Keep ghost replays' finishes as the vehicle's best run (to seed comparisons from bot laps). */
        saveReplays(on: boolean) {
            saveReplays = on;
        },
        /** Replays an RKG ghost (URL) on the current course; replay(null) returns to live play. */
        async replay(url: string | null) {
            finishShot = null;
            finishFrame = null;
            if (url) sim.startGhost(await fetchBytes(url));
            else sim.stopReplay();
            restart();
            return 'ok';
        },
        /**
         * Render resolution: renderScale.info(), .pin(scale | null) to hold a pixel ratio,
         * .pinBudget(ms | null) to pretend the display wants faster frames (forces a step down).
         */
        renderScale: renderer.scale,
        /** Renders one frame from a free camera (screenshots of any part of the course). */
        look(pos: [number, number, number] | null, target: [number, number, number] = [0, 0, 0], fov = 60) {
            paused = true;
            onboarding.close();
            if (menu.isOpen()) menu.close();
            freeCam = pos ? { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target), fov } : null;
            const view = sim.view(1);
            renderer.render(view.kart, freeCam ?? view.camera, simTime);
        },
    };
}

main().catch((err) => {
    console.error(err);
    const pre = document.createElement('pre');
    pre.className = 'fatal';
    pre.textContent = String(err?.stack ?? err);
    document.body.replaceChildren(pre);
});
