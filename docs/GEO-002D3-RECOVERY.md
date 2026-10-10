# EUROPA-002D.3 — Offline building coverage recovery

## Problem to solve

The baseline 1km² Nova Zagora import has 127 building footprints, 70 named road ways and 12 mapped public POIs, of which 6 had no imported footprint within 12m. In particular:

- **СУ Иван Вазов**: POI at X=-23.2, Z=55.3; nearest imported footprint way/1019028376 about 21.3m away.
- **TBI Bank**: POI at X=72.8, Z=175.1; nearest imported footprint way/519138371 about 96.1m away.
- **Църква Света Богородица**: inside building way/519138371.

A school or bank can be a *point* in OSM without any building polygon. The 002B geometry and 002D.1 names came from two different source snapshots. We must not spawn fake buildings from POI names or associate TBI Bank with the church simply because it is the closest polygon.

## What this branch implements

**1. Offline, provenance-preserving input.** Import GeoJSON exported by osmium from a suitable OSM PBF extract using \`osmium export -a type,id\`. A raw OSM core-map/Overpass JSON export is accepted as an alternative. Every imported building keeps its real OSM way/relation ID, and source tags where present. Anonymous GIS polygons **fail closed** rather than receiving generated IDs.

**2. Wider footprint coverage.** The existing geometry importer can clip closed building polygons at the 1km outer boundary and accept simple relation polygons. Single-outer multipolygons with no courtyard holes are supported. Complex multipolygons or courtyard holes are skipped with explicit counts; never solidify a hollow site.

**3. School/civic sites.** Mapped named site boundaries (such as an \`amenity=school\` polygon) are retained in a separate \`sites.json\` file. The report checks whether a named POI is geographically contained in that site and lists actual building polygons within its boundary. Site membership is *evidence*, **not** proof of each building's precise identity. A campus polygon is never treated as a building or player collider.

**4. Before/after report.** The default command writes \`.europa-recovery/last-preview.json\` and prints:
- before/new number of real building outlines and road segments;
- OSM source IDs that appear/disappear;
- counts of named streets and public landmarks;
- per-POI inside/near/no-nearby-footprint, with actual map position;
- matched named site areas and campus building candidates;
- safety-gate warnings.

**5. Preview then explicit install.** The first run **never** changes \`map.json\`, \`navigation.json\` or \`chunks/\`. \`--apply\` is a separate affirmative operation, available only when the candidate does not reduce building coverage, remove any old building IDs, or significantly reduce road/label counts. All 16 chunks, map, navigation and named sites are generated in staging first, then swapped with rollback. Backup directories are kept alongside the world data for manual inspection; generated ODbL data and reports are ignored by Git.

### Obtain the OSM source (one-time external download)

Download Bulgaria's \`bulgaria-latest.osm.pbf\` from [Geofabrik](https://download.geofabrik.de/europe/bulgaria.html), saving it outside the Git repository or in an ignored recovery workspace. This is a real OSM distribution, not an OpenStreetMap editing API request. Follow its ODbL license and attribution.

Use **osmium-tool** (requires installation separately; Windows via WSL/Linux is one straightforward option). The supported commands are:

\`\`\`powershell
# Run from D:\WebstormProjects\EUROPA-GitHub if osmium is on PATH.
pnpm map:bbox
# Returns longitude,latitude,longitude,latitude with ~80m padding.

# For example after placing the Bulgaria PBF under D:\OSM:
$bbox = (pnpm --silent map:bbox).Trim()
osmium extract --strategy smart --bbox $bbox --output "D:\OSM\nova-zagora-small.osm.pbf" "D:\OSM\bulgaria-latest.osm.pbf"
osmium export -a type,id --output "D:\OSM\nova-zagora-small.geojson" "D:\OSM\nova-zagora-small.osm.pbf"
\`\`\`

The **smart** extraction strategy retains reference-complete multipolygon relations near the boundary. The GeoJSON exporter **must include** \`@type\` and \`@id\` attributes. **Do not** run \`osmium export\` directly on the whole country's PBF: clip the small local region first.

If using WSL, use equivalent paths under \`/mnt/d/\` and install \`osmium-tool\` from your distribution's package manager. Osmium references:
- <https://docs.osmcode.org/osmium/latest/osmium-extract.html>
- <https://docs.osmcode.org/osmium/latest/osmium-export.html>

### Preview the candidate, WITHOUT modifying the game

Stop \`pnpm dev\` temporarily and run:

\`\`\`powershell
cd D:\WebstormProjects\EUROPA-GitHub
git fetch origin
git switch feat/europa-002d3-building-coverage-recovery
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm map:recover --input "D:\OSM\nova-zagora-small.geojson"
\`\`\`

The output will compare your real existing local files to the new data. The preview report is at \`.europa-recovery/last-preview.json\`. **Please share the report or console summary before applying**; it will show whether Иван Вазов and TBI Bank now have any genuine mapped footprints.

You can supply the source snapshot timestamp if known:

\`\`\`powershell
pnpm map:recover --input "D:\OSM\nova-zagora-small.geojson" --source-date "2026-10-10T00:00:00Z"
\`\`\`

The date is optional. Do not label the import with a fictitious date—if the exact PBF snapshot time is not known, the output says so. Geofabrik/osmium metadata can identify its actual date.

### Apply only when the preview passes

After inspecting the comparison:

\`\`\`powershell
pnpm map:recover --input "D:\OSM\nova-zagora-small.geojson" --apply
pnpm dev
\`\`\`

\`--apply\` writes the new world, 16 tiles, navigation labels and site boundaries from **one source**. A failed safety gate blocks the swap. Do not weaken the gate merely to get a higher count. If any old building disappeared, investigate whether OSM remapped or deleted it, rather than silently discarding it.

**Critical:** a new OSM extract may still have no physical geometry for an actual school, bank, residential building or tree. This import does not magically increase geographic completeness. If the candidate yields no additional verified footprint IDs, we should inspect OSM coverage or use a properly licensed independent building-footprint source and then verify it carefully.

### Testing after apply

- The previously known 127 footprints are the baseline; the report must explain any additions/removals.
- The HUD should still show 0 failed tiles; walk across a streamed tile boundary.
- The school and bank labels may still show “no imported footprint” if no actual building polygons are mapped. That is correct.
- Confirm the church remains in its real outline and there are no invented bank buildings.
- Building walls still block player movement; \`R\` resets to safety.
- New named OSM sites remain site boundaries, not 3D collision structures.
- Check FPS near dense streets and camera-oriented signs.

ODbL: © OpenStreetMap contributors — <https://www.openstreetmap.org/copyright>. Game source GPL-3.0. Do not upload generated ODbL world files into the GPL-only Git tree.


## 2026-10-10: real osmium preview — duplicate-geometry safeguard

The first real GeoJSON preview printed **127 → 258 building entries**, but just **3 new OSM building IDs** and **1 missing old ID**. This was *not* 131 newly mapped buildings. By default, osmium's export config sets both \`linear_tags=true\` and \`area_tags=true\`. A closed OSM way can consequently be exported as **both** a LineString and a Polygon under exactly the same \`@type=way, @id\`. Importing both as footprints produces coincident meshes and redundant collision obstacles.

The recovery converter now prescans polygon source IDs and suppresses each corresponding redundant linear representation. Named school/civic site boundaries also use the polygon for their POI centroid. Real mapped highway lines are retained separately when an area feature has the same identity. Preview output includes both **number of footprint entries** and **unique building source IDs**, the number of suppressed duplicate linear building representations, and lists new/missing OSM source IDs. The apply safety gate rejects any residual duplicate 3D building source IDs.

**Expected next preview:** around 129 uniquely sourced footprints if the reported source-ID differences were caused entirely by dual geometry export; this is a hypothesis until rerunning against the user's actual GeoJSON. The existing **one missing building source ID** is still an apply blocker and must be investigated. Do **not** run \`--apply\` on a rejected report or waive the gate to make the count bigger.

OSM documentation: <https://docs.osmcode.org/osmium/latest/osmium-export.html> (see AREA HANDLING and default \`linear_tags\`/\`area_tags\` settings).


## 2026-10-10 — Investigate one missing real building (read-only)

The locally exported GeoJSON confirms that \`way/1016083252\` exists as
**LineString (5 vertices) + MultiPolygon (one polygon, one ring)**.
This is a valid, *simple* multipolygon structure, not a courtyard or
multiple-building relation. The importer is already designed to accept it,
so we must NOT weaken or bypass the area/clipping safety rules without
finding the exact rejection reason.

After pulling the latest EUROPA-002D.3 branch, run in **PowerShell**:

\`\`\`powershell
pnpm map:inspect --input "D:\OSM\nova-zagora-small.geojson" --id way/1016083252
\`\`\`

The read-only command inspects both raw GeoJSON representations, the
deduplicated building candidate, and the actual 1km² footprint clipping
routine. It prints area, map-relative extent and a reason if the
footprint is not accepted. The Bulgaria extract includes an 80m buffer
around the game; a structure wholly outside the gameplay boundary is
correctly excluded. Existing OSM-derived map, chunks and navigation
remain unchanged until explicit \`--apply\` following review.

