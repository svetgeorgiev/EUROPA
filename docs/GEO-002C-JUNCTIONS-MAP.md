# EUROPA-002C.4 — Junction cleanup and navigation

The previous 002C.3 browser test had angular dark overlays at a street junction. The 3D map is based on genuine OpenStreetMap road lines and building outlines, but still lacked enough navigational context to recognize the area.

## Junction rendering

- Expand each OSM road segment into a rectangle using its existing approximate road width.
- Use polygon-clipping to union overlapping asphalt rectangles; triangulate with earcut. There are no overlapping asphalt triangles within a tile.
- Clip the final asphalt polygon to the exact 250m chunk square. Road centre lines in the chunk file deliberately include padding, but the visible triangles no longer overlap adjacent chunks.
- Trim the decorative sidewalk strips and road dashes for approximately 6.5m around segment intersections and clip remaining decoration to the tile boundary.
- Ground collision and sealed building footprints are unchanged.
- This adds the MIT-licensed polygon-clipping package. Run pnpm install after pulling this branch.

## Navigation

- The new north-up minimap shows a schematic layout of real local OSM roads and building footprints, using the existing locally served map.json file.
- The gold player arrow turns with the first-person view and the N marker stays at the top.
- Press M to toggle between a close-up neighbourhood view and an overview of the entire 1km² map.
- A link shows the approximate player position on OpenStreetMap, useful for comparing the game to real geography. The browser only opens the external website if the user clicks it. Gameplay never requests OpenStreetMap APIs.

This is not a full navigation system: no routing, road names, building identity or landmark labels have yet been imported. The OSM coordinate anchor remains approximate. All cosmetic facades and road widths are procedural estimates.

## Test steps (Windows, WebStorm)

Stop Vite with Ctrl+C, then from D:\WebstormProjects\EUROPA-GitHub:

    git switch feat/europa-002c-world-streaming
    git pull --ff-only
    pnpm install
    pnpm test
    pnpm typecheck
    pnpm build
    pnpm dev

**Keep your previously generated map.json and the sixteen tile files.** No new OSM API request and no map:chunks run are necessary for this patch.

Test the same junction from the screenshot, cross a chunk boundary, watch tile loaded/failed counters and FPS, compare building collisions with the last version, and press M for the north-up overview.

OpenStreetMap geographic data and generated chunks remain ODbL 1.0 (© OpenStreetMap contributors), while EUROPA game code is GPL-3.0.
