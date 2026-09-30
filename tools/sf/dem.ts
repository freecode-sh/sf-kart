/**
 * Elevation model from AWS Terrain Tiles (Terrarium encoding: h = R * 256 + G + B / 256 - 32768 m),
 * mosaicked from .context/sf/terrain/<z>/, sampled bilinearly in meters east/north of ORIGIN.
 * Bathymetry is included (negative in the bay).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fromMeters, tileRange, tileXY } from './geo';

export class Dem {
    private constructor(
        private readonly z: number,
        private readonly x0: number,
        private readonly y0: number,
        private readonly w: number,
        private readonly h: number,
        private readonly data: Float32Array,
    ) {}

    static load(dir: string, z = 14): Dem {
        const r = tileRange(z);
        const tw = r.x1 - r.x0 + 1;
        const th = r.y1 - r.y0 + 1;
        const W = tw * 256;
        const H = th * 256;
        const data = new Float32Array(W * H);
        for (let ty = 0; ty < th; ++ty)
            for (let tx = 0; tx < tw; ++tx) {
                const f = join(dir, String(z), `${r.x0 + tx}_${r.y0 + ty}.png`);
                if (!existsSync(f)) throw new Error(`missing terrain tile ${f} (run tools/sf/fetch.ts terrain)`);
                const rgb = execFileSync('magick', [f, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 24 });
                for (let py = 0; py < 256; ++py)
                    for (let px = 0; px < 256; ++px) {
                        const i = (py * 256 + px) * 3;
                        data[(ty * 256 + py) * W + tx * 256 + px] = rgb[i]! * 256 + rgb[i + 1]! + rgb[i + 2]! / 256 - 32768;
                    }
            }
        return new Dem(z, r.x0, r.y0, W, H, data);
    }

    /** Elevation (m) at meters east/north of ORIGIN. */
    at(e: number, n: number): number {
        const [lat, lon] = fromMeters(e, n);
        const [tx, ty] = tileXY(lat, lon, this.z);
        const fx = (tx - this.x0) * 256 - 0.5;
        const fy = (ty - this.y0) * 256 - 0.5;
        const ix = Math.max(0, Math.min(this.w - 2, Math.floor(fx)));
        const iy = Math.max(0, Math.min(this.h - 2, Math.floor(fy)));
        const ax = Math.max(0, Math.min(1, fx - ix));
        const ay = Math.max(0, Math.min(1, fy - iy));
        const d = this.data;
        const k = iy * this.w + ix;
        const top = d[k]! * (1 - ax) + d[k + 1]! * ax;
        const bot = d[k + this.w]! * (1 - ax) + d[k + this.w + 1]! * ax;
        return top * (1 - ay) + bot * ay;
    }
}
