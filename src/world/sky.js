import * as THREE from 'three';
import { RNG, clamp, lerp, smoothstep } from '../core/rng.js';

// Sky dome + sun/moon lighting + stars + drifting clouds + fog, all driven by
// a single timeOfDay value in [0, 1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.

const DAY_LENGTH = 240; // seconds per full cycle

const PAL = {
  day: { top: 0x3a7bd5, horizon: 0xaed6f1, fog: 0xbcd9ec, sun: 0xfff3d6, hemiSky: 0xbfd9ff, hemiGround: 0x8a7f6a },
  sunset: { top: 0x35418c, horizon: 0xff9d5c, fog: 0xe8b48c, sun: 0xffb46b, hemiSky: 0xd99c7c, hemiGround: 0x6a5a4c },
  night: { top: 0x0a1028, horizon: 0x233158, fog: 0x1a2240, sun: 0x9db4ff, hemiSky: 0x33415f, hemiGround: 0x232630 },
};

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.22; // start late morning
    this.speed = 1 / DAY_LENGTH;

    // dome
    this.uniforms = {
      topColor: { value: new THREE.Color(PAL.day.top) },
      horizonColor: { value: new THREE.Color(PAL.day.horizon) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(PAL.day.sun) },
      sunGlow: { value: 1 },
      duskGlow: { value: 0 },
      duskColor: { value: new THREE.Color(0xff8a4a) },
    };
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // pin to far plane
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform float sunGlow;
        uniform float duskGlow;
        uniform vec3 duskColor;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.62));
          float sunDot = clamp(dot(vDir, sunDir), 0.0, 1.0);
          col += sunColor * pow(sunDot, 220.0) * 1.6 * sunGlow;      // disc
          col += sunColor * pow(sunDot, 6.0) * 0.22 * sunGlow;       // halo
          // warm band hugging the horizon at dawn/dusk, strongest sunward
          float band = exp(-abs(vDir.y) * 7.0);
          float sunward = 0.35 + 0.65 * pow(clamp(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0, 1.0), 2.0);
          col += duskColor * band * sunward * duskGlow;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 18), domeMat);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 320;
    const s = 95;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(PAL.day.hemiSky, PAL.day.hemiGround, 0.9);
    scene.add(this.hemi);

    // stars
    const rng = new RNG(4242);
    const starCount = 900;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = rng.range(0, Math.PI * 2);
      const y = rng.range(0.06, 1);
      const r = Math.sqrt(1 - y * y);
      sp[i * 3] = Math.cos(a) * r * 850;
      sp[i * 3 + 1] = y * 850;
      sp[i * 3 + 2] = Math.sin(a) * r * 850;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // clouds: instanced squashed icosahedra puffs
    const puff = new THREE.IcosahedronGeometry(1, 0);
    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1 });
    const puffsPerCloud = 5;
    const cloudCount = 16;
    this.clouds = new THREE.InstancedMesh(puff, this.cloudMat, cloudCount * puffsPerCloud);
    this.cloudSeeds = [];
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let c = 0; c < cloudCount; c++) {
      const cx = rng.range(-260, 260);
      const cy = rng.range(46, 90);
      const cz = rng.range(-260, 260);
      const speed = rng.range(1.2, 2.6);
      const scale = rng.range(4, 9);
      for (let p = 0; p < puffsPerCloud; p++) {
        const ox = rng.range(-1.2, 1.2) * scale;
        const oy = rng.range(-0.16, 0.22) * scale;
        const oz = rng.range(-0.5, 0.5) * scale;
        const ps = rng.range(0.45, 1) * scale;
        this.cloudSeeds.push({ cx, cy, cz, ox, oy, oz, ps, speed, idx });
        dummy.position.set(cx + ox, cy + oy, cz + oz);
        dummy.scale.set(ps, ps * 0.45, ps * 0.75);
        dummy.updateMatrix();
        this.clouds.setMatrixAt(idx++, dummy.matrix);
      }
    }
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    // moon: soft-shaded disc sprite, only visible at night
    this.moonMat = new THREE.SpriteMaterial({ map: makeMoonTexture(), transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.moon = new THREE.Sprite(this.moonMat);
    this.moon.scale.setScalar(110);
    scene.add(this.moon);

    scene.fog = new THREE.Fog(PAL.day.fog, 120, 620);

    this._dummy = dummy;
    this._colA = new THREE.Color();
    this.nightFactor = 0;
  }

  setTime(t) {
    this.time = ((t % 1) + 1) % 1;
  }

  update(dt, playerPos) {
    this.time = (this.time + dt * this.speed) % 1;
    const a = this.time * Math.PI * 2; // 0 => sunrise
    const sunEl = Math.sin(a);
    const sunDir = new THREE.Vector3(Math.cos(a), sunEl, 0.35).normalize();

    const dayF = smoothstep(-0.06, 0.18, sunEl);
    const duskF = (1 - smoothstep(0.12, 0.38, Math.abs(sunEl))) * smoothstep(-0.3, -0.02, sunEl) + (1 - smoothstep(0.12, 0.38, Math.abs(sunEl))) * smoothstep(-0.02, 0.1, sunEl);
    const sunsetF = clamp(1 - smoothstep(0.05, 0.32, Math.abs(sunEl)), 0, 1);
    const nightF = 1 - dayF;
    this.nightFactor = nightF;
    void duskF;

    const mix3 = (key) => {
      const day = new THREE.Color(PAL.day[key]);
      const sunset = new THREE.Color(PAL.sunset[key]);
      const night = new THREE.Color(PAL.night[key]);
      const c = new THREE.Color();
      // blend day <-> night, then pull toward sunset near the horizon
      c.copy(night).lerp(day, dayF).lerp(sunset, sunsetF * 0.85);
      return c;
    };

    this.uniforms.topColor.value.copy(mix3('top'));
    this.uniforms.horizonColor.value.copy(mix3('horizon'));
    this.uniforms.sunColor.value.copy(mix3('sun'));
    this.uniforms.sunGlow.value = sunEl > -0.12 ? 1 : 0; // the moon sprite takes over at night
    this.uniforms.duskGlow.value = sunsetF * 0.55;

    // when the sun sets, the "sun" light becomes the moon (opposite side)
    const isDay = sunEl > -0.04;
    const lightDir = isDay ? sunDir : sunDir.clone().multiplyScalar(-1);
    this.uniforms.sunDir.value.copy(isDay ? sunDir : lightDir);

    this.sun.position.copy(playerPos).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(playerPos);
    this.sun.intensity = isDay ? lerp(0.35, 2.4, dayF) : 0.9;
    this.sun.color.set(isDay ? mix3('sun') : new THREE.Color(0x8fa5e8));

    this.hemi.color.copy(mix3('hemiSky'));
    this.hemi.groundColor.copy(mix3('hemiGround'));
    this.hemi.intensity = lerp(0.55, 1.0, dayF);

    this.scene.fog.color.copy(mix3('fog'));

    this.starMat.opacity = clamp(nightF - 0.25, 0, 1) * 1.2;
    this.stars.rotation.y += dt * 0.004;

    this.cloudMat.opacity = lerp(0.5, 0.92, dayF);
    this.cloudMat.color.copy(new THREE.Color(0xffffff).lerp(new THREE.Color(0x2a3357), nightF * 0.85).lerp(new THREE.Color(0xffc79e), sunsetF * 0.5));

    // drift clouds, wrap around the world
    for (const s of this.cloudSeeds) {
      s.cx += s.speed * dt;
      if (s.cx > 300) s.cx = -300;
      this._dummy.position.set(s.cx + s.ox, s.cy + s.oy, s.cz + s.oz);
      this._dummy.scale.set(s.ps, s.ps * 0.45, s.ps * 0.75);
      this._dummy.updateMatrix();
      this.clouds.setMatrixAt(s.idx, this._dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    // moon rides opposite the sun, fading in as night falls
    this.moon.position.copy(playerPos).addScaledVector(sunDir, -820);
    this.moonMat.opacity = clamp(nightF - 0.15, 0, 1);

    this.dome.position.copy(playerPos);
    this.stars.position.set(playerPos.x, 0, playerPos.z);
  }
}

function makeMoonTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const r = size * 0.32;
  // outer glow
  let grad = ctx.createRadialGradient(c, c, r * 0.6, c, c, size / 2);
  grad.addColorStop(0, 'rgba(210,225,255,0.5)');
  grad.addColorStop(1, 'rgba(210,225,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // disc, lit from the upper left
  grad = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r);
  grad.addColorStop(0, '#f4f7ff');
  grad.addColorStop(0.75, '#cdd8f0');
  grad.addColorStop(1, '#9aa8c8');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // a few craters
  ctx.fillStyle = 'rgba(150,165,200,0.55)';
  for (const [ox, oy, cr] of [[-0.3, 0.15, 0.16], [0.25, -0.2, 0.12], [0.1, 0.3, 0.09], [-0.05, -0.35, 0.07]]) {
    ctx.beginPath();
    ctx.arc(c + ox * r, c + oy * r, cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}
