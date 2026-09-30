# Credits

## Engine
SF Kart's driving physics is a line-by-line TypeScript port of
[Kinoko](https://github.com/vabold/Kinoko) (MIT). Kinoko is an independent, open-source
reimplementation of the physics of a classic Wii kart racer. SF Kart ships none of that game's
files, models, sounds, names or characters, and it is not affiliated with or endorsed by Nintendo.
The vehicles run on our own stats (`public/data/vehicles/`), and all art, sound and music are
original or procedural.

Kinoko's license:

```
MIT License

Copyright (c) 2022-2026 vabold

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## San Francisco data
See [DATA_LICENSE.md](DATA_LICENSE.md) for each shipped file's source, licence and generator.

- Map data © OpenStreetMap contributors, ODbL 1.0
- Elevation: USGS 3DEP lidar; NOAA NCEI CUDEM (public domain); AWS Terrain Tiles
  ([attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md))
- Imagery: NOAA National Geodetic Survey; USDA NAIP (public domain)
- Canopy: USGS 3DEP via NASA WERK (CC0)
- Buildings, street trees and street detail: City and County of San Francisco, DataSF (PDDL)

## Libraries
- [three.js](https://threejs.org) (MIT)
- [Vite](https://vite.dev) (MIT)

## Fonts
Latin subsets (`tools/fonts/subset.sh`), shipped with their licences in `src/app/ui/fonts/`.

- [Paper Mono](https://github.com/paper-design/paper-mono) v0.310, © 2025 The Paper Mono Project
  Authors, SIL Open Font License 1.1 (`src/app/ui/fonts/PaperMono-OFL.txt`)
- [Public Sans](https://github.com/uswds/public-sans) v2.001, © 2015 The Public Sans Project
  Authors, SIL Open Font License 1.1 (`src/app/ui/fonts/PublicSans-OFL.txt`)
- [Archivo](https://github.com/Omnibus-Type/Archivo) v2.001 (italic), © 2020 The Archivo Project
  Authors, SIL Open Font License 1.1 (`src/app/ui/fonts/Archivo-OFL.txt`)

## freecode
The freecode mark and wordmark (`src/app/ui/brand/`) are freecode's, as freecode.sh ships them,
used unaltered for the "by freecode" lockup. They are not covered by this repository's MIT licence:
a remix that isn't freecode's should drop them.

Built with [freecode](https://freecode.sh).
