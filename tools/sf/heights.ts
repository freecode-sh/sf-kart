/**
 * The San Francisco elevation model, in meters above mean sea level at course meters (e, n):
 *
 *   1. USGS 3DEP 1 m bare earth, CA_SanFrancisco_B23 (lidar flown 2023)       the city + Presidio
 *   2. USGS 3DEP 1 m bare earth, CA_NoCal_Wildfires_B5b_QL1 (2018)            Marin Headlands
 *   3. NOAA NCEI CUDEM 1/9" topobathy (~3 m, 2022)                            the bay floor, gaps
 *   4. AWS Terrain Tiles (Terrarium, z14 / z11)                               everything else
 *
 * All public domain. 3DEP and CUDEM heights are NAVD88; mean sea level at the Presidio tide station
 * (9414290) is ~0.95 m above it. Water in the 3DEP tiles is hydro-flattened to a constant (about
 * -1.07 m): those cells fall through to CUDEM so the shallows keep their depth.
 */

import { join } from 'node:path';
import { Dem } from './dem';
import { HeightRaster, type MBox } from './raster';
import { DEM_FILES } from './sources';

/** Mean sea level above NAVD88 at San Francisco (m). */
export const MSL_NAVD88 = 0.95;

export class HeightModel {
    private constructor(
        private readonly sf: HeightRaster | null,
        private readonly marin: HeightRaster | null,
        private readonly cudem: HeightRaster | null,
        private readonly terrarium: Dem,
    ) {}

    /** Loads everything needed for `box` from .context/sf (dem/ and terrain/). */
    static async load(ctx: string, box: MBox): Promise<HeightModel> {
        const dir = join(ctx, 'dem');
        const [sf, marin, cudem] = await Promise.all([
            // Hydro-flattened water sits just under -1 m NAVD88; land never does here.
            HeightRaster.load(join(dir, DEM_FILES.sf), box, (v) => v > -1.0 && v < 1000),
            // The 2018 Marin survey flattens water to about -0.4 m NAVD88.
            HeightRaster.load(join(dir, DEM_FILES.marin), box, (v) => v > 0 && v < 1000),
            HeightRaster.load(join(dir, DEM_FILES.cudem), box, (v) => v > -500 && v < 1000),
        ]);
        return new HeightModel(sf, marin, cudem, Dem.load(join(ctx, 'terrain')));
    }

    /** Height above mean sea level (m). */
    at(e: number, n: number): number {
        let v = this.sf?.at(e, n) ?? NaN;
        if (!Number.isFinite(v)) v = this.marin?.at(e, n) ?? NaN;
        if (!Number.isFinite(v)) v = this.cudem?.at(e, n) ?? NaN;
        // Terrarium matches NAVD88 here to ~0.1 m (median over land).
        return (Number.isFinite(v) ? v : this.terrarium.at(e, n)) - MSL_NAVD88;
    }
}
