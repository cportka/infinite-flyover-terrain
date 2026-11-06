import * as THREE from 'three';
import { GLSL } from './shaderLib.js';

/** Uniforms shared by every world material (updated once per frame by the atmosphere). */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSunDisc: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyTop: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyGlow: { value: new THREE.Color() },
    uAmbSky: { value: new THREE.Color() },
    uAmbGround: { value: new THREE.Color() },
    uFogDensity: { value: 0.0008 },
    uHeightFog: { value: 0.0015 },
    uHeightFalloff: { value: 0.02 },
    uNight: { value: 0 },
    uGlow: { value: 1 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudCover: { value: 0.6 },
    uWind: { value: 1 },
    uDream: { value: 0 },
    uNeonA: { value: new THREE.Color(0.4, 1, 0.8) },
    uNeonB: { value: new THREE.Color(1, 0.4, 0.9) },
    uBoomPos: { value: new THREE.Vector3() },
    uBoomColor: { value: new THREE.Color(0, 0, 0) },
    uBoomRadius: { value: 0 },
  };
}

const terrainVert = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aMat;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vColor;
varying vec4 vMat;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float bl = aMat.g;
  if (bl > 0.0) {
    // the Borderland breathes
    wp.y += bl * bl * 1.8 * sin(uTime * 0.55 + wp.x * 0.0920388 + wp.z * 0.0613592);
  }
  vWorldPos = wp.xyz;
  vNormal = normal;
  vColor = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const terrainFrag = /* glsl */ `
${GLSL}
uniform float uFacet;
uniform vec3 uStrata[7];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vColor;
varying vec4 vMat;

vec3 strataColor(vec3 p) {
  float wob = tnoise(p.xz * (1.0 / 32.0), 128.0) * 0.7 + tnoise(p.xz * (1.0 / 8.0), 512.0) * 0.15;
  float f = p.y / 6.5 + wob + 70.0;
  float k = floor(f);
  int i0 = int(mod(k, 7.0));
  int i1 = int(mod(k + 1.0, 7.0));
  vec3 c = mix(uStrata[i0], uStrata[i1], smoothstep(0.12, 0.88, f - k));
  return c * (0.93 + 0.07 * sin(p.y * 2.3 + wob * 6.0));
}

void main() {
  float real = 1.0 - uDream;
  vec3 sN = normalize(vNormal);
  vec3 fN = flatNormal(vWorldPos);
  if (dot(fN, sN) < 0.0) fN = -fN;
  float steep = smoothstep(0.3, 0.65, 1.0 - sN.y);
  float facet = uFacet * mix(1.0, 0.3, steep) * mix(0.3, 1.0, uDream);
  vec3 N = normalize(mix(sN, fN, facet));
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = distance(vWorldPos, cameraPosition);

  // reality: fine relief in the ground close to the viewer
  float near = 1.0 - smoothstep(70.0, 300.0, dist);
  if (near > 0.0 && real > 0.02) {
    vec2 q = vWorldPos.xz * 0.5;
    float b0 = tnoise(q, 2048.0) + 0.5 * tnoise(q * 2.0, 4096.0);
    float bx = tnoise(q + vec2(0.35, 0.0), 2048.0) + 0.5 * tnoise(q * 2.0 + vec2(0.7, 0.0), 4096.0);
    float bz = tnoise(q + vec2(0.0, 0.35), 2048.0) + 0.5 * tnoise(q * 2.0 + vec2(0.0, 0.7), 4096.0);
    vec2 g = vec2(bx - b0, bz - b0) / 0.35;
    N = normalize(N - vec3(g.x, 0.0, g.y) * 0.22 * near * real * (1.0 - steep * 0.5));
  }

  vec3 albedo = vColor.rgb;
  float patchN = tnoise(vWorldPos.xz * (1.0 / 16.0), 256.0);
  float speck = tnoise(vWorldPos.xz * 0.5, 2048.0);
  albedo *= 0.94 + 0.12 * patchN;
  albedo *= mix(0.9 + 0.2 * speck, 1.0, smoothstep(60.0, 220.0, dist));
  if (vMat.r > 0.004) albedo = mix(albedo, strataColor(vWorldPos), vMat.r);
  if (vMat.b > 0.004) {
    // prismatic ground: thin-film colours that shift with height and view angle
    float film = vWorldPos.y * 0.035 + dot(N, V) * 1.6 + tnoise(vWorldPos.xz / 32.0, 128.0) * 0.8 + uTime * 0.015;
    vec3 iri = neonPalette(film) * 0.6 + 0.55;
    albedo = mix(albedo, albedo * iri * 1.1, vMat.b * 0.85);
  }
  if (uDream > 0.01) {
    float hs = sin(uTime * 0.04 + vWorldPos.x * 0.0030679616 + vWorldPos.z * 0.0015339808);
    vec3 shifted = hueRotate(albedo, hs * 1.3 * uDream);
    float l = dot(shifted, vec3(0.2126, 0.7152, 0.0722));
    albedo = mix(albedo, max(mix(vec3(l), shifted, 1.0 + 0.6 * uDream), 0.0), uDream * 0.85);
  }

  float uw = smoothstep(0.0, -7.0, vWorldPos.y);
  albedo = mix(albedo, albedo * vec3(0.38, 0.55, 0.62), uw);

  float shadow = cloudShadow(vWorldPos.xz);
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + mix(0.2, 0.08, real)) / mix(1.2, 1.08, real), 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  // reality: deeper contrast in hollows and on rock faces
  hemi *= mix(1.0, 0.78 + 0.22 * sN.y, real);
  vec3 col = albedo * (uSunColor * wrap * shadow + hemi);
  // a faint specular sheen on rock and wet ground when the world is real
  vec3 Hh = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, Hh), 0.0), 40.0) * 0.05 * real * shadow * (steep + smoothstep(1.5, 0.0, vWorldPos.y));

  col += albedo * vColor.a * uGlow * 1.4 * (1.0 + 0.8 * uDream);
  col += albedo * boomLight(vWorldPos, N);
  float bl = vMat.g;
  col += dreamLines(vWorldPos, dist) * (0.55 + 0.45 * uNight) * (1.0 - 0.5 * uw);
  col = applyFog(col, vWorldPos);
  if (bl > 0.004) {
    // the Borderland is veiled in a violet mist
    float lum = dot(uSkyHorizon, vec3(0.3, 0.5, 0.2));
    col = mix(col, vec3(lum) * vec3(0.62, 0.5, 0.95) + vec3(0.02, 0.0, 0.05), bl * 0.38);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrainMaterial(shared, strataHex) {
  const strata = strataHex.map((h) => new THREE.Color(h));
  return new THREE.ShaderMaterial({
    name: 'terrain',
    uniforms: { ...shared, uFacet: { value: 0.65 }, uStrata: { value: strata } },
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
  });
}

const propVert = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aData;
attribute vec4 aNormal;
uniform float uTime;
uniform float uWind;
varying vec3 vWorldPos;
varying vec3 vSmoothN;
varying vec4 vColor;
varying float vFlag;
varying float vPhase;
void main() {
  vec3 p = position;
  float sway = aData.x * 2.0;
  float ph = aData.y * 6.2831853;
  if (sway > 0.0) {
    float t = uTime;
    float g = sin(t * 0.6 + ph * 0.3) * 0.5 + 0.5;
    p.x += sway * uWind * (sin(t * 1.7 + ph) * 0.6 + sin(t * 3.3 + ph * 2.1) * 0.22) * (0.5 + g);
    p.z += sway * uWind * (cos(t * 1.3 + ph * 1.7) * 0.45) * (0.5 + g);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vSmoothN = mat3(modelMatrix) * aNormal.xyz;
  vColor = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  vFlag = aData.z * 255.0;
  vPhase = ph;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const propFrag = /* glsl */ `
${GLSL}
uniform float uEmissiveBoost;
uniform float uOpacity;
varying vec3 vWorldPos;
varying vec3 vSmoothN;
varying vec4 vColor;
varying float vFlag;
varying float vPhase;
void main() {
  float real = 1.0 - uDream;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = distance(vWorldPos, cameraPosition);
  vec3 fN = flatNormal(vWorldPos);
  // derivative sign conventions vary between drivers: always face the viewer
  if (dot(fN, V) < 0.0) fN = -fN;
  vec3 sN = vSmoothN;
  float sl = length(sN);
  sN = sl > 0.01 ? sN / sl : fN;
  if (dot(sN, fN) < 0.0) sN = -sN;
  // reality rounds things off; the dream keeps them crystalline
  vec3 N = normalize(mix(fN, sN, mix(0.8, 0.2, uDream)));
  // grass & flower stems: light like the ground so they blend into the terrain
  if (vFlag > 2.5 && vFlag < 3.5) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.8));

  vec3 albedo = vColor.rgb;
  if (uDream > 0.01) {
    vec3 shifted = hueRotate(albedo, uDream * 1.1 * sin(uTime * 0.05 + vPhase));
    albedo = mix(albedo, shifted * (1.0 + 0.3 * uDream), uDream * 0.6);
  }
  float shadow = cloudShadow(vWorldPos.xz);
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + mix(0.3, 0.12, real)) / mix(1.3, 1.12, real), 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * wrap * shadow + hemi);

  if ((vFlag > 0.5 && vFlag < 1.5) || (vFlag > 2.5 && vFlag < 3.5)) {
    float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
    col += albedo * uSunColor * back * 0.55 * shadow;
  }
  float em = vColor.a;
  if (em > 0.0) {
    float pulse = (vFlag > 1.5 && vFlag < 2.5) ? 0.72 + 0.28 * sin(uTime * 1.8 + vPhase * 3.0) : 1.0;
    col += albedo * em * uGlow * pulse * uEmissiveBoost * (1.0 + 0.7 * uDream);
  }
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uSkyHorizon * rim * 0.12;
  // dream: neon edges and contour light
  col += mix(uNeonA, uNeonB, 0.5 + 0.5 * sin(vPhase + uTime * 0.3)) * rim * uDream * 1.3;
  col += dreamLines(vWorldPos, dist) * 0.45;
  col += albedo * boomLight(vWorldPos, N);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, uOpacity);
}
`;

export function createPropMaterial(shared, opts = {}) {
  return new THREE.ShaderMaterial({
    name: 'props',
    uniforms: { ...shared, uEmissiveBoost: { value: 2.3 }, uOpacity: { value: 1 } },
    vertexShader: propVert,
    fragmentShader: propFrag,
    side: THREE.DoubleSide,
    ...opts,
  });
}

const waterVert = /* glsl */ `
attribute float aDepth;
attribute vec4 aTint;
varying vec3 vWorldPos;
varying float vDepth;
varying vec4 vTint;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vDepth = aDepth;
  vTint = vec4(pow(aTint.rgb, vec3(2.2)), aTint.a);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const waterFrag = /* glsl */ `
${GLSL}
varying vec3 vWorldPos;
varying float vDepth;
varying vec4 vTint;

const float K = 6.28318530718 / 4096.0; // wave vectors are integer multiples -> periodic over 4096 m

vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 k; float ph;
  k = vec2(70.0, 30.0) * K;    ph = dot(k, p) - t * 1.05; g += k * cos(ph) * (0.060 / length(k));
  k = vec2(-55.0, 85.0) * K;   ph = dot(k, p) - t * 1.22; g += k * cos(ph) * (0.050 / length(k));
  k = vec2(120.0, -95.0) * K;  ph = dot(k, p) - t * 1.55; g += k * cos(ph) * (0.042 / length(k));
  k = vec2(-160.0, -140.0) * K; ph = dot(k, p) - t * 1.80; g += k * cos(ph) * (0.036 / length(k));
  k = vec2(240.0, 200.0) * K;  ph = dot(k, p) - t * 2.20; g += k * cos(ph) * (0.030 / length(k));
  k = vec2(-330.0, 150.0) * K; ph = dot(k, p) - t * 2.45; g += k * cos(ph) * (0.026 / length(k));
  return g;
}

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vWorldPos.xz;
  float t = uTime;
  float kind = floor(vTint.a * 3.0 + 0.5); // 0 water, 1 lava, 2 mercury, 3 black mirror

  if (kind > 0.5 && kind < 1.5) {
    float n1 = tnoise(p * (1.0 / 16.0) + vec2(t * 0.03, t * 0.05), 256.0);
    float n2 = tnoise(p * 0.25 - vec2(t * 0.12, -t * 0.05), 1024.0);
    float crust = smoothstep(0.32, 0.62, n1 * 0.6 + n2 * 0.4);
    vec3 hot = vec3(2.4, 0.55, 0.1);
    vec3 cool = vec3(0.05, 0.012, 0.01);
    vec3 col = mix(hot, cool, crust);
    col *= 0.85 + 0.15 * sin(t * 1.4 + n1 * 9.0);
    col += vec3(1.2, 0.35, 0.06) * smoothstep(1.2, 0.0, vDepth);
    if (uDream > 0.01) col = mix(col, hueRotate(col, uDream * 2.0 * sin(t * 0.05)), uDream * 0.5);
    col = applyFog(col, vWorldPos, 0.85);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float calm = kind > 2.5 ? 0.25 : kind > 1.5 ? 0.45 : 1.0;
  float atten = calm / (1.0 + dist * 0.005);
  vec2 g = waveSlope(p, t) * atten;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(N, V), 0.0);
  float f0 = kind > 2.5 ? 0.1 : kind > 1.5 ? 0.55 : 0.02;
  float fres = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  float dpt = max(vDepth, 0.0);
  vec3 tint = vTint.rgb;
  vec3 deep = tint * 0.28;
  vec3 shallow = tint * 1.35 + vec3(0.03, 0.07, 0.07);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 16.0, dpt));
  vec3 lit = body * (uAmbSky * 1.0 + uSunColor * clamp(uSunDir.y + 0.25, 0.0, 1.0) * 0.55);
  if (kind > 1.5 && kind < 2.5) {
    // liquid mercury: a chrome mirror full of colour
    refl *= 0.55 + 0.6 * neonPalette(fres * 1.5 + t * 0.03 + tnoise(p / 64.0, 64.0));
    lit = tint * uAmbSky * 0.6;
  }
  if (kind > 2.5) {
    // black mirror: still, dark, reflecting everything
    lit *= 0.3;
    refl = refl * 0.85 + vec3(0.06, 0.0, 0.02) * fres;
  }
  if (uDream > 0.01) refl = mix(refl, refl * (0.6 + 0.8 * neonPalette(fres * 2.0 + t * 0.04)), uDream * 0.6);
  vec3 col = mix(lit, refl, clamp(fres * (kind > 1.5 ? 1.0 : 0.62), 0.0, 1.0));

  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 700.0);
  col += uSunColor * spec * 2.6 * cloudShadow(p);

  float foam = 0.0;
  if (kind < 0.5) {
    float fn = tnoise(p * 0.25 + vec2(t * 0.15, t * 0.1), 1024.0);
    float foamLine = smoothstep(0.85, 0.0, dpt + (fn - 0.5) * 0.6);
    float bands = smoothstep(0.65, 1.0, sin(dpt * 3.4 - t * 1.4 + fn * 2.0) * 0.5 + 0.5) * smoothstep(1.9, 0.3, dpt);
    foam = clamp(foamLine + bands * fn * 0.7, 0.0, 1.0);
    vec3 foamCol = uSunColor * clamp(uSunDir.y + 0.2, 0.0, 1.0) * 0.55 + uAmbSky * 1.1;
    col = mix(col, foamCol, foam * 0.85);
  }
  col += boomLight(vWorldPos, N) * 0.5;

  float alpha = mix(0.55, 0.95, smoothstep(0.0, 7.0, dpt));
  if (kind > 1.5) alpha = mix(0.8, 0.98, smoothstep(0.0, 3.0, dpt));
  alpha = max(alpha, max(foam * 0.9, fres));
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createWaterMaterial(shared) {
  return new THREE.ShaderMaterial({
    name: 'water',
    uniforms: { ...shared },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: true,
  });
}
