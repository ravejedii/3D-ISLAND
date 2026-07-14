import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/800.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, SMAAEffect, VignetteEffect, HueSaturationEffect,
  BrightnessContrastEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Assets } from './core/assets.js';
import { World } from './world/world.js';
import { Player } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { HUD } from './ui/hud.js';
import { TouchControls, detectMobile } from './ui/touch.js';
import { GameAudio } from './audio.js';

const canvas = document.getElementById('game-canvas');

// Detect software rasterizers (SwiftShader / llvmpipe) before creating the real
// context: MSAA + shadow maps in software rendering are unplayably slow.
function detectSoftwareGL() {
  try {
    const probe = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!probe) return false;
    const info = probe.getExtension('WEBGL_debug_renderer_info');
    const name = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : probe.getParameter(probe.RENDERER);
    return /swiftshader|llvmpipe|software|angle \(google/i.test(String(name));
  } catch {
    return false;
  }
}
const softwareGL = new URLSearchParams(location.search).has('lowgfx') || detectSoftwareGL();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !softwareGL, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

// ---------- asset preload (glTF/GLB, CC0 KayKit packs) ----------
// Everything the world swaps in for its procedural placeholders. Any entry
// that fails resolves to null and the consumer keeps its procedural mesh.
const assets = new Assets('assets/models/');
assets.onProgress = (f) => {
  const fill = document.getElementById('loading-fill');
  const sub = document.getElementById('loading-sub');
  if (fill) fill.style.width = `${Math.round(f * 100)}%`;
  if (sub) sub.textContent = `summoning relics… ${Math.round(f * 100)}%`;
};
const models = await assets.loadAll({
  knight: 'characters/Knight.glb',
  treeA: 'nature/tree_single_A.gltf',
  treeB: 'nature/tree_single_B.gltf',
  treesLargeA: 'nature/trees_A_large.gltf',
  treesMediumA: 'nature/trees_A_medium.gltf',
  treesLargeB: 'nature/trees_B_large.gltf',
  rockA: 'nature/rock_single_A.gltf',
  rockB: 'nature/rock_single_B.gltf',
  rockC: 'nature/rock_single_C.gltf',
  rockD: 'nature/rock_single_D.gltf',
  rockE: 'nature/rock_single_E.gltf',
  castle: 'buildings/building_castle_blue.gltf',
  windmill: 'buildings/building_windmill_blue.gltf',
  homeA: 'buildings/building_home_A_blue.gltf',
  homeB: 'buildings/building_home_B_blue.gltf',
  well: 'buildings/building_well_blue.gltf',
  tower: 'buildings/building_tower_A_blue.gltf',
});

const world = new World(scene, models);

// post-processing (pmndrs `postprocessing` + n8ao): SSAO, bloom, SMAA,
// vignette, and a light grade. Runs at quality 0-1 on hardware GL only.
// (?fx forces it on software GL so headless screenshots can verify it.)
let composer = null;
let composerActive = false;
if (!softwareGL || new URLSearchParams(location.search).has('fx')) {
  composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const n8ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  n8ao.configuration.aoRadius = 2.2;
  n8ao.configuration.intensity = 2.6;
  n8ao.configuration.distanceFalloff = 0.6;
  n8ao.setQualityMode('Medium');
  composer.addPass(n8ao);
  composer.addPass(new EffectPass(
    camera,
    new BloomEffect({ intensity: 0.5, luminanceThreshold: 0.72, luminanceSmoothing: 0.2, mipmapBlur: true }),
    new HueSaturationEffect({ saturation: 0.14 }),
    new BrightnessContrastEffect({ contrast: 0.07 }),
    new VignetteEffect({ offset: 0.28, darkness: 0.5 }),
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    new SMAAEffect(),
  ));
}

// Tone mapping lives in the effect chain when the composer runs, and on the
// renderer when it doesn't — setComposerActive keeps them mutually exclusive.
function setComposerActive(active) {
  composerActive = active;
  renderer.toneMapping = active ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
}
const player = new Player(world, models.knight);
scene.add(player.group);
const tpCamera = new ThirdPersonCamera(camera, world);
const hud = new HUD(document.getElementById('ui-root'));
const audio = new GameAudio();

// ---------- input ----------
const input = { forward: false, back: false, left: false, right: false, run: false, jump: false, moveX: 0, moveZ: 0 };
const isMobile = detectMobile();
if (isMobile) document.body.classList.add('touch-mode');
const keyMap = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump',
};
window.addEventListener('keydown', (e) => {
  const k = keyMap[e.code];
  if (k) {
    // jump is edge-triggered and buffered: keyup must not cancel a press the
    // physics step hasn't consumed yet (matters on slow frames), and a press
    // just before landing should still fire
    if (k === 'jump') {
      if (!e.repeat) input.jumpBufferedAt = performance.now();
      input.jump = true;
    } else {
      input[k] = true;
    }
    e.preventDefault();
  }
  if (e.code === 'KeyM') {
    const muted = audio.toggleMute();
    hud.toast(muted ? 'Sound muted' : 'Sound on', 1200);
  }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (k && k !== 'jump') input[k] = false;
});

// ---------- state machine ----------
let state = 'title'; // title | playing | paused | win
let crystalsCollected = 0;
let playStartTime = 0;
let pointerWanted = false;

function setState(next) {
  state = next;
  hud.show(next === 'playing' ? 'game' : next === 'paused' ? 'pause' : next);
  if (touch) {
    if (next === 'playing') touch.show();
    else touch.hide();
  }
}

function lockPointer() {
  if (isMobile) return; // touch look needs no pointer lock
  pointerWanted = true;
  if (!document.pointerLockElement && canvas.requestPointerLock) {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {}); // headless/denied: game still runs
  }
}

function startGame() {
  audio.init();
  crystalsCollected = 0;
  world.crystals.forEach((c, i) => {
    c.collected = false;
    world.crystalField.setCollected(i, false, c);
  });
  hud.setCrystals(0, world.crystals.length);
  player.position.copy(world.spawn);
  player.velocity.set(0, 0, 0);
  playStartTime = performance.now();
  setState('playing');
  lockPointer();
}

function resumeGame() {
  audio.init();
  setState('playing');
  lockPointer();
}

hud.onPlay(startGame);
hud.onResume(resumeGame);
hud.onAgain(startGame);

const touch = isMobile
  ? new TouchControls(document.getElementById('ui-root'), input, tpCamera, {
      onJump: () => {},
      onPause: () => setState('paused'),
    })
  : null;

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && pointerWanted) {
    setState('paused');
  }
});
canvas.addEventListener('click', () => {
  if (state === 'playing') lockPointer();
});

player.fellCallback = () => {
  hud.flash();
  hud.toast('The void is not kind. Try again!', 2400);
  audio.fall();
};
player.onJump = () => audio.jump();
player.onLand = () => audio.land();

// ---------- crystal pickup ----------
const burst = makeBurst(scene);
const burstAt = new THREE.Vector3();
function checkPickups() {
  for (let i = 0; i < world.crystals.length; i++) {
    const c = world.crystals[i];
    if (c.collected) continue;
    const dx = player.position.x - c.x;
    const dy = player.position.y + 1 - c.baseY;
    const dz = player.position.z - c.z;
    if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) {
      c.collected = true;
      world.crystalField.setCollected(i, true, c);
      crystalsCollected++;
      hud.setCrystals(crystalsCollected, world.crystals.length);
      audio.pickup(crystalsCollected);
      burstAt.set(c.x, c.baseY, c.z);
      burst.fire(burstAt, c.color);
      if (crystalsCollected >= world.crystals.length) {
        const secs = Math.round((performance.now() - playStartTime) / 1000);
        hud.setWinStats(`All ${world.crystals.length} crystals · ${Math.floor(secs / 60)}m ${secs % 60}s`);
        audio.win();
        setState('win');
        pointerWanted = false;
        if (document.exitPointerLock) document.exitPointerLock();
      } else {
        hud.toast(`Crystal recovered — ${crystalsCollected} of ${world.crystals.length}`, 1800);
      }
    }
  }
}

function makeBurst(scene) {
  const N = 40;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const vels = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * Math.PI - Math.PI / 2;
    vels.push(new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b) + 0.6, Math.sin(a) * Math.cos(b)).multiplyScalar(2 + Math.random() * 3));
  }
  let life = 0;
  const origin = new THREE.Vector3();
  return {
    fire(at, color) {
      origin.copy(at);
      mat.color.copy(color);
      life = 1;
      for (let i = 0; i < N; i++) {
        pos[i * 3] = at.x;
        pos[i * 3 + 1] = at.y;
        pos[i * 3 + 2] = at.z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    update(dt) {
      if (life <= 0) return;
      life -= dt * 1.4;
      mat.opacity = Math.max(0, life) * 0.9;
      for (let i = 0; i < N; i++) {
        pos[i * 3] += vels[i].x * dt;
        pos[i * 3 + 1] += (vels[i].y - (1 - life) * 4) * dt;
        pos[i * 3 + 2] += vels[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- title-screen cinematic camera ----------
let cinAngle = 0;
function cinematicCamera(dt) {
  cinAngle += dt * 0.045;
  const r = 95;
  camera.position.set(Math.cos(cinAngle) * r, 34 + Math.sin(cinAngle * 0.7) * 8, Math.sin(cinAngle) * r);
  camera.lookAt(0, 8, -10);
}

// ---------- FPS tracking ----------
let fpsFrames = 0;
let fpsTime = 0;
let fps = 60;
const fpsHistory = [];

// ---------- adaptive quality: step down until the frame rate holds ----------
const qualityLevels = [
  { pixelRatio: Math.min(window.devicePixelRatio, 1.75), shadowSize: 2048, shadows: true },
  { pixelRatio: Math.min(window.devicePixelRatio, 1.25), shadowSize: 1024, shadows: true },
  { pixelRatio: 1, shadowSize: 1024, shadows: true },
  { pixelRatio: 1, shadowSize: 512, shadows: false },
  { pixelRatio: 0.6, shadowSize: 512, shadows: false }, // software-GL survival mode
];
let qualityIndex = 0;
let qualityCooldown = 0;

function applyQuality(i) {
  qualityIndex = i;
  const q = qualityLevels[i];
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) {
    composer.setSize(window.innerWidth, window.innerHeight); // re-reads pixel ratio
  }
  setComposerActive(!!composer && i <= 1);
  renderer.shadowMap.enabled = q.shadows;
  world.sky.sun.castShadow = q.shadows;
  if (q.shadows) {
    world.sky.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (world.sky.sun.shadow.map) {
      world.sky.sun.shadow.map.dispose();
      world.sky.sun.shadow.map = null;
    }
  }
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
}

let qualityLocked = false;
function autoQuality(dt) {
  qualityCooldown -= dt;
  if (qualityLocked || qualityCooldown > 0 || fpsHistory.length < 6) return;
  const recent = fpsHistory.slice(-6);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  // software rasterizers never climb back into shadow-mapped levels
  const minIndex = softwareGL ? 3 : 0;
  if (avg < 42 && qualityIndex < qualityLevels.length - 1) {
    applyQuality(qualityIndex + 1);
    qualityCooldown = 4;
  } else if (avg > 58 && qualityIndex > minIndex) {
    applyQuality(qualityIndex - 1);
    qualityCooldown = 8;
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let elapsed = 0;

// compile every shader up front — avoids multi-second hitches (especially on
// software renderers) the first time the castle or a waterfall enters view
renderer.compile(scene, camera);

if (softwareGL) applyQuality(qualityLevels.length - 1);
else setComposerActive(!!composer && qualityIndex <= 1);

// image-based lighting: the sky dome becomes the environment map, refreshed
// as the day-night cycle moves (cheap: a few times per minute)
if (!softwareGL) world.sky.initEnvironment(renderer, scene);

function tick() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  elapsed += dt;

  // FPS accounting must use wall-clock time, not the physics-clamped dt,
  // or slow frames under-report and the history never fills
  fpsFrames++;
  fpsTime += rawDt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsHistory.push(fps);
    if (fpsHistory.length > 40) fpsHistory.shift();
    fpsFrames = 0;
    fpsTime = 0;
    if (state === 'playing') hud.setFPS(fps);
    autoQuality(dt);
  }

  if (state === 'playing') {
    player.update(dt, input, tpCamera.yaw);
    tpCamera.update(dt, player.position);
    checkPickups();
    hud.setCompass(tpCamera.yaw);
    world.update(dt, elapsed, player.position);
  } else if (state === 'title') {
    cinematicCamera(dt);
    world.update(dt, elapsed, camera.position);
  } else {
    // paused / win: keep the world alive behind the overlay, freeze the player
    world.update(dt, elapsed, player.position);
  }
  burst.update(dt);

  if (composerActive) {
    composer.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// drop the static loading overlay once the first frame is on screen
requestAnimationFrame(() => {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 650);
  }
});

// ---------- test hooks ----------
window.__game = {
  get state() { return state; },
  get fps() { return fps; },
  get avgFPS() { return fpsHistory.length ? fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length : 0; },
  resetFPS() { fpsHistory.length = 0; },
  get crystalsCollected() { return crystalsCollected; },
  get totalCrystals() { return world.crystals.length; },
  get playerPos() { return { x: player.position.x, y: player.position.y, z: player.position.z }; },
  get grounded() { return player.grounded; },
  get velocity() { return { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z }; },
  get inputState() { return { ...input }; },
  start() { startGame(); },
  teleport(x, z) {
    const g = world.groundHeight(x, z);
    player.position.set(x, (isFinite(g) ? g : 10) + 1.5, z);
    player.velocity.set(0, 0, 0);
  },
  setYaw(y) { tpCamera.yaw = y; },
  get cameraYaw() { return tpCamera.yaw; },
  get isMobile() { return isMobile; },
  get assetsLoaded() { return assets.loadedCount; },
  get assetFailures() { return [...assets.failures]; },
  get usingModelPlayer() { return !player.isProcedural; },
  setTimeOfDay(t) { world.sky.setTime(t); },
  crystalPositions() { return world.crystals.map((c) => ({ x: c.x, y: c.baseY, z: c.z, collected: c.collected })); },
  groundHeight(x, z) { return world.groundHeight(x, z); },
  drawCalls() { return renderer.info.render.calls; },
  triangles() { return renderer.info.render.triangles; },
  get qualityLevel() { return qualityIndex; },
  // manual override pins the level (used for screenshots / debugging)
  setQuality(i) {
    qualityLocked = true;
    applyQuality(Math.max(0, Math.min(qualityLevels.length - 1, i)));
  },
};
