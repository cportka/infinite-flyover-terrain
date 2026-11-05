import * as THREE from 'three';
import { GLSL } from '../render/shaderLib.js';
import { mulberry32 } from '../world/noise.js';

const RING_R = 6.5;

const ringVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const ringFrag = /* glsl */ `
${GLSL}
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  float band = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * 10.0 - uTime * 5.0);
  vec3 base = mix(uColorA, uColorB, band);
  float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  vec3 col = base * (1.3 + 2.2 * fres) * uIntensity;
  col = applyFog(col, vWorldPos, 0.6);
  gl_FragColor = vec4(col, uAlpha);
}
`;
const diskFrag = /* glsl */ `
uniform vec3 uColorA;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float a = smoothstep(1.0, 0.55, r) * (0.10 + 0.06 * sin(r * 14.0 - uTime * 6.0));
  gl_FragColor = vec4(uColorA * 1.4, a * uAlpha);
}
`;
const diskVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// collection burst particles
const burstVert = /* glsl */ `
attribute vec3 aVel;
uniform float uAge;
uniform float uPixel;
varying float vA;
void main() {
  vec3 p = position + aVel * uAge * (1.0 - uAge * 0.35);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.9 * uPixel / max(-mv.z, 1.0), 0.0, 40.0);
  vA = 1.0 - uAge;
}
`;
const burstFrag = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(uColor * 3.0, a);
}
`;

export class Rings {
  constructor(root, world, shared, seed = 1) {
    this.root = root;
    this.world = world;
    this.shared = shared;
    this.rng = mulberry32(seed * 977 + 3);
    this.items = [];
    this.bursts = [];
    this.torus = new THREE.TorusGeometry(RING_R, 0.48, 10, 48);
    this.disk = new THREE.CircleGeometry(RING_R * 0.95, 40);
    this.burstGeo = this.makeBurstGeometry();
    this.cursor = null;
    this.pixel = 800;
    this.collected = 0;
    this.missed = 0;
    this.enabled = false;
    this.surf = {};
  }

  makeBurstGeometry() {
    const n = 36;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const r = mulberry32(42);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const b = Math.acos(r() * 2 - 1);
      const sp = 10 + r() * 16;
      vel[i * 3] = Math.sin(b) * Math.cos(a) * sp;
      vel[i * 3 + 1] = Math.cos(b) * sp;
      vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * sp;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    return g;
  }

  setEnabled(on) {
    this.enabled = on;
    this.cursor = null;
    if (!on) this.clear();
  }

  clear() {
    for (const it of this.items) this.removeItem(it);
    this.items.length = 0;
  }

  floor(x, z) {
    return this.world.surfaceAt(x, z, this.surf).y;
  }

  /** Where the next pattern continues from: kept ahead of the flyer, along its heading. */
  ensureCursor(flyer) {
    const fx = Math.sin(flyer.yaw);
    const fz = -Math.cos(flyer.yaw);
    const c = this.cursor;
    let reset = !c;
    if (c) {
      const dx = c.x - flyer.pos.x;
      const dz = c.z - flyer.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const ahead = (dx * fx + dz * fz) / dist;
      reset = dist > 1700 || ahead < 0.55 || c.dx * fx + c.dz * fz < 0.45;
    }
    if (reset) this.cursor = { x: flyer.pos.x + fx * 420, z: flyer.pos.z + fz * 420, dx: fx, dz: fz };
  }

  spawnRing(x, z, yRel, dx, dz, golden) {
    const rx = dz;
    const rz = -dx; // right-hand side of the route
    const g = Math.max(this.floor(x, z), this.floor(x + rx * RING_R, z + rz * RING_R), this.floor(x - rx * RING_R, z - rz * RING_R));
    const y = Math.min(g + 150, Math.max(g + RING_R + 3.5, this.floor(x, z) + yRel));
    const colA = golden ? new THREE.Color(1.0, 0.72, 0.18) : new THREE.Color(0.35, 0.95, 1.0);
    const colB = golden ? new THREE.Color(1.0, 0.95, 0.55) : new THREE.Color(0.85, 0.55, 1.0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, uColorA: { value: colA }, uColorB: { value: colB }, uIntensity: { value: golden ? 1.6 : 1.0 }, uAlpha: { value: 1 } },
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      transparent: true,
    });
    const mesh = new THREE.Mesh(this.torus, mat);
    const diskMat = new THREE.ShaderMaterial({
      uniforms: { uColorA: { value: colA }, uAlpha: { value: 1 }, uTime: this.shared.uTime },
      vertexShader: diskVert,
      fragmentShader: diskFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    mesh.add(new THREE.Mesh(this.disk, diskMat));
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.atan2(dx, dz); // local +Z faces along the route
    if (golden) mesh.scale.setScalar(1.1);
    this.root.add(mesh);
    const it = { pos: new THREE.Vector3(x, y, z), nx: dx, nz: dz, golden, mesh, mat, diskMat, state: 'active', t: 0, phase: this.rng() * 6 };
    this.items.push(it);
    return it;
  }

  /** Lay one pattern along a gently curving route from the cursor. */
  spawnPattern(flyer) {
    this.ensureCursor(flyer);
    const c = this.cursor;
    const r = this.rng;
    const turn = (r() - 0.5) * 0.0028; // rad per metre
    const kind = r();
    const base = 16 + r() * 22;
    const offsets = [];
    let spacing = 46;
    if (kind < 0.38) {
      const n = 4 + Math.floor(r() * 3);
      const u0 = (r() - 0.5) * 40;
      const amp = 8 + r() * 14;
      const ph = r() * 6.28;
      for (let i = 0; i < n; i++) offsets.push([u0 + Math.sin(ph + i * 0.6) * amp, base + Math.sin(ph * 0.7 + i * 0.5) * 7, false]);
    } else if (kind < 0.6) {
      spacing = 62;
      const w = 7 + r() * 8;
      const cc = (r() - 0.5) * 30;
      for (let i = 0; i < 5; i++) offsets.push([cc + (i % 2 ? w : -w), base, false]);
    } else if (kind < 0.8) {
      spacing = 50;
      const u0 = (r() - 0.5) * 30;
      for (let i = 0; i < 6; i++) offsets.push([u0, 9 + Math.abs(i / 5 - 0.5) * 2 * 30, false]);
    } else if (kind < 0.92) {
      spacing = 44;
      const rad = 9 + r() * 6;
      const cc = (r() - 0.5) * 30;
      for (let i = 0; i < 7; i++) offsets.push([cc + Math.cos(i * 0.8) * rad, base + 8 + Math.sin(i * 0.8) * rad * 0.7, false]);
    } else {
      offsets.push([(r() - 0.5) * 40, r() < 0.5 ? 7 : 60 + r() * 40, true]);
    }
    for (const [u, yRel, golden] of offsets) {
      const a = Math.atan2(c.dx, -c.dz) + turn * spacing;
      c.dx = Math.sin(a);
      c.dz = -Math.cos(a);
      c.x += c.dx * spacing;
      c.z += c.dz * spacing;
      // right vector of a heading (dx, dz) is (-dz, dx)
      this.spawnRing(c.x - c.dz * u, c.z + c.dx * u, yRel, c.dx, c.dz, golden);
    }
    const gap = 160 + r() * 200;
    c.x += c.dx * gap;
    c.z += c.dz * gap;
    return offsets.length;
  }

  removeItem(it) {
    this.root.remove(it.mesh);
    it.mat.dispose();
    it.diskMat.dispose();
  }

  burst(it) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 0 }, uPixel: { value: this.pixel }, uColor: { value: it.golden ? new THREE.Color(1, 0.8, 0.3) : new THREE.Color(0.5, 0.95, 1) } },
      vertexShader: burstVert,
      fragmentShader: burstFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(this.burstGeo, mat);
    pts.position.copy(it.mesh.position);
    pts.frustumCulled = false;
    this.root.add(pts);
    this.bursts.push({ pts, mat, age: 0 });
  }

  update(dt, flyer, events) {
    if (this.enabled && flyer.alive) {
      const fx = Math.sin(flyer.yaw);
      const fz = -Math.cos(flyer.yaw);
      let ahead = 0;
      for (const it of this.items) {
        if (it.state !== 'active') continue;
        const dx = it.pos.x - flyer.pos.x;
        const dz = it.pos.z - flyer.pos.z;
        if (dx * fx + dz * fz > 30 && Math.hypot(dx, dz) < 1600) ahead++;
      }
      for (let guard = 0; ahead < 6 && guard < 3; guard++) ahead += this.spawnPattern(flyer);
    }

    const p = flyer.pos;
    const q = flyer.prevPos;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.state === 'active') {
        const side = (p.x - it.pos.x) * it.nx + (p.z - it.pos.z) * it.nz;
        const prev = (q.x - it.pos.x) * it.nx + (q.z - it.pos.z) * it.nz;
        if (flyer.alive && ((prev < 0 && side >= 0) || (prev > 0 && side <= 0))) {
          const t = prev / (prev - side);
          const cx = q.x + (p.x - q.x) * t - it.pos.x;
          const cy = q.y + (p.y - q.y) * t - it.pos.y;
          const cz = q.z + (p.z - q.z) * t - it.pos.z;
          const off = Math.hypot(cx, cy, cz);
          if (off < RING_R + 0.9) {
            it.state = 'collected';
            it.t = 0;
            this.collected++;
            this.burst(it);
            events.onCollect?.(it, off < 2.4);
          } else if (off < 70) {
            it.state = 'missed';
            it.t = 0;
            this.missed++;
            events.onMiss?.(it);
          }
        }
        it.mat.uniforms.uIntensity.value = (it.golden ? 1.6 : 1.0) * (0.9 + 0.1 * Math.sin(performance.now() * 0.004 + it.phase));
        if (Math.hypot(it.pos.x - p.x, it.pos.z - p.z) > 2200) {
          this.removeItem(it);
          this.items.splice(i, 1);
        }
      } else {
        it.t += dt;
        const collected = it.state === 'collected';
        const k = Math.min(1, it.t / (collected ? 0.45 : 0.8));
        if (collected) it.mesh.scale.setScalar((it.golden ? 1.1 : 1) * (1 + k * 0.9));
        it.mat.uniforms.uAlpha.value = 1 - k;
        it.diskMat.uniforms.uAlpha.value = 1 - k;
        it.mat.uniforms.uIntensity.value = collected ? 2.5 * (1 - k) + 0.5 : 0.35;
        if (k >= 1) {
          this.removeItem(it);
          this.items.splice(i, 1);
        }
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt / 0.9;
      b.mat.uniforms.uAge.value = Math.min(1, b.age);
      b.mat.uniforms.uPixel.value = this.pixel;
      if (b.age >= 1) {
        this.root.remove(b.pts);
        b.mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
