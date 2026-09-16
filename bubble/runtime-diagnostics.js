'use strict';

export function createRuntimeDiagnostics(options) {
  const {
    params: P, preview: PREVIEW, diagnostics: DIAG, diagTimingEnabled: DIAG_TIMING,
    shaderRun: SHADER_RUN, frag: FRAG, fragBaseline: FRAG_BASELINE, usesBaselineShader,
    maxDrops: MAX_DROPS, maxMicroDrops: MAX_MICRO_DROPS, motionSvgDemo: MOTION_SVG_DEMO,
    usesShapeField, variantKey, variantState, variantCacheLimit: VARIANT_CACHE_LIMIT,
    diagTiming, glTimeline, adaptiveQuality, qualityTierNames: QUALITY_TIER_NAMES,
    setQualityTier, markInteraction, frame, setLast, cancelFrameLoop, runtime, canvas,
  } = options;

// WebGL / ANGLE 環境。Windows 上「bubble shader 編譯卡死」必須先分清是 shader
// 本身還是某一個 ANGLE 後端，而後端只能從 runtime().renderer 字串讀出來 —— 頁面內沒有別的
// 途徑能知道 --use-angle 實際生效在哪裡。
//
// 這裡用的全部是字串型 getParameter 與 getExtension：它們只問 context 的靜態屬性，
// 跟任何 program 的狀態無關，不會 flush、不會等待編譯。絕對不能為了取環境資訊順手
// 加上 getProgramParameter(LINK_STATUS) / gl.finish() 那類查詢 —— 那正是先前把
// Chrome 卡住、讓整批測試數據作廢的東西（見 startDiagTiming 的註解）。
function collectGlEnvironment() {
  const gl = runtime().renderer && runtime().renderer.getContext ? runtime().renderer.getContext() : null;
  if (!gl) return { 狀態: '(runtime().renderer 未初始化)' };
  const get = p => { try { return gl.getParameter(p); } catch (_) { return null; } };
  let dbg = null;
  try { dbg = gl.getExtension('WEBGL_debug_renderer_info'); } catch (_) {}
  const glRenderer = get(gl.RENDERER);
  const unmaskedRenderer = dbg ? get(dbg.UNMASKED_RENDERER_WEBGL) : null;
  // ANGLE 把後端寫進 runtime().renderer 字串，例如
  //   ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)
  //   ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786), Vulkan 1.3.260)
  // 兩個字串都看，因為未遮蔽的那個才有完整的後端資訊，而它可能不可用。
  const backendSource = [glRenderer, unmaskedRenderer].filter(Boolean).join(' | ');
  const backend = /SwiftShader/i.test(backendSource) ? 'SwiftShader（軟體算繪）'
    : /Vulkan/i.test(backendSource) ? 'Vulkan'
    : /Direct3D11|\bD3D11\b/i.test(backendSource) ? 'D3D11'
    : /Direct3D9|\bD3D9\b/i.test(backendSource) ? 'D3D9'
    : /OpenGL|GLES/i.test(backendSource) ? 'OpenGL/GLES'
    : /ANGLE/i.test(backendSource) ? 'ANGLE（後端字串無法分辨）'
    : '非 ANGLE 或無法分辨';
  let parallelCompile = false;
  try { parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile'); } catch (_) {}
  return {
    webgl版本: (typeof WebGL2RenderingContext !== 'undefined'
      && gl instanceof WebGL2RenderingContext) ? 'WebGL2' : 'WebGL1',
    ANGLE後端推定: backend,
    GL_VENDOR: get(gl.VENDOR),
    GL_RENDERER: glRenderer,
    GL_VERSION: get(gl.VERSION),
    UNMASKED_VENDOR_WEBGL: dbg
      ? get(dbg.UNMASKED_VENDOR_WEBGL) : '(WEBGL_debug_renderer_info 不可用)',
    UNMASKED_RENDERER_WEBGL: dbg
      ? unmaskedRenderer : '(WEBGL_debug_renderer_info 不可用)',
    KHR_parallel_shader_compile: parallelCompile,
  };
}

// 這一份 shader 的靜態規模統計。矩陣頁需要它才能把「編譯多久」跟「編譯了多少東西」
// 放在同一列看，否則只有時間數字沒有解釋力。
//
// 逐項都是對「前處理之後」的原始碼算的，跟真正送進 ANGLE 的內容一致。
function computeShaderStats() {
  const activeFrag = usesBaselineShader() ? FRAG_BASELINE : FRAG;
  const d = (runtime().mesh && runtime().mesh.material) ? runtime().mesh.material.defines || {} : {};
  const isOn = k => d[k] !== false && d[k] !== undefined;
  const eff = [];
  let depth = 0, skip = [];
  for (const line of activeFrag.split('\n')) {
    let m = line.match(/^\s*#ifdef\s+(\w+)/);
    if (m) { depth++; if (!isOn(m[1])) skip.push(depth); continue; }
    m = line.match(/^\s*#ifndef\s+(\w+)/);
    if (m) { depth++; if (isOn(m[1])) skip.push(depth); continue; }
    if (/^\s*#endif/.test(line)) { skip = skip.filter(x => x !== depth); depth--; continue; }
    if (!skip.length) eff.push(line);
  }
  // 註解要先剝掉，否則註解裡提到的函式名會被算成呼叫點。
  const bodyOf = name => {
    const i = eff.findIndex(l => new RegExp('^\\w+\\s+' + name + '\\s*\\(').test(l));
    if (i < 0) return null;
    let dep = 0, started = false; const out = [];
    for (let j = i; j < eff.length; j++) {
      out.push(eff[j]);
      dep += (eff[j].match(/\{/g) || []).length;
      dep -= (eff[j].match(/\}/g) || []).length;
      if ((eff[j].match(/\{/g) || []).length) started = true;
      if (started && dep === 0) break;
    }
    return out;
  };
  const strip = ls => (ls || []).map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const count = (ls, re) => (strip(ls).match(new RegExp(re, 'g')) || []).length;

  const all = eff;
  const calcNormal = bodyOf('calcNormal');
  const exitFnName = d.TRACE_EXIT_NORMAL_FN || 'calcNormal';
  const exitFn = exitFnName === 'calcNormal' ? calcNormal : bodyOf(exitFnName);
  const trace = bodyOf('traceExitSurface');
  const main = bodyOf('main');

  // mapScene 在攤平之後總共會出現幾份：沿呼叫圖算，不是數文字出現次數。
  const calcNormalTaps = count(calcNormal, 'mapScene\\s*\\(');
  const exitTaps = exitFn ? count(exitFn, 'mapScene\\s*\\(') : 0;
  const tracePer = count(trace, 'mapScene\\s*\\(') + exitTaps;
  const mapScene展開份數 = count(main, 'mapScene\\s*\\(')
    + count(main, 'calcNormal\\s*\\(') * calcNormalTaps
    + count(main, 'traceExitSurface\\s*\\(') * tracePer;

  return {
    有效行數: all.length,
    純程式碼行數: all.filter(l => l.trim() && !l.trim().startsWith('//')).length,
    mapScene展開份數,
    calcNormalTaps,
    texture2D呼叫點: count(all, 'texture2D\\s*\\('),
    textureCubeUV呼叫點: count(all, 'textureCubeUV\\s*\\('),
    snoise呼叫點: count(all, 'snoise\\s*\\(') - count(all, 'float\\s+snoise\\s*\\('),
    固定迴圈數: all.filter(l => /^\s*for\s*\(/.test(l)).length,
  };
}

// 把剛算繪的那一幀讀回來存起來，供跨頁面載入的 A/B 逐像素比對（?diagCapture=key）。
//
// 存兩份東西：整張畫面的雜湊，以及一份等間隔取樣的原始像素。
//   雜湊    —— 用來回答「是不是完全一模一樣」。相同就代表逐位元相同，不必再看誤差。
//   取樣    —— 雜湊不同時才需要，用來算最大／平均誤差，判斷是浮點級還是真的畫錯。
// 不存整張是因為 localStorage 只有幾 MB，而兩份全解析度緩衝區就會撐爆。
function captureFrameForDiff(key) {
  try {
    const gl = runtime().renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

    // FNV-1a，逐位元敏感
    let hash = 0x811c9dc5;
    for (let i = 0; i < px.length; i++) {
      hash ^= px[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    // 等間隔取樣（取原值，不做平均——平均會把浮點級差異抹掉）
    const TARGET = 200;
    const stepX = Math.max(1, Math.floor(w / TARGET));
    const stepY = Math.max(1, Math.floor(h / TARGET));
    const sample = [];
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const o = (y * w + x) * 4;
        sample.push(px[o], px[o + 1], px[o + 2], px[o + 3]);
      }
    }
    const record = {
      key, width: w, height: h, hash, stepX, stepY,
      simT: runtime().uniforms.uTime.value,
      diag: DIAG.list,
      sample,
    };
    localStorage.setItem('vfx:diagpix:' + key, JSON.stringify(record));
    console.info('[bubble diag] 已擷取畫面 "' + key + '"：' + w + 'x' + h
      + '，hash=' + hash.toString(16) + '，取樣 ' + (sample.length / 4) + ' 像素'
      + '，uTime=' + record.simT);
    return { ok: true, hash, width: w, height: h };
  } catch (e) {
    // 幾乎一定是 localStorage 配額：一筆擷取約 700KB，而配額只有 5MB 上下，
    // 存到第七、八筆就滿了。失敗訊息一定要把原因跟清法講出來 —— 否則讀回來只是
    // null，下游會以為「擷取到一張空畫面」而不是「根本沒存進去」，那是會白花
    // 一整輪量測時間的誤判。
    const 已存筆數 = Object.keys(localStorage).filter(k => k.startsWith('vfx:diagpix:')).length;
    console.error('[bubble diag] 擷取畫面失敗：' + e.message
      + '（localStorage 目前有 ' + 已存筆數 + ' 筆擷取，每筆約 700KB，配額約 5MB。'
      + '清掉：Object.keys(localStorage)'
      + '.filter(k=>k.startsWith("vfx:diagpix:")).forEach(k=>localStorage.removeItem(k))）');
    return { ok: false, 錯誤: e.message, 已存筆數 };
  }
}

// 比較兩份擷取結果。純讀 localStorage，任何時候都可以在 console 呼叫。
window.__bubbleDiagComparePixels = function (keyA, keyB) {
  const a = JSON.parse(localStorage.getItem('vfx:diagpix:' + keyA) || 'null');
  const b = JSON.parse(localStorage.getItem('vfx:diagpix:' + keyB) || 'null');
  if (!a || !b) return { 錯誤: '找不到擷取結果', a: !!a, b: !!b };
  if (a.width !== b.width || a.height !== b.height) {
    return { 錯誤: '尺寸不同，無法比較', a: a.width + 'x' + a.height, b: b.width + 'x' + b.height };
  }
  if (a.simT !== b.simT) {
    return { 錯誤: '動畫時間不同，這樣的比較沒有意義（請帶同一個 ?diagTime=）',
      aTime: a.simT, bTime: b.simT };
  }
  const 逐位元相同 = a.hash === b.hash;
  let max = 0, sum = 0, diffCount = 0;
  const n = Math.min(a.sample.length, b.sample.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.sample[i] - b.sample[i]);
    if (d > max) max = d;
    if (d !== 0) diffCount++;
    sum += d;
  }
  return {
    逐位元相同,
    全畫面hash: { [keyA]: a.hash.toString(16), [keyB]: b.hash.toString(16) },
    尺寸: a.width + 'x' + a.height,
    uTime: a.simT,
    取樣通道數: n,
    最大通道誤差: max,
    平均通道誤差: Math.round((sum / n) * 10000) / 10000,
    有差異的通道數: diffCount,
    判讀: 逐位元相同 ? '完全相同'
      : max <= 1 ? '僅 ±1/255 的浮點捨入級差異'
        : max <= 4 ? '極小差異（可能是浮點累加順序）'
          : '有可見差異，需要檢查',
    diag: { [keyA]: a.diag, [keyB]: b.diag },
  };
};

// 在「現在這個狀態」算繪一幀並擷取起來，供逐像素 A/B。
//
// ?diagCapture= 只在 DIAG.static 的第一幀觸發，那一幀必然是頁面預設模式（分裂）。
// 造型類模式沒有 URL 參數可以直接進入，得先像使用者那樣切模式、等造型匯入、
// 等變體在背景編好，才有「同一支 shader 的同一幀」可比 —— 那些等待由外部驅動
// （__bubbleDiagReport 已經把需要的狀態全部攤出來了），這裡只負責最後那一步。
//
// 算繪路徑與 DIAG.static 那一段逐字相同：先對齊 last 讓 dt≈0，走完整的 frame()
// 而不是只呼叫 runtime().renderer.render()，讀像素緊接在同一個 task 內，最後把 frame()
// 自己排下去的那次 RAF 取消掉，只留這一幀。
window.__bubbleDiagRenderAndCapture = function (key) {
  if (!runtime().inited) return { 錯誤: 'WebGL 尚未初始化' };
  setLast(performance.now());
  frame(performance.now());
  const result = captureFrameForDiff(key);
  cancelFrameLoop();
  const saved = result.ok
    ? JSON.parse(localStorage.getItem('vfx:diagpix:' + key) || 'null')
    : null;
  return saved
    ? { key, 尺寸: saved.width + 'x' + saved.height, hash: saved.hash.toString(16),
      simT: saved.simT, 取樣像素數: saved.sample.length / 4,
      目前變體: runtime().activeVariantKey, defines: runtime().mesh.material.defines }
    : { 錯誤: '擷取失敗：' + (result.錯誤 || '(未知)'), 已存筆數: result.已存筆數 };
};

// Hardware GPU timing for local acceptance. Timer queries measure the complete
// composite without forcing a synchronous readback. Restore the user's adaptive
// tier after the requested sample set finishes.
window.__bubbleProfileGpu = async function ({ tier = 'high', samples = 16, warmup = 3 } = {}) {
  if (!runtime().inited || !runtime().gpuProfiler) return { supported: false, reason: 'WebGL 尚未初始化' };
  const nextTier = QUALITY_TIER_NAMES.indexOf(tier);
  if (nextTier < 0) throw new Error(`Unknown quality tier: ${tier}`);
  const previousTier = adaptiveQuality.snapshot().tierIndex;
  setQualityTier(nextTier);
  markInteraction();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const result = await runtime().gpuProfiler.measure({ samples, warmup });
    return { ...result, tier, quality: adaptiveQuality.snapshot() };
  } finally {
    setQualityTier(previousTier);
  }
};

// 診斷用的現況報告。任何時候都可以在 console 呼叫 __bubbleDiagReport()，
// 帶 ?diag= 時初始化完成後也會自動印一次。純讀取，不改變任何狀態。
window.__bubbleDiagReport = function () {
  const gl = runtime().renderer && runtime().renderer.getContext ? runtime().renderer.getContext() : null;
  // 目前這支 material 實際使用的 fragment shader 原始碼
  const activeFrag = usesBaselineShader() ? FRAG_BASELINE : FRAG;
  // 依 defines 做前處理，得出真正送進編譯器的內容
  const preprocess = src => {
    const d = (runtime().mesh && runtime().mesh.material) ? runtime().mesh.material.defines || {} : {};
    const isOn = k => d[k] !== false && d[k] !== undefined;
    const out = [];
    let depth = 0; let skip = [];
    for (const line of src.split('\n')) {
      let m = line.match(/^\s*#ifdef\s+(\w+)/);
      if (m) { depth++; if (!isOn(m[1])) skip.push(depth); continue; }
      m = line.match(/^\s*#ifndef\s+(\w+)/);
      if (m) { depth++; if (isOn(m[1])) skip.push(depth); continue; }
      if (/^\s*#endif/.test(line)) { skip = skip.filter(x => x !== depth); depth--; continue; }
      if (!skip.length) out.push(line);
    }
    return out;
  };
  const effective = preprocess(activeFrag);
  const effectiveSrc = effective.join('\n');
  // 取某個函式在「前處理後」的行數
  const fnLines = name => {
    const i = effective.findIndex(l => new RegExp('^[A-Za-z_][\\w]*\\s+' + name + '\\s*\\(').test(l));
    if (i < 0) return '(不存在)';
    let depth = 0, n = 0;
    for (let j = i; j < effective.length; j++) {
      n++;
      depth += (effective[j].match(/\{/g) || []).length;
      depth -= (effective[j].match(/\}/g) || []).length;
      if (depth === 0 && j > i) break;
    }
    return n;
  };
  const has = re => new RegExp(re).test(effectiveSrc);
  const loops = effective
    .map((l, i) => ({ l: l.trim(), i }))
    .filter(x => /^for\s*\(/.test(x.l))
    .map(x => x.l.replace(/\s*\{\s*$/, ''));
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  const steps = runtime().uniforms ? runtime().uniforms.uMaxSteps.value : null;
  // 每像素的 mapScene 呼叫次數：主 raymarch 迴圈 + 法線差分 + 內部折射追蹤。
  // 法線在 SVG 造型路徑是分軸中央差分（6 次），其餘是四面體（4 次）。
  const normalTaps = (runtime().uniforms && runtime().uniforms.uShapeType.value === 1 && runtime().uniforms.uShapeProgress.value > 0.001) ? 6 : 4;
  const INTERIOR_STEPS = 28;
  const mapSceneCalls = (steps || 0) + normalTaps + INTERIOR_STEPS;
  // 每次 mapScene 內部的迴圈上限（GLSL 端的編譯期常數，執行期靠 break 提早跳出）
  const inner = {
    主滴迴圈上限: MAX_DROPS,          // GLSL: MAXN = 12
    衛星滴迴圈: 3,                    // GLSL: for (s = 0; s < 3)
    微滴迴圈上限: MAX_MICRO_DROPS,    // GLSL: MAX_MICRO = 48（含 texture2D 取樣）
    負形迴圈上限: 4,                  // GLSL: MAX_NEGATIVE = 4
  };
  const innerMax = inner.主滴迴圈上限 + inner.衛星滴迴圈 + inner.微滴迴圈上限 + inner.負形迴圈上限;
  const innerActual = Math.round(runtime().uniforms ? runtime().uniforms.uCount.value : 0) + 3
    + Math.round(runtime().uniforms ? runtime().uniforms.uMicroCount.value : 0)
    + Math.round(runtime().uniforms ? runtime().uniforms.uNegativeCount.value : 0);
  const r = {
    模式: { preview: PREVIEW, diag: DIAG.list, motion: P.motion },
    // 每一筆 cold compile 數字都必須帶著它是在哪個後端量到的，否則跨後端的
    // 結果混在一起就無法比較（見 collectGlEnvironment）。這一份是呼叫當下的現況。
    gl環境: collectGlEnvironment(),
    // 過程中後端有沒有換過人（見 glTimeline）。
    gl時間軸: glTimeline,
    shader規模: computeShaderStats(),
    // 造型場的完整 runtime 狀態。「造型資料在不在」與「shader 有沒有把它編進來」是
    // 兩件事，要並排看才分得出是資料沒到還是 shader 沒編。
    造型: (() => {
      const d = (runtime().mesh && runtime().mesh.material) ? runtime().mesh.material.defines || {} : {};
      const has = k => d[k] !== false && d[k] !== undefined;
      const tex = runtime().uniforms ? runtime().uniforms.uShapeTex.value : null;
      const img = tex && tex.image ? tex.image : null;
      return {
        motion: P.motion,
        shapeSource: P.shapeSource,
        usesShapeField: usesShapeField(P.motion),
        // --- shader 端 ---
        FEATURE_SHAPE_FIELD已編入: has('FEATURE_SHAPE_FIELD'),
        NORMAL_TAPS_SVG: has('NORMAL_TAPS_SVG'),
        NORMAL_TAPS_TETRA: has('NORMAL_TAPS_TETRA'),
        FEATURE_MICRO_DROPS: has('FEATURE_MICRO_DROPS'),
        FEATURE_NEGATIVE_FIELD: has('FEATURE_NEGATIVE_FIELD'),
        // 造型場內部的模式特化。FEATURE_SHAPE_SVG / VOLUME 應該正好對上 uShapeType
        // （1 / 2）；不一致就代表變體還在背景編譯中，此刻 shapeDistance 會回傳
        // 遠距離，造型暫時不顯示（見 shaders.js 的 shapeDistance）。
        FEATURE_SHAPE_SVG: has('FEATURE_SHAPE_SVG'),
        FEATURE_SHAPE_VOLUME: has('FEATURE_SHAPE_VOLUME'),
        FEATURE_SHAPE_MORPH: has('FEATURE_SHAPE_MORPH'),
        FEATURE_FORMATION_CUT: has('FEATURE_FORMATION_CUT'),
        FEATURE_DISSOLVE_FIELD: has('FEATURE_DISSOLVE_FIELD'),
        // --- uniform 端 ---
        uShapeType: runtime().uniforms ? runtime().uniforms.uShapeType.value : null,
        uShapeProgress: runtime().uniforms ? runtime().uniforms.uShapeProgress.value : null,
        uShapeGrid: runtime().uniforms ? runtime().uniforms.uShapeGrid.value : null,
        uShapeScale: runtime().uniforms ? runtime().uniforms.uShapeScale.value : null,
        uShapeTex有貼圖: !!tex,
        uShapeTex尺寸: img ? (img.width + 'x' + img.height) : '(無)',
        // --- 造型資料端 ---
        shapeField存在: !!runtime().shapeField,
        shapeTargetsBase長度: runtime().shapeTargetsBase.length,
        shapeTargets長度: runtime().shapeTargets.length,
        shapeCavityBase長度: runtime().shapeCavityBase.length,
        shapeFieldSource: runtime().shapeFieldSource,
        builtinSvgVariant: runtime().builtinSvgVariant,
        期望的內建造型: MOTION_SVG_DEMO[P.motion] || 'question',
        shapeConverting: runtime().shapeConverting,
        shapeImportingKind: runtime().shapeImportingKind,
        使用者匯入的檔案: { svg: !!runtime().userShapeFiles.svg, gltf: !!runtime().userShapeFiles.gltf },
      };
    })(),
    變體: {
      目前key: runtime().activeVariantKey,
      應該要的key: variantKey(),
      首編已完成: runtime().initialCompileDone,
      待補做的切換: runtime().pendingVariantSync,
      編譯中的key: runtime().variantSwapInFlight,
      // 進行中的背景編譯：每次讀報告時重算已經過時間，這樣就能直接看出
      // 「還在編」與「已經卡死」的差別，不必自己掐錶。
      進行中編譯: runtime().variantStats.進行中 ? {
        ...runtime().variantStats.進行中,
        已經過ms: Math.round(performance.now() - runtime().variantStats.進行中.開始於ms),
        期間contextLost: glTimeline.contextLost次數 - runtime().variantStats.進行中.開始時contextLost,
      } : null,
      狀態: variantState(),
      // 背景預熱。「略過」不是壞事 —— 快的後端本來就不該預熱（見 prewarmSkipReason）。
      預熱: {
        ...runtime().prewarmStats,
        首編耗時ms: runtime().initialCompileMs === null ? null : Math.round(runtime().initialCompileMs),
        進行中: runtime().prewarmStats.進行中 ? {
          ...runtime().prewarmStats.進行中,
          已經過ms: Math.round(performance.now() - runtime().prewarmStats.進行中.開始於ms),
        } : null,
      },
      已快取: [...runtime().variantCache.keys()],
      快取上限: VARIANT_CACHE_LIMIT,
      ...runtime().variantStats,
    },
    coldCompile量測: {
      shaderRun: SHADER_RUN === null ? '(未指定 → 可能命中已暖好的 shader cache)' : SHADER_RUN,
      計時工具: DIAG_TIMING
        ? '啟用（KHR_parallel_shader_compile 非阻塞輪詢）'
        : '未啟用（?diagTiming=1 才開）',
      ...diagTiming,
          說明: 'program建立到編譯完成 = 從 runtime().renderer.compile() 到 COMPLETION_STATUS_KHR'
        + ' 全部為 true 的牆鐘時間（rAF 輪詢，不阻塞主執行緒）；第一幀 render 在編譯'
        + '確定完成之後才量，所以兩段是分開的。不使用任何同步查詢。',
    },
    尺寸: {
      CSS: cssW + ' x ' + cssH,
      drawingBuffer: gl ? gl.drawingBufferWidth + ' x ' + gl.drawingBufferHeight : '(未初始化)',
      canvas屬性: canvas.width + ' x ' + canvas.height,
      'window.devicePixelRatio': window.devicePixelRatio,
      'runtime().renderer.getPixelRatio()': runtime().renderer ? runtime().renderer.getPixelRatio() : '(未初始化)',
      像素數: gl ? (gl.drawingBufferWidth * gl.drawingBufferHeight).toLocaleString() : '(未初始化)',
    },
    效能: (() => {
      const quality = adaptiveQuality.snapshot();
      return {
      自動品質層級: quality.tier,
      最近取樣FPS: quality.lastFps === null ? null : Math.round(quality.lastFps * 10) / 10,
      qualityDpr: quality.dpr,
      maxRenderDpr: quality.maxDpr,
      minRenderDpr: quality.minDpr,
      qualitySteps: quality.steps,
      reflectionSamples: quality.reflectionSamples,
      省電節流中: runtime().powerSaveThrottled,
      減少動態效果暫停: runtime().reducedMotionPaused,
      畫布拖曳中: runtime().dragging,
      };
    })(),
    raymarch: {
      'uMaxSteps(本幀)': steps,
      主迴圈硬上限: 88,
      法線差分次數: normalTaps,
      內部折射追蹤步數: INTERIOR_STEPS,
      每像素mapScene次數: mapSceneCalls,
      mapScene內層迴圈上限: inner,
      內層上限合計: innerMax,
      內層實際跑幾次: innerActual,
      內層各項實際值: runtime().uniforms ? {
        uCount: runtime().uniforms.uCount.value,
        uMicroCount: runtime().uniforms.uMicroCount.value,
        uNegativeCount: runtime().uniforms.uNegativeCount.value,
        uShapeProgress: runtime().uniforms.uShapeProgress.value,
        uShapeType: runtime().uniforms.uShapeType.value,
        uExtendedMotion: runtime().uniforms.uExtendedMotion.value,
        uMaterialStyle: runtime().uniforms.uMaterialStyle.value,
        uRayBeamPattern: runtime().uniforms.uRayBeamPattern.value,
      } : '(未初始化)',
      // 打字模式的排版狀態。字沒出現時第一個要看的就是這幾個值：可見字數（.w）、
      // 字距、字級，以及射線邊界有沒有涵蓋整行。
      打字: runtime().uniforms && P.motion === 'typewriter' ? {
        uTypeLine: runtime().uniforms.uTypeLine.value.toArray(),
        uTypeShape: runtime().uniforms.uTypeShape.value.toArray(),
        uTypeAtlasInfo: runtime().uniforms.uTypeAtlasInfo.value.toArray(),
        uTypeCaret: runtime().uniforms.uTypeCaret.value.toArray(),
        uBounds: runtime().uniforms.uBounds.value.toArray(),
      } : undefined,
      每像素SDF評估_最壞: (mapSceneCalls * innerMax).toLocaleString(),
      每像素SDF評估_目前參數: (mapSceneCalls * innerActual).toLocaleString(),
    },
    shaderVariant: {
      使用的shader: usesBaselineShader()
        ? 'FRAG_BASELINE（最小 shader'
          + (DIAG.probeSnoise ? ' + snoise' : '')
          + (DIAG.probeFbm ? ' + snoise/fbm' : '')
          + (DIAG.probeNoiseMapscene ? ' + snoise/fbmFast@mapScene' : '')
          + (DIAG.probeMarchBound > 0
            ? ' + snoise/fbmFast@mapScene, march=' + DIAG.probeMarchBound : '')
          + (DIAG.probeNoise ? ' + snoise/fbm/fbmFast' : '')
          + '）'
        : 'FRAG（正式）',
      defines: runtime().mesh && runtime().mesh.material ? runtime().mesh.material.defines : '(未初始化)',
      有效行數: effective.length,
      'mapScene有效行數': fnLines('mapScene'),
      'main有效行數': fnLines('main'),
      剩餘固定迴圈: loops,
      loop數: loops.length,
      // snoise 的呼叫次數（原始碼中的呼叫點，不是執行次數）
      snoise呼叫數: (effectiveSrc.match(/snoise\s*\(/g) || []).length
        - (effectiveSrc.match(/float\s+snoise\s*\(/g) || []).length,
      // 是否位於 raymarch 呼叫鏈內：mapScene 會被 march 迴圈重複呼叫，
      // 所以 noise 若出現在 mapScene 內就等於被乘上迴圈次數。
      // inline 展開量估算：mapScene 被 main 呼叫幾次（march 迴圈上限 + calcNormal
      // 的取樣數）× mapScene 內部的 snoise 份數。這是 HLSL 編譯器實際要處理的規模。
      mapScene被呼叫次數: (() => {
        const d = (runtime().mesh && runtime().mesh.material) ? runtime().mesh.material.defines || {} : {};
        const march = d.MAX_MARCH_COMPILE !== undefined ? Number(d.MAX_MARCH_COMPILE) : 88;
        const normalTaps = 4;
        return { march, calcNormal取樣: normalTaps, 合計: march + normalTaps };
      })(),
      // snoise 展開份數估算：mapScene 的呼叫次數 × mapScene 內部的 snoise 份數。
      snoise展開份數估算: (() => {
        const d = (runtime().mesh && runtime().mesh.material) ? runtime().mesh.material.defines || {} : {};
        const march = d.MAX_MARCH_COMPILE !== undefined ? Number(d.MAX_MARCH_COMPILE) : 88;
        const perMapScene = d.CALL_FBMFAST_MAPSCENE !== undefined ? 2 : 0;
        if (!perMapScene) return '(noise 不在 mapScene 內)';
        return { mapScene呼叫次數: march + 4, 每次snoise份數: perMapScene,
                 合計: (march + 4) * perMapScene };
      })(),
      是否在raymarch呼叫鏈內: (() => {
        const i = effective.findIndex(l => /^float\s+mapScene\s*\(/.test(l));
        if (i < 0) return false;
        let depth = 0;
        for (let j = i; j < effective.length; j++) {
          depth += (effective[j].match(/\{/g) || []).length;
          depth -= (effective[j].match(/\}/g) || []).length;
          if (/snoise\s*\(|fbm\s*\(|fbmFast\s*\(/.test(effective[j]) && j > i) return true;
          if (depth === 0 && j > i) break;
        }
        return false;
      })(),
      仍存在的構造: {
        'snoise/fbm/fbmFast': has('snoise|fbmFast|\\bfbm\\('),
        'texture lookup': has('texture2D|texture\\s*\\('),
        'sampler 宣告': has('uniform\\s+sampler'),
        '內部折射 traceExitSurface': has('traceExitSurface'),
        '薄膜 thinFilm': has('thinFilm'),
        '色散/OPD/光譜': has('Dispersion|artisticDispersionOPD|visibleSpectrum|sampleFilmInterference'),
        '稜光光芒 prismBeam': has('prismBeamField|prismBeamCoord'),
        '負形場': has('uNegativeDrops'),
        '造型距離場': has('svgShapeDistance|volumeShapeDistance'),
        'geometry wobble': has('geometryWobble'),
        '環境反射/背景合成': has('sampleReflection|backgroundSample'),
      },
      // 實際送進編譯器的 fragment shader 行數（Three.js 前置的 header 不算）
      // 下面幾項只描述正式 FRAG；基線探針用的是另一支 shader，列出來會誤導。
      正式FRAG行數: usesBaselineShader() ? '(不適用：目前用 FRAG_BASELINE)' : FRAG.split('\n').length,
      編譯期迴圈上限: usesBaselineShader() ? '(不適用：見上方剩餘固定迴圈)' : (() => {
        const d = runtime().mesh && runtime().mesh.material ? runtime().mesh.material.defines : null;
        const pick = (k, dflt) => (d && d[k] !== undefined ? d[k] : dflt);
        return {
          主滴MAXN: pick('MAX_DROPS_COMPILE', 12),
          主raymarch展開: pick('MAX_MARCH_COMPILE', 88),
          內部折射展開: pick('MAX_INTERIOR_COMPILE', 28),
          反射環形取樣上限: pick('MAX_REFLECTION_SAMPLES', 8),
          微滴MAX_MICRO: (d && d.FEATURE_MICRO_DROPS === false) ? '整個迴圈已移除' : 48,
          負形MAX_NEGATIVE: 4,
        };
      })(),
      編譯後生效行數: usesBaselineShader() ? '(不適用：見上方有效行數)' : (() => {
        const d = runtime().mesh && runtime().mesh.material ? runtime().mesh.material.defines : null;
        if (!d) return '(未初始化)';
        const on = k => d[k] !== false && d[k] !== undefined;
        let keep = 0, depth = 0, skipping = [];
        for (const line of FRAG.split('\n')) {
          const m = line.match(/^#ifdef\s+(\w+)/);
          if (m) { depth++; if (!on(m[1])) skipping.push(depth); continue; }
          if (/^#endif/.test(line)) { skipping = skipping.filter(x => x !== depth); depth--; continue; }
          if (!skipping.length) keep++;
        }
        return keep;
      })(),
    },
    shader特性: {
      巢狀迴圈: '是（raymarch 迴圈內呼叫 mapScene，mapScene 內部還有 4 層迴圈）',
      迴圈上限由uniform動態控制: '是（for i<88 內 if (i >= uMaxSteps) break）',
      大的固定迴圈常數: 'MAX_MICRO=48（內含 texture2D）、主迴圈 88、內部追蹤 28',
      discard: '無',
      precision: 'highp float',
      WebGL版本: gl ? (gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1') : '(未初始化)',
      antialias: gl ? !!gl.getContextAttributes().antialias : '(未初始化)',
    },
    render管線: {
      已編譯program數: runtime().renderer ? runtime().renderer.info.programs.length : '(未初始化)',
      // 注意：three.js 的 info.render 每次 render() 都會重置，而 initGL() 裡的
      // PMREM 環境貼圖本來就會算繪幾個小 quad（材質必需）。所以這個數字不能用來
      // 判斷「全螢幕 raymarch 有沒有跑」——compileonly 的差別在於它從不對主 runtime().mesh
      // 送出全螢幕 draw call，而不是完全沒有任何 draw call。
      最後一次render的drawCall數: runtime().renderer ? runtime().renderer.info.render.calls : '(未初始化)',
      pass數: 1,
      framebuffer: '正常算繪直接畫到 canvas；WebGLRenderTarget 只用於匯出',
      postprocessing: '無',
      環境貼圖: 'PMREM 一次性產生（換材質/HDRI 時才重算）',
    },
    色散: {
      色散總閘: runtime().dispersionMasterOn,
      'uDispersionEnabled': runtime().uniforms ? runtime().uniforms.uDispersionEnabled.value : null,
      'uRayDispersionEnabled': runtime().uniforms ? runtime().uniforms.uRayDispersionEnabled.value : null,
      'uSpectralCausticEnabled': runtime().uniforms ? runtime().uniforms.uSpectralCausticEnabled.value : null,
      取樣方式: '不是多次 raymarch，而是同一條光線上的 RGB 三通道相位/OPD 位移（稜光圖樣為 3 次迴圈的程序化雜訊）',
    },
  };
  console.log('[bubble diag] 現況報告', r);
  return r;
};

  return { collectGlEnvironment, computeShaderStats, captureFrameForDiff };
}
