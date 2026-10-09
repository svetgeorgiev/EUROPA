# EUROPA

EUROPA is an open-source browser-based first-person survival-game prototype set in a fictional civilisation-collapse scenario, built toward using real-world European geography.

## Current milestone: EUROPA-002B — OpenStreetMap importer (development branch)

**Available:** WASD, mouse look/pointer lock, jump, sprint, gravity, basic mesh collisions, FPS HUD, diagnostics, geographic coordinates and optional OpenStreetMap roads/building footprints after local import. **Not available:** elevation terrain, streaming, survival systems, saves, multiplayer.

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

The built-in 001 fallback scene is **synthetic**. Run `pnpm map:fetch` to download real OpenStreetMap street and building geometry for a small portion of Nova Zagora. See [EUROPA-002B importer guide](docs/GEO-002B.md). The movement controller uses a mesh collider (not `camera.moveWithCollisions()`).

## Geographic preview (002A branch)

A WGS84 local-tangent projection and a location HUD were added in 002A. The HUD remains clearly labelled **simulated** while the synthetic scene is active. See [docs/GEO-002A.md](docs/GEO-002A.md). Run `pnpm test` for geographic and OSM importer tests.

## Roadmap

- **001**: browser engine and movement (playtested)
- **002A**: geographic coordinate foundation (merged)
- **002B**: OpenStreetMap import and generated roads/buildings (development branch)
- **002C**: chunk streaming

## License

Game source code: [GPL-3.0](LICENSE). Future map data, derived databases, and third-party media will have independent attribution/license requirements; see [CONTRIBUTING.md](CONTRIBUTING.md).
