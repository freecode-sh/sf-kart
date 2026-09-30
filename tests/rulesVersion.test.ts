/**
 * The sources that decide how inputs race (the engine, the sim's input handling and tricks, the drift
 * layer, the start, the pickups and splits, how vehicles are packed) against a checked-in snapshot
 * (rulesSources.json). When they change, a run may race differently: bump RULES_VERSION
 * (src/app/rules/hash.ts, a new leaderboard season), then refresh the snapshot. If the change
 * can't affect a run (comments, the HUD view in sim.ts), refresh the snapshot alone.
 *   UPDATE_RULES_SNAPSHOT=1 npx vitest run tests/rulesVersion.test.ts
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { RULES_VERSION } from '../src/app/rules/hash';

const ROOT = join(import.meta.dirname, '..');
const SNAPSHOT = join(import.meta.dirname, 'rulesSources.json');

const RULE_SOURCES = [
    'src/egg',
    'src/game',
    'src/abstract',
    'src/Common.ts',
    'src/app/sim.ts',
    'src/app/easyDrift.ts',
    'src/app/raceStart.ts',
    'src/app/vehicleData.ts',
    'src/app/tuning.ts',
    'src/app/rules/course.ts',
    'src/app/rules/pickups.ts',
    'src/app/rules/resim.ts',
];

function files(path: string): string[] {
    const abs = join(ROOT, path);
    if (!statSync(abs).isDirectory()) return [path];
    return readdirSync(abs)
        .sort()
        .flatMap((f) => files(relative(ROOT, join(abs, f))));
}

it('RULES_VERSION is bumped when the rule sources change', () => {
    const h = createHash('sha256');
    const list = RULE_SOURCES.flatMap(files).filter((f) => f.endsWith('.ts'));
    for (const f of list) h.update(`${f}\n`).update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));
    const sources = h.digest('hex');
    if (process.env.UPDATE_RULES_SNAPSHOT) {
        writeFileSync(SNAPSHOT, `${JSON.stringify({ rulesVersion: RULES_VERSION, sources, files: list.length }, null, 1)}\n`);
        return;
    }
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { rulesVersion: number; sources: string };
    if (snap.sources !== sources) {
        expect.fail(
            snap.rulesVersion === RULES_VERSION
                ? `The rule sources changed: bump RULES_VERSION (src/app/rules/hash.ts) if runs can race differently, then UPDATE_RULES_SNAPSHOT=1 npx vitest run tests/rulesVersion.test.ts`
                : `RULES_VERSION is bumped (${snap.rulesVersion} → ${RULES_VERSION}): UPDATE_RULES_SNAPSHOT=1 npx vitest run tests/rulesVersion.test.ts`,
        );
    }
    expect(snap.rulesVersion).toBe(RULES_VERSION);
});
