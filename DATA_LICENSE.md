# Data licences

Everything under `public/data/` is generated from open data by the scripts in `tools/`. Nothing is
streamed from a map service at runtime.

| Path | What | Sources | Licence / attribution | Generator |
|---|---|---|---|---|
| `public/data/courses/golden_gate/course.kcl`, `course.kmp`, `course_meta.json` | Collision, checkpoints and course layout | OpenStreetMap streets, USGS 3DEP lidar road profile | Derived Database of OpenStreetMap, **ODbL 1.0** ("© OpenStreetMap contributors") | `npx tsx tools/sf/bakeTrack.ts`, then `npx tsx tools/course/build.ts golden_gate` (see `tools/README.md`) |
| `public/data/courses/golden_gate/rivals.{bin,json}`, `bot.rkg` | Recorded CPU rivals and the bot ghost | Our bot on the course above | ODbL 1.0 (derived from the course) | `npx tsx tools/sf/rivals.ts`, `npx tsx tools/sf/pickupBot.ts` |
| `public/data/sf/terrain.bin`, `terrain_far.bin`, `depth.bin`, `landcover.bin` | Ground heights, bay depth, land cover | USGS 3DEP 1 m DEM, NOAA NCEI CUDEM, AWS Terrain Tiles (far field), OpenStreetMap land use | Public domain (USGS, NOAA); Terrain Tiles: [their attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md); OSM parts ODbL 1.0 | `npx tsx tools/sf/bakeWorld.ts` (terrain cells: `tools/sf/terrainBake.ts`) |
| `public/data/sf/img/*` | Ground imagery | NOAA NGS 0.25 m orthoimagery (2025), USDA NAIP | Public domain; credit "NOAA NGS", "USDA NAIP" | `npx tsx tools/sf/bakeImagery.ts` (`far.jpg`: `tools/sf/bakeWorld.ts`) |
| `public/data/sf/world.json` | Buildings, trees, shrubs, water, streets | DataSF building footprints, parcels and street tree list, OpenStreetMap, USGS 3DEP lidar canopy and surface heights (NASA WERK), NOAA / NAIP imagery (roof colours, vegetation) | DataSF: PDDL; OSM: ODbL 1.0; lidar: CC0; imagery: public domain | `npx tsx tools/sf/bakeWorld.ts` |
| `public/data/sf/detail.json` | Crosswalks, sidewalks, bike lanes, meters | DataSF | PDDL | `npx tsx tools/sf/bakeStreetDetail.ts` |
| `public/data/vehicles/*` | Vehicle stats, hitboxes, wheels, camera | SF Kart's own numbers | MIT, like the code | Hand-tuned (`tools/vehicles/compare.ts` compares them) |

The game shows "© OpenStreetMap contributors" and the other credits in its About panel
(`src/app/sf/credits.ts`).
