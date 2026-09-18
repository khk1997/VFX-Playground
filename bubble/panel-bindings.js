'use strict';

import { MOTION_HDRI, MOTION_TEXT_DEFAULTS } from './motions/registry.js?v=type-center-1';
import {
  DEFAULTS, LEGACY_SELECT_VALUES, SELECT_DEFAULTS, SPECTRAL_CAUSTIC_DEFAULTS,
} from './runtime-defaults.js?v=tint-light-1';

export function createPanelBindings(options) {
  const {
    THREE, params: P, preview: PREVIEW, selects: SELECTS, toggles: TOGGLES, colors: COLORS,
    formatters: fmt, getUniforms, uniformNameFor, rotation: rot, motionMemoryKeys: MOTION_MEMORY_KEYS,
    getMotionMemory, memorySlot, applyEdgeDropDistribution, scheduleShapeAScaleRebuild,
    scheduleShapeBScaleRebuild, refreshCapillaryHeightReadout, updateEdgeTintForKey,
    buildSpectralCausticLUT, applyGates, syncShaderVariant, ensureShapeForCurrentSource,
    refreshShatterTimelineReadouts, shatterTimelineKeys: SHATTER_TIMELINE_KEYS,
    refreshTypewriterReadouts, typeTimelineKeys: TYPE_TIMELINE_KEYS, updateTimelineSummary,
    refreshLoopScaledReadouts, requestPausedRender, switchMaterialProfile, applyMemorySlots,
    backdropMemoryKeys: BACKDROP_MEMORY_KEYS, resetPreviousDropT, isInited, loadMaterialEnvironment,
    updateUIState, scheduleGLBRebuild, applyAntialiasLevel, ensureGlyphAtlas, applyToggle,
    getDispersionMaster, setDispersionMaster, dispersionToggleKeys: DISPERSION_TOGGLE_KEYS,
    setBgColorUniform, pageBackgroundCss, scheduleGlyphRebuild, buildRampLUT,
    stopMax: STOP_MAX, rampDefault: RAMP_DEFAULT, syncMotionUrl,
  } = options;

// 文字型控制項。單獨一支而不是塞進下面那個數值迴圈：那個迴圈對每個 key 一律
// parseFloat，而且每次 input 都直接寫 uniform；文字要走的是「debounce 之後重烘一份
// 字形圖集」，兩條路的生命週期完全不同。
//
// 參數組合檔不必特別處理——preset-io.js 的控件查詢本來就含 textarea[id]，
// 序列化直接讀 DOM value，所以存檔與六格快速暫存自動就支援了。
function bindTextControls() {
  for (const key of Object.keys(MOTION_TEXT_DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) continue;
    el.value = P[key];
    if (PREVIEW || el._bound) continue;
    el.addEventListener('input', () => {
      P[key] = el.value;
      if (key === 'typeText') scheduleGlyphRebuild();
    });
    el._bound = true;
  }
}

function bindControls() {
  // 數值型控制項（滑桿與以數字作為 option value 的下拉選單）
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const uName = uniformNameFor(key);
    const update = () => {
      const previousValue = P[key];
      P[key] = key === 'count' && P.motion === 'research' ? 2 : parseFloat(el.value);
      // 舊 preset 載入 count=1 時不只渲染要修正，DOM 也要同步，下一次匯出才不會
      // 又把舊值寫回檔案。私語模式的 count 列本來就是隱藏的，不會限制正常操作。
      if (key === 'count' && P.motion === 'research') el.value = '2';
      if (key === 'cameraRotationX') rot.x = P[key] * Math.PI / 180;
      if (key === 'cameraRotationY') rot.y = P[key] * Math.PI / 180;
      if (MOTION_MEMORY_KEYS.includes(key)) {
        getMotionMemory()[key][memorySlot(key)] = key === 'count' ? Math.round(P[key]) : P[key];
      }
      if (key === 'shapeLiquidPosition') applyEdgeDropDistribution(P[key]);
      if (key === 'shapeAScale') scheduleShapeAScaleRebuild();
      if (key === 'shapeBScale') scheduleShapeBScaleRebuild();
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
      if (key === 'capillaryRings') refreshCapillaryHeightReadout();
      // 這兩個是數值型的 select，但它們的身分是「總開關」而不是單純的參數：
      // 會改變哪些控制項該顯示，staticShape 還會改變要編譯哪一支 shader。
      // 走 SELECTS 的字串型 select 在 change 時會自動呼叫 updateUIState() 與
      // syncShaderVariant()，但這兩個走的是這裡的數值型通用迴圈，得自己補。
      updateEdgeTintForKey(key);
      if (key === 'spectralCausticBlend') buildSpectralCausticLUT();
      if (key === 'capillaryTexture') applyGates();
      // 同理：私語的程序紋理選「無」時，紋理方向那三根滑桿要一起收起來。
      if (key === 'researchShellTexture') applyGates();
      if (key === 'staticShape' && previousValue !== P[key]) {
        applyGates();
        // 內建幾何走程序化 SDF、匯入走形狀場，是兩支不同的 shader。少了這行，
        // 切到「匯入」時畫面會停在舊的變體上，匯入的造型永遠不會出現。
        syncShaderVariant();
        // 切到「匯入」時才需要把內建展示造型載進來（使用者還沒自己匯入的話）。
        ensureShapeForCurrentSource();
      }
      if (getUniforms() && getUniforms()[uName]) getUniforms()[uName].value = (key === 'count') ? Math.round(P[key]) : P[key];
      if (SHATTER_TIMELINE_KEYS.includes(key)) refreshShatterTimelineReadouts();
      if (TYPE_TIMELINE_KEYS.includes(key)) refreshTypewriterReadouts();
      if (key === 'gatherDuration' || key === 'shapeHold' || key === 'loopDuration') {
        updateTimelineSummary();
        // 循環秒數變了，那些「比例 × 循環秒數」的讀數也要跟著換算，但不動
        // 使用者設定的比例值，所以只重畫文字，不重新觸發 input。
        if (key === 'loopDuration') refreshLoopScaledReadouts();
      }
      requestPausedRender();
    };
    el.value = P[key];
    if (!PREVIEW && !el._bound) {
      el.addEventListener('input', update);
      // 這條迴圈也管「以數字作為 option value 的下拉選單」（程序紋理、波場類型）。
      // 使用者手動操作 <select> 時瀏覽器 input/change 都會發，但切換動態模式時
      // 還原按模式記憶的值那段（見下方 MOTION_MEMORY_KEYS 的迴圈）對 SELECT 送的
      // 是 change——只綁 input 的話，程序紋理這種被記憶的 select 會只換了顯示值
      // 而 P 沒跟著更新。update 本身是冪等的，兩個事件都綁不會有副作用。
      el.addEventListener('change', update);
      el._bound = true;
    }
    update();
  }
  // 下拉選單
  for (const key of Object.keys(SELECTS)) {
    const el = document.getElementById(key);
    const { uniform, map } = SELECTS[key];
    const update = () => {
      // 舊的參數組合可能還存著已移除的選項。寫進 <select> 後 value 會變成空
      // 字串，往下就是 map[''] === undefined 汙染 uniform，所以在這裡收斂：
      // 有對應的舊選項就導過去（脈動呼吸的參數組合仍會帶著形狀），否則回預設。
      const legacy = LEGACY_SELECT_VALUES[key]?.[el.value];
      if (legacy) el.value = legacy;
      else if (!(el.value in map)) el.value = SELECT_DEFAULTS[key];
      const previousMotion = P.motion;
      const previousValue = P[key];
      P[key] = el.value;
      if (key === 'materialStyle' && previousValue !== P[key]) {
        switchMaterialProfile(previousValue, P[key]);
      }
      if (key === 'backdrop' && previousValue !== P[key]) {
        // 只搬跟底色有關的那幾根，其餘的兩個情境共用同一格，碰都不該碰。
        applyMemorySlots(
          BACKDROP_MEMORY_KEYS, P.motion, P.motion, previousValue, P[key],
        );
      }
      if (key === 'motion' && previousMotion !== P.motion) {
        // 毛細波只允許形狀場本體。舊的自動保存／參數檔可能還記著早期版本的
        // count=12；除了渲染端強制歸零，這裡也把模式記憶清成 0，避免隱藏欄位
        // 繼續被匯出成看似有效的水滴設定。
        if (P.motion === 'capillary') getMotionMemory().count.capillary = 0;
        // 每個按模式記憶的參數：先把舊模式剛才的值存回去，再把新模式記得的值
        // 寫回控制項並觸發它自己的 input/change，讓 uniform、顯示文字、
        // applyEdgeDropDistribution 之類的副作用照常跑一次，不必在這裡重複。
        applyMemorySlots(MOTION_MEMORY_KEYS, previousMotion, P.motion, P.backdrop, P.backdrop);
        resetPreviousDropT();
        // 模式指定的 HDRI：進出私語這類自帶環境貼圖的模式時要換圖，回到沒有
        // 指定的模式則換回材質類型原本那張。兩邊都沒有指定就不用動 —— 重載一
        // 張 1MB 的 HDRI 還要重跑 PMREM，不是每次切模式都該付的成本。
        if (isInited() && (MOTION_HDRI[previousMotion] || MOTION_HDRI[P.motion])) {
          loadMaterialEnvironment(P.materialStyle);
        }
        // 網址跟著模式走，重新整理與複製連結才會停在正在看的這個模式。
        syncMotionUrl();
      }
      if (getUniforms() && getUniforms()[uniform]) getUniforms()[uniform].value = map[el.value];
      if (key === 'backdrop' && getUniforms()) {
        getUniforms().uLightBgGradientEnabled.value = P.backdrop === 'light' ? 1 : 0;
      }
      updateUIState();
      if (key === 'shapeQuality' && previousValue !== P[key]) {
        scheduleGLBRebuild();
      }
      if (key === 'antialiasLevel') applyAntialiasLevel();
      if ((key === 'motion' || key === 'shapeSource') && previousValue !== P[key]) {
        ensureShapeForCurrentSource();
      }
      // 字形圖集只在真正切進打字模式時才烘（一次同步的 EDT，不該在其他模式付這個
      // 錢）。ensureGlyphAtlas 自己會判斷模式與文字有沒有變。
      if (key === 'motion') ensureGlyphAtlas();
      // motion / shapeSource / materialStyle / rayBeamPattern 都可能改變要編譯的功能
      // 組合。syncShaderVariant 自己會判斷有沒有變，沒變就是零成本。
      syncShaderVariant();
      requestPausedRender();
    };
    el.value = P[key];
    if (!PREVIEW && !el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 材質功能開關
  for (const key of Object.keys(TOGGLES)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const label = el.closest('.toggleRow')?.querySelector('label');
    const update = () => {
      P[key] = el.checked;
      if (MOTION_MEMORY_KEYS.includes(key)) getMotionMemory()[key][memorySlot(key)] = P[key];
      if (valEl) valEl.textContent = P[key] ? '開啟' : '關閉';
      applyToggle(key);
      updateUIState();
      requestPausedRender();
    };
    el.checked = P[key];
    // 原生 checkbox 為視覺隱藏狀態；將文字標籤正式連到 input，
    // 讓使用者點標籤也能切換，而不必精準命中 34px 的滑軌。
    if (label) label.htmlFor = key;
    const track = el.nextElementSibling;
    if (!PREVIEW && track && !track._bound) {
      track.addEventListener('click', event => {
        // 開關長在 <summary> 上時（.summaryToggle，例如「造型動態」與私語那幾個
        // 小節），按滑軌不該順手把整節收起來。原本只在 summary 上擋冒泡，但
        // <details> 的展開是 summary 的「啟用行為」——stopPropagation 只擋監聽器，
        // 擋不掉啟用行為，要 preventDefault 才行。滑軌自己沒有任何預設行為（真正
        // 的 checkbox 是它旁邊那顆視覺隱藏的 input，狀態由下面那行手動翻），
        // 所以無條件擋掉是安全的。
        event.preventDefault();
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      track._bound = true;
    }
    if (!PREVIEW && !el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 色散總開關：只是一個總閘，不動 ART／RAY／LIGHT 各自的開關狀態——關閉時
  // 三個效果一律停用，重新打開後各自回到原本開/關的樣子（見 applyToggle）。
  const dispersionMaster = document.getElementById('dispersionMaster');
  const dispersionMasterTrack = dispersionMaster.nextElementSibling;
  dispersionMaster.checked = getDispersionMaster();
  if (!PREVIEW && dispersionMasterTrack && !dispersionMasterTrack._bound) {
    dispersionMasterTrack.addEventListener('click', () => {
      setDispersionMaster(!getDispersionMaster());
      dispersionMaster.checked = getDispersionMaster();
      DISPERSION_TOGGLE_KEYS.forEach(k => applyToggle(k));
      updateUIState();
      requestPausedRender();
    });
    dispersionMasterTrack._bound = true;
  }
  // 顏色
  for (const key of Object.keys(COLORS)) {
    const el = document.getElementById(key);
    const uName = COLORS[key];
    const update = () => {
      P[key] = el.value;
      updateEdgeTintForKey(key);
      if (!uName) { /* LUT / 後處理顏色不直接對應 uniform */ }
      else if (key === 'bgColor') setBgColorUniform(el.value);
      // 見上面 applyAllUniforms 裡同一個特例的說明。
      else if (key === 'absorbColor' || key === 'researchIconTintColor'
      || key === 'researchShellTintColor'
      || key === 'lightIconColor' || key === 'lightIconRimColor'
      || key === 'lightBgGradientTop' || key === 'lightBgGradientBottom') {
        if (getUniforms()) getUniforms()[uName].value.setStyle(el.value, THREE.LinearSRGBColorSpace);
      }
      else if (getUniforms()) getUniforms()[uName].value.set(el.value);
      if (key === 'bgColor') {
        document.body.style.background = (P.bgMode === 'hdri') ? '#000' : pageBackgroundCss(el.value);
        updateUIState();
      }
      requestPausedRender();
    };
    el.value = P[key];
    if (!PREVIEW && !el._bound) { el.addEventListener('input', update); el._bound = true; }
    update();
  }
  const clearIconPreset = document.getElementById('clearIconPreset');
  if (!PREVIEW && !clearIconPreset._bound) {
    clearIconPreset.addEventListener('click', () => {
      for (const [key, value] of Object.entries({ lightIconColor: '#d9f3ff',
        lightIconClarity: 0.58, lightIconTint: 0.42, lightIconRimColor: '#3aa9df',
        lightIconRimStrength: 0.62, lightIconEdge: 5.2 })) {
        const input = document.getElementById(key);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    clearIconPreset._bound = true;
  }
  bindSpectralCausticColors();
  bindRamp();
  updateUIState();
}

function bindSpectralCausticColors() {
  for (let i = 0; i < SPECTRAL_CAUSTIC_DEFAULTS.length; i++) {
    const key = 'spectralCausticCol' + i;
    const el = document.getElementById(key);
    el.value = P[key];
    if (!PREVIEW && !el._bound) {
      el.addEventListener('input', () => {
        P[key] = el.value;
        buildSpectralCausticLUT();
        requestPausedRender();
      });
      el._bound = true;
    }
  }
  buildSpectralCausticLUT();
}

function resetSpectralCausticColors() {
  SPECTRAL_CAUSTIC_DEFAULTS.forEach((_, i) => {
    const key = 'spectralCausticCol' + i;
    document.getElementById(key).value = P[key];
  });
  buildSpectralCausticLUT();
}

// 自訂漸層色標：數量 + 每色位置
function updateRampRows() {
  const n = Math.round(parseFloat(document.getElementById('rampCount').value));
  for (let i = 0; i < STOP_MAX; i++) {
    document.getElementById('stopRow' + i).style.display = (i < n) ? 'flex' : 'none';
  }
}
function bindRamp() {
  const rc = document.getElementById('rampCount');
  const rcv = document.getElementById('rampCount_v');
  const onCount = () => { rcv.textContent = Math.round(parseFloat(rc.value)).toFixed(0); updateRampRows(); buildRampLUT(); updateUIState(); };
  if (!PREVIEW && !rc._bound) { rc.addEventListener('input', onCount); rc._bound = true; }
  onCount();
  for (let i = 0; i < STOP_MAX; i++) {
    const col = document.getElementById('stopCol' + i);
    const pos = document.getElementById('stopPos' + i);
    const pv = document.getElementById('stopPos' + i + '_v');
  const upd = () => {
    if (pv) pv.textContent = parseFloat(pos.value).toFixed(2);
    buildRampLUT();
    requestPausedRender();
  };
    if (!PREVIEW && !col._bound) { col.addEventListener('input', upd); col._bound = true; }
    if (!PREVIEW && !pos._bound) { pos.addEventListener('input', upd); pos._bound = true; }
    upd();
  }
}
function resetRamp() {
  document.getElementById('rampCount').value = RAMP_DEFAULT.count;
  for (let i = 0; i < STOP_MAX; i++) {
    document.getElementById('stopCol' + i).value = RAMP_DEFAULT.cols[i];
    document.getElementById('stopPos' + i).value = RAMP_DEFAULT.pos[i];
  }
}


  return {
    // updateRampRows 一併交出去：套用參數組合檔之後，bubble.js 的 afterApply 要把
    // 色標列、兩張 LUT 與邊緣染色整組重刷一次，它是其中一步。這個函式讀的是
    // STOP_MAX 這個 options 閉包變數，所以只能從這裡交出來，不能在呼叫端另寫
    // 一份——兩份色標上限遲早會對不上。
    bindTextControls, bindControls, resetSpectralCausticColors, resetRamp, updateRampRows,
  };
}
