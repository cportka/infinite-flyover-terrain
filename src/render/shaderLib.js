// Shared GLSL. Every world-space pattern here is periodic with a period that
// divides REBASE_STEP (4096 m) so floating-origin rebases are invisible.
// (2*pi/4096 = 0.0015339808)

export const COMMON_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;      // key light direction (sun by day, moon by night)
uniform vec3 uSunColor;    // key light colour * intensity (linear HDR)
uniform vec3 uSunDisc;     // actual sun direction (sky disc + glow)
uniform vec3 uMoonDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uFogDensity;
uniform float uHeightFog;
uniform float uHeightFalloff;
uniform float uNight;
uniform float uGlow;
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform float uDream;      // 0 = as real as we can make it, 1 = full neon dream
uniform vec3 uNeonA;
uniform vec3 uNeonB;
uniform vec3 uBoomPos;     // explosion light (scene space)
uniform vec3 uBoomColor;
uniform float uBoomRadius;
`;

export const COMMON_FUNCS = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise with an integer lattice period (seamless tiling).
float tnoise(vec2 x, float period) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, period);
  vec2 i1 = mod(i + 1.0, period);
  float a = hash12(i0);
  float b = hash12(vec2(i1.x, i0.y));
  float c = hash12(vec2(i0.x, i1.y));
  float d = hash12(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

// Inigo Quilez cosine palette: smooth neon rainbow
vec3 neonPalette(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
}

vec3 skyColor(vec3 dir) {
  float y = dir.y;
  float t = pow(clamp(1.0 - y, 0.0, 1.0), 3.2);
  vec3 col = mix(uSkyTop, uSkyHorizon, t);
  col = mix(col, uSkyHorizon * 0.9 + uAmbGround * 0.1, clamp(-y * 2.5, 0.0, 1.0));
  float sd = max(dot(dir, uSunDisc), 0.0);
  float glow = pow(sd, 6.0) * 0.16 + pow(sd, 32.0) * 0.32 + pow(sd, 260.0) * 0.9;
  col += uSkyGlow * glow * (0.55 + 0.45 * t);
  if (uDream > 0.01) {
    // the sky (and therefore the haze) slowly drifts through impossible hues
    float a = uDream * (0.9 * sin(uTime * 0.031 + dir.x * 1.7 + dir.z * 0.9) + 0.5 * sin(uTime * 0.017));
    col = mix(col, hueRotate(col, a) * (1.0 + 0.15 * uDream), uDream * 0.75);
  }
  return col;
}

// Aerial perspective: exp2 distance fog + analytic exponential height fog.
float fogAmount(vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  float kd = dist * uFogDensity;
  float tau = kd * kd;
  float b = uHeightFalloff;
  float k = rd.y * b;
  float hInt = abs(k) < 1e-5 ? dist : (1.0 - exp(-dist * k)) / k;
  tau += uHeightFog * exp(-max(cameraPosition.y, 0.0) * b) * max(hInt, 0.0);
  return 1.0 - exp(-tau);
}

vec3 applyFog(vec3 col, vec3 wpos, float amount) {
  vec3 rd = normalize(wpos - cameraPosition);
  return mix(col, skyColor(rd), fogAmount(wpos) * amount);
}

vec3 applyFog(vec3 col, vec3 wpos) {
  return applyFog(col, wpos, 1.0);
}

float cloudShadow(vec2 xz) {
  vec2 p = xz * (1.0 / 256.0) + uCloudOffset;
  float n = tnoise(p, 16.0) * 0.65 + tnoise(p * 2.0 + 3.0, 32.0) * 0.35;
  return 1.0 - smoothstep(0.5, 0.78, n) * 0.5 * uCloudCover * (1.0 - uNight);
}

// Face normal from screen-space derivatives. Edge-on or sub-pixel triangles
// give a zero cross product; never let that become a NaN (bloom would smear
// a single NaN pixel across the whole screen).
vec3 flatNormal(vec3 wpos) {
  vec3 c = cross(dFdx(wpos), dFdy(wpos));
  float l = length(c);
  return l > 1e-12 ? c / l : vec3(0.0, 1.0, 0.0);
}

// Light thrown by an explosion.
vec3 boomLight(vec3 wpos, vec3 N) {
  if (uBoomRadius <= 0.0) return vec3(0.0);
  vec3 L = uBoomPos - wpos;
  float d = length(L);
  float att = 1.0 / (1.0 + 4.0 * d * d / (uBoomRadius * uBoomRadius));
  att *= 1.0 - smoothstep(uBoomRadius, uBoomRadius * 2.5, d);
  return uBoomColor * (0.35 + 0.65 * max(dot(N, L / max(d, 1e-3)), 0.0)) * att;
}

// Dream phase: neon contour lines climbing the land, and pulses rolling out from the viewer.
vec3 dreamLines(vec3 p, float dist) {
  if (uDream < 0.01) return vec3(0.0);
  float cy = p.y / 9.0 - uTime * 0.12;
  float fw = fwidth(cy);
  float dl = abs(fract(cy + 0.5) - 0.5);
  float line = (1.0 - smoothstep(fw * 0.35, fw * 1.15, dl)) * (1.0 - smoothstep(0.18, 0.42, fw));
  float hue = p.y * 0.006 + uTime * 0.025 + 0.15 * sin(p.x * 0.0015339808 + uTime * 0.1) + 0.15 * sin(p.z * 0.0030679616);
  vec3 c = mix(neonPalette(hue), mix(uNeonA, uNeonB, 0.5 + 0.5 * sin(hue * 6.2831853)), 0.3);
  c = max(c - 0.25 * dot(c, vec3(0.33)), 0.0) * 1.35; // push towards saturated neon
  float pr = mod(uTime, 7.0) / 7.0;
  float ring = exp(-abs(dist - pr * 1500.0) / 9.0) * (1.0 - pr);
  return c * (line * 0.95 + ring * 1.6) * uDream;
}
`;

export const GLSL = COMMON_UNIFORMS + COMMON_FUNCS;
