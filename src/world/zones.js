import { RNG } from '../core/rng.js';

// Rock outcrop zones — the geological structure that breaks up the meadow.
//
// A zone is a short RIDGE, not a blob: a capsule in the XZ plane (two end
// points plus a radius). Bedrock surfaces along a line of weakness, so a ridge
// reads as something the landscape did; a circle of rocks reads as someone
// emptying a bag.
//
// The same capsules are consumed by three systems, which is the whole point —
// otherwise you get scree painted in one place and boulders in another:
//
//   * `world.js` hands them to the terrain shader, which paints exposed earth
//     and dry scree inside them
//   * `props.js` seeds boulders along their spines, big on the axis and
//     fraying to debris at the edges
//   * grass and flora are excluded from them, so nothing grows out of rock
//
// Passing the capsules to the shader as uniforms — rather than re-deriving a
// matching noise field in GLSL — is what guarantees the paint and the props
// agree exactly. This count is the array size the terrain shader declares.
export const MAX_ROCK_ZONES = 8;

function distToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dd = dx * dx + dz * dz;
  const t = dd > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / dd)) : 0;
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

// Seeded ridge placement. `ok(x, z, clearance)` is the world's veto — paths,
// the castle plateau, the pond, the hamlet, bridge mouths, crystals — and it
// is tested along the WHOLE spine, not just the centre, so a ridge can never
// swing one end into a walking route.
export function buildRockZones({ island, seed = 313, count = MAX_ROCK_ZONES, ok = () => true }) {
  const rng = new RNG(seed);
  const zones = [];
  let tries = 0;
  while (zones.length < count && tries < count * 400) {
    tries++;
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * island.radius * 0.66;
    const cx = island.center.x + Math.cos(a) * r;
    const cz = island.center.z + Math.sin(a) * r;
    const dir = rng.range(0, Math.PI);
    const half = rng.range(3.5, 8);
    const rad = rng.range(3.2, 5.6);
    const x1 = cx - Math.cos(dir) * half;
    const z1 = cz - Math.sin(dir) * half;
    const x2 = cx + Math.cos(dir) * half;
    const z2 = cz + Math.sin(dir) * half;
    let clear = true;
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      const px = x1 + (x2 - x1) * t;
      const pz = z1 + (z2 - z1) * t;
      // an outcrop hanging off a cliff face floats and can't be read anyway
      if (!ok(px, pz, rad) || island.slopeAt(px, pz) > 0.56) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    // ridges that touch merge into one shapeless mass; keep them apart so each
    // one reads as a separate landform
    if (zones.some((z) => distToSegment(cx, cz, z.x1, z.z1, z.x2, z.z2) < z.r + rad + 6)) continue;
    zones.push({ x1, z1, x2, z2, r: rad });
  }
  return zones;
}

// Distance to the nearest ridge surface: negative inside the core, growing
// outward. Drives the vegetation cutoff on the JS side; the terrain shader
// recomputes the same quantity from the same capsules.
export function rockZoneField(zones, x, z) {
  let best = Infinity;
  for (const zn of zones) {
    const d = distToSegment(x, z, zn.x1, zn.z1, zn.x2, zn.z2) - zn.r;
    if (d < best) best = d;
  }
  return best;
}
