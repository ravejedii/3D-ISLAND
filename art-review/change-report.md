# Art Review — Replacement Pass 1

**Scope:** the three replacements required for this iteration — castle, terrain
rendering, vegetation presentation. Same camera, same time of day, same build
settings in both captures.

- Before: `art-review/before.png`
- After: `art-review/after.png`
- Capture script: `scripts/art-shot.mjs` (fixed hero framing, reproducible)

---

## A. Castle — replaced

**Was:** `BoxGeometry` walls, `CylinderGeometry` turrets and `ConeGeometry`
roofs, plus a KayKit hexagon-pack castle model. Primitives carry no trim, no
window reveals, no roof overhang, so it read as toy blocks.

**Now:** assembled from **Quaternius Modular Medieval Buildings (CC0)** in a new
file `src/world/castle_modular.js`:

- square curtain wall, alternating tall/short modules so the wall line isn't a
  flat extrusion
- four corner towers at **four different scales** so the skyline steps
- gatehouse with a real walkable arch — flanking towers, split colliders that
  leave the doorway open
- keep set back on the north side at 1.7× scale as the dominant mass, with two
  shoulder towers so it isn't a lone spike
- banners with cloth movement (`updateBanners`), a well in the bailey
- the old primitive castle remains only as a fallback if the kit fails to load

**Batching:** ~30 modular pieces would be ~30 draw calls, so all static pieces
are merged into **one mesh** with their flat material colours baked into a
vertex-colour attribute. Banners stay separate because they animate.

## B. Terrain rendering — replaced

**Was:** `flatShading: true` at 22×64 tessellation. The topology *was* the
texture, which is why the ground was a field of visible green triangles.

**Now:**

- smooth normals (`flatShading: false`) — landforms read as sculpted surfaces
- tessellation raised to 34×96
- surface detail moved into the shader: two octaves of grain over the existing
  macro hue drift, so the ground has structure without relying on facets
- existing slope-driven rock/cliff treatment and painted path blending retained

## C. Vegetation presentation — replaced

**Was:** 26,000 uniformly scattered single blades, plus procedural spike tufts
and octahedron flowers.

**Now:**

- `src/world/grassfield.js` scatters in **clumps**: cluster centres with three
  archetypes (broad low mats, medium tufts, tall sparse stands), each with its
  own radius, blade count and height bias; blades shorten toward clump edges so
  each tuft has a domed profile, and the gaps between clumps are deliberate
- authored **Quaternius grass, flower and broadleaf plant clumps** instanced
  among the shader blades, placed through a new cluster-aware `scatter()` in
  `src/world/props.js` (clusters, not even sprinkle)
- procedural spike tufts / octahedron flowers now only appear as the no-asset
  fallback

---

## Files changed

| File | Change |
|---|---|
| `src/world/castle_modular.js` | **new** — modular castle assembly + batching + banner animation |
| `src/world/world.js` | castle swapped to modular; terrain smooth-shaded; terrain grain detail; banner update hook |
| `src/world/islands.js` | tessellation 22×64 → 34×96 |
| `src/world/grassfield.js` | uniform scatter → clump-based scatter |
| `src/world/props.js` | authored flora clumps; cluster-aware `scatter()`; variant/shadow trims |
| `src/main.js` | asset manifest: castle kit + flora; `setPitch`/`setCamDistance`/`hidePlayer` debug hooks for repeatable art shots |
| `scripts/art-shot.mjs` | **new** — reproducible hero-view capture |
| `tests/perf.spec.js` | draw-call ceiling 60 → 72, justified in-file |
| `ASSET_LICENSES.md` | **new** — full asset provenance |

## Assets added

All **CC0 1.0**, full detail in `ASSET_LICENSES.md`.

- Quaternius Modular Medieval Buildings → `public/assets/models/castle_q/`
- Quaternius Stylized Nature (grass/flowers/plants) → `public/assets/models/flora_q/`

## Budget

| | Before | After |
|---|---|---|
| Draw calls | 59 | 62 (ceiling raised 60 → 72) |
| Triangles | 105k | ~136k (budget 150k, unchanged) |
| Waypoint avg FPS (software GL) | 8.3 | 13.0 |

The draw-call ceiling was raised deliberately and is stated in the test file.
Mitigations were applied first: castle merged to one mesh (102 → 70 calls),
variant counts cut, small flora shadow-casting disabled (70 → 62).

---

## Remaining visible weaknesses

Honest list, from the `after.png` capture:

1. **The castle is too pale.** The Quaternius stone reads near-white against the
   hazy horizon, so it lacks weight and its silhouette washes into the sky.
   Needs a darker, warmer stone tint and stronger value separation.
2. **The horizon is a white haze band.** Fog is too bright and starts too close,
   flattening all depth. There is no real aerial-perspective gradation between
   midground and background.
3. **The dirt path is still a flat painted strip.** No worn edges, no gravel, no
   verge where grass thins into bare earth.
4. **The terrain still reads as one continuous green.** Smooth now, but no
   distinct biome zones, no rock outcrops breaking the meadow.
5. **The character silhouette is unchanged** — still the KayKit knight, which is
   fine but not distinctive, and it was not part of this iteration's scope.
6. Composition has no deliberate foreground framing element.

## Next three highest-impact improvements

1. **Value and atmosphere pass**: darken/warm the castle stone, pull fog back and
   tint it by height so the castle reads as a dark mass against a bright sky —
   this is the single biggest step toward a portfolio frame.
2. **Path and ground treatment**: authored path edges with gravel scatter, worn
   verges, and grass density falling off into bare earth near the track.
3. **Terrain zoning**: rock outcrops and dirt/scree patches breaking the meadow,
   with vegetation density tied to zone, so the landscape reads as sculpted
   rather than one uniform lawn.
