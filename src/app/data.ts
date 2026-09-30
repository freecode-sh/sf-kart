/**
 * Loads data files by path (relative to public/data; URLs from paths.ts), gunzipping the ones the
 * build stored gzipped. `prefetchData` starts files early (main() asks for everything the boot needs
 * at once, see bootData.ts); a later load of the same path picks up that request instead of making
 * another one. `dataProgress()` counts the bytes as they arrive, for the loading screen.
 */

import { dataGzipped, dataUrl } from './paths';

const early = new Map<string, Promise<ArrayBuffer>>();

/** Bytes received so far, bytes expected (from each response's Content-Length) and files still loading. */
const progress = { received: 0, expected: 0, pending: 0 };

/** How far the data downloads have come (a copy; poll it). */
export function dataProgress(): Readonly<typeof progress> {
    return { ...progress };
}

/** The response body, counted into `progress` chunk by chunk. */
async function readCounted(res: Response): Promise<ArrayBuffer> {
    const size = Number(res.headers.get('Content-Length')) || 0;
    progress.expected += size;
    if (!res.body) {
        const buf = await res.arrayBuffer();
        progress.received += buf.byteLength;
        progress.expected += buf.byteLength - size;
        return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        progress.received += value.byteLength;
    }
    // (No Content-Length, or a host that unpacked it on the way: expect what came.)
    progress.expected += got - size;
    const out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
    }
    return out.buffer;
}

async function fetchData(path: string, priority?: RequestPriority): Promise<ArrayBuffer> {
    const url = dataUrl(path);
    ++progress.pending;
    let buf: ArrayBuffer;
    try {
        const res = await fetch(url, priority ? { priority } : undefined);
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        buf = await readCounted(res);
    } finally {
        --progress.pending;
    }
    const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    // (A host that serves .gz files with Content-Encoding: gzip has already unpacked it.)
    if (!dataGzipped(path) || b[0] !== 0x1f || b[1] !== 0x8b) return buf;
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** Starts loading `paths` now (each is kept until it's loaded, once). */
export function prefetchData(paths: readonly string[], priority?: RequestPriority): void {
    for (const p of paths) {
        if (early.has(p)) continue;
        const load = fetchData(p, priority);
        load.catch(() => {}); // (Reported to whoever loads it.)
        early.set(p, load);
    }
}

/** The file's bytes. */
export function loadData(path: string): Promise<ArrayBuffer> {
    const load = early.get(path);
    if (!load) return fetchData(path);
    early.delete(path);
    return load;
}

export async function loadDataJson<T>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await loadData(path))) as T;
}

/** An image file as an object URL (for three's loaders; revoke it once loaded). */
export async function loadDataImage(path: string): Promise<string> {
    const type = path.endsWith('.webp') ? 'image/webp' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return URL.createObjectURL(new Blob([await loadData(path)], { type }));
}
