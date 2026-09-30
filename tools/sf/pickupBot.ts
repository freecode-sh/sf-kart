/**
 * The Golden Gate bot lap with the app's speed-up pickups (src/app/rules/pickups.ts: the same layout
 * and pickup rule, a speed-up stored after the same frame), using a stored speed-up just past each
 * row, so its ghost replays in the app (tools/sf/record.ts, window.__kart.replay) exactly as the bot
 * drove it. Ghost replays store the pickups too, so a bot lap recorded without them (botlap.ts
 * --rkg) drifts off line once it runs out of speed-ups.
 *
 * Usage: npx tsx tools/sf/pickupBot.ts [out.rkg] [--vehicle ebike|robotaxi|buggy] [--no-pickups]
 *        (default out: public/data/courses/golden_gate/bot.rkg)
 */

import { writeFileSync } from 'node:fs';
import { COURSE_SLOT, loadCourseFiles, loadMeta, runBot, summarize } from '../course/botlap';
import { buildRKG } from '../ghost/rkg';
import { DRIVER_SLOT, vehicleSlot } from '../../src/app/vehicleData';
import { vehicleDef } from '../../src/app/vehicles';
import { PickupField, pickupRows, storeSpeedUp } from '../../src/app/rules/pickups';
import type { Station } from '../../src/app/sf/road';
import { KartObjectManager } from '../../src/game/kart/KartObjectManager';
import { ItemDirector } from '../../src/game/item/ItemDirector';
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
const rows = pickupRows(meta.segments);
const field = new PickupField(meta.centerline as unknown as Station[], rows);
const veh = vehicleDef(opt('--vehicle') ?? 'ebike');
const hits: number[] = [];
// Frames counted like the app's sim.frame() (the first bot frame is 1).
let frame = 0;
const r = runBot(loadCourseFiles(dir), meta, {
    vehicle: vehicleSlot(veh.id),
    // A stored speed-up used just past each pickup row (the row stores one back).
    actions: pickups ? rows.map((s) => ({ from: s + 300, to: s + 600, action: 'item' as const })) : [],
    onFrame: () => {
        ++frame;
        if (!pickups || RaceManager.Instance()!.stage() !== Stage.Race) return;
        const kart = KartObjectManager.Instance()!.object(0);
        const p = kart.pos();
        if (field.check({ x: p.x, y: p.y, z: p.z }, frame) > 0) {
            storeSpeedUp(ItemDirector.Instance()!.kartItem(0).inventory());
            hits.push(frame);
        }
    },
});
console.log(`${meta.name}:`);
console.log(summarize(r).join('\n'));
console.log(`pickups ${pickups ? `on: ${hits.length} collected at frames ${hits.join(', ')}` : 'off'}`);
writeFileSync(out, buildRKG(r.inputs, { course: COURSE_SLOT, vehicle: vehicleSlot(veh.id), character: DRIVER_SLOT, driftIsAuto: false, controller: 2, name: 'golden_gate' }));
console.log(`wrote ${out} (${r.inputs.length} input frames; ends at frame ${r.frames})`);
