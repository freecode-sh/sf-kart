/**
 * The code that decides a race (src/app/run/rules.ts). When this fails, that code changed: if it
 * can change a race's outcome, bump RULES_VERSION (a new leaderboard season); either way, update
 * RULES_SOURCES below.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RULES_VERSION } from '../src/app/run/rules';

const SOURCES = [
    'src/abstract',
    'src/egg',
    'src/game',
    'src/Common.ts',
    'src/app/raceStart.ts',
    'src/app/run/race.ts',
    'src/app/run/verify.ts',
    'src/app/sf/pickupField.ts',
    'src/app/tuning.ts',
    'src/app/vehicleData.ts',
];
/** RULES_VERSION and the sources' hash when it was last checked. */
const RULES_SOURCES = { version: 1, sha256: '4389b0d8f91b5ccdca22f56eba40f133f3a459234b6d9549d89b9ab788609186' };

function files(p: string): string[] {
    return statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((f) => files(join(p, f))) : [p];
}

it('rules sources are unchanged since RULES_VERSION was last checked', () => {
    const h = createHash('sha256');
    for (const f of SOURCES.flatMap(files)) h.update(f).update('\0').update(readFileSync(f)).update('\0');
    expect({ version: RULES_VERSION, sha256: h.digest('hex') }).toEqual(RULES_SOURCES);
});
