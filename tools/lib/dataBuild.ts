/**
 * The deploy copy of the game's data: every file the game loads from public/data (the source of
 * truth: the tools read it from disk and the dev server serves it as is), content-hashed so it can be
 * cached forever, and gzipped where that pays off (the client gunzips with DecompressionStream, see
 * src/app/data.ts, so any static host or bucket serves it as plain bytes).
 *
 * Out: `<out>/<dir>/<name>.<hash8>.<ext>[.gz]` + `<out>/manifest.json` (logical path → entry). The
 * hash is of the raw content, so a rebuild with the same data gives the same names. Used by
 * vite.config.ts (the manifest is baked into the bundle) and tools/uploadData.ts (R2).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface DataEntry {
    /** The stored file, relative to the output directory (and to DATA_BASE when deployed). */
    file: string;
    /** Stored gzipped: the client gunzips it. */
    gz: boolean;
    /** Raw and stored bytes. */
    size: number;
    stored: number;
}

/** Logical path (relative to public/data, '/' separated) → entry. */
export type DataManifest = Record<string, DataEntry>;

/** Not shipped: dev and debug files the game never loads (the viewer's lidar points, bot ghosts for tools/sf/record.ts). */
const SKIP = [/^sf\/debug\//, /\.rkg$/, /(^|\/)\./];

/** Already compressed. */
const PACKED = new Set(['.webp', '.jpg', '.jpeg', '.png', '.ktx2', '.gz', '.br']);

/** Gzip only when the result is at most this fraction of the raw size. */
const GZ_GAIN = 0.9;

export const CONTENT_TYPES: Record<string, string> = {
    '.json': 'application/json',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gz': 'application/gzip',
};

/** Content-Type of a stored file (gzipped files are plain gzip: the client decodes them). */
export const contentType = (file: string): string => CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

function walk(dir: string): string[] {
    return readdirSync(dir)
        .sort()
        .flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

/**
 * Hashes (and compresses) the data in `src`; writes it to `out` (emptied first) if given.
 */
export function buildData(src = 'public/data', out?: string): DataManifest {
    const manifest: DataManifest = {};
    if (out) {
        rmSync(out, { recursive: true, force: true });
        mkdirSync(out, { recursive: true });
    }
    for (const abs of walk(src)) {
        const path = relative(src, abs).split('\\').join('/');
        if (SKIP.some((re) => re.test(path))) continue;
        const raw = readFileSync(abs);
        const ext = extname(path);
        const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
        const packed = PACKED.has(ext.toLowerCase()) ? null : gzipSync(raw, { level: 9 });
        const gz = !!packed && packed.length <= raw.length * GZ_GAIN;
        // The client tells a gzip stream from a host-decoded one by its magic: no raw file may start with it.
        if (gz && raw[0] === 0x1f && raw[1] === 0x8b) throw new Error(`${path}: starts with the gzip magic`);
        const file = `${path.slice(0, path.length - ext.length)}.${hash}${ext}${gz ? '.gz' : ''}`;
        const bytes = gz ? packed! : raw;
        manifest[path] = { file, gz, size: raw.length, stored: bytes.length };
        if (out) {
            mkdirSync(dirname(join(out, file)), { recursive: true });
            writeFileSync(join(out, file), bytes);
        }
    }
    if (out) writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    return manifest;
}
