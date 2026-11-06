// Collision helpers: capsule tests, terrain contact and what the ground is made of.

import { BIOME, LIQUID } from '../world/biomes.js';
import { MAT } from '../world/matter.js';

/** Closest point on segment ab to point p; returns parameter t in [0,1]. */
export function closestOnSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const l2 = abx * abx + aby * aby + abz * abz;
  if (l2 < 1e-9) return 0;
  const t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Squared distance between segments p0p1 and q0q1 (approximate, sampled; good enough for avoidance). */
export function segSegDist2(p0, p1, q0x, q0y, q0z, q1x, q1y, q1z) {
  let best = Infinity;
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    const x = p0.x + (p1.x - p0.x) * s;
    const y = p0.y + (p1.y - p0.y) * s;
    const z = p0.z + (p1.z - p0.z) * s;
    const t = closestOnSegment(x, y, z, q0x, q0y, q0z, q1x, q1y, q1z);
    const cx = q0x + (q1x - q0x) * t;
    const cy = q0y + (q1y - q0y) * t;
    const cz = q0z + (q1z - q0z) * t;
    const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
    if (d < best) best = d;
  }
  return best;
}

export function liquidMaterial(type) {
  switch (type) {
    case LIQUID.LAVA:
      return MAT.LAVA;
    case LIQUID.MERCURY:
      return MAT.MERCURY;
    case LIQUID.MIRROR:
      return MAT.MIRROR;
    default:
      return MAT.WATER;
  }
}

/** What the ground is made of at a point, from its biome, height and slope. */
export function terrainMaterial(biome, h, slope, bl) {
  if (bl > 0.5) return MAT.OBSIDIAN;
  switch (biome) {
    case BIOME.ALPINE:
      return h > 100 ? MAT.SNOW : slope > 0.3 ? MAT.STONE : MAT.GROUND;
    case BIOME.MESA:
      return slope > 0.22 ? MAT.STONE : MAT.SAND;
    case BIOME.COAST:
      return h < 6 ? MAT.SAND : slope > 0.3 ? MAT.STONE : MAT.GROUND;
    case BIOME.VOLCANIC:
      return slope > 0.3 ? MAT.OBSIDIAN : MAT.ASH;
    case BIOME.PRISM:
      return MAT.CRYSTAL;
    case BIOME.GOTHIC:
      return slope > 0.3 ? MAT.STONE : MAT.GROUND;
    default:
      return slope > 0.35 ? MAT.STONE : MAT.GROUND;
  }
}
