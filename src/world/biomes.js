// Biome catalogue. Pure data, shared by the main thread and the chunk worker.
// Colours are sRGB in [0, 1]; shaders decode them to linear.

export const BIOME = {
  MEADOW: 0,
  ALPINE: 1,
  MESA: 2,
  MYSTIC: 3,
  AUTUMN: 4,
  COAST: 5,
  VOLCANIC: 6,
  GOTHIC: 7,
  PRISM: 8,
};

/** Liquid filling rivers and lakes. Encoded into the water mesh (aTint.a = type / 3). */
export const LIQUID = { WATER: 0, LAVA: 1, MERCURY: 2, MIRROR: 3 };

export function hex(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

/**
 * terrain:
 *   base        constant elevation offset (m)
 *   contAmp     amplitude of the continental (very low frequency) layer
 *   hillAmp     amplitude of rolling hills
 *   mtnAmp      amplitude of ridged mountains
 *   ridgePow    exponent applied to the ridge signal (higher = sharper peaks, flatter lowlands)
 *   mtnBias     shifts the mountain mask (+ = more mountains)
 *   detailAmp   small bumps
 *   terrace     0..1 strength of terracing (mesa strata)
 *   terraceStep height of each terrace (m)
 *   valleyWidth half width of river valleys (m)
 *   valleyFloor height of valley floors (m, water level is 0)
 *   floorVar    how much valley floors wander up/down
 *   valleyWall  quadratic steepness of the valley walls
 * atmo:
 *   tint/fog/heightFog/clouds/aurora/wind  atmosphere modifiers
 *   moon        moon colour (sRGB)
 *   dream       bias added to the dream/reality cycle while in this biome
 * neon: two sRGB accent colours used for dream-phase contour lines
 */
export const BIOMES = [
  {
    key: 'meadow',
    name: 'Verdant Vale',
    tagline: 'Rolling hills and slow rivers',
    terrain: {
      base: 15, contAmp: 22, hillAmp: 32, mtnAmp: 110, ridgePow: 1.6, mtnBias: -0.05, detailAmp: 1.1,
      terrace: 0, terraceStep: 10,
      valleyWidth: 62, valleyFloor: -2.2, floorVar: 5, valleyWall: 0.0045,
    },
    water: hex(0x3f8fb0),
    liquid: LIQUID.WATER,
    atmo: { tint: [1.0, 1.0, 1.0], fog: 1.0, heightFog: 1.0, clouds: 0.65, aurora: 0.0, wind: 1.0, moon: hex(0xdfe8ff), dream: 0 },
    neon: [hex(0x7affc8), hex(0xffe066)],
    // air: soft particles (normal blending); glow: additive particles
    air: { color: hex(0xfff6dc), color2: hex(0xffe6a8), size: 0.22, amount: 0.45, fall: 0.1, swirl: 1.2, shape: 0 },
    glow: { color: hex(0xd8ff7a), color2: hex(0xfff08a), size: 0.55, amount: 0.25, night: 1.0, rise: 0.15 },
    music: 0,
  },
  {
    key: 'alpine',
    name: 'Frostpeak Range',
    tagline: 'Granite giants under the aurora',
    terrain: {
      base: 26, contAmp: 40, hillAmp: 30, mtnAmp: 430, ridgePow: 1.25, mtnBias: 0.38, detailAmp: 1.6,
      terrace: 0, terraceStep: 10,
      valleyWidth: 58, valleyFloor: 3, floorVar: 18, valleyWall: 0.0065,
    },
    water: hex(0x4f9fae),
    liquid: LIQUID.WATER,
    atmo: { tint: [0.93, 0.98, 1.06], fog: 0.85, heightFog: 0.7, clouds: 0.85, aurora: 1.0, wind: 1.4, moon: hex(0xe8f2ff), dream: 0 },
    neon: [hex(0x6ff0ff), hex(0xb78cff)],
    air: { color: hex(0xffffff), color2: hex(0xe6f2ff), size: 0.3, amount: 1.0, fall: 3.2, swirl: 2.2, shape: 0 },
    glow: { color: hex(0x9ff4ff), color2: hex(0xdfe8ff), size: 0.35, amount: 0.12, night: 0.7, rise: 0.0 },
    music: 1,
  },
  {
    key: 'mesa',
    name: 'Ember Mesa',
    tagline: 'Sun-baked canyons of layered stone',
    terrain: {
      base: 26, contAmp: 26, hillAmp: 14, mtnAmp: 170, ridgePow: 2.1, mtnBias: 0.28, detailAmp: 0.9,
      terrace: 0.6, terraceStep: 14,
      valleyWidth: 40, valleyFloor: 0.6, floorVar: 4, valleyWall: 0.02,
    },
    water: hex(0x4c9a86),
    liquid: LIQUID.WATER,
    atmo: { tint: [1.1, 0.97, 0.86], fog: 1.1, heightFog: 0.45, clouds: 0.3, aurora: 0.0, wind: 0.7, moon: hex(0xffe2c0), dream: 0 },
    neon: [hex(0xff7a3a), hex(0xffd23a)],
    air: { color: hex(0xf2c79a), color2: hex(0xe8a874), size: 0.2, amount: 0.7, fall: -0.1, swirl: 2.8, shape: 0 },
    glow: { color: hex(0xffc070), color2: hex(0xffe0a0), size: 0.3, amount: 0.05, night: 0.6, rise: 0.2 },
    music: 2,
  },
  {
    key: 'mystic',
    name: 'Amethyst Wilds',
    tagline: 'Where the crystals hum at night',
    terrain: {
      base: 16, contAmp: 24, hillAmp: 32, mtnAmp: 150, ridgePow: 1.35, mtnBias: 0.1, detailAmp: 1.3,
      terrace: 0, terraceStep: 10,
      valleyWidth: 70, valleyFloor: -2.8, floorVar: 4, valleyWall: 0.0045,
    },
    water: hex(0x6a4fd0),
    liquid: LIQUID.WATER,
    atmo: { tint: [1.0, 0.9, 1.12], fog: 1.12, heightFog: 1.6, clouds: 0.5, aurora: 0.8, wind: 0.8, moon: hex(0xf0d8ff), dream: 0.2 },
    neon: [hex(0x6ff6ff), hex(0xff6af0)],
    air: { color: hex(0xe8c8ff), color2: hex(0xc8e8ff), size: 0.22, amount: 0.4, fall: 0.2, swirl: 1.4, shape: 0 },
    glow: { color: hex(0x6ff6ff), color2: hex(0xff7af0), size: 0.5, amount: 0.6, night: 0.35, rise: 0.8 },
    music: 3,
  },
  {
    key: 'autumn',
    name: 'Autumn Hollow',
    tagline: 'Copper forests and drifting leaves',
    terrain: {
      base: 14, contAmp: 24, hillAmp: 30, mtnAmp: 110, ridgePow: 1.45, mtnBias: 0.0, detailAmp: 1.1,
      terrace: 0, terraceStep: 10,
      valleyWidth: 58, valleyFloor: -2.0, floorVar: 5, valleyWall: 0.0045,
    },
    water: hex(0x3a7f8c),
    liquid: LIQUID.WATER,
    atmo: { tint: [1.07, 0.98, 0.9], fog: 1.05, heightFog: 1.35, clouds: 0.6, aurora: 0.0, wind: 1.2, moon: hex(0xffe8c8), dream: 0 },
    neon: [hex(0xff8a3a), hex(0xff3a7a)],
    air: { color: hex(0xf08a2a), color2: hex(0xd8462a), size: 0.55, amount: 0.75, fall: 1.4, swirl: 2.6, shape: 1 },
    glow: { color: hex(0xffd27a), color2: hex(0xfff2a0), size: 0.5, amount: 0.25, night: 1.0, rise: 0.1 },
    music: 4,
  },
  {
    key: 'coast',
    name: 'Azure Coast',
    tagline: 'Islands scattered on a glass sea',
    terrain: {
      base: -11, contAmp: 46, hillAmp: 26, mtnAmp: 90, ridgePow: 1.6, mtnBias: -0.15, detailAmp: 1.0,
      terrace: 0, terraceStep: 10,
      valleyWidth: 95, valleyFloor: -7, floorVar: 3, valleyWall: 0.0022,
    },
    water: hex(0x1aa7b8),
    liquid: LIQUID.WATER,
    atmo: { tint: [0.95, 1.02, 1.06], fog: 0.85, heightFog: 0.55, clouds: 0.55, aurora: 0.0, wind: 1.1, moon: hex(0xe0f0ff), dream: 0 },
    neon: [hex(0x3affe0), hex(0x3a9aff)],
    air: { color: hex(0xffffff), color2: hex(0xdff8ff), size: 0.2, amount: 0.3, fall: 0.0, swirl: 1.6, shape: 0 },
    glow: { color: hex(0x8ffff0), color2: hex(0xbfe8ff), size: 0.4, amount: 0.12, night: 1.0, rise: 0.05 },
    music: 5,
  },
  {
    key: 'volcanic',
    name: 'Cinder Fields',
    tagline: 'Rivers of fire beneath black glass',
    terrain: {
      base: 18, contAmp: 28, hillAmp: 18, mtnAmp: 240, ridgePow: 1.1, mtnBias: 0.22, detailAmp: 2.0,
      terrace: 0, terraceStep: 10,
      valleyWidth: 46, valleyFloor: -2.2, floorVar: 3, valleyWall: 0.008,
    },
    water: hex(0xff6a1a),
    liquid: LIQUID.LAVA,
    atmo: { tint: [1.1, 0.88, 0.84], fog: 1.1, heightFog: 0.8, clouds: 0.9, aurora: 0.0, wind: 0.9, moon: hex(0xffb090), dream: 0.05 },
    neon: [hex(0xff5a1a), hex(0xffc04a)],
    air: { color: hex(0x6a625e), color2: hex(0x8a807a), size: 0.25, amount: 0.8, fall: 0.6, swirl: 1.8, shape: 0 },
    glow: { color: hex(0xff7a2a), color2: hex(0xffc04a), size: 0.45, amount: 1.0, night: 0.5, rise: 2.2 },
    music: 6,
  },
  {
    key: 'gothic',
    name: 'Requiem Moors',
    tagline: 'Where the bells have forgotten their names',
    terrain: {
      base: 16, contAmp: 26, hillAmp: 30, mtnAmp: 170, ridgePow: 1.2, mtnBias: 0.05, detailAmp: 1.7,
      terrace: 0, terraceStep: 10,
      valleyWidth: 64, valleyFloor: -2.6, floorVar: 4, valleyWall: 0.005,
    },
    water: hex(0x2a0e1a),
    liquid: LIQUID.MIRROR,
    atmo: { tint: [0.9, 0.86, 1.04], fog: 1.35, heightFog: 2.2, clouds: 0.95, aurora: 0.0, wind: 1.3, moon: hex(0xff3a2e), dream: 0.08 },
    neon: [hex(0xff2a4a), hex(0x8a3aff)],
    air: { color: hex(0x3a3238), color2: hex(0x5a5058), size: 0.24, amount: 0.7, fall: 0.35, swirl: 1.6, shape: 0 },
    glow: { color: hex(0x9fffe0), color2: hex(0xbfd8ff), size: 0.6, amount: 0.35, night: 0.8, rise: 0.12 },
    music: 7,
  },
  {
    key: 'prism',
    name: 'Prismatic Expanse',
    tagline: 'The light remembers every colour it has been',
    terrain: {
      base: 12, contAmp: 22, hillAmp: 24, mtnAmp: 130, ridgePow: 2.3, mtnBias: 0.12, detailAmp: 0.6,
      terrace: 0.3, terraceStep: 9,
      valleyWidth: 72, valleyFloor: -2.4, floorVar: 4, valleyWall: 0.004,
    },
    water: hex(0xc8c0f0),
    liquid: LIQUID.MERCURY,
    atmo: { tint: [1.04, 0.98, 1.1], fog: 0.95, heightFog: 1.1, clouds: 0.4, aurora: 0.7, wind: 0.8, moon: hex(0xfff0ff), dream: 0.38 },
    neon: [hex(0xff4ae8), hex(0x4af0ff)],
    air: { color: hex(0xffe8ff), color2: hex(0xe8fff8), size: 0.2, amount: 0.5, fall: -0.15, swirl: 1.8, shape: 0 },
    glow: { color: hex(0xff8af0), color2: hex(0x8affff), size: 0.45, amount: 0.75, night: 0.3, rise: 0.4 },
    music: 8,
  },
];

export const BIOME_COUNT = BIOMES.length;

/** The world opens in this biome (region around the origin of the first generation). */
export const START_BIOME = BIOME.MEADOW;
