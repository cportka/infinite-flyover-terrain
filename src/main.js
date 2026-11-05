import * as THREE from 'three';
import './ui/style.css';
import { BIOMES, BIOME } from './world/biomes.js';
import { createWorldView } from './world/world.js';
import { ChunkManager, QUALITY } from './world/chunkManager.js';
import { MESA_STRATA } from './world/chunkBuilder.js';
import { epochCell } from './world/blend.js';
import { MATTER } from './world/matter.js';
import { hex } from './world/biomes.js';
import { createSharedUniforms, createTerrainMaterial, createPropMaterial, createWaterMaterial } from './render/materials.js';
import { createSky } from './render/sky.js';
import { Atmosphere } from './render/atmosphere.js';
import { PostFX } from './render/postfx.js';
import { Particles, Clouds, Birds, NeonShapes } from './render/ambient.js';
import { Flyer } from './game/player.js';
import { Rings } from './game/rings.js';
import { Explosions } from './game/explosions.js';
import { Input } from './game/input.js';
import { AudioEngine } from './game/audio.js';
import { HUD } from './ui/hud.js';

const REBASE_STEP = 4096; // every world-space shader pattern is periodic over this
const REBASE_TRIGGER = 3072;
const TIME_WRAP = 4096;
const IDLE_MS = 5000;

// ------------------------------------------------------------------ settings & params

const params = new URLSearchParams(location.search);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`ifo:${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`ifo:${k}`, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const seedParam = parseInt(params.get('seed') ?? '', 10);
const SEED = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 1337;

const settings = {
  quality: params.get('quality') || store.get('quality', 'auto'),
  camera: params.get('cam') || store.get('camera', 'chase'),
  daySpeed: store.get('daySpeed', 1),
  dream: params.get('dream') || store.get('dream', 'auto'),
  volume: store.get('volume', 0.8),
  muted: store.get('muted', false),
  invertY: store.get('invertY', false),
};

function resolveQuality(q) {
  if (q !== 'auto') return q;
  const small = Math.min(screen.width, screen.height) < 820;
  return isTouch || small ? 'medium' : 'high';
}

// ------------------------------------------------------------------ boot

const hud = new HUD();
hud.setSeed(SEED);
hud.setBest(store.get('best', 0));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
} catch (err) {
  console.error(err);
  hud.showError();
  throw err;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x0b0e1a, 1);
renderer.info.autoReset = false;

let qualityName = resolveQuality(settings.quality);
const maxDPR = () => Math.min(window.devicePixelRatio || 1, qualityName === 'high' ? 2 : qualityName === 'medium' ? 1.5 : 1);
let resScale = qualityName === 'low' ? 0.8 : 1;
let pixelRatio = maxDPR() * resScale;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
const worldRoot = new THREE.Group();
scene.add(worldRoot);
const origin = { x: 0, z: 0 };

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 4200);
worldRoot.add(camera);

const shared = createSharedUniforms();
const materials = {
  terrain: createTerrainMaterial(shared, MESA_STRATA),
  props: createPropMaterial(shared),
  water: createWaterMaterial(shared),
};

const sky = createSky(shared);
scene.add(sky);

const world = createWorldView(SEED, { memorySeconds: 40 });
// debug: ?border places a boundary between two generations right at the start
if (params.has('border')) world.memory.assignHook = (ix) => (ix >= 0 ? 1 : 0);
const chunks = new ChunkManager({ root: worldRoot, seed: SEED, world, materials, quality: qualityName });

const startT = parseFloat(params.get('t'));
const atmosphere = new Atmosphere(shared, sky, { startTime: Number.isFinite(startT) ? startT : 0.665 });
atmosphere.viewRadius = chunks.viewRadius;
atmosphere.speed = settings.daySpeed;
atmosphere.dreamMode = settings.dream;
if (settings.dream === 'dream') atmosphere.dream = 1;
if (settings.dream === 'real') atmosphere.dream = 0;

const air = new Particles({ count: 1800, box: [256, 128, 256], additive: false, seed: 3 });
const glow = new Particles({ count: 900, box: [256, 96, 256], additive: true, seed: 5 });
scene.add(air.points);
scene.add(glow.points);
const clouds = new Clouds(shared);
scene.add(clouds.mesh);
const birds = new Birds(shared);
scene.add(birds.mesh);
const neon = new NeonShapes(shared);
scene.add(neon.group);

const flyer = new Flyer(world, chunks, materials.props);
worldRoot.add(flyer.group);
for (const t of flyer.trails) worldRoot.add(t.mesh);
flyer.preferredCamera = settings.camera;
{
  const biomeKey = params.get('biome');
  const bi = biomeKey ? BIOMES.findIndex((b) => b.key === biomeKey) : -1;
  const sp = (bi >= 0 && world.findBiome(bi)) || world.startPoint();
  flyer.reset(sp.x, sp.z, sp.tx, sp.tz);
}

const rings = new Rings(worldRoot, world, shared, SEED);
const explosions = new Explosions(worldRoot, shared);

const post = new PostFX(renderer, scene, camera, { bloom: qualityName !== 'low', msaa: qualityName === 'high' ? 4 : 0 });

const input = new Input(renderer.domElement);
input.invertY = settings.invertY;
const audio = new AudioEngine();
audio.volume = settings.volume;
audio.muted = settings.muted;
hud.setSound(false);

// ------------------------------------------------------------------ state

const game = {
  started: false,
  paused: false,
  gameMode: false,
  score: 0,
  combo: 1,
  best: store.get('best', 0),
  crashes: 0,
  regionKey: null,
  borderShown: -1e9,
  time: 0,
  loadTime: 0,
  timeScale: 1,
  autopilot: true,
  dreamTrend: atmosphere.dreamTrend,
  lastEpoch: 0,
  cellKey: null,
  visits: new Map(),
};

function applyQuality(name) {
  qualityName = resolveQuality(name);
  chunks.setQuality(qualityName);
  atmosphere.viewRadius = chunks.viewRadius;
  camera.far = chunks.viewRadius * 1.6 + 600;
  camera.updateProjectionMatrix();
  post.setBloom(qualityName !== 'low');
  resScale = qualityName === 'low' ? 0.8 : 1;
  resize();
}
camera.far = chunks.viewRadius * 1.6 + 600;
camera.updateProjectionMatrix();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  pixelRatio = Math.max(0.5, maxDPR() * resScale);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(w, h, pixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function startAudio() {
  if (settings.muted) return;
  audio.start();
  audio.setMuted(false);
  hud.setSound(true);
}

function setGameMode(on) {
  game.gameMode = on;
  flyer.setGameMode(on);
  rings.setEnabled(on);
  hud.setGameHUD(on);
  if (on) {
    game.score = 0;
    game.combo = 1;
    hud.whisper(isTouch ? 'drag to steer · hold boost to fly faster' : 'steer with WASD or drag · space to boost', 4.5);
  }
}

function setPaused(p) {
  if (!game.started) p = false;
  game.paused = p;
  hud.showPause(p);
  if (p) audio.suspend();
  else if (!settings.muted) audio.resume();
}

function finishRun() {
  if (game.gameMode && game.score > game.best) {
    game.best = Math.round(game.score);
    store.set('best', game.best);
    hud.setBest(game.best);
  }
}

// ------------------------------------------------------------------ UI wiring

const $ = (id) => document.getElementById(id);
$('btn-game').addEventListener('click', () => {
  startAudio();
  setGameMode(!game.gameMode);
});
$('btn-menu').addEventListener('click', () => setPaused(!game.paused));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-newworld').addEventListener('click', () => {
  finishRun();
  const q = new URLSearchParams(location.search);
  q.set('seed', String(1 + Math.floor(Math.random() * 999999)));
  location.search = q.toString();
});
$('btn-sound').addEventListener('click', () => toggleMute());

function toggleMute() {
  if (!audio.ctx && !settings.muted) {
    startAudio();
    return;
  }
  settings.muted = !settings.muted;
  store.set('muted', settings.muted);
  if (!settings.muted) audio.start();
  audio.setMuted(settings.muted);
  hud.setSound(!settings.muted);
}

const bindSelect = (id, key, apply) => {
  const el = $(id);
  el.value = String(settings[key]);
  el.addEventListener('change', () => {
    settings[key] = el.type === 'range' ? parseFloat(el.value) : el.value;
    store.set(key, settings[key]);
    apply(settings[key]);
  });
  return el;
};
bindSelect('opt-quality', 'quality', applyQuality);
const optCamera = bindSelect('opt-camera', 'camera', (v) => {
  flyer.preferredCamera = v;
  if (game.gameMode) flyer.cameraMode = v;
});
bindSelect('opt-time', 'daySpeed', (v) => (atmosphere.speed = parseFloat(v)));
const optDream = bindSelect('opt-dream', 'dream', (v) => (atmosphere.dreamMode = v));
const optVolume = $('opt-volume');
optVolume.value = String(settings.volume);
optVolume.addEventListener('input', () => {
  settings.volume = parseFloat(optVolume.value);
  store.set('volume', settings.volume);
  audio.setVolume(settings.volume);
});
const optInvert = $('opt-invert');
optInvert.checked = settings.invertY;
optInvert.addEventListener('change', () => {
  settings.invertY = optInvert.checked;
  store.set('invertY', settings.invertY);
  input.invertY = settings.invertY;
});

const boostBtn = $('boost-btn');
boostBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  input.touchBoost = true;
  boostBtn.classList.add('held');
});
const boostUp = () => {
  input.touchBoost = false;
  boostBtn.classList.remove('held');
};
boostBtn.addEventListener('pointerup', boostUp);
boostBtn.addEventListener('pointercancel', boostUp);
boostBtn.addEventListener('pointerleave', boostUp);

// the first touch, click or key wakes the sound
const wake = () => {
  if (!game.started) return;
  startAudio();
  hud.hideSoundHint();
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

const CAMERAS = ['chase', 'cinematic', 'cockpit'];
const DREAMS = ['auto', 'dream', 'real'];
const DREAM_WORDS = { auto: 'the world drifts between dreaming and waking', dream: 'the world dreams', real: 'the world stays awake' };
input.on('key', (code) => {
  if (!game.started) return;
  if (code === 'KeyP' || code === 'Escape') setPaused(!game.paused);
  else if (code === 'KeyM') toggleMute();
  else if (code === 'KeyG') setGameMode(!game.gameMode);
  else if (code === 'KeyH') document.body.classList.toggle('photo');
  else if (code === 'KeyC' && game.gameMode) {
    const i = (CAMERAS.indexOf(flyer.cameraMode) + 1) % CAMERAS.length;
    flyer.cameraMode = CAMERAS[i];
    flyer.preferredCamera = CAMERAS[i];
    settings.camera = CAMERAS[i];
    optCamera.value = settings.camera;
    store.set('camera', settings.camera);
  } else if (code === 'KeyT') {
    atmosphere.t = (atmosphere.t + 0.04) % 1;
  } else if (code === 'KeyR') {
    const m = DREAMS[(DREAMS.indexOf(atmosphere.dreamMode) + 1) % DREAMS.length];
    atmosphere.dreamMode = m;
    settings.dream = m;
    optDream.value = m;
    store.set('dream', m);
    hud.whisper(DREAM_WORDS[m], 3.5);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else if (!game.paused && !settings.muted) audio.resume();
});

// ------------------------------------------------------------------ events

const tmpV = new THREE.Vector3();
function screenPos(x, y, z) {
  tmpV.set(x - origin.x, y, z - origin.z).project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, visible: tmpV.z < 1 };
}

const events = {
  onCollect(it, perfect) {
    if (!game.gameMode) return;
    const base = it.golden ? 500 : 100;
    const pts = Math.round(base * game.combo * (perfect ? 1.5 : 1));
    game.score += pts;
    audio.collect(game.combo, it.golden);
    game.combo = Math.min(game.combo + 1, 25);
    flyer.boostEnergy = Math.min(1, flyer.boostEnergy + (it.golden ? 0.4 : 0.14));
    const p = screenPos(it.pos.x, it.pos.y, it.pos.z);
    if (p.visible) hud.popup(p.x, p.y, `+${pts}${perfect ? '  perfect' : ''}`, it.golden ? 'gold' : '');
    post.final.uniforms.uFlash.value = it.golden ? 0.25 : 0.08;
  },
  onMiss(it) {
    if (!game.gameMode) return;
    if (game.combo > 1) {
      const p = screenPos(it.pos.x, it.pos.y, it.pos.z);
      if (p.visible) hud.popup(p.x, p.y, 'combo lost', 'miss');
      audio.miss();
    }
    game.combo = 1;
  },
  onHit(mat, damage, pos) {
    if (damage < 3) return;
    game.combo = 1;
    explosions.spawnHit(mat, pos, flyer.vel, Math.min(2, damage / 30));
    audio.hit(MATTER[mat].style, damage);
    const p = screenPos(pos.x, pos.y + 3, pos.z);
    if (p.visible && damage >= 8) hud.popup(p.x, p.y, `hull −${Math.round(damage)}`, 'hurt');
  },
  onDeath(mat, pos, vel, mesh) {
    game.crashes++;
    explosions.spawn(mat, pos, vel, mesh);
    audio.explosion(MATTER[mat].style);
    finishRun();
    hud.eulogy(MATTER[mat].line, `flight ${game.crashes} · ${Math.round(game.score).toLocaleString()} points`);
    game.timeScale = 0.25;
    post.final.uniforms.uFlash.value = 0.35;
    game.combo = 1;
  },
  onRespawn() {
    game.score = 0;
  },
};

// ------------------------------------------------------------------ ambient presets

function mixPreset(A, B, t, out) {
  const l = (a, b) => a + (b - a) * t;
  out.color = [l(A.color[0], B.color[0]), l(A.color[1], B.color[1]), l(A.color[2], B.color[2])];
  out.color2 = [l(A.color2[0], B.color2[0]), l(A.color2[1], B.color2[1]), l(A.color2[2], B.color2[2])];
  out.size = l(A.size, B.size);
  out.amount = l(A.amount, B.amount);
  out.fall = l(A.fall || 0, B.fall || 0);
  out.rise = l(A.rise || 0, B.rise || 0);
  out.swirl = l(A.swirl, B.swirl);
  out.shape = t < 0.5 ? A.shape || 0 : B.shape || 0;
  out.night = l(A.night ?? 1, B.night ?? 1);
  return out;
}
const BORDER_AIR = { color: hex(0x2a2430), color2: hex(0x4a4058), size: 0.3, amount: 1.0, fall: -0.4, swirl: 2.5, shape: 0 };
const BORDER_GLOW = { color: hex(0xa04aff), color2: hex(0xff4ad8), size: 0.45, amount: 0.9, night: 0.2, rise: 1.4 };
const airP = {};
const glowP = {};
const airB = {};
const glowB = {};
const lightCol = new THREE.Color();
const S = {};

// ------------------------------------------------------------------ main loop

let last = performance.now();
let frameAvg = 16;
let slowTime = 0;
let fastTime = 0;
const debug = params.has('debug');

function updateAdaptiveResolution(dtMs) {
  frameAvg += (dtMs - frameAvg) * 0.05;
  if (!game.started) return;
  if (frameAvg > 24) {
    slowTime += dtMs;
    fastTime = 0;
  } else if (frameAvg < 15.5) {
    fastTime += dtMs;
    slowTime = 0;
  } else {
    slowTime = 0;
    fastTime = 0;
  }
  if (slowTime > 1500 && resScale > 0.55) {
    resScale = Math.max(0.55, resScale - 0.12);
    slowTime = 0;
    resize();
  } else if (fastTime > 5000 && resScale < 1) {
    resScale = Math.min(1, resScale + 0.08);
    fastTime = 0;
    resize();
  }
}

function memoryWhispers() {
  for (const e of world.memory.drainEvents()) {
    if (e.type === 'epoch' && game.started) hud.whisper('beyond memory, the land is made anew', 5.5);
  }
  // returning to remembered ground
  const ix = epochCell(camera.position.x);
  const iz = epochCell(camera.position.z);
  const key = `${ix},${iz}`;
  if (key !== game.cellKey) {
    const lastVisit = game.visits.get(key);
    const age = world.memory.ageOf(ix, iz);
    if (lastVisit !== undefined && game.time - lastVisit > 25 && age !== undefined && age > 35) {
      hud.whisper('you remember this place', 4.5);
    }
    if (game.cellKey) game.visits.set(game.cellKey, game.time);
    game.cellKey = key;
    if (game.visits.size > 400) game.visits.delete(game.visits.keys().next().value);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  renderer.info.reset();
  updateAdaptiveResolution(Math.min(rawMs, 100));
  let dt = Math.min(rawMs / 1000, 1 / 20);
  if (game.paused) dt = 0;
  game.timeScale += (1 - game.timeScale) * Math.min(1, dt * 0.9);
  const gdt = dt * game.timeScale;
  game.time += gdt;
  shared.uTime.value = game.time % TIME_WRAP;

  // ---- flight
  input.enabled = game.started && !game.paused;
  input.update();
  if (game.started) {
    rings.update(gdt, flyer, events);
    const human = input.activeWithin(IDLE_MS);
    game.autopilot = !human;
    let control;
    let boost = false;
    if (human && flyer.alive) {
      control = input.steer;
      boost = input.boost;
    } else {
      control = flyer.autopilot(gdt, game.time);
    }
    if (gdt > 0) {
      const wasBoost = flyer.boosting;
      flyer.update(gdt, control, boost, events, game.time);
      if (flyer.boosting && !wasBoost) audio.whoosh();
    }
  }

  // ---- camera + floating origin
  flyer.updateCamera(camera, gdt, game.time);
  const portrait = camera.aspect < 1;
  const baseFov = (portrait ? 74 : 62) + (flyer.cameraMode === 'drone' ? 4 : 0);
  const targetFov = baseFov + (flyer.boosting ? 10 : 0) + Math.max(0, flyer.speed - 66) * 0.04;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3 || 0.1);
  camera.updateProjectionMatrix();

  if (Math.abs(camera.position.x - origin.x) > REBASE_TRIGGER || Math.abs(camera.position.z - origin.z) > REBASE_TRIGGER) {
    origin.x += Math.round((camera.position.x - origin.x) / REBASE_STEP) * REBASE_STEP;
    origin.z += Math.round((camera.position.z - origin.z) / REBASE_STEP) * REBASE_STEP;
    worldRoot.position.set(-origin.x, 0, -origin.z);
  }
  worldRoot.updateMatrixWorld(true);
  sky.position.set(camera.position.x - origin.x, camera.position.y, camera.position.z - origin.z);

  // ---- world streaming (full disk, biased along the heading)
  chunks.update(camera.position.x, camera.position.z, Math.sin(flyer.yaw), -Math.cos(flyer.yaw), game.time, game.started ? 4 : 12);

  // ---- atmosphere: biome + borderland at the camera
  world.sample(camera.position.x, camera.position.z, S);
  atmosphere.setBiomeBlend(S.a, S.b, S.t, S.bl);
  atmosphere.update(game.started ? gdt : 0);
  const st = atmosphere.state;
  birds.material.uniforms.uDay.value = Math.max(0, Math.min(1, 1 - st.night * 1.6));

  const A = BIOMES[S.a];
  const B = BIOMES[S.b];
  mixPreset(A.air, B.air, S.t, airP);
  mixPreset(A.glow, B.glow, S.t, glowP);
  if (S.bl > 0.01) {
    mixPreset(airP, BORDER_AIR, S.bl, airB);
    mixPreset(glowP, BORDER_GLOW, S.bl, glowB);
    Object.assign(airP, airB);
    Object.assign(glowP, glowB);
  }
  const pixel = (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  lightCol.copy(shared.uSunColor.value).multiplyScalar(0.35).add(shared.uAmbSky.value).multiplyScalar(1.1);
  air.apply(airP, lightCol, 0.85, shared.uTime.value, pixel);
  const glowAmount = glowP.amount * (glowP.night >= 0.99 ? st.night : 1 - glowP.night + glowP.night * st.night);
  lightCol.setRGB(1.7, 1.7, 1.7).multiplyScalar(1 + st.dream * 0.6);
  glow.apply({ ...glowP, amount: Math.min(1, glowAmount + st.dream * 0.25) }, lightCol, 1.0, shared.uTime.value, pixel, 1);
  rings.pixel = pixel;
  explosions.pixel = pixel;
  explosions.update(gdt, origin);

  // ---- regions, borderlands, memory, dreams
  if (game.started) {
    const dom = S.t > 0.5 ? S.b : S.a;
    if (S.bl > 0.45) {
      if (game.time - game.borderShown > 40) {
        game.borderShown = game.time;
        hud.region('The Borderland', 'where memory frays into another world', 'border');
      }
      game.regionKey = null;
    } else {
      const key = `${S.e0}:${S.region}`;
      if (key !== game.regionKey && S.bl < 0.2) {
        game.regionKey = key;
        hud.region(BIOMES[dom].name, BIOMES[dom].tagline);
        audio.setBiome(BIOMES[dom].music);
        audio.regionSwell();
      }
    }
    memoryWhispers();
    const trend = atmosphere.dreamTrend;
    if (trend !== game.dreamTrend && atmosphere.dreamMode === 'auto') {
      if (trend === 'rising') hud.whisper('the colours begin to dream…', 5);
      if (trend === 'falling') hud.whisper('…and slowly, the world wakes', 5);
      game.dreamTrend = trend;
    }
    audio.update({ speed: flyer.speed, boosting: flyer.boosting });
    audio.setAmbience(S.bl, st.dream);
    hud.update(dt, {
      game: game.gameMode,
      score: game.score,
      combo: game.combo,
      distance: flyer.distance,
      clock: atmosphere.clock(),
      boost: flyer.boostEnergy,
      boosting: flyer.boosting,
      health: flyer.health,
      autopilot: game.gameMode && game.autopilot && flyer.alive,
    });
  }

  // ---- loading
  if (!game.started) {
    game.loadTime += rawMs / 1000;
    const p = chunks.progress();
    hud.setLoading(p);
    if ((p >= 0.98 && game.loadTime > 0.6) || game.loadTime > 12) {
      game.started = true;
      hud.hideLoading();
      hud.titleCard(params.has('notitle') ? 0 : 6500);
      if (params.has('game') || params.has('play')) setGameMode(true);
    }
  }

  // ---- post
  const f = post.final.uniforms;
  f.uExposure.value = st.exposure;
  f.uDream.value = st.dream;
  f.uAberration.value = flyer.boosting ? 0.0045 : 0.0008 + st.dream * 0.0022;
  f.uFlash.value = Math.max(0, f.uFlash.value - dt * 0.8);
  // the dream blooms hardest at night; by day it must not wash the land out
  const dreamBloom = st.dream * (0.35 + 0.65 * st.night);
  post.bloom.threshold = 2.6 + (1.15 - 2.6) * Math.max(st.night, dreamBloom * 0.7);
  post.bloom.strength = 0.42 + 0.45 * dreamBloom;
  post.render(dt);

  if (debug && Math.floor(now / 1000) !== Math.floor((now - rawMs) / 1000)) {
    console.log(
      `[debug] fps ${(1000 / frameAvg).toFixed(0)} res ${resScale.toFixed(2)} chunks ${chunks.stats.chunks} pending ${chunks.stats.pending} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} t ${atmosphere.t.toFixed(3)} dream ${st.dream.toFixed(2)} bl ${S.bl.toFixed(2)} epoch ${world.memory.epoch} pos ${flyer.pos.x.toFixed(0)},${flyer.pos.z.toFixed(0)} y ${flyer.pos.y.toFixed(0)}`,
    );
  }
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// expose a tiny handle for debugging in the console
window.__flyover = { world, chunks, flyer, rings, explosions, atmosphere, game, renderer, camera, scene, post, setGameMode, events, QUALITY, BIOME };
