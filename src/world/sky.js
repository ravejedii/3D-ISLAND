import * as THREE from 'three';
import { updatePainterlyLighting } from '../render/painterly.js';
import { makeCloudDome } from '../render/clouds.js';
import { Sky as AtmoSky } from 'three/addons/objects/Sky.js';
import { RNG, clamp, lerp, smoothstep } from '../core/rng.js';

// Sky dome + sun/moon lighting + stars + drifting clouds + fog, all driven by
// a single timeOfDay value in [0, 1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.

const DAY_LENGTH = 240; // seconds per full cycle

// Horizon and fog are deliberately the SAME family of blues at every hour: the
// point of aerial perspective is that distance dissolves into sky, so a fog
// colour that disagrees with the horizon reads as haze sitting in front of the
// world instead of air inside it.
const PAL = {
  day: { top: 0x3d80cf, horizon: 0x9ecde8, fog: 0x9dc7e2, sun: 0xfff3d6, hemiSky: 0xcae0ff, hemiGround: 0x8b9c63 },
  sunset: { top: 0x35418c, horizon: 0xe8905f, fog: 0xc0906f, sun: 0xffb46b, hemiSky: 0xd99c7c, hemiGround: 0x6a5a4c },
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
      this.atmo.turbidity.value = 3.4; // less suspended haze: the horizon was a white band that flattened all depth
      this.atmo.rayleigh.value = 1.6;
      this.atmo.mieCoefficient.value = 0.0022;
      this.atmo.mieDirectionalG.value = 0.85;
      // the addon ships its own fbm cloud layer; clouds.js already owns that
      // job and the addon's version only added white wisps near the horizon
      this.atmo.cloudCoverage.value = 0;
      gradeHorizonBand(this.dome.material);
      scene.add(this.dome);
    }

    // painted cumulus deck over the sky dome — the shapes that make a sky read
    // as weather rather than a gradient. Skipped on the cheap path (software
    // rasterizers can't afford a full-dome fbm).
    this.clouds = null;
    if (!cheap) {
      const deck = makeCloudDome(1700);
      this.clouds = deck;
      scene.add(deck.mesh);
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

    // Aerial perspective. The old range (260 -> 980) began past everything in
    // the world, so the satellite islands were rendered at full contrast in
    // front of a blazing horizon — the classic depth-flattener. Fog now starts
    // just beyond the castle and reaches its full tint around the far islands,
    // so distance genuinely fades toward the same blue the sky is.
    scene.fog = new THREE.Fog(PAL.day.fog, 88, 400);

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
      // crisp deep-blue midday, hazy amber only near sunset
      this.atmo.sunPosition.value.copy(sunDir);
      this.atmo.rayleigh.value = lerp(1.05, 3.2, sunsetF);
      this.atmo.turbidity.value = lerp(3.2, 8.5, sunsetF);
      this.atmo.mieCoefficient.value = lerp(0.0028, 0.0075, sunsetF);
      // the graded band tracks the palette, so the horizon stays the same
      // colour the fog is at every hour of the cycle
      this.atmo.uHorizonColor.value.copy(mix3('horizon'));
      // let the band open up at sunset — that glow is the point of a sunset —
      // but keep it clamped hard through the working hours of the day
      this.atmo.uHorizonTint.value = lerp(0.85, 0.35, sunsetF);
      this.atmo.uHorizonRoll.value = lerp(3.0, 0.9, sunsetF);
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

    // keep every painterly surface lit by the same sun/sky as the scene, so
    // rim light and leaf translucency track the day cycle
    updatePainterlyLighting(lightDir, mix3('sun'), mix3('hemiSky'));
    if (this.clouds) {
      const u = this.clouds.uniforms;
      u.uTime.value += dt;
      u.uSunDir.value.copy(lightDir);
      u.uSunColor.value.copy(mix3('sun'));
      u.uSkyColor.value.copy(mix3('horizon'));
      // clouds go warm at golden hour and deep blue at night, like the sky
      u.uCloudColor.value.copy(mix3('sun')).lerp(new THREE.Color(0xffffff), 0.55);
      // give the deck real form: a shadow side that actually reads as shadow
      // is what stops the upper half of the frame going milky, and a sky with
      // internal contrast is what makes a calm horizon look deliberate
      u.uShadowColor.value.copy(mix3('fog')).multiplyScalar(0.62).lerp(new THREE.Color(0x6f8fbe), 0.35);
      this.clouds.mesh.position.copy(playerPos);
    }
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

// Grade the scattering dome.
//
// Preetham's model is right: at grazing angles the optical path through the
// atmosphere is enormous, every wavelength saturates, and the horizon goes
// near-white. Its output is also genuinely HDR — several times display white —
// and the composer's ACES pass was clipping the entire lower half of the sky
// to a flat 218/218/218 sheet. That sheet, not a narrow band, is what sat
// behind the castle: the silhouette that should have been the darkest mass in
// the frame had nothing to be dark against.
//
// Turbidity can't fix it (dropping it far enough to calm the horizon also
// kills the sunset), so the dome is graded after the fact:
//
//   * a scale-free luminance rolloff, `l / (1 + l * k)` — bright values are
//     compressed hard, calm ones are left alone, so this behaves at noon, at
//     dusk and at night without a single magic absolute threshold. `k` is
//     small over the dome as a whole (just enough to keep the sky inside the
//     display range, which is what lets its blue show at all) and large
//     through the horizon band.
//   * a re-hue toward the palette's horizon blue at constant luminance, so
//     what is left of the band is sky rather than glare.
//
// The band weight falls off with elevation, so the zenith, the clouds and the
// sun's own disc are essentially untouched.
function gradeHorizonBand(mat) {
  mat.uniforms.uHorizonColor = { value: new THREE.Color(PAL.day.horizon) };
  mat.uniforms.uHorizonSpread = { value: 0.55 };
  mat.uniforms.uSkyRoll = { value: 0.55 };
  mat.uniforms.uHorizonRoll = { value: 3.0 };
  mat.uniforms.uHorizonTint = { value: 0.85 };
  mat.fragmentShader = mat.fragmentShader
    .replace(
      'uniform float mieDirectionalG;',
      `uniform float mieDirectionalG;
      uniform vec3 uHorizonColor;
      uniform float uHorizonSpread;
      uniform float uSkyRoll;
      uniform float uHorizonRoll;
      uniform float uHorizonTint;`,
    )
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `{
        const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
        float band = 1.0 - smoothstep( -0.08, uHorizonSpread, direction.y );
        band = pow( band, 1.5 );
        float lum = max( dot( texColor, LW ), 1e-5 );
        float rolled = lum / ( 1.0 + lum * mix( uSkyRoll, uHorizonRoll, band ) );
        texColor *= rolled / lum;
        float hl = max( dot( uHorizonColor, LW ), 1e-5 );
        texColor = mix( texColor, uHorizonColor * ( dot( texColor, LW ) / hl ), band * uHorizonTint );
      }
      gl_FragColor = vec4( texColor, 1.0 );`,
    );
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
