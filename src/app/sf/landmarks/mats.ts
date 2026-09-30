/**
 * Materials and procedural canvas textures for the landmarks (built once, shared).
 *
 * MeshStandardMaterial with canvas textures; most use vertex colors as a tint so one material
 * serves many parts (the texture carries detail, the vertex color the hue).
 */

import * as THREE from 'three';
import { rng } from './kit';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number, draw: (g: Ctx, w: number, h: number) => void): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    return c;
}

function tex(c: HTMLCanvasElement, color = true, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.repeat.set(repeat[0], repeat[1]);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
}

/** Speckle noise over the whole canvas: value ± amp around the current pixels. */
function speckle(g: Ctx, w: number, h: number, amp: number, seed: number, cell = 1): void {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const r = rng(seed);
    for (let y = 0; y < h; y += cell)
        for (let x = 0; x < w; x += cell) {
            const n = (r() - 0.5) * 2 * amp;
            for (let yy = y; yy < Math.min(h, y + cell); ++yy)
                for (let xx = x; xx < Math.min(w, x + cell); ++xx) {
                    const k = (yy * w + xx) * 4;
                    d[k] = Math.max(0, Math.min(255, d[k]! + n));
                    d[k + 1] = Math.max(0, Math.min(255, d[k + 1]! + n));
                    d[k + 2] = Math.max(0, Math.min(255, d[k + 2]! + n));
                }
        }
    g.putImageData(img, 0, 0);
}

/** Soft blotches (weathering), tileable by wrapping around the edges. */
function blotches(g: Ctx, w: number, h: number, n: number, color: string, rMin: number, rMax: number, seed: number): void {
    const r = rng(seed);
    for (let i = 0; i < n; ++i) {
        const x = r() * w;
        const y = r() * h;
        const rad = rMin + r() * (rMax - rMin);
        for (const ox of [-w, 0, w])
            for (const oy of [-h, 0, h]) {
                const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
                gr.addColorStop(0, color);
                gr.addColorStop(1, 'rgba(0,0,0,0)');
                g.fillStyle = gr;
                g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
            }
    }
}

/** Vertical rain streaks (tileable in x). */
function streaks(g: Ctx, w: number, h: number, n: number, color: string, seed: number): void {
    const r = rng(seed);
    g.fillStyle = color;
    for (let i = 0; i < n; ++i) {
        const x = r() * w;
        const y = r() * h;
        const len = h * (0.1 + r() * 0.5);
        const ww = 1 + r() * 3;
        const gr = g.createLinearGradient(0, y, 0, y + len);
        gr.addColorStop(0, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x, y, ww, len);
        if (y + len > h) g.fillRect(x, y - h, ww, len);
    }
}

// ------------------------------------------------------------------------------ textures

/** Light ashlar stone (4 m tile: 8 courses), near-white so vertex colors give the hue. */
function stoneCanvas(): HTMLCanvasElement {
    return canvas(512, 512, (g, w, h) => {
        g.fillStyle = '#f2efe9';
        g.fillRect(0, 0, w, h);
        blotches(g, w, h, 40, 'rgba(120,105,85,0.07)', 20, 90, 11);
        blotches(g, w, h, 30, 'rgba(255,255,250,0.12)', 20, 70, 12);
        const r = rng(5);
        const rows = 8;
        const rh = h / rows;
        g.strokeStyle = 'rgba(110,95,80,0.28)';
        g.lineWidth = 2;
        for (let i = 0; i < rows; ++i) {
            const y = i * rh;
            g.beginPath();
            g.moveTo(0, y + 1);
            g.lineTo(w, y + 1);
            g.stroke();
            const blocks = 3 + Math.floor(r() * 2);
            const off = r() * w;
            for (let k = 0; k < blocks; ++k) {
                const x = (off + (k * w) / blocks) % w;
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x, y + rh);
                g.stroke();
            }
        }
        streaks(g, w, h, 50, 'rgba(90,75,60,0.07)', 7);
        speckle(g, w, h, 10, 3, 2);
    });
}

/** Plain weathered surface (concrete, painted metal): subtle noise and blotches. */
function plainCanvas(): HTMLCanvasElement {
    return canvas(256, 256, (g, w, h) => {
        g.fillStyle = '#f0f0f0';
        g.fillRect(0, 0, w, h);
        blotches(g, w, h, 25, 'rgba(90,90,90,0.08)', 10, 50, 21);
        streaks(g, w, h, 30, 'rgba(60,60,60,0.07)', 22);
        speckle(g, w, h, 10, 23, 1);
    });
}

/** Fluted column shaft: 12 flutes across u, with dark grooves (map) — see fluteNormal. */
function fluteCanvas(): HTMLCanvasElement {
    return canvas(256, 256, (g, w, h) => {
        const flutes = 12;
        for (let x = 0; x < w; ++x) {
            const ph = ((x / w) * flutes) % 1;
            const c = 206 + 44 * Math.sin(ph * Math.PI);
            g.fillStyle = `rgb(${c},${c * 0.99},${c * 0.97})`;
            g.fillRect(x, 0, 1, h);
        }
        blotches(g, w, h, 12, 'rgba(110,95,80,0.12)', 10, 40, 31);
        streaks(g, w, h, 25, 'rgba(80,70,60,0.10)', 32);
        speckle(g, w, h, 10, 33, 1);
    });
}

function fluteNormalCanvas(): HTMLCanvasElement {
    return canvas(256, 4, (g, w, h) => {
        const flutes = 12;
        for (let x = 0; x < w; ++x) {
            const ph = ((x / w) * flutes) % 1;
            const nx = -Math.cos(ph * Math.PI) * 0.8;
            const nz = Math.sqrt(1 - nx * nx);
            g.fillStyle = `rgb(${Math.round(128 + 127 * nx)},128,${Math.round(128 + 127 * nz)})`;
            g.fillRect(x, 0, 1, h);
        }
    });
}

/** The rotunda dome: ochre / salmon with 8 ribbed bays of relief panels (u = one bay, repeat 8). */
function domeCanvas(): HTMLCanvasElement {
    return canvas(256, 512, (g, w, h) => {
        const base = g.createLinearGradient(0, h, 0, 0);
        base.addColorStop(0, '#d98a5a');
        base.addColorStop(0.6, '#e29a68');
        base.addColorStop(1, '#cf8456');
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        // Rib at the bay edges.
        g.fillStyle = 'rgba(235,190,140,0.55)';
        g.fillRect(0, 0, 14, h);
        g.fillRect(w - 14, 0, 14, h);
        g.fillStyle = 'rgba(90,45,25,0.35)';
        g.fillRect(14, 0, 3, h);
        g.fillRect(w - 17, 0, 3, h);
        // Panels (v = 0 bottom of dome → canvas bottom).
        const panels = [
            [0.06, 0.3],
            [0.34, 0.56],
            [0.6, 0.76],
        ];
        for (const [v0, v1] of panels) {
            const y0 = h * (1 - v1!);
            const y1 = h * (1 - v0!);
            g.fillStyle = 'rgba(120,60,35,0.35)';
            g.fillRect(34, y0, w - 68, y1 - y0);
            g.fillStyle = 'rgba(240,195,150,0.35)';
            g.fillRect(40, y0 + 6, w - 80, y1 - y0 - 12);
            // Relief figure: a few soft light blobs.
            blotchesIn(g, 50, y0 + 10, w - 100, y1 - y0 - 20, 'rgba(250,215,170,0.35)', 44 + Math.round(v0! * 100));
        }
        // Horizontal cornice band.
        g.fillStyle = 'rgba(240,200,160,0.5)';
        g.fillRect(0, h * 0.97, w, h * 0.03);
        blotches(g, w, h, 20, 'rgba(80,60,50,0.12)', 10, 60, 41);
        streaks(g, w, h, 30, 'rgba(70,40,30,0.12)', 42);
        speckle(g, w, h, 10, 43, 2);
    });
}

function blotchesIn(g: Ctx, x: number, y: number, w: number, h: number, color: string, seed: number): void {
    const r = rng(seed);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (let i = 0; i < 7; ++i) {
        const cx = x + r() * w;
        const cy = y + r() * h;
        const rad = 8 + r() * 18;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    g.restore();
}

/**
 * Fort Point brick: one bay (5 m) by one tier (4.2 m) per tile. Solid brick for v < 0.24 (sill at
 * 0.25), an arched casemate opening from 0.28 to 0.86, brick above.
 */
function brickCanvas(): HTMLCanvasElement {
    return canvas(512, 430, (g, w, h) => {
        g.fillStyle = '#8a5a48';
        g.fillRect(0, 0, w, h);
        const r = rng(51);
        const bw = 24;
        const bh = 8;
        for (let row = 0; row * bh < h; ++row) {
            const off = row % 2 ? bw / 2 : 0;
            for (let x = -bw; x < w + bw; x += bw) {
                const t = r();
                const rr = 150 + t * 45 + (r() < 0.06 ? -45 : 0);
                g.fillStyle = `rgb(${rr},${rr * 0.52 + r() * 14},${rr * 0.38 + r() * 12})`;
                g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
            }
        }
        const Y = (v: number) => h * (1 - v);
        // Granite sill band + tier course.
        g.fillStyle = '#a8a39a';
        g.fillRect(0, Y(0.25), w, h * 0.035);
        g.fillStyle = 'rgba(40,20,15,0.25)';
        g.fillRect(0, Y(0.25) + h * 0.035, w, 2);
        // Arched opening with a granite surround.
        const cx = w / 2;
        const ow = w * 0.36;
        const vTop = 0.86;
        const vSpring = 0.72;
        const rad = ow / 2;
        const path = (grow: number) => {
            g.beginPath();
            g.moveTo(cx - rad - grow, Y(0.28) + grow);
            g.lineTo(cx - rad - grow, Y(vSpring));
            g.arc(cx, Y(vSpring), rad + grow, Math.PI, 0);
            g.lineTo(cx + rad + grow, Y(0.28) + grow);
            g.closePath();
        };
        path(8);
        g.fillStyle = '#9d978d';
        g.fill();
        path(0);
        const dark = g.createLinearGradient(0, Y(vTop), 0, Y(0.28));
        dark.addColorStop(0, '#15110f');
        dark.addColorStop(1, '#2a2320');
        g.fillStyle = dark;
        g.fill();
        // Keystone.
        g.fillStyle = '#b0aaa0';
        g.fillRect(cx - 9, Y(vSpring) - rad - 12, 18, 16);
        streaks(g, w, h, 40, 'rgba(30,20,15,0.12)', 52);
        blotches(g, w, h, 18, 'rgba(210,200,190,0.10)', 10, 50, 53);
        speckle(g, w, h, 8, 54, 1);
    });
}

/** Office tower curtain wall: 4 bays (u) x 6 floors (v) per tile, mostly neutral for tinting. */
function facadeCanvas(): HTMLCanvasElement {
    return canvas(256, 256, (g, w, h) => {
        g.fillStyle = '#e8e8e6';
        g.fillRect(0, 0, w, h);
        const r = rng(61);
        const bays = 4;
        const floors = 6;
        const bw = w / bays;
        const fh = h / floors;
        for (let f = 0; f < floors; ++f)
            for (let b = 0; b < bays; ++b) {
                const lit = r();
                const base = 105 + lit * 70;
                g.fillStyle = `rgb(${base * 0.82},${base * 0.92},${Math.min(255, base * 1.08)})`;
                g.fillRect(b * bw + 5, f * fh + 9, bw - 10, fh - 14);
                // Sky reflection gradient.
                const gr = g.createLinearGradient(0, f * fh + 9, 0, f * fh + fh - 5);
                gr.addColorStop(0, 'rgba(210,230,255,0.25)');
                gr.addColorStop(1, 'rgba(0,0,0,0)');
                g.fillStyle = gr;
                g.fillRect(b * bw + 5, f * fh + 9, bw - 10, fh - 14);
                g.fillStyle = 'rgba(230,230,230,0.5)';
                g.fillRect(b * bw + bw / 2 - 1, f * fh + 9, 2, fh - 14);
            }
        speckle(g, w, h, 6, 62, 1);
    });
}

/** Residential / low-rise walls: pale stucco with small windows (4 bays x 4 floors of 3 m). */
function residCanvas(): HTMLCanvasElement {
    return canvas(128, 128, (g, w, h) => {
        g.fillStyle = '#f4f2ee';
        g.fillRect(0, 0, w, h);
        const r = rng(91);
        for (let f = 0; f < 4; ++f)
            for (let b = 0; b < 4; ++b) {
                const v = 70 + r() * 50;
                g.fillStyle = `rgb(${v * 0.85},${v * 0.9},${v})`;
                g.fillRect(b * 32 + 10, f * 32 + 9, 12, 16);
            }
        speckle(g, w, h, 8, 92, 1);
    });
}

/** Art-deco stucco with tall recessed window strips (one 3.5 m bay x 4 m floor per tile). */
function decoCanvas(): HTMLCanvasElement {
    return canvas(128, 160, (g, w, h) => {
        g.fillStyle = '#f1ead8';
        g.fillRect(0, 0, w, h);
        // Pilaster edges.
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(0, 0, 10, h);
        g.fillRect(w - 10, 0, 10, h);
        g.fillStyle = 'rgba(120,110,90,0.25)';
        g.fillRect(10, 0, 2, h);
        g.fillRect(w - 12, 0, 2, h);
        // Window.
        g.fillStyle = '#3d4a55';
        g.fillRect(28, 30, w - 56, h - 60);
        g.fillStyle = 'rgba(200,220,240,0.25)';
        g.fillRect(28, 30, w - 56, (h - 60) * 0.4);
        g.fillStyle = '#e8e2d0';
        g.fillRect(w / 2 - 2, 30, 4, h - 60);
        g.fillRect(28, 30 + (h - 60) * 0.55, w - 56, 3);
        // Spandrel with a deco chevron.
        g.strokeStyle = 'rgba(160,120,70,0.6)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(34, h - 18);
        g.lineTo(w / 2, h - 26);
        g.lineTo(w - 34, h - 18);
        g.stroke();
        blotches(g, w, h, 8, 'rgba(100,90,70,0.10)', 10, 40, 71);
        speckle(g, w, h, 8, 72, 1);
    });
}

/** "GOLDEN GATE BRIDGE" sign board (International Orange, white letters). */
function signCanvas(): HTMLCanvasElement {
    return canvas(1024, 64, (g, w, h) => {
        g.fillStyle = '#b8392c';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#f4efe4';
        g.fillRect(0, 3, w, 2);
        g.fillRect(0, h - 5, w, 2);
        g.font = 'bold 40px Futura, "Gill Sans", Helvetica, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const text = 'GOLDEN GATE BRIDGE';
        // Letter-spaced.
        const spacing = 14;
        const widths = [...text].map((c) => g.measureText(c).width + spacing);
        let x = w / 2 - widths.reduce((a, b) => a + b, 0) / 2;
        [...text].forEach((c, i) => {
            g.fillText(c, x + widths[i]! / 2, h / 2 + 2);
            x += widths[i]!;
        });
    });
}

/** Rock / earth noise (grey-brown, vertex colors add the hue). */
function rockCanvas(): HTMLCanvasElement {
    return canvas(256, 256, (g, w, h) => {
        g.fillStyle = '#d8d8d8';
        g.fillRect(0, 0, w, h);
        blotches(g, w, h, 60, 'rgba(60,60,60,0.18)', 6, 30, 81);
        blotches(g, w, h, 40, 'rgba(255,255,255,0.15)', 6, 24, 82);
        speckle(g, w, h, 22, 83, 2);
    });
}

// ------------------------------------------------------------------------------ materials

export type Mats = Record<string, THREE.Material>;

let cache: Mats | null = null;

export function materials(): Mats {
    return (cache ??= build());
}

function build(): Mats {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true, ...p });
    const stoneMap = tex(stoneCanvas());
    const plainMap = tex(plainCanvas());
    const flute = tex(fluteCanvas());
    const fluteN = tex(fluteNormalCanvas(), false);
    const dome = tex(domeCanvas(), true, [8, 1]);
    const brick = tex(brickCanvas());
    const facade = tex(facadeCanvas());
    const deco = tex(decoCanvas());
    const rock = tex(rockCanvas());
    const resid = tex(residCanvas());
    return {
        stone: std({ map: stoneMap, roughness: 0.9 }),
        column: std({ map: flute, normalMap: fluteN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.88 }),
        dome: std({ map: dome, roughness: 0.8, vertexColors: false }),
        brick: std({ map: brick, roughness: 0.92, vertexColors: false }),
        plain: std({ map: plainMap, roughness: 0.85 }),
        metal: std({ map: plainMap, roughness: 0.5, metalness: 0.55 }),
        glass: std({ roughness: 0.12, metalness: 0.4, color: 0xffffff }),
        lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
        facade: std({ map: facade, roughness: 0.45, metalness: 0.25 }),
        deco: std({ map: deco, roughness: 0.8, vertexColors: false }),
        rock: std({ map: rock, roughness: 0.97 }),
        resid: std({ map: resid, roughness: 0.9 }),
        sail: std({ map: plainMap, roughness: 0.75, side: THREE.DoubleSide }),
        hull: std({ roughness: 0.45, metalness: 0.1 }),
        sign: std({ map: tex(signCanvas()), roughness: 0.6, vertexColors: false, emissive: 0x220806 }),
    };
}
