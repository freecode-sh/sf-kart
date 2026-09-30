/**
 * Verifies a run file (src/app/rules/runfile.ts) the way the leaderboard will: checks it was raced
 * under the current rules (the hash of the course, vehicle data and RULES_VERSION), re-simulates
 * its pads headlessly through the live path (src/app/rules/resim.ts) and compares the finish frame
 * and splits with the ones it claims. Prints JSON:
 *   { ok, finishFrame, splits, vehicle, ms (the engine's race time), frames, elapsedMs, errors }
 * and exits 1 when the run doesn't verify.
 *
 * Usage: npx tsx tools/verify.ts run.sfkr        (a file of raw bytes, or its base64)
 */

import { readFileSync } from 'node:fs';
import { checkRun } from '../src/app/rules/resim';
import { decodeRun, fromBase64 } from '../src/app/rules/runfile';
import { loadRulesData } from './lib/rulesFiles';

const file = process.argv[2];
if (!file) {
    console.error('usage: npx tsx tools/verify.ts run.sfkr');
    process.exit(2);
}
const t0 = performance.now();
let bytes: Uint8Array = new Uint8Array(readFileSync(file));
// Base64 text (window.__kart.lastRun()) works too.
if (bytes[0] !== 0x53) bytes = fromBase64(new TextDecoder().decode(bytes).trim());
try {
    const run = await decodeRun(bytes);
    const r = await checkRun(run, loadRulesData());
    const out = { ok: r.ok, finishFrame: r.finishFrame, splits: r.splits, vehicle: r.vehicle, ms: r.raceMs, frames: r.frames, elapsedMs: Math.round(performance.now() - t0), errors: r.errors };
    console.log(JSON.stringify(out));
    process.exit(r.ok ? 0 : 1);
} catch (e) {
    console.log(JSON.stringify({ ok: false, errors: [String((e as Error).message ?? e)], elapsedMs: Math.round(performance.now() - t0) }));
    process.exit(1);
}
