// Shared GLSL. Every world-space pattern here is periodic with a period that
// divides REBASE_STEP (4096 m) so floating-origin rebases are invisible.

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

vec3 skyColor(vec3 dir) {
  float y = dir.y;
  float t = pow(clamp(1.0 - y, 0.0, 1.0), 3.2);
  vec3 col = mix(uSkyTop, uSkyHorizon, t);
  // below the horizon: a slightly denser haze
  col = mix(col, uSkyHorizon * 0.9 + uAmbGround * 0.1, clamp(-y * 2.5, 0.0, 1.0));
  float sd = max(dot(dir, uSunDisc), 0.0);
  float glow = pow(sd, 6.0) * 0.16 + pow(sd, 32.0) * 0.32 + pow(sd, 260.0) * 0.9;
  col += uSkyGlow * glow * (0.55 + 0.45 * t);
  return col;
}

// Aerial perspective: exp2 distance fog + analytic exponential height fog,
// fading into the exact sky colour behind the fragment.
vec3 applyFog(vec3 col, vec3 wpos, float amount) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  float kd = dist * uFogDensity;
  float tau = kd * kd;
  float b = uHeightFalloff;
  float k = rd.y * b;
  float hInt = abs(k) < 1e-5 ? dist : (1.0 - exp(-dist * k)) / k;
  tau += uHeightFog * exp(-max(cameraPosition.y, 0.0) * b) * max(hInt, 0.0);
  float f = (1.0 - exp(-tau)) * amount;
  return mix(col, skyColor(rd), f);
}

vec3 applyFog(vec3 col, vec3 wpos) {
  return applyFog(col, wpos, 1.0);
}

vec3 diffuseLight(vec3 N) {
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  return uSunColor * wrap + hemi;
}

float cloudShadow(vec2 xz) {
  vec2 p = xz * (1.0 / 256.0) + uCloudOffset;
  float n = tnoise(p, 16.0) * 0.65 + tnoise(p * 2.0 + 3.0, 32.0) * 0.35;
  return 1.0 - smoothstep(0.5, 0.78, n) * 0.5 * uCloudCover * (1.0 - uNight);
}

vec3 flatNormal(vec3 wpos) {
  return normalize(cross(dFdx(wpos), dFdy(wpos)));
}
`;

export const GLSL = COMMON_UNIFORMS + COMMON_FUNCS;
