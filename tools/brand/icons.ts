/**
 * Rasterizes public/favicon.svg (tools/brand/favicon.ts) into the PNG fallbacks: favicon-32.png and
 * apple-touch-icon.png (180 px, square: iOS rounds the corners itself). Run by tools/brand/icons.sh.
 */

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync('public/favicon.svg', 'utf8');
const png = (src: string, size: number, out: string) =>
    sharp(Buffer.from(src), { density: (72 * size) / 64 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(out)
        .then((i) => console.log(`${out}: ${i.size} bytes`));

await png(svg, 32, 'public/favicon-32.png');
await png(svg.replace(/rx="14"/, 'rx="0"'), 180, 'public/apple-touch-icon.png');
