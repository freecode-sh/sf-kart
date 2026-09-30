/**
 * The Golden Gate course corridor: road segments between the course's centerline stations in a
 * spatial hash (world units), for keeping scenery off the road and carving the terrain under it.
 */

import { SCALE } from './geo';
import type { HeightModel } from './heights';
import type { OsmElement } from './osm';
import { onStructure, structureSegments } from './profile';

export type Station = { s: number; pos: [number, number, number]; halfWidth: number; fwd: [number, number, number] };
export type Meta = { centerline: Station[]; segments: Record<string, [number, number]> };

/**
 * `elevated`: a bridge deck high over the ground (the terrain is left alone under it). `viaduct`: on
 * piers over a valley (src/app/sf/sections/parkway.ts draws them): the terrain is only cut down under
 * it, never filled.
 */
export type RoadSeg = { ax: number; az: number; bx: number; bz: number; ay: number; by: number; hw: number; elevated: boolean; viaduct: boolean };

export class Corridor {
    readonly segs: RoadSeg[] = [];
    private grid = new Map<string, number[]>();
    private readonly cell = 3000;

    /** `viaducts`: S ranges (world units along the lap) on viaducts (see `osmViaducts`). */
    constructor(meta: Meta, elevatedSections: string[], viaducts: [number, number][] = []) {
        const cl = meta.centerline;
        const elev = elevatedSections.map((n) => meta.segments[n]!);
        for (let i = 0; i < cl.length; ++i) {
            const a = cl[i]!;
            const b = cl[(i + 1) % cl.length]!;
            const mid = (a.s + (i + 1 < cl.length ? b.s : a.s + 200)) / 2;
            const seg: RoadSeg = {
                ax: a.pos[0],
                az: a.pos[2],
                bx: b.pos[0],
                bz: b.pos[2],
                ay: a.pos[1],
                by: b.pos[1],
                hw: Math.max(a.halfWidth, b.halfWidth),
                elevated: elev.some(([s0, s1]) => mid > s0 && mid < s1),
                viaduct: viaducts.some(([s0, s1]) => mid > s0 && mid < s1),
            };
            const k = this.segs.push(seg) - 1;
            const R = seg.hw + 6000;
            for (let gx = Math.floor((Math.min(seg.ax, seg.bx) - R) / this.cell); gx <= Math.floor((Math.max(seg.ax, seg.bx) + R) / this.cell); ++gx)
                for (let gz = Math.floor((Math.min(seg.az, seg.bz) - R) / this.cell); gz <= Math.floor((Math.max(seg.az, seg.bz) + R) / this.cell); ++gz) {
                    const key = `${gx},${gz}`;
                    let l = this.grid.get(key);
                    if (!l) this.grid.set(key, (l = []));
                    l.push(k);
                }
        }
    }

    /** Road segments near (x, z) with the distance to each and the road height there. */
    near(x: number, z: number): { d: number; y: number; hw: number; elevated: boolean; viaduct: boolean }[] {
        const l = this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`) ?? [];
        return l.map((k) => {
            const g = this.segs[k]!;
            const dx = g.bx - g.ax;
            const dz = g.bz - g.az;
            const L2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / L2));
            const px = g.ax + dx * t - x;
            const pz = g.az + dz * t - z;
            return { d: Math.sqrt(px * px + pz * pz), y: g.ay + (g.by - g.ay) * t, hw: g.hw, elevated: g.elevated, viaduct: g.viaduct };
        });
    }

    /** Distance past the nearest road edge (negative = on the road). */
    clearance(x: number, z: number, elevatedToo = true, viaductsToo = true): number {
        let best = Infinity;
        for (const n of this.near(x, z)) if ((elevatedToo || !n.elevated) && (viaductsToo || !n.viaduct)) best = Math.min(best, n.d - n.hw);
        return best;
    }

    /** Distance past the nearest road edge anywhere (world units; brute force, unlike `clearance`). */
    distance(x: number, z: number, elevatedToo = true): number {
        let best = Infinity;
        for (const g of this.segs) {
            if (!elevatedToo && g.elevated) continue;
            const dx = g.bx - g.ax;
            const dz = g.bz - g.az;
            const t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz || 1)));
            best = Math.min(best, Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) - g.hw);
        }
        return best;
    }
}

/**
 * Stretches of the lap inside `within` (S ranges, world units) that OpenStreetMap has on a bridge or
 * viaduct (profile.ts bridges the road over them) and where the lidar ground drops well below the
 * road: those stand on piers rather than on a fill embankment.
 */
export function osmViaducts(meta: Meta, els: OsmElement[], heights: HeightModel, seaY: number, within: [number, number][], minClear = 4): [number, number][] {
    const segs = structureSegments(els, true);
    const cl = meta.centerline;
    const runs: { s0: number; s1: number; clear: number }[] = [];
    let run: { s0: number; s1: number; clear: number } | null = null;
    for (const st of cl) {
        const inside = within.some(([a, b]) => st.s >= a && st.s <= b);
        const e = st.pos[0] / SCALE;
        const n = -st.pos[2] / SCALE;
        const on = inside && onStructure(segs, e, n, st.fwd[0], -st.fwd[2], 30);
        if (!on) {
            if (run) runs.push(run);
            run = null;
            continue;
        }
        const clear = (st.pos[1] - seaY) / SCALE - heights.at(e, n);
        if (!run) run = { s0: st.s, s1: st.s, clear };
        run.s1 = st.s;
        run.clear = Math.max(run.clear, clear);
    }
    if (run) runs.push(run);
    // Join runs split by a short gap (a missed station), keep the ones that clear the ground.
    const joined: typeof runs = [];
    for (const r of runs) {
        const last = joined.at(-1);
        if (last && r.s0 - last.s1 < 40 * SCALE) {
            last.s1 = r.s1;
            last.clear = Math.max(last.clear, r.clear);
        } else joined.push({ ...r });
    }
    return joined.filter((r) => r.clear > minClear && r.s1 - r.s0 > 30 * SCALE).map((r) => [r.s0, r.s1]);
}
