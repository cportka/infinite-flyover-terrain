// Main-thread view of the live world: generations + memory + blending.
// The chunk workers build meshes from exactly the same functions, fed with the
// epochs this memory hands out, so collisions match what is rendered.

import { createGeneration, generationSeed, WATER_LEVEL } from './terrain.js';
import { createBlendSampler, epochCell } from './blend.js';
import { WorldMemory } from './memory.js';
import { START_BIOME, BIOMES } from './biomes.js';

export function makeGenerationCache(baseSeed, limit = 8) {
  const gens = new Map();
  return function getGen(epoch) {
    let g = gens.get(epoch);
    if (!g) {
      g = createGeneration(generationSeed(baseSeed, epoch), { startBiome: epoch === 0 ? START_BIOME : null });
      gens.set(epoch, g);
      if (gens.size > limit) gens.delete(gens.keys().next().value);
    }
    return g;
  };
}

export function createWorldView(baseSeed, { memorySeconds = 40 } = {}) {
  const memory = new WorldMemory({ memorySeconds });
  const getGen = makeGenerationCache(baseSeed);
  const sampler = createBlendSampler(getGen, (ix, iz) => memory.epochOf(ix, iz));
  const S = {};
  const RV = {};

  /** Terrain height (no water). */
  function heightAt(x, z) {
    return sampler.heightAt(x, z);
  }

  /** Ground or liquid surface, plus what it is made of. */
  function surfaceAt(x, z, out = {}) {
    sampler.sample(x, z, S);
    const B = BIOMES[S.t > 0.5 ? S.b : S.a];
    out.h = S.h;
    out.liquid = S.h < WATER_LEVEL;
    out.liquidType = B.liquid;
    out.y = Math.max(S.h, WATER_LEVEL);
    out.biome = S.t > 0.5 ? S.b : S.a;
    out.bl = S.bl;
    return out;
  }

  /** River field of the dominant generation at a point (for the autopilot). */
  function riverAt(x, z) {
    const e = sampler.dominantEpoch(x, z);
    return getGen(e).river(x, z, RV);
  }

  /** Sample including biome blend and borderland weight. */
  function sample(x, z, out = {}) {
    return sampler.sample(x, z, out);
  }

  /** A pleasant starting point: on a river near the origin, heading along it. */
  function startPoint() {
    const g = getGen(memory.epochOf(epochCell(0), epochCell(0)));
    const p = g.nearestRiver(0, 0) || g.nearestRiver(600, 300) || { x: 0, z: 0, tx: 0, tz: -1 };
    // head roughly "north" (-z) for a consistent opening
    if (p.tz > 0) {
      p.tx = -p.tx;
      p.tz = -p.tz;
    }
    return p;
  }

  /** Find a spot in a given biome near the origin (used by ?biome= for testing). */
  function findBiome(biome) {
    const g = getGen(0);
    for (let r = 1; r < 12; r++) {
      for (let iz = -r; iz <= r; iz++) {
        for (let ix = -r; ix <= r; ix++) {
          if (Math.max(Math.abs(ix), Math.abs(iz)) !== r) continue;
          const s = g.site(ix, iz);
          if (s.biome === biome) return g.nearestRiver(s.x, s.z) || { x: s.x, z: s.z, tx: 0, tz: -1 };
        }
      }
    }
    return null;
  }

  return { memory, getGen, sampler, heightAt, surfaceAt, riverAt, sample, startPoint, findBiome };
}
