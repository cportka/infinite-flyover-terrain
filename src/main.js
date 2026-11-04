import * as THREE from 'three';
import './ui/style.css';
import { createWorld } from './world/terrain.js';
import { BIOMES } from './world/biomes.js';
import { ChunkManager, QUALITY } from './world/chunkManager.js';
import { MESA_STRATA } from './world/chunkBuilder.js';
import { createSharedUniforms, createTerrainMaterial, createPropMaterial, createWaterMaterial } from './render/materials.js';
import { createSky } from './render/sky.js';
import { Atmosphere } from './render/atmosphere.js';
import { PostFX } from './render/postfx.js';
import { Particles, Clouds, Birds } from './render/ambient.js';
import { Player } from './game/player.js';
import { Rings } from './game/rings.js';
import { Input } from './game/input.js';
import { AudioEngine } from './game/audio.js';
import { HUD } from './ui/hud.js';

const REBASE_STEP = 4096; // every world-space shader pattern is periodic over this
const REBASE_TRIGGER = 3072;
const TIME_WRAP = 4096;
const START_S = 300;

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
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
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
worldRoot.matrixAutoUpdate = true;
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

const world = createWorld(SEED);
const chunks = new ChunkManager({ root: worldRoot, seed: SEED, world, materials, quality: qualityName });

const startT = parseFloat(params.get('t'));
const atmosphere = new Atmosphere(shared, sky, { startTime: Number.isFinite(startT) ? startT : 0.665 });
atmosphere.viewRadius = chunks.viewRadius;
atmosphere.speed = settings.daySpeed;

const air = new Particles({ count: 1800, box: [256, 128, 256], additive: false, seed: 3 });
const glow = new Particles({ count: 900, box: [256, 96, 256], additive: true, seed: 5 });
scene.add(air.points);
scene.add(glow.points);
const clouds = new Clouds(shared);
scene.add(clouds.mesh);
const birds = new Birds(shared);
scene.add(birds.mesh);

const player = new Player(world, materials.props);
worldRoot.add(player.group);
for (const t of player.trails) worldRoot.add(t.mesh);
const startS = parseFloat(params.get('s'));
player.reset(Number.isFinite(startS) ? startS : START_S);
player.cameraMode = 'cinematic';

const rings = new Rings(worldRoot, world, shared, SEED);
rings.reset(player.s);

const post = new PostFX(renderer, scene, camera, { bloom: qualityName !== 'low', msaa: qualityName === 'high' ? 4 : 0 });

const input = new Input(renderer.domElement);
input.invertY = settings.invertY;
const audio = new AudioEngine();
audio.volume = settings.volume;
audio.muted = settings.muted;
hud.setSound(!settings.muted);

// ------------------------------------------------------------------ game state

const game = {
  mode: 'loading', // loading | title | play | zen
  paused: false,
  score: 0,
  combo: 1,
  best: store.get('best', 0),
  region: null,
  photo: false,
  loadTime: 0,
  time: 0,
  autopilot: true,
  hintTimer: 0,
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

function startFlight(zen) {
  audio.start();
  audio.setMuted(settings.muted);
  game.mode = zen ? 'zen' : 'play';
  game.score = 0;
  game.combo = 1;
  game.hintTimer = 0;
  player.distance = 0;
  player.boostEnergy = 1;
  player.cameraMode = zen ? 'cinematic' : settings.camera;
  input.enabled = !zen;
  hud.showTitle(false);
  hud.showHUD(true);
  hud.setZen(zen);
  document.body.classList.toggle('playing', !zen);
  const r = currentRegion();
  game.region = r.key;
  hud.region(BIOMES[r.biome].name, BIOMES[r.biome].tagline);
  audio.setBiome(BIOMES[r.biome].music);
}

function toTitle() {
  setPaused(false);
  finishRun();
  audio.suspend();
  game.mode = 'title';
  input.enabled = false;
  player.cameraMode = 'cinematic';
  hud.showHUD(false);
  hud.showTitle(true);
  hud.setZen(false);
  document.body.classList.remove('playing');
}

function finishRun() {
  if (game.mode === 'play' && game.score > game.best) {
    game.best = Math.round(game.score);
    store.set('best', game.best);
    hud.setBest(game.best);
  }
}

function setPaused(p) {
  if (game.mode !== 'play' && game.mode !== 'zen') p = false;
  game.paused = p;
  hud.showPause(p);
  document.body.classList.toggle('paused', p);
  if (p) audio.suspend();
  else if (game.mode === 'play' || game.mode === 'zen') audio.resume();
}

function currentRegion() {
  const b = world.biomeAt(player.pos.x, player.pos.z);
  const second = b.t > 0.5;
  return { key: second ? b.region + 1 : b.region, biome: second ? b.b : b.a };
}

// ------------------------------------------------------------------ UI wiring

const $ = (id) => document.getElementById(id);
$('btn-play').addEventListener('click', () => startFlight(false));
$('btn-zen').addEventListener('click', () => startFlight(true));
$('btn-zen-exit').addEventListener('click', () => toTitle());
$('btn-pause').addEventListener('click', () => setPaused(!game.paused));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-menu').addEventListener('click', () => toTitle());
$('btn-newworld').addEventListener('click', () => {
  finishRun();
  const s = 1 + Math.floor(Math.random() * 999999);
  const q = new URLSearchParams(location.search);
  q.set('seed', String(s));
  location.search = q.toString();
});
$('btn-sound').addEventListener('click', () => toggleMute());

function toggleMute() {
  settings.muted = !settings.muted;
  store.set('muted', settings.muted);
  audio.setMuted(settings.muted);
  hud.setSound(!settings.muted);
}

const optQuality = $('opt-quality');
optQuality.value = settings.quality;
optQuality.addEventListener('change', () => {
  settings.quality = optQuality.value;
  store.set('quality', settings.quality);
  applyQuality(settings.quality);
});
const optCamera = $('opt-camera');
optCamera.value = settings.camera;
optCamera.addEventListener('change', () => {
  settings.camera = optCamera.value;
  store.set('camera', settings.camera);
  if (game.mode === 'play') player.cameraMode = settings.camera;
});
const optTime = $('opt-time');
optTime.value = String(settings.daySpeed);
optTime.addEventListener('change', () => {
  settings.daySpeed = parseFloat(optTime.value);
  store.set('daySpeed', settings.daySpeed);
  atmosphere.speed = settings.daySpeed;
});
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

const CAMERAS = ['chase', 'cinematic', 'cockpit'];
input.on('key', (code) => {
  if (game.mode === 'title') {
    if (code === 'Enter' || code === 'Space') startFlight(false);
    if (code === 'KeyZ') startFlight(true);
    return;
  }
  if (game.mode !== 'play' && game.mode !== 'zen') return;
  if (code === 'KeyP' || code === 'Escape') setPaused(!game.paused);
  else if (code === 'KeyM') toggleMute();
  else if (code === 'KeyH') {
    game.photo = !game.photo;
    hud.setPhoto(game.photo);
  } else if (code === 'KeyC' && game.mode === 'play') {
    const i = (CAMERAS.indexOf(player.cameraMode) + 1) % CAMERAS.length;
    player.cameraMode = CAMERAS[i];
    settings.camera = player.cameraMode;
    optCamera.value = settings.camera;
    store.set('camera', settings.camera);
  } else if (code === 'KeyT') {
    atmosphere.t = (atmosphere.t + 0.04) % 1;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game.mode === 'play') setPaused(true);
    audio.suspend();
  } else if (!game.paused && (game.mode === 'play' || game.mode === 'zen')) {
    audio.resume();
  }
});

// ------------------------------------------------------------------ events

const tmpV = new THREE.Vector3();
function screenPos(x, y, z) {
  tmpV.set(x - origin.x, y, z - origin.z).project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, visible: tmpV.z < 1 };
}

const events = {
  onCollect(it, perfect) {
    if (game.mode !== 'play') {
      if (game.mode === 'zen') audio.collect(Math.min(9, game.combo++), it.golden);
      return;
    }
    const base = it.golden ? 500 : 100;
    const pts = Math.round(base * game.combo * (perfect ? 1.5 : 1));
    game.score += pts;
    audio.collect(game.combo, it.golden);
    game.combo = Math.min(game.combo + 1, 25);
    player.boostEnergy = Math.min(1, player.boostEnergy + (it.golden ? 0.4 : 0.14));
    const p = screenPos(it.x, it.y, it.z);
    if (p.visible) hud.popup(p.x, p.y, `+${pts}${perfect ? '  perfect' : ''}`, it.golden ? 'gold' : '');
    post.final.uniforms.uFlash.value = it.golden ? 0.25 : 0.08;
  },
  onMiss(it) {
    if (game.mode === 'zen') game.combo = 1;
    if (game.mode !== 'play') return;
    if (game.combo > 1) {
      const p = screenPos(it.x, it.y, it.z);
      if (p.visible) hud.popup(p.x, p.y, 'combo lost', 'miss');
      audio.miss();
    }
    game.combo = 1;
  },
  onBump() {
    if (game.mode !== 'play') return;
    game.combo = 1;
    audio.bump();
  },
};

// ------------------------------------------------------------------ particles presets

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
const airP = {};
const glowP = {};
const lightCol = new THREE.Color();

// ------------------------------------------------------------------ main loop

let last = performance.now();
let frameAvg = 16;
let slowTime = 0;
let fastTime = 0;
const debug = params.has('debug');

function updateAdaptiveResolution(dtMs) {
  frameAvg += (dtMs - frameAvg) * 0.05;
  if (game.mode === 'loading') return;
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

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  renderer.info.reset();
  updateAdaptiveResolution(Math.min(rawMs, 100));
  let dt = Math.min(rawMs / 1000, 1 / 20);
  if (game.paused) dt = 0;
  game.time += dt;
  shared.uTime.value = game.time % TIME_WRAP;

  // ---- flight
  input.update();
  let steer = { x: 0, y: 0 };
  let boost = false;
  let next = null;
  if (game.mode !== 'loading') next = rings.update(dt, player, events);
  const flying = game.mode !== 'loading';
  if (flying && dt > 0) {
    const human = game.mode === 'play' && input.activeWithin(6000);
    game.autopilot = !human;
    if (human) {
      steer = input.steer;
      boost = input.boost;
    } else {
      steer = player.autopilot(game.mode === 'play' ? null : next, dt);
    }
    const wasBoost = player.boosting;
    player.update(dt, steer, boost, events);
    if (player.boosting && !wasBoost) audio.whoosh();
  }

  // ---- camera + floating origin
  player.updateCamera(camera, dt, game.time);
  const portrait = camera.aspect < 1;
  const baseFov = portrait ? 74 : 62;
  const targetFov = baseFov + (player.boosting ? 10 : 0) + (player.speed - 68) * 0.04;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3 || 0.1);
  camera.updateProjectionMatrix();

  if (Math.abs(camera.position.x - origin.x) > REBASE_TRIGGER || Math.abs(camera.position.z - origin.z) > REBASE_TRIGGER) {
    origin.x += Math.round((camera.position.x - origin.x) / REBASE_STEP) * REBASE_STEP;
    origin.z += Math.round((camera.position.z - origin.z) / REBASE_STEP) * REBASE_STEP;
    worldRoot.position.set(-origin.x, 0, -origin.z);
  }
  worldRoot.updateMatrixWorld(true);
  sky.position.set(camera.position.x - origin.x, camera.position.y, camera.position.z - origin.z);

  // ---- world streaming
  chunks.update(camera.position.x, camera.position.z, game.mode === 'loading' ? 12 : 4);

  // ---- atmosphere (biome at the camera drives tints, particles, music)
  const bb = world.biomeAt(camera.position.x, camera.position.z);
  atmosphere.setBiomeBlend(bb.a, bb.b, bb.t);
  atmosphere.update(game.mode === 'loading' ? 0 : dt);
  const st = atmosphere.state;
  birds.material.uniforms.uDay.value = Math.max(0, Math.min(1, 1 - st.night * 1.6));

  const A = BIOMES[bb.a];
  const B = BIOMES[bb.b];
  mixPreset(A.air, B.air, bb.t, airP);
  mixPreset(A.glow, B.glow, bb.t, glowP);
  const pixel = (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  lightCol.copy(shared.uSunColor.value).multiplyScalar(0.35).add(shared.uAmbSky.value).multiplyScalar(1.1);
  air.apply(airP, lightCol, 0.85, shared.uTime.value, pixel);
  const glowAmount = glowP.amount * (glowP.night >= 0.99 ? st.night : 1 - glowP.night + glowP.night * st.night);
  lightCol.setRGB(1.7, 1.7, 1.7);
  glow.apply({ ...glowP, amount: Math.min(1, glowAmount) }, lightCol, 1.0, shared.uTime.value, pixel, 1);
  rings.pixel = pixel;

  // ---- regions
  if (game.mode === 'play' || game.mode === 'zen') {
    const r = currentRegion();
    if (r.key !== game.region) {
      game.region = r.key;
      hud.region(BIOMES[r.biome].name, BIOMES[r.biome].tagline);
      audio.setBiome(BIOMES[r.biome].music);
      audio.regionSwell();
    }
    audio.update({ speed: player.speed, boosting: player.boosting });
    hud.update(dt, {
      score: game.score,
      combo: game.combo,
      distance: player.distance,
      clock: atmosphere.clock(),
      night: st.night,
      boost: player.boostEnergy,
      boosting: player.boosting,
      autopilot: game.mode === 'play' && game.autopilot,
    });
  }

  // ---- loading -> title
  if (game.mode === 'loading') {
    game.loadTime += rawMs / 1000;
    const p = chunks.progress();
    hud.setLoading(p);
    if ((p >= 0.98 && game.loadTime > 0.6) || game.loadTime > 12) {
      hud.hideLoading();
      if (params.has('play')) {
        game.mode = 'title';
        startFlight(false);
      } else if (params.has('zen')) {
        game.mode = 'title';
        startFlight(true);
      } else {
        toTitle();
      }
    }
  }

  // ---- post
  const f = post.final.uniforms;
  f.uExposure.value = st.exposure;
  // bloom runs before exposure: keep sun-lit whites out of it by day, let emissives glow at night
  post.bloom.threshold = 2.6 + (1.15 - 2.6) * st.night;
  f.uAberration.value = player.boosting ? 0.0045 : 0.0012;
  f.uFlash.value = Math.max(0, f.uFlash.value - dt * 0.8);
  post.render(dt);

  if (debug && Math.floor(now / 1000) !== Math.floor((now - rawMs) / 1000)) {
    console.log(
      `[debug] fps ${(1000 / frameAvg).toFixed(0)} res ${resScale.toFixed(2)} chunks ${chunks.stats.chunks} pending ${chunks.stats.pending} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} t ${atmosphere.t.toFixed(3)} s ${player.s.toFixed(0)}`,
    );
  }
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// expose a tiny handle for debugging in the console
window.__flyover = { world, chunks, player, rings, atmosphere, game, renderer, QUALITY };
