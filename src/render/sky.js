import * as THREE from 'three';
import { GLSL } from './shaderLib.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */ `
${GLSL}
uniform float uStars;
uniform float uAurora;
uniform vec3 uMoonColor;
uniform vec3 uPlanetDir;
uniform float uPlanet;
varying vec3 vDir;

// The dream planet: a vast ringed world hanging over the horizon.
vec3 planet(vec3 dir, vec3 col) {
  vec3 pd = uPlanetDir;
  if (dot(dir, pd) < 0.85) return col;
  vec3 t1 = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(t1, pd);
  float R = 0.13;
  vec2 uv = vec2(dot(dir, t1), dot(dir, t2)) / R;
  float r2 = dot(uv, uv);
  float ca = cos(0.35);
  float sa = sin(0.35);
  vec2 ru = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
  float re = length(vec2(ru.x, ru.y * 4.2));
  float band = smoothstep(1.35, 1.45, re) * (1.0 - smoothstep(2.05, 2.25, re)) * (0.55 + 0.45 * sin(re * 26.0));
  vec3 ringCol = mix(uNeonA, uNeonB, 0.5 + 0.5 * sin(re * 7.0)) * 0.9 + 0.25;
  float a = uPlanet;
  vec3 o = col;
  if (ru.y >= 0.0 && r2 >= 1.0) o = mix(o, ringCol, band * a * 0.8);
  if (r2 < 1.0) {
    vec3 n = vec3(uv, sqrt(1.0 - r2));
    vec3 L = normalize(vec3(-0.6, 0.5, 0.62));
    float lam = clamp(dot(n, L), 0.0, 1.0);
    float bands = 0.5 + 0.5 * sin(uv.y * 9.0 + sin(uv.x * 3.0 + uTime * 0.02) * 1.5);
    vec3 surf = mix(vec3(0.78, 0.62, 0.92), vec3(0.32, 0.26, 0.52), bands) * (0.06 + 1.05 * lam);
    surf += mix(uNeonA, uNeonB, 0.5) * pow(1.0 - n.z, 3.0) * 0.8;
    o = mix(o, surf, a * smoothstep(1.0, 0.96, r2));
  }
  if (ru.y < 0.0) o = mix(o, ringCol, band * a * 0.9);
  return o;
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec3 aurora(vec3 dir) {
  if (dir.y < 0.0) return vec3(0.0);
  float az = atan(dir.x, -dir.z) / 6.2831853 + 0.5;
  float el = dir.y;
  float wave = tnoise(vec2(az * 7.0 + uTime * 0.006, 0.5), 7.0);
  float wave2 = tnoise(vec2(az * 19.0 - uTime * 0.01, 4.5), 19.0);
  float base = 0.07 + wave * 0.13 + wave2 * 0.04;
  float shape = smoothstep(base, base + 0.035, el) * (1.0 - smoothstep(base + 0.05, base + 0.32 + wave2 * 0.1, el));
  float rays = tnoise(vec2(az * 110.0 + uTime * 0.04, uTime * 0.03), 110.0);
  float mask = smoothstep(0.3, 0.75, tnoise(vec2(az * 3.0 - uTime * 0.004, 3.7), 3.0));
  vec3 c = mix(vec3(0.1, 1.0, 0.5), vec3(0.55, 0.22, 1.0), smoothstep(base + 0.04, base + 0.3, el));
  return c * shape * (0.3 + 0.7 * rays) * mask;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);

  // high wispy cloud layer
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.12) * 0.9 + uCloudOffset * 0.06;
    float c = tnoise(uv * 1.2, 1000.0) * 0.55 + tnoise(uv * 2.7 + 7.0, 1000.0) * 0.3 + tnoise(uv * 6.3 + 3.0, 1000.0) * 0.15;
    c = smoothstep(0.5, 0.82, c) * smoothstep(0.0, 0.25, dir.y) * uCloudCover;
    float sd = max(dot(dir, uSunDisc), 0.0);
    vec3 lit = uSkyHorizon * 1.08 + uSkyGlow * 0.35 + uSunColor * 0.08;
    vec3 cc = mix(lit, uSunColor * 0.25 + uSkyGlow * 0.9, pow(sd, 6.0));
    cc = mix(cc, uSkyTop * 1.6 + uAmbSky * 0.4, uNight * 0.75);
    col = mix(col, cc, c * 0.6);
  }

  // sun disc (HDR so bloom picks it up)
  float sd = dot(dir, uSunDisc);
  float disc = smoothstep(0.99955, 0.99982, sd);
  col += uSunColor * disc * 7.0 * smoothstep(-0.04, 0.02, uSunDisc.y);

  // moon
  float md = dot(dir, uMoonDir);
  float moon = smoothstep(0.99935, 0.99958, md);
  col += uMoonColor * (moon * 2.6 + pow(max(md, 0.0), 400.0) * 0.25) * uNight;

  // stars
  if (uStars > 0.01 && dir.y > -0.05) {
    vec3 sp = dir * 150.0;
    vec3 cell = floor(sp);
    vec3 h = hash33(cell);
    vec3 cpos = cell + 0.2 + 0.6 * h;
    float d = length(sp - cpos);
    float star = smoothstep(0.24, 0.0, d) * step(0.68, h.x);
    float tw = 0.6 + 0.4 * sin(uTime * (1.3 + 3.0 * h.y) + h.z * 40.0);
    vec3 sc = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.86, 0.7), h.z);
    col += sc * star * tw * uStars * 1.8 * smoothstep(-0.05, 0.2, dir.y);
  }

  if (uAurora > 0.01) col += aurora(dir) * uAurora * 0.9;
  if (uPlanet > 0.01) col = planet(dir, col);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(shared) {
  const material = new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: {
      ...shared,
      uStars: { value: 0 },
      uAurora: { value: 0 },
      uMoonColor: { value: new THREE.Color(0.85, 0.9, 1.0) },
      uPlanetDir: { value: new THREE.Vector3(-0.55, 0.26, -0.8).normalize() },
      uPlanet: { value: 0 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.scale.setScalar(1000);
  mesh.matrixAutoUpdate = true;
  return mesh;
}
