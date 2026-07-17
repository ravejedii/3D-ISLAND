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
    gridOrigin = null, // where the radial grid fans from (default: center) —
    // park it on flat ground, because sliver triangles at the fan turn any
    // height gradient into radial lighting spokes
  }) {
    this.center = center;
    this.gox = gridOrigin ? gridOrigin.x : center.x;
    this.goz = gridOrigin ? gridOrigin.z : center.z;
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
    let h = this.rawHeight(x, z, d);
    // near the grid's fan origin, blend to the local tangent plane so the
    // sliver triangles there share one normal (no lighting spokes)
    const gd = Math.hypot(x - this.gox, z - this.goz) / this.radius;
    if (gd < 0.14) {
      const e = 2.0;
      const od = Math.hypot(this.gox - this.center.x, this.goz - this.center.z) / this.radius;
      const hC = this.rawHeight(this.gox, this.goz, od);
      const gx = (this.rawHeight(this.gox + e, this.goz, od) - hC) / e;
      const gz = (this.rawHeight(this.gox, this.goz + e, od) - hC) / e;
      const plane = hC + gx * (x - this.gox) + gz * (z - this.goz);
      h = lerp(plane, h, smoothstep(0.05, 0.14, gd));
    }
    return h;
  }

  rawHeight(x, z, d) {
    const falloff = 1 - smoothstep(0.55, 1.0, d);
    // calm the noise near the grid's fan origin: sliver triangles there turn
    // any height variation into radial lighting spokes
    const gd = Math.hypot(x - this.gox, z - this.goz) / this.radius;
    const n = fbm(x * this.noiseScale, z * this.noiseScale, this.seed, 4) * smoothstep(0.02, 0.14, gd);
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

    const grass = new THREE.Color(0x77bb4f);
    const grassDark = new THREE.Color(0x4d9448);
    const dirt = new THREE.Color(0xb08f57);
    const stone = new THREE.Color(0x968b7a);
    const rimRock = new THREE.Color(0x94805f);

    // --- top surface: radial grid fanning from gridOrigin ---
    // Rings interpolate between the fan origin and the exact rim circle, so
    // the origin can sit on flat ground while the rim still welds to the skirt.
    const topH = this.heightAt(this.gox, this.goz);
    positions.push(this.gox, topH, this.goz);
    this.colorForSurface(this.gox, this.goz, 0, col, { grass, grassDark, dirt, stone, rimRock });
    colors.push(col.r, col.g, col.b);

    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      const f = Math.pow(t, 0.85); // denser toward the fan origin
      for (let j = 0; j < sectors; j++) {
        // stagger alternate rings half a sector so triangles stay close to
        // equilateral instead of degenerating into radial slivers
        // (the rim ring stays aligned — the skirt welds to it)
        const a = ((j + (i < rings ? (i % 2) * 0.5 : 0)) / sectors) * Math.PI * 2;
        const rimX = this.center.x + Math.cos(a) * this.radius;
        const rimZ = this.center.z + Math.sin(a) * this.radius;
        const dirX = rimX - this.gox;
        const dirZ = rimZ - this.goz;
        const len = Math.hypot(dirX, dirZ);
        const jitter = (hash2(i * 91 + j, this.seed, 7) - 0.5) * (len / rings) * 0.6 * (i < rings ? 1 : 0);
        const ff = f + jitter / len;
        const x = this.gox + dirX * ff;
        const z = this.goz + dirZ * ff;
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
    // the radial grid fans into sliver triangles at the island center, so any
    // per-vertex variation there interpolates into visible spokes — fade all
    // noise terms to plain grass near the fan
    const damp = smoothstep(0.03, 0.16, t);
    const n = fbm(x * 0.11 + 40, z * 0.11 - 17, this.seed + 5, 3);
    out.copy(pal.grass).lerp(pal.grassDark, clamp(n * 0.5 + 0.5, 0, 1) * damp + 0.35 * (1 - damp));
    // warm meadow patches so the grass reads less uniform
    const meadow = fbm(x * 0.028 - 90, z * 0.028 + 55, this.seed + 11, 2);
    if (meadow > 0.1) out.lerp(new THREE.Color(0xa9c25e), clamp((meadow - 0.1) * 2.2, 0, 0.5) * damp);
    // dirt shows only where the noise peaks hard — scattered accents, not blotch
    if (n > 0.55) out.lerp(pal.dirt, 0.4 * damp);
    // cheap baked AO: darken concavities (height below the local average).
    // This is the only AO phones get, so it carries real weight.
    const e = 2.6;
    const h0 = this.heightAt(x, z);
    if (isFinite(h0)) {
      const avg = (this.heightAt(x + e, z) + this.heightAt(x - e, z) + this.heightAt(x, z + e) + this.heightAt(x, z - e)) / 4;
      if (isFinite(avg)) {
        const cavity = clamp((avg - h0) * 0.7, 0, 0.42) * damp;
        out.multiplyScalar(1 - cavity);
        // cool the shadowed dips slightly so depth reads as air, not dirt
        out.lerp(new THREE.Color(0x3d6a55), cavity * 0.5);
      }
    }
    // NOTE: steep-face rock is painted per-facet by the terrain fragment
    // shader (crisp, flat-shaded); tinting it here per-vertex would smear
    // radial streaks across the plateau ramps.
    if (t > 0.86) out.lerp(pal.rimRock, smoothstep(0.86, 1.0, t));
    if (this.pond) {
      const pd = Math.hypot(x - this.pond.x, z - this.pond.z);
      if (pd < this.pond.radius * 1.35) {
        out.lerp(new THREE.Color(0xc9b57e), 1 - smoothstep(this.pond.radius * 0.7, this.pond.radius * 1.35, pd)); // sandy shore
      }
    }
  }
}
