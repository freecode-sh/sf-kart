/**
 * The aerial imagery's colour: NAIP (2022) matched to NOAA's (February 2025) overall colour, and one
 * grade for both. bakeImagery.ts grades the core's photos with it, bakeWorld.ts the far field's
 * (img/far.jpg), so the backdrop hills match the terrain in front of them.
 */

import { join } from 'node:path';
import sharp from 'sharp';
import type { ImageTiles } from './raster';
import { TERRAIN_BOX } from './terrainBake';

/** NAIP sRGB (0..255, bilinear) at (e, n) meters into `out`; false outside the tiles. */
export type Naip = (e: number, n: number, out: Float32Array) => boolean;

/** NAIP over the core: the 4 x 4 lat/lon tiles over TERRAIN_BOX from fetch.ts (row 0 = south). */
export async function loadNaip(ctx: string): Promise<Naip> {
    const n = 4;
    const tiles: { data: Buffer; w: number; h: number }[] = [];
    for (let j = 0; j < n; ++j)
        for (let i = 0; i < n; ++i) {
            const { data, info } = await sharp(join(ctx, 'naip/terrain', `${i}_${j}.jpg`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            tiles.push({ data, w: info.width, h: info.height });
        }
    const B = TERRAIN_BOX;
    const tw = (B.e1 - B.e0) / n;
    const th = (B.n1 - B.n0) / n;
    return (e, nn, out) => {
        const i = Math.floor((e - B.e0) / tw);
        const j = Math.floor((nn - B.n0) / th);
        if (i < 0 || j < 0 || i >= n || j >= n) return false;
        const t = tiles[j * n + i]!;
        const fx = ((e - B.e0 - i * tw) / tw) * t.w - 0.5;
        const fy = ((B.n0 + (j + 1) * th - nn) / th) * t.h - 0.5;
        const x0 = Math.max(0, Math.min(t.w - 2, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(t.h - 2, Math.floor(fy)));
        const a = Math.max(0, Math.min(1, fx - x0));
        const b = Math.max(0, Math.min(1, fy - y0));
        for (let c = 0; c < 3; ++c) {
            const p = (x: number, y: number) => t.data[(y * t.w + x) * 3 + c]!;
            out[c] = (p(x0, y0) * (1 - a) + p(x0 + 1, y0) * a) * (1 - b) + (p(x0, y0 + 1) * (1 - a) + p(x0 + 1, y0 + 1) * a) * b;
        }
        return true;
    };
}

/** Per-channel gain taking NAIP to NOAA's overall colour (medians over sunlit land both cover). */
function fitGain(pairs: [number[], number[]][]): number[] {
    const lit = pairs.filter(([a, b]) => a[1]! > 60 && b[1]! > 60);
    return [0, 1, 2].map((c) => {
        const r = lit.map(([a, b]) => b[c]! / Math.max(1, a[c]!)).sort((x, y) => x - y);
        return r[Math.floor(r.length / 2)]!;
    });
}

/** NAIP → NOAA colour match, from a coarse grid of land pixels both cover (and how many). */
export async function naipGain(noaa: ImageTiles, naip: Naip): Promise<{ gain: number[]; samples: number }> {
    const pairs: [number[], number[]][] = [];
    const B = TERRAIN_BOX;
    const box = { e0: B.e0 + 900, e1: B.e0 + 3900, n0: B.n0 + 300, n1: B.n0 + 2700 };
    const W = 300;
    const H = 240;
    const { data, cover } = await noaa.sample(box, W, H, [0, 1, 2]);
    const nv = new Float32Array(3);
    for (let y = 0; y < H; y += 2)
        for (let x = 0; x < W; x += 2) {
            const k = y * W + x;
            if (!cover[k]) continue;
            const e = box.e0 + ((x + 0.5) / W) * (box.e1 - box.e0);
            const n = box.n1 - ((y + 0.5) / H) * (box.n1 - box.n0);
            if (!naip(e, n, nv)) continue;
            pairs.push([[nv[0]!, nv[1]!, nv[2]!], [data[0]![k]!, data[1]![k]!, data[2]![k]!]]);
        }
    return { gain: fitGain(pairs), samples: pairs.length };
}

/**
 * The grade (sRGB 0..255 in and out): lift the shadows (the photos' midday shadows fight the game's
 * own sun), warm the cool February cast, a touch more saturation.
 */
export function grade(rgb: Float32Array): void {
    const r0 = rgb[0]! / 255;
    const g0 = rgb[1]! / 255;
    const b0 = rgb[2]! / 255;
    const L = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
    // Shadow lift: raise dark tones toward ~0.2, fading out by the mids.
    const lift = 0.08 * Math.max(0, 1 - L / 0.45) ** 1.6;
    // Warmth: pull blue down, red up, more so in the shadows (they're bluest).
    const warm = 0.035 + 0.05 * Math.max(0, 1 - L / 0.5);
    let r = r0 + lift + warm * 0.9;
    let g = g0 + lift + warm * 0.25;
    let b = b0 + lift * 0.85 - warm;
    // Saturation.
    const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = 1.08;
    r = l2 + (r - l2) * sat;
    g = l2 + (g - l2) * sat;
    b = l2 + (b - l2) * sat;
    rgb[0] = Math.max(0, Math.min(255, r * 255));
    rgb[1] = Math.max(0, Math.min(255, g * 255));
    rgb[2] = Math.max(0, Math.min(255, b * 255));
}
