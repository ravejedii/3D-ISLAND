import * as THREE from 'three';
import { clamp, lerp } from '../core/rng.js';

// A sagging plank bridge between two anchor points. Walkable: heightAt() feeds
// the shared ground query, and clampLateral() keeps the player between rails.
export class Bridge {
  constructor(a, b, width = 2.4) {
    this.a = a.clone();
    this.b = b.clone();
    this.width = width;
    this.dir2 = new THREE.Vector2(b.x - a.x, b.z - a.z);
    this.len2 = this.dir2.length();
    this.dir2.normalize();
    this.sag = Math.max(1.2, this.len2 * 0.07);
  }

  // 2D projection onto the span: returns { t, lateral } or null
  project(x, z) {
    const px = x - this.a.x;
    const pz = z - this.a.z;
    const along = px * this.dir2.x + pz * this.dir2.y;
    const t = along / this.len2;
    const lateral = -px * this.dir2.y + pz * this.dir2.x;
    return { t, lateral };
  }

  yAt(t) {
    return lerp(this.a.y, this.b.y, t) - this.sag * 4 * t * (1 - t);
  }

  heightAt(x, z) {
    const { t, lateral } = this.project(x, z);
    if (t < 0 || t > 1 || Math.abs(lateral) > this.width * 0.5) return -Infinity;
    return this.yAt(t);
  }

  // Keep the player between the rope rails while they stand on this bridge.
  clampLateral(pos) {
    const { t, lateral } = this.project(pos.x, pos.z);
    if (t < 0.02 || t > 0.98) return;
    const limit = this.width * 0.5 - 0.35;
    if (Math.abs(lateral) > limit) {
      const excess = lateral - Math.sign(lateral) * limit;
      pos.x -= -this.dir2.y * excess;
      pos.z -= this.dir2.x * excess;
    }
  }

  build() {
    const group = new THREE.Group();
    const plankGeos = [];
    const woodGeo = [];
    const nPlanks = Math.round(this.len2 / 0.85);
    const right = new THREE.Vector3(-this.dir2.y, 0, this.dir2.x);
    const forward = new THREE.Vector3(this.dir2.x, 0, this.dir2.y);

    const plankProto = new THREE.BoxGeometry(this.width, 0.12, 0.6);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yawQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);

    for (let i = 0; i < nPlanks; i++) {
      const t = (i + 0.5) / nPlanks;
      const x = lerp(this.a.x, this.b.x, t);
      const z = lerp(this.a.z, this.b.z, t);
      const y = this.yAt(t) - 0.08;
      // pitch follows the sag curve
      const dydt = (this.yAt(clamp(t + 0.01, 0, 1)) - this.yAt(clamp(t - 0.01, 0, 1))) / (0.02 * this.len2);
      q.copy(yawQ);
      const pitch = new THREE.Quaternion().setFromAxisAngle(right, -Math.atan(dydt));
      q.premultiply(pitch);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      const g = plankProto.clone().applyMatrix4(m);
      plankGeos.push(g);
    }

    // posts at both ends + rope rails
    for (const end of [this.a, this.b]) {
      for (const side of [-1, 1]) {
        const post = new THREE.BoxGeometry(0.16, 1.3, 0.16);
        const px = end.x + right.x * side * this.width * 0.5;
        const pz = end.z + right.z * side * this.width * 0.5;
        post.translate(px, end.y + 0.55, pz);
        woodGeo.push(post);
      }
    }

    const ropes = [];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push(new THREE.Vector3(
          lerp(this.a.x, this.b.x, t) + right.x * side * this.width * 0.5,
          this.yAt(t) + 0.85,
          lerp(this.a.z, this.b.z, t) + right.z * side * this.width * 0.5,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      ropes.push(new THREE.TubeGeometry(curve, 20, 0.045, 5, false));
    }

    return { plankGeos, woodGeo, ropeGeos: ropes, group };
  }
}
