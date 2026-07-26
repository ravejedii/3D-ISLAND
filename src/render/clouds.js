import * as THREE from 'three';

// Painted cumulus for the sky dome.
//
// Billboard sprites read as flat stickers and the atmospheric-scattering dome
// gives a beautiful but empty sky — neither produces the towering, silver-lined
// cloudbanks that define a Ghibli-style sky. This is an inside-out sphere
// running domain-warped fBm over the view direction: cheap (no raymarching, one
// draw call, no textures), but it yields billowing shapes with real internal
// structure that catch the sun on their edges.
//
// The clouds are lit rather than merely coloured: density gradient along the
// sun vector drives a bright silver lining on sunward edges and lets shadowed
// interiors go blue, which is what sells them as volume instead of fog.
export function makeCloudDome(radius = 1700) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) },
    uSunColor: { value: new THREE.Color(0xfff3d6) },
    uSkyColor: { value: new THREE.Color(0xbfe2f2) },
    uCloudColor: { value: new THREE.Color(0xffffff) },
    uShadowColor: { value: new THREE.Color(0x8fa6c8) },
    uCoverage: { value: 0.42 },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uCloudColor;
      uniform vec3 uShadowColor;
      uniform float uCoverage;
      uniform float uOpacity;

      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = p * 2.02 + vec2(37.1, 17.7);
          a *= 0.5;
        }
        return v;
      }
      // domain warping is what turns smooth fbm blobs into billowing cauliflower
      // edges — the shape language of real cumulus
      float clouds(vec2 p) {
        vec2 q = vec2(fbm(p + vec2(uTime * 0.014, 0.0)), fbm(p + vec2(5.2, 1.3)));
        vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + uTime * 0.008),
                      fbm(p + 3.4 * q + vec2(8.3, 2.8)));
        return fbm(p + 3.2 * r);
      }

      void main() {
        // project the view ray onto a flat cloud plane overhead: shapes stretch
        // toward the horizon exactly as a real cloud deck does
        // clamping the elevation floor keeps the deck from smearing into
        // infinite streaks near the horizon — without it the projection turns
        // cumulus into cirrus
        float h = max(vDir.y, 0.16);
        vec2 uv = vDir.xz / h * 0.30;

        float d = clouds(uv * 0.9);
        // a tight threshold band carves defined, billowing cloud bodies; a wide
        // one just fogs the sky
        float density = smoothstep(uCoverage, uCoverage + 0.13, d);

        // fade the deck out near the horizon so it reads as distance, not a wall
        float horizon = smoothstep(0.03, 0.26, vDir.y);
        density *= horizon;

        // light the cloud: sample density a step toward the sun — less density
        // that way means the edge is sunlit, which gives the silver lining
        vec2 sunUV = uv + normalize(uSunDir.xz + vec2(0.001)) * 0.22;
        float toSun = smoothstep(uCoverage, uCoverage + 0.13, clouds(sunUV * 0.9));
        float lit = clamp(1.0 - (toSun - density) * 2.1, 0.0, 1.0);

        // sun proximity adds a warm bloom through thin edges
        float sunAmt = pow(clamp(dot(normalize(vDir), normalize(uSunDir)), 0.0, 1.0), 8.0);

        vec3 col = mix(uShadowColor, uCloudColor, lit);
        col += uSunColor * sunAmt * 0.55 * (1.0 - density * 0.4);
        // thin fringes pick up the sky so edges dissolve instead of cutting out
        col = mix(uSkyColor, col, clamp(density * 1.15, 0.0, 1.0));

        float alpha = density * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms, material };
}
