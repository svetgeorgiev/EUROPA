# EUROPA-002C.5 — Chunk streaming recovery and diagnostics

A browser screenshot after the 002C.4 junction cleanup showed TILE 2_1 with **8 loaded, 1 failed**. The screenshot alone does not tell us whether the failure was an HTTP fetch, invalid JSON, polygon union, or another runtime rendering issue.

This update makes failures diagnosable and reduces the chance that optional visual errors cause entire neighbourhood tiles to disappear.

## Changed

- One malformed road union now falls back to plain Babylon road ribbons while the ground/buildings/collision data can continue loading. The fallback may have z-fighting, but deliberately preserves basic scene navigation and is logged.
- Per-tile rendering isolates optional road and facade details, so errors creating a decoration do not make the entire chunk fail.
- On a fatal error creating an essential ground tile, the renderer disposes all meshes created during that attempt before allowing a retry.
- Stream stats now include the actual failed tile IDs and latest error. Hover the highlighted HUD after releasing the pointer with Esc to inspect it, and check the F12 browser console for full warnings.
- Press **T** for a single manual retry of failed nearby tiles. There is **no automatic retry loop** repeatedly hitting the same resources.
- New tests for failed HTTP, failed render callback, manual retry and polygon-merge fallback.

## Windows / WebStorm

From the GitHub clone already on \`feat/europa-002c-world-streaming\`:

\`\`\`powershell
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

You do **not** need to download OSM data, re-run Overpass, or regenerate 250m chunks.

## Verification

1. Visit the same street at ~X 73, Z -171 and check the \`TILE ... failed\` counter.
2. If a tile fails, note its ID shown on screen. Press Esc, hover over the amber tile HUD for its cause, then press T to retry once.
3. In F12 Console, look for messages prefixed \`EUROPA tile\`, \`Road polygon merge failed\` or \`Chunk ... failed:\`. Those identify the offending tile and stage.
4. Move into a different tile. FPS should remain stable; walls must still block movement and minimap position should track the player.
5. If it continues failing, send the exact error and failed chunk ID. A specific one-off OSM geometry can then be fixed without guessing.

## Boundaries

No actual new geographic data, terrain, buildings or monuments were added. This is a reliability milestone before expanding beyond the initial 1 km² scene. Future milestones can import road names and landmarks from OSM and extend the world streaming grid. OSM-derived files remain separately licensed under ODbL; game source remains GPL-3.0.
