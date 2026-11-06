// Web worker: generates chunk geometry off the main thread.
// Each request carries the 3x3 epoch neighbourhood decided by the main thread's
// WorldMemory, so every worker builds exactly the same world.
import { buildChunk } from './chunkBuilder.js';
import { makeGenerationCache } from './world.js';

let getGen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    getGen = makeGenerationCache(msg.seed, 10);
    return;
  }
  if (msg.type === 'gen') {
    if (!getGen) getGen = makeGenerationCache(msg.seed ?? 1, 10);
    try {
      const out = buildChunk(getGen, msg.epochs, msg.cx, msg.cz, msg.lod, msg.density);
      const { transfer, ...data } = out;
      self.postMessage({ type: 'chunk', id: msg.id, key: msg.key, ...data }, transfer);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, key: msg.key, message: String(err && err.stack ? err.stack : err) });
    }
  }
};
