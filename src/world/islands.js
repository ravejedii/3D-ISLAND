import * as THREE from 'three';
import { fbm, hash2, clamp, lerp, smoothstep } from '../core/rng.js';

// A floating island: analytic heightfield (shared by mesh + collision) with a
// rocky skirt hanging below it. `heightAt` returns -Infinity outside the rim.
export class Island {
  constructor({
    center = new THREE.Vector3(),
    radius = 40,
    seed = 1,
    amp = 5,
    base = 2.5,
    noiseScale = 0.045,
    plateau = null, // { x, z, radius, height } in world coords, height relative to center.y
    pond = null, // { x, z, radius, depth } in world coords
    rings = 22,
    sectors = 64,
  }) {
    this.center = center;
    this.radius = radius;
    this.seed = seed;
    this.amp = amp;
    this.base = base;
    this.noiseScale = noiseScale;
    this.plateau = plateau;
    this.pond = pond;
    this.rings = rings;
    this.sectors = sectors;
  }

  contains(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }

  heightAt(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    const d = Math.sqrt(dx * dx + dz * dz) / this.radius;
    if (d >= 1) return -Infinity;
    const falloff = 1 - smoothstep(0.55, 1.0, d);
    const n = fbm(x * this.noiseScale, z * this.noiseScale, this.seed, 4);
    let h = (this.base + n * this.amp) * falloff;
    // Gentle dome so the middle sits higher than the rim
    h += (1 - d * d) * this.base * 0.6;

    if (this.plateau) {
      const p = this.plateau;
      const pd = Math.hypot(x - p.x, z - p.z);
      const blend = 1 - smoothstep(p.radius * 0.8, p.radius * 1.35, pd);
      h = lerp(h, p.height, blend);
    }
    if (this.pond) {
      const p = this.pond;
      const pd = Math.hypot(x - p.x, z - p.z);
      const blend = 1 - smoothstep(p.radius * 0.55, p.radius * 1.3, pd);
      h -= p.depth * blend;
    }
    return h + this.center.y;
  }

  // Approximate slope magnitude via finite differences
  slopeAt(x, z) {
    const e = 0.6;
    const h0 = this.heightAt(x, z);
    const hx = this.heightAt(x + e, z);
    const hz = this.heightAt(x, z + e);
    if (!isFinite(h0) || !isFinite(hx) || !isFinite(hz)) return Infinity;
    return Math.hypot((hx - h0) / e, (hz - h0) / e);
  }

  buildGeometry() {
    const { rings, sectors } = this;
    const positions = [];
    const colors = [];
    const indices = [];
    const col = new THREE.Color();

    const grass = new THREE.Color(0x7aa758);
    const grassDark = new THREE.Color(0x5a8a4a);
    const dirt = new THREE.Color(0xa5854f);
    const stone = new THREE.Color(0x958f86);
    const rimRock = new THREE.Color(0x8f7a62);

    // --- top surface: radial grid with a center fan ---
    const topH = this.heightAt(this.center.x, this.center.z);
    positions.push(this.center.x, topH, this.center.z);
    this.colorForSurface(this.center.x, this.center.z, 0, col, { grass, grassDark, dirt, stone, rimRock });
    colors.push(col.r, col.g, col.b);

    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      const r = this.radius * Math.pow(t, 0.85); // denser toward the middle
      for (let j = 0; j < sectors; j++) {
        const a = (j / sectors) * Math.PI * 2;
        const jitter = (hash2(i * 91 + j, this.seed, 7) - 0.5) * (this.radius / rings) * 0.6 * (i < rings ? 1 : 0);
        const rr = r + jitter;
        const x = this.center.x + Math.cos(a) * rr;
        const z = this.center.z + Math.sin(a) * rr;
        const y = i === rings ? this.center.y : this.heightAt(x, z);
        positions.push(x, y, z);
        this.colorForSurface(x, z, t, col, { grass, grassDark, dirt, stone, rimRock });
        colors.push(col.r, col.g, col.b);
      }
    }
    const ringStart = (i) => 1 + (i - 1) * sectors;
    // center fan
    for (let j = 0; j < sectors; j++) {
      indices.push(0, ringStart(1) + ((j + 1) % sectors), ringStart(1) + j);
    }
    for (let i = 1; i < rings; i++) {
      const a0 = ringStart(i);
      const b0 = ringStart(i + 1);
      for (let j = 0; j < sectors; j++) {
        const j1 = (j + 1) % sectors;
        indices.push(a0 + j, b0 + j1, b0 + j);
        indices.push(a0 + j, a0 + j1, b0 + j1);
      }
    }

    // --- skirt: rim spirals down to a tip ---
    const skirtRings = 9;
    const depth = this.radius * 1.05;
    const rockA = new THREE.Color(0x6e655c);
    const rockB = new THREE.Color(0x4e463f);
    const skirtStart = positions.length / 3;
    for (let k = 0; k <= skirtRings; k++) {
      const t = k / skirtRings;
      const shrink = Math.pow(1 - t, 1.35);
      for (let j = 0; j < sectors; j++) {
        const a = (j / sectors) * Math.PI * 2;
        const wob = 1 + (hash2(j * 13 + k * 57, this.seed, 21) - 0.5) * 0.55 * Math.sin(t * Math.PI);
        const r = Math.max(this.radius * shrink * wob, 0.001);
        const x = this.center.x + Math.cos(a) * r;
        const z = this.center.z + Math.sin(a) * r;
        const y = this.center.y - depth * Math.pow(t, 1.25) + (hash2(j * 5 + k * 31, this.seed, 33) - 0.5) * 2.2 * Math.sin(t * Math.PI);
        positions.push(x, y, z);
        const m = hash2(j * 3 + k * 17, this.seed, 44);
        col.copy(rockA).lerp(rockB, t * 0.8 + m * 0.35);
        if (m > 0.82) col.lerp(new THREE.Color(0x9a7b52), 0.5); // dirt strata
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let k = 0; k < skirtRings; k++) {
      const a0 = skirtStart + k * sectors;
      const b0 = skirtStart + (k + 1) * sectors;
      for (let j = 0; j < sectors; j++) {
        const j1 = (j + 1) % sectors;
        indices.push(a0 + j, b0 + j, b0 + j1);
        indices.push(a0 + j, b0 + j1, a0 + j1);
      }
    }

    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo = geo.toNonIndexed(); // faceted low-poly shading
    geo.computeVertexNormals();
    return geo;
  }

  colorForSurface(x, z, t, out, pal) {
    const slope = this.slopeAt(x, z);
    const n = fbm(x * 0.11 + 40, z * 0.11 - 17, this.seed + 5, 3);
    out.copy(pal.grass).lerp(pal.grassDark, clamp(n * 0.5 + 0.5, 0, 1));
    // warm meadow patches so the grass reads less uniform
    const meadow = fbm(x * 0.028 - 90, z * 0.028 + 55, this.seed + 11, 2);
    if (meadow > 0.1) out.lerp(new THREE.Color(0x9cab5c), clamp((meadow - 0.1) * 2.2, 0, 0.5));
    if (n > 0.42) out.lerp(pal.dirt, 0.55);
    // cheap baked AO: darken concavities (height below the local average)
    const e = 2.6;
    const h0 = this.heightAt(x, z);
    if (isFinite(h0)) {
      const avg = (this.heightAt(x + e, z) + this.heightAt(x - e, z) + this.heightAt(x, z + e) + this.heightAt(x, z - e)) / 4;
      if (isFinite(avg)) {
        const cavity = clamp((avg - h0) * 0.55, 0, 0.35);
        out.multiplyScalar(1 - cavity);
      }
    }
    if (isFinite(slope) && slope > 0.38) out.lerp(pal.stone, clamp((slope - 0.38) * 2.2, 0, 1));
    if (t > 0.86) out.lerp(pal.rimRock, smoothstep(0.86, 1.0, t));
    if (this.pond) {
      const pd = Math.hypot(x - this.pond.x, z - this.pond.z);
      if (pd < this.pond.radius * 1.35) {
        out.lerp(new THREE.Color(0xc9b57e), 1 - smoothstep(this.pond.radius * 0.7, this.pond.radius * 1.35, pd)); // sandy shore
      }
    }
  }
}
