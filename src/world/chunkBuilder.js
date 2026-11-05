// Builds the typed arrays for one terrain chunk from its 3x3 epoch
// neighbourhood: terrain mesh (with skirts), water/lava/mercury/mirror surface,
// baked low-poly props with smooth normals, and capsule colliders (with what
// each thing is made of). Runs inside the workers (or on the main thread as a
// fallback). Output contains only transferable typed arrays.

import { BIOME, BIOMES, LIQUID, hex } from './biomes.js';
import { CHUNK_SIZE, WATER_LEVEL, LANDMARK_CELL } from './terrain.js';
import { createBlendSampler } from './blend.js';
import { mulberry32, hashInt, clamp, lerp, smoothstep } from './noise.js';
import { PROP, buildPropLibrary, archProto, ringGateProto, islandProto, gothicGateProto, haloProto } from './props.js';
import { MAT } from './matter.js';

export const LOD_SEGMENTS = [64, 32, 16];
export const MESA_STRATA = [0xc4673a, 0xd98b52, 0xeab47e, 0xb5523a, 0xf2d3a2, 0xa84a30, 0xd77d4a];
export const COLLIDER_STRIDE = 8;

let LIB = null;
function lib() {
  if (!LIB) LIB = buildPropLibrary();
  return LIB;
}

// ------------------------------------------------------------------ colour helpers

function set3(o, c) {
  o[0] = c[0];
  o[1] = c[1];
  o[2] = c[2];
}
function mix3(o, c, t) {
  if (t <= 0) return;
  if (t >= 1) {
    set3(o, c);
    return;
  }
  o[0] += (c[0] - o[0]) * t;
  o[1] += (c[1] - o[1]) * t;
  o[2] += (c[2] - o[2]) * t;
}
function shade3(o, k) {
  o[0] *= k;
  o[1] *= k;
  o[2] *= k;
}

const C = {
  meadow: {
    grassA: hex(0x5d9a3a), grassB: hex(0x93c652), dry: hex(0xc2c46c), forest: hex(0x3c6a2c), high: hex(0xa4ad6c),
    rock: hex(0x8d877a), rock2: hex(0x6e6a62), sand: hex(0xdccb9c), bed: hex(0x6f8460),
  },
  alpine: {
    grassA: hex(0x4f7d48), grassB: hex(0x759a58), forest: hex(0x2f5232), rock: hex(0x727b8c), rock2: hex(0x4f5668),
    snow: hex(0xf3f7ff), snow2: hex(0xd9e4f6), gravel: hex(0x8e8c80), bed: hex(0x5d7070),
  },
  mesa: { mid: hex(0xcf8352), sand: hex(0xe3bd88), scrub: hex(0xb6a05e), wet: hex(0xb08a5a), bed: hex(0x8a6a48) },
  mystic: {
    grassA: hex(0x5a3c9e), grassB: hex(0x8f62d4), teal: hex(0x2aa38f), moss: hex(0x4ff0d0),
    rock: hex(0x3d3654), rock2: hex(0x5c517c), shore: hex(0xc4aaea), bed: hex(0x3a2e6c), forest: hex(0x3a2670),
  },
  autumn: {
    groundA: hex(0xa96a2c), groundB: hex(0xcf913c), green: hex(0x7f8c3a), forest: hex(0x7a4020), rock: hex(0x80726a),
    rock2: hex(0x625850), shore: hex(0xccb48a), bed: hex(0x6a5a3c),
  },
  coast: {
    sand: hex(0xf2e2b6), wet: hex(0xd6bf8c), grassA: hex(0x4caa48), grassB: hex(0x2e8a3e), rock: hex(0x9c978c),
    rock2: hex(0x7c776e), bed: hex(0xdccc9a), forest: hex(0x2a7034),
  },
  volcanic: {
    groundA: hex(0x1f1b1b), groundB: hex(0x352a26), ash: hex(0x5a524e), rock: hex(0x141213), crack: hex(0xff5a14),
    bed: hex(0x2a1410), glass: hex(0x1e1828),
  },
  gothic: {
    heath: hex(0x4b3f52), dead: hex(0x6b6050), peat: hex(0x2b2329), moss: hex(0x3a4838), rock: hex(0x3c3a44),
    rock2: hex(0x2c2b32), shore: hex(0x4a3c3c), bed: hex(0x1a1014), frost: hex(0x8a8a9a),
  },
  prism: {
    pearl: hex(0xece8f4), lilac: hex(0xcdbfee), mint: hex(0xc4f2e4), blush: hex(0xf6d0e6), rock: hex(0xb8b0d0),
    shore: hex(0xfaf6ff), bed: hex(0x9a90c0),
  },
  border: { ash: hex(0x2c2733), ash2: hex(0x4a4058), crack: hex(0xa04aff) },
};

// Per-vertex extras written by terrainColor (painted per pixel by the shader).
let STRATA = 0;
let PRISMW = 0;

/**
 * Terrain colour per biome. Writes sRGB into o and returns emissive strength (0..1).
 * h: height, sl: slope (0 flat .. 1 vertical), n: detail noise, m: moisture, fm: forest mask
 */
function terrainColor(b, o, h, sl, n, m, fm, ridge) {
  STRATA = 0;
  PRISMW = 0;
  switch (b) {
    case BIOME.MEADOW: {
      const P = C.meadow;
      set3(o, P.grassA);
      mix3(o, P.grassB, 0.5 + 0.45 * n);
      mix3(o, P.dry, smoothstep(0.15, 0.85, m) * 0.55);
      mix3(o, P.forest, fm * 0.6);
      mix3(o, P.high, smoothstep(45, 100, h) * 0.6);
      mix3(o, n > 0 ? P.rock : P.rock2, smoothstep(0.22, 0.4, sl + n * 0.05));
      mix3(o, P.sand, 1 - smoothstep(0.35, 1.3, h + n * 0.35));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -3, h));
      return 0;
    }
    case BIOME.ALPINE: {
      const P = C.alpine;
      set3(o, P.grassA);
      mix3(o, P.grassB, 0.5 + 0.4 * n);
      mix3(o, P.forest, fm * 0.65 * (1 - smoothstep(70, 110, h)));
      mix3(o, n > 0 ? P.rock : P.rock2, Math.max(smoothstep(0.16, 0.32, sl + n * 0.05), smoothstep(95, 140, h) * 0.85));
      const snowLine = 105 + 35 * n + 25 * m;
      const snow = smoothstep(snowLine - 12, snowLine + 12, h) * (1 - smoothstep(0.45, 0.7, sl));
      mix3(o, sl > 0.25 ? P.snow2 : P.snow, snow);
      mix3(o, P.gravel, 1 - smoothstep(0.5, 2.5, h + n));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -3, h));
      return 0;
    }
    case BIOME.MESA: {
      const P = C.mesa;
      set3(o, P.mid);
      shade3(o, 0.92 + 0.12 * n);
      const flat = 1 - smoothstep(0.08, 0.2, sl);
      STRATA = (1 - flat) * smoothstep(3, 9, h);
      mix3(o, m > 0.1 ? P.scrub : P.sand, flat * 0.85);
      mix3(o, P.sand, (1 - smoothstep(3, 9, h)) * 0.9);
      mix3(o, P.wet, 1 - smoothstep(0.3, 1.4, h));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -2, h));
      return 0;
    }
    case BIOME.MYSTIC: {
      const P = C.mystic;
      set3(o, P.grassA);
      mix3(o, P.grassB, 0.5 + 0.45 * n);
      mix3(o, P.teal, smoothstep(0.2, 0.7, m) * 0.7);
      mix3(o, P.forest, fm * 0.5);
      mix3(o, n > 0 ? P.rock2 : P.rock, smoothstep(0.22, 0.42, sl + n * 0.05));
      let em = 0;
      const moss = smoothstep(0.55, 0.8, m + n * 0.25) * (1 - smoothstep(0.15, 0.3, sl)) * smoothstep(1, 3, h);
      if (moss > 0) {
        mix3(o, P.moss, moss * 0.7);
        em = moss * 0.3;
      }
      mix3(o, P.shore, 1 - smoothstep(0.35, 1.3, h + n * 0.35));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -3, h));
      return em;
    }
    case BIOME.AUTUMN: {
      const P = C.autumn;
      set3(o, P.groundA);
      mix3(o, P.groundB, 0.5 + 0.45 * n);
      mix3(o, P.green, smoothstep(-0.2, -0.7, m) * 0.6);
      mix3(o, P.forest, fm * 0.55);
      mix3(o, n > 0 ? P.rock : P.rock2, smoothstep(0.22, 0.42, sl + n * 0.05));
      mix3(o, P.shore, 1 - smoothstep(0.35, 1.3, h + n * 0.35));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -3, h));
      return 0;
    }
    case BIOME.COAST: {
      const P = C.coast;
      set3(o, P.grassA);
      mix3(o, P.grassB, 0.5 + 0.45 * n);
      mix3(o, P.forest, fm * 0.5);
      mix3(o, n > 0 ? P.rock : P.rock2, smoothstep(0.2, 0.38, sl + n * 0.05));
      mix3(o, P.sand, 1 - smoothstep(2.5, 6.5, h + n * 1.5));
      mix3(o, P.wet, 1 - smoothstep(0.2, 1.0, h));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -2, h));
      return 0;
    }
    case BIOME.VOLCANIC: {
      const P = C.volcanic;
      set3(o, P.groundA);
      mix3(o, P.groundB, 0.5 + 0.45 * n);
      mix3(o, P.ash, (1 - smoothstep(0.08, 0.2, sl)) * smoothstep(0.0, 0.7, m) * 0.55);
      mix3(o, P.glass, smoothstep(0.3, 0.5, sl) * 0.6);
      mix3(o, P.rock, smoothstep(0.22, 0.42, sl));
      const crack = Math.max(smoothstep(0.8, 0.93, ridge + n * 0.06), 1 - smoothstep(0.2, 2.4, h));
      let em = 0;
      if (crack > 0) {
        mix3(o, P.crack, crack);
        em = crack * 0.9;
      }
      if (h < 0) mix3(o, P.bed, smoothstep(0, -1.5, h));
      return em;
    }
    case BIOME.GOTHIC: {
      const P = C.gothic;
      set3(o, P.heath);
      mix3(o, P.dead, smoothstep(-0.1, 0.7, m) * 0.6 + n * 0.1);
      mix3(o, P.moss, fm * 0.45);
      mix3(o, P.peat, smoothstep(0.3, -0.6, n + m * 0.3) * 0.5);
      mix3(o, n > 0 ? P.rock : P.rock2, smoothstep(0.2, 0.38, sl + n * 0.05));
      mix3(o, P.frost, smoothstep(120, 190, h) * 0.6);
      mix3(o, P.shore, 1 - smoothstep(0.35, 1.3, h + n * 0.35));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -2, h));
      return 0;
    }
    case BIOME.PRISM:
    default: {
      const P = C.prism;
      set3(o, P.pearl);
      mix3(o, P.lilac, 0.5 + 0.45 * n);
      mix3(o, P.mint, smoothstep(0.1, 0.7, m) * 0.6);
      mix3(o, P.blush, fm * 0.5);
      mix3(o, P.rock, smoothstep(0.24, 0.45, sl + n * 0.05) * 0.6);
      mix3(o, P.shore, 1 - smoothstep(0.35, 1.3, h + n * 0.35));
      if (h < 0) mix3(o, P.bed, smoothstep(0, -2, h));
      PRISMW = smoothstep(0.3, 1.8, h);
      return 0.05;
    }
  }
}

// --------------------------------------------------------------- prop output buffer

class PropBuffer {
  constructor(cap = 1 << 16) {
    this.alloc(cap);
    this.colCap = 1024;
    this.col = new Float32Array(this.colCap * 8);
  }
  alloc(cap) {
    const pos = new Float32Array(cap * 3);
    const nrm = new Int8Array(cap * 4);
    const col = new Uint8Array(cap * 4);
    const dat = new Uint8Array(cap * 4);
    if (this.pos) {
      pos.set(this.pos.subarray(0, this.n * 3));
      nrm.set(this.nrm.subarray(0, this.n * 4));
      col.set(this.colr.subarray(0, this.n * 4));
      dat.set(this.dat.subarray(0, this.n * 4));
    }
    this.pos = pos;
    this.nrm = nrm;
    this.colr = col;
    this.dat = dat;
    this.cap = cap;
  }
  reset() {
    this.n = 0;
    this.nc = 0;
    this.minX = this.minY = this.minZ = Infinity;
    this.maxX = this.maxY = this.maxZ = -Infinity;
  }
  ensure(extra) {
    if (this.n + extra > this.cap) {
      let c = this.cap;
      while (this.n + extra > c) c *= 2;
      this.alloc(c);
    }
  }
}

/** Capsule collider from a to b with radius r (chunk-local coordinates). */
function pushCol(buf, ax, ay, az, bx, by, bz, r, mat) {
  if (buf.nc >= buf.colCap) {
    const c = new Float32Array(buf.colCap * 2 * 8);
    c.set(buf.col);
    buf.col = c;
    buf.colCap *= 2;
  }
  const o = buf.nc * 8;
  const C8 = buf.col;
  C8[o] = ax;
  C8[o + 1] = ay;
  C8[o + 2] = az;
  C8[o + 3] = bx;
  C8[o + 4] = by;
  C8[o + 5] = bz;
  C8[o + 6] = r;
  C8[o + 7] = mat;
  buf.nc++;
}

/** Vertical capsule from the ground up. */
function colV(buf, x, y, z, h, r, mat) {
  pushCol(buf, x, y + r * 0.6, z, x, y + Math.max(r * 0.6, h - r * 0.4), z, r, mat);
}
function colS(buf, x, y, z, r, mat) {
  pushCol(buf, x, y, z, x, y, z, r, mat);
}

/**
 * Bake one prototype instance.
 * @param inst { x,y,z, ry, s, sy, tiltX, tiltZ, colors[4][3] (sRGB 0..1), emis[4], flags[4], phase, sway }
 */
function emit(buf, proto, inst) {
  const n = proto.count;
  buf.ensure(n);
  const c = Math.cos(inst.ry);
  const s = Math.sin(inst.ry);
  const sx = inst.s;
  const sy = inst.sy ?? inst.s;
  const isx = 1 / sx;
  const isy = 1 / sy;
  const tX = inst.tiltX || 0;
  const tZ = inst.tiltZ || 0;
  const P = proto.pos;
  const NR = proto.nrm;
  const pos = buf.pos;
  const nrm = buf.nrm;
  const col = buf.colr;
  const dat = buf.dat;
  const swayMul = (inst.sway ?? 1) * Math.min(2, Math.abs(sx));
  const phase = Math.floor((inst.phase ?? 0) * 255) & 255;
  let o = buf.n;
  for (let i = 0; i < n; i++) {
    let x = P[i * 3] * sx;
    const y = P[i * 3 + 1] * sy;
    let z = P[i * 3 + 2] * sx;
    x += y * tX;
    z += y * tZ;
    const rx = x * c - z * s;
    const rz = x * s + z * c;
    const wx = rx + inst.x;
    const wy = y + inst.y;
    const wz = rz + inst.z;
    pos[o * 3] = wx;
    pos[o * 3 + 1] = wy;
    pos[o * 3 + 2] = wz;
    if (wx < buf.minX) buf.minX = wx;
    if (wx > buf.maxX) buf.maxX = wx;
    if (wy < buf.minY) buf.minY = wy;
    if (wy > buf.maxY) buf.maxY = wy;
    if (wz < buf.minZ) buf.minZ = wz;
    if (wz > buf.maxZ) buf.maxZ = wz;
    // normal: inverse-transpose of the scale, then the same rotation
    const nx = NR[i * 3] * isx;
    const ny = NR[i * 3 + 1] * isy;
    const nz = NR[i * 3 + 2] * isx;
    const rnx = nx * c - nz * s;
    const rnz = nx * s + nz * c;
    const nl = 127 / (Math.hypot(rnx, ny, rnz) || 1);
    nrm[o * 4] = rnx * nl;
    nrm[o * 4 + 1] = ny * nl;
    nrm[o * 4 + 2] = rnz * nl;
    nrm[o * 4 + 3] = 0;
    const p = proto.part[i];
    const cc = inst.colors[p] || inst.colors[0];
    const ao = proto.ao[i];
    col[o * 4] = clamp(cc[0] * ao * 255, 0, 255);
    col[o * 4 + 1] = clamp(cc[1] * ao * 255, 0, 255);
    col[o * 4 + 2] = clamp(cc[2] * ao * 255, 0, 255);
    col[o * 4 + 3] = clamp((inst.emis ? inst.emis[p] || 0 : 0) * 255, 0, 255);
    dat[o * 4] = clamp(proto.sway[i] * swayMul * 127.5, 0, 255);
    dat[o * 4 + 1] = phase;
    dat[o * 4 + 2] = inst.flags ? inst.flags[p] || 0 : 0;
    dat[o * 4 + 3] = 0;
    o++;
  }
  buf.n = o;
}

// prop flags (read by the prop shader)
const F_SOLID = 0;
const F_FOLIAGE = 1;
const F_PULSE = 2;
const F_GRASS = 3;

function vary(c, r, amt = 0.12) {
  const k = 1 - amt + r * amt * 2;
  return [c[0] * k, c[1] * k, c[2] * k];
}
function pick(list, r) {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

const PAL = {
  trunk: hex(0x6b4a32),
  trunkDark: hex(0x4a3526),
  birch: hex(0xe8e2d6),
  leafMeadow: [0x5f9e38, 0x4f8a32, 0x7bb043, 0x6aa63c, 0x8cbc4a].map(hex),
  leafAutumn: [0xe0542a, 0xf08c2a, 0xf2c13a, 0xc0352a, 0xe87a24, 0xd8a030].map(hex),
  leafPine: [0x2f5d3a, 0x2a5236, 0x3a6a40, 0x264a32].map(hex),
  leafPineDark: [0x1e3026, 0x22342a, 0x1a2a22].map(hex),
  leafPalm: [0x3f9a3a, 0x4caa3e, 0x358a36].map(hex),
  leafMystic: [0xb06af0, 0x7a4fe0, 0x40d8c8, 0xe070e0].map(hex),
  bushMesa: [0x9b8a4e, 0x8a7a44, 0xa89656].map(hex),
  bushAutumn: [0xa8322a, 0xc2442a, 0x8c3a2a].map(hex),
  rockGray: [0x8a8680, 0x77736c, 0x9a958c].map(hex),
  rockAlpine: [0x737c8c, 0x5f6878, 0x868e9c].map(hex),
  rockRed: [0xa65a3c, 0xb8683e, 0x94503a].map(hex),
  rockMystic: [0x4a4066, 0x5c5080, 0x3c3456].map(hex),
  rockDark: [0x2a2626, 0x1f1c1d, 0x342e2c].map(hex),
  rockGothic: [0x3a3640, 0x47434e, 0x2e2b33].map(hex),
  rockPearl: [0xd8d2e8, 0xc8c0e0, 0xe6e2f2].map(hex),
  cactus: [0x4f7a3a, 0x5c8a40, 0x467034].map(hex),
  flowers: [0xffffff, 0xffe066, 0xff8fb0, 0xc58cff, 0xff7a5c, 0x9fd8ff].map(hex),
  mysticFlowers: [0x6ff6ff, 0xff7af0, 0xb48cff, 0x8affc8].map(hex),
  heather: [0x9a6ab0, 0x7a5a90, 0xb07ac0].map(hex),
  gems: [0xff4ae8, 0x4af0ff, 0xfff04a, 0x7aff7a, 0xff8a3a, 0x9a6aff].map(hex),
  crystalMystic: [0xb070ff, 0x6ff0ff, 0xff70e0].map(hex),
  crystalIce: [0x9ff0ff, 0xbfe8ff].map(hex),
  mushroomCap: [0xd94fa5, 0x4fd9d0, 0x9a5cff, 0xff8a5c].map(hex),
  stem: hex(0xe8dccf),
  wall: [0xf0e6d2, 0xe8d8b8, 0xf4efe6, 0xd9c8a8].map(hex),
  roof: [0xb8452e, 0x7a4a3a, 0x3f5a7a, 0x8a3a3a, 0x5a6a3a].map(hex),
  window: hex(0xffc66a),
  stone: [0xb8b2a6, 0xa49e92, 0xc4bfb4].map(hex),
  stoneDark: [0x3a3640, 0x47434e, 0x34303a].map(hex),
  slate: hex(0x24242e),
  glass: [0xff3a4a, 0x4a7aff, 0xffb050, 0x9a4aff].map(hex),
  mossStone: [0x8c9a7a, 0x7f8c70].map(hex),
  balloon: [0xe84a4a, 0xf2c13a, 0x3a8ae8, 0xffffff, 0x4ac28a, 0xe87ad8, 0xff8a3a].map(hex),
  sail: hex(0xf6f2ea),
  hull: [0x8a5a3a, 0x3a5a8a, 0xb8452e, 0xf0f0f0].map(hex),
  grassMeadow: [0x6aa83c, 0x86bc48, 0x5a9a36].map(hex),
  grassAlpine: [0x6a9050, 0x7c9a5a].map(hex),
  grassMesa: [0xc8b46a, 0xb8a058].map(hex),
  grassMystic: [0x9a6ae0, 0x7a52c8, 0x5ad8c8].map(hex),
  grassAutumn: [0xd8a040, 0xc88a34, 0xb8b048].map(hex),
  grassCoast: [0x9ac466, 0xc8c87a].map(hex),
  grassVolcanic: [0x5a524c, 0x6a605a].map(hex),
  grassGothic: [0x6b6050, 0x5a5048, 0x7a6e5a].map(hex),
  grassPrism: [0xf0e8ff, 0xd8c8f8, 0xc8f8ec].map(hex),
  ember: hex(0xff7a2a),
  violet: hex(0xa04aff),
  obsidian: [0x1a1720, 0x221d2a].map(hex),
  deadBlack: hex(0x1c181a),
};

// ------------------------------------------------------------------ chunk builder

const S = {};
const SURF = {};

/**
 * @param getGen  (epoch) => generation
 * @param epochs  epochs of the 3x3 epoch cells around this chunk's epoch cell (row-major from -1,-1)
 */
export function buildChunk(getGen, epochs, cx, cz, lod, density = 1) {
  const N = LOD_SEGMENTS[lod];
  const step = CHUNK_SIZE / N;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const ex = Math.floor(cx / 2);
  const ez = Math.floor(cz / 2);
  const epochOf = (ix, iz) => epochs[(clamp(iz - ez, -1, 1) + 1) * 3 + (clamp(ix - ex, -1, 1) + 1)];
  const sampler = createBlendSampler(getGen, epochOf);

  const G = N + 3;
  const V = (N + 1) * (N + 1);
  const H = new Float32Array(G * G);
  const E0 = new Int32Array(V);
  const E1 = new Int32Array(V);
  const bA0 = new Uint8Array(V);
  const bB0 = new Uint8Array(V);
  const bT0 = new Float32Array(V);
  const bA1 = new Uint8Array(V);
  const bB1 = new Uint8Array(V);
  const bT1 = new Float32Array(V);
  const W1 = new Float32Array(V);
  const BL = new Float32Array(V);
  const det = new Float32Array(V);
  const det1 = new Float32Array(V);
  const rid = new Float32Array(V);
  const rid1 = new Float32Array(V);
  const dist = new Float32Array(V);
  const vwA = new Float32Array(V);

  for (let j = 0; j < G; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const x = x0 + (i - 1) * step;
      sampler.sample(x, z, S);
      H[j * G + i] = S.h;
      if (i >= 1 && i <= N + 1 && j >= 1 && j <= N + 1) {
        const k = (j - 1) * (N + 1) + (i - 1);
        E0[k] = S.e0;
        bA0[k] = S.a;
        bB0[k] = S.b;
        bT0[k] = S.t;
        det[k] = S.detail;
        rid[k] = S.ridge;
        dist[k] = S.d;
        vwA[k] = S.vw;
        BL[k] = S.bl;
        if (S.n > 1 && S.s1) {
          const w = S.w1 / (S.w0 + S.w1);
          W1[k] = w;
          E1[k] = S.e1;
          bA1[k] = S.s1.a;
          bB1[k] = S.s1.b;
          bT1[k] = S.s1.t;
          det1[k] = S.s1.detail;
          rid1[k] = S.s1.ridge;
        } else {
          W1[k] = 0;
          E1[k] = S.e0;
        }
      }
    }
  }

  // ---------------------------------------------------------------- terrain
  const edgeVerts = 4 * (N + 1);
  const totalVerts = V + edgeVerts;
  const tPos = new Float32Array(totalVerts * 3);
  const tNrm = new Int8Array(totalVerts * 3);
  const tCol = new Uint8Array(totalVerts * 4);
  const tMat = new Uint8Array(totalVerts * 4);
  const nrmY = new Float32Array(V);
  const nrmX = new Float32Array(V);
  const nrmZ = new Float32Array(V);
  let minY = Infinity;
  let maxY = -Infinity;
  const ca = [0, 0, 0];
  const cb = [0, 0, 0];
  const inv2 = 1 / (2 * step);

  const colorFor = (o, gen, a, b, t, h, sl, n, ridge, wx, wz) => {
    const m = gen.nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
    const fm = smoothstep(0.05, 0.45, gen.nC(wx * 0.0045 + 7.7, wz * 0.0045 - 3.3) + 0.25 * gen.nA(wx * 0.017, wz * 0.017));
    let em = terrainColor(a, o, h, sl, n, m, fm, ridge);
    let strata = STRATA;
    let prism = PRISMW;
    if (t > 0.001) {
      const tmpC = [0, 0, 0];
      const emB = terrainColor(b, tmpC, h, sl, n, m, fm, ridge);
      mix3(o, tmpC, t);
      em = lerp(em, emB, t);
      strata = lerp(strata, STRATA, t);
      prism = lerp(prism, PRISMW, t);
    }
    return [em, strata, prism];
  };

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const gi = (j + 1) * G + (i + 1);
      const h = H[gi];
      const hx = (H[gi + 1] - H[gi - 1]) * inv2;
      const hz = (H[gi + G] - H[gi - G]) * inv2;
      const il = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
      const nx = -hx * il;
      const ny = il;
      const nz = -hz * il;
      nrmX[k] = nx;
      nrmY[k] = ny;
      nrmZ[k] = nz;
      const lx = i * step;
      const lz = j * step;
      tPos[k * 3] = lx;
      tPos[k * 3 + 1] = h;
      tPos[k * 3 + 2] = lz;
      tNrm[k * 3] = Math.round(nx * 127);
      tNrm[k * 3 + 1] = Math.round(ny * 127);
      tNrm[k * 3 + 2] = Math.round(nz * 127);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;

      const wx = x0 + lx;
      const wz = z0 + lz;
      const sl = 1 - ny;
      let [em, strata, prism] = colorFor(ca, getGen(E0[k]), bA0[k], bB0[k], bT0[k], h, sl, det[k], rid[k], wx, wz);
      if (W1[k] > 0.001) {
        const [em1, st1, pr1] = colorFor(cb, getGen(E1[k]), bA1[k], bB1[k], bT1[k], h, sl, det1[k], rid1[k], wx, wz);
        mix3(ca, cb, W1[k]);
        em = lerp(em, em1, W1[k]);
        strata = lerp(strata, st1, W1[k]);
        prism = lerp(prism, pr1, W1[k]);
      }
      const bl = BL[k];
      if (bl > 0.001) {
        // the Borderland: colour drains to ash, violet fissures glow through
        const P = C.border;
        mix3(ca, det[k] > 0 ? P.ash2 : P.ash, bl * 0.8);
        const crack = smoothstep(0.78, 0.93, rid[k] + det[k] * 0.06) * bl;
        if (crack > 0) {
          mix3(ca, P.crack, crack);
          em = Math.max(em, crack * 0.95);
        }
        strata *= 1 - bl;
        prism *= 1 - bl;
      }
      tCol[k * 4] = clamp(ca[0] * 255, 0, 255);
      tCol[k * 4 + 1] = clamp(ca[1] * 255, 0, 255);
      tCol[k * 4 + 2] = clamp(ca[2] * 255, 0, 255);
      tCol[k * 4 + 3] = clamp(em * 255, 0, 255);
      tMat[k * 4] = clamp(strata * 255, 0, 255);
      tMat[k * 4 + 1] = clamp(bl * 255, 0, 255);
      tMat[k * 4 + 2] = clamp(prism * 255, 0, 255);
      tMat[k * 4 + 3] = 0;
    }
  }

  // skirts: duplicate the border ring, pushed down, to hide LOD cracks
  const skirtDepth = step * 1.5 + 3;
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push(i);
  for (let j = 1; j <= N; j++) ring.push(j * (N + 1) + N);
  for (let i = N - 1; i >= 0; i--) ring.push(N * (N + 1) + i);
  for (let j = N - 1; j >= 1; j--) ring.push(j * (N + 1));
  for (let r = 0; r < ring.length; r++) {
    const src = ring[r];
    const dst = V + r;
    tPos[dst * 3] = tPos[src * 3];
    tPos[dst * 3 + 1] = tPos[src * 3 + 1] - skirtDepth;
    tPos[dst * 3 + 2] = tPos[src * 3 + 2];
    for (let q = 0; q < 3; q++) tNrm[dst * 3 + q] = tNrm[src * 3 + q];
    for (let q = 0; q < 4; q++) {
      tCol[dst * 4 + q] = tCol[src * 4 + q];
      tMat[dst * 4 + q] = tMat[src * 4 + q];
    }
  }
  minY -= skirtDepth;

  const ringN = ring.length;
  const tIdx = new Uint16Array(N * N * 6 + ringN * 12);
  let ii = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + (N + 1);
      const d = c + 1;
      tIdx[ii++] = a;
      tIdx[ii++] = c;
      tIdx[ii++] = b;
      tIdx[ii++] = b;
      tIdx[ii++] = c;
      tIdx[ii++] = d;
    }
  }
  for (let r = 0; r < ringN; r++) {
    const r2 = (r + 1) % ringN;
    const a = ring[r];
    const b = ring[r2];
    const sa = V + r;
    const sb = V + r2;
    tIdx[ii++] = a;
    tIdx[ii++] = sa;
    tIdx[ii++] = b;
    tIdx[ii++] = b;
    tIdx[ii++] = sa;
    tIdx[ii++] = sb;
    tIdx[ii++] = a;
    tIdx[ii++] = b;
    tIdx[ii++] = sa;
    tIdx[ii++] = b;
    tIdx[ii++] = sb;
    tIdx[ii++] = sa;
  }

  const terrain = {
    pos: tPos.subarray(0, (V + ringN) * 3).slice(),
    nrm: tNrm.subarray(0, (V + ringN) * 3).slice(),
    col: tCol.subarray(0, (V + ringN) * 4).slice(),
    mat: tMat.subarray(0, (V + ringN) * 4).slice(),
    idx: tIdx,
    minY,
    maxY,
  };

  // ------------------------------------------------------------------ water
  const water = buildWater(N, step, H, G, bA0, bB0, bT0, bA1, bB1, bT1, W1, BL);

  // ------------------------------------------------------------------ props
  const buf = getBuffer();
  buf.reset();
  const ctx = {
    getGen, sampler, epochs, cx, cz, lod, N, step, H, G, x0, z0, nrmX, nrmY, nrmZ,
    E0, E1, bA0, bB0, bT0, bA1, bB1, bT1, W1, BL, dist, vwA, density,
  };
  if (lod <= 1) placeProps(ctx, buf);
  placeSpecials(ctx, buf);
  placeLandmarks(ctx, buf);
  let props = null;
  if (buf.n > 0) {
    props = {
      pos: buf.pos.slice(0, buf.n * 3),
      nrm: buf.nrm.slice(0, buf.n * 4),
      col: buf.colr.slice(0, buf.n * 4),
      dat: buf.dat.slice(0, buf.n * 4),
      count: buf.n,
      min: [buf.minX, buf.minY, buf.minZ],
      max: [buf.maxX, buf.maxY, buf.maxZ],
    };
  }
  const colliders = buf.col.slice(0, buf.nc * 8);

  const transfer = [terrain.pos.buffer, terrain.nrm.buffer, terrain.col.buffer, terrain.mat.buffer, terrain.idx.buffer, colliders.buffer];
  if (water) transfer.push(water.pos.buffer, water.dep.buffer, water.tint.buffer, water.idx.buffer);
  if (props) transfer.push(props.pos.buffer, props.nrm.buffer, props.col.buffer, props.dat.buffer);
  return { cx, cz, lod, epochs: epochs.slice(), terrain, water, props, colliders, transfer };
}

let BUF = null;
function getBuffer() {
  if (!BUF) BUF = new PropBuffer();
  return BUF;
}

function waterTint(a, b, t, out) {
  const A = BIOMES[a];
  const B = BIOMES[b];
  out[0] = lerp(A.water[0], B.water[0], t);
  out[1] = lerp(A.water[1], B.water[1], t);
  out[2] = lerp(A.water[2], B.water[2], t);
  return t > 0.5 ? B.liquid : A.liquid;
}

function buildWater(N, step, H, G, bA0, bB0, bT0, bA1, bB1, bT1, W1, BL) {
  const V = (N + 1) * (N + 1);
  const map = new Int32Array(V).fill(-1);
  let count = 0;
  let quads = 0;
  const hAt = (i, j) => H[(j + 1) * G + (i + 1)];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const mn = Math.min(hAt(i, j), hAt(i + 1, j), hAt(i, j + 1), hAt(i + 1, j + 1));
      if (mn < WATER_LEVEL + 0.25) {
        quads++;
        const ks = [j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i, (j + 1) * (N + 1) + i + 1];
        for (const k of ks) if (map[k] < 0) map[k] = count++;
      }
    }
  }
  if (quads === 0) return null;
  const pos = new Float32Array(count * 3);
  const dep = new Float32Array(count);
  const tint = new Uint8Array(count * 4);
  const idx = new Uint16Array(quads * 6);
  const t0 = [0, 0, 0];
  const t1 = [0, 0, 0];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const w = map[k];
      if (w < 0) continue;
      pos[w * 3] = i * step;
      pos[w * 3 + 1] = WATER_LEVEL;
      pos[w * 3 + 2] = j * step;
      dep[w] = clamp(WATER_LEVEL - hAt(i, j), -8, 80);
      let liquid = waterTint(bA0[k], bB0[k], bT0[k], t0);
      if (W1[k] > 0.001) {
        const l1 = waterTint(bA1[k], bB1[k], bT1[k], t1);
        mix3(t0, t1, W1[k]);
        if (W1[k] > 0.5) liquid = l1;
      }
      if (BL[k] > 0) mix3(t0, C.border.ash2, BL[k] * 0.6);
      tint[w * 4] = clamp(t0[0] * 255, 0, 255);
      tint[w * 4 + 1] = clamp(t0[1] * 255, 0, 255);
      tint[w * 4 + 2] = clamp(t0[2] * 255, 0, 255);
      tint[w * 4 + 3] = Math.round((liquid / 3) * 255);
    }
  }
  let o = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + (N + 1);
      const d = c + 1;
      if (map[a] < 0 || map[b] < 0 || map[c] < 0 || map[d] < 0) continue;
      const mn = Math.min(hAt(i, j), hAt(i + 1, j), hAt(i, j + 1), hAt(i + 1, j + 1));
      if (mn >= WATER_LEVEL + 0.25) continue;
      idx[o++] = map[a];
      idx[o++] = map[c];
      idx[o++] = map[b];
      idx[o++] = map[b];
      idx[o++] = map[c];
      idx[o++] = map[d];
    }
  }
  return { pos, dep, tint, idx: idx.subarray(0, o).slice() };
}

// Surface height + normal at chunk-local (lx, lz), matching the rendered triangles.
function surface(ctx, lx, lz, out) {
  const { N, step, H, G, nrmX, nrmY, nrmZ } = ctx;
  const gx = clamp(lx / step, 0, N - 1e-4);
  const gz = clamp(lz / step, 0, N - 1e-4);
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const ha = H[(j + 1) * G + i + 1];
  const hb = H[(j + 1) * G + i + 2];
  const hc = H[(j + 2) * G + i + 1];
  const hd = H[(j + 2) * G + i + 2];
  if (fx + fz < 1) out.h = ha + (hb - ha) * fx + (hc - ha) * fz;
  else out.h = hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  const k = j * (N + 1) + i;
  out.ny = nrmY[k];
  out.nx = nrmX[k];
  out.nz = nrmZ[k];
  out.k = k;
  return out;
}

function instBase(x, y, z, r) {
  return { x, y, z, ry: r * Math.PI * 2, s: 1, sy: undefined, colors: [], emis: null, flags: null, phase: r, sway: 1 };
}

// Current LOD while placing props: small items are skipped on distant chunks.
let PLOD = 0;
const SMALL_AT_DISTANCE = new Set([PROP.BUSH, PROP.CACTUS, PROP.DEAD_TREE]);

/** Pick generation + biome for a candidate at grid vertex k. */
function candidate(ctx, k, rGen, rBiome) {
  const second = rGen < ctx.W1[k];
  const a = second ? ctx.bA1[k] : ctx.bA0[k];
  const b = second ? ctx.bB1[k] : ctx.bB0[k];
  const t = second ? ctx.bT1[k] : ctx.bT0[k];
  return { gen: ctx.getGen(second ? ctx.E1[k] : ctx.E0[k]), biome: rBiome < t ? b : a };
}

function placeProps(ctx, buf) {
  const { cx, cz, lod, x0, z0, density, epochs } = ctx;
  PLOD = lod;
  const L = lib();
  const rng = mulberry32(hashInt(cx, cz, epochs[4], 0x51ed));

  // ---------------------------------------------------- large props (10 m cells)
  const cell = 10;
  const cells = 256 / cell;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const r4 = rng();
      const r5 = rng();
      const r6 = rng();
      const r7 = rng();
      const r8 = rng();
      if (r7 > density) continue;
      const lx = (i + r1) * cell;
      const lz = (j + r2) * cell;
      const wx = x0 + lx;
      const wz = z0 + lz;
      surface(ctx, lx, lz, SURF);
      const h = SURF.h;
      const k = SURF.k;
      const bl = ctx.BL[k];
      if (bl > 0.35 && r8 < bl) {
        borderProp(buf, L, lx, h, lz, r4, r5, r6);
        continue;
      }
      const { gen, biome } = candidate(ctx, k, r8, r3);
      if (h < WATER_LEVEL + 0.4) {
        maybeBoat(buf, L, biome, lx, lz, h, r4, r5, r6);
        continue;
      }
      const sl = 1 - SURF.ny;
      const fm = smoothstep(0.05, 0.45, gen.nC(wx * 0.0045 + 7.7, wz * 0.0045 - 3.3) + 0.25 * gen.nA(wx * 0.017, wz * 0.017));
      const m = gen.nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
      const d = ctx.dist[k];
      const vw = ctx.vwA[k];
      const village = gen.nC(wx * 0.0021 + 33.3, wz * 0.0021 - 71.1);
      const central = d < vw * 0.55; // keep tall things out of the river corridor
      largeProp(buf, L, biome, lx, h, lz, sl, fm, m, d, vw, village, central, r4, r5, r6);
    }
  }

  if (lod > 0) return;

  // ---------------------------------------------------- small props (4 m cells)
  const sc = 4;
  const sCells = 256 / sc;
  for (let j = 0; j < sCells; j++) {
    for (let i = 0; i < sCells; i++) {
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const r4 = rng();
      const r5 = rng();
      const r6 = rng();
      if (r5 > density) continue;
      const lx = (i + r1) * sc;
      const lz = (j + r2) * sc;
      surface(ctx, lx, lz, SURF);
      const h = SURF.h;
      if (h < WATER_LEVEL + 0.5) continue;
      const k = SURF.k;
      if (ctx.BL[k] > 0.5) continue;
      const { gen, biome } = candidate(ctx, k, r6, r3);
      const sl = 1 - SURF.ny;
      if (sl > 0.35) continue;
      const wx = x0 + lx;
      const wz = z0 + lz;
      const m = gen.nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
      const village = gen.nC(wx * 0.0021 + 33.3, wz * 0.0021 - 71.1);
      smallProp(buf, L, biome, lx, h, lz, sl, m, village, r4, rng);
    }
  }
}

function borderProp(buf, L, lx, h, lz, r4, r5, r6) {
  // the Borderland: barren, with debris hanging in the air
  if (r4 < 0.035) {
    const y = Math.max(h, WATER_LEVEL) + 6 + r5 * 38;
    const inst = instBase(lx, y, lz, r5);
    inst.s = 0.9 + r6 * 2.6;
    inst.tiltX = (r5 - 0.5) * 0.8;
    inst.tiltZ = (r6 - 0.5) * 0.8;
    inst.colors = [hex(0x2a2430), PAL.violet, PAL.violet];
    inst.emis = [0, 0, 1.1];
    inst.flags = [0, 0, F_PULSE];
    emit(buf, pick(L[PROP.LAVA_ROCK], r6), inst);
    colS(buf, lx, y + 0.3 * inst.s, lz, 1.3 * inst.s, MAT.OBSIDIAN);
  } else if (r4 < 0.045 && PLOD === 0) {
    const inst = instBase(lx, h - 0.4, lz, r5);
    inst.s = 1 + r6 * 0.8;
    inst.colors = [hex(0x141218), hex(0x141218), PAL.violet];
    inst.emis = [0, 0, 1.2];
    inst.flags = [0, 0, F_PULSE];
    emit(buf, pick(L[PROP.OBELISK], r6), inst);
    colV(buf, lx, h, lz, 14 * inst.s, 1.0 * inst.s, MAT.OBSIDIAN);
  } else if (r4 < 0.08) {
    tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.8 + r6 * 0.7, [PAL.deadBlack], r5, [0, 0, 0, 0]);
  }
}

function maybeBoat(buf, L, biome, lx, lz, h, r4, r5, r6) {
  if (h > -3 || PLOD > 0) return;
  if (BIOMES[biome].liquid !== LIQUID.WATER) return;
  const p = biome === BIOME.COAST ? 0.012 : biome === BIOME.MEADOW || biome === BIOME.AUTUMN ? 0.003 : 0;
  if (r4 > p) return;
  const inst = instBase(lx, WATER_LEVEL - 0.15, lz, r5);
  inst.s = 0.9 + r6 * 0.4;
  inst.colors = [pick(PAL.hull, r6), PAL.sail, PAL.sail, PAL.trunkDark];
  emit(buf, pick(L[PROP.BOAT], r5), inst);
  colS(buf, lx, 1.5, lz, 2.8 * inst.s, MAT.WOOD);
}

// collider shape for each tree-like prototype: [height factor, radius factor, material]
const TREE_COL = {
  [PROP.ROUND_TREE]: [6.4, 1.9, MAT.WOOD],
  [PROP.PINE]: [7.0, 1.6, MAT.WOOD],
  [PROP.BIRCH]: [8.0, 1.1, MAT.WOOD],
  [PROP.PALM]: [8.0, 0.9, MAT.WOOD],
  [PROP.CACTUS]: [4.5, 0.7, MAT.WOOD],
  [PROP.DEAD_TREE]: [5.0, 0.8, MAT.WOOD],
};

function tree(buf, L, type, lx, h, lz, scale, colors, r, flags = [F_SOLID, F_FOLIAGE, F_SOLID, F_SOLID]) {
  if (PLOD > 0 && SMALL_AT_DISTANCE.has(type)) return;
  const inst = instBase(lx, h - 0.25 * scale, lz, r);
  inst.s = scale;
  inst.colors = colors;
  inst.flags = flags;
  inst.tiltX = (r - 0.5) * 0.08;
  inst.tiltZ = (((r * 7.31) % 1) - 0.5) * 0.08;
  emit(buf, pick(L[type], (r * 13.7) % 1), inst);
  const tc = TREE_COL[type];
  if (tc) colV(buf, lx, h, lz, tc[0] * scale, tc[1] * scale, tc[2]);
  else if (type === PROP.BUSH) colS(buf, lx, h + 0.7 * scale, lz, 1.3 * scale, MAT.WOOD);
}

function largeProp(buf, L, biome, lx, h, lz, sl, fm, m, d, vw, village, central, r4, r5, r6) {
  const leafVar = (list) => vary(pick(list, r6), r5, 0.1);
  switch (biome) {
    case BIOME.MEADOW: {
      if (village > 0.52 && sl < 0.08 && h > 2 && d > vw * 0.75 && d < vw * 3.5 && r4 < 0.3) {
        return cottage(buf, L, lx, h, lz, r5, r6);
      }
      if (sl > 0.4) return;
      const pt = 0.03 + 0.62 * fm;
      if (r4 < pt) {
        if (r5 < 0.72) return tree(buf, L, PROP.ROUND_TREE, lx, h, lz, 0.75 + r6 * 0.85, [PAL.trunk, leafVar(PAL.leafMeadow)], r5);
        if (r5 < 0.86) return tree(buf, L, PROP.PINE, lx, h, lz, 0.8 + r6 * 0.7, [PAL.trunkDark, leafVar(PAL.leafPine)], r5);
        return tree(buf, L, PROP.BUSH, lx, h, lz, 0.8 + r6 * 0.8, [PAL.trunk, leafVar(PAL.leafMeadow)], r5);
      }
      if (r4 < pt + 0.03) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 1.6, PAL.rockGray, r5);
      if (r4 > 0.996 && !central) return monolith(buf, L, lx, h, lz, r5, r6, PAL.stone);
      return;
    }
    case BIOME.ALPINE: {
      const treeLine = 95 + r6 * 20;
      if (h < treeLine && sl < 0.42) {
        const pt = 0.04 + 0.68 * fm;
        if (r4 < pt) {
          const snowy = h > 55 + r5 * 30;
          const leaf = snowy ? vary(hex(0xc8d8d8), r5, 0.05) : leafVar(PAL.leafPine);
          if (r5 < 0.9) return tree(buf, L, PROP.PINE, lx, h, lz, 0.9 + r6 * 1.2, [PAL.trunkDark, leaf], r5);
          return tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.8 + r6 * 0.6, [hex(0x5a4a3e)], r5);
        }
      }
      if (r4 > 0.93) return rockProp(buf, L, lx, h, lz, 0.8 + r6 * 2.6, PAL.rockAlpine, r5);
      if (r4 > 0.915 && !central && h > 20) return crystalProp(buf, L, lx, h, lz, 0.8 + r6 * 1.2, PAL.crystalIce, r5, 0.8, MAT.ICE);
      return;
    }
    case BIOME.MESA: {
      if (sl < 0.2) {
        if (r4 < 0.035) return tree(buf, L, PROP.CACTUS, lx, h, lz, 0.8 + r6 * 0.7, [vary(pick(PAL.cactus, r6), r5), hex(0xff7ab0)], r5, [0, 0, 0, 0]);
        if (r4 < 0.085) return tree(buf, L, PROP.BUSH, lx, h, lz, 0.5 + r6 * 0.6, [PAL.trunk, leafVar(PAL.bushMesa)], r5);
        if (r4 < 0.096 && !central) return hoodooProp(buf, L, lx, h, lz, 0.7 + r6 * 0.9, r5);
        if (r4 < 0.104) return tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.6 + r6 * 0.5, [hex(0x7a6250)], r5);
      }
      if (r4 > 0.955) return rockProp(buf, L, lx, h, lz, 0.8 + r6 * 2.2, PAL.rockRed, r5);
      return;
    }
    case BIOME.MYSTIC: {
      if (sl > 0.45) {
        if (r4 < 0.05) return crystalProp(buf, L, lx, h, lz, 0.8 + r6 * 1.4, PAL.crystalMystic, r5, 1.0, MAT.CRYSTAL);
        return;
      }
      if (r4 < 0.03 + 0.12 * fm && !central) return mushroomProp(buf, L, lx, h, lz, 0.8 + r6 * 0.9, r5, r6);
      if (r4 < 0.06 + 0.45 * fm) {
        const leaf = leafVar(PAL.leafMystic);
        return tree(buf, L, r5 < 0.75 ? PROP.ROUND_TREE : PROP.BIRCH, lx, h, lz, 0.8 + r6 * 0.8, [hex(0x2a2040), leaf], r5, [0, 1, 0, 0]);
      }
      if (r4 < 0.6 && r4 > 0.57) return crystalProp(buf, L, lx, h, lz, 0.6 + r6 * 1.2, PAL.crystalMystic, r5, 1.0, MAT.CRYSTAL);
      if (r4 > 0.93) return glowFlowerProp(buf, L, lx, h, lz, 1 + r6, r5, r6);
      if (r4 > 0.91) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 1.6, PAL.rockMystic, r5);
      return;
    }
    case BIOME.AUTUMN: {
      if (village > 0.55 && sl < 0.08 && h > 2 && d > vw * 0.75 && d < vw * 3.5 && r4 < 0.3) {
        return cottage(buf, L, lx, h, lz, r5, r6);
      }
      if (sl > 0.4) return;
      const pt = 0.04 + 0.62 * fm;
      if (r4 < pt) {
        if (r5 < 0.62) return tree(buf, L, PROP.ROUND_TREE, lx, h, lz, 0.75 + r6 * 0.85, [PAL.trunk, leafVar(PAL.leafAutumn)], r5);
        if (r5 < 0.82) return tree(buf, L, PROP.BIRCH, lx, h, lz, 0.8 + r6 * 0.6, [PAL.birch, vary(hex(0xf2c13a), r6, 0.12)], r5);
        if (r5 < 0.93) return tree(buf, L, PROP.PINE, lx, h, lz, 0.8 + r6 * 0.6, [PAL.trunkDark, leafVar(PAL.leafPine)], r5);
        return tree(buf, L, PROP.BUSH, lx, h, lz, 0.7 + r6 * 0.6, [PAL.trunk, leafVar(PAL.bushAutumn)], r5);
      }
      if (r4 < pt + 0.012) return logProp(buf, L, lx, h, lz, r5, r6);
      if (r4 < pt + 0.03) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 1.4, PAL.rockGray, r5);
      return;
    }
    case BIOME.COAST: {
      if (sl > 0.4) return;
      if (h < 9 && r4 < 0.11) return tree(buf, L, PROP.PALM, lx, h, lz, 0.8 + r6 * 0.5, [hex(0x8a6a48), leafVar(PAL.leafPalm)], r5);
      if (h >= 9 && r4 < 0.05 + 0.45 * fm) {
        if (r5 < 0.6) return tree(buf, L, PROP.ROUND_TREE, lx, h, lz, 0.8 + r6 * 0.7, [PAL.trunk, leafVar(PAL.leafPalm)], r5);
        return tree(buf, L, PROP.BUSH, lx, h, lz, 0.8 + r6 * 0.8, [PAL.trunk, leafVar(PAL.leafPalm)], r5);
      }
      if (r4 > 0.965) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 2, PAL.rockGray, r5);
      return;
    }
    case BIOME.VOLCANIC: {
      if (r4 < 0.012 && !central && sl < 0.4) return spireProp(buf, L, lx, h, lz, 0.7 + r6 * 0.8, r5);
      if (r4 < 0.045 && sl < 0.35) return tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.7 + r6 * 0.6, [hex(0x241c18)], r5, [0, 0, 0, 0]);
      if (r4 < 0.075) return lavaRockProp(buf, L, lx, h, lz, 0.8 + r6 * 1.8, r5);
      if (r4 > 0.96) return rockProp(buf, L, lx, h, lz, 0.8 + r6 * 2, PAL.rockDark, r5);
      return;
    }
    case BIOME.GOTHIC: {
      if (village > 0.56 && sl < 0.1 && h > 2 && d > vw * 0.8 && d < vw * 3.2 && r4 < 0.05 && !central) {
        return cathedralProp(buf, L, lx, h, lz, r5, r6);
      }
      if (r4 < 0.004 && !central && sl < 0.25) return gothicSpireProp(buf, L, lx, h, lz, 0.8 + r6 * 0.5, r5);
      if (sl > 0.42) {
        if (r4 > 0.94) return rockProp(buf, L, lx, h, lz, 0.8 + r6 * 2.4, PAL.rockGothic, r5);
        return;
      }
      const pt = 0.03 + 0.3 * fm;
      if (r4 < pt) {
        if (r5 < 0.6) return tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.9 + r6 * 0.9, [vary(PAL.deadBlack, r6, 0.2)], r5, [0, 0, 0, 0]);
        return tree(buf, L, PROP.PINE, lx, h, lz, 0.9 + r6 * 1.0, [PAL.deadBlack, leafVar(PAL.leafPineDark)], r5);
      }
      if (r4 > 0.988 && d < vw * 1.4) return lanternProp(buf, L, lx, h, lz, r5);
      if (r4 > 0.96) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 1.8, PAL.rockGothic, r5);
      if (r4 > 0.957 && !central) return obeliskProp(buf, L, lx, h, lz, r5, r6, hex(0xff2a4a));
      return;
    }
    case BIOME.PRISM:
    default: {
      if (sl > 0.45) {
        if (r4 < 0.03) return prismShardProp(buf, L, lx, h, lz, 0.8 + r6, r5, r6);
        return;
      }
      if (r4 < 0.012 && !central) return polyProp(buf, L, lx, h, lz, 0.8 + r6 * 1.2, r5, r6);
      if (r4 < 0.022) return prismShardProp(buf, L, lx, h, lz, 0.7 + r6 * 0.9, r5, r6);
      if (r4 < 0.03 && !central) return orbProp(buf, L, lx, h + 4 + r5 * 12, lz, 0.8 + r6 * 1.4, r5, r6);
      if (r4 < 0.05 + 0.3 * fm) {
        return tree(buf, L, PROP.BIRCH, lx, h, lz, 0.8 + r6 * 0.7, [hex(0xf4f0ff), vary(pick(PAL.gems, r6), r5, 0.05)], r5, [0, 2, 0, 0]);
      }
      if (r4 > 0.975) return rockProp(buf, L, lx, h, lz, 0.6 + r6 * 1.6, PAL.rockPearl, r5);
      return;
    }
  }
}

function rockProp(buf, L, lx, h, lz, s, pal, r) {
  if (PLOD > 0 && s < 1.6) return;
  const inst = instBase(lx, h - 0.25 * s, lz, r);
  inst.s = s;
  inst.colors = [vary(pick(pal, r), (r * 3.7) % 1, 0.1)];
  emit(buf, pick(L[PROP.ROCK], (r * 11.3) % 1), inst);
  if (s > 0.9) colS(buf, lx, h + 0.1 * s, lz, 1.25 * s, MAT.STONE);
}

function crystalProp(buf, L, lx, h, lz, s, pal, r, glow, mat = MAT.CRYSTAL) {
  const inst = instBase(lx, h - 0.2, lz, r);
  inst.s = s;
  const c = pick(pal, (r * 5.3) % 1);
  inst.colors = [hex(0x4a4258), c, c, c];
  inst.emis = [0, 0, glow, 0];
  inst.flags = [0, 0, F_PULSE, 0];
  emit(buf, pick(L[PROP.CRYSTAL], (r * 7.1) % 1), inst);
  colV(buf, lx, h, lz, 4.8 * s, 1.1 * s, mat);
}

function mushroomProp(buf, L, lx, h, lz, s, r, r2) {
  const inst = instBase(lx, h - 0.3, lz, r);
  inst.s = s;
  const cap = pick(PAL.mushroomCap, r2);
  inst.colors = [PAL.stem, cap, vary(hex(0xbff8ff), r2, 0.1), cap];
  inst.emis = [0, 0.08, 0.9, 0];
  inst.flags = [0, 0, F_PULSE, 0];
  emit(buf, pick(L[PROP.MUSHROOM], (r * 3.3) % 1), inst);
  colV(buf, lx, h, lz, 6.5 * s, 0.6 * s, MAT.FUNGUS);
  colS(buf, lx, h + 6.6 * s, lz, 3.0 * s, MAT.FUNGUS);
}

function glowFlowerProp(buf, L, lx, h, lz, s, r, r2) {
  if (PLOD > 0) return;
  const inst = instBase(lx, h, lz, r);
  inst.s = s;
  const c = pick(PAL.mysticFlowers, r2);
  inst.colors = [c, hex(0x3a8a6a), c, c];
  inst.emis = [0, 0, 1.0, 0];
  inst.flags = [0, F_FOLIAGE, F_PULSE, 0];
  emit(buf, pick(L[PROP.GLOW_FLOWER], (r * 3.3) % 1), inst);
}

function hoodooProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.5, lz, r);
  inst.s = s;
  inst.colors = [vary(hex(0xc8703e), r, 0.08), vary(hex(0xe2a46e), r, 0.08)];
  emit(buf, pick(L[PROP.HOODOO], (r * 3.1) % 1), inst);
  colV(buf, lx, h, lz, 21 * s, 2.6 * s, MAT.STONE);
}

function spireProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.5, lz, r);
  inst.s = s;
  inst.colors = [pick(PAL.obsidian, r), hex(0x3a2a40), PAL.ember];
  inst.emis = [0, 0, 0.9];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.SPIRE], (r * 3.1) % 1), inst);
  colV(buf, lx, h, lz, 17 * s, 1.7 * s, MAT.OBSIDIAN);
}

function lavaRockProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.25 * s, lz, r);
  inst.s = s;
  inst.colors = [pick(PAL.rockDark, r), PAL.ember, PAL.ember];
  inst.emis = [0, 0, 0.85];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.LAVA_ROCK], (r * 5.1) % 1), inst);
  if (s > 1) colS(buf, lx, h + 0.1 * s, lz, 1.3 * s, MAT.OBSIDIAN);
}

function logProp(buf, L, lx, h, lz, r, r2) {
  if (PLOD > 0) return;
  const inst = instBase(lx, h - 0.15, lz, r);
  inst.s = 0.8 + r2 * 0.5;
  inst.colors = [vary(hex(0x6a4a30), r2, 0.1)];
  emit(buf, pick(L[PROP.LOG], r2), inst);
}

function monolith(buf, L, lx, h, lz, r, r2, pal) {
  const inst = instBase(lx, h - 0.5, lz, r);
  inst.s = 1 + r2 * 0.8;
  inst.colors = [vary(pick(pal, r2), r, 0.08)];
  emit(buf, pick(L[PROP.MONOLITH], r2), inst);
  colV(buf, lx, h, lz, 9 * inst.s, 1.2 * inst.s, MAT.STONE);
}

function cottage(buf, L, lx, h, lz, r, r2) {
  const inst = instBase(lx, h - 0.3, lz, r);
  inst.s = 0.95 + r2 * 0.3;
  inst.colors = [pick(PAL.wall, r2), pick(PAL.roof, (r * 7.7) % 1), PAL.window, vary(hex(0x8a8078), r, 0.1)];
  inst.emis = [0, 0, 0.75, 0];
  emit(buf, pick(L[PROP.COTTAGE], (r * 3.3) % 1), inst);
  colS(buf, lx, h + 2.6 * inst.s, lz, 3.6 * inst.s, MAT.BUILDING);
}

function gothicSpireProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.8, lz, r);
  inst.s = s;
  inst.colors = [vary(pick(PAL.stoneDark, r), r, 0.06), PAL.slate, pick(PAL.glass, (r * 5.7) % 1)];
  inst.emis = [0, 0, 1.0];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.GOTHIC_SPIRE], (r * 3.3) % 1), inst);
  colV(buf, lx, h, lz, 44 * s, 2.4 * s, MAT.STONE);
}

function cathedralProp(buf, L, lx, h, lz, r, r2) {
  const inst = instBase(lx, h - 0.6, lz, r);
  inst.s = 1 + r2 * 0.3;
  inst.colors = [vary(pick(PAL.stoneDark, r2), r, 0.06), PAL.slate, pick(PAL.glass, r2)];
  inst.emis = [0, 0, 0.85];
  inst.flags = [0, 0, F_PULSE];
  const proto = pick(L[PROP.CATHEDRAL], (r * 3.3) % 1);
  emit(buf, proto, inst);
  // piers along the local x axis, rotated by ry
  const c = Math.cos(inst.ry);
  const s = Math.sin(inst.ry);
  const half = proto.radius * inst.s;
  pushCol(buf, lx - c * half, h + 6, lz - s * half, lx + c * half, h + 6, lz + s * half, 5 * inst.s, MAT.STONE);
}

function lanternProp(buf, L, lx, h, lz, r) {
  if (PLOD > 0) return;
  const inst = instBase(lx, h - 0.1, lz, r);
  inst.s = 1;
  inst.colors = [hex(0x1c1a20), hex(0x1c1a20), hex(0xffb050)];
  inst.emis = [0, 0, 1.4];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.LANTERN], r), inst);
}

function obeliskProp(buf, L, lx, h, lz, r, r2, glyph) {
  const inst = instBase(lx, h - 0.4, lz, r);
  inst.s = 1 + r2 * 0.6;
  inst.colors = [hex(0x18161c), hex(0x18161c), glyph];
  inst.emis = [0, 0, 1.2];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.OBELISK], r2), inst);
  colV(buf, lx, h, lz, 14 * inst.s, 1.0 * inst.s, MAT.OBSIDIAN);
}

function polyProp(buf, L, lx, h, lz, s, r, r2) {
  const inst = instBase(lx, h, lz, r);
  inst.s = s;
  const c0 = pick(PAL.gems, r2);
  const c1 = pick(PAL.gems, (r2 * 3.7) % 1);
  const c2 = pick(PAL.gems, (r2 * 7.3) % 1);
  inst.colors = [hex(0xf4f0ff), c1, c2, c0];
  inst.emis = [0, 0.25, 1.0, 0];
  inst.flags = [0, 0, F_PULSE, 0];
  const proto = pick(L[PROP.POLYHEDRON], (r * 5.3) % 1);
  emit(buf, proto, inst);
  colS(buf, lx, h + proto.height * s * 0.5, lz, proto.height * s * 0.45, MAT.CRYSTAL);
}

function prismShardProp(buf, L, lx, h, lz, s, r, r2) {
  const inst = instBase(lx, h - 0.3, lz, r);
  inst.s = s;
  inst.tiltX = (r2 - 0.5) * 0.5;
  inst.tiltZ = (r - 0.5) * 0.5;
  inst.colors = [hex(0xf0ecff), hex(0xf0ecff), pick(PAL.gems, r2)];
  inst.emis = [0, 0, 1.2];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.PRISM_SHARD], (r * 3.1) % 1), inst);
  colV(buf, lx, h, lz, 11 * s, 1.0 * s, MAT.CRYSTAL);
}

function orbProp(buf, L, lx, y, lz, s, r, r2) {
  const inst = instBase(lx, y, lz, r);
  inst.s = s;
  const c = pick(PAL.gems, r2);
  inst.colors = [c, hex(0xf4f0ff), c];
  inst.emis = [0, 0.3, 1.3];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.ORB], r2), inst);
  colS(buf, lx, y, lz, 1.4 * s, MAT.CRYSTAL);
}

function smallProp(buf, L, biome, lx, h, lz, sl, m, village, r4, rng) {
  const r = rng();
  const r2 = rng();
  let p = 0;
  let grassPal = PAL.grassMeadow;
  let flowerP = 0;
  let flowers = PAL.flowers;
  let glow = 0;
  switch (biome) {
    case BIOME.MEADOW:
      p = 0.4;
      flowerP = 0.16;
      break;
    case BIOME.ALPINE:
      if (h > 70) return;
      p = 0.25;
      grassPal = PAL.grassAlpine;
      flowerP = 0.04;
      break;
    case BIOME.MESA:
      p = 0.12;
      grassPal = PAL.grassMesa;
      break;
    case BIOME.MYSTIC:
      p = 0.32;
      grassPal = PAL.grassMystic;
      flowerP = 0.12;
      flowers = PAL.mysticFlowers;
      glow = 0.8;
      break;
    case BIOME.AUTUMN:
      p = 0.32;
      grassPal = PAL.grassAutumn;
      flowerP = 0.05;
      break;
    case BIOME.COAST:
      p = 0.22;
      grassPal = PAL.grassCoast;
      flowerP = 0.05;
      break;
    case BIOME.GOTHIC:
      if (village > 0.42 && r4 < 0.07) {
        // a graveyard on the moor
        const inst = instBase(lx, h - 0.15, lz, r);
        inst.s = 0.9 + r2 * 0.4;
        inst.tiltX = (r - 0.5) * 0.25;
        inst.tiltZ = (r2 - 0.5) * 0.25;
        inst.colors = [vary(pick(PAL.stoneDark, r2), r, 0.12)];
        emit(buf, pick(L[PROP.GRAVESTONE], r2), inst);
        return;
      }
      p = 0.3;
      grassPal = PAL.grassGothic;
      flowerP = 0.07;
      flowers = PAL.heather;
      break;
    case BIOME.PRISM:
      p = 0.24;
      grassPal = PAL.grassPrism;
      flowerP = 0.1;
      flowers = PAL.gems;
      glow = 0.9;
      break;
    case BIOME.VOLCANIC:
      p = 0.05;
      grassPal = PAL.grassVolcanic;
      if (r4 > 0.985) {
        const inst = instBase(lx, h - 0.1, lz, r);
        inst.s = 0.25 + r2 * 0.3;
        inst.colors = [PAL.ember];
        inst.emis = [0.9];
        inst.flags = [F_PULSE];
        emit(buf, pick(L[PROP.ROCK], r2), inst);
        return;
      }
      break;
    default:
      break;
  }
  p *= 0.75 + 0.5 * clamp(0.5 - m * 0.5, 0, 1);
  if (r4 < flowerP * (0.5 + 0.5 * clamp(m + 0.5, 0, 1))) {
    const inst = instBase(lx, h - 0.05, lz, r);
    inst.s = 0.9 + r2 * 0.5;
    const c = pick(flowers, r2);
    inst.colors = [c, vary(pick(grassPal, r), r2, 0.1), c];
    inst.emis = glow ? [0, 0, glow] : null;
    inst.flags = [0, F_GRASS, glow ? F_PULSE : 0];
    emit(buf, pick(L[PROP.FLOWER], r), inst);
    return;
  }
  if (r4 < flowerP + p) {
    const inst = instBase(lx, h - 0.05, lz, r);
    inst.s = 0.8 + r2 * 0.8;
    const c = vary(pick(grassPal, r2), r, 0.12);
    inst.colors = [c, c];
    inst.flags = [0, F_GRASS];
    emit(buf, pick(L[PROP.GRASS], r), inst);
    return;
  }
  if (r4 > 0.985 && biome !== BIOME.MYSTIC && biome !== BIOME.PRISM) {
    const pal =
      biome === BIOME.ALPINE ? PAL.rockAlpine : biome === BIOME.MESA ? PAL.rockRed : biome === BIOME.VOLCANIC ? PAL.rockDark : biome === BIOME.GOTHIC ? PAL.rockGothic : PAL.rockGray;
    rockProp(buf, L, lx, h, lz, 0.25 + r2 * 0.4, pal, r);
  }
}

// --------------------------------------------- per-chunk specials (islands, balloons, lighthouses)

const BIO = {};
function placeSpecials(ctx, buf) {
  const { cx, cz, x0, z0, sampler, getGen } = ctx;
  const L = lib();
  const ccx = x0 + 128;
  const ccz = z0 + 128;
  const gen = getGen(sampler.dominantEpoch(ccx, ccz));
  const rng = mulberry32(hashInt(cx, cz, gen.seed, 0xf1a7));
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();
  const r4 = rng();
  const r5 = rng();
  const r6 = rng();
  const r7 = rng();
  const r8 = rng();
  PLOD = 0; // specials are big and always visible
  const lx = 30 + r2 * 196;
  const lz = 30 + r3 * 196;
  const B = gen.regionAt(x0 + lx, z0 + lz, BIO);
  const biome = r4 < B.t ? B.b : B.a;
  surface(ctx, lx, lz, SURF);
  if (ctx.BL[SURF.k] > 0.3) return;
  const ground = Math.max(WATER_LEVEL, SURF.h);

  // floating island
  const pIsland = biome === BIOME.MYSTIC ? 0.32 : biome === BIOME.PRISM ? 0.18 : biome === BIOME.GOTHIC ? 0.06 : 0.0;
  if (r1 < pIsland) {
    const radius = 10 + r5 * 18;
    const y = ground + 70 + r6 * 90;
    const proto = islandProto(radius, mulberry32(hashInt(cx, cz, 0x15)));
    const inst = instBase(lx, y, lz, r7);
    const grass = biome === BIOME.MYSTIC ? hex(0x7a52c8) : biome === BIOME.PRISM ? hex(0xece8f4) : hex(0x4b3f52);
    const rockC = biome === BIOME.MYSTIC ? hex(0x4a4066) : biome === BIOME.PRISM ? hex(0xc8c0e0) : hex(0x2e2b33);
    inst.colors = [rockC, grass];
    emit(buf, proto, inst);
    colS(buf, lx, y - radius * 0.25, lz, radius, MAT.STONE);
    colS(buf, lx, y - radius * 0.95, lz, radius * 0.55, MAT.STONE);
    const trees = 2 + Math.floor(r8 * 4);
    for (let t = 0; t < trees; t++) {
      const a = rng() * Math.PI * 2;
      const rr = rng() * radius * 0.6;
      const tx = lx + Math.cos(a) * rr;
      const tz = lz + Math.sin(a) * rr;
      const rt = rng();
      if (biome === BIOME.MYSTIC) {
        if (rt < 0.5) mushroomProp(buf, L, tx, y + radius * 0.1, tz, 0.5 + rng() * 0.4, rng(), rng());
        else tree(buf, L, PROP.ROUND_TREE, tx, y + radius * 0.1, tz, 0.7 + rng() * 0.5, [hex(0x2a2040), pick(PAL.leafMystic, rt)], rng(), [0, 1, 0, 0]);
      } else if (biome === BIOME.PRISM) {
        polyProp(buf, L, tx, y + radius * 0.1, tz, 0.5 + rng() * 0.4, rng(), rng());
      } else {
        tree(buf, L, PROP.DEAD_TREE, tx, y + radius * 0.1, tz, 0.7 + rng() * 0.6, [PAL.deadBlack], rng(), [0, 0, 0, 0]);
      }
    }
    if (biome !== BIOME.GOTHIC) {
      for (let c = 0; c < 3; c++) {
        const a = rng() * Math.PI * 2;
        const rr = rng() * radius * 0.4;
        const ci = instBase(lx + Math.cos(a) * rr, y - radius * 0.5, lz + Math.sin(a) * rr, rng());
        ci.s = 0.7 + rng() * 0.6;
        ci.sy = -ci.s;
        const col = biome === BIOME.MYSTIC ? pick(PAL.crystalMystic, rng()) : pick(PAL.gems, rng());
        ci.colors = [hex(0x4a4258), col, col, col];
        ci.emis = [0, 0, 1, 0];
        ci.flags = [0, 0, F_PULSE, 0];
        emit(buf, pick(L[PROP.CRYSTAL], rng()), ci);
      }
    }
  }

  // hot-air balloon
  const pBalloon =
    biome === BIOME.MEADOW || biome === BIOME.AUTUMN ? 0.13 : biome === BIOME.COAST || biome === BIOME.MESA ? 0.08 : biome === BIOME.ALPINE || biome === BIOME.PRISM ? 0.04 : 0.0;
  if (r5 < pBalloon) {
    const bx = 20 + r6 * 216;
    const bz = 20 + r7 * 216;
    surface(ctx, bx, bz, SURF);
    const y = Math.max(WATER_LEVEL, SURF.h) + 55 + r8 * 110;
    const inst = instBase(bx, y, bz, r2);
    inst.s = 1.4 + r3 * 0.6;
    const ca = pick(PAL.balloon, r1);
    let cb = pick(PAL.balloon, (r1 * 7.3) % 1);
    if (cb === ca) cb = PAL.balloon[(PAL.balloon.indexOf(ca) + 3) % PAL.balloon.length];
    inst.colors = [ca, cb, hex(0xffb050), hex(0x8a6a48)];
    inst.emis = [0, 0, 1.2, 0];
    inst.flags = [0, 0, F_PULSE, 0];
    emit(buf, L[PROP.BALLOON][0], inst);
    colS(buf, bx, y + 8.6 * inst.s, bz, 5.8 * inst.s, MAT.FABRIC);
    colS(buf, bx, y + 0.5 * inst.s, bz, 1.0 * inst.s, MAT.FABRIC);
  }

  // lighthouse on a coastal headland
  if (biome === BIOME.COAST && r8 < 0.12) {
    for (let tries = 0; tries < 6; tries++) {
      const tx = 20 + rng() * 216;
      const tz = 20 + rng() * 216;
      surface(ctx, tx, tz, SURF);
      if (SURF.h > 2 && SURF.h < 14 && SURF.ny > 0.9) {
        const inst = instBase(tx, SURF.h - 0.4, tz, rng());
        inst.s = 1 + rng() * 0.3;
        inst.colors = [hex(0xf4f0e8), hex(0xd8402e), hex(0xfff0b0), hex(0x3a3a40)];
        inst.emis = [0, 0, 1.4, 0];
        inst.flags = [0, 0, F_PULSE, 0];
        emit(buf, L[PROP.LIGHTHOUSE][0], inst);
        colV(buf, tx, SURF.h, tz, 21 * inst.s, 2.5 * inst.s, MAT.BUILDING);
        break;
      }
    }
  }
}

// ----------------------------------------------------- landmarks (snapped to rivers)

function placeLandmarks(ctx, buf) {
  const { x0, z0, epochs, getGen, sampler } = ctx;
  PLOD = 0;
  const seen = new Set();
  const k0x = Math.floor((x0 - 400) / LANDMARK_CELL);
  const k1x = Math.floor((x0 + 256 + 400) / LANDMARK_CELL);
  const k0z = Math.floor((z0 - 400) / LANDMARK_CELL);
  const k1z = Math.floor((z0 + 256 + 400) / LANDMARK_CELL);
  for (const e of epochs) {
    if (seen.has(e)) continue;
    seen.add(e);
    const gen = getGen(e);
    for (let kz = k0z; kz <= k1z; kz++) {
      for (let kx = k0x; kx <= k1x; kx++) {
        const spec = gen.landmark(kx, kz);
        if (!spec) continue;
        if (spec.x < x0 || spec.x >= x0 + 256 || spec.z < z0 || spec.z >= z0 + 256) continue;
        if (sampler.weightOf(e, spec.x, spec.z) < 0.5) continue;
        buildLandmark(ctx, buf, gen, spec);
      }
    }
  }
}

const LS = {};
function buildLandmark(ctx, buf, gen, spec) {
  const { x0, z0, sampler } = ctx;
  const L = lib();
  const r = mulberry32(spec.seed);
  const B = gen.regionAt(spec.x, spec.z, BIO);
  const biome = B.t > 0.5 ? B.b : B.a;
  sampler.sample(spec.x, spec.z, LS);
  if (LS.bl > 0.3) return;
  const vw = LS.vw;
  const floor = Math.max(WATER_LEVEL, LS.h);
  const ax = spec.ax;
  const az = spec.az; // across the valley
  const tx = -az;
  const tz = ax; // along the river
  const yaw = Math.atan2(az, ax);
  const lx = spec.x - x0;
  const lz = spec.z - z0;
  const roll = spec.roll;

  const ARCH = {
    [BIOME.MEADOW]: { p: 0.45, col: [hex(0xa8a294), hex(0x8c9a7a), hex(0x9ad8a0)], glow: 0, mat: MAT.STONE },
    [BIOME.ALPINE]: { p: 0.45, col: [hex(0x7c8494), hex(0x9aa2b0), hex(0x9ff0ff)], glow: 0, mat: MAT.STONE },
    [BIOME.MESA]: { p: 0.75, col: [hex(0xc4673a), hex(0xe2a46e), hex(0xffc070)], glow: 0, mat: MAT.STONE },
    [BIOME.AUTUMN]: { p: 0.45, col: [hex(0x8c8478), hex(0x7f8c62), hex(0xffd27a)], glow: 0, mat: MAT.STONE },
    [BIOME.COAST]: { p: 0.5, col: [hex(0xe0d8c8), hex(0xc8bea8), hex(0xffffff)], glow: 0, mat: MAT.STONE },
    [BIOME.VOLCANIC]: { p: 0.6, col: [hex(0x1d1a1f), hex(0x2a2430), hex(0xff6a1e)], glow: 5, mat: MAT.OBSIDIAN },
  };

  // a chain of capsules along local (x, y) points of a structure facing the river
  const chain = (pts, baseY, r0, mat, closed = false) => {
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      pushCol(buf, lx + ax * p[0], baseY + p[1], lz + az * p[0], lx + ax * q[0], baseY + q[1], lz + az * q[0], r0, mat);
    }
  };

  if (spec.river) {
    if (biome === BIOME.MYSTIC || biome === BIOME.PRISM) {
      if (roll < 0.72) {
        const radius = 26 + r() * 12;
        const cy = floor + 26;
        if (biome === BIOME.MYSTIC) {
          const th = 5 + r() * 2;
          const proto = ringGateProto(radius, th, r);
          const inst = instBase(lx, cy, lz, 0);
          inst.ry = yaw;
          inst.colors = [hex(0x4a4066), hex(0x5c5080), hex(0x8ff8ff), hex(0x4a4066)];
          inst.emis = [0, 0, 1.3, 0];
          inst.flags = [0, 0, F_PULSE, 0];
          emit(buf, proto, inst);
          const pts = [];
          for (let i = 0; i < 24; i++) pts.push([Math.cos((i / 24) * Math.PI * 2) * radius, Math.sin((i / 24) * Math.PI * 2) * radius]);
          chain(pts, cy, th * 0.55, MAT.STONE, true);
        } else {
          const th = 3.5 + r() * 1.5;
          const proto = haloProto(radius, th, r);
          const inst = instBase(lx, cy, lz, 0);
          inst.ry = yaw;
          inst.colors = [pick(PAL.gems, r()), pick(PAL.gems, r()), pick(PAL.gems, r())];
          inst.emis = [0.9, 0.9, 1.4];
          inst.flags = [F_PULSE, F_PULSE, F_PULSE];
          emit(buf, proto, inst);
          const pts = [];
          for (let i = 0; i < 28; i++) pts.push([Math.cos((i / 28) * Math.PI * 2) * radius, Math.sin((i / 28) * Math.PI * 2) * radius]);
          chain(pts, cy, th * 0.55, MAT.NEON, true);
          colS(buf, lx, cy, lz, radius * 0.12, MAT.NEON);
        }
      } else {
        crystalCluster(ctx, buf, L, spec, vw, floor, r, biome === BIOME.PRISM ? PAL.gems : PAL.crystalMystic, MAT.CRYSTAL);
      }
      return;
    }

    if (biome === BIOME.GOTHIC) {
      if (roll < 0.7) {
        const span = clamp(2 * vw + 50, 110, 260);
        const half = span / 2;
        const gL = sampler.heightAt(spec.x - ax * half, spec.z - az * half);
        const gR = sampler.heightAt(spec.x + ax * half, spec.z + az * half);
        const base = Math.max(floor, Math.min(gL, gR) + 4);
        const legDown = base - Math.min(gL, gR, WATER_LEVEL - 2) + 4;
        const ratio = 0.78 + r() * 0.2;
        const width = 8 + r() * 4;
        const depth = 10 + r() * 6;
        const proto = gothicGateProto(span, ratio, legDown, width, depth, r);
        const inst = instBase(lx, base, lz, 0);
        inst.ry = yaw;
        inst.colors = [hex(0x3a3640), hex(0x2c2a32), pick(PAL.glass, r())];
        inst.emis = [0, 0, 1.25];
        inst.flags = [0, 0, F_PULSE];
        emit(buf, proto, inst);
        // pointed arch collider (two arcs), plus the flanking towers
        const R = span * ratio;
        const xc = -half + R;
        const thA = Math.acos(clamp(-xc / R, -1, 1));
        const pts = [[-half, -legDown]];
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI + (thA - Math.PI) * (i / 8);
          pts.push([xc + Math.cos(a) * R, Math.sin(a) * R]);
        }
        for (let i = 8; i >= 0; i--) {
          const a = Math.PI + (thA - Math.PI) * (i / 8);
          pts.push([-(xc + Math.cos(a) * R), Math.sin(a) * R]);
        }
        pts.push([half, -legDown]);
        chain(pts, base, width * 0.5, MAT.STONE);
        const apex = Math.sin(thA) * R;
        for (const sx of [-1, 1]) {
          const px = lx + ax * sx * (half + width * 0.3);
          const pz = lz + az * sx * (half + width * 0.3);
          pushCol(buf, px, base - legDown, pz, px, base + apex * 0.8, pz, width, MAT.STONE);
        }
      } else {
        // cathedral ruins on both banks
        for (let i = 0; i < 2; i++) {
          const side = i ? 1 : -1;
          const off = side * (vw * 0.9 + 12 + r() * 16);
          const px = spec.x + ax * off + tx * (r() - 0.5) * 60;
          const pz = spec.z + az * off + tz * (r() - 0.5) * 60;
          const h = sampler.heightAt(px, pz);
          if (h > WATER_LEVEL) cathedralProp(buf, L, px - x0, h, pz - z0, r(), r());
        }
      }
      return;
    }

    const A = ARCH[biome];
    if (A && roll < A.p) {
      const span = clamp(2 * vw + 60, 110, 300);
      const half = span / 2;
      const gL = sampler.heightAt(spec.x - ax * half, spec.z - az * half);
      const gR = sampler.heightAt(spec.x + ax * half, spec.z + az * half);
      const base = Math.max(floor, Math.min(gL, gR) + 4);
      const legDown = base - Math.min(gL, gR, WATER_LEVEL - 2) + 4;
      const rise = clamp(span * 0.42, 55, 110) + r() * 15;
      const width = 9 + r() * 6;
      const depth = 10 + r() * 8;
      const proto = archProto(span, rise, legDown, width, depth, r, A.glow);
      const inst = instBase(lx, base, lz, 0);
      inst.ry = yaw;
      inst.colors = [A.col[0], A.col[1], A.col[2]];
      inst.emis = [0, 0, A.glow ? 1 : 0];
      inst.flags = [0, 0, A.glow ? F_PULSE : 0];
      emit(buf, proto, inst);
      const pts = [[-half, -legDown]];
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI - (i / 16) * Math.PI;
        pts.push([Math.cos(a) * half, Math.sin(a) * rise]);
      }
      pts.push([half, -legDown]);
      chain(pts, base, width * 0.5, A.mat);
      return;
    }
    if (roll < 0.85) riverRuins(ctx, buf, L, spec, biome, vw, r);
    return;
  }

  // ------------------------------------------- free-standing landmarks (away from rivers)
  switch (biome) {
    case BIOME.GOTHIC: {
      gothicSpireProp(buf, L, lx, sampler.heightAt(spec.x, spec.z), lz, 1.0 + r() * 0.4, r());
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2;
        const d = 18 + r() * 30;
        const px = spec.x + Math.cos(a) * d;
        const pz = spec.z + Math.sin(a) * d;
        const h = sampler.heightAt(px, pz);
        if (h > WATER_LEVEL + 0.5) lanternProp(buf, L, px - x0, h, pz - z0, r());
      }
      return;
    }
    case BIOME.PRISM: {
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2;
        const d = r() * 40;
        const px = spec.x + Math.cos(a) * d;
        const pz = spec.z + Math.sin(a) * d;
        const h = sampler.heightAt(px, pz);
        if (h < WATER_LEVEL) continue;
        if (i % 2) orbProp(buf, L, px - x0, h + 10 + r() * 30, pz - z0, 1.4 + r() * 2.5, r(), r());
        else polyProp(buf, L, px - x0, h, pz - z0, 1.4 + r() * 1.8, r(), r());
      }
      return;
    }
    case BIOME.MEADOW:
    case BIOME.AUTUMN: {
      // a ring of standing stones
      const n = 8 + Math.floor(r() * 5);
      const rad = 16 + r() * 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = spec.x + Math.cos(a) * rad;
        const pz = spec.z + Math.sin(a) * rad;
        const h = sampler.heightAt(px, pz);
        if (h > WATER_LEVEL) monolith(buf, L, px - x0, h, pz - z0, r(), r(), PAL.stone);
      }
      return;
    }
    case BIOME.ALPINE:
    case BIOME.MYSTIC:
      crystalCluster(ctx, buf, L, spec, 0, Math.max(WATER_LEVEL, sampler.heightAt(spec.x, spec.z)), r, biome === BIOME.ALPINE ? PAL.crystalIce : PAL.crystalMystic, biome === BIOME.ALPINE ? MAT.ICE : MAT.CRYSTAL);
      return;
    case BIOME.MESA:
      for (let i = 0; i < 4; i++) {
        const px = spec.x + (r() - 0.5) * 80;
        const pz = spec.z + (r() - 0.5) * 80;
        hoodooProp(buf, L, px - x0, sampler.heightAt(px, pz), pz - z0, 1.4 + r() * 1.0, r());
      }
      return;
    case BIOME.VOLCANIC:
      for (let i = 0; i < 5; i++) {
        const px = spec.x + (r() - 0.5) * 90;
        const pz = spec.z + (r() - 0.5) * 90;
        spireProp(buf, L, px - x0, Math.max(sampler.heightAt(px, pz), WATER_LEVEL), pz - z0, 1.4 + r() * 1.2, r());
      }
      return;
    default:
      return;
  }
}

function crystalCluster(ctx, buf, L, spec, vw, floor, r, pal, mat) {
  const { x0, z0, sampler } = ctx;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const off = side * (vw * 0.65 + r() * 30);
    const along = (r() - 0.5) * 120;
    const px = spec.x + spec.ax * off - spec.az * along;
    const pz = spec.z + spec.az * off + spec.ax * along;
    const h = sampler.heightAt(px, pz);
    crystalProp(buf, L, px - x0, Math.max(h, floor - 1), pz - z0, 2.5 + r() * 2.5, pal, r(), 1.1, mat);
  }
}

function riverRuins(ctx, buf, L, spec, biome, vw, r) {
  const { x0, z0, sampler } = ctx;
  const pal = biome === BIOME.COAST ? PAL.stone : PAL.mossStone;
  const count = 8 + Math.floor(r() * 6);
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const off = side * (vw * 0.55 + 6 + r() * 14);
    const along = (Math.floor(i / 2) - count / 4) * 22 + (r() - 0.5) * 4;
    const px = spec.x + spec.ax * off - spec.az * along;
    const pz = spec.z + spec.az * off + spec.ax * along;
    const h = sampler.heightAt(px, pz);
    if (h < WATER_LEVEL - 1) continue;
    if (biome === BIOME.VOLCANIC) {
      spireProp(buf, L, px - x0, Math.max(h, WATER_LEVEL), pz - z0, 1.2 + r() * 1.0, r());
      continue;
    }
    if (biome === BIOME.MESA) {
      if (i % 3 === 0) hoodooProp(buf, L, px - x0, h, pz - z0, 1.2 + r() * 0.8, r());
      continue;
    }
    const broken = r() < 0.4;
    const inst = instBase(px - x0, Math.max(h, WATER_LEVEL) - 0.6, pz - z0, r());
    inst.s = 1.4 + r() * 0.4;
    const c = vary(pick(pal, r()), r(), 0.08);
    inst.colors = [c, vary(c, r(), 0.06)];
    emit(buf, L[broken ? PROP.PILLAR_BROKEN : PROP.PILLAR][Math.floor(r() * 2)], inst);
    colV(buf, px - x0, Math.max(h, WATER_LEVEL), pz - z0, (broken ? 7 : 13) * inst.s, 1.1 * inst.s, MAT.STONE);
  }
}
