/**
 * OpenStreetMap helpers for the San Francisco course: loading the Overpass dump, a routable street
 * graph (Dijkstra between waypoints, one-ways respected), and polyline utilities (meters, east/north).
 */

import { readFileSync } from 'node:fs';
import { toMeters } from './geo';

export type P2 = [number, number];

export interface OsmWay {
    type: 'way';
    id: number;
    nodes: number[];
    geometry: { lat: number; lon: number }[];
    tags?: Record<string, string>;
}
export interface OsmNode {
    type: 'node';
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
}
export interface OsmRelation {
    type: 'relation';
    id: number;
    tags?: Record<string, string>;
    members: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
}
export type OsmElement = OsmWay | OsmNode | OsmRelation;

export function loadOsm(path: string): OsmElement[] {
    return (JSON.parse(readFileSync(path, 'utf8')) as { elements: OsmElement[] }).elements;
}

export const wayPoints = (w: OsmWay): P2[] => w.geometry.map((g) => toMeters(g.lat, g.lon));

const DRIVABLE = new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

/** Street graph: node id → position and outgoing edges. */
export class StreetGraph {
    readonly pos = new Map<number, P2>();
    readonly out = new Map<number, { to: number; len: number; way: OsmWay }[]>();

    constructor(elements: OsmElement[], extra: (w: OsmWay) => boolean = () => false) {
        for (const e of elements) {
            if (e.type !== 'way' || !e.tags?.highway) continue;
            if (!DRIVABLE.has(e.tags.highway) && !extra(e)) continue;
            const pts = wayPoints(e);
            e.nodes.forEach((id, i) => this.pos.set(id, pts[i]!));
            const oneway = e.tags.oneway === 'yes' || e.tags.highway === 'motorway' || e.tags.junction === 'roundabout';
            const rev = e.tags.oneway === '-1';
            for (let i = 0; i + 1 < e.nodes.length; ++i) {
                const a = e.nodes[i]!;
                const b = e.nodes[i + 1]!;
                const len = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
                if (!rev) this.edge(a, b, len, e);
                if (!oneway || rev) this.edge(b, a, len, e);
            }
        }
    }

    private edge(a: number, b: number, len: number, way: OsmWay): void {
        let l = this.out.get(a);
        if (!l) this.out.set(a, (l = []));
        l.push({ to: b, len, way });
    }

    nearest(p: P2): number {
        let best = -1;
        let bd = Infinity;
        for (const [id, q] of this.pos) {
            if (!this.out.has(id)) continue;
            const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (d < bd) {
                bd = d;
                best = id;
            }
        }
        return best;
    }

    /** Shortest path between two points (snapped to the nearest routable nodes). */
    route(from: P2, to: P2, avoid: (w: OsmWay) => boolean = () => false): { pts: P2[]; ways: string[] } {
        const s = this.nearest(from);
        const t = this.nearest(to);
        const dist = new Map<number, number>([[s, 0]]);
        const prev = new Map<number, number>();
        const via = new Map<number, OsmWay>();
        const open = new Set<number>([s]);
        while (open.size) {
            let u = -1;
            let ud = Infinity;
            for (const n of open) {
                const d = dist.get(n)!;
                if (d < ud) {
                    ud = d;
                    u = n;
                }
            }
            open.delete(u);
            if (u === t) break;
            for (const e of this.out.get(u) ?? []) {
                if (avoid(e.way)) continue;
                const nd = ud + e.len;
                if (nd < (dist.get(e.to) ?? Infinity)) {
                    dist.set(e.to, nd);
                    prev.set(e.to, u);
                    via.set(e.to, e.way);
                    open.add(e.to);
                }
            }
        }
        if (!dist.has(t)) throw new Error(`no route from ${from} to ${to}`);
        const ids: number[] = [t];
        while (ids[0] !== s) ids.unshift(prev.get(ids[0]!)!);
        const ways: string[] = [];
        for (const id of ids.slice(1)) {
            const w = via.get(id)!;
            const n = w.tags?.name ?? w.tags?.ref ?? `way ${w.id}`;
            if (ways[ways.length - 1] !== n) ways.push(n);
        }
        return { pts: ids.map((id) => this.pos.get(id)!), ways };
    }
}

export function polyLength(pts: P2[]): number {
    let L = 0;
    for (let i = 1; i < pts.length; ++i) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    return L;
}

/** Douglas-Peucker simplification. */
export function simplify(pts: P2[], eps: number): P2[] {
    if (pts.length < 3) return pts.slice();
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    let md = 0;
    let mi = 0;
    for (let i = 1; i < pts.length - 1; ++i) {
        const p = pts[i]!;
        const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
        if (d > md) {
            md = d;
            mi = i;
        }
    }
    if (md < eps) return [a, b];
    return [...simplify(pts.slice(0, mi + 1), eps).slice(0, -1), ...simplify(pts.slice(mi), eps)];
}

/** Resamples a polyline at uniform spacing (keeps both ends). */
export function resample(pts: P2[], step: number): P2[] {
    const out: P2[] = [pts[0]!];
    let carry = 0;
    for (let i = 1; i < pts.length; ++i) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let d = step - carry;
        while (d <= len) {
            out.push([a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len]);
            d += step;
        }
        carry = len - (d - step);
    }
    const last = pts[pts.length - 1]!;
    const tail = out[out.length - 1]!;
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
    return out;
}
