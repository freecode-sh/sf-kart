/**
 * The rules hash: what a run was raced under, in one SHA-256. It covers the course (course.kcl,
 * course.kmp and the course_meta.json fields the rules read: the pickups and sections), the
 * vehicles (vehicles.json) and RULES_VERSION, which stands for the code. Runs are only compared
 * under the same hash: a new one starts a new leaderboard season.
 *
 * The app gets it at build time (RULES_HASH from `virtual:sfkart-rules-hash`, made by
 * tools/lib/rulesHashPlugin.ts); the verifier computes it from the files it simulates with.
 * crypto.subtle only: browsers, Node and Workers alike. No imports (vite.config.ts loads this).
 */

/**
 * The version of the race rules in code: bump it whenever a change can make the same inputs race
 * differently (sim.ts's input handling, tricks and start boost, easyDrift.ts, the pickups and splits
 * in rules/, how vehicles.json is packed for the engine, the engine itself). A bump starts a new
 * season. tests/rulesVersion.test.ts fails when those sources change, as a reminder.
 */
export const RULES_VERSION = 2;

/** The course_meta.json fields the rules read (rules/course.ts RulesMeta). */
type MetaFields = 'laps' | 'length' | 'segments' | 'centerline';

export interface RulesSources {
    kcl: Uint8Array;
    kmp: Uint8Array;
    /** course_meta.json (parsed; only the rules' fields count). */
    meta: { [K in MetaFields]: unknown };
    /** vehicles.json (parsed). */
    vehicles: unknown;
}

/** Just the fields the rules read, from a whole course_meta.json. */
export function rulesMeta<M extends { [K in MetaFields]: unknown }>(meta: M): Pick<M, MetaFields> {
    const { laps, length, segments, centerline } = meta;
    return { laps, length, segments, centerline };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

export async function rulesHash(src: RulesSources): Promise<string> {
    const text = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    const parts = [
        new TextEncoder().encode(`SFKR rules ${RULES_VERSION}\n`),
        await sha256(src.kcl),
        await sha256(src.kmp),
        await sha256(text(rulesMeta(src.meta))),
        await sha256(text(src.vehicles)),
    ];
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        all.set(p, o);
        o += p.length;
    }
    return [...(await sha256(all))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
