import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';

// Non-photorealistic rendering for the whole world.
//
// Flat MeshStandardMaterial is why everything read as untextured boxes: smooth
// Lambert falloff over a single colour has no painted structure in it. The
// stylised-game look (Breath of the Wild, Genshin, Sable — the "Ghibli in a
// game" family) comes from four things stacked, and this module provides all
// four:
//
//   1. a TOON RAMP — light quantised into a few painted bands with warm lit
//      tones and cool shadows, instead of a smooth grey gradient
//   2. RIM LIGHT — a sky-coloured wrap along silhouettes, which is what makes
//      objects feel lit by an environment rather than stamped on it
//   3. TRANSLUCENCY — sun bleeding through leaves when you look toward the
//      light, the single most recognisable thing about painted foliage
//   4. MOTTLING — low-frequency value noise breaking up every flat fill, so a
//      surface reads as painted material rather than a colour swatch
//
// Everything is procedural: no texture files, so it costs nothing to download
// and still works on the plain mobile path.

// Warm-to-cool ramp used as MeshToonMaterial's gradientMap. Banding is real
// (nearest filtering) but the steps are tinted rather than pure luminance, so
// shadows go blue-violet and light goes warm — the painted look, not grey cel.
export function toonRamp(bands = 4) {
  const size = 64;
  const data = new Uint8Array(size * 4);
  const shadow = new THREE.Color(0x6f7fb0);
  const mid = new THREE.Color(0xc9c3bc);
  const lit = new THREE.Color(0xfff6e2);
  const c = new THREE.Color();
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    // quantise, but keep a sliver of softness inside each band so surfaces
    // still turn instead of going poster-flat
    const q = Math.min(0.999, Math.floor(t * bands) / (bands - 1 || 1));
    const soft = q * 0.88 + t * 0.12;
    if (soft < 0.5) c.copy(shadow).lerp(mid, soft / 0.5);
    else c.copy(mid).lerp(lit, (soft - 0.5) / 0.5);
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let sharedRamp = null;
export function sharedToonRamp() {
  if (!sharedRamp) sharedRamp = toonRamp(4);
  return sharedRamp;
}

// Every painterly material shares these uniforms so one update moves the whole
// world's lighting (sun direction / colour follow the day cycle).
export const painterlyGlobals = {
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(0xfff3d6) },
  uSkyColor: { value: new THREE.Color(0xcae0ff) },
};

const NOISE_GLSL = /* glsl */ `
  float pnHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float pnNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(pnHash(i + vec3(0,0,0)), pnHash(i + vec3(1,0,0)), f.x),
                   mix(pnHash(i + vec3(0,1,0)), pnHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(pnHash(i + vec3(0,0,1)), pnHash(i + vec3(1,0,1)), f.x),
                   mix(pnHash(i + vec3(0,1,1)), pnHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

// Build a painterly material.
//   foliage   0..1  how much light bleeds through the surface (leaves, grass)
//   mottle    0..1  strength of the painted noise breakup
//   rim       0..1  strength of the sky-coloured silhouette wrap
//   mottleScale     world-space frequency of the breakup
export function painterlyMaterial({
  color = 0xffffff,
  map = null,
  vertexColors = false,
  flatShading = true,
  foliage = 0,
  mottle = 0.14,
  rim = 0.5,
  mottleScale = 0.35,
  transparent = false,
  alphaTest = 0,
  side = THREE.FrontSide,
  extraUniforms = {},
  extraVertex = '',
} = {}) {
  return new CustomShaderMaterial({
    baseMaterial: THREE.MeshToonMaterial,
    color,
    map,
    vertexColors,
    flatShading,
    transparent,
    alphaTest,
    side,
    gradientMap: sharedToonRamp(),
    silent: true,
    uniforms: {
      ...painterlyGlobals,
      uFoliage: { value: foliage },
      uMottle: { value: mottle },
      uRim: { value: rim },
      uMottleScale: { value: mottleScale },
      ...extraUniforms,
    },
    vertexShader: /* glsl */ `
      varying vec3 vPtWPos;
      varying vec3 vPtWNormal;
      void main() {
        // instanced scenery (trees, rocks, grass) carries its transform in
        // instanceMatrix, so world position must include it or the painted
        // breakup would slide with the camera instead of sticking to surfaces
        vec4 ptLocal = vec4(position, 1.0);
        vec3 ptNormal = normal;
        #ifdef USE_INSTANCING
          ptLocal = instanceMatrix * ptLocal;
          ptNormal = mat3(instanceMatrix) * ptNormal;
        #endif
        vPtWPos = (modelMatrix * ptLocal).xyz;
        vPtWNormal = normalize(mat3(modelMatrix) * ptNormal);
        ${extraVertex}
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPtWPos;
      varying vec3 vPtWNormal;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform float uFoliage;
      uniform float uMottle;
      uniform float uRim;
      uniform float uMottleScale;
      ${NOISE_GLSL}
      void main() {
        // csm_DiffuseColor already carries the sampled map; vertex colours are
        // not folded in by CSM, so read them explicitly when present
        vec3 base = csm_DiffuseColor.rgb;
        #ifdef USE_COLOR
          base = vColor.rgb * diffuse;
        #endif

        // 1. painted breakup — two octaves so it reads as brushwork rather
        // than uniform grain, and a hue drift instead of a plain brightness
        // multiply so surfaces never go muddy
        float n = pnNoise(vPtWPos * uMottleScale);
        n = n * 0.65 + pnNoise(vPtWPos * uMottleScale * 3.1) * 0.35;
        vec3 warm = base * vec3(1.10, 1.04, 0.90);
        vec3 cool = base * vec3(0.88, 0.94, 1.08);
        base = mix(cool, warm, n);
        base *= 1.0 + (n - 0.5) * uMottle;

        vec3 N = normalize(vPtWNormal);
        vec3 V = normalize(cameraPosition - vPtWPos);
        vec3 L = normalize(uSunDir);

        // 2. rim / wrap light along silhouettes, strongest where the surface
        // turns away from the camera but still faces the sky
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        float skyward = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        base += uSkyColor * fres * skyward * uRim * 0.55;

        // 3. translucency — sun bleeding through leaves when looking toward
        // the light. Cheap wrap-diffuse on the back hemisphere.
        if (uFoliage > 0.0) {
          float back = clamp(dot(-N, L), 0.0, 1.0);
          float toward = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0);
          base += uSunColor * base * back * toward * uFoliage * 1.6;
        }

        csm_DiffuseColor = vec4(base, csm_DiffuseColor.a);
      }
    `,
  });
}

// Point every painterly material at the current sun/sky each frame.
export function updatePainterlyLighting(sunPos, sunColor, skyColor) {
  painterlyGlobals.uSunDir.value.copy(sunPos).normalize();
  painterlyGlobals.uSunColor.value.copy(sunColor);
  painterlyGlobals.uSkyColor.value.copy(skyColor);
}

// Convert an already-loaded glTF (castle, buildings, knight) to the painterly
// look, preserving each mesh's authored colour and skinning.
export function painterlyfy(root, opts = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!src) return;
    const mat = painterlyMaterial({
      color: src.color ? src.color.getHex() : 0xffffff,
      // KayKit/Quaternius models carry their colour in a texture atlas —
      // dropping the map turns every mesh white
      map: src.map || null,
      transparent: !!src.transparent,
      alphaTest: src.alphaTest || 0,
      side: src.side,
      vertexColors: !!src.vertexColors,
      flatShading: src.flatShading !== undefined ? src.flatShading : true,
      ...opts,
    });
    mat.skinning = !!o.isSkinnedMesh;
    o.material = mat;
  });
}

// Cel outline via inverted hull: a back-face copy of each mesh, displaced
// along its normals, drawn in a dark ink. This is the classic cel-shaded
// contour (Wind Waker / Genshin style) and it is what gives a character a
// clean, deliberate silhouette instead of dissolving into the scene. Works on
// SkinnedMesh too: the displacement runs before the skinning transform, so the
// hull follows animation exactly.
export function addToonOutline(root, { thickness = 0.02, color = 0x241a12 } = {}) {
  const outlines = [];
  root.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || o.userData.isOutline) return;
    // skip hidden meshes (alternate weapon loadouts etc.) — their hulls would
    // draw as floating ink even though the source mesh is invisible
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normal * ${thickness.toFixed(4)};`,
      );
    };
    const hull = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, mat) : new THREE.Mesh(o.geometry, mat);
    if (o.isSkinnedMesh) {
      hull.bind(o.skeleton, o.bindMatrix);
      hull.bindMode = o.bindMode;
    }
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.frustumCulled = false;
    hull.renderOrder = (o.renderOrder || 0) - 1;
    outlines.push({ src: o, hull });
  });
  for (const { src, hull } of outlines) src.parent.add(hull);
  return outlines.map((o) => o.hull);
}
