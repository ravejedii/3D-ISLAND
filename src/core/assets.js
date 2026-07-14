import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Central glTF/GLB asset manager: promise-cached loads, aggregate progress for
// the loading screen, and per-asset error capture so a missing/corrupt file
// degrades to the procedural fallback instead of crashing the game.
export class Assets {
  constructor(basePath = 'assets/models/') {
    // ?noassets simulates total asset failure (used by tests to prove the
    // procedural fallbacks keep the game alive)
    this.disabled = new URLSearchParams(location.search).has('noassets');
    this.basePath = basePath;
    this.manager = new THREE.LoadingManager();
    this.loader = new GLTFLoader(this.manager);
    this.cache = new Map();
    this.failures = [];
    this.loadedCount = 0;
    this.onProgress = null;

    this.manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      if (this.onProgress && itemsTotal > 0) this.onProgress(itemsLoaded / itemsTotal, itemsLoaded, itemsTotal);
    };
  }

  // Resolves to a gltf result, or null on any failure (never rejects).
  load(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const url = this.disabled ? `${this.basePath}__disabled__/${path}` : this.basePath + path;
    const promise = new Promise((resolve) => {
      this.loader.load(
        url,
        (gltf) => {
          this.loadedCount++;
          resolve(gltf);
        },
        undefined,
        (err) => {
          console.warn(`[assets] failed to load ${path} — using procedural fallback`, err?.message || err);
          this.failures.push(path);
          resolve(null);
        },
      );
    });
    this.cache.set(path, promise);
    return promise;
  }

  // Load a set of assets described by { key: path }; resolves to { key: gltf|null }.
  async loadAll(manifest) {
    const entries = Object.entries(manifest);
    const results = await Promise.all(entries.map(([, path]) => this.load(path)));
    const out = {};
    entries.forEach(([key], i) => {
      out[key] = results[i];
    });
    return out;
  }
}

// Bake a (static) gltf scene into a single geometry + its atlas material, so
// it can drive an InstancedMesh. Returns null if the gltf is missing.
export function bakeToGeometry(gltf, mergeGeometries) {
  if (!gltf) return null;
  const geos = [];
  let material = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    // instancing needs matching attribute sets; strip extras beyond pos/normal/uv
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    geos.push(g.toNonIndexed());
    if (!material) material = o.material;
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return { geometry: merged, material };
}

// Prepare a unique (non-instanced) building/prop: enables shadows, applies
// transform, and returns simple colliders derived from its footprint.
export function placeModel(gltf, { x, z, y = 0, scale = 1, rotY = 0, colliderShrink = 0.8, collide = true }) {
  if (!gltf) return null;
  const model = gltf.scene.clone(true);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  model.scale.setScalar(scale);
  model.rotation.y = rotY;
  model.position.set(x, y, z);
  model.updateMatrixWorld(true);

  const colliders = [];
  if (collide) {
    const box = new THREE.Box3().setFromObject(model);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const rx = ((box.max.x - box.min.x) / 2) * colliderShrink;
    const rz = ((box.max.z - box.min.z) / 2) * colliderShrink;
    colliders.push({
      type: 'box',
      minX: cx - rx, maxX: cx + rx,
      minZ: cz - rz, maxZ: cz + rz,
      minY: box.min.y - 1, maxY: box.max.y,
    });
  }
  return { model, colliders };
}
