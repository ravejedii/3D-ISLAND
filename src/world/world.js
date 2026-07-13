import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Island } from './islands.js';
import { Bridge } from './bridges.js';
import { buildCastle } from './castle.js';
import { buildProps } from './props.js';
import { Sky } from './sky.js';
import { buildPond, buildWaterfall } from './water.js';
import { Ambient } from './ambient.js';
import { RNG } from '../core/rng.js';

const SEED = 20260712;

export class World {
  constructor(scene) {
    this.scene = scene;
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
      plateau: { x: castlePos.x, z: castlePos.z, radius: 20, height: 6.5 },
      pond: { x: 18, z: 26, radius: 7, depth: 1.6 },
      rings: 26,
      sectors: 80,
    });
    this.satellites = [
      new Island({ center: new THREE.Vector3(-95, 6, -34), radius: 26, seed: SEED + 7, amp: 4, base: 2.4, rings: 16, sectors: 48 }),
      new Island({ center: new THREE.Vector3(88, 10, -52), radius: 22, seed: SEED + 13, amp: 3.6, base: 2.2, rings: 14, sectors: 44 }),
      new Island({ center: new THREE.Vector3(64, -4, 74), radius: 24, seed: SEED + 21, amp: 4.2, base: 2.4, rings: 15, sectors: 44 }),
      new Island({ center: new THREE.Vector3(-72, 2, 66), radius: 19, seed: SEED + 33, amp: 3.2, base: 2, rings: 13, sectors: 40 }),
    ];
    this.islands = [this.main, ...this.satellites];

    // one merged mesh for all island terrain
    const terrainGeo = mergeGeometries(this.islands.map((i) => i.buildGeometry()));
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
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

    // --- castle on the plateau ---
    this.castleCenter = new THREE.Vector3(castlePos.x, 6.5, castlePos.z);
    const castle = buildCastle({ x: castlePos.x, z: castlePos.z, groundY: 6.5 });
    scene.add(castle.group);
    this.colliders.push(...castle.colliders);
    this.windowsMaterial = castle.windowsMaterial;
    this.torchLight = castle.torchLight;
    this.torchFlames = castle.flames;

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

    // --- props (keep clear of castle, pond, bridge mouths, spawn) ---
    const clearZones = [
      { x: castlePos.x, z: castlePos.z, r: 21 },
      { x: 18, z: 26, r: 9.5 },
      { x: 0, z: 44, r: 5 }, // spawn
    ];
    for (const br of this.bridges) {
      clearZones.push({ x: br.a.x, z: br.a.z, r: 6 });
      clearZones.push({ x: br.b.x, z: br.b.z, r: 6 });
    }
    const exclude = (x, z) => clearZones.every((c) => Math.hypot(x - c.x, z - c.z) > c.r);
    const props = buildProps(this.islands, { seed: SEED + 99, exclude });
    scene.add(props.group);
    this.colliders.push(...props.colliders);
    this.updatables.push((dt, t) => (props.windTime.value = t));

    // --- crystals ---
    this.crystals = this.buildCrystals();

    // --- sky ---
    this.sky = new Sky(scene);

    // --- ambient life: fireflies, pollen, birds ---
    this.ambient = new Ambient(scene, this);

    this.spawn = new THREE.Vector3(0, this.main.heightAt(0, 44) + 2, 44);
  }

  buildCrystals() {
    const rng = new RNG(SEED + 500);
    // polar (island, angle, radiusFrac); one is inside the keep
    const spots = [
      { isl: this.main, x: this.castleCenter.x, z: this.castleCenter.z - 18 * 0.35 }, // keep interior
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
