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

export function buildProps(islands, { seed = 909, exclude, models = {} }) {
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
  const bakeLeaf = (gltf) => bakeC(gltf, { foliage: 0.55, mottle: 0.2, mottleScale: 0.5 });
  const bakeStone = (gltf) => bakeC(gltf, { foliage: 0, mottle: 0.26, rim: 0.62, mottleScale: 0.9 });
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
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.17) / commonTrees.length), scale: [1.4, 2.5], tint: leafTint, accent: 0xe7b168, accentChance: 0.07, lean: 0.05, collideR: 0.16, maxSlope: 0.4, shadow: true, sway: 0.045 });
    }
    for (const v of pineTrees) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.09) / pineTrees.length), scale: [1.5, 2.7], tint: [0xffffff, 0xcfe0c2], lean: 0.03, collideR: 0.14, maxSlope: 0.44, shadow: true, sway: 0.035 });
    }
    for (const v of willows) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round(isl.radius * 0.03), scale: [1.6, 2.3], tint: leafTint, lean: 0.04, collideR: 0.16, maxSlope: 0.36, shadow: true, sway: 0.06 });
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
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.26) / bushVariants.length), scale: [0.7, 1.35], tint: leafTint, lean: 0.07, collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.09 });
    }
  } else {
    for (const geo of [bushGeometry(1), bushGeometry(2)]) {
      defs.push({ geo, per: (isl) => Math.round(isl.radius * 0.15), scale: [0.8, 1.5], tint: leafTint, lean: 0.08, collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.09 });
    }
  }
  if (rockVariants.length) {
    for (const v of rockVariants) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.16) / rockVariants.length), scale: [1.1, 3.4], tint: [0xffffff, 0xc7cdd2], collideR: 0.28, maxSlope: 0.6, shadow: true });
    }
  } else {
    defs.push({ geo: rockGeometry(), per: (isl) => Math.round(isl.radius * 0.22), scale: [0.4, 1.5], tint: [0xb9b6ae, 0x74716b], collideR: 1.0, maxSlope: 0.6, shadow: true });
  }
  // Authored plant clumps replace the procedural spike tufts. They are placed
  // in clusters (see `cluster` below) so vegetation gathers into stands with
  // clear ground between, instead of an even sprinkle.
  if (grassClumps.length) {
    for (const v of grassClumps) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.55) / grassClumps.length), scale: [0.9, 1.9], tint: [0xd6f2a8, 0x86c060], collideR: 0, maxSlope: 0.42, shadow: false, sway: 0.2, cluster: 5.5 });
    }
  } else {
    defs.push({ geo: grassGeometry(), per: (isl) => Math.round(isl.radius * 1.6), scale: [0.7, 1.5], tint: [0xd0ff9e, 0x7fbf62], collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.35 });
  }
  for (const v of plantClumps) {
    defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.16) / plantClumps.length), scale: [0.8, 1.6], tint: [0xffffff, 0xbcd89a], collideR: 0, maxSlope: 0.4, shadow: false, sway: 0.14, cluster: 4.0 });
  }
  if (flowerClumps.length) {
    for (const v of flowerClumps) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round(isl.radius * 0.22), scale: [0.8, 1.5], tint: [0xffffff, 0xffe6b0], collideR: 0, maxSlope: 0.38, shadow: false, sway: 0.22, cluster: 3.0 });
    }
  } else {
    defs.push({ geo: flowerGeometry(), per: (isl) => Math.round(isl.radius * 0.4), scale: [0.8, 1.3], tint: [0xff8ab5, 0x9e6bff, 0xffd166, 0xff6b6b], collideR: 0, maxSlope: 0.45, shadow: false, palette: true, sway: 0.25 });
  }

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  const baseA = new THREE.Color();
  const baseB = new THREE.Color();

  for (const def of defs) {
    const placements = [];
    for (const isl of islands) {
      const spots = scatter(isl, rng, def.per(isl), exclude, def.maxSlope, 0.82, def.cluster || 0);
      placements.push(...spots);
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
      const s = rng.range(def.scale[0], def.scale[1]);
      dummy.position.set(p.x, p.y - 0.05, p.z);
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
      if (def.collideR > 0) {
        colliders.push({ type: 'circle', x: p.x, z: p.z, r: def.collideR * s, minY: p.y - 1, maxY: p.y + 4 * s });
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return { group, colliders, windTime };
}
