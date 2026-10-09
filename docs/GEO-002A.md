# EUROPA-002A — Geographic coordinate foundation

The browser still displays the **synthetic EUROPA-001 test environment**. This milestone adds the WGS84-to-local coordinate foundation for a future map importer, not roads or real buildings.

## Convention

- Input: WGS84 latitude and longitude in **degrees**, height in **metres**.
- Babylon world: **+X east**, **+Z north**, **+Y up**, all in metres.
- The anchor is the local zero point. Horizontal conversion uses WGS84 meridional and prime-vertical curvature radii at the anchor latitude (local tangent-plane approximation).
- Every region/chunk must have a stable anchor. This local approximation is for neighbourhood/town extents, **not for the entire European continent**.
- `NOVA_ZAGORA_ANCHOR` (`42.4930, 26.0110`) is an **approximate development reference**, not a surveyed spawn or a validated centre point. Elevation `0` is a **placeholder datum**, not a claim of actual sea-level height.
- The HUD shows **GEO PREVIEW (SIMULATED)**: it mathematically projects the player's synthetic test-scene position; it does **not** mean the 3D scene reproduces real streets.

## Next milestone (002B)

1. Choose and document an exact bounding box and verified reference coordinate.
2. Obtain an OSM extract with attribution / ODbL compliance, and documented elevation data.
3. Transform OSM nodes via `geoToWorld()` and generate roads/building footprint geometry offline.
4. Validate orientation and metre distances before enabling real geometry in gameplay.
5. Keep the 001 player collider unchanged during this integration.

## Tests

Run `pnpm test:geo` (Node 22+) for anchor, axis orientation, roundtrip and invalid-input tests. Then `pnpm typecheck` and `pnpm build`.
