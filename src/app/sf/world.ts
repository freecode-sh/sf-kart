/**
 * Loads the baked San Francisco scenery (public/data/sf, made by tools/sf/bakeWorld.ts and
 * bakeImagery.ts): the multi-resolution terrain cells, land cover, imagery, buildings, trees and
 * streets. Also answers ground-height queries.
 */

import * as THREE from 'three';
import { DATA_BASE } from '../paths';

export interface GridInfo {
    e0: number;
    e1: number;
    n0: number;
    n1: number;
    step: number;
    nx: number;
    nz: number;
    file: string;
}

/** Terrain cells (tools/sf/terrainBake.ts): `cell` m squares, each sampled every steps[level] m. */
export interface TerrainInfo {
    e0: number;
    n1: number;
    cell: number;
    cx: number;
    cz: number;
    steps: number[];
    /** Per cell (row-major, row 0 north): index into `steps`, 255 = no cell (deep water). */
    levels: number[];
    file: string;
}

export interface ImageryInfo {
    /** n x n tiles over the box (tile (i, j): column i from the west, row j from the north). */
    base: { e0: number; e1: number; n0: number; n1: number; n: number; pattern: string };
    /** 0.3 m tiles of the cells along the course: atlas slot per cell (-1 = none). */
    detail: { tile: number; pad: number; per: number; atlasSize: number; atlases: string[]; page: number[] };
}

export interface WorldJson {
    attribution: string;
    scale: number;
    seaY: number;
    terrain: TerrainInfo;
    landcover: GridInfo;
    imagery: ImageryInfo;
    far: GridInfo & { image: string };
    /**
     * Footprints (x, z pairs), base y, height, pitched roof rise (0 = flat), kind, roof colour (-1 =
     * none), facade kind per edge (0 side, 1 street front, 2 party wall), lot zoning (tools/sf/buildingsBake.ts).
     */
    buildings: { n: number[]; pts: number[]; base: number[]; h: number[]; roof: number[]; kind: number[]; roofColor?: number[]; edges?: string[]; zone?: number[] };
    /** x, y, z, scale * 100, type (0 cypress, 1 eucalyptus, 2 pine, 3 broadleaf, 4 palm; + 8 far). */
    trees: number[];
    /** Per tree: its crown radius (dm; tools/sf/treesBake.ts). */
    treeCrowns?: number[];
    /** Low vegetation: x, z, kind (0 brush, 1 low green, 2 dune grass) + 4 * (radius dm + 32 * height dm) (tools/sf/shrubsBake.ts). */
    shrubs?: number[];
    streets: { w: number; kind: number; pts: number[] }[];
    /** Water depth (m below sea level) on a coarse grid, for the sea's colour. */
    depth?: GridInfo & { max: number };
}

export const LANDCOVER = { urban: 0, grass: 1, forest: 2, sand: 3, scrub: 4, water: 5, paved: 6 } as const;

export class SfWorld {
    readonly far: Float32Array;
    /** Per terrain cell: its samples (world y), or null. */
    readonly cells: (Float32Array | null)[] = [];
    /** Crown radius (m) per tree position (keyed as baked: sections may drop trees at load time). */
    private readonly crowns = new Map<number, number>();

    private constructor(
        readonly json: WorldJson,
        terrain: Int16Array,
        readonly landcover: Uint8Array,
        far: Float32Array,
        readonly baseImages: THREE.Texture[],
        readonly detailAtlases: THREE.Texture[],
        readonly farImage: THREE.Texture,
        readonly depth: Uint8Array | null,
    ) {
        this.far = far;
        const tc = json.treeCrowns;
        if (tc) for (let k = 0; k < tc.length; ++k) this.crowns.set(json.trees[k * 5]! * 1e7 + json.trees[k * 5 + 2]!, tc[k]! / 10);
        const t = json.terrain;
        let o = 0;
        for (const lv of t.levels) {
            if (lv === 255) {
                this.cells.push(null);
                continue;
            }
            const m = t.cell / t.steps[lv]! + 1;
            this.cells.push(Float32Array.from(terrain.subarray(o, o + m * m)));
            o += m * m;
        }
    }

    static async load(root = `${DATA_BASE}/sf`): Promise<SfWorld> {
        const bytes = async (f: string) => {
            const r = await fetch(`${root}/${f}`);
            if (!r.ok) throw new Error(`${root}/${f}: ${r.status}`);
            return r.arrayBuffer();
        };
        const json = (await (await fetch(`${root}/world.json`)).json()) as WorldJson;
        const loader = new THREE.TextureLoader();
        const tex = (f: string, flipY = true) =>
            new Promise<THREE.Texture>((res, rej) =>
                loader.load(
                    `${root}/${f}`,
                    (t) => {
                        t.colorSpace = THREE.SRGBColorSpace;
                        t.anisotropy = 8;
                        t.flipY = flipY;
                        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
                        res(t);
                    },
                    undefined,
                    rej,
                ),
            );
        const b = json.imagery.base;
        const imgs: Promise<THREE.Texture>[] = [];
        for (let j = 0; j < b.n; ++j) for (let i = 0; i < b.n; ++i) imgs.push(tex(b.pattern.replace('{i}', String(i)).replace('{j}', String(j))));
        const [terrain, lc, far, baseImages, detailAtlases, farImage, depth] = await Promise.all([
            bytes(json.terrain.file),
            bytes(json.landcover.file),
            bytes(json.far.file),
            Promise.all(imgs),
            // Atlas rows run north → south in the image, like the page table: no flip.
            Promise.all(json.imagery.detail.atlases.map((f) => tex(f, false))),
            tex(json.far.image),
            json.depth ? bytes(json.depth.file) : Promise.resolve(null),
        ]);
        for (const t of detailAtlases) t.anisotropy = 4;
        return new SfWorld(json, new Int16Array(terrain), new Uint8Array(lc), new Float32Array(far), baseImages, detailAtlases, farImage, depth ? new Uint8Array(depth) : null);
    }

    /**
     * Re-stitches the cells after the height samples were edited (sections carving the ground at
     * load time): a finer cell's edge follows its coarser neighbour's, as in tools/sf/terrainBake.ts,
     * so the meshes join without cracks.
     */
    stitch(): void {
        const t = this.json.terrain;
        const edge = (m: number, side: 'n' | 's' | 'w' | 'e', k: number) => (side === 'n' ? k : side === 's' ? (m - 1) * m + k : side === 'w' ? k * m : k * m + m - 1);
        const opposite = { n: 's', s: 'n', w: 'e', e: 'w' } as const;
        // Coarsest first, so a chain of refinements sees final coarse edges.
        const order = [...t.levels.keys()].filter((c) => this.cells[c]).sort((a, b) => t.levels[b]! - t.levels[a]!);
        for (const c of order) {
            const h = this.cells[c]!;
            const i = c % t.cx;
            const j = Math.floor(c / t.cx);
            const lv = t.levels[c]!;
            const m = t.cell / t.steps[lv]! + 1;
            for (const [side, di, dj] of [
                ['n', 0, -1],
                ['s', 0, 1],
                ['w', -1, 0],
                ['e', 1, 0],
            ] as const) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= t.cx || nj >= t.cz) continue;
                const nh = this.cells[nj * t.cx + ni];
                const nl = t.levels[nj * t.cx + ni]!;
                if (!nh || nl <= lv) continue;
                const nm = t.cell / t.steps[nl]! + 1;
                const ratio = (m - 1) / (nm - 1);
                for (let k = 0; k < m; ++k) {
                    const f = k / ratio;
                    const k0 = Math.min(nm - 2, Math.floor(f));
                    const a = nh[edge(nm, opposite[side], k0)]!;
                    const b = nh[edge(nm, opposite[side], k0 + 1)]!;
                    h[edge(m, side, k)] = a + (b - a) * (f - k0);
                }
            }
        }
    }

    /** Frees the imagery textures (the meshes and materials belong to terrain.ts). */
    dispose(): void {
        for (const t of [...this.baseImages, ...this.detailAtlases, this.farImage]) t.dispose();
    }

    /** Baked crown radius (m) of the tree at world (x, z), if known. */
    crownAt = (x: number, z: number): number | undefined => this.crowns.get(x * 1e7 + z);

    /** Base image tile (i from the west, j from the north). */
    baseImage(i: number, j: number): THREE.Texture {
        return this.baseImages[j * this.json.imagery.base.n + i]!;
    }

    /** Terrain height (world y) at world (x, z): the core cells where they are, else the far grid. */
    groundY = (x: number, z: number): number => {
        const s = this.json.scale;
        const e = x / s;
        const n = -z / s;
        const y = this.coreY(e, n);
        if (y !== null) return y;
        const f = this.json.far;
        if (e >= f.e0 && e <= f.e1 && n >= f.n0 && n <= f.n1) return sample(this.far, f, e, n);
        return this.json.seaY - 2400;
    };

    /** Core terrain height (world y) at (e, n) meters, or null outside the cells. */
    coreY(e: number, n: number): number | null {
        const t = this.json.terrain;
        const i = Math.floor((e - t.e0) / t.cell);
        const j = Math.floor((t.n1 - n) / t.cell);
        if (i < 0 || j < 0 || i >= t.cx || j >= t.cz) return null;
        const h = this.cells[j * t.cx + i];
        if (!h) return null;
        const st = t.steps[t.levels[j * t.cx + i]!]!;
        const m = t.cell / st + 1;
        const fx = (e - (t.e0 + i * t.cell)) / st;
        const fy = (t.n1 - j * t.cell - n) / st;
        const a0 = Math.min(m - 2, Math.floor(fx));
        const b0 = Math.min(m - 2, Math.floor(fy));
        const a = fx - a0;
        const b = fy - b0;
        const k = b0 * m + a0;
        return (h[k]! * (1 - a) + h[k + 1]! * a) * (1 - b) + (h[k + m]! * (1 - a) + h[k + m + 1]! * a) * b;
    }

    /** Land cover class at world (x, z) (nearest grid vertex; urban outside). */
    landcoverAt(x: number, z: number): number {
        const c = this.json.landcover;
        const i = Math.round((x / this.json.scale - c.e0) / c.step);
        const j = Math.round((c.n1 + z / this.json.scale) / c.step);
        if (i < 0 || j < 0 || i >= c.nx || j >= c.nz) return LANDCOVER.urban;
        return this.landcover[j * c.nx + i]!;
    }
}

/** Bilinear sample of a grid whose row 0 is the north edge (n1). */
function sample(h: Float32Array, g: GridInfo, e: number, n: number): number {
    const fi = (e - g.e0) / g.step;
    const fj = (g.n1 - n) / g.step;
    const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(g.nz - 2, Math.floor(fj)));
    const a = Math.max(0, Math.min(1, fi - i));
    const b = Math.max(0, Math.min(1, fj - j));
    const k = j * g.nx + i;
    return (h[k]! * (1 - a) + h[k + 1]! * a) * (1 - b) + (h[k + g.nx]! * (1 - a) + h[k + g.nx + 1]! * a) * b;
}
