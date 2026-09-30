# tools/

Offline toolchain: the course builder, the bot, the San Francisco data bakes and helpers.

```
tools/
  brandLint.ts       no game or brand names in the repository (run before committing)
  brand/icons.sh     favicon.svg (the lap, favicon.ts) and its PNGs (icons.ts) → public/
  verify.ts          verifies a run file (SFKR): the rules hash, then re-simulates it and checks its finish and splits
  course/            course generator and bot
    build.ts         build courses → public/data/courses/<id>/
    tracks/*.ts      one declarative TrackDef per course (tracks/index.ts lists them)
    lib/types.ts     TrackDef / zone types, KCL attribute helpers
    lib/course.ts    the builder (TrackDef → KCL + KMP + meta), incl. validation
    lib/centerline.ts turtle program / explicit path, closure solve, Catmull-Rom centerline
    lib/kcl.ts       KCL (prism collision + octree) writer
    lib/kmp.ts       KMP writer
    botlap.ts        closed-loop pure-pursuit bot driving the engine (library + CLI)
    preview.ts       top-down PNG of a built course (debugging layouts)
    kclcheck.ts      KCL sanity/octree completeness checker
    boundscheck.ts   boundary / shortcut audit: barrier holes and heights, nearby stretches without a key checkpoint between them, respawns, bot laps that push the walls
    jumpcheck.ts     gap-jump landings: bot runs across the lanes in every vehicle (coasting, braking, after a wall scrape, grinding the barrier up the ramp, veering out off the lip, with / without a trick), how far past the far edge each comes down
  fonts/subset.sh    the UI fonts: Latin subsets of fonts/upstream/ → src/app/ui/fonts/ (pinned fontTools)
  ghost/rkg.ts       RKG (ghost) writer
  lib/bin.ts         BinWriter, CRCs
  lib/dataBuild.ts   the deploy copy of public/data (hashed names, gzip) → dist-data/, for the build and uploadData.ts
  lib/padDriver.ts   a scripted, noisy human-ish driver making the app's raw pads (test runs through the live path)
  lib/rulesFiles.ts  the rules' data from disk for re-simulating runs; lib/rulesHashPlugin.ts bakes RULES_HASH into the app
  lib/originalParams.ts  the original game's parameter files, if you own them ($KART_COMMON_DIR)
  sf/                San Francisco data: fetch, bake, route, rivals, screenshots, recordings
  uploadData.ts      sync dist-data/ to the CDN's R2 bucket (dry run unless --apply)
  vehicles/compare.ts  the vehicles' race stats and a bot lap each, with section splits
  vehicles/export.ts   provenance of vehicles.json (needs the original parameter files)
```

Every tool's header documents its usage. Tools run from the repository root with `npx tsx`.

**Scratch space:** downloads, caches and diagnostics go to `.context/` (gitignored): the raw San Francisco data (`.context/sf/`, ~4 GB from `tools/sf/fetch.ts` and
`tools/sf/datasf.ts`), intermediate bakes (`.context/sf/derived/`), previews, reports and
recordings. Only the baked results the game loads are written to `public/data/` (and
`bridgeFit.ts`'s thinned lidar points for the bridge viewer, to the gitignored
`public/data/sf/debug/`).

**External programs:** ImageMagick (`magick`: `tools/sf/dem.ts`, `bakeWorld.ts`, `bridgeFit.ts`),
ffmpeg (`record.ts`), Google Chrome (`shot.ts`, `record.ts`; set
`$CHROME` to its binary if it isn't the default macOS install) and python3 (`fonts/subset.sh`,
`brand/icons.sh`: each makes a throwaway venv with fontTools 4.60.1).

## Quick reference

```sh
npx tsx tools/course/build.ts [id ...]        # build courses (all if no id)
npx tsx tools/course/botlap.ts <id> [--laps N] [--frames N] [--no-trick] [--vehicle ebike|robotaxi|buggy] [--rkg out.rkg]   # one bot race, event log
npx tsx tools/vehicles/compare.ts [id] [--tune JSON] [--only ebike,buggy]   # SF vehicles: race stats + a bot lap each, section splits
npx tsx tools/course/preview.ts <id> [out.png] [--px 40] [--bbox x0,z0,x1,z1] [--wire]
npx tsx tools/course/kclcheck.ts [id]         # octree completeness / floor types (default golden_gate)
npx tsx tools/course/boundscheck.ts <id> [--drive]   # can a kart get out or cut the lap? (--drive: 27 boundary-pushing bot laps, ~40 s)
npx tsx tools/course/jumpcheck.ts <id> [--jump N] [--lanes a,b] [--approaches grind,veer700] [-v]   # does every run clear each gap jump, and by how much? (~6 min a jump)
```

Output per course: `public/data/courses/<id>/{course.kcl, course.kmp, course_meta.json}`. The
browser loads the KCL/KMP into `RaceSession` (through the engine's default course slot). The San
Francisco pipeline (`tools/sf/*`) is described in the main README.

### Coordinates and conventions

- Engine world units, +Y up, right-handed. Yaw (KMP rotation.y, meta `angleDeg`/`yawDeg`) of a
  direction (x, z) is `atan2(x, z)` in degrees. Facing +Z, +X is the driver's **left**.
- `S` = arc length along the final spline centerline from the start of the turtle program
  (0 ≤ S < length). `lat` = lateral offset from the centerline, **positive to the driver's left**.
- Karts below y = 0 are respawned by the game (`KartCollide::calcBeforeRespawn`), so every road
  surface is kept at y ≥ 0 (the builder checks it).

### Writing a course (TrackDef, `tools/course/lib/types.ts`)

```ts
const track: TrackDef = {
    id, name, description, laps: 3,
    theme: { sky, fog, ground, road, offroad, wall, accent },   // '#rrggbb'
    groundY: -6000,            // optional hint for the renderer (null = no ground)
    baseY: 4000,               // elevation at S = 0
    program: [                 // turtle: straights + arcs (deg > 0 = left turn), total turning ±360
        { kind: 'straight', len: 8000, name: 'start' },
        { kind: 'arc', radius: 6000, deg: 90, name: 't1', bank: 10, rise: 600 },
        ...
        { kind: 'straight', len: 0, name: 'link' },           // solved
    ],
    closure: ['final', 'link'],   // two non-parallel straights whose lengths are solved to close the loop
    crossSection: { road: 1800, offroadL: 400, offroadR: 400, wallH: 800, wallL: false, wallR: false, splits: [600, -600] },
    finish: { seg: 'start', at: 5000 }, spawnBehind: 500,
    zones: [ ... ],
    checkpoints: { keyCount: 6 },   // spacing 2500, maxTurnDeg 20, margin 300, openMargin 1500, jugemEvery 3, noKey: [Range], shortcutGap 8000
    validate: { maxGrade: 0.2 },    // default 0.08; minClearance 1000; turning (default ±360, 0 = figure eight)
};
```

Optional: `origin: [x, z]` (world position of the program start), `path: { pts, sections }`
(an explicit closed centerline instead of a turtle program, e.g. real streets; Golden Gate's comes
from `tools/sf/bakeTrack.ts`), `profile: [{ at: Ref, y }]` (road-height knots with a periodic
monotone cubic between them, replacing `baseY`; `bump`/`rise` still add on top),
`crossSection.invisibleWallH` (invisible 0x0D wall above low walls), `stations` (spacing, denser
ranges) and `extra` (fields copied into course_meta.json for the app).

Arcs are eased (1.6R → 1.25R → R → 1.25R → 1.6R, same total angle) unless `ease: false`.
Segment sugar: `rise` (height change across the segment, cosine eased), `bump` (up and back
down), `bank` (degrees, outside of the corner raised).

Positions: `Ref = { seg, at }` (spline units from the segment start; negative = from its end),
`Range = 'seg' | { seg, from?, to? } | { from: Ref, to: Ref }`, `Span = { seg, at, len }`
(centered). `Lat = [lo, hi] | 'leftLane' | 'rightLane'` (lanes of an island).

Zones:

| kind | effect |
| --- | --- |
| `bump`, `rise` | elevation (cosine eased); all `rise`s must sum to 0 |
| `bank` | banking in degrees (+ raises the right edge), eased over `ease` (default ≤1500) |
| `width` | road / offroad widths (eased) |
| `walls` | turn the left/right walls on/off over a range (no wall = open edge + fall boundary band below; `fall: false` or `{ depth, width }` for a cliff above a lower road); `invisibleWallH` (both sides, or `{ left, right }`); `slick: true`: barriers and invisible walls are KCL 0x0F, which keeps 70% of the speed limit along it instead of 0x0C's 40% (beside a jump, so a kart grinding the barrier up the ramp still clears the gap) |
| `airRoom` | room in the air beside a jump's flight: one side's invisible wall stands `out` further out, from the barrier top (or `above` the road) up, eased in / out (`easeIn`, `easeOut`). A mid-air wall hit keeps 40% of the speed and points the kart along its body (mid-trick: anywhere), so a kart that takes off along a barrier and tricks drops into the gap without it. The room's floor slopes from the barrier top up to the wall (up to 600), so a kart that comes down in it slides back in over the barrier. Keep other roads' invisible walls 300 away (KCL faces are 300 thick). Listed in the meta's `features` (boundscheck allows karts in it) |
| `dashPanel` | KCL 0x06 over `span` (default lat ±600) |
| `jumpPad` | KCL 0x08 \| variant << 5 (default: road width) |
| `surface` | any KCL attribute over a range (offroad patches, slippery road, ...) |
| `ramp` | kicker `height * t^exp` (exp 2) ending in a lip; `attr` = `KCL.boostRamp(0\|1\|2)` (0x07) or `KCL.road \| KCL.trickable` (0x2000); vertical lip face |
| `gap` | no floor over a range (optionally one lane); fall boundary 1200 below, faces under both edges |
| `shortcut` | removes the walls on one side and fills the area between that edge and the straight chord joining its ends (heavy offroad by default) + chord wall |
| `island` | divided road: lanes of width `road` either side of an island (eased width, walls facing the lanes); `respawnLane` picks the lane respawn points use |
| `cannon` | barrel cannon: KCL 0x11 trigger across the road at the range start, no geometry until the range end, CNPT at `target` (`{ at: Ref, y }`, aimed along the centerline, `param` 0/1/2); one long checkpoint quad over the flight, no respawns near it |
| `halfpipe` | quarter-pipe (KCL 0x13, `height` default 700) replacing one side's offroad strip, invisible half-pipe wall (0x1C) above the lip, a deck and a back wall behind it; the invisible walls for 8000 past its end top a launch (lip + 1625 + 500) |

What the builder generates:

- **Stations** every min(500, max(150, R·3°)) (100 on ramps), forced at every feature boundary.
- **Floor strips** between lateral lines (walls, road edges, island edges, lane splits, feature
  edges), attributes road 0x00 / offroad 0x03 / island / overlays; **walls** 0x0C at the outer
  edges (normals facing the road); **step faces** where adjacent strips differ in height
  (partial ramps, lane gaps); **fall boundaries** 0x10 under gaps and in bands (≤6000 wide, 1000
  below) outside open edges. The builder rejects fall boundaries within −800..+3500 of another
  floor.
- **KMP**: KTPT (start, `spawnBehind` behind the finish), CKPT every ≤2500 / ≤20° of turning,
  spanning the walls + 300 (open edges + 1500), one CKPH group, `keyCount` key checkpoints
  (0 = finish line; never within 3000 of a shortcut) plus one between any two stretches of road
  within `shortcutGap` (8000) of each other edge to edge (the later one below, or at most 3000
  above) that the lap reaches ≥ 3000 later than the straight line would (the engine's checkpoint search stops at key checkpoints and a lap needs
  them all in order, so crossing over doesn't count), JGPT every 3rd checkpoint but never within
  ramp/gap/jump-pad danger zones (each checkpoint respawns at the latest point at or before it,
  so falling into a gap respawns you before the ramp), ENPT/ITPT (one path), STGI (laps).
- **Validation** (build fails): radius ≥ 1.15 × inner wall offset, max grade, self clearance,
  total turning ±360, every checkpoint quad convex, fall boundaries away from other floors,
  road above y = 0, shortcut edge monotonic along its chord, walls (+ invisible walls) topping
  every jump's flight from the ramp to its landing by 500 (boost ramps: lip + 2000 for 10 000
  past the lip; trick kickers: lip + 900 for 7000; measured with the bots), half-pipe walls
  ≥ 2125.

## The bot (`tools/course/botlap.ts`)

`runBot(files, meta, options)` drives a local race through `RaceSession` (the chosen vehicle,
manual drift), reading the kart pose each frame and calling `hostController().setRawInputs(...)`.
The steering law: nearest centerline station, lookahead `600 + 12·speed`, stick = clamp(−4·error).
Extras: optimal start boost, automatic hop + inside drifts through corners (MT boosts), trick-up
right after leaving trickable surfaces / jump pads, S-ranged actions (`offset`, `aim`, `item`,
`noaccel`, `brake`, `drift`, `wheelie`, `stick`, `look`; `laps: [...]`, `untilRespawn`).
It records the raw inputs (→ `buildRKG`) and events: laps, airtime (takeoff/landing, rise, trick,
ramp boost, jump pad, landed on the road?), boost activations (MT / panel+item / trick),
respawns (fall S, landing S/lat, on road?), wall/offroad frames.

## File formats

### RKG (ghost) — tools/ghost/rkg.ts

0x2800 bytes, uncompressed: `RKGD`, finish time/course slot, vehicle / character (engine ids) /
date / controller, flags incl. drift type and input
data size, lap splits, driver profile (+CRC16), input data at 0x88, CRC32 at 0x27FC. Input data: u16 face /
stick / trick run counts, then run-length streams — face (0x01 A, 0x02 B, 0x04 item, 0x08 drift
bit when B is pressed with A held; runs ≤ 255), stick `x << 4 | y` raw 0..14 (7 = neutral), trick
`trick << 12 | frames` (0 none, 1 up, 2 down, 3 left, 4 right). Input #0 is consumed on frame 173
(after the 172-frame intro); the race starts on frame 412.

### KCL / KMP

Documented at the top of `tools/course/lib/kcl.ts` (prism layout, octree encoding) and
`tools/course/lib/kmp.ts` (section/entry layouts, revision 2520).

## course_meta.json (for the renderer / app)

```jsonc
{
  "id": "golden_gate", "name": "Golden Gate", "description": "...",
    "length": 719301.2, "laps": 1,
  "theme": { "sky": "#7ec8ff", "fog": "#e8f4ff", "ground": "#f4f8ff", "road": "#c9ccd6",
             "offroad": "#eef3ff", "wall": "#f2c14e", "accent": "#ff4fa3" },
  "groundY": -6000,                     // suggested ground-plane height; null = none
  "bbox": { "min": [x, y, z], "max": [x, y, z] },   // drivable geometry (no fall boundaries)
  "crossSection": { "roadHalfWidth", "offroadWidth": [l, r], "wallHeight", "kcl": { ... } },
  "start": { "pos": [x, y, z], "angleDeg": 0, "s": 5000, "width": 4400 },   // finish line (center, yaw, full width)
  "spawn": { "pos", "angleDeg", "s" },                                      // KTPT
  "segments": { "<name>": [s0, s1], ... },                                  // program segments in S
  "features": [
    // every feature: type, s: [s0, s1], pos (surface center), yawDeg (driving direction),
    // length, lat: [lo, hi], width, size: [width, length]
    { "type": "dashPanel", ... },
    { "type": "jumpPad", "variant": 3, ... },
    { "type": "boostRamp" | "ramp", "attr", "height", "lipPos": [x, y, z], "lipAngleDeg", ... },
    { "type": "gap", ... },
    { "type": "surface", "label", "attr", ... },
    { "type": "island", "halfWidth", "wallH", ... },
    { "type": "shortcut", "label", "attr", "pos": centroid,
      "polygon": [[x, y, z], ...],     // closed outline: road edge points then the chord back
      "chord": [a, b] }
  ],
  "elevation": { "min", "max", "maxGrade" },
  "minCenterlineRadius": 4805,
  "checkpoints": [{ "id", "s", "left": [x, z], "right": [x, z], "key", "jugem" }],   // key -1 = normal, 0 = finish
  "respawns": [{ "id", "s", "pos": [x, y, z], "angleDeg" }],
  "centerline": [{                                   // one per KCL station (150..500 apart)
    "s", "pos": [x, y, z], "right": [x, 0, z], "fwd": [x, 0, z],
    "halfWidth",                                     // max(|wall offsets|)
    "edges": { "wallL", "roadL", "roadR", "wallR", "island" },   // lateral offsets (+left)
    "walls": [left, right],                          // wall present after this station
    "bankDeg"
  }]
}
```
