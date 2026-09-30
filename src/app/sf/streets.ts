/**
 * The US 101 viaduct continuing north of the bridge (which the course passes under at Vista Point).
 * The rest of the street network shows in the aerial photo (terrain.ts gives it an asphalt grain).
 */

import * as THREE from 'three';
import type { SfWorld } from './world';
import { buildViaduct101 } from './viaduct101';

export interface StreetMeshes {
    group: THREE.Group;
    dispose(): void;
}

/** US 101 north of the bridge (meters E/N, deck height m): from the bridge's north end towards the Waldo tunnel. */
export const US101: [number, number, number][] = [
    // Starts where the course's carriageways have split round the Vista Point loop (south of here
    // they are the road), spans the loop, and has no pier near it.
    [-217, 2200, 67],
    [-262, 2400, 72.5],
    [-283, 2430, 73],
    [-330, 2490, 74],
    [-380, 2560, 75],
    [-440, 2660, 77],
    [-500, 2790, 79],
    [-530, 2950, 81],
];

export function buildStreets(world: SfWorld): StreetMeshes {
    // US 101 viaduct (viaduct101.ts): girders, parapets, bent caps on columns.
    const viaduct = buildViaduct101(US101, 2400, world.groundY);
    const group = new THREE.Group();
    group.name = 'streets';
    group.add(viaduct.group);
    return {
        group,
        dispose() {
            viaduct.dispose();
        },
    };
}
