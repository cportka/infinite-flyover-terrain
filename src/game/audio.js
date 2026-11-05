// Generative ambient soundtrack + sound effects, synthesised with WebAudio (no assets).

const PROGRESSIONS = [
  // Verdant Vale — D major
  { chords: [[50, 57, 61, 64], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 54, 59]], scale: [62, 64, 66, 69, 71, 74, 76, 78, 81] },
  // Frostpeak Range — E minor
  { chords: [[52, 59, 62, 66], [48, 55, 59, 64], [55, 59, 62, 64], [50, 57, 59, 64]], scale: [64, 67, 69, 71, 74, 76, 79, 81] },
  // Ember Mesa — A dorian
  { chords: [[45, 52, 55, 59], [50, 57, 60, 64], [53, 57, 60, 64], [55, 59, 62, 64]], scale: [69, 72, 74, 76, 79, 81, 84] },
  // Amethyst Wilds — F lydian
  { chords: [[53, 60, 64, 71], [55, 59, 62, 67], [52, 55, 59, 62], [57, 59, 60, 64]], scale: [65, 67, 69, 71, 72, 76, 79] },
  // Autumn Hollow — C major
  { chords: [[48, 55, 59, 62], [45, 52, 55, 60], [53, 57, 60, 64], [55, 60, 62, 65]], scale: [60, 62, 64, 67, 69, 72, 74, 76] },
  // Azure Coast — E major
  { chords: [[52, 59, 63, 66], [49, 56, 59, 64], [45, 52, 56, 61], [47, 54, 56, 61]], scale: [64, 66, 68, 71, 73, 76, 78, 80] },
  // Cinder Fields — C minor
  { chords: [[48, 55, 58, 62], [44, 51, 55, 60], [53, 56, 60, 63], [55, 58, 62, 65]], scale: [60, 63, 65, 67, 70, 72, 75] },
  // Requiem Moors — D minor / phrygian, with organ and bells
  { chords: [[50, 57, 60, 64], [46, 53, 57, 64], [55, 58, 62, 64], [45, 52, 55, 58]], scale: [62, 63, 65, 67, 69, 70, 74], organ: true, bells: true },
  // Prismatic Expanse — C lydian
  { chords: [[48, 55, 59, 66], [48, 54, 57, 62], [52, 55, 59, 62], [54, 57, 60, 64]], scale: [72, 74, 76, 78, 79, 83, 84], sparkle: true },
];

const CHORD_LEN = 8;

function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.biome = 0;
    this.chordIdx = 0;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(3.4);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.6;
    this.reverb.connect(revOut).connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.7;
    this.music.connect(musicSend).connect(this.reverb);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.35;
    this.sfx.connect(sfxSend).connect(this.reverb);

    // feedback delay for chimes
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.45;
    this.delay.connect(dOut).connect(this.music);

    // warm pad bus with a slowly breathing filter
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 950;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.music);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(this.padFilter.frequency);
    lfo.start();

    // wind
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // the Borderland: two low voices beating against each other
    this.borderGain = ctx.createGain();
    this.borderGain.gain.value = 0;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.value = 420;
    this.borderGain.connect(bf).connect(this.music);
    for (const [f, type] of [[55, 'sawtooth'], [58.3, 'sawtooth'], [82.4, 'triangle'], [116.6, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.012;
      lfo.connect(lg).connect(o.frequency);
      o.connect(this.borderGain);
      o.start();
      lfo.start();
    }

    const now = ctx.currentTime;
    this.nextChord = now + 0.15;
    this.nextChime = now + 2.5;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 1.2);
  }

  makeIR(seconds) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.25);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  setBiome(b) {
    if (b === this.biome) return;
    this.biome = b;
    this.chordIdx = 0;
  }

  padVoice(midi, t, dur, vol) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 2.4);
    g.gain.setValueAtTime(vol, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur + 2.6);
    g.connect(this.padFilter);
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 2.7);
    }
  }

  playChord(t) {
    const prog = PROGRESSIONS[this.biome] || PROGRESSIONS[0];
    const chord = prog.chords[this.chordIdx % prog.chords.length];
    this.chordIdx++;
    for (const m of chord) this.padVoice(m, t, CHORD_LEN, 0.03);
    if (prog.organ) for (const m of chord) this.organVoice(m - 12, t, CHORD_LEN);
    // soft sub bass
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(chord[0] - 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + CHORD_LEN + 1.5);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + CHORD_LEN + 1.6);
  }

  pluck(midi, t, vol, dest, pan = 0) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2.001;
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    o.connect(g);
    o2.connect(g2).connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest);
    out.connect(this.delay);
    o.start(t);
    o2.start(t);
    o.stop(t + 2.5);
    o2.stop(t + 2.5);
  }

  update(state) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.nextChord < now - 1) this.nextChord = now + 0.05;
    while (this.nextChord < now + 0.4) {
      this.playChord(this.nextChord);
      this.nextChord += CHORD_LEN;
    }
    if (this.nextChime < now - 1) this.nextChime = now + 0.5;
    if (this.nextChime < now + 0.15) {
      const scale = (PROGRESSIONS[this.biome] || PROGRESSIONS[0]).scale;
      const prog = PROGRESSIONS[this.biome] || PROGRESSIONS[0];
      const m = scale[Math.floor(Math.random() * scale.length)];
      if (prog.bells && Math.random() < 0.45) this.bell(m - 12, this.nextChime, 0.05);
      else this.pluck(m, this.nextChime, 0.05 + Math.random() * 0.03, this.music, (Math.random() - 0.5) * 1.2);
      if (prog.sparkle) for (let i = 1; i < 4; i++) this.pluck(scale[(scale.indexOf(m) + i * 2) % scale.length], this.nextChime + i * 0.11, 0.025, this.music, (Math.random() - 0.5) * 1.6);
      if (Math.random() < 0.3) {
        const m2 = scale[Math.min(scale.length - 1, scale.indexOf(m) + 2)];
        this.pluck(m2, this.nextChime + 0.18, 0.04, this.music, (Math.random() - 0.5) * 1.2);
      }
      this.nextChime += 0.9 + Math.random() * 2.6;
    }
    const sp = Math.min(1.4, state.speed / 128);
    this.windFilter.frequency.setTargetAtTime(280 + sp * 1300, now, 0.3);
    this.windGain.gain.setTargetAtTime(0.025 + sp * 0.085 + (state.boosting ? 0.05 : 0), now, 0.25);
  }

  organVoice(midi, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + 1.2);
    g.gain.setValueAtTime(0.022, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    g.connect(f).connect(this.music);
    // stacked pipes: 8', 4' and a quiet 2 2/3' mixture
    for (const [mul, vol] of [[1, 1], [2, 0.55], [3, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(midi) * mul;
      const og = ctx.createGain();
      og.gain.value = vol * 0.5;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 2);
    }
  }

  /** Bell: inharmonic partials, long decay. */
  bell(midi, t, vol) {
    const ctx = this.ctx;
    const f = mtof(midi);
    for (const [ratio, amp, dec] of [[1, 1, 3.5], [2.76, 0.45, 2.2], [5.4, 0.25, 1.2], [0.5, 0.35, 4.5]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g);
      g.connect(this.music);
      g.connect(this.delay);
      o.start(t);
      o.stop(t + dec + 0.1);
    }
  }

  /** Ambient state: how much Borderland and dream surround the listener. */
  setAmbience(border, dream) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.borderGain.gain.setTargetAtTime(Math.min(1, border) * 0.07, now, 0.8);
    this.padFilter.frequency.setTargetAtTime(950 + dream * 1500, now, 2);
  }

  noiseBurst(t, dur, f0, f1, type, vol, dest = this.sfx) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** The end of a flight: a deep boom plus the voice of whatever was struck. */
  explosion(style) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    // sub boom
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 1.5);
    this.noiseBurst(t, 1.6, 1800, 60, 'lowpass', 0.9);
    const scale = (PROGRESSIONS[this.biome] || PROGRESSIONS[0]).scale;
    switch (style) {
      case 'crystal':
      case 'prism':
      case 'obsidian':
        for (let i = 0; i < 14; i++) this.pluck(scale[Math.floor(Math.random() * scale.length)] + 12, t + i * 0.035 + Math.random() * 0.05, 0.05, this.sfx, Math.random() * 2 - 1);
        this.noiseBurst(t, 0.8, 9000, 3000, 'highpass', 0.25);
        break;
      case 'splash':
      case 'mirror':
        this.noiseBurst(t, 1.8, 2400, 300, 'bandpass', 0.8);
        this.noiseBurst(t + 0.25, 1.2, 5000, 1200, 'highpass', 0.25);
        break;
      case 'wood':
        for (let i = 0; i < 6; i++) this.noiseBurst(t + i * 0.07 + Math.random() * 0.05, 0.12, 3000, 800, 'bandpass', 0.35);
        this.noiseBurst(t + 0.1, 2.5, 900, 200, 'bandpass', 0.25);
        break;
      case 'fire':
      case 'inferno':
      case 'ash':
        this.noiseBurst(t, 2.8, 1200, 120, 'lowpass', 0.6);
        for (let i = 0; i < 10; i++) this.noiseBurst(t + 0.2 + Math.random() * 2, 0.04, 4000, 2000, 'highpass', 0.15);
        break;
      case 'spores':
        this.noiseBurst(t, 1.5, 6000, 1500, 'bandpass', 0.2);
        for (let i = 0; i < 6; i++) this.pluck(scale[i % scale.length] + 12, t + i * 0.09, 0.04, this.sfx, (i % 2) * 1.4 - 0.7);
        break;
      case 'snow':
      case 'sand':
        this.noiseBurst(t, 2.2, 1600, 300, 'bandpass', 0.5);
        break;
      default:
        this.noiseBurst(t + 0.05, 2.0, 500, 60, 'lowpass', 0.7);
    }
    // a slow, mournful chord in the aftermath
    const chord = (PROGRESSIONS[this.biome] || PROGRESSIONS[0]).chords[this.chordIdx % 4];
    for (const m of chord) this.padVoice(m - 12, t + 0.6, 4, 0.035);
  }

  /** A survivable impact. */
  hit(style, damage) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = Math.min(1, damage / 50);
    this.noiseBurst(t, 0.35, 1400, 120, 'lowpass', 0.25 + 0.35 * v);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 + 0.3 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
    if (style === 'crystal' || style === 'prism') this.pluck(84 + Math.floor(Math.random() * 6), t, 0.08, this.sfx, 0);
    if (style === 'splash' || style === 'mirror') this.noiseBurst(t, 0.6, 3000, 600, 'bandpass', 0.3);
  }

  collect(combo, golden) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const scale = (PROGRESSIONS[this.biome] || PROGRESSIONS[0]).scale;
    const t = ctx.currentTime + 0.01;
    const i = Math.min(scale.length - 1, combo - 1);
    const base = scale[i] + (combo > scale.length ? 12 : 0);
    this.pluck(base, t, 0.16, this.sfx, 0);
    this.pluck(base + 7, t + 0.06, 0.08, this.sfx, 0.2);
    if (golden) {
      this.pluck(base + 12, t + 0.12, 0.1, this.sfx, -0.2);
      this.pluck(base + 19, t + 0.2, 0.08, this.sfx, 0.3);
    }
  }

  miss() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.45);
  }

  bump() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.5);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
  }

  whoosh() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.75);
  }

  regionSwell() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const scale = (PROGRESSIONS[this.biome] || PROGRESSIONS[0]).scale;
    const t = ctx.currentTime + 0.05;
    [0, 2, 4].forEach((k, i) => this.pluck(scale[k], t + i * 0.22, 0.07, this.music, (i - 1) * 0.5));
  }
}
