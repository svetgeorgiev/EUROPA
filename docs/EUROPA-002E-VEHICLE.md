# EUROPA-002E — First interactive abandoned vehicle

Branch: `feat/europa-002e-interactive-vehicles`

## On your Windows PC

1. `git fetch origin`
2. `git switch feat/europa-002e-interactive-vehicles` (if Git says the branch isn't found locally: `git switch --track origin/feat/europa-002e-interactive-vehicles`)
3. `pnpm install` — installs `@babylonjs/loaders`. This also updates the **untracked** local `pnpm-lock.yaml`; review and commit the lockfile after successful tests. Do not add `package-lock.json`.
4. Keep your legally downloaded Sketchfab model at `public/assets/vehicles/abandoned-car.glb`. It is intentionally not in the GitHub repository.
5. `pnpm typecheck`, `pnpm test`, `pnpm dev`.
6. Look at the mini-map for the orange **C** marker. While actively playing with pointer lock, press **V** to teleport to a safe spot about 8 m from the car and face it. Walk toward the car and press **E** within 4 metres.
7. An orange blocky car will be displayed immediately as a **debug placeholder**; it is replaced by the Sketchfab car only after the full GLB loads. A bottom-left status message distinguishes loading, success and error.
8. If the model does not replace the placeholder, visit `http://localhost:5173/assets/vehicles/abandoned-car.glb` — it must download the GLB, not return an HTML/404 page. Open browser DevTools (F12), check Console and Network for errors.
9. If the browser still shows the old 002D.3B badge, stop and restart `pnpm dev`, then force-refresh the page. The current vehicle debug branch displays the **002E** badge.

The game attempts to place the vehicle at a safe point near the mapped school footprint. The placement is approximate and **not** verified as a real parking location. The original GLB's axis orientation may need adjustment after a browser visual check.

**Prototype limitations:** The vehicle is stationary. Its full asset is 66 MB, so browser startup may be slow. Searching it is a one-time localStorage flag and a descriptive notification — real inventory, loot rewards, per-world persistence, doors and driving are not implemented yet. Use browser developer tools to troubleshoot GLB loading or CORS/404 issues. Clearing `europa-002e-abandoned-car-searched-v1` from localStorage resets search state.

Keep the model creator's name, source URL and licence details with your source asset. Before a public release, review attribution, optimise the GLB and decide on Git LFS or external storage.
