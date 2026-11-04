// DOM HUD: score, combo, distance, clock, boost meter, region toasts and popups.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      loading: $('loading'),
      loadBar: $('load-bar'),
      loadHint: $('load-hint'),
      title: $('title'),
      hud: $('hud'),
      score: $('hud-score'),
      combo: $('hud-combo'),
      comboN: $('hud-combo-n'),
      dist: $('hud-dist'),
      clock: $('hud-clock'),
      clockIcon: $('hud-clock-icon'),
      boost: $('hud-boost'),
      toast: $('region-toast'),
      regionName: $('region-name'),
      regionTag: $('region-tag'),
      popups: $('popups'),
      autopilot: $('autopilot-badge'),
      pause: $('pause'),
      error: $('error'),
      errorMsg: $('error-msg'),
      sound: $('btn-sound'),
      best: $('best-line'),
      zenExit: $('zen-exit'),
      boostBtn: $('boost-btn'),
      seed: $('seed-val'),
    };
    this.shown = { score: -1, combo: -1, dist: '', clock: '', boost: -1, auto: null };
    this.displayScore = 0;
    this.toastTimer = 0;
    this.hints = ['Raising mountains…', 'Carving valleys…', 'Planting forests…', 'Growing crystals…', 'Filling rivers…', 'Painting the sky…'];
  }

  setLoading(p) {
    this.el.loadBar.style.width = `${Math.round(p * 100)}%`;
    const h = this.hints[Math.min(this.hints.length - 1, Math.floor(p * this.hints.length))];
    if (this.el.loadHint.textContent !== h) this.el.loadHint.textContent = h;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  showTitle(show) {
    this.el.title.classList.toggle('hidden', !show);
  }

  showHUD(show) {
    this.el.hud.classList.toggle('hidden', !show);
  }

  setZen(zen) {
    this.el.hud.classList.toggle('zen', zen);
    this.el.zenExit.classList.toggle('hidden', !zen);
  }

  setPhoto(on) {
    this.el.hud.classList.toggle('photo', on);
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
    this.el.best.textContent = best > 0 ? `Best flight — ${best.toLocaleString()} points` : '';
  }

  setSound(on) {
    this.el.sound.classList.toggle('off', !on);
  }

  update(dt, s) {
    // score counts up smoothly
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
    const dist = `${(s.distance / 1000).toFixed(1)} km`;
    if (dist !== this.shown.dist) {
      this.shown.dist = dist;
      this.el.dist.textContent = dist;
    }
    if (s.clock !== this.shown.clock) {
      this.shown.clock = s.clock;
      this.el.clock.textContent = s.clock;
      this.el.clockIcon.textContent = s.night > 0.5 ? '☾' : '☀';
    }
    const b = Math.round(s.boost * 200) / 200;
    if (b !== this.shown.boost) {
      this.shown.boost = b;
      this.el.boost.style.transform = `scaleX(${b})`;
    }
    this.el.boost.classList.toggle('active', !!s.boosting);
    if (s.autopilot !== this.shown.auto) {
      this.shown.auto = s.autopilot;
      this.el.autopilot.classList.toggle('show', !!s.autopilot);
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  region(name, tagline) {
    this.el.regionName.textContent = name;
    this.el.regionTag.textContent = tagline;
    this.el.toast.classList.add('show');
    this.toastTimer = 4.5;
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
