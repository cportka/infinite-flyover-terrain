// Unified input: keyboard, pointer-drag virtual joystick (mouse + touch), gamepad.

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.steer = { x: 0, y: 0 };
    this.boost = false;
    this.invertY = false;
    this.lastActive = -Infinity;
    this.enabled = false;
    this.pointer = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
    this.touchBoost = false;
    this.handlers = {};
    this._bind();
  }

  _bind() {
    const now = () => performance.now();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k) && this.enabled) e.preventDefault();
      if (!this.keys.has(k)) {
        this.keys.add(k);
        this.handlers.key?.(k, e);
      }
      this.lastActive = now();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointer.id = null;
      this.touchBoost = false;
    });

    const el = this.target;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.pointer.id !== null) {
        // a second finger boosts
        if (e.pointerType === 'touch') this.touchBoost = true;
        return;
      }
      this.pointer.id = e.pointerId;
      this.pointer.x0 = this.pointer.x = e.clientX;
      this.pointer.y0 = this.pointer.y = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.lastActive = now();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointer.id) return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.lastActive = now();
    });
    const up = (e) => {
      if (e.pointerId === this.pointer.id) this.pointer.id = null;
      else if (e.pointerType === 'touch') this.touchBoost = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  /** Is the player actively steering right now (or very recently)? */
  activeWithin(ms) {
    return performance.now() - this.lastActive < ms;
  }

  update() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    let boost = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBoost;

    if (this.pointer.id !== null) {
      const r = Math.min(window.innerWidth, window.innerHeight) * 0.16;
      const dx = (this.pointer.x - this.pointer.x0) / r;
      const dy = (this.pointer.y - this.pointer.y0) / r;
      x += Math.max(-1, Math.min(1, dx));
      y -= Math.max(-1, Math.min(1, dy));
    }

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      if (dz(ax) || dz(ay)) this.lastActive = performance.now();
      x += dz(ax);
      y -= dz(ay);
      const b = p.buttons;
      if ((b[0] && b[0].pressed) || (b[7] && b[7].value > 0.3) || (b[5] && b[5].pressed)) {
        boost = true;
        this.lastActive = performance.now();
      }
    }

    if (this.invertY) y = -y;
    this.steer.x = Math.max(-1, Math.min(1, x));
    this.steer.y = Math.max(-1, Math.min(1, y));
    this.boost = boost;
    if (x !== 0 || y !== 0 || boost) this.lastActive = Math.max(this.lastActive, performance.now() - 1);
  }
}
