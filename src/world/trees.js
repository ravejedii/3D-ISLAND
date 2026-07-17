import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hash2 } from '../core/rng.js';

// Hand-built stylized trees: organic displaced-sphere canopies with baked
// color gradients, tapered bent trunks with visible branches, layered pines.
// Authored at world scale (an oak is ~3.5m tall at scale 1).

function paint(geo, colorFn) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorFn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Irregular foliage cloud: displaced icosahedron, squashed vertically.
// Displacement is keyed on vertex direction so duplicated corners stay welded.
function blob(seed, r, squash = 0.82) {
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = hash2(Math.round(x * 23 + y * 57), Math.round(z * 41 - y * 13), seed);
    const s = 0.82 + key * 0.38;
    pos.setXYZ(i, x * s, y * s * squash, z * s);
  }
  return geo;
}

// Tapered trunk with a gentle lean/bend and bark-tone jitter.
function trunk(seed, h, r0, r1, bendX, bendZ, barkA, barkB) {
  const geo = new THREE.CylinderGeometry(r1, r0, h, 7, 3);
  geo.translate(0, h / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + bendX * t * t);
    pos.setZ(i, pos.getZ(i) + bendZ * t * t);
  }
  const a = new THREE.Color(barkA);
  const b = new THREE.Color(barkB);
  const c = new THREE.Color();
  return paint(geo, (x, y, z, out) => {
    const k = hash2(Math.round(x * 31 + y * 17), Math.round(z * 29), seed);
    out.copy(c.copy(a).lerp(b, k));
  });
}

function branch(from, to, r) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r * 0.5, r, len, 5);
  geo.translate(0, len / 2, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(quat);
  geo.translate(from.x, from.y, from.z);
  return geo;
}

function canopyPaint(geo, low, high, yMin, yMax, seed) {
  const lo = new THREE.Color(low);
  const hi = new THREE.Color(high);
  return paint(geo, (x, y, z, out) => {
    const t = THREE.MathUtils.clamp((y - yMin) / (yMax - yMin), 0, 1);
    const k = hash2(Math.round(x * 19 + z * 27), Math.round(y * 23), seed + 9);
    out.copy(lo).lerp(hi, t * 0.85 + k * 0.15);
  });
}

// --- broadleaf: bent trunk, 2 branches, 4-6 foliage clouds ---
export function oakGeometry(seed = 1, { canopyLow = 0x47713a, canopyHigh = 0x83b055, barkA = 0x6b4a30, barkB = 0x54371f } = {}) {
  const rng = new RNG(seed * 7919 + 11);
  const parts = [];
  const bendX = rng.range(-0.28, 0.28);
  const bendZ = rng.range(-0.28, 0.28);
  const trunkH = rng.range(1.35, 1.7);
  parts.push(trunk(seed, trunkH, rng.range(0.15, 0.19), 0.09, bendX, bendZ, barkA, barkB));

  const canopyCenter = new THREE.Vector3(bendX, trunkH + 0.75, bendZ);
  const blobCount = rng.int(4, 6);
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    const a = (i / blobCount) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const rad = rng.range(0.15, 0.62);
    const bx = canopyCenter.x + Math.cos(a) * rad;
    const bz = canopyCenter.z + Math.sin(a) * rad;
    const by = canopyCenter.y + rng.range(-0.3, 0.55);
    const r = rng.range(0.55, 0.9);
    const g = blob(seed * 13 + i, r);
    g.translate(bx, by, bz);
    blobs.push({ g, bx, by, bz });
  }
  // top crown blob
  const crown = blob(seed * 13 + 99, rng.range(0.6, 0.8));
  crown.translate(canopyCenter.x, canopyCenter.y + 0.7, canopyCenter.z);
  blobs.push({ g: crown });

  const yMin = trunkH - 0.2;
  const yMax = canopyCenter.y + 1.5;
  for (const b of blobs) parts.push(canopyPaint(b.g, canopyLow, canopyHigh, yMin, yMax, seed));

  // two visible branches reaching into the canopy
  for (let i = 0; i < 2; i++) {
    const target = blobs[i * 2] || blobs[0];
    const br = branch(
      new THREE.Vector3(bendX * 0.4, trunkH * rng.range(0.55, 0.75), bendZ * 0.4),
      new THREE.Vector3(target.bx ?? bendX, (target.by ?? canopyCenter.y) - 0.2, target.bz ?? bendZ),
      0.05,
    );
    parts.push(paint(br, (x, y, z, out) => out.set(barkB)));
  }

  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}

// --- birch: slim pale trunk, smaller airy canopy ---
export function birchGeometry(seed = 1) {
  return oakGeometry(seed + 400, { canopyLow: 0x5c8a44, canopyHigh: 0x9cc468, barkA: 0xd9d3c3, barkB: 0xb1a893 });
}

// --- conifer: jittered irregular tiers, visible trunk, narrow tip ---
export function pineGeometry(seed = 1) {
  const rng = new RNG(seed * 6151 + 3);
  const parts = [];
  const trunkH = rng.range(0.7, 1.0);
  const totalH = rng.range(2.9, 3.6);
  parts.push(trunk(seed, trunkH + 0.4, 0.14, 0.08, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1), 0x5e4029, 0x49301d));

  const tiers = rng.int(4, 5);
  const lo = new THREE.Color(0x2e5a33);
  const hi = new THREE.Color(0x6aa04c);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = trunkH + t * (totalH - trunkH - 0.5);
    const r = THREE.MathUtils.lerp(rng.range(0.85, 1.05), 0.28, t);
    const h = rng.range(0.75, 1.0);
    const cone = new THREE.ConeGeometry(r, h, 8);
    // jitter the rim so tiers aren't perfect cones (welded by keyed hash)
    const pos = cone.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      const x = pos.getX(j);
      const z = pos.getZ(j);
      const key = hash2(Math.round(x * 37), Math.round(z * 37), seed + i);
      const s = 0.85 + key * 0.3;
      pos.setX(j, x * s);
      pos.setZ(j, z * s);
    }
    cone.translate(rng.range(-0.07, 0.07), y + h / 2, rng.range(-0.07, 0.07));
    const tierCol = new THREE.Color().copy(lo).lerp(hi, t);
    const edge = new THREE.Color().copy(tierCol).multiplyScalar(1.18);
    parts.push(paint(cone, (x, y2, z, out) => {
      const rim = Math.min(1, Math.hypot(x, z) * 1.2);
      out.copy(tierCol).lerp(edge, rim * 0.5);
    }));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}

// --- low undergrowth bush ---
export function bushGeometry(seed = 1) {
  const rng = new RNG(seed * 911 + 5);
  const parts = [];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const g = blob(seed * 31 + i, rng.range(0.3, 0.48), 0.7);
    g.translate(rng.range(-0.25, 0.25), rng.range(0.18, 0.3), rng.range(-0.25, 0.25));
    parts.push(canopyPaint(g, 0x466e38, 0x7aa851, -0.2, 0.8, seed));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  merged.computeVertexNormals();
  return merged;
}
