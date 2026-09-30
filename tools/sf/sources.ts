/**
 * Downloaded source files for the San Francisco course (tools/sf/fetch.ts puts them in .context/sf/).
 */

import { SOURCE_URL } from '../../src/app/brand';

/** User-Agent of the downloads, so the data services can see who's asking. */
export const USER_AGENT = `sf-kart-tools (${SOURCE_URL})`;

/** USGS 3DEP 1 m bare earth (SF 2023, Marin 2018) and NOAA CUDEM 1/9" topobathy, in dem/. */
export const DEM_FILES = {
    sf: 'USGS_1M_10_x54y419_CA_SanFrancisco_B23.tif',
    marin: 'USGS_1m_x54y419_CA_NoCal_Wildfires_B5b_QL1_2018.tif',
    cudem: 'ncei19_n38x00_w122x50_2022v1.tif',
};

/**
 * NOAA NGS 4-band (RGB + near infrared) 0.25 m orthoimagery, San Francisco, 5–8 February 2025: the
 * 3 km UTM tiles (NAD83(2011) UTM 10N, named by their west / north edges) covering the core, in noaa/.
 */
export const NOAA_TILES = ['543000e4185000n', '543000e4188000n', '546000e4185000n', '546000e4188000n', '549000e4185000n', '549000e4188000n', '549000e4191000n'];
