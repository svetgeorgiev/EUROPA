# EUROPA-002B — Overpass API identification / fallback fix

Addresses HTTP 429 from the older Kumi hostname and HTTP 406 from `overpass-api.de` due to restrictions on generic/unidentified automated clients.

## Changes
- Use `https://overpass.private.coffee/api/interpreter` (current endpoint; replaced Kumi) with official `https://overpass-api.de/api/interpreter` as fallback.
- Identify the open-source EUROPA project using a distinct User-Agent and Referer.
- Pause 30 seconds after HTTP 429 or 406 before trying another server, per OSM published guidance.
- Report abbreviated server errors. Keep `--input` and avoid replacing an existing map if the response lacks sufficient features.
- Add mock HTTP tests. These do not establish that a public Overpass instance is currently reachable.

## Windows / WebStorm

From `D:\\WebstormProjects\\EUROPA-GitHub`:

```powershell
git switch feat/europa-002b-osm-importer
git pull --ff-only
pnpm test
pnpm typecheck
pnpm build
pnpm map:fetch
```

If data generation succeeds, run `pnpm dev` and refresh your browser. The world will show flat, simplified 3D roads and buildings based on real OpenStreetMap features. If servers still reject the request, wait instead of retrying immediately. Optionally use `--input` with an existing compatible Overpass JSON export.

## Licensing

Map data © OpenStreetMap contributors, ODbL 1.0, <https://www.openstreetmap.org/copyright>. EUROPA source code is GPL-3.0 and generated map data remains excluded from the Git repository.
