import * as THREE from 'three';
import { GLSL } from './shaderLib.js';
import { ico } from '../world/props.js';
import { mulberry32 } from '../world/noise.js';

// ---------------------------------------------------------------- particles

const particleVert = /* glsl */ `
attribute vec4 aRnd;
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uSwirl;
uniform float uSize;
uniform float uAmount;
uniform float uPixel;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uLight;
uniform float uFlicker;
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
void main() {
  vec3 p = position + uVel * uTime * (0.6 + aRnd.x * 0.8);
  float tt = uTime;
  p.x += sin(tt * (0.25 + aRnd.x * 0.5) + aRnd.y * 6.28) * uSwirl;
  p.z += cos(tt * (0.2 + aRnd.z * 0.5) + aRnd.x * 6.28) * uSwirl;
  p.y += sin(tt * (0.3 + aRnd.w * 0.4) + aRnd.z * 6.28) * uSwirl * 0.5;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.65, 1.0, max(max(e.x, e.y), e.z));
  float keep = step(aRnd.w, uAmount);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.5);
  gl_PointSize = clamp(uSize * (0.6 + aRnd.x * 0.8) * uPixel / dist, 0.0, 48.0) * keep;
  float flick = mix(1.0, 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (1.5 + aRnd.y * 2.5) + aRnd.z * 40.0), 2.0), uFlicker);
  vAlpha = edge * keep * smoothstep(0.8, 4.0, dist) * flick;
  vColor = mix(uColorA, uColorB, aRnd.y) * uLight;
  vRot = aRnd.z * 6.28 + uTime * (aRnd.x - 0.5) * 4.0;
}
`;

const particleFrag = /* glsl */ `
uniform float uShape;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (uShape > 0.5) {
    float cs = cos(vRot);
    float sn = sin(vRot);
    vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
    r.x *= 2.3;
    a = smoothstep(0.5, 0.32, length(r));
  } else {
    a = smoothstep(0.5, 0.0, length(c));
    a *= a;
  }
  float alpha = a * vAlpha * uOpacity;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

export class Particles {
  constructor({ count = 1600, box = [256, 128, 256], additive = false, seed = 1 } = {}) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const rr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() * box[0];
      pos[i * 3 + 1] = rnd() * box[1];
      pos[i * 3 + 2] = rnd() * box[2];
      rr[i * 4] = rnd();
      rr[i * 4 + 1] = rnd();
      rr[i * 4 + 2] = rnd();
      rr[i * 4 + 3] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rr, 4));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(...box) },
        uVel: { value: new THREE.Vector3(0, -1, 0) },
        uSwirl: { value: 1 },
        uSize: { value: 0.3 },
        uAmount: { value: 1 },
        uPixel: { value: 800 },
        uColorA: { value: new THREE.Color(1, 1, 1) },
        uColorB: { value: new THREE.Color(1, 1, 1) },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uFlicker: { value: 0 },
        uShape: { value: 0 },
        uOpacity: { value: 1 },
      },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.additive = additive;
    this.tmpA = new THREE.Color();
    this.tmpB = new THREE.Color();
  }

  /** p: blended preset { color, color2, size, amount, fall, swirl, shape, rise } */
  apply(p, light, opacity, time, pixel, flicker = 0) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uPixel.value = pixel;
    u.uColorA.value.setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace);
    u.uColorB.value.setRGB(p.color2[0], p.color2[1], p.color2[2], THREE.SRGBColorSpace);
    u.uLight.value.copy(light);
    u.uSize.value = p.size;
    u.uAmount.value = p.amount;
    u.uVel.value.set(p.drift || 0, (p.rise || 0) - (p.fall || 0), (p.driftZ || 0));
    u.uSwirl.value = p.swirl;
    u.uShape.value = p.shape || 0;
    u.uOpacity.value = opacity;
    u.uFlicker.value = flicker;
  }
}

// ---------------------------------------------------------------- clouds

const cloudVert = /* glsl */ `
attribute vec4 aCenter;
attribute vec4 aPuff;
uniform float uTime;
uniform vec2 uCloudWind;
uniform float uCloudCover;
varying vec3 vWorldPos;
varying float vShade;
varying vec3 vSphereN;
void main() {
  vSphereN = normalize(position);
  vec2 c = aCenter.xz + uCloudWind * uTime;
  vec2 rel = mod(c - cameraPosition.xz + 2048.0, 4096.0) - 2048.0;
  float far = 1.0 - smoothstep(1500.0, 2000.0, length(rel));
  float vis = smoothstep(aCenter.w - 0.08, aCenter.w + 0.08, uCloudCover) * far;
  vec3 center = vec3(cameraPosition.x + rel.x, aCenter.y, cameraPosition.z + rel.y);
  vec3 wp = center + aPuff.xyz + position * aPuff.w * vis * vec3(1.0, 0.62, 1.0);
  vWorldPos = wp;
  vShade = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const cloudFrag = /* glsl */ `
${GLSL}
varying vec3 vWorldPos;
varying float vShade;
varying vec3 vSphereN;
void main() {
  float dist = distance(vWorldPos, cameraPosition);
  float fade = smoothstep(30.0, 110.0, dist);
  if (hash12(floor(gl_FragCoord.xy)) > fade) discard;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 fN = flatNormal(vWorldPos);
  vec3 sN = normalize(vSphereN);
  if (dot(fN, sN) < 0.0) fN = -fN;
  vec3 N = normalize(mix(fN, sN, 0.65));
  float ndl = dot(N, uSunDir);
  float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
  vec3 col = uSunColor * 0.34 * wrap + uAmbSky * 1.5 + uSkyHorizon * 0.35;
  col *= mix(0.8, 1.06, clamp(vShade * 0.5 + 0.5, 0.0, 1.0));
  // silver lining / forward scattering when looking towards the sun
  float back = pow(max(dot(-V, uSunDisc), 0.0), 4.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  col += (uSkyGlow * 0.6 + uSunColor * 0.12) * back * (0.4 + rim);
  col += uSkyHorizon * rim * 0.25;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Clouds {
  constructor(shared, { clusters = 70, seed = 7 } = {}) {
    const rnd = mulberry32(seed);
    const base = ico(1, 1, 0.12, rnd);
    const posArr = [];
    for (let i = 0; i < base.f.length; i++) {
      const k = base.f[i] * 3;
      posArr.push(base.v[k], base.v[k + 1], base.v[k + 2]);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
    const centers = [];
    const puffs = [];
    for (let c = 0; c < clusters; c++) {
      const cx = rnd() * 4096;
      const cz = rnd() * 4096;
      const cy = 230 + rnd() * 200;
      const thr = rnd();
      const n = 5 + Math.floor(rnd() * 5);
      const spread = 40 + rnd() * 60;
      for (let p = 0; p < n; p++) {
        const a = rnd() * Math.PI * 2;
        const r = rnd() * spread;
        centers.push(cx, cy, cz, thr);
        const s = (24 + rnd() * 34) * (1 - (r / spread) * 0.45);
        puffs.push(Math.cos(a) * r, rnd() * 18 - (r / spread) * 10, Math.sin(a) * r * 0.7, s);
      }
    }
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 4));
    g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
    g.instanceCount = centers.length / 4;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uCloudWind: { value: new THREE.Vector2(3.2, 1.4) } },
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }
}

// ---------------------------------------------------------------- birds

const birdVert = /* glsl */ `
attribute float aWing;
attribute vec4 aFlock;
attribute vec4 aBird;
uniform float uTime;
uniform float uDay;
varying vec3 vWorldPos;
void main() {
  float hd = aFlock.w;
  vec2 dir = vec2(sin(hd), -cos(hd));
  vec2 fc = aFlock.xz + dir * 13.0 * uTime;
  vec2 rel = mod(fc - cameraPosition.xz + 1024.0, 2048.0) - 1024.0;
  float far = 1.0 - smoothstep(850.0, 1000.0, length(rel));
  float ph = aBird.w * 6.2831853;
  vec3 center = vec3(cameraPosition.x + rel.x, aFlock.y + sin(uTime * 0.35 + ph) * 3.0, cameraPosition.z + rel.y);
  vec3 p = position * (1.0 + aBird.w * 0.4) * uDay * far;
  float flap = sin(uTime * 7.0 + ph * 3.0);
  p.y += abs(aWing) * flap * 0.9 * uDay * far;
  vec3 lo = aBird.xyz;
  float c = cos(hd);
  float s = sin(hd);
  vec3 q = p + lo;
  vec3 r = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  vec3 wp = center + r;
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const birdFrag = /* glsl */ `
${GLSL}
varying vec3 vWorldPos;
void main() {
  vec3 col = vec3(0.05, 0.05, 0.06) * (uAmbSky * 2.0 + uSunColor * 0.15);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Birds {
  constructor(shared, { flocks = 26, seed = 11 } = {}) {
    const rnd = mulberry32(seed);
    // body + two wings (forward = -z), wingspan ~3.2 m
    const v = [
      // body
      0, 0, -0.9, 0.18, 0, 0.3, -0.18, 0, 0.3,
      0, 0, 0.3, 0.12, 0, 0.9, -0.12, 0, 0.9,
      // left wing (two tris)
      -0.15, 0, -0.35, -0.15, 0, 0.35, -0.9, 0, 0.05,
      -0.9, 0, 0.05, -0.9, 0, -0.15, -1.6, 0, 0.35,
      // right wing
      0.15, 0, -0.35, 0.15, 0, 0.35, 0.9, 0, 0.05,
      0.9, 0, 0.05, 0.9, 0, -0.15, 1.6, 0, 0.35,
    ];
    const wing = [];
    for (let i = 0; i < v.length; i += 3) wing.push(Math.min(1, Math.abs(v[i]) / 1.6) * (Math.abs(v[i]) > 0.2 ? 1 : 0));
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(wing), 1));
    const fl = [];
    const bd = [];
    for (let f = 0; f < flocks; f++) {
      const x = rnd() * 2048;
      const z = rnd() * 2048;
      const y = 45 + rnd() * 120;
      const hd = (rnd() - 0.5) * Math.PI * 1.6;
      const n = 5 + Math.floor(rnd() * 7);
      for (let b = 0; b < n; b++) {
        const side = b % 2 ? 1 : -1;
        const rank = Math.ceil(b / 2);
        fl.push(x, y, z, hd);
        bd.push(side * rank * 3.2 + (rnd() - 0.5), (rnd() - 0.5) * 1.5, rank * 3.0 + (rnd() - 0.5), rnd());
      }
    }
    g.setAttribute('aFlock', new THREE.InstancedBufferAttribute(new Float32Array(fl), 4));
    g.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(bd), 4));
    g.instanceCount = fl.length / 4;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uDay: { value: 1 } },
      vertexShader: birdVert,
      fragmentShader: birdFrag,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }
}

// ---------------------------------------------------------------- neon shapes (dream phase)

function baryGeometry(geo) {
  // expand an indexed {v, f} into a non-indexed geometry with barycentric coordinates
  const pos = [];
  const bary = [];
  for (let i = 0; i < geo.f.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const vi = geo.f[i + k] * 3;
      pos.push(geo.v[vi], geo.v[vi + 1], geo.v[vi + 2]);
      bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
    }
  }
  return { pos: new Float32Array(pos), bary: new Float32Array(bary) };
}

const OCTA = {
  v: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
  f: [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 0, 4, 3, 4, 1, 3, 1, 5, 3, 5, 0, 3],
};
const TETRA = {
  v: [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1].map((x) => x * 0.8),
  f: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2],
};

const neonVert = /* glsl */ `
attribute vec3 aBary;
attribute vec4 aCenter;
attribute vec4 aParams;
uniform float uTime;
uniform float uDream;
varying vec3 vBary;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vHue;
varying float vVis;
mat3 rotAxis(vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  float t = 1.0 - c;
  return mat3(
    t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
}
void main() {
  vec2 rel = mod(aCenter.xz - cameraPosition.xz + 2048.0, 4096.0) - 2048.0;
  float far = 1.0 - smoothstep(1500.0, 1950.0, length(rel));
  float vis = smoothstep(aParams.w, aParams.w + 0.2, uDream) * far;
  vec3 axis = normalize(vec3(sin(aCenter.w * 12.9), cos(aCenter.w * 7.3), sin(aCenter.w * 3.1 + 1.0)));
  mat3 R = rotAxis(axis, uTime * aParams.y + aCenter.w * 6.28);
  vec3 lp = R * (position * aParams.x * vis);
  vec3 center = vec3(cameraPosition.x + rel.x, aCenter.y + sin(uTime * 0.25 + aCenter.w * 9.0) * 8.0, cameraPosition.z + rel.y);
  vec3 wp = center + lp;
  vWorldPos = wp;
  vBary = aBary;
  vHue = aParams.z;
  vVis = vis;
  vN = R * normalize(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const neonFrag = /* glsl */ `
${GLSL}
varying vec3 vBary;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vHue;
varying float vVis;
void main() {
  if (vVis < 0.01) discard;
  float e = min(vBary.x, min(vBary.y, vBary.z));
  float fw = fwidth(e);
  float edge = 1.0 - smoothstep(fw * 0.8, fw * 2.2 + 0.012, e);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  vec3 c = mix(neonPalette(vHue + uTime * 0.04), mix(uNeonA, uNeonB, 0.5 + 0.5 * sin(uTime * 0.3 + vHue * 6.0)), 0.35);
  vec3 col = c * (edge * 3.2 + 0.04 + fres * 0.3);
  col *= 1.0 - fogAmount(vWorldPos) * 0.85;
  gl_FragColor = vec4(col * vVis, 1.0);
}
`;

const pillarVert = /* glsl */ `
attribute vec4 aCenter;
attribute vec4 aParams;
uniform float uTime;
uniform float uDream;
varying float vY;
varying float vHue;
varying float vVis;
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  vec2 rel = mod(aCenter.xz - cameraPosition.xz + 2048.0, 4096.0) - 2048.0;
  float far = 1.0 - smoothstep(1500.0, 1950.0, length(rel));
  float vis = smoothstep(aParams.w, aParams.w + 0.2, uDream) * far;
  float r = aParams.x * (0.85 + 0.15 * sin(uTime * 2.0 + aCenter.w * 20.0));
  vec3 wp = vec3(cameraPosition.x + rel.x + position.x * r * vis, -30.0 + position.y * aParams.y, cameraPosition.z + rel.y + position.z * r * vis);
  vY = position.y;
  vHue = aParams.z;
  vVis = vis;
  vWorldPos = wp;
  vN = normalize(vec3(position.x, 0.0, position.z));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const pillarFrag = /* glsl */ `
${GLSL}
varying float vY;
varying float vHue;
varying float vVis;
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  if (vVis < 0.01) discard;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float core = pow(abs(dot(vN, V)), 2.0);
  float fade = pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.03, vY);
  vec3 c = mix(neonPalette(vHue + uTime * 0.03), uNeonB, 0.3);
  vec3 col = c * (0.12 + 0.75 * core) * fade;
  col *= 1.0 - fogAmount(vWorldPos) * 0.8;
  gl_FragColor = vec4(col * vVis, 1.0);
}
`;

export class NeonShapes {
  constructor(shared, { seed = 23 } = {}) {
    const rnd = mulberry32(seed);
    this.group = new THREE.Group();
    const shapes = [
      { geo: OCTA, count: 14, size: [14, 34] },
      { geo: ico(1, 0, 0, rnd), count: 12, size: [16, 38] },
      { geo: TETRA, count: 12, size: [12, 30] },
      { geo: ico(1, 1, 0, rnd), count: 5, size: [30, 60] },
    ];
    const mk = (count, sizeMin, sizeMax, yMin, yMax) => {
      const centers = new Float32Array(count * 4);
      const params = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        centers[i * 4] = rnd() * 4096;
        centers[i * 4 + 1] = yMin + rnd() * (yMax - yMin);
        centers[i * 4 + 2] = rnd() * 4096;
        centers[i * 4 + 3] = rnd();
        params[i * 4] = sizeMin + rnd() * (sizeMax - sizeMin);
        params[i * 4 + 1] = (rnd() - 0.5) * 0.5;
        params[i * 4 + 2] = rnd();
        params[i * 4 + 3] = rnd() * 0.55;
      }
      return { centers, params };
    };
    this.materials = [];
    for (const s of shapes) {
      const b = baryGeometry(s.geo);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
      g.setAttribute('aBary', new THREE.BufferAttribute(b.bary, 3));
      const { centers, params } = mk(s.count, s.size[0], s.size[1], 90, 460);
      g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 4));
      g.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
      g.instanceCount = s.count;
      const m = new THREE.ShaderMaterial({
        uniforms: { ...shared },
        vertexShader: neonVert,
        fragmentShader: neonFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.materials.push(m);
    }
    // beams of light rising out of the land
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    cyl.translate(0, 0.5, 0);
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', cyl.getAttribute('position'));
    pg.setIndex(cyl.getIndex());
    const n = 12;
    const { centers, params } = mk(n, 2, 6, 0, 0);
    for (let i = 0; i < n; i++) params[i * 4 + 1] = 600 + rnd() * 700;
    pg.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 4));
    pg.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    pg.instanceCount = n;
    const pm = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: pillarVert,
      fragmentShader: pillarFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const pillars = new THREE.Mesh(pg, pm);
    pillars.frustumCulled = false;
    pillars.renderOrder = 6;
    this.group.add(pillars);
    this.materials.push(pm);
  }
}
