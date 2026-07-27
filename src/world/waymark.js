import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeColored } from '../core/assets.js';

// Foreground framing for the hero view.
//
// The composition problem in art-review/after.png: everything sits in the same
// depth plane. Castle on the hill, meadow, a couple of mid-ground trees — no
// near-field object for the eye to read depth against, and nothing holding the
// left edge of the frame against the satellite island on the right.
//
// The fix is the oldest one in landscape painting: a dark vertical mass at the
// frame edge, cropped, closer than everything else. Two weathered waymarker
// stones stand west of the spawn track — old boundary markers the road was
// laid past. They are deliberately NOT centred, NOT on the path, and NOT in
// front of the castle: they hold the left margin and nothing else.
//
// Built from the Quaternius nature rock (CC0), stretched into menhir
// proportions and baked with bakeColored + the painterly stack like every
// other stone in the world. Both stones share one InstancedMesh, so the whole
// framing element costs a single draw call. If the rock models failed to load
// (the ?noassets path) this returns null and nothing appears.

// Cool weathered granite — darker than the castle's trim course on purpose, so
// the near field reads as a silhouette and the castle stays the lightest mass
// in the middle distance.
const GRANITE = new THREE.Color(0.228, 0.216, 0.207);
// the pack's moss material, pulled to a grey-sage lichen so it reads as age on
// stone rather than a plant growing on it
const LICHEN = new THREE.Color(0.132, 0.158, 0.098);

// x/z are hand-placed against the hero camera (player at 6,44 looking north
// down -z, so the camera sits near z=56): both stones land in the outer ~20%
// of the left margin, one near and one further back to open up a depth step.
// Neither is within 4m of the spawn->gate walk, the painted paths, or any perf
// tour waypoint.
const STONES = [
  { x: -2.4, z: 47.6, h: 4.55, w: 1.2, d: 0.82, lean: 0.085, tilt: -0.05, spin: 0.7 },
  { x: -5.4, z: 42.6, h: 2.9, w: 0.90, d: 0.62, lean: -0.11, tilt: 0.04, spin: 2.35 },
];

export function buildWaymark(models, { groundAt }) {
  const baked = bakeColored(models.rockMossB || models.rockB || models.rockA, mergeGeometries, {
    // stone, not foliage: no translucency, strong painted breakup so a plain
    // grey mass still reads as weathered rock at this size
    foliage: 0, mottle: 0.34, rim: 0.62, mottleScale: 0.85,
    remap: (c, matName) => (/green|moss/i.test(matName) ? LICHEN.clone() : GRANITE.clone()),
  });
  if (!baked) return null;

  // Normalise the source rock to a unit box standing on y=0 and centred in xz,
  // so the per-stone metres below mean what they say regardless of how the
  // pack authored its scale.
  const geo = baked.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
  const sy = (bb.max.y - bb.min.y) || 1;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(1 / sx, 1 / sy, 1 / sx);

  const placed = [];
  for (const s of STONES) {
    const g = groundAt(s.x, s.z);
    if (!isFinite(g)) continue;
    placed.push({ s, y: g });
  }
  if (!placed.length) return null;

  const mesh = new THREE.InstancedMesh(geo, baked.material, placed.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const colliders = [];
  placed.forEach(({ s, y }, i) => {
    // spin first, then lean — a menhir that has settled off-plumb over a few
    // centuries, not a prop dropped in level
    e.set(s.tilt, s.spin, s.lean, 'YXZ');
    q.setFromEuler(e);
    // sunk 0.25m so the base is buried in the turf rather than resting on it
    m.compose(new THREE.Vector3(s.x, y - 0.25, s.z), q, new THREE.Vector3(s.w, s.h, s.d));
    mesh.setMatrixAt(i, m);
    colliders.push({
      type: 'circle', x: s.x, z: s.z, r: Math.max(s.w, s.d) * 0.55,
      minY: y - 1, maxY: y + s.h,
    });
  });
  mesh.instanceMatrix.needsUpdate = true;

  return { mesh, colliders, spots: placed.map(({ s }) => ({ x: s.x, z: s.z, r: Math.max(s.w, s.d) * 0.9 })) };
}
