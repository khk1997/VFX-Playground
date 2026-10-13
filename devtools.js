/*
 * 開發者 HUD：FPS、frame time、draw call。
 * ?dev=1 開啟（記在 localStorage），?dev=0 關閉；Shift+D 切換顯示，Shift+F 換位置。
 * 沒開啟時什麼都不包；首頁預覽 iframe（?preview=1）一律不啟用。
 * 要在特效腳本之前載入，才包得到 requestAnimationFrame 與 WebGL 的 draw 呼叫。
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.has('preview')) return;

  const KEY = 'vfx-dev';
  const store = {
    get(name) { try { return localStorage.getItem(name); } catch (_) { return null; } },
    set(name, value) { try { localStorage.setItem(name, value); } catch (_) { /* 無痕模式 */ } },
    remove(name) { try { localStorage.removeItem(name); } catch (_) { /* 無痕模式 */ } },
  };

  if (params.get('dev') === '1') store.set(KEY, '1');
  if (params.get('dev') === '0') store.remove(KEY);
  const enabled = store.get(KEY) === '1';

  const isTyping = target => target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  // 沒啟用時只留一個快捷鍵：開啟後重新載入，讓 hook 從頭裝上。
  if (!enabled) {
    addEventListener('keydown', event => {
      if (!event.shiftKey || event.code !== 'KeyD' || isTyping(event.target)) return;
      store.set(KEY, '1');
      location.reload();
    });
    return;
  }

  // ---- 量測 ----
  const SAMPLE_SIZE = 240;
  const intervals = [];   // 實際「有畫東西」的幀之間的間隔（ms）
  const cpuTimes = [];    // 這些幀裡 rAF callback 花掉的 JS 時間（ms）
  let lastFrameStamp = 0;
  let lastRenderedStamp = 0;
  let frameCpu = 0;
  let frameDraws = 0;
  let framePrims = 0;
  let renderedInWindow = 0;
  let drawsInWindow = 0;
  let primsInWindow = 0;

  // 記下頁面開過哪些 context：只有 2D canvas 的頁面沒有 draw call 可數。
  const contextKinds = new Set();
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = nativeGetContext.call(this, kind, ...rest);
    if (ctx) contextKinds.add(/webgl/.test(kind) ? 'webgl' : kind);
    return ctx;
  };

  const push = (list, value) => {
    list.push(value);
    if (list.length > SAMPLE_SIZE) list.shift();
  };

  // 有些特效閒置時會自己跳幀省電（例如 bubble），rAF 照跑但沒畫東西。
  // WebGL 頁面只把真的有 draw call 的幀算進 FPS，量到的才是畫面實際的更新率。
  const finishFrame = () => {
    const rendered = !contextKinds.has('webgl') || frameDraws > 0;
    if (rendered) {
      if (lastRenderedStamp) {
        push(intervals, lastFrameStamp - lastRenderedStamp);
        push(cpuTimes, frameCpu);
      }
      lastRenderedStamp = lastFrameStamp;
      renderedInWindow++;
      drawsInWindow += frameDraws;
      primsInWindow += framePrims;
    }
    frameCpu = frameDraws = framePrims = 0;
  };

  // 同一個 rAF timestamp 只算一幀（一幀裡可能有好幾個 callback）。
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => nativeRAF(stamp => {
    if (stamp !== lastFrameStamp) {
      if (lastFrameStamp) finishFrame();
      lastFrameStamp = stamp;
    }
    const start = performance.now();
    try {
      callback(stamp);
    } finally {
      frameCpu += performance.now() - start;
    }
  });

  const PRIMS = { 0: 1, 1: 2, 2: 1, 3: 1, 4: 3, 5: 1, 6: 1 }; // 每個 primitive 用掉的頂點數（POINTS…TRIANGLE_FAN）
  const primitiveCount = (mode, count) => {
    if (mode === 4) return count / 3;
    if (mode === 5 || mode === 6) return Math.max(0, count - 2);
    if (mode === 1) return count / 2;
    return count / (PRIMS[mode] || 1);
  };

  const hookDraws = (proto, name, countArg, instanceArg) => {
    const original = proto && proto[name];
    if (!original) return;
    proto[name] = function (...args) {
      frameDraws++;
      framePrims += primitiveCount(args[0], args[countArg]) * (instanceArg ? args[instanceArg] : 1);
      return original.apply(this, args);
    };
  };

  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    hookDraws(proto, 'drawArrays', 2);
    hookDraws(proto, 'drawElements', 1);
  }
  hookDraws(window.WebGL2RenderingContext?.prototype, 'drawArraysInstanced', 2, 3);
  hookDraws(window.WebGL2RenderingContext?.prototype, 'drawElementsInstanced', 1, 4);
  hookDraws(window.WebGL2RenderingContext?.prototype, 'drawRangeElements', 3);
  // WebGL1 的 instancing 走 ANGLE_instanced_arrays 擴充。
  const nativeGetExtension = window.WebGLRenderingContext?.prototype.getExtension;
  if (nativeGetExtension) {
    window.WebGLRenderingContext.prototype.getExtension = function (name) {
      const ext = nativeGetExtension.call(this, name);
      if (ext && name === 'ANGLE_instanced_arrays' && !ext.__vfxDevHooked) {
        const proto = Object.getPrototypeOf(ext);
        hookDraws(proto, 'drawArraysInstancedANGLE', 2, 3);
        hookDraws(proto, 'drawElementsInstancedANGLE', 1, 4);
        ext.__vfxDevHooked = true;
      }
      return ext;
    };
  }

  // ---- HUD ----
  // 預設放頂端中間：各頁的「首頁」和右上按鈕之間通常是空的，左右兩側都有面板。
  const CORNERS = ['tc', 'bc', 'bl', 'br', 'tr', 'tl'];
  let corner = CORNERS.includes(store.get('vfx-dev-corner')) ? store.get('vfx-dev-corner') : 'tc';
  let visible = store.get('vfx-dev-hidden') !== '1';

  const style = document.createElement('style');
  style.textContent = `
    #vfxDevHud {
      position: fixed; z-index: 2147483000; pointer-events: none;
      font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #d8dee9; background: rgba(8, 10, 14, .62);
      padding: 4px 8px; border-radius: 6px; white-space: nowrap;
      font-variant-numeric: tabular-nums; letter-spacing: .01em;
    }
    #vfxDevHud[data-corner="tc"] { left: 50%; top: 10px; transform: translateX(-50%); }
    #vfxDevHud[data-corner="bc"] { left: 50%; bottom: 10px; transform: translateX(-50%); }
    #vfxDevHud[data-corner="bl"] { left: 10px; bottom: 10px; }
    #vfxDevHud[data-corner="br"] { right: 10px; bottom: 10px; }
    #vfxDevHud[data-corner="tr"] { right: 10px; top: 10px; }
    #vfxDevHud[data-corner="tl"] { left: 10px; top: 10px; }
    #vfxDevHud[hidden] { display: none; }
    #vfxDevHud .warn { color: #ffd166; }
    #vfxDevHud .bad { color: #ff6b6b; }
    #vfxDevHud .dim { color: #8a93a3; }
  `;

  const hud = document.createElement('div');
  hud.id = 'vfxDevHud';
  hud.setAttribute('aria-hidden', 'true');

  const mount = () => {
    document.head.appendChild(style);
    document.body.appendChild(hud);
    hud.dataset.corner = corner;
    hud.hidden = !visible;
  };
  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });

  const fpsClass = fps => (fps < 30 ? 'bad' : fps < 50 ? 'warn' : '');
  const percentile = (list, p) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const average = list => list.reduce((sum, v) => sum + v, 0) / list.length;
  const span = (text, cls) => (cls ? `<span class="${cls}">${text}</span>` : text);
  const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

  const stats = {};
  const UPDATE_MS = 400;
  setInterval(() => {
    const frames = renderedInWindow;
    if (frames) {
      stats.drawCalls = drawsInWindow / frames;
      stats.primitives = primsInWindow / frames;
    }
    renderedInWindow = drawsInWindow = primsInWindow = 0;
    stats.idle = !frames;

    if (intervals.length < 2) {
      if (visible) hud.innerHTML = span('等待畫面…', 'dim');
      return;
    }
    // 這段時間一幀都沒畫：特效在休眠或暫停，舊數字留著會誤導，直接標出來。
    if (stats.idle) {
      if (visible) hud.innerHTML = span('閒置／暫停中', 'dim');
      return;
    }
    // 只看最近約 1 秒算平均，1% low 和最差一幀看整個樣本視窗。
    const recent = intervals.slice(-60);
    stats.fps = 1000 / average(recent);
    stats.frameMs = average(recent);
    stats.low1 = 1000 / percentile(intervals, .99);
    stats.worstMs = Math.max(...intervals);
    stats.cpuMs = average(cpuTimes.slice(-60));

    if (!visible) return;
    hud.innerHTML = [
      span(`${stats.fps.toFixed(0)}fps`, fpsClass(stats.fps)),
      span(`1%low ${stats.low1.toFixed(0)}`, fpsClass(stats.low1)),
      `${stats.frameMs.toFixed(1)}ms`,
      span(`max ${stats.worstMs.toFixed(0)}ms`, stats.worstMs > 50 ? 'bad' : stats.worstMs > 25 ? 'warn' : 'dim'),
      `js ${stats.cpuMs.toFixed(1)}ms`,
      ...(contextKinds.has('webgl')
        ? [`${stats.drawCalls.toFixed(0)}dc`, `${compact(stats.primitives)}tri`]
        : [span(contextKinds.has('2d') ? 'canvas2d' : 'no-gl', 'dim')]),
    ].join(span(' · ', 'dim'));
  }, UPDATE_MS);

  addEventListener('keydown', event => {
    if (!event.shiftKey || isTyping(event.target)) return;
    if (event.code === 'KeyD') {
      visible = !visible;
      hud.hidden = !visible;
      if (visible) store.remove('vfx-dev-hidden');
      else store.set('vfx-dev-hidden', '1');
    } else if (event.code === 'KeyF') {
      corner = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
      hud.dataset.corner = corner;
      store.set('vfx-dev-corner', corner);
    }
  });

  // 給之後的抽屜／bug report／自動化測試讀。
  window.__vfxDev = { stats };
})();
