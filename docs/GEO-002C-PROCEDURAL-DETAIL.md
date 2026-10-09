# EUROPA-002C.3 — Procedural street and facade detail

## Context

The 002C.2 lighting adjustment corrected very dark road surfaces, but a browser screenshot still showed a washed-out green/beige scene: plain green ground, a single featureless road surface and blank flat building facades. A meaningful next visual milestone needs **geometry and surface detail**, not another brightness-only tweak.

This update changes the visual presentation on the **existing 002C development branch** while preserving OSM coordinates, chunk format, streaming, gravity and the 002C.1 footprint collision blocker.

## Added

- **Subtle grass grain** and **asphalt grain** generated at runtime from small deterministic canvas textures. No downloads or third-party imagery.
- **Muted overcast lighting** and desaturated, higher-contrast wall/road/ground palette instead of the earlier near-neon grass and pale facades.
- **Roadside concrete strips** and **faded dashed centre markings** on suitable roads. These are *artistically inferred* from road categories, **not mapped OSM sidewalks or actual street markings**.
- **Window frames, dark window panes, mullions and simple doors** procedurally placed along building footprints. These represent a plausible urban prototype, **not surveyed real facades or true building entrances**.
- All facade details are combined into **one mesh per active 250m chunk**, rather than creating an individual Babylon mesh for each door or window. Roadside strips and lane marks are likewise batched.
- Render details are attached to a streamed chunk's mesh array and disposed with that chunk.
- Static 002B fallback receives the same materials and geometry details.
- No new data schema and no changes to local ODbL source data.
- Unit tests for procedural geometry, winding, dimensions, determinism and street classification.

## Run locally (Windows / WebStorm)

\`\`\`powershell
cd D:\WebstormProjects\EUROPA-GitHub
git switch feat/europa-002c-world-streaming
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

**No \`map:fetch\` or \`map:chunks\` required**; keep the real Nova Zagora data you already downloaded.

## What to test

1. Open http://localhost:5173 and refresh. Street surfaces should be a darker speckled asphalt, with a few faded lane markings and roadside strips.
2. Nearby buildings should have rows of dark windows, simple door silhouettes and less washed-out facades.
3. Walk and sprint into building walls: entry must **remain blocked**, exactly as in the previously user-tested 002C.1 collision fix.
4. Walk into another chunk (watch the TILE counter) and back: new details should load, old geometry should unload; 0 failed chunks expected.
5. Compare FPS at the same coordinates against the previous version; a reduction may suggest the window-detail mesh needs further LOD and draw-call optimisation.

## Limitations

These decorations are procedural *fictional visual approximations*. Building outlines and road centre lines continue to be real OSM-derived planimetric data. We do **not** know which physical windows, doors or footpaths exist in the real town. The prototype remains flat without surveyed elevation, accurate roofs, real building textures, trees, parked vehicles or usable interiors. The browser needs a manual visual/performance check before merging.

Map JSON and tiles remain ODbL; GPL-3.0 game source stays separate. © OpenStreetMap contributors — https://www.openstreetmap.org/copyright
