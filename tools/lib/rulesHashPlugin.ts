/**
 * The rules' data files on disk: the course the app races (course.kcl, course.kmp,
 * course_meta.json) and public/data/vehicles/vehicles.json. And the Vite plugin that bakes their
 * rules hash (src/app/rules/hash.ts) into the app as `virtual:sfkart-rules-hash`, recomputed when
 * they change. vite.config.ts loads this, hence the explicit .ts extensions (Vite's native config
 * loader needs them); tools use rulesFiles.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { rulesHash, type RulesSources } from '../../src/app/rules/hash.ts';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** The course the app races (main.ts COURSE_ID). */
export const RULES_COURSE = 'golden_gate';

export function rulesFilePaths(root = REPO_ROOT, course = RULES_COURSE) {
    const dir = join(root, 'public/data/courses', course);
    return {
        kcl: join(dir, 'course.kcl'),
        kmp: join(dir, 'course.kmp'),
        meta: join(dir, 'course_meta.json'),
        vehicles: join(root, 'public/data/vehicles/vehicles.json'),
    };
}

export function readRulesSources(root = REPO_ROOT, course = RULES_COURSE): RulesSources {
    const p = rulesFilePaths(root, course);
    return {
        kcl: new Uint8Array(readFileSync(p.kcl)),
        kmp: new Uint8Array(readFileSync(p.kmp)),
        meta: JSON.parse(readFileSync(p.meta, 'utf8')) as RulesSources['meta'],
        vehicles: JSON.parse(readFileSync(p.vehicles, 'utf8')) as unknown,
    };
}

const VIRTUAL = 'virtual:sfkart-rules-hash';

/** `import { RULES_HASH } from 'virtual:sfkart-rules-hash'`: the rules hash of the data being served / built. */
export function rulesHashPlugin(): Plugin {
    let root = REPO_ROOT;
    return {
        name: 'sfkart-rules-hash',
        configResolved(config) {
            root = config.root;
        },
        resolveId(id) {
            return id === VIRTUAL ? `\0${VIRTUAL}` : undefined;
        },
        async load(id) {
            if (id !== `\0${VIRTUAL}`) return undefined;
            for (const f of Object.values(rulesFilePaths(root))) this.addWatchFile(f);
            return `export const RULES_HASH = ${JSON.stringify(await rulesHash(readRulesSources(root)))};\n`;
        },
    };
}
