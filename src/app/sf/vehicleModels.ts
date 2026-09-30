/** Builds the model of any SF vehicle by id (the player's, the rivals', the comparison ghosts'). */

import type { VehicleId } from '../vehicles';
import { buildBuggy } from './buggy';
import { buildEBike } from './ebike';
import { buildRobotaxi } from './robotaxi';
import type { Livery, VehicleModel } from './vehicleModel';

export function buildVehicleModel(id: VehicleId, livery?: Livery): VehicleModel {
    if (id === 'robotaxi') return buildRobotaxi();
    if (id === 'buggy') return buildBuggy();
    return buildEBike(livery);
}
