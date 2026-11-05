// World-generation tests (node --test). These cover the deterministic,
// DOM-free part of the game: generations, memory/epochs, borderland blending,
// chunk meshes, colliders and materials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, CHUNK_SIZE, WATER_LEVEL, REGION_SIZE } from '../src/world/terrain.js';
import { createWorldView, makeGenerationCache } from '../src/world/world.js';
import { WorldMemory } from '../src/world/memory.js';
import { createBlendSampler, EPOCH_CELL } from '../src/world/blend.js';
import { BIOMES, BIOME_COUNT, START_BIOME } from '../src/world/biomes.js';
import { buildChunk, LOD_SEGMENTS, COLLIDER_STRIDE } from '../src/world/chunkBuilder.js';
import { buildPropLibrary } from '../src/world/props.js';
import { MAT, MATTER } from '../src/world/matter.js';

test('a generation is deterministic per seed and differs between seeds', () => {
  const a = createGeneration(42);
  const b = createGeneration(42);
  const c = createGeneration(43);
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 37.3 - 3000;
    const z = -i * 91.7 + 500;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
    if (Math.abs(a.heightAt(x, z) - c.heightAt(x, z)) > 0.01) diff++;
  }
  assert.ok(diff > 150, `expected different seeds to differ, only ${diff}/200 did`);
});

test('heights are finite and within sane bounds, even very far away, in every direction', () => {
  const g = createGeneration(1337, { startBiome: START_BIOME });
  for (const r of [0, 1e5, 5e6, 2e7]) {
    for (let i = 0; i < 300; i++) {
      const a = (i / 300) * Math.PI * 2;
      const x = Math.cos(a) * r + (i % 17) * 61;
      const z = Math.sin(a) * r - (i % 13) * 53;
      const h = g.heightAt(x, z);
      assert.ok(Number.isFinite(h), `non-finite height at ${x},${z}`);
      assert.ok(h > -120 && h < 700, `height ${h} out of range at ${x},${z}`);
    }
  }
});

test('every biome appears, and the journey opens in the start biome on a river', () => {
  const g = createGeneration(7, { startBiome: START_BIOME });
  const seen = new Set();
  for (let iz = -6; iz <= 6; iz++) for (let ix = -6; ix <= 6; ix++) seen.add(g.site(ix, iz).biome);
  assert.equal(seen.size, BIOME_COUNT);
  assert.equal(g.regionAt(0, 0).a, START_BIOME);
  const w = createWorldView(7);
  const sp = w.startPoint();
  assert.ok(Math.hypot(sp.x, sp.z) < REGION_SIZE, 'start point should be near the origin');
  assert.ok(g.river(sp.x, sp.z).d < 40, 'start point should be on a river');
});

test('memory: pinned cells keep their epoch, forgotten ground is generated anew', () => {
  const m = new WorldMemory({ memorySeconds: 40 });
  m.now = 0;
  const e0 = m.epochOf(0, 0);
  assert.equal(e0, 0);
  // flying onwards into unexplored ground continues the same epoch
  for (let i = 1; i < 30; i++) assert.equal(m.epochOf(0, -i), 0);
  // keep (0,0) pinned, let everything else age
  for (let t = 1; t <= 100; t++) {
    m.now = t;
    m.pin(0, 0);
    m.tick(t);
  }
  assert.equal(m.epochOf(0, 0), 0, 'a pinned cell must never change');
  assert.equal(m.ageOf(0, -20), undefined, 'unpinned cells are forgotten');
  // re-entering forgotten ground starts a new epoch
  const e = m.epochOf(0, -20);
  assert.equal(e, 1);
  assert.equal(m.drainEvents().length, 1);
  // and the rest of that excursion continues the new epoch
  assert.equal(m.epochOf(0, -21), 1);
});

test('the world view really changes when you return beyond memory', () => {
  const W = createWorldView(1337, { memorySeconds: 40 });
  const M = W.memory;
  const fly = (z0, z1, t0) => {
    let t = t0;
    const dir = Math.sign(z1 - z0);
    for (let z = z0; dir * (z1 - z) > 0; z += dir * 35) {
      t += 0.5;
      M.now = t;
      const cz = Math.floor(z / EPOCH_CELL);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) M.pinBlock(dx, cz + dz);
      M.tick(t);
    }
    return t;
  };
  const before = W.heightAt(140, -2200);
  let t = fly(0, -14000, 0);
  assert.equal(M.epoch, 0, 'flying straight on never forgets what is ahead');
  t = fly(-14000, 0, t);
  assert.ok(M.epoch >= 1, 'returning past the edge of memory starts a new epoch');
  assert.notEqual(W.heightAt(140, -2200), before, 'the land you return to is new');
});

test('borderland blending is continuous and peaks between generations', () => {
  const getGen = makeGenerationCache(9);
  const sampler = createBlendSampler(getGen, (ix) => (ix >= 0 ? 1 : 0));
  const s = {};
  let prev = null;
  let maxJump = 0;
  let maxBl = 0;
  // rift shards make the borderland steep, but it must stay continuous:
  // sampled every centimetre, no step may exceed half a metre
  for (let x = -900; x <= 900; x += 0.01) {
    sampler.sample(x, 333, s);
    assert.ok(Number.isFinite(s.h));
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(s.h - prev));
    prev = s.h;
    maxBl = Math.max(maxBl, s.bl);
  }
  assert.ok(maxBl > 0.9, `borderland should reach full strength (got ${maxBl})`);
  assert.ok(maxJump < 0.5, `terrain must not tear across the border (max step ${maxJump.toFixed(3)} m per cm)`);
  sampler.sample(-800, 333, s);
  assert.equal(s.bl, 0);
  assert.equal(s.e0, 0);
  sampler.sample(800, 333, s);
  assert.equal(s.bl, 0);
  assert.equal(s.e0, 1);
});

test('prop prototypes are valid triangle soups with finite smooth normals', () => {
  for (const variants of buildPropLibrary()) {
    for (const p of variants) {
      assert.equal(p.pos.length, p.count * 3);
      assert.equal(p.nrm.length, p.count * 3);
      assert.equal(p.count % 3, 0, 'prototype must be a list of triangles');
      for (let i = 0; i < p.pos.length; i++) assert.ok(Number.isFinite(p.pos[i]) && Number.isFinite(p.nrm[i]));
    }
  }
});

const ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const MIXED = [0, 0, 1, 0, 0, 1, 0, 1, 1];

for (const lod of [0, 1, 2]) {
  test(`chunk meshes and colliders are consistent at LOD ${lod}`, () => {
    const getGen = makeGenerationCache(1337);
    const g = getGen(0);
    let anyColliders = 0;
    for (let b = 0; b < BIOME_COUNT; b++) {
      let spot = null;
      for (let r = 0; r < 8 && !spot; r++) {
        for (let iz = -r; iz <= r && !spot; iz++) {
          for (let ix = -r; ix <= r && !spot; ix++) {
            const s = g.site(ix, iz);
            if (s.biome === b) spot = g.nearestRiver(s.x, s.z) || s;
          }
        }
      }
      const cx = Math.floor(spot.x / CHUNK_SIZE);
      const cz = Math.floor(spot.z / CHUNK_SIZE);
      for (const epochs of [ZERO, MIXED]) {
        const c = buildChunk(getGen, epochs, cx, cz, lod, 1);
        const t = c.terrain;
        const verts = t.pos.length / 3;
        const N = LOD_SEGMENTS[lod];
        assert.equal(verts, (N + 1) * (N + 1) + 4 * N, 'grid + skirt ring');
        assert.equal(t.nrm.length, verts * 3);
        assert.equal(t.col.length, verts * 4);
        assert.equal(t.mat.length, verts * 4);
        for (const i of t.idx) assert.ok(i < verts, 'terrain index out of range');
        for (const v of t.pos) assert.ok(Number.isFinite(v));
        if (c.water) {
          const wv = c.water.pos.length / 3;
          assert.equal(c.water.dep.length, wv);
          assert.equal(c.water.tint.length, wv * 4);
          for (const i of c.water.idx) assert.ok(i < wv, 'water index out of range');
          for (let i = 0; i < wv; i++) assert.equal(c.water.pos[i * 3 + 1], WATER_LEVEL);
        }
        if (c.props) {
          assert.equal(c.props.pos.length, c.props.count * 3);
          assert.equal(c.props.nrm.length, c.props.count * 4);
          assert.equal(c.props.col.length, c.props.count * 4);
          assert.equal(c.props.dat.length, c.props.count * 4);
          for (const v of c.props.pos) assert.ok(Number.isFinite(v));
        }
        assert.equal(c.colliders.length % COLLIDER_STRIDE, 0);
        for (let i = 0; i < c.colliders.length; i += COLLIDER_STRIDE) {
          for (let k = 0; k < 7; k++) assert.ok(Number.isFinite(c.colliders[i + k]));
          assert.ok(c.colliders[i + 6] > 0, 'collider radius must be positive');
          assert.ok(MATTER[c.colliders[i + 7]], 'collider material must exist');
        }
        anyColliders += c.colliders.length;
        assert.equal(new Set(c.transfer).size, c.transfer.length, 'each buffer transferred once');
      }
    }
    if (lod === 0) assert.ok(anyColliders > 0, 'props must come with colliders');
  });
}

test('adjacent chunks agree on their shared edge, even across generations', () => {
  const getGen = makeGenerationCache(1337);
  const mem = new WorldMemory();
  mem.assignHook = (ix) => (ix >= 2 ? 1 : 0);
  const blockOf = (cx, cz) => mem.block(Math.floor(cx / 2), Math.floor(cz / 2));
  for (const [cx, cz] of [[3, -6], [2, 4], [-1, 0]]) {
    const A = buildChunk(getGen, blockOf(cx, cz), cx, cz, 0, 1);
    const B = buildChunk(getGen, blockOf(cx + 1, cz), cx + 1, cz, 0, 1);
    const N = 64;
    for (let j = 0; j <= N; j++) {
      const ha = A.terrain.pos[(j * (N + 1) + N) * 3 + 1];
      const hb = B.terrain.pos[(j * (N + 1)) * 3 + 1];
      assert.ok(Math.abs(ha - hb) < 1e-4, `seam at chunk ${cx},${cz} row ${j}: ${ha} vs ${hb}`);
    }
  }
});

test('chunk generation is deterministic (identical output from every worker)', () => {
  const a = buildChunk(makeGenerationCache(5), MIXED, 2, -30, 0, 1);
  const b = buildChunk(makeGenerationCache(5), MIXED, 2, -30, 0, 1);
  assert.deepEqual(a.terrain.pos, b.terrain.pos);
  assert.deepEqual(a.terrain.col, b.terrain.col);
  assert.deepEqual(a.colliders, b.colliders);
  assert.equal(a.props?.count, b.props?.count);
  if (a.props) assert.deepEqual(a.props.pos, b.props.pos);
});

test('every material has a eulogy and an explosion style', () => {
  for (const id of Object.values(MAT)) {
    const m = MATTER[id];
    assert.ok(m, `material ${id} missing`);
    assert.ok(m.line && m.style && m.hardness > 0 && m.debris.length >= 1);
  }
  assert.equal(BIOMES.length, BIOME_COUNT);
});
