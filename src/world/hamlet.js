import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { painterlyMaterial } from '../render/painterly.js';
import { STONE_PALETTE } from './castle_modular.js';

// Re-dressing the hamlet into the castle's kingdom.
//
// The outbuildings (windmill, two cottages, well, watchtower) come from the
// KayKit Medieval Hexagon pack, whose "_blue" variants ship a poster palette:
// a cobalt roof, pillar-box red timber and pure white plaster. Next to the
// castle's warm stone and slate that reads as a different game's art.
//
// The usual lever — multiplying material.color per mesh — does not exist here:
// every one of these files is a SINGLE mesh with a SINGLE material called
// `hexagons_medieval`, and all of the colour lives in a shared 1024x1024
// atlas (`hexagons_medieval.png`). Tinting the material tints roof, wall and
// timber together.
//
// But that atlas is not a painted texture: it is an 8x4 grid of flat colour
// swatches, and every triangle's UV lands squarely inside one cell. So the
// atlas is effectively a palette index, and we can re-author it exactly the
// way the castle authors its palette by material name — classify each triangle
// by the atlas cell it samples, bake the kingdom colour into a vertex-colour
// attribute, and drop the texture entirely. The buildings then run the same
// flat-colour + painterly material as the castle batch, which is also why they
// finally sit in the same light.
//
// Which cells each building actually uses (area-weighted, measured off the
// glTF UVs) and what they are:
//
//   r0c1  #d4dbde  bright white plaster panels  -> warm lime plaster
//   r0c2  #818c91  cool grey stone base/body    -> warm face stone
//   r0c3  #4a5155  dark trim, chimney shafts    -> trim course
//   r0c4  #333333  chimney flue                 -> iron
//   r0c5  #b16f52  doors + tower walkway decks  -> dark clay
//   r0c6  #9b5a45  red-brown timber walls       -> kingdom timber
//   r1c0  #62a0d0  the water inside the well    -> deep well water
//   r1c5  #daae7d  windmill sail canvas         -> weathered linen
//   r1c6  #978f86  window shutters              -> muted heraldic crimson
//   r3c0  #257ebc  THE COBALT ROOFS             -> castle slate
//
// Anything unmapped falls back to face stone, the same default the castle uses.

const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;

// Four colours the castle has no use for, authored in the same key.
const HAMLET_EXTRA = {
  plaster: new THREE.Color(0.500, 0.455, 0.385), // lime wash: a value step up
  clay: new THREE.Color(0.250, 0.200, 0.150),    // doors, walkway decks
  linen: new THREE.Color(0.455, 0.410, 0.325),   // sun-bleached sail canvas
  water: new THREE.Color(0.075, 0.165, 0.235),   // well water, pond-keyed
  // the castle's heraldic crimson taken right down: these cells are a few
  // hundred pixels of shutter on a distant roofline, and at banner strength
  // they fired as red pinpricks instead of reading as painted wood
  shutter: new THREE.Color(0.185, 0.045, 0.048),
};

const ATLAS_PALETTE = {
  r0c1: HAMLET_EXTRA.plaster,
  r0c2: STONE_PALETTE.lightrock,
  r0c3: STONE_PALETTE.darkrock,
  r0c4: STONE_PALETTE.black,
  r0c5: HAMLET_EXTRA.clay,
  r0c6: STONE_PALETTE.lightwood,
  r1c0: HAMLET_EXTRA.water,
  r1c5: HAMLET_EXTRA.linen,
  r1c6: HAMLET_EXTRA.shutter,
  r3c0: STONE_PALETTE.celing,
};

function kingdomColorAt(u, v) {
  // glTF UV origin is top-left and GLTFLoader leaves flipY off, so v=0 is the
  // atlas's top row — the same indexing the offline measurement used.
  const c = Math.min(ATLAS_COLS - 1, Math.max(0, Math.floor(u * ATLAS_COLS)));
  const r = Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS)));
  return ATLAS_PALETTE[`r${r}c${c}`] || STONE_PALETTE.lightrock;
}

// Same contract as placeModel() in core/assets.js — a placed model plus a
// footprint collider — but the atlas is re-authored into vertex colours and
// the building's parts are merged, so the windmill (3 meshes) and watchtower
// (2 meshes) cost one draw call each instead of three and two.
export function placeHamletBuilding(gltf, { x, z, y = 0, scale = 1, rotY = 0, colliderShrink = 0.8 }) {
  if (!gltf) return null;
  const src = gltf.scene.clone(true);
  src.updateMatrixWorld(true);

  const geos = [];
  src.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
    const uv = g.attributes.uv;
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let t = 0; t + 2 < n; t += 3) {
      // classify by the triangle CENTROID, not per vertex: a vertex shared by
      // a roof face and a wall face would otherwise smear one colour into the
      // other along the seam
      let col = STONE_PALETTE.lightrock;
      if (uv) {
        const u = (uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3;
        const v = (uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3;
        col = kingdomColorAt(u, v);
      }
      for (let k = 0; k < 3; k++) {
        colors[(t + k) * 3] = col.r;
        colors[(t + k) * 3 + 1] = col.g;
        colors[(t + k) * 3 + 2] = col.b;
      }
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  });
  if (!geos.length) return null;

  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  const model = new THREE.Mesh(merged, painterlyMaterial({
    vertexColors: true, flatShading: true, mottle: 0.26, rim: 0.5, mottleScale: 0.55,
  }));
  model.castShadow = true;
  model.receiveShadow = true;
  model.scale.setScalar(scale);
  model.rotation.y = rotY;
  model.position.set(x, y, z);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const rx = ((box.max.x - box.min.x) / 2) * colliderShrink;
  const rz = ((box.max.z - box.min.z) / 2) * colliderShrink;
  const colliders = [{
    type: 'box',
    minX: cx - rx, maxX: cx + rx,
    minZ: cz - rz, maxZ: cz + rz,
    minY: box.min.y - 1, maxY: box.max.y,
  }];
  return { model, colliders };
}
