/**
 * Downloads the raw map data for the San Francisco course into .context/sf/ (gitignored, ~4 GB):
 *   osm.json      OpenStreetMap roads, buildings, water, parks, trees (Overpass API, ODbL)
 *   terrain/      AWS Terrain Tiles (Terrarium PNG elevation, z14 core / z11 far field)
 *   dem/          USGS 3DEP 1 m bare earth (SF 2023, Marin 2018) + NOAA CUDEM topobathy (heights.ts)
 *   noaa/         NOAA NGS 0.25 m 4-band orthoimagery, San Francisco, February 2025 (3 km tiles)
 *   naip/         USDA NAIP orthoimagery (~0.6 m, 2022): Marin and the far field
 *   chm/          lidar canopy height etc. (USGS 3DEP 2023 processed by NASA WERK, CC0, 1 m tiles)
 *
 * All public domain except OSM. No keys.
 * Usage: npx tsx tools/sf/fetch.ts [osm] [terrain] [far] [dem] [noaa] [naip] [chm]   (all when no args)
 * DataSF (buildings, street trees, street detail): tools/sf/datasf.ts.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, FAR, fromMeters, latLonBox, tileRange } from './geo';
import { DEM_FILES, NOAA_TILES, USER_AGENT as UA } from './sources';
import { TERRAIN_BOX } from './terrainBake';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.context/sf');

async function get(url: string, init?: RequestInit): Promise<Uint8Array | null> {
    for (let attempt = 0; ; ++attempt) {
        try {
            const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } });
            // Missing tiles (open water at high zoom): the baker falls back to a lower zoom.
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`${res.status} ${url}`);
            return new Uint8Array(await res.arrayBuffer());
        } catch (e) {
            if (attempt >= 4) throw e;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
    }
}

async function osm(): Promise<void> {
    const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
    const q = `[out:json][timeout:180];
(
  way["highway"](${b});
  way["building"](${b});
  way["building:part"](${b});
  way["man_made"~"bridge|pier|breakwater"](${b});
  way["natural"~"water|coastline|wood|scrub|beach|sand|cliff|grassland|heath|wetland|bare_rock"](${b});
  relation["natural"~"water|wood|scrub|beach|wetland"](${b});
  way["water"](${b});
  way["landuse"](${b});
  relation["landuse"](${b});
  way["leisure"~"park|pitch|golf_course|garden|marina|playground|nature_reserve"](${b});
  relation["leisure"~"park|golf_course|nature_reserve"](${b});
  way["place"="island"](${b});
  way["amenity"="parking"](${b});
  node["natural"="tree"](${b});
  way["barrier"~"wall|fence|retaining_wall"](${b});
  way["railway"](${b});
);
out geom;`;
    const body = new URLSearchParams({ data: q });
    const bytes = await get('https://overpass-api.de/api/interpreter', { method: 'POST', body });
    if (!bytes) throw new Error('overpass: 404');
    writeFileSync(join(OUT, 'osm.json'), bytes);
    console.log(`osm.json: ${(bytes.length / 1e6).toFixed(1)} MB`);
}

async function tiles(
    kind: 'terrain' | 'imagery',
    z: number,
    url: (z: number, x: number, y: number) => string,
    ext: string,
    box = BBOX,
): Promise<void> {
    const dir = join(OUT, kind, String(z));
    mkdirSync(dir, { recursive: true });
    const r = tileRange(z, box);
    const jobs: [number, number][] = [];
    for (let y = r.y0; y <= r.y1; ++y) for (let x = r.x0; x <= r.x1; ++x) jobs.push([x, y]);
    let done = 0;
    const worker = async () => {
        for (;;) {
            const j = jobs.pop();
            if (!j) return;
            const f = join(dir, `${j[0]}_${j[1]}.${ext}`);
            if (!existsSync(f) && !existsSync(f + '.missing')) {
                const bytes = await get(url(z, j[0], j[1]));
                if (bytes) writeFileSync(f, bytes);
                else writeFileSync(f + '.missing', '');
            }
            if (++done % 50 === 0) console.log(`${kind} ${done}`);
        }
    };
    const total = jobs.length;
    await Promise.all(Array.from({ length: 8 }, worker));
    console.log(`${kind} z${z}: ${total} tiles`);
}

/**
 * USGS NAIP orthoimagery (public domain, ~0.6 m) for the core region as a grid of `n` x `n`
 * images of `px` pixels in plain lat/lon (EPSG:4326), which maps linearly onto the course frame.
 */
async function naip(name: string, box: { e0: number; e1: number; n0: number; n1: number }, n: number, px: number): Promise<void> {
    const dir = join(OUT, 'naip', name);
    mkdirSync(dir, { recursive: true });
    for (let j = 0; j < n; ++j)
        for (let i = 0; i < n; ++i) {
            const f = join(dir, `${i}_${j}.jpg`);
            if (existsSync(f)) continue;
            const e0 = box.e0 + ((box.e1 - box.e0) * i) / n;
            const e1 = box.e0 + ((box.e1 - box.e0) * (i + 1)) / n;
            const n0 = box.n0 + ((box.n1 - box.n0) * j) / n;
            const n1 = box.n0 + ((box.n1 - box.n0) * (j + 1)) / n;
            const [s, w] = fromMeters(e0, n0);
            const [nn, e] = fromMeters(e1, n1);
            // The server keeps pixels square in degrees (it grows the box otherwise): match the aspect.
            const h = Math.round((px * (nn - s)) / (e - w));
            const q = new URLSearchParams({
                bbox: `${w},${s},${e},${nn}`,
                bboxSR: '4326',
                imageSR: '4326',
                size: `${px},${h}`,
                format: 'jpg',
                compressionQuality: '88',
                f: 'image',
            });
            const bytes = await get(`https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?${q}`);
            if (!bytes) throw new Error(`naip ${name} ${i},${j}: 404`);
            writeFileSync(f, bytes);
            console.log(`naip ${name} ${i},${j}: ${(bytes.length / 1e6).toFixed(2)} MB`);
        }
}

/** Downloads a (large) file once, via a .part file. */
async function file(url: string, dest: string): Promise<void> {
    if (existsSync(dest)) return;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
    const part = dest + '.part';
    const out = createWriteStream(part);
    await pipeline(Readable.fromWeb(res.body as never), out);
    renameSync(part, dest);
    console.log(`${dest.split('/').pop()}: ${(statSync(dest).size / 1e6).toFixed(0)} MB`);
}

const args = process.argv.slice(2);
const want = (k: string) => args.length === 0 || args.includes(k);
mkdirSync(OUT, { recursive: true });
if (want('osm')) await osm();
if (want('terrain')) await tiles('terrain', 14, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 'png');
if (want('naip')) {
    await naip('terrain', TERRAIN_BOX, 4, 2048);
    await naip('far', FAR, 1, 2048);
}
if (want('far'))
    await tiles('terrain', 11, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 'png', latLonBox(FAR));
if (want('dem')) {
    const dir = join(OUT, 'dem');
    mkdirSync(dir, { recursive: true });
    const urls = [
        `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_SanFrancisco_B23/TIFF/${DEM_FILES.sf}`,
        `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_NoCal_Wildfires_B5b_QL1_2018/TIFF/${DEM_FILES.marin}`,
        `https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/CA/${DEM_FILES.cudem}`,
    ];
    for (const u of urls) await file(u, join(dir, u.split('/').pop()!));
}
if (want('chm')) {
    // The STAC collection's items over the bbox, each a 5-band 1 m GeoTIFF (band 3: canopy height).
    const dir = join(OUT, 'chm');
    mkdirSync(dir, { recursive: true });
    const q = new URLSearchParams({ bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, limit: '1000' });
    const items = (await (await fetch(`https://nationaldataplatform.org/stac/collections/nasa-werk-dem-ca-sanfrancisco-1-b23/items?${q}`)).json()) as {
        features: { assets: { data: { href: string } } }[];
    };
    for (const f of items.features) await file(f.assets.data.href, join(dir, f.assets.data.href.split('/').pop()!));
    console.log(`chm: ${items.features.length} tiles`);
}
if (want('noaa')) {
    const dir = join(OUT, 'noaa');
    mkdirSync(dir, { recursive: true });
    for (const t of NOAA_TILES) await file(`https://coastalimagery.blob.core.windows.net/digitalcoast/SanFranciscoCA_RGBN_2025_10318/${t}.tif`, join(dir, `${t}.tif`));
}
