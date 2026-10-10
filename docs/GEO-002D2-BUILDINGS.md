# EUROPA-002D.2 — Building coverage, roof styles and visible POIs

## Why TBI Bank can appear on the map but not in 3D

EUROPA-002D.1 reads named POI nodes and named ways. An OSM node tagged \`amenity=bank\` can identify a business location even when no \`building=*\` polygon is present in the available dataset. The old importer also dropped buildings that cross the 1km-square boundary and ignored multipolygon building relations. A map label never guarantees matching physical geometry.

**We do not invent a bank building where OSM lacks an outline.** This is especially important for a real-geography game.

## Run the offline diagnostic first

In WebStorm, from your existing GitHub clone:

\`\`\`powershell
git fetch origin
git switch feat/europa-002d2-building-coverage-architecture
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm map:coverage --name "TBI Bank"
\`\`\`

The diagnostic uses only existing \`public/worlds/nova-zagora/map.json\` and \`navigation.json\`. It reports the known bank position in world X/Z metres, the nearest *imported* building source ID and the shortest distance to its outline. \`no-nearby-footprint\` is a statement about this **current game extract**, not proof that the physical building or an OSM polygon does not exist.

Running the script **does not download, overwrite or regenerate map files**. Please send the diagnostic output; we can decide whether additional raw OSM source data is justified.

## Visual changes immediately available from existing data

- Smaller, approximately rectangular house-like footprints get deterministic red/brown pitched gable roofs.
- A building explicitly tagged \`roof:shape=hipped\` can receive a hipped roof. Explicit \`flat\` and common large apartment/industrial/commercial footprints remain flat.
- Roofs use shared, lightly patterned clay/slate materials rather than one flat slab.
- Existing \`height\`, \`building:levels\`, \`building\`, \`roof:shape\`, \`roof:height\` and \`roof:material\` tags may be preserved by **future imports**, but old \`map.json\` does not contain them.
- POIs whose \`navigation.json\` has a real named location can appear nearby as floating in-world labels. These labels identify OSM places, **not physical buildings**. They are hidden beyond 110 metres to avoid clutter.
- POIs with no nearby building footprint are labelled **OSM POI · NO IMPORTED FOOTPRINT**, to explain why a place may appear on the minimap while the surrounding ground is empty.
- 002C's collision blocker still uses the exact imported footprints; decorative roofs and POI markers are visual-only and never create solid colliders.
- The same styles work with 250m streaming chunks and the single-file fallback. Existing 16 chunk files work without changes.

## Improved building importer, for a future saved raw OSM source

The code now retains real closed building footprints that **intersect** the 1km square, clipping to the square boundary rather than omitting entire buildings. It also supports *simple outer-ring* OSM multipolygon building relations. Relations containing inner rings/courtyards are explicitly skipped because the current sealed-footprint collision system cannot correctly represent holes. OSM source IDs are preserved for debugging.

To import a **saved raw OSM core \`/map.json\` export** (with \`elements\`, node refs and ways), or raw Overpass \`out geom\` JSON, run only when you have such a file:

\`\`\`powershell
pnpm map:fetch --input "D:\path\to\raw-osm.json"
\`\`\`

That regenerates local \`map.json\` and streamed chunks from verified raw geometry, so keep a backup of the previous files and verify buildings/collisions before merging. Don't feed this importer an existing EUROPA \`map.json\` or \`navigation.json\`, because they are already processed outputs, not raw OSM elements.

No live external API requests happen at browser runtime. Do not repeatedly use the OSM editing API to fill gaps; for future regional coverage use appropriately licensed offline OSM/PBF extracts and consider a second legitimate footprint data source where OSM is sparse.

## Visual test

\`\`\`powershell
pnpm dev
\`\`\`

1. Look at small houses: some should have visibly sloped, clay-coloured roofs while larger blocks stay flat.
2. Near a named POI (for example TBI Bank), look for a floating label. If there is no nearby mapped footprint, the marker will clearly say so.
3. Check that the minimap, OSM names, 250m streaming counter and 60 FPS target remain healthy.
4. Walk/sprint into building walls. Collision **must** still stop the player. Press R to recover if a geometry issue traps you.
5. Check chunk seams for popped/disappearing roofs and confirm \`0 failed\` in the HUD.

## Known limitations

- Procedural roofs and facade colours are stylistic interpretations of geometry, not faithful surveys of each Bulgarian building.
- Roofs for non-rectangular or very small outlines remain flat; do not fake a shape without adequate footprint geometry.
- Some named landmarks in OSM map data may be point-only and some building outlines may genuinely be unmapped. This change makes those gaps visible; it cannot produce exact footprints from names.
- Multipolygon holes/courtyards, relation members outside available raw extracts, terrain elevation, complex balconies and interiors are future milestones.
- New building coverage depends on **new raw source material** and regenerating tile files explicitly.

Attribution: © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright.
EUROPA code GPL-3.0. Existing local ODbL map and navigation files remain Git-ignored.
