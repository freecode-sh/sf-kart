/**
 * Downloads the DataSF (City and County of San Francisco open data, PDDL) datasets for the course
 * bbox into .context/sf/datasf/<name>.geojson (skipped if already present): street detail, building
 * footprints with lidar heights, the parcels (lots: bakeWorld.ts splits the block-merged footprints
 * into one building per lot) and the street tree inventory.
 *
 * Usage: npx tsx tools/sf/datasf.ts [--force]
 *
 * Then: npx tsx tools/sf/bakeStreetDetail.ts   (→ public/data/sf/detail.json) and bakeWorld.ts
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX } from './geo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATASF_DIR = join(ROOT, '.context/sf/datasf');

/**
 * name → Socrata id and its geometry column (from https://data.sf.gov/api/views/<id>.json), or a
 * lat/lon column pair for datasets without one; optionally an extra filter and a column selection.
 */
export const DATASETS: Record<string, { id: string; geom?: string; latLon?: [string, string]; where?: string; select?: string }> = {
    crosswalks: { id: 'g9zy-srvv', geom: 'shape' }, // Continental Crosswalks (points)
    curbs: { id: 'emxt-b6yg', geom: 'the_geom' }, // Curbs and Islands (lines)
    sidewalks: { id: '4g86-grxu', geom: 'shape' }, // Sidewalk Widths (2014) (lines + widths)
    curbRamps: { id: 'ch9w-7kih', geom: 'location' }, // Curb Ramps (points)
    bike: { id: 'ygmz-vaxd', geom: 'shape' }, // MTA Bike Network Linear Features
    meters: { id: '8vzz-qzz9', geom: 'shape' }, // Parking Meters (points)
    streets: { id: '3psu-pn9h', geom: 'line' }, // Streets – Active and Retired (centerlines)
    buildings: { id: 'ynuv-fyni', geom: 'shape' }, // Building Footprints (2010 lidar heights)
    parcels: { id: 'acdm-wktn', geom: 'shape', where: "active='true'", select: 'blklot,zoning_code,shape' }, // Parcels – Active and Retired
    trees: { id: 'tkzw-k3nq', latLon: ['latitude', 'longitude'] }, // Street Tree Inventory (points)
};

export type DatasetName = keyof typeof DATASETS;

// data.sfgov.org now redirects here.
const HOST = 'https://data.sf.gov';

async function download(name: DatasetName, force: boolean): Promise<void> {
    const file = join(DATASF_DIR, `${name}.geojson`);
    if (!force && existsSync(file) && statSync(file).size > 100) {
        console.log(`${name}: have ${file}`);
        return;
    }
    const { id, geom, latLon, where: extra, select } = DATASETS[name]!;
    const { north: n, west: w, south: s, east: e } = BBOX;
    const box = geom ? `within_box(${geom}, ${n}, ${w}, ${s}, ${e})` : `${latLon![0]} between ${s} and ${n} and ${latLon![1]} between ${w} and ${e}`;
    const q = new URLSearchParams({ $where: extra ? `${box} AND ${extra}` : box, $limit: '50000', ...(select ? { $select: select } : {}) });
    const url = `${HOST}/resource/${id}.geojson?${q}`;
    for (let attempt = 1; ; ++attempt) {
        try {
            const r = await fetch(url, { redirect: 'follow' });
            if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
            const text = await r.text();
            const fc = JSON.parse(text) as { features: unknown[] };
            writeFileSync(file, text);
            console.log(`${name}: ${fc.features.length} features, ${(text.length / 1e6).toFixed(2)} MB`);
            if (fc.features.length >= 50000) console.warn(`${name}: hit the 50000 limit — paginate`);
            return;
        } catch (err) {
            if (attempt >= 3) throw new Error(`${name} (${url}): ${String(err)}`);
            console.warn(`${name}: retry ${attempt} (${String(err).slice(0, 120)})`);
            await new Promise((res) => setTimeout(res, 2000 * attempt));
        }
    }
}

async function main(): Promise<void> {
    mkdirSync(DATASF_DIR, { recursive: true });
    const force = process.argv.includes('--force');
    for (const name of Object.keys(DATASETS) as DatasetName[]) await download(name, force);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
