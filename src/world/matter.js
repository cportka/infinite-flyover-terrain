// What things are made of: used by collisions (how much they hurt), by the
// explosion that follows (what flies, burns or splashes) and by the eulogy.

export const MAT = {
  GROUND: 0,
  WOOD: 1,
  STONE: 2,
  CRYSTAL: 3,
  FUNGUS: 4,
  BUILDING: 5,
  FABRIC: 6,
  OBSIDIAN: 7,
  WATER: 8,
  LAVA: 9,
  SNOW: 10,
  SAND: 11,
  ICE: 12,
  MERCURY: 13,
  MIRROR: 14,
  ASH: 15,
  NEON: 16,
};

/**
 * hardness: damage multiplier on impact
 * style:    explosion recipe (see game/explosions.js)
 * debris:   sRGB hex colours of flying fragments
 * line:     eulogy shown when the flight ends here
 */
export const MATTER = [
  { key: 'ground', hardness: 1.0, style: 'earth', debris: [0x6b5a3e, 0x4f7d48, 0x8a7a5a], line: 'Returned to the earth' },
  { key: 'wood', hardness: 0.75, style: 'wood', debris: [0x6b4a32, 0x4f8a32, 0x8a5a3a], line: 'Splintered among the trees' },
  { key: 'stone', hardness: 1.1, style: 'stone', debris: [0x8a8680, 0x6e6a62, 0xa49e92], line: 'Broken upon the stone' },
  { key: 'crystal', hardness: 0.95, style: 'crystal', debris: [0xb070ff, 0x6ff0ff, 0xff70e0], line: 'Shattered into a thousand colours' },
  { key: 'fungus', hardness: 0.45, style: 'spores', debris: [0xd94fa5, 0x4fd9d0, 0xe8dccf], line: 'Lost in a cloud of spores' },
  { key: 'building', hardness: 1.0, style: 'fire', debris: [0xf0e6d2, 0xb8452e, 0x8a8078], line: 'Fell among the old houses' },
  { key: 'fabric', hardness: 0.35, style: 'fire', debris: [0xe84a4a, 0xf2c13a, 0x3a8ae8], line: 'Burned with the balloon' },
  { key: 'obsidian', hardness: 1.15, style: 'obsidian', debris: [0x1a1720, 0x2a2430, 0xff6a1e], line: 'Cut upon black glass' },
  { key: 'water', hardness: 0.5, style: 'splash', debris: [0xdff4ff, 0xbfe8ff, 0x8fd0e0], line: 'Swallowed by the water' },
  { key: 'lava', hardness: 1.2, style: 'inferno', debris: [0x2a1410, 0xff6a1a, 0x1d1a1b], line: 'Consumed by fire' },
  { key: 'snow', hardness: 0.7, style: 'snow', debris: [0xf4f8ff, 0xdfe7f5, 0x9fb8d0], line: 'Buried in the snow' },
  { key: 'sand', hardness: 0.8, style: 'sand', debris: [0xe3bd88, 0xd8a868, 0xc4673a], line: 'Scattered on the sand' },
  { key: 'ice', hardness: 1.0, style: 'crystal', debris: [0x9ff0ff, 0xdff8ff, 0x6fc8e8], line: 'Shattered on the ice' },
  { key: 'mercury', hardness: 0.6, style: 'prism', debris: [0xe8e4f0, 0xc8b8e8, 0xb8f0e0], line: 'Drowned in liquid light' },
  { key: 'mirror', hardness: 0.6, style: 'mirror', debris: [0x2a0e1a, 0x5a2a3a, 0x8a3aff], line: 'Taken by the black mirror' },
  { key: 'ash', hardness: 0.9, style: 'ash', debris: [0x3a3330, 0x5a524e, 0xff5a14], line: 'Scattered into ash' },
  { key: 'neon', hardness: 0.8, style: 'prism', debris: [0xff4ae8, 0x4af0ff, 0xfff04a], line: 'Dissolved into light' },
];
