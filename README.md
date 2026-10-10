# EUROPA

EUROPA is an open-source browser-based first-person survival-game prototype set in a fictional civilisation-collapse scenario, built toward using real-world European geography.

## Current milestone: EUROPA-002C — World Streaming (development branch)

**Available:** WASD, mouse look/pointer lock, jump, sprint, gravity, collisions, FPS + streaming HUD, geographic coordinates, optional OSM town data and streamed 250m chunks generated from it. **Not available:** true terrain elevation, all-Europe data, survival systems, saves, multiplayer.

### Windows / WebStorm

Requirements: Node.js 22, pnpm 9.12.0. Open the project folder in WebStorm and run:

```powershell
pnpm install
pnpm dev
```

Open http://localhost:5173 and click **CLICK TO ENTER**.

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| Esc | Release mouse |

Validation:

```powershell
pnpm typecheck
pnpm build
```

The built-in 001 fallback scene is **synthetic**. Run `pnpm map:fetch --osm-api` only if you do not yet have a local OSM extract; with an existing `map.json`, run `pnpm map:chunks` offline to prepare streaming. See [EUROPA-002B importer guide](docs/GEO-002B.md). The movement controller uses a mesh collider (not `camera.moveWithCollisions()`).

## Geographic preview (002A branch)

A WGS84 local-tangent projection and a location HUD were added in 002A. The HUD remains clearly labelled **simulated** while the synthetic scene is active. See [docs/GEO-002A.md](docs/GEO-002A.md). Run `pnpm test` for geographic and OSM importer tests.

## Recognisable Nova Zagora — 002D.1

Import *real OSM names and public landmarks* into an independent optional navigation file. See [the 002D.1 guide](docs/GEO-002D-NAVIGATION.md). If you already saved raw OSM JSON, use `pnpm map:nav --input PATH`; otherwise a manually requested, one-time prototype fetch is available via `pnpm map:nav --osm-api`. Neither option rewrites map.json or existing 250m chunks.

## Roadmap

- **001**: browser engine and movement (playtested)
- **002A**: geographic coordinate foundation (merged)
- **002B**: OpenStreetMap import and generated roads/buildings (development branch)
- **002C**: 250m tile generation and local streaming (merged). See [002C guide](docs/GEO-002C.md).
- **002D.1**: real OSM street names and available public landmarks (development branch)

## License

Game source code: [GPL-3.0](LICENSE). Future map data, derived databases, and third-party media will have independent attribution/license requirements; see [CONTRIBUTING.md](CONTRIBUTING.md).


## EUROPA-002D.2 — Building coverage and Bulgarian architecture

On branch `feat/europa-002d2-building-coverage-architecture`, the game displays procedural red/slate pitched roofs on suitable OSM building footprints and optional 3D POI labels. A label saying **OSM POI · NO IMPORTED FOOTPRINT** means the point is mapped but the current 3D extract has no nearby building outline; it is **not** an invented physical building.

Run `pnpm map:coverage --name "TBI Bank"` offline to inspect the bank's position, nearest imported building and distance. See [building coverage guide](docs/GEO-002D2-BUILDINGS.md).

A future fresh raw OSM extract can be imported with `pnpm map:fetch --input "path/to/raw-osm.json"`. The improved importer can retain building outlines crossing the square edge and simple multipolygon relations, but it still cannot create building footprints that OSM does not contain. Never repeat upstream API requests just to regenerate chunks.


### 002D.2b — Landmarks and trees

Floating landmarks now use upright HTML camera projections instead of mirrored Babylon billboards. Procedural verge trees add atmosphere in streamed chunks without inventing additional mapped buildings. [See the streetscape guide](docs/GEO-002D2-STREETSCAPE.md).


### EUROPA-002D.3 — Offline real-building recovery

A preview-first pipeline imports small osmium GeoJSON extracts with genuine OSM feature IDs, compares coverage and optional school/civic sites, and only replaces the game map plus all sixteen chunks via an explicit, quality-gated `--apply`. See [building recovery guide](docs/GEO-002D3-RECOVERY.md). The game never invents physical buildings from POI pins.
