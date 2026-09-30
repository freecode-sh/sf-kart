/**
 * Browser entry point: loads data, runs the physics at the engine's 59.94 Hz frame rate with a fixed
 * timestep, and renders with Three.js.
 */

import * as THREE from 'three';
import { AudioEngine } from './audio';
import { formatFrames, Hud } from './hud';
import { BUTTON_ACCELERATE, BUTTON_BRAKE, InputManager, type RawPadState } from './input';
import { DEV_TOOLS } from './devMode';
import { effectiveTune, loadMenuState, Menu } from './menu';
import { Renderer, type CameraState, type CourseMeta } from './renderer';
import { ScaleMoment } from './renderScale';
import { Sim } from './sim';
import { SfHud, type SfHudMeta } from './sf/sfHud';
import { SfMusic } from './sf/music';
import { CompareGhosts, loadRun, RunRecorder, saveRun } from './sf/ghosts';
import { pickupKindFor } from './sf/itemBoxes';
import { DevTuning } from './devTuning';
import type { SplitColumn } from './sf/sfHud';
import { STOCK_TUNE, summarize, tuneStats, type StatSummary, type VehicleTune } from './tuning';
import { engineStats, packVehicleFiles, VEHICLE_DATA_URL, vehicleSlot, type VehicleDataFile } from './vehicleData';
import { Leaderboard } from './leaderboard/leaderboard';
import { RULES } from './leaderboard/api';
import { finishTimeMs, kartParamFor as packTunedKartParam } from './run/race';
import { encodeRun } from './run/runFile';
import { VEHICLES, vehicleDef, type VehicleId } from './vehicles';
import { DATA_BASE } from './paths';

const FRAME_SEC = 1 / 59.94;

/** The course: San Francisco, Golden Gate (built by tools/course/build.ts golden_gate). */
const COURSE_ID = 'golden_gate';
const COURSE_DIR = `${DATA_BASE}/courses/${COURSE_ID}`;

async function fetchBytes(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
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

async function main(): Promise<void> {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const hudRoot = document.getElementById('hud') as HTMLElement;
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Loading…';
    document.body.appendChild(loading);

    const [vehicleData, course] = await Promise.all([
        (async () => {
            const data = await fetchJson<VehicleDataFile>(VEHICLE_DATA_URL);
            if (!data) throw new Error(`Failed to load ${VEHICLE_DATA_URL}`);
            return data;
        })(),
        (async () => {
            const [kcl, kmp, meta] = await Promise.all([
                fetchBytes(`${COURSE_DIR}/course.kcl`),
                fetchBytes(`${COURSE_DIR}/course.kmp`),
                fetchJson<CourseMeta>(`${COURSE_DIR}/course_meta.json`),
            ]);
            return { files: new Map([['course.kcl', kcl], ['course.kmp', kmp]]), meta };
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
    /** The vehicle the current race runs with (the menu's choice applies on the next start). */
    let vehicle: VehicleId = state0.vehicle;
    /** The tune (JSON) the current race runs with. */
    let raceTune = '';
    /** What makes runs comparable: the vehicle's tune and the vehicle data's version (saved runs store this string). */
    const runSig = (id: VehicleId) => `${JSON.stringify(effectiveTune(state0, id))}|drift|v${vehicleData.version}`;
    const tunedParams = new Map<string, Uint8Array>();
    /** kartParam.bin with `id`'s stats adjusted by `tune` (cached). */
    const kartParamFor = (id: VehicleId, tune: VehicleTune) => {
        const key = `${id}:${JSON.stringify(tune)}`;
        let b = tunedParams.get(key);
        if (!b) {
            b = packTunedKartParam(vehicleData, id, tune);
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
    loading.remove();

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
    let splitEntry: Record<string, number> = {};
    let splitSection = '';
    let ghosts: CompareGhosts | null = null;
    const ghostLabel = (id: VehicleId, frames: number, tune: string) =>
        `${vehicleDef(id).short} ${formatFrames(frames).slice(0, -2)}${tune !== runSig(id) ? '*' : ''}`;
    const setupGhosts = () => {
        ghosts?.dispose();
        ghosts = null;
        if (!state0.ghosts || !renderer.sf) return;
        const runs = VEHICLES.map((v) => loadRun(courseId, v.id))
            .filter((r) => r !== null)
            .map((run) => ({ run, label: ghostLabel(run.vehicle, run.frames, run.tune) }));
        if (!runs.length) return;
        ghosts = new CompareGhosts(runs);
        renderer.scene.add(ghosts.group);
    };

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
        splitEntry = {};
        splitSection = '';
        setupGhosts();
        renderer.sf?.items?.reset();
        renderer.sf?.items?.setKind(pickupKindFor(vehicle));
        sfHud?.resetSection();
        lastStation = 0;
        prevS = -1;
        sLaps = 0;
        finishFrame = null;
        finishShot = null;
        acc = 0;
        paused = false;
        finishedFrames = null;
        input.recenterMouse();
    };

    const leaderboard = Leaderboard.enabled() ? new Leaderboard() : null;
    const menu = new Menu(state0, {
        onChange: applySettings,
        leaderboard: leaderboard ?? undefined,
        bestFor: (v) => {
            const b = bests[bestKey(courseId, v)];
            return b !== undefined ? formatFrames(b) : null;
        },
        statsFor,
        onStart: async (s) => {
            audio.unlock();
            sfMusic.unlock();
            // The San Francisco scenery streams in after the menu shows: wait for it.
            const waitSf = async () => {
                if (!renderer.sf) return;
                const note = document.createElement('div');
                note.className = 'loading';
                note.textContent = 'Loading San Francisco…';
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
    menu.open();

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

    /** Nearest centerline station to the kart (windowed search from the last one). */
    let lastStation = 0;
    let prevS = -1;
    let sLaps = 0;
    let finishFrame: number | null = null;
    const fwd = new THREE.Vector3();
    const updateSfHud = (view: ReturnType<Sim['view']>) => {
        const meta = course.meta as unknown as SfHudMeta;
        const cl = meta.centerline;
        const p = view.kart.pos;
        let best = lastStation;
        let bd = Infinity;
        const scan = (i: number) => {
            const c = cl[(i + cl.length) % cl.length]!;
            const d = (c.pos[0] - p.x) ** 2 + (c.pos[2] - p.z) ** 2 + ((c.pos[1] - p.y) * 3) ** 2;
            if (d < bd) {
                bd = d;
                best = (i + cl.length) % cl.length;
            }
        };
        for (let k = -40; k <= 40; ++k) scan(lastStation + k);
        if (bd > 1600 ** 2) for (let i = 0; i < cl.length; ++i) scan(i);
        lastStation = best;
        // Continuous S: project onto the segment to the next / previous station.
        let S = cl[best]!.s;
        {
            const a = cl[best]!;
            for (const nb of [cl[(best + 1) % cl.length]!, cl[(best - 1 + cl.length) % cl.length]!]) {
                const dx = nb.pos[0] - a.pos[0];
                const dz = nb.pos[2] - a.pos[2];
                const L2 = dx * dx + dz * dz;
                const t = L2 > 0 ? ((p.x - a.pos[0]) * dx + (p.z - a.pos[2]) * dz) / L2 : 0;
                if (t > 0 && t <= 1) {
                    let ds = nb.s - a.s;
                    if (ds < -meta.length / 2) ds += meta.length;
                    if (ds > meta.length / 2) ds -= meta.length;
                    S = (a.s + t * ds + meta.length) % meta.length;
                    break;
                }
            }
        }
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
        // Section splits: the race frame the kart first entered each section.
        if (view.hud.raceFrames !== null && finishFrame === null && sec && sec !== splitSection) {
            splitSection = sec;
            splitEntry[sec] ??= view.hud.raceFrames;
        }
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
        // Section durations from the entry frames (in lap order).
        const entries = Object.entries(splitEntry).sort((a, b) => a[1] - b[1]);
        const splits: Record<string, number> = {};
        entries.forEach(([k, f], i) => (splits[k] = (entries[i + 1]?.[1] ?? total) - f));
        const run = recorder.run(vehicle, total, splits, raceTune);
        const prevBest = loadRun(courseId, vehicle);
        // (Ghost replays count only when asked to, from the debug hook.)
        const newBest = total > 0 && !liveTuned && (!sim.isReplay() || saveReplays) && (!prevBest || total < prevBest.frames || prevBest.tune !== raceTune);
        if (newBest) saveRun(courseId, run);
        // The leaderboard: the run itself (its engine inputs up to this frame), if it raced the stock vehicle.
        const timeMs = finishTimeMs();
        if (leaderboard && !liveTuned && !sim.isReplay() && timeMs !== null && raceTune.startsWith(`${JSON.stringify(STOCK_TUNE)}|`)) {
            void leaderboard.finished(vehicle, timeMs, encodeRun({ vehicle, rules: RULES, timeMs, inputs: sim.recording.slice() }));
        }
        if (total > 0 && !liveTuned && (bests[key] === undefined || total < bests[key]!)) {
            bests[key] = total;
            localStorage.setItem(BEST_KEY, JSON.stringify(bests));
        }
        // Compare: this run and the best run of every vehicle.
        const cols: SplitColumn[] = [{ name: `This run`, color: vehicleDef(vehicle).color, splits, total, current: true, note: vehicleDef(vehicle).name + (liveTuned ? ' · tuned mid-race, not kept' : newBest ? ' · new best' : '') }];
        for (const v of VEHICLES) {
            const r = v.id === vehicle && newBest ? null : loadRun(courseId, v.id);
            if (r) cols.push({ name: `${v.name} best`, color: v.color, splits: r.splits, total: r.frames, note: r.tune !== runSig(v.id) ? 'other tune/drift' : undefined });
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
            sfHud?.showResults(shot.results, formatFrames, shot.compare, leaderboard?.status);
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
            const st = (course.meta as unknown as { centerline: { pos: number[]; right: number[] }[] }).centerline[lastStation];
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
        let j = lastStation;
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

    const stepOnce = () => {
        sim.step(finishShot && course.meta ? finishPad(finishShot) : input.sample());
        simTime += FRAME_SEC;
        recorder.push(sim.frame(), sim.kartPos(), sim.kartRot());
        // Speed-up pickups (San Francisco): drive through one for an instant boost.
        if (renderer.sf?.items && sim.racing() && renderer.sf.items.check(sim.kartPos(), sim.frame())) {
            sim.pickupBoost();
            sim.events.push({ type: 'itemBox' });
        }
        for (const ev of sim.events) {
            audio.event(ev);
            if (ev.type === 'finish') onFinish();
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
        const inMenu = menu.isOpen();
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
        renderer.render(view.kart, freeCam ?? finishCamera(view) ?? view.camera, simTime);
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
                itemKey: input.scheme().help.find(([, a]) => a === 'speed-up')?.[0] ?? 'item',
                courseName: courseName(),
                best: bests[bestKey(courseId, vehicle)] ?? finishedFrames,
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
        step(n: number, pad: Partial<ReturnType<InputManager['sample']>> = {}) {
            paused = true;
            if (menu.isOpen()) menu.close();
            for (let i = 0; i < n; ++i) {
                sim.step({ buttons: 0, stickXRaw: 7, stickYRaw: 7, trick: 0, ...pad });
                simTime += FRAME_SEC;
                // The finish still counts (results board, final place; playthrough recordings).
                if (sim.events.some((ev) => ev.type === 'finish')) onFinish();
                sim.events.length = 0;
                // Speed-up pickups boost as in play (ghost replays too: the same boost on the same
                // frame, so a recorded run replays in sync).
                if (renderer.sf?.items && sim.racing() && renderer.sf.items.check(sim.kartPos(), sim.frame())) sim.pickupBoost();
            }
            const view = sim.view(1);
            renderer.frame = sim.frame();
            renderer.render(view.kart, finishCamera(view) ?? view.camera, simTime);
            return sim.debugText();
        },
        /** Runs n game frames through the full race loop (events, recording, splits) without drawing. */
        fastForward(n: number) {
            paused = true;
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
            if (menu.isOpen()) menu.close();
            freeCam = pos ? { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target), fov } : null;
            const view = sim.view(1);
            renderer.render(view.kart, freeCam ?? view.camera, simTime);
        },
    };
}

main().catch((err) => {
    console.error(err);
    document.body.innerHTML = `<pre style="color:#f88;padding:20px">${String(err?.stack ?? err)}</pre>`;
});
