# EUROPA-002B — OpenStreetMap map importer (developer preview)

The GitHub branch adds an import pipeline and a 3D map renderer. **It does not bundle map data from OpenStreetMap.** This is intentional: the code remains GPL-3.0, while generated OSM-derived map data has separate ODbL licensing and attribution requirements.

## What works

- Convert a small (~1 km × 1 km) square near Nova Zagora to an Overpass API bounding box.
- Download **real OSM highway ways and closed building ways** from Overpass.
- Transform geodetic WGS84 points into the local X/Z metres from EUROPA-002A.
- Clip road segments to the town square; generate road-width surfaces and simplified polygon buildings.
- Use OSM building heights when tagged; otherwise use level counts or an estimated height.
- Spawn near a road and keep the existing first-person collider/movement.
- Keep the old test environment as a fallback until the downloaded map exists.
- Always display OSM attribution when displaying the imported world.

## Running (Windows / WebStorm)

From the *GitHub clone* (not the original ZIP directory):

\`\`\`powershell
git fetch origin
git switch feat/europa-002b-osm-importer
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm map:fetch
pnpm dev
\`\`\`

The downloader needs internet. If both Overpass servers return errors, run `pnpm map:fetch --osm-api` **once** for the small dev region; this opt-in option uses the OSM main API, which must not be used for bulk downloads. See [small-area fallback](GEO-002B-API-FALLBACK.md). If the first Overpass endpoint is unavailable, it tries a second one. Public Overpass instances rate-limit requests; do not run it repeatedly or use it as a live game server. The script refuses to overwrite a previously good map if the response contains insufficient data.

**Important:** Vite reads the generated file from \`public/worlds/nova-zagora/map.json\`. Refresh the browser after the download. If the file doesn't exist or can't be parsed, the original synthetic map still appears, and the UI clearly says \`TEST ENVIRONMENT · IMPORT PENDING\`.

If you already have an Overpass JSON export, import it offline:

\`\`\`powershell
node --experimental-strip-types scripts/fetch-osm.mjs --input .\path\to\overpass.json
\`\`\`

### Expected visual result

Street directions and building footprints come from OpenStreetMap. Buildings are simplified solid extrusions, not replicas of actual facades. Roads are flat grey surfaces. Ground is flat and green. There are no real terrain heights, satellite imagery, interiors, vegetation, roadsigns, or streamed chunks in 002B.

### Technical boundaries

- Anchor is currently approximate: \`42.4930°N, 26.0110°E\`, altitude placeholder 0m.
- Bounding square is 500m in all horizontal directions from anchor, projected via the 002A coordinate helper.
- Building geometry: tagged *closed ways* only. Some complex multipolygon buildings are intentionally omitted.
- Some building height values are guessed (e.g. 3m per level) and should not be treated as ground truth.
- Roads are represented as two-triangle surfaces per OSM segment. Widths are approximations based on road tags.
- Cropping of roads uses a local, axis-aligned 510m square. Buildings crossing the edge are skipped.
- No chunk streaming yet; importing much larger areas could degrade performance.
- Map content and attribution depend on OSM mapping completeness for the town. OSM is not surveyed ground truth.

### Data licensing

OpenStreetMap data: **© OpenStreetMap contributors**, Open Database License 1.0, <https://www.openstreetmap.org/copyright>. Generated \`map.json\` contains an OSM-derived collection of streets and footprints, so treat that database under ODbL. Review obligations before redistributing it. Do not pull copyrighted Google Maps or other restricted imagery into the repository.

EUROPA source code remains GPL-3.0. The renderer displays OSM credit on screen. Generated map data is intentionally gitignored, to avoid confusing data and code licensing.

## Troubleshooting

- **Old test map:** Run \`pnpm map:fetch\`; check that \`public/worlds/nova-zagora/map.json\` exists; refresh the browser.
- **HTTP 429, timeout or other Overpass errors:** Wait and retry later; use the offline \`--input\` option if you have a compatible export.
- **Few or missing buildings:** OSM coverage varies and multipolygon buildings are excluded in this milestone.
- **Type errors:** Share the complete \`pnpm typecheck\` output, plus \`pnpm -v\` and \`node -v\`.
- **Collision or geometry issues:** Report street/building OSM IDs when visible in the JSON.
