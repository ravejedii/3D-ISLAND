import * as THREE from 'three';

// Pond disc with gentle shader ripples + waterfalls pouring off island rims.

export function buildPond({ x, z, y, radius }) {
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 1.7 + uTime * 1.6) * cos(p.y * 1.4 + uTime * 1.1);
        vWave = w;
        p.z += w * 0.06;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec3 deep = vec3(0.10, 0.35, 0.44);
        vec3 shallow = vec3(0.30, 0.62, 0.66);
        float d = distance(vUv, vec2(0.5));
        vec3 col = mix(deep, shallow, smoothstep(0.5, 0.18, d));
        col += vWave * 0.045;
        // sun glints: sparse cells that blink on and off
        vec2 cell = floor(vUv * 46.0);
        float h = hash(cell);
        float blink = smoothstep(0.94, 1.0, sin(uTime * (1.5 + h * 2.5) + h * 40.0) * 0.5 + 0.5);
        col += vec3(1.0, 0.98, 0.9) * blink * step(0.82, h) * 0.55;
        // soft foam ring hugging the shore
        float foamBand = smoothstep(0.415, 0.46, d + sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 9.0 + uTime * 0.8) * 0.012);
        col = mix(col, vec3(0.85, 0.95, 0.95), foamBand * 0.5);
        float edge = smoothstep(0.5, 0.44, d);
        gl_FragColor = vec4(col, 0.82 * edge);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return { mesh, uniforms };
}

export function buildWaterfall({ x, y, z, angle, width = 3.5, height = 30 }) {
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float stripes = sin(vUv.y * 26.0 + uTime * 5.5 + sin(vUv.x * 14.0) * 1.2);
        float s = smoothstep(0.1, 0.9, stripes * 0.5 + 0.5);
        vec3 col = mix(vec3(0.62, 0.82, 0.92), vec3(0.92, 0.98, 1.0), s);
        // churning foam where the water pours over the lip
        float lip = smoothstep(0.86, 0.97, vUv.y + sin(vUv.x * 30.0 + uTime * 3.0) * 0.015);
        col = mix(col, vec3(1.0), lip * 0.8);
        float sideFade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float fade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.02, 0.8, vUv.y);
        gl_FragColor = vec4(col, (0.55 + s * 0.35 + lip * 0.3) * fade * sideFade);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(width, height, 1, 8);
  // slight outward bow so it reads as pouring, not a flat sheet
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) / height + 0.5);
    pos.setZ(i, Math.sin(t * Math.PI * 0.5) * 1.6);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y - height / 2 + 0.5, z);
  mesh.rotation.y = angle;

  // mist puffs churning at the bottom of the fall
  const group = new THREE.Group();
  group.add(mesh);
  const mistTex = makeMistTexture();
  const mists = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.SpriteMaterial({ map: mistTex, color: 0xdff2fa, transparent: true, opacity: 0.35, depthWrite: false });
    const sprite = new THREE.Sprite(sm);
    sprite.position.set(x + (i - 1) * width * 0.3, y - height + 2 + i * 1.2, z);
    sprite.scale.setScalar(4 + i * 1.5);
    group.add(sprite);
    mists.push({ sprite, phase: i * 2.1 });
  }
  const baseUpdate = (t) => {
    uniforms.uTime.value = t;
    for (const m of mists) {
      const pulse = Math.sin(t * 1.3 + m.phase);
      m.sprite.material.opacity = 0.22 + 0.13 * pulse;
      m.sprite.scale.setScalar(4.5 + 1.4 * pulse);
    }
  };
  return { mesh: group, uniforms, update: baseUpdate };
}

let _mistTex = null;
function makeMistTexture() {
  if (_mistTex) return _mistTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _mistTex = new THREE.CanvasTexture(canvas);
  return _mistTex;
}
