# Floating Isles

A 3D explorable world that runs in the browser. A scattered kingdom drifts in
the endless sky — cross rope bridges between floating islands, explore the
castle, and recover the 10 lost sky crystals.

Everything is procedural: terrain, castle, trees, sky, and even the audio are
generated from a seed at load time. No downloaded assets, no build-time bake.

## Play

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| `Shift` | Run |
| `Space` | Jump (buffered — a press just before landing still fires) |
| Mouse | Look (click to capture the pointer) |
| Scroll | Zoom camera |
| `Esc` | Pause |
| `M` | Mute |

## What's inside

- **World** — five floating islands built from an analytic heightfield
  (the same math drives the render mesh and the collision), rocky skirts,
  a castle with a walkable courtyard and keep, sagging rope bridges,
  waterfalls, a pond, and instanced pines/rocks/grass/flowers.
- **Sky** — full day/night cycle: sun and moon lighting, sunset palette,
  stars, drifting clouds, fog, and castle windows that glow at night.
- **Gameplay** — third-person controller with capsule collision, ledge
  step-up rules, bridge rails, void respawn; 10 crystals to collect,
  win screen with your time.
- **Performance** — merged geometry (~37 draw calls, ~34k triangles),
  adaptive quality that steps shadow resolution / pixel ratio up and down
  to hold frame rate, and a software-rasterizer detector that switches to
  a fast preset under SwiftShader/llvmpipe (append `?lowgfx` to force it).

## Development

```bash
pnpm build        # production build to dist/
pnpm preview      # serve the production build on :4173
pnpm test         # Playwright e2e + performance suite (13 tests)
node scripts/shot.mjs   # headless screenshot tour (needs `pnpm preview` running)
```

The test suite drives the real game in headless Chromium: it walks from spawn
across a bridge to a satellite island with no teleports, collects crystals,
verifies the win state, falls off the world and respawns, and measures FPS on
a six-waypoint tour (thresholds are calibrated for software rendering in CI;
`PERF_MIN_FPS` overrides them on real GPUs).
