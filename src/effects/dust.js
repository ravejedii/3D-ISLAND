import * as THREE from 'three';

const MAX = 48;
// Fade-to-black trick: PointsMaterial has no per-vertex alpha, but with
// additive blending a particle whose color has decayed to black contributes
// nothing to the frame, so per-particle life can fade via vertex color alone.
const BASE_COLOR = new THREE.Color(0xcdbb92);

function makeDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// One pooled additive Points cloud drives every traversal dust puff —
// footstep taps and landing bursts alike — so it costs a single draw call
// and needs no post-processing, keeping it live on the plain mobile path.
export function makeDustPuffs(scene) {
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3); // current (faded) color, written each frame
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.3,
    map: makeDot(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // pool spans wherever the player has walked
  scene.add(points);

  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const vz = new Float32Array(MAX);
  const life = new Float32Array(MAX); // 1 -> 0
  const maxLife = new Float32Array(MAX);
  const baseR = new Float32Array(MAX);
  const baseG = new Float32Array(MAX);
  const baseB = new Float32Array(MAX);
  let cursor = 0;

  function emit(origin, count, { spread, upBias, speedScale, dur, tint }) {
    for (let n = 0; n < count; n++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      positions[i * 3] = origin.x + Math.cos(a) * r;
      positions[i * 3 + 1] = origin.y + 0.05 + Math.random() * 0.08;
      positions[i * 3 + 2] = origin.z + Math.sin(a) * r;
      const outSpeed = (0.5 + Math.random() * 0.9) * speedScale;
      vx[i] = Math.cos(a) * outSpeed;
      vy[i] = (0.35 + Math.random() * 0.5) * upBias;
      vz[i] = Math.sin(a) * outSpeed;
      life[i] = 1;
      maxLife[i] = dur * (0.8 + Math.random() * 0.4);
      baseR[i] = tint.r;
      baseG[i] = tint.g;
      baseB[i] = tint.b;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    // light puff at each footfall while grounded and moving
    footstep(pos, speed) {
      const s = Math.min(1, speed / 12);
      emit(pos, 3 + Math.round(s * 2), {
        spread: 0.18,
        upBias: 0.25,
        speedScale: 0.5 + s * 0.6,
        dur: 0.32,
        tint: BASE_COLOR,
      });
    },
    // bigger burst on a grounded transition, scaled by impact speed
    landing(pos, impactSpeed) {
      const s = THREE.MathUtils.clamp(impactSpeed / 14, 0, 1);
      if (s < 0.06) return; // stepping off a curb shouldn't kick up dust
      emit(pos, Math.round(8 + s * 22), {
        spread: 0.35 + s * 0.55,
        upBias: 0.5 + s * 0.6,
        speedScale: 1.1 + s * 3,
        dur: 0.45 + s * 0.35,
        tint: BASE_COLOR,
      });
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt / maxLife[i];
        if (life[i] <= 0) {
          life[i] = 0;
          colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
          continue;
        }
        vy[i] -= 1.4 * dt; // gentle settle, not full gravity — these drift
        const drag = Math.max(0, 1 - 2 * dt);
        vx[i] *= drag;
        vz[i] *= drag;
        positions[i * 3] += vx[i] * dt;
        positions[i * 3 + 1] += vy[i] * dt;
        positions[i * 3 + 2] += vz[i] * dt;
        const f = life[i];
        colors[i * 3] = baseR[i] * f;
        colors[i * 3 + 1] = baseG[i] * f;
        colors[i * 3 + 2] = baseB[i] * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}
