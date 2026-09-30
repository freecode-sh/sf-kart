/**
 * Small procedural textures for the bridge: riveted steel plate (albedo grime, normal,
 * roughness) and board-formed concrete. One texture repeat = 240 units (4 m) of world space.
 * Returns null outside the browser (no canvas), materials then fall back to flat colors.
 */

import * as THREE from 'three';

type Tex = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Tileable value noise on an N x N grid with `cells` cells. */
function valueNoise(N: number, cells: number, seed: number): Float32Array {
    const r = rng(seed);
    const g = Array.from({ length: cells * cells }, () => r());
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            const fx = (x / N) * cells;
            const fy = (y / N) * cells;
            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            const tx = fx - x0;
            const ty = fy - y0;
            const sx = tx * tx * (3 - 2 * tx);
            const sy = ty * ty * (3 - 2 * ty);
            const G = (i: number, j: number) => g[((j % cells) * cells + (i % cells)) | 0]!;
            const a = G(x0, y0) + (G(x0 + 1, y0) - G(x0, y0)) * sx;
            const b = G(x0, y0 + 1) + (G(x0 + 1, y0 + 1) - G(x0, y0 + 1)) * sx;
            out[y * N + x] = a + (b - a) * sy;
        }
    return out;
}

function canvasTex(N: number, fill: (img: ImageData) => void, srgb: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    fill(img);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function normalFromHeight(N: number, h: Float32Array, strength: number): (img: ImageData) => void {
    return (img) => {
        for (let y = 0; y < N; ++y)
            for (let x = 0; x < N; ++x) {
                const H = (i: number, j: number) => h[((j + N) % N) * N + ((i + N) % N)]!;
                const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
                // Canvas y runs down; texture v runs up (flipY).
                const dy = -(H(x, y + 1) - H(x, y - 1)) * strength;
                const L = Math.hypot(dx, dy, 1);
                const o = (y * N + x) * 4;
                img.data[o] = ((-dx / L) * 0.5 + 0.5) * 255;
                img.data[o + 1] = ((-dy / L) * 0.5 + 0.5) * 255;
                img.data[o + 2] = ((1 / L) * 0.5 + 0.5) * 255;
                img.data[o + 3] = 255;
            }
    };
}

let paintCache: Tex | null | undefined;

/** Riveted, painted steel plate. */
export function paintTextures(): Tex | null {
    if (paintCache !== undefined) return paintCache;
    if (typeof document === 'undefined') return (paintCache = null);
    const N = 512;
    const h = new Float32Array(N * N);
    // Plate seams: horizontal every 1 m (128 px), vertical every 2 m, rivet rows beside them.
    const seamY = (y: number) => y % 128;
    const seamX = (x: number) => x % 256;
    for (let y = 0; y < N; ++y)
        for (let x = 0; x < N; ++x) {
            let v = 0;
            const sy = seamY(y);
            const sx = seamX(x);
            if (sy < 2 || sx < 2) v -= 1.2;
            // Slight plate bulge.
            v += 0.25 * Math.sin((Math.PI * sy) / 128) * Math.sin((Math.PI * sx) / 256);
            h[y * N + x] = v;
        }
    const rivet = (cx: number, cy: number) => {
        for (let j = -3; j <= 3; ++j)
            for (let i = -3; i <= 3; ++i) {
                const d = Math.hypot(i, j);
                if (d > 2.8) continue;
                const x = (cx + i + N) % N;
                const y = (cy + j + N) % N;
                h[y * N + x]! += 1.1 * Math.cos((d / 2.8) * Math.PI * 0.5);
            }
    };
    for (let y = 0; y < N; y += 128)
        for (let x = 4; x < N; x += 12) {
            rivet(x, y + 7);
            rivet(x, y - 7);
        }
    for (let x = 0; x < N; x += 256)
        for (let y = 4; y < N; y += 12) {
            rivet(x + 7, y);
            rivet(x - 7, y);
        }
    const n1 = valueNoise(N, 8, 7);
    const n2 = valueNoise(N, 32, 11);
    const streak = valueNoise(N, 64, 5);
    const map = canvasTex(
        N,
        (img) => {
            for (let y = 0; y < N; ++y)
                for (let x = 0; x < N; ++x) {
                    const o = (y * N + x) * 4;
                    // Vertical grime streaks: noise stretched along y.
                    const st = streak[x]!;
                    const v = 0.93 + 0.07 * n1[y * N + x]! + 0.04 * n2[y * N + x]! - 0.05 * st;
                    const seam = seamY(y) < 2 || seamX(x) < 2 ? 0.85 : 1;
                    const c = Math.max(0, Math.min(1, v * seam)) * 255;
                    img.data[o] = c;
                    img.data[o + 1] = c * 0.985;
                    img.data[o + 2] = c * 0.97;
                    img.data[o + 3] = 255;
                }
        },
        true,
    );
    const normalMap = canvasTex(N, normalFromHeight(N, h, 1.6), false);
    const roughnessMap = canvasTex(
        N,
        (img) => {
            for (let i = 0; i < N * N; ++i) {
                const r = (0.8 + 0.35 * n2[i]! + 0.2 * n1[i]!) * 200;
                img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, r);
                img.data[i * 4 + 3] = 255;
            }
        },
        false,
    );
    return (paintCache = { map, normalMap, roughnessMap });
}

let concreteCache: Tex | null | undefined;

/** Board-formed concrete. */
export function concreteTextures(): Tex | null {
    if (concreteCache !== undefined) return concreteCache;
    if (typeof document === 'undefined') return (concreteCache = null);
    const N = 256;
    const n1 = valueNoise(N, 6, 3);
    const n2 = valueNoise(N, 48, 9);
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; ++y) for (let x = 0; x < N; ++x) h[y * N + x] = 0.25 * n2[y * N + x]! - (y % 64 < 1 ? 0.6 : 0);
    const map = canvasTex(
        N,
        (img) => {
            for (let y = 0; y < N; ++y)
                for (let x = 0; x < N; ++x) {
                    const i = y * N + x;
                    const v = (0.9 + 0.08 * n1[i]! + 0.03 * n2[i]! - (y % 64 < 1 ? 0.04 : 0)) * 255;
                    img.data[i * 4] = v;
                    img.data[i * 4 + 1] = v * 0.98;
                    img.data[i * 4 + 2] = v * 0.94;
                    img.data[i * 4 + 3] = 255;
                }
        },
        true,
    );
    const normalMap = canvasTex(N, normalFromHeight(N, h, 0.8), false);
    const roughnessMap = canvasTex(
        N,
        (img) => {
            for (let i = 0; i < N * N; ++i) {
                img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 215 + 40 * n2[i]!;
                img.data[i * 4 + 3] = 255;
            }
        },
        false,
    );
    return (concreteCache = { map, normalMap, roughnessMap });
}
