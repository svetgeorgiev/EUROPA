# EUROPA-002G — Player avatar and first reactive shooting targets

Branch: `feat/europa-002g-character-physics-damage`. This builds on `feat/europa-002f-car-gun-pickup`; it does not modify the OSM chunk JSON or geography.

## Test on Windows (WebStorm)

```powershell
git fetch origin
git switch --track origin/feat/europa-002g-character-physics-damage
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

If the branch already exists locally, use `git switch feat/europa-002g-character-physics-damage` followed by `git pull --ff-only`. Keep the following GLBs on your computer, inside Vite's `public` folder:

- `public/assets/vehicles/abandoned-car.glb`
- `public/assets/guns/gun.glb`
- `public/assets/skins/skin_1.glb`

These assets are intentionally excluded from Git pending Sketchfab licence/attribution checks and size optimisation. GitHub only contains integration code. Verify the character is served by opening `http://localhost:5173/assets/skins/skin_1.glb` while Vite runs; it should download a GLB rather than return HTML.

## Controls

- **V**: debug teleport near the car
- **E**: search car / recover firearm
- **Left click** (first-person): fire hitscan shot and apply damage to the training crates
- **F**: reload
- **C**: switch between first-person shooting and third-person character inspection
- **WASD**: smooth movement; **Shift**: sprint; **Space**: jump
- **M**: map; **R**: unstuck; **Esc**: pause

## Changes

1. **Player movement:** horizontal velocity accelerates/decelerates instead of changing instantaneously. The original player ellipsoid and OSM building-footprint collision checks remain in control. Gravity/jumping are preserved. No Havok dependency or fragile ragdoll has been introduced.
2. **Visual avatar:** loads `skin_1.glb` asynchronously, scales to approximately 1.75 m, roots it at the character's feet and aligns with walking direction. Switch to third-person (**C**) to inspect it. First-person keeps the existing firearm viewmodel. Third-person displays a simple gun prop attached approximately in front of the right arm; precise bone-based placement awaits inspection of the rig.
3. **Animation:** if the GLB contains suitable animation groups named idle/walk/run/jump/aim (or similar), they are automatically selected based on movement. Without clips, the imported model remains largely rigid; a procedurally animated low-poly human fallback is shown if loading fails. Adding animations to a static skin requires rigging/retargeting outside the runtime.
4. **Reactive damage:** wooden test crates are placed near the car where available. They have 3 HP, are pickable by the weapon ray, receive lightweight impulse/bounce physics, change appearance as damaged, and break into temporary debris. Map buildings, school walls and real-world assets do not receive damage.
5. **Weapon sway:** small speed-based sway/bob supplements existing recoil and finite ammunition.

## Acceptance test

1. Reload and verify `EUROPA 002G` is visible; school, minimap and 9/16 streaming chunks still work.
2. Press V to reach the car and look for nearby wooden practice crates. Recover the gun if needed.
3. Shoot at a practice crate 3 times. The ammo counter drops, the crate moves/changes appearance, and the third hit removes it with debris. Rounds are hitscan, not simulated ballistic projectiles.
4. Press C. The imported character should appear (or a procedural stand-in if GLB loading failed), move and follow player yaw. Press C to return to first-person gun view.
5. Press Shift/WASD and release. Movement should accelerate/decelerate while the same OSM building collision boundaries remain solid.
6. If your GLB does not animate, check its animation groups and skeleton in Blender (Animation tab / Outliner). Send the model here if you want exact skeleton/hand-mapping and animation retargeting.

## Important limitations

- The `skin_1.glb` rig/skeleton/animation inventory cannot be verified from GitHub because the model is only on the user's PC. Natural body motion **requires animation clips** for that rig. This implementation does **not** deliver full-body ragdoll, inverse kinematics, finger grips, foot IK, vehicle entry or NPC combat.
- Third-person is intended to inspect movement and character pose. Aim/shoot in **first-person** for now.
- Prop motion uses low-cost custom gravity, damping and bounce on the current flat terrain; not Havok rigid bodies or destructible OSM walls.
- Bullets are an instantaneous raycast with hitpoints, recoil and a temporary impact marker, not objects simulated through flight.
- Clearing site data or private browser storage resets some gameplay saves; crate damage is session-only.
- File attribution and licences must be verified before publishing any downloaded models.

These deliberate constraints keep the current map-streaming baseline stable while the actual asset rig is inspected.
