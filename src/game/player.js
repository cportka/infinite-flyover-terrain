import * as THREE from 'three';
import { WATER_LEVEL } from '../world/terrain.js';

const LAT_SPEED = 46; // m/s sideways at full stick
const VERT_SPEED = 30; // m/s vertical at full stick
const BASE_SPEED = 68;
const BOOST_SPEED = 128;
const MAX_LATERAL = 105;
const CRUISE = 24; // default height above the ground along the path

function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}

function buildGliderGeometry() {
  // Low-poly delta glider. Forward = -Z.
  const P = [];
  const C = [];
  const tri = (a, b, c, col, em = 0) => {
    P.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) C.push(col[0], col[1], col[2], em);
  };
  const body = [244, 239, 230];
  const under = [190, 196, 210];
  const accent = [255, 140, 92];
  const glow = [120, 240, 255];
  const N = [0, 0.12, -2.5];
  const L = [-2.9, 0.38, 1.05];
  const R = [2.9, 0.38, 1.05];
  const T = [0, 0.08, 0.72];
  const K = [0, -0.42, 0.35];
  const Cp = [0, 0.42, -0.55];
  // top wings with a raised spine
  tri(N, Cp, L, body);
  tri(Cp, T, L, body);
  tri(N, R, Cp, body);
  tri(Cp, R, T, body);
  // underside
  tri(N, L, K, under);
  tri(K, L, T, under);
  tri(N, K, R, under);
  tri(K, T, R, under);
  // accent stripe near the trailing edge
  tri([-2.3, 0.33, 0.92], [-0.2, 0.12, 0.74], [-2.25, 0.36, 1.0], accent);
  tri([2.3, 0.33, 0.92], [2.25, 0.36, 1.0], [0.2, 0.12, 0.74], accent);
  // tail fin
  tri([0, 0.1, 0.1], [0, 1.0, 0.95], [0, 0.1, 0.85], body);
  // glowing winglets + leading edge lights
  tri(L, [L[0] + 0.05, L[1] + 0.65, L[2] + 0.25], [L[0] + 0.1, L[1], L[2] - 0.55], glow, 255);
  tri(R, [R[0] - 0.05, R[1] + 0.65, R[2] + 0.25], [R[0] - 0.1, R[1], R[2] - 0.55], glow, 255);
  tri([-0.25, 0.16, -2.0], [-2.6, 0.37, 0.8], [-2.55, 0.42, 0.75], glow, 200);
  tri([0.25, 0.16, -2.0], [2.55, 0.42, 0.75], [2.6, 0.37, 0.8], glow, 200);
  // engine glow
  tri([-0.22, 0.02, 0.74], [0.22, 0.02, 0.74], [0, 0.28, 0.76], [255, 190, 120], 255);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(C), 4, true));
  g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array((P.length / 3) * 4), 4, true));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ trails

const trailVert = /* glsl */ `
attribute float aFade;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // fade out the part of the ribbon that comes close to the camera
  vFade = aFade * smoothstep(7.0, 14.0, length(mv.xyz));
  gl_Position = projectionMatrix * mv;
}
`;
const trailFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor * 1.3, vFade * vFade * uOpacity);
}
`;

class Trail {
  constructor(count = 14, spacing = 0.6, maxLen = 7) {
    this.n = count;
    this.spacing = spacing;
    this.maxLen = maxLen;
    this.pts = [];
    this.pos = new Float32Array(count * 2 * 3);
    const fade = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      fade[i * 2] = fade[i * 2 + 1] = 1 - i / (count - 1);
    }
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.fade = fade;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    g.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.6, 0.95, 1.0) }, uOpacity: { value: 0.55 } },
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  reset() {
    this.pts.length = 0;
  }

  /** Points are spaced by distance (not per frame) so the length is stable at any FPS. */
  push(p) {
    const pts = this.pts;
    if (pts.length < 2) {
      pts.unshift([p.x, p.y, p.z]);
      return;
    }
    const q = pts[1];
    if (Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) > this.spacing) {
      pts.unshift([p.x, p.y, p.z]);
      if (pts.length > this.n) pts.length = this.n;
    } else {
      pts[0][0] = p.x;
      pts[0][1] = p.y;
      pts[0][2] = p.z;
    }
    // cap the ribbon by length (frame-rate independent)
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (len + seg > this.maxLen) {
        const t = seg > 0 ? (this.maxLen - len) / seg : 0;
        b[0] = a[0] + (b[0] - a[0]) * t;
        b[1] = a[1] + (b[1] - a[1]) * t;
        b[2] = a[2] + (b[2] - a[2]) * t;
        pts.length = i + 1;
        break;
      }
      len += seg;
    }
  }

  /** Rebuild the ribbon relative to `origin` (keeps float32 precision). */
  build(origin, camPos, width) {
    const pts = this.pts;
    const n = this.n;
    const pos = this.pos;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[Math.min(i, pts.length - 1)] || [ox, oy, oz];
      if (i > 0 && i < pts.length) {
        const pp = pts[i - 1];
        along += Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      }
      const f = i < pts.length ? Math.max(0, 1 - along / this.maxLen) : 0;
      this.fade[i * 2] = f;
      this.fade[i * 2 + 1] = f;
      const q = pts[Math.min(i + 1, pts.length - 1)] || p;
      let dx = p[0] - q[0];
      let dy = p[1] - q[1];
      let dz = p[2] - q[2];
      if (i === pts.length - 1 && i > 0) {
        const r = pts[i - 1];
        dx = r[0] - p[0];
        dy = r[1] - p[1];
        dz = r[2] - p[2];
      }
      const vx = camPos.x - p[0];
      const vy = camPos.y - p[1];
      const vz = camPos.z - p[2];
      // side = normalize(cross(seg, view))
      let sx = dy * vz - dz * vy;
      let sy = dz * vx - dx * vz;
      let sz = dx * vy - dy * vx;
      const l = Math.hypot(sx, sy, sz) || 1;
      const w = width * (0.25 + 0.75 * f);
      sx = (sx / l) * w;
      sy = (sy / l) * w;
      sz = (sz / l) * w;
      pos[i * 6] = p[0] - ox + sx;
      pos[i * 6 + 1] = p[1] - oy + sy;
      pos[i * 6 + 2] = p[2] - oz + sz;
      pos[i * 6 + 3] = p[0] - ox - sx;
      pos[i * 6 + 4] = p[1] - oy - sy;
      pos[i * 6 + 5] = p[2] - oz - sz;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aFade.needsUpdate = true;
    this.mesh.position.set(ox, oy, oz);
  }
}

// ------------------------------------------------------------------ player

export class Player {
  constructor(world, propMaterial) {
    this.world = world;
    this.mesh = new THREE.Mesh(buildGliderGeometry(), propMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(1.3);
    this.group = new THREE.Group();
    this.trails = [new Trail(), new Trail()];
    this.group.add(this.mesh);
    this.frame = {};
    this.pos = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.camOffset = new THREE.Vector3(0, 6, 16);
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    this.lookM = new THREE.Matrix4();
    this.cameraMode = 'chase';
    this.reset(300);
  }

  reset(s) {
    this.s = s;
    this.u = 0;
    this.uVel = 0;
    this.yVel = 0;
    this.speed = BASE_SPEED;
    this.bank = 0;
    this.pitch = 0;
    this.boostEnergy = 1;
    this.boosting = false;
    this.distance = 0;
    this.bumpCooldown = 0;
    this.y = this.world.groundAlongPath(s) + CRUISE;
    this.updatePose(0);
    this.camOffset.set(0, 6, 16);
    for (const t of this.trails) t.reset();
  }

  /** Height the autopilot / camera consider "ground" (water counts as ground). */
  groundAt(x, z) {
    return Math.max(WATER_LEVEL, this.world.heightAt(x, z));
  }

  /** Steering suggestion that follows the valley and threads upcoming rings. */
  autopilot(target, dt) {
    const F = this.frame;
    // look ahead along the path at our current lateral offset
    let clear = 0;
    for (const ahead of [30, 70, 120, 190]) {
      const fr = this.world.pathFrame(this.s + ahead, {});
      const x = fr.x + fr.rx * this.u;
      const z = fr.z + fr.rz * this.u;
      clear = Math.max(clear, this.groundAt(x, z) + 12 - ahead * 0.04);
    }
    let tu = 0;
    let ty = this.world.groundAlongPath(this.s + 80) + CRUISE + 8 * Math.sin(this.s * 0.0035);
    // time until we reach the target (rings) or a comfortable horizon (cruising)
    let ttr = 1.6;
    if (target) {
      tu = target.u;
      ty = target.y;
      ttr = Math.max(0.3, (target.s - this.s) / Math.max(1, this.speed));
    }
    ty = Math.max(ty, clear);
    void F;
    void dt;
    // desired velocity to arrive on target, converted into stick input (with lag compensation)
    const vu = (tu - this.u) / ttr;
    const vy = (ty - this.y) / Math.max(0.45, ttr);
    return {
      x: Math.max(-1, Math.min(1, (vu + (vu - this.uVel) * 0.35) / LAT_SPEED)),
      y: Math.max(-1, Math.min(1, (vy + (vy - this.yVel) * 0.35) / VERT_SPEED)),
    };
  }

  update(dt, steer, wantBoost, events) {
    // boost
    const canBoost = this.boostEnergy > 0.02;
    this.boosting = wantBoost && canBoost;
    if (this.boosting) this.boostEnergy = Math.max(0, this.boostEnergy - dt * 0.22);
    else this.boostEnergy = Math.min(1, this.boostEnergy + dt * 0.035);
    const targetSpeed = this.boosting ? BOOST_SPEED : BASE_SPEED;
    this.speed = damp(this.speed, targetSpeed, this.boosting ? 1.6 : 0.9, dt);

    this.uVel = damp(this.uVel, steer.x * LAT_SPEED, 3.2, dt);
    this.yVel = damp(this.yVel, steer.y * VERT_SPEED, 2.8, dt);
    this.u += this.uVel * dt;
    if (Math.abs(this.u) > MAX_LATERAL) {
      this.u = Math.sign(this.u) * MAX_LATERAL;
      this.uVel *= 0.3;
    }
    this.y += this.yVel * dt;

    const ds = this.speed * dt;
    this.s += ds;
    this.distance += ds;

    this.updatePose(dt, events);
  }

  updatePose(dt, events) {
    const W = this.world;
    const F = W.pathFrame(this.s, this.frame);
    const x = F.x + F.rx * this.u;
    const z = F.z + F.rz * this.u;
    const ground = this.groundAt(x, z);
    const minY = ground + 3.2;
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    if (this.y < minY) {
      const pen = minY - this.y;
      this.y = minY;
      if (this.yVel < 0) this.yVel = -this.yVel * 0.3;
      if (pen > 1.5 && dt > 0 && this.bumpCooldown <= 0) {
        this.yVel += 10;
        this.speed *= 0.82;
        this.shake = Math.min(1, this.shake + 0.7);
        this.bumpCooldown = 0.8;
        events?.onBump?.();
      }
    }
    const maxY = W.groundAlongPath(this.s) + 230;
    if (this.y > maxY) {
      this.y = maxY;
      this.yVel = Math.min(this.yVel, 0);
    }
    this.pos.set(x, this.y, z);

    // orientation from the velocity vector
    const fx = F.tx * this.speed + F.rx * this.uVel;
    const fy = this.yVel;
    const fz = F.tz * this.speed + F.rz * this.uVel;
    this.forward.set(fx, fy, fz).normalize();
    // bank into turns (steering + path curvature)
    const curv = (W.pathSlope(this.s + 6) - W.pathSlope(this.s - 6)) / 12;
    const targetBank = Math.max(-1.0, Math.min(1.0, (this.uVel / LAT_SPEED) * 0.75 + curv * this.speed * this.speed * 0.012));
    this.bank = dt > 0 ? damp(this.bank, targetBank, 4, dt) : targetBank;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const r0 = new THREE.Vector3().crossVectors(this.forward, worldUp).normalize();
    const u0 = new THREE.Vector3().crossVectors(r0, this.forward).normalize();
    this.up.copy(u0).multiplyScalar(Math.cos(this.bank)).addScaledVector(r0, Math.sin(this.bank));
    this.right.crossVectors(this.forward, this.up).normalize();
    const back = this.forward.clone().negate();
    const m = new THREE.Matrix4().makeBasis(this.right, this.up, back);
    this.mesh.quaternion.setFromRotationMatrix(m);
    this.mesh.position.copy(this.pos);

    // wingtip trails
    if (dt > 0) {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const tip = this.pos.clone().addScaledVector(this.right, side * 2.9).addScaledVector(this.up, 0.4).addScaledVector(this.forward, -1.0);
        this.trails[i].push(tip);
      }
    }
  }

  updateCamera(camera, dt, time) {
    const mode = this.cameraMode;
    const fwdFlat = new THREE.Vector3(this.forward.x, this.forward.y * 0.35, this.forward.z).normalize();
    let dist = 15;
    let height = 4.6;
    let side = 0;
    let lookAhead = 26;
    if (mode === 'cinematic') {
      dist = 34;
      height = 3.0;
      side = Math.sin(time * 0.07) * 14;
      lookAhead = 10;
    }
    const desired = fwdFlat.clone().multiplyScalar(-dist);
    desired.y += height;
    desired.addScaledVector(this.right, side);
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * (mode === 'cinematic' ? 2.2 : 5.5));
      this.camOffset.lerp(desired, k);
    } else {
      this.camOffset.copy(desired);
    }
    if (mode === 'cockpit') {
      camera.position.copy(this.pos).addScaledVector(this.forward, -0.6).addScaledVector(this.up, 0.9);
      this.camLook.copy(this.pos).addScaledVector(this.forward, 40).addScaledVector(this.up, 0.9);
      camera.up.copy(this.up);
      this.mesh.visible = false;
    } else {
      this.mesh.visible = true;
      camera.position.copy(this.pos).add(this.camOffset);
      const g = this.groundAt(camera.position.x, camera.position.z) + 2.5;
      if (camera.position.y < g) camera.position.y = g;
      this.camLook.copy(this.pos).addScaledVector(this.forward, lookAhead);
      this.camLook.y += 1.5;
      const roll = this.bank * (mode === 'cinematic' ? 0.15 : 0.32);
      camera.up.set(0, 1, 0).addScaledVector(this.right, Math.sin(roll)).normalize();
    }
    // shake
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.9;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    // Orient from world-space eye/target (camera.lookAt expects scene space,
    // which differs from world space under the floating-origin root).
    this.lookM.lookAt(camera.position, this.camLook, camera.up);
    camera.quaternion.setFromRotationMatrix(this.lookM);

    // trails
    for (const t of this.trails) {
      t.material.uniforms.uOpacity.value = mode === 'cockpit' ? 0.0 : this.boosting ? 0.7 : 0.38;
      t.material.uniforms.uColor.value.setRGB(...(this.boosting ? [1.0, 0.75, 0.35] : [0.55, 0.92, 1.0]));
      t.build(this.pos, camera.position, this.boosting ? 0.2 : 0.12);
    }
  }
}

export const FLIGHT = { BASE_SPEED, BOOST_SPEED, CRUISE, MAX_LATERAL };
