/// <reference types="vitest/config" />
import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildData } from './tools/lib/dataBuild.ts';
import { rulesHashPlugin } from './tools/lib/rulesHashPlugin.ts';

/**
 * The production build is served at freecode.sh/sf-kart (freecode.sh rewrites /sf-kart/* to this
 * project's Vercel deployment, see vercel.json), so its URLs start with /sf-kart/. `SFK_BASE=/` builds
 * for the root of a domain of your own. The dev server always runs at /; `vite preview` serves the
 * build at its base.
 *
 * The data: the dev server serves public/data as it is. The build writes the deploy copy (hashed,
 * partly gzipped: tools/lib/dataBuild.ts) to dist-data/ and bakes its manifest into the bundle
 * (src/app/paths.ts). With `SFK_DATA_BASE` (e.g. https://cdn.freecode.sh/sf-kart) the game loads it
 * from there (upload it with tools/uploadData.ts); without, the copy goes to dist/data/.
 */
export default defineConfig(({ command, isPreview }) => ({
    base: command === 'build' || isPreview ? (process.env.SFK_BASE ?? '/sf-kart/') : '/',
    // The online leaderboard's API (src/app/leaderboard/): off without it.
    define: { __SFK_API__: JSON.stringify(process.env.SFK_API?.replace(/\/+$/, '') ?? '') },
    plugins: [rulesHashPlugin(), ...(command === 'build' ? [deployData(process.env.SFK_DATA_BASE?.replace(/\/+$/, '') || null)] : [])],
    build: {
        // (public/ minus data/ is copied by deployData.)
        copyPublicDir: false,
        rolldownOptions: {
            // three.js on its own: it changes far less often than the game, so it stays cached.
            output: { codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] } },
        },
    },
    test: { include: ['tests/**/*.test.ts'] },
}));

function deployData(dataBase: string | null): Plugin {
    const out = resolve('dist-data');
    let outDir = 'dist';
    return {
        name: 'sfk-deploy-data',
        config() {
            const manifest = buildData('public/data', out);
            const files = Object.fromEntries(Object.entries(manifest).map(([path, e]) => [path, [e.file, e.gz ? 1 : 0]]));
            return { define: { __SFK_DATA__: JSON.stringify({ base: dataBase, files }) } };
        },
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
            if (existsSync('public')) cpSync('public', outDir, { recursive: true, filter: (src) => resolve(src) !== resolve('public/data') });
            if (!dataBase) cpSync(out, join(outDir, 'data'), { recursive: true, filter: (src) => resolve(src) !== join(out, 'manifest.json') });
        },
    };
}
