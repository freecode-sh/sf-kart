/**
 * Leaf-card trees (trees.ts places them): per species a trunk and limbs plus a crown of alpha-tested
 * leaf-cluster cards with crown-shaped normals (soft, volumetric shading instead of flat cards),
 * baked ambient occlusion, sun shining through the leaves and a little wind.
 *
 *   0 Monterey cypress   short thick trunk splitting into limbs, broad flat-topped layered pads
 *   1 blue gum eucalyptus tall pale forked trunk, open crown of hanging grey-green leaf clumps
 *   2 Monterey pine      tall trunk, irregular rounded crown of needle tufts
 *   3 street / park tree broadleaf (plane, ficus, ...): rounded crown of leaf clusters
 *   4 palm               Canary Island date palm: stout trunk, a ball of arching fronds
 *
 * Templates are unit trees (height 1, crown radius 1; trees.ts scales them by each tree's lidar
 * height and crown), in three levels of detail: near (two variants per species), far and a handful
 * of big cards for the distance. One procedurally painted leaf / bark atlas with coverage-preserving
 * mipmaps, so crowns don't thin out with distance.
 */

import * as THREE from 'three';

const AW = 2048;
const AH = 1024;

type Cell = { x: number; y: number; w: number; h: number };
const CELLS = {
    broadleaf: { x: 0, y: 0, w: 512, h: 512 },
    cypress: { x: 512, y: 0, w: 512, h: 512 },
    pine: { x: 1024, y: 0, w: 512, h: 512 },
    eucalyptus: { x: 1536, y: 0, w: 512, h: 512 },
    frond: { x: 0, y: 512, w: 1024, h: 512 },
    shrub: { x: 1024, y: 512, w: 512, h: 512 },
    bark: { x: 1536, y: 512, w: 512, h: 512 },
} satisfies Record<string, Cell>;
/** The leaf cell of each species, then of the understory shrubs (its mean colour sets the per-tree tint). */
const LEAF_CELL = [CELLS.cypress, CELLS.eucalyptus, CELLS.pine, CELLS.broadleaf, CELLS.frond, CELLS.shrub];
/** Index of the shrubs in TreeAtlas.leafMean. */
export const SHRUB = 5;

/** Height / crown radius the templates are drawn for (trees.ts keeps each tree near it). */
export const ASPECT = [2.4, 3.2, 2.8, 1.6, 3.4];
/** Crown colour per species (sRGB albedo), before the photo's. */
export const CROWN = [0x2c4228, 0x475838, 0x2b4128, 0x41592c, 0x52693a];

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ------------------------------------------------------------------------------ atlas

const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%)`;

function paintAtlas(): Uint8Array {
    const cv = document.createElement('canvas');
    cv.width = AW;
    cv.height = AH;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const mk = document.createElement('canvas');
    mk.width = AW;
    mk.height = AH;
    const m = mk.getContext('2d', { willReadFrequently: true })!;
    m.fillStyle = '#000';
    m.fillRect(0, 0, AW, AH);
    const R = rng(1234);
    // Draws a shape on the colour canvas and white on the coverage mask.
    const both = (fill: string, draw: (c: CanvasRenderingContext2D) => void) => {
        g.fillStyle = g.strokeStyle = fill;
        draw(g);
        m.fillStyle = m.strokeStyle = '#fff';
        draw(m);
    };
    const leaf = (x: number, y: number, len: number, wid: number, ang: number, col: string, bend = 0) =>
        both(col, (c) => {
            c.save();
            c.translate(x, y);
            c.rotate(ang);
            c.beginPath();
            c.moveTo(0, 0);
            c.quadraticCurveTo(len * 0.45, wid + bend, len, bend * 1.6);
            c.quadraticCurveTo(len * 0.5, -wid + bend, 0, 0);
            c.fill();
            c.restore();
        });
    const line = (pts: [number, number][], w: number, col: string) =>
        both(col, (c) => {
            c.lineWidth = w;
            c.lineCap = c.lineJoin = 'round';
            c.beginPath();
            pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
            c.stroke();
        });
    const clipCell = (cell: Cell, bg: string, fn: () => void) => {
        for (const c of [g, m]) {
            c.save();
            c.beginPath();
            c.rect(cell.x + 2, cell.y + 2, cell.w - 4, cell.h - 4);
            c.clip();
        }
        // The background shows through the mip chain's edges only: the leaves' own colour.
        g.fillStyle = bg;
        g.fillRect(cell.x, cell.y, cell.w, cell.h);
        fn();
        g.restore();
        m.restore();
    };
    /** Random point in a disc, denser toward the middle. */
    const inDisc = (r: number): [number, number] => {
        const a = R() * Math.PI * 2;
        const d = r * Math.pow(R(), 0.65);
        return [Math.cos(a) * d, Math.sin(a) * d];
    };

    // Broadleaf cluster: twigs, then ovate leaves lit from above.
    {
        const c = CELLS.broadleaf;
        const cx = c.x + 256;
        const cy = c.y + 256;
        clipCell(c, hsl(95, 0.4, 0.2), () => {
            for (let t = 0; t < 9; ++t) {
                const a = R() * Math.PI * 2;
                line([[cx, cy], [cx + Math.cos(a) * 120, cy + Math.sin(a) * 120], [cx + Math.cos(a + 0.4) * 200, cy + Math.sin(a + 0.4) * 200]], 3, hsl(25, 0.25, 0.18));
            }
            for (let k = 0; k < 1100; ++k) {
                const [dx, dy] = inDisc(222);
                const top = -dy / 222;
                const l = 0.17 + 0.1 * top + R() * 0.12 + (k / 1100) * 0.07;
                leaf(cx + dx, cy + dy, 26 + R() * 14, 9 + R() * 5, R() * Math.PI * 2, hsl(84 + R() * 26, 0.36 + R() * 0.2, l), (R() - 0.5) * 6);
            }
        });
    }
    // Monterey cypress: dense sprays of scale foliage.
    {
        const c = CELLS.cypress;
        const cx = c.x + 256;
        const cy = c.y + 256;
        clipCell(c, hsl(120, 0.3, 0.1), () => {
            for (let sp = 0; sp < 64; ++sp) {
                const [dx, dy] = inDisc(185);
                const a = R() * Math.PI * 2;
                const len = 50 + R() * 70;
                const x0 = cx + dx;
                const y0 = cy + dy;
                for (let b = 0; b < 7; ++b) {
                    const t = b / 7;
                    const bx = x0 + Math.cos(a) * len * t;
                    const by = y0 + Math.sin(a) * len * t;
                    const ba = a + (b % 2 ? 1 : -1) * (0.7 + R() * 0.4);
                    const bl = (1 - t) * 40 + 12;
                    for (let q = 0; q < 6; ++q) {
                        const u = q / 6;
                        const px = bx + Math.cos(ba) * bl * u;
                        const py = by + Math.sin(ba) * bl * u;
                        const top = -(py - cy) / 220;
                        both(hsl(100 + R() * 22, 0.3 + R() * 0.12, 0.13 + 0.08 * top + R() * 0.08), (cc) => {
                            cc.beginPath();
                            cc.arc(px, py, 4 + R() * 4 * (1 - u * 0.5), 0, Math.PI * 2);
                            cc.fill();
                        });
                    }
                }
            }
        });
    }
    // Monterey pine: needle tufts on twigs.
    {
        const c = CELLS.pine;
        const cx = c.x + 256;
        const cy = c.y + 256;
        clipCell(c, hsl(110, 0.3, 0.12), () => {
            for (let t = 0; t < 7; ++t) {
                const a = R() * Math.PI * 2;
                line([[cx, cy], [cx + Math.cos(a) * 180, cy + Math.sin(a) * 180]], 4, hsl(20, 0.3, 0.16));
            }
            for (let k = 0; k < 120; ++k) {
                const [dx, dy] = inDisc(195);
                const x = cx + dx;
                const y = cy + dy;
                const top = -dy / 200;
                const base = R() * Math.PI * 2;
                for (let n = 0; n < 34; ++n) {
                    const a = base + (n / 34) * Math.PI * 2 + (R() - 0.5) * 0.3;
                    const L = 22 + R() * 22;
                    line([[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L + 4]], 2.2, hsl(98 + R() * 25, 0.3 + R() * 0.15, 0.14 + 0.07 * top + R() * 0.08));
                }
            }
        });
    }
    // Eucalyptus: thin twigs with long, hanging sickle leaves.
    {
        const c = CELLS.eucalyptus;
        const cx = c.x + 256;
        const cy = c.y + 220;
        clipCell(c, hsl(90, 0.12, 0.28), () => {
            for (let t = 0; t < 8; ++t) {
                const a = -Math.PI / 2 + (R() - 0.5) * 2.6;
                line([[cx, cy + 60], [cx + Math.cos(a) * 170, cy + 60 + Math.sin(a) * 120]], 2.5, hsl(30, 0.2, 0.35));
            }
            for (let k = 0; k < 420; ++k) {
                const [dx, dy] = inDisc(190);
                const a = Math.PI / 2 + (R() - 0.5) * 1.4;
                const top = -dy / 200;
                leaf(cx + dx, cy + dy * 0.8, 55 + R() * 40, 5 + R() * 3, a, hsl(88 + R() * 28, 0.2 + R() * 0.14, 0.26 + 0.08 * top + R() * 0.1), (R() - 0.5) * 16);
            }
        });
    }
    // Palm frond: the rachis along u with two rows of leaflets.
    {
        const c = CELLS.frond;
        clipCell(c, hsl(85, 0.4, 0.2), () => {
            const y0 = c.y + 256;
            const rach = (t: number): [number, number] => [c.x + 16 + t * 990, y0 + Math.sin(t * Math.PI) * 10];
            for (let k = 0; k < 110; ++k) {
                const t = 0.04 + (k / 110) * 0.95;
                const [x, y] = rach(t);
                const L = 230 * (1 - t * 0.75);
                for (const side of [-1, 1]) {
                    const a = side * (1.05 - t * 0.45) + (R() - 0.5) * 0.1;
                    leaf(x, y, L * (0.85 + R() * 0.2), 5 + R() * 2, a, hsl(72 + R() * 22 + t * 8, 0.4 + R() * 0.15, 0.2 + R() * 0.12 + (1 - t) * 0.04), side * 6);
                }
            }
            line(Array.from({ length: 20 }, (_, i) => rach(i / 19)), 7, hsl(55, 0.35, 0.42));
        });
    }
    // Shrub: small dense leaves (scrub, hedges).
    {
        const c = CELLS.shrub;
        const cx = c.x + 256;
        const cy = c.y + 256;
        clipCell(c, hsl(100, 0.35, 0.14), () => {
            for (let k = 0; k < 2600; ++k) {
                const [dx, dy] = inDisc(235);
                const top = -dy / 235;
                leaf(cx + dx, cy + dy, 13 + R() * 7, 5 + R() * 2, R() * Math.PI * 2, hsl(88 + R() * 32, 0.3 + R() * 0.15, 0.15 + 0.08 * top + R() * 0.1));
            }
        });
    }
    // Bark: neutral grey-brown vertical streaks (tinted per species by the vertex colour).
    {
        const c = CELLS.bark;
        g.fillStyle = '#8a8580';
        g.fillRect(c.x, c.y, c.w, c.h);
        m.fillStyle = '#fff';
        m.fillRect(c.x, c.y, c.w, c.h);
        for (let k = 0; k < 900; ++k) {
            const x = c.x + R() * c.w;
            const y = c.y + R() * c.h;
            g.fillStyle = R() < 0.5 ? `rgba(40,34,30,${0.2 + R() * 0.4})` : `rgba(200,195,185,${0.15 + R() * 0.25})`;
            g.fillRect(x, y, 2 + R() * 5, Math.min(20 + R() * 120, c.y + c.h - y));
        }
    }
    const col = g.getImageData(0, 0, AW, AH).data;
    const msk = m.getImageData(0, 0, AW, AH).data;
    const data = new Uint8Array(AW * AH * 4);
    for (let i = 0; i < AW * AH; ++i) {
        data[i * 4] = col[i * 4]!;
        data[i * 4 + 1] = col[i * 4 + 1]!;
        data[i * 4 + 2] = col[i * 4 + 2]!;
        data[i * 4 + 3] = msk[i * 4]!;
    }
    return data;
}

export interface TreeAtlas {
    texture: THREE.DataTexture;
    /** Mean colour (linear) of each species' leaves. */
    leafMean: THREE.Color[];
}

/**
 * The atlas with a mip chain whose alpha keeps each cell's alpha-test coverage (so distant crowns
 * don't dissolve), colour averaged by alpha (no dark fringes).
 */
export function treeAtlas(): TreeAtlas {
    const data = paintAtlas();
    const cells = Object.values(CELLS);
    const levels: { data: Uint8Array; width: number; height: number }[] = [{ data, width: AW, height: AH }];
    const coverage = (d: Uint8Array, w: number, cell: Cell, scale: number, k = 1) => {
        let n = 0;
        let t = 0;
        for (let y = Math.floor(cell.y / scale); y < Math.floor((cell.y + cell.h) / scale); ++y)
            for (let x = Math.floor(cell.x / scale); x < Math.floor((cell.x + cell.w) / scale); ++x) {
                ++t;
                if (d[(y * w + x) * 4 + 3]! * k > 127) ++n;
            }
        return t ? n / t : 0;
    };
    const target = cells.map((c) => coverage(data, AW, c, 1));
    let w = AW;
    let h = AH;
    let prev = data;
    let scale = 1;
    while (w > 1 || h > 1) {
        const nw = Math.max(1, w >> 1);
        const nh = Math.max(1, h >> 1);
        const next = new Uint8Array(nw * nh * 4);
        for (let y = 0; y < nh; ++y)
            for (let x = 0; x < nw; ++x) {
                let r = 0;
                let gg = 0;
                let b = 0;
                let a = 0;
                let wsum = 0;
                for (let dy = 0; dy < 2; ++dy)
                    for (let dx = 0; dx < 2; ++dx) {
                        const k = (Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 4;
                        const wt = prev[k + 3]! / 255 + 0.02;
                        r += prev[k]! * wt;
                        gg += prev[k + 1]! * wt;
                        b += prev[k + 2]! * wt;
                        wsum += wt;
                        a += prev[k + 3]!;
                    }
                const o = (y * nw + x) * 4;
                next[o] = r / wsum;
                next[o + 1] = gg / wsum;
                next[o + 2] = b / wsum;
                next[o + 3] = a / 4;
            }
        scale *= 2;
        // Rescale alpha per cell to keep its coverage (binary search on a multiplier).
        if (nw >= 8)
            cells.forEach((c, ci) => {
                let lo = 1;
                let hi = 4;
                for (let it = 0; it < 10; ++it) {
                    const mid = (lo + hi) / 2;
                    if (coverage(next, nw, c, scale, mid) < target[ci]!) lo = mid;
                    else hi = mid;
                }
                const k = (lo + hi) / 2;
                for (let y = Math.floor(c.y / scale); y < Math.floor((c.y + c.h) / scale); ++y)
                    for (let x = Math.floor(c.x / scale); x < Math.floor((c.x + c.w) / scale); ++x) {
                        const o = (y * nw + x) * 4 + 3;
                        next[o] = Math.min(255, next[o]! * k);
                    }
            });
        levels.push({ data: next, width: nw, height: nh });
        prev = next;
        w = nw;
        h = nh;
    }
    const t = new THREE.DataTexture(data, AW, AH);
    t.mipmaps = levels;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    // Mean leaf colour per species (opaque texels of a small mip).
    const L = levels[4]!;
    const leafMean = LEAF_CELL.map((c) => {
        const acc = new THREE.Color(0, 0, 0);
        const px = new THREE.Color();
        let n = 0;
        for (let y = c.y / 16; y < (c.y + c.h) / 16; ++y)
            for (let x = c.x / 16; x < (c.x + c.w) / 16; ++x) {
                const k = (y * L.width + x) * 4;
                if (L.data[k + 3]! < 128) continue;
                px.setRGB(L.data[k]! / 255, L.data[k + 1]! / 255, L.data[k + 2]! / 255, THREE.SRGBColorSpace);
                acc.r += px.r;
                acc.g += px.g;
                acc.b += px.b;
                ++n;
            }
        return acc.multiplyScalar(1 / Math.max(1, n));
    });
    return { texture: t, leafMean };
}

// ------------------------------------------------------------------------------ geometry

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class TreeBuilder {
    pos: number[] = [];
    nrm: number[] = [];
    uv: number[] = [];
    col: number[] = [];
    sway: number[] = [];
    leaf: number[] = [];
    idx: number[] = [];
    private v = 0;

    /** A vertex; `leaf` 0 for bark (which the per-tree crown tint leaves alone). */
    vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, sway: number, leaf = 1): number {
        this.leaf.push(leaf);
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(n.x, n.y, n.z);
        this.uv.push(u, v);
        this.col.push(c.r, c.g, c.b);
        this.sway.push(sway);
        return this.v++;
    }

    /** A leaf card: centre, half extents along two axes, atlas cell; normals bent away from the crown centre. */
    card(c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, cell: Cell, crown: THREE.Vector3, tint: THREE.Color, sway: number, bend = 0.6): void {
        const u0 = (cell.x + 3) / AW;
        const u1 = (cell.x + cell.w - 3) / AW;
        const v0 = (cell.y + 3) / AH;
        const v1 = (cell.y + cell.h - 3) / AH;
        const cn = new THREE.Vector3().crossVectors(ax, ay).normalize();
        const ids = (
            [
                [-1, -1, u0, v1],
                [1, -1, u1, v1],
                [1, 1, u1, v0],
                [-1, 1, u0, v0],
            ] as const
        ).map(([sx, sy, u, v]) => {
            const p = c.clone().addScaledVector(ax, sx).addScaledVector(ay, sy);
            const radial = p.clone().sub(crown).normalize();
            if (cn.dot(radial) < 0) cn.negate();
            return this.vert(p, cn.clone().lerp(radial, bend).normalize(), u, v, tint, sway);
        });
        this.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
    }

    /** A tapered bark cylinder from a to b (open ends). */
    limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides: number, tint: THREE.Color, sway0: number, sway1: number): void {
        const cell = CELLS.bark;
        const dir = b.clone().sub(a);
        const len = dir.length();
        dir.normalize();
        const t1 = (Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(dir).normalize();
        const t2 = dir.clone().cross(t1).normalize();
        const base = this.v;
        for (let ring = 0; ring < 2; ++ring)
            for (let s = 0; s <= sides; ++s) {
                const ang = (s / sides) * Math.PI * 2;
                const n = t1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t2, Math.sin(ang));
                const u = (cell.x + 4 + (s / sides) * (cell.w - 8)) / AW;
                const v = (cell.y + 4 + ring * Math.min(cell.h - 8, (len / (r0 * 6.3)) * 60)) / AH;
                // Darker low down (ambient occlusion from the ground and the crown).
                const t = tint.clone().multiplyScalar(ring ? 1 : 0.8);
                this.vert((ring ? b : a).clone().addScaledVector(n, ring ? r1 : r0), n, u, v, t, ring ? sway1 : sway0, 0);
            }
        for (let s = 0; s < sides; ++s) {
            const a0 = base + s;
            const b0 = base + sides + 1 + s;
            this.idx.push(a0, a0 + 1, b0 + 1, a0, b0 + 1, b0);
        }
    }

    /** The geometry, squeezed from (crown radius 1, height `aspect`) to a unit tree. */
    geometry(aspect: number): THREE.BufferGeometry {
        for (let i = 1; i < this.pos.length; i += 3) this.pos[i]! /= aspect;
        for (let i = 0; i < this.nrm.length; i += 3) {
            const n = V(this.nrm[i]!, this.nrm[i + 1]! * aspect, this.nrm[i + 2]!).normalize();
            this.nrm[i] = n.x;
            this.nrm[i + 1] = n.y;
            this.nrm[i + 2] = n.z;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 1));
        g.setAttribute('leaf', new THREE.Float32BufferAttribute(this.leaf, 1));
        g.setIndex(this.idx);
        g.computeBoundingSphere();
        return g;
    }
}

function randDir(R: () => number): THREE.Vector3 {
    const z = R() * 2 - 1;
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return V(Math.cos(a) * r, z, Math.sin(a) * r);
}

/** Cards filling an ellipsoid clump. `orient`: 0 random, 1 mostly horizontal, -1 hanging (vertical). */
function clump(b: TreeBuilder, R: () => number, center: THREE.Vector3, radius: THREE.Vector3, n: number, size: number, cell: Cell, crown: THREE.Vector3, crownR: number, orient: number): void {
    for (let k = 0; k < n; ++k) {
        const p = center.clone().add(randDir(R).multiplyScalar(Math.pow(R(), 0.5)).multiply(radius));
        const nrm =
            orient > 0 ? V((R() - 0.5) * 1.3, 1, (R() - 0.5) * 1.3).normalize() : orient < 0 ? V(R() - 0.5, (R() - 0.5) * 0.4, R() - 0.5).normalize() : randDir(R);
        const ax = (Math.abs(nrm.y) < 0.95 ? V(0, 1, 0) : V(1, 0, 0)).cross(nrm).normalize();
        const ay = nrm.clone().cross(ax).normalize();
        const rot = R() * Math.PI * 2;
        const ax2 = ax.clone().multiplyScalar(Math.cos(rot)).addScaledVector(ay, Math.sin(rot));
        const ay2 = nrm.clone().cross(ax2).normalize();
        const s = size * (0.8 + R() * 0.4);
        // Baked occlusion: darker deep inside the crown and underneath.
        const depth = Math.min(1, p.distanceTo(crown) / crownR);
        const under = Math.max(0, Math.min(1, (p.y - (crown.y - crownR)) / (crownR * 2)));
        const ao = Math.min(1.1, 0.42 + 0.45 * depth + 0.22 * under);
        b.card(p, ax2.multiplyScalar(s * 0.5), ay2.multiplyScalar(s * 0.5), cell, crown, new THREE.Color(ao, ao, ao), 1);
    }
}

/**
 * A species template. lod 0: the near tree (variant = seed), 1: far (a quarter of the cards, bigger,
 * no limbs), 2: distant (a few big cards on a stick).
 */
export function treeTemplate(type: number, lod: 0 | 1 | 2, variant = 0): THREE.BufferGeometry {
    const R = rng(100 + type * 17 + variant * 5 + lod * 1000);
    const A = ASPECT[type]!;
    const b = new TreeBuilder();
    const cards = (n: number) => (lod === 0 ? n : lod === 1 ? Math.max(2, Math.round(n / 4)) : 1);
    const grow = lod === 0 ? 1 : lod === 1 ? 2 : 3;
    const cl = (c: THREE.Vector3, r: THREE.Vector3, n: number, size: number, cell: Cell, crown: THREE.Vector3, crownR: number, orient: number) =>
        clump(b, R, c, lod === 2 ? r.clone().multiplyScalar(0.3) : r, cards(n), size * grow, cell, crown, crownR, orient);
    const limb = (a: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number, sides: number, tint: THREE.Color, s0: number, s1: number) => {
        if (lod === 0) b.limb(a, c, r0, r1, sides, tint, s0, s1);
    };
    const trunk = (a: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number, sides: number, tint: THREE.Color) => b.limb(a, c, r0, r1, lod === 0 ? sides : lod === 1 ? 5 : 3, tint, 0, 0.03);
    if (type === 3) {
        // Broadleaf street / park tree: short trunk, rounded crown of clusters.
        const bark = new THREE.Color(0.6, 0.55, 0.48);
        const top = V((R() - 0.5) * 0.05, 0.42 * A, (R() - 0.5) * 0.05);
        trunk(V(0, -0.05, 0), top, 0.09, 0.065, 7, bark);
        const crown = V(0, 0.68 * A, 0);
        const n = lod === 2 ? 5 : 7;
        for (let k = 0; k < n; ++k) {
            const a = (k / n) * Math.PI * 2 + R() * 0.5;
            const rr = k === 0 ? 0 : 0.45 + R() * 0.15;
            const c = V(Math.cos(a) * rr, (k === 0 ? 0.86 : 0.58 + R() * 0.18) * A, Math.sin(a) * rr);
            limb(top, c.clone().lerp(top, 0.4), 0.035, 0.015, 4, bark, 0.05, 0.4);
            cl(c, V(0.45, 0.32 * A * 0.5, 0.45), 16, 0.62, CELLS.broadleaf, crown, 0.9, 0);
        }
    } else if (type === 0) {
        // Monterey cypress: short thick trunk splitting into limbs, broad flat layered pads.
        const bark = new THREE.Color(0.55, 0.42, 0.34);
        const fork = V(0, 0.28 * A, 0);
        trunk(V(0, -0.05, 0), fork, 0.13, 0.1, 7, bark);
        const crown = V(0, 0.68 * A, 0);
        const pads = lod === 2 ? 6 : 8;
        for (let k = 0; k < pads; ++k) {
            const a = (k / pads) * Math.PI * 2 + R() * 0.6;
            const rr = k < 2 ? R() * 0.25 : 0.4 + R() * 0.32;
            const y = (k < 2 ? 0.86 + R() * 0.08 : 0.46 + R() * 0.34) * A;
            const c = V(Math.cos(a) * rr, y, Math.sin(a) * rr * 0.85);
            limb(fork, c.clone().lerp(fork, 0.3), 0.06, 0.02, 5, bark, 0.02, 0.3);
            const w = 0.42 + R() * 0.2 + (y > 0.8 * A ? 0.12 : 0);
            cl(c, V(w, 0.16, w * 0.85), 16, 0.62, CELLS.cypress, crown, 1.1, 1);
        }
    } else if (type === 2) {
        // Monterey pine: tall trunk, irregular rounded crown of needle clumps.
        const bark = new THREE.Color(0.5, 0.4, 0.33);
        const top = V(0.03, 0.86 * A, 0);
        trunk(V(0, -0.05, 0), top, 0.08, 0.035, 7, bark);
        const crown = V(0, 0.74 * A, 0);
        const n = lod === 2 ? 6 : 9;
        for (let k = 0; k < n; ++k) {
            const a = (k / n) * Math.PI * 2 + R() * 0.7;
            const rr = k === 0 ? 0 : 0.35 + R() * 0.35;
            const y = (k === 0 ? 0.93 : 0.52 + R() * 0.38) * A;
            const c = V(Math.cos(a) * rr, y, Math.sin(a) * rr);
            const from = V(0, Math.min(0.84 * A, y - 0.06 * A), 0);
            limb(from, c.clone().lerp(from, 0.2), 0.03, 0.012, 4, bark, 0.1, 0.4);
            cl(c, V(0.34, 0.22, 0.34), 12, 0.52, CELLS.pine, crown, 0.9, 1);
        }
    } else if (type === 1) {
        // Blue gum: tall, pale, forked trunk; open crown of hanging leaf clumps.
        const bark = new THREE.Color(0.92, 0.88, 0.8);
        const fork = V(0.04, 0.5 * A, 0);
        trunk(V(0, -0.05, 0), fork, 0.1, 0.075, 7, bark);
        const leaders = [V(0.28, 0.92 * A, 0.1), V(-0.24, 0.86 * A, -0.14), V(0.02, 0.97 * A, 0.24)];
        for (const l of leaders) limb(fork, l, 0.055, 0.02, 5, bark, 0.05, 0.3);
        const crown = V(0, 0.76 * A, 0);
        const n = lod === 2 ? 6 : 11;
        for (let k = 0; k < n; ++k) {
            const l = leaders[k % 3]!;
            const from = fork.clone().lerp(l, 0.45 + R() * 0.55);
            const a = R() * Math.PI * 2;
            const c = from.clone().add(V(Math.cos(a) * (0.2 + R() * 0.3), R() * 0.2, Math.sin(a) * (0.2 + R() * 0.3)));
            limb(from, c, 0.018, 0.008, 3, bark, 0.3, 0.6);
            cl(c, V(0.3, 0.3, 0.3), 10, 0.5, CELLS.eucalyptus, crown, 0.9, -1);
        }
    } else {
        // Canary Island date palm: stout trunk, a ball of arching fronds.
        const bark = new THREE.Color(0.66, 0.58, 0.46);
        const top = V(0, 0.8 * A, 0);
        trunk(V(0, -0.05, 0), top, 0.2, 0.16, 9, bark);
        if (lod === 0) b.limb(top, V(0, 0.86 * A, 0), 0.2, 0.1, 9, new THREE.Color(0.55, 0.52, 0.32), 0.05, 0.1);
        const crown = V(0, 0.86 * A, 0);
        const cell = CELLS.frond;
        const N = lod === 0 ? 26 : lod === 1 ? 12 : 7;
        const segs = lod === 0 ? 4 : lod === 1 ? 2 : 1;
        for (let k = 0; k < N; ++k) {
            const az = k * 2.39996 + R() * 0.2;
            // Young fronds point up, old ones droop.
            let e = 0.9 - (k / N) * 1.5 + (R() - 0.5) * 0.2;
            const L = 1.0 + R() * 0.15;
            const dir = V(Math.cos(az), 0, Math.sin(az));
            const side = V(-dir.z, 0, dir.x);
            let p = crown.clone();
            const pts: THREE.Vector3[] = [p.clone()];
            for (let s = 0; s < segs; ++s) {
                p = p.clone().add(dir.clone().multiplyScalar(Math.cos(e) * (L / segs))).add(V(0, Math.sin(e) * (L / segs), 0));
                pts.push(p);
                e -= 0.28 * (4 / segs);
            }
            const tint = new THREE.Color().setScalar(0.85 + R() * 0.2);
            if (k > N * 0.85) tint.setRGB(1.25, 1.05, 0.7);
            for (let s = 0; s < segs; ++s) {
                const a = pts[s]!;
                const c = pts[s + 1]!;
                const w0 = 0.26 * Math.sin(((s + 0.15) / segs) * Math.PI * 0.9 + 0.3);
                const w1 = 0.26 * Math.sin(((s + 1.15) / segs) * Math.PI * 0.9 + 0.3);
                const u0 = (cell.x + 8 + (s / segs) * (cell.w - 16)) / AW;
                const u1 = (cell.x + 8 + ((s + 1) / segs) * (cell.w - 16)) / AW;
                const vm = (cell.y + cell.h / 2) / AH;
                const vs = (cell.h / 2 - 8) / AH;
                // V-fold: the leaflets rise a little on both sides of the rachis.
                for (const sd of [-1, 1]) {
                    const ea = a.clone().addScaledVector(side, sd * w0).add(V(0, w0 * 0.25, 0));
                    const ec = c.clone().addScaledVector(side, sd * w1).add(V(0, w1 * 0.25, 0));
                    const nrm = V(0, 1, 0).addScaledVector(side, -sd * 0.3).normalize();
                    const sw0 = 0.3 + (s / segs) * 0.7;
                    const sw1 = 0.3 + ((s + 1) / segs) * 0.7;
                    const i0 = b.vert(a, nrm, u0, vm, tint, sw0);
                    const i1 = b.vert(c, nrm, u1, vm, tint, sw1);
                    const i2 = b.vert(ec, nrm, u1, vm + sd * vs * (w1 / 0.26), tint, sw1);
                    const i3 = b.vert(ea, nrm, u0, vm + sd * vs * (w0 / 0.26), tint, sw0);
                    b.idx.push(i0, i1, i2, i0, i2, i3);
                }
            }
        }
    }
    return b.geometry(A);
}

/** An understory shrub (height 1, radius 1): a dome of leaf cards. */
export function shrubTemplate(): THREE.BufferGeometry {
    const R = rng(77);
    const b = new TreeBuilder();
    const center = V(0, 0.2, 0);
    for (let k = 0; k < 5; ++k) {
        const a = (k / 5) * Math.PI + R() * 0.3;
        const tilt = k < 3 ? 0 : 0.9;
        // Upright cards crossing at the middle, two leaning ones over the top.
        const ax = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.95);
        const ay = V(-Math.sin(a) * Math.sin(tilt), Math.cos(tilt), Math.cos(a) * Math.sin(tilt)).multiplyScalar(0.55);
        const c = V(0, 0.5 + (k < 3 ? 0 : 0.1), 0);
        const ao = k < 3 ? 0.75 : 1;
        b.card(c, ax, ay, CELLS.shrub, center, new THREE.Color(ao, ao, ao), 1, 0.8);
    }
    return b.geometry(1);
}

// ------------------------------------------------------------------------------ material

/** Leaf / bark material: alpha to coverage, authored crown normals, translucency, wind. */
export function treeMaterial(atlas: THREE.Texture, sunDir: THREE.Vector3, time: { value: number }): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
        map: atlas,
        alphaTest: 0.5,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
        envMapIntensity: 0.5,
    });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.treeTime = time;
        sh.uniforms.treeSun = { value: sunDir };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float sway;\nattribute float leaf;\nuniform float treeTime;\nvarying float vSway;\nvarying vec3 vTreeW;')
            // The per-tree tint is the crown's: bark keeps its own colour.
            .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix( color.xyz, vColor.xyz, leaf );\n#endif')
            .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                vSway = sway;
                {
                    #ifdef USE_INSTANCING
                        vec2 ip = instanceMatrix[3].xz;
                    #else
                        vec2 ip = vec2( 0.0 );
                    #endif
                    float ph = dot( ip, vec2( 0.00031, 0.00047 ) );
                    float w = sin( treeTime * 1.1 + ph ) * 0.6 + sin( treeTime * 2.3 + ph * 1.7 ) * 0.4;
                    float f = sin( treeTime * 7.0 + position.x * 40.0 + position.z * 37.0 + ph ) * 0.01;
                    transformed.x += sway * ( w * 0.015 + f );
                    transformed.z += sway * ( w * 0.01 - f );
                }`,
            )
            .replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                #ifdef USE_INSTANCING
                    vTreeW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
                #else
                    vTreeW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
                #endif`,
            );
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 treeSun;\nvarying float vSway;\nvarying vec3 vTreeW;')
            // Crown normals are authored: don't flip them on back faces.
            .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );')
            // Leaves are dark and matte: little sky sheen (it read as frost on the crowns' tops).
            .replace(
                '#include <lights_physical_fragment>',
                '#include <lights_physical_fragment>\nmaterial.specularColor *= 0.15;\nmaterial.specularColorBlended *= 0.15;\nmaterial.specularF90 = 0.15;',
            )
            .replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                {
                    // Low sun shining through the leaves facing away from it (only the leaf cards sway).
                    vec3 V = normalize( vTreeW - cameraPosition );
                    float tr = pow( max( dot( V, treeSun ), 0.0 ), 4.0 );
                    float back = clamp( -dot( normal, ( viewMatrix * vec4( treeSun, 0.0 ) ).xyz ), 0.0, 1.0 );
                    totalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 0.85, 0.55 ) * tr * back * 0.6 * step( 0.5, vSway );
                }`,
            );
    };
    return mat;
}
