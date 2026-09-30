/**
 * The version of the game's data (`public/data/`): a hash of every file's path and bytes. A build
 * that loads its data from a CDN (vite.config.ts, `SFK_CDN`) reads it from `<SFK_CDN>/<version>/data/`,
 * which tools/uploadData.ts fills, so the CDN's files never change and cache forever.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RULES_FILES, rulesId } from '../../src/app/run/rules';

export const DATA_DIR = 'public/data';
/** Uploaded last, so its presence means a version is complete. */
export const MANIFEST = 'manifest.json';

/** Every data file, as a `/`-separated path relative to `dir`, sorted (not the gitignored `debug/` bakes). */
export function dataFiles(dir = DATA_DIR): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'debug') continue;
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else out.push(relative(dir, p).split(sep).join('/'));
        }
    };
    walk(dir);
    return out.sort();
}

export function dataVersion(dir = DATA_DIR): string {
    const h = createHash('sha256');
    for (const f of dataFiles(dir)) {
        h.update(f).update('\0');
        h.update(createHash('sha256').update(readFileSync(join(dir, f))).digest());
    }
    return h.digest('hex').slice(0, 12);
}

/** The rules id (src/app/run/rules.ts) of the data in `dir`: the leaderboard season it races in. */
export function dataRulesId(dir = DATA_DIR): Promise<string> {
    return rulesId(RULES_FILES.map((f) => new Uint8Array(readFileSync(join(dir, f)))));
}
