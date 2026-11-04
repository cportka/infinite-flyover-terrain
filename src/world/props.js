// Low-poly prop geometry, generated procedurally (no assets).
// Prototypes are triangle soups with a per-vertex "part" index so each instance
// can be coloured per part (trunk / foliage / accent / glow) when baked into a chunk.
// Rendering uses derivative (flat) normals, so winding order never matters.

import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------ indexed geometry helpers

function geo() {
  return { v: [], f: [] };
}

export function cylinder(rb, rt, h, n, y0 = 0, capTop = true, capBottom = false, phase = 0) {
  const g = geo();
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    g.v.push(Math.cos(a) * rb, y0, Math.sin(a) * rb);
  }
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    g.v.push(Math.cos(a) * rt, y0 + h, Math.sin(a) * rt);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.f.push(i, j, n + j, i, n + j, n + i);
  }
  if (capTop && rt > 0) {
    const c = g.v.length / 3;
    g.v.push(0, y0 + h, 0);
    for (let i = 0; i < n; i++) g.f.push(n + i, n + ((i + 1) % n), c);
  }
  if (capBottom && rb > 0) {
    const c = g.v.length / 3;
    g.v.push(0, y0, 0);
    for (let i = 0; i < n; i++) g.f.push(i, (i + 1) % n, c);
  }
  return g;
}

export function cone(r, h, n, y0 = 0, capBottom = false, phase = 0) {
  const g = geo();
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    g.v.push(Math.cos(a) * r, y0, Math.sin(a) * r);
  }
  const apex = n;
  g.v.push(0, y0 + h, 0);
  for (let i = 0; i < n; i++) g.f.push(i, (i + 1) % n, apex);
  if (capBottom) {
    const c = g.v.length / 3;
    g.v.push(0, y0, 0);
    for (let i = 0; i < n; i++) g.f.push(i, (i + 1) % n, c);
  }
  return g;
}

export function box(w, h, d) {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const g = geo();
  g.v.push(-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z);
  g.f.push(0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2);
  return g;
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, 0,
  0, -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T,
  ICO_T, 0, -1, ICO_T, 0, 1, -ICO_T, 0, -1, -ICO_T, 0, 1,
];
const ICO_F = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

/** Icosphere (detail 0 or 1) with optional radial jitter. */
export function ico(r, detail = 0, jitter = 0, rnd = Math.random) {
  let v = ICO_V.slice();
  let f = ICO_F.slice();
  if (detail > 0) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 1000 + b : b * 1000 + a;
      let m = cache.get(key);
      if (m === undefined) {
        m = v.length / 3;
        v.push((v[a * 3] + v[b * 3]) / 2, (v[a * 3 + 1] + v[b * 3 + 1]) / 2, (v[a * 3 + 2] + v[b * 3 + 2]) / 2);
        cache.set(key, m);
      }
      return m;
    };
    const nf = [];
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i];
      const b = f[i + 1];
      const c = f[i + 2];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    f = nf;
  }
  for (let i = 0; i < v.length; i += 3) {
    const l = Math.hypot(v[i], v[i + 1], v[i + 2]);
    const k = (r * (1 + jitter * (rnd() * 2 - 1))) / l;
    v[i] *= k;
    v[i + 1] *= k;
    v[i + 2] *= k;
  }
  return { v, f };
}

/** In-place transform: scale, rotate X, Y, Z, then translate. */
export function xf(g, o) {
  const sx = o.sx ?? o.s ?? 1;
  const sy = o.sy ?? o.s ?? 1;
  const sz = o.sz ?? o.s ?? 1;
  const rx = o.rx || 0;
  const ry = o.ry || 0;
  const rz = o.rz || 0;
  const tx = o.tx || 0;
  const ty = o.ty || 0;
  const tz = o.tz || 0;
  const cx = Math.cos(rx);
  const snx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sny = Math.sin(ry);
  const cz = Math.cos(rz);
  const snz = Math.sin(rz);
  const v = g.v;
  for (let i = 0; i < v.length; i += 3) {
    let x = v[i] * sx;
    let y = v[i + 1] * sy;
    let z = v[i + 2] * sz;
    let t = y * cx - z * snx;
    z = y * snx + z * cx;
    y = t;
    t = x * cy + z * sny;
    z = -x * sny + z * cy;
    x = t;
    t = x * cz - y * snz;
    y = x * snz + y * cz;
    x = t;
    v[i] = x + tx;
    v[i + 1] = y + ty;
    v[i + 2] = z + tz;
  }
  return g;
}

/** Tube with rectangular cross-section along a polyline of centre points. */
function tube(points, normals, width, depth, closed, rnd, jitter, partOf) {
  // points/normals: arrays of [x, y] in the arch plane (z is the depth axis)
  const g = geo();
  const parts = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i];
    const [nx, ny] = normals[i];
    const hw = width / 2;
    const hd = depth / 2;
    const j = () => (rnd() * 2 - 1) * jitter;
    // 4 corners: outer-front, outer-back, inner-back, inner-front
    g.v.push(px + nx * hw + j(), py + ny * hw + j(), hd + j());
    g.v.push(px + nx * hw + j(), py + ny * hw + j(), -hd + j());
    g.v.push(px - nx * hw + j(), py - ny * hw + j(), -hd + j());
    g.v.push(px - nx * hw + j(), py - ny * hw + j(), hd + j());
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 4;
    const b = ((i + 1) % n) * 4;
    const p = partOf(i);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      g.f.push(a + k, a + k2, b + k2, a + k, b + k2, b + k);
      parts.push(p, p);
    }
  }
  return { g, parts };
}

// ------------------------------------------------------------ prototype container

export class Proto {
  constructor() {
    this.pos = [];
    this.part = [];
  }

  add(g, part) {
    const { v, f } = g;
    for (let i = 0; i < f.length; i++) {
      const k = f[i] * 3;
      this.pos.push(v[k], v[k + 1], v[k + 2]);
      this.part.push(part);
    }
    return this;
  }

  /** Add with a per-triangle part array. */
  addParts(g, triParts) {
    const { v, f } = g;
    for (let i = 0; i < f.length; i++) {
      const k = f[i] * 3;
      this.pos.push(v[k], v[k + 1], v[k + 2]);
      this.part.push(triParts[(i / 3) | 0]);
    }
    return this;
  }

  /**
   * @param {object} o
   *   sway:  { [part]: amplitude in metres at the top }
   *   bend:  trunk-style bending amplitude for every other part
   *   aoParts: parts that get vertical ambient-occlusion darkening
   */
  finalize(o = {}) {
    const count = this.pos.length / 3;
    const pos = new Float32Array(this.pos);
    const part = new Uint8Array(this.part);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    const pMin = {};
    const pMax = {};
    for (let i = 0; i < count; i++) {
      const y = pos[i * 3 + 1];
      const p = part[i];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 2]));
      pMin[p] = Math.min(pMin[p] ?? Infinity, y);
      pMax[p] = Math.max(pMax[p] ?? -Infinity, y);
    }
    const height = Math.max(0.001, maxY);
    const sway = new Float32Array(count);
    const ao = new Float32Array(count);
    const swayParts = o.sway || {};
    const aoParts = o.aoParts || [1];
    const bend = o.bend || 0;
    for (let i = 0; i < count; i++) {
      const y = pos[i * 3 + 1];
      const p = part[i];
      const hn = Math.max(0, y / height);
      if (swayParts[p] !== undefined) sway[i] = swayParts[p] * Math.pow(hn, 1.5);
      else sway[i] = bend * hn * hn;
      if (aoParts.includes(p)) {
        const r = (y - pMin[p]) / Math.max(0.001, pMax[p] - pMin[p]);
        ao[i] = 0.62 + 0.38 * r;
      } else {
        ao[i] = 0.8 + 0.2 * Math.min(1, hn * 1.5);
      }
    }
    return { pos, part, sway, ao, count, height, radius: maxR, minY };
  }
}

// ------------------------------------------------------------ prototypes

function roundTree(rnd) {
  const P = new Proto();
  const th = 2.4 + rnd() * 1.0;
  P.add(cylinder(0.34, 0.22, th + 0.8, 5, 0, false, false, rnd() * TAU), 0);
  P.add(xf(ico(2.2 + rnd() * 0.4, 0, 0.16, rnd), { sy: 0.85 + rnd() * 0.25, ty: th + 1.7, ry: rnd() * TAU }), 1);
  const blobs = Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * TAU;
    P.add(xf(ico(1.25 + rnd() * 0.5, 0, 0.2, rnd), { tx: Math.cos(a) * 1.55, ty: th + 0.9 + rnd() * 1.6, tz: Math.sin(a) * 1.55 }), 1);
  }
  return P.finalize({ sway: { 1: 0.35 }, bend: 0.12 });
}

function pine(rnd) {
  const P = new Proto();
  const n = 6;
  P.add(cylinder(0.3, 0.18, 2.2, 5, 0, false), 0);
  const tiers = 3 + (rnd() < 0.4 ? 1 : 0);
  let y = 1.2;
  let r = 2.5 + rnd() * 0.3;
  for (let i = 0; i < tiers; i++) {
    const h = r * 1.35;
    P.add(cone(r, h, n, y, false, rnd() * TAU), 1);
    y += h * 0.52;
    r *= 0.74;
  }
  return P.finalize({ sway: { 1: 0.3 }, bend: 0.12 });
}

function birch(rnd) {
  const P = new Proto();
  const th = 5 + rnd() * 1.5;
  P.add(cylinder(0.2, 0.13, th + 0.6, 5, 0, false), 0);
  P.add(xf(ico(1.5, 0, 0.18, rnd), { sy: 1.5, ty: th + 0.6 }), 1);
  P.add(xf(ico(1.1, 0, 0.2, rnd), { sy: 1.3, tx: 0.7, ty: th - 0.9, tz: -0.4 }), 1);
  return P.finalize({ sway: { 1: 0.4 }, bend: 0.18 });
}

function palm(rnd) {
  const P = new Proto();
  const segs = 6;
  const h = 7 + rnd() * 2;
  const lean = 0.25 + rnd() * 0.25;
  let px = 0;
  let py = 0;
  let topX = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = lean * h * t0 * t0;
    const x1 = lean * h * t1 * t1;
    const seg = cylinder(0.3 - 0.13 * t0, 0.3 - 0.13 * t1, h / segs, 5, 0, false);
    // shear the segment so it follows the curve
    for (let k = 0; k < seg.v.length; k += 3) {
      const ly = seg.v[k + 1] / (h / segs);
      seg.v[k] += x0 + (x1 - x0) * ly;
      seg.v[k + 1] += t0 * h;
    }
    P.add(seg, 0);
    px = x1;
    py = t1 * h;
    topX = px;
  }
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rnd() * 0.4;
    const len = 3.6 + rnd() * 1.2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.55;
    // frond: a bent leaf made of two triangles (base -> mid -> tip) drooping down
    const mx = topX + ca * len * 0.55;
    const mz = sa * len * 0.55;
    const my = py + 0.6;
    const tx = topX + ca * len;
    const tz = sa * len;
    const ty = py - 1.4 - rnd() * 0.6;
    const g = geo();
    g.v.push(topX, py, 0, mx - sa * w, my, mz + ca * w, mx + sa * w, my, mz - ca * w, tx, ty, tz);
    g.f.push(0, 1, 2, 1, 3, 2);
    P.add(g, 1);
  }
  const nut = xf(ico(0.35, 0, 0.1, rnd), { tx: topX, ty: py - 0.3 });
  P.add(nut, 0);
  return P.finalize({ sway: { 1: 0.45 }, bend: 0.15 });
}

function cactus(rnd) {
  const P = new Proto();
  const h = 3.2 + rnd() * 2.2;
  P.add(cylinder(0.45, 0.4, h, 7, 0, false), 0);
  P.add(cone(0.4, 0.35, 7, h), 0);
  const arms = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? 1 : -1;
    const ay = h * (0.35 + rnd() * 0.25);
    const ah = 1.2 + rnd() * 1.2;
    P.add(xf(cylinder(0.26, 0.26, 0.9, 6, 0, false), { rz: side * -Math.PI / 2, tx: side * 0.1, ty: ay }), 0);
    P.add(xf(cylinder(0.26, 0.24, ah, 6, ay - 0.05, true), { tx: side * 0.95 }), 0);
  }
  if (rnd() < 0.5) P.add(xf(ico(0.25, 0, 0.1, rnd), { ty: h + 0.3 }), 1);
  return P.finalize({ bend: 0.02 });
}

function bush(rnd) {
  const P = new Proto();
  P.add(xf(ico(1.1, 0, 0.2, rnd), { sy: 0.75, ty: 0.65 }), 1);
  if (rnd() < 0.6) P.add(xf(ico(0.8, 0, 0.2, rnd), { sy: 0.8, tx: 0.8, ty: 0.5, tz: 0.3 }), 1);
  return P.finalize({ sway: { 1: 0.12 } });
}

function rock(rnd) {
  const P = new Proto();
  P.add(xf(ico(1, 0, 0.3, rnd), { sx: 1.3 + rnd() * 0.4, sy: 0.75 + rnd() * 0.3, sz: 1.0 + rnd() * 0.3, ty: 0.2, ry: rnd() * TAU }), 0);
  return P.finalize({ aoParts: [0] });
}

function crystal(rnd) {
  const P = new Proto();
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const h = (i === 0 ? 4.5 : 1.8 + rnd() * 2.5) * (0.8 + rnd() * 0.4);
    const r = h * 0.16;
    const g = cylinder(r, r * 0.9, h * 0.75, 6, 0, false, false);
    const tip = cone(r * 0.9, h * 0.35, 6, h * 0.75);
    const tilt = i === 0 ? rnd() * 0.15 : 0.35 + rnd() * 0.45;
    const a = rnd() * TAU;
    const o = { rx: Math.cos(a) * tilt, rz: Math.sin(a) * tilt, ry: rnd() * TAU, tx: i === 0 ? 0 : Math.cos(a) * 0.6, tz: i === 0 ? 0 : Math.sin(a) * 0.6 };
    P.add(xf(g, o), 2);
    P.add(xf(tip, o), 2);
  }
  P.add(xf(ico(0.9, 0, 0.3, rnd), { sy: 0.5, ty: 0.1 }), 0);
  return P.finalize({ aoParts: [] });
}

function mushroom(rnd) {
  const P = new Proto();
  const h = 5 + rnd() * 3;
  const r = 2.6 + rnd() * 1.4;
  const bend = (rnd() - 0.5) * 0.8;
  const stem = cylinder(0.55, 0.42, h, 6, 0, false);
  for (let k = 0; k < stem.v.length; k += 3) {
    const t = stem.v[k + 1] / h;
    stem.v[k] += bend * t * t * 2;
  }
  P.add(stem, 0);
  const capX = bend * 2;
  // cap: flattened upper hemisphere + glowing gills underneath
  const cap = ico(r, 1, 0.05, rnd);
  const cv = cap.v;
  for (let k = 0; k < cv.length; k += 3) {
    cv[k + 1] = Math.max(cv[k + 1], -r * 0.05) * 0.55;
  }
  xf(cap, { tx: capX, ty: h - 0.2 });
  P.add(cap, 1);
  const gills = cone(r * 0.92, -0.6, 10, h - 0.15);
  xf(gills, { tx: capX });
  P.add(gills, 2);
  // a few glowing spots on the cap
  const spots = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < spots; i++) {
    const a = rnd() * TAU;
    const rr = r * (0.25 + rnd() * 0.5);
    const sy = Math.sqrt(Math.max(0, 1 - (rr / r) ** 2)) * r * 0.55;
    P.add(cone(0.32 + rnd() * 0.2, 0.18, 5, h - 0.25 + sy, false, rnd() * TAU), 2);
    // cone() is centred on the axis; move it onto the cap
    const n = 5 * 3;
    for (let k = P.pos.length - n * 3; k < P.pos.length; k += 3) {
      P.pos[k] += capX + Math.cos(a) * rr;
      P.pos[k + 2] += Math.sin(a) * rr;
    }
  }
  return P.finalize({ bend: 0.15, aoParts: [1] });
}

function grassTuft(rnd) {
  const P = new Proto();
  const n = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd() * 0.8;
    const h = 0.55 + rnd() * 0.65;
    const w = 0.09 + rnd() * 0.05;
    const lean = 0.2 + rnd() * 0.35;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const g = geo();
    g.v.push(-sa * w, 0, ca * w, sa * w, 0, -ca * w, ca * lean, h, sa * lean);
    g.f.push(0, 1, 2);
    P.add(g, 1);
  }
  return P.finalize({ sway: { 1: 0.22 }, aoParts: [] });
}

function flower(rnd) {
  const P = new Proto();
  const h = 0.55 + rnd() * 0.4;
  const g = geo();
  g.v.push(-0.04, 0, 0, 0.04, 0, 0, 0, h, 0);
  g.f.push(0, 1, 2);
  P.add(g, 1);
  const hr = 0.17 + rnd() * 0.06;
  P.add(cone(hr, 0.12, 5, h, false, rnd() * TAU), 2);
  P.add(cone(hr, -0.08, 5, h, false, rnd() * TAU), 2);
  return P.finalize({ sway: { 1: 0.15, 2: 0.15 }, aoParts: [] });
}

function deadTree(rnd) {
  const P = new Proto();
  const h = 4 + rnd() * 2.5;
  P.add(cylinder(0.3, 0.12, h, 5, 0, true), 0);
  const branches = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < branches; i++) {
    const a = rnd() * TAU;
    const y = h * (0.45 + rnd() * 0.4);
    const len = 1.2 + rnd() * 1.5;
    const tilt = 0.7 + rnd() * 0.5;
    P.add(xf(cylinder(0.1, 0.04, len, 4, 0, true), { rz: -tilt, ry: a, ty: y }), 0);
  }
  return P.finalize({ bend: 0.05, aoParts: [] });
}

function hoodoo(rnd) {
  const P = new Proto();
  let y = 0;
  const stacks = 3 + Math.floor(rnd() * 3);
  let r = 2.6 + rnd() * 1.2;
  for (let i = 0; i < stacks; i++) {
    const h = 3 + rnd() * 3.5;
    const r2 = r * (0.65 + rnd() * 0.3);
    P.add(cylinder(r, r2, h, 7, y, false, false, rnd() * TAU), i % 2);
    P.add(cylinder(r2, r * 0.95, h * 0.35, 7, y + h, false, false, rnd() * TAU), i % 2);
    y += h * 1.35;
    r = r2 * (0.95 + rnd() * 0.15);
  }
  // cap rock
  P.add(xf(ico(r * 1.5, 0, 0.25, rnd), { sy: 0.45, ty: y + 0.4 }), 1);
  return P.finalize({ aoParts: [0, 1] });
}

function spire(rnd) {
  const P = new Proto();
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const h = (i === 0 ? 16 : 6 + rnd() * 8) * (0.8 + rnd() * 0.4);
    const r = 1.4 + rnd() * 1.2;
    const a = rnd() * TAU;
    const off = i === 0 ? 0 : 1.5 + rnd();
    const o = { rx: (rnd() - 0.5) * 0.25, rz: (rnd() - 0.5) * 0.25, tx: Math.cos(a) * off, tz: Math.sin(a) * off };
    P.add(xf(cone(r, h, 5, 0, false, rnd() * TAU), o), 0);
    // glowing vein near the base
    P.add(xf(cylinder(r * 1.02, r * 0.82, h * 0.18, 5, h * 0.1, false, false, rnd()), o), 2);
  }
  return P.finalize({ aoParts: [0] });
}

function cottage(rnd) {
  const P = new Proto();
  const w = 4.5 + rnd() * 2;
  const d = 3.5 + rnd() * 1.2;
  const h = 2.6 + rnd() * 0.8;
  P.add(xf(box(w, h, d), { ty: h / 2 }), 0);
  // roof prism
  const rh = 1.8 + rnd() * 0.6;
  const ov = 0.35;
  const g = geo();
  const x = w / 2 + ov;
  const z = d / 2 + ov;
  g.v.push(-x, h, -z, x, h, -z, x, h, z, -x, h, z, -x, h + rh, 0, x, h + rh, 0);
  g.f.push(0, 1, 5, 0, 5, 4, 3, 4, 5, 3, 5, 2, 0, 4, 3, 1, 2, 5);
  P.add(g, 1);
  // chimney
  P.add(xf(box(0.6, 1.6, 0.6), { tx: w * 0.25, ty: h + rh * 0.7, tz: -d * 0.2 }), 3);
  // glowing windows on both long sides + door
  const wins = 2;
  for (let i = 0; i < wins; i++) {
    const wx = (i / (wins - 1) - 0.5) * w * 0.55;
    P.add(xf(box(0.7, 0.7, 0.08), { tx: wx, ty: h * 0.55, tz: d / 2 + 0.03 }), 2);
    P.add(xf(box(0.7, 0.7, 0.08), { tx: wx, ty: h * 0.55, tz: -d / 2 - 0.03 }), 2);
  }
  P.add(xf(box(0.08, 1.4, 0.8), { tx: w / 2 + 0.03, ty: 0.7 }), 2);
  return P.finalize({ aoParts: [] });
}

function pillar(rnd, broken) {
  const P = new Proto();
  const h = broken ? 3 + rnd() * 4 : 9 + rnd() * 3;
  P.add(xf(box(2.2, 0.8, 2.2), { ty: 0.4 }), 0);
  const col = cylinder(0.75, 0.68, h, 8, 0.8, !broken);
  if (broken) {
    // slanted break
    for (let k = 0; k < col.v.length; k += 3) {
      if (col.v[k + 1] > 1) col.v[k + 1] += col.v[k] * 0.5;
    }
  }
  P.add(col, 1);
  if (!broken) P.add(xf(box(2.0, 0.7, 2.0), { ty: h + 0.8 + 0.35 }), 0);
  return P.finalize({ aoParts: [] });
}

function glowFlower(rnd) {
  const P = new Proto();
  const h = 1.2 + rnd() * 1.4;
  P.add(cylinder(0.06, 0.04, h, 4, 0, false), 1);
  P.add(xf(ico(0.32 + rnd() * 0.15, 0, 0.15, rnd), { sy: 1.2, ty: h + 0.2 }), 2);
  const g = geo();
  g.v.push(0, h * 0.4, 0, 0.6, h * 0.55, 0.1, 0.3, h * 0.45, 0.35);
  g.f.push(0, 1, 2);
  P.add(g, 1);
  return P.finalize({ sway: { 1: 0.25, 2: 0.25 }, aoParts: [] });
}

function lavaRock(rnd) {
  const P = new Proto();
  const g = xf(ico(1, 0, 0.3, rnd), { sx: 1.4, sy: 0.8, sz: 1.1, ty: 0.25, ry: rnd() * TAU });
  const tri = [];
  for (let i = 0; i < g.f.length / 3; i++) tri.push(rnd() < 0.25 ? 2 : 0);
  P.addParts(g, tri);
  return P.finalize({ aoParts: [0] });
}

function log(rnd) {
  const P = new Proto();
  const len = 4 + rnd() * 3;
  P.add(xf(cylinder(0.38, 0.32, len, 6, -len / 2, true, true), { rz: Math.PI / 2, ty: 0.3 }), 0);
  return P.finalize({ aoParts: [] });
}

function boat(rnd) {
  const P = new Proto();
  const L = 5 + rnd() * 2;
  const W = 1.8;
  const g = geo();
  // hull: deck rectangle with pointed bow, keel line below
  g.v.push(
    -L / 2, 0.7, -W / 2, L * 0.25, 0.7, -W / 2, L / 2, 0.8, 0, L * 0.25, 0.7, W / 2, -L / 2, 0.7, W / 2,
    -L / 2 + 0.3, -0.3, 0, L * 0.35, -0.3, 0,
  );
  g.f.push(0, 1, 6, 0, 6, 5, 1, 2, 6, 3, 6, 2, 4, 5, 6, 4, 6, 3, 0, 5, 4, 0, 1, 2, 0, 2, 3, 0, 3, 4);
  P.add(g, 0);
  P.add(xf(box(0.15, 5.5, 0.15), { tx: L * 0.05, ty: 3.4 }), 3);
  const s = geo();
  s.v.push(L * 0.05 + 0.1, 1.2, 0, L * 0.05 + 0.1, 6, 0, -L * 0.42, 1.3, 0);
  s.f.push(0, 1, 2);
  P.add(s, 1);
  return P.finalize({ aoParts: [] });
}

function lighthouse(rnd) {
  const P = new Proto();
  const bands = 5;
  let y = 0;
  let r = 2.4;
  const bh = 3.2;
  for (let i = 0; i < bands; i++) {
    const r2 = r * 0.9;
    P.add(cylinder(r, r2, bh, 10, y, false), i % 2);
    y += bh;
    r = r2;
  }
  P.add(cylinder(r * 1.25, r * 1.25, 0.4, 10, y, true), 3);
  P.add(cylinder(r * 0.8, r * 0.8, 1.8, 8, y + 0.4, false), 2);
  P.add(cone(r * 1.0, 1.6, 8, y + 2.2, true), 1);
  return P.finalize({ aoParts: [] });
}

function balloon(rnd) {
  const P = new Proto();
  const n = 12;
  // teardrop lathe profile (y, radius) from the throat up to the crown
  const prof = [
    [0, 0.9],
    [1.6, 2.6],
    [3.4, 4.6],
    [5.4, 5.6],
    [7.4, 5.5],
    [9.0, 4.4],
    [10.1, 2.6],
    [10.6, 0.0],
  ];
  const g = geo();
  const tri = [];
  for (let k = 0; k < prof.length; k++) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.v.push(Math.cos(a) * prof[k][1], prof[k][0], Math.sin(a) * prof[k][1]);
    }
  }
  for (let k = 0; k < prof.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = k * n + i;
      const b = k * n + j;
      const c = (k + 1) * n + j;
      const d = (k + 1) * n + i;
      g.f.push(a, b, c, a, c, d);
      tri.push(i % 2, i % 2);
    }
  }
  xf(g, { ty: 3.2 });
  P.addParts(g, tri);
  P.add(xf(box(1.3, 1.0, 1.3), { ty: 0.5 }), 3);
  P.add(xf(cone(0.35, 0.9, 5, 0, false), { ty: 1.4 }), 2);
  return P.finalize({ aoParts: [] });
}

function stoneSlab(rnd) {
  // standing stone / monolith
  const P = new Proto();
  const h = 5 + rnd() * 5;
  const g = xf(box(1.8 + rnd(), h, 0.9 + rnd() * 0.5), { ty: h / 2 - 0.4, rx: (rnd() - 0.5) * 0.12, rz: (rnd() - 0.5) * 0.12 });
  P.add(g, 0);
  return P.finalize({ aoParts: [] });
}

// ------------------------------------------------------------ procedural landmarks

/**
 * Natural arch / bridge spanning the valley. Built in local space with the span
 * along X and the arch plane = XY; caller rotates it to face the path.
 */
export function archProto(span, rise, legDown, width, depth, rnd, glowEvery = 0) {
  const P = new Proto();
  const pts = [];
  const nrm = [];
  const half = span / 2;
  const segs = 20;
  pts.push([-half, -legDown]);
  nrm.push([-1, 0]);
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI - (i / segs) * Math.PI;
    const x = Math.cos(a) * half;
    const y = Math.sin(a) * rise;
    // normal of the ellipse
    const nx = Math.cos(a) / half;
    const ny = Math.sin(a) / rise;
    const l = Math.hypot(nx, ny);
    pts.push([x, y]);
    nrm.push([nx / l, ny / l]);
  }
  pts.push([half, -legDown]);
  nrm.push([1, 0]);
  // thicker legs near the ground
  const { g, parts } = tube(pts, nrm, width, depth, false, rnd, Math.min(width, depth) * 0.12, (i) => {
    if (glowEvery > 0 && i % glowEvery === glowEvery - 1) return 2;
    return i % 3 === 0 ? 1 : 0;
  });
  P.addParts(g, parts);
  return P.finalize({ aoParts: [] });
}

/** Floating ring gate (full circle) with glowing runes. */
export function ringGateProto(radius, thickness, rnd) {
  const P = new Proto();
  const pts = [];
  const nrm = [];
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    nrm.push([Math.cos(a), Math.sin(a)]);
  }
  const { g, parts } = tube(pts, nrm, thickness, thickness * 0.8, true, rnd, thickness * 0.08, (i) => (i % 4 === 1 ? 2 : i % 2));
  P.addParts(g, parts);
  // floating shards around the ring
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU;
    const r = radius * (1.25 + rnd() * 0.5);
    P.add(xf(ico(1.2 + rnd() * 1.5, 0, 0.3, rnd), { sy: 1.6, tx: Math.cos(a) * r, ty: Math.sin(a) * r, tz: (rnd() - 0.5) * 6 }), 0);
  }
  return P.finalize({ aoParts: [] });
}

/** Floating island: inverted rocky cone with a grassy top. Trees are added separately. */
export function islandProto(radius, rnd) {
  const P = new Proto();
  const n = 9;
  const rockG = cone(radius, -radius * 1.5, n, 0, false, rnd() * TAU);
  // jitter rim + body
  for (let k = 0; k < rockG.v.length; k += 3) {
    const j = 1 + (rnd() - 0.5) * 0.25;
    rockG.v[k] *= j;
    rockG.v[k + 2] *= j;
    if (rockG.v[k + 1] < -0.1) rockG.v[k + 1] *= 0.85 + rnd() * 0.3;
  }
  P.add(rockG, 0);
  // mid-ring of rock for a chunkier silhouette
  P.add(xf(cone(radius * 0.7, -radius * 0.9, n, -radius * 0.25, false, rnd() * TAU), { tx: radius * 0.15 }), 0);
  const top = ico(radius * 1.02, 1, 0.06, rnd);
  for (let k = 0; k < top.v.length; k += 3) top.v[k + 1] = Math.max(0, top.v[k + 1]) * 0.12;
  P.add(top, 1);
  return P.finalize({ aoParts: [] });
}

// ------------------------------------------------------------ library

export const PROP = {
  ROUND_TREE: 0,
  PINE: 1,
  BIRCH: 2,
  PALM: 3,
  CACTUS: 4,
  BUSH: 5,
  ROCK: 6,
  CRYSTAL: 7,
  MUSHROOM: 8,
  GRASS: 9,
  FLOWER: 10,
  DEAD_TREE: 11,
  HOODOO: 12,
  SPIRE: 13,
  COTTAGE: 14,
  PILLAR: 15,
  PILLAR_BROKEN: 16,
  GLOW_FLOWER: 17,
  LAVA_ROCK: 18,
  LOG: 19,
  BOAT: 20,
  LIGHTHOUSE: 21,
  BALLOON: 22,
  MONOLITH: 23,
};

const MAKERS = [
  [roundTree, 5],
  [pine, 4],
  [birch, 3],
  [palm, 3],
  [cactus, 3],
  [bush, 3],
  [rock, 5],
  [crystal, 3],
  [mushroom, 3],
  [grassTuft, 4],
  [flower, 3],
  [deadTree, 3],
  [hoodoo, 3],
  [spire, 3],
  [cottage, 3],
  [(r) => pillar(r, false), 2],
  [(r) => pillar(r, true), 2],
  [glowFlower, 3],
  [lavaRock, 3],
  [log, 2],
  [boat, 2],
  [lighthouse, 1],
  [balloon, 1],
  [stoneSlab, 3],
];

/** Build every prototype variant from a fixed seed (identical in every worker). */
export function buildPropLibrary() {
  const rnd = mulberry32(0xbadc0de);
  return MAKERS.map(([make, variants]) => {
    const list = [];
    for (let i = 0; i < variants; i++) list.push(make(rnd));
    return list;
  });
}
