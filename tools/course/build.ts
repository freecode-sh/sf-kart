/**
 * Builds courses into public/data/courses/<id>/{course.kcl,course.kmp,course_meta.json}.
 *
 * Usage: npx tsx tools/course/build.ts [id ...] [--out <dir>]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCourse } from './lib/course';
import { TRACKS } from './tracks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
let outRoot = join(ROOT, 'public/data/courses');
const ids: string[] = [];
for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--out') outRoot = resolve(args[++i]!);
    else ids.push(args[i]!);
}
for (const id of ids) if (!TRACKS.some((t) => t.id === id)) throw new Error(`unknown course '${id}' (have: ${TRACKS.map((t) => t.id).join(', ')})`);

let failed = 0;
for (const def of TRACKS) {
    if (ids.length && !ids.includes(def.id)) continue;
    try {
        const c = buildCourse(def);
        const dir = join(outRoot, def.id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'course.kcl'), c.kcl);
        writeFileSync(join(dir, 'course.kmp'), c.kmp);
        writeFileSync(join(dir, 'course_meta.json'), JSON.stringify(c.meta, null, 1) + '\n');
        console.log(c.summary.join('\n'));
        console.log(`  wrote ${dir}`);
    } catch (e) {
        ++failed;
        console.error((e as Error).stack ?? String(e));
    }
}
if (failed) process.exit(1);
