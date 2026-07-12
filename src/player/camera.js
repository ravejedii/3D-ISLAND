import * as THREE from 'three';
import { clamp } from '../core/rng.js';

// Third-person orbit camera with pointer-lock mouse look, wheel zoom,
// and terrain clearance so it never clips into the ground.
export class ThirdPersonCamera {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0; // camera sits south of the player, looking north at the castle
    this.pitch = 0.32;
    this.dist = 7;
    this.targetDist = 7;
    this.smoothed = new THREE.Vector3();
    this.first = true;

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0026;
        this.pitch = clamp(this.pitch + e.movementY * 0.0022, -0.5, 1.25);
      }
    });
    window.addEventListener('wheel', (e) => {
      this.targetDist = clamp(this.targetDist + Math.sign(e.deltaY) * 0.8, 3.2, 13);
    }, { passive: true });
  }

  update(dt, playerPos) {
    this.dist += (this.targetDist - this.dist) * Math.min(1, 8 * dt);

    const target = new THREE.Vector3(playerPos.x, playerPos.y + 1.7, playerPos.z);
    if (this.first) {
      this.smoothed.copy(target);
      this.first = false;
    } else {
      this.smoothed.lerp(target, Math.min(1, 14 * dt));
    }

    const cp = Math.cos(this.pitch);
    const boom = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    );

    // shorten the boom if terrain or a solid collider blocks the view
    let dist = this.dist;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const px = this.smoothed.x + boom.x * this.dist * t;
      const pz = this.smoothed.z + boom.z * this.dist * t;
      const py = this.smoothed.y + boom.y * this.dist * t;
      const g = this.world.groundHeight(px, pz);
      let blocked = isFinite(g) && py < g + 0.45;
      if (!blocked) {
        for (const c of this.world.colliders) {
          if (c.type !== 'box') continue;
          const pad = 0.35;
          if (px > c.minX - pad && px < c.maxX + pad && pz > c.minZ - pad && pz < c.maxZ + pad && py > c.minY && py < c.maxY + pad) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) {
        dist = Math.min(dist, Math.max(1.2, this.dist * t - 0.6));
        break;
      }
    }

    this.camera.position.copy(this.smoothed).addScaledVector(boom, dist);
    // never sink the camera itself below the ground
    const camGround = this.world.groundHeight(this.camera.position.x, this.camera.position.z);
    if (isFinite(camGround) && this.camera.position.y < camGround + 0.4) {
      this.camera.position.y = camGround + 0.4;
    }
    this.camera.lookAt(this.smoothed);
  }
}
