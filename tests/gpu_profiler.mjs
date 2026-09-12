import assert from 'node:assert/strict';
import { createGpuProfiler, summarizeGpuSamples } from '../bubble/gpu-profiler.js';

assert.deepEqual(summarizeGpuSamples([4, 1, 3, 2]), {
  samples: 4, medianMs: 3, p95Ms: 4, minMs: 1, maxMs: 4,
});

let nextQuery = 0;
const results = [2_000_000, 4_000_000, 6_000_000];
const gl = {
  QUERY_RESULT_AVAILABLE: 1,
  QUERY_RESULT: 2,
  getExtension: name => name === 'EXT_disjoint_timer_query_webgl2'
    ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
  createQuery: () => ({ index: nextQuery++ }),
  beginQuery() {}, endQuery() {}, deleteQuery() {},
  getParameter: () => false,
  getQueryParameter: (query, key) => key === 1 ? true : results[query.index],
};
const profiler = createGpuProfiler(gl);
assert.equal(profiler.supported, true);
const pending = profiler.measure({ samples: 2, warmup: 1 });
for (let i = 0; i < 4; i++) { profiler.beginFrame(); profiler.endFrame(); }
const measured = await pending;
assert.equal(measured.samples, 2);
assert.equal(measured.medianMs, 6);
assert.equal(measured.minMs, 4);

const unsupported = createGpuProfiler({ getExtension: () => null });
assert.deepEqual(await unsupported.measure(), {
  supported: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable',
});
console.log('GPU timer query lifecycle and sample summary passed');
