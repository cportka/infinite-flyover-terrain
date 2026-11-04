import * as THREE from 'three';
import { CHUNK_SIZE } from './terrain.js';
import { buildChunk } from './chunkBuilder.js';

export const QUALITY = {
  low: { R: 1650, R0: 400, R1: 880, density: 0.5, behind: 300 },
  medium: { R: 2050, R0: 540, R1: 1120, density: 0.75, behind: 340 },
  high: { R: 2450, R0: 660, R1: 1380, density: 1.0, behind: 380 },
};

const S = CHUNK_SIZE;
const HYST = 40;

function keyOf(cx, cz) {
  return cx + ',' + cz;
}

export class ChunkManager {
  constructor({ root, seed, world, materials, quality = 'high' }) {
    this.root = root;
    this.seed = seed;
    this.world = world;
    this.mats = materials;
    this.chunks = new Map(); // key -> { cx, cz, lod, group, meshes }
    this.pending = new Map(); // key -> Set(lod)
    this.desired = new Map(); // key -> { cx, cz, lod, d }
    this.results = [];
    this.lastX = Infinity;
    this.lastZ = Infinity;
    this.lastRecalc = 0;
    this.stats = { chunks: 0, pending: 0, props: 0 };
    this.setQuality(quality);
    this.fallback = false;
    this.workers = [];
    this.initWorkers();
  }

  setQuality(q) {
    this.q = QUALITY[q] || QUALITY.high;
    this.qualityName = q;
    this.lastX = Infinity; // force recompute
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
      const set = this.pending.get(msg.key);
      if (set) set.clear();
      return;
    }
    this.results.push(msg);
  }

  lodFor(d, current) {
    const { R0, R1 } = this.q;
    let lod = d < R0 ? 0 : d < R1 ? 1 : 2;
    if (current !== undefined && Math.abs(current - lod) === 1) {
      // hysteresis around the threshold between the two levels
      const th = Math.min(current, lod) === 0 ? R0 : R1;
      if (Math.abs(d - th) < HYST) lod = current;
    }
    return lod;
  }

  recompute(camX, camZ) {
    const { R, behind } = this.q;
    const desired = this.desired;
    desired.clear();
    const cx0 = Math.floor((camX - R) / S);
    const cx1 = Math.floor((camX + R) / S);
    const cz0 = Math.floor((camZ - R) / S);
    const cz1 = Math.floor((camZ + behind) / S);
    for (let cz = cz0; cz <= cz1; cz++) {
      const zMin = cz * S;
      const zMax = zMin + S;
      if (zMin > camZ + behind) continue;
      const dz = camZ < zMin ? zMin - camZ : camZ > zMax ? camZ - zMax : 0;
      for (let cx = cx0; cx <= cx1; cx++) {
        const xMin = cx * S;
        const xMax = xMin + S;
        const dx = camX < xMin ? xMin - camX : camX > xMax ? camX - xMax : 0;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const key = keyOf(cx, cz);
        const cur = this.chunks.get(key);
        const lod = this.lodFor(d, cur ? cur.lod : undefined);
        // prioritise what is ahead of the camera
        const ahead = camZ - (zMin + S / 2);
        desired.set(key, { cx, cz, lod, d, prio: d - Math.max(0, Math.min(ahead, 600)) * 0.35 });
      }
    }
    // drop chunks that are no longer wanted
    for (const [key, c] of this.chunks) {
      if (!desired.has(key)) this.disposeChunk(key, c);
    }
  }

  update(camX, camZ, budgetMs = 4) {
    const now = performance.now();
    if (Math.hypot(camX - this.lastX, camZ - this.lastZ) > 24 || now - this.lastRecalc > 500) {
      this.lastX = camX;
      this.lastZ = camZ;
      this.lastRecalc = now;
      this.recompute(camX, camZ);
    }

    // queue requests
    const todo = [];
    for (const [key, d] of this.desired) {
      const cur = this.chunks.get(key);
      if (cur && cur.lod === d.lod) continue;
      const p = this.pending.get(key);
      if (p && p.has(d.lod)) continue;
      todo.push(d);
    }
    todo.sort((a, b) => a.prio - b.prio);

    if (this.fallback) {
      // synchronous generation: at most one chunk per frame
      if (todo.length) {
        const d = todo[0];
        const out = buildChunk(this.world, d.cx, d.cz, d.lod, this.q.density);
        this.results.push({ ...out, key: keyOf(d.cx, d.cz) });
      }
    } else {
      let ti = 0;
      for (const slot of this.workers) {
        if (!slot.ok) continue;
        while (slot.inflight < 2 && ti < todo.length) {
          const d = todo[ti++];
          const key = keyOf(d.cx, d.cz);
          let set = this.pending.get(key);
          if (!set) {
            set = new Set();
            this.pending.set(key, set);
          }
          set.add(d.lod);
          slot.inflight++;
          slot.w.postMessage({ type: 'gen', key, cx: d.cx, cz: d.cz, lod: d.lod, density: this.q.density, seed: this.seed });
        }
      }
    }

    // install finished chunks within a time budget
    const t0 = performance.now();
    while (this.results.length && performance.now() - t0 < budgetMs) {
      const r = this.results.shift();
      const set = this.pending.get(r.key);
      if (set) {
        set.delete(r.lod);
        if (set.size === 0) this.pending.delete(r.key);
      }
      const want = this.desired.get(r.key);
      if (!want) continue;
      const cur = this.chunks.get(r.key);
      if (r.lod !== want.lod && cur) continue; // stale, and we already have something
      if (cur && cur.lod === r.lod) continue;
      this.install(r, cur);
    }

    let pending = 0;
    for (const s of this.pending.values()) pending += s.size;
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
    tg.setAttribute('aMat', new THREE.BufferAttribute(t.mat, 1, true));
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
    this.chunks.set(key, { cx: r.cx, cz: r.cz, lod: r.lod, group, meshes });
  }

  disposeChunk(key, c) {
    this.root.remove(c.group);
    for (const m of c.meshes) m.geometry.dispose();
    this.chunks.delete(key);
  }

  /** Loading progress for the chunks that matter at start-up (near + mid rings). */
  progress() {
    let total = 0;
    let done = 0;
    for (const [key, d] of this.desired) {
      if (d.d > this.q.R1) continue;
      total++;
      const c = this.chunks.get(key);
      if (c) done++;
    }
    return total === 0 ? 0 : done / total;
  }

  dispose() {
    for (const [key, c] of this.chunks) this.disposeChunk(key, c);
    for (const s of this.workers) s.w.terminate();
  }
}
