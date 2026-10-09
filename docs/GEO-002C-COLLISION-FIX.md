# EUROPA-002C.1 — Building collision safety hotfix

## Why?

During the first real Nova Zagora walkthrough, a player could enter an OSM building and become trapped. The old implementation relied on collision responses from an **infinitely thin building visual mesh**, whose triangle winding and missing closed collision volume made wall entry unreliable.

## Changes

- A small engine-independent **2D building footprint collision field** checks both polygon interiors and the player's clearance from every exterior wall segment.
- Horizontal movement is swept in short steps at both walking and sprinting speeds. Movement slides along walls where possible, but cannot pass through a building perimeter just because its visual mesh is single-sided.
- Visual OSM building geometry no longer participates in Babylon's 3D collision engine; that layer still handles gravity and flat terrain.
- Loaded streaming chunks register their building outlines. Unloading removes them. Late-arriving chunks cannot trap the player silently: the player is returned to a known safe location if necessary.
- Spawn positions inside an imported building are relocated to clear ground.
- **R** teleports the player to the last known safe position, including resetting their height and falling speed.
- Unit tests cover facing direction, wall sliding, sprint tunneling, corners, spawn recovery and chunk unload.

## Test locally

\`\`\`powershell
git switch feat/europa-002c-world-streaming
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

Do **not** run \`map:fetch\` or \`map:chunks\` again for this fix: the existing local Nova Zagora 002B source data and 002C tiles remain usable, as the change is to movement collision handling rather than tile format.

1. Walk straight into a facade from the road. You should stop outside it.
2. Walk diagonally along the same wall. You should continue sliding along it.
3. Sprint directly at a thin-looking or unusually shaped building from two directions.
4. Walk between chunks and watch that collision blocking continues on newly loaded buildings.
5. Press **R** if trapped or if gravity puts you below the flat ground.

The OpenStreetMap building outlines are still treated as **sealed buildings**: interiors, doors, staircases and roof traversal are future gameplay features.

## Remaining limitations

- This is a flat 2D footprint blocker; it does not yet support doors, interiors, multi-level physics, climbing or jumping over roofs.
- Real OSM data may contain incomplete or overlapping footprints; collisions correspond to available source outlines, not surveyed building interiors.
- It is a gameplay prototype; manual browser regression testing remains required.
- Dark roads/buildings visible in screenshots are a **separate visual-material issue** to handle after collision safety is confirmed.

OSM data and generated chunk files remain ODbL-licensed and excluded from Git; source code remains GPL-3.0.
