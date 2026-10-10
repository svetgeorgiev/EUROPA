# EUROPA-002E — First interactive abandoned vehicle

Branch: `feat/europa-002e-interactive-vehicles`

## On your Windows PC

1. `git fetch origin`
2. `git switch feat/europa-002e-interactive-vehicles` (if Git says the branch isn't found locally: `git switch --track origin/feat/europa-002e-interactive-vehicles`)
3. `pnpm install` — installs `@babylonjs/loaders`. This also updates the **untracked** local `pnpm-lock.yaml`; review and commit the lockfile after successful tests. Do not add `package-lock.json`.
4. Keep your legally downloaded Sketchfab model at `public/assets/vehicles/abandoned-car.glb`. It is intentionally not in the GitHub repository.
5. `pnpm typecheck`, `pnpm test`, `pnpm dev`.
6. Go to the mapped school area near local X=-65, Z=-12. Turn toward the car and press **E** within 4 metres.

The game attempts to place the vehicle at a safe point near the mapped school footprint. The placement is approximate and **not** verified as a real parking location. The original GLB's axis orientation may need adjustment after a browser visual check.

**Prototype limitations:** The vehicle is stationary. Its full asset is 66 MB, so browser startup may be slow. Searching it is a one-time localStorage flag and a descriptive notification — real inventory, loot rewards, per-world persistence, doors and driving are not implemented yet. Use browser developer tools to troubleshoot GLB loading or CORS/404 issues. Clearing `europa-002e-abandoned-car-searched-v1` from localStorage resets search state.

Keep the model creator's name, source URL and licence details with your source asset. Before a public release, review attribution, optimise the GLB and decide on Git LFS or external storage.
