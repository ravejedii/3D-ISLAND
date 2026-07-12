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
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.10, 0.35, 0.44);
        vec3 shallow = vec3(0.30, 0.62, 0.66);
        float d = distance(vUv, vec2(0.5));
        vec3 col = mix(deep, shallow, smoothstep(0.5, 0.18, d));
        col += vWave * 0.045;
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
        float sideFade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float fade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.02, 0.8, vUv.y);
        gl_FragColor = vec4(col, (0.55 + s * 0.35) * fade * sideFade);
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
  return { mesh, uniforms };
}
