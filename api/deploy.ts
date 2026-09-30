/**
 * Deploys the leaderboard API (api/wrangler.jsonc) for the data in public/data: uploads the data if
 * this version isn't on the CDN yet (tools/uploadData.ts), applies the D1 migrations, then deploys
 * the Worker with the data version and rules id (src/app/run/rules.ts) it verifies runs under.
 * Deploy it whenever the rules change, before the game (runs from the new game are refused as
 * stale by an API still on the old rules, and the other way round).
 *
 * Usage: npx tsx api/deploy.ts [--staging] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dataRulesId, dataVersion } from '../tools/lib/dataVersion';

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dry = args.includes('--dry-run');
const env = ['--env', staging ? 'staging' : ''];
const wrangler = (...a: string[]) => execFileSync('npx', ['wrangler', ...a, '-c', 'api/wrangler.jsonc', ...env], { stdio: 'inherit' });

const version = dataVersion();
const rules = await dataRulesId();
console.log(`data ${version}, rules ${rules}${staging ? ' (staging)' : ''}`);
if (!dry) {
    execFileSync('npx', ['tsx', 'tools/uploadData.ts'], { stdio: 'inherit' });
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote');
}
wrangler('deploy', '--var', `DATA_VERSION:${version}`, '--var', `RULES_ID:${rules}`, ...(dry ? ['--dry-run', '--outdir', resolve('.context/api-dist')] : []));
