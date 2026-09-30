/**
 * Golden Gate — San Francisco on real streets (OpenStreetMap), at 60 units per meter.
 *
 * Crissy Field → Marine Drive → around Fort Point under the bridge → Long Avenue → Lincoln
 * Boulevard → the Golden Gate Bridge northbound → Vista Point, under US 101 → the bridge
 * southbound → toll plaza → Presidio Parkway → Palace of Fine Arts → Marina Green → Crissy Field.
 *
 * The centerline and road heights come from tools/sf/bakeTrack.ts (golden_gate.path.json).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KCL, type TrackDef, type Zone } from '../lib/types';

type Baked = {
    pts: [number, number][];
    sections: { name: string; at: number }[];
    titles: Record<string, string>;
    profile: { seg: string; at: number; y: number }[];
    seaY: number;
};
const baked = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'golden_gate.path.json'), 'utf8')) as Baked;

const trickRamp = KCL.road | KCL.trickable;

/**
 * Lane panels on a bridge carriageway: about every 6500 units through each stretch (clear of the
 * tower panels, the jump, and the landings off the kickers), alternating sides so the fast line
 * weaves.
 */
function lanePanels(seg: string, stretches: [number, number][]): Zone[] {
    const out: Zone[] = [];
    for (const [from, to] of stretches) {
        const n = Math.round((to - from) / 6500);
        for (let i = 0; i <= n; ++i) {
            const lat: [number, number] = out.length % 2 ? [-1000, -200] : [200, 1000];
            out.push({ kind: 'dashPanel', span: { seg, at: Math.round(from + ((to - from) * i) / Math.max(1, n)), len: 700 }, lat });
        }
    }
    return out;
}

/**
 * The Presidio Parkway's tunnels (Battery and Main Post, where OpenStreetMap has them), drawn as the
 * real cut-and-cover boxes under the Tunnel Tops by src/app/sf/sections/parkway.ts: spline units
 * from the parkway's start.
 */
const TUNNELS = [
    { seg: 'parkway', from: 55200, to: 73300, name: 'BATTERY TUNNEL' },
    { seg: 'parkway', from: 95000, to: 113600, name: 'MAIN POST TUNNEL' },
];

/** Open-air half-pipes rise out of the barrier line over this run-in at each end (~50 m). */
const PIPE_EASE = 3000;

/** Narrow carriageways where the lap uses a street in both directions. */
const twoWay = { road: 1050, offroadL: 100, offroadR: 100 };
/** Taper of Marine Drive's width zones (the default, 1500, reads as a sideways jog at speed). */
const MARINE_EASE = 6000;

const track: TrackDef = {
    id: 'golden_gate',
    name: 'Golden Gate',
    description: 'San Francisco on real streets: Crissy Field, Fort Point, both ways across the Golden Gate Bridge, the Presidio Parkway and the Palace of Fine Arts.',
    laps: 1,
    theme: {
        sky: '#a9d3f5',
        fog: '#dfe9f1',
        ground: '#6d8f5a',
        road: '#5d6068',
        offroad: '#8a8f7a',
        wall: '#c0392b',
        accent: '#ff7a1f',
    },
    groundY: baked.seaY,
    extra: { sectionTitles: baked.titles, seaY: baked.seaY, tunnels: TUNNELS },
    path: { pts: baked.pts, sections: baked.sections },
    profile: baked.profile.map((k) => ({ at: { seg: k.seg, at: k.at }, y: k.y })),
    crossSection: { road: 1250, offroadL: 350, offroadR: 350, wallH: 220, invisibleWallH: 1400, wallL: true, wallR: true },
    finish: { seg: 'crissy', at: 5000 },
    spawnBehind: 1200,
    zones: [
        // Carriageways side by side: Marine Drive (both ways) and the bridge decks. Marine Drive
        // narrows and widens over ~100 m (MARINE_EASE), so its walls and edge lines taper instead of
        // jogging sideways into Fort Point and onto Long Avenue.
        { kind: 'width', range: { from: { seg: 'marine_w' }, to: { seg: 'fort_point', at: 4500 } }, ...twoWay, ease: MARINE_EASE },
        { kind: 'width', range: { from: { seg: 'marine_e', at: -29000 }, to: { seg: 'long_ave' } }, ...twoWay, ease: MARINE_EASE },
        { kind: 'width', range: { from: { seg: 'plaza_nb', at: -5000 }, to: { seg: 'vista', at: 7000 } }, ...twoWay, ease: MARINE_EASE },
        { kind: 'width', range: { from: { seg: 'vista', at: -7000 }, to: { seg: 'plaza_sb', at: 5000 } }, ...twoWay, ease: MARINE_EASE },

        // Crissy Field is drift corners (no panels); Marine Drive: a panel along the seawall.
        { kind: 'dashPanel', span: { seg: 'marine_w', at: 14000, len: 700 } },
        // Fort Point: a half-pipe round the outside of the loop under the bridge.
        { kind: 'halfpipe', range: { seg: 'fort_point', from: 5000, to: -5000 }, side: 'right', ease: PIPE_EASE },
        // Long Avenue switchback: a wider hairpin with a half-pipe round its outside (ride the wall
        // instead of braking).
        { kind: 'halfpipe', range: { seg: 'switchback', from: 1500, to: -1500 }, side: 'left', ease: PIPE_EASE },
        // Toll plaza (northbound): toll lane panels.
        { kind: 'dashPanel', span: { seg: 'plaza_nb', at: 6000, len: 700 }, lat: [-900, -300] },
        { kind: 'dashPanel', span: { seg: 'plaza_nb', at: 6000, len: 700 }, lat: [300, 900] },

        // Golden Gate Bridge, northbound: full-width panels through the tower portals, lane panels
        // between them, a trick kicker at each expansion joint, and a boost-ramp jump over a missing
        // section of deck at midspan.
        ...lanePanels('bridge_nb', [[3000, 13500], [24500, 34000], [41000, 56000], [85000, 93500], [104500, 111500], [118500, 134000]]),
        { kind: 'ramp', range: { seg: 'bridge_nb', from: 16000, to: 17800 }, height: 200, attr: trickRamp },
        { kind: 'dashPanel', span: { seg: 'bridge_nb', at: 37500, len: 800 } },
        { kind: 'ramp', range: { seg: 'bridge_nb', from: 66000, to: 68400 }, height: 600, attr: KCL.boostRamp(1) },
        { kind: 'gap', range: { seg: 'bridge_nb', from: 68400, to: 71400 } },
        // The jump flies ~2900 above the deck: keep karts off the southbound deck and out of the bay.
        { kind: 'walls', range: { seg: 'bridge_nb', from: 62000, to: 90000 }, invisibleWallH: 4500 },
        // Room in the air beside it, from the lip to past the far edge: the invisible walls stand out
        // 1000 over the bay (to the drawn railing at the sidewalk's outer edge) and 200 over the
        // median (from 600 up, clear of the southbound barrier, lowered there to 450: KCL faces are
        // 300 thick). A kart that took off along a barrier and tricked brushed it in the air and
        // dropped into the gap at 40% speed, pointing wherever the trick had turned it; one held into
        // the barrier takes off heading out and reaches the bay-side wall past the far edge now. The
        // room's sloping floor puts a kart that comes down in it back over the barrier
        // (tools/course/jumpcheck.ts).
        { kind: 'airRoom', range: { seg: 'bridge_nb', from: 68400, to: 74400 }, side: 'right', out: 1000, easeIn: 600, easeOut: 3000 },
        { kind: 'airRoom', range: { seg: 'bridge_nb', from: 68400, to: 74400 }, side: 'left', out: 200, above: 600, easeIn: 600, easeOut: 3000 },
        // Slick walls from the run-up to the landing: a kart grinding the barrier up the ramp kept 40%
        // of the ramp's speed (~40 of 100) and fell into the gap; now 70%.
        { kind: 'walls', range: { seg: 'bridge_nb', from: 63000, to: 74400 }, slick: true },
        { kind: 'ramp', range: { seg: 'bridge_nb', from: 96000, to: 97800 }, height: 200, attr: trickRamp },
        { kind: 'dashPanel', span: { seg: 'bridge_nb', at: 115000, len: 800 } },

        // Vista Point: a half-pipe round the outside of the loop, a panel out of the underpass.
        { kind: 'halfpipe', range: { seg: 'vista', from: 7000, to: 25000 }, side: 'right', ease: PIPE_EASE },
        { kind: 'dashPanel', span: { seg: 'vista', at: 30000, len: 700 } },

        // Southbound: panels at the towers, lane panels between them, and two kickers.
        // Beside the northbound jump's air room the median barrier tops out at 450 (see above).
        { kind: 'walls', range: { seg: 'bridge_sb', from: 64000, to: 71500 }, invisibleWallH: { left: 230 } },
        ...lanePanels('bridge_sb', [[3000, 26500], [33500, 51000], [62500, 85000], [96500, 104500], [111500, 140000]]),
        { kind: 'dashPanel', span: { seg: 'bridge_sb', at: 30000, len: 800 } },
        { kind: 'ramp', range: { seg: 'bridge_sb', from: 54000, to: 55800 }, height: 220, attr: trickRamp },
        { kind: 'ramp', range: { seg: 'bridge_sb', from: 88000, to: 89800 }, height: 220, attr: trickRamp },
        { kind: 'dashPanel', span: { seg: 'bridge_sb', at: 108000, len: 800 } },
        // Toll plaza (southbound): toll lane panels.
        { kind: 'dashPanel', span: { seg: 'plaza_sb', at: 9000, len: 700 }, lat: [-900, -300] },
        { kind: 'dashPanel', span: { seg: 'plaza_sb', at: 9000, len: 700 }, lat: [300, 900] },

        // Presidio Parkway: panels between the two tunnels (TUNNELS), trick kickers before the first
        // tunnel and out of each (all landing well clear of the portals), and a kicker in the middle
        // of each tunnel, centred on the road (drive round it or hop it), lip at the tunnel's
        // midpoint: low enough that the jump clears the ceiling (TUNNEL_CEIL in parkway.ts) with
        // room to spare, landing well before the far portal.
        { kind: 'dashPanel', span: { seg: 'parkway', at: 20000, len: 700 } },
        { kind: 'ramp', range: { seg: 'parkway', from: 38000, to: 39800 }, height: 220, attr: trickRamp },
        { kind: 'ramp', range: { seg: 'parkway', from: 62700, to: 64500 }, height: 190, attr: trickRamp, lat: [-650, 650] },
        { kind: 'ramp', range: { seg: 'parkway', from: 79000, to: 80800 }, height: 220, attr: trickRamp },
        { kind: 'dashPanel', span: { seg: 'parkway', at: 88000, len: 700 } },
        { kind: 'ramp', range: { seg: 'parkway', from: 102500, to: 104300 }, height: 190, attr: trickRamp, lat: [-650, 650] },
        { kind: 'ramp', range: { seg: 'parkway', from: 119000, to: 120800 }, height: 220, attr: trickRamp },
        // Out of the Palace corner onto Marina Boulevard (after the turn, not into it).
        { kind: 'dashPanel', span: { seg: 'marina', at: 9000, len: 700 } },

        // Marina Green → Crissy Field: a boost-ramp jump over the Crissy Field lagoon inlet, right
        // before the finish.
        { kind: 'ramp', range: { seg: 'marina', from: -13000, to: -10600 }, height: 600, attr: KCL.boostRamp(1) },
        { kind: 'gap', range: { seg: 'marina', from: -10600, to: -7800 } },
        // This one flies ~2600 above the road too (an angled takeoff cleared the barriers into the
        // lagoon): tall invisible walls from the ramp to past the landing, like the bridge's, room in
        // the air beside the flight (nothing else near here) and slick walls from the run-up on.
        { kind: 'walls', range: { seg: 'marina', from: -13000 }, invisibleWallH: 4500 },
        { kind: 'airRoom', range: { seg: 'marina', from: -10600, to: -4800 }, side: 'left', out: 1000, easeIn: 600, easeOut: 3000 },
        { kind: 'airRoom', range: { seg: 'marina', from: -10600, to: -4800 }, side: 'right', out: 1000, easeIn: 600, easeOut: 3000 },
        { kind: 'walls', range: { seg: 'marina', from: -16000, to: -4800 }, slick: true },
    ],
    // Coarser than the builder's default: at 900 the KCL outgrows its u16 normal indices. Denser into
    // the corners that open off long straights (into and out of the Fort Point loop, onto Long
    // Avenue), where an 1100 chord reached into the bend and the walls and edge lines kinked.
    stations: {
        max: 1100,
        deg: 4,
        dense: [
            { range: { from: { seg: 'marine_w', at: -3500 }, to: { seg: 'fort_point', at: 2500 } }, max: 450 },
            { range: { from: { seg: 'fort_point', at: -2500 }, to: { seg: 'marine_e', at: 3000 } }, max: 450 },
            { range: { seg: 'marine_e', from: -4000 }, max: 450 },
        ],
    },
    checkpoints: { spacing: 4200, maxTurnDeg: 24, keyCount: 8, margin: 100 },
    validate: { maxGrade: 0.12, minClearance: 150, turning: 360 },
};

export default track;
