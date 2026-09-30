/**
 * GeoTIFF rasters sampled in course meters (east / north of geo.ORIGIN): elevation models (USGS 3DEP
 * 1 m, NOAA CUDEM) and multi-band orthoimagery (NOAA NGS). Reads only the window around a box of
 * interest; reprojects per sample with proj4 (NAD83 is taken as WGS84: under 1.5 m here).
 */

import { fromFile, type GeoTIFFImage } from 'geotiff';
import proj4 from 'proj4';
import { fromMeters } from './geo';

proj4.defs('EPSG:26910', '+proj=utm +zone=10 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs');
proj4.defs('EPSG:6339', '+proj=utm +zone=10 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs');
// San Francisco CS13 (the city's low-distortion grid; NASA WERK's lidar products).
proj4.defs('EPSG:7131', '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs');

export type MBox = { e0: number; e1: number; n0: number; n1: number };

/** Source CRS of a GeoTIFF: 'geo' (lon/lat degrees) or a proj4 code. */
export function crsOf(im: GeoTIFFImage): string {
    const k = im.getGeoKeys() as Record<string, number>;
    if (k.GTModelTypeGeoKey === 2) return 'geo';
    const code = k.ProjectedCSTypeGeoKey;
    if (code === 26910 || code === 6339 || code === 7131) return `EPSG:${code}`;
    throw new Error(`unsupported CRS ${JSON.stringify(k)}`);
}

/** Course meters → source CRS coordinates. */
export function projector(crs: string): (e: number, n: number) => [number, number] {
    if (crs === 'geo')
        return (e, n) => {
            const [lat, lon] = fromMeters(e, n);
            return [lon, lat];
        };
    const p = proj4('EPSG:4326', crs);
    return (e, n) => {
        const [lat, lon] = fromMeters(e, n);
        return p.forward([lon, lat]) as [number, number];
    };
}

/** Pixel window of the source covering a course-meter box (plus `pad` pixels). */
function windowOf(im: GeoTIFFImage, box: MBox, pad: number): [number, number, number, number] | null {
    const to = projector(crsOf(im));
    const [ox, oy] = im.getOrigin();
    const [rx, ry] = im.getResolution();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let a = 0; a <= 8; ++a)
        for (const [e, n] of [
            [box.e0 + ((box.e1 - box.e0) * a) / 8, box.n0],
            [box.e0 + ((box.e1 - box.e0) * a) / 8, box.n1],
            [box.e0, box.n0 + ((box.n1 - box.n0) * a) / 8],
            [box.e1, box.n0 + ((box.n1 - box.n0) * a) / 8],
        ] as [number, number][]) {
            const [x, y] = to(e, n);
            const px = (x - ox!) / rx!;
            const py = (y - oy!) / ry!;
            x0 = Math.min(x0, px);
            x1 = Math.max(x1, px);
            y0 = Math.min(y0, py);
            y1 = Math.max(y1, py);
        }
    const w = im.getWidth();
    const h = im.getHeight();
    const win: [number, number, number, number] = [
        Math.max(0, Math.floor(x0) - pad),
        Math.max(0, Math.floor(y0) - pad),
        Math.min(w, Math.ceil(x1) + pad + 1),
        Math.min(h, Math.ceil(y1) + pad + 1),
    ];
    return win[2] > win[0] && win[3] > win[1] ? win : null;
}

/** A single-band float raster (elevation). NaN where the source has no data. */
export class HeightRaster {
    private constructor(
        readonly name: string,
        private readonly to: (e: number, n: number) => [number, number],
        private readonly ox: number,
        private readonly oy: number,
        private readonly rx: number,
        private readonly ry: number,
        private readonly w: number,
        private readonly h: number,
        private readonly data: Float32Array,
    ) {}

    /** Loads the part of `file` covering `box` (or null if it doesn't overlap). */
    static async load(file: string, box: MBox, valid: (v: number) => boolean = (v) => v > -1000): Promise<HeightRaster | null> {
        const tif = await fromFile(file);
        const im = await tif.getImage();
        const win = windowOf(im, box, 2);
        if (!win) return null;
        const [raw] = (await im.readRasters({ window: win, samples: [0] })) as unknown as [Float32Array];
        const data = Float32Array.from(raw!, (v) => (valid(v) ? v : NaN));
        const [ox, oy] = im.getOrigin();
        const [rx, ry] = im.getResolution();
        await tif.close();
        return new HeightRaster(file.split('/').pop()!, projector(crsOf(im)), ox! + win[0] * rx!, oy! + win[1] * ry!, rx!, ry!, win[2] - win[0], win[3] - win[1], data);
    }

    /** Bilinear value at course meters (e, n); NaN if any of the four samples is missing. */
    at(e: number, n: number): number {
        const [x, y] = this.to(e, n);
        const fx = (x - this.ox) / this.rx - 0.5;
        const fy = (y - this.oy) / this.ry - 0.5;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        if (ix < 0 || iy < 0 || ix + 1 >= this.w || iy + 1 >= this.h) return NaN;
        const a = fx - ix;
        const b = fy - iy;
        const d = this.data;
        const k = iy * this.w + ix;
        return (d[k]! * (1 - a) + d[k + 1]! * a) * (1 - b) + (d[k + this.w]! * (1 - a) + d[k + this.w + 1]! * a) * b;
    }
}

/**
 * Multi-band 8-bit imagery from a set of GeoTIFF tiles (e.g. the NOAA NGS 3 km tiles). Reads each
 * requested window at a chosen ground resolution into an RGBA-ish float buffer.
 */
export class ImageTiles {
    private constructor(private readonly tiles: { file: string; im: GeoTIFFImage; close: () => Promise<void> }[]) {}

    static async open(files: string[]): Promise<ImageTiles> {
        const tiles = [];
        for (const f of files) {
            const tif = await fromFile(f);
            tiles.push({ file: f, im: await tif.getImage(), close: async () => void (await tif.close()) });
        }
        return new ImageTiles(tiles);
    }

    async close(): Promise<void> {
        for (const t of this.tiles) await t.close();
    }

    /**
     * Samples `bands` over a course-meter box into a W x H grid (row 0 = north), bilinear, at the
     * source's full resolution windows. Returns per-band Float32 arrays and a coverage mask.
     */
    async sample(box: MBox, W: number, H: number, bands: number[]): Promise<{ data: Float32Array[]; cover: Uint8Array }> {
        const out = bands.map(() => new Float32Array(W * H));
        const cover = new Uint8Array(W * H);
        for (const t of this.tiles) {
            const win = windowOf(t.im, box, 2);
            if (!win) continue;
            const ww = win[2] - win[0];
            const wh = win[3] - win[1];
            const ras = (await t.im.readRasters({ window: win, samples: bands })) as unknown as Uint8Array[];
            const to = projector(crsOf(t.im));
            const [ox, oy] = t.im.getOrigin();
            const [rx, ry] = t.im.getResolution();
            const x0 = ox! + win[0] * rx!;
            const y0 = oy! + win[1] * ry!;
            // Transform is smooth: project a coarse lattice of pixel centers and interpolate.
            const G = 16;
            const gx = Math.ceil(W / G) + 1;
            const gy = Math.ceil(H / G) + 1;
            const lat = new Float64Array(gx * gy * 2);
            for (let j = 0; j < gy; ++j)
                for (let i = 0; i < gx; ++i) {
                    const e = box.e0 + ((box.e1 - box.e0) * (i * G + 0.5)) / W;
                    const n = box.n1 - ((box.n1 - box.n0) * (j * G + 0.5)) / H;
                    const [x, y] = to(e, n);
                    lat[(j * gx + i) * 2] = (x - x0) / rx! - 0.5;
                    lat[(j * gx + i) * 2 + 1] = (y - y0) / ry! - 0.5;
                }
            for (let py = 0; py < H; ++py) {
                const gj = Math.min(gy - 2, Math.floor(py / G));
                const bj = (py - gj * G) / G;
                for (let px = 0; px < W; ++px) {
                    const k = py * W + px;
                    if (cover[k]) continue;
                    const gi = Math.min(gx - 2, Math.floor(px / G));
                    const ai = (px - gi * G) / G;
                    const l = (jj: number, ii: number, c: number) => lat[((gj + jj) * gx + gi + ii) * 2 + c]!;
                    const fx = (l(0, 0, 0) * (1 - ai) + l(0, 1, 0) * ai) * (1 - bj) + (l(1, 0, 0) * (1 - ai) + l(1, 1, 0) * ai) * bj;
                    const fy = (l(0, 0, 1) * (1 - ai) + l(0, 1, 1) * ai) * (1 - bj) + (l(1, 0, 1) * (1 - ai) + l(1, 1, 1) * ai) * bj;
                    const ix = Math.floor(fx);
                    const iy = Math.floor(fy);
                    if (ix < 0 || iy < 0 || ix + 1 >= ww || iy + 1 >= wh) continue;
                    const a = fx - ix;
                    const b = fy - iy;
                    const q = iy * ww + ix;
                    let blank = true;
                    for (let c = 0; c < bands.length; ++c) {
                        const r = ras[c]!;
                        const v = (r[q]! * (1 - a) + r[q + 1]! * a) * (1 - b) + (r[q + ww]! * (1 - a) + r[q + ww + 1]! * a) * b;
                        out[c]![k] = v;
                        if (r[q] !== 0 || r[q + ww + 1] !== 0) blank = false;
                    }
                    // Tiles are zero outside their data (the edges of the survey).
                    if (!blank) cover[k] = 1;
                }
            }
        }
        return { data: out, cover };
    }
}
