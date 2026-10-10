# EUROPA-002I — Inspected skin rig and dual-weapon integration

## Source file inspection (user-supplied ZIPs)

- `skin_1.zip` contains `skin_1.glb` (1.84 MB unpacked). GLB metadata:
  - Title: **Partizan 715 Lethal company skin IN MULTICAM NOW**
  - Creator: **Andruxa-snajper** (https://sketchfab.com/Andruxa-snajper)
  - Source: https://sketchfab.com/3d-models/partizan-715-lethal-company-skin-in-multicam-now-1a6e15de4a634f0996184d3eceaf567f
  - Embedded licence: **Sketchfab Standard** (https://sketchfab.com/licenses)
  - Geometry: one skinned mesh, **90 joints**, approximately 24,048 indices.
  - Built-in animation clips: **zero**.
  - Key bones: `thigh_L.L_043`, `thigh_L.R_056`, `shin_L.L_044`, `shin_L.R_057`, `shoulder_L.L_04`, `shoulder_L.R_025`, `arm_L_upper.L_05`, `arm_L_upper.R_026`, `arm_L_lower.L_06`, `arm_L_lower.R_00`, `hand_L.R_027`.
- `gun2.zip` contains `gun2.glb` (4.18 MB unpacked). GLB metadata:
  - Title: **M249**
  - Creator: **Dmitriy Korotkov** (https://sketchfab.com/ArtDmitriyK)
  - Source: https://sketchfab.com/3d-models/m249-b1e60faa37de4461822103fe38e5c9ce
  - Embedded licence: **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/)
  - Geometry: one mesh, 18,956 vertex positions, no skin or animation clips; major original model axis Y.

These binary source assets are **not** committed to GitHub. Verify the creator's terms and required credits before redistribution. The downloaded model files live locally under Vite's `public` folder.

## Windows / WebStorm setup

Start from your working `EUROPA-GitHub` folder. Extract the ZIPs locally (leave original ZIPs as backups) so these exact files exist:

```text
public/assets/skins/skin_1.glb
public/assets/guns/gun.glb
public/assets/guns/gun2.glb
public/assets/vehicles/abandoned-car.glb
```

Stop the old Vite server, then in PowerShell run:

```powershell
git fetch origin
git switch --track origin/feat/europa-002i-skeletal-weapons
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

If you already have the local branch, run `git switch feat/europa-002i-skeletal-weapons` and `git pull --ff-only` instead. Keep the binary assets local until the licences, credits and size policies are agreed.

## Controls

- **V**: jump to the parked car for testing.
- **E**: recover primary rifle, then the M249; after both, restock the equipped weapon when low on spare ammunition.
- **1**: equip the original rifle. Existing rifle ammo is preserved in its old localStorage key.
- **2**: equip the M249. New independent 60-round magazine + 120 reserve.
- **Left mouse click**: shoot primary rifle. **Hold left mouse**: continuous M249 fire (while pointer lock is active).
- **F**: reload currently equipped weapon.
- **G**: reverse model barrel direction if its imported asset faces backward.
- **C**: switch first-/third-person. Third-person loads a separate small M249 GLB display attached approximately near the avatar's right hand.
- **P**: show bind-pose preview versus runtime skeletal movement; useful when refining arm pose.
- **WASD**, **Shift**, **Space**: move, sprint and jump.
- **M**, **R**, **Esc**: map, unstuck, pause/unlock.

## Character skeleton animation

The uploaded Partizan 715 *is* rigged. Previous detection incorrectly demanded built-in walk/run clips, so the model stayed in its T-pose. EUROPA-002I now maps the inspected joints and applies local rotation deltas relative to their rest orientations for idle, walk, sprint and a basic two-handed shooting pose. It still does **not** have production-quality IK, authored animation blending, hand/finger grips or ragdoll physics.

If the Babylon glTF importer exposes different bone names, the procedural mannequin remains as a fallback. Look at the browser console for `EUROPA character rig diagnostics` to inspect `proceduralRig` and `mappedJoints`. Send a third-person screenshot; axis signs and hand offsets may need visual correction for this particular export.

## Acceptance checklist

1. Check `EUROPA 002I` is displayed. Original Nova Zagora roads, school, map and streamed chunks still work.
2. Press V, then E to retrieve the M249 after taking the primary rifle. The local M249 GLB should appear in first-person.
3. Use 1 and 2 to switch. M249 should show **60 / 120** initially and fire continuously while holding left mouse. The original rifle's saved ammunition stays independent.
4. Press F and confirm only the active weapon's reserve is used. Shoot crates and observe impacts/damage.
5. Press C. With `skin_1.glb` present, the actual survivor should be shown (not the block mannequin) and swing leg/arm joints as you move. Press P to inspect static bind pose if required. The M249 should be near the survivor's right hand, not perfectly fitted until IK calibration.
6. Press C to return to first-person and check imported model orientation. Use G if the muzzle points backward.
7. Verify status notices no longer overlap the mini-map.

CI validates TypeScript, unit tests and Vite builds. It does **not** load locally ignored assets, so visual confirmation in your browser is necessary.

## Scope limitation

This version does not introduce full rigid-body hit reactions on humans, simulated bullet flight, NPC combat, exact left-hand rifle gripping, new map data or online multiplayer. Shooting impacts and simple damage remain limited to test crates. Authentic animation blending and firearm attachment can be refined once browser screenshots confirm the imported model axes and linked skeleton behaviour.
