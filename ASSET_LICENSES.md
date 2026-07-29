# Bundled Asset Licenses

Every 3D asset shipped in this repository is **CC0 1.0 Universal** (public
domain dedication). CC0 requires no attribution; credit is given here anyway,
and because a portfolio project should be auditable.

No ripped, commercial, or fan-made assets from Nintendo, Studio Ghibli, or any
other rights-holder are used anywhere in this project.

---

## Quaternius — Modular Medieval Buildings

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase (public mirror; the author's own site is unreachable from this build environment) |
| **Location** | `public/assets/models/castle_q/` |

Pieces used: `Wall.glb`, `TallWall.glb`, `TallWallEntrance.glb`, `LargeTower.glb`,
`PointyTower.glb`, `Tower.glb`, `SmallTower.glb`, `WatchTowerWRoof.glb`,
`Banner.glb`, `Door.glb`, `WindowGothic.glb`, `Well.glb`, `Target.glb`,
`TargetWithArrows.glb`, `Dummy.glb`, plus unused spares in the same folder.

**Used for:** the castle — curtain walls, gatehouse, corner towers, keep,
banners and the bailey well. Assembled in `src/world/castle_modular.js`. This
replaced a keep built from `BoxGeometry`/`CylinderGeometry`/`ConeGeometry`.
The archery butts and pell dummies of the bailey's training ground
(`src/world/bailey.js`) come from the same kit, unmodified.

---

## Quaternius — Medieval Village Pack

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase (public mirror) |
| **Location** | `public/assets/models/village_q/` |

Pieces used: `Barrel.glb`, `Crate.glb`, `Bags.glb`, `Hay.glb`, `Cart.glb`,
`Bench_1.glb`, `MarketStand_2.glb`, `Fence.glb`.

**Used for:** the castle bailey's supply yard — the market stall and the crates,
barrels, sacks, straw, handcart, benches and rail fence stacked around it
(`src/world/bailey.js`). Each file is decimated with `scripts/decimate-glb.cjs`
(meshoptimizer) to 12–35% of its source triangle count so the whole yard fits
the render budget; geometry is simplified, colour is untouched (the pack's flat
material colours are re-authored at bake time into the castle's palette).

---

## Quaternius — Stylized Nature MegaKit

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase |
| **Location** | `public/assets/models/nature_q/`, `public/assets/models/flora_q/` |

Pieces used: `CommonTree_1/3.glb`, `PineTree_1.glb`, `Willow_4.glb`,
`Rock_1/3.glb`, `Rock_Moss_2.glb`, `Bush_1/2.glb`, `Grass.glb`, `Grass_2.glb`,
`Flowers.glb`, `Plant_1.glb`, `Plant_3.glb`. (`Willow_2.glb` ships but is no
longer placed — its crown is a narrow cone; `Willow_4.glb` has the spreading
skirt the tree is read by.)

**Used for:** trees, rocks, bushes and the clustered ground flora
(`src/world/props.js`). `Grass.glb`/`Grass_2.glb` double as the pond's reeds
under a narrow, tall per-instance scale, and `Rock_*` as its shore gravel.
Trees are decimated to ~40–60% of their source triangle count by
`scripts/decimate-glb.cjs` (meshoptimizer); geometry is simplified, colour is
untouched.

---

## KayKit — Character Pack: Adventurers

| | |
|---|---|
| **Author** | Kay Lousberg (KayKit) |
| **License** | CC0 1.0 Universal |
| **Source** | https://kaylousberg.com · https://kaylousberg.itch.io |
| **Location** | `public/assets/models/characters/Knight.glb` |

**Used for:** the player character, including its animation set (idle, walk,
run, jump, cheer) driven in `src/player/controller.js`.

---

## KayKit — Medieval Hexagon Pack

| | |
|---|---|
| **Author** | Kay Lousberg (KayKit) |
| **License** | CC0 1.0 Universal |
| **Source** | https://kaylousberg.com · https://kaylousberg.itch.io |
| **Location** | `public/assets/models/buildings/` |

**Used for:** the outlying hamlet and satellite-island landmarks — houses,
windmill, well, tower (`src/world/world.js`). The castle model from this pack is
no longer used.

---

## Procedural / authored in-repo

Not third-party assets, listed for completeness:

- **UI artwork** (`src/ui/frames.js`) — crest, corner filigree, ornamental rule
  and crystal pip, hand-authored SVG, original to this project.
- **Painterly material system** (`src/render/painterly.js`) — toon ramp, rim
  light, foliage translucency, procedural mottling. No texture files.
- **Cloud deck** (`src/render/clouds.js`) — domain-warped fBm, no textures.
- **Terrain, water, bridges, grass blades** — generated at runtime.
