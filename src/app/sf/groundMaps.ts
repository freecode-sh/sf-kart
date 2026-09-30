/**
 * Ground maps for the terrain's imagery, made at load time from the baked data (no extra downloads):
 *
 *   mask   2 m over the core: R where the aerial photo shows a tree we draw in 3D (its crown and the
 *          photo's shadow of it, which falls to the north-north-west), G asphalt (OSM streets), B
 *          parking lots, A contact shade under the 3D trees
 *   fill   4 m: the imagery with those crowns and the photo's dark shadows filled in from the ground
 *          around them (push-pull), turning to a leaf-litter floor inside forests — what the ground
 *          under our trees shows instead of a photo of their tops; A: 0 on water-sized dark areas
 *   cover  8 m: the land cover, R vegetated (grass, scrub, forest), G grass (lawns and parks), B
 *          road ground: near a street, a parking lot or the course, where the terrain takes out the
 *          photo's paint (its lane and centre lines, stalls, arrows; ours are drawn in 3D), A sand
 *          (beaches and dunes)
 *
 * Also samples the imagery (4 m) for the trees' crown colours.
 */

import * as THREE from 'three';
import { LANDCOVER, type SfWorld } from './world';

/** Mask and fill resolution (m per texel). */
const MASK_RES = 2;
const FILL_RES = 4;
/** Direction (e, n) of the shadows in the aerial photos (the sun was in the south-south-east). */
const PHOTO_SHADOW: [number, number] = [-0.42, 0.91];
/** Road ground (cover B): this far from a street's edge or a parking lot, or the course (m). */
const PAINT_NEAR_STREET = 10;
const PAINT_NEAR_COURSE = 40;
/** Forest floor (sRGB): leaf litter and duff with a little green. */
const DUFF: [number, number, number] = [98, 104, 62];

export interface GroundMaps {
    /** Frame of both maps (meters): west edge, north edge, size. */
    e0: number;
    n1: number;
    width: number;
    height: number;
    mask: THREE.DataTexture;
    fill: THREE.DataTexture;
    cover: THREE.DataTexture;
    /** How wooded (0..1) the ground around (e, n) m is: our trees' crowns over ~20 m. */
    woods(e: number, n: number): number;
    /** Mean imagery colour (sRGB 0..1) within r m of (e, n) m, or null outside the imagery. */
    photoAt(e: number, n: number, r: number, out: THREE.Color): THREE.Color | null;
    dispose(): void;
}

export interface TreeFootprint {
    e: number;
    n: number;
    /** Crown radius and height (m). */
    r: number;
    h: number;
}

/** The base imagery drawn down to FILL_RES (sRGB bytes, RGBA, row 0 north). */
function photoGrid(world: SfWorld, W: number, H: number): Uint8ClampedArray {
    const B = world.json.imagery.base;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const tw = W / B.n;
    const th = H / B.n;
    for (let j = 0; j < B.n; ++j)
        for (let i = 0; i < B.n; ++i) {
            const img = world.baseImage(i, j).image as CanvasImageSource | undefined;
            if (img) g.drawImage(img, i * tw, j * th, tw, th);
        }
    return g.getImageData(0, 0, W, H).data;
}

/** `course`: the course centreline (world units), for the road ground around it. */
export function buildGroundMaps(world: SfWorld, trees: TreeFootprint[], course: readonly { pos: readonly number[] }[] = []): GroundMaps {
    const B = world.json.imagery.base;
    const s = world.json.scale;
    const e0 = B.e0;
    const n1 = B.n1;
    const width = B.e1 - B.e0;
    const height = B.n1 - B.n0;
    const MW = Math.round(width / MASK_RES);
    const MH = Math.round(height / MASK_RES);
    const FW = Math.round(width / FILL_RES);
    const FH = Math.round(height / FILL_RES);

    // ---- mask ----
    const mask = new Uint8Array(MW * MH * 4);
    /** Calls fn(k, d) for mask texels within `r` m of the segment a-b (d = distance, m). */
    const stroke = (ae: number, an: number, be: number, bn: number, r: number, fn: (k: number, d: number) => void) => {
        const x0 = Math.max(0, Math.floor((Math.min(ae, be) - r - e0) / MASK_RES));
        const x1 = Math.min(MW - 1, Math.ceil((Math.max(ae, be) + r - e0) / MASK_RES));
        const y0 = Math.max(0, Math.floor((n1 - Math.max(an, bn) - r) / MASK_RES));
        const y1 = Math.min(MH - 1, Math.ceil((n1 - Math.min(an, bn) + r) / MASK_RES));
        const de = be - ae;
        const dn = bn - an;
        const L2 = de * de + dn * dn || 1;
        for (let y = y0; y <= y1; ++y)
            for (let x = x0; x <= x1; ++x) {
                const e = e0 + (x + 0.5) * MASK_RES;
                const n = n1 - (y + 0.5) * MASK_RES;
                const t = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / L2));
                const d = Math.hypot(ae + de * t - e, an + dn * t - n);
                if (d < r) fn(y * MW + x, d);
            }
    };
    const put = (k: number, c: number, v: number) => {
        const q = Math.round(Math.max(0, Math.min(1, v)) * 255);
        if (q > mask[k * 4 + c]!) mask[k * 4 + c] = q;
    };
    for (const t of trees) {
        // The photo's crown (a little wider: the tree leans in the photo), soft at the rim.
        const rc = t.r * 1.15 + 0.8;
        stroke(t.e, t.n, t.e, t.n, rc + 1.5, (k, d) => {
            put(k, 0, (rc + 1.5 - d) / 2);
            put(k, 3, (1 - d / (t.r * 1.2)) * 0.9);
        });
        // Its shadow in the photo.
        const L = t.h * 0.75;
        const se = t.e + PHOTO_SHADOW[0] * L;
        const sn = t.n + PHOTO_SHADOW[1] * L;
        const rs = t.r * 0.85 + 0.5;
        stroke(t.e, t.n, se, sn, rs + 1.5, (k, d) => put(k, 0, ((rs + 1.5 - d) / 2) * 0.9));
    }
    // Streets (not paths: the photo's are right).
    for (const st of world.json.streets) {
        if (st.kind === 1) continue;
        const hw = st.w / 2;
        const p = st.pts;
        for (let k = 0; k + 3 < p.length; k += 2)
            stroke(p[k]! / s, -p[k + 1]! / s, p[k + 2]! / s, -p[k + 3]! / s, hw + 1, (q, d) => put(q, 1, hw + 0.5 - d));
    }
    // Parking lots (land cover, 8 m).
    {
        const c = world.json.landcover;
        for (let j = 0; j < c.nz; ++j)
            for (let i = 0; i < c.nx; ++i) {
                if (world.landcover[j * c.nx + i] !== LANDCOVER.paved) continue;
                const e = c.e0 + i * c.step;
                const n = c.n1 - j * c.step;
                stroke(e, n, e, n, c.step * 0.75, (k) => put(k, 2, 1));
            }
    }
    const maskTex = new THREE.DataTexture(mask, MW, MH, THREE.RGBAFormat, THREE.UnsignedByteType);
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.minFilter = THREE.LinearMipmapLinearFilter;
    maskTex.generateMipmaps = true;
    maskTex.needsUpdate = true;

    // ---- fill ----
    const photo = photoGrid(world, FW, FH);
    const lot = lotAsphalt(world, photo, FW, FH);
    // Weight of each 4 m texel as a sample of open ground: not under one of our crowns, not in a
    // dark (bluish) photo shadow, and in a parking lot not a parked car (so the lot fills in with
    // its own bare asphalt, which the terrain shows over the photo's cars).
    const w0 = new Float32Array(FW * FH);
    const canopy = new Float32Array(FW * FH);
    const shadeAt = new Float32Array(FW * FH);
    const R = FILL_RES / MASK_RES;
    for (let y = 0; y < FH; ++y)
        for (let x = 0; x < FW; ++x) {
            let c = 0;
            for (let v = 0; v < R; ++v) for (let u = 0; u < R; ++u) c += mask[((y * R + v) * MW + x * R + u) * 4]!;
            c /= R * R * 255;
            const k = y * FW + x;
            const r = photo[k * 4]!;
            const g = photo[k * 4 + 1]!;
            const b = photo[k * 4 + 2]!;
            const lum = 0.3 * r + 0.59 * g + 0.11 * b;
            const shade = Math.max(0, Math.min(1, (70 - lum) / 30)) * Math.max(0, Math.min(1, 0.5 + (b - r) / 30));
            shadeAt[k] = shade;
            canopy[k] = c;
            w0[k] = Math.max(0, 1 - c * 1.3) * (1 - shade) * lot[k]!;
        }
    const fill = pushPull(photo, w0, FW, FH);
    // Inside forests the floor is litter, not lawn: blend by the canopy density around (~20 m).
    const dens = boxBlur(boxBlur(canopy, FW, FH, 3, true), FW, FH, 3, false);
    // Dark blue over ~40 m is water (ponds, the lagoon), not a shadow.
    const wide = boxBlur(boxBlur(shadeAt, FW, FH, 5, true), FW, FH, 5, false);
    const out = new Uint8Array(FW * FH * 4);
    for (let k = 0; k < FW * FH; ++k) {
        const f = Math.max(0, Math.min(1, (dens[k]! - 0.35) / 0.45)) * 0.85;
        for (let c = 0; c < 3; ++c) out[k * 4 + c] = Math.round(fill[k * 3 + c]! * (1 - f) + DUFF[c]! * f);
        out[k * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (0.8 - wide[k]!) / 0.3)));
    }
    const fillTex = new THREE.DataTexture(out, FW, FH, THREE.RGBAFormat, THREE.UnsignedByteType);
    fillTex.colorSpace = THREE.SRGBColorSpace;
    fillTex.magFilter = THREE.LinearFilter;
    fillTex.minFilter = THREE.LinearMipmapLinearFilter;
    fillTex.generateMipmaps = true;
    fillTex.needsUpdate = true;

    // ---- cover (the land cover grid spans the imagery) ----
    const lc = world.json.landcover;
    const cov = new Uint8Array(lc.nx * lc.nz * 4);
    for (let k = 0; k < lc.nx * lc.nz; ++k) {
        const c = world.landcover[k];
        cov[k * 4] = c === LANDCOVER.grass || c === LANDCOVER.scrub || c === LANDCOVER.forest ? 255 : 0;
        cov[k * 4 + 1] = c === LANDCOVER.grass ? 255 : 0;
        cov[k * 4 + 2] = c === LANDCOVER.paved ? 255 : 0;
        cov[k * 4 + 3] = c === LANDCOVER.sand ? 255 : 0;
    }
    // Road ground: the land cover cells near a street or the course (the photo's roads can sit a
    // few metres off ours, where the course was moved or widened; not its beaches, whose surf is
    // white too).
    const road = (ae: number, an: number, be: number, bn: number, r: number, shore: boolean) => {
        const i0 = Math.max(0, Math.floor((Math.min(ae, be) - r - lc.e0) / lc.step));
        const i1 = Math.min(lc.nx - 1, Math.ceil((Math.max(ae, be) + r - lc.e0) / lc.step));
        const j0 = Math.max(0, Math.floor((lc.n1 - Math.max(an, bn) - r) / lc.step));
        const j1 = Math.min(lc.nz - 1, Math.ceil((lc.n1 - Math.min(an, bn) + r) / lc.step));
        const de = be - ae;
        const dn = bn - an;
        const L2 = de * de + dn * dn || 1;
        for (let j = j0; j <= j1; ++j)
            for (let i = i0; i <= i1; ++i) {
                const e = lc.e0 + i * lc.step;
                const n = lc.n1 - j * lc.step;
                const t = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / L2));
                const c = world.landcover[j * lc.nx + i];
                if (!shore && (c === LANDCOVER.sand || c === LANDCOVER.water)) continue;
                if (Math.hypot(ae + de * t - e, an + dn * t - n) < r) cov[(j * lc.nx + i) * 4 + 2] = 255;
            }
    };
    for (const st of world.json.streets) {
        if (st.kind === 1) continue;
        const p = st.pts;
        for (let k = 0; k + 3 < p.length; k += 2) road(p[k]! / s, -p[k + 1]! / s, p[k + 2]! / s, -p[k + 3]! / s, st.w / 2 + PAINT_NEAR_STREET, true);
    }
    for (let k = 0; k < course.length; ++k) {
        const a = course[k]!.pos;
        const b = course[(k + 1) % course.length]!.pos;
        road(a[0]! / s, -a[2]! / s, b[0]! / s, -b[2]! / s, PAINT_NEAR_COURSE, false);
    }
    const coverTex = new THREE.DataTexture(cov, lc.nx, lc.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    coverTex.magFilter = THREE.LinearFilter;
    coverTex.minFilter = THREE.LinearMipmapLinearFilter;
    coverTex.generateMipmaps = true;
    coverTex.needsUpdate = true;

    return {
        e0,
        n1,
        width,
        height,
        mask: maskTex,
        fill: fillTex,
        cover: coverTex,
        woods(e, n) {
            const x = Math.floor((e - e0) / FILL_RES);
            const y = Math.floor((n1 - n) / FILL_RES);
            return x < 0 || y < 0 || x >= FW || y >= FH ? 0 : dens[y * FW + x]!;
        },
        photoAt(e, n, r, col) {
            const cx = (e - e0) / FILL_RES;
            const cy = (n1 - n) / FILL_RES;
            const q = Math.max(0, Math.round(r / FILL_RES - 0.5));
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let cnt = 0;
            for (let v = -q; v <= q; ++v)
                for (let u = -q; u <= q; ++u) {
                    const x = Math.floor(cx) + u;
                    const y = Math.floor(cy) + v;
                    if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
                    const k = (y * FW + x) * 4;
                    sr += photo[k]!;
                    sg += photo[k + 1]!;
                    sb += photo[k + 2]!;
                    ++cnt;
                }
            return cnt ? col.setRGB(sr / cnt / 255, sg / cnt / 255, sb / cnt / 255, THREE.SRGBColorSpace) : null;
        },
        dispose() {
            maskTex.dispose();
            fillTex.dispose();
            coverTex.dispose();
        },
    };
}

/**
 * Per 4 m texel of the photo, how much it looks like its parking lot's bare asphalt (1 outside the
 * lots): the lots are the land cover's paved areas, each one's asphalt its median brightness, and
 * a parked car (brighter or darker than that) weighs nothing.
 */
function lotAsphalt(world: SfWorld, photo: Uint8ClampedArray, W: number, H: number): Float32Array {
    const c = world.json.landcover;
    const B = world.json.imagery.base;
    // The lots: connected paved cells.
    const id = new Int32Array(c.nx * c.nz).fill(-1);
    let lots = 0;
    const stack: number[] = [];
    for (let k0 = 0; k0 < id.length; ++k0) {
        if (id[k0] !== -1 || world.landcover[k0] !== LANDCOVER.paved) continue;
        id[k0] = lots;
        stack.push(k0);
        while (stack.length) {
            const k = stack.pop()!;
            const i = k % c.nx;
            for (const q of [i > 0 ? k - 1 : -1, i + 1 < c.nx ? k + 1 : -1, k - c.nx, k + c.nx])
                if (q >= 0 && q < id.length && id[q] === -1 && world.landcover[q] === LANDCOVER.paved) {
                    id[q] = lots;
                    stack.push(q);
                }
        }
        ++lots;
    }
    const lotOf = new Int32Array(W * H);
    const hist = new Uint32Array(lots * 256);
    const lum = (k: number) => Math.round(0.3 * photo[k * 4]! + 0.59 * photo[k * 4 + 1]! + 0.11 * photo[k * 4 + 2]!);
    for (let y = 0; y < H; ++y)
        for (let x = 0; x < W; ++x) {
            const i = Math.round((B.e0 + ((x + 0.5) / W) * (B.e1 - B.e0) - c.e0) / c.step);
            const j = Math.round((c.n1 - (B.n1 - ((y + 0.5) / H) * (B.n1 - B.n0))) / c.step);
            const l = i < 0 || j < 0 || i >= c.nx || j >= c.nz ? -1 : id[j * c.nx + i]!;
            lotOf[y * W + x] = l;
            if (l >= 0) ++hist[l * 256 + lum(y * W + x)]!;
        }
    const median = new Uint8Array(lots);
    for (let l = 0; l < lots; ++l) {
        let n = 0;
        for (let v = 0; v < 256; ++v) n += hist[l * 256 + v]!;
        let m = 0;
        let v = 0;
        while (v < 255 && (m += hist[l * 256 + v]!) * 2 < n) ++v;
        median[l] = v;
    }
    const out = new Float32Array(W * H).fill(1);
    for (let k = 0; k < W * H; ++k) {
        const l = lotOf[k]!;
        if (l >= 0) out[k] = Math.max(0, Math.min(1, (20 - Math.abs(lum(k) - median[l]!)) / 8));
    }
    return out;
}

/**
 * Push-pull hole filling: each texel's colour (RGB of `rgba`) counts with weight w in [0, 1]; texels
 * with little weight take the colour of the weighted average around them, from ever coarser levels.
 */
function pushPull(rgba: Uint8ClampedArray, w: Float32Array, W: number, H: number): Float32Array {
    const levels: { c: Float32Array; w: Float32Array; W: number; H: number }[] = [];
    const c0 = new Float32Array(W * H * 3);
    for (let k = 0; k < W * H; ++k) for (let c = 0; c < 3; ++c) c0[k * 3 + c] = rgba[k * 4 + c]!;
    levels.push({ c: c0, w, W, H });
    // Push: weighted averages down to a few texels.
    while (levels[levels.length - 1]!.W > 2 || levels[levels.length - 1]!.H > 2) {
        const L = levels[levels.length - 1]!;
        const nW = Math.max(1, Math.ceil(L.W / 2));
        const nH = Math.max(1, Math.ceil(L.H / 2));
        const c = new Float32Array(nW * nH * 3);
        const ww = new Float32Array(nW * nH);
        for (let y = 0; y < nH; ++y)
            for (let x = 0; x < nW; ++x) {
                let sw = 0;
                let r = 0;
                let g = 0;
                let b = 0;
                for (let v = 0; v < 2; ++v)
                    for (let u = 0; u < 2; ++u) {
                        const xx = Math.min(L.W - 1, x * 2 + u);
                        const yy = Math.min(L.H - 1, y * 2 + v);
                        const k = yy * L.W + xx;
                        const q = L.w[k]!;
                        sw += q;
                        r += L.c[k * 3]! * q;
                        g += L.c[k * 3 + 1]! * q;
                        b += L.c[k * 3 + 2]! * q;
                    }
                const k = y * nW + x;
                if (sw > 0) {
                    c[k * 3] = r / sw;
                    c[k * 3 + 1] = g / sw;
                    c[k * 3 + 2] = b / sw;
                }
                ww[k] = Math.min(1, sw);
            }
        levels.push({ c, w: ww, W: nW, H: nH });
    }
    // Pull: blend each level with the (bilinear) coarser one where its weight is low.
    for (let l = levels.length - 2; l >= 0; --l) {
        const L = levels[l]!;
        const C = levels[l + 1]!;
        for (let y = 0; y < L.H; ++y)
            for (let x = 0; x < L.W; ++x) {
                const k = y * L.W + x;
                const q = L.w[k]!;
                if (q >= 1) continue;
                const fx = Math.max(0, Math.min(C.W - 1, (x + 0.5) / 2 - 0.5));
                const fy = Math.max(0, Math.min(C.H - 1, (y + 0.5) / 2 - 0.5));
                const x0 = Math.floor(fx);
                const y0 = Math.floor(fy);
                const x1 = Math.min(C.W - 1, x0 + 1);
                const y1 = Math.min(C.H - 1, y0 + 1);
                const a = fx - x0;
                const b = fy - y0;
                for (let ch = 0; ch < 3; ++ch) {
                    const v =
                        (C.c[(y0 * C.W + x0) * 3 + ch]! * (1 - a) + C.c[(y0 * C.W + x1) * 3 + ch]! * a) * (1 - b) +
                        (C.c[(y1 * C.W + x0) * 3 + ch]! * (1 - a) + C.c[(y1 * C.W + x1) * 3 + ch]! * a) * b;
                    L.c[k * 3 + ch] = L.c[k * 3 + ch]! * q + v * (1 - q);
                }
            }
    }
    return levels[0]!.c;
}

/** Box blur of radius r texels along x (or y). */
function boxBlur(src: Float32Array, W: number, H: number, r: number, alongX: boolean): Float32Array {
    const out = new Float32Array(W * H);
    const n = alongX ? W : H;
    const m = alongX ? H : W;
    for (let j = 0; j < m; ++j) {
        let sum = 0;
        const at = (i: number) => src[alongX ? j * W + Math.max(0, Math.min(W - 1, i)) : Math.max(0, Math.min(H - 1, i)) * W + j]!;
        for (let i = -r; i <= r; ++i) sum += at(i);
        for (let i = 0; i < n; ++i) {
            out[alongX ? j * W + i : i * W + j] = sum / (2 * r + 1);
            sum += at(i + r + 1) - at(i - r);
        }
    }
    return out;
}
