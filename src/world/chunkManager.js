import * as THREE from 'three';
import { CHUNK_SIZE } from './terrain.js';
import { buildChunk } from './chunkBuilder.js';
import { makeGenerationCache } from './world.js';

export const QUALITY = {
  low: { R: 1650, R0: 380, R1: 860, density: 0.5 },
  medium: { R: 2050, R0: 500, R1: 1100, density: 0.75 },
  high: { R: 2450, R0: 600, R1: 1350, density: 1.0 },
};

const S = CHUNK_SIZE;
const HYST = 40;
const BEHIND = 0.6; // chunks behind the direction of travel count as this much farther

function keyOf(cx, cz) {
  return cx + ',' + cz;
}

export class ChunkManager {
  constructor({ root, seed, world, materials, quality = 'high' }) {
    this.root = root;
    this.seed = seed;
    this.world = world; // main-thread world view (memory + generations)
    this.memory = world.memory;
    this.mats = materials;
    this.chunks = new Map(); // key -> { cx, cz, lod, group, meshes, colliders, ox, oz }
    this.pending = new Map(); // key -> Map(lod -> epochs)
    this.desired = new Map();
    this.results = [];
    this.lastX = Infinity;
    this.lastZ = Infinity;
    this.lastFx = 0;
    this.lastFz = -1;
    this.lastRecalc = 0;
    this.lastPin = -Infinity;
    this.stats = { chunks: 0, pending: 0 };
    this.setQuality(quality);
    this.fallback = false;
    this.workers = [];
    this.fallbackGen = null;
    this.initWorkers();
  }

  setQuality(q) {
    this.q = QUALITY[q] || QUALITY.high;
    this.qualityName = q;
    this.lastX = Infinity;
  }

  get viewRadius() {
    return this.q.R;
  }

  initWorkers() {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
        const slot = { w, inflight: 0, ok: true };
        w.onmessage = (e) => {
          slot.inflight = Math.max(0, slot.inflight - 1);
          this.onResult(e.data);
        };
        w.onerror = (e) => {
          console.warn('[chunks] worker failed, falling back to main thread', e.message || e);
          slot.ok = false;
          if (this.workers.every((s) => !s.ok)) this.fallback = true;
        };
        w.postMessage({ type: 'init', seed: this.seed });
        this.workers.push(slot);
      }
    } catch (err) {
      console.warn('[chunks] module workers unavailable, generating on main thread', err);
      this.fallback = true;
    }
  }

  onResult(msg) {
    if (msg.type === 'error') {
      console.error('[chunks] generation error', msg.message);
      const p = this.pending.get(msg.key);
      if (p) p.clear();
      return;
    }
    this.results.push(msg);
  }

  lodFor(d, current) {
    const { R0, R1 } = this.q;
    let lod = d < R0 ? 0 : d < R1 ? 1 : 2;
    if (current !== undefined && Math.abs(current - lod) === 1) {
      const th = Math.min(current, lod) === 0 ? R0 : R1;
      if (Math.abs(d - th) < HYST) lod = current;
    }
    return lod;
  }

  recompute(camX, camZ, fx, fz) {
    const { R } = this.q;
    const desired = this.desired;
    desired.clear();
    const cx0 = Math.floor((camX - R) / S);
    const cx1 = Math.floor((camX + R) / S);
    const cz0 = Math.floor((camZ - R) / S);
    const cz1 = Math.floor((camZ + R) / S);
    for (let cz = cz0; cz <= cz1; cz++) {
      const zMin = cz * S;
      const zMax = zMin + S;
      const dz = camZ < zMin ? zMin - camZ : camZ > zMax ? camZ - zMax : 0;
      for (let cx = cx0; cx <= cx1; cx++) {
        const xMin = cx * S;
        const xMax = xMin + S;
        const dx = camX < xMin ? xMin - camX : camX > xMax ? camX - xMax : 0;
        const d = Math.hypot(dx, dz);
        // direction to the chunk centre vs heading: things behind count as farther
        const vx = xMin + S / 2 - camX;
        const vz = zMin + S / 2 - camZ;
        const vl = Math.hypot(vx, vz) || 1;
        const behind = Math.max(0, -(vx * fx + vz * fz) / vl);
        const de = d * (1 + BEHIND * behind);
        if (de > R) continue;
        const key = keyOf(cx, cz);
        const cur = this.chunks.get(key);
        const lod = this.lodFor(de, cur ? cur.lod : undefined);
        desired.set(key, { cx, cz, lod, d: de, prio: de - (1 - behind) * 120 });
      }
    }
    for (const [key, c] of this.chunks) {
      if (!desired.has(key)) this.disposeChunk(key, c);
    }
  }

  /** Keep every live chunk's epoch neighbourhood remembered, then let the rest fade. */
  pinAndTick(now) {
    const mem = this.memory;
    mem.now = now;
    for (const c of this.chunks.values()) mem.pinBlock(Math.floor(c.cx / 2), Math.floor(c.cz / 2));
    for (const key of this.pending.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      mem.pinBlock(Math.floor(cx / 2), Math.floor(cz / 2));
    }
    for (const d of this.desired.values()) {
      if (d.lod === 0) mem.pinBlock(Math.floor(d.cx / 2), Math.floor(d.cz / 2));
    }
    mem.tick(now);
  }

  update(camX, camZ, fx, fz, now, budgetMs = 4) {
    const t = performance.now();
    const turned = fx * this.lastFx + fz * this.lastFz < 0.97;
    if (Math.hypot(camX - this.lastX, camZ - this.lastZ) > 24 || turned || t - this.lastRecalc > 500) {
      this.lastX = camX;
      this.lastZ = camZ;
      this.lastFx = fx;
      this.lastFz = fz;
      this.lastRecalc = t;
      this.recompute(camX, camZ, fx, fz);
    }
    if (now - this.lastPin > 0.5) {
      this.lastPin = now;
      this.pinAndTick(now);
    }

    const todo = [];
    for (const [key, d] of this.desired) {
      const cur = this.chunks.get(key);
      if (cur && cur.lod === d.lod) continue;
      const p = this.pending.get(key);
      if (p && p.has(d.lod)) continue;
      todo.push(d);
    }
    todo.sort((a, b) => a.prio - b.prio);

    const mem = this.memory;
    if (this.fallback) {
      if (todo.length) {
        const d = todo[0];
        if (!this.fallbackGen) this.fallbackGen = makeGenerationCache(this.seed, 10);
        const epochs = mem.block(Math.floor(d.cx / 2), Math.floor(d.cz / 2));
        const out = buildChunk(this.fallbackGen, epochs, d.cx, d.cz, d.lod, this.q.density);
        this.results.push({ ...out, key: keyOf(d.cx, d.cz) });
      }
    } else {
      let ti = 0;
      for (const slot of this.workers) {
        if (!slot.ok) continue;
        while (slot.inflight < 2 && ti < todo.length) {
          const d = todo[ti++];
          const key = keyOf(d.cx, d.cz);
          const ex = Math.floor(d.cx / 2);
          const ez = Math.floor(d.cz / 2);
          mem.pinBlock(ex, ez);
          const epochs = mem.block(ex, ez);
          let p = this.pending.get(key);
          if (!p) {
            p = new Map();
            this.pending.set(key, p);
          }
          p.set(d.lod, epochs);
          slot.inflight++;
          slot.w.postMessage({ type: 'gen', key, cx: d.cx, cz: d.cz, lod: d.lod, density: this.q.density, seed: this.seed, epochs });
        }
      }
    }

    const t0 = performance.now();
    while (this.results.length && performance.now() - t0 < budgetMs) {
      const r = this.results.shift();
      const p = this.pending.get(r.key);
      if (p) {
        p.delete(r.lod);
        if (p.size === 0) this.pending.delete(r.key);
      }
      const want = this.desired.get(r.key);
      if (!want) continue;
      // a chunk built against epochs that have since changed would not match its neighbours
      const ex = Math.floor(r.cx / 2);
      const ez = Math.floor(r.cz / 2);
      const now9 = mem.block(ex, ez);
      if (r.epochs && now9.some((e, i) => e !== r.epochs[i])) continue;
      const cur = this.chunks.get(r.key);
      if (r.lod !== want.lod && cur) continue;
      if (cur && cur.lod === r.lod) continue;
      this.install(r, cur);
    }

    let pending = 0;
    for (const p of this.pending.values()) pending += p.size;
    this.stats.chunks = this.chunks.size;
    this.stats.pending = pending + this.results.length;
  }

  install(r, old) {
    const group = new THREE.Group();
    group.position.set(r.cx * S, 0, r.cz * S);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const meshes = [];

    const t = r.terrain;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(t.nrm, 3, true));
    tg.setAttribute('aColor', new THREE.BufferAttribute(t.col, 4, true));
    tg.setAttribute('aMat', new THREE.BufferAttribute(t.mat, 4, true));
    tg.setIndex(new THREE.BufferAttribute(t.idx, 1));
    tg.boundingBox = new THREE.Box3(new THREE.Vector3(0, t.minY, 0), new THREE.Vector3(S, t.maxY, S));
    tg.boundingSphere = tg.boundingBox.getBoundingSphere(new THREE.Sphere());
    const tm = new THREE.Mesh(tg, this.mats.terrain);
    tm.matrixAutoUpdate = false;
    meshes.push(tm);

    if (r.water) {
      const w = r.water;
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(w.pos, 3));
      wg.setAttribute('aDepth', new THREE.BufferAttribute(w.dep, 1));
      wg.setAttribute('aTint', new THREE.BufferAttribute(w.tint, 4, true));
      wg.setIndex(new THREE.BufferAttribute(w.idx, 1));
      wg.boundingBox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(S, 1, S));
      wg.boundingSphere = wg.boundingBox.getBoundingSphere(new THREE.Sphere());
      const wm = new THREE.Mesh(wg, this.mats.water);
      wm.matrixAutoUpdate = false;
      wm.renderOrder = 1;
      meshes.push(wm);
    }

    if (r.props) {
      const p = r.props;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
      pg.setAttribute('aNormal', new THREE.BufferAttribute(p.nrm, 4, true));
      pg.setAttribute('aColor', new THREE.BufferAttribute(p.col, 4, true));
      pg.setAttribute('aData', new THREE.BufferAttribute(p.dat, 4, true));
      pg.boundingBox = new THREE.Box3(new THREE.Vector3(...p.min).subScalar(3), new THREE.Vector3(...p.max).addScalar(3));
      pg.boundingSphere = pg.boundingBox.getBoundingSphere(new THREE.Sphere());
      const pm = new THREE.Mesh(pg, this.mats.props);
      pm.matrixAutoUpdate = false;
      meshes.push(pm);
    }

    for (const m of meshes) group.add(m);
    this.root.add(group);
    group.updateMatrixWorld(true);
    const key = r.key;
    if (old) this.disposeChunk(key, old);
    this.chunks.set(key, { cx: r.cx, cz: r.cz, lod: r.lod, group, meshes, colliders: r.colliders, ox: r.cx * S, oz: r.cz * S });
  }

  disposeChunk(key, c) {
    this.root.remove(c.group);
    for (const m of c.meshes) m.geometry.dispose();
    this.chunks.delete(key);
  }

  /**
   * Visit colliders near (x, z): fn(ax, ay, az, bx, by, bz, r, mat) in world coordinates.
   * Only loaded chunks are searched (props exist only where chunks are loaded).
   */
  forEachColliderNear(x, z, radius, fn) {
    const c0x = Math.floor((x - radius) / S);
    const c1x = Math.floor((x + radius) / S);
    const c0z = Math.floor((z - radius) / S);
    const c1z = Math.floor((z + radius) / S);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this.chunks.get(keyOf(cx, cz));
        if (!c || !c.colliders) continue;
        const C = c.colliders;
        for (let i = 0; i < C.length; i += 8) {
          fn(C[i] + c.ox, C[i + 1], C[i + 2] + c.oz, C[i + 3] + c.ox, C[i + 4], C[i + 5] + c.oz, C[i + 6], C[i + 7]);
        }
      }
    }
  }

  /** Loading progress for the chunks that matter at start-up (near + mid rings). */
  progress() {
    let total = 0;
    let done = 0;
    for (const [key, d] of this.desired) {
      if (d.d > this.q.R1) continue;
      total++;
      if (this.chunks.get(key)) done++;
    }
    return total === 0 ? 0 : done / total;
  }

  dispose() {
    for (const [key, c] of this.chunks) this.disposeChunk(key, c);
    for (const s of this.workers) s.w.terminate();
  }
}
