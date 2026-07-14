import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hash2 } from '../core/rng.js';
import { bakeToGeometry } from '../core/assets.js';

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

function pineGeometry() {
  const trunk = colored(new THREE.CylinderGeometry(0.14, 0.22, 1.5, 6).translate(0, 0.75, 0), 0x6d4c33);
  const c1 = colored(new THREE.ConeGeometry(1.25, 1.9, 7).translate(0, 2.0, 0), 0x3c7a3a);
  const c2 = colored(new THREE.ConeGeometry(0.95, 1.6, 7).translate(0, 3.0, 0), 0x458a41);
  const c3 = colored(new THREE.ConeGeometry(0.6, 1.3, 7).translate(0, 3.95, 0), 0x529a4a);
  const g = mergeGeometries([trunk.toNonIndexed(), c1.toNonIndexed(), c2.toNonIndexed(), c3.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
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
function scatter(island, rng, count, ok, maxSlope = 0.45, rimMax = 0.82) {
  const spots = [];
  let attempts = 0;
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

  // Bake glTF models (KayKit, CC0) into instancing-ready geometry; every
  // variant that failed to load simply isn't offered, and if none loaded we
  // fall back to the procedural primitives.
  const bake = (gltf) => bakeToGeometry(gltf, mergeGeometries);
  const treeVariants = [models.treeA, models.treeB, models.treesMediumA].map(bake).filter(Boolean);
  const forestVariants = [models.treesLargeA, models.treesLargeB].map(bake).filter(Boolean);
  const rockVariants = [models.rockA, models.rockB, models.rockC, models.rockD, models.rockE].map(bake).filter(Boolean);

  const defs = [];
  if (treeVariants.length) {
    for (const v of treeVariants) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.28) / treeVariants.length), scale: [2.8, 4.6], collideR: 0.09, maxSlope: 0.4, shadow: true, sway: 0.05 });
    }
    for (const v of forestVariants) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.06) / forestVariants.length), scale: [3.4, 4.8], collideR: 0.3, maxSlope: 0.32, shadow: true, sway: 0.04 });
    }
  } else {
    defs.push({ geo: pineGeometry(), per: (isl) => Math.round(isl.radius * 0.55), scale: [0.8, 1.7], tint: [0x9adf8a, 0x5d8a52], collideR: 0.4, maxSlope: 0.4, shadow: true, sway: 0.05 });
  }
  if (rockVariants.length) {
    for (const v of rockVariants) {
      defs.push({ geo: v.geometry, material: v.material, per: (isl) => Math.round((isl.radius * 0.2) / rockVariants.length), scale: [3, 7.5], collideR: 0.14, maxSlope: 0.6, shadow: true });
    }
  } else {
    defs.push({ geo: rockGeometry(), per: (isl) => Math.round(isl.radius * 0.22), scale: [0.4, 1.5], tint: [0xb9b6ae, 0x74716b], collideR: 1.0, maxSlope: 0.6, shadow: true });
  }
  // grass + flowers stay procedural — they read great and sway in the wind
  defs.push({ geo: grassGeometry(), per: (isl) => Math.round(isl.radius * 1.6), scale: [0.7, 1.5], tint: [0xd0ff9e, 0x7fbf62], collideR: 0, maxSlope: 0.5, shadow: false, sway: 0.35 });
  defs.push({ geo: flowerGeometry(), per: (isl) => Math.round(isl.radius * 0.4), scale: [0.8, 1.3], tint: [0xff8ab5, 0x9e6bff, 0xffd166, 0xff6b6b], collideR: 0, maxSlope: 0.45, shadow: false, palette: true, sway: 0.25 });

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  const baseA = new THREE.Color();
  const baseB = new THREE.Color();

  for (const def of defs) {
    const placements = [];
    for (const isl of islands) {
      const spots = scatter(isl, rng, def.per(isl), exclude, def.maxSlope);
      placements.push(...spots);
    }
    if (!placements.length) continue;
    const mat = def.material
      ? def.material.clone()
      : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
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
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (def.tint) {
        if (def.palette) {
          tintColor.set(rng.pick(def.tint));
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
