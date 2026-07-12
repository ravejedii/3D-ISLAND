import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Ambient life: fireflies at night, drifting pollen by day, and a small flock
// of birds circling the main island. Three draw calls total.

function makeDotTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.4)') {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, mid);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Ambient {
  constructor(scene, world) {
    this.world = world;
    const rng = new RNG(77);

    // --- fireflies (meadow + pond area, night only) ---
    this.fireflyCount = 70;
    this.fireflySeeds = [];
    const fpos = new Float32Array(this.fireflyCount * 3);
    for (let i = 0; i < this.fireflyCount; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 44;
      const x = 8 + Math.cos(a) * r;
      const z = 22 + Math.sin(a) * r;
      const g = world.groundHeight(x, z);
      const y = (isFinite(g) ? g : 2) + rng.range(0.5, 2.6);
      this.fireflySeeds.push({ x, y, z, p1: rng.range(0, 6.28), p2: rng.range(0, 6.28), s: rng.range(0.4, 1.1) });
      fpos.set([x, y, z], i * 3);
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      map: makeDotTexture('rgba(255,250,180,1)', 'rgba(200,255,120,0.5)'),
      color: 0xd8ff9a, size: 0.55, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.fireflies = new THREE.Points(fgeo, this.fireflyMat);
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);

    // --- pollen / floating sparkles (day) ---
    this.pollenCount = 90;
    this.pollenSeeds = [];
    const ppos = new Float32Array(this.pollenCount * 3);
    for (let i = 0; i < this.pollenCount; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 52;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const g = world.groundHeight(x, z);
      const y = (isFinite(g) ? g : 2) + rng.range(0.8, 5);
      this.pollenSeeds.push({ x, y, z, p1: rng.range(0, 6.28), s: rng.range(0.2, 0.7) });
      ppos.set([x, y, z], i * 3);
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    this.pollenMat = new THREE.PointsMaterial({
      map: makeDotTexture(),
      color: 0xfff6d8, size: 0.28, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.pollen = new THREE.Points(pgeo, this.pollenMat);
    this.pollen.frustumCulled = false;
    scene.add(this.pollen);

    // --- birds: simple stretched-V silhouettes circling high up ---
    const birdGeo = new THREE.BufferGeometry();
    // two wing triangles meeting at the body
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.25, -1.1, 0.18, -0.25, 0, 0.05, -0.15,
      0, 0, 0.25, 0, 0.05, -0.15, 1.1, 0.18, -0.25,
    ], 3));
    birdGeo.computeVertexNormals();
    this.birdCount = 7;
    this.birds = new THREE.InstancedMesh(
      birdGeo,
      new THREE.MeshBasicMaterial({ color: 0x2b3242, side: THREE.DoubleSide }),
      this.birdCount,
    );
    this.birds.frustumCulled = false;
    this.birdSeeds = [];
    for (let i = 0; i < this.birdCount; i++) {
      this.birdSeeds.push({
        r: rng.range(45, 85),
        h: rng.range(26, 44),
        speed: rng.range(0.1, 0.18) * (rng.next() > 0.3 ? 1 : -1),
        phase: rng.range(0, Math.PI * 2),
        flap: rng.range(4, 7),
        scale: rng.range(0.8, 1.3),
      });
    }
    scene.add(this.birds);
    this._dummy = new THREE.Object3D();
  }

  update(dt, t, nightFactor) {
    // fireflies wander and blink
    this.fireflyMat.opacity = Math.max(0, nightFactor - 0.25) * 1.3;
    if (this.fireflyMat.opacity > 0.01) {
      const pos = this.fireflies.geometry.attributes.position;
      for (let i = 0; i < this.fireflyCount; i++) {
        const s = this.fireflySeeds[i];
        pos.setXYZ(
          i,
          s.x + Math.sin(t * s.s + s.p1) * 1.6,
          s.y + Math.sin(t * s.s * 1.4 + s.p2) * 0.8,
          s.z + Math.cos(t * s.s * 0.8 + s.p2) * 1.6,
        );
      }
      pos.needsUpdate = true;
    }

    // pollen drifts on the wind
    this.pollenMat.opacity = Math.max(0, 0.75 - nightFactor) * 0.5;
    if (this.pollenMat.opacity > 0.01) {
      const pos = this.pollen.geometry.attributes.position;
      for (let i = 0; i < this.pollenCount; i++) {
        const s = this.pollenSeeds[i];
        pos.setXYZ(
          i,
          s.x + Math.sin(t * s.s * 0.5 + s.p1) * 3 + t * 0.15 % 4,
          s.y + Math.sin(t * s.s + s.p1 * 2) * 0.6,
          s.z + Math.cos(t * s.s * 0.4 + s.p1) * 3,
        );
      }
      pos.needsUpdate = true;
    }

    // birds circle and flap; they roost at night
    this.birds.visible = nightFactor < 0.6;
    if (this.birds.visible) {
      for (let i = 0; i < this.birdCount; i++) {
        const s = this.birdSeeds[i];
        const a = t * s.speed + s.phase;
        const dir = Math.sign(s.speed);
        this._dummy.position.set(Math.cos(a) * s.r, s.h + Math.sin(t * 0.5 + s.phase) * 2, Math.sin(a) * s.r - 10);
        this._dummy.rotation.set(0, -a - dir * Math.PI / 2, Math.sin(t * s.flap) * 0.45);
        const flapStretch = 0.75 + 0.25 * Math.abs(Math.cos(t * s.flap));
        this._dummy.scale.set(s.scale * flapStretch, s.scale, s.scale);
        this._dummy.updateMatrix();
        this.birds.setMatrixAt(i, this._dummy.matrix);
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
  }
}
