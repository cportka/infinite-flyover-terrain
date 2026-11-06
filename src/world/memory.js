// WorldMemory: which generation ("epoch") owns each epoch cell, and how long
// the world remembers it.
//
// - Cells near anything loaded are pinned and never change while pinned, so
//   meshes stay consistent.
// - Unpinned cells are forgotten after `memorySeconds`.
// - When the flyer re-enters ground it has forgotten, a new epoch begins:
//   that land is generated anew, and where it meets still-remembered land the
//   two worlds blend into a Borderland.
// - Unexplored ground simply continues the current epoch, so flying onwards
//   never produces seams.

const SUPER = 4; // super cell = 4x4 epoch cells (~2 km) for "have I been here?"

function cellKey(ix, iz) {
  return (ix + 1048576) * 2097152 + (iz + 1048576);
}

export class WorldMemory {
  constructor({ memorySeconds = 40, maxCells = 6000 } = {}) {
    this.memorySeconds = memorySeconds;
    this.maxCells = maxCells;
    this.cells = new Map(); // key -> { e, born, t }
    this.visited = new Map(); // super key -> { e, t }
    this.epoch = 0;
    this.now = 0;
    this.events = [];
    this.assignHook = null; // debug: (ix, iz) => epoch | undefined
  }

  /** Epoch of a cell, assigning one if the cell is not (or no longer) remembered. */
  epochOf(ix, iz) {
    const k = cellKey(ix, iz);
    const c = this.cells.get(k);
    if (c) return c.e;
    const sk = cellKey(Math.floor(ix / SUPER), Math.floor(iz / SUPER));
    const v = this.visited.get(sk);
    if (v && v.e === this.epoch && this.now - v.t > this.memorySeconds) {
      // we have been here before and forgotten it: the world renews itself
      this.epoch++;
      this.events.push({ type: 'epoch', epoch: this.epoch, at: this.now });
    }
    this.visited.set(sk, { e: this.epoch, t: this.now });
    const e = (this.assignHook && this.assignHook(ix, iz)) ?? this.epoch;
    this.cells.set(k, { e, born: this.now, t: this.now });
    return e;
  }

  /** Keep a cell (and its super cell) remembered. */
  pin(ix, iz) {
    const k = cellKey(ix, iz);
    let c = this.cells.get(k);
    if (!c) {
      this.epochOf(ix, iz);
      c = this.cells.get(k);
    }
    c.t = this.now;
    const sk = cellKey(Math.floor(ix / SUPER), Math.floor(iz / SUPER));
    const v = this.visited.get(sk);
    if (v) v.t = Math.max(v.t, this.now);
  }

  /** Pin the 3x3 block around a cell. */
  pinBlock(ix, iz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.pin(ix + dx, iz + dz);
  }

  /** Epochs of the 3x3 block around (ix, iz), row-major from (-1,-1). */
  block(ix, iz, out = new Array(9)) {
    let i = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out[i++] = this.epochOf(ix + dx, iz + dz);
    return out;
  }

  /** Forget cells that have not been pinned recently. Call after pinning everything live. */
  tick(now) {
    this.now = now;
    const limit = now - this.memorySeconds;
    for (const [k, c] of this.cells) {
      if (c.t < limit) this.cells.delete(k);
    }
    if (this.cells.size > this.maxCells) {
      const arr = [...this.cells.entries()].sort((a, b) => a[1].t - b[1].t);
      for (let i = 0; i < arr.length - this.maxCells; i++) this.cells.delete(arr[i][0]);
    }
  }

  /** How long ago the world first generated this cell (undefined if not remembered). */
  ageOf(ix, iz) {
    const c = this.cells.get(cellKey(ix, iz));
    return c ? this.now - c.born : undefined;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
