/**
 * Uploads the game's data (public/data) to a Cloudflare R2 bucket behind a CDN, at
 * `<prefix>/<data version>/data/`, for a build with `SFK_CDN` (see vite.config.ts). Files are
 * immutable (the version is a hash of all of them), so they cache forever; an already uploaded
 * version is skipped. The manifest goes last: the build checks for it.
 *
 * Usage: npx tsx tools/uploadData.ts [--cdn https://cdn.freecode.sh/sf-kart] [--bucket sfkart-assets]
 *        (needs Cloudflare's wrangler CLI, logged in; the key prefix is the CDN URL's path)
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, dataFiles, dataVersion, MANIFEST } from './lib/dataVersion';

const args = process.argv.slice(2);
const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
};
const cdn = (opt('--cdn') ?? process.env.SFK_CDN ?? 'https://cdn.freecode.sh/sf-kart').replace(/\/+$/, '');
const bucket = opt('--bucket') ?? 'sfkart-assets';

const TYPES: Record<string, string> = {
    json: 'application/json',
    webp: 'image/webp',
    jpg: 'image/jpeg',
    png: 'image/png',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';

const version = dataVersion();
const prefix = `${new URL(cdn).pathname.replace(/^\/+/, '')}/${version}/data`;
const base = `${cdn}/${version}/data`;

if ((await fetch(`${base}/${MANIFEST}`, { method: 'HEAD' })).ok) {
    console.log(`${base}: already uploaded`);
    process.exit(0);
}

const files = dataFiles();
const put = (key: string, file: string, type: string) =>
    execFileSync('wrangler', ['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', file, '--content-type', type, '--cache-control', IMMUTABLE], { stdio: ['ignore', 'ignore', 'inherit'] });

for (const [i, f] of files.entries()) {
    console.log(`[${i + 1}/${files.length}] ${f}`);
    put(`${prefix}/${f}`, join(DATA_DIR, f), TYPES[f.split('.').pop()!] ?? 'application/octet-stream');
}
const manifest = JSON.stringify({ version, files: Object.fromEntries(files.map((f) => [f, statSync(join(DATA_DIR, f)).size])) }, null, 1);
execFileSync('wrangler', ['r2', 'object', 'put', `${bucket}/${prefix}/${MANIFEST}`, '--remote', '--pipe', '--content-type', TYPES.json!, '--cache-control', 'no-cache'], { input: manifest, stdio: ['pipe', 'ignore', 'inherit'] });
console.log(`${base}: ${files.length} files uploaded`);
