'use strict';

export function createCompileDiagnostics(options) {
  const {
    canvas, diagnostics: DIAG, diagTimingEnabled: DIAG_TIMING, shaderRun: SHADER_RUN,
    collectGlEnvironment, computeShaderStats, waitForEnvSettled, variantKey,
    getActiveVariantKey, setActiveVariantKey, getMesh, getVariantCache,
    buildVariantMaterial, markInitialCompileDone, getRenderer, getScene, getCamera,
  } = options;

// cold compile 的時間量測（?diagTiming=1）。
//
// 絕對不做任何會強迫同步的查詢。前一版用 gl.getProgramParameter(p, LINK_STATUS)
// 逼連結完成，Windows 實測那會直接讓 Chrome 卡住 —— 它把 three.js 交給
// KHR_parallel_shader_compile 在背景做的編譯，硬拉回主執行緒等待。同一個 URL 只要
// 不帶 diagTiming 就完全正常、帶了就卡，所以卡頓是量測工具造成的，不是 shader。
//
// 改用 KHR_parallel_shader_compile 的 COMPLETION_STATUS_KHR：那個查詢會立刻回傳
// 布林值（還沒編完就是 false），不阻塞。用 rAF 輪詢直到全部為 true，記錄牆鐘時間。
const diagTiming = {
  shaderRun: null,
  parallelCompile支援: null,
  program建立到編譯完成ms: null,
  輪詢次數: null,
  第一幀render耗時ms: null,
  狀態: null,
};

let diagTimingStarted = false;

// ===== getRenderer() 後端的時間軸 =====
//
// 一筆 cold compile 的結果只說「多久」或「沒回來」，說不出這個 context 在過程中有沒有
// 換過人。Windows 上 GPU process 被打掉時 Chrome 會把 context 換成軟體算繪
// （SwiftShader），而事後只看最後一次查詢的話，「這個 probe 從頭就是軟體算繪」與
// 「它把 GPU 弄掛之後才變成軟體算繪」看起來一模一樣 —— 前者是環境設定問題，後者才是
// 我們在找的東西。所以兩個時間點都要留紀錄，加上 context 遺失事件本身。
const glTimeline = {
  renderer建立後: null,      // initGL 剛建好 renderer，還沒編譯任何 program
  編譯完成後: null,          // COMPLETION_STATUS_KHR 全部為 true 之後
  contextLost次數: 0,
  contextRestored次數: 0,
  事件: [],                  // { 距頁面載入ms, 類型, getRenderer() }
};

// 只留分辨後端要用的欄位。完整的環境每次都塞一份會讓 localStorage 與畫面都難讀，
// 而這裡要回答的問題只有「現在是哪個後端」。
function compactGlEnvironment() {
  const e = collectGlEnvironment();
  if (e.狀態) return { 狀態: e.狀態 };
  return {
    ANGLE後端推定: e.ANGLE後端推定,
    webgl版本: e.webgl版本,
    GL_RENDERER: e.GL_RENDERER,
    UNMASKED_RENDERER_WEBGL: e.UNMASKED_RENDERER_WEBGL,
  };
}

function markGlEvent(類型) {
  const at = Math.round(performance.now() * 10) / 10;
  glTimeline.事件.push({ 距頁面載入ms: at, 類型, ...compactGlEnvironment() });
  console.warn('[bubble diag] ' + 類型 + ' @ ' + at + 'ms');
  postDiagReport(類型);
}

function startGlTimeline() {
  glTimeline.renderer建立後 = compactGlEnvironment();
  // webglcontextlost 預設會讓瀏覽器不再嘗試恢復；這裡刻意不 preventDefault ——
  // 診斷要的是「實際發生了什麼」，不是改變它的行為。
  canvas.addEventListener('webglcontextlost', () => {
    glTimeline.contextLost次數++;
    markGlEvent('webglcontextlost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    glTimeline.contextRestored次數++;
    markGlEvent('webglcontextrestored');
  });
}

// ===== 把結果主動回報給父頁（postMessage）=====
//
// 為什麼不讓父頁直接讀 frame.contentWindow.__bubbleDiagReport()：那條路要求同源，
// 而它會在兩種情況下整批失效 ——
//   1. 矩陣頁用 file:// 開啟：每個 file:// document 都是獨立的 opaque origin。
//   2. iframe 的 getRenderer() process 掛掉：那個 frame 會變成 chrome-error://chromewebdata，
//      而它是 cross-origin，之後任何存取都拋 SecurityError。
// 兩種都會讓父頁收到一串看不懂的 cross-origin error，而不是「這個 probe 超時了」。
//
// postMessage 不受同源限制。真的把 getRenderer() process 弄掛時就沒有訊息會送出來，
// 父頁會乾淨地判定 TIMEOUT —— 那正是我們要的語意。
//
// targetOrigin 用 '*'：矩陣頁可能是任何 origin（含 file:// 的 "null"），而這裡送的
// 只有 GPU 字串與計時數字，沒有任何機敏資料。
function postDiagReport(reason) {
  if (window.parent === window) return;          // 不在 iframe 裡就沒有對象
  if (!DIAG.any && !DIAG_TIMING) return;         // 只在診斷模式下說話
  let payload = null;
  try {
    payload = {
      diag: DIAG.list,
      shaderRun: SHADER_RUN,
      gl環境: collectGlEnvironment(),
      gl時間軸: glTimeline,
      coldCompile: { ...diagTiming },
      shader規模: computeShaderStats(),
    };
  } catch (_) { return; }
  try {
    window.parent.postMessage(
      { source: 'bubble-diag', version: 1, reason: reason || 'update', payload },
      '*',
    );
  } catch (_) { /* 父頁不可達就算了，父頁自己會 timeout */ }
}

// 父頁可以主動要一份現況（例如 timeout 當下想知道後端有沒有變）。
window.addEventListener('message', event => {
  const d = event.data;
  if (!d || d.source !== 'bubble-diag-request') return;
  postDiagReport('requested');
});

// 非阻塞地等所有 program 編譯完成，然後才量第一幀。
//
// 順序刻意是「先 compile、輪詢到完成、才 render」：如果直接 render，three.js 內部
// 會在真正要畫之前自己把 program 準備好，那段等待就混進第一幀的時間裡，兩者分不開。
function startDiagTiming(onDone) {
  if (diagTimingStarted) { onDone(); return; }
  diagTimingStarted = true;
  // 先等環境狀態確定，理由跟正式路徑一樣：uHasEnv 是變體軸之一，不等它就會隨載入
  // 時機的抖動量到不同的 variant，同一個 URL 兩次跑出不同數字。
  waitForEnvSettled().then(() => runDiagTiming(onDone));
}

function runDiagTiming(onDone) {
  // env 確定後，第一支 variant 也要依最終狀態定案，才不會量到已經被丟棄的那一支。
  const key = variantKey();
  if (key !== getActiveVariantKey() && getMesh()) {
    const stale = getVariantCache().get(getActiveVariantKey());
    getVariantCache().delete(getActiveVariantKey());
    if (stale) { try { stale.dispose(); } catch (_) {} }
    const mat = buildVariantMaterial();
    getVariantCache().set(key, mat);
    getMesh().material = mat;
    setActiveVariantKey(key);
  }
  // 計時模式自己負責首編，之後的切換交回 syncShaderVariant（含補做被擋下的那一次）。
  markInitialCompileDone();

  const gl = getRenderer().getContext();
  let ext = null;
  try { ext = gl.getExtension('KHR_parallel_shader_compile'); } catch (_) {}
  diagTiming.shaderRun = SHADER_RUN;
  diagTiming.parallelCompile支援 = !!ext;

  if (!ext) {
    // 沒有這個擴充就無法在不阻塞的前提下知道「編完了沒」。刻意不退回同步查詢
    // —— 那正是造成卡頓的東西。
    diagTiming.狀態 = '此環境不支援 KHR_parallel_shader_compile，略過非阻塞量測';
    console.warn('[bubble diag] ' + diagTiming.狀態);
    if (DIAG.any) window.__bubbleDiagReport();
    // 一樣要回報，否則父頁只能等到 timeout 才知道這個環境量不了。
    postDiagReport('unsupported');
    onDone();
    return;
  }

  const t0 = performance.now();
  let polls = 0;

  // ===== 心跳 =====
  //
  // 這一行的價值不在「還活著」，而在它停掉的時候。
  //
  // KHR_parallel_shader_compile 只保證「查詢編譯好了沒」這個動作不阻塞，它不保證
  // 驅動真的在背景執行緒編譯。如果 ANGLE 是在 glLinkProgram 裡面同步把 HLSL 編成
  // D3D bytecode，那主執行緒會被整段扣住 —— 而那正好就是使用者感受到的「Chrome 沒
  // 反應」，也會讓 console 在那段期間一個字都印不出來（看起來像什麼都沒發生）。
  //
  // 心跳刻意在 getRenderer().compile() 之前就開始跑。之後只要看紀錄裡的空洞，就能直接
  // 讀出主執行緒被卡住多久：
  //   有心跳、沒完成 → 編譯真的在背景跑，只是慢（效能問題）
  //   心跳整段消失   → glLinkProgram 同步阻塞主執行緒（卡死的真正機制）
  //
  // 只在前景分頁判讀這個數字。分頁被切到背景時 Chrome 會把計時器節流到每秒甚至每分鐘
  // 一次，心跳自然會出現十幾秒的空洞，那是節流不是阻塞（實測背景分頁量到 15 秒「停頓」，
  // 但同一段時間 getRenderer().compile() 只花 1.7ms、分頁也一直有回應）。同理，背景分頁的
  // 輪詢次數也會遠低於實際經過時間 ÷ POLL_INTERVAL_MS。
  let lastBeat = t0;
  let maxBeatGap = 0;
  const beatTimer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastBeat;
    lastBeat = now;
    if (gap > maxBeatGap) maxBeatGap = gap;
    console.info('[bubble diag] 心跳 ' + ((now - t0) / 1000).toFixed(1) + 's'
      + '（輪詢 ' + polls + ' 次）'
      + (gap > 2000 ? '　⚠ 主執行緒剛被卡住約 ' + Math.round(gap) + 'ms' : ''));
  }, 1000);

  // compile() 只建立 program 並送出 linkProgram，不等待結果 —— 前提是驅動真的支援
  // 背景編譯。上面的心跳就是用來驗證這個前提到底成不成立。
  const compileEnteredAt = performance.now();
  getRenderer().compile(getScene(), getCamera());
  const compileReturnedAfter = Math.round((performance.now() - compileEnteredAt) * 10) / 10;
  diagTiming['renderer_compile()同步耗時ms'] = compileReturnedAfter;
  console.info('[bubble diag] getRenderer().compile() 同步部分耗時 = ' + compileReturnedAfter
    + 'ms（這段時間主執行緒是被扣住的）');
  // 用 setTimeout 而不是 rAF 輪詢：rAF 在頁面不可見／未被合成時會被瀏覽器整體暫停，
  // 那樣輪詢永遠不會執行、量測就卡在 null（本機實測踩到）。setTimeout 不受影響，
  // 而且一樣不阻塞主執行緒。
  const POLL_INTERVAL_MS = 4;
  const POLL_LIMIT = 15000;   // 約 60 秒的保險，避免無限輪詢

  const check = () => {
    polls++;
    let pending = 0;
    for (const wrapper of getRenderer().info.programs || []) {
      const glProgram = wrapper.program || wrapper;
      if (!glProgram) continue;
      // 非阻塞：還沒編完就回 false，不會等 driver
      if (!gl.getProgramParameter(glProgram, ext.COMPLETION_STATUS_KHR)) pending++;
    }

    if (pending > 0 && polls < POLL_LIMIT) {
      setTimeout(check, POLL_INTERVAL_MS);
      return;
    }

    clearInterval(beatTimer);
    // fxc 的警告。這時 COMPLETION_STATUS_KHR 已經全部為 true，program 早就連結完成，
    // 所以 getProgramInfoLog 只是把現成的字串取回來，不會逼任何等待 —— 跟舊版那個
    // 會強迫同步的 LINK_STATUS 查詢是兩回事。
    try {
      const logs = [];
      for (const wrapper of getRenderer().info.programs || []) {
        const glProgram = wrapper.program || wrapper;
        if (!glProgram) continue;
        const log = gl.getProgramInfoLog(glProgram);
        if (log && log.trim()) logs.push(log.trim());
      }
      const joined = logs.join('\n');
      diagTiming.fxc警告數 = (joined.match(/warning\s+X\d+/g) || []).length;
      diagTiming.fxc警告 = joined
        ? [...new Set(joined.split('\n').filter(l => /warning|error/i.test(l)))].join(' | ')
        : '(無)';
    } catch (e) {
      diagTiming.fxc警告 = '(讀取失敗：' + e.message + ')';
    }
    diagTiming.program建立到編譯完成ms = Math.round((performance.now() - t0) * 10) / 10;
    diagTiming.輪詢次數 = polls;
    // 整段過程中主執行緒最長被扣住多久。心跳是每秒一次，所以正常值應該接近 1000ms；
    // 明顯大於那個數字就代表有東西同步阻塞了主執行緒。
    diagTiming.最長主執行緒停頓ms = Math.round(maxBeatGap);
    // 編譯結束的當下就取後端，不要等到第一幀之後 —— 中間若換了後端就分不清是誰造成的。
    glTimeline.編譯完成後 = compactGlEnvironment();
    diagTiming.狀態 = pending > 0
      ? '輪詢超過上限仍未完成（' + pending + ' 個 program 未回報完成）'
      : '編譯完成';
    console.info('[bubble diag] program建立到編譯完成 = '
      + diagTiming.program建立到編譯完成ms + 'ms（輪詢 ' + polls + ' 次，'
      + (SHADER_RUN !== null ? 'shaderRun=' + SHADER_RUN + '，cold' : '未帶 shaderRun，可能命中快取') + '）');

    // 編譯確定完成之後才量第一幀，兩段才分得開
    const t1 = performance.now();
    getRenderer().render(getScene(), getCamera());
    diagTiming.第一幀render耗時ms = Math.round((performance.now() - t1) * 10) / 10;
    console.info('[bubble diag] 第一幀render耗時 = ' + diagTiming.第一幀render耗時ms + 'ms');

    if (DIAG.any) window.__bubbleDiagReport();
    // 父頁不必輪詢，編譯一完成就主動送出去（見 postDiagReport）。
    postDiagReport('complete');
    onDone();
  };

  setTimeout(check, 0);
}


  return {
    diagTiming, glTimeline, compactGlEnvironment, markGlEvent, startGlTimeline,
    postDiagReport, startDiagTiming, isDiagTimingStarted: () => diagTimingStarted,
  };
}
