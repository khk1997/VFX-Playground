export function summarizeGpuSamples(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return {
    samples: sorted.length,
    medianMs: pick(0.5),
    p95Ms: pick(0.95),
    minMs: sorted[0] ?? null,
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

export function createGpuProfiler(gl) {
  const extension = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  let active = null;
  let pending = null;
  let measuring = false;

  function finish(result) {
    const current = active;
    active = null;
    measuring = false;
    if (pending) {
      gl.deleteQuery(pending);
      pending = null;
    }
    current?.resolve(result);
  }

  function poll() {
    if (!pending || !active) return;
    if (!gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
    const nanoseconds = gl.getQueryParameter(pending, gl.QUERY_RESULT);
    gl.deleteQuery(pending);
    pending = null;
    if (!disjoint && Number.isFinite(nanoseconds)) {
      if (active.warmup > 0) active.warmup--;
      else active.samples.push(nanoseconds / 1e6);
    } else {
      active.disjointSamples++;
    }
    if (active.samples.length >= active.target) {
      finish({ supported: true, disjointSamples: active.disjointSamples, ...summarizeGpuSamples(active.samples) });
    }
  }

  function beginFrame() {
    poll();
    if (!extension || !active || pending || measuring) return;
    pending = gl.createQuery();
    gl.beginQuery(extension.TIME_ELAPSED_EXT, pending);
    measuring = true;
  }

  function endFrame() {
    if (!measuring) return;
    gl.endQuery(extension.TIME_ELAPSED_EXT);
    measuring = false;
  }

  function measure({ samples = 16, warmup = 3 } = {}) {
    if (!extension) return Promise.resolve({ supported: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' });
    if (active) return Promise.reject(new Error('GPU profiling is already active'));
    return new Promise(resolve => {
      active = {
        target: Math.max(1, Math.min(120, Math.round(samples))),
        warmup: Math.max(0, Math.min(30, Math.round(warmup))),
        samples: [],
        disjointSamples: 0,
        resolve,
      };
    });
  }

  return { supported: Boolean(extension), beginFrame, endFrame, measure, poll };
}
