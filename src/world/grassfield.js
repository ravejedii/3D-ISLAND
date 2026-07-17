import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Dense instanced blade grass for the main-island meadows. One draw call;
// blades sway in the wind and smoothly shrink away past ~55m so distance
// costs nothing. Gated to hardware GL at the higher quality levels.
export class GrassField {
  constructor(scene, island, exclude, { count = 26000, seed = 727 } = {}) {
    const rng = new RNG(seed);

    // --- one blade: tapered 3-segment strip ---
    const blade = new THREE.BufferGeometry();
    const positions = new Float32Array([
      // segment 1 (base)
      -0.045, 0, 0, 0.045, 0, 0, -0.032, 0.4, 0,
      0.045, 0, 0, 0.032, 0.4, 0, -0.032, 0.4, 0,
      // segment 2
      -0.032, 0.4, 0, 0.032, 0.4, 0, -0.018, 0.75, 0,
      0.032, 0.4, 0, 0.018, 0.75, 0, -0.018, 0.75, 0,
      // tip
      -0.018, 0.75, 0, 0.018, 0.75, 0, 0, 1.05, 0,
    ]);
    blade.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // --- scatter ---
    const offsets = [];
    const data = []; // rot, scale, tint, phase
    let attempts = 0;
    while (offsets.length / 3 < count && attempts < count * 30) {
      attempts++;
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * island.radius * 0.86;
      const x = island.center.x + Math.cos(a) * r;
      const z = island.center.z + Math.sin(a) * r;
      if (!exclude(x, z)) continue;
      if (island.slopeAt(x, z) > 0.38) continue;
      const y = island.heightAt(x, z);
      offsets.push(x, y - 0.02, z);
      data.push(rng.range(0, Math.PI * 2), rng.range(0.5, 1.25), rng.next(), rng.range(0, Math.PI * 2));
    }
    const n = offsets.length / 3;

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.attributes.position = blade.attributes.position;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    geo.instanceCount = n;

    this.uniforms = {
      uTime: { value: 0 },
      uLow: { value: new THREE.Color(0x4d9448) },
      uHigh: { value: new THREE.Color(0xa9d05c) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 120 },
      fogFar: { value: 620 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec4 aData; // rot, scale, tint, phase
        uniform float uTime;
        varying float vH;
        varying float vTint;
        varying float vFogDepth;
        void main() {
          float rot = aData.x;
          float scale = aData.y;
          vTint = aData.z;
          vH = position.y;
          // fade out with distance from the camera (soft LOD)
          float dist = distance(cameraPosition.xz, aOffset.xz);
          float lod = 1.0 - smoothstep(42.0, 58.0, dist);
          vec3 p = position * scale * lod;
          float c = cos(rot);
          float s = sin(rot);
          p.xz = mat2(c, -s, s, c) * p.xz;
          // wind: bend grows with height^2
          float bendPhase = uTime * 1.9 + aOffset.x * 0.35 + aOffset.z * 0.28 + aData.w;
          float bend = (sin(bendPhase) * 0.14 + sin(bendPhase * 2.3) * 0.05) * vH * vH;
          p.x += bend;
          p.z += bend * 0.6;
          vec4 mv = modelViewMatrix * vec4(p + aOffset, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLow;
        uniform vec3 uHigh;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        varying float vH;
        varying float vTint;
        varying float vFogDepth;
        void main() {
          vec3 col = mix(uLow, uHigh, pow(clamp(vH, 0.0, 1.0), 0.85));
          col *= 0.88 + vTint * 0.24;
          float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          col = mix(col, fogColor, fogF);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.count = n;
  }

  update(t, fogColor) {
    this.uniforms.uTime.value = t;
    if (fogColor) this.uniforms.fogColor.value.copy(fogColor);
  }
}
