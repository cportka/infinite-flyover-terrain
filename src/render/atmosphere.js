import * as THREE from 'three';
import { BIOMES } from '../world/biomes.js';

// Palette keyframes over the day (t: 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset).
const KEYS = [
  { t: 0.0, top: 0x040714, hor: 0x1a2342, glow: 0x0e1630, sun: 0x8ea4ff, sunI: 0.42, amb: 0x1e2648, gnd: 0x0b0e1a, night: 1.0, stars: 1.0, exposure: 1.12 },
  { t: 0.205, top: 0x0b1030, hor: 0x302e5a, glow: 0x3a2a58, sun: 0x8ea4ff, sunI: 0.36, amb: 0x282c52, gnd: 0x100e1a, night: 0.9, stars: 0.8, exposure: 1.1 },
  { t: 0.24, top: 0x2a3a78, hor: 0xdc7a8a, glow: 0xff9a6a, sun: 0xff9a60, sunI: 1.2, amb: 0x5a5c8c, gnd: 0x2c2232, night: 0.45, stars: 0.15, exposure: 1.1 },
  { t: 0.275, top: 0x4a76ba, hor: 0xffc08c, glow: 0xffb070, sun: 0xffc890, sunI: 2.4, amb: 0x8aa2cc, gnd: 0x4a4036, night: 0.05, stars: 0.0, exposure: 0.8 },
  { t: 0.34, top: 0x3f80d8, hor: 0xcfe6fa, glow: 0xfff0d8, sun: 0xfff2e0, sunI: 2.9, amb: 0x9ab8e0, gnd: 0x5a5a48, night: 0, stars: 0, exposure: 0.8 },
  { t: 0.5, top: 0x2f6fd0, hor: 0xbcdcf6, glow: 0xfff8f0, sun: 0xfffaf2, sunI: 3.1, amb: 0x9cc0ea, gnd: 0x5e604c, night: 0, stars: 0, exposure: 0.8 },
  { t: 0.645, top: 0x3a6cc4, hor: 0xf0cda4, glow: 0xffcf90, sun: 0xffe8c8, sunI: 2.9, amb: 0x9ab4d8, gnd: 0x5e5844, night: 0, stars: 0, exposure: 0.8 },
  { t: 0.715, top: 0x3c5aa8, hor: 0xffb074, glow: 0xff9a50, sun: 0xffae60, sunI: 2.5, amb: 0x8a90b8, gnd: 0x5a4434, night: 0.03, stars: 0, exposure: 0.8 },
  { t: 0.752, top: 0x2a307c, hor: 0xff7452, glow: 0xff6a3a, sun: 0xff7442, sunI: 1.5, amb: 0x6a5a8c, gnd: 0x3a2830, night: 0.25, stars: 0.05, exposure: 1.05 },
  { t: 0.79, top: 0x151a4c, hor: 0xa44a7a, glow: 0xc0507a, sun: 0x9aa8ff, sunI: 0.45, amb: 0x3c3264, gnd: 0x181420, night: 0.75, stars: 0.5, exposure: 1.2 },
  { t: 0.84, top: 0x060a1c, hor: 0x1e2648, glow: 0x161e3a, sun: 0x8ea4ff, sunI: 0.42, amb: 0x1e2648, gnd: 0x0b0e1a, night: 1.0, stars: 1.0, exposure: 1.12 },
];

const COLOR_FIELDS = ['top', 'hor', 'glow', 'sun', 'amb', 'gnd'];
const KEYC = KEYS.map((k) => {
  const o = { ...k };
  for (const f of COLOR_FIELDS) o[f] = new THREE.Color(k[f]); // hex is sRGB -> linear working space
  return o;
});

const MOON_DIR = new THREE.Vector3(-0.45, 0.62, -0.645).normalize();

function smooth(u) {
  return u * u * (3 - 2 * u);
}

const DREAM_PERIOD = 270; // seconds for a full reality -> dream -> reality cycle

/** 0..1: about a third of the cycle real, a third dreaming, with slow transitions. */
function dreamCycle(phase) {
  const p = phase - Math.floor(phase);
  if (p < 0.34) return 0;
  if (p < 0.5) return smooth((p - 0.34) / 0.16);
  if (p < 0.84) return 1;
  return 1 - smooth((p - 0.84) / 0.16);
}

export class Atmosphere {
  constructor(shared, sky, { startTime = 0.66, dayLength = 420, dreamPhase = 0.36 } = {}) {
    this.u = shared;
    this.sky = sky;
    this.t = startTime;
    this.dayLength = dayLength;
    this.speed = 1;
    this.viewRadius = 2400;
    this.state = {
      night: 0,
      stars: 0,
      exposure: 1,
      sunDir: new THREE.Vector3(),
      keyDir: new THREE.Vector3(),
      daylight: 1,
      wind: 1,
    };
    this.cloud = new THREE.Vector2(0, 0);
    this.tmp = { top: new THREE.Color(), hor: new THREE.Color(), glow: new THREE.Color(), sun: new THREE.Color(), amb: new THREE.Color(), gnd: new THREE.Color() };
    this.biomeMix = {
      tint: new THREE.Vector3(1, 1, 1), fog: 1, heightFog: 1, clouds: 0.6, aurora: 0, wind: 1,
      moon: new THREE.Color(0.85, 0.9, 1), neonA: new THREE.Color(), neonB: new THREE.Color(), dream: 0, border: 0,
    };
    this.dreamMode = 'auto'; // auto | dream | real
    this.dreamPhase = dreamPhase;
    this.dream = dreamCycle(dreamPhase);
    this.tmpA = new THREE.Color();
    this.tmpB = new THREE.Color();
  }

  /** Progress of the dream cycle that the UI can reflect on ('rising' / 'falling'). */
  get dreamTrend() {
    const p = this.dreamPhase - Math.floor(this.dreamPhase);
    return p >= 0.34 && p < 0.5 ? 'rising' : p >= 0.84 ? 'falling' : p >= 0.5 ? 'dream' : 'real';
  }

  /** Day progress per real second, with faster nights and slightly slower golden hours. */
  rate(t) {
    const night = t < 0.215 || t > 0.8;
    const golden = (t > 0.24 && t < 0.3) || (t > 0.69 && t < 0.77);
    return (1 / this.dayLength) * (night ? 2.1 : golden ? 0.8 : 1.0);
  }

  setBiomeBlend(a, b, t, border = 0) {
    const A = BIOMES[a].atmo;
    const B = BIOMES[b].atmo;
    const m = this.biomeMix;
    m.moon.setRGB(...A.moon, THREE.SRGBColorSpace).lerp(this.tmpA.setRGB(...B.moon, THREE.SRGBColorSpace), t);
    m.neonA.setRGB(...BIOMES[a].neon[0], THREE.SRGBColorSpace).lerp(this.tmpA.setRGB(...BIOMES[b].neon[0], THREE.SRGBColorSpace), t);
    m.neonB.setRGB(...BIOMES[a].neon[1], THREE.SRGBColorSpace).lerp(this.tmpB.setRGB(...BIOMES[b].neon[1], THREE.SRGBColorSpace), t);
    m.dream = A.dream + (B.dream - A.dream) * t;
    m.border = border;
    m.tint.set(
      A.tint[0] + (B.tint[0] - A.tint[0]) * t,
      A.tint[1] + (B.tint[1] - A.tint[1]) * t,
      A.tint[2] + (B.tint[2] - A.tint[2]) * t,
    );
    m.fog = A.fog + (B.fog - A.fog) * t;
    m.heightFog = A.heightFog + (B.heightFog - A.heightFog) * t;
    m.clouds = A.clouds + (B.clouds - A.clouds) * t;
    m.aurora = A.aurora + (B.aurora - A.aurora) * t;
    m.wind = A.wind + (B.wind - A.wind) * t;
  }

  sample(t) {
    let i = KEYC.length - 1;
    for (let k = 0; k < KEYC.length; k++) {
      if (KEYC[k].t <= t) i = k;
    }
    const a = KEYC[i];
    const b = KEYC[(i + 1) % KEYC.length];
    const ta = a.t;
    const tb = i + 1 < KEYC.length ? b.t : 1.0;
    const u = smooth(Math.min(1, Math.max(0, (t - ta) / (tb - ta))));
    const o = this.tmp;
    for (const f of COLOR_FIELDS) o[f].copy(a[f]).lerp(b[f], u);
    o.sunI = a.sunI + (b.sunI - a.sunI) * u;
    o.night = a.night + (b.night - a.night) * u;
    o.stars = a.stars + (b.stars - a.stars) * u;
    o.exposure = a.exposure + (b.exposure - a.exposure) * u;
    return o;
  }

  update(dt) {
    this.t = (this.t + dt * this.rate(this.t) * this.speed) % 1;
    if (this.t < 0) this.t += 1;
    const t = this.t;
    const P = this.sample(t);
    const U = this.u;
    const m = this.biomeMix;

    // sun path: rises front-right, culminates ahead, sets front-left
    const elev = Math.asin(Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * (t - 0.25)) * 0.92)));
    const az = (0.5 - t) * ((2 * Math.PI) / 3) * 2;
    const sun = this.state.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));
    U.uSunDisc.value.copy(sun);
    U.uMoonDir.value.copy(MOON_DIR);
    const w = Math.min(1, Math.max(0, (sun.y + 0.1) / 0.16));
    const wk = smooth(w);
    const key = this.state.keyDir.copy(MOON_DIR).lerp(sun, wk).normalize();
    // keep the key light from grazing completely flat
    if (key.y < 0.08) {
      key.y = 0.08;
      key.normalize();
    }
    U.uSunDir.value.copy(key);

    U.uSunColor.value.copy(P.sun).multiplyScalar(P.sunI);
    U.uSkyTop.value.copy(P.top);
    U.uSkyHorizon.value.copy(P.hor).multiply({ r: m.tint.x, g: m.tint.y, b: m.tint.z });
    U.uSkyGlow.value.copy(P.glow).multiply({ r: m.tint.x, g: m.tint.y, b: m.tint.z }).multiplyScalar(1 - P.night * 0.8);
    U.uAmbSky.value.copy(P.amb).multiplyScalar(0.55);
    U.uAmbGround.value.copy(P.gnd).multiplyScalar(0.6);

    const dawn = Math.exp(-(((t - 0.27) / 0.05) ** 2));
    const dusk = Math.exp(-(((t - 0.77) / 0.05) ** 2));
    U.uFogDensity.value = (2.05 / this.viewRadius) * m.fog;
    U.uHeightFog.value = 0.0007 * m.heightFog * (1 + 1.8 * dawn + 0.8 * dusk + 0.4 * P.night);
    U.uHeightFalloff.value = 0.018;
    U.uNight.value = P.night;
    U.uGlow.value = 0.45 + 0.75 * P.night;
    U.uCloudCover.value = m.clouds;
    U.uWind.value = m.wind;

    // drifting cloud shadows (offset wraps at the noise period of 16 cells)
    this.cloud.x = (this.cloud.x + dt * 0.012 * m.wind) % 16;
    this.cloud.y = (this.cloud.y + dt * 0.006 * m.wind) % 16;
    U.uCloudOffset.value.copy(this.cloud);

    // ---- dream / reality
    this.dreamPhase += dt / DREAM_PERIOD;
    let target;
    if (this.dreamMode === 'dream') target = 1;
    else if (this.dreamMode === 'real') target = 0;
    else target = Math.min(1, dreamCycle(this.dreamPhase) * 0.92 + m.dream + m.border * 0.75);
    this.dream += (target - this.dream) * (1 - Math.exp(-dt * 0.45));
    const D = this.dream;
    U.uDream.value = D;
    U.uNeonA.value.copy(m.neonA);
    U.uNeonB.value.copy(m.neonB);
    // the dream glows brighter
    U.uGlow.value += D * 0.6;

    if (this.sky) {
      const su = this.sky.material.uniforms;
      su.uStars.value = Math.max(P.stars, D * 0.35);
      su.uAurora.value = m.aurora * P.night + D * 0.45;
      su.uMoonColor.value.copy(m.moon);
      su.uPlanet.value = D * (0.55 + 0.45 * P.night);
    }

    const s = this.state;
    s.night = P.night;
    s.stars = P.stars;
    s.exposure = P.exposure;
    s.daylight = 1 - P.night;
    s.wind = m.wind;
    s.dream = D;
  }

  /** "HH:MM" for the HUD. */
  clock() {
    const mins = Math.floor(this.t * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
