import * as THREE from 'three';
import { WATER_LEVEL } from '../world/terrain.js';
import { MATTER } from '../world/matter.js';
import { closestOnSegment, segSegDist2, liquidMaterial, terrainMaterial } from './collision.js';

const TURN_RATE = 0.95; // rad/s at full stick
const PITCH_MAX = 0.62; // rad
const SPEED = { flyover: 46, game: 66, boost: 128 };
export const RADIUS = 2.2; // collision sphere of the glider
const MAX_HEALTH = 100;

function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
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
  tri(N, Cp, L, body);
  tri(Cp, T, L, body);
  tri(N, R, Cp, body);
  tri(Cp, R, T, body);
  tri(N, L, K, under);
  tri(K, L, T, under);
  tri(N, K, R, under);
  tri(K, T, R, under);
  tri([-2.3, 0.33, 0.92], [-0.2, 0.12, 0.74], [-2.25, 0.36, 1.0], accent);
  tri([2.3, 0.33, 0.92], [2.25, 0.36, 1.0], [0.2, 0.12, 0.74], accent);
  tri([0, 0.1, 0.1], [0, 1.0, 0.95], [0, 0.1, 0.85], body);
  tri(L, [L[0] + 0.05, L[1] + 0.65, L[2] + 0.25], [L[0] + 0.1, L[1], L[2] - 0.55], glow, 255);
  tri(R, [R[0] - 0.05, R[1] + 0.65, R[2] + 0.25], [R[0] - 0.1, R[1], R[2] - 0.55], glow, 255);
  tri([-0.25, 0.16, -2.0], [-2.6, 0.37, 0.8], [-2.55, 0.42, 0.75], glow, 200);
  tri([0.25, 0.16, -2.0], [2.55, 0.42, 0.75], [2.6, 0.37, 0.8], glow, 200);
  tri([-0.22, 0.02, 0.74], [0.22, 0.02, 0.74], [0, 0.28, 0.76], [255, 190, 120], 255);
  // face normals for the smooth-normal attribute
  const nrm = new Int8Array((P.length / 3) * 4);
  for (let t = 0; t < P.length / 9; t++) {
    const i = t * 9;
    const ax = P[i + 3] - P[i];
    const ay = P[i + 4] - P[i + 1];
    const az = P[i + 5] - P[i + 2];
    const bx = P[i + 6] - P[i];
    const by = P[i + 7] - P[i + 1];
    const bz = P[i + 8] - P[i + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 3; k++) {
      nrm[(t * 3 + k) * 4] = nx * 127;
      nrm[(t * 3 + k) * 4 + 1] = ny * 127;
      nrm[(t * 3 + k) * 4 + 2] = nz * 127;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(C), 4, true));
  g.setAttribute('aData', new THREE.BufferAttribute(new Uint8Array((P.length / 3) * 4), 4, true));
  g.setAttribute('aNormal', new THREE.BufferAttribute(nrm, 4, true));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ trails

const trailVert = /* glsl */ `
attribute float aFade;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
    this.fade = new Float32Array(count * 2);
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1));
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

// ------------------------------------------------------------------ the flyer

export class Flyer {
  constructor(world, chunks, propMaterial) {
    this.world = world;
    this.chunks = chunks;
    this.geometry = buildGliderGeometry();
    this.mesh = new THREE.Mesh(this.geometry, propMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(1.3);
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.trails = [new Trail(), new Trail()];
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.camOffset = new THREE.Vector3(0, 6, 16);
    this.camLook = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.lookM = new THREE.Matrix4();
    this.tmpM = new THREE.Matrix4();
    this.shake = 0;
    this.cameraMode = 'drone';
    this.gameMode = false;
    this.surf = {};
    this.apMode = 'river';
    this.apTimer = 50;
    this.wanderBias = 0;
    this.distance = 0;
  }

  reset(x, z, tx, tz) {
    const ground = this.world.surfaceAt(x, z, this.surf).y;
    this.pos.set(x, ground + 30, z);
    this.prevPos.copy(this.pos);
    this.yaw = Math.atan2(tx, -tz);
    this.pitch = 0;
    this.yawRate = 0;
    this.bank = 0;
    this.speed = SPEED.flyover;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.invuln = 0;
    this.lastHit = -10;
    this.respawnIn = 0;
    this.boostEnergy = 1;
    this.boosting = false;
    this.distance = 0;
    this.updateFrame();
    this.camFwd.copy(this.forward);
    for (const t of this.trails) t.reset();
  }

  /** Ground or liquid surface (what we can crash into) below a point. */
  floorAt(x, z) {
    return this.world.surfaceAt(x, z, this.surf).y;
  }

  updateFrame() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const r0 = new THREE.Vector3().crossVectors(this.forward, worldUp).normalize();
    const u0 = new THREE.Vector3().crossVectors(r0, this.forward).normalize();
    this.up.copy(u0).multiplyScalar(Math.cos(this.bank)).addScaledVector(r0, Math.sin(this.bank));
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  /** Graceful autopilot: follows rivers, wanders over hills, keeps clear of terrain and obstacles. */
  autopilot(dt, time) {
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.apTimer -= dt;
    if (this.apTimer <= 0) {
      this.apMode = this.apMode === 'river' ? 'wander' : 'river';
      this.apTimer = this.apMode === 'river' ? 70 + Math.random() * 80 : 25 + Math.random() * 30;
      this.wanderBias = (Math.random() - 0.5) * 0.5;
    }
    let desired = this.yaw;
    const ax = this.pos.x + fx * 150;
    const az = this.pos.z + fz * 150;
    const R = this.world.riverAt(ax, az);
    if (this.apMode === 'river' && R.d < 520) {
      const g = Math.hypot(R.gx, R.gz) || 1;
      let tx = -R.gz / g;
      let tz = R.gx / g;
      if (tx * fx + tz * fz < 0) {
        tx = -tx;
        tz = -tz;
      }
      const toward = -Math.sign(R.r);
      const pull = Math.min(1, R.d / 110) * 0.9;
      desired = Math.atan2(tx + toward * (R.gx / g) * pull, -(tz + toward * (R.gz / g) * pull));
    } else {
      let best = this.yaw;
      let bestCost = Infinity;
      for (const off of [-0.7, -0.35, 0, 0.35, 0.7]) {
        const a = this.yaw + off + this.wanderBias * 0.3;
        const sx = Math.sin(a);
        const sz = -Math.cos(a);
        let cost = Math.abs(off) * 30;
        for (const d of [160, 320, 520]) cost += Math.max(0, this.floorAt(this.pos.x + sx * d, this.pos.z + sz * d)) * (d === 160 ? 1.5 : 1);
        if (cost < bestCost) {
          bestCost = cost;
          best = a;
        }
      }
      desired = best;
    }

    // terrain ahead: climb early and smoothly
    const cruise = 30 + 24 * (0.5 + 0.5 * Math.sin(time * 0.021)) + 70 * Math.pow(Math.max(0, Math.sin(time * 0.0071 + 1.3)), 3);
    let need = this.floorAt(this.pos.x, this.pos.z) + cruise * 0.6;
    for (const d of [30, 70, 130, 210, 320]) {
      const g = this.floorAt(this.pos.x + fx * d, this.pos.z + fz * d);
      need = Math.max(need, g + cruise - d * 0.12);
    }

    // obstacles straight ahead: lift over them and lean away
    let lift = 0;
    let lean = 0;
    const p0 = this.pos;
    const p1 = { x: p0.x + this.forward.x * 110, y: p0.y + this.forward.y * 110, z: p0.z + this.forward.z * 110 };
    this.chunks.forEachColliderNear(p0.x + this.forward.x * 55, p0.z + this.forward.z * 55, 70, (qx, qy, qz, rx, ry, rz, r) => {
      const d2 = segSegDist2(p0, p1, qx, qy, qz, rx, ry, rz);
      const clear = r + 9;
      if (d2 < clear * clear) {
        lift = Math.max(lift, Math.max(ry, qy) + r + 10 - p0.y);
        const side = (qx - p0.x) * this.right.x + (qz - p0.z) * this.right.z;
        lean += side > 0 ? -1 : 1;
      }
    });
    if (lift > 0) need = Math.max(need, p0.y + lift);
    desired += Math.sign(lean) * 0.35;

    const err = wrapAngle(desired - this.yaw);
    const vy = (need - this.pos.y) / 2.5;
    const desiredPitch = Math.atan2(vy, this.speed);
    return {
      x: Math.max(-1, Math.min(1, err * 1.6)) * 0.55,
      y: Math.max(-1, Math.min(1, desiredPitch / PITCH_MAX)),
    };
  }

  update(dt, control, wantBoost, events, time) {
    this.prevPos.copy(this.pos);
    this.invuln = Math.max(0, this.invuln - dt);

    if (!this.alive) {
      // the wreck's momentum carries the camera on, slowing
      this.speed = damp(this.speed, 14, 1.2, dt);
      this.pitch = damp(this.pitch, 0.12, 1.5, dt);
      this.yawRate = damp(this.yawRate, 0, 1.5, dt);
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn(events);
    } else {
      const canBoost = this.gameMode && this.boostEnergy > 0.02;
      this.boosting = !!wantBoost && canBoost;
      if (this.boosting) this.boostEnergy = Math.max(0, this.boostEnergy - dt * 0.22);
      else this.boostEnergy = Math.min(1, this.boostEnergy + dt * 0.035);
      const base = this.gameMode ? SPEED.game : SPEED.flyover;
      this.speed = damp(this.speed, this.boosting ? SPEED.boost : base, this.boosting ? 1.6 : 0.8, dt);
      this.yawRate = damp(this.yawRate, control.x * TURN_RATE, 3.0, dt);
      this.pitch = damp(this.pitch, control.y * PITCH_MAX, 2.4, dt);
      if (this.gameMode && time - this.lastHit > 3) this.health = Math.min(MAX_HEALTH, this.health + dt * 6);
    }
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    const targetBank = Math.max(-1.1, Math.min(1.1, this.yawRate * 0.95));
    this.bank = damp(this.bank, targetBank, 4, dt);
    this.updateFrame();
    this.vel.copy(this.forward).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.distance += this.speed * dt;

    // ceiling: the sky has a limit
    const floor = this.floorAt(this.pos.x, this.pos.z);
    if (this.pos.y > floor + 480) {
      this.pos.y = floor + 480;
      this.pitch = Math.min(this.pitch, 0);
    }

    if (this.gameMode && this.alive) this.collide(dt, events, time);
    else {
      const clear = this.alive ? 6 : 3;
      if (this.pos.y < floor + clear) {
        this.pos.y = floor + clear;
        this.pitch = Math.max(this.pitch, 0.05);
      }
    }

    this.mesh.visible = this.gameMode && this.alive && (this.invuln <= 0 || Math.floor(time * 12) % 2 === 0);
    if (this.mesh.visible) {
      const back = this.forward.clone().negate();
      this.tmpM.makeBasis(this.right, this.up, back);
      this.mesh.quaternion.setFromRotationMatrix(this.tmpM);
      this.mesh.position.copy(this.pos);
    }
    if (dt > 0) {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const tip = this.pos.clone().addScaledVector(this.right, side * 3.6).addScaledVector(this.up, 0.5).addScaledVector(this.forward, -1.2);
        this.trails[i].push(tip);
      }
    }
  }

  hit(mat, damage, events, time, nx, ny, nz) {
    if (this.invuln > 0) return;
    this.health -= damage;
    this.lastHit = time;
    this.invuln = 0.35;
    this.shake = Math.min(1, this.shake + 0.25 + damage / 60);
    this.lastMat = mat;
    events?.onHit?.(mat, damage, this.pos, nx, ny, nz);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.respawnIn = 3.6;
      this.shake = 1;
      events?.onDeath?.(mat, this.pos.clone(), this.vel.clone(), this.mesh);
    }
  }

  collide(dt, events, time) {
    const W = this.world;
    const p = this.pos;
    const S = W.surfaceAt(p.x, p.z, this.surf);
    // ---- terrain / liquid
    if (p.y - RADIUS < S.y) {
      let nx = 0;
      let ny = 1;
      let nz = 0;
      let mat;
      if (S.liquid) {
        mat = liquidMaterial(S.liquidType);
      } else {
        const e = 2;
        const hx = W.heightAt(p.x + e, p.z) - W.heightAt(p.x - e, p.z);
        const hz = W.heightAt(p.x, p.z + e) - W.heightAt(p.x, p.z - e);
        nx = -hx / (2 * e);
        nz = -hz / (2 * e);
        const l = Math.hypot(nx, 1, nz);
        nx /= l;
        ny = 1 / l;
        nz /= l;
        mat = terrainMaterial(S.biome, S.h, 1 - ny, S.bl);
      }
      const vn = -(this.vel.x * nx + this.vel.y * ny + this.vel.z * nz);
      const hard = MATTER[mat].hardness;
      let damage;
      if (S.liquid) {
        // skimming liquid is survivable; diving in is not; lava burns regardless
        damage = Math.max(0, vn - 5) * 1.8 * hard + (MATTER[mat].key === 'lava' ? 38 : 2);
      } else {
        damage = (6 + Math.max(0, vn) * 1.25 + this.speed * 0.05) * hard;
      }
      p.y = S.y + RADIUS;
      this.pitch = Math.max(this.pitch, Math.min(0.55, 0.12 + vn * 0.01));
      this.speed *= 1 - Math.min(0.45, Math.max(0, vn) / Math.max(1, this.speed)) * 0.6;
      this.hit(mat, damage, events, time, nx, ny, nz);
    }
    if (!this.alive) return;
    // ---- props (trees, rocks, arches, spires...)
    let hitMat = -1;
    let best = 0;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    this.chunks.forEachColliderNear(p.x, p.z, 40, (ax, ay, az, bx, by, bz, r, mat) => {
      const t = closestOnSegment(p.x, p.y, p.z, ax, ay, az, bx, by, bz);
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      const cz = az + (bz - az) * t;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dy, dz);
      const pen = r + RADIUS - d;
      if (pen > best) {
        best = pen;
        hitMat = mat;
        const il = d > 1e-6 ? 1 / d : 0;
        bnx = dx * il;
        bny = d > 1e-6 ? dy * il : 1;
        bnz = dz * il;
        p.x += bnx * pen;
        p.y += bny * pen;
        p.z += bnz * pen;
      }
    });
    if (hitMat >= 0) {
      const vn = -(this.vel.x * bnx + this.vel.y * bny + this.vel.z * bnz);
      if (vn > 0) {
        // bounce: reflect the heading off the obstacle
        const v = this.vel.clone().addScaledVector(new THREE.Vector3(bnx, bny, bnz), vn * 1.6);
        this.yaw = Math.atan2(v.x, -v.z);
        this.pitch = Math.max(-0.3, Math.min(0.6, Math.atan2(v.y, Math.hypot(v.x, v.z))));
        this.speed *= 0.72;
        const damage = MATTER[hitMat].hardness * (10 + vn * 0.75);
        this.hit(hitMat, damage, events, time, bnx, bny, bnz);
      }
    }
  }

  respawn(events) {
    const ground = this.floorAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(this.pos.y, ground + 40);
    this.prevPos.copy(this.pos);
    this.alive = true;
    this.health = MAX_HEALTH;
    this.invuln = 2.5;
    this.speed = this.gameMode ? SPEED.game : SPEED.flyover;
    this.pitch = 0;
    for (const t of this.trails) t.reset();
    events?.onRespawn?.();
  }

  setGameMode(on) {
    this.gameMode = on;
    if (on) {
      this.health = MAX_HEALTH;
      this.alive = true;
      this.invuln = 2;
      this.boostEnergy = 1;
      this.cameraMode = this.preferredCamera || 'chase';
    } else {
      this.alive = true;
      this.cameraMode = 'drone';
    }
    for (const t of this.trails) t.reset();
  }

  updateCamera(camera, dt, time) {
    const mode = this.cameraMode;
    if (mode === 'drone') {
      // the camera *is* the flyer: smooth, with a gentle downward gaze
      const k = dt > 0 ? 1 - Math.exp(-dt * 2.2) : 1;
      this.camFwd.lerp(this.forward, k).normalize();
      camera.position.copy(this.pos);
      camera.position.y += Math.sin(time * 0.6) * 0.4;
      const g = this.floorAt(camera.position.x, camera.position.z) + 4;
      if (camera.position.y < g) camera.position.y = g;
      // gaze stays near level while climbing or diving, a little below the horizon
      const flat = Math.hypot(this.camFwd.x, this.camFwd.z) || 1;
      const gazePitch = Math.asin(Math.max(-1, Math.min(1, this.camFwd.y))) * 0.3 - 0.13;
      const look = new THREE.Vector3((this.camFwd.x / flat) * Math.cos(gazePitch), Math.sin(gazePitch), (this.camFwd.z / flat) * Math.cos(gazePitch));
      this.camLook.copy(camera.position).addScaledVector(look, 50);
      const roll = this.bank * 0.4;
      const r0 = new THREE.Vector3().crossVectors(this.camFwd, new THREE.Vector3(0, 1, 0)).normalize();
      camera.up.set(0, 1, 0).multiplyScalar(Math.cos(roll)).addScaledVector(r0, Math.sin(roll));
    } else {
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
      if (!this.alive) {
        dist = 30;
        height = 9;
      }
      const desired = fwdFlat.clone().multiplyScalar(-dist);
      desired.y += height;
      desired.addScaledVector(this.right, side);
      if (dt > 0) this.camOffset.lerp(desired, 1 - Math.exp(-dt * (mode === 'cinematic' ? 2.2 : 5.5)));
      else this.camOffset.copy(desired);
      if (mode === 'cockpit' && this.alive) {
        camera.position.copy(this.pos).addScaledVector(this.forward, -0.6).addScaledVector(this.up, 0.9);
        this.camLook.copy(this.pos).addScaledVector(this.forward, 40).addScaledVector(this.up, 0.9);
        camera.up.copy(this.up);
        this.mesh.visible = false;
      } else {
        camera.position.copy(this.pos).add(this.camOffset);
        const g = this.floorAt(camera.position.x, camera.position.z) + 2.5;
        if (camera.position.y < g) camera.position.y = g;
        this.camLook.copy(this.pos).addScaledVector(this.forward, this.alive ? lookAhead : 0);
        this.camLook.y += 1.5;
        const roll = this.bank * (mode === 'cinematic' ? 0.15 : 0.32);
        camera.up.set(0, 1, 0).addScaledVector(this.right, Math.sin(roll)).normalize();
      }
    }
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 1.2;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    // orient from world-space eye/target (camera.lookAt expects scene space)
    this.lookM.lookAt(camera.position, this.camLook, camera.up);
    camera.quaternion.setFromRotationMatrix(this.lookM);

    const showTrails = this.gameMode && this.alive && mode !== 'cockpit';
    for (const t of this.trails) {
      t.mesh.visible = showTrails;
      if (!showTrails) continue;
      t.material.uniforms.uOpacity.value = this.boosting ? 0.7 : 0.38;
      t.material.uniforms.uColor.value.setRGB(...(this.boosting ? [1.0, 0.75, 0.35] : [0.55, 0.92, 1.0]));
      t.build(this.pos, camera.position, this.boosting ? 0.2 : 0.12);
    }
  }
}
