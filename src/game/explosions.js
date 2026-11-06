// Explosions shaped by what the glider hit: particles, tumbling debris, the
// glider's own triangles flying apart, a fireball, a shockwave, and light
// thrown onto the surrounding land. Everything animates on the GPU from
// closed-form ballistics, so an explosion costs only its draw calls.

import * as THREE from 'three';
import { GLSL } from '../render/shaderLib.js';
import { MATTER } from '../world/matter.js';
import { mulberry32 } from '../world/noise.js';

const C = (h) => new THREE.Color(h);

// layer: n, cols (hex), size [min,max] (m), speed [min,max], up (vertical bias), gravity, drag, life [min,max],
//        add (additive), grow (size growth /s), soft (alpha falloff exponent)
const L = {
  sparks: (cols, n = 70) => ({ n, cols, size: [0.25, 0.6], speed: [18, 46], up: 0.4, gravity: 14, drag: 1.2, life: [0.6, 1.6], add: true, grow: 0, soft: 1.5 }),
  embers: (cols, n = 120) => ({ n, cols, size: [0.35, 0.8], speed: [6, 24], up: 0.9, gravity: -2.5, drag: 0.9, life: [1.5, 3.5], add: true, grow: 0, soft: 1.2 }),
  smoke: (cols, n = 50) => ({ n, cols, size: [5, 9], speed: [2, 9], up: 0.7, gravity: -3, drag: 1.1, life: [2.5, 4.5], add: false, grow: 0.9, soft: 1.0 }),
  dust: (cols, n = 90) => ({ n, cols, size: [4, 8], speed: [6, 20], up: 0.35, gravity: 1, drag: 1.4, life: [2.0, 4.0], add: false, grow: 0.7, soft: 1.0 }),
  leaves: (cols, n = 90) => ({ n, cols, size: [0.5, 0.9], speed: [8, 24], up: 0.6, gravity: 3, drag: 1.8, life: [2.5, 4.5], add: false, grow: 0, soft: 4.0 }),
  glints: (cols, n = 220) => ({ n, cols, size: [0.25, 0.7], speed: [16, 60], up: 0.2, gravity: 4, drag: 1.0, life: [1.0, 2.6], add: true, grow: 0, soft: 2.0 }),
  spores: (cols, n = 260) => ({ n, cols, size: [0.4, 1.0], speed: [3, 14], up: 0.5, gravity: -1.2, drag: 0.7, life: [3.0, 5.5], add: true, grow: 0, soft: 1.4 }),
  spray: (cols, n = 320) => ({ n, cols, size: [0.4, 1.2], speed: [10, 36], up: 1.6, gravity: 22, drag: 0.6, life: [1.2, 2.6], add: false, grow: 0.2, soft: 1.6 }),
  mist: (cols, n = 70) => ({ n, cols, size: [6, 11], speed: [2, 8], up: 0.4, gravity: 0, drag: 1.0, life: [2.5, 4.0], add: false, grow: 0.8, soft: 1.0 }),
  powder: (cols, n = 300) => ({ n, cols, size: [2.5, 6], speed: [6, 26], up: 0.6, gravity: 2, drag: 1.3, life: [2.0, 4.5], add: false, grow: 0.6, soft: 1.0 }),
};

const RECIPES = {
  earth: { flash: 0xffb070, fire: true, shock: 0xffd8a0, layers: [L.dust([0x6b5a3e, 0x8a7a5a]), L.sparks([0xffa040, 0xffd070])] },
  wood: { flash: 0xff9a40, fire: true, shock: 0xffc080, layers: [L.leaves([0x4f8a32, 0x8cbc4a, 0xe08a2a, 0xc0352a]), L.sparks([0xff9a40, 0xffe080], 80), L.smoke([0x3a3430], 30)] },
  stone: { flash: 0xffe0b0, fire: false, shock: 0xffffff, layers: [L.dust([0x8a8680, 0x6e6a62, 0xa49e92], 110), L.sparks([0xffe8c0, 0xffffff], 50)] },
  crystal: { flash: 0xb060ff, fire: false, shock: 0x6ff0ff, layers: [L.glints([0xa050ff, 0x40e8ff, 0xff50d8, 0x6a7aff, 0x50ffb0]), L.spores([0x40e8ff, 0xff4ae8, 0xb070ff], 90)] },
  spores: { flash: 0x7affd0, fire: false, shock: 0xff7af0, layers: [L.spores([0x6ff6ff, 0xff7af0, 0xb48cff, 0x8affc8], 320), L.mist([0x8a6ab0], 40)] },
  fire: { flash: 0xff8a30, fire: true, shock: 0xffc080, layers: [L.embers([0xff7a2a, 0xffc04a, 0xff4a1a], 150), L.smoke([0x2a2420, 0x4a403a], 60), L.sparks([0xffe0a0], 50)] },
  obsidian: { flash: 0xff6a1e, fire: true, shock: 0xff6a1e, layers: [L.glints([0x8a4aff, 0xff6a1e, 0x2a2430], 170), L.embers([0xff7a2a, 0xffc04a], 90)] },
  splash: { flash: 0xbfe8ff, fire: false, shock: 0xffffff, layers: [L.spray([0xffffff, 0xdff4ff, 0xbfe8ff], 360), L.mist([0xe8f4ff], 60)] },
  inferno: { flash: 0xff5a10, fire: true, big: true, shock: 0xffa040, layers: [L.embers([0xff5a10, 0xffa040, 0xffe080], 220), L.smoke([0x140e0c, 0x2a1a14], 90), L.sparks([0xffd080], 80)] },
  snow: { flash: 0xdff0ff, fire: false, shock: 0xffffff, layers: [L.powder([0xffffff, 0xe6f2ff, 0xd0e4f8], 320), L.glints([0xffffff, 0x9ff0ff], 60)] },
  sand: { flash: 0xffd090, fire: false, shock: 0xffe0b0, layers: [L.powder([0xe3bd88, 0xd8a868, 0xc4874a], 280), L.sparks([0xffd090], 40)] },
  prism: { flash: 0xff70ff, fire: false, shock: 0x7affff, layers: [L.glints([0xff4ae8, 0x4af0ff, 0xfff04a, 0x7aff7a, 0xff8a3a, 0x9a6aff], 320), L.spores([0xffffff, 0xff9af0, 0x9affff], 120)] },
  mirror: { flash: 0x8a3aff, fire: false, shock: 0xff2a4a, layers: [L.spray([0x1a0a12, 0x3a1a2a, 0x5a2a3a], 260), L.glints([0x8a3aff, 0xff2a4a], 110)] },
  ash: { flash: 0xff6a20, fire: true, shock: 0xffa060, layers: [L.powder([0x3a3330, 0x5a524e, 0x2a2624], 240), L.embers([0xff6a20, 0xffa040], 110)] },
};

const partVert = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aParams;
attribute vec3 aColor;
uniform float uAge;
uniform float uPixel;
uniform float uGrow;
varying vec3 vColor;
varying float vA;
void main() {
  float life = aParams.x;
  float t = min(uAge, life);
  float k = max(aParams.w, 0.05);
  vec3 disp = aVel * (1.0 - exp(-k * t)) / k + vec3(0.0, -0.5 * aParams.z * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(disp, 1.0);
  gl_Position = projectionMatrix * mv;
  float a = clamp(1.0 - uAge / life, 0.0, 1.0);
  vA = a * a;
  vColor = aColor;
  gl_PointSize = clamp(aParams.y * (1.0 + uGrow * uAge) * uPixel / max(-mv.z, 1.0), 0.0, 160.0) * step(uAge, life);
}
`;
const partFrag = /* glsl */ `
uniform float uSoft;
uniform float uGain;
varying vec3 vColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - smoothstep(0.0, 1.0, d), 1e-6), uSoft) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}
`;

const rotGLSL = /* glsl */ `
mat3 rotAxis(vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  float t = 1.0 - c;
  return mat3(
    t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
}
`;

// tumbling fragments (debris and the glider's own triangles share this shader)
const chunkVert = /* glsl */ `
${rotGLSL}
attribute vec3 aCentroid;
attribute vec3 aVel;
attribute vec4 aSpin;
attribute vec4 aColor;
uniform float uAge;
varying vec3 vWorldPos;
varying vec4 vColor;
void main() {
  float t = uAge;
  mat3 R = rotAxis(normalize(aSpin.xyz + vec3(1e-4)), aSpin.w * t);
  float shrink = 1.0 - smoothstep(2.4, 3.6, t);
  vec3 p = aCentroid + R * (position * shrink);
  vec3 disp = aVel * (1.0 - exp(-0.55 * t)) / 0.55 + vec3(0.0, -8.0 * t * t, 0.0);
  vec4 wp = modelMatrix * vec4(p + disp, 1.0);
  vWorldPos = wp.xyz;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const chunkFrag = /* glsl */ `
${GLSL}
varying vec3 vWorldPos;
varying vec4 vColor;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = flatNormal(vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 albedo = pow(vColor.rgb, vec3(2.2));
  float ndl = clamp((dot(N, uSunDir) + 0.3) / 1.3, 0.0, 1.0);
  vec3 hemi = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  vec3 col = albedo * (uSunColor * ndl + hemi) + albedo * vColor.a * 5.0 + albedo * boomLight(vWorldPos, N);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

const fireVert = /* glsl */ `
varying vec3 vN;
varying vec3 vWorldPos;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const fireFrag = /* glsl */ `
uniform float uT;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec3 vN;
varying vec3 vWorldPos;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  float f = clamp(abs(dot(normalize(vN), V)), 0.0, 1.0);
  float edge = pow(max(1.0 - f, 0.0), 1.4);
  vec3 c = mix(uColA, uColB, smoothstep(0.0, 0.55, uT));
  float k = (0.45 + edge * 1.2) * pow(max(1.0 - uT, 0.0), 1.6);
  gl_FragColor = vec4(c * k, k);
}
`;

const shockFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uT;
varying vec2 vUv;
void main() {
  float a = (1.0 - uT) * (1.0 - uT);
  gl_FragColor = vec4(uColor * 1.5 * a, a);
}
`;
const shockVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function tetraGeo() {
  const v = [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1];
  const f = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
  const pos = [];
  for (const i of f) pos.push(v[i * 3] * 0.6, v[i * 3 + 1] * 0.6, v[i * 3 + 2] * 0.6);
  return new Float32Array(pos);
}

export class Explosions {
  constructor(root, shared) {
    this.root = root;
    this.shared = shared;
    this.list = [];
    this.pixel = 800;
    this.rng = mulberry32(99);
    this.tetra = tetraGeo();
    this.sphere = new THREE.IcosahedronGeometry(1, 2);
    this.ring = new THREE.RingGeometry(0.86, 1.0, 72);
    this.ring.rotateX(-Math.PI / 2);
  }

  r(a, b) {
    return a + (b - a) * this.rng();
  }

  /** Random unit vector biased upwards by `up`. */
  dir(up) {
    const a = this.rng() * Math.PI * 2;
    const z = this.rng() * 2 - 1 + up * 0.5;
    const s = Math.sqrt(Math.max(0, 1 - Math.min(1, z * z)));
    const v = new THREE.Vector3(Math.cos(a) * s, Math.min(1, z), Math.sin(a) * s);
    return v.normalize();
  }

  particleLayer(layer, scale, inherit) {
    const n = Math.round(layer.n * scale);
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const par = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const cols = layer.cols.map(C);
    for (let i = 0; i < n; i++) {
      const d = this.dir(layer.up);
      const sp = this.r(layer.speed[0], layer.speed[1]) * (0.6 + 0.4 * scale);
      vel[i * 3] = d.x * sp + inherit.x * 0.25;
      vel[i * 3 + 1] = d.y * sp + inherit.y * 0.25;
      vel[i * 3 + 2] = d.z * sp + inherit.z * 0.25;
      par[i * 4] = this.r(layer.life[0], layer.life[1]);
      par[i * 4 + 1] = this.r(layer.size[0], layer.size[1]);
      par[i * 4 + 2] = layer.gravity;
      par[i * 4 + 3] = layer.drag;
      const c = cols[Math.floor(this.rng() * cols.length)];
      const gain = layer.add ? 1.6 : 1;
      col[i * 3] = c.r * gain;
      col[i * 3 + 1] = c.g * gain;
      col[i * 3 + 2] = c.b * gain;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aParams', new THREE.BufferAttribute(par, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 0 }, uPixel: { value: this.pixel }, uGrow: { value: layer.grow }, uSoft: { value: layer.soft }, uGain: { value: 1 } },
      vertexShader: partVert,
      fragmentShader: partFrag,
      transparent: true,
      depthWrite: false,
      blending: layer.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    return pts;
  }

  /** Tumbling fragments: either debris tetrahedra, or the glider's own triangles. */
  fragments(tris, inherit, emissive) {
    // tris: array of { a:[x,y,z], b, c (relative to centre), color:[r,g,b] (0..1) }
    const n = tris.length;
    const pos = new Float32Array(n * 9);
    const cen = new Float32Array(n * 9);
    const vel = new Float32Array(n * 9);
    const spin = new Float32Array(n * 12);
    const col = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const t = tris[i];
      const cx = (t.a[0] + t.b[0] + t.c[0]) / 3;
      const cy = (t.a[1] + t.b[1] + t.c[1]) / 3;
      const cz = (t.a[2] + t.b[2] + t.c[2]) / 3;
      const d = new THREE.Vector3(cx, cy, cz);
      if (d.lengthSq() < 1e-4) d.copy(this.dir(0.5));
      d.normalize();
      const sp = this.r(t.speed?.[0] ?? 10, t.speed?.[1] ?? 28);
      const vx = d.x * sp + inherit.x * 0.35 + this.r(-4, 4);
      const vy = d.y * sp + inherit.y * 0.35 + this.r(4, 12);
      const vz = d.z * sp + inherit.z * 0.35 + this.r(-4, 4);
      const ax = this.r(-1, 1);
      const ay = this.r(-1, 1);
      const az = this.r(-1, 1);
      const rate = this.r(3, 13);
      const vs = [t.a, t.b, t.c];
      for (let k = 0; k < 3; k++) {
        const o = i * 3 + k;
        pos[o * 3] = vs[k][0] - cx;
        pos[o * 3 + 1] = vs[k][1] - cy;
        pos[o * 3 + 2] = vs[k][2] - cz;
        cen[o * 3] = cx;
        cen[o * 3 + 1] = cy;
        cen[o * 3 + 2] = cz;
        vel[o * 3] = vx;
        vel[o * 3 + 1] = vy;
        vel[o * 3 + 2] = vz;
        spin[o * 4] = ax;
        spin[o * 4 + 1] = ay;
        spin[o * 4 + 2] = az;
        spin[o * 4 + 3] = rate;
        col[o * 4] = t.color[0];
        col[o * 4 + 1] = t.color[1];
        col[o * 4 + 2] = t.color[2];
        col[o * 4 + 3] = t.emissive ?? emissive;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCentroid', new THREE.BufferAttribute(cen, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aSpin', new THREE.BufferAttribute(spin, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, uAge: { value: 0 } },
      vertexShader: chunkVert,
      fragmentShader: chunkFrag,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  debrisTris(cols, count, size, emissive) {
    const tris = [];
    const T = this.tetra;
    for (let i = 0; i < count; i++) {
      const s = this.r(size[0], size[1]);
      const off = this.dir(0.4).multiplyScalar(this.r(0.5, 2.5));
      const c = C(cols[i % cols.length]);
      c.convertLinearToSRGB();
      const color = [c.r, c.g, c.b];
      const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(this.r(0, 6), this.r(0, 6), this.r(0, 6)));
      const sp = [12, 36];
      for (let f = 0; f < 4; f++) {
        const v = [];
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Vector3(T[(f * 3 + k) * 3], T[(f * 3 + k) * 3 + 1], T[(f * 3 + k) * 3 + 2]).multiplyScalar(s).applyMatrix4(rot).add(off);
          v.push([p.x, p.y, p.z]);
        }
        // all four faces of a tetrahedron fly together: same centroid offset per piece
        tris.push({ a: v[0], b: v[1], c: v[2], color, speed: sp, emissive });
      }
    }
    return tris;
  }

  gliderTris(glider, center) {
    if (!glider) return [];
    const g = glider.geometry;
    const P = g.getAttribute('position');
    const Cc = g.getAttribute('aColor');
    const q = glider.quaternion;
    const s = glider.scale.x;
    const tris = [];
    for (let i = 0; i < P.count; i += 3) {
      const v = [];
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Vector3(P.getX(i + k), P.getY(i + k), P.getZ(i + k)).multiplyScalar(s).applyQuaternion(q).add(glider.position).sub(center);
        v.push([p.x, p.y, p.z]);
      }
      tris.push({ a: v[0], b: v[1], c: v[2], color: [Cc.getX(i), Cc.getY(i), Cc.getZ(i)], emissive: Cc.getW(i) * 0.8, speed: [8, 26] });
    }
    return tris;
  }

  /** A crash that ends the flight. */
  spawn(matId, pos, vel, glider) {
    const M = MATTER[matId] || MATTER[0];
    const R = RECIPES[M.style] || RECIPES.earth;
    const group = new THREE.Group();
    group.position.copy(pos);
    const parts = [];
    for (const layer of R.layers) {
      const p = this.particleLayer(layer, R.big ? 1.4 : 1, vel);
      group.add(p);
      parts.push(p);
    }
    const emissive = M.style === 'crystal' || M.style === 'prism' || M.style === 'obsidian' ? 0.9 : M.style === 'inferno' ? 0.5 : 0;
    const frags = this.fragments([...this.debrisTris(M.debris, 26, [0.5, 1.6], emissive), ...this.gliderTris(glider, pos)], vel, emissive);
    group.add(frags);
    let fire = null;
    if (R.fire) {
      fire = new THREE.Mesh(
        this.sphere,
        new THREE.ShaderMaterial({
          uniforms: { uT: { value: 0 }, uColA: { value: new THREE.Color(3.6, 1.9, 0.6) }, uColB: { value: new THREE.Color(1.5, 0.32, 0.05) } },
          vertexShader: fireVert,
          fragmentShader: fireFrag,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      fire.frustumCulled = false;
      group.add(fire);
    }
    const shock = new THREE.Mesh(
      this.ring,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: C(R.shock) }, uT: { value: 0 } },
        vertexShader: shockVert,
        fragmentShader: shockFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    shock.frustumCulled = false;
    group.add(shock);
    this.root.add(group);
    this.list.push({ group, parts, frags, fire, shock, age: 0, life: 5.5, pos: pos.clone(), flash: C(R.flash), big: !!R.big, kind: 'death', burn: R.fire });
  }

  /** A survivable impact: a small burst of the material. */
  spawnHit(matId, pos, vel, strength = 1) {
    const M = MATTER[matId] || MATTER[0];
    const R = RECIPES[M.style] || RECIPES.earth;
    const group = new THREE.Group();
    group.position.copy(pos);
    const parts = [];
    const layer = R.layers[0];
    const p = this.particleLayer(layer, Math.min(0.5, 0.15 + strength * 0.25), vel);
    group.add(p);
    parts.push(p);
    const frags = this.fragments(this.debrisTris(M.debris, Math.round(4 + strength * 6), [0.25, 0.7], 0), vel, 0);
    group.add(frags);
    this.root.add(group);
    this.list.push({ group, parts, frags, fire: null, shock: null, age: 0, life: 3.5, pos: pos.clone(), flash: C(R.flash), kind: 'hit', strength });
  }

  update(dt, origin) {
    let light = null;
    let best = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.age += dt;
      for (const p of e.parts) {
        p.material.uniforms.uAge.value = e.age;
        p.material.uniforms.uPixel.value = this.pixel;
      }
      e.frags.material.uniforms.uAge.value = e.age;
      if (e.fire) {
        const t = Math.min(1, e.age / 1.6);
        const r = (e.big ? 19 : 13) * (1 - Math.exp(-6 * e.age)) * (1 + 0.3 * e.age);
        e.fire.scale.setScalar(Math.max(0.01, r));
        e.fire.material.uniforms.uT.value = t;
        e.fire.visible = t < 1;
      }
      if (e.shock) {
        const t = Math.min(1, e.age / 0.9);
        e.shock.scale.setScalar(1 + e.age * 95);
        e.shock.material.uniforms.uT.value = t;
        e.shock.visible = t < 1;
      }
      // light thrown onto the land
      let k;
      if (e.kind === 'death') k = 4.2 * Math.exp(-e.age * 2.5) + (e.burn ? 1.0 * Math.exp(-e.age * 0.6) * (0.8 + 0.2 * Math.sin(e.age * 23)) : 0);
      else k = 1.5 * e.strength * Math.exp(-e.age * 6);
      if (k > best) {
        best = k;
        light = e;
      }
      if (e.age > e.life) {
        this.root.remove(e.group);
        for (const p of e.parts) {
          p.geometry.dispose();
          p.material.dispose();
        }
        e.frags.geometry.dispose();
        e.frags.material.dispose();
        if (e.fire) e.fire.material.dispose();
        if (e.shock) e.shock.material.dispose();
        this.list.splice(i, 1);
      }
    }
    const U = this.shared;
    if (light && best > 0.01) {
      U.uBoomPos.value.set(light.pos.x - origin.x, light.pos.y, light.pos.z - origin.z);
      U.uBoomColor.value.copy(light.flash).multiplyScalar(best);
      U.uBoomRadius.value = light.kind === 'death' ? (light.big ? 120 : 85) : 30;
    } else {
      U.uBoomRadius.value = 0;
    }
  }
}
