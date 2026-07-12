import * as THREE from 'three';
import { clamp } from '../core/rng.js';

const GRAVITY = 30;
const WALK_SPEED = 7;
const RUN_SPEED = 12.5;
const JUMP_SPEED = 11;
const MAX_STEP = 0.85; // max ledge the player can walk up
const KILL_Y = -70;

// Stylized low-poly adventurer + movement physics against the analytic world.
export class Player {
  constructor(world) {
    this.world = world;
    this.position = world.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.heading = Math.PI; // start facing north, toward the castle
    this.radius = 0.45;
    this.walkPhase = 0;
    this.fellCallback = null;

    this.group = new THREE.Group();
    this.buildMesh();
    this.group.position.copy(this.position);
  }

  buildMesh() {
    const flat = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.9, ...extra });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 3, 8), flat(0x2e8b8b));
    body.position.y = 1.0;
    body.scale.set(1, 1, 0.8);
    body.castShadow = true;

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.12, 8), flat(0x5e442c));
    belt.position.y = 0.82;
    belt.scale.set(1, 1, 0.82);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), flat(0xe8b88a));
    head.position.y = 1.78;
    head.castShadow = true;

    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.4, 8), flat(0x24505e));
    hood.position.y = 1.98;

    // simple face: two dark eyes so you can tell which way they look
    const eyeGeo = new THREE.SphereGeometry(0.035, 6, 5);
    const eyeMat = flat(0x1d2430);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.09, 1.8, 0.21);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.09;

    this.armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 2, 6), flat(0x246e6e));
    this.armL.geometry.translate(0, -0.2, 0); // pivot at the shoulder
    this.armL.position.set(-0.4, 1.32, 0);
    this.armL.rotation.z = 0.12;
    this.armR = this.armL.clone();
    this.armR.position.x = 0.4;
    this.armR.rotation.z = -0.12;

    this.legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.36, 2, 6), flat(0x3a3f4a));
    this.legL.geometry.translate(0, -0.24, 0); // pivot at the hip
    this.legL.position.set(-0.15, 0.6, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.15;

    this.body = new THREE.Group();
    this.body.add(body, belt, head, hood, eyeL, eyeR, this.armL, this.armR, this.legL, this.legR);
    this.group.add(this.body);
  }

  respawn() {
    this.position.copy(this.world.spawn);
    this.velocity.set(0, 0, 0);
    if (this.fellCallback) this.fellCallback();
  }

  update(dt, input, camYaw) {
    const world = this.world;

    // camera-relative move direction
    let mx = 0;
    let mz = 0;
    if (input.forward) mz -= 1;
    if (input.back) mz += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    const moving = mx !== 0 || mz !== 0;
    let dirX = 0;
    let dirZ = 0;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      dirX = mx * cos - mz * sin;
      dirZ = mx * sin + mz * cos;
    }

    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const accel = this.grounded ? 44 : 14;
    this.velocity.x += (dirX * speed - this.velocity.x) * Math.min(1, accel * dt / speed * 4);
    this.velocity.z += (dirZ * speed - this.velocity.z) * Math.min(1, accel * dt / speed * 4);
    if (!moving && this.grounded) {
      this.velocity.x *= Math.max(0, 1 - 12 * dt);
      this.velocity.z *= Math.max(0, 1 - 12 * dt);
    }

    // jump + gravity (buffered: a press is valid for 0.25s until consumed)
    if (input.jump && performance.now() - (input.jumpBufferedAt || 0) > 250) {
      input.jump = false; // stale press
    }
    if (input.jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      input.jump = false;
      if (this.onJump) this.onJump();
    }
    this.velocity.y -= GRAVITY * dt;

    // --- horizontal move with step/cliff rules ---
    const prevX = this.position.x;
    const prevZ = this.position.z;
    let nx = prevX + this.velocity.x * dt;
    let nz = prevZ + this.velocity.z * dt;

    // solid colliders push-out (castle walls, towers, trees, rocks)
    const py = this.position.y;
    for (const c of world.colliders) {
      if (py + 1.6 < c.minY || py + 0.2 > c.maxY) continue;
      if (c.type === 'box') {
        const ex = clamp(nx, c.minX, c.maxX);
        const ez = clamp(nz, c.minZ, c.maxZ);
        const dx = nx - ex;
        const dz = nz - ez;
        const d2 = dx * dx + dz * dz;
        if (d2 < this.radius * this.radius) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = ex + (dx / d) * this.radius;
            nz = ez + (dz / d) * this.radius;
          } else {
            // inside the box: push out toward the nearest face
            const pushL = nx - c.minX;
            const pushR = c.maxX - nx;
            const pushB = nz - c.minZ;
            const pushF = c.maxZ - nz;
            const m = Math.min(pushL, pushR, pushB, pushF);
            if (m === pushL) nx = c.minX - this.radius;
            else if (m === pushR) nx = c.maxX + this.radius;
            else if (m === pushB) nz = c.minZ - this.radius;
            else nz = c.maxZ + this.radius;
          }
        }
      } else if (c.type === 'circle') {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const rr = c.r + this.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = c.x + (dx / d) * rr;
          nz = c.z + (dz / d) * rr;
        }
      }
    }

    // steep rises act as walls (can't walk up a cliff face)
    if (this.grounded) {
      const gNew = world.groundHeight(nx, nz);
      if (gNew - this.position.y > MAX_STEP && gNew > -Infinity) {
        // try sliding along each axis
        const gx = world.groundHeight(nx, prevZ);
        const gz = world.groundHeight(prevX, nz);
        if (gx - this.position.y <= MAX_STEP) {
          nz = prevZ;
        } else if (gz - this.position.y <= MAX_STEP) {
          nx = prevX;
        } else {
          nx = prevX;
          nz = prevZ;
        }
        this.velocity.x *= 0.3;
        this.velocity.z *= 0.3;
      }
    }

    this.position.x = nx;
    this.position.z = nz;

    // stay between bridge rails
    const bridge = world.bridgeAt(this.position.x, this.position.z, this.position.y);
    if (bridge && this.grounded) bridge.clampLateral(this.position);

    // --- vertical ---
    this.position.y += this.velocity.y * dt;
    const ground = world.groundHeight(this.position.x, this.position.z);
    if (this.velocity.y <= 0 && this.position.y <= ground) {
      this.position.y = ground;
      this.velocity.y = 0;
      if (!this.grounded && this.onLand) this.onLand();
      this.grounded = true;
    } else if (this.grounded && this.position.y - ground < MAX_STEP && this.velocity.y <= 0) {
      // snap down when walking over small dips
      this.position.y = ground;
      this.velocity.y = 0;
    } else {
      this.grounded = false;
    }

    if (this.position.y < KILL_Y) this.respawn();

    // --- visuals ---
    if (moving) {
      const targetHeading = Math.atan2(dirX, dirZ);
      let d = targetHeading - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, 12 * dt);
    }
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;

    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && hSpeed > 0.5) {
      this.walkPhase += dt * (input.run ? 13 : 9);
      const swing = Math.sin(this.walkPhase) * 0.55;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.8;
      this.armR.rotation.x = swing * 0.8;
      this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06;
      this.body.rotation.x = input.run ? 0.12 : 0.05;
    } else if (!this.grounded) {
      this.legL.rotation.x = 0.35;
      this.legR.rotation.x = -0.2;
      this.armL.rotation.x = -0.7;
      this.armR.rotation.x = -0.7;
      this.body.rotation.x = 0.06;
    } else {
      const relax = Math.max(0, 1 - 10 * dt);
      this.legL.rotation.x *= relax;
      this.legR.rotation.x *= relax;
      this.armL.rotation.x *= relax;
      this.armR.rotation.x *= relax;
      this.body.rotation.x *= relax;
      this.body.position.y *= relax;
    }
  }
}
