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
      const m = scale[Math.floor(Math.random() * scale.length)];
      this.pluck(m, this.nextChime, 0.05 + Math.random() * 0.03, this.music, (Math.random() - 0.5) * 1.2);
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
