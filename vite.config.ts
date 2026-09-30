/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { dataRulesId, dataVersion, MANIFEST } from './tools/lib/dataVersion';

/**
 * The production build is served at freecode.sh/sf-kart (freecode.sh rewrites /sf-kart/* to this
 * project's Vercel deployment, see vercel.json), so its URLs start with /sf-kart/. `SFK_BASE=/` builds
 * for the root of a domain of your own. The dev server always runs at / (`vite preview` at the build's base).
 *
 * `SFK_CDN` (e.g. https://cdn.freecode.sh/sf-kart, set in the Vercel project) makes the build load
 * the game's data from `<SFK_CDN>/<data version>/data/` (uploaded first by tools/uploadData.ts) and
 * leave it out of `dist/`. Without it the data is copied into `dist/data/` and served alongside.
 *
 * `SFK_API` (e.g. https://sfkart-api.freecode.sh, also set in the Vercel project) turns on the
 * leaderboard (src/app/leaderboard/, api/), for runs under this data's rules id (src/app/run/rules.ts).
 */
export default defineConfig(async ({ command, isPreview }) => {
    const cdn = command === 'build' ? process.env.SFK_CDN?.replace(/\/+$/, '') : undefined;
    const dataBase = cdn ? `${cdn}/${dataVersion()}/data` : '';
    return {
        base: command === 'build' || isPreview ? (process.env.SFK_BASE ?? '/sf-kart/') : '/',
        define: {
            __SFK_DATA_BASE__: JSON.stringify(dataBase),
            __SFK_API__: JSON.stringify(process.env.SFK_API?.replace(/\/+$/, '') ?? ''),
            __SFK_RULES__: JSON.stringify(await dataRulesId()),
        },
        build: { copyPublicDir: !cdn },
        plugins: cdn ? [requireUploaded(dataBase)] : [],
        test: { include: ['tests/**/*.test.ts'] },
    };
});

/** Fails the build if this data version isn't on the CDN yet (run tools/uploadData.ts first). */
function requireUploaded(dataBase: string): Plugin {
    return {
        name: 'sfk-require-uploaded-data',
        async buildStart() {
            const url = `${dataBase}/${MANIFEST}`;
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) this.error(`${url}: ${res.status}. Upload this data version first: npx tsx tools/uploadData.ts`);
        },
    };
}
