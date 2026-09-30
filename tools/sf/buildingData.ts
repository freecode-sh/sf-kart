/**
 * Building heights from DataSF's Building Footprints (City and County of San Francisco, PDDL): each
 * footprint carries statistics of the 2010 airborne lidar (50 cm) over it, in particular the median
 * height above ground (walls) and the maximum (roof ridge, chimneys, trees overhanging). Matched to
 * other footprints by position; buildingsBake.ts falls back to it where the 2023 lidar doesn't cover
 * a lot.
 */

import { existsSync, readFileSync } from 'node:fs';
import { toMeters } from './geo';
import type { P2 } from './osm';

type Rec = { ring: P2[]; c: P2; median: number; max: number };

export interface BuildingHeights {
    /** Median height (m) and roof rise (max − median, m) of the DataSF footprint matching an OSM ring. */
    lookup(ring: P2[]): { median: number; rise: number } | null;
}

function inside(p: P2, ring: P2[]): boolean {
    let ok = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) ok = !ok;
    }
    return ok;
}

const centroid = (ring: P2[]): P2 => ring.reduce<P2>((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);

export function loadBuildingHeights(file: string): BuildingHeights {
    const recs: Rec[] = [];
    if (existsSync(file)) {
        const fc = JSON.parse(readFileSync(file, 'utf8')) as {
            features: { geometry: { type: string; coordinates: number[][][][] } | null; properties: Record<string, string> }[];
        };
        for (const f of fc.features) {
            if (!f.geometry || f.geometry.type !== 'MultiPolygon') continue;
            const median = Number.parseFloat(f.properties.hgt_median_m ?? '');
            const max = Number.parseFloat(f.properties.hgt_maxcm ?? '') / 100;
            if (!Number.isFinite(median) || median < 2) continue;
            for (const poly of f.geometry.coordinates) {
                const ring = poly[0]!.map(([lon, lat]) => toMeters(lat!, lon!));
                recs.push({ ring, c: centroid(ring), median, max: Number.isFinite(max) ? max : median });
            }
        }
    }
    // Grid of centroids.
    const CELL = 60;
    const grid = new Map<string, Rec[]>();
    for (const r of recs) {
        const k = `${Math.floor(r.c[0] / CELL)},${Math.floor(r.c[1] / CELL)}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(r);
    }
    return {
        lookup(ring) {
            const c = centroid(ring);
            const gi = Math.floor(c[0] / CELL);
            const gj = Math.floor(c[1] / CELL);
            let best: Rec | null = null;
            for (let dj = -2; dj <= 2 && !best; ++dj)
                for (let di = -2; di <= 2 && !best; ++di)
                    for (const r of grid.get(`${gi + di},${gj + dj}`) ?? []) {
                        // The DataSF footprint contains our centroid, or ours contains its centroid.
                        if (inside(c, r.ring) || inside(r.c, ring)) {
                            best = r;
                            break;
                        }
                    }
            return best && { median: best.median, rise: Math.max(0, best.max - best.median) };
        },
    };
}
