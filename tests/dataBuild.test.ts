/**
 * The deploy copy of the data (tools/lib/dataBuild.ts): every stored file unpacks to its source, the
 * dev-only files stay out, and the boot's prefetch list (src/app/bootData.ts) names the files the
 * loaders ask for, so none of them is fetched twice or late.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildData } from '../tools/lib/dataBuild';
import { BOOT_FIRST, BOOT_SCENE, STREET_DETAIL } from '../src/app/bootData';
import type { WorldJson } from '../src/app/sf/world';

const out = mkdtempSync(join(tmpdir(), 'sfk-data-'));
const manifest = buildData('public/data', out);

describe('data build', () => {
    it('stores every file so it unpacks to its source, under a hashed name', () => {
        const names = new Set<string>();
        for (const [path, e] of Object.entries(manifest)) {
            const raw = readFileSync(`public/data/${path}`);
            const stored = readFileSync(join(out, e.file));
            expect(e.file).toMatch(/\.[0-9a-f]{8}\./);
            expect(e.file.endsWith('.gz')).toBe(e.gz);
            expect(stored.length).toBe(e.stored);
            expect((e.gz ? gunzipSync(stored) : stored).equals(raw)).toBe(true);
            expect(names.has(e.file)).toBe(false);
            names.add(e.file);
        }
        expect(manifest['courses/golden_gate/course.kcl']!.gz).toBe(true);
        expect(manifest['sf/img/detail_0.webp']!.gz).toBe(false);
        rmSync(out, { recursive: true, force: true });
    }, 30_000);

    it('leaves out the dev-only files', () => {
        expect(Object.keys(manifest).filter((p) => p.startsWith('sf/debug/') || p.endsWith('.rkg'))).toEqual([]);
    });

    it('prefetches exactly what the boot loads', () => {
        const world = JSON.parse(readFileSync('public/data/sf/world.json', 'utf8')) as WorldJson;
        const b = world.imagery.base;
        const named = [world.terrain.file, world.landcover.file, world.far.file, world.far.image, ...world.imagery.detail.atlases, ...(world.depth ? [world.depth.file] : [])];
        for (let j = 0; j < b.n; ++j) for (let i = 0; i < b.n; ++i) named.push(b.pattern.replace('{i}', String(i)).replace('{j}', String(j)));
        const scene = BOOT_SCENE.filter((p) => p.startsWith('sf/') && p !== 'sf/world.json').map((p) => p.slice(3));
        expect(scene.sort()).toEqual(named.sort());
        for (const p of [...BOOT_FIRST, ...BOOT_SCENE, STREET_DETAIL]) expect(manifest[p], p).toBeDefined();
    });
});
