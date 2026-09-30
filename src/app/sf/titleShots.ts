/**
 * The title's camera: a slow drift through three shots of the Golden Gate course (world units), each
 * held for SHOT_SEC and eased from its first framing to its last. Between shots the fog rolls
 * through (`veil`, 0..1: the onboarding's .veil), hiding the cut.
 *
 *   the start gantry and the pack · Crissy Field's beach toward the bridge · Fort Point under the
 *   bridge
 */

import * as THREE from 'three';
import type { CameraState } from '../renderer';

type Framing = { pos: [number, number, number]; target: [number, number, number] };

const SHOTS: { from: Framing; to: Framing }[] = [
    { from: { pos: [92500, 900, 38720], target: [70000, 1250, 36900] }, to: { pos: [89300, 1350, 38660], target: [70000, 1500, 36600] } },
    { from: { pos: [61000, 2500, 31000], target: [0, 4500, -20000] }, to: { pos: [53000, 2300, 26500], target: [-2000, 4500, -22000] } },
    { from: { pos: [21000, 3100, 16000], target: [-3000, 5000, -20000] }, to: { pos: [16500, 2700, 11000], target: [-4000, 4700, -22000] } },
];

const SHOT_SEC = 9;
/** The fog's pass at a cut: in over this long before it, out over this long after. */
const VEIL_SEC = 0.9;

const lerp = (a: [number, number, number], b: [number, number, number], t: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

/** The camera `t` seconds into the title, and how thick the fog is (0..1). */
export function titleShot(t: number): { camera: CameraState; veil: number } {
    const n = Math.floor(t / SHOT_SEC);
    const shot = SHOTS[n % SHOTS.length]!;
    const u = (t - n * SHOT_SEC) / SHOT_SEC;
    const e = u * u * (3 - 2 * u);
    const into = t - n * SHOT_SEC;
    const left = SHOT_SEC - into;
    const veil = Math.max(0, 1 - Math.min(into, left) / VEIL_SEC);
    return { camera: { pos: lerp(shot.from.pos, shot.to.pos, e), target: lerp(shot.from.target, shot.to.target, e), fov: 50 }, veil: veil * veil };
}
