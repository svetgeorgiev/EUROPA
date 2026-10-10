# EUROPA-002D.1 — Real street names and public landmarks

## Why this milestone is a separate navigation import

EUROPA-002B successfully downloaded OSM streets/building outlines, but its generated map.json deliberately keeps only geometry and OSM feature IDs. The name and POI tags of the original API response are **not in map.json**, so we cannot recover real street names from the existing game tiles. We never invent these names.

EUROPA-002D.1 introduces an independent optional ODbL navigation dataset. The existing game map, 16 streamed chunks, player collision and visuals do not change.

## Development import (Windows / WebStorm)

From \`D:\WebstormProjects\EUROPA-GitHub\` on \`feat/europa-002d-recognisable-nova-zagora\`:

\`\`\`powershell
pnpm test
pnpm typecheck
pnpm build
\`\`\`

If you have a **raw OSM /map.json export** (containing both \`node\` elements and \`way.nodes\` arrays), or an Overpass JSON export with \`out geom\`, prefer offline import:

\`\`\`powershell
pnpm map:nav --input "D:\path\to\raw-osm.json"
\`\`\`

If you did not save the original source when importing 002B, the prototype supports **one manually requested, small-area bootstrap**:

\`\`\`powershell
pnpm map:nav --osm-api
\`\`\`

This does **one GET** to OSM's 0.6 editing API, for the same approximate 1 km² region used in 002B. It requires internet and may be unavailable or refuse requests. Do **not** automate or repeatedly poll this endpoint; it is not a suitable bulk/production data feed. For geographic expansion, use downloadable OSM extracts/PBF files or another appropriately licensed distribution. OSM API usage policy: <https://operations.osmfoundation.org/policies/api/>.

After success, the importer reports the exact number of named road ways and named public landmarks **actually present in OSM** and writes:

\`public/worlds/nova-zagora/navigation.json\`

This metadata file is Git-ignored under its own ODbL licensing. Your existing \`map.json\` and \`chunks/0_0.json\` through \`3_3.json\` are untouched. Do NOT rerun \`map:fetch\` or \`map:chunks\`.

Then run \`pnpm dev\` and refresh the browser.

## Browser features

- The existing north-up minimap now shows **real OSM street names** where the data contains \`name:bg\`, \`name\` or \`name:en\` (in that preference order).
- A selection of **named public POIs**, such as schools, libraries, memorials, places of worship, hospitals, parks and supermarkets, is labelled. Unnamed POIs are skipped; names attached solely to private houses or people are excluded.
- Text label overlap is reduced by a canvas label-collision pass; the local/overview toggle still uses **M**.
- A small "NEAR" hint indicates the nearest mapped road label by approximate distance to a labelled segment. This is **not** navigation routing or a verified street address.
- If the metadata file is missing or invalid, EUROPA-002C gameplay and the unlabelled map continue normally and the minimap shows a short import hint.

## Important limitations

- OSM data is crowdsourced and incomplete. Some streets and landmarks in Nova Zagora may have no labels or may not be included in this initial 1 km² area.
- A road way is labelled near the middle of one suitable segment, rather than along its entire length; the displayed name hint can be approximate.
- Point-of-interest categories are a deliberately limited public-category allowlist, not all possible OSM tags. OSM multipolygon relations aren't supported in this milestone.
- Labels are schematic UI features only: no navigable 3D signposts yet, no changes to buildings, no street routing, no monuments or vegetation.
- Our anchor (42.4930 N, 26.0110 E) is an approximate development reference, not a surveyed elevation.

Attribution: © OpenStreetMap contributors, ODbL 1.0, <https://www.openstreetmap.org/copyright>. Game source code: GPL-3.0.
