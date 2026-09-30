/**
 * Uploads the deploy copy of the game's data (tools/lib/dataBuild.ts, rebuilt into dist-data/ first)
 * to the R2 bucket behind the CDN, for a build made with `SFK_DATA_BASE=<cdn>/<prefix>`. The names
 * are content hashes, so a file the CDN already has (a HEAD answers 200) is never uploaded again, and
 * everything is cached for a year, immutable. Upload before deploying the app that points at it.
 *
 * Usage: npx tsx tools/uploadData.ts [--apply] [--bucket sfkart-assets] [--prefix sf-kart] [--cdn https://cdn.freecode.sh]
 * Without --apply it's a dry run: it lists what it would upload. Uploads with wrangler (logged in).
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildData, contentType } from './lib/dataBuild';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const apply = argv.includes('--apply');
const bucket = opt('bucket', 'sfkart-assets');
const prefix = opt('prefix', 'sf-kart').replace(/^\/+|\/+$/g, '');
const cdn = opt('cdn', 'https://cdn.freecode.sh').replace(/\/+$/, '');
const OUT = 'dist-data';
const CACHE = 'public, max-age=31536000, immutable';

const manifest = buildData('public/data', OUT);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

/** Whether the CDN already serves `file` (a 404 or a network error: no). */
async function present(file: string): Promise<boolean> {
    try {
        return (await fetch(`${cdn}/${prefix}/${file}`, { method: 'HEAD' })).ok;
    } catch {
        return false;
    }
}

const todo: string[] = [];
let bytes = 0;
const entries = Object.entries(manifest);
const have = await Promise.all(entries.map(([, e]) => present(e.file)));
for (const [k, [path, e]] of entries.entries()) {
    console.log(`${have[k] ? 'have  ' : 'upload'} ${e.file.padEnd(52)} ${kb(e.stored).padStart(8)}${e.gz ? ` (${kb(e.size)} raw)` : ''}  ← ${path}`);
    if (have[k]) continue;
    todo.push(e.file);
    bytes += e.stored;
}
console.log(`${todo.length} of ${Object.keys(manifest).length} files to upload (${kb(bytes)}) to r2://${bucket}/${prefix}/ (${cdn}/${prefix}/)`);
if (!apply) {
    if (todo.length) console.log('Dry run: --apply uploads them.');
    process.exit(0);
}
for (const file of todo) {
    const args = ['r2', 'object', 'put', `${bucket}/${prefix}/${file}`, '--remote', '--file', join(OUT, file), '--content-type', contentType(file), '--cache-control', CACHE];
    console.log(`wrangler ${args.join(' ')}`);
    const r = spawnSync('wrangler', args, { stdio: 'inherit' });
    if (r.status !== 0) {
        console.error(`upload failed: ${file}`);
        process.exit(1);
    }
}
console.log('Done.');
