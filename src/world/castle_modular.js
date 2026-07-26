import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { painterlyMaterial, painterlyfy } from '../render/painterly.js';

// A castle assembled from authored modular architecture (Quaternius Modular
// Medieval Buildings, CC0) rather than Three.js primitives.
//
// The previous keep was BoxGeometry walls with a ConeGeometry roof, which is
// exactly why it read as toy blocks: primitives have no trim, no window
// reveals, no roof overhang and no silhouette variety. These pieces carry all
// of that in the mesh, so the job here is composition — ring the bailey with
// walls, break the skyline with towers of four different heights, push the keep
// up on the north side so it reads as the tallest mass, and leave a real gate
// you can walk through.
//
// Units: the pack's wall module is ~1.52 wide and 2.35 tall, so SCALE 4 gives
// ~6m wall segments about 9m tall — readable against a 1.85m player.

const SCALE = 4;
const WALL_W = 1.52 * SCALE;   // module footprint, used to lay out the ring
const PIECES = [
  'wall', 'wallTall', 'wallEntrance', 'towerLarge', 'towerPointy', 'tower',
  'towerSmall', 'watchtower', 'banner', 'door', 'window', 'well',
];

// Clone a loaded piece, scale it, and drop it at (x, z) standing on groundY.
function place(gltf, { x, z, y, rotY = 0, scale = SCALE, tint = null }) {
  if (!gltf) return null;
  const node = gltf.scene.clone(true);
  node.scale.setScalar(scale);
  node.rotation.y = rotY;
  node.position.set(x, y, z);
  if (tint) {
    node.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(tint);
      }
    });
  }
  node.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return node;
}

function boxCollider(minX, maxX, minZ, maxZ, minY, maxY) {
  return { type: 'box', minX, maxX, minZ, maxZ, minY, maxY };
}

// models: { wall, wallTall, wallEntrance, towerLarge, towerPointy, tower,
//           towerSmall, watchtower, banner, door, window, well }
export function buildModularCastle(models, { x, z, groundY }) {
  const missing = PIECES.filter((k) => !models[k]);
  if (missing.length > 4) return null; // not enough of the kit loaded

  const group = new THREE.Group();
  const colliders = [];
  const banners = [];
  const y0 = groundY;

  // ---- bailey: a square curtain wall, gate facing south toward the path ----
  const half = WALL_W * 2.5;          // 2.5 modules from centre to each face
  const wallH = 2.35 * SCALE;
  const perSide = 5;                  // modules per wall run

  const addWallRun = (side) => {
    for (let i = 0; i < perSide; i++) {
      const t = (i - (perSide - 1) / 2) * WALL_W;
      // the south run leaves its middle module open for the gatehouse
      const isGateSlot = side === 'S' && i === Math.floor(perSide / 2);
      let px = x, pz = z, rot = 0;
      if (side === 'N') { px = x + t; pz = z - half; rot = 0; }
      if (side === 'S') { px = x + t; pz = z + half; rot = Math.PI; }
      if (side === 'W') { px = x - half; pz = z + t; rot = -Math.PI / 2; }
      if (side === 'E') { px = x + half; pz = z + t; rot = Math.PI / 2; }

      if (isGateSlot) {
        const gate = place(models.wallEntrance || models.wall, { x: px, z: pz, y: y0, rotY: rot });
        if (gate) group.add(gate);
        // two half-width colliders leave the doorway walkable
        const jamb = WALL_W * 0.32;
        colliders.push(boxCollider(px - WALL_W / 2, px - jamb, pz - 1.1, pz + 1.1, y0 - 1, y0 + wallH));
        colliders.push(boxCollider(px + jamb, px + WALL_W / 2, pz - 1.1, pz + 1.1, y0 - 1, y0 + wallH));
        continue;
      }

      // alternate tall/short modules so the wall line isn't a flat extrusion
      const tall = (i + (side === 'N' ? 1 : 0)) % 2 === 0;
      const piece = tall ? (models.wallTall || models.wall) : models.wall;
      const seg = place(piece, { x: px, z: pz, y: y0, rotY: rot });
      if (seg) group.add(seg);
      const along = WALL_W / 2;
      if (side === 'N' || side === 'S') {
        colliders.push(boxCollider(px - along, px + along, pz - 1.1, pz + 1.1, y0 - 1, y0 + wallH));
      } else {
        colliders.push(boxCollider(px - 1.1, px + 1.1, pz - along, pz + along, y0 - 1, y0 + wallH));
      }
    }
  };
  ['N', 'S', 'W', 'E'].forEach(addWallRun);

  // ---- corner towers: four heights so the skyline steps instead of repeating
  const corners = [
    { dx: -1, dz: -1, piece: models.towerPointy || models.towerLarge, s: SCALE * 1.15 },
    { dx: 1, dz: -1, piece: models.towerLarge || models.tower, s: SCALE * 1.0 },
    { dx: -1, dz: 1, piece: models.tower || models.towerLarge, s: SCALE * 0.92 },
    { dx: 1, dz: 1, piece: models.watchtower || models.tower, s: SCALE * 0.86 },
  ];
  for (const c of corners) {
    const px = x + c.dx * half;
    const pz = z + c.dz * half;
    const t = place(c.piece, { x: px, z: pz, y: y0, scale: c.s });
    if (t) group.add(t);
    colliders.push({ type: 'circle', x: px, z: pz, r: 2.6, minY: y0 - 1, maxY: y0 + wallH * 1.6 });
  }

  // ---- gatehouse: flanking towers so the entrance reads as the front door ---
  for (const sx of [-1, 1]) {
    const px = x + sx * WALL_W * 0.9;
    const pz = z + half;
    const t = place(models.towerSmall || models.tower, { x: px, z: pz, y: y0, scale: SCALE * 0.95 });
    if (t) group.add(t);
    colliders.push({ type: 'circle', x: px, z: pz, r: 1.9, minY: y0 - 1, maxY: y0 + wallH });
  }

  // ---- keep: the tallest mass, set back on the north side ----
  const keepZ = z - half * 0.45;
  const keep = place(models.towerPointy || models.towerLarge, { x, z: keepZ, y: y0, scale: SCALE * 1.7 });
  if (keep) group.add(keep);
  colliders.push({ type: 'circle', x, z: keepZ, r: 4.2, minY: y0 - 1, maxY: y0 + wallH * 2.6 });
  // two shoulder towers give the keep a base instead of a lone spike
  for (const sx of [-1, 1]) {
    const px = x + sx * WALL_W * 1.15;
    const t = place(models.towerLarge || models.tower, { x: px, z: keepZ + WALL_W * 0.35, y: y0, scale: SCALE * 1.05 });
    if (t) group.add(t);
    colliders.push({ type: 'circle', x: px, z: keepZ + WALL_W * 0.35, r: 2.4, minY: y0 - 1, maxY: y0 + wallH * 1.8 });
  }

  // ---- dressing: banners on the gate towers, a well in the bailey ----
  if (models.banner) {
    for (const sx of [-1, 1]) {
      const b = place(models.banner, { x: x + sx * WALL_W * 0.9, z: z + half - 1.2, y: y0 + wallH * 0.55, scale: SCALE * 1.1 });
      if (b) {
        group.add(b);
        banners.push(b);
      }
    }
    // one high banner on the keep — the pair below already reads at the gate
    const kb = place(models.banner, { x: x - WALL_W * 0.62, z: keepZ + WALL_W * 0.9, y: y0 + wallH * 1.35, scale: SCALE });
    if (kb) {
      group.add(kb);
      banners.push(kb);
    }
  }
  if (models.well) {
    const w = place(models.well, { x: x + WALL_W * 0.8, z: z + WALL_W * 0.5, y: y0, scale: SCALE * 0.9 });
    if (w) group.add(w);
    colliders.push({ type: 'circle', x: x + WALL_W * 0.8, z: z + WALL_W * 0.5, r: 1.3, minY: y0 - 1, maxY: y0 + 2 });
  }

  // ---- batch ----
  // Thirty-odd modular pieces are thirty-odd draw calls. Every piece uses flat
  // colours, so their material colour is baked into a vertex-colour attribute
  // and the whole castle is merged into ONE mesh with a single painted
  // material. Banners stay separate because they animate.
  const bannerSet = new Set(banners);
  const geos = [];
  const leftovers = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) {
      if (bannerSet.has(p)) return; // keep animated cloth out of the batch
    }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    }
    const geo = g.toNonIndexed();
    const n = geo.attributes.position.count;
    const col = (o.material && o.material.color) || new THREE.Color(0xffffff);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(geo);
    leftovers.push(o);
  });

  const batched = new THREE.Group();
  if (geos.length) {
    const merged = mergeGeometries(geos);
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, painterlyMaterial({
      vertexColors: true, flatShading: true, mottle: 0.3, rim: 0.55, mottleScale: 0.5,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    batched.add(mesh);
  }
  // re-attach the animated banners on top of the batch
  for (const b of banners) {
    painterlyfy(b, { mottle: 0.12, rim: 0.6, mottleScale: 2.0 });
    batched.add(b);
  }

  return { group: batched, colliders, banners, half, gateZ: z + half };
}

// Banners breathe in the wind — cloth movement, not a static decal.
export function updateBanners(banners, t) {
  for (let i = 0; i < banners.length; i++) {
    const b = banners[i];
    b.rotation.z = Math.sin(t * 1.7 + i * 1.3) * 0.06;
    b.rotation.x = Math.sin(t * 2.3 + i * 0.7) * 0.04;
  }
}
