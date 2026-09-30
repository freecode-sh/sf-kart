/**
 * Aerial imagery for the San Francisco course's terrain, from NOAA NGS 0.25 m orthoimagery (February
 * 2025, public domain), with USDA NAIP (2022, public domain) where NOAA doesn't reach (Marin):
 *
 *   base     the whole terrain grid (terrainBake.TERRAIN_BOX) at 1 m in BASE_N x BASE_N WebP tiles
 *   detail   0.3 m tiles of the terrain cells along the course, packed into WebP atlases, with a
 *            page table (cell → atlas slot); terrain.ts blends them over the base near the road
 *
 * Both are colour graded the same way: February light is cool and the midday shadows are hard, so
 * the grade lifts the shadows, warms the tone a little and evens out NAIP against NOAA.
 *
 * Also writes the NOAA vegetation index (NDVI from the near-infrared band) on a 2 m grid for the land
 * cover and trees (bakeWorld.ts), and imagery.json (merged into world.json by bakeWorld.ts).
 *
 * Usage: npx tsx tools/sf/bakeImagery.ts [--preview]    (after bakeWorld.ts; --preview: a few graded
 *        150 m patches to .context/imgcheck/ instead, for tuning the grade)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Corridor, type Meta } from './corridor';
import { grade, loadNaip, naipGain, type Naip } from './grade';
import { SCALE } from './geo';
import { ImageTiles, type MBox } from './raster';
import { NOAA_TILES } from './sources';
import { TERRAIN, TERRAIN_BOX } from './terrainBake';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CTX = join(ROOT, '.context/sf');
const OUT = join(ROOT, 'public/data/sf');

/** Base: tiles per side and ground resolution (m / px). */
const BASE_N = 2;
const BASE_RES = 1;
/** Detail: pixels per cell side, gutter pixels around each tile, tiles per atlas side. */
const DETAIL_PX = 320;
const PAD = 8;
const PER = 12;
/** Cells whose nearest point is within this of the road edge (m) get detail imagery. */
const DETAIL_REACH = 28;
const NDVI_RES = 2;

const WEBP_BASE = 72;
const WEBP_DETAIL = 70;

// ---------------------------------------------------------------------------------------------
// Colour (NAIP's match to NOAA and the grade: grade.ts)
// ---------------------------------------------------------------------------------------------

/** Separable box blur (radius r, clamped at the edges), twice: a triangle filter. */
function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
    let a = src;
    for (let pass = 0; pass < 2; ++pass) {
        const t = new Float32Array(W * H);
        for (let y = 0; y < H; ++y) {
            let s = 0;
            for (let x = -r; x <= r; ++x) s += a[y * W + Math.max(0, Math.min(W - 1, x))]!;
            for (let x = 0; x < W; ++x) {
                t[y * W + x] = s / (2 * r + 1);
                s += a[y * W + Math.min(W - 1, x + r + 1)]! - a[y * W + Math.max(0, x - r)]!;
            }
        }
        const u = new Float32Array(W * H);
        for (let x = 0; x < W; ++x) {
            let s = 0;
            for (let y = -r; y <= r; ++y) s += t[Math.max(0, Math.min(H - 1, y)) * W + x]!;
            for (let y = 0; y < H; ++y) {
                u[y * W + x] = s / (2 * r + 1);
                s += t[Math.min(H - 1, y + r + 1) * W + x]! - t[Math.max(0, y - r) * W + x]!;
            }
        }
        a = u;
    }
    return a;
}

// ---------------------------------------------------------------------------------------------

/** Scale (m) below which NOAA's detail is kept as is; above it, the tone comes from NAIP. */
const TONE_M = 6;
/** How much of NAIP's broad tone to take (1 = all of it). */
const TONE_MIX = 0.95;

/**
 * Samples the imagery over `box` into W x H RGB bytes (row 0 north): NOAA averaged down from `ss`
 * samples per pixel, NAIP where NOAA has nothing, graded. NOAA was flown in February, so its midday
 * shadows are long and blue; NAIP (May) has short ones. The result keeps NOAA's fine detail and takes
 * the broad brightness and colour (over TONE_M) from NAIP, which fills in the shadows.
 * Optionally returns the NDVI per output pixel.
 */
async function render(noaa: ImageTiles, naip: Naip, gain: number[], box: MBox, W: number, H: number, ss: number, ndvi?: Float32Array): Promise<Buffer> {
    const res = (box.e1 - box.e0) / W;
    const R = Math.max(1, Math.round(TONE_M / res));
    const M = 2 * R;
    const W2 = W + 2 * M;
    const H2 = H + 2 * M;
    const big = { e0: box.e0 - M * res, e1: box.e1 + M * res, n0: box.n0 - M * res, n1: box.n1 + M * res };
    const sw = W2 * ss;
    const { data, cover } = await noaa.sample(big, sw, H2 * ss, [0, 1, 2, 3]);
    const src = [new Float32Array(W2 * H2), new Float32Array(W2 * H2), new Float32Array(W2 * H2)];
    const nai = [new Float32Array(W2 * H2), new Float32Array(W2 * H2), new Float32Array(W2 * H2)];
    const hasNaip = new Uint8Array(W2 * H2);
    const nv = new Float32Array(3);
    for (let y = 0; y < H2; ++y)
        for (let x = 0; x < W2; ++x) {
            const o = y * W2 + x;
            let r = 0;
            let g = 0;
            let b = 0;
            let nir = 0;
            let cov = 0;
            for (let v = 0; v < ss; ++v)
                for (let u = 0; u < ss; ++u) {
                    const k = (y * ss + v) * sw + x * ss + u;
                    if (!cover[k]) continue;
                    r += data[0]![k]!;
                    g += data[1]![k]!;
                    b += data[2]![k]!;
                    nir += data[3]![k]!;
                    ++cov;
                }
            const f = cov / (ss * ss);
            if (cov) {
                r /= cov;
                g /= cov;
                b /= cov;
                nir /= cov;
            }
            const e = big.e0 + (x + 0.5) * res;
            const n = big.n1 - (y + 0.5) * res;
            if (naip(e, n, nv)) {
                hasNaip[o] = 1;
                for (let c = 0; c < 3; ++c) nai[c]![o] = nv[c]! * gain[c]!;
                r = r * f + nai[0]![o]! * (1 - f);
                g = g * f + nai[1]![o]! * (1 - f);
                b = b * f + nai[2]![o]! * (1 - f);
            } else for (let c = 0; c < 3; ++c) nai[c]![o] = [r, g, b][c]!;
            src[0]![o] = r;
            src[1]![o] = g;
            src[2]![o] = b;
            const inside = x >= M && y >= M && x < W + M && y < H + M;
            if (ndvi && inside) ndvi[(y - M) * W + x - M] = cov ? (nir - r) / (nir + r + 1e-3) : NaN;
        }
    // Luminance ratio NAIP / NOAA at the broad scale: > 1 in NOAA's shadows. Only ever brightens
    // (NAIP's own lean and misregistration shouldn't darken sunlit ground).
    const lum = (a: Float32Array[], o: number) => 0.2126 * a[0]![o]! + 0.7152 * a[1]![o]! + 0.0722 * a[2]![o]!;
    const ys = new Float32Array(W2 * H2);
    const yn = new Float32Array(W2 * H2);
    for (let o = 0; o < W2 * H2; ++o) {
        ys[o] = lum(src, o);
        yn[o] = lum(nai, o);
    }
    const ls = blur(ys, W2, H2, R);
    const ln = blur(yn, W2, H2, R);
    const lc = nai.map((c) => blur(c, W2, H2, R));
    const out = Buffer.alloc(W * H * 3);
    const px = new Float32Array(3);
    for (let y = 0; y < H; ++y)
        for (let x = 0; x < W; ++x) {
            const o = (y + M) * W2 + x + M;
            const ratio = hasNaip[o] ? Math.max(1, Math.min(2.6, (ln[o]! + 6) / (ls[o]! + 6))) : 1;
            const k = 1 + (ratio - 1) * TONE_MIX;
            // In the lifted shadows, the (blue skylight) colour goes toward NAIP's local colour.
            const w = Math.min(0.85, Math.max(0, (ratio - 1.15) / 0.8));
            const Y = ys[o]! * k;
            const Yl = Math.max(1, lum(lc, o));
            for (let c = 0; c < 3; ++c) {
                const own = (src[c]![o]! - ys[o]!) * k;
                const theirs = ((lc[c]![o]! - Yl) * Y) / Yl;
                px[c] = Y + own * (1 - w) + theirs * w;
            }
            grade(px);
            const q = (y * W + x) * 3;
            out[q] = px[0]!;
            out[q + 1] = px[1]!;
            out[q + 2] = px[2]!;
        }
    return out;
}

async function main(): Promise<void> {
    const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/courses/golden_gate/course_meta.json'), 'utf8')) as Meta;
    const corridor = new Corridor(meta, ['bridge_nb', 'bridge_sb']);
    const noaa = await ImageTiles.open(NOAA_TILES.map((t) => join(CTX, 'noaa', `${t}.tif`)));
    const naip = await loadNaip(CTX);
    const levels = (JSON.parse(readFileSync(join(OUT, 'world.json'), 'utf8')) as { terrain?: { levels: number[] } }).terrain?.levels;
    mkdirSync(join(OUT, 'img'), { recursive: true });
    mkdirSync(join(CTX, 'derived'), { recursive: true });

    const { gain, samples } = await naipGain(noaa, naip);
    console.log(`NAIP→NOAA gain from ${samples} px: ${gain.map((v) => v.toFixed(2))}`);

    // --preview: a few 150 m patches at detail resolution, for tuning the grade.
    if (process.argv.includes('--preview')) {
        const spots: [string, number, number][] = [
            ['fort', 150, -120],
            ['lincoln', 420, -470],
            ['crissy', 1200, -560],
            ['palace', 2600, -900],
            ['parkway', 1100, -960],
        ];
        mkdirSync(join(ROOT, '.context/imgcheck'), { recursive: true });
        for (const [name, e, n] of spots) {
            const box = { e0: e - 75, e1: e + 75, n0: n - 75, n1: n + 75 };
            const img = await render(noaa, naip, gain, box, 500, 500, 1);
            await sharp(img, { raw: { width: 500, height: 500, channels: 3 } }).png().toFile(join(ROOT, '.context/imgcheck', `pv_${name}.png`));
        }
        await noaa.close();
        return;
    }

    // ---- base ----
    const B = TERRAIN_BOX;
    const tileE = (B.e1 - B.e0) / BASE_N;
    const tileN = (B.n1 - B.n0) / BASE_N;
    const W = Math.round(tileE / BASE_RES);
    const H = Math.round(tileN / BASE_RES);
    const nW = Math.round((B.e1 - B.e0) / NDVI_RES);
    const nH = Math.round((B.n1 - B.n0) / NDVI_RES);
    const ndviGrid = new Uint8Array(nW * nH);
    let baseBytes = 0;
    for (let j = 0; j < BASE_N; ++j)
        for (let i = 0; i < BASE_N; ++i) {
            // Row j from the north.
            const img = Buffer.alloc(W * H * 3);
            const STRIP = 144;
            for (let y0 = 0; y0 < H; y0 += STRIP) {
                const h = Math.min(STRIP, H - y0);
                const box = { e0: B.e0 + i * tileE, e1: B.e0 + (i + 1) * tileE, n1: B.n1 - j * tileN - y0 * BASE_RES, n0: B.n1 - j * tileN - (y0 + h) * BASE_RES };
                const nd = new Float32Array(W * h);
                const strip = await render(noaa, naip, gain, box, W, h, 2, nd);
                strip.copy(img, y0 * W * 3);
                // NDVI down to NDVI_RES (Uint8: 0 = no data, else 1 + (ndvi + 1) * 127).
                const f = NDVI_RES / BASE_RES;
                for (let y = 0; y < h; y += f)
                    for (let x = 0; x < W; x += f) {
                        let s = 0;
                        let c = 0;
                        for (let v = 0; v < f; ++v)
                            for (let u = 0; u < f; ++u) {
                                const q = nd[(y + v) * W + x + u]!;
                                if (Number.isFinite(q)) {
                                    s += q;
                                    ++c;
                                }
                            }
                        const gx = (i * W + x) / f;
                        const gy = (j * H + y0 + y) / f;
                        ndviGrid[gy * nW + gx] = c ? 1 + Math.round((Math.max(-1, Math.min(1, s / c)) + 1) * 127) : 0;
                    }
            }
            const file = `img/base_${i}_${j}.webp`;
            await sharp(img, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: WEBP_BASE, effort: 6 }).toFile(join(OUT, file));
            const size = readFileSync(join(OUT, file)).length;
            baseBytes += size;
            console.log(`${file}: ${W}x${H}, ${(size / 1e6).toFixed(2)} MB`);
        }
    writeFileSync(join(CTX, 'derived/ndvi.bin'), ndviGrid);

    // ---- detail ----
    const { cell, cx, cz } = TERRAIN;
    const page = new Int16Array(cx * cz).fill(-1);
    const chosen: number[] = [];
    for (let j = 0; j < cz; ++j)
        for (let i = 0; i < cx; ++i) {
            if (levels && levels[j * cx + i] === 255) continue;
            const ce = TERRAIN.e0 + (i + 0.5) * cell;
            const cn = TERRAIN.n1 - (j + 0.5) * cell;
            const d = corridor.distance(ce * SCALE, -cn * SCALE, false) / SCALE - cell * 0.71;
            if (d < DETAIL_REACH) chosen.push(j * cx + i);
        }
    const full = DETAIL_PX + 2 * PAD;
    const perAtlas = PER * PER;
    const nAtlas = Math.ceil(chosen.length / perAtlas);
    const atlasSize = PER * full;
    const res = cell / DETAIL_PX;
    const atlases: string[] = [];
    let detailBytes = 0;
    for (let a = 0; a < nAtlas; ++a) {
        const img = Buffer.alloc(atlasSize * atlasSize * 3);
        const cells = chosen.slice(a * perAtlas, (a + 1) * perAtlas);
        for (let s = 0; s < cells.length; ++s) {
            const c = cells[s]!;
            const i = c % cx;
            const j = Math.floor(c / cx);
            const e0 = TERRAIN.e0 + i * cell - PAD * res;
            const n1 = TERRAIN.n1 - j * cell + PAD * res;
            const box = { e0, e1: e0 + full * res, n1, n0: n1 - full * res };
            const tile = await render(noaa, naip, gain, box, full, full, 1);
            const sx = (s % PER) * full;
            const sy = Math.floor(s / PER) * full;
            for (let y = 0; y < full; ++y) tile.copy(img, ((sy + y) * atlasSize + sx) * 3, y * full * 3, (y + 1) * full * 3);
            page[c] = a * perAtlas + s;
        }
        const file = `img/detail_${a}.webp`;
        await sharp(img, { raw: { width: atlasSize, height: atlasSize, channels: 3 } }).webp({ quality: WEBP_DETAIL, effort: 6 }).toFile(join(OUT, file));
        const size = readFileSync(join(OUT, file)).length;
        detailBytes += size;
        atlases.push(file);
        console.log(`${file}: ${cells.length} cells, ${(size / 1e6).toFixed(2)} MB`);
    }
    await noaa.close();
    console.log(`imagery: base ${(baseBytes / 1e6).toFixed(2)} MB, detail ${(detailBytes / 1e6).toFixed(2)} MB (${chosen.length} cells)`);

    const imagery = {
        base: { e0: B.e0, e1: B.e1, n0: B.n0, n1: B.n1, n: BASE_N, pattern: 'img/base_{i}_{j}.webp' },
        detail: { tile: DETAIL_PX, pad: PAD, per: PER, atlasSize, atlases, page: Array.from(page) },
        ndvi: { e0: B.e0, n1: B.n1, res: NDVI_RES, nx: nW, nz: nH },
    };
    writeFileSync(join(CTX, 'derived/imagery.json'), JSON.stringify(imagery));
    // Into world.json too (bakeWorld.ts merges it on its next run).
    const world = JSON.parse(readFileSync(join(OUT, 'world.json'), 'utf8')) as Record<string, unknown>;
    world.imagery = { base: imagery.base, detail: imagery.detail };
    writeFileSync(join(OUT, 'world.json'), JSON.stringify(world));
}

await main();
