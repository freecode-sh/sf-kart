/**
 * Races the Golden Gate lap in the live Sim, main.ts style (easy drift, hop tricks, the start boost,
 * the pickups), with a pure-pursuit driver that also drifts through bends, hops and uses a
 * speed-up now and then: runs for tests/run.test.ts and leaderboard smoke tests.
 */

import { readFileSync } from 'node:fs';
import { Sim } from '../src/app/sim';
import { BUTTON_ACCELERATE, BUTTON_DRIFT, BUTTON_ITEM, type RawPadState } from '../src/app/input';
import { finishTimeMs, kartParamFor } from '../src/app/run/race';
import type { RulesData } from '../src/app/run/verify';
import { PickupField, pickupRows } from '../src/app/sf/pickupField';
import { packVehicleFiles, vehicleSlot, type VehicleDataFile } from '../src/app/vehicleData';
import type { VehicleId } from '../src/app/vehicles';

const DIR = 'public/data/courses/golden_gate';
const vehicleData = JSON.parse(readFileSync('public/data/vehicles/vehicles.json', 'utf8')) as VehicleDataFile;
const course = new Map([
    ['course.kcl', new Uint8Array(readFileSync(`${DIR}/course.kcl`))],
    ['course.kmp', new Uint8Array(readFileSync(`${DIR}/course.kmp`))],
]);
const meta = JSON.parse(readFileSync(`${DIR}/course_meta.json`, 'utf8')) as RulesData['meta'];
export const data: RulesData = { vehicleData, course, meta };

/** Races `frames` frames, or to the finish. */
export function liveRun(vehicle: VehicleId, frames: number) {
    const sim = new Sim(packVehicleFiles(vehicleData), course);
    sim.vehicle = vehicleSlot(vehicle);
    sim.setKartParam(kartParamFor(vehicleData, vehicle));
    sim.laps = meta.laps ?? 1;
    sim.start();
    sim.skipToCountdown();
    const field = new PickupField(meta.centerline, pickupRows(meta.segments));
    const cl = meta.centerline;
    const pickups: number[] = [];
    let station = 0;
    let finished = false;
    for (let i = 0; sim.recording.length < frames && !finished; ++i) {
        const p = sim.kartPos();
        const f = sim.kartForward();
        let best = station;
        let bd = Infinity;
        for (let k = -40; k <= 40; ++k) {
            const j = (station + k + cl.length) % cl.length;
            const d = (cl[j]!.pos[0] - p.x) ** 2 + (cl[j]!.pos[2] - p.z) ** 2 + ((cl[j]!.pos[1] - p.y) * 3) ** 2;
            if (d < bd) [bd, best] = [d, j];
        }
        station = best;
        let j = station;
        for (let ahead = 0; ahead < 1800; ) {
            const k = (j + 1) % cl.length;
            ahead += Math.hypot(cl[k]!.pos[0] - cl[j]!.pos[0], cl[k]!.pos[2] - cl[j]!.pos[2]);
            j = k;
        }
        let alpha = Math.atan2(cl[j]!.pos[0] - p.x, cl[j]!.pos[2] - p.z) - Math.atan2(f.x, f.z);
        alpha = ((alpha + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const steer = Math.max(-1, Math.min(1, -4 * alpha));
        let buttons = BUTTON_ACCELERATE;
        if (Math.abs(alpha) > 0.25 || i % 97 === 0) buttons |= BUTTON_DRIFT;
        if (i % 600 === 300) buttons |= BUTTON_ITEM;
        const pad: RawPadState = { buttons, stickXRaw: Math.round(steer * 7) + 7, stickYRaw: 7, trick: 0 };
        sim.step(pad);
        if (sim.racing() && field.check(sim.kartPos(), sim.frame()) > 0) {
            sim.pickupBoost();
            pickups.push(sim.frame());
        }
        finished = sim.events.some((e) => e.type === 'finish');
        sim.events.length = 0;
    }
    const p = sim.kartPos();
    return { inputs: [...sim.recording], pickups, pos: [p.x, p.y, p.z], finished, timeMs: finishTimeMs() };
}
