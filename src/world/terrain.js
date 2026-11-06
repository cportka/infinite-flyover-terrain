// A "generation" is one complete, deterministic, infinite 2D world for a seed:
// Voronoi biome regions, a meandering river network carved into valleys, and
// the terrain height field. The live world is a patchwork of generations
// (see blend.js / memory.js), which is how the world forgets and renews itself.
// Pure JS: runs identically in the chunk workers and on the main thread.

import { createSimplex2D, mulberry32, hashInt, hash01, clamp, lerp, smoothstep, smin } from './noise.js';
import { BIOMES, BIOME_COUNT } from './biomes.js';

export const CHUNK_SIZE = 256;
export const WATER_LEVEL = 0;
export const REGION_SIZE = 2600; // spacing of biome region sites (m)
const REGION_BLEND = 560; // d2 - d1 range over which neighbouring regions blend
const RIVER_FREQ = 1 / 2300; // river network spacing (zero-set of a low-frequency field)
export const LANDMARK_CELL = 1000;

export function createGeneration(seed = 1, { startBiome = null } = {}) {
  seed = seed >>> 0;
  const nA = createSimplex2D(mulberry32(seed ^ 0x9e3779b9));
  const nB = createSimplex2D(mulberry32((seed * 7 + 13) ^ 0x85ebca6b));
  const nC = createSimplex2D(mulberry32((seed * 31 + 101) ^ 0xc2b2ae35));
  const nR = createSimplex2D(mulberry32((seed * 131 + 7) ^ 0x27d4eb2d));

  // ------------------------------------------------------------ biome regions
  const sites = new Map();
  const rawPick = (ix, iz) => hashInt(ix, iz, seed, 0x51e) % BIOME_COUNT;
  function site(ix, iz) {
    const key = (ix + 32768) * 65536 + (iz + 32768);
    let s = sites.get(key);
    if (s) return s;
    let x;
    let z;
    let biome;
    if (startBiome !== null && ix === 0 && iz === 0) {
      x = 0;
      z = 0;
      biome = startBiome;
    } else {
      x = (ix + (hash01(ix, iz, seed, 11) - 0.5) * 0.6) * REGION_SIZE;
      z = (iz + (hash01(ix, iz, seed, 12) - 0.5) * 0.6) * REGION_SIZE;
      biome = rawPick(ix, iz);
      // avoid repeating the biome of the left / upper neighbours
      for (let k = 0; k < 3 && (biome === rawPick(ix - 1, iz) || biome === rawPick(ix, iz - 1)); k++) {
        biome = (biome + 1) % BIOME_COUNT;
      }
    }
    s = { x, z, biome, key };
    sites.set(key, s);
    if (sites.size > 4096) sites.delete(sites.keys().next().value);
    return s;
  }

  /** Biome blend at a point: out.a blends into out.b by out.t (t <= 0.5, a dominates). */
  function regionAt(x, z, out = {}) {
    const wx = x + 0.17 * REGION_SIZE * nB(x * 0.00025 + 3.3, z * 0.00025 - 7.1);
    const wz = z + 0.17 * REGION_SIZE * nB(x * 0.00025 - 9.9, z * 0.00025 + 1.7);
    const cx = Math.round(wx / REGION_SIZE);
    const cz = Math.round(wz / REGION_SIZE);
    let d1 = Infinity;
    let d2 = Infinity;
    let s1 = null;
    let s2 = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const s = site(cx + dx, cz + dz);
        const d = Math.hypot(wx - s.x, wz - s.z);
        if (d < d1) {
          d2 = d1;
          s2 = s1;
          d1 = d;
          s1 = s;
        } else if (d < d2) {
          d2 = d;
          s2 = s;
        }
      }
    }
    out.a = s1.biome;
    out.b = s2.biome;
    out.t = s1.biome === s2.biome ? 0 : 0.5 - 0.5 * smoothstep(0, REGION_BLEND, d2 - d1);
    out.region = s1.key;
    return out;
  }

  // ------------------------------------------------------------ noise helpers
  function fbm(x, z, oct) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * nA(x * f + o * 31.7, z * f - o * 17.3);
      norm += amp;
      amp *= 0.5;
      f *= 2.02;
    }
    return sum / norm;
  }

  function ridged(x, z, oct) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    let w = 1;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(nB(x * f + o * 13.1, z * f + o * 7.7));
      v *= v;
      v *= w;
      w = clamp(v * 1.7, 0, 1);
      sum += v * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.05;
    }
    return sum / norm;
  }

  // ------------------------------------------------------------ rivers
  // Rivers run along the zero-set of a warped low-frequency field r(x,z).
  // Distance to the river ~ |r| / |grad r|.
  function riverRaw(wx, wz) {
    return nR(wx * RIVER_FREQ, wz * RIVER_FREQ) * 0.75 + nC(wx * RIVER_FREQ * 2.3 + 11.1, wz * RIVER_FREQ * 2.3 - 4.4) * 0.25;
  }
  const MIN_GRAD = RIVER_FREQ * 0.45;
  function river(x, z, out = {}) {
    const ox = 150 * nR(x * 0.0011 + 5.5, z * 0.0011 - 2.2);
    const oz = 150 * nR(x * 0.0011 - 8.8, z * 0.0011 + 6.6);
    const wx = x + ox;
    const wz = z + oz;
    const e = 3;
    const r = riverRaw(wx, wz);
    const gx = (riverRaw(wx + e, wz) - r) / e;
    const gz = (riverRaw(wx, wz + e) - r) / e;
    const g = Math.max(MIN_GRAD, Math.hypot(gx, gz));
    out.r = r;
    out.gx = gx;
    out.gz = gz;
    out.g = g;
    out.d = Math.abs(r) / g;
    return out;
  }

  // ------------------------------------------------------------ height field
  function biomeHeight(T, cont, hills, ridge, mmBase, detail) {
    const mm = smoothstep(-0.15, 0.5, mmBase + T.mtnBias);
    let h = T.base + T.contAmp * cont + T.hillAmp * hills + T.mtnAmp * Math.pow(ridge, T.ridgePow) * mm + T.detailAmp * detail;
    if (T.terrace > 0) {
      const k = h / T.terraceStep;
      const fl = Math.floor(k);
      const tf = fl + smoothstep(0.22, 0.78, k - fl);
      h = lerp(h, tf * T.terraceStep, T.terrace);
    }
    return h;
  }

  const RV = {};
  /**
   * Full terrain sample. Fills `out` with:
   *   h, a, b, t (biome blend), region, detail, cont, ridge,
   *   d (distance to river), vw (valley half width), floor, rgx/rgz (river field gradient)
   */
  function sample(x, z, out = {}) {
    regionAt(x, z, out);
    const TA = BIOMES[out.a].terrain;
    const TB = BIOMES[out.b].terrain;
    const t = out.t;

    const wx = x + 80 * nA(x * 0.0016 + 13.1, z * 0.0016 + 71.9);
    const wz = z + 80 * nA(x * 0.0016 - 41.3, z * 0.0016 + 5.7);
    const cont = fbm(wx * 0.00021, wz * 0.00021, 3);
    const hills = fbm(wx * 0.0022, wz * 0.0022, 4);
    const ridge = ridged(wx * 0.001, wz * 0.001, 5);
    const mmBase = 0.65 * nB(x * 0.00033 + 300, z * 0.00033 - 200) + 0.5 * cont;
    const detail = 0.7 * nA(x * 0.031, z * 0.031) + 0.3 * nB(x * 0.083 + 5, z * 0.083 - 5);

    let h = biomeHeight(TA, cont, hills, ridge, mmBase, detail);
    if (t > 0) h = lerp(h, biomeHeight(TB, cont, hills, ridge, mmBase, detail), t);

    // carve valleys around the river network
    river(x, z, RV);
    const d = RV.d;
    const vw = lerp(TA.valleyWidth, TB.valleyWidth, t) * (0.75 + 0.25 * (1 + nC(x * 0.0007, z * 0.0007 + 40.5)));
    const vfloor = lerp(TA.valleyFloor, TB.valleyFloor, t) + lerp(TA.floorVar, TB.floorVar, t) * nC(x * 0.00045 + 77.7, z * 0.00045);
    const wall = lerp(TA.valleyWall, TB.valleyWall, t);
    const e = Math.max(0, d - vw);
    const rw = 13 + 9 * (1 + nC(x * 0.0011 + 91.1, z * 0.0011));
    const chan = smoothstep(rw, rw * 0.3, d);
    const floodplain = vfloor + 4.2 + 0.9 * detail;
    const bed = vfloor - 2.4 + 0.3 * detail;
    const valleyFloor = floodplain + (bed - floodplain) * chan;
    const profile = valleyFloor + wall * e * e + 0.03 * e;
    h = smin(h, profile, 12);

    out.h = h;
    out.cont = cont;
    out.ridge = ridge;
    out.detail = detail;
    out.d = d;
    out.vw = vw;
    out.floor = vfloor;
    out.rgx = RV.gx;
    out.rgz = RV.gz;
    out.rr = RV.r;
    return out;
  }

  const tmp = {};
  function heightAt(x, z) {
    return sample(x, z, tmp).h;
  }

  // ------------------------------------------------------------ landmarks
  // One candidate per LANDMARK_CELL; snapped onto the river when one is near,
  // oriented across the valley (arches, gates) or free-standing otherwise.
  const lmCache = new Map();
  const LR = {};
  function landmark(kx, kz) {
    const key = (kx + 32768) * 65536 + (kz + 32768);
    if (lmCache.has(key)) return lmCache.get(key);
    const r = mulberry32(hashInt(kx, kz, seed, 0x1a2d));
    let x = (kx + 0.2 + 0.6 * r()) * LANDMARK_CELL;
    let z = (kz + 0.2 + 0.6 * r()) * LANDMARK_CELL;
    const roll = r();
    const seedL = hashInt(kx, kz, seed, 0x77);
    river(x, z, LR);
    let spec = null;
    if (LR.d < 300) {
      for (let i = 0; i < 3; i++) {
        river(x, z, LR);
        const g2 = LR.gx * LR.gx + LR.gz * LR.gz + 1e-12;
        x -= (LR.r * LR.gx) / g2;
        z -= (LR.r * LR.gz) / g2;
      }
      river(x, z, LR);
      const g = Math.hypot(LR.gx, LR.gz) || 1;
      if (LR.d < 25) {
        spec = { x, z, river: true, ax: LR.gx / g, az: LR.gz / g, roll, seed: seedL };
      }
    }
    if (!spec && roll < 0.45) spec = { x, z, river: false, ax: 1, az: 0, roll, seed: seedL };
    lmCache.set(key, spec);
    if (lmCache.size > 2048) lmCache.delete(lmCache.keys().next().value);
    return spec;
  }

  /** Nearest point on a river, searched from (x, z); returns {x, z, tx, tz} or null. */
  function nearestRiver(x, z) {
    const o = {};
    for (let i = 0; i < 8; i++) {
      river(x, z, o);
      const g2 = o.gx * o.gx + o.gz * o.gz + 1e-12;
      const k = Math.min(1, 400 / Math.max(1e-6, Math.abs(o.r) / Math.sqrt(g2)));
      x -= ((o.r * o.gx) / g2) * k;
      z -= ((o.r * o.gz) / g2) * k;
    }
    river(x, z, o);
    if (o.d > 40) return null;
    const g = Math.hypot(o.gx, o.gz) || 1;
    return { x, z, tx: -o.gz / g, tz: o.gx / g };
  }

  return { seed, nA, nB, nC, nR, regionAt, river, sample, heightAt, landmark, nearestRiver, site };
}

/** Seed of the generation for an epoch (epoch 0 is the shareable base world). */
export function generationSeed(baseSeed, epoch) {
  return epoch === 0 ? baseSeed >>> 0 : hashInt(baseSeed, epoch, 0xe90c) >>> 0;
}
