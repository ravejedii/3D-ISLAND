import * as THREE from 'three';
import { Sky as AtmoSky } from 'three/addons/objects/Sky.js';
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
  constructor(scene, { cheap = false } = {}) {
    this.scene = scene;
    this.time = 0.22; // start late morning
    this.speed = 1 / DAY_LENGTH;

    if (cheap) {
      // software rasterizers can't afford the full-screen scattering shader —
      // a palette-driven background color stands in
      this.dome = null;
      this.atmo = null;
      scene.background = new THREE.Color(PAL.day.horizon);
    } else {
      // physically-based atmospheric scattering (three.js Sky addon):
      // real rayleigh/mie sunsets and horizon glow, driven by the day cycle
      this.dome = new AtmoSky();
      this.dome.scale.setScalar(1800);
      this.dome.frustumCulled = false;
      this.atmo = this.dome.material.uniforms;
      this.atmo.turbidity.value = 6;
      this.atmo.rayleigh.value = 1.6;
      this.atmo.mieCoefficient.value = 0.004;
      this.atmo.mieDirectionalG.value = 0.85;
      scene.add(this.dome);
    }

    // bright disc the god-rays effect samples as its light source
    this.sunSphere = new THREE.Mesh(
      new THREE.SphereGeometry(22, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2cf, fog: false, transparent: true, opacity: 0.95 }),
    );
    this.sunSphere.frustumCulled = false;
    scene.add(this.sunSphere);

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

    // clouds: soft billboard sprites (fluffy, painterly — reads far better
    // than solid low-poly puffs)
    this.cloudMats = [0, 1].map((v) => new THREE.SpriteMaterial({
      map: makeCloudTexture(v),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
      color: 0xffffff,
    }));
    this.cloudSprites = [];
    const cloudGroup = new THREE.Group();
    for (let c = 0; c < 12; c++) {
      const sprite = new THREE.Sprite(this.cloudMats[c % 2]);
      const w = rng.range(38, 70);
      sprite.scale.set(w, w * rng.range(0.32, 0.42), 1);
      sprite.position.set(rng.range(-280, 280), rng.range(48, 95), rng.range(-280, 280));
      cloudGroup.add(sprite);
      this.cloudSprites.push({ sprite, speed: rng.range(1.1, 2.4) });
    }
    scene.add(cloudGroup);

    // moon: soft-shaded disc sprite, only visible at night
    this.moonMat = new THREE.SpriteMaterial({ map: makeMoonTexture(), transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.moon = new THREE.Sprite(this.moonMat);
    this.moon.scale.setScalar(110);
    scene.add(this.moon);

    scene.fog = new THREE.Fog(PAL.day.fog, 120, 620);

    this._colA = new THREE.Color();
    this.nightFactor = 0;
  }

  setTime(t) {
    this.time = ((t % 1) + 1) % 1;
  }

  // Image-based lighting: PMREM-render the sky dome into scene.environment so
  // materials pick up sky color. Refreshed periodically as the cycle advances.
  initEnvironment(renderer, scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(this.dome.geometry, this.dome.material);
    envDome.scale.setScalar(1800);
    this.envScene.add(envDome);
    this.envTarget = scene;
    this.envRT = null;
    this.lastEnvTime = -1;
    scene.environmentIntensity = 0.2; // the physical sky env is bright
    this.refreshEnvironment();
  }

  refreshEnvironment() {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1500);
    this.envTarget.environment = this.envRT.texture;
    if (old) old.dispose();
    this.lastEnvTime = this.time;
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

    // atmosphere: hazier + more scattering toward sunset, crisp at noon
    if (this.atmo) {
      this.atmo.sunPosition.value.copy(sunDir);
      this.atmo.rayleigh.value = lerp(1.4, 3.4, sunsetF);
      this.atmo.turbidity.value = lerp(5, 9, sunsetF);
      this.atmo.mieCoefficient.value = lerp(0.0035, 0.008, sunsetF);
    } else {
      this.scene.background.copy(mix3('horizon'));
    }
    this.dayFactor = dayF;

    // god-rays source disc rides the sun; fades out for the night
    this.sunSphere.position.copy(playerPos).addScaledVector(sunDir, 780);
    this.sunSphere.material.opacity = clamp(dayF * 1.2 - 0.1, 0, 1);
    this.sunSphere.visible = sunEl > -0.08;

    // when the sun sets, the "sun" light becomes the moon (opposite side)
    const isDay = sunEl > -0.04;
    const lightDir = isDay ? sunDir : sunDir.clone().multiplyScalar(-1);

    this.sun.position.copy(playerPos).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(playerPos);
    this.sun.intensity = isDay ? lerp(0.35, 1.9, dayF) : 0.9;
    this.sun.color.set(isDay ? mix3('sun') : new THREE.Color(0x8fa5e8));

    this.hemi.color.copy(mix3('hemiSky'));
    this.hemi.groundColor.copy(mix3('hemiGround'));
    this.hemi.intensity = lerp(0.5, 0.8, dayF);

    this.scene.fog.color.copy(mix3('fog'));

    this.starMat.opacity = clamp(nightF - 0.25, 0, 1) * 1.2;
    this.stars.rotation.y += dt * 0.004;

    const cloudTint = new THREE.Color(0xffffff)
      .lerp(new THREE.Color(0x39406b), nightF * 0.9)
      .lerp(new THREE.Color(0xffc79e), sunsetF * 0.55);
    for (const m of this.cloudMats) {
      m.opacity = lerp(0.42, 0.9, dayF);
      m.color.copy(cloudTint);
    }
    // drift clouds, wrap around the world
    for (const s of this.cloudSprites) {
      s.sprite.position.x += s.speed * dt;
      if (s.sprite.position.x > 320) s.sprite.position.x = -320;
    }

    // refresh the environment map as the light changes
    if (this.pmrem) {
      const d = Math.abs(this.time - this.lastEnvTime);
      if (Math.min(d, 1 - d) > 0.015) this.refreshEnvironment();
    }

    // moon rides opposite the sun, fading in as night falls
    this.moon.position.copy(playerPos).addScaledVector(sunDir, -820);
    this.moonMat.opacity = clamp(nightF - 0.15, 0, 1);

    if (this.dome) this.dome.position.copy(playerPos);
    this.stars.position.set(playerPos.x, 0, playerPos.z);
  }
}

// Painterly cloud texture: layered soft puffs with a flatter base.
function makeCloudTexture(variant) {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rng = new RNG(910 + variant * 37);
  const puffs = 14;
  for (let i = 0; i < puffs; i++) {
    const t = i / puffs;
    const px = w * (0.16 + 0.68 * t) + rng.range(-14, 14);
    const py = h * 0.62 - Math.sin(t * Math.PI) * h * rng.range(0.18, 0.3) + rng.range(-5, 5);
    const r = rng.range(18, 34) * (0.6 + Math.sin(t * Math.PI) * 0.6);
    const grad = ctx.createRadialGradient(px, py, r * 0.1, px, py, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  // fade the very bottom so clouds read flat-based
  const fade = ctx.createLinearGradient(0, h * 0.72, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.globalCompositeOperation = 'source-over';
  return new THREE.CanvasTexture(canvas);
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
