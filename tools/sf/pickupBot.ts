/**
 * The Golden Gate bot lap with the app's speed-up pickups applied (src/app/sf/itemBoxes.ts: the same
 * layout and pickup rule, the same boost after the same frame), so its ghost replays in the app
 * (tools/sf/record.ts, window.__kart.replay) exactly as the bot drove it. Ghost replays apply the
 * pickups too, so a bot lap recorded without them (botlap.ts --rkg) drifts off line after the
 * first pickup row.
 *
 * Usage: npx tsx tools/sf/pickupBot.ts [out.rkg] [--vehicle ebike|robotaxi|buggy] [--no-pickups]
 *        (default out: public/data/courses/golden_gate/bot.rkg)
 */

import { writeFileSync } from 'node:fs';
import { COURSE_SLOT, loadCourseFiles, loadMeta, runBot, summarize } from '../course/botlap';
import { buildRKG } from '../ghost/rkg';
import { DRIVER_SLOT, vehicleSlot } from '../../src/app/vehicleData';
import { vehicleDef } from '../../src/app/vehicles';
import { PickupField, pickupRows } from '../../src/app/sf/itemBoxes';
import type { Station } from '../../src/app/sf/road';
import { KartObjectManager } from '../../src/game/kart/KartObjectManager';
import { RaceManager, Stage } from '../../src/game/system/RaceManager';

const args = process.argv.slice(2);
const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
};
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'public/data/courses/golden_gate/bot.rkg';
const pickups = !args.includes('--no-pickups');
const dir = 'public/data/courses/golden_gate';
const meta = loadMeta(dir);
const field = new PickupField(meta.centerline as unknown as Station[], pickupRows(meta.segments));
const veh = vehicleDef(opt('--vehicle') ?? 'ebike');
const hits: number[] = [];
// Frames counted like the app's sim.frame() (the first bot frame is 1).
let frame = 0;
const r = runBot(loadCourseFiles(dir), meta, {
    vehicle: vehicleSlot(veh.id),
    onFrame: () => {
        ++frame;
        if (!pickups || RaceManager.Instance()!.stage() !== Stage.Race) return;
        const kart = KartObjectManager.Instance()!.object(0);
        const p = kart.pos();
        if (field.check({ x: p.x, y: p.y, z: p.z }, frame) > 0) {
            kart.move().activateMushroom();
            hits.push(frame);
        }
    },
});
console.log(`${meta.name}:`);
console.log(summarize(r).join('\n'));
console.log(`pickups ${pickups ? `on: ${hits.length} boosts at frames ${hits.join(', ')}` : 'off'}`);
writeFileSync(out, buildRKG(r.inputs, { course: COURSE_SLOT, vehicle: vehicleSlot(veh.id), character: DRIVER_SLOT, driftIsAuto: false, controller: 2, name: 'golden_gate' }));
console.log(`wrote ${out} (${r.inputs.length} input frames; ends at frame ${r.frames})`);
