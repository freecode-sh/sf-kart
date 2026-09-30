/**
 * The city's buildings (tools/sf/buildingsBake.ts: DataSF footprints split into lots, OSM in the
 * gaps, 2023 lidar heights and roofs, facade kind per edge, photo roof colours), merged into a few
 * meshes (one per ~600 m cell, so the camera's frustum drops the rest).
 *
 * One procedural facade / roof shader for everything (per-vertex style attributes):
 *   walls   by district and age: the Presidio's white Army clapboard, red-brick barracks around the
 *           Main Post and Spanish-colonial stucco under red tile roofs; the Marina's pastel stucco
 *           with windows per storey (real storey heights), garage doors and entries on street
 *           fronts, storefronts on commercial lots, blank party walls; concrete for the big halls.
 *           Stucco blotches, rain streaks, darker at the ground.
 *   detail  (geometry) cornices or Spanish tile strips along Marina street fronts, angled bay
 *           windows over the garages, parapets round flat roofs, hipped roofs along the long axis
 *           with an eave overhang.
 *   roofs   the aerial photo's colour, as tar and gravel (flat), clay tile or shingle (pitched).
 */

import * as THREE from 'three';
import { SCALE } from './geo';
import type { WorldJson } from './world';

// sRGB palettes.
// Walls stay off pure white: in the low sun a white box reads as a hole in the picture.
const MARINA = [
    0xe6dcc8, 0xe9e2d4, 0xe3d2a6, 0xd6c29c, 0xdcb898, 0xcfa184, 0xbfc9cc, 0xbdcab6, 0xcac6bd, 0xc6bcc6, 0xdfc3bb, 0xd0ab78, 0xddd6ca, 0xcbbfa8, 0xc9b79a, 0xb7c0b0,
];
const PRESIDIO_WOOD = [0xdfdbd0, 0xd9d3c5, 0xe2ddd2, 0xd4cdbd];
/** Fort Baker's cream and pale yellow clapboard (Marin). */
const FORT_BAKER = [0xe8dcc0, 0xeadfb8, 0xe2d6b8, 0xe6dcc6];
const PRESIDIO_STUCCO = [0xdccdb2, 0xd5c4a6, 0xe0d4be];
const BRICK = [0x7e4636, 0x8a5040, 0x744031, 0x8f5746];
const BIG = [0xbab4a9, 0xaaa69e, 0xc3b9a7, 0xa09c95, 0xbdaf99];
const TRIM = [0xe8e4db, 0xdfdacf, 0x6b6a66, 0x8a7b69, 0xeae6de];
/** Photo roof colour when the bake has none, per kind. */
const ROOF_DEFAULT = [0x8f4a34, 0x5b5754, 0x6d6a66];

/** Wall styles (fac.x). */
const S_WOOD = 0;
const S_STUCCO = 1;
const S_BIG = 2;
const S_BRICK = 3;
const S_MISSION = 4;
/** Surface kinds (fac.z). */
const SIDE = 0;
const FRONT = 1;
const PARTY = 2;
const BAY = 3;
const TILES = 4;
const ROOF_FLAT = 5;
const ROOF_PITCHED = 6;
const TRIM_KIND = -1;

/** Presidio Main Post (Montgomery Street barracks), meters east / north: brick country. */
const MAIN_POST = [1760, -1150, 380] as const;
/**
 * Marin (north of the strait, meters north): Fort Baker's clapboard, no brick; the small buildings
 * (restrooms, utility huts; no lidar heights here, so they come in at a storey default) low concrete.
 */
const MARIN_N = 1000;
const MARIN_SMALL = { area: 100, height: 4.5 } as const;
/**
 * The Palace of Fine Arts' Exhibition Hall behind the peristyle (meters east / north, radius; its big
 * lots are over HALL.area m²): a plain windowless shed in the Palace's warm stucco, so it sits quietly
 * behind the colonnade.
 */
const HALL = { e: 2510, n: -833, r: 60, area: 1000 } as const;
const HALL_WALL = 0xc9b597;
/** Zone code (fac2.w) of a blank wall: no windows or doors. */
const Z_BLANK = 4;
/** Cell size of the merged meshes (world units). */
const CELL = 600 * SCALE;

function hash(n: number): number {
    let h = Math.imul(n | 0, 2654435761);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const col = new THREE.Color();
const rgb = (hex: number, f = 1): number[] => {
    col.setHex(hex);
    return [col.r * f, col.g * f, col.b * f];
};
const pick = (list: number[], r: number) => list[Math.min(list.length - 1, Math.floor(r * list.length))]!;

/**
 * A roof colour from the aerial photo, evened out: NOAA flew in February, so roofs in shadow come out
 * dark blue and white membranes blown out; pull both towards a plausible, less saturated middle.
 */
function roofTone(hex: number, keepRed: boolean): number[] {
    let r = ((hex >> 16) & 255) / 255;
    let g = ((hex >> 8) & 255) / 255;
    let b = (hex & 255) / 255;
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    // Blue / magenta casts (shadows, the February light) lose most of their colour.
    const sat = keepRed ? 0.85 : b > r || b > g ? 0.25 : 0.6;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    const k = Math.max(0.22, Math.min(0.68, l)) / Math.max(0.01, l);
    col.setRGB(Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k), THREE.SRGBColorSpace);
    return [col.r * 0.9, col.g * 0.9, col.b * 0.9];
}

/** Per-vertex attributes of the merged geometry (non-indexed triangles). */
class Builder {
    pos: number[] = [];
    uv: number[] = [];
    color: number[] = [];
    fac: number[] = [];
    fac2: number[] = [];
    private push(p: number[], uv: number[], color: number[], fac: number[], fac2: number[]): void {
        this.pos.push(p[0]!, p[1]!, p[2]!);
        this.uv.push(uv[0]!, uv[1]!);
        this.color.push(color[0]!, color[1]!, color[2]!);
        this.fac.push(fac[0]!, fac[1]!, fac[2]!, fac[3]!);
        this.fac2.push(fac2[0]!, fac2[1]!, fac2[2]!, fac2[3]!);
    }
    /** A vertical quad (ax, az) → (bx, bz), world y y0..y1; u meters along from u0, v meters above vBase. */
    wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, vBase: number, color: number[], fac: number[], fac2: number[]): void {
        const len = Math.hypot(bx - ax, bz - az) / SCALE;
        const v0 = (y0 - vBase) / SCALE;
        const v1 = (y1 - vBase) / SCALE;
        const P = [
            [ax, y0, az],
            [bx, y0, bz],
            [bx, y1, bz],
            [ax, y1, az],
        ];
        const U = [
            [u0, v0],
            [u0 + len, v0],
            [u0 + len, v1],
            [u0, v1],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) this.push(P[i]!, U[i]!, color, fac, fac2);
    }
    /** A quad from 4 corners (any orientation) with optional uvs (meters). */
    quad(p: number[][], uv: number[][] | null, color: number[], fac: number[], fac2: number[] = [0, 0, 0, 0]): void {
        for (const i of [0, 1, 2, 0, 2, 3]) this.push(p[i]!, uv ? uv[i]! : [0, 0], color, fac, fac2);
    }
    tri(a: number[], b: number[], c: number[], uv: number[][] | null, color: number[], fac: number[], fac2: number[] = [0, 0, 0, 0]): void {
        this.push(a, uv ? uv[0]! : [0, 0], color, fac, fac2);
        this.push(b, uv ? uv[1]! : [0, 0], color, fac, fac2);
        this.push(c, uv ? uv[2]! : [0, 0], color, fac, fac2);
    }
    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        g.setAttribute('fac', new THREE.Float32BufferAttribute(this.fac, 4));
        g.setAttribute('fac2', new THREE.Float32BufferAttribute(this.fac2, 4));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
    }
}

/** RGBA tileable value-noise fbm (linear data): R, G smooth at two scales, B medium, A fine grain. */
function noiseTexture(): THREE.DataTexture {
    const N = 256;
    let seed = 7;
    const rnd = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
    };
    const fbm = (base: number, octaves: number): Float32Array => {
        const out = new Float32Array(N * N);
        let amp = 1;
        let total = 0;
        for (let o = 0; o < octaves; ++o) {
            const g = base << o;
            const lat = Float32Array.from({ length: g * g }, rnd);
            for (let y = 0; y < N; ++y) {
                const fy = (y / N) * g;
                const iy = Math.floor(fy);
                const ty = fy - iy;
                const sy = ty * ty * (3 - 2 * ty);
                for (let x = 0; x < N; ++x) {
                    const fx = (x / N) * g;
                    const ix = Math.floor(fx);
                    const tx = fx - ix;
                    const sx = tx * tx * (3 - 2 * tx);
                    const l = (i: number, j: number) => lat[(j % g) * g + (i % g)]!;
                    const a = l(ix, iy) + (l(ix + 1, iy) - l(ix, iy)) * sx;
                    const b = l(ix, iy + 1) + (l(ix + 1, iy + 1) - l(ix, iy + 1)) * sx;
                    out[y * N + x] = out[y * N + x]! + (a + (b - a) * sy) * amp;
                }
            }
            total += amp;
            amp *= 0.5;
        }
        for (let i = 0; i < out.length; ++i) out[i] = out[i]! / total;
        return out;
    };
    const ch = [fbm(4, 5), fbm(8, 4), fbm(24, 3), fbm(64, 2)];
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; ++i) for (let c = 0; c < 4; ++c) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(((ch[c]![i]! - 0.2) / 0.6) * 255)));
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
}

/** The facade / roof shader: a standard material patched to draw from the per-vertex style. */
function facadeMaterial(noise: THREE.Texture): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
        s.uniforms.noiseMap = { value: noise };
        s.vertexShader = s.vertexShader
            .replace(
                '#include <common>',
                `#include <common>
                attribute vec4 fac;
                attribute vec4 fac2;
                varying vec4 vFac;
                varying vec4 vFac2;
                varying vec2 vFuv;`,
            )
            .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = fac; vFac2 = fac2; vFuv = uv;');
        s.fragmentShader = s.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
                uniform sampler2D noiseMap;
                varying vec4 vFac;
                varying vec4 vFac2;
                varying vec2 vFuv;
                float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                // Anti-aliased box: 1 inside [a, b].
                float box(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
                float glassMask;
                float roughMod;`,
            )
            .replace(
                '#include <color_fragment>',
                `#include <color_fragment>
                {
                    float style = vFac.x;         // 0 clapboard, 1 Marina stucco, 2 big, 3 brick, 4 mission stucco
                    float seed = vFac.y;
                    float kind = vFac.z;          // 0 side, 1 front, 2 party, 3 bay, 4 tile strip, 5 flat roof, 6 pitched roof, -1 trim
                    float bays = vFac.w;          // walls: bay windows on this front; pitched roofs: 1 clay tile
                    float len = vFac2.x;          // facade length (m)
                    float gh = vFac2.y;           // ground floor height (m)
                    float eave = vFac2.z;         // wall top (m above the base)
                    float zone = vFac2.w;         // 0 house, 1 apartments, 2 shops, 3 other, 4 blank (the Exhibition Hall)
                    float u = vFuv.x;
                    float v = vFuv.y;
                    float wv = max(fwidth(v), 0.004);
                    float wu = max(fwidth(u), 0.004);
                    float lod = clamp(max(wu, wv) * 5.0 - 0.1, 0.0, 1.0);   // 1: too small for details
                    glassMask = 0.0;
                    roughMod = 1.0;
                    float frameMask = 0.0;
                    vec3 wall = diffuseColor.rgb;
                    vec3 col = wall;
                    float shade = 1.0;
                    vec2 np = vec2(u, v);
                    float st = texture2D(noiseMap, np * 0.11 + seed).r * 0.55 + texture2D(noiseMap, np * 0.23).b * 0.45;
                    if (kind > 4.5) {
                        // Roofs: the photo's colour as a material.
                        float grain = texture2D(noiseMap, np * 0.9 + seed).a;
                        if (kind < 5.5) {
                            // Tar and gravel, patched; darker streaks towards the drains.
                            col *= 0.78 + 0.3 * st + 0.14 * (grain - 0.5);
                            roughMod = 1.05;
                        } else if (bays > 0.5) {
                            // Clay barrel tile: ridges down the slope, courses across.
                            float ridge = abs(fract(u / 0.26) - 0.5) * 2.0;
                            float tile = (0.78 + 0.3 * (1.0 - ridge * ridge)) * (1.0 - 0.28 * box(fract(v / 0.36), 0.0, 0.1, wv / 0.36));
                            col *= mix(tile, 0.9, lod) * (0.85 + 0.3 * st);
                            roughMod = 0.8;
                        } else {
                            // Composition shingle: courses with staggered tab joints.
                            float row = floor(v / 0.2);
                            float lines = 1.0 - 0.22 * box(fract(v / 0.2), 0.0, 0.14, wv / 0.2);
                            lines *= 1.0 - 0.14 * box(fract(u / 0.9 + row * 0.5), 0.0, 0.035, wu / 0.9);
                            col *= mix(lines, 0.9, lod) * (0.82 + 0.3 * st + 0.1 * (grain - 0.5));
                        }
                    } else if (kind > -0.5) {
                        bool presidio = style < 0.5 || style > 2.5;
                        // Plaster / paint: blotches, rain streaks, darker near the ground.
                        float streak = texture2D(noiseMap, vec2(u * 0.9, v * 0.05) + seed).g;
                        wall *= 0.88 + 0.18 * st - 0.08 * smoothstep(0.55, 0.8, streak);
                        if (style > 2.5 && style < 3.5) {
                            // Brick: per-brick tone, mortar courses (fading out with distance).
                            float course = floor(v / 0.075);
                            float bk = hsh(vec2(floor(u / 0.21 + course * 0.5), course));
                            wall *= mix(0.9 + 0.2 * bk, 1.0, lod);
                            float mortar = max(box(fract(v / 0.075), 0.0, 0.14, wv / 0.075), box(fract(u / 0.21 + course * 0.5), 0.0, 0.05, wu / 0.21));
                            wall = mix(wall, vec3(0.55, 0.52, 0.47), mortar * 0.55 * (1.0 - smoothstep(0.02, 0.05, max(wu, wv))));
                        }
                        wall *= mix(0.66, 1.0, smoothstep(0.0, 1.3, v));
                        col = wall;
                        float hs3 = hsh(vec2(seed, 3.0));
                        vec3 trim = presidio ? (style > 3.5 ? vec3(0.42, 0.26, 0.16) : vec3(0.93, 0.92, 0.89))
                                             : (hs3 < 0.7 ? vec3(0.9, 0.89, 0.86) : (hs3 < 0.85 ? wall * 0.72 : vec3(0.36, 0.38, 0.4)));
                        float fh = style > 2.5 && style < 3.5 ? 3.7 : (presidio ? 3.4 : 3.1);
                        float fl = v < gh ? 0.0 : 1.0 + floor((v - gh) / fh);
                        float fv = v < gh ? v : mod(v - gh, fh);  // height within the storey
                        if (zone > 3.5) {
                            // Blank: tall panels, a band under the parapet.
                            col *= 1.0 - 0.1 * box(mod(u, 6.5), 0.0, 0.14, wu) * (1.0 - lod);
                            col *= 1.0 - 0.12 * box(v, eave - 1.6, eave - 1.3, wv);
                        } else if (kind < 1.5 || kind > 2.5) {
                            // Windows in columns, one per storey.
                            float spacing = kind > 2.5 ? max(0.9, len / max(1.0, floor(len / 1.3 + 0.5)))
                                : style > 1.5 && style < 2.5 ? 2.3 : presidio ? 2.5 + hsh(vec2(seed, 7.0)) * 0.5 : 1.9 + hsh(vec2(seed, 7.0)) * 0.6;
                            if (kind < 0.5) spacing *= 1.8;
                            float cols = max(1.0, floor(len / spacing));
                            float cw = len / cols;
                            float ci = floor(u / cw);
                            float cu = mod(u, cw) - cw * 0.5;
                            float ww = kind > 2.5 ? cw * 0.78 : min(cw * 0.6, presidio ? 1.05 : 1.4);
                            float wh = style > 2.5 && style < 3.5 ? 2.0 : style > 1.5 && style < 2.5 ? 1.9 : 1.65;
                            float sill = 0.8;
                            float upper = step(0.5, fl) * step(v, eave - 0.9);
                            float blank = kind < 0.5 ? step(0.5, hsh(vec2(ci, seed))) : 0.0;
                            float on = upper * (1.0 - blank);
                            float win = box(cu, -ww * 0.5, ww * 0.5, wu) * box(fv, sill, sill + wh, wv) * on;
                            float fr = box(cu, -ww * 0.5 - 0.1, ww * 0.5 + 0.1, wu) * box(fv, sill - 0.05, sill + wh + 0.1, wv) * on;
                            // Sill (and on brick, a stone lintel): a lighter ledge, a shadow line under it.
                            float sillL = box(cu, -ww * 0.5 - 0.16, ww * 0.5 + 0.16, wu) * box(fv, sill - 0.14, sill - 0.04, wv) * on;
                            if (style > 2.5 && style < 3.5) sillL = max(sillL, box(cu, -ww * 0.5 - 0.2, ww * 0.5 + 0.2, wu) * box(fv, sill + wh + 0.1, sill + wh + 0.32, wv) * on);
                            shade *= 1.0 - 0.35 * box(cu, -ww * 0.5 - 0.16, ww * 0.5 + 0.16, wu) * box(fv, sill - 0.24, sill - 0.14, wv) * on;
                            // Double-hung sashes, and the reveal's shadow inside the frame.
                            float mull = (box(cu, -0.03, 0.03, wu) * step(1.0, ww) + box(fv, sill + wh * 0.55, sill + wh * 0.55 + 0.06, wv)) * win;
                            float reveal = win * (box(fv, sill + wh - 0.16, sill + wh, wv) + box(cu, ww * 0.5 - 0.1, ww * 0.5, wu));
                            glassMask = win * (1.0 - clamp(mull, 0.0, 1.0));
                            frameMask = clamp(fr - win + mull + sillL, 0.0, 1.0);
                            shade *= 1.0 - 0.45 * reveal;
                            if (kind > 0.5 && kind < 1.5 && fl < 0.5) {
                                if (zone > 1.5 && zone < 2.5 && !presidio) {
                                    // Storefront: big glass in bays under a sign band.
                                    float bu = mod(u, 5.2);
                                    float sf = box(fv, 0.45, gh - 0.75, wv) * box(bu, 0.25, 4.95, wu);
                                    float mul = box(bu, 2.55, 2.65, wu) * sf;
                                    glassMask = max(glassMask, sf - mul);
                                    frameMask = max(frameMask, box(fv, 0.3, gh - 0.62, wv) * box(bu, 0.12, 5.08, wu) - sf + mul);
                                    float sign = box(fv, gh - 0.62, gh - 0.12, wv);
                                    vec3 sc = vec3(0.12, 0.13, 0.14) + hsh(vec2(floor(u / 5.2), seed)) * vec3(0.45, 0.12, 0.05);
                                    col = mix(col, sc, sign);
                                    shade *= 1.0 - 0.4 * box(fv, gh - 0.12, gh - 0.02, wv);
                                } else if (!presidio) {
                                    // Garage doors under the bays, entry doors beside.
                                    float nb = max(1.0, bays);
                                    float slot = len / nb;
                                    float gu = mod(u, slot) - slot * 0.5;
                                    float gw = min(2.7, slot * 0.5);
                                    float garage = box(gu, -gw * 0.5, gw * 0.5, wu) * box(fv, 0.0, 2.25, wv) * step(3.2, len);
                                    float door = box(gu, gw * 0.5 + 0.45, gw * 0.5 + 1.4, wu) * box(fv, 0.0, 2.35, wv) * step(4.6, slot);
                                    float hg = hsh(vec2(seed, 11.0));
                                    vec3 gcol = hg < 0.35 ? vec3(0.35, 0.33, 0.3) : (hg < 0.7 ? vec3(0.86, 0.85, 0.82) : vec3(0.45, 0.3, 0.2));
                                    float pl = 1.0 - 0.3 * box(mod(fv, 0.56), 0.0, 0.04, wv);
                                    col = mix(col, gcol * pl, garage);
                                    col = mix(col, vec3(0.24, 0.16, 0.1), door);
                                    frameMask = max(frameMask, box(gu, -gw * 0.5 - 0.12, gw * 0.5 + 0.12, wu) * box(fv, 0.0, 2.4, wv) - garage);
                                    shade *= 1.0 - 0.5 * garage * box(fv, 2.05, 2.25, wv);
                                    glassMask *= 1.0 - garage;
                                    glassMask = max(glassMask, box(gu, gw * 0.5 + 0.55, gw * 0.5 + 1.3, wu) * box(fv, 2.45, 2.75, wv) * step(4.6, slot));
                                } else {
                                    // Presidio: ground floor windows too, a door in the middle bay.
                                    float blank0 = step(0.75, hsh(vec2(ci, seed + 5.0)));
                                    float gwin = box(cu, -ww * 0.5, ww * 0.5, wu) * box(fv, 0.9, 0.9 + wh, wv) * (1.0 - blank0);
                                    float door = box(u - len * 0.5, -0.55, 0.55, wu) * box(fv, 0.0, 2.3, wv) * step(5.0, len);
                                    glassMask = max(glassMask, gwin * (1.0 - door));
                                    frameMask = max(frameMask, box(cu, -ww * 0.5 - 0.1, ww * 0.5 + 0.1, wu) * box(fv, 0.8, 1.0 + wh, wv) * (1.0 - blank0) - gwin);
                                    col = mix(col, vec3(0.2, 0.17, 0.14), door);
                                }
                            } else if (fl < 0.5 && kind < 0.5) {
                                glassMask = 0.0;
                                frameMask = 0.0;
                            }
                            if (style < 0.5) {
                                // Clapboard siding: a shadow line under every board.
                                col *= 1.0 - 0.12 * box(mod(v, 0.2), 0.0, 0.035, wv) * (1.0 - lod);
                            }
                            if (presidio) {
                                // Concrete foundation course.
                                col = mix(col, vec3(0.5, 0.49, 0.46) * (0.85 + 0.2 * st), box(v, -2.0, 0.55, wv) * (1.0 - glassMask));
                            }
                        }
                        // Glass: dark, with a hint of curtains / blinds in some panes.
                        float pane = hsh(vec2(floor(u / 0.9), floor(v / 3.1) + seed));
                        vec3 glass = vec3(0.035, 0.04, 0.045) + step(0.6, pane) * vec3(0.18, 0.16, 0.13) * box(fv, 1.5, 2.6, wv);
                        col = mix(col, glass, glassMask);
                        col = mix(col, trim, frameMask);
                        col *= shade;
                        // Far away: towards the pattern's average (no shimmering).
                        col = mix(col, mix(wall, vec3(0.1), 0.22), lod * 0.5 * step(kind, 3.5) * step(zone, 3.5));
                        glassMask *= 1.0 - lod;
                        if (kind > 3.5) {
                            // Spanish tile strip along a Marina front.
                            float ridge = abs(fract(u / 0.24) - 0.5) * 2.0;
                            col = vec3(0.55, 0.22, 0.13) * (0.75 + 0.35 * (1.0 - ridge * ridge)) * (0.85 + 0.3 * st);
                            col *= 1.0 - 0.3 * box(fract(v / 0.34), 0.0, 0.12, wv / 0.34);
                            glassMask = 0.0;
                        }
                    }
                    diffuseColor.rgb = col;
                }`,
            )
            .replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor * roughMod, 0.05, glassMask);`,
            )
            .replace(
                '#include <lights_fragment_maps>',
                `#include <lights_fragment_maps>
                {
                    // Windows at street level mostly reflect the street and the buildings opposite, not
                    // the open sky: darken reflections that point at the horizon or below.
                    vec3 rv = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
                    radiance *= mix(1.0, mix(0.22, 1.0, smoothstep(0.02, 0.45, rv.y)), glassMask);
                }`,
            );
    };
    mat.customProgramCacheKey = () => 'sfFacade';
    return mat;
}

type XZ = [number, number];

/** Ring moved inwards by d (world units) along the vertex bisectors (fine for the small insets here). */
function insetRing(pts: XZ[], d: number): XZ[] {
    const n = pts.length;
    let area = 0;
    for (let k = 0; k < n; ++k) area += pts[k]![0] * pts[(k + 1) % n]![1] - pts[(k + 1) % n]![0] * pts[k]![1];
    const s = area > 0 ? 1 : -1;
    const out: XZ[] = [];
    for (let k = 0; k < n; ++k) {
        const p = pts[(k + n - 1) % n]!;
        const a = pts[k]!;
        const q = pts[(k + 1) % n]!;
        const n1 = norm(-(a[1] - p[1]) * s, (a[0] - p[0]) * s);
        const n2 = norm(-(q[1] - a[1]) * s, (q[0] - a[0]) * s);
        let bx = n1[0] + n2[0];
        let bz = n1[1] + n2[1];
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl;
        bz /= bl;
        const cos = Math.max(0.35, bx * n1[0] + bz * n1[1]);
        out.push([a[0] + (bx * d) / cos, a[1] + (bz * d) / cos]);
    }
    return out;
}

function norm(x: number, z: number): XZ {
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
}

/** Ridge (ax, az, bx, bz) of a hipped roof along the footprint's long axis, and the half width. */
function ridgeOf(pts: XZ[]): { r: [number, number, number, number]; half: number } {
    let best = 0;
    let ang = 0;
    for (let k = 0; k < pts.length; ++k) {
        const a = pts[k]!;
        const q = pts[(k + 1) % pts.length]!;
        const l = Math.hypot(q[0] - a[0], q[1] - a[1]);
        if (l > best) {
            best = l;
            ang = Math.atan2(q[1] - a[1], q[0] - a[0]);
        }
    }
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
        const u = p[0] * ux + p[1] * uz;
        const v = -p[0] * uz + p[1] * ux;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
    }
    const P = (u: number, v: number): XZ => [u * ux - v * uz, u * uz + v * ux];
    if (u1 - u0 >= v1 - v0) {
        const half = (v1 - v0) / 2;
        let a0 = u0 + half;
        let a1 = u1 - half;
        if (a1 < a0) a0 = a1 = (u0 + u1) / 2;
        const vm = (v0 + v1) / 2;
        return { r: [...P(a0, vm), ...P(a1, vm)], half };
    }
    const half = (u1 - u0) / 2;
    let b0 = v0 + half;
    let b1 = v1 - half;
    if (b1 < b0) b0 = b1 = (v0 + v1) / 2;
    const um = (u0 + u1) / 2;
    return { r: [...P(um, b0), ...P(um, b1)], half };
}

export interface BuildingMeshes {
    group: THREE.Group;
    dispose(): void;
}

/**
 * Footprints drawn twice or more: the bake splits a footprint by the parcels, and condo parcels (and
 * the Palace's) overlap, so one building can come out as a stack of the same lot. Of each stack (same
 * area within 6 %, bounding boxes within 5 % of their size) only the largest is drawn, the last of
 * equals (the one on top so far).
 */
function stacked(B: WorldJson['buildings']): Uint8Array {
    const N = B.n.length;
    const box = new Float64Array(N * 4);
    const area = new Float64Array(N);
    const grid = new Map<string, number[]>();
    const G = 30 * SCALE;
    let off = 0;
    for (let b = 0; b < N; ++b) {
        const n = B.n[b]!;
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        let a = 0;
        for (let k = 0; k < n; ++k) {
            const x = B.pts[(off + k) * 2]!;
            const z = B.pts[(off + k) * 2 + 1]!;
            const k1 = off + ((k + 1) % n);
            a += x * B.pts[k1 * 2 + 1]! - B.pts[k1 * 2]! * z;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            z0 = Math.min(z0, z);
            z1 = Math.max(z1, z);
        }
        off += n;
        box.set([x0, x1, z0, z1], b * 4);
        area[b] = Math.abs(a) / 2;
        const key = `${Math.floor((x0 + x1) / 2 / G)},${Math.floor((z0 + z1) / 2 / G)}`;
        grid.get(key)?.push(b) ?? grid.set(key, [b]);
    }
    const skip = new Uint8Array(N);
    for (let b = 0; b < N; ++b) {
        const gx = Math.floor((box[b * 4]! + box[b * 4 + 1]!) / 2 / G);
        const gz = Math.floor((box[b * 4 + 2]! + box[b * 4 + 3]!) / 2 / G);
        const tol = 0.05 * Math.hypot(box[b * 4 + 1]! - box[b * 4]!, box[b * 4 + 3]! - box[b * 4 + 2]!);
        for (let i = -1; i <= 1 && !skip[b]; ++i)
            for (let j = -1; j <= 1 && !skip[b]; ++j)
                for (const o of grid.get(`${gx + i},${gz + j}`) ?? []) {
                    if (o === b || Math.abs(area[o]! - area[b]!) > 0.06 * Math.max(area[o]!, area[b]!)) continue;
                    let near = true;
                    for (let c = 0; c < 4; ++c) near &&= Math.abs(box[o * 4 + c]! - box[b * 4 + c]!) <= tol;
                    if (near && (area[o]! > area[b]! || (area[o] === area[b] && o > b))) {
                        skip[b] = 1;
                        break;
                    }
                }
    }
    return skip;
}

export function buildBuildings(world: WorldJson): BuildingMeshes {
    const B = world.buildings;
    const cells = new Map<string, Builder>();
    const skip = stacked(B);
    let off = 0;
    for (let b = 0; b < B.n.length; ++b) {
        const n = B.n[b]!;
        let pts: XZ[] = [];
        for (let k = 0; k < n; ++k) pts.push([B.pts[(off + k) * 2]!, B.pts[(off + k) * 2 + 1]!]);
        off += n;
        if (skip[b]) continue;
        let edges = (B.edges?.[b] ?? '').split('').map(Number);
        if (edges.length !== n) edges = new Array<number>(n).fill(SIDE);
        // Walls face out when the ring is counterclockwise seen from above (negative area in x, z).
        let area = 0;
        for (let k = 0; k < n; ++k) area += pts[k]![0] * pts[(k + 1) % n]![1] - pts[(k + 1) % n]![0] * pts[k]![1];
        if (area > 0) {
            pts = pts.reverse();
            // Reversed, edge k runs from old vertex n-1-k to n-2-k: the old edge n-2-k.
            edges = edges.map((_, k) => edges[(2 * n - 2 - k) % n]!);
            area = -area;
        }
        const areaM = Math.abs(area) / 2 / (SCALE * SCALE);
        let cx = 0;
        let cz = 0;
        for (const p of pts) {
            cx += p[0] / n;
            cz += p[1] / n;
        }
        const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
        let wb = cells.get(key);
        if (!wb) cells.set(key, (wb = new Builder()));

        // ---- style ----
        const hall = areaM > HALL.area && Math.hypot(cx / SCALE - HALL.e, -cz / SCALE - HALL.n) < HALL.r;
        const kind = hall ? 2 : B.kind[b]!;
        const zone = hall ? Z_BLANK : (B.zone?.[b] ?? 3);
        const r = hash(b * 7 + 1);
        const r2 = hash(b * 13 + 5);
        const seed = hall ? 0 : r * 97;
        const base = B.base[b]!;
        const vBase = base;
        const marin = -cz / SCALE > MARIN_N;
        const marinSmall = marin && kind === 0 && areaM < MARIN_SMALL.area;
        const h = marinSmall ? Math.min(B.h[b]!, MARIN_SMALL.height * SCALE) : B.h[b]!;
        const eave = base + h;
        const eaveM = h / SCALE;
        const rise = B.roof[b]!;
        const pitched = rise > 0;
        const photo = B.roofColor?.[b] ?? -1;
        const roofHex = photo >= 0 ? photo : pitched ? ROOF_DEFAULT[kind]! : 0x55524e;
        col.setHex(roofHex);
        // Clay tile: red-orange (not magenta) in the photo.
        const clayTile = pitched && ((col.r - Math.max(col.g, col.b) > 0.07 && col.g >= col.b * 0.95) || (photo < 0 && kind === 0));
        let style: number;
        if (kind === 2) style = S_BIG;
        else if (kind === 1) style = S_STUCCO;
        else {
            const mainPost = Math.hypot(cx / SCALE - MAIN_POST[0], -cz / SCALE - MAIN_POST[1]) < MAIN_POST[2];
            // Main Post: the brick barracks round the parade ground, whatever their roofs.
            if (mainPost && areaM > 250) style = r2 < 0.75 ? S_BRICK : S_WOOD;
            else if (clayTile) style = r2 < 0.7 ? S_MISSION : S_WOOD;
            else if (mainPost) style = r2 < 0.5 ? S_BRICK : S_WOOD;
            else style = r2 < 0.62 ? S_WOOD : r2 < 0.8 ? S_BRICK : S_MISSION;
            // Clapboard is for houses and barracks; the big blocks (the old hospital, the
            // apartments) are stucco or brick.
            if (style === S_WOOD && eaveM > 10) style = r2 < 0.3 ? S_BRICK : S_MISSION;
            if (marin) style = marinSmall ? S_BIG : style === S_MISSION || eaveM > 10 ? S_MISSION : S_WOOD;
        }
        const woodPalette = marin ? FORT_BAKER : PRESIDIO_WOOD;
        const wall =
            hall ? rgb(HALL_WALL) : style === S_BIG ? rgb(pick(BIG, r)) : style === S_BRICK ? rgb(pick(BRICK, r)) : style === S_WOOD ? rgb(pick(woodPalette, r)) : style === S_MISSION ? rgb(pick(PRESIDIO_STUCCO, r)) : rgb(pick(MARINA, r));
        const gh = style === S_STUCCO ? (zone === 2 ? 3.8 : 3.1) : 3.3;
        const flat = !pitched;
        const parapet = flat ? (style === S_BIG ? 0.9 : 0.45 + r2 * 0.6) * SCALE : 0;
        const top = eave + parapet;
        const marinaFront = style === S_STUCCO && flat && zone !== 2;
        const tiles = marinaFront && r2 > 0.45;
        const trimCol = rgb(pick(TRIM, r2), 0.95);

        // ---- walls, cornices, bays ----
        for (let k = 0; k < n; ++k) {
            const a = pts[k]!;
            const q = pts[(k + 1) % n]!;
            const len = Math.hypot(q[0] - a[0], q[1] - a[1]) / SCALE;
            if (len < 0.05) continue;
            const ek = edges[k]!;
            const wantBays = ek === FRONT && style === S_STUCCO && zone !== 2 && eaveM > 6 && len > 4.2;
            const nb = wantBays ? Math.max(1, Math.min(4, Math.floor(len / 6.2))) : 0;
            const fac = [style, seed, ek, nb];
            const fac2 = [len, gh, (top - vBase) / SCALE, zone];
            wb.wall(a[0], a[1], q[0], q[1], base - 60, top, 0, vBase, wall, fac, fac2);
            const dx = (q[0] - a[0]) / (len * SCALE);
            const dz = (q[1] - a[1]) / (len * SCALE);
            // Outward normal of a counterclockwise (seen from above) ring in x, z.
            const ox = -dz;
            const oz = dx;
            if (ek === FRONT && len > 1.5 && marinaFront) {
                // Cornice or Spanish tile strip along the top, a little past the corners.
                const ext = 0.12 * SCALE;
                const ax = a[0] - dx * ext;
                const az = a[1] - dz * ext;
                const qx = q[0] + dx * ext;
                const qz = q[1] + dz * ext;
                if (tiles) {
                    const out = 0.62 * SCALE;
                    const y0 = top + 0.18 * SCALE;
                    const y1 = top - 0.28 * SCALE;
                    const slope = Math.hypot(out, y0 - y1) / SCALE;
                    wb.quad(
                        [
                            [ax, y0, az],
                            [qx, y0, qz],
                            [qx + ox * out, y1, qz + oz * out],
                            [ax + ox * out, y1, az + oz * out],
                        ],
                        [
                            [0, slope],
                            [len + 0.24, slope],
                            [len + 0.24, 0],
                            [0, 0],
                        ],
                        rgb(0xffffff),
                        [style, seed, TILES, 0],
                    );
                    wb.quad(
                        [
                            [ax + ox * out, y1, az + oz * out],
                            [qx + ox * out, y1, qz + oz * out],
                            [qx, y1 - 0.05 * SCALE, qz],
                            [ax, y1 - 0.05 * SCALE, az],
                        ],
                        null,
                        trimCol.map((c) => c * 0.8),
                        [0, 0, TRIM_KIND, 0],
                    );
                } else {
                    const out = 0.28 * SCALE;
                    const y0 = top - 0.42 * SCALE;
                    const y1 = top + 0.04 * SCALE;
                    const tc = hash(b * 31 + 5) < 0.6 ? rgb(0xece7dc) : wall.map((c) => c * 0.92);
                    wb.quad([[ax, y0, az], [qx, y0, qz], [qx + ox * out, y0, qz + oz * out], [ax + ox * out, y0, az + oz * out]], null, tc.map((c) => c * 0.75), [0, 0, TRIM_KIND, 0]);
                    wb.quad([[ax + ox * out, y0, az + oz * out], [qx + ox * out, y0, qz + oz * out], [qx + ox * out, y1, qz + oz * out], [ax + ox * out, y1, az + oz * out]], null, tc, [0, 0, TRIM_KIND, 0]);
                    wb.quad([[ax + ox * out, y1, az + oz * out], [qx + ox * out, y1, qz + oz * out], [qx, y1, qz], [ax, y1, az]], null, tc, [0, 0, TRIM_KIND, 0]);
                }
            }
            if (nb) {
                // Angled bay windows from the ground floor's ceiling to under the cornice.
                const W = Math.min(3.2, (len / nb) * 0.62) * SCALE;
                const F = W * 0.58;
                const D = 0.75 * SCALE;
                const y0 = vBase + gh * SCALE;
                const y1 = eave - 0.45 * SCALE;
                if (y1 - y0 < 2 * SCALE) continue;
                for (let j = 0; j < nb; ++j) {
                    const t = ((j + 0.5) / nb) * len * SCALE;
                    const px = a[0] + dx * t;
                    const pz = a[1] + dz * t;
                    const wl = [px - (dx * W) / 2, pz - (dz * W) / 2];
                    const wr = [px + (dx * W) / 2, pz + (dz * W) / 2];
                    const fl = [px - (dx * F) / 2 + ox * D, pz - (dz * F) / 2 + oz * D];
                    const fr = [px + (dx * F) / 2 + ox * D, pz + (dz * F) / 2 + oz * D];
                    const side = Math.hypot(fl[0]! - wl[0]!, fl[1]! - wl[1]!) / SCALE;
                    const bf2 = [side, gh, (y1 - vBase) / SCALE + 0.3, zone];
                    wb.wall(wl[0]!, wl[1]!, fl[0]!, fl[1]!, y0, y1, 0, vBase, wall, [style, seed, BAY, 0], bf2);
                    wb.wall(fl[0]!, fl[1]!, fr[0]!, fr[1]!, y0, y1, 0, vBase, wall, [style, seed, BAY, 0], [F / SCALE, gh, (y1 - vBase) / SCALE + 0.3, zone]);
                    wb.wall(fr[0]!, fr[1]!, wr[0]!, wr[1]!, y0, y1, 0, vBase, wall, [style, seed, BAY, 0], bf2);
                    const tc = rgb(0xeeeae2);
                    for (const yy of [y1, y0]) {
                        const A = [wl[0]!, yy, wl[1]!];
                        const Bq = [fl[0]!, yy, fl[1]!];
                        const C = [fr[0]!, yy, fr[1]!];
                        const Dd = [wr[0]!, yy, wr[1]!];
                        wb.tri(A, C, Bq, null, tc, [0, 0, TRIM_KIND, 0]);
                        wb.tri(A, Dd, C, null, tc, [0, 0, TRIM_KIND, 0]);
                    }
                }
            }
        }

        // ---- roof ----
        const roofCol = roofTone(roofHex, clayTile);
        if (flat) {
            // Parapet: inner faces and caps; the roof sunk behind it.
            const inset = 0.22 * SCALE;
            const inner = insetRing(pts, inset);
            const capCol = style === S_BIG ? wall.map((c) => c * 0.9) : trimCol;
            for (let k = 0; k < n; ++k) {
                const a = inner[k]!;
                const q = inner[(k + 1) % n]!;
                const len = Math.hypot(q[0] - a[0], q[1] - a[1]) / SCALE;
                // Party walls: the neighbour's roof or wall hides it.
                if (edges[k] === PARTY) continue;
                wb.wall(q[0], q[1], a[0], a[1], eave, top, 0, eave, wall.map((c) => c * 0.85), [style, 0, TRIM_KIND, 0], [len, 0, 0, 0]);
                const A = [pts[k]![0], top, pts[k]![1]];
                const Bq = [pts[(k + 1) % n]![0], top, pts[(k + 1) % n]![1]];
                const C = [q[0], top, q[1]];
                const D = [a[0], top, a[1]];
                wb.tri(A, C, Bq, null, capCol, [0, 0, TRIM_KIND, 0]);
                wb.tri(A, D, C, null, capCol, [0, 0, TRIM_KIND, 0]);
            }
            const contour = inner.map((p) => new THREE.Vector2(p[0], p[1]));
            const y = eave + 4;
            for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
                const P = [t[0]!, t[2]!, t[1]!].map((k) => [inner[k]![0], y, inner[k]![1]]);
                wb.tri(P[0]!, P[1]!, P[2]!, P.map((p) => [p[0]! / SCALE, p[2]! / SCALE]), roofCol, [style, seed, ROOF_FLAT, 0]);
            }
        } else {
            // Hipped along the long axis, with an eave overhang.
            const { r: ridge, half } = ridgeOf(pts);
            const rh = Math.min(rise, half * 0.9);
            const over = 0.4 * SCALE;
            const drop = half > 1 ? (over * rh) / half : 0;
            const outer = insetRing(pts, -over);
            const ry = eave + rh;
            const ye = eave - drop;
            const [rax, raz, rbx, rbz] = ridge;
            const proj = (p: XZ): XZ => {
                const dx = rbx - rax;
                const dz = rbz - raz;
                const L2 = dx * dx + dz * dz;
                if (L2 < 1) return [rax, raz];
                const t = Math.max(0, Math.min(1, ((p[0] - rax) * dx + (p[1] - raz) * dz) / L2));
                return [rax + dx * t, raz + dz * t];
            };
            const fac = [style, seed, ROOF_PITCHED, clayTile ? 1 : 0];
            for (let k = 0; k < n; ++k) {
                const a = outer[k]!;
                const q = outer[(k + 1) % n]!;
                const ra = proj(pts[k]!);
                const rq = proj(pts[(k + 1) % n]!);
                const L = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1;
                const ex = (q[0] - a[0]) / L;
                const ez = (q[1] - a[1]) / L;
                // uv: u along the eave, v up the slope (meters).
                const uvOf = (p: XZ, y: number) => {
                    const along = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / SCALE;
                    const across = Math.abs((p[0] - a[0]) * -ez + (p[1] - a[1]) * ex) / SCALE;
                    return [along, Math.hypot(across, (y - ye) / SCALE)];
                };
                wb.tri([a[0], ye, a[1]], [rq[0], ry, rq[1]], [q[0], ye, q[1]], [uvOf(a, ye), uvOf(rq, ry), uvOf(q, ye)], roofCol, fac);
                if (Math.hypot(ra[0] - rq[0], ra[1] - rq[1]) > 5) wb.tri([a[0], ye, a[1]], [ra[0], ry, ra[1]], [rq[0], ry, rq[1]], [uvOf(a, ye), uvOf(ra, ry), uvOf(rq, ry)], roofCol, fac);
            }
        }
    }

    const noise = noiseTexture();
    const mat = facadeMaterial(noise);
    const group = new THREE.Group();
    group.name = 'buildings';
    const meshes: THREE.Mesh[] = [];
    for (const wb of cells.values()) {
        const mesh = new THREE.Mesh(wb.geometry(), mat);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        meshes.push(mesh);
    }
    return {
        group,
        dispose() {
            for (const m of meshes) m.geometry.dispose();
            noise.dispose();
            mat.dispose();
        },
    };
}
