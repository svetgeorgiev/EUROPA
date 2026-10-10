# EUROPA-002H — T-pose fallback, first-person weapon alignment, ammo and HUD fix

This branch builds on `feat/europa-002g-character-physics-damage` and preserves the OSM world files, local map, loaded car, movement collision and destructible test crates.

## Install with WebStorm on Windows

Stop Vite (Ctrl+C) and run:

```powershell
git fetch origin
git switch --track origin/feat/europa-002h-animation-ammo-hud
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

If the branch is already local, use `git switch feat/europa-002h-animation-ammo-hud` then `git pull --ff-only` instead of the tracking switch. The model files are still on your computer:

- `public/assets/vehicles/abandoned-car.glb`
- `public/assets/guns/gun.glb`
- `public/assets/skins/skin_1.glb`

Binary Sketchfab assets are **not** in the GitHub repository until you check size, creator licence, redistribution and attribution.

## Controls and tests

- **C** — switch between first-person and third-person.
- **P** — in third-person, preview the original imported skin (T-pose if unanimated); press again to return to the animated fallback.
- **G** — in first-person, flip the Sketchfab gun by 180° if its auto-axis alignment still has the muzzle backwards.
- **V** — developer teleport close to the car.
- **E** — recover gun, or scavenge 24 *prototype* practice rounds when remaining reserve is under 8. This also works after the car was previously searched.
- **F** — reload. The first recovered rounds auto-load a magazine if loaded ammo is zero.
- **Left click** — fire at damageable practice crates; impact, HP loss and debris remain from 002G.

**Expected out-of-ammo recovery:** from `0 / 0`, approach the car, look at it and press E. The HUD should update to `8 / 16` (24 recovered, 8 loaded automatically). This test restock is repeatable while reserve is low and capped at 96 reserve — not a finished survival-loot economy.

**Weapon view:** the first-person GLB now aligns its dominant X axis toward the camera's forward Z direction, adds lightweight sleeve/hand geometry, and keeps bob/recoil. The exact muzzle direction for arbitrary Sketchfab assets cannot be inferred reliably. Use **G** to flip if needed; full believable two-handed handling needs model-specific attachment points, a proper character rig and an IK animation system.

**T-pose:** a static, unrigged GLB is just geometric art. Applying gravity or collisions does not bend its arms or legs. The game now checks for skeletons plus walk/run clips. If missing, third-person uses an animated multi-joint mannequin instead, while P can still show the original skin for rigging comparison. The console prints **EUROPA character rig diagnostics**, including skeleton names and animation clips. The original GLB will **not** magically animate without a rig/compatible clips — use Blender/Mixamo (subject to model terms) to rig and animate then re-export as GLB.

**HUD:** vehicle/weapon diagnostics are short-lived notices at the upper left beneath the title, no longer layered across the lower-left mini-map.

## Manual validation

1. In the top-left look for **002H** after a fresh restart and Ctrl+Shift+R.
2. Press C and walk/sprint. If the original skin is unanimated, the fallback avatar's hips and shoulders should animate. Press P to inspect original GLB T-pose, and P again to return.
3. Press C to return first-person. View the gun: it should be aligned forward and move subtly. If backwards, press G.
4. Press V and locate car. While reserve is 0, use E for ammo. Fire at wooden crates to verify damage and 8/16 ammo recovery.
5. Verify status notices do not cover the mini-map, even after repeated reload/out-of-ammo messages.
6. Test map streaming, building collision, movement, sprint and R unstuck.

The gameplay remains a browser prototype: damageable wooden crates, no NPC ragdolls and no destructible OSM school buildings. For the actual `skin_1.glb` to hold the exact `gun.glb` model naturally, send both GLBs for inspection of arm bones, hand transforms, model axes and the animation set.
