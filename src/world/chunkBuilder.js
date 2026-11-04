// Builds the typed arrays for one terrain chunk: terrain mesh (with skirts),
// water/lava surface and baked low-poly props. Runs inside the worker (or on the
// main thread as a fallback). Output contains only transferable typed arrays.

import { BIOME, BIOMES, hex } from './biomes.js';
import { CHUNK_SIZE, WATER_LEVEL } from './terrain.js';
import { mulberry32, hashInt, clamp, lerp, smoothstep } from './noise.js';
import { PROP, buildPropLibrary, archProto, ringGateProto, islandProto } from './props.js';

export const LOD_SEGMENTS = [64, 32, 16];
export const MESA_STRATA = [0xc4673a, 0xd98b52, 0xeab47e, 0xb5523a, 0xf2d3a2, 0xa84a30, 0xd77d4a];
const LANDMARK_SPACING = 1100;

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
    rock: hex(0x8d877a), rock2: hex(0x6e6a62), sand: hex(0xdccb9c), bed: hex(0x6f8460), path: hex(0xb9a87a),
  },
  alpine: {
    grassA: hex(0x4f7d48), grassB: hex(0x759a58), forest: hex(0x2f5232), rock: hex(0x727b8c), rock2: hex(0x4f5668),
    snow: hex(0xf3f7ff), snow2: hex(0xd9e4f6), gravel: hex(0x8e8c80), bed: hex(0x5d7070),
  },
  mesa: {
    strata: [0xc4673a, 0xd98b52, 0xeab47e, 0xb5523a, 0xf2d3a2, 0xa84a30, 0xd77d4a].map(hex),
    mid: hex(0xcf8352),
    sand: hex(0xe3bd88), scrub: hex(0xb6a05e), wet: hex(0xb08a5a), bed: hex(0x8a6a48),
  },
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
};

/**
 * Terrain colour per biome. Writes sRGB into o and returns emissive strength (0..1).
 * h: height, sl: slope (0 flat .. 1 vertical), n: detail noise, m: moisture, fm: forest mask
 */
// Per-vertex weight of the mesa strata, which the terrain shader paints per pixel.
let STRATA = 0;

function terrainColor(b, o, h, sl, n, m, fm, ridge) {
  STRATA = 0;
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
      // average strata tone; the shader paints the actual bands per pixel
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
    case BIOME.VOLCANIC:
    default: {
      const P = C.volcanic;
      set3(o, P.groundA);
      mix3(o, P.groundB, 0.5 + 0.45 * n);
      mix3(o, P.ash, (1 - smoothstep(0.08, 0.2, sl)) * smoothstep(0.0, 0.7, m) * 0.55);
      mix3(o, P.glass, smoothstep(0.3, 0.5, sl) * 0.6);
      mix3(o, P.rock, smoothstep(0.22, 0.42, sl));
      // glowing fissures along ridges and lava shores
      const crack = Math.max(smoothstep(0.8, 0.93, ridge + n * 0.06), 1 - smoothstep(0.2, 2.4, h));
      let em = 0;
      if (crack > 0) {
        mix3(o, P.crack, crack);
        em = crack * 0.9;
      }
      if (h < 0) mix3(o, P.bed, smoothstep(0, -1.5, h));
      return em;
    }
  }
}

// --------------------------------------------------------------- prop output buffer

class PropBuffer {
  constructor(cap = 1 << 16) {
    this.alloc(cap);
  }
  alloc(cap) {
    const pos = new Float32Array(cap * 3);
    const col = new Uint8Array(cap * 4);
    const dat = new Uint8Array(cap * 4);
    if (this.pos) {
      pos.set(this.pos.subarray(0, this.n * 3));
      col.set(this.col.subarray(0, this.n * 4));
      dat.set(this.dat.subarray(0, this.n * 4));
    }
    this.pos = pos;
    this.col = col;
    this.dat = dat;
    this.cap = cap;
  }
  reset() {
    this.n = 0;
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

const tmpCol = [0, 0, 0];

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
  const tX = inst.tiltX || 0;
  const tZ = inst.tiltZ || 0;
  const P = proto.pos;
  const pos = buf.pos;
  const col = buf.col;
  const dat = buf.dat;
  const swayMul = (inst.sway ?? 1) * Math.min(2, sx);
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
  leafPalm: [0x3f9a3a, 0x4caa3e, 0x358a36].map(hex),
  leafMystic: [0xb06af0, 0x7a4fe0, 0x40d8c8, 0xe070e0].map(hex),
  bushMesa: [0x9b8a4e, 0x8a7a44, 0xa89656].map(hex),
  bushAutumn: [0xa8322a, 0xc2442a, 0x8c3a2a].map(hex),
  rockGray: [0x8a8680, 0x77736c, 0x9a958c].map(hex),
  rockAlpine: [0x737c8c, 0x5f6878, 0x868e9c].map(hex),
  rockRed: [0xa65a3c, 0xb8683e, 0x94503a].map(hex),
  rockMystic: [0x4a4066, 0x5c5080, 0x3c3456].map(hex),
  rockDark: [0x2a2626, 0x1f1c1d, 0x342e2c].map(hex),
  cactus: [0x4f7a3a, 0x5c8a40, 0x467034].map(hex),
  flowers: [0xffffff, 0xffe066, 0xff8fb0, 0xc58cff, 0xff7a5c, 0x9fd8ff].map(hex),
  mysticFlowers: [0x6ff6ff, 0xff7af0, 0xb48cff, 0x8affc8].map(hex),
  crystalMystic: [0xb070ff, 0x6ff0ff, 0xff70e0].map(hex),
  crystalIce: [0x9ff0ff, 0xbfe8ff].map(hex),
  mushroomCap: [0xd94fa5, 0x4fd9d0, 0x9a5cff, 0xff8a5c].map(hex),
  stem: hex(0xe8dccf),
  wall: [0xf0e6d2, 0xe8d8b8, 0xf4efe6, 0xd9c8a8].map(hex),
  roof: [0xb8452e, 0x7a4a3a, 0x3f5a7a, 0x8a3a3a, 0x5a6a3a].map(hex),
  window: hex(0xffc66a),
  stone: [0xb8b2a6, 0xa49e92, 0xc4bfb4].map(hex),
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
  ember: hex(0xff7a2a),
  obsidian: [0x1a1720, 0x221d2a].map(hex),
};

// ------------------------------------------------------------------ chunk builder

const S = {};
const BIO = {};

export function buildChunk(world, cx, cz, lod, density = 1) {
  const N = LOD_SEGMENTS[lod];
  const step = CHUNK_SIZE / N;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const G = N + 3;
  const V = (N + 1) * (N + 1);
  const H = new Float32Array(G * G);
  const bA = new Uint8Array(V);
  const bB = new Uint8Array(V);
  const bT = new Float32Array(V);
  const det = new Float32Array(V);
  const rid = new Float32Array(V);
  const dist = new Float32Array(V);
  const vwA = new Float32Array(V);

  for (let j = 0; j < G; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const x = x0 + (i - 1) * step;
      world.sample(x, z, S);
      H[j * G + i] = S.h;
      if (i >= 1 && i <= N + 1 && j >= 1 && j <= N + 1) {
        const k = (j - 1) * (N + 1) + (i - 1);
        bA[k] = S.a;
        bB[k] = S.b;
        bT[k] = S.t;
        det[k] = S.detail;
        rid[k] = S.ridge;
        dist[k] = S.d;
        vwA[k] = S.vw;
      }
    }
  }

  // ---------------------------------------------------------------- terrain
  const edgeVerts = 4 * (N + 1);
  const totalVerts = V + edgeVerts;
  const tPos = new Float32Array(totalVerts * 3);
  const tNrm = new Int8Array(totalVerts * 3);
  const tCol = new Uint8Array(totalVerts * 4);
  const tMat = new Uint8Array(totalVerts);
  const nrmY = new Float32Array(V);
  const nrmX = new Float32Array(V);
  const nrmZ = new Float32Array(V);
  let minY = Infinity;
  let maxY = -Infinity;
  const ca = [0, 0, 0];
  const cb = [0, 0, 0];
  const nA = world.nA;
  const nB = world.nB;
  const nC = world.nC;
  const inv2 = 1 / (2 * step);

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
      const n = det[k];
      const m = nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
      const fm = smoothstep(0.05, 0.45, nC(wx * 0.0045 + 7.7, wz * 0.0045 - 3.3) + 0.25 * nA(wx * 0.017, wz * 0.017));
      let em = terrainColor(bA[k], ca, h, sl, n, m, fm, rid[k]);
      let strata = STRATA;
      const t = bT[k];
      if (t > 0.001) {
        const emB = terrainColor(bB[k], cb, h, sl, n, m, fm, rid[k]);
        mix3(ca, cb, t);
        em = lerp(em, emB, t);
        strata = lerp(strata, STRATA, t);
      }
      tMat[k] = clamp(strata * 255, 0, 255);
      tCol[k * 4] = clamp(ca[0] * 255, 0, 255);
      tCol[k * 4 + 1] = clamp(ca[1] * 255, 0, 255);
      tCol[k * 4 + 2] = clamp(ca[2] * 255, 0, 255);
      tCol[k * 4 + 3] = clamp(em * 255, 0, 255);
    }
  }

  // skirts: duplicate the border ring, pushed down, to hide LOD cracks
  const skirtDepth = step * 1.5 + 3;
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push(i); // j = 0 edge
  for (let j = 1; j <= N; j++) ring.push(j * (N + 1) + N); // i = N edge
  for (let i = N - 1; i >= 0; i--) ring.push(N * (N + 1) + i); // j = N edge
  for (let j = N - 1; j >= 1; j--) ring.push(j * (N + 1)); // i = 0 edge
  // ring has 4N entries; we allocated 4(N+1) slots, fine.
  for (let r = 0; r < ring.length; r++) {
    const src = ring[r];
    const dst = V + r;
    tPos[dst * 3] = tPos[src * 3];
    tPos[dst * 3 + 1] = tPos[src * 3 + 1] - skirtDepth;
    tPos[dst * 3 + 2] = tPos[src * 3 + 2];
    tNrm[dst * 3] = tNrm[src * 3];
    tNrm[dst * 3 + 1] = tNrm[src * 3 + 1];
    tNrm[dst * 3 + 2] = tNrm[src * 3 + 2];
    tCol[dst * 4] = tCol[src * 4];
    tCol[dst * 4 + 1] = tCol[src * 4 + 1];
    tCol[dst * 4 + 2] = tCol[src * 4 + 2];
    tCol[dst * 4 + 3] = tCol[src * 4 + 3];
    tMat[dst] = tMat[src];
  }
  minY -= skirtDepth;

  const quadCount = N * N;
  const ringN = ring.length;
  const tIdx = new Uint16Array(quadCount * 6 + ringN * 12);
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
    // both windings so the skirt is visible from either side
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
    mat: tMat.subarray(0, V + ringN).slice(),
    idx: tIdx,
    minY,
    maxY,
  };

  // ------------------------------------------------------------------ water
  const water = buildWater(N, step, H, G, bA, bB, bT);

  // ------------------------------------------------------------------ props
  let props = null;
  const buf = getBuffer();
  buf.reset();
  const ctx = { world, cx, cz, lod, N, step, H, G, x0, z0, nrmX, nrmY, nrmZ, bA, bB, bT, dist, vwA, density };
  if (lod <= 1) placeProps(ctx, buf);
  placeSpecials(ctx, buf);
  placeLandmarks(ctx, buf);
  if (buf.n > 0) {
    props = {
      pos: buf.pos.slice(0, buf.n * 3),
      col: buf.col.slice(0, buf.n * 4),
      dat: buf.dat.slice(0, buf.n * 4),
      count: buf.n,
      min: [buf.minX, buf.minY, buf.minZ],
      max: [buf.maxX, buf.maxY, buf.maxZ],
    };
  }

  const transfer = [terrain.pos.buffer, terrain.nrm.buffer, terrain.col.buffer, terrain.mat.buffer, terrain.idx.buffer];
  if (water) transfer.push(water.pos.buffer, water.dep.buffer, water.tint.buffer, water.idx.buffer);
  if (props) transfer.push(props.pos.buffer, props.col.buffer, props.dat.buffer);
  return { cx, cz, lod, terrain, water, props, transfer };
}

let BUF = null;
function getBuffer() {
  if (!BUF) BUF = new PropBuffer();
  return BUF;
}

function buildWater(N, step, H, G, bA, bB, bT) {
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
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const w = map[k];
      if (w < 0) continue;
      pos[w * 3] = i * step;
      pos[w * 3 + 1] = WATER_LEVEL;
      pos[w * 3 + 2] = j * step;
      dep[w] = clamp(WATER_LEVEL - hAt(i, j), -8, 80);
      const A = BIOMES[bA[k]];
      const B = BIOMES[bB[k]];
      const t = bT[k];
      tint[w * 4] = clamp(lerp(A.water[0], B.water[0], t) * 255, 0, 255);
      tint[w * 4 + 1] = clamp(lerp(A.water[1], B.water[1], t) * 255, 0, 255);
      tint[w * 4 + 2] = clamp(lerp(A.water[2], B.water[2], t) * 255, 0, 255);
      tint[w * 4 + 3] = clamp(lerp(A.lava, B.lava, t) * 255, 0, 255);
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

const SURF = {};

function instBase(x, y, z, r) {
  return { x, y, z, ry: r * Math.PI * 2, s: 1, sy: undefined, colors: [], emis: null, flags: null, phase: r, sway: 1 };
}

function placeProps(ctx, buf) {
  const { world, cx, cz, lod, x0, z0, density } = ctx;
  PLOD = lod;
  const L = lib();
  const rng = mulberry32(hashInt(cx, cz, world.seed, 0x51ed));
  const nA = world.nA;
  const nB = world.nB;
  const nC = world.nC;

  // ---------------------------------------------------- large props (10 m cells)
  const cell = 10;
  const cells = CHUNK_SIZE / cell;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const r4 = rng();
      const r5 = rng();
      const r6 = rng();
      const r7 = rng();
      if (r7 > density) continue;
      const lx = (i + r1) * cell;
      const lz = (j + r2) * cell;
      const wx = x0 + lx;
      const wz = z0 + lz;
      surface(ctx, lx, lz, SURF);
      const h = SURF.h;
      if (h < WATER_LEVEL + 0.4) {
        maybeBoat(ctx, buf, L, lx, lz, h, r3, r4, r5, r6);
        continue;
      }
      const k = SURF.k;
      const biome = r3 < ctx.bT[k] ? ctx.bB[k] : ctx.bA[k];
      const sl = 1 - SURF.ny;
      const fm = smoothstep(0.05, 0.45, nC(wx * 0.0045 + 7.7, wz * 0.0045 - 3.3) + 0.25 * nA(wx * 0.017, wz * 0.017));
      const m = nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
      const d = ctx.dist[k];
      const vw = ctx.vwA[k];
      const village = nC(wx * 0.0021 + 33.3, wz * 0.0021 - 71.1);
      const central = d < vw * 0.55; // keep tall things out of the flight corridor
      largeProp(buf, L, biome, lx, h, lz, sl, fm, m, d, vw, village, central, r4, r5, r6, SURF);
    }
  }

  if (lod > 0) return;

  // ---------------------------------------------------- small props (4 m cells)
  const sc = 4;
  const sCells = CHUNK_SIZE / sc;
  for (let j = 0; j < sCells; j++) {
    for (let i = 0; i < sCells; i++) {
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const r4 = rng();
      const r5 = rng();
      if (r5 > density) continue;
      const lx = (i + r1) * sc;
      const lz = (j + r2) * sc;
      surface(ctx, lx, lz, SURF);
      const h = SURF.h;
      if (h < WATER_LEVEL + 0.5) continue;
      const k = SURF.k;
      const biome = r3 < ctx.bT[k] ? ctx.bB[k] : ctx.bA[k];
      const sl = 1 - SURF.ny;
      if (sl > 0.35) continue;
      const wx = x0 + lx;
      const wz = z0 + lz;
      const m = nB(wx * 0.0011 - 9.3, wz * 0.0011 + 4.1);
      smallProp(buf, L, biome, lx, h, lz, sl, m, r4, rng);
    }
  }
}

function maybeBoat(ctx, buf, L, lx, lz, h, r3, r4, r5, r6) {
  if (h > -3 || PLOD > 0) return;
  const k = SURF.k;
  const biome = r3 < ctx.bT[k] ? ctx.bB[k] : ctx.bA[k];
  const lava = BIOMES[biome].lava > 0;
  if (lava) return;
  const p = biome === BIOME.COAST ? 0.012 : biome === BIOME.MEADOW || biome === BIOME.AUTUMN ? 0.003 : 0;
  if (r4 > p) return;
  const inst = instBase(lx, WATER_LEVEL - 0.15, lz, r5);
  inst.s = 0.9 + r6 * 0.4;
  inst.colors = [pick(PAL.hull, r6), PAL.sail, PAL.sail, PAL.trunkDark];
  emit(buf, pick(L[PROP.BOAT], r5), inst);
}

const SMALL_AT_DISTANCE = new Set([PROP.BUSH, PROP.CACTUS, PROP.DEAD_TREE]);

function tree(buf, L, type, lx, h, lz, scale, colors, r, flags = [F_SOLID, F_FOLIAGE, F_SOLID, F_SOLID]) {
  if (PLOD > 0 && SMALL_AT_DISTANCE.has(type)) return;
  const inst = instBase(lx, h - 0.25 * scale, lz, r);
  inst.s = scale;
  inst.colors = colors;
  inst.flags = flags;
  inst.tiltX = (r - 0.5) * 0.08;
  inst.tiltZ = (((r * 7.31) % 1) - 0.5) * 0.08;
  emit(buf, pick(L[type], (r * 13.7) % 1), inst);
}

// Current LOD while placing props: small items are skipped on distant chunks.
let PLOD = 0;

function largeProp(buf, L, biome, lx, h, lz, sl, fm, m, d, vw, village, central, r4, r5, r6, surf) {
  const leafVar = (list) => vary(pick(list, r6), r5, 0.1);
  switch (biome) {
    case BIOME.MEADOW: {
      if (village > 0.52 && sl < 0.08 && h > 2 && d > vw * 0.75 && d < vw * 3.5 && r4 < 0.3) {
        return cottage(buf, L, lx, h, lz, r5, r6);
      }
      if (sl > 0.4) return;
      const pt = 0.03 + 0.62 * fm;
      if (r4 < pt) {
        const roll = r5;
        if (roll < 0.72) return tree(buf, L, PROP.ROUND_TREE, lx, h, lz, 0.75 + r6 * 0.85, [PAL.trunk, leafVar(PAL.leafMeadow)], r5);
        if (roll < 0.86) return tree(buf, L, PROP.PINE, lx, h, lz, 0.8 + r6 * 0.7, [PAL.trunkDark, leafVar(PAL.leafPine)], r5);
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
      if (r4 > 0.915 && !central && h > 20) return crystalProp(buf, L, lx, h, lz, 0.8 + r6 * 1.2, PAL.crystalIce, r5, 0.8);
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
        if (r4 < 0.05) return crystalProp(buf, L, lx, h, lz, 0.8 + r6 * 1.4, PAL.crystalMystic, r5, 1.0);
        return;
      }
      if (r4 < 0.03 + 0.12 * fm && !central) return mushroomProp(buf, L, lx, h, lz, 0.8 + r6 * 0.9, r5, r6);
      if (r4 < 0.06 + 0.45 * fm) {
        const leaf = leafVar(PAL.leafMystic);
        return tree(buf, L, r5 < 0.75 ? PROP.ROUND_TREE : PROP.BIRCH, lx, h, lz, 0.8 + r6 * 0.8, [hex(0x2a2040), leaf], r5, [0, 1, 0, 0]);
      }
      if (r4 < 0.6 && r4 > 0.57) return crystalProp(buf, L, lx, h, lz, 0.6 + r6 * 1.2, PAL.crystalMystic, r5, 1.0);
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
        const roll = r5;
        if (roll < 0.62) return tree(buf, L, PROP.ROUND_TREE, lx, h, lz, 0.75 + r6 * 0.85, [PAL.trunk, leafVar(PAL.leafAutumn)], r5);
        if (roll < 0.82) return tree(buf, L, PROP.BIRCH, lx, h, lz, 0.8 + r6 * 0.6, [PAL.birch, vary(hex(0xf2c13a), r6, 0.12)], r5);
        if (roll < 0.93) return tree(buf, L, PROP.PINE, lx, h, lz, 0.8 + r6 * 0.6, [PAL.trunkDark, leafVar(PAL.leafPine)], r5);
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
    case BIOME.VOLCANIC:
    default: {
      if (r4 < 0.012 && !central && sl < 0.4) return spireProp(buf, L, lx, h, lz, 0.7 + r6 * 0.8, r5);
      if (r4 < 0.045 && sl < 0.35) return tree(buf, L, PROP.DEAD_TREE, lx, h, lz, 0.7 + r6 * 0.6, [hex(0x241c18)], r5, [0, 0, 0, 0]);
      if (r4 < 0.075) return lavaRockProp(buf, L, lx, h, lz, 0.8 + r6 * 1.8, r5);
      if (r4 > 0.96) return rockProp(buf, L, lx, h, lz, 0.8 + r6 * 2, PAL.rockDark, r5);
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
}

function crystalProp(buf, L, lx, h, lz, s, pal, r, glow) {
  const inst = instBase(lx, h - 0.2, lz, r);
  inst.s = s;
  const c = pick(pal, (r * 5.3) % 1);
  inst.colors = [hex(0x4a4258), c, c, c];
  inst.emis = [0, 0, glow, 0];
  inst.flags = [0, 0, F_PULSE, 0];
  emit(buf, pick(L[PROP.CRYSTAL], (r * 7.1) % 1), inst);
}

function mushroomProp(buf, L, lx, h, lz, s, r, r2) {
  const inst = instBase(lx, h - 0.3, lz, r);
  inst.s = s;
  const cap = pick(PAL.mushroomCap, r2);
  inst.colors = [PAL.stem, cap, vary(hex(0xbff8ff), r2, 0.1), cap];
  inst.emis = [0, 0.08, 0.9, 0];
  inst.flags = [0, 0, F_PULSE, 0];
  emit(buf, pick(L[PROP.MUSHROOM], (r * 3.3) % 1), inst);
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
}

function spireProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.5, lz, r);
  inst.s = s;
  inst.colors = [pick(PAL.obsidian, r), hex(0x3a2a40), PAL.ember];
  inst.emis = [0, 0, 0.9];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.SPIRE], (r * 3.1) % 1), inst);
}

function lavaRockProp(buf, L, lx, h, lz, s, r) {
  const inst = instBase(lx, h - 0.25 * s, lz, r);
  inst.s = s;
  inst.colors = [pick(PAL.rockDark, r), PAL.ember, PAL.ember];
  inst.emis = [0, 0, 0.85];
  inst.flags = [0, 0, F_PULSE];
  emit(buf, pick(L[PROP.LAVA_ROCK], (r * 5.1) % 1), inst);
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
}

function cottage(buf, L, lx, h, lz, r, r2) {
  const inst = instBase(lx, h - 0.3, lz, r);
  inst.s = 0.95 + r2 * 0.3;
  inst.colors = [pick(PAL.wall, r2), pick(PAL.roof, (r * 7.7) % 1), PAL.window, vary(hex(0x8a8078), r, 0.1)];
  inst.emis = [0, 0, 0.75, 0];
  emit(buf, pick(L[PROP.COTTAGE], (r * 3.3) % 1), inst);
}

function smallProp(buf, L, biome, lx, h, lz, sl, m, r4, rng) {
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
    case BIOME.VOLCANIC:
      p = 0.05;
      grassPal = PAL.grassVolcanic;
      if (r4 > 0.985) {
        // glowing ember pebble
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
  // moisture modulates density a little
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
  if (r4 > 0.985 && biome !== BIOME.MYSTIC) {
    const pal = biome === BIOME.ALPINE ? PAL.rockAlpine : biome === BIOME.MESA ? PAL.rockRed : biome === BIOME.VOLCANIC ? PAL.rockDark : PAL.rockGray;
    rockProp(buf, L, lx, h, lz, 0.25 + r2 * 0.4, pal, r);
  }
}

// --------------------------------------------- per-chunk specials (islands, balloons, lighthouses)

function placeSpecials(ctx, buf) {
  const { world, cx, cz, x0, z0 } = ctx;
  PLOD = 0; // specials are big and always visible
  const L = lib();
  const rng = mulberry32(hashInt(cx, cz, world.seed, 0xf1a7));
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();
  const r4 = rng();
  const r5 = rng();
  const r6 = rng();
  const r7 = rng();
  const r8 = rng();
  const lx = 30 + r2 * (CHUNK_SIZE - 60);
  const lz = 30 + r3 * (CHUNK_SIZE - 60);
  const wx = x0 + lx;
  const wz = z0 + lz;
  const B = world.biomeAt(wx, wz, BIO);
  const biome = r4 < B.t ? B.b : B.a;
  surface(ctx, lx, lz, SURF);
  const ground = Math.max(WATER_LEVEL, SURF.h);

  // floating island
  const pIsland = biome === BIOME.MYSTIC ? 0.32 : 0.0;
  if (r1 < pIsland) {
    const radius = 10 + r5 * 18;
    const y = ground + 70 + r6 * 90;
    const proto = islandProto(radius, mulberry32(hashInt(cx, cz, 0x15)));
    const inst = instBase(lx, y, lz, r7);
    const grass =
      biome === BIOME.MYSTIC ? hex(0x7a52c8) : biome === BIOME.ALPINE ? hex(0xe8eef8) : biome === BIOME.AUTUMN ? hex(0xc88a34) : hex(0x6aa83c);
    const rockC = biome === BIOME.MYSTIC ? hex(0x4a4066) : biome === BIOME.VOLCANIC ? hex(0x2a2626) : hex(0x8a7a6a);
    inst.colors = [rockC, grass];
    emit(buf, proto, inst);
    // trees on top
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
      } else if (biome === BIOME.ALPINE) {
        tree(buf, L, PROP.PINE, tx, y + radius * 0.1, tz, 0.8 + rng() * 0.6, [PAL.trunkDark, pick(PAL.leafPine, rt)], rng());
      } else {
        tree(buf, L, PROP.ROUND_TREE, tx, y + radius * 0.1, tz, 0.7 + rng() * 0.6, [PAL.trunk, pick(PAL.leafMeadow, rt)], rng());
      }
    }
    // hanging crystals underneath (mystic)
    if (biome === BIOME.MYSTIC || biome === BIOME.ALPINE) {
      for (let c = 0; c < 3; c++) {
        const a = rng() * Math.PI * 2;
        const rr = rng() * radius * 0.4;
        const ci = instBase(lx + Math.cos(a) * rr, y - radius * 0.5, lz + Math.sin(a) * rr, rng());
        ci.s = 0.7 + rng() * 0.6;
        ci.sy = -ci.s;
        const col = biome === BIOME.MYSTIC ? pick(PAL.crystalMystic, rng()) : pick(PAL.crystalIce, rng());
        ci.colors = [hex(0x4a4258), col, col, col];
        ci.emis = [0, 0, 1, 0];
        ci.flags = [0, 0, F_PULSE, 0];
        emit(buf, pick(L[PROP.CRYSTAL], rng()), ci);
      }
    }
  }

  // hot-air balloon
  const pBalloon =
    biome === BIOME.MEADOW || biome === BIOME.AUTUMN ? 0.13 : biome === BIOME.COAST || biome === BIOME.MESA ? 0.08 : biome === BIOME.ALPINE ? 0.04 : 0.0;
  if (r5 < pBalloon) {
    const bx = 20 + r6 * (CHUNK_SIZE - 40);
    const bz = 20 + r7 * (CHUNK_SIZE - 40);
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
  }

  // lighthouse on a coastal headland
  if (biome === BIOME.COAST && r8 < 0.12) {
    // search a few spots for land just above the sea
    for (let tries = 0; tries < 6; tries++) {
      const tx = 20 + rng() * (CHUNK_SIZE - 40);
      const tz = 20 + rng() * (CHUNK_SIZE - 40);
      surface(ctx, tx, tz, SURF);
      if (SURF.h > 2 && SURF.h < 14 && SURF.ny > 0.9) {
        const inst = instBase(tx, SURF.h - 0.4, tz, rng());
        inst.s = 1 + rng() * 0.3;
        inst.colors = [hex(0xf4f0e8), hex(0xd8402e), hex(0xfff0b0), hex(0x3a3a40)];
        inst.emis = [0, 0, 1.4, 0];
        inst.flags = [0, 0, F_PULSE, 0];
        emit(buf, L[PROP.LIGHTHOUSE][0], inst);
        break;
      }
    }
  }
}

// ----------------------------------------------------- landmarks along the flight path

const FRAME = {};
function placeLandmarks(ctx, buf) {
  const { world, x0, z0 } = ctx;
  // chunk covers z in [z0, z0 + CHUNK), i.e. s in (-(z0 + CHUNK), -z0]
  const sMin = -(z0 + CHUNK_SIZE);
  const sMax = -z0;
  const k0 = Math.floor(sMin / LANDMARK_SPACING) - 1;
  const k1 = Math.floor(sMax / LANDMARK_SPACING) + 1;
  for (let k = k0; k <= k1; k++) {
    const r = mulberry32(hashInt(k, world.seed, 0x1a2d));
    const sk = (k + 0.5 + (r() - 0.5) * 0.4) * LANDMARK_SPACING;
    if (sk < 600) continue; // keep the opening clear
    if (sk <= sMin || sk > sMax) continue;
    const F = world.pathFrame(sk, FRAME);
    if (F.x < x0 || F.x >= x0 + CHUNK_SIZE) continue;
    buildLandmark(ctx, buf, k, sk, F, r);
  }
}

function buildLandmark(ctx, buf, k, sk, F, r) {
  const { world, x0, z0 } = ctx;
  const L = lib();
  const B = world.biomeAt(F.x, F.z, BIO);
  const biome = B.t > 0.5 ? B.b : B.a;
  const roll = r();
  const S2 = world.sample(F.x, F.z, {});
  const vw = S2.vw;
  const floor = Math.max(WATER_LEVEL, S2.h);
  const yaw = Math.atan2(F.rz, F.rx); // align local +X with the path's right vector
  const lx = F.x - x0;
  const lz = F.z - z0;

  const archTypes = {
    [BIOME.MEADOW]: { p: 0.45, col: [hex(0xa8a294), hex(0x8c9a7a), hex(0x9ad8a0)], glow: 0 },
    [BIOME.ALPINE]: { p: 0.45, col: [hex(0x7c8494), hex(0x9aa2b0), hex(0x9ff0ff)], glow: 0 },
    [BIOME.MESA]: { p: 0.75, col: [hex(0xc4673a), hex(0xe2a46e), hex(0xffc070)], glow: 0 },
    [BIOME.MYSTIC]: { p: 0.0, col: [hex(0x4a4066), hex(0x5c5080), hex(0x6ff6ff)], glow: 0 },
    [BIOME.AUTUMN]: { p: 0.45, col: [hex(0x8c8478), hex(0x7f8c62), hex(0xffd27a)], glow: 0 },
    [BIOME.COAST]: { p: 0.5, col: [hex(0xe0d8c8), hex(0xc8bea8), hex(0xffffff)], glow: 0 },
    [BIOME.VOLCANIC]: { p: 0.6, col: [hex(0x1d1a1f), hex(0x2a2430), hex(0xff6a1e)], glow: 5 },
  };
  const A = archTypes[biome];

  if (biome === BIOME.MYSTIC) {
    if (roll < 0.75) {
      // floating ring gate the player can fly through
      const radius = 26 + r() * 12;
      const proto = ringGateProto(radius, 5 + r() * 2, r);
      // centred on the cruising altitude so the glider (and chase camera) fly through the middle
      const inst = instBase(lx, world.groundAlongPath(sk) + 26, lz, 0);
      inst.ry = yaw;
      inst.s = 1;
      inst.colors = [hex(0x4a4066), hex(0x5c5080), hex(0x8ff8ff), hex(0x4a4066)];
      inst.emis = [0, 0, 1.3, 0];
      inst.flags = [0, 0, F_PULSE, 0];
      emit(buf, proto, inst);
    } else {
      crystalCluster(ctx, buf, L, F, vw, floor, r, PAL.crystalMystic);
    }
    return;
  }

  if (roll < A.p) {
    // arch spanning the valley
    const span = clamp(2 * vw + 60, 110, 300);
    const half = span / 2;
    // ground under each leg
    const lxL = F.x - F.rx * half;
    const lzL = F.z - F.rz * half;
    const lxR = F.x + F.rx * half;
    const lzR = F.z + F.rz * half;
    const gL = world.heightAt(lxL, lzL);
    const gR = world.heightAt(lxR, lzR);
    const base = Math.max(floor, Math.min(gL, gR) + 4);
    const legDown = base - Math.min(gL, gR, WATER_LEVEL - 2) + 4;
    const rise = clamp(span * 0.42, 55, 110) + r() * 15;
    const width = 9 + r() * 6;
    const depth = 10 + r() * 8;
    const proto = archProto(span, rise, legDown, width, depth, r, A.glow);
    const inst = instBase(lx, base, lz, 0);
    inst.ry = yaw;
    inst.s = 1;
    inst.colors = [A.col[0], A.col[1], A.col[2]];
    inst.emis = [0, 0, A.glow ? 1 : 0];
    inst.flags = [0, 0, A.glow ? F_PULSE : 0];
    emit(buf, proto, inst);
    return;
  }

  if (roll < A.p + 0.3) {
    if (biome === BIOME.MEADOW || biome === BIOME.AUTUMN || biome === BIOME.COAST) {
      ruins(ctx, buf, L, F, vw, r, biome);
    } else if (biome === BIOME.ALPINE) {
      crystalCluster(ctx, buf, L, F, vw, floor, r, PAL.crystalIce);
    } else if (biome === BIOME.VOLCANIC) {
      for (let i = 0; i < 5; i++) {
        const side = i % 2 ? 1 : -1;
        const off = side * (vw * 0.7 + r() * 40);
        const along = (r() - 0.5) * 120;
        const px = F.x + F.rx * off + F.tx * along;
        const pz = F.z + F.rz * off + F.tz * along;
        const h = world.heightAt(px, pz);
        spireProp(buf, L, px - x0, Math.max(h, WATER_LEVEL), pz - z0, 1.4 + r() * 1.2, r());
      }
    } else if (biome === BIOME.MESA) {
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        const off = side * (vw * 0.8 + r() * 30);
        const along = (r() - 0.5) * 140;
        const px = F.x + F.rx * off + F.tx * along;
        const pz = F.z + F.rz * off + F.tz * along;
        const h = world.heightAt(px, pz);
        hoodooProp(buf, L, px - x0, h, pz - z0, 1.4 + r() * 1.0, r());
      }
    }
  }
}

function crystalCluster(ctx, buf, L, F, vw, floor, r, pal) {
  const { world, x0, z0 } = ctx;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const off = side * (vw * 0.65 + r() * 30);
    const along = (r() - 0.5) * 120;
    const px = F.x + F.rx * off + F.tx * along;
    const pz = F.z + F.rz * off + F.tz * along;
    const h = world.heightAt(px, pz);
    crystalProp(buf, L, px - x0, Math.max(h, floor - 1), pz - z0, 2.5 + r() * 2.5, pal, r(), 1.1);
  }
}

function ruins(ctx, buf, L, F, vw, r, biome) {
  const { world, x0, z0 } = ctx;
  const pal = biome === BIOME.COAST ? PAL.stone : PAL.mossStone;
  const count = 8 + Math.floor(r() * 6);
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const off = side * (vw * 0.55 + 6 + r() * 14);
    const along = (Math.floor(i / 2) - count / 4) * 22 + (r() - 0.5) * 4;
    const px = F.x + F.rx * off + F.tx * along;
    const pz = F.z + F.rz * off + F.tz * along;
    const h = world.heightAt(px, pz);
    if (h < WATER_LEVEL - 1) continue;
    const broken = r() < 0.4;
    const inst = instBase(px - x0, Math.max(h, WATER_LEVEL) - 0.6, pz - z0, r());
    inst.s = 1.4 + r() * 0.4;
    const c = vary(pick(pal, r()), r(), 0.08);
    inst.colors = [c, vary(c, r(), 0.06)];
    emit(buf, L[broken ? PROP.PILLAR_BROKEN : PROP.PILLAR][Math.floor(r() * 2)], inst);
  }
}
