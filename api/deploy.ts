/**
 * Deploys the leaderboard API (api/wrangler.jsonc) for the data in public/data: uploads the deploy
 * copy of the data if the CDN lacks any of it (tools/uploadData.ts), applies the D1 migrations, then
 * deploys the Worker with the rules hash (src/app/rules/hash.ts) and the stored names of the rules
 * files it verifies runs with. Deploy it whenever the rules change, before the game (the API refuses
 * runs raced under other rules as stale).
 *
 * Usage: npx tsx api/deploy.ts [--staging] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { rulesHash } from '../src/app/rules/hash';
import { buildData } from '../tools/lib/dataBuild';
import { readRulesSources } from '../tools/lib/rulesHashPlugin';

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dry = args.includes('--dry-run');
const env = ['--env', staging ? 'staging' : ''];
const wrangler = (...a: string[]) => execFileSync('npx', ['wrangler', ...a, '-c', 'api/wrangler.jsonc', ...env], { stdio: 'inherit' });

const manifest = buildData('public/data');
const stored = (path: string) => manifest[path]!.file;
const files = {
    kcl: stored('courses/golden_gate/course.kcl'),
    kmp: stored('courses/golden_gate/course.kmp'),
    meta: stored('courses/golden_gate/course_meta.json'),
    vehicles: stored('vehicles/vehicles.json'),
};
const rules = await rulesHash(readRulesSources());
console.log(`rules ${rules}${staging ? ' (staging)' : ''}`);
if (!dry) {
    execFileSync('npx', ['tsx', 'tools/uploadData.ts', '--apply'], { stdio: 'inherit' });
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote');
}
wrangler('deploy', '--var', `RULES_ID:${rules}`, '--var', `RULES_FILES:${JSON.stringify(files)}`, ...(dry ? ['--dry-run', '--outdir', resolve('.context/api-dist')] : []));
