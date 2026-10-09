# EUROPA

EUROPA is an open-source browser-based first-person survival-game prototype set in a fictional civilisation-collapse scenario, built toward using real-world European geography.

## Current milestone: EUROPA-001 — Browser engine foundation

**Available:** synthetic test environment, WASD, mouse look/pointer lock, jump, sprint, gravity, basic mesh collisions, FPS HUD, diagnostics. **Not available:** real geographic maps, survival systems, saves, multiplayer.

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

The 001 scene is **synthetic**, not a replica of Nova Zagora. Its movement controller uses a mesh collider (not `camera.moveWithCollisions()`).

## Roadmap

- **001**: browser engine and movement (playtested)
- **002A**: geographic coordinate foundation
- **002B**: OpenStreetMap import and generated roads/buildings
- **002C**: chunk streaming

## License

Game source code: [GPL-3.0](LICENSE). Future map data, derived databases, and third-party media will have independent attribution/license requirements; see [CONTRIBUTING.md](CONTRIBUTING.md).
