// Web worker: generates chunk geometry off the main thread.
import { createWorld } from './terrain.js';
import { buildChunk } from './chunkBuilder.js';

let world = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    world = createWorld(msg.seed);
    return;
  }
  if (msg.type === 'gen') {
    if (!world) world = createWorld(msg.seed ?? 1);
    try {
      const out = buildChunk(world, msg.cx, msg.cz, msg.lod, msg.density);
      const { transfer, ...data } = out;
      self.postMessage({ type: 'chunk', id: msg.id, key: msg.key, ...data }, transfer);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, key: msg.key, message: String(err && err.stack ? err.stack : err) });
    }
  }
};
