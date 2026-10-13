/*
 * 開發者 HUD：FPS、frame time、draw call。
 * ?dev=1 開啟（記在 localStorage），?dev=0 關閉。
 * Shift+D 顯示／隱藏　Shift+F 換位置　Shift+G 展開詳細資訊　Shift+R 強制 DPR=1（會重新載入）
 * 沒開啟時什麼都不包。首頁預覽 iframe（?preview=1）裡只量不顯示，數字交給首頁讀。
 * 沒有自己動畫迴圈的頁面（首頁）呼叫 __vfxDev.mode('page')，改由 HUD 自己跑探測迴圈量主執行緒。
 * 要在特效腳本之前載入，才包得到 requestAnimationFrame 與 WebGL 的 draw 呼叫。
 *
 * 特效自己的數值用 window.__vfxDev?.watch({ 標籤: () => 值 }) 登記，展開（Shift+G）
 * 時每次更新讀一次。沒開開發者模式時 __vfxDev 不存在，那一行什麼都不做。
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const headless = params.has('preview');

  const KEY = 'vfx-dev';
  const store = {
    get(name) { try { return localStorage.getItem(name); } catch (_) { return null; } },
    set(name, value) { try { localStorage.setItem(name, value); } catch (_) { /* 無痕模式 */ } },
    remove(name) { try { localStorage.removeItem(name); } catch (_) { /* 無痕模式 */ } },
  };

  if (!headless && params.get('dev') === '1') store.set(KEY, '1');
  if (!headless && params.get('dev') === '0') store.remove(KEY);
  const enabled = store.get(KEY) === '1';

  const isTyping = target => target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  // 沒啟用時只留一個快捷鍵：開啟後重新載入，讓 hook 從頭裝上。
  if (!enabled) {
    if (headless) return;
    addEventListener('keydown', event => {
      if (!event.shiftKey || event.code !== 'KeyD' || isTyping(event.target)) return;
      store.set(KEY, '1');
      location.reload();
    });
    return;
  }

  // 強制 DPR=1：快速判斷瓶頸是不是像素填充量。特效大多在載入當下讀 DPR
  // （bubble 的 deviceMaxDpr 就是），所以切換一律重新載入，從頭生效。
  // 預覽 iframe 的 DPR 歸首頁管（preview-performance.js），這裡不插手。
  const forceDpr1 = !headless && store.get('vfx-dev-dpr1') === '1';
  const nativeDpr = window.devicePixelRatio || 1;
  if (forceDpr1) {
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
    } catch (_) { /* 有些瀏覽器的 DPR 不可覆寫 */ }
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
    if (ctx && kind === 'webgl2') watchGpu(ctx);
    return ctx;
  };

  // ---- GPU 時間（EXT_disjoint_timer_query_webgl2）----
  // 每幀第一個 draw 時開一個 TIME_ELAPSED query，下一幀開頭收掉；結果晚幾幀才回來。
  // 同一時間一個 context 只能有一個 TIME_ELAPSED query，特效自己要量的時候
  // （bubble 的 gpu-profiler.js）這裡就讓開，不搶。Safari 沒有這個擴充，顯示 n/a。
  const gpuTimes = [];
  const gpuStates = new Map();
  const gl2 = window.WebGL2RenderingContext?.prototype;
  const nativeBeginQuery = gl2?.beginQuery;
  const nativeEndQuery = gl2?.endQuery;

  function watchGpu(gl) {
    if (gpuStates.has(gl)) return;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    gpuStates.set(gl, ext ? { ext, ours: null, pending: [], appActive: false } : null);
  }

  const gpuBegin = gl => {
    const st = gpuStates.get(gl);
    if (!st || st.ours || st.appActive || st.pending.length > 4) return;
    st.ours = gl.createQuery();
    nativeBeginQuery.call(gl, st.ext.TIME_ELAPSED_EXT, st.ours);
  };

  const gpuEndFrame = () => {
    for (const [gl, st] of gpuStates) {
      if (!st) continue;
      if (st.ours) {
        nativeEndQuery.call(gl, st.ext.TIME_ELAPSED_EXT);
        st.pending.push(st.ours);
        st.ours = null;
      }
      while (st.pending.length && gl.getQueryParameter(st.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = st.pending.shift();
        const disjoint = gl.getParameter(st.ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        gl.deleteQuery(query);
        if (!disjoint && Number.isFinite(ns)) push(gpuTimes, ns / 1e6);
      }
    }
  };

  if (gl2 && nativeBeginQuery) {
    gl2.beginQuery = function (target, query) {
      const st = gpuStates.get(this);
      if (st && target === st.ext.TIME_ELAPSED_EXT) {
        // 特效要開自己的 query：先把我們這幀的收掉、丟棄，讓它的量測成立。
        if (st.ours) {
          nativeEndQuery.call(this, target);
          this.deleteQuery(st.ours);
          st.ours = null;
        }
        st.appActive = true;
      }
      return nativeBeginQuery.call(this, target, query);
    };
    gl2.endQuery = function (target) {
      const st = gpuStates.get(this);
      if (st && target === st.ext.TIME_ELAPSED_EXT) st.appActive = false;
      return nativeEndQuery.call(this, target);
    };
  }

  // ---- 資源計數 ----
  // 建立減掉刪除＝目前活著的數量。切換模式、改參數之後只增不減，就是洩漏。
  const resources = { texture: 0, buffer: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0, vao: 0 };
  const live = new WeakSet();
  const hookResource = (proto, type, key) => {
    const create = proto?.[`create${type}`];
    const remove = proto?.[`delete${type}`];
    if (!create || !remove) return;
    proto[`create${type}`] = function (...args) {
      const obj = create.apply(this, args);
      if (obj) { live.add(obj); resources[key]++; }
      return obj;
    };
    proto[`delete${type}`] = function (obj) {
      if (obj && live.has(obj)) { live.delete(obj); resources[key]--; }
      return remove.call(this, obj);
    };
  };
  for (const proto of [window.WebGLRenderingContext?.prototype, gl2]) {
    hookResource(proto, 'Texture', 'texture');
    hookResource(proto, 'Buffer', 'buffer');
    hookResource(proto, 'Program', 'program');
    hookResource(proto, 'Shader', 'shader');
    hookResource(proto, 'Framebuffer', 'framebuffer');
    hookResource(proto, 'Renderbuffer', 'renderbuffer');
  }
  hookResource(gl2, 'VertexArray', 'vao');

  const push = (list, value) => {
    list.push(value);
    if (list.length > SAMPLE_SIZE) list.shift();
  };

  // 有些特效閒置時會自己跳幀省電（例如 bubble），rAF 照跑但沒畫東西。
  // WebGL 頁面只把真的有 draw call 的幀算進 FPS，量到的才是畫面實際的更新率。
  // 特效刻意的省電節流（例如 bubble 閒置一段時間後降到 30fps）由特效自己用
  // __vfxDev.throttled(() => 布林) 告知。節流中的幀不算卡頓：HUD 和走勢圖改用
  // 中性色，1%low／max 也只拿沒節流的幀來算。
  let throttleGetter = null;
  const throttledFlags = [];
  let prevThrottled = false;
  const isThrottled = () => {
    try { return Boolean(throttleGetter?.()); } catch (_) { return false; }
  };

  // 頁面模式：頁面本身沒有持續的動畫迴圈，改由 HUD 跑自己的探測迴圈，量到的是
  // 主執行緒能維持的幀率（捲動、CSS 動畫、iframe 載入造成的卡頓都會反映在這裡）。
  let pageMode = false;
  let lastProbe = 0;
  const probe = stamp => {
    if (lastProbe) {
      push(intervals, stamp - lastProbe);
      push(throttledFlags, false);
      push(cpuTimes, 0);
    }
    lastProbe = stamp;
    renderedInWindow++;
    nativeRAF(probe);
  };
  document.addEventListener('visibilitychange', () => { lastProbe = 0; });

  const finishFrame = () => {
    if (pageMode) { frameCpu = frameDraws = framePrims = 0; return; }
    const rendered = !contextKinds.has('webgl') || frameDraws > 0;
    if (rendered) {
      if (lastRenderedStamp) {
        push(intervals, lastFrameStamp - lastRenderedStamp);
        // 間隔兩端任一幀在節流，這段間隔就是節流造成的（剛喚醒的第一幀也算）。
        const throttled = isThrottled();
        push(throttledFlags, throttled || prevThrottled);
        prevThrottled = throttled;
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
      gpuEndFrame();
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
      if (proto === gl2) gpuBegin(this);
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
  let visible = !headless && store.get('vfx-dev-hidden') !== '1';
  let expanded = store.get('vfx-dev-expanded') === '1';

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
    #vfxDevHud .idle { color: #0d1117; background: #8fa3c7; border-radius: 3px; padding: 0 3px; }
    #vfxDevHud .idle-text { color: #a9b8d6; }
    #vfxDevHud .idle-bad { color: #0d1117; background: #ff6b6b; border-radius: 3px; padding: 0 3px; }
    #vfxDevHud .tag { color: #0d1117; background: #ffd166; border-radius: 3px; padding: 0 3px; }
    #vfxDevDetail { margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,.08); }
    #vfxDevDetail[hidden] { display: none; }
    #vfxDevDetail canvas { display: block; height: 48px; margin-bottom: 4px; }
    #vfxDevDetail .sep { height: 1px; margin: 4px 0; background: rgba(255,255,255,.08); }
    #vfxDevDetail .row { display: flex; justify-content: space-between; gap: 16px; }
  `;

  const hud = document.createElement('div');
  hud.id = 'vfxDevHud';
  hud.setAttribute('aria-hidden', 'true');
  const line = document.createElement('div');
  const detail = document.createElement('div');
  detail.id = 'vfxDevDetail';
  const graph = document.createElement('canvas');
  const rows = document.createElement('div');
  detail.append(graph, rows);
  hud.append(line, detail);

  const mount = () => {
    document.head.appendChild(style);
    document.body.appendChild(hud);
    hud.dataset.corner = corner;
    hud.hidden = !visible;
    detail.hidden = !expanded;
  };
  if (headless) { /* 預覽 iframe：只量，不顯示 */ }
  else if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });

  // ---- 長任務（主執行緒被佔住超過 50ms）----
  // 首頁載入預覽 iframe、編譯 shader 時最常出現；特效頁的參數切換也看得到。
  const LONG_TASK_WINDOW_MS = 10000;
  const longTasks = [];
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime + entry.duration, ms: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { /* Safari／Firefox 沒有 longtask */ }
  const recentLongTasks = () => {
    const since = performance.now() - LONG_TASK_WINDOW_MS;
    while (longTasks.length && longTasks[0].at < since) longTasks.shift();
    return longTasks;
  };

  // 特效頁：固定門檻（低於 50 黃、低於 30 紅）。
  // 頁面模式（首頁）：跟著螢幕更新率走，低於 80% 黃、低於 50% 紅——120Hz 螢幕上
  // 掉到 60 已經看得出頓，固定門檻抓不到。
  const COMMON_HZ = [60, 75, 90, 100, 120, 144, 165, 240];
  let refreshHz = 60;
  const estimateRefreshHz = () => {
    if (intervals.length < 30) return;
    // 最快那一成的幀最接近 vsync 間隔，再貼齊常見更新率，避免抖動。
    const fastest = 1000 / percentile(intervals, .1);
    refreshHz = COMMON_HZ.reduce((a, b) => (Math.abs(b - fastest) < Math.abs(a - fastest) ? b : a));
  };
  const fpsClass = fps => {
    if (!pageMode) return fps < 30 ? 'bad' : fps < 50 ? 'warn' : '';
    return fps < refreshHz * .5 ? 'bad' : fps < refreshHz * .8 ? 'warn' : '';
  };
  // GPU 一幀耗時：超過 16ms（60fps 預算）黃、超過 33ms（30fps 預算）紅。
  // 跟有沒有省電無關——它代表「畫一幀要多久」，省電時超過 33ms 代表連 30fps 都撐不住。
  const above = (value, warn, bad) => (value > bad ? 'bad' : value > warn ? 'warn' : '');
  const gpuClass = ms => above(ms, 1000 / 60, 1000 / 30);
  // JS 一幀耗時：Canvas 2D 的繪圖成本也算在這裡。超過 8ms 黃（吃掉 60fps 預算一半）、
  // 超過 16ms 紅（光 JS 就超過 60fps 預算）。
  const jsClass = ms => above(ms, 8, 1000 / 60);
  // 長任務：有就黃，任一次超過 200ms（肉眼看得出的卡頓）就紅。
  const longTaskClass = tasks => (!tasks.length ? '' : tasks.some(t => t.ms > 200) ? 'bad' : 'warn');
  const percentile = (list, p) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const average = list => list.reduce((sum, v) => sum + v, 0) / list.length;
  const span = (text, cls) => (cls ? `<span class="${cls}">${text}</span>` : text);
  const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

  // frame time 走勢圖：最近 240 個實際渲染的幀，虛線是 16.7ms（60fps）和 33.3ms（30fps）。
  const GRAPH_MAX_MS = 50;
  const drawGraph = () => {
    const ratio = Math.min(nativeDpr, 2);
    // 跟著上面那一行的寬度撐滿面板。
    const w = Math.max(240, Math.round(line.offsetWidth)), h = 48;
    if (graph.width !== w * ratio) {
      graph.width = w * ratio; graph.height = h * ratio;
      graph.style.width = `${w}px`;
    }
    // 用原生 getContext，HUD 自己的畫布不該被算成頁面的 context。
    const g = nativeGetContext.call(graph, '2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, w, h);
    const y = ms => h - Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS * h;
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.setLineDash([2, 3]);
    for (const ms of [1000 / 60, 1000 / 30]) {
      g.beginPath(); g.moveTo(0, y(ms)); g.lineTo(w, y(ms)); g.stroke();
    }
    g.setLineDash([]);
    const step = w / SAMPLE_SIZE;
    const x0 = w - intervals.length * step;
    intervals.forEach((ms, i) => {
      g.fillStyle = throttledFlags[i] ? '#6c7a96'
        : ms > 1000 / 30 ? '#ff6b6b' : ms > 1000 / 50 ? '#ffd166' : '#7ee0a1';
      const top = y(ms);
      g.fillRect(x0 + i * step, top, Math.max(1, step - .2), h - top);
    });
    // GPU 時間疊成細線，看得出 GPU 吃掉一幀裡多少。
    if (gpuTimes.length > 1) {
      g.strokeStyle = '#8ab4ff';
      g.beginPath();
      const gx0 = w - gpuTimes.length * step;
      gpuTimes.forEach((ms, i) => (i ? g.lineTo : g.moveTo).call(g, gx0 + i * step, y(ms)));
      g.stroke();
    }
  };

  const largestCanvas = () => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      if (c === graph || !c.clientWidth) continue;
      if (!best || c.width * c.height > best.width * best.height) best = c;
    }
    return best;
  };

  // 特效登記的數值：標籤 → getter。用拉的而不是每幀推，沒展開時零成本。
  // inline 的那幾個另外顯示在上方那一行（每次更新都會讀）。
  const watches = new Map();
  const inlineWatches = new Set();
  // getter 可以直接回傳值，或回傳 { value, level: 'warn' | 'bad' } 指定顏色。
  const isLevelled = v => v != null && typeof v === 'object' && 'value' in v;
  const watchLevel = v => (isLevelled(v) && (v.level === 'warn' || v.level === 'bad') ? v.level : '');
  const formatWatch = raw => {
    const value = isLevelled(raw) ? raw.value : raw;
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number') return Number.isInteger(value) ? `${value}` : value.toFixed(2);
    return String(value);
  };
  const readWatches = () => {
    const out = {};
    for (const [label, getter] of watches) {
      try { out[label] = getter(); } catch (_) { out[label] = undefined; }
    }
    return out;
  };

  const escapeHtml = text => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const row = (label, value, cls) => `<div class="row"><span class="dim">${label}</span>${span(value, cls)}</div>`;
  const renderDetail = () => {
    drawGraph();
    const out = [];
    if (watches.size) {
      const values = readWatches();
      for (const label of watches.keys()) {
        out.push(row(escapeHtml(label), escapeHtml(formatWatch(values[label])), watchLevel(values[label])));
      }
      out.push('<div class="sep"></div>');
    }
    const hasGpuTimer = [...gpuStates.values()].some(Boolean);
    if (contextKinds.has('webgl')) {
      out.push(row('GPU', hasGpuTimer
        ? (stats.gpuMs != null ? `${stats.gpuMs.toFixed(2)}ms（p95 ${stats.gpuP95.toFixed(2)}）` : '量測中…')
        : 'n/a（瀏覽器不支援）', stats.gpuMs != null ? gpuClass(stats.gpuMs) : ''));
      out.push(row('貼圖 / buffer', `${resources.texture} / ${resources.buffer}`));
      out.push(row('program / shader', `${resources.program} / ${resources.shader}`));
      out.push(row('FBO / RBO / VAO', `${resources.framebuffer} / ${resources.renderbuffer} / ${resources.vao}`));
    }
    const c = largestCanvas();
    if (c) {
      const scale = c.width / c.clientWidth;
      out.push(row('canvas', `${c.width}×${c.height}（×${scale.toFixed(2)}）`));
    }
    const tasks = recentLongTasks();
    out.push(row('長任務（10 秒內）', tasks.length
      ? `${tasks.length} 次，最長 ${Math.round(Math.max(...tasks.map(t => t.ms)))}ms`
      : '0', longTaskClass(tasks)));
    out.push(row('DPR', forceDpr1 ? `1（強制，原生 ${nativeDpr}）` : `${nativeDpr}`, forceDpr1 ? 'warn' : ''));
    if (performance.memory) out.push(row('JS heap', `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB`));
    out.push(`<div class="dim">紅黃門檻：gpu 16 / 33ms · js 8 / 16ms · 省電時 gpu 超過 33ms 或低於 27fps 標紅</div>`);
    out.push(`<div class="dim">1%low＝最差 1% 幀的 fps · max＝樣本內最慢一幀（都不含省電節流的幀）</div>`);
    if (throttleGetter) out.push(`<div class="dim">走勢圖藍灰色＝省電節流中的幀</div>`);
    if (pageMode) out.push(row('螢幕更新率（推估）', `${refreshHz}Hz`));
    if (pageMode) out.push(`<div class="dim">頁面模式：fps 是主執行緒探測迴圈量到的，不是特效的渲染幀率</div>`);
    out.push(`<div class="dim">⇧D 隱藏 · ⇧F 位置 · ⇧G 收合 · ⇧R DPR=1</div>`);
    rows.innerHTML = out.join('');
  };

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
    stats.context = contextKinds.has('webgl') ? 'webgl' : contextKinds.has('2d') ? 'canvas2d' : 'none';

    if (intervals.length < 2) {
      if (visible) line.innerHTML = span('等待畫面…', 'dim');
      return;
    }
    // 這段時間一幀都沒畫：特效在休眠或暫停，舊數字留著會誤導，直接標出來。
    if (stats.idle) {
      if (visible) line.innerHTML = span('閒置／暫停中', 'dim');
      return;
    }
    // 只看最近約 1 秒算平均，1% low 和最差一幀看整個樣本視窗。
    stats.throttled = prevThrottled; // 最新一幀的狀態，喚醒當下就切回來
    const active = intervals.filter((_, i) => !throttledFlags[i]);
    // 節流中就照實顯示節流後的幀率；沒節流時排除前面節流那段，剛喚醒才不會被拉低。
    const recent = stats.throttled || active.length < 2 ? intervals.slice(-60) : active.slice(-60);
    stats.fps = 1000 / average(recent);
    stats.frameMs = average(recent);
    // 整個樣本都在節流：沒有可以判斷卡頓的幀，只好拿全部來算，但不上色。
    const basis = active.length >= 2 ? active : intervals;
    stats.low1 = 1000 / percentile(basis, .99);
    stats.worstMs = Math.max(...basis);
    const judge = active.length >= 2;
    if (pageMode) estimateRefreshHz();
    stats.refreshHz = refreshHz;
    stats.cpuMs = average(cpuTimes.slice(-60));
    if (gpuTimes.length) {
      stats.gpuMs = average(gpuTimes.slice(-60));
      stats.gpuP95 = percentile(gpuTimes, .95);
    }
    stats.resources = { ...resources };
    // 省電中也要抓得到真正的問題：GPU 一幀超過 30fps 預算，或實際幀率掉到
    // 節流目標（約 30）的 90% 以下，就是「省電了還是撐不住」。
    stats.throttleStrained = Boolean(stats.throttled
      && ((stats.gpuMs != null && stats.gpuMs > 1000 / 30) || stats.fps < 27));

    if (!visible) return;
    if (expanded) renderDetail();
    const tasks = recentLongTasks();
    const inline = [];
    if (inlineWatches.size) {
      const values = readWatches();
      for (const label of inlineWatches) {
        inline.push(span(`${escapeHtml(label)} ${escapeHtml(formatWatch(values[label]))}`, watchLevel(values[label])));
      }
    }
    line.innerHTML = [
      ...(forceDpr1 ? [span('DPR1', 'tag')] : []),
      ...(stats.throttled ? [span(stats.throttleStrained ? '省電但撐不住' : '省電', stats.throttleStrained ? 'idle-bad' : 'idle')] : []),
      span(`${stats.fps.toFixed(0)}fps`, stats.throttled ? 'idle-text' : fpsClass(stats.fps)),
      span(`1%low ${stats.low1.toFixed(0)}`, judge ? fpsClass(stats.low1) : 'dim'),
      `${stats.frameMs.toFixed(1)}ms`,
      span(`max ${stats.worstMs.toFixed(0)}ms`, !judge ? 'dim' : stats.worstMs > 50 ? 'bad' : stats.worstMs > 25 ? 'warn' : 'dim'),
      ...(tasks.length ? [span(`long ${tasks.length}`, longTaskClass(tasks))] : []),
      ...(pageMode ? [] : [
        span(`js ${stats.cpuMs.toFixed(1)}ms`, jsClass(stats.cpuMs)),
        ...(stats.gpuMs != null ? [span(`gpu ${stats.gpuMs.toFixed(1)}ms`, gpuClass(stats.gpuMs))] : []),
        ...(contextKinds.has('webgl')
          ? [`${stats.drawCalls.toFixed(0)}dc`, `${compact(stats.primitives)}tri`]
          : [span(contextKinds.has('2d') ? 'canvas2d' : 'no-gl', 'dim')]),
      ]),
      ...inline,
    ].join(span(' · ', 'dim'));
  }, UPDATE_MS);

  addEventListener('keydown', event => {
    if (headless || !event.shiftKey || isTyping(event.target)) return;
    if (event.code === 'KeyD') {
      visible = !visible;
      hud.hidden = !visible;
      if (visible) store.remove('vfx-dev-hidden');
      else store.set('vfx-dev-hidden', '1');
    } else if (event.code === 'KeyF') {
      corner = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
      hud.dataset.corner = corner;
      store.set('vfx-dev-corner', corner);
    } else if (event.code === 'KeyG') {
      expanded = !expanded;
      detail.hidden = !expanded;
      if (expanded) { store.set('vfx-dev-expanded', '1'); renderDetail(); }
      else store.remove('vfx-dev-expanded');
    } else if (event.code === 'KeyR') {
      if (forceDpr1) store.remove('vfx-dev-dpr1');
      else store.set('vfx-dev-dpr1', '1');
      location.reload();
    }
  });

  // 給之後的抽屜／bug report／自動化測試讀。
  window.__vfxDev = {
    stats,
    resources,
    // 回傳取消函式；同一個標籤重複登記會蓋掉舊的。{ inline: true } 會顯示在上方那一行。
    watch(entries, { inline = false } = {}) {
      for (const [label, getter] of Object.entries(entries)) {
        if (typeof getter !== 'function') continue;
        watches.set(label, getter);
        if (inline) inlineWatches.add(label);
      }
      return () => {
        for (const label of Object.keys(entries)) { watches.delete(label); inlineWatches.delete(label); }
      };
    },
    // 沒有自己動畫迴圈的頁面（首頁）用 'page'：改量主執行緒的探測迴圈。
    mode(name) {
      if (name !== 'page' || pageMode) return;
      pageMode = true;
      intervals.length = throttledFlags.length = cpuTimes.length = 0;
      nativeRAF(probe);
    },
    // 特效告知「現在是刻意節流」，每個渲染幀讀一次，getter 要便宜。
    throttled(getter) { throttleGetter = typeof getter === 'function' ? getter : null; },
    // 一次讀出全部數值，給之後的 bug report／自動化測試用。
    snapshot: () => ({
      stats: { ...stats },
      resources: { ...resources },
      longTasks: recentLongTasks().map(t => Math.round(t.ms)),
      effect: Object.fromEntries(Object.entries(readWatches()).map(([k, v]) => [k, isLevelled(v) ? v.value : v])),
    }),
  };
})();
