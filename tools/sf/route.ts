/**
 * The Golden Gate course route on real streets (meters east/north of geo.ORIGIN).
 *
 * The lap (a figure eight in plan):
 *   Crissy Field promenade (start, heading west, the bridge ahead) → Marine Drive → a loop around
 *   Fort Point under the bridge → back along Marine Drive → Long Avenue climb → Lincoln Boulevard
 *   → the bridge northbound → Vista Point turnaround (under US 101) → the bridge southbound →
 *   toll plaza → Presidio Parkway (tunnels) → Palace of Fine Arts → Marina Green → Crissy Field.
 *
 * Sections are routed on the OSM street graph between waypoints, or given as literal polylines
 * where the course leaves the real streets. Two-way stretches the lap drives in both directions
 * (the bridge, Marine Drive) are split into carriageways by offsetting each direction from the
 * street's centerline.
 */

import { StreetGraph, polyLength, simplify, type OsmWay, type P2 } from './osm';

export type Section = {
    name: string;
    /** Display name (HUD banner). */
    title: string;
    /** Routed on the street graph through these waypoints... */
    via?: P2[];
    /** ...or a literal polyline. */
    pts?: P2[];
    /** Lateral offset (meters, + = driver's left) applied to this section's polyline. */
    offset?: number;
};

/** Half the distance between the two carriageways where the lap uses a street both ways (m). */
export const CARRIAGEWAY = 21;

/** The Golden Gate Bridge axis (tower to tower), for the carriageway offsets and the bridge model. */
export const BRIDGE = {
    sfTower: [-34, 391] as P2,
    marinTower: [-153, 1670] as P2,
    /** South end of the suspension structure (Fort Point arch) and north end of the Marin approach. */
    southEnd: [60, -230] as P2,
    northEnd: [-200, 2080] as P2,
};

export const SECTIONS: Section[] = [
    // Off the promenade in one broad, gentle sweep across the Crissy Field airfield lawn and back to
    // the beach (an easy start to get used to the controls).
    { name: 'crissy', title: 'Crissy Field', pts: [[1500, -645], [1330, -650], [1210, -688], [1090, -700], [980, -655], [890, -588], [830, -525], [769, -465]] },
    // Westbound along the seawall, north of Marine Drive (the eastbound carriageway is Marine Drive).
    {
        name: 'marine_w',
        title: 'Marine Drive',
        pts: [[700, -385], [630, -290], [560, -198], [480, -163], [400, -150], [300, -140], [230, -133], [160, -105]],
    },
    // Around Fort Point under the bridge (the fort is at 35, 1), counterclockwise.
    { name: 'fort_point', title: 'Fort Point', pts: arc([30, -15], 88, -20, 215, 12) },
    { name: 'marine_e', title: 'Marine Drive', via: [[118, -110], [232, -160], [400, -173], [543, -237]], offset: -CARRIAGEWAY },
    // Up Long Avenue, then a switchback (wider than the real junction) onto Lincoln Boulevard.
    { name: 'long_ave', title: 'Long Avenue', via: [[557, -267], [598, -397]] },
    { name: 'switchback', title: 'Long Avenue', pts: arc([566, -466], 62, 25, -128, 12) },
    { name: 'lincoln', title: 'Lincoln Boulevard', via: [[449, -399], [329, -431]] },
    { name: 'plaza_nb', title: 'Toll Plaza', pts: [[270, -415], [200, -350], [140, -290]] },
    { name: 'bridge_nb', title: 'Golden Gate Bridge', pts: [] },
    { name: 'vista', title: 'Vista Point', pts: [] },
    { name: 'bridge_sb', title: 'Golden Gate Bridge', pts: [] },
    { name: 'plaza_sb', title: 'Toll Plaza', pts: [[80, -330], [150, -420], [230, -500]] },
    { name: 'parkway', title: 'Presidio Parkway', via: [[311, -546], [441, -679], [684, -830], [1123, -951], [1406, -1001], [2044, -826], [2310, -815]] },
    // Around the Palace of Fine Arts: Lyon Street, Bay Street, then north on Baker Street along
    // the lagoon, so the rotunda sits inside the turn.
    {
        name: 'palace',
        title: 'Palace of Fine Arts',
        pts: [[2420, -895], [2520, -968], [2615, -995], [2685, -960], [2698, -880], [2688, -780], [2668, -660]],
    },
    { name: 'marina', title: 'Marina Green', pts: [[2600, -600], [2450, -585], [2250, -570], [2036, -554], [1750, -600]] },
];

export const ALLOW_PATHS = (w: OsmWay) => w.tags?.name === 'Golden Gate Promenade' || w.tags?.name === 'Vista Point Trail';

/** Offsets a polyline laterally (+ = left of the direction of travel). */
export function offsetLine(pts: P2[], d: number): P2[] {
    return pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)]!;
        const b = pts[Math.min(pts.length - 1, i + 1)]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        return [p[0] - (dy / L) * d, p[1] + (dx / L) * d];
    });
}

/** Points on a circular arc (degrees, counterclockwise from east). */
function arc(c: P2, r: number, a0: number, a1: number, n: number): P2[] {
    return Array.from({ length: n + 1 }, (_, i) => {
        const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
        return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as P2;
    });
}

/** Point at fraction t along the segment a→b. */
const lerp = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Bridge carriageways: the axis offset to the east (northbound) or west (southbound). */
function bridgeLine(dir: 'nb' | 'sb'): P2[] {
    const { southEnd, sfTower, marinTower, northEnd } = BRIDGE;
    const axis: P2[] = [lerp(southEnd, sfTower, 0), lerp(southEnd, sfTower, 0.5), sfTower, lerp(sfTower, marinTower, 0.5), marinTower, northEnd];
    // The axis runs north; east of it is the right side going north.
    const east = offsetLine(axis, -CARRIAGEWAY);
    const west = offsetLine(axis, CARRIAGEWAY);
    return dir === 'nb' ? east : west.reverse();
}

export type RoutePiece = { name: string; title: string; pts: P2[]; ways: string[] };

export function buildRoute(g: StreetGraph): RoutePiece[] {
    const out: RoutePiece[] = [];
    for (const s of SECTIONS) {
        let pts: P2[] = [];
        let ways: string[] = [];
        if (s.name === 'bridge_nb') {
            pts = bridgeLine('nb');
            ways = ['Golden Gate Bridge (northbound)'];
        } else if (s.name === 'bridge_sb') {
            pts = bridgeLine('sb');
            ways = ['Golden Gate Bridge (southbound)'];
        } else if (s.name === 'vista') {
            // Off the northbound carriageway, a tight loop west under the US 101 approach (just past
            // the Vista Point lot), back onto the southbound carriageway.
            const nbEnd = bridgeLine('nb').at(-1)!;
            const sbStart = bridgeLine('sb')[0]!;
            pts = [
                lerp(nbEnd, [-160, 2190], 0.4),
                [-150, 2230],
                [-152, 2280],
                [-175, 2325],
                [-220, 2348],
                [-268, 2338],
                [-302, 2300],
                [-308, 2245],
                [-290, 2185],
                lerp([-290, 2185], sbStart, 0.4),
            ];
            ways = ['Vista Point', 'US 101 underpass'];
        } else if (s.pts) {
            pts = s.pts.map((p) => [...p] as P2);
            ways = ['(literal)'];
        } else if (s.via) {
            for (let i = 0; i + 1 < s.via.length; ++i) {
                const r = g.route(s.via[i]!, s.via[i + 1]!, (w) => w.tags?.highway === 'service' && !ALLOW_PATHS(w));
                pts.push(...(pts.length ? r.pts.slice(1) : r.pts));
                for (const w of r.ways) if (ways[ways.length - 1] !== w) ways.push(w);
            }
        }
        if (s.offset) pts = offsetLine(pts, s.offset);
        out.push({ name: s.name, title: s.title, pts: simplify(pts, 1.5), ways });
    }
    return out;
}

export function describe(pieces: RoutePiece[]): string {
    let total = 0;
    const lines = pieces.map((p) => {
        const L = polyLength(p.pts);
        total += L;
        return `  ${p.name.padEnd(12)} ${L.toFixed(0).padStart(5)} m  ${p.ways.join(' → ')}`;
    });
    return [...lines, `  total ${total.toFixed(0)} m`].join('\n');
}
