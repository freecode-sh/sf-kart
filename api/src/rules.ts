/**
 * The rules the API verifies runs with: the game's data files at the version it was deployed with
 * (DATA_VERSION, from the R2 bucket tools/uploadData.ts fills), loaded once per isolate. Their
 * rules id must be the RULES_ID the deploy computed (api/deploy.ts) from the same files.
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import { RULES_FILES, rulesId } from '../../src/app/run/rules';
import type { RulesData } from '../../src/app/run/verify';

export interface RulesEnv {
    ASSETS: R2Bucket;
    DATA_PREFIX: string;
    DATA_VERSION: string;
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

async function load(env: RulesEnv): Promise<RulesData> {
    const files = await Promise.all(
        RULES_FILES.map(async (f) => {
            const key = `${env.DATA_PREFIX}/${env.DATA_VERSION}/data/${f}`;
            const obj = await env.ASSETS.get(key);
            if (!obj) throw new Error(`missing ${key}`);
            return new Uint8Array(await obj.arrayBuffer());
        }),
    );
    const id = await rulesId(files);
    if (id !== env.RULES_ID) throw new Error(`rules ${id} in the data, ${env.RULES_ID} deployed`);
    const [kcl, kmp, meta, vehicles] = files as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    const text = new TextDecoder();
    return {
        vehicleData: JSON.parse(text.decode(vehicles)),
        course: new Map([
            ['course.kcl', kcl],
            ['course.kmp', kmp],
        ]),
        meta: JSON.parse(text.decode(meta)),
    };
}
