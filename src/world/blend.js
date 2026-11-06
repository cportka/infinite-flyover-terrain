// The live world is a patchwork of generations ("epochs") laid on a grid of
// EPOCH_CELL squares. Inside a cell whose neighbours share its epoch the world
// is exactly that generation; where neighbouring cells hold different epochs,
// the terrain morphs between the two worlds across a warped band: the Borderland.
//
// Weights at a point depend only on the epochs of the 4 nearest cell centres,
// which all lie in the 3x3 block around the point's cell. That is what lets a
// chunk be built from just its 3x3 epoch neighbourhood (and stay valid while
// those 9 epochs are pinned by WorldMemory).

import { CHUNK_SIZE } from './terrain.js';
import { createSimplex2D, mulberry32, smoothstep } from './noise.js';

export const EPOCH_CELL = CHUNK_SIZE * 2;

const warpN = createSimplex2D(mulberry32(0xb0bde7));
const riftN = createSimplex2D(mulberry32(0x5eed9a));

export function epochCell(v) {
  return Math.floor(v / EPOCH_CELL);
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * @param getGen (epoch) => generation
 * @param epochOf (ix, iz) => epoch of an epoch cell
 */
export function createBlendSampler(getGen, epochOf) {
  const subs = [{}, {}, {}, {}];
  const ep = [0, 0, 0, 0];
  const wt = [0, 0, 0, 0];
  let count = 0;

  /** Fills ep/wt with the distinct epochs at (x, z), sorted by weight; returns their count. */
  function weights(x, z) {
    const wx = x + 70 * warpN(x * 0.0035, z * 0.0035);
    const wz = z + 70 * warpN(x * 0.0035 + 17.7, z * 0.0035 - 4.2);
    const fx = wx / EPOCH_CELL - 0.5;
    const fz = wz / EPOCH_CELL - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const tx = smooth(fx - i0);
    const tz = smooth(fz - j0);
    const e00 = epochOf(i0, j0);
    const e10 = epochOf(i0 + 1, j0);
    const e01 = epochOf(i0, j0 + 1);
    const e11 = epochOf(i0 + 1, j0 + 1);
    count = 0;
    if (e00 === e10 && e00 === e01 && e00 === e11) {
      ep[0] = e00;
      wt[0] = 1;
      count = 1;
      return 1;
    }
    const add = (e, w) => {
      if (w <= 0) return;
      for (let k = 0; k < count; k++) {
        if (ep[k] === e) {
          wt[k] += w;
          return;
        }
      }
      ep[count] = e;
      wt[count] = w;
      count++;
    };
    add(e00, (1 - tx) * (1 - tz));
    add(e10, tx * (1 - tz));
    add(e01, (1 - tx) * tz);
    add(e11, tx * tz);
    // sort descending by weight (tiny n)
    for (let a = 1; a < count; a++) {
      for (let b = a; b > 0 && wt[b] > wt[b - 1]; b--) {
        let t = wt[b];
        wt[b] = wt[b - 1];
        wt[b - 1] = t;
        t = ep[b];
        ep[b] = ep[b - 1];
        ep[b - 1] = t;
      }
    }
    if (count === 0) {
      ep[0] = e00;
      wt[0] = 1;
      count = 1;
    }
    return count;
  }

  /**
   * Blended sample. `out` gets every field of the dominant generation's sample,
   * plus: h (blended), bl (borderland 0..1), n (generations involved),
   * e0/w0 and e1/w1/s1 (second generation and its raw sample, when n > 1).
   */
  function sample(x, z, out = {}) {
    const n = weights(x, z);
    if (n === 1) {
      getGen(ep[0]).sample(x, z, out);
      out.bl = 0;
      out.n = 1;
      out.e0 = ep[0];
      out.w0 = 1;
      out.s1 = null;
      return out;
    }
    let h = 0;
    for (let k = 0; k < n; k++) {
      getGen(ep[k]).sample(x, z, subs[k]);
      h += wt[k] * subs[k].h;
    }
    Object.assign(out, subs[0]);
    const bl = smoothstep(0, 1, (1 - wt[0]) * 2);
    // the Borderland: torn ground with shards of rock pushing up through it
    const rv = 1 - Math.abs(riftN(x * 0.018, z * 0.018));
    const shards = Math.pow(rv, 7) * 26 + Math.pow(1 - Math.abs(riftN(x * 0.05 + 9.1, z * 0.05)), 9) * 9;
    h += bl * (shards * bl - 4);
    out.h = h;
    out.bl = bl;
    out.n = n;
    out.e0 = ep[0];
    out.w0 = wt[0];
    out.e1 = ep[1];
    out.w1 = wt[1];
    out.s1 = subs[1];
    return out;
  }

  const tmp = {};
  function heightAt(x, z) {
    return sample(x, z, tmp).h;
  }

  /** Weight of a given epoch at a point (0 if absent). */
  function weightOf(epoch, x, z) {
    const n = weights(x, z);
    for (let k = 0; k < n; k++) if (ep[k] === epoch) return wt[k];
    return 0;
  }

  /** Dominant epoch at a point. */
  function dominantEpoch(x, z) {
    weights(x, z);
    return ep[0];
  }

  return { sample, heightAt, weightOf, dominantEpoch };
}
