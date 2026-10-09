# EUROPA-002B — OSM API small-area fallback

## Why?

On 9 October 2026, Nova Zagora Overpass requests returned HTTP 500 and 504 on two public servers. These are service-side errors, not a broken Babylon/Vue project.

EUROPA now supports an **explicit, one-time** OpenStreetMap core API fallback for generating the **1 km × 1 km development scene**.

This is not the default and is **not appropriate for mass downloading Europe, per-player live queries, or production infrastructure**. OpenStreetMap's editing API usage policy asks read-only and bulk consumers to use Overpass, extracts or other supported data sources instead: <https://operations.osmfoundation.org/policies/api/>.

### Step-by-step (Windows / WebStorm)

From \`D:\WebstormProjects\EUROPA-GitHub\` on branch \`feat/europa-002b-osm-importer\`:

\`\`\`powershell
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm map:fetch --osm-api
\`\`\`

This uses one GET to \`https://api.openstreetmap.org/api/0.6/map.json?bbox=...\` for a 1 km square. It downloads OSM's node/way JSON, resolves way node references, and converts the data into the existing generated 3D world format. It does not call Overpass.

If successful, expect \`Imported ... road segments and ... building footprints\` and \`Saved real OpenStreetMap data to ...\`.

Then run \`pnpm dev\` and refresh the page.

You can also download a .json export yourself and run:

\`\`\`powershell
pnpm map:fetch --input "D:\path\to\map.json"
\`\`\`

The importer accepts both core \`map.json\` and Overpass \`out geom\` JSON. Core API exports must contain node elements and way.node reference arrays.

### Safeguards and limitations

- The core API mode is **opt-in**, a single request, no retries. It only supports at most a 1 km square.
- Rejects invalid JSON and missing nodes; refuses to replace an existing map if it has too few roads or buildings.
- Buildings and roads are simplified on **flat terrain**; this is not satellite imagery.
- OSM core API has independent use limits and may still be unavailable or refuse requests. Wait before retrying.
- Generated map remains ignored by Git. Do not commit ODbL map databases into the GPL code tree without separate licensing documentation.
- Attribution: © OpenStreetMap contributors (ODbL 1.0), <https://www.openstreetmap.org/copyright>.
