import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { painterlyMaterial } from '../render/painterly.js';
import { crestEmblem } from '../ui/frames.js';

// ---------------------------------------------------------------------------
// Dressing the hero.
//
// The base character is a bare Quaternius knight: correct heroic proportions
// (~7 heads, real shoulders, separated fingers) but only three flat materials
// and no gear at all. Everything that makes him *this kingdom's* champion is
// authored here and attached to his bones:
//
//   * a layered TABARD carrying the kingdom crest (the same winged sky-crystal
//     emblem the HUD draws, rasterised from its SVG onto a canvas) with a gold
//     hem and a belt whose UVs point at a gold swatch baked into the same
//     canvas — so tabard + belt + buckle are ONE draw call
//   * PAULDRONS with gold edge trim, one per shoulder bone
//   * a SEGMENTED CAPE: a skinned sheet over a 5-bone chain driven from the
//     movement state, so it trails when he runs and settles when he stops.
//     Skinning keeps it to a single draw call where nested segments would cost
//     one each
//   * a HEATER SHIELD whose face is painted from the same crest canvas
//   * a real crossguarded sword in the weapon hand, and a modelled great helm
//     over the (featureless) base head, both CC0 Quaternius kit pieces baked
//     down to one vertex-coloured mesh each
//   * the base body re-authored: its three source materials are merged into a
//     single skinned mesh whose colours live in a vertex attribute, which both
//     saves two draw calls and lets gauntlets/boots/collar be gilded by BONE
//     REGION for free
//
// Draw-call arithmetic matters here: the KayKit chibi this replaced drew 9
// visible meshes, and the perf budget (tests/perf.spec.js) allows no slack, so
// the dressed hero is held to the same 9.
// ---------------------------------------------------------------------------

// The kingdom's colours. Crimson is the castle banner colour from
// STONE_PALETTE (src/world/castle_modular.js); steel and gold are authored to
// sit a stop brighter than the scenery so the hero separates from the meadow.
export const HERALDRY = {
  crimson: new THREE.Color(0.52, 0.085, 0.11),
  crimsonDeep: new THREE.Color(0.30, 0.045, 0.065),
  steel: new THREE.Color(0.60, 0.645, 0.73),
  steelDark: new THREE.Color(0.30, 0.33, 0.40),
  gold: new THREE.Color(0.86, 0.635, 0.20),
  goldDeep: new THREE.Color(0.52, 0.35, 0.09),
  iron: new THREE.Color(0.10, 0.105, 0.125),
  leather: new THREE.Color(0.26, 0.155, 0.085),
  skin: new THREE.Color(0.80, 0.575, 0.40),
};

const CHAR_MAT = { mottle: 0.13, rim: 0.8, mottleScale: 4.0 };

// ---------------------------------------------------------------------------
// bone plumbing
// ---------------------------------------------------------------------------

// Bone names differ per pack AND the loader rewrites them: glTF's "Shoulder.L"
// arrives as "ShoulderL" because three.js strips characters that are illegal in
// a property path. Compare on letters and digits only so both spellings — and
// KayKit's "upperarm.l" — resolve to the same bone. First match wins.
const boneKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function findBone(root, names) {
  const want = names.map(boneKey);
  let hit = null;
  let rank = Infinity;
  root.traverse((o) => {
    if (!o.isBone) return;
    const i = want.indexOf(boneKey(o.name));
    if (i >= 0 && i < rank) {
      rank = i;
      hit = o;
    }
  });
  return hit;
}

// A socket is an Object3D parented to a bone whose *rest* transform cancels the
// bone's own rotation and scale, so anything added to it can be authored in
// METRES, in the character's own frame (+X right, +Y up, +Z forward) — and it
// still rides the animation. Without this every attachment offset would have to
// be expressed in whatever arbitrary space that bone's rest pose happens to be.
export function makeSocket(model, bone, name = 'socket') {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const boneLocal = new THREE.Matrix4().multiplyMatrices(inv, bone.matrixWorld);
  const pos = new THREE.Vector3().setFromMatrixPosition(boneLocal);
  // model units per metre: the controller normalises the whole model with a
  // uniform scale, so one metre is 1/scale model units
  const upm = 1 / (model.scale.x || 1);
  const target = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z)
    .multiply(new THREE.Matrix4().makeScale(upm, upm, upm));
  const local = new THREE.Matrix4().copy(boneLocal).invert().multiply(target);
  const socket = new THREE.Object3D();
  socket.name = name;
  local.decompose(socket.position, socket.quaternion, socket.scale);
  bone.add(socket);
  return socket;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

function paint(geo, color) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// merge a list of [geometry, colour] into one vertex-coloured geometry
function mergePainted(parts) {
  const geos = parts.map(([g, c]) => paint(g.toNonIndexed(), c));
  for (const g of geos) {
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key);
    }
  }
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}

function vcMesh(geometry, opts = {}) {
  const mesh = new THREE.Mesh(geometry, painterlyMaterial({
    vertexColors: true, flatShading: true, ...CHAR_MAT, ...opts,
  }));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// the crest canvas — one texture serves the tabard, the shield and the gold
// trim, so every painted piece stays inside a single material
// ---------------------------------------------------------------------------

// Layout (1 texture, 512x512):
//   (0,0)-(256,320)   tabard field: crimson, gold hem, crest
//   (256,0)-(512,320) shield face: gold border, quartered field, crest
//   (0,320)-(512,384) flat gold swatch (belt, buckle, strapping)
//   (0,384)-(512,512) flat dark leather swatch
export const CREST_UV = {
  tabard: [0, 0, 0.5, 0.625],
  shield: [0.5, 0, 1, 0.625],
  gold: [0.05, 0.66, 0.45, 0.72],
  leather: [0.05, 0.79, 0.45, 0.85],
};

function hex(c) {
  return `#${c.getHexString()}`;
}

export function crestCanvasTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d');
  const P = HERALDRY;

  // --- tabard field ---
  g.fillStyle = hex(P.crimson);
  g.fillRect(0, 0, 256, 320);
  // a darker centre gore so the cloth has a fold down the middle
  const gore = g.createLinearGradient(0, 0, 256, 0);
  gore.addColorStop(0, 'rgba(0,0,0,0.34)');
  gore.addColorStop(0.34, 'rgba(0,0,0,0)');
  gore.addColorStop(0.66, 'rgba(0,0,0,0)');
  gore.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = gore;
  g.fillRect(0, 0, 256, 320);
  // gold hem, doubled, and a gold collar band at the top
  g.fillStyle = hex(P.gold);
  g.fillRect(0, 292, 256, 14);
  g.fillRect(0, 312, 256, 6);
  g.fillRect(0, 0, 256, 20);
  g.fillStyle = hex(P.goldDeep);
  g.fillRect(0, 306, 256, 6);
  g.fillRect(0, 20, 256, 5);
  // gold orphreys down both edges, so the cloth has vertical structure at the
  // distance where the crest itself stops resolving
  g.fillStyle = hex(P.gold);
  g.fillRect(14, 25, 9, 267);
  g.fillRect(233, 25, 9, 267);

  // --- shield face: gold border over a per-fess crimson/steel field ---
  g.fillStyle = hex(P.gold);
  g.fillRect(256, 0, 256, 320);
  g.fillStyle = hex(P.crimson);
  g.fillRect(272, 14, 224, 292);
  g.fillStyle = hex(P.steelDark);
  g.fillRect(272, 14, 224, 96);
  g.fillStyle = hex(P.goldDeep);
  g.fillRect(272, 106, 224, 8);

  // --- flat swatches for trim geometry that shares this material ---
  g.fillStyle = hex(P.gold);
  g.fillRect(0, 320, 512, 64);
  g.fillStyle = hex(P.leather);
  g.fillRect(0, 384, 512, 128);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // canvas y runs downward; without this the atlas regions below land upside
  // down and every panel samples the wrong swatch (the tabard came out leather)
  tex.flipY = false;

  // The crest itself is the HUD's own SVG artwork rasterised in; it arrives a
  // frame or two later, so the fields above are already correct without it.
  try {
    // The HUD injects this markup into an HTML document, where the parser
    // infers the SVG namespace. A standalone data: URI has no such context —
    // without an explicit xmlns the image never decodes and the crest silently
    // never appears.
    const svg = crestEmblem(200).trim()
      .replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
    const img = new Image();
    img.onload = () => {
      g.save();
      g.globalAlpha = 0.98;
      g.drawImage(img, 26, 52, 204, 211); // tabard
      g.drawImage(img, 256 + 44, 118, 168, 174); // shield
      g.restore();
      tex.needsUpdate = true;
    };
    img.onerror = () => console.warn('[dress] crest emblem failed to rasterise');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch (e) {
    /* canvas keeps its painted fields */
  }
  return tex;
}

// Remap a plane's UVs into one region of the crest atlas.
function uvTo(geo, [u0, v0, u1, v1], flipV = true) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, u0 + u * (u1 - u0), flipV ? v1 - v * (v1 - v0) : v0 + v * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

// A cloth panel: a plane hanging from y=0 down to y=-h, curved around the body
// in Z and tapered by `taper` at the bottom.
function clothPanel(w, h, { segs = 4, rows = 4, bow = 0.05, taper = 1.0, z = 0 } = {}) {
  const geo = new THREE.PlaneGeometry(w, h, segs, rows);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // +h/2 .. -h/2
    const t = (h / 2 - y) / h; // 0 at top, 1 at bottom
    const k = 1 + (taper - 1) * t;
    const nx = x * k;
    const u = (nx / (w / 2));
    pos.setXYZ(i, nx, y - h / 2, z + Math.cos(u * Math.PI * 0.5) * bow);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// the cape: one skinned sheet over a bone chain, swayed in the update loop
// ---------------------------------------------------------------------------
function buildCape(width, length, topZ) {
  const ROWS = 5;
  const BONES = ROWS + 1;
  const seg = length / ROWS;

  const geo = new THREE.PlaneGeometry(width, length, 3, ROWS);
  const pos = geo.attributes.position;
  const skinIndex = [];
  const skinWeight = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // 0 top .. 1 bottom. Clamped: the top row lands a hair below zero in
    // floating point, and an unclamped floor() there yields bone index -1,
    // which wraps to 65535 in the Uint16 skin attribute and crashes the
    // renderer's skinned bounding-sphere pass.
    const t = Math.min(1, Math.max(0, (length / 2 - y) / length));
    // a mantle: full shoulder width at the collar, flaring to the hem. A
    // narrower top left a pale notch of tabard showing between the shoulders.
    const k = 1.0 + 0.42 * t;
    const nx = x * k;
    const u = nx / (width * 0.9);
    const wrap = Math.cos(u * Math.PI * 0.5);
    // a shallow V hem: the corners ride up, so it reads as cut cloth rather
    // than a rectangle of felt
    const hem = t * t * u * u * 0.16 * length;
    // The sheet has to fall AWAY from the spine as it descends, and its outer
    // edges wrap FORWARD around the shoulders — the centre is the furthest
    // back. Bowing it the other way pushed the collar through the chest.
    const z = topZ - wrap * 0.05 + (1 - wrap) * 0.11 - t * 0.10;
    pos.setXYZ(i, nx, -t * length + hem, z);

    const f = t * (BONES - 1);
    const b0 = Math.min(BONES - 2, Math.max(0, Math.floor(f)));
    const w1 = Math.min(1, Math.max(0, f - b0));
    skinIndex.push(b0, b0 + 1, 0, 0);
    skinWeight.push(1 - w1, w1, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.computeVertexNormals();

  const bones = [];
  const inverses = [];
  for (let i = 0; i < BONES; i++) {
    const b = new THREE.Bone();
    b.position.y = i === 0 ? 0 : -seg;
    if (i > 0) bones[i - 1].add(b);
    bones.push(b);
    inverses.push(new THREE.Matrix4().makeTranslation(0, seg * i, 0));
  }
  const skeleton = new THREE.Skeleton(bones, inverses);

  // Deliberately low rim: this is a big, mostly sky-facing sheet, and at the
  // hero's usual 0.8 rim strength it picked up so much sky blue that the cape
  // rendered salmon-pink next to the tabard's crimson.
  const mat = painterlyMaterial({
    color: HERALDRY.crimsonDeep.getHex(),
    vertexColors: false,
    flatShading: true,
    side: THREE.DoubleSide,
    mottle: 0.20,
    rim: 0.28,
    mottleScale: 3.0,
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  return { mesh, bones, seg };
}

// ---------------------------------------------------------------------------
// authored armour pieces
// ---------------------------------------------------------------------------
function buildPauldron(side) {
  const P = HERALDRY;
  const parts = [];
  // main cop: a flattened dome
  const cap = new THREE.SphereGeometry(0.145, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.62);
  cap.scale(1.0, 0.9, 1.12);
  parts.push([cap, P.steel]);
  // gold rim around its lower edge
  const rim = new THREE.TorusGeometry(0.142, 0.017, 4, 12, Math.PI * 2);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -0.012, 0);
  rim.scale(1.0, 1.0, 1.12);
  parts.push([rim, P.gold]);
  // a second, smaller lame below it so the shoulder has layered plate
  const lame = new THREE.SphereGeometry(0.118, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.52);
  lame.scale(1.0, 0.72, 1.1);
  lame.translate(side * 0.028, -0.072, 0);
  parts.push([lame, P.steelDark]);
  // a crest fin along the top so the shoulder line isn't a bare dome
  const fin = new THREE.ConeGeometry(0.030, 0.10, 4);
  fin.rotateX(-Math.PI * 0.12);
  fin.translate(side * 0.055, 0.085, -0.005);
  parts.push([fin, P.gold]);
  return mergePainted(parts);
}

// belt + buckle + tassets, authored so they share the crest atlas material
function buildBelt() {
  const geos = [];
  const band = new THREE.CylinderGeometry(0.235, 0.245, 0.085, 14, 1, true);
  geos.push(uvTo(band.toNonIndexed(), CREST_UV.leather, false));
  const buckle = new THREE.BoxGeometry(0.115, 0.085, 0.05);
  buckle.translate(0, 0, 0.225);
  geos.push(uvTo(buckle.toNonIndexed(), CREST_UV.gold, false));
  const ring = new THREE.TorusGeometry(0.243, 0.014, 4, 14);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, -0.045, 0);
  geos.push(uvTo(ring.toNonIndexed(), CREST_UV.gold, false));
  for (const g of geos) {
    g.deleteAttribute('color');
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    }
  }
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}

// The world-space bounds (expressed in `socket` space, i.e. metres in the
// character's own frame) of the vertices a given bone owns.
//
// Guessing head size is how the first three helmets ended up as skullcaps
// floating inside a bare head: this rig's cranium measures 0.44 x 0.58 x 0.50 m
// on a 2.05 m body, far larger than a "realistic" head. Measure, then fit.
export function boneRegionBox(mesh, boneName, socket) {
  const sk = mesh.skeleton;
  const idx = sk.bones.findIndex((b) => boneKey(b.name) === boneKey(boneName));
  if (idx < 0) return null;
  mesh.updateWorldMatrix(true, false);
  socket.updateWorldMatrix(true, false);
  const toSocket = new THREE.Matrix4().copy(socket.matrixWorld).invert();
  const skinToWorld = new THREE.Matrix4()
    .multiplyMatrices(sk.bones[idx].matrixWorld, sk.boneInverses[idx])
    .multiply(mesh.bindMatrix);
  const m = new THREE.Matrix4().multiplyMatrices(toSocket, skinToWorld);
  const pos = mesh.geometry.attributes.position;
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  if (!si || !sw) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) { bw = w; best = si.getComponent(i, k); }
    }
    if (best !== idx || bw < 0.5) continue;
    box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  }
  return box.isEmpty() ? null : box;
}

// The kit helm turned out to be a FACEPLATE, not a closed helm: from behind the
// hero was a bare head wearing a red mohawk. This is the closed skull it needs
// — an ellipsoid fitted to the measured cranium, a gold crown band, and a comb
// under the plume — merged into the same mesh as the kit piece so the whole
// head still costs one draw call.
function buildHelmSkull(box) {
  const P = HERALDRY;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const rx = (s.x / 2) * 1.09;
  const ry = (s.y / 2) * 1.02;
  const rz = (s.z / 2) * 1.07;
  const parts = [];

  // closed helm: an almost complete ellipsoid, open only at the neck
  const dome = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.93);
  dome.scale(rx, ry, rz);
  dome.translate(c.x, c.y + ry * 0.04, c.z);
  parts.push([dome, P.steel]);

  // gold crown band around the brow line
  const band = new THREE.CylinderGeometry(1, 1.02, 0.16, 16, 1, true);
  band.scale(rx * 1.012, ry, rz * 1.012);
  band.translate(c.x, c.y + ry * 0.30, c.z);
  parts.push([band, P.gold]);

  // gold comb along the crown, seating the plume
  const comb = new THREE.BoxGeometry(rx * 0.20, ry * 0.18, rz * 1.55);
  comb.translate(c.x, c.y + ry * 0.98, c.z - rz * 0.14);
  parts.push([comb, P.gold]);

  // a dark gorget ring at the neck so the helm doesn't float on bare skin
  const gorget = new THREE.CylinderGeometry(rx * 0.78, rx * 0.92, ry * 0.22, 14, 1, true);
  gorget.scale(1, 1, (rz / rx) * 1.02);
  gorget.translate(c.x, box.min.y + ry * 0.05, c.z);
  parts.push([gorget, P.steelDark]);

  return { geometry: mergePainted(parts), centre: c, radius: new THREE.Vector3(rx, ry, rz) };
}

// heater shield: a domed, tapered plate carrying the painted crest face
function buildShield() {
  const W = 0.46;
  const H = 0.60;
  const geo = new THREE.PlaneGeometry(W, H, 4, 5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (H / 2 - y) / H; // 0 top .. 1 bottom
    // heater outline: straight at the top, curving to a point at the base
    const k = t < 0.25 ? 1 : Math.cos((t - 0.25) / 0.75 * Math.PI * 0.5);
    const nx = x * Math.max(0.02, k);
    const dome = Math.cos((nx / (W / 2)) * Math.PI * 0.5) * 0.055;
    pos.setXYZ(i, nx, y, dome);
  }
  uvTo(geo, CREST_UV.shield);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// base body: three flat source materials merged into one vertex-coloured
// skinned mesh, then re-authored by bone region
// ---------------------------------------------------------------------------
const BONE_TINT = [
  [/^(palm|middlehand|fingers|thumb)/i, HERALDRY.gold],   // gilded gauntlets
  [/^(foot|toes)/i, HERALDRY.iron],                       // dark sabatons
  [/^(lowerleg)/i, HERALDRY.steel],                       // greaves
  [/^(upperleg|hips)/i, HERALDRY.steelDark],              // mail chausses
  [/^(lowerarm)/i, HERALDRY.steel],
  [/^(upperarm|shoulder)/i, HERALDRY.steelDark],
  [/^(head|neck)/i, HERALDRY.skin],
];

function materialTint(name) {
  const n = String(name || '').toLowerCase();
  if (/skin|head|face|hand/.test(n)) return HERALDRY.skin;
  if (/boot|shoe|foot/.test(n)) return HERALDRY.iron;
  if (/armor|armour|metal|steel|plate/.test(n)) return HERALDRY.steel;
  if (/cloth|tunic|fabric/.test(n)) return HERALDRY.crimsonDeep;
  return HERALDRY.steel;
}

// Returns the merged SkinnedMesh, or null when the source isn't mergeable.
function rebuildBody(model) {
  const skinned = [];
  model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) return null;
  const skeleton = skinned[0].skeleton;
  // every part must ride the same skeleton for a single merge to be valid
  if (!skinned.every((s) => s.skeleton === skeleton)) return null;

  const boneColor = skeleton.bones.map((b) => {
    for (const [re, c] of BONE_TINT) if (re.test(b.name)) return c;
    return null;
  });

  const geos = [];
  for (const mesh of skinned) {
    const g = mesh.geometry.clone().toNonIndexed();
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(key)) g.deleteAttribute(key);
    }
    if (!g.attributes.skinIndex || !g.attributes.skinWeight) return null;
    const base = materialTint(mesh.material && mesh.material.name);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // pick the bone that owns this vertex, and let its region colour win over
      // the source material — this is what gilds the gauntlets and darkens the
      // sabatons without adding a single draw call
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bestW) { bestW = w; best = si.getComponent(i, k); }
      }
      const region = boneColor[best];
      c.copy(region && bestW > 0.55 ? region : base);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  if (!merged) return null;
  merged.computeVertexNormals();

  const mesh = new THREE.SkinnedMesh(merged, painterlyMaterial({
    vertexColors: true, flatShading: true, ...CHAR_MAT,
  }));
  mesh.name = 'Knight_Body';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const src = skinned[0];
  src.parent.add(mesh);
  mesh.bindMode = src.bindMode;
  mesh.bind(skeleton, src.bindMatrix);
  for (const s of skinned) {
    s.visible = false;
    if (s.parent) s.parent.remove(s);
  }
  return mesh;
}

// ---------------------------------------------------------------------------
// kit pieces loaded from CC0 GLBs, baked to one vertex-coloured mesh each
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
const kitCache = new Map();

function loadKit(file) {
  if (kitCache.has(file)) return kitCache.get(file);
  const p = new Promise((resolve) => {
    loader.load(`assets/models/characters/${file}`, resolve, undefined, (err) => {
      console.warn(`[dress] ${file} unavailable — the hero wears the rest`, err?.message || err);
      resolve(null);
    });
  });
  kitCache.set(file, p);
  return p;
}

// Bake a kit GLB into one vertex-coloured geometry, remapping its palette into
// the kingdom's. Hidden/alternate meshes in a kit file are never included.
function bakeKit(gltf, remap) {
  if (!gltf) return null;
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh || o.visible === false) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    parts.push([g, remap(o.material && o.material.name, o.material && o.material.color)]);
  });
  if (!parts.length) return null;
  return mergePainted(parts);
}

// Scale + centre a baked kit geometry so it occupies `height` metres and sits
// with its origin at the middle of its own bounds.
function fitGeometry(geo, height) {
  geo.computeBoundingBox();
  const h = Math.max(geo.boundingBox.max.y - geo.boundingBox.min.y, 1e-6);
  geo.scale(height / h, height / h, height / h);
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  return geo.translate(-c.x, -c.y, -c.z);
}

// Lay a weapon geometry along -Y (hanging from the grip at the origin) and
// normalise it to `length` metres.
//
// This can't assume an axis: glTF is Y-up but the source packs are authored
// Z-up in Blender, and the exporter puts that conversion in the NODE, so after
// baking a kit's world matrix into its geometry the blade may run along any
// axis. Measuring beats guessing — the first attempt hard-coded +Z and produced
// a four-metre greatsword.
function layBlade(geo, length) {
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : (size.y >= size.z ? 'y' : 'z');
  const k = length / Math.max(size[axis], 1e-6);
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z); // centred, so "spread" below is measurable
  geo.computeBoundingBox();

  // Which end is the hilt? The crossguard is the widest cross-section on a
  // sword, so compare the perpendicular spread of the outer fifth at each end.
  const pos = geo.attributes.position;
  const b = geo.boundingBox;
  const lo = b.min[axis];
  const hi = b.max[axis];
  const span = hi - lo;
  const perp = ['x', 'y', 'z'].filter((a) => a !== axis);
  const spread = [0, 0];
  for (let i = 0; i < pos.count; i++) {
    const v = pos[`get${axis.toUpperCase()}`](i);
    const t = (v - lo) / span;
    const end = t < 0.2 ? 0 : (t > 0.8 ? 1 : -1);
    if (end < 0) continue;
    for (const a of perp) {
      spread[end] = Math.max(spread[end], Math.abs(pos[`get${a.toUpperCase()}`](i)));
    }
  }
  const hiltAtMax = spread[1] > spread[0];

  if (axis === 'z') geo.rotateX(Math.PI / 2);        // +Z -> -Y
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2);  // +X -> -Y
  // axis 'y' already runs vertically
  if (hiltAtMax !== (axis === 'y')) geo.rotateX(Math.PI); // put the hilt on top
  geo.computeBoundingBox();
  geo.translate(
    -(geo.boundingBox.min.x + geo.boundingBox.max.x) / 2,
    -geo.boundingBox.max.y,
    -(geo.boundingBox.min.z + geo.boundingBox.max.z) / 2,
  );
  return geo;
}

const HELMET_REMAP = (name) => {
  const n = String(name || '').toLowerCase();
  if (/gold/.test(n)) return HERALDRY.gold;
  if (/black|dark/.test(n)) return HERALDRY.iron;
  return HERALDRY.steel;
};
const SWORD_REMAP = (name) => {
  const n = String(name || '').toLowerCase();
  if (/gold/.test(n)) return HERALDRY.gold;
  if (/lightsteel/.test(n)) return new THREE.Color(0.78, 0.82, 0.90);
  if (/darksteel/.test(n)) return HERALDRY.gold;      // crossguard + pommel gilded
  if (/steel|metal/.test(n)) return new THREE.Color(0.62, 0.67, 0.76);
  if (/lightwood/.test(n)) return HERALDRY.crimson;   // wrapped grip
  if (/wood|leather|brown/.test(n)) return HERALDRY.crimsonDeep;
  return HERALDRY.steel;
};

// The approved plume crest: a dense arc of blades that merges into one
// horsehair crest, so the silhouette is readable from any distance.
export function buildPlume(width = 0.19) {
  const blades = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const g = new THREE.ConeGeometry(0.055 - t * 0.02, 0.22 + Math.sin(t * Math.PI) * 0.09, 5);
    g.translate(0, 0.11, 0);
    // sweep hard back over the crown: a shallower fan read as a punk mohawk
    // from behind rather than as a horsehair crest
    g.rotateX(-0.10 - t * 1.55);
    g.translate(0, 0, -t * 0.035);
    blades.push(g.toNonIndexed());
  }
  const geo = mergeGeometries(blades);
  geo.computeVertexNormals();
  const plume = new THREE.Mesh(geo, painterlyMaterial({
    color: HERALDRY.crimson.getHex(), flatShading: true, mottle: 0.16, rim: 0.7, mottleScale: 3.0,
  }));
  plume.name = 'Knight_Plume';
  plume.castShadow = false; // a 90-triangle tuft is not worth a shadow pass
  plume.frustumCulled = false;
  plume.scale.setScalar(width / 0.11);
  return plume;
}

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------

// Dresses `model` (an already-normalised character glTF scene) in the
// kingdom's colours and gear. Synchronous parts land immediately; the two CC0
// kit pieces (helm, sword) stream in and attach when they arrive. Returns a
// handle with `update(dt, state)` for the cape, or null when the model has no
// usable skeleton.
export function dressKnight(model) {
  const bone = (names) => findBone(model, names);
  const head = bone(['head']);
  const torso = bone(['torso', 'chest', 'spine']);
  const shoulderL = bone(['shoulder.l', 'upperarm.l']);
  const shoulderR = bone(['shoulder.r', 'upperarm.r']);
  const handR = bone(['palm.r', 'handslot.r', 'hand.r', 'middlehand.r']);
  const armL = bone(['lowerarm.l', 'palm.l', 'hand.l']);
  if (!torso && !head) return null;

  const parts = [];
  const add = (socket, obj) => {
    socket.add(obj);
    parts.push(obj);
  };

  const body = rebuildBody(model);

  const crest = crestCanvasTexture();
  const clothMat = painterlyMaterial({
    map: crest, flatShading: false, side: THREE.DoubleSide,
    mottle: 0.16, rim: 0.7, mottleScale: 3.0,
  });

  // ---- tabard + belt (one mesh, one material) ----
  if (torso) {
    const s = makeSocket(model, torso, 'socket_tabard');
    const front = uvTo(clothPanel(0.40, 0.72, { bow: 0.085, taper: 1.10, z: 0.115 }), CREST_UV.tabard);
    const back = uvTo(clothPanel(0.38, 0.68, { bow: -0.060, taper: 1.10, z: -0.100 }), CREST_UV.tabard);
    const belt = buildBelt();
    belt.translate(0, -0.50, 0);
    const geos = [front.toNonIndexed(), back.toNonIndexed(), belt.toNonIndexed()];
    for (const g of geos) {
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
      }
    }
    const merged = mergeGeometries(geos);
    merged.computeVertexNormals();
    const tabard = new THREE.Mesh(merged, clothMat);
    tabard.name = 'Knight_Tabard';
    tabard.castShadow = true;
    tabard.frustumCulled = false;
    tabard.position.set(0, 0.14, 0);
    add(s, tabard);
  }

  // ---- pauldrons ----
  for (const [b, side, tag] of [[shoulderL, 1, 'pauldronL'], [shoulderR, -1, 'pauldronR']]) {
    if (!b) continue;
    const s = makeSocket(model, b, `socket_${tag}`);
    const p = vcMesh(buildPauldron(side));
    p.name = `Knight_Pauldron_${side > 0 ? 'L' : 'R'}`;
    p.position.set(side * 0.105, 0.035, -0.005);
    p.rotation.z = side * 0.30;
    add(s, p);
  }

  // ---- cape ----
  let cape = null;
  if (torso) {
    const s = makeSocket(model, torso, 'socket_cape');
    // seated clear of the tabard's back panel, or the tabard pokes through it
    cape = buildCape(0.50, 0.98, -0.185);
    cape.mesh.name = 'Knight_Cape';
    cape.mesh.position.set(0, 0.345, -0.03);
    add(s, cape.mesh);
    // Gold clasp across the shoulders, holding the cape on. Its z sits just
    // OUTSIDE the cape's top row (which bows back to ~-0.235 at the centre) —
    // put it at z=0 and the gems surface through the chest as red blemishes.
    const bar = new THREE.BoxGeometry(0.34, 0.048, 0.042);
    bar.translate(0, 0.012, -0.242);
    const gem = (x) => {
      const g = new THREE.SphereGeometry(0.042, 8, 6);
      g.translate(x, 0.012, -0.215);
      return g;
    };
    const clasp = mergePainted([[bar, HERALDRY.gold], [gem(0.175), HERALDRY.crimson], [gem(-0.175), HERALDRY.crimson]]);
    const claspMesh = vcMesh(clasp);
    claspMesh.name = 'Knight_CapeClasp';
    claspMesh.castShadow = false;
    cape.mesh.add(claspMesh); // rides the cape mesh: no extra socket, still 1 node
  }

  // ---- shield on the off hand ----
  if (armL) {
    const s = makeSocket(model, armL, 'socket_shield');
    const shield = new THREE.Mesh(buildShield(), clothMat);
    shield.name = 'Knight_Shield';
    shield.castShadow = true;
    shield.frustumCulled = false;
    // outside the forearm and slightly forward, angled so the painted face is
    // turned toward the camera rather than presenting its edge
    shield.position.set(0.075, -0.05, 0.105);
    shield.rotation.set(0.10, -0.46, 0.22);
    add(s, shield);
  }

  const handle = {
    parts,
    plume: null,
    cape,
    sway: { x: 0, z: 0 },
    update(dt, state) {
      if (!cape) return;
      const speed = state.speed || 0;
      const airborne = !state.grounded;
      // trail angle grows with speed; a slow wind wobble keeps it alive at rest
      const t = state.time || 0;
      const targetX = 0.09 + Math.min(0.9, speed * 0.075) + (airborne ? 0.28 : 0)
        + Math.sin(t * 1.7) * (0.045 + speed * 0.006);
      const targetZ = Math.sin(t * 1.1) * 0.05 - (state.turn || 0) * 0.5;
      const k = Math.min(1, dt * 7);
      this.sway.x += (targetX - this.sway.x) * k;
      this.sway.z += (targetZ - this.sway.z) * k;
      const n = cape.bones.length;
      for (let i = 1; i < n; i++) {
        // the chain bends progressively: most of the swing lives near the hem
        const f = 0.35 + (i / (n - 1)) * 0.9;
        cape.bones[i].rotation.x = this.sway.x * f * 0.55;
        cape.bones[i].rotation.z = this.sway.z * f * 0.4;
      }
    },
  };

  // ---- streamed kit: great helm (with the plume) and the sword ----
  if (head) {
    const s = makeSocket(model, head, 'socket_head');
    const measured = body ? boneRegionBox(body, 'head', s) : null;
    const box = measured || new THREE.Box3(
      new THREE.Vector3(-0.16, 0.02, -0.16), new THREE.Vector3(0.16, 0.50, 0.20),
    );
    const seatHelm = (kitGeo) => {
      const skull = buildHelmSkull(box);
      const r = skull.radius;
      const c = skull.centre;
      let geo = skull.geometry;
      if (kitGeo) {
        // the kit visor rides on the front of the authored skull
        fitGeometry(kitGeo, r.y * 1.85);
        kitGeo.translate(c.x, c.y + r.y * 0.06, c.z + r.z * 0.30);
        geo = mergeGeometries([kitGeo, geo]);
      }
      geo.computeVertexNormals();
      const helm = vcMesh(geo);
      helm.name = 'Knight_Helmet';
      add(s, helm);
      const plume = buildPlume(r.x * 0.44);
      plume.position.set(c.x, c.y + r.y * 0.94, c.z - r.z * 0.10);
      helm.add(plume); // parented to the helm: no extra socket
      handle.plume = plume;
    };
    loadKit('Knight_Helmet.glb').then((gltf) => seatHelm(bakeKit(gltf, HELMET_REMAP)));
  }
  if (handR) {
    const s = makeSocket(model, handR, 'socket_sword');
    loadKit('Knight_Sword.glb').then((gltf) => {
      const geo = bakeKit(gltf, SWORD_REMAP);
      if (!geo) return;
      // 0.78 m: long enough to read at gameplay distance, short enough that the
      // tip clears the grass when it hangs from a 0.62 m hand.
      layBlade(geo, 0.95);
      geo.translate(0, 0.17, 0); // the fist grips the middle of the grip
      const sword = vcMesh(geo);
      sword.name = 'Knight_Sword';
      sword.position.set(0, -0.02, 0.04);
      // canted forward so the tip clears the grass, and swung out from the hip
      // so the blade isn't lost behind the leg
      sword.rotation.set(0.52, 0, -0.30);
      add(s, sword);
    });
  }

  return handle;
}
