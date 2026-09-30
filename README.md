# SF Kart

A browser kart racer on real San Francisco streets. One lap of the Golden Gate course, about three
minutes: Crissy Field, Fort Point under the bridge, both ways across the Golden Gate Bridge, the
Presidio Parkway tunnels and the Palace of Fine Arts, against five CPU rivals. The city is baked
from open data (OpenStreetMap, USGS lidar, NOAA imagery, DataSF) and the driving runs on a
deterministic, bit-exact physics engine.

**Play:** [freecode.sh/sf-kart](https://freecode.sh/sf-kart) · **Remix it** with
[freecode](https://freecode.sh): `npm install -g freecode-sh && freecode`, then see
[docs/REMIX.md](docs/REMIX.md).

Needs Node.js 22.12 or newer.

```sh
npm install
npm run dev          # http://localhost:5173
```

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | type check + production build (`dist/`) |
| `npm test` | unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |

## Playing

Press Enter on the title, pick a vehicle (the Robo Car is the easy one to start with), pick your
controls, and race from the times to beat once San Francisco has loaded. Your choices are saved.

| | WASD | WASD + Mouse | Arrows |
|---|---|---|---|
| Accelerate | W | W | X |
| Steer | A / D | mouse (analog, 15 steps like a stick) | ← / → (Shift: half tilt) |
| Stick up / down (dive in the air) | R / F | R / F | ↑ / ↓ |
| Hop / drift / trick off a ramp | Space | left click or Shift | W |
| Brake / reverse | S | S | Z |
| Wheelie (e-bike) / trick | Shift or Q | Space | T F G H |
| Use a stored speed-up | E | right click or E | Q |

A gamepad always works: A accelerate, B brake, RB/RT hop, drift and tricks, LB/LT speed-up, the
D-pad for tricks (up: a wheelie).

In a race: `Esc` opens the menu, `Backspace` restarts (`Enter` from the results), `P` pauses, `C`
switches to the next vehicle (and restarts), `B` toggles the street detail.

- **Vehicles:** the **Share E-Bike** (a silver bike-share e-bike: inside drifts, mini-turbos,
  wheelies), the **Robo Car** (heavy car: top speed, wide stable slides, super mini-turbos, nobody at
  the wheel) and the **Tour Kart** (heavy car: quicker off the line, tighter, lower top speed).
- **Drifting:** hold drift and steer (even after the hop) to slide; sparks go white → blue
  (mini-turbo) → orange (super mini-turbo, cars); let go to boost. Without the button it never
  drifts, so plain steering takes the corners too.
- **Jumps and tricks:** press hop as you leave a ramp (or on the ramp,
  just before the lip) for a trick, steer for a side trick, and land it for a boost. Each vehicle
  has its own tricks (flips and spins for the cars, a superman or a no-hander on the e-bike).
- **Speed-ups:** you start with three to use yourself, and each pickup you drive through adds one
  back (up to three): batteries for the Robo Car, gas cans for the Tour Kart, coffee for the
  E-Bike.
- **Start:** a quick 3, 2, 1, and everyone gets the best start boost at GO.
- **Race:** a time trial against five recorded rivals across the three vehicles (Karl the Fog on a
  Robo Car, Sutro and Lombard on e-bikes, Muni and Coit on Tour Karts; about 2:43 to 3:07), with
  live race position, minimap, section banners, a results board with section splits and a
  procedural surf-rock soundtrack. The rivals are playbacks of bot runs: no collisions, no
  slipstream.
- **Ghosts:** your best run in each vehicle races along as a translucent ghost (*Compare ghosts* in
  the menu), and the results board compares your section splits with each vehicle's best.
- **Leaderboard** (on freecode.sh): sign in with a freecode account and pick a board name. A run
  that beats your board time is posted as the run itself (its inputs, a few KB). The server races
  it again with the game's own code and puts it on the board only if it finishes in the time you
  got. There's a board for all vehicles and one for each vehicle.

### Developer tools

On the dev server (or anything served from `localhost`) there is more; `src/app/devMode.ts` turns
it off everywhere else, where every vehicle races with its stock tune:

- the menu's **Tuning** panel: nudge a vehicle's stats relative to stock (top speed, acceleration,
  handling, drift, drift angle, turn drag, offroad, mini-turbo); applies on restart;
- `K` in race: a live tuning panel whose sliders change the running race instantly
  (`src/app/devTuning.ts`; a run tuned mid-race isn't kept as a best). *Copy* gives the values as
  multipliers to bake into `public/data/vehicles/vehicles.json`;
- `` ` `` toggles the physics debug panel, `.` steps one frame while paused;
- `window.__kart`, a scripting hook used by `tools/sf/shot.ts` (screenshots) and
  `tools/sf/record.ts` (playthrough recordings).

Tuning patches the vehicle's entry in a copy of its parameter file (`src/app/tuning.ts`), so the
engine is untouched and races stay deterministic.

## How it works

- **Physics:** `src/egg` and `src/game` are a line-by-line TypeScript port of
  [Kinoko](https://github.com/vabold/Kinoko) (MIT), an independent open-source reimplementation of
  a classic console kart racer's physics. Every float operation rounds to f32 exactly like the
  original, including fused multiply-add, table-based trig and reciprocal approximations, so a race
  is fully determined by its inputs. See `docs/PORTING.md`. SF Kart ships no code, art, audio or
  files from any commercial game (see [CREDITS.md](CREDITS.md)).
- **Course:** `tools/course/` builds the course collision (KCL), layout (KMP) and metadata from
  `tools/course/tracks/golden_gate.ts` and a route over the real street graph (`tools/sf/route.ts`).
  The app runs the engine at 59.94 Hz with a fixed timestep (`src/app/sim.ts`).
- **Drifting:** `src/app/easyDrift.ts` makes the engine's manual drift forgiving (see above).
- **Rendering:** three.js. `src/app/sf/` draws San Francisco: `scene.ts` loads everything,
  `terrain.ts` + `groundMaps.ts` (0.25 m aerial imagery on the 1 m lidar terrain), `road.ts`,
  `kclExtras.ts` (ramps, half-pipes and islands straight from the collision), `buildings.ts` (DataSF
  buildings lot by lot with lidar heights and one facade / roof shader), `trees.ts` + `treeCards.ts`,
  `streets.ts`, `streetDetail.ts`, `sky.ts` (physically based golden-hour sky, water coloured by the
  real depth), `sections/*` (the course's set pieces), `bridge.ts` + `bridgeParts/`,
  `landmarks.ts`, the vehicles (`ebike.ts`, `robotaxi.ts`, `buggy.ts` on `carKit.ts` and
  `modelKit.ts`), `rivals.ts`, `ghosts.ts`, `itemBoxes.ts`, `sfHud.ts`, `music.ts`.
  `sfviewer.html?model=bridge` shows a single model (`model=ebike&steer=1&drift=1` poses a vehicle).

### Rebuilding the San Francisco data

Everything is downloaded once into `.context/` (gitignored scratch space) and baked into
`public/data/` (no keys, no runtime streaming):

```sh
npx tsx tools/sf/fetch.ts                        # OSM, terrain tiles, 1 m lidar DEMs + canopy, NOAA/NAIP imagery → .context/sf/ (~4 GB)
npx tsx tools/sf/datasf.ts                       # DataSF: buildings (lidar heights), parcels, street trees, street detail
npx tsx tools/sf/bakeTrack.ts                    # route → centerline + road heights from the lidar (tools/sf/profile.ts)
npx tsx tools/course/build.ts golden_gate        # KCL/KMP/meta
npx tsx tools/sf/bakeWorld.ts                    # terrain cells, land cover, buildings, trees, streets, water depth
npx tsx tools/sf/bakeImagery.ts                  # NOAA 0.25 m imagery: 1 m base + 0.3 m detail along the road, NDVI
npx tsx tools/sf/bakeWorld.ts                    # again, to pick up the imagery (roof colours, trees use the NDVI)
npx tsx tools/sf/bakeStreetDetail.ts             # crosswalks, curbs, sidewalks, bike lanes, meters → detail.json
npx tsx tools/sf/bakeChart.ts                    # the menus' course chart (lap, land, coast, streets) → chart.json; then sh tools/brand/icons.sh
npx tsx tools/sf/rivals.ts                       # CPU rivals → public/data/courses/golden_gate/rivals.{bin,json}
npx tsx tools/sf/pickupBot.ts                    # the bot ghost with the pickups → bot.rkg
npx tsx tools/course/botlap.ts golden_gate --laps 1   # bot lap report; --vehicle robotaxi|buggy for the cars
```

- Heights (`heights.ts`): USGS 3DEP 1 m bare earth (San Francisco 2023, Marin 2018), NOAA CUDEM
  topobathy for the bay, AWS Terrain Tiles beyond; relative to mean sea level.
- The road follows the lidar ground, smoothed so it drives well (`profile.ts`: grade cap, crest and
  sag radii); OSM bridges and tunnels are bridged over, the Golden Gate deck and the Vista Point dip
  are designed. The Presidio Parkway's viaducts stand on piers (`corridor.ts`).
- Imagery (`bakeImagery.ts`): NOAA NGS February 2025 photos (NAIP 2022 in Marin, matched to their
  colour), graded to lift the winter shadows and warm the cool cast (`grade.ts`).
- Buildings (`buildingsBake.ts`): DataSF footprints split into one building per lot by the parcels
  (OSM where DataSF has none), wall height and pitched roofs from the 2023 lidar, roof colours from
  the photos. Trees (`treesBake.ts`): DataSF street trees and lidar canopy tops (Marin: from the
  land cover and the photo). Shrubs (`shrubsBake.ts`): the lidar's low green vegetation, the photo's
  brush in Marin.
- `tools/sf/route.ts` defines the lap: sections routed on the OSM street graph between waypoints,
  or literal polylines where the course leaves the streets.
- `npx tsx tools/sf/shot.ts OUT -- js:... shot:name` takes screenshots of the running dev server.
- Optional: `lidar.ts` downloads the bridge's 2023 lidar points and `bridgeFit.ts` measures the
  bridge model against them (a report in `.context/bridge-fit/`); nothing the game loads.

See `tools/README.md` for the course builder and the bot.

## Credits

Physics engine ported from [Kinoko](https://github.com/vabold/Kinoko) by vabold and contributors
(MIT). Rendering: [three.js](https://threejs.org) (MIT).

Map data © OpenStreetMap contributors (ODbL). Elevation: USGS 3DEP lidar (public domain), NOAA NCEI
CUDEM (public domain), AWS Terrain Tiles. Imagery: NOAA National Geodetic Survey (public domain),
USDA NAIP via the USGS National Map (public domain). Canopy: USGS 3DEP processed by NASA WERK (CC0).
Buildings, street trees and street detail: City and County of San Francisco, DataSF (PDDL).
(`src/app/sf/credits.ts` exports these lines for the app).

The vehicles' parameters (stats, hitboxes, wheels and suspension, camera) are our own data,
`public/data/vehicles/vehicles.json`; `src/app/vehicleData.ts` packs them into the layouts the
engine parses.

## Hosting

`npm run build` writes a static site to `dist/` with its URLs under `/sf-kart/` (`vite.config.ts`;
`SFK_BASE=/` for a domain root) and the data in `dist/data/`. `vercel.json` deploys it as its own
Vercel project with a strict content security policy; freecode.sh serves it at `/sf-kart` by
rewriting to that deployment.

That project builds with `SFK_CDN=https://cdn.freecode.sh/sf-kart`, so the game's data (about
15 MB) loads from Cloudflare R2 instead of Vercel, at a folder named by the data's hash that caches
forever. After changing anything in `public/data/`, upload the new version before deploying (the
build fails until it's there):

```sh
npx tsx tools/uploadData.ts   # needs wrangler, logged in to freecode's Cloudflare account
```

### Leaderboard

The leaderboard is a Cloudflare Worker, `api/`, at `sfkart-api.freecode.sh`:
- D1 holds players, runs and bests.
- R2 `sfkart-runs` holds the run files.
- Players are freecode accounts, checked against freecode's auth server's public keys.
- The game shows the leaderboard only when it's built with `SFK_API=https://sfkart-api.freecode.sh`
  (set in the Vercel project).

A run is posted as its engine inputs, in a run file (`src/app/run/runFile.ts`). The API races it
again (`src/app/run/verify.ts`) through the same frame code the game uses (`src/app/run/race.ts`),
so a posted time is the time those inputs make. Each board is a season: a rules id that hashes
`RULES_VERSION` and the course and vehicle data (`src/app/run/rules.ts`). Change the rules and a
new board starts.

```sh
npx tsx api/deploy.ts --staging   # sfkart-api-staging.freecode.workers.dev, its own D1
npx tsx api/deploy.ts             # production: data upload, D1 migrations, then the Worker
```

Deploy the API before the game whenever the rules change. Until then, the API refuses the new
game's runs as stale.

The data isn't served as it is in `public/data/`: the build writes a deploy copy to `dist-data/`
(`tools/lib/dataBuild.ts`), each file named by its content hash (cached for good) and gzipped where
that pays off (the game unpacks it). Without `SFK_DATA_BASE` it goes into `dist/data/`, next to the
app. freecode.sh loads it from its CDN instead (a Cloudflare R2 bucket):

```sh
npx tsx tools/uploadData.ts                  # what would be uploaded (files the CDN doesn't have yet)
npx tsx tools/uploadData.ts --apply          # upload them (wrangler, logged in)
SFK_DATA_BASE=https://cdn.freecode.sh/sf-kart npm run build   # an app that loads from there
```

## Layout

- `src/egg`, `src/game`, `src/abstract`, `src/Common.ts`: the physics engine (Kinoko port; mirrors
  its source tree, see `docs/PORTING.md`).
- `src/app`: the browser app (three.js renderer, input, audio, HUD, menu); `src/app/sf`: San Francisco.
- `src/app/run`: races as run files, and their verification; `src/app/leaderboard`: the board in the game.
- `api/`: the leaderboard API (Cloudflare Worker, D1 migrations).
- `tools/`: course builder, bot, San Francisco data bakes.
- `tests/`: unit tests (`npm test`), including the math core pinned to Kinoko's C++ output.
- `public/data/`: everything the game loads, baked by `tools/` (see [DATA_LICENSE.md](DATA_LICENSE.md)).

## License

The code is [MIT](LICENSE). The baked data in `public/data/` keeps its sources' licences (OpenStreetMap-derived
files are ODbL): see [DATA_LICENSE.md](DATA_LICENSE.md) and [CREDITS.md](CREDITS.md).
