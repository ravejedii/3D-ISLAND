import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Island } from './islands.js';
import { Bridge } from './bridges.js';
import { buildCastle, buildCourtyard, buildGateTorches } from './castle.js';
import { buildModularCastle, updateBanners } from './castle_modular.js';
import { placeModel } from '../core/assets.js';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { sharedToonRamp, painterlyGlobals } from '../render/painterly.js';
import { buildProps } from './props.js';
import { Sky } from './sky.js';
import { buildPond, buildWaterfall } from './water.js';
import { Ambient } from './ambient.js';
import { GrassField } from './grassfield.js';
import { buildRockZones, rockZoneField, MAX_ROCK_ZONES } from './zones.js';
import { RNG } from '../core/rng.js';

const SEED = 20260712;

// Hand-placed dirt paths: spawn -> castle gate, a fork to the west bridge,
// and a lane to the hamlet. Drawn per-fragment by the terrain shader and
// kept clear of grass and props, so the world reads as inhabited.
const PATH_SEGMENTS = [
  [0, 46, 1, 28],
  [1, 28, 4, 12],
  [4, 12, 1, -3], // castle gate
  [1, 28, -14, 14],
  [-14, 14, -34, -4],
  [-34, -4, -48, -16], // west bridge mouth
  [4, 12, 16, 15],
  [16, 15, 27, 19], // hamlet well
];

function distToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

export function pathDistance(x, z) {
  let d = Infinity;
  for (const [x1, z1, x2, z2] of PATH_SEGMENTS) {
    const s = distToSegment(x, z, x1, z1, x2, z2);
    if (s < d) d = s;
  }
  return d;
}

export class World {
  constructor(scene, models = {}, { cheapSky = false } = {}) {
    this.cheapSky = cheapSky;
    this.scene = scene;
    this.models = models;
    this.colliders = [];
    this.updatables = [];

    // --- island layout ---
    const castlePos = { x: 0, z: -18 };
    this.main = new Island({
      center: new THREE.Vector3(0, 0, 0),
      radius: 58,
      seed: SEED,
      amp: 4.5,
      base: 2.6,
      plateau: { x: castlePos.x, z: castlePos.z, radius: 28, height: 6.5 },
      pond: { x: 18, z: 26, radius: 7, depth: 1.6 },
      // fan the grid from flat meadow in the west — a fan near the castle
      // ramp draws lighting spokes across the approach
      gridOrigin: { x: -18, z: 26 },
      // dense enough that plateau slopes don't streak into radial slivers
      rings: 36,
      sectors: 104,
    });
    this.satellites = [
      new Island({ center: new THREE.Vector3(-95, 6, -34), radius: 26, seed: SEED + 7, amp: 4, base: 2.4, rings: 16, sectors: 48 }),
      new Island({ center: new THREE.Vector3(88, 10, -52), radius: 22, seed: SEED + 13, amp: 3.6, base: 2.2, rings: 14, sectors: 44 }),
      new Island({ center: new THREE.Vector3(64, -4, 74), radius: 24, seed: SEED + 21, amp: 4.2, base: 2.4, rings: 15, sectors: 44 }),
      new Island({ center: new THREE.Vector3(-72, 2, 66), radius: 19, seed: SEED + 33, amp: 3.2, base: 2, rings: 13, sectors: 40 }),
    ];
    this.islands = [this.main, ...this.satellites];

    // one merged mesh for all island terrain — stylized shader (CSM extends
    // MeshStandardMaterial, so shadows/env/SSAO still apply): clean color
    // blocking in a fixed palette + slope cliffs + painted dirt paths, with
    // collision staying purely analytic
    const terrainGeo = mergeGeometries(this.islands.map((i) => i.buildGeometry()));
    const terrainMat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshToonMaterial,
      vertexColors: true,
      // smooth normals: flat shading is what turned the landscape into a field
      // of visible green triangles. Landforms now read as sculpted surfaces and
      // the painted detail comes from the shader instead of the topology.
      flatShading: false,
      gradientMap: sharedToonRamp(),
      silent: true,
      uniforms: {
        ...painterlyGlobals,
        uCliff: { value: new THREE.Color(0x998772) },
        uPath: { value: new THREE.Color(0xc9a26a) },
        uPathSegs: { value: PATH_SEGMENTS.map(([a, b, c, d]) => new THREE.Vector4(a, b, c, d)) },
        // rock outcrop ridges — filled in below, once the zones have been
        // placed against the paths and landmarks they have to avoid
        uScree: { value: new THREE.Color(0xa39b90) },
        uSoil: { value: new THREE.Color(0x8b7050) },
        uRockZones: { value: Array.from({ length: MAX_ROCK_ZONES }, () => new THREE.Vector4(1e5, 1e5, 1e5, 1e5)) },
        uRockZoneR: { value: new Array(MAX_ROCK_ZONES).fill(0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWPos;
        varying vec3 vWNormal;
        void main() {
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * normal);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform vec3 uCliff;
        uniform vec3 uPath;
        uniform vec4 uPathSegs[8];
        uniform vec3 uScree;
        uniform vec3 uSoil;
        uniform vec4 uRockZones[8];
        uniform float uRockZoneR[8];
        float distSeg(vec2 p, vec2 a, vec2 b) {
          vec2 ab = b - a;
          float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
          return length(p - (a + ab * t));
        }
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
                     mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          // csm_DiffuseColor doesn't include vertex colors — read them directly
          vec3 base = vColor.rgb;
          // broad, smooth warm/cool drift across the meadow — a hue shift,
          // not a brightness multiply, so fields stay clean instead of muddy
          float macro = smoothstep(0.3, 0.8, vnoise(vWPos.xz * 0.028));
          base = mix(base, base * vec3(1.1, 1.04, 0.82), macro * 0.3);
          // Fine surface detail. With flat shading gone the topology no longer
          // supplies any texture, so the ground gets its structure here: two
          // octaves of grain plus a mid-scale patchiness that reads as worn
          // turf rather than a solid green fill.
          float grain = vnoise(vWPos.xz * 1.35) * 0.6 + vnoise(vWPos.xz * 4.1) * 0.4;
          base *= 0.92 + grain * 0.16;
          // steep faces become rock
          float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
          float rockMix = smoothstep(0.42, 0.62, slope);
          vec3 cliff = uCliff * (0.84 + vnoise(vWPos.xz * 0.35 + vWPos.y * 0.2) * 0.28);
          base = mix(base, cliff, rockMix * 0.85);
          vec2 p = vWPos.xz;
          // --- rock outcrop ridges -------------------------------------
          // Bedrock surfacing through the turf. These are the same capsules
          // props.js seeds boulders along, so scree always appears under
          // rocks and never on open lawn.
          float rz = 1e6;
          for (int i = 0; i < 8; i++) {
            rz = min(rz, distSeg(p, uRockZones[i].xy, uRockZones[i].zw) - uRockZoneR[i]);
          }
          // The capsule distance above is a handful of ALU ops, but the paint
          // below is six noise lookups, and the ridges cover a few percent of
          // the island. Gating on proximity keeps that cost off every other
          // terrain fragment — which matters: this shader is the single
          // biggest per-pixel cost on the software-rasterizer path, where the
          // frame-rate floor lives. The bound is the largest displacement the
          // wobble below can apply plus the paint's own falloff.
          if (rz < 7.5) {
            // three octaves of wobble turn a lozenge into an eroded outline
            // with fingers of loose stone running out of the ridge
            rz += (vnoise(p * 0.17 + 21.0) - 0.5) * 5.6
                + (vnoise(p * 0.58) - 0.5) * 2.0
                + (vnoise(p * 1.9) - 0.5) * 0.7;
            float outcrop = (1.0 - smoothstep(-1.2, 3.2, rz)) * (1.0 - rockMix);
            // the halo first: turf worn back to bare earth around the stone
            base = mix(base, uSoil * (0.90 + vnoise(p * 0.85) * 0.24), outcrop * 0.66);
            // then dry scree over the core. Two scales of grit plus a sparse
            // band of darker chips, so the ground under the boulders is
            // broken stone rather than a flat tan fill.
            float grit = vnoise(p * 2.9) * 0.55 + vnoise(p * 9.1) * 0.45;
            vec3 screeCol = uScree * (0.76 + grit * 0.48);
            screeCol = mix(screeCol, screeCol * 0.70, smoothstep(0.60, 0.88, vnoise(p * 5.5 + 3.0)) * 0.8);
            base = mix(base, screeCol, smoothstep(0.28, 0.95, outcrop) * 0.88);
          }
          // worn dirt paths, wobbled by noise so edges aren't ruler-straight
          float pd = 1e6;
          for (int i = 0; i < 8; i++) {
            pd = min(pd, distSeg(p, uPathSegs[i].xy, uPathSegs[i].zw));
          }
          pd += (vnoise(p * 0.55) - 0.5) * 0.9;
          // the track is a material, not a flat strip: base dirt with fine
          // gravel speckle, darker wheel ruts either side of the crown, and
          // sun-dried verges where the grass gives out before bare earth
          vec3 pathCol = uPath * (0.88 + vnoise(p * 1.7) * 0.24);
          float gravel = vnoise(p * 6.3) * 0.55 + vnoise(p * 14.0) * 0.45;
          pathCol *= 0.90 + gravel * 0.20;
          float rut = 1.0 - smoothstep(0.0, 0.16, abs(pd - 0.5));
          pathCol = mix(pathCol, pathCol * 0.78, rut * 0.8);
          float onPath = 1.0 - smoothstep(1.05, 1.55, pd);
          float verge = (1.0 - smoothstep(1.4, 2.7, pd)) * (1.0 - onPath);
          base = mix(base, base * vec3(1.08, 1.00, 0.66), verge * 0.5); // dry straw fringe
          float wornEdge = (1.0 - smoothstep(1.55, 2.6, pd)) * 0.18;
          base = mix(base, base * 0.9, wornEdge);        // trampled fringe
          base = mix(base, pathCol, onPath * (1.0 - rockMix));
          csm_DiffuseColor.rgb = base;
        }
      `,
    });
    this.terrain = new THREE.Mesh(terrainGeo, terrainMat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    scene.add(this.terrain);

    // --- bridges (main island -> each satellite) ---
    this.bridges = [];
    const bridgeWood = [];
    const bridgePlanks = [];
    const bridgeRopes = [];
    for (const sat of this.satellites) {
      const dir = new THREE.Vector3().subVectors(sat.center, this.main.center);
      dir.y = 0;
      dir.normalize();
      const aXZ = new THREE.Vector3(this.main.center.x, 0, this.main.center.z).addScaledVector(dir, this.main.radius * 0.9);
      const bXZ = new THREE.Vector3(sat.center.x, 0, sat.center.z).addScaledVector(dir, -sat.radius * 0.86);
      const a = new THREE.Vector3(aXZ.x, this.main.heightAt(aXZ.x, aXZ.z) + 0.05, aXZ.z);
      const b = new THREE.Vector3(bXZ.x, sat.heightAt(bXZ.x, bXZ.z) + 0.05, bXZ.z);
      const bridge = new Bridge(a, b, 2.6);
      this.bridges.push(bridge);
      const built = bridge.build();
      bridgePlanks.push(...built.plankGeos);
      bridgeWood.push(...built.woodGeo);
      bridgeRopes.push(...built.ropeGeos);
    }
    const plankMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeWoodTexture(), flatShading: true, roughness: 0.95 });
    const plankMesh = new THREE.Mesh(mergeGeometries(bridgePlanks), plankMat);
    plankMesh.castShadow = true;
    plankMesh.receiveShadow = true;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5e442c, flatShading: true, roughness: 0.95 });
    const woodMesh = new THREE.Mesh(mergeGeometries(bridgeWood), woodMat);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcbb489, roughness: 1 });
    const ropeMesh = new THREE.Mesh(mergeGeometries(bridgeRopes), ropeMat);
    scene.add(plankMesh, woodMesh, ropeMesh);

    // --- castle on the plateau: KayKit model, procedural keep as fallback ---
    this.castleCenter = new THREE.Vector3(castlePos.x, 6.5, castlePos.z);
    this.windowsMaterial = null;
    this.torchLight = null;
    this.torchFlames = [];
    // The model keep sits at the back of a walled bailey you can actually
    // walk into through the south gate.
    // Authored modular architecture first; the old primitive keep only appears
    // if the kit fails to load.
    const modular = buildModularCastle(models, { x: castlePos.x, z: castlePos.z, groundY: 6.45, groundAt: (px, pz) => this.main.heightAt(px, pz) });
    this.banners = [];
    if (modular) {
      scene.add(modular.group);
      this.colliders.push(...modular.colliders);
      this.banners = modular.banners;
      const torches = buildGateTorches({ x: castlePos.x, y: 6.45, z: modular.gateZ - 1.4, spread: 4.2 });
      scene.add(torches.group);
      this.torchLight = torches.light;
      this.torchFlames = torches.flames;
    } else {
      const castle = buildCastle({ x: castlePos.x, z: castlePos.z, groundY: 6.5 });
      scene.add(castle.group);
      this.colliders.push(...castle.colliders);
      this.windowsMaterial = castle.windowsMaterial;
      this.torchLight = castle.torchLight;
      this.torchFlames = castle.flames;
    }

    // --- hamlet + satellite landmarks (model-only garnish) ---
    this.buildingSpots = [];
    const buildingPlan = [
      { gltf: models.homeA, x: 30, z: 12, scale: 4.4, rotY: 2.6, shrink: 0.8 },
      { gltf: models.homeB, x: 36, z: 21, scale: 4.4, rotY: -2.2, shrink: 0.8 },
      { gltf: models.hamletWell, x: 29.5, z: 19, scale: 3.2, rotY: 0.6, shrink: 0.85 },
      { gltf: models.windmill, isl: 1, dx: 2, dz: 3, scale: 6, rotY: 2.4, shrink: 0.6 },
      { gltf: models.hamletTower, isl: 0, dx: 6, dz: 5, scale: 5, rotY: 1.2, shrink: 0.7 },
    ];
    for (const b of buildingPlan) {
      if (!b.gltf) continue;
      const bx = b.isl !== undefined ? this.satellites[b.isl].center.x + b.dx : b.x;
      const bz = b.isl !== undefined ? this.satellites[b.isl].center.z + b.dz : b.z;
      const ground = this.groundHeightIslands(bx, bz);
      if (!isFinite(ground)) continue;
      const placed = placeModel(b.gltf, { x: bx, z: bz, y: ground - 0.1, scale: b.scale, rotY: b.rotY, colliderShrink: b.shrink });
      scene.add(placed.model);
      this.colliders.push(...placed.colliders);
      this.buildingSpots.push({ x: bx, z: bz, r: 3.2 * (b.scale / 4.4) });
    }

    // --- pond + waterfalls ---
    const pondY = this.main.heightAt(18, 26) + 0.55;
    const pond = buildPond({ x: 18, z: 26, y: pondY, radius: 6.4 });
    scene.add(pond.mesh);
    this.updatables.push((dt, t) => (pond.uniforms.uTime.value = t));

    const fallSpots = [
      { isl: this.satellites[0], angle: 2.4 },
      { isl: this.satellites[2], angle: -0.6 },
      { isl: this.main, angle: 1.05 },
    ];
    for (const { isl, angle } of fallSpots) {
      const fx = isl.center.x + Math.cos(angle) * isl.radius * 0.97;
      const fz = isl.center.z + Math.sin(angle) * isl.radius * 0.97;
      const fall = buildWaterfall({ x: fx, y: isl.center.y + 0.6, z: fz, angle: -angle + Math.PI / 2, width: 4.2, height: 34 });
      scene.add(fall.mesh);
      this.updatables.push((dt, t) => fall.update(t));
    }

    // --- props (keep clear of castle, pond, buildings, bridge mouths, spawn) ---
    const clearZones = [
      { x: castlePos.x, z: castlePos.z, r: 21 },
      { x: 18, z: 26, r: 9.5 },
      { x: 0, z: 44, r: 5 }, // spawn
      ...this.buildingSpots.map((b) => ({ x: b.x, z: b.z, r: b.r + 2 })),
    ];
    for (const br of this.bridges) {
      clearZones.push({ x: br.a.x, z: br.a.z, r: 6 });
      clearZones.push({ x: br.b.x, z: br.b.z, r: 6 });
    }
    const exclude = (x, z) => clearZones.every((c) => Math.hypot(x - c.x, z - c.z) > c.r)
      && pathDistance(x, z) > 2.4;

    // --- crystals ---
    // Built before the props so the outcrop zones below can be kept off them:
    // the e2e run walks into every crystal, and a boulder field around one is
    // a thing to get wedged on.
    this.crystals = this.buildCrystals();

    // --- terrain zoning: rock outcrop ridges ---
    // The meadow was one continuous green from rim to rim. These ridges are
    // the geology that breaks it. They are deliberately kept well off the
    // painted paths (which are also the walking routes), off the castle
    // plateau, and off every crystal.
    const zoneOK = (x, z, r) => pathDistance(x, z) > r + 6
      && clearZones.every((c) => Math.hypot(x - c.x, z - c.z) > c.r + r + 2)
      && this.crystals.every((c) => Math.hypot(x - c.x, z - c.z) > r + 5);
    // seed chosen from a scan of the constraint set: it is the one that places
    // six ridges with real spread across the island AND puts one across the
    // castle approach, where the meadow was most obviously empty
    this.rockZones = buildRockZones({ island: this.main, seed: SEED + 531, ok: zoneOK });
    for (let i = 0; i < this.rockZones.length; i++) {
      const zn = this.rockZones[i];
      terrainMat.uniforms.uRockZones.value[i].set(zn.x1, zn.z1, zn.x2, zn.z2);
      terrainMat.uniforms.uRockZoneR.value[i] = zn.r;
    }
    // vegetation stops at the scree line — grass growing out of bare rock is
    // exactly the "sprinkled props" read this pass exists to remove
    const excludeVeg = (x, z) => exclude(x, z) && rockZoneField(this.rockZones, x, z) > 1.0;

    const props = buildProps(this.islands, {
      seed: SEED + 99, exclude, excludeVeg, rockZones: this.rockZones, models,
    });
    scene.add(props.group);
    this.colliders.push(...props.colliders);
    this.updatables.push((dt, t) => (props.windTime.value = t));

    // dense shader grass on the main island meadows (quality-gated in main.js)
    this.grassField = new GrassField(scene, this.main, excludeVeg);
    this.updatables.push((dt, t) => this.grassField.update(t, this.scene.fog));

    // --- sky ---
    this.sky = new Sky(scene, { cheap: cheapSky });

    // --- ambient life: fireflies, pollen, birds ---
    this.ambient = new Ambient(scene, this);

    this.spawn = new THREE.Vector3(0, this.main.heightAt(0, 44) + 2, 44);
  }

  buildCrystals() {
    const rng = new RNG(SEED + 500);
    // polar (island, angle, radiusFrac); one is inside the keep
    // First crystal waits inside the castle courtyard, past the gate.
    // Inside the bailey, past the gate: clear of the keep (which sits at the
    // north end) and of the well, so it stays collectable once the modular
    // castle's colliders are in place.
    const keepSpot = { isl: this.main, x: -5.5, z: -12 };
    const spots = [
      keepSpot,
      { isl: this.main, a: 0.6, f: 0.62 },
      { isl: this.main, a: 2.8, f: 0.7 },
      { isl: this.main, a: 4.2, f: 0.55 },
      { isl: this.satellites[0], a: 1.1, f: 0.4 },
      { isl: this.satellites[0], a: 3.9, f: 0.62 },
      { isl: this.satellites[1], a: 0.4, f: 0.5 },
      { isl: this.satellites[2], a: 2.2, f: 0.45 },
      { isl: this.satellites[2], a: 5.1, f: 0.66 },
      { isl: this.satellites[3], a: 1.9, f: 0.4 },
    ];
    const crystals = [];
    for (const s of spots) {
      const x = s.x !== undefined ? s.x : s.isl.center.x + Math.cos(s.a) * s.isl.radius * s.f;
      const z = s.z !== undefined ? s.z : s.isl.center.z + Math.sin(s.a) * s.isl.radius * s.f;
      const y = s.isl.heightAt(x, z) + 1.25;
      const hue = 0.48 + rng.range(-0.1, 0.22);
      const color = new THREE.Color().setHSL(hue, 0.85, 0.6);
      crystals.push({ x, z, baseY: y, groundY: s.isl.heightAt(x, z), color, collected: false, phase: rng.range(0, Math.PI * 2) });
    }
    this.crystalField = new CrystalField(this.scene, crystals);
    return crystals;
  }

  // island-only ground height (no bridges) — used to seat buildings
  groundHeightIslands(x, z) {
    let g = -Infinity;
    for (const isl of this.islands) {
      const h = isl.heightAt(x, z);
      if (h > g) g = h;
    }
    return g;
  }

  // ground height under (x, z): islands + bridges. -Infinity over the void.
  groundHeight(x, z) {
    let g = -Infinity;
    for (const isl of this.islands) {
      const h = isl.heightAt(x, z);
      if (h > g) g = h;
    }
    for (const br of this.bridges) {
      const h = br.heightAt(x, z);
      if (h > g) g = h;
    }
    return g;
  }

  bridgeAt(x, z, y) {
    for (const br of this.bridges) {
      const h = br.heightAt(x, z);
      if (h > -Infinity && Math.abs(h - y) < 1.2) return br;
    }
    return null;
  }

  update(dt, elapsed, playerPos) {
    if (this.banners && this.banners.length) updateBanners(this.banners, elapsed);
    this.sky.update(dt, playerPos);
    for (const u of this.updatables) u(dt, elapsed);
    const nightF = this.sky.nightFactor;
    if (this.windowsMaterial) this.windowsMaterial.emissiveIntensity = nightF * 2.2;
    if (this.torchLight) {
      const flicker = 0.86 + 0.09 * Math.sin(elapsed * 13) + 0.05 * Math.sin(elapsed * 29 + 1.7);
      this.torchLight.intensity = (2 + nightF * 26) * flicker;
      for (const f of this.torchFlames) {
        f.scale.set(0.62 + 0.1 * Math.sin(elapsed * 11 + f.position.x), 1.0 + 0.16 * flicker, 1);
      }
    }
    this.ambient.update(dt, elapsed, nightF);
    this.crystalField.update(elapsed, this.crystals);
  }
}

// All 10 crystals in 4 draw calls: instanced shells/cores/rings + one glow Points.
class CrystalField {
  constructor(scene, crystals) {
    const n = crystals.length;
    const shellGeo = new THREE.OctahedronGeometry(0.55, 0);
    shellGeo.scale(1, 1.8, 1);
    const coreGeo = new THREE.OctahedronGeometry(0.26, 0);
    coreGeo.scale(1, 1.9, 1);
    const ringGeo = new THREE.RingGeometry(0.55, 1.05, 24);
    ringGeo.rotateX(-Math.PI / 2);

    this.shells = new THREE.InstancedMesh(shellGeo, new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55,
      emissive: 0xffffff, emissiveIntensity: 0.35, depthWrite: false,
    }), n);
    this.cores = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }), n);

    const glowGeo = new THREE.BufferGeometry();
    this.glowPos = new Float32Array(n * 3);
    const glowCol = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = crystals[i];
      this.glowPos.set([c.x, c.baseY, c.z], i * 3);
      glowCol.set([c.color.r, c.color.g, c.color.b], i * 3);
      this.shells.setColorAt(i, c.color);
      this.cores.setColorAt(i, new THREE.Color().copy(c.color).lerp(new THREE.Color(0xffffff), 0.65));
      this.rings.setColorAt(i, c.color);
    }
    glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
    this.glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({
      map: makeGlowTexture(), vertexColors: true, size: 3.4, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.glow.frustumCulled = false;

    for (const m of [this.shells, this.cores, this.rings]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    scene.add(this.shells, this.cores, this.rings, this.glow);
    this._dummy = new THREE.Object3D();
  }

  update(elapsed, crystals) {
    const d = this._dummy;
    for (let i = 0; i < crystals.length; i++) {
      const c = crystals[i];
      if (c.collected) continue;
      const bob = Math.sin(elapsed * 1.6 + c.phase) * 0.25;
      const y = c.baseY + bob;
      d.position.set(c.x, y, c.z);
      d.rotation.set(0, elapsed * 1.2 + c.phase, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.shells.setMatrixAt(i, d.matrix);
      d.rotation.y = -elapsed * 2.1 + c.phase;
      d.updateMatrix();
      this.cores.setMatrixAt(i, d.matrix);
      const pulse = 0.85 + 0.2 * Math.sin(elapsed * 2.2 + c.phase);
      d.position.set(c.x, c.groundY + 0.06, c.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(pulse);
      d.updateMatrix();
      this.rings.setMatrixAt(i, d.matrix);
      this.glowPos[i * 3 + 1] = y;
    }
    this.shells.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
  }

  setCollected(i, collected, crystal) {
    const d = this._dummy;
    d.position.set(crystal.x, collected ? -999 : crystal.baseY, crystal.z);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(collected ? 0.0001 : 1);
    d.updateMatrix();
    this.shells.setMatrixAt(i, d.matrix);
    this.cores.setMatrixAt(i, d.matrix);
    this.rings.setMatrixAt(i, d.matrix);
    this.glowPos[i * 3 + 1] = collected ? -999 : crystal.baseY;
    this.shells.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
  }
}

function makeWoodTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8a6a45';
  ctx.fillRect(0, 0, size, size);
  const rng = new RNG(414);
  // grain streaks along x
  for (let i = 0; i < 46; i++) {
    const y = rng.range(0, size);
    const alpha = rng.range(0.05, 0.22);
    const light = rng.next() > 0.6;
    ctx.strokeStyle = light ? `rgba(190,150,105,${alpha})` : `rgba(70,50,32,${alpha})`;
    ctx.lineWidth = rng.range(0.6, 2.4);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * rng.range(0.5, 2));
    }
    ctx.stroke();
  }
  // a few knots
  for (let i = 0; i < 3; i++) {
    const kx = rng.range(10, size - 10);
    const ky = rng.range(10, size - 10);
    ctx.strokeStyle = 'rgba(60,42,26,0.5)';
    ctx.lineWidth = 1.2;
    for (let r = 2; r < 7; r += 2) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
