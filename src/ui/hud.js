// DOM HUD: quiet status, region toasts, whispers, the eulogy, and (in glider
// mode) score, combo, hull and boost.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      loading: $('loading'),
      loadBar: $('load-bar'),
      loadHint: $('load-hint'),
      titlecard: $('titlecard'),
      hud: $('hud'),
      score: $('hud-score'),
      combo: $('hud-combo'),
      comboN: $('hud-combo-n'),
      health: $('hud-health'),
      boost: $('hud-boost'),
      dist: $('st-dist'),
      clock: $('st-clock'),
      toast: $('region-toast'),
      regionName: $('region-name'),
      regionTag: $('region-tag'),
      whisper: $('whisper'),
      eulogy: $('eulogy'),
      eulogyLine: $('eulogy-line'),
      eulogySub: $('eulogy-sub'),
      popups: $('popups'),
      autopilot: $('autopilot-badge'),
      pause: $('pause'),
      error: $('error'),
      errorMsg: $('error-msg'),
      sound: $('btn-sound'),
      game: $('btn-game'),
      soundHint: $('sound-hint'),
      best: $('best-line'),
      seed: $('seed-val'),
    };
    this.shown = { score: -1, combo: -1, dist: '', clock: '', boost: -1, health: -1, auto: null };
    this.displayScore = 0;
    this.toastTimer = 0;
    this.whisperTimer = 0;
    this.eulogyTimer = 0;
    this.hints = ['Raising mountains…', 'Carving rivers…', 'Planting forests…', 'Growing crystals…', 'Remembering…', 'Painting the sky…'];
  }

  setLoading(p) {
    this.el.loadBar.style.width = `${Math.round(p * 100)}%`;
    const h = this.hints[Math.min(this.hints.length - 1, Math.floor(p * this.hints.length))];
    if (this.el.loadHint.textContent !== h) this.el.loadHint.textContent = h;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  /** The opening title: fades in over the flyover, then gently away. */
  titleCard(holdMs = 6500) {
    const t = this.el.titlecard;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), holdMs);
  }

  setGameHUD(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.game.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('gaming', on);
  }

  setSound(on) {
    this.el.sound.setAttribute('aria-pressed', String(on));
    if (on) this.el.soundHint.classList.add('gone');
  }

  hideSoundHint() {
    this.el.soundHint.classList.add('gone');
  }

  showPause(show) {
    this.el.pause.classList.toggle('hidden', !show);
  }

  showError(msg) {
    if (msg) this.el.errorMsg.textContent = msg;
    this.el.error.classList.remove('hidden');
    this.el.loading.classList.add('hidden');
  }

  setSeed(seed) {
    this.el.seed.textContent = String(seed);
  }

  setBest(best) {
    this.el.best.textContent = best > 0 ? `best flight ${best.toLocaleString()}` : 'no flights yet';
  }

  update(dt, s) {
    const dist = `${(s.distance / 1000).toFixed(1)} km`;
    if (dist !== this.shown.dist) {
      this.shown.dist = dist;
      this.el.dist.textContent = dist;
    }
    if (s.clock !== this.shown.clock) {
      this.shown.clock = s.clock;
      this.el.clock.textContent = s.clock;
    }
    if (s.game) {
      this.displayScore += (s.score - this.displayScore) * Math.min(1, dt * 8);
      if (Math.abs(s.score - this.displayScore) < 1) this.displayScore = s.score;
      const sc = Math.round(this.displayScore);
      if (sc !== this.shown.score) {
        this.shown.score = sc;
        this.el.score.textContent = sc.toLocaleString();
      }
      if (s.combo !== this.shown.combo) {
        const up = s.combo > this.shown.combo;
        this.shown.combo = s.combo;
        this.el.comboN.textContent = String(s.combo);
        this.el.combo.classList.toggle('dim', s.combo <= 1);
        if (up && s.combo > 1) {
          this.el.combo.classList.remove('pop');
          void this.el.combo.offsetWidth;
          this.el.combo.classList.add('pop');
        }
      }
      const b = Math.round(s.boost * 200) / 200;
      if (b !== this.shown.boost) {
        this.shown.boost = b;
        this.el.boost.style.transform = `scaleX(${b})`;
      }
      this.el.boost.classList.toggle('active', !!s.boosting);
      const h = Math.round(s.health) / 100;
      if (h !== this.shown.health) {
        this.shown.health = h;
        this.el.health.style.transform = `scaleX(${Math.max(0, h)})`;
        this.el.health.classList.toggle('low', h < 0.3);
      }
      if (s.autopilot !== this.shown.auto) {
        this.shown.auto = s.autopilot;
        this.el.autopilot.classList.toggle('show', !!s.autopilot);
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    if (this.whisperTimer > 0) {
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0) this.el.whisper.classList.remove('show');
    }
    if (this.eulogyTimer > 0) {
      this.eulogyTimer -= dt;
      if (this.eulogyTimer <= 0) this.el.eulogy.classList.remove('show');
    }
  }

  region(name, tagline, kind = '') {
    if (this.eulogyTimer > 0) return; // never talk over a eulogy
    this.el.regionName.textContent = name;
    this.el.regionTag.textContent = tagline;
    this.el.toast.classList.toggle('border', kind === 'border');
    this.el.toast.classList.add('show');
    this.toastTimer = 5;
  }

  whisper(text, seconds = 5) {
    this.el.whisper.textContent = text;
    this.el.whisper.classList.add('show');
    this.whisperTimer = seconds;
  }

  eulogy(line, sub) {
    this.el.eulogyLine.textContent = line;
    this.el.eulogySub.textContent = sub;
    this.el.eulogy.classList.add('show');
    this.eulogyTimer = 3.4;
    // a eulogy owns the screen: let the region toast and whispers fall silent
    this.el.toast.classList.remove('show');
    this.toastTimer = 0;
    this.el.whisper.classList.remove('show');
    this.whisperTimer = 0;
  }

  popup(x, y, text, kind = '') {
    const d = document.createElement('div');
    d.className = `popup ${kind}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }
}
