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
`Banner.glb`, `Door.glb`, `WindowGothic.glb`, `Well.glb`, plus unused spares in
the same folder.

**Used for:** the castle — curtain walls, gatehouse, corner towers, keep,
banners and the bailey well. Assembled in `src/world/castle_modular.js`. This
replaced a keep built from `BoxGeometry`/`CylinderGeometry`/`ConeGeometry`.

---

## Quaternius — Stylized Nature MegaKit

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase |
| **Location** | `public/assets/models/nature_q/`, `public/assets/models/flora_q/` |

Pieces used: `CommonTree_1/3.glb`, `PineTree_1.glb`, `Willow_2.glb`,
`Rock_1/3.glb`, `Rock_Moss_2.glb`, `Bush_1/2.glb`, `Grass.glb`, `Grass_2.glb`,
`Flowers.glb`, `Plant_1.glb`, `Plant_3.glb`.

**Used for:** trees, rocks, bushes and the clustered ground flora
(`src/world/props.js`). Trees are decimated to ~40% of their source triangle
count by `scripts/decimate-glb.cjs` (meshoptimizer); geometry is simplified,
colour is untouched.

---

## Quaternius — Single Knight Pack

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase |
| **Location** | `public/assets/models/characters/Knight.glb` (pack's `KnightCharacter.glb`), `public/assets/models/characters/Knight_Helmet.glb` (pack's `Helmet3.glb`) |

**Used for:** the player character — a rigged, heroically proportioned knight
with the animation set (`HumanArmature|Idle` / `|Walking` / `|Run` / `|Jump`,
plus `|swordAttackJump` used as the victory flourish) driven in
`src/player/controller.js`. The pack's `Helmet3` provides the visored faceplate
of the great helm; the rest of the helm, the tabard, pauldrons, cape, belt and
shield are authored in `src/player/dress.js`.

This replaced KayKit's Adventurers Knight, whose chibi proportions (head ≈ 35%
of body height, mitten hands, slab limbs) read as a toy next to the rest of the
world. That file is no longer bundled.

---

## Quaternius — Medieval Weapons Pack

| | |
|---|---|
| **Author** | Quaternius |
| **License** | CC0 1.0 Universal |
| **Source** | https://quaternius.com |
| **Retrieved via** | https://github.com/trebeljahr/quaternius-showcase |
| **Location** | `public/assets/models/characters/Knight_Sword.glb` (pack's `Sword.glb`) |

**Used for:** the hero's arming sword — a real crossguarded blade in his weapon
hand, baked to a single vertex-coloured mesh and re-palleted to the kingdom's
gold/steel/crimson in `src/player/dress.js`.

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
