/**
 * Where the game's data lives: `data/` under the app's base URL (`/` in development, `/sf-kart/` in
 * the production build served at freecode.sh/sf-kart; see vite.config.ts), or a versioned folder on
 * a CDN when the build sets `SFK_CDN`. Tools running in Node import some of these modules too, where
 * there is no base URL: they read the files from disk.
 */
declare const __SFK_DATA_BASE__: string;

const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const cdn = typeof __SFK_DATA_BASE__ === 'string' ? __SFK_DATA_BASE__ : '';

export const DATA_BASE = cdn || `${base}data`;
