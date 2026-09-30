/**
 * The client's data loader (src/app/data.ts) against a build's manifest: hashed URLs at the data
 * base, gzipped files unpacked (or taken as they are when the host already did), and a prefetched
 * file fetched once.
 */

import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const JSON_TEXT = JSON.stringify({ hello: 'bay' });
const served = new Map<string, Uint8Array<ArrayBuffer>>([
    ['https://cdn.test/sfkart/a.0123abcd.json.gz', new Uint8Array(gzipSync(JSON_TEXT))],
    ['https://cdn.test/sfkart/c.0123abcd.json.gz', new TextEncoder().encode(JSON_TEXT)], // (host-decoded)
    ['https://cdn.test/sfkart/b.89abcdef.bin', new Uint8Array([1, 2, 3])],
]);
const fetchMock = vi.fn(async (url: string) => {
    const body = served.get(url);
    return body ? new Response(body) : new Response(null, { status: 404 });
});

let data: typeof import('../src/app/data');
let paths: typeof import('../src/app/paths');

beforeAll(async () => {
    (globalThis as Record<string, unknown>).__SFK_DATA__ = {
        base: 'https://cdn.test/sfkart',
        files: { 'a.json': ['a.0123abcd.json.gz', 1], 'c.json': ['c.0123abcd.json.gz', 1], 'b.bin': ['b.89abcdef.bin', 0] },
    };
    vi.stubGlobal('fetch', fetchMock);
    paths = await import('../src/app/paths');
    data = await import('../src/app/data');
});

describe('data loader', () => {
    it('resolves paths through the manifest', () => {
        expect(paths.dataUrl('a.json')).toBe('https://cdn.test/sfkart/a.0123abcd.json.gz');
        expect(paths.dataUrl('sf/unlisted.bin')).toBe('https://cdn.test/sfkart/sf/unlisted.bin');
    });

    it('unpacks gzipped files, and takes host-decoded ones as they are', async () => {
        expect(await data.loadDataJson('a.json')).toEqual({ hello: 'bay' });
        expect(await data.loadDataJson('c.json')).toEqual({ hello: 'bay' });
        expect([...new Uint8Array(await data.loadData('b.bin'))]).toEqual([1, 2, 3]);
        await expect(data.loadData('missing.bin')).rejects.toThrow('404');
    });

    it('fetches a prefetched file once', async () => {
        fetchMock.mockClear();
        data.prefetchData(['b.bin', 'b.bin']);
        await data.loadData('b.bin');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
