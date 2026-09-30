/**
 * Draws public/favicon.svg: the lap (the SF Kart logo's symbol, from the course chart's `mark`,
 * tools/sf/bakeChart.ts) in International Orange on a fog tile. Run by tools/brand/icons.sh.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FOG = '#f3f5f6';
const SIGNATURE = '#fe6a00';
const { mark } = JSON.parse(readFileSync('public/data/courses/golden_gate/chart.json', 'utf8')) as { mark: string };

// The mark's 100 x 100 box into the 64 x 64 tile, with a margin for its stroke.
const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${FOG}"/>` +
    `<path transform="translate(12 12) scale(0.4)" d="${mark}" fill="none" stroke="${SIGNATURE}" stroke-width="15" stroke-linejoin="round" stroke-linecap="round"/></svg>\n`;
writeFileSync('public/favicon.svg', svg);
console.log(`public/favicon.svg: ${svg.length} bytes`);
