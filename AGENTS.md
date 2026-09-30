# AGENTS.md: working on SF Kart

A browser kart racer on real San Francisco streets: TypeScript, Vite and three.js on a deterministic,
bit-exact physics engine. Humans: see README.md and docs/REMIX.md.

## Commands
```sh
npm install          # Node.js 22.12+
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
- `src/app/input.ts`: control schemes. `hud.ts` and `sf/sfHud.ts`: the HUD. `menu.ts`: the menu.
- `src/app/vehicles.ts`: the three vehicles. Their numbers are in
  `public/data/vehicles/vehicles.json`, packed into the engine's layouts by `src/app/vehicleData.ts`.
- `src/app/sf/`: San Francisco.
  - `scene.ts` loads everything.
  - Vehicle models: `ebike.ts`, `robotaxi.ts`, `buggy.ts`, `carKit.ts`, `modelKit.ts`,
    `vehicleModel.ts`.
  - Speed-up pickups: `itemBoxes.ts`. Game pieces: `padMaterial.ts`, `kclExtras.ts`.
  - Set pieces: `sections/*`. Landmarks: `landmarks/*`. Bridge: `bridge.ts` and `bridgeParts/`.
  - Rivals: `rivals.ts`. Your own ghosts: `ghosts.ts`.
- `src/app/run/`: the leaderboard's rules: `race.ts`, the frame code the game and the verifier share;
  `runFile.ts`, a run as its engine inputs; `verify.ts`, racing one again headless; `rules.ts`, the
  rules id (season). `src/app/leaderboard/`: the board in the game. `api/`: the leaderboard
  Worker (`npx tsx api/deploy.ts [--staging]`).
- `tools/`: offline bakes and bots. `tools/sf/` (data pipeline, rivals, screenshots),
  `tools/course/` (course builder and bot). See tools/README.md.
- `public/data/`: everything the game loads, all baked (see DATA_LICENSE.md).
- `.context/` (gitignored): the tools' downloads, caches, reports and recordings.

## Rules
- **Determinism:** anything that changes a run must depend only on the inputs and the kart state,
  and must run identically in live play and in ghost replays. Examples: the speed-up pickups and
  the hop-button trick mapping, whose output is what gets recorded. After changing the course,
  a vehicle's numbers or gameplay rules, re-record: `npx tsx tools/sf/rivals.ts` and
  `npx tsx tools/sf/pickupBot.ts`.
- **Leaderboard rules:** anything that decides a race goes through `src/app/run/race.ts`, so
  `verify.ts` races a posted run exactly as it was played (`tests/run.test.ts`). If that code or the
  engine changes the outcome of a race, bump `RULES_VERSION` in `rules.ts`, which starts a new
  season. `tests/rules.test.ts` fails whenever those files change. Deploy the API
  (`npx tsx api/deploy.ts`) before the game.
- **Course budget:** the collision (KCL) must stay under 65,535 normals.
- **No copied IP:** no names, art, sounds or files from commercial games, and no real vehicle
  brands or logos. `tools/brandLint.ts` checks the product. Keep the credits files accurate.
- **Dev-only tools:** anything for tuning or debugging goes behind `DEV_TOOLS`
  (`src/app/devMode.ts`).
- **Data URLs:** go through `DATA_BASE` (`src/app/paths.ts`), never `/data/...` literals. Production
  loads the data from R2 (`cdn.freecode.sh`): after changing `public/data/`, run
  `npx tsx tools/uploadData.ts` before deploying.
- **Style:** match the surrounding code: comment density, naming, small focused modules.
- **Checking visuals:** use the headless screenshot tool (`npx tsx tools/sf/shot.ts OUT --
  js:... shot:name`, see its header) against a running `npm run dev`. The `window.__kart` hook
  offers `step(n, pad)`, `fastForward(n)`, `replay(url)` and `look(pos, target)`. It runs Chrome
  headless and muted.
