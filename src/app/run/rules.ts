/**
 * The rules a run is raced under, as one id: RULES_VERSION and the data files that decide a race
 * (the course's collision, checkpoints and pickups, the vehicles' numbers). The game is built with
 * its id (vite.config.ts); the leaderboard computes its own from the data it verifies with, takes
 * runs only under that id and keeps each id's board apart (a season).
 *
 * Bump RULES_VERSION whenever the code that decides a race changes: the engine, race.ts, verify.ts,
 * pickupField.ts, vehicleData.ts's packing, tuning.ts's tuneStats (tests/rules.test.ts notices those
 * files changing). Not for changes to the input layers (easy drift, hop tricks): their output is
 * what's recorded.
 */

export const RULES_VERSION = 1;

/** The data files (under data/) the rules id covers. */
export const RULES_FILES = [
    'courses/golden_gate/course.kcl',
    'courses/golden_gate/course.kmp',
    'courses/golden_gate/course_meta.json',
    'vehicles/vehicles.json',
] as const;

/** The rules id (16 hex digits) from the files' bytes (RULES_FILES order). */
export async function rulesId(files: readonly Uint8Array[]): Promise<string> {
    const parts: Uint8Array[] = [new TextEncoder().encode(`sfkart-rules-v${RULES_VERSION}`)];
    for (const f of files) parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', f as Uint8Array<ArrayBuffer>)));
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        all.set(p, o);
        o += p.length;
    }
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', all)).subarray(0, 8));
}

export function hex(b: Uint8Array): string {
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
