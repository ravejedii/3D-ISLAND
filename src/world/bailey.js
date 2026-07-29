import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { painterlyMaterial } from '../render/painterly.js';
import { STONE_PALETTE } from './castle_modular.js';

// Dressing for the castle bailey — the yard INSIDE the curtain wall.
//
// The walled yard held a well and two gate torches, which is why it read as a
// parking lot with a keep parked in it: a castle bailey is a workplace, not a
// lawn. This module gives it the two functions a bailey always had — a
// training ground and a supply yard — plus the banners, doors and window
// reveals that make the inner wall faces read as architecture rather than
// blank extrusions.
//
// Composition rules the placement below follows:
//   * the gate-to-keep axis stays EMPTY. Everything is pushed against the side
//     walls, so walking in you look down an open parade ground at the keep,
//     with activity framing you on both sides. (It is also the e2e walking
//     route and must stay walkable.)
//   * each corner is one SCENE, not a sprinkle: the training ground is a butt
//     (targets against the wall) with a firing line of dummies and a straw
//     store behind it; the supply yard is a stall with its stock stacked
//     around it and a cart backed up to be loaded.
//   * nothing stands alone. Every item touches or overlaps another's base, so
//     the eye groups them.
//
// Everything static is baked to vertex colours and merged into ONE mesh, the
// same batching the castle itself uses — thirty props would otherwise be
// thirty draw calls and the budget (tests/perf.spec.js) has no room for that.

// The yard's colour script. Architecture colours come straight from the
// castle's STONE_PALETTE so the props read as belonging to the same world;
// the materials the village pack adds (sackcloth, straw, leather, canvas)
// are authored here in the same warm, desaturated key.
const YARD_PALETTE = {
  lightrock: STONE_PALETTE.lightrock,
  darkrock: STONE_PALETTE.darkrock,
  stone: STONE_PALETTE.darkrock,
  stonedark: STONE_PALETTE.darkrock,
  stonelight: STONE_PALETTE.lightrock,
  celing: STONE_PALETTE.celing,
  glass: STONE_PALETTE.celing,
  // the stall's awning: the pack calls it "RoofTiles_Red", but on a market
  // stall it is canvas. Slating it in the castle's roof blue turned the yard's
  // one bright object into a blue-and-cream deckchair; it is dyed cloth here,
  // striped against the same beige, which is what a market awning is.
  rooftiles: new THREE.Color(0.400, 0.128, 0.098),
  lightwood: STONE_PALETTE.lightwood,
  wood: STONE_PALETTE.lightwood,
  woodside: new THREE.Color(0.395, 0.265, 0.145),
  darkwood: new THREE.Color(0.185, 0.118, 0.062),
  leather: new THREE.Color(0.285, 0.180, 0.098),
  bag: new THREE.Color(0.400, 0.330, 0.205),
  beige: new THREE.Color(0.505, 0.455, 0.300),
  hay: new THREE.Color(0.590, 0.445, 0.180),
  red: STONE_PALETTE.banner,
  banner: STONE_PALETTE.banner,
  white: new THREE.Color(0.620, 0.595, 0.545),
  darkmetal: STONE_PALETTE.black,
  black: STONE_PALETTE.black,
};

// Longest-prefix match, so "RoofTiles_Red" resolves to the roof slate rather
// than to "red" and "Stone_Dark" beats "stone".
const yardColorFor = (matName) => {
  const key = String(matName || '').toLowerCase().replace(/[^a-z]/g, '');
  let best = null;
  let bestLen = -1;
  for (const k of Object.keys(YARD_PALETTE)) {
    if (key.startsWith(k) && k.length > bestLen) {
      best = YARD_PALETTE[k];
      bestLen = k.length;
    }
  }
  return best || STONE_PALETTE.lightwood;
};

export const BAILEY_PIECES = [
  'target', 'targetArrows', 'dummy', 'banner', 'door', 'window',
  'barrel', 'crate', 'hay', 'sacks', 'cart', 'stall', 'bench', 'fence',
];

// models: the keys above (any of them may be null — the yard just loses that
// item). Coordinates are given as offsets from the castle centre, +z south.
export function buildBaileyYard(models, { x, z, groundY, half, groundAt = null }) {
  const seat = (px, pz) => (groundAt ? Math.min(groundY, groundAt(px, pz)) : groundY);
  const items = [];
  const colliders = [];

  // (dx, dz) are yard-local; rotY 0 faces south (+z), the way you came in.
  const put = (key, dx, dz, { rot = 0, s = 1, y = 0, r = 0, h = 1.4 } = {}) => {
    const gltf = models[key];
    if (!gltf) return;
    const px = x + dx;
    const pz = z + dz;
    items.push({ gltf, px, pz, rot, s, y: seat(px, pz) + y });
    if (r > 0) colliders.push({ type: 'circle', x: px, z: pz, r, minY: groundY - 1.5, maxY: groundY + h });
  };

  // Yard-local coordinates. dz is measured from the castle centre with +z
  // SOUTH (toward the gate), so the inner wall faces sit at |d| ~ 14.1 and
  // anything beyond that is outside the castle. Fixed points to respect:
  //   gate mouth (0, 14.1) · well (4.9, 3.0) · bailey crystal (-5.5, 6.0)
  //   keep (0, -6.8) r4.2 · shoulder towers (±7.0, -4.7) r2.4
  //   the e2e walk runs gate -> (0, 9) -> (5.5, 7), so the band
  //   dx in [-3.5, 7], dz in [7, 14.1] carries no colliders at all.

  // ------------------------------------------------------------------
  // TRAINING GROUND — west side. Butts against the wall, a firing line of
  // dummies stood off them, the straw store behind. Targets face east.
  // Spacing along the wall is deliberately irregular: three targets on an
  // even pitch read as a fence, not as something soldiers use.
  // ------------------------------------------------------------------
  const T = Math.PI / 2; // faces +x (east)
  put('targetArrows', -12.5, 9.4, { rot: T - 0.06, s: 2.9, r: 0.55, h: 2.2 });
  put('target', -12.7, 5.3, { rot: T + 0.14, s: 2.7, r: 0.55, h: 2.1 });
  put('target', -12.3, 3.6, { rot: T - 0.10, s: 2.4, r: 0.5, h: 2.0 });
  // the firing line
  put('dummy', -8.9, 8.6, { rot: T - 0.55, s: 1.8, r: 0.42, h: 2.2 });
  put('dummy', -8.4, 2.2, { rot: T + 0.40, s: 1.65, r: 0.42, h: 2.1 });
  // straw store at the north end of the butts — bales stacked, one on top
  put('hay', -12.8, -1.2, { rot: 0.4, s: 5.0, r: 0.5, h: 1.1 });
  put('hay', -11.9, -1.9, { rot: 1.1, s: 4.7, r: 0.5, h: 1.1 });
  put('hay', -12.4, -1.5, { rot: 2.3, s: 4.4, y: 0.82 });
  put('bench', -10.4, -2.6, { rot: 0.18, s: 2.4, r: 0.55, h: 0.9 });
  // a rail fence closes the south end of the butts off from the gate road
  put('fence', -11.9, 12.1, { rot: 0.05, s: 3.4, r: 0 });
  put('fence', -9.3, 12.2, { rot: -0.06, s: 3.4, r: 0 });

  // ------------------------------------------------------------------
  // SUPPLY YARD — east side. A stall with its stock stacked around it and
  // a cart backed up to be loaded.
  // ------------------------------------------------------------------
  const W = -Math.PI / 2; // faces -x (west, into the yard)
  put('stall', 12.1, 8.2, { rot: W + 0.06, s: 2.7, r: 1.25, h: 2.8 });
  put('crate', 9.5, 10.7, { rot: 0.3, s: 5.2, r: 0.55, h: 1.1 });
  put('crate', 10.5, 11.4, { rot: -0.5, s: 4.8, r: 0.52, h: 1.1 });
  put('crate', 9.8, 11.0, { rot: 0.9, s: 4.3, y: 0.84 });
  put('barrel', 12.7, 11.5, { rot: 0.2, s: 4.8, r: 0.46, h: 1.2 });
  put('barrel', 13.2, 12.5, { rot: 1.4, s: 4.5, r: 0.44, h: 1.2 });
  put('barrel', 12.2, 12.7, { rot: 2.7, s: 5.0, r: 0.48, h: 1.2 });
  put('sacks', 10.7, 6.3, { rot: 0.9, s: 4.1, r: 0.55, h: 0.6 });
  put('sacks', 13.1, 5.0, { rot: -0.6, s: 3.7, r: 0.45, h: 0.6 });
  put('cart', 10.0, 2.6, { rot: 1.62, s: 2.4, r: 1.05, h: 2.1 });
  put('barrel', 8.8, 3.7, { rot: 0.7, s: 4.7, r: 0.46, h: 1.2 });
  put('hay', 13.0, 1.1, { rot: 0.6, s: 4.8, r: 0.5, h: 1.1 });

  // just inside the gate, off the road: something to pass on the way in, so
  // the yard has near-field detail from the arch as well as at its edges
  put('barrel', 7.6, 12.4, { rot: 0.9, s: 4.7, r: 0.46, h: 1.2 });
  put('crate', 8.3, 13.1, { rot: -0.3, s: 5.0, r: 0.55, h: 1.1 });
  put('sacks', -7.8, 13.0, { rot: 2.1, s: 4.2, r: 0.55, h: 0.6 });

  // ------------------------------------------------------------------
  // KEEP FORECOURT — a little order at the foot of the keep, kept off the
  // central axis so the keep still reads as the thing you walk toward.
  // ------------------------------------------------------------------
  put('crate', -3.9, -1.9, { rot: 0.5, s: 5.0, r: 0.55, h: 1.1 });
  put('barrel', -4.7, -1.0, { rot: 1.9, s: 4.7, r: 0.46, h: 1.2 });
  put('hay', 4.3, -1.6, { rot: 1.2, s: 4.7, r: 0.5, h: 1.1 });
  put('bench', 5.2, -0.3, { rot: 0.9, s: 2.3, r: 0.5, h: 0.9 });

  // ------------------------------------------------------------------
  // WALL FURNITURE — banners hung on the inner faces and gothic reveals
  // punched into the blank runs, so the yard is enclosed by architecture
  // rather than by four blank extrusions. The banner hangs from a pole at
  // its origin toward +x, so the rotation lays the cloth along its wall.
  // ------------------------------------------------------------------
  const inner = half - 1.15;      // inner face of the curtain wall
  const bY = 3.6;                 // reads from the yard, below the crenels
  put('banner', -inner, -0.6, { rot: -Math.PI / 2, s: 3.5, y: bY });
  put('banner', -inner, 8.2, { rot: -Math.PI / 2, s: 3.5, y: bY });
  put('banner', inner, 1.8, { rot: Math.PI / 2, s: 3.5, y: bY });
  put('banner', inner, 10.6, { rot: Math.PI / 2, s: 3.5, y: bY });
  put('window', -inner - 0.05, -5.5, { rot: -Math.PI / 2, s: 4.6, y: 4.3 });
  put('window', inner + 0.05, 1.4, { rot: Math.PI / 2, s: 4.6, y: 4.3 });
  // a postern in the north wall, seen past the keep's shoulder
  put('door', -6.0, -inner + 0.25, { rot: 0, s: 3.1, y: 0 });

  if (!items.length) return null;

  // ---- batch: one merged mesh, colours in a vertex attribute ----
  const geos = [];
  const node = new THREE.Object3D();
  for (const it of items) {
    const clone = it.gltf.scene.clone(true);
    node.clear();
    node.add(clone);
    node.position.set(it.px, it.y, it.pz);
    node.rotation.set(0, it.rot, 0);
    node.scale.setScalar(it.s);
    node.updateMatrixWorld(true);
    clone.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      // position only: the decimated village props were rebuilt from POSITION
      // alone, so keeping normals here would give the merge two different
      // attribute sets. Flat normals are recomputed on the merged result.
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position') g.deleteAttribute(name);
      }
      const geo = g.toNonIndexed();
      const n = geo.attributes.position.count;
      const col = yardColorFor(o.material && o.material.name);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(geo);
    });
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, painterlyMaterial({
    vertexColors: true, flatShading: true, mottle: 0.26, rim: 0.5, mottleScale: 1.4,
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, colliders };
}
