// The procedural world: flight path, biome regions and the terrain height field.
// Pure JS so it can run identically in the chunk worker and on the main thread
// (the main thread uses it for collisions, ring placement and the autopilot).

import { createSimplex2D, mulberry32, hashInt, clamp, lerp, smoothstep, smin } from './noise.js';
import { BIOMES, BIOME_COUNT, FIRST_CYCLE } from './biomes.js';

export const CHUNK_SIZE = 256;
export const WATER_LEVEL = 0;
export const REGION_LENGTH = 3200; // metres of journey per biome region
const TRANSITION = 0.2; // fraction of a region used to blend into the next one

// Flight-path shape (lateral meander as a function of forward distance s).
const PATH_A1 = 300;
const PATH_F1 = 0.00024;
const PATH_A2 = 85;
const PATH_F2 = 0.00085;

export function createWorld(seed = 1) {
  seed = seed >>> 0;
  const nA = createSimplex2D(mulberry32(seed ^ 0x9e3779b9));
  const nB = createSimplex2D(mulberry32((seed * 7 + 13) ^ 0x85ebca6b));
  const nC = createSimplex2D(mulberry32((seed * 31 + 101) ^ 0xc2b2ae35));

  // ---------------------------------------------------------------- path
  function pathX(s) {
    return PATH_A1 * nA(s * PATH_F1, 0.5) + PATH_A2 * nA(s * PATH_F2, 9.5);
  }
  function pathSlope(s) {
    return (pathX(s + 2) - pathX(s - 2)) * 0.25;
  }

  // Per-s memo: rows of a chunk share the same z, so this hits constantly.
  let memoS = NaN;
  const memo = { x: 0, invLen: 1, widthN: 0, floorN: 0, riverOff: 0, riverW: 0 };
  function pathInfo(s) {
    if (s !== memoS) {
      memoS = s;
      const slope = pathSlope(s);
      memo.x = pathX(s);
      memo.invLen = 1 / Math.sqrt(1 + slope * slope);
      memo.widthN = nC(s * 0.0007, 40.5);
      memo.floorN = nC(s * 0.00045, 77.7);
      memo.riverOff = nC(s * 0.0032, 13.3);
      memo.riverW = nC(s * 0.0011, 91.1);
    }
    return memo;
  }

  /** Path frame at distance s: position (y = 0), unit tangent and right vectors. */
  function pathFrame(s, out = {}) {
    const slope = pathSlope(s);
    const inv = 1 / Math.sqrt(1 + slope * slope);
    out.x = pathX(s);
    out.z = -s;
    out.tx = slope * inv; // tangent points towards -z (forward)
    out.tz = -inv;
    out.rx = inv; // right = (-tz, 0, tx)
    out.rz = slope * inv;
    return out;
  }

  // ------------------------------------------------------------- regions
  const permCache = new Map();
  function rawPerm(c) {
    if (c === 0) return FIRST_CYCLE.slice();
    const r = mulberry32(hashInt(c, seed, 0x5bd1e995));
    const p = [];
    for (let i = 0; i < BIOME_COUNT; i++) p.push(i);
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    if (c === -1) {
      // The journey starts near the region -1/0 boundary (warped), so make the
      // region just behind the start share the opening biome.
      const k = p.indexOf(FIRST_CYCLE[0]);
      p.splice(k, 1);
      p.push(FIRST_CYCLE[0]);
    }
    return p;
  }
  function cyclePerm(c) {
    let p = permCache.get(c);
    if (p) return p;
    p = rawPerm(c);
    if (c !== 0) {
      // Never repeat a biome across a cycle boundary. Swapping the first two
      // entries never changes the last one, so comparing raw perms is exact.
      const prev = rawPerm(c - 1);
      if (p[0] === prev[prev.length - 1]) {
        const t = p[0];
        p[0] = p[1];
        p[1] = t;
      }
    }
    permCache.set(c, p);
    if (permCache.size > 64) permCache.delete(permCache.keys().next().value);
    return p;
  }
  function regionBiome(i) {
    const c = Math.floor(i / BIOME_COUNT);
    return cyclePerm(c)[i - c * BIOME_COUNT];
  }
  function regionCoord(x, z) {
    return -z / REGION_LENGTH + 0.3 * nB(x * 0.0004 + 50.0, z * 0.0004 - 20.0) + 0.08 * nC(x * 0.0013, z * 0.0013 + 80.0);
  }
  /** Biome blend at a point: out.a blends into out.b by out.t. */
  function biomeAt(x, z, out = {}) {
    const u = regionCoord(x, z);
    const i = Math.floor(u);
    const f = u - i;
    out.region = i;
    out.a = regionBiome(i);
    out.b = regionBiome(i + 1);
    out.t = smoothstep(1 - TRANSITION, 1, f);
    return out;
  }

  // ------------------------------------------------------------- terrain
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

  /**
   * Full terrain sample. Fills `out` with:
   *   h, a, b, t (biome blend), region, detail, cont, ridge, d (distance to path), vw (valley half width)
   */
  function sample(x, z, out = {}) {
    biomeAt(x, z, out);
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

    // Carve the flight valley along the path.
    const s = -z;
    const P = pathInfo(s);
    const d = Math.abs(x - P.x) * P.invLen;
    const vw = lerp(TA.valleyWidth, TB.valleyWidth, t) * (0.75 + 0.25 * (1 + P.widthN));
    const vfloor = lerp(TA.valleyFloor, TB.valleyFloor, t) + lerp(TA.floorVar, TB.floorVar, t) * P.floorN;
    const wall = lerp(TA.valleyWall, TB.valleyWall, t);
    const e = Math.max(0, d - vw);
    // a meandering river channel inside a raised floodplain
    const rOff = P.riverOff * vw * 0.35;
    const dr = Math.abs(x - P.x - rOff) * P.invLen;
    const rw = 13 + 9 * (1 + P.riverW);
    const chan = smoothstep(rw, rw * 0.3, dr);
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
    return out;
  }

  const tmpSample = {};
  function heightAt(x, z) {
    return sample(x, z, tmpSample).h;
  }

  /** Height of the ground or water surface along the path centre. */
  function groundAlongPath(s) {
    const x = pathX(s);
    return Math.max(WATER_LEVEL, heightAt(x, -s));
  }

  return {
    seed,
    nA,
    nB,
    nC,
    pathX,
    pathSlope,
    pathFrame,
    biomeAt,
    regionBiome,
    sample,
    heightAt,
    groundAlongPath,
  };
}
