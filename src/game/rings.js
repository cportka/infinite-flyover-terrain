import * as THREE from 'three';
import { GLSL } from '../render/shaderLib.js';
import { WATER_LEVEL } from '../world/terrain.js';
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
    this.nextS = 0;
    this.pixel = 800;
    this.collected = 0;
    this.missed = 0;
    this.frame = {};
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

  reset(s0) {
    for (const it of this.items) this.removeItem(it);
    this.items.length = 0;
    this.nextS = s0 + 260;
  }

  ground(x, z) {
    return Math.max(WATER_LEVEL, this.world.heightAt(x, z));
  }

  spawnRing(s, u, yRel, golden) {
    const F = this.world.pathFrame(s, this.frame);
    u = Math.max(-85, Math.min(85, u));
    const x = F.x + F.rx * u;
    const z = F.z + F.rz * u;
    const ref = this.world.groundAlongPath(s);
    let y = ref + yRel;
    // keep the whole ring clear of the ground
    const g = Math.max(
      this.ground(x, z),
      this.ground(x + F.rx * RING_R, z + F.rz * RING_R),
      this.ground(x - F.rx * RING_R, z - F.rz * RING_R),
    );
    y = Math.max(y, g + RING_R + 3.5);
    y = Math.min(y, ref + 150);

    const colA = golden ? new THREE.Color(1.0, 0.72, 0.18) : new THREE.Color(0.35, 0.95, 1.0);
    const colB = golden ? new THREE.Color(1.0, 0.95, 0.55) : new THREE.Color(0.85, 0.55, 1.0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.shared,
        uColorA: { value: colA },
        uColorB: { value: colB },
        uIntensity: { value: golden ? 1.6 : 1.0 },
        uAlpha: { value: 1 },
      },
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
    const disk = new THREE.Mesh(this.disk, diskMat);
    mesh.add(disk);
    mesh.position.set(x, y, z);
    // face along the path (local +Z -> tangent); avoids lookAt, which works in scene space
    mesh.rotation.y = Math.atan2(F.tx, F.tz);
    if (golden) mesh.scale.setScalar(1.1);
    this.root.add(mesh);
    const it = { s, u, y, x, z, golden, mesh, mat, diskMat, state: 'active', t: 0 };
    this.items.push(it);
    return it;
  }

  spawnPattern() {
    const r = this.rng;
    const s0 = this.nextS;
    const kind = r();
    let len = 0;
    const base = 16 + r() * 22;
    // Patterns are sized so the lateral/vertical speeds they demand stay
    // within the glider's limits at cruise speed (boosting makes them harder).
    if (kind < 0.38) {
      // flowing line
      const n = 4 + Math.floor(r() * 3);
      const u0 = (r() - 0.5) * 70;
      const amp = 8 + r() * 14;
      const ph = r() * 6.28;
      for (let i = 0; i < n; i++) {
        this.spawnRing(s0 + i * 46, u0 + Math.sin(ph + i * 0.6) * amp, base + Math.sin(ph * 0.7 + i * 0.5) * 7, false);
      }
      len = n * 46;
    } else if (kind < 0.6) {
      // slalom
      const n = 5;
      const w = 7 + r() * 8;
      const c = (r() - 0.5) * 50;
      for (let i = 0; i < n; i++) this.spawnRing(s0 + i * 62, c + (i % 2 ? w : -w), base, false);
      len = n * 62;
    } else if (kind < 0.8) {
      // dive towards the river then climb
      const n = 6;
      const u0 = (r() - 0.5) * 50;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        this.spawnRing(s0 + i * 50, u0 + (r() - 0.5) * 4, 9 + Math.abs(t - 0.5) * 2 * 30, false);
      }
      len = n * 50;
    } else if (kind < 0.92) {
      // spiral
      const n = 7;
      const rad = 9 + r() * 6;
      const c = (r() - 0.5) * 40;
      for (let i = 0; i < n; i++) {
        const a = i * 0.8;
        this.spawnRing(s0 + i * 44, c + Math.cos(a) * rad, base + 8 + Math.sin(a) * rad * 0.7, false);
      }
      len = n * 44;
    } else {
      // golden ring in a daring spot
      const low = r() < 0.5;
      this.spawnRing(s0, (r() - 0.5) * 90, low ? 6 : 60 + r() * 40, true);
      len = 10;
    }
    this.nextS = s0 + len + 140 + r() * 200;
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

  /**
   * @returns nearest upcoming active ring (for the autopilot), or null
   */
  update(dt, player, events) {
    while (this.nextS < player.s + 1500) this.spawnPattern();

    let next = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.state === 'active') {
        if (player.s >= it.s) {
          const du = player.u - it.u;
          const dy = player.y - it.y;
          const d = Math.hypot(du, dy);
          if (d < RING_R + 0.9) {
            it.state = 'collected';
            it.t = 0;
            this.collected++;
            this.burst(it);
            events.onCollect?.(it, d < 2.4);
          } else {
            it.state = 'missed';
            it.t = 0;
            this.missed++;
            events.onMiss?.(it);
          }
        } else if (!next || it.s < next.s) {
          next = it;
        }
        // gentle spin + idle pulse
        it.mat.uniforms.uIntensity.value = (it.golden ? 1.6 : 1.0) * (0.9 + 0.1 * Math.sin(performance.now() * 0.004 + it.s));
      } else {
        it.t += dt;
        if (it.state === 'collected') {
          const k = Math.min(1, it.t / 0.45);
          it.mesh.scale.setScalar((it.golden ? 1.1 : 1) * (1 + k * 0.9));
          it.mat.uniforms.uAlpha.value = 1 - k;
          it.diskMat.uniforms.uAlpha.value = 1 - k;
          it.mat.uniforms.uIntensity.value = 2.5 * (1 - k) + 0.5;
          if (k >= 1) {
            this.removeItem(it);
            this.items.splice(i, 1);
          }
        } else {
          const k = Math.min(1, it.t / 0.8);
          it.mat.uniforms.uAlpha.value = 1 - k;
          it.diskMat.uniforms.uAlpha.value = 1 - k;
          it.mat.uniforms.uIntensity.value = 0.35;
          if (k >= 1 || player.s > it.s + 80) {
            this.removeItem(it);
            this.items.splice(i, 1);
          }
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
    return next;
  }
}
