# Remix SF Kart

SF Kart is open source and made to be remixed. The quickest way to remix it is with
[freecode](https://freecode.sh), the free coding agent:

```sh
npm install -g freecode-sh && freecode
```

Clone the repo, run `npm install && npm run dev`, start freecode in the folder and describe what
you want. [AGENTS.md](../AGENTS.md) tells the agent how the project fits together. It's worth
reading yourself too.

## Ideas, from a small change to a big one

| Remix | Where | Prompt to try |
|---|---|---|
| Recolour a vehicle, give it a new rider or passenger | `src/app/sf/ebike.ts`, `robotaxi.ts`, `buggy.ts` (on `carKit.ts` / `modelKit.ts`) | "Make the Tour Buggy a mint-green convertible with a dog in the passenger seat." |
| New speed-up pickup look | `src/app/sf/itemBoxes.ts` (`pickupKindFor`) | "Give the e-bike a sourdough loaf pickup instead of coffee, with crumbs when it bursts." |
| New trick flourish | `src/app/sf/vehicleModel.ts` (`trickFlourish`) and each model's `update` | "Make the Robo Car do a corkscrew on up-tricks and flash its roof lights." |
| Rename or re-time the rivals | `tools/sf/rivals.ts`, then `npx tsx tools/sf/rivals.ts` | "Add a sixth rival called Fog Horn on the Robo Car, about as fast as Muni." |
| A new vehicle | `src/app/vehicles.ts`, `public/data/vehicles/vehicles.json`, a model in `src/app/sf/` registered in `vehicleModels.ts` | "Add a cable car: heavy, slow off the line, but the best top speed downhill." |
| Tune how a vehicle drives | `public/data/vehicles/vehicles.json` (or `K` in race on the dev server) | "Make the E-Bike a little quicker off the line without changing its top speed." |
| Weather or time of day | `src/app/sf/sky.ts` (`LIGHTING`) | "Add a foggy morning: low sun, thick fog rolling through the Gate." |
| **A track in your city** | `tools/sf/` (see below) | "Build a one-lap course through downtown Chicago along the river." |

Every run is deterministic: the physics engine gives the same result for the same inputs. So if
you change the course or a vehicle's numbers, re-record the rivals and the bot ghost:

```sh
npx tsx tools/sf/rivals.ts
npx tsx tools/sf/pickupBot.ts
```

## A track in your city

The San Francisco course is baked offline from open data. Nothing streams from a map service while
you play. The pipeline is in `tools/sf/` and has five parts:

1. **Area and projection:** `tools/sf/geo.ts` (`BBOX`, `ORIGIN`, the `CORE` and `FAR` extents).
   Change these to your city.
2. **Downloads:** `tools/sf/fetch.ts`:
   - OpenStreetMap (worldwide)
   - AWS Terrain Tiles (worldwide)
   - USGS 3DEP 1 m lidar DEMs (most of the US)
   - NOAA or NAIP aerial imagery (US)

   Outside the US, swap in your country's open elevation and imagery data. `tools/sf/datasf.ts` is
   San Francisco-only: use OpenStreetMap or Overture buildings instead.
3. **The lap:** `tools/sf/route.ts` lists sections as waypoints routed on the OSM street graph, or
   as literal polylines where the course leaves the streets. `tools/course/tracks/golden_gate.ts`
   turns the route into a course: ramps, boost lanes, half-pipes, walls and checkpoints.
4. **Bakes:** run `bakeTrack.ts`, `course/build.ts`, `bakeWorld.ts`, `bakeImagery.ts` and
   `bakeStreetDetail.ts`. The README lists them in order. The output goes to `public/data/`.
5. **Set pieces:** `src/app/sf/sections/*` and `landmarks/*` are hand-made for San Francisco (the
   bridge, Fort Point, the Palace). Your city's landmarks go here.

Tips:
- Keep the lap about 2–3 minutes: 8–12 km at the game's 60 units per metre.
- Keep the collision under the engine's limit of 65,535 triangle normals (`npx tsx tools/course/kclcheck.ts`).
- Drive the bot (`npx tsx tools/course/botlap.ts golden_gate`) after every change: it reports
  wall hits, off-road frames and falls by section.

Only use data you're allowed to redistribute, and credit it: see [DATA_LICENSE.md](../DATA_LICENSE.md).

## Share it

Deploy the static build anywhere: `npm run build` produces `dist/`, data included. Set `SFK_BASE=/`
to serve from a domain root, and `SFK_DATA_BASE` to load the data from a CDN of your own (see the
README's Hosting section). Tag your remix with **#sfkart** and **@freecode**.

## Rules of the road

- Keep the credits (CREDITS.md, DATA_LICENSE.md). OpenStreetMap-derived data is under ODbL.
- No game files, characters, names or art from commercial games. SF Kart's pieces, vehicles and
  sounds are its own. Keep yours your own too.
- Real brands: evoke a type of vehicle ("a robotaxi"), don't copy names or logos.
