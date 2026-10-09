# EUROPA-002C.2 — Daylight renderer cleanup

During the first Nova Zagora browser walkthrough the OSM roads appeared almost black and upper building walls looked muddy. Building footprint collision was subsequently fixed in EUROPA-002C.1 and successfully tested by a player; it is **not** part of the renderer changes.

## Changes

- **Brighter asphalt and footpath palette:** roads and paths use lighter, recognisable colours. The original colours were very dark; moderate emissive and ambient fill prevents the material from becoming almost black.
- **Predictable road surface normals:** all visual OSM road ribbons explicitly face upward, regardless of line direction. Roads are still graphics only, with ground meshes supplying gravity and collision.
- **Flat-shaded building facades:** each building wall has its own vertices and horizontal outward normal. This avoids corner smoothing and incorrect-looking upper walls.
- **Distinct roof shading:** roofs get separate triangles with upward normals, a 2.5 cm visual offset and slightly darker cool-grey tint. Roof geometry is **visual only**.
- **Soft outdoor lighting:** brighter hemispheric fill, a warm directional sun, and subtle distant atmospheric haze. No expensive dynamic shadows added yet.
- **One palette for both static OSM and 250m streamed chunks:** no new map or chunk file schema.
- **Geometry tests:** roads oriented in multiple directions, roof/wall normals, winding, invalid polygons.

## Windows / WebStorm

From \`D:\WebstormProjects\EUROPA-GitHub\`:

\`\`\`powershell
git switch feat/europa-002c-world-streaming
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

**Do not re-download OSM or run map:chunks again.** The existing \`map.json\` and all sixteen generated chunk files stay unchanged.

Test near the spawn and near another 250m chunk boundary:

1. Roads should appear medium grey rather than pitch black, without upside-down patches.
2. Buildings should have more readable wall colours and distinguishable roof surfaces.
3. Frame rate and \`TILE ... loaded/loading/failed\` display should remain stable.
4. Walk into facades, including while sprinting; the EUROPA-002C.1 footprint collision still blocks entry.
5. Press R if you ever get stuck and report any red error banner or errors in the F12 console.

## Constraints

This is a basic **procedural geometry preview**, not a photorealistic replica of Nova Zagora. We do not yet have real facade textures, surveyed building materials, elevation, road markings, sidewalks, doors, usable interiors, vegetation, dynamic shadows or streaming outside the initial 1 km² region.

OpenStreetMap data and locally generated chunks remain ODbL 1.0 with attribution; game code remains GPL-3.0. The model never makes live OSM API calls during gameplay.
