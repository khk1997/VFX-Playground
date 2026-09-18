/*
 * Lightweight scheduler for homepage preview iframes.
 * It is a no-op on full effect pages and only activates for ?preview=1.
 */
(() => {
  'use strict';

  if (!new URLSearchParams(location.search).has('preview')) return;

  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCancelRAF = window.cancelAnimationFrame.bind(window);
  const nativeDpr = window.devicePixelRatio || 1;
  const jobs = new Map();
  let nextJobId = 1;
  let targetFps = 30;
  let paused = false;
  let dprCap = 1.5;
  let lastFrameAt = performance.now();

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => Math.min(nativeDpr, dprCap),
    });
  } catch (_) {
    // Some browsers expose a non-configurable DPR; FPS throttling still works.
  }

  window.requestAnimationFrame = callback => {
    const id = nextJobId++;
    const effectiveFps = paused ? 4 : targetFps;
    const interval = 1000 / Math.max(1, effectiveFps);
    const delay = Math.max(0, interval - (performance.now() - lastFrameAt));
    const job = { timeout: 0, raf: 0 };

    job.timeout = setTimeout(() => {
      if (!jobs.has(id)) return;
      job.raf = nativeRAF(timestamp => {
        if (!jobs.has(id)) return;
        jobs.delete(id);
        lastFrameAt = timestamp;
        callback(timestamp);
      });
    }, delay);

    jobs.set(id, job);
    return id;
  };

  window.cancelAnimationFrame = id => {
    const job = jobs.get(id);
    if (!job) return;
    clearTimeout(job.timeout);
    if (job.raf) nativeCancelRAF(job.raf);
    jobs.delete(id);
  };

  addEventListener('message', event => {
    if (event.data === 'vfx-pause') {
      paused = true;
      return;
    }
    if (event.data === 'vfx-play') {
      paused = false;
      return;
    }
    if (!event.data || event.data.type !== 'vfx-quality') return;

    if (Number.isFinite(event.data.fps)) {
      targetFps = Math.max(12, Math.min(60, event.data.fps));
    }

    if (Number.isFinite(event.data.dpr)) {
      // 上限放到 2.5：首頁的大卡片會把 660×570 的畫面放大到 1090px 以上，
      // 卡在 1.5 的話送過來的需求會被砍掉，畫面就是被放大的鋸齒。
      const nextDprCap = Math.max(0.75, Math.min(2.5, event.data.dpr));
      if (Math.abs(nextDprCap - dprCap) > .01) {
        dprCap = nextDprCap;
        nativeRAF(() => dispatchEvent(new Event('resize')));
      }
    }
  });

  window.__vfxPreviewPerf = {
    get fps() { return paused ? 4 : targetFps; },
    get dpr() { return Math.min(nativeDpr, dprCap); },
    get paused() { return paused; },
  };
})();
