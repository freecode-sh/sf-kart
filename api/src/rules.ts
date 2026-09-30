/**
 * The rules the API verifies runs with: the game's rules files (the course and the vehicle data,
 * src/app/rules/hash.ts) from the deploy copy of the data in R2 (tools/uploadData.ts), at the
 * content-hashed names the deploy passes in (RULES_FILES), loaded once per isolate. Their rules hash
 * must be the RULES_ID the deploy computed from the same files (api/deploy.ts).
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { rulesHash } from '../../src/app/rules/hash';
import type { RulesData } from '../../src/app/rules/resim';

export interface RulesEnv {
    ASSETS: R2Bucket;
    DATA_PREFIX: string;
    /** JSON: { kcl, kmp, meta, vehicles } → stored file (tools/lib/dataBuild.ts; `.gz`: gzipped). */
    RULES_FILES: string;
    RULES_ID: string;
}

let loaded: Promise<RulesData> | null = null;

export function loadRules(env: RulesEnv): Promise<RulesData> {
    loaded ??= load(env).catch((e: unknown) => {
        loaded = null;
        throw e;
    });
    return loaded;
}

async function read(env: RulesEnv, file: string): Promise<Uint8Array> {
    const key = `${env.DATA_PREFIX}/${file}`;
    const obj = await env.ASSETS.get(key);
    if (!obj) throw new Error(`missing ${key}`);
    const bytes = await obj.arrayBuffer();
    if (!file.endsWith('.gz')) return new Uint8Array(bytes);
    const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    return new Uint8Array(await new Response(new Response(bytes).body!.pipeThrough(gunzip)).arrayBuffer());
}

async function load(env: RulesEnv): Promise<RulesData> {
    const files = JSON.parse(env.RULES_FILES) as Record<'kcl' | 'kmp' | 'meta' | 'vehicles', string>;
    const [kcl, kmp, meta, vehicles] = await Promise.all([read(env, files.kcl), read(env, files.kmp), read(env, files.meta), read(env, files.vehicles)]);
    const text = new TextDecoder();
    const data: RulesData = { kcl, kmp, meta: JSON.parse(text.decode(meta)), vehicles: JSON.parse(text.decode(vehicles)) };
    const hash = await rulesHash(data);
    if (hash !== env.RULES_ID) throw new Error(`rules ${hash} in the data, ${env.RULES_ID} deployed`);
    return data;
}
