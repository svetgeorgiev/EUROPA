# EUROPA-002D.3B — School grounds & mapped landmark identification

Status: **Draft / browser verification pending**, stacked on 002D.3 PR #6.
This milestone reuses the real OSM campus geometries saved by
\`pnpm map:recover --apply\` in the local, Git-ignored file
\`public/worlds/nova-zagora/sites.json\`.

## Scope

- \`CampusSites.ts\` validates the local data's OSM source, geographic anchor,
  **exact source snapshot timestamp**, original OSM way/relation IDs, finite
  coordinates and ring sizes. Invalid/stale/missing data is **ignored**, never
  substituted with guessed locations.
- Real school/college/kindergarten/university site outlines are rendered as
  a subtle **non-colliding flat ground tint** with thin site-outline annotation
  in Babylon.js. Polygon holes (such as courtyards) remain open and sites are
  clipped to EUROPA's playable 1km square. This is **not** a mapped fence,
  entrance, exterior wall, verified schoolyard surface material or exact
  surveyed elevation.
- The local minimap shows the same actual school boundaries, distinct from
  physical building outlines and road centre-lines.
- Landmark title remains its original Bulgarian OSM name. When an OSM school
  landmark matches the mapped site by kind and **exact OSM source ID** or by
  **matching normalised name with the POI inside that site**, its 3D marker
  says **MAPPED SCHOOL GROUNDS · N BUILDINGS IN SITE**. N counts existing
  imported buildings whose footprint centres lie inside the campus polygon.
  It does NOT claim each structure's function, a particular entrance, or a
  physically surveyed affiliation.
- Other POIs keep the existing generic marker and explicit missing-footprint
  warning. In particular, TBI Bank is not given geometry from a neighbouring
  church or school.
- The site overlay lives across 250m streamed chunk transitions and is rebuilt
  safely after loading the optional static map. It creates **no colliders**
  and does not alter the existing 129 real footprints, collision safety,
  navigation files or 16 streamed chunks.
- All new geometry has strict non-finite/large-input checks; the same site
  metadata can be absent without breaking legacy 002D builds.
- There is **no runtime external OSM request**. The data is sourced only from
  the local Geofabrik/osmium recovery created earlier.

## Browser smoke test

Run from WebStorm's **PowerShell** terminal, on the updated 002D.3 branch:

\`\`\`powershell
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm dev
\`\`\`

1. Verify the minimap shows the school-campus outline and does not turn
   ordinary building outlines into campus borders.
2. Approach СУ Иван Вазов near its three imported buildings. The game should
   show tinted campus ground and an OSM school marker naming the mapped
   grounds, counting **three** existing footprint centres (subject to the
   actual source data and POI match). Be aware the marker is view/angle/range
   dependent and not a permanent billboard.
3. Follow the roads around the school: mapped roads must still be visible
   above the terrain tint. Walk and sprint through the ground; site contours
   must never stop the player. Buildings must still block player movement.
4. Inspect a school site with a courtyard hole; no false surface fill should
   appear in a mapped hole.
5. Walk over chunk boundaries: site areas should not flicker/disappear,
   chunk count stays healthy, and no mesh or HUD error occurs.
6. Verify TBI Bank still uses the honest POI/no-footprint marker when it
   lacks a matching building footprint.
7. Temporarily rename \`sites.json\` while Vite is stopped and verify the
   map still runs with its existing buildings/POIs, then restore the file.
   Ensure the OSM metadata snapshot matches \`map.json\`.

## Next, not faked in 002D.3B

**Real entrances, fences, footpaths, playground assets and façade accuracy**
require explicit OSM tags, mapped geometries or another licensed source.
Do not infer their location just from a campus border or from the user's
screenshot. We can add them when verified data exists.

© OpenStreetMap contributors, ODbL 1.0. Game code GPL-3.0.
