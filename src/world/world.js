import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Island } from './islands.js';
import { Bridge } from './bridges.js';
import { buildCastle } from './castle.js';
import { buildProps } from './props.js';
import { Sky } from './sky.js';
import { buildPond, buildWaterfall } from './water.js';
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
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, flatShading: true, roughness: 0.95 });
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
      this.updatables.push((dt, t) => (fall.uniforms.uTime.value = t));
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

    // --- crystals ---
    this.crystals = this.buildCrystals();

    // --- sky ---
    this.sky = new Sky(scene);

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
    const geo = new THREE.OctahedronGeometry(0.55, 0);
    geo.scale(1, 1.8, 1);
    const crystals = [];
    const group = new THREE.Group();
    const spriteMap = makeGlowTexture();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const x = s.x !== undefined ? s.x : s.isl.center.x + Math.cos(s.a) * s.isl.radius * s.f;
      const z = s.z !== undefined ? s.z : s.isl.center.z + Math.sin(s.a) * s.isl.radius * s.f;
      const y = s.isl.heightAt(x, z) + 1.25;
      const hue = 0.48 + rng.range(-0.1, 0.22);
      const color = new THREE.Color().setHSL(hue, 0.85, 0.6);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap, color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.setScalar(3.2);
      sprite.position.copy(mesh.position);
      group.add(mesh, sprite);
      crystals.push({ mesh, sprite, baseY: y, collected: false, phase: rng.range(0, Math.PI * 2) });
    }
    this.scene.add(group);
    this.crystalGroup = group;
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
    if (this.windowsMaterial) this.windowsMaterial.emissiveIntensity = this.sky.nightFactor * 2.2;
    for (const c of this.crystals) {
      if (c.collected) continue;
      c.mesh.rotation.y += dt * 1.2;
      const bob = Math.sin(elapsed * 1.6 + c.phase) * 0.25;
      c.mesh.position.y = c.baseY + bob;
      c.sprite.position.y = c.mesh.position.y;
      c.sprite.material.opacity = 0.35 + 0.2 * Math.sin(elapsed * 2.2 + c.phase);
    }
  }
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
