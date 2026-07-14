import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Castle keep built from primitives, merged into a handful of draw calls.
// Returns { group, colliders, windowsMaterial } — colliders are AABBs/circles
// consumed by the player controller.

function colored(geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const pos = geo.attributes.position;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // subtle per-vertex tonal noise so large flat faces read as weathered
    // stone instead of untextured plastic (keyed on position => stable)
    const k = Math.sin(pos.getX(i) * 12.9898 + pos.getY(i) * 78.233 + pos.getZ(i) * 37.719) * 43758.5453;
    const jitter = 0.93 + (k - Math.floor(k)) * 0.14;
    colors[i * 3] = color.r * jitter;
    colors[i * 3 + 1] = color.g * jitter;
    colors[i * 3 + 2] = color.b * jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const STONE = 0xb8ac98;
const STONE_DARK = 0x9a8f7d;
const ROOF = 0x4f7d8c;
const WOOD = 0x6d4c33;

export function buildCastle({ x, z, groundY }) {
  const geos = [];
  const colliders = [];
  const y0 = groundY;

  const half = 14; // courtyard half-size
  const wallH = 5.2;
  const wallT = 1.3;

  const addBox = (w, h, d, cx, cy, cz, hex, collide = true, rotY = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    geos.push(colored(g, hex));
    if (collide) {
      if (rotY) {
        // conservative AABB for rotated boxes
        const s = Math.abs(Math.sin(rotY));
        const c = Math.abs(Math.cos(rotY));
        const ww = w * c + d * s;
        const dd = w * s + d * c;
        colliders.push({ type: 'box', minX: cx - ww / 2, maxX: cx + ww / 2, minZ: cz - dd / 2, maxZ: cz + dd / 2, minY: cy - h / 2, maxY: cy + h / 2 });
      } else {
        colliders.push({ type: 'box', minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: cy - h / 2, maxY: cy + h / 2 });
      }
    }
  };

  const addCylinder = (r, h, cx, cy, cz, hex, segments = 10, collide = true) => {
    const g = new THREE.CylinderGeometry(r, r * 1.08, h, segments);
    g.translate(cx, cy, cz);
    geos.push(colored(g, hex));
    if (collide) colliders.push({ type: 'circle', x: cx, z: cz, r: r + 0.15, minY: cy - h / 2, maxY: cy + h / 2 });
  };

  const addCone = (r, h, cx, cy, cz, hex, segments = 10) => {
    const g = new THREE.ConeGeometry(r, h, segments);
    g.translate(cx, cy, cz);
    geos.push(colored(g, hex));
  };

  // --- outer walls (gate gap on the south side) ---
  // walls extend 2.5 below ground level so terrain undulation never shows sky
  const gateW = 5;
  const sink = 2.5;
  const wallCY = y0 + wallH / 2 - sink / 2;
  const wallFullH = wallH + sink;
  // north wall
  addBox(half * 2, wallFullH, wallT, x, wallCY, z - half, STONE);
  // east / west walls
  addBox(wallT, wallFullH, half * 2, x + half, wallCY, z, STONE);
  addBox(wallT, wallFullH, half * 2, x - half, wallCY, z, STONE);
  // south wall, split around the gate
  const sideW = half - gateW / 2;
  addBox(sideW, wallFullH, wallT, x - gateW / 2 - sideW / 2, wallCY, z + half, STONE);
  addBox(sideW, wallFullH, wallT, x + gateW / 2 + sideW / 2, wallCY, z + half, STONE);
  // gate lintel (walk under it)
  addBox(gateW + 1, 1.6, wallT + 0.4, x, y0 + wallH - 0.5, z + half, STONE_DARK, false);

  // crenellations
  for (const [wx, wz, horiz] of [
    [x, z - half, true],
    [x + half, z, false],
    [x - half, z, false],
  ]) {
    for (let i = -6; i <= 6; i++) {
      const off = i * 2.2;
      addBox(0.9, 0.7, 0.9, horiz ? wx + off : wx, y0 + wallH + 0.35, horiz ? wz : wz + off, STONE_DARK, false);
    }
  }
  for (let i = -6; i <= 6; i++) {
    const off = i * 2.2;
    if (Math.abs(off) < gateW / 2 + 1) continue;
    addBox(0.9, 0.7, 0.9, x + off, y0 + wallH + 0.35, z + half, STONE_DARK, false);
  }

  // --- corner towers ---
  const towers = [
    [x - half, z - half],
    [x + half, z - half],
    [x - half, z + half],
    [x + half, z + half],
  ];
  for (const [tx, tz] of towers) {
    addCylinder(2.4, 11, tx, y0 + 4.25 - 1.25, tz, STONE);
    addCone(3.0, 3.4, tx, y0 + 8.5 + 1.7, tz, ROOF);
  }
  // gatehouse mini-towers
  for (const side of [-1, 1]) {
    addCylinder(1.4, 7, x + side * (gateW / 2 + 1.1), y0 + 3.5, z + half, STONE_DARK, 8);
    addCone(1.9, 2.4, x + side * (gateW / 2 + 1.1), y0 + 7 + 1.2, z + half, ROOF, 8);
  }

  // --- central keep (enter through the south door) ---
  const keepW = 11, keepD = 9, keepH = 9;
  const kz = z - half * 0.35;
  const doorW = 2.6, doorH = 3.4;
  // keep walls as 4 slabs so there's a real doorway + interior
  const keepCY = y0 + keepH / 2 - sink / 2;
  const keepFullH = keepH + sink;
  addBox(keepW, keepFullH, 1.2, x, keepCY, kz - keepD / 2, STONE_DARK); // north
  addBox(1.2, keepFullH, keepD, x - keepW / 2, keepCY, kz, STONE_DARK); // west
  addBox(1.2, keepFullH, keepD, x + keepW / 2, keepCY, kz, STONE_DARK); // east
  const fw = (keepW - doorW) / 2;
  addBox(fw, keepFullH, 1.2, x - doorW / 2 - fw / 2, keepCY, kz + keepD / 2, STONE_DARK); // south-left
  addBox(fw, keepFullH, 1.2, x + doorW / 2 + fw / 2, keepCY, kz + keepD / 2, STONE_DARK); // south-right
  addBox(doorW + 0.8, keepH - doorH, 1.2, x, y0 + doorH + (keepH - doorH) / 2, kz + keepD / 2, STONE_DARK); // above door
  // keep roof slab + main tower
  addBox(keepW + 1, 0.8, keepD + 1, x, y0 + keepH + 0.4, kz, STONE, false);
  addCylinder(2.6, 6, x, y0 + keepH + 3, kz, STONE, 12, false);
  addCone(3.4, 4.2, x, y0 + keepH + 6 + 2.1, kz, ROOF, 12);
  // corner turrets on the keep roof
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    addCylinder(0.9, 2.6, x + sx * (keepW / 2 - 0.4), y0 + keepH + 1.3, kz + sz * (keepD / 2 - 0.4), STONE_DARK, 8, false);
    addCone(1.25, 1.6, x + sx * (keepW / 2 - 0.4), y0 + keepH + 2.6 + 0.8, kz + sz * (keepD / 2 - 0.4), ROOF, 8);
  }
  // door frame
  addBox(0.35, doorH, 1.4, x - doorW / 2, y0 + doorH / 2, kz + keepD / 2, WOOD, false);
  addBox(0.35, doorH, 1.4, x + doorW / 2, y0 + doorH / 2, kz + keepD / 2, WOOD, false);

  // banners on gatehouse
  for (const side of [-1, 1]) {
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5);
    pole.translate(x + side * (gateW / 2 + 1.1), y0 + 9.4, z + half);
    geos.push(colored(pole, WOOD));
    const flag = new THREE.BoxGeometry(1.5, 0.9, 0.05);
    flag.translate(x + side * (gateW / 2 + 1.1) + 0.8, y0 + 10.2, z + half);
    geos.push(colored(flag, 0xd8574a));
  }

  const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()));
  merged.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // --- emissive windows (glow at night) ---
  const winGeos = [];
  const winProto = new THREE.BoxGeometry(0.5, 0.9, 0.15);
  const windowSpots = [
    [x - 2.5, y0 + 5.5, kz - keepD / 2 - 0.55], [x + 2.5, y0 + 5.5, kz - keepD / 2 - 0.55],
    [x, y0 + 6.6, kz + keepD / 2 + 0.55], [x - 3, y0 + 6.6, kz + keepD / 2 + 0.55], [x + 3, y0 + 6.6, kz + keepD / 2 + 0.55],
    [x - keepW / 2 - 0.55, y0 + 5.5, kz], [x + keepW / 2 + 0.55, y0 + 5.5, kz],
    [x, y0 + keepH + 4.2, kz + 2.7],
  ];
  for (const [wx, wy, wz] of windowSpots) {
    const g = winProto.clone();
    g.translate(wx, wy, wz);
    winGeos.push(g);
  }
  const windowsMaterial = new THREE.MeshStandardMaterial({ color: 0x22201c, emissive: 0xffb54d, emissiveIntensity: 0 });
  const winMesh = new THREE.Mesh(mergeGeometries(winGeos), windowsMaterial);

  const group = new THREE.Group();
  group.add(mesh, winMesh);

  // gate torches: two flame sprites + one shared flickering light
  const torches = buildGateTorches({ x, y: y0, z: z + half, spread: gateW / 2 + 0.6 });
  group.add(torches.group);

  return { group, colliders, windowsMaterial, torchLight: torches.light, flames: torches.flames };
}

// Two torch flames + a shared flickering point light — used at the gate of
// both the procedural castle and the glTF castle model.
export function buildGateTorches({ x, y, z, spread = 3 }) {
  const group = new THREE.Group();
  const flameTex = makeFlameTexture();
  const flames = [];
  for (const side of [-1, 1]) {
    const fm = new THREE.SpriteMaterial({ map: flameTex, color: 0xffc27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const flame = new THREE.Sprite(fm);
    flame.position.set(x + side * spread, y + 3.4, z + 0.9);
    flame.scale.set(0.7, 1.1, 1);
    group.add(flame);
    flames.push(flame);
    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, flatShading: true }));
    bracket.position.set(x + side * spread, y + 2.95, z + 0.9);
    group.add(bracket);
  }
  const light = new THREE.PointLight(0xff9a45, 0, 26, 1.8);
  light.position.set(x, y + 3.6, z + 1.6);
  group.add(light);
  return { group, light, flames };
}

let _flameTex = null;
function makeFlameTexture() {
  if (_flameTex) return _flameTex;
  const w = 32, h = 48;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(w / 2, h * 0.65, 2, w / 2, h * 0.55, h * 0.5);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.35, 'rgba(255,160,60,0.85)');
  grad.addColorStop(0.75, 'rgba(230,80,30,0.35)');
  grad.addColorStop(1, 'rgba(200,60,20,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  _flameTex = new THREE.CanvasTexture(canvas);
  return _flameTex;
}
