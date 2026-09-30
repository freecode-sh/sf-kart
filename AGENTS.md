# AGENTS.md: working on SF Kart

A browser kart racer on real San Francisco streets: TypeScript, Vite and three.js on a deterministic,
bit-exact physics engine. Humans: see README.md and docs/REMIX.md.

## Commands
```sh
npm install
npm run dev          # http://localhost:5173 (dev tools on: tuning panel, K, `, window.__kart)
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run build        # production build → dist/ (served at /sf-kart/; SFK_BASE=/ for a domain root)
npx tsx tools/brandLint.ts   # no game or brand names in the product (run before committing)
```

## Map
- `src/egg`, `src/game` (plus `src/abstract`, `src/Common.ts`): **the physics engine** (a port of
  Kinoko). Treat it as read-only. It is
  bit-exact and deterministic: the same inputs always give the same race. Don't "fix" float math
  in it, and don't add randomness or wall-clock time to anything that affects a run.
- `src/app/main.ts`: boot, the fixed 59.94 Hz race loop, finish and results, `window.__kart` (dev
  only).
- `src/app/sim.ts`: the adapter between the app and the engine: input → engine, tricks on the hop
  button, events, the HUD and render state.
- `src/app/easyDrift.ts`: the forgiving drift layer.
- `src/app/rules/`: runs as inputs. `runfile.ts` (the `SFKR` run file: a race's pads, a few KB),
  `course.ts` and `pickups.ts` (the course's pickups and section splits, run by `Sim.step`),
  `hash.ts` (`RULES_VERSION` and the rules hash), `resim.ts` (re-simulates a run headlessly;
  `tools/verify.ts` checks a run file with it).
- `src/app/input.ts`: control schemes. `hud.ts` and `sf/sfHud.ts`: the HUD and the results.
  `menu.ts`: the pause menu (Esc in race). The way into a race is `ui/onboarding.ts`, one card:
  title (the course chart; the camera drifts through `sf/titleShots.ts`), your ride (a 16:9 stage,
  `sf/showroom.ts`: the three vehicles in a studio scene of their own), controls, then
  the times to beat (`ui/leaderboard.ts`) and Race!, which waits for the city to load.
- `src/app/ui/`: the UI kit, theme Fog: `tokens.css` (fog-white cards, ink type, one orange;
  Archivo italic / Public Sans / Paper Mono), `components.css` (card, rows, the one button),
  `chart.ts` (the course chart, baked by `tools/sf/bakeChart.ts`), `dom.ts` (`el()`, `button()`),
  `identity.ts` (the name, the "by freecode" lockup, the loading card), the vendored fonts and
  brand files. Keep screens simple: one card, one button, no captions.
- `src/app/vehicles.ts`: the three vehicles. Their numbers are in
  `public/data/vehicles/vehicles.json`, packed into the engine's layouts by `src/app/vehicleData.ts`.
- `src/app/sf/`: San Francisco.
  - `scene.ts` loads everything.
  - Vehicle models: `ebike.ts`, `robotaxi.ts`, `buggy.ts`, `carKit.ts`, `modelKit.ts`,
    `vehicleModel.ts`.
  - Speed-up pickups: `itemBoxes.ts` (drawing; the gameplay is `rules/pickups.ts`). Game pieces: `padMaterial.ts`, `kclExtras.ts`.
  - Set pieces: `sections/*`. Landmarks: `landmarks/*`. Bridge: `bridge.ts` and `bridgeParts/`.
  - Rivals: `rivals.ts`. Your own ghosts: `ghosts.ts` (playback), `runStore.ts` (your best runs as
    run files, IndexedDB), `ghostWorker.ts` / `ghostSim.ts` (pose tracks simulated from run files).
- `tools/`: offline bakes and bots. `tools/sf/` (data pipeline, rivals, screenshots),
  `tools/course/` (course builder and bot). See tools/README.md.
- `public/data/`: everything the game loads, all baked (see DATA_LICENSE.md).

## Rules
- **Determinism:** anything that changes a run must depend only on the inputs and the kart state,
  and must run identically in live play and in replays. A run is the pads `Sim.step` took from
  `Sim.start()` (`sim.recording`); replayed through `Sim.startRun` or `rules/resim.ts` they must
  drive the same run, so everything that affects it happens inside `Sim.step` (the drift layer,
  hop-button tricks, the start boost, the speed-up pickups). No `Math.hypot`/`**`/trig in rules
  code outside the engine: other JS engines may round them differently. After changing the course,
  a vehicle's numbers or gameplay rules, re-record: `npx tsx tools/sf/rivals.ts` and
  `npx tsx tools/sf/pickupBot.ts`; after changing gameplay code, bump `RULES_VERSION`
  (`src/app/rules/hash.ts`; `tests/rulesVersion.test.ts` reminds you).
- **Course budget:** the collision (KCL) must stay under 65,535 normals.
- **No copied IP:** no names, art, sounds or files from commercial games, and no real vehicle
  brands or logos. `tools/brandLint.ts` checks the product. Keep the credits files accurate.
- **Dev-only tools:** anything for tuning or debugging goes behind `DEV_TOOLS`
  (`src/app/devMode.ts`).
- **Data URLs:** load data through `src/app/data.ts` (`loadData('sf/world.json')`, ...) or
  `dataUrl()` (`src/app/paths.ts`), never `/data/...` literals: the build serves hashed, gzipped
  copies, from a CDN in production. A new file the boot needs goes in `src/app/bootData.ts`.
- **UI text is text:** build DOM with `src/app/ui/dom.ts`, never `innerHTML` with anything built at
  run time (player names will render on freecode.sh). `tests/noInnerHtml.test.ts` enforces it.
  Colours, sizes and durations come from `src/app/ui/tokens.css` (durations in multiples of 60 ms).
- **Style:** match the surrounding code: comment density, naming, small focused modules.
- **Checking visuals:** use the headless screenshot tool (`npx tsx tools/sf/shot.ts OUT --
  js:... shot:name`, see its header) against a running `npm run dev`. The `window.__kart` hook
  offers `step(n, pad)`, `fastForward(n)`, `replay(url)` and `look(pos, target)`. It runs Chrome
  headless and muted.
