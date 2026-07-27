import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hash2 } from '../core/rng.js';
import { bakeColored } from '../core/assets.js';
import { painterlyMaterial } from '../render/painterly.js';
import { oakGeometry, birchGeometry, pineGeometry as pineTreeGeometry, bushGeometry } from './trees.js';

// Instanced scenery: pine trees, rocks, grass tufts, flowers.
// Everything is placed with seeded rejection sampling on walkable slopes.

function colored(geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position;
  // vertices are duplicated per face, so jitter must be keyed on position
  // (not vertex index) or the faces tear apart
  for (let i = 0; i < pos.count; i++) {
    const key = hash2(Math.round(pos.getX(i) * 37 + pos.getY(i) * 91), Math.round(pos.getZ(i) * 53), 7);
    const s = 0.78 + key * 0.4;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.72, pos.getZ(i) * s);
  }
  const c = colored(g, 0x8d8a85);
  c.computeVertexNormals();
  return c;
}

function grassGeometry() {
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.ConeGeometry(0.05, 0.55, 3);
    b.translate(Math.cos((i / 3) * Math.PI * 2) * 0.08, 0.25, Math.sin((i / 3) * Math.PI * 2) * 0.08);
    b.rotateY(i * 2.1);
    blades.push(colored(b, 0x67ab4f).toNonIndexed());
  }
  const g = mergeGeometries(blades);
  g.computeVertexNormals();
  return g;
}

function flowerGeometry() {
  const stem = colored(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4).translate(0, 0.17, 0), 0x4c8a3f);
  const bloom = colored(new THREE.OctahedronGeometry(0.11, 0).translate(0, 0.42, 0), 0xffffff);
  const g = mergeGeometries([stem.toNonIndexed(), bloom.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

// Try to find `count` spots on the island where `ok(x, z)` passes.
// `clusterRadius` groups the spots into stands with open ground between them —
// vegetation in nature gathers, and even scatter is what reads as programmer
// art. Pass 0 for an even distribution (rocks, trees).
function scatter(island, rng, count, ok, maxSlope = 0.45, rimMax = 0.82, clusterRadius = 0) {
  const spots = [];
  let attempts = 0;
  if (clusterRadius > 0) {
    const perCluster = 7;
    const clusters = Math.max(1, Math.round(count / perCluster));
    let made = 0;
    while (made < clusters && attempts < clusters * 60) {
      attempts++;
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * island.radius * rimMax;
      const cx = island.center.x + Math.cos(a) * r;
      const cz = island.center.z + Math.sin(a) * r;
      if (island.slopeAt(cx, cz) > maxSlope || !ok(cx, cz)) continue;
      made++;
      const n = Math.round(perCluster * rng.range(0.5, 1.5));
      for (let i = 0; i < n && spots.length < count; i++) {
        const t = rng.next() * rng.next(); // packs toward the centre
        const ang = rng.range(0, Math.PI * 2);
        const x = cx + Math.cos(ang) * t * clusterRadius;
        const z = cz + Math.sin(ang) * t * clusterRadius;
        if (island.slopeAt(x, z) > maxSlope || !ok(x, z)) continue;
        spots.push({ x, z, y: island.heightAt(x, z) });
      }
    }
    return spots;
  }
  while (spots.length < count && attempts < count * 40) {
    attempts++;
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * island.radius * rimMax;
    const x = island.center.x + Math.cos(a) * r;
    const z = island.center.z + Math.sin(a) * r;
    if (island.slopeAt(x, z) > maxSlope) continue;
    if (!ok(x, z)) continue;
    spots.push({ x, z, y: island.heightAt(x, z) });
  }
  return spots;
}

// Boulders along an outcrop ridge's spine.
//
// What makes a heap of instances read as one landform rather than scattered
// props is the SIZE GRADIENT: the biggest blocks sit on the axis and near the
// middle of the ridge, and the stone frays out into small debris toward the
// ends and the scree edge. Placement is packed toward the spine by squaring a
// uniform, so the ridge has a dense core instead of an even fill.
function outcropSpots(zones, islands, rng, ok) {
  const spots = [];
  for (const zn of zones) {
    const dx = zn.x2 - zn.x1;
    const dz = zn.z2 - zn.z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const n = Math.round(len * 0.6 + zn.r * 0.9);
    for (let i = 0; i < n; i++) {
      const t = rng.range(-0.08, 1.08);
      const u = rng.next() * rng.next() * (rng.next() < 0.5 ? -1 : 1);
      const x = zn.x1 + dx * t + nx * u * zn.r * 1.15;
      const z = zn.z1 + dz * t + nz * u * zn.r * 1.15;
      if (!ok(x, z)) continue;
      const isl = islands.find((I) => I.contains(x, z));
      if (!isl) continue;
      const y = isl.heightAt(x, z);
      if (!isFinite(y)) continue;
      const along = 1 - Math.abs(t * 2 - 1); // 0 at the ridge tips, 1 mid-span
      const sz = Math.pow(Math.max(0, 1 - Math.abs(u)) * (0.4 + along * 0.6), 1.3) * rng.range(0.7, 1.0);
      // the finest specks cost a full mesh each and read as nothing at any
      // distance — the shader's grit already covers that scale
      if (sz < 0.18) continue;
      spots.push({ x, z, y, sz });
    }
  }
  return spots;
}

export function buildProps(islands, { seed = 909, exclude, excludeVeg = exclude, rockZones = [], models = {} }) {
  const rng = new RNG(seed);
  const group = new THREE.Group();
  const colliders = [];
  const windTime = { value: 0 };

  // Bake Quaternius nature-pack models (CC0) into instancing-ready geometry:
  // their per-material flat colours are folded into a vertex-colour attribute
  // so a single InstancedMesh draws trunk + foliage. If nothing loaded (the
  // ?noassets path), fall back to the hand-built procedural trees/rocks.
  // foliage lets sun bleed through leaves; rock/stone keeps it at zero
  const bakeC = (gltf, o = {}) => bakeColored(gltf, mergeGeometries, { roughness: 0.9, ...o });
  // Authored vegetation palette. The packs' source greens are nearly black in
  // linear space and collapsed into silhouette blobs under the toon ramp, so
  // every foliage/trunk colour is remapped through HSL into a designed range:
  // foliage lifts into sage-to-spring greens with a warm sunny cast, trunks
  // into readable warm bark instead of near-black.
  const hsl = { h: 0, s: 0, l: 0 };
  const leafRemap = (c, matName) => {
    c.getHSL(hsl);
    if (/wood|trunk|bark|brown/i.test(matName) || (hsl.h < 0.13 && hsl.s > 0.15)) {
      return c.setHSL(0.07, 0.34, Math.max(0.30, Math.min(0.42, hsl.l + 0.22)));
    }
    // foliage: keep each variant's hue character but move it into a lively band
    const hue = 0.21 + (hsl.h - 0.28) * 0.35;
    const light = 0.34 + Math.min(0.18, hsl.l * 1.6);
    return c.setHSL(Math.max(0.16, Math.min(0.27, hue)), 0.52, light);
  };
  const bakeLeaf = (gltf) => bakeC(gltf, { foliage: 0.55, mottle: 0.2, mottleScale: 0.5, remap: leafRemap });
  // The pack's stone is near-black in linear space: fine for a lone pebble in
  // the grass, useless for an outcrop, where the boulders and the scree they
  // sit in have to read as the SAME rock. Stone is remapped into a warm mid
  // grey band close in value to the terrain's scree colour, with moss kept
  // green so the mossy variants still count as variety.
  const stoneRemap = (c, matName) => {
    c.getHSL(hsl);
    if (/moss|grass|green|leaf/i.test(matName) || (hsl.h > 0.18 && hsl.h < 0.45 && hsl.s > 0.12)) {
      return c.setHSL(0.24, 0.42, 0.34);
    }
    // keep each variant's slight hue character, land it in readable stone
    return c.setHSL(0.09 + (hsl.h - 0.09) * 0.3, 0.09, 0.42 + Math.min(0.14, hsl.l * 0.9));
  };
  const bakeStone = (gltf) => bakeC(gltf, { foliage: 0, mottle: 0.3, rim: 0.62, mottleScale: 0.9, remap: stoneRemap });
  const commonTrees = [models.treeCommonA, models.treeCommonB].map(bakeLeaf).filter(Boolean);
  const pineTrees = [models.treePineA].map(bakeLeaf).filter(Boolean);
  const willows = [models.treeWillow].map(bakeLeaf).filter(Boolean);
  const rockVariants = [models.rockA, models.rockB, models.rockMossA].map(bakeStone).filter(Boolean);
  const bushVariants = [models.bushA, models.bushB].map(bakeLeaf).filter(Boolean);
  // authored grass/flower/broadleaf clumps (Quaternius) — real modelled tufts
  // that sit among the shader blades so the meadow has actual plant shapes
  const grassClumps = [models.grassClumpA, models.grassClumpB].map(bakeLeaf).filter(Boolean);
  const flowerClumps = [models.flowerClump].map(bakeLeaf).filter(Boolean);
  const plantClumps = [models.plantA, models.plantB].map(bakeLeaf).filter(Boolean);

  const defs = [];
  // subtle per-instance shade drift (multiplicative, so it varies toward
  // shadow) — keeps a forest of the same model from looking cloned. A few
  // broadleaves get a warm autumn tint.
  const leafTint = [0xffffff, 0xd7e6bf];
  if (commonTrees.length) {
    for (const v of commonTrees) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.17) / commonTrees.length), scale: [1.3, 2.0], tint: leafTint, accent: 0xe7b168, accentChance: 0.07, lean: 0.05, collideR: 0.16, maxSlope: 0.4, shadow: true, sway: 0.045 });
    }
    for (const v of pineTrees) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.09) / pineTrees.length), scale: [1.4, 2.2], tint: [0xffffff, 0xcfe0c2], lean: 0.03, collideR: 0.14, maxSlope: 0.44, shadow: true, sway: 0.035 });
    }
    for (const v of willows) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round(isl.radius * 0.03), scale: [1.5, 2.0], tint: leafTint, lean: 0.04, collideR: 0.16, maxSlope: 0.36, shadow: true, sway: 0.06 });
    }
  } else {
    // procedural fallback (no assets)
    for (const geo of [oakGeometry(1), oakGeometry(2), birchGeometry(1)]) {
      defs.push({ geo, per: (isl) => Math.round(isl.radius * 0.08), scale: [0.85, 1.6], tint: leafTint, lean: 0.06, collideR: 0.17, maxSlope: 0.4, shadow: true, sway: 0.05 });
    }
    for (const geo of [pineTreeGeometry(1), pineTreeGeometry(2)]) {
      defs.push({ geo, per: (isl) => Math.round(isl.radius * 0.05), scale: [0.9, 1.55], tint: [0xffffff, 0xcfe0c2], lean: 0.035, collideR: 0.13, maxSlope: 0.42, shadow: true, sway: 0.04 });
    }
  }
  if (bushVariants.length) {
    for (const v of bushVariants) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.26) / bushVariants.length), scale: [0.7, 1.35], tint: leafTint, lean: 0.07, collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.09, veg: true });
    }
  } else {
    for (const geo of [bushGeometry(1), bushGeometry(2)]) {
      defs.push({ geo, per: (isl) => Math.round(isl.radius * 0.15), scale: [0.8, 1.5], tint: leafTint, lean: 0.08, collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.09, veg: true });
    }
  }
  // Rocks. The ambient scatter is deliberately thin — loose stones lying about
  // a meadow are garnish. The mass of the stone in this world lives in the
  // outcrop ridges, and `rockSlot` deals those placements round-robin into
  // these same InstancedMeshes so the geology costs no extra draw calls.
  if (rockVariants.length) {
    rockVariants.forEach((v, i) => {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.1) / rockVariants.length), scale: [1.0, 3.2], tint: [0xffffff, 0xc7cdd2], lean: 0.13, collideR: 0.28, maxSlope: 0.6, shadow: true, rockSlot: i, rockSlots: rockVariants.length });
    });
  } else {
    defs.push({ geo: rockGeometry(), per: (isl) => Math.round(isl.radius * 0.14), scale: [0.4, 1.9], tint: [0xb9b6ae, 0x74716b], lean: 0.13, collideR: 1.0, maxSlope: 0.6, shadow: true, rockSlot: 0, rockSlots: 1 });
  }
  // Authored plant clumps replace the procedural spike tufts. They are placed
  // in clusters (see `cluster` below) so vegetation gathers into stands with
  // clear ground between, instead of an even sprinkle.
  if (grassClumps.length) {
    for (const v of grassClumps) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.55) / grassClumps.length), scale: [0.9, 1.9], tint: [0xd6f2a8, 0x86c060], collideR: 0, maxSlope: 0.42, shadow: false, sway: 0.2, cluster: 5.5, veg: true });
    }
  } else {
    defs.push({ geo: grassGeometry(), per: (isl) => Math.round(isl.radius * 1.6), scale: [0.7, 1.5], tint: [0xd0ff9e, 0x7fbf62], collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.35, veg: true });
  }
  for (const v of plantClumps) {
    defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.16) / plantClumps.length), scale: [0.8, 1.6], tint: [0xffffff, 0xbcd89a], collideR: 0, maxSlope: 0.4, shadow: false, sway: 0.14, cluster: 4.0, veg: true });
  }
  if (flowerClumps.length) {
    for (const v of flowerClumps) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round(isl.radius * 0.22), scale: [0.8, 1.5], tint: [0xffffff, 0xffe6b0], collideR: 0, maxSlope: 0.38, shadow: false, sway: 0.22, cluster: 3.0, veg: true });
    }
  } else {
    defs.push({ geo: flowerGeometry(), per: (isl) => Math.round(isl.radius * 0.4), scale: [0.8, 1.3], tint: [0xff8ab5, 0x9e6bff, 0xffd166, 0xff6b6b], collideR: 0, maxSlope: 0.45, shadow: false, palette: true, sway: 0.25, veg: true });
  }

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  const baseA = new THREE.Color();
  const baseB = new THREE.Color();

  // its own stream on purpose: drawing outcrop samples from the shared `rng`
  // would shift every tree and bush placed after it, so adding geology would
  // silently re-roll the whole world
  const outcrops = rockZones.length
    ? outcropSpots(rockZones, islands, new RNG(seed + 4242), exclude)
    : [];

  for (const def of defs) {
    const placements = [];
    for (const isl of islands) {
      const spots = scatter(isl, rng, def.per(isl), def.veg ? excludeVeg : exclude, def.maxSlope, 0.82, def.cluster || 0);
      placements.push(...spots);
    }
    // deal the outcrop boulders across the rock variants: same meshes, so the
    // geology adds instances but not draw calls
    if (def.rockSlots) {
      for (let i = def.rockSlot; i < outcrops.length; i += def.rockSlots) placements.push(outcrops[i]);
    }
    if (!placements.length) continue;
    const mat = def.material
      ? def.material.clone()
      : painterlyMaterial({ vertexColors: true, flatShading: true, foliage: 0.45, mottle: 0.18, mottleScale: 0.6 });
    if (def.sway) {
      // wind: vertices lean by height, phase varies per instance position
      const sway = def.sway;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = windTime;
        shader.uniforms.uSway = { value: sway };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uSway;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              float phase = uWindTime * 1.7 + instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.43;
              float amt = pow(max(position.y, 0.0) * 0.3, 1.4) * uSway;
              transformed.x += sin(phase) * amt;
              transformed.z += cos(phase * 0.83) * amt * 0.7;
            }`);
      };
      mat.customProgramCacheKey = () => 'wind-sway';
    }
    const mesh = new THREE.InstancedMesh(def.geo, mat, placements.length);
    mesh.castShadow = def.shadow;
    mesh.receiveShadow = false;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      // outcrop stones carry their own size from the ridge gradient, and are
      // bedded deeper into the ground so they read as rock coming UP through
      // the turf rather than props set down on it
      const s = p.sz !== undefined
        ? def.scale[0] + (def.scale[1] - def.scale[0]) * p.sz
        : rng.range(def.scale[0], def.scale[1]);
      dummy.position.set(p.x, p.y - (p.sz !== undefined ? 0.3 * s : 0.05), p.z);
      const lean = def.lean || 0;
      dummy.rotation.set(rng.range(-lean, lean), rng.range(0, Math.PI * 2), rng.range(-lean, lean));
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (def.tint) {
        if (def.palette) {
          tintColor.set(rng.pick(def.tint));
        } else if (def.accentChance && rng.next() < def.accentChance) {
          tintColor.set(def.accent); // the odd golden tree
        } else {
          baseA.set(def.tint[0]);
          baseB.set(def.tint[1]);
          tintColor.copy(baseA).lerp(baseB, rng.next());
        }
        mesh.setColorAt(i, tintColor);
      }
      // only the blocks big enough to stop a person collide; the scree debris
      // is walk-over dressing, which also keeps the collider list short
      if (def.collideR > 0 && (p.sz === undefined || p.sz > 0.62)) {
        colliders.push({ type: 'circle', x: p.x, z: p.z, r: def.collideR * s, minY: p.y - 1, maxY: p.y + 4 * s });
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return { group, colliders, windTime };
}
