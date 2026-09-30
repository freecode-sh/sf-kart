/**
 * The link preview card (public/og-v3.jpg, 1200x630): the title screen itself (the fog card with the
 * SF KART name and the lap, "by freecode", the city behind it), its Race button swapped for the
 * tagline. The camera drifts through the title shots, so it takes a few frames a few seconds apart
 * (.context/og/og.<n>.png) and encodes the one you pick. A new card gets a new name (og-v4.jpg, here
 * and in index.html): link previews cache the image by its URL.
 *
 * Usage: npx tsx tools/brand/og.ts            (against a running `npm run dev`; then pick)
 *        npx tsx tools/brand/og.ts <n>        (encode frame n to public/og-v3.jpg)
 */

import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const OUT = '.context/og/og';
const pick = process.argv[2];

if (pick) {
    const i = await sharp(`${OUT}.${pick}.png`).resize(1200, 630).jpeg({ quality: 86, mozjpeg: true }).toFile('public/og-v3.jpg');
    console.log(`public/og-v3.jpg: ${i.width}x${i.height}, ${(i.size / 1024).toFixed(0)} KB`);
} else {
    const tagline = `(() => {
        const foot = document.querySelector('.onboarding .card-foot');
        const t = document.createElement('div');
        t.textContent = 'Race real San Francisco streets';
        t.style.cssText = 'font: 600 20px var(--font-body); color: var(--ink); text-align: center; width: 100%; padding: 14px 0';
        foot?.replaceChildren(t);
        document.querySelectorAll('.launch-post').forEach((e) => e.setAttribute('hidden', ''));
        return 'ok';
    })()`;
    const frames = [1, 2, 3, 4].flatMap((n) => ['wait:5000', `shot:${n}`]);
    execFileSync('npx', ['tsx', 'tools/sf/shot.ts', OUT, '--gpu', '--size', '1200x630', '--dpr', '2', '--', 'wait:8000', `js:${tagline}`, ...frames], { stdio: 'inherit' });
    console.log(`pick one: npx tsx tools/brand/og.ts <1-4>`);
}
