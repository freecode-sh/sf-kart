/**
 * Where the game's data lives. Every data URL goes through `dataUrl(path)`, `path` being relative to
 * public/data (e.g. 'sf/world.json').
 * - Development: the files as they are, under `data/` at the app's base URL.
 * - Production build: the content-hashed, partly gzipped copy (tools/lib/dataBuild.ts), whose
 *   manifest vite.config.ts bakes in as `__SFK_DATA__`, at `$SFK_DATA_BASE` (a CDN, e.g.
 *   https://cdn.freecode.sh/sf-kart) or, without it, under `data/` at the app's base URL (`/sf-kart/`
 *   in the build served at freecode.sh/sf-kart; see vite.config.ts).
 * Tools running in Node import some of these modules too, where there is neither: they read the
 * files from disk.
 */

declare const __SFK_DATA__: { base: string | null; files: Record<string, [file: string, gz: 0 | 1]> } | undefined;

const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const built = typeof __SFK_DATA__ !== 'undefined' ? __SFK_DATA__ : null;

export const DATA_BASE = built?.base ?? `${base}data`;

/** URL of the data file at `path` (relative to public/data). */
export const dataUrl = (path: string): string => `${DATA_BASE}/${built?.files[path]?.[0] ?? path}`;

/** Whether the build stored `path` gzipped (src/app/data.ts gunzips it). */
export const dataGzipped = (path: string): boolean => built?.files[path]?.[1] === 1;
