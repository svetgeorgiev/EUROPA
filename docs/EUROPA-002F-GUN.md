# EUROPA-002F — Recover a firearm from the abandoned car

Development branch: `feat/europa-002f-car-gun-pickup`
Build label: `EUROPA 002F`

## Playtest (Windows / WebStorm)

Run these commands from `D:\\WebstormProjects\\EUROPA-GitHub`:

```powershell
git fetch origin
git switch --track origin/feat/europa-002f-car-gun-pickup
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

If you've already created the local branch, use `git switch feat/europa-002f-car-gun-pickup` and `git pull --ff-only` instead. The game source should use pnpm, as declared in package.json. Avoid committing `package-lock.json` from npm unless intentionally changing package managers.

The game needs the locally downloaded model at:

`public/assets/guns/gun.glb`

No binary GLB has been committed to GitHub. Its creator/licence, dimensions and performance must be reviewed before publishing or uploading it. You can verify Vite's file server by opening `http://localhost:5173/assets/guns/gun.glb` in a browser. It should download the file rather than return HTML or a 404.

## Controls

- **V** — temporary debug teleport near the car
- **E** — search the car and recover the gun (also works if the car was searched before this update)
- **Left click** — fire while the mouse is locked to the game
- **F** — reload the firearm
- **R** — original unstuck control (unchanged)
- **M** — original local map control
- **Esc** — release mouse/pause

When collected the gun appears at the lower right of the camera. The GLB is auto-scaled based on its bounding dimensions; it may need an orientation adjustment for this specific model once visually inspected. A simple placeholder remains usable if the GLB cannot load.

The initial gun inventory is **8 loaded + 24 reserve rounds**. Reloads draw only from reserve ammunition. Gun ownership and ammunition counts persist in localStorage; the rest of EUROPA's survival inventory is not implemented yet. Reloading is immediate for this prototype.

Shooting uses a centre-screen raycast, short-lived impact markers and visual recoil. It is for **gameplay/visual testing only**: there is no NPC damage, combat AI, real projectile physics, ballistics, sound or network replication.

## Manual acceptance checks

1. Verify the school, roads, streaming, map and car still work.
2. Press V near the car and check that the prompt says `E — Take gun from car` even when the previous car search state was already stored.
3. Press E while looking at the car; the gun HUD should show `8 / 24`.
4. Shoot once at the ground or a wall. Ammo should become `7 / 24` and a small impact marker should appear temporarily.
5. Press F; ammo should become `8 / 23`.
6. Reload the page: the firearm and ammo state should be restored.
7. Confirm no new remote map requests, model errors or severe frame-rate regressions.

To reset the demo completely, remove only the keys `europa-002f-weapon-ammo-v1` and `europa-002e-abandoned-car-searched-v1` from this site's browser localStorage.

## Asset licence

Record the Sketchfab creator, model URL and licence (for both the vehicle and firearm) before publishing the game. A glTF file copied from a private download is **not** automatically licensed for redistribution. Check if attribution is required and whether the licence permits commercial distribution. Also inspect size, axes, geometry and texture resolution; a browser game needs optimised GLBs.
