// World-generation tests (node --test). These cover the deterministic,
// DOM-free part of the game: path, biomes, terrain heights and chunk meshes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, CHUNK_SIZE, REGION_LENGTH, WATER_LEVEL } from '../src/world/terrain.js';
import { BIOMES, BIOME_COUNT, FIRST_CYCLE } from '../src/world/biomes.js';
import { buildChunk, LOD_SEGMENTS } from '../src/world/chunkBuilder.js';
import { buildPropLibrary } from '../src/world/props.js';

test('terrain is deterministic per seed and differs between seeds', () => {
  const a = createWorld(42);
  const b = createWorld(42);
  const c = createWorld(43);
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 37.3 - 3000;
    const z = -i * 91.7;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
    if (Math.abs(a.heightAt(x, z) - c.heightAt(x, z)) > 0.01) diff++;
  }
  assert.ok(diff > 150, `expected different seeds to differ, only ${diff}/200 did`);
});

test('heights are finite and within sane bounds, even very far away', () => {
  const w = createWorld(1337);
  for (const base of [0, 1e5, 5e6, 2e7]) {
    for (let i = 0; i < 400; i++) {
      const x = w.pathX(base + i * 53) + (i % 21 - 10) * 140;
      const z = -(base + i * 53);
      const h = w.heightAt(x, z);
      assert.ok(Number.isFinite(h), `non-finite height at ${x},${z}`);
      assert.ok(h > -120 && h < 700, `height ${h} out of range at ${x},${z}`);
    }
  }
});

test('flight path is smooth and its frame is orthonormal', () => {
  const w = createWorld(7);
  let prev = w.pathX(0);
  const f = {};
  for (let s = 1; s < 50000; s += 1) {
    const x = w.pathX(s);
    assert.ok(Math.abs(x - prev) < 1.5, `path jumps at s=${s}`);
    prev = x;
    if (s % 997 === 0) {
      w.pathFrame(s, f);
      assert.ok(Math.abs(Math.hypot(f.tx, f.tz) - 1) < 1e-9);
      assert.ok(Math.abs(Math.hypot(f.rx, f.rz) - 1) < 1e-9);
      assert.ok(Math.abs(f.tx * f.rx + f.tz * f.rz) < 1e-9, 'tangent and right must be perpendicular');
      assert.ok(f.tz < 0, 'path must always head towards -z');
    }
  }
});

test('the valley keeps the flight corridor open', () => {
  const w = createWorld(1337);
  let blocked = 0;
  for (let s = 500; s < 60000; s += 25) {
    const g = w.groundAlongPath(s);
    // the terrain a little to either side of the centreline should not tower over the corridor
    const f = w.pathFrame(s, {});
    const side = Math.max(w.heightAt(f.x + f.rx * 20, f.z + f.rz * 20), w.heightAt(f.x - f.rx * 20, f.z - f.rz * 20));
    if (side > g + 40) blocked++;
  }
  assert.ok(blocked < 10, `corridor blocked at ${blocked} samples`);
});

test('biome regions never repeat back-to-back and the journey opens in the first curated biome', () => {
  const w = createWorld(99);
  assert.equal(w.regionBiome(0), FIRST_CYCLE[0]);
  assert.equal(w.regionBiome(-1), FIRST_CYCLE[0]);
  for (let i = 0; i < 400; i++) {
    const a = w.regionBiome(i);
    const b = w.regionBiome(i + 1);
    assert.ok(a >= 0 && a < BIOME_COUNT);
    assert.notEqual(a, b, `regions ${i} and ${i + 1} share biome ${BIOMES[a].key}`);
  }
  // every biome shows up in the first two cycles
  const seen = new Set();
  for (let i = 0; i < BIOME_COUNT * 2; i++) seen.add(w.regionBiome(i));
  assert.equal(seen.size, BIOME_COUNT);
  // the start of the journey is in the opening biome
  const b = w.biomeAt(w.pathX(300), -300);
  assert.equal(b.t > 0.5 ? b.b : b.a, FIRST_CYCLE[0]);
  assert.ok(REGION_LENGTH > 1000);
});

test('prop prototypes are valid triangle soups', () => {
  const lib = buildPropLibrary();
  for (const variants of lib) {
    for (const p of variants) {
      assert.equal(p.pos.length, p.count * 3);
      assert.equal(p.count % 3, 0, 'prototype must be a list of triangles');
      for (let i = 0; i < p.pos.length; i++) assert.ok(Number.isFinite(p.pos[i]));
    }
  }
});

for (const lod of [0, 1, 2]) {
  test(`chunk meshes are consistent at LOD ${lod}`, () => {
    const w = createWorld(1337);
    for (const s of [1500, 6000, 9500, 12800, 16000, 19200, 22400]) {
      const cx = Math.floor(w.pathX(s) / CHUNK_SIZE);
      const cz = Math.floor(-s / CHUNK_SIZE);
      const c = buildChunk(w, cx, cz, lod, 1);
      const t = c.terrain;
      const verts = t.pos.length / 3;
      const N = LOD_SEGMENTS[lod];
      assert.equal(verts, (N + 1) * (N + 1) + 4 * N, 'grid + skirt ring');
      assert.equal(t.nrm.length, verts * 3);
      assert.equal(t.col.length, verts * 4);
      assert.equal(t.mat.length, verts);
      for (const i of t.idx) assert.ok(i < verts, 'terrain index out of range');
      for (const v of t.pos) assert.ok(Number.isFinite(v));
      assert.ok(t.minY <= t.maxY);
      if (c.water) {
        const wv = c.water.pos.length / 3;
        assert.equal(c.water.dep.length, wv);
        assert.equal(c.water.tint.length, wv * 4);
        for (const i of c.water.idx) assert.ok(i < wv, 'water index out of range');
        for (let i = 0; i < wv; i++) assert.equal(c.water.pos[i * 3 + 1], WATER_LEVEL);
      }
      if (c.props) {
        assert.equal(c.props.pos.length, c.props.count * 3);
        assert.equal(c.props.col.length, c.props.count * 4);
        assert.equal(c.props.dat.length, c.props.count * 4);
        assert.equal(c.props.count % 3, 0);
        for (const v of c.props.pos) assert.ok(Number.isFinite(v));
      }
      // every typed array handed to postMessage must be transferable exactly once
      assert.equal(new Set(c.transfer).size, c.transfer.length);
    }
  });
}

test('chunk generation is deterministic (identical output from every worker)', () => {
  const a = buildChunk(createWorld(5), 2, -30, 0, 1);
  const b = buildChunk(createWorld(5), 2, -30, 0, 1);
  assert.deepEqual(a.terrain.pos, b.terrain.pos);
  assert.deepEqual(a.terrain.col, b.terrain.col);
  assert.equal(a.props?.count, b.props?.count);
  if (a.props) assert.deepEqual(a.props.pos, b.props.pos);
});
