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
  };
}

const terrainVert = /* glsl */ `
attribute vec4 aColor;
attribute float aMat;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vColor;
varying float vStrata;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normal;
  vStrata = aMat;
  vColor = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
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
varying float vStrata;

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
  vec3 sN = normalize(vNormal);
  vec3 fN = flatNormal(vWorldPos);
  if (dot(fN, sN) < 0.0) fN = -fN;
  // keep facets on gentle terrain, smooth out steep walls (avoids grid chevrons)
  float facet = uFacet * mix(1.0, 0.3, smoothstep(0.3, 0.65, 1.0 - sN.y));
  vec3 N = normalize(mix(sN, fN, facet));
  float dist = distance(vWorldPos, cameraPosition);

  vec3 albedo = vColor.rgb;
  if (vStrata > 0.004) albedo = mix(albedo, strataColor(vWorldPos), vStrata);
  // large soft patches + fine speckle (faded with distance to avoid shimmer)
  float patchN = tnoise(vWorldPos.xz * (1.0 / 16.0), 256.0);
  float speck = tnoise(vWorldPos.xz * 0.5, 2048.0);
  albedo *= 0.94 + 0.12 * patchN;
  albedo *= mix(0.9 + 0.2 * speck, 1.0, smoothstep(60.0, 220.0, dist));

  // underwater: darker, blue-green
  float uw = smoothstep(0.0, -7.0, vWorldPos.y);
  albedo = mix(albedo, albedo * vec3(0.38, 0.55, 0.62), uw);

  float shadow = cloudShadow(vWorldPos.xz);
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + 0.2) / 1.2, 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * wrap * shadow + hemi);

  // emissive veins / moss
  col += albedo * vColor.a * uGlow * 1.4;

  col = applyFog(col, vWorldPos);
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
uniform float uTime;
uniform float uWind;
varying vec3 vWorldPos;
varying vec4 vColor;
varying float vFlag;
varying float vPhase;
void main() {
  vec3 p = position;
  float sway = aData.x * 2.0;
  float ph = aData.y * 6.2831853;
  if (sway > 0.0) {
    float t = uTime;
    float g = sin(t * 0.6 + ph * 0.3) * 0.5 + 0.5; // gusts
    p.x += sway * uWind * (sin(t * 1.7 + ph) * 0.6 + sin(t * 3.3 + ph * 2.1) * 0.22) * (0.5 + g);
    p.z += sway * uWind * (cos(t * 1.3 + ph * 1.7) * 0.45) * (0.5 + g);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vColor = vec4(pow(aColor.rgb, vec3(2.2)), aColor.a);
  vFlag = aData.z * 255.0;
  vPhase = ph;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const propFrag = /* glsl */ `
${GLSL}
uniform float uEmissiveBoost;
varying vec3 vWorldPos;
varying vec4 vColor;
varying float vFlag;
varying float vPhase;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = flatNormal(vWorldPos);
  // derivative sign conventions vary between drivers: always face the viewer
  if (dot(N, V) < 0.0) N = -N;
  // grass & flower stems: light like the ground so they blend into the terrain
  if (vFlag > 2.5 && vFlag < 3.5) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.8));
  vec3 albedo = vColor.rgb;
  float shadow = cloudShadow(vWorldPos.xz);
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * wrap * shadow + hemi);

  if ((vFlag > 0.5 && vFlag < 1.5) || (vFlag > 2.5 && vFlag < 3.5)) {
    // foliage: soft translucency when backlit
    float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
    col += albedo * uSunColor * back * 0.55 * shadow;
  }
  float em = vColor.a;
  if (em > 0.0) {
    float pulse = (vFlag > 1.5 && vFlag < 2.5) ? 0.72 + 0.28 * sin(uTime * 1.8 + vPhase * 3.0) : 1.0;
    col += albedo * em * uGlow * pulse * uEmissiveBoost;
  }
  // gentle rim light keeps silhouettes readable against the haze
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uSkyHorizon * rim * 0.12;

  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createPropMaterial(shared) {
  return new THREE.ShaderMaterial({
    name: 'props',
    uniforms: { ...shared, uEmissiveBoost: { value: 2.3 } },
    vertexShader: propVert,
    fragmentShader: propFrag,
    side: THREE.DoubleSide,
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

  if (vTint.a > 0.5) {
    // ---- lava
    float n1 = tnoise(p * (1.0 / 16.0) + vec2(t * 0.03, t * 0.05), 256.0);
    float n2 = tnoise(p * 0.25 - vec2(t * 0.12, -t * 0.05), 1024.0);
    float crust = smoothstep(0.32, 0.62, n1 * 0.6 + n2 * 0.4);
    vec3 hot = vec3(2.4, 0.55, 0.1);
    vec3 cool = vec3(0.05, 0.012, 0.01);
    vec3 col = mix(hot, cool, crust);
    col *= 0.85 + 0.15 * sin(t * 1.4 + n1 * 9.0);
    float edge = smoothstep(1.2, 0.0, vDepth);
    col += vec3(1.2, 0.35, 0.06) * edge;
    col = applyFog(col, vWorldPos, 0.85);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float atten = 1.0 / (1.0 + dist * 0.005);
  vec2 g = waveSlope(p, t) * atten;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  float dpt = max(vDepth, 0.0);
  vec3 tint = vTint.rgb;
  vec3 deep = tint * 0.28;
  vec3 shallow = tint * 1.35 + vec3(0.03, 0.07, 0.07);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 16.0, dpt));
  vec3 lit = body * (uAmbSky * 1.0 + uSunColor * clamp(uSunDir.y + 0.25, 0.0, 1.0) * 0.55);
  vec3 col = mix(lit, refl, fres * 0.62);

  // sun glitter
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 700.0);
  col += uSunColor * spec * 2.6 * cloudShadow(p);

  // shoreline foam
  float fn = tnoise(p * 0.25 + vec2(t * 0.15, t * 0.1), 1024.0);
  float foamLine = smoothstep(0.85, 0.0, dpt + (fn - 0.5) * 0.6);
  float bands = smoothstep(0.65, 1.0, sin(dpt * 3.4 - t * 1.4 + fn * 2.0) * 0.5 + 0.5) * smoothstep(1.9, 0.3, dpt);
  float foam = clamp(foamLine + bands * fn * 0.7, 0.0, 1.0);
  vec3 foamCol = uSunColor * clamp(uSunDir.y + 0.2, 0.0, 1.0) * 0.55 + uAmbSky * 1.1;
  col = mix(col, foamCol, foam * 0.85);

  float alpha = mix(0.55, 0.95, smoothstep(0.0, 7.0, dpt));
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
