# EUROPA-002C — Streaming one real-world Nova Zagora region

## Scope and constraints

EUROPA-002C divides the existing **1 km × 1 km Nova Zagora 002B map** into **16 tiles, 250 m × 250 m each**, then loads only the 3 × 3 neighbourhood around the first-person player (fewer near world edges).

The game continues to use flat ground, real OSM road and building *footprints*, and simplified building heights. **It does not stream all Europe, acquire more geographic data, add terrain heights, or expand the map boundary.**

## Windows / WebStorm — verify locally

**Prerequisite:** You already successfully ran \`pnpm map:fetch --osm-api\` and your existing \`public/worlds/nova-zagora/map.json\` is intact. That file is local and intentionally excluded from Git.

From \`D:\WebstormProjects\EUROPA-GitHub\`:

\`\`\`powershell
git fetch origin
git switch feat/europa-002c-world-streaming
pnpm install
pnpm map:chunks
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

- \`map:chunks\` reads your **existing** OSM \`map.json\`. No network call or new OSM API request is needed.
- The generated \`public/worlds/nova-zagora/chunks/\` directory contains \`manifest.json\` and \`0_0.json\` through \`3_3.json\`: seventeen files.
- Refresh http://localhost:5173. The header should show \`STREAMED REAL-WORLD GEOMETRY\`.
- The HUD should show e.g. \`TILE 2_1 · 9/16 loaded · 0 loading · 0 failed\` (the exact tile/count depends on spawn location).
- Walk towards a distant edge of the current tile and verify that the tile ID changes and the number of loaded tiles adjusts. Objects behind you should unload.
- Test WASD, mouse look, jump, gravity, collision with OSM buildings, FPS stability and no red engine error.
- F12 → Network: requests should go to \`/worlds/nova-zagora/chunks/<col>_<row>.json\`; it should **not** download all sixteen files on initial load when spawning near an edge.
- If the generated chunks are absent, EUROPA-002B's old whole-map loader remains as fallback. If that is also absent, synthetic EUROPA-001 stays available.

After changing \`map.json\` via a future import, re-run \`pnpm map:chunks\`. \`pnpm map:fetch\` also regenerates chunks after a successful import, but **do not** refetch the map merely to regenerate existing chunks.

## Architecture

1. \`src/world/chunkGrid.ts\` — deterministic grid geometry and bounds, road clipping with overlap, unique building ownership, versioned manifest and tile schemas.
2. \`scripts/chunk-writer.mjs\` — offline exporter from the real OSM-derived \`map.json\`. Writes a staging directory, publishes it only after all tile files succeed, and retains existing outputs when source validation fails.
3. \`src/world/ChunkStreamer.ts\` — engine-independent lifecycle manager. Loads a 3×3 set, unloads distant tiles, ignores stale async responses, reports errors/stats and avoids a request loop on failed tiles.
4. \`src/world/ChunkRenderer.ts\` — shared materials, individual ground tiles, road ribbons and building meshes. Disposal frees tile meshes/colliders. Invisible boundary colliders prevent leaving the 1 km² prototype.
5. \`src/game/EuropaGame.ts\` — integrates tile loading with the existing movement controller. Preloads a spawn neighbourhood before switching from the old scene; falls back to 002B if the centre tile cannot be loaded.
6. \`src/App.vue\` — streaming HUD, OSM credit, mode indicators.

## Known limitations

- Geographic data remains scoped to the existing 1 km² OSM extract. This is not streaming new cities, country maps, tiles from OSM servers, or a global world.
- All tile files use one local-metre coordinate anchor. Large-scale geodesy, origin rebasing, streaming between anchors and real elevations are future milestones.
- Some footprints crossing tile boundaries belong to their centroid's tile; neighbouring tile preloading reduces visibility issues, but exceptionally large building footprints can still pop at loading edges.
- Roads overlap slightly across tile seams for continuity. Where neighbouring road meshes meet, some overlapping surfaces may cause visual flicker on certain GPUs.
- No LOD or texture streaming yet. Browser still loads Babylon.js and the 3D engine up front.
- Files are requested from the game's own static host; **the browser never calls the public Overpass or OSM editing APIs**.
- A failed non-centre tile is reported as \`failed\` in the HUD; returning to its neighbourhood or refreshing allows a retry. Centre tile failure on initial loading returns to 002B.
- Performance and collisions require **manual browser validation**; CI cannot simulate a real walk-through.
- No persistence of visited region, loot, saves, NPCs, world state, or multiplayer yet.

## Attribution and redistribution

**Real geographic data:** © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0, <https://www.openstreetmap.org/copyright>. Both \`map.json\` and generated tile files are derived OSM databases and deliberately Git-ignored. Game source code remains GPL-3.0. Review ODbL redistribution and attribution obligations before publishing or bundling generated tiles.

## Pull requests

This PR targets \`feat/europa-002b-osm-importer\` while that branch's PR #2 remains unmerged. **Merge 002B into main first**, then rebase or retarget 002C onto main after manual validation; do not merge both blindly.
