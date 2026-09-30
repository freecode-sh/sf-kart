/**
 * The interface every San Francisco vehicle model implements (ebike.ts, robotaxi.ts, buggy.ts;
 * built by id in vehicleModels.ts) and the trick flourish the renderer turns them with.
 */

import * as THREE from 'three';

export interface VehicleState {
    timeSec: number;
    steer: number;
    speed: number;
    drifting: number;
    boosting: boolean;
    airborne: boolean;
    wheelie: boolean;
    /** The trick in progress: its direction (1 up, 2 down, 3 left, 4 right), or -1. */
    trick: number;
    /** Progress of the trick's flourish, 0..1 (renderer.ts trickFlourish turns the whole vehicle). */
    trickT?: number;
    /** The engine rotates the kart itself in this trick (boost-ramp flips, the bike's side swing). */
    trickEngineRot?: boolean;
    /** Accelerator held (the e-bike rider pedals away from a stop; the motor carries it at speed). */
    throttle?: boolean;
    /** Braking or reversing (brake lights). */
    braking?: boolean;
}

export interface VehicleModel {
    /** Added under the renderer's kartBody (frame, body, riders), kart-local space. */
    body: THREE.Group;
    /** The renderer positions them at the physics wheel centers; update() spins them. */
    wheels: THREE.Object3D[];
    /** Where the boost flame comes out, kart-local. */
    exhaust: THREE.Vector3;
    /**
     * Positions the wheels from the physics wheel centers (kart-local, in tire order), for models
     * whose wheels don't map one to one (the three-wheeled buggy). Default: wheel i at center i.
     */
    placeWheels?(centers: readonly THREE.Vector3[]): void;
    update(state: VehicleState): void;
    dispose(): void;
}

/** Colors of a rider's outfit (the e-bike's accent, hoodie and scarf). */
export interface Livery {
    primary: string;
    secondary: string;
    accent: string;
}

export const DEFAULT_LIVERY: Livery = { primary: '#e8492e', secondary: '#f4ecd8', accent: '#1f3a5f' };

// ---------------------------------------------------------------------------------------------
// Trick flourish (the renderer turns the whole vehicle with it; the viewers preview it)
// ---------------------------------------------------------------------------------------------

/** Kart-local height the trick flourishes turn the vehicle around (about its middle). */
const TRICK_PIVOT_Y = 20;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/**
 * The vehicle's own trick flourish, for tricks where the engine doesn't rotate the kart (off a trick
 * ramp: every car trick, the bike's Up / Down; boost-ramp flips and the bike's side swing are the
 * engine's own). Sets `out` (kart-local, around the vehicle's middle) and returns how far the car
 * tucks its wheels up. `dir`: 1 up, 2 down, 3 left, 4 right; `u`: the flourish's progress 0..1.
 *
 * Cars: Up is a backflip, Left / Right a flat 360 spin banked into the turn, Down a barrel roll,
 * each popping up off the chassis on the way. The bike: Up pops the nose high, Down dips it.
 */
export function trickFlourish(bike: boolean, dir: number, u: number, out: THREE.Matrix4): number {
    const bump = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    const e = easeInOut(Math.min(1, Math.max(0, u)));
    let lift: number;
    let tuck = 0;
    if (bike) {
        // (Its side tricks are the engine's own swing: nothing to add.)
        if (dir >= 3) return out.identity(), 0;
        lift = 12 * bump;
        if (dir === 2) _e.set(0.3 * bump, 0, Math.sin(u * Math.PI * 2) * 0.08, 'YXZ');
        else _e.set(-0.4 * Math.sin(Math.PI * Math.min(1, u * 1.15)), Math.sin(u * Math.PI * 2) * 0.12, 0, 'YXZ');
    } else {
        lift = 28 * bump;
        tuck = 9 * bump;
        const side = dir === 3 ? 1 : dir === 4 ? -1 : 0;
        if (side) _e.set(0, side * Math.PI * 2 * e, -side * 0.32 * bump, 'YXZ');
        else if (dir === 2) _e.set(0, 0, Math.PI * 2 * e, 'YXZ');
        else _e.set(-Math.PI * 2 * e, 0, 0, 'YXZ');
    }
    _q.setFromEuler(_e);
    out.makeTranslation(0, TRICK_PIVOT_Y + lift, 0).multiply(_m.makeRotationFromQuaternion(_q)).multiply(_m.makeTranslation(0, -TRICK_PIVOT_Y, 0));
    return tuck;
}

/**
 * Viewer preview of a trick (sfviewer.html?model=…&trick=1..4[&trickT=0.4][&rot=1]): poses the
 * vehicle airborne in the trick and turns `lift` (the kart-local frame, raised by -groundY) with the
 * flourish; without trickT the trick loops. Call the returned function every frame after setting
 * state.timeSec.
 */
export function viewerTrick(q: URLSearchParams, state: VehicleState, lift: THREE.Object3D, groundY: number, bike: boolean): () => void {
    const dir = q.has('trick') ? Number(q.get('trick')) : -1;
    const fixed = q.has('trickT') ? Number(q.get('trickT')) : null;
    const engineRot = q.get('rot') === '1';
    const air = state.airborne;
    lift.matrixAutoUpdate = false;
    const flourish = new THREE.Matrix4();
    return () => {
        let u = -1;
        if (dir > 0) {
            // Loop: the flourish (0.57 s), held in the air a moment, then a landing pause.
            const c = (state.timeSec % 1.6) / 0.57;
            u = fixed ?? Math.min(1, c);
            const inAir = fixed !== null || state.timeSec % 1.6 < 1.1;
            state.trick = inAir ? dir : -1;
            state.airborne = inAir || air;
        }
        state.trickT = u;
        state.trickEngineRot = engineRot;
        if (u >= 0 && !engineRot) trickFlourish(bike, dir, u, flourish);
        else flourish.identity();
        lift.matrix.makeTranslation(0, -groundY, 0).multiply(flourish);
        lift.matrixWorldNeedsUpdate = true;
    };
}
