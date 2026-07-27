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

## Pass 2 (grounding, trees, knight, README)

- **Castle grounding fixed**: the bailey's diagonal (21.5m) exceeded the 20m
  plateau, so corner towers hung over falling slope — exactly the "perched toy"
  look. The plateau now spans 28m (flat past the whole footprint) and every
  piece is seated on sampled terrain, sunk 0.3m so its base is buried.
- **Tree presentation rewritten**: the packs' source greens are near-black in
  linear space and collapsed to silhouettes under the toon ramp. All foliage
  and trunk colours now pass through an authored HSL remap (sage-to-spring
  canopy band, warm readable bark) at bake time; giant 2.5x scale outliers
  capped at 2.0x.
- **Knight rewritten**: inverted-hull ink outline (skinned, follows animation;
  hidden alternate weapons excluded after their hulls drew as a floating black
  smear), atlas lifted ~1.2x so the hero sits a stop brighter than scenery,
  height 1.85m → 2.05m.
- **HUD**: crystal count set in the display face, gilded.
- **README** rewritten to match what the project actually is now.

## Pass 3 (value & atmosphere)

- **Castle palette authored**: the mirror's GLBs had lost the pack's palette
  texture (every material flat 0.8 grey — why the castle rendered near-white),
  but material names survived. The palette is now authored by name: warm face
  stone, darker trim courses, slate-blue roofs, timber, heraldic crimson
  banners, iron. The castle finally reads as a mid-dark mass against the sky.
- **Aerial perspective**: fog retuned from bright white-out (near 150) to a
  sky-blue tint starting at 260 — distance now goes blue, not white — and the
  scattering sky's turbidity/mie haze halved, which removes most of the white
  horizon band.
- **Path as material**: fine gravel speckle (two octaves), darker wheel ruts
  either side of the crown, and a sun-dried straw verge where grass gives out
  before the bare track.

## Pass 5 (sky clipping + terrain zoning — parallel agent)

- **The horizon diagnosis was wrong, and a debug tint proved it**: the "band"
  was the entire lower sky clipping flat — the scattering dome outputs several
  times display white and ACES crushed everything below ~0.5 rad to uniform
  grey. Fixed at the source with a scale-free luminance rolloff graded into
  the dome (gentle overall, strong through the horizon, re-hued to the
  palette's blue at constant luminance), verified across six times of day on
  both render paths. Cloud deck base raised off the skyline; fog pulled in to
  88→400 so the satellite islands finally receive aerial perspective; god
  rays and bloom eased.
- **Terrain zoning as landform**: six seeded ridge capsules (src/world/zones.js)
  feed the terrain shader as uniforms (exposed-earth halo + two-scale scree),
  deal boulders along the ridge spine with a size gradient into the existing
  rock InstancedMeshes (zero extra draw calls), and exclude vegetation — one
  definition, three consumers, no drift. Stone palette authored to warm mid
  grey; ambient rock scatter halved so the mass lives in the ridges.

## Remaining visible weaknesses

Honest list, from the `after.png` capture:

1. **The terrain still reads as one continuous green.** No distinct biome
   zones or rock outcrops breaking the meadow.
2. **Horizon glow behind the castle** is reduced but still bright at low sun
   angles; a height-graded fog would finish the job.
3. ~~Composition has no deliberate foreground framing element.~~ (pass 4)
4. ~~The satellite-island buildings (KayKit hexagon pack) are stylistically
   louder than the new castle and could be re-dressed.~~ (pass 4)

## Pass 4 (hamlet re-dress + foreground framing)

Capture: `art-review/agent-b.png` (same camera as `after.png`).

- **The hamlet now belongs to the kingdom.** The KayKit hexagon-pack
  outbuildings shipped a poster palette — cobalt roofs, pillar-box timber,
  white plaster — and could not be tinted per part: each file is one mesh with
  one material and all colour lives in a shared atlas. But that atlas is an
  8×4 grid of flat swatches, i.e. a palette index, so `src/world/hamlet.js`
  classifies every triangle by the atlas cell its UVs land in and bakes the
  castle's colours into a vertex-colour attribute instead. Cobalt roof →
  castle slate, red-brown timber → kingdom timber, white plaster → warm lime
  wash, cool grey base → warm face stone, plus a muted crimson on the
  shutters. `STONE_PALETTE` moved to module scope in `castle_modular.js` so
  the castle and the hamlet share one authored palette.
- **Foreground framing.** Two weathered waymarker stones
  (`src/world/waymark.js`) stand west of the spawn track, at the left frame
  edge — a near-field dark vertical the eye can read depth against, holding
  the left margin against the satellite island on the right. Built from the
  Quaternius rock through `bakeColored`, one InstancedMesh, one draw call,
  clear of every path, walk route and perf waypoint.
- **Budget:** draw calls 62 → **60** (merging each building's parts paid for
  the stones), triangles ~134k of 150k.

## Next three highest-impact improvements

1. **Value and atmosphere pass**: darken/warm the castle stone, pull fog back and
   tint it by height so the castle reads as a dark mass against a bright sky —
   this is the single biggest step toward a portfolio frame.
2. **Path and ground treatment**: authored path edges with gravel scatter, worn
   verges, and grass density falling off into bare earth near the track.
3. **Terrain zoning**: rock outcrops and dirt/scree patches breaking the meadow,
   with vegetation density tied to zone, so the landscape reads as sculpted
   rather than one uniform lawn.
