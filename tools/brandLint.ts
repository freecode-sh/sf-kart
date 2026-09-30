/**
 * Brand lint: SF Kart ships no Nintendo names, no Mario Kart copy and no real-world brands (vehicle
 * makers and services, the toll program).
 * Scans everything player-facing comes from (the app's sources, strings and comments, its HTML, the
 * README and docs, the shipped data in public/) and the rest of the public repository (the tools and
 * the tests). The engine (src/game, src/egg) isn't scanned: it keeps the names of the Kinoko port it
 * mirrors (enum members such as the course / character / vehicle slots, `eStatus.X`,
 * `activateMushroom` ...), and references to those identifiers are skipped in the code that is. They
 * never reach the screen, but they are in the minified bundle as the enums' names, so dist/ isn't
 * scanned.
 *
 * Usage: npx tsx tools/brandLint.ts        (exit 1 on any hit)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = /mario|nintendo|\bwii\b|game ?cube|\bmkw\b|\bmk ?(8|wii|look|style)\b|mushroom|luigi|bowser|donkey|\bdk\b|shy ?guy|lakitu|flame[ _-]?(runner|flyer)|standard[ _-]?kart|waymo|lyft|bay ?wheels|gocar|jaguar|dolphin|fas ?trak/i;

/** Files that may name the lineage: the credits and the engine's porting notes. */
const ALLOW = new Set(['CREDITS.md', 'docs/PORTING.md', 'tools/brandLint.ts']);

const ROOTS = ['src/app', 'index.html', 'README.md', 'AGENTS.md', 'docs', 'public', 'tools', 'tests'];
const TEXT = /\.(ts|js|mjs|html|css|md|json|txt)$/;

/** Engine identifiers (code files only): enum members, m_ fields, the engine's own API names. */
const ENGINE_IDENT = /\w+\[\w+\.\w+=\d+\]=`\w*`|\b\w+_\w+\b|\b(eStatus|ItemId|Course|Character|Vehicle)\.\w+|\b(activateMushroom|MushroomBoost)\b/g;
const CODE = /\.(ts|js|mjs)$/;

const root = process.cwd();
const hits: string[] = [];

function scan(path: string): void {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
        for (const f of readdirSync(path)) scan(join(path, f));
        return;
    }
    const rel = relative(root, path);
    if (ALLOW.has(rel) || !TEXT.test(path)) return;
    readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
            const m = BANNED.exec(CODE.test(path) ? line.replace(ENGINE_IDENT, '') : line);
            if (m) hits.push(`${rel}:${i + 1}: "${m[0]}"  ${line.trim().slice(0, 140)}`);
        });
}

for (const r of ROOTS) scan(join(root, r));

if (hits.length) {
    console.log(hits.join('\n'));
    console.log(`\nbrand lint: ${hits.length} hit(s)`);
    process.exit(1);
}
console.log('brand lint: clean');
