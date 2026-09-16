'use strict';
import * as THREE from 'three';
import { buildInspector } from './inspector.js?v=panel-ux-3';
import { createAdaptiveQuality, QUALITY_TIER_NAMES } from './adaptive-quality.js?v=2';
import { initQuickSlots } from './quick-slots.js?v=1';
import { createGpuProfiler } from './gpu-profiler.js?v=1';
let inspector = null;
import { EDGE_TINT_TARGETS, edgeTintKeys, sanitizeEdgeTintValue, readEdgeTintStops, sampleEdgeTint } from './edge-tint.js?v=dark-tint-1';
import {
  svgToField, gltfToField, objectToField, packShapePairTexture,
} from './shape-field.js?v=typewriter-1';
import {
  DEFAULT_SVG_NAME, DEFAULT_SOLID_NAME, buildDefaultSolid, makeDefaultSvgFile,
  MELT_DEFAULT_SVG_NAME, makeMeltDemoSvgFile,
  MORPH_TARGET_SVG_NAME, makeMorphTargetSvgFile,
  MORPH_TARGET_SOLID_NAME, buildMorphTargetSolid,
} from './default-shapes.js?v=svg-shape-76';
import {
  MOTION_UNIFORM_MAP, MOTION_SVG_DEMO,
  MOTION_HDRI, MOTION_KEYS, MOTION_TEXT_DEFAULTS, usesShapeField,
} from './motions/registry.js?v=edge-tint-1';
import { fract, hash11CPU, smoothstepCPU } from './motions/util.js?v=svg-shape-76';
import createShatterMotion from './motions/shatter.js?v=svg-shape-76';
import createFormationMotion, { MICRO_ORBIT_TUNE } from './motions/formation.js?v=svg-shape-76';
import createMorphMotion, { buildMorphPairs } from './motions/morph.js?v=post-mask-3';
import createShapeRigidMotion, { computeShapeRigid } from './motions/shapeRigid.js?v=post-mask-3';
import {
  createExtendedMotionRuntime, effectiveCapillaryHeight, isExtendedMotion,
} from './motions/extended/index.js?v=extended-motions-4';
import { PMREMGenerator } from './vendor/PMREMGenerator.js';
import patchEnvMapResolution from './vendor/patchEnvMapResolution.js';
import { parseBubbleRuntimeOptions } from './diagnostics.js?v=1';
import { createMaterialTextureController } from './material-textures.js?v=1';
import { createEnvironmentLoader, selectMaterialEnvironment } from './environment-loader.js?v=1';
import { describeShapeImport, loadShapeAsset } from './shape-loader.js?v=1';
import { createShaderVariantPlanner, VariantMaterialCache } from './shader-variants.js?v=1';
import {
  contactMergeAmount, findClosestDropPair, updateDropBounds,
} from './drop-physics.js?v=1';
import {
  distributeDetailedAnchors, distributeFormationAnchors, distributePrimaryAnchors,
  formationEdgeScaleFor, scaleShapePoints as scalePoints,
} from './shape-anchors.js?v=1';
import {
  COLOR_DEFAULTS, DEFAULTS, LEGACY_SELECT_VALUES, SELECT_DEFAULTS,
  SPECTRAL_CAUSTIC_DEFAULTS, TOGGLE_DEFAULTS, isFormationMotion,
} from './runtime-defaults.js?v=1';
import {
  BACKDROP_SCOPED_KEYS, createMemorySlot, createMotionMemory, motionDefaultsFor,
} from './runtime-memory.js?v=1';
import {
  COLORS, SELECTS, createFormatters, createToggleBindings,
} from './control-schema.js?v=1';
import { createTypewriterRuntime } from './typewriter-runtime.js?v=1';
import { createStaticCapillaryRuntime } from './motions/runtime/static-capillary.js?v=1';
import { createJellyRuntime } from './motions/runtime/jelly.js?v=1';
import { createResearchRuntime } from './motions/runtime/research.js?v=1';
import { createMeltRuntime } from './motions/runtime/melt.js?v=1';
import { buildExtendedMotionControls } from './panel-builder.js?v=1';
import { createPanelStateController } from './panel-state.js?v=1';
import { createPanelBindings } from './panel-bindings.js?v=1';
import { createExportRuntime } from './export-runtime.js?v=1';
import { createCompileDiagnostics } from './compile-diagnostics.js?v=1';
import { createRuntimeDiagnostics } from './runtime-diagnostics.js?v=1';

// 提高 PMREM 高粗糙度的最低預過濾解析度，避免 16×16 tile 造成方格反射。
patchEnvMapResolution();

const {
  preview: PREVIEW,
  shaderRun: SHADER_RUN,
  diagTiming: DIAG_TIMING,
  diagTime: DIAG_TIME,
  diagCapture: DIAG_CAPTURE,
  forceFeatures: FORCE_FEATURES,
  diagnostics: DIAG,
} = parseBubbleRuntimeOptions(location.search);
if (PREVIEW) document.documentElement.classList.add('preview-mode');
if (DIAG.any) console.info('[bubble diag] 啟用:', DIAG.list.join(', '));

const canvas = document.getElementById('stage');
let stagePresented = false;
let stagePresentTimer = 0;
// 首頁 iframe 的第一個 draw 可能仍在完成環境反射／材質上傳；若立刻顯示，
// 使用者會看到一個偏暗、偏小的中間影格，下一幀才跳成正式預覽。正式效果頁
// 不需要這個窗口，只有 preview=1 延後一小段時間讓首輪畫面穩定。
const PREVIEW_PRESENT_DELAY_MS = 260;
function markStagePresented() {
  if (stagePresented || stagePresentTimer) return;
  const reveal = () => {
    stagePresentTimer = 0;
    if (stagePresented) return;
    stagePresented = true;
    document.body.dataset.stageReady = 'true';
  };
  if (PREVIEW) stagePresentTimer = window.setTimeout(reveal, PREVIEW_PRESENT_DELAY_MS);
  else reveal();
}
const mobileRenderQuery = window.matchMedia('(max-width: 760px)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const GLASS_HDRI_URL = new URL('./assets/photo_studio2_london_hall_1k.hdr', import.meta.url).href;
const GLASS_HDRI_LABEL = 'photo_studio2_london_hall_1k.hdr';
// 動態模式自己指定的環境貼圖（registry.js 的 hdri 欄位）。HDRI 平常跟著材質
// 類型走，但某些模式的外觀是照特定一張棚燈校出來的，換一張反射就全變了。
function motionEnvironmentFor(motion) {
  const name = MOTION_HDRI[motion];
  if (!name) return null;
  return {
    url: new URL(`./assets/${name}`, import.meta.url).href,
    label: name,
    isHDR: /\.hdr$/i.test(name),
    file: null,
  };
}
const MAX_DROPS = 12;
// 必須跟 shaders.js 的 MAX_MICRO 一致（那邊是 GLSL 的迴圈上界，改一邊就對不上）。
// 48 是為了細長的造型（例如筆畫細、鋪得又寬的文字外框）：20 顆微滴攤在那種形狀上
// 稀到讀不出「水滴在組成這個字」。march 迴圈是 `m >= uMicroCount` 動態跳出，所以
// 這個上界只影響著色器的展開大小，實際成本跟著滑桿的值走——預設仍是 14，拉高
// 才付錢。
const MAX_MICRO_DROPS = 48;
const MAX_EDGE_DROPS = 8;
const MAX_NEGATIVE_DROPS = 4;

const P = { ...DEFAULTS, ...MOTION_TEXT_DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS };
const extendedMotions = createExtendedMotionRuntime(P);

// 材質目前統一為通用玻璃。保留單一 profile，供 HDRI 匯入與重設共用。
const MATERIAL_PROFILE_KEYS = [
  'hdriYaw', 'hdriPitch', 'hdriBlur', 'envRefraction',
  'reflect', 'transmission', 'materialExposure',
  'roughness', 'fresnel', 'ior',
  // 薄膜式藝術色散：白底薄膜的顯色幾乎全靠它，跟通用玻璃要的分佈差很多
  // （通用玻璃靠折射堆疊出顏色，薄膜是整片透光、顏色要自己長出來），
  // 所以兩種材質也各記一份。
  'dispersion', 'dispersionSeparation', 'artThickness', 'artThickVar',
  'artNoiseScale', 'artPatternSpeed', 'artGravity',
  'causticScale', 'causticSharpness',
];
const pickMaterialProfile = source => Object.fromEntries(
  MATERIAL_PROFILE_KEYS.map(key => [key, source[key]])
);
const MATERIAL_PROFILE_DEFAULTS = {
  universal: pickMaterialProfile(P),
};
const MATERIAL_ENVIRONMENT_DEFAULTS = {
  universal: { url: GLASS_HDRI_URL, label: GLASS_HDRI_LABEL, isHDR: true, file: null },
};
let materialProfiles = {};
let materialEnvironments = {};
function resetMaterialProfiles() {
  materialProfiles = {
    universal: { ...MATERIAL_PROFILE_DEFAULTS.universal },
  };
  materialEnvironments = {
    universal: { ...MATERIAL_ENVIRONMENT_DEFAULTS.universal },
  };
}
resetMaterialProfiles();
const MOBILE_CAMERA_DISTANCE_DEFAULT = 4.3;
if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
const memorySlot = createMemorySlot(P);
// 把一批被記憶的參數從「舊的格子」搬到「新的格子」：先把控制項現在的值存回舊
// 格，再把新格記得的值寫回控制項並觸發它自己的 input/change。
//
// 觸發事件而不是直接改 P，是為了讓 uniform、顯示文字、applyEdgeDropDistribution
// 之類的副作用照常各跑一次，不必在這裡重複一份。切模式與切底色情境走的是同一支
// —— 兩者的差別只有「哪些 key」與「格子的哪一維在變」。
function applyMemorySlots(keys, fromMotion, toMotion, fromBackdrop, toBackdrop) {
  for (const key of keys) {
    motionMemory[key][memorySlot(key, fromMotion, fromBackdrop)] = P[key];
    const el = document.getElementById(key);
    if (!el) continue;
    const next = motionMemory[key][memorySlot(key, toMotion, toBackdrop)];
    if (el.type === 'checkbox') {
      el.checked = next;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = next;
      el.dispatchEvent(new Event(
        el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true },
      ));
    }
  }
}
let motionMemory = createMotionMemory();
const MOTION_MEMORY_KEYS = Object.keys(motionMemory);
// 把目前這一格的值鏡射到另一個底色情境的同一格。
//
// 為什麼需要：載入參數檔（或自動保存的還原）只會寫進「當時所在底色」那一格，
// 另一格還留著內建預設。於是切換底色時，那些 key 會突然跳回預設值，看起來像
// 「淺底又跟深底不一樣了」。淺底目前沒有獨立的定案數值（見 BACKDROP_SCOPED_KEYS
// 的說明），所以載入後兩格應該相同，之後使用者在淺底調什麼才是真正的差異。
function mirrorBackdropMemory() {
  const other = P.backdrop === 'dark' ? 'light' : 'dark';
  for (const key of BACKDROP_MEMORY_KEYS) {
    motionMemory[key][memorySlot(key, P.motion, P.backdrop)] = P[key];
    if (!EDGE_TINT_TARGETS.some(p => edgeTintKeys(p).includes(key))) {
      motionMemory[key][memorySlot(key, P.motion, other)] = P[key];
    }
  }
}

function serializeTintMemory() {
  const tintMemory = {};
  for (const key of EDGE_TINT_TARGETS.flatMap(edgeTintKeys)) {
    tintMemory[key] = { ...motionMemory[key], [memorySlot(key)]: P[key] };
  }
  return { tintMemory };
}

function restoreTintMemory(payload) {
  const saved = payload.extra?.tintMemory;
  for (const key of EDGE_TINT_TARGETS.flatMap(edgeTintKeys)) {
    const slots = motionDefaultsFor(key);
    for (const slot of Object.keys(slots)) {
      const value = sanitizeEdgeTintValue(key, saved?.[key]?.[slot]);
      if (value !== undefined) slots[slot] = value;
    }
    if (!saved) {
      // Legacy tint controls only affected light backdrops, even when saved on dark.
      const value = payload.values[key] ?? (DEFAULTS[key] ?? TOGGLE_DEFAULTS[key] ?? COLOR_DEFAULTS[key]);
      const valid = sanitizeEdgeTintValue(key, typeof value === 'string' && !key.includes('Color') ? Number(value) : value);
      if (valid !== undefined) slots[`${P.motion}|light`] = valid;
    } else {
      // Visible controls are authoritative for the active backdrop.
      slots[memorySlot(key)] = P[key];
    }
    motionMemory[key] = slots;
    const el = document.getElementById(key);
    const next = slots[memorySlot(key)];
    if (el.type === 'checkbox') el.checked = next;
    else el.value = next;
    el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
  }
}
// 切換底色情境時要搬的那一批。由交集導出而不是另外手寫一份名單：BACKDROP_SCOPED_KEYS
// 裡若有哪個 key 忘了加進 MOTION_SCOPED_KEYS，它在 motionMemory 裡根本沒有格子，
// 手寫名單會在這裡炸掉，交集則是安全地略過它。
const BACKDROP_MEMORY_KEYS = MOTION_MEMORY_KEYS.filter(k => BACKDROP_SCOPED_KEYS.has(k));
// 初始模式（SELECT_DEFAULTS.motion）不會經過 select 的 change 事件，
// 切模式時「套用該模式記憶值」那段回寫邏輯不會跑。以前預設模式是分裂、
// 沒有 overrides，這個落差看不出來；現在預設模式換成靜態、帶了整組材質
// overrides，得在這裡把起始 P 值先補成該模式記得的值，跟切換模式時的行為一致。
for (const key of MOTION_MEMORY_KEYS) P[key] = motionMemory[key][memorySlot(key)];

// 自訂漸層色標（最多 6，可調位置）— reset 用
const STOP_MAX = 6;
const RAMP_DEFAULT = {
  count: 6,
  cols: ['#3698d8', '#b794a6', '#d1aa75', '#b2b3b4', '#9e7d98', '#5dbded'],
  pos:  [0.56, 0.20, 0.39, 0.60, 0.27, 0.66],
};

const TOGGLES = createToggleBindings(applyEdgeDropDistribution);

const DISPERSION_TOGGLE_KEYS = ['dispersionEnabled', 'rayDispersionEnabled', 'spectralCausticEnabled'];
// 色散總開關：純粹是一個總閘，關閉時三個效果一律停用，但不動它們各自的
// 開關狀態；重新打開總開關後，各效果回到自己原本開/關的樣子。不隨參數組合
// 存檔，只是面板互動的捷徑，所以是一個獨立於 P 的暫時狀態。
// 診斷 nodispersion 直接把總閘關掉：applyToggle 已經用它 gate 這三個效果，
// 等同面板上關掉「色散」總開關，是程式本來就支援的狀態。
let dispersionMasterOn = !DIAG.nodispersion;

function applyToggle(key) {
  const target = TOGGLES[key];
  if (typeof target === 'function') target();
  else if (uniforms && uniforms[target]) {
    const effective = DISPERSION_TOGGLE_KEYS.includes(key) ? (P[key] && dispersionMasterOn) : P[key];
    uniforms[target].value = effective ? 1 : 0;
  }
  // 薄膜與三個色散開關會改變要編譯哪些功能；切到新組合時在背景預編譯，
  // 編好之前繼續用目前這一支（見 syncShaderVariant）。
  syncShaderVariant();
}

// DEFAULTS 的 key 一律用 'u' + 首字大寫推導 uniform 名稱（uReflect、uRoughness...），
// 但 IOR 照慣例整個縮寫大寫，'uIor' 對不上 shader 裡宣告的 uIOR，需要例外表。
// 形狀變形的波前軟硬屬於「形狀切削」那組 uniform（uShapeCut／uShapeMorph），
// 命名跟著那組走，而不是跟著滑桿 key 走。
const UNIFORM_NAME_OVERRIDES = { ior: 'uIOR', morphCutBlend: 'uShapeCutBlend' };
function uniformNameFor(key) {
  return UNIFORM_NAME_OVERRIDES[key] || ('u' + key.charAt(0).toUpperCase() + key.slice(1));
}

const fmt = createFormatters(P, {
  effectiveCapillaryHeight,
  shatterSegmentSeconds: (...args) => shatterSegmentSeconds(...args),
});

// 靜態方體與毛細波的執行期模組。這兩個模式共用同一組程序化表面紋理 uniform，
// 由模組自己負責寫入；bubble.js 只在 updateDropUniforms 裡依 active() 決定
// 要走這條還是其餘模式的通用分支。
const staticCapillaryRuntime = createStaticCapillaryRuntime({
  params: P,
  motionUniformMap: MOTION_UNIFORM_MAP,
});

function refreshCapillaryHeightReadout() {
  const value = document.getElementById('capillaryHeight_v');
  if (value) value.textContent = fmt.capillaryHeight(P.capillaryHeight);
}

// 崩解噴濺的四段時長是正規化的相對權重，所以動任何一段，其他三段實際佔的秒數
// 都會跟著變 —— 讀數必須一起重畫，不能只更新被拖動的那一個。
// 打字的四段時長同樣是正規化的相對權重（見 motions/typewriter.js），所以讀數也
// 必須整組一起重畫。
const TYPE_TIMELINE_KEYS = ['typeCharTime', 'typeHold', 'typeEraseTime', 'typeGap'];
const SHATTER_TIMELINE_KEYS = ['shatterRest', 'shatterChargeTime', 'shatterFlight', 'shatterReform'];
function refreshShatterTimelineReadouts() {
  for (const key of SHATTER_TIMELINE_KEYS) {
    const valEl = document.getElementById(key + '_v');
    if (valEl) valEl.textContent = fmt[key]();
  }
  const total = document.getElementById('shatterTotal');
  if (total) total.textContent = `四段合計 ${P.loopDuration.toFixed(1)}s（＝循環秒數）`;
}

// 這幾個滑桿存的是「佔循環的比例」，讀數卻顯示換算後的秒數，所以循環秒數一變
// 就得重畫，否則會停在用舊循環長度算出來的數字。切換動態模式時循環秒數會跟著
// 換（每個模式各自記憶），所以這不是罕見情況——morphHold 一開始就漏了列進來，
// 結果切到形狀變形時定格時間顯示的是用上一個模式的循環秒數算的值。
const LOOP_SCALED_KEYS = [
  'gatherDuration', 'shapeHold', 'morphHold', 'rayBeamSpeed',
  'researchIconPhaseOffset', 'researchIconBirthStagger',
];
function refreshLoopScaledReadouts() {
  for (const key of LOOP_SCALED_KEYS) {
    const valEl = document.getElementById(key + '_v');
    if (valEl) valEl.textContent = fmt[key](P[key]);
  }
  refreshShatterTimelineReadouts();
  refreshTypewriterReadouts();
}

import { VERT, FRAG, FRAG_BASELINE } from './shaders.js?v=structured-1';
import { createPostChain } from './post.js?v=post-mask-3';

const {
  diagTiming, glTimeline, compactGlEnvironment, markGlEvent, startGlTimeline,
  postDiagReport, startDiagTiming, isDiagTimingStarted,
} = createCompileDiagnostics({
  canvas, diagnostics: DIAG, diagTimingEnabled: DIAG_TIMING, shaderRun: SHADER_RUN,
  collectGlEnvironment: (...args) => collectGlEnvironment(...args),
  computeShaderStats: (...args) => computeShaderStats(...args), waitForEnvSettled,
  variantKey: (...args) => variantKey(...args),
  getActiveVariantKey: () => activeVariantKey,
  setActiveVariantKey: key => { activeVariantKey = key; },
  getMesh: () => mesh, getVariantCache: () => variantCache, buildVariantMaterial,
  markInitialCompileDone, getRenderer: () => renderer, getScene: () => scene,
  getCamera: () => camera,
});

// 這一份 shader 要編譯哪些功能。回傳的物件直接交給 ShaderMaterial.defines，
// Three.js 會在 fragment shader 前面注入對應的 #define，GLSL 那邊用 #ifdef
// 把整個區塊在「編譯期」移除 —— 不是 runtime 的 uniform 分支，ANGLE 翻成 HLSL
// 時那些程式碼根本不存在。
//
// 為什麼需要這個：Windows Chrome 走 ANGLE，GLSL 要先翻成 HLSL 再編譯成 D3D
// bytecode，而 HLSL 編譯器對大型巢狀迴圈會嘗試積極展開。這支 fragment shader
// 有 2200 行、主 raymarch 迴圈上限 88 次、而 mapScene 內部還有四層迴圈（其中
// 微滴那層 48 次且含 texture2D），編譯本身就會讓整個瀏覽器無回應（實測
// ?diag=compileonly 直接卡死，完整版也一樣）。
//
// 目前只有 ?diag=minshader 會走精簡組合，其餘情況一律編譯完整功能 ——
// 完整版不永久移除任何功能。日後要做「依模式編譯 variant + program cache」時，
// 這個函式就是唯一的決策點：把判斷條件從 DIAG.minshader 換成當前模式需要什麼。
// 基線與所有 probe 都共用 FRAG_BASELINE 那支最小 shader，差別只在 PROBE_* 開關。
// 這樣「baseline → +A → +B」每一步的差異就只有一個功能，不會混進別的變因。
// ===== 變體快取 =====
//
// 一個 key 對應一支已經編好的 ShaderMaterial。切回用過的組合時直接取用，零編譯。
//
// 上限存在的理由：每個 variant 是一支真的 WebGL program，佔 GPU 記憶體。12 個足夠
// 覆蓋一般使用會碰到的組合，超過就以 LRU 淘汰並 dispose。
const VARIANT_CACHE_LIMIT = 12;
const variantCache = new VariantMaterialCache(VARIANT_CACHE_LIMIT, key => {
  console.info('[bubble variant] 淘汰 ' + key);
});
let activeVariantKey = null;
let variantSwapInFlight = null;     // 正在背景預編譯的 key，避免重複發動
const variantStats = { 命中: 0, 未命中: 0, 最後一次切換ms: null, 最後一次是命中: null };

function touchVariant(key) {
  return variantCache.touch(key);
}

function evictVariantsIfNeeded() {
  variantCache.evict(activeVariantKey);
}

// ===== 環境貼圖就緒與否 =====
//
// uHasEnv 是變體軸之一：HDRI 載入前是 0，載入後變 1。如果不等它就先編第一支，
// 冷載入會編兩次（先無 env、HDRI 到了再編有 env 的），而每一次都是十秒級。
//
// 所以第一支 variant 一律等到 env 狀態「確定」之後才決定。確定包含三種：載入成功、
// 載入失敗、以及等太久 —— 後兩者都讓 uHasEnv 維持 0，編出無 env 的變體，畫面照樣
// 出得來（那本來就是沒有 HDRI 時的正常路徑）。絕不無限等待。
const ENV_SETTLE_TIMEOUT_MS = 4000;
let envSettled = false;
let envSettleResolve = null;
const envSettledPromise = new Promise(resolve => { envSettleResolve = resolve; });
function settleEnv(reason) {
  if (envSettled) return;
  envSettled = true;
  console.info('[bubble variant] 環境狀態確定：' + reason
    + '（uHasEnv=' + (uniforms ? uniforms.uHasEnv.value : '?') + '）');
  if (envSettleResolve) envSettleResolve();
}
function waitForEnvSettled() {
  if (envSettled) return Promise.resolve();
  // 逾時只是「不再等」，不是錯誤：預覽用的 iframe 或離線情境下 HDRI 可能永遠不來，
  // 那時該做的是照樣把畫面畫出來，而不是黑屏等下去。
  return Promise.race([
    envSettledPromise,
    new Promise(resolve => setTimeout(() => { settleEnv('等待逾時'); resolve(); },
      ENV_SETTLE_TIMEOUT_MS)),
  ]);
}

// 首次算繪前的背景預編譯。只做一次，結果快取成 promise。
let initialCompilePromise = null;
let initialCompileDone = false;
// 首編的起算時刻與實測耗時。耗時是背景預熱要不要做的依據（見 prewarmSkipReason），
// 起算時刻則是「準備中」提示的計秒基準（見 shaderStateNote）。
let initialCompileStartedAt = null;
let initialCompileMs = null;
// 首編進行中被擋下來的變體切換。
//
// 只用一個布林而不是佇列是刻意的：syncShaderVariant() 每次都重新讀當下的
// variantState()，所以「補做一次」自然就等於「用最新狀態補做」。窗口內連切五個模式
// 也只會編最後那一個需要的變體，中間那些過期的根本不會被排進來。
let pendingVariantSync = false;

// 首編完成。旗標與補做綁在一起，避免哪天多一條設定旗標的路徑又忘了補做 ——
// 這個 regression 的成因正是「設了旗標但沒有人補做」。
function markInitialCompileDone() {
  initialCompileDone = true;
  // 首編耗時不屬於持續算繪 FPS；從完成這一刻重新開樣本窗口。
  adaptiveQuality.resetSamples(performance.now(), true);
  lastInteractionAt = performance.now();
  if (pendingVariantSync) {
    pendingVariantSync = false;
    syncShaderVariant();
  }
  updateShaderState();
  // 稍微延後再開始背景預熱，讓首幀先順順地畫出來。預熱本身不阻塞主執行緒
  // （這是它的前提條件之一），但排在首幀之後開始還是比較穩。
  setTimeout(prewarmVariants, 1200);
}
function ensureInitialCompile() {
  if (initialCompilePromise) return initialCompilePromise;
  initialCompilePromise = waitForEnvSettled().then(() => {
    // env 確定之後才決定第一支 variant。initGL 建立 mesh 時那一支是用當時（尚未載入
    // HDRI）的狀態算出來的，如果 key 變了就地換掉 —— 它從未被算繪過，也就從未被
    // 編譯過，丟掉不浪費任何東西。
    const key = variantKey();
    if (key !== activeVariantKey && mesh) {
      const stale = variantCache.get(activeVariantKey);
      variantCache.delete(activeVariantKey);
      if (stale) { try { stale.dispose(); } catch (_) {} }
      const mat = buildVariantMaterial();
      variantCache.set(key, mat);
      mesh.material = mat;
      console.info('[bubble variant] 首支 variant 依 env 狀態改為 ' + key
        + '（未編譯的 ' + activeVariantKey + ' 已丟棄）');
      activeVariantKey = key;
    }
    initialCompileStartedAt = performance.now();
    updateShaderState();
    return (renderer.compileAsync
      ? renderer.compileAsync(scene, camera)
      : Promise.resolve())
      .then(() => {
        // 這個數字是背景預熱的判斷依據：慢才值得預熱（見 prewarmSkipReason）。
        initialCompileMs = performance.now() - initialCompileStartedAt;
        console.info('[bubble variant] 首次 program 背景編譯完成 '
          + Math.round(initialCompileMs) + 'ms（主執行緒未被阻塞）key=' + key);
      });
  }).catch(err => {
    // 失敗也要放行：讓 three.js 走原本的同步路徑，畫面該出來還是要出來。
    console.warn('[bubble variant] 背景預編譯失敗，退回同步路徑：' + err.message);
  }).then(() => {
    // 首編完成的當下才重新看狀態：窗口內被擋下來的切換在這裡一次補做，
    // 而且用的是「現在」的狀態，不是被擋當下的狀態。
    markInitialCompileDone();
  });
  return initialCompilePromise;
}

// V 可以傳入，用來蓋出「別的模式」那一支材質（背景預熱要用；見 prewarmVariants）。
function buildVariantMaterial(V = variantState()) {
  const mat = new THREE.ShaderMaterial({
    uniforms,                       // 所有變體共用同一組 uniform 物件
    vertexShader: VERT,
    fragmentShader: usesBaselineShader() ? FRAG_BASELINE : FRAG,
    defines: shaderFeatures(V),
    depthTest: false, depthWrite: false,
  });
  mat.envMap = pmremTarget.texture;
  return mat;
}

// 依當下狀態切換到對應的變體。
//
// 關鍵在於「不要直接把新 material 掛上 mesh」：three.js 會在下一次 render 時同步把
// program 準備好，而取 uniform location 會強迫等待連結完成 —— 那就等於把我們花了
// 一整輪診斷才避開的主執行緒阻塞又加回來。所以新變體一律先在離屏 scene 上用
// compileAsync 預編譯，resolve 之後才換上去；這段期間畫面繼續用舊變體算繪，
// 不會黑掉也不需要 loading UI。
// 變體切換一律延到這一輪事件處理跑完才決定。
//
// 原因：切一次動態模式會連帶還原一整組「按模式各自記憶」的參數（見 motionMemory），
// 而每一個控制項的處理都會各自呼叫進來一次。同步處理的話，中間那些過渡狀態也會各自
// 發動一次背景編譯 —— 實測切到毛細波時，中途的「毛細波＋光譜焦散開」組合就被真的編了
// 一支，那是三十秒的 fxc 工作，而它從頭到尾沒有任何一幀會用到；而且 WebGL 沒有取消
// 編譯的手段，發出去就只能等它跑完。
//
// 合併之後只看最後那個狀態。這是安全的，因為 syncShaderVariantNow() 每次都重新讀當下
// 的 variantState()，本來就沒有「把每一次都做一遍」的語意 —— 跟 pendingVariantSync
// 用一個布林而不是佇列是同一個道理。
let variantSyncScheduled = false;
function syncShaderVariant() {
  if (variantSyncScheduled) return;
  variantSyncScheduled = true;
  setTimeout(() => {
    variantSyncScheduled = false;
    syncShaderVariantNow();
  }, 0);
}

function syncShaderVariantNow() {
  if (!inited || !mesh) return;
  // 首支 variant 還沒定案前不立刻開新編譯 —— 那會把「冷載入只編一次」又打回原形。
  // 但也不能就這樣丟掉：記下來，等首編 resolve 時由 markInitialCompileDone() 用當下
  // 最新的狀態補做一次。
  //
  // 少了這個 pending，窗口內（env 已就緒、首編仍在跑，正式頁約 8 秒）的任何變體變更
  // 都會被永久吞掉 —— 例如切到需要造型場的模式時，造型資料照常載入，但編出來的
  // shader 沒有 FEATURE_SHAPE_FIELD，於是預設造型永遠不顯示，而且不會自行恢復。
  if (!initialCompileDone) { pendingVariantSync = true; return; }
  const key = variantKey();
  if (key === activeVariantKey) return;

  const cached = touchVariant(key);
  if (cached) {
    const t0 = performance.now();
    mesh.material = cached;
    activeVariantKey = key;
    updateShaderState();
    variantStats.命中++;
    variantStats.最後一次切換ms = Math.round((performance.now() - t0) * 10) / 10;
    variantStats.最後一次是命中 = true;
    console.info('[bubble variant] 命中 ' + key
      + '（' + variantStats.最後一次切換ms + 'ms，未編譯）');
    return;
  }

  if (variantSwapInFlight === key) return;   // 已經在背景編這一支了
  variantSwapInFlight = key;
  const t0 = performance.now();
  // 背景編譯的計時。變體切換用的是 compileAsync，不會經過 startDiagTiming 那條
  // 量測路徑，所以「這一支編了多久／有沒有編完」在報告裡本來是看不到的 ——
  // 而 shape 類 variant 正好卡在這裡。一併記下開始當下的 context 遺失次數，
  // 才分得出「編很久」與「編到 GPU driver 逾時重置」。
  variantStats.進行中 = {
    key,
    開始於ms: Math.round(t0),
    已經過ms: 0,
    開始時contextLost: glTimeline.contextLost次數,
    狀態: '編譯中',
  };
  updateShaderState();
  const next = buildVariantMaterial();
  const stage = new THREE.Scene();
  const stageMesh = new THREE.Mesh(mesh.geometry, next);
  stageMesh.frustumCulled = false;
  stage.add(stageMesh);

  // 這一支的「進行中」紀錄該收掉了。
  //
  // 一定要走這條路而不是直接在成功那一段清掉：finish() 有兩條提早 return（目標已經換
  // 人、鍵已經變了），舊版在那兩條路上把 variantStats.進行中 留著不清。那時它只是診斷
  // 欄位所以看不出來，但現在「準備中」提示與外部的就緒判斷都讀它 —— 留著就會永遠顯示
  // 「編譯中」。實測踩過：切到毛細波時 motionMemory 的還原會連帶觸發好幾次
  // syncShaderVariant，中間那幾支正好走的就是這兩條提早 return。
  const clearInFlight = () => {
    if (variantStats.進行中 && variantStats.進行中.key === key) variantStats.進行中 = null;
    updateShaderState();
  };
  const finish = () => {
    // 期間使用者可能又切到別的組合；只有還是同一個目標才換上去。
    if (variantSwapInFlight !== key) { try { next.dispose(); } catch (_) {} clearInFlight(); return; }
    variantSwapInFlight = null;
    if (variantKey() !== key) {
      try { next.dispose(); } catch (_) {}
      clearInFlight();
      // 這裡是「編好的那一支已經過期」的補做，直接走立即版：狀態已經定案了，
      // 再延一輪只是讓正確的那一支更晚開始編。
      syncShaderVariantNow();
      return;
    }
    variantCache.set(key, next);
    mesh.material = next;
    activeVariantKey = key;
    evictVariantsIfNeeded();
    variantStats.未命中++;
    variantStats.最後一次切換ms = Math.round((performance.now() - t0) * 10) / 10;
    variantStats.最後一次是命中 = false;
    const lostDuring = glTimeline.contextLost次數
      - (variantStats.進行中 ? variantStats.進行中.開始時contextLost : 0);
    variantStats.進行中 = null;
    variantStats.最後一次編譯 = {
      key,
      耗時ms: variantStats.最後一次切換ms,
      期間contextLost: lostDuring,
    };
    updateShaderState();
    console.info('[bubble variant] 新編 ' + key
      + '（' + variantStats.最後一次切換ms + 'ms，背景編譯'
      + (lostDuring ? '，期間 context 遺失 ' + lostDuring + ' 次' : '') + '）');
  };

  const compiled = renderer.compileAsync
    ? renderer.compileAsync(stage, camera)
    : Promise.resolve(renderer.compile(stage, camera));
  compiled.then(finish).catch(err => {
    variantSwapInFlight = null;
    // 一樣要認鍵：這個 catch 可能是一支早就過期的編譯回來的，不能把後面那支
    // 正在進行的紀錄清掉（見 clearInFlight 的說明）。
    if (variantStats.進行中 && variantStats.進行中.key === key) {
      variantStats.進行中.狀態 = '失敗：' + err.message;
      variantStats.最後一次編譯 = {
        key,
        耗時ms: Math.round(performance.now() - t0),
        期間contextLost: glTimeline.contextLost次數 - variantStats.進行中.開始時contextLost,
        結果: '失敗：' + err.message,
      };
      variantStats.進行中 = null;
    }
    updateShaderState();
    console.error('[bubble variant] 預編譯失敗 ' + key + '：' + err.message);
    try { next.dispose(); } catch (_) {}
  });
}

// ===== 背景預熱 =====
//
// 為什麼要有這個：Windows 預設的 ANGLE D3D11 後端用 fxc 編一支造型變體要數十秒
// （本機實測 formation 34s、morph 55s，七個造型模式合計 154s），而 Chrome 的 D3D
// bytecode 快取是跟著 profile 持久的 —— 同一支第二次只要 2 秒。也就是說這個成本
// 本質上是「每個組合一次」，不是「每次切換一次」。既然如此，就不該讓使用者在切模式
// 的當下才付：首編落地之後在背景把各模式會用到的那幾支依序編掉，等使用者真的切過去
// 就是快取命中。
//
// 為什麼是「有條件」而不是一律預熱 —— 這件事只在「編譯慢，而且慢在背景」才划算：
//   * macOS 的 ANGLE Metal 與 Windows 的 ANGLE Vulkan 後端本來就是個位數秒
//     （實測 Vulkan 七個模式合計 20s），預熱等於白燒 GPU。
//   * 更關鍵的是 Vulkan 後端沒有 KHR_parallel_shader_compile，three.js 的 compileAsync
//     在那裡會退回同步路徑 —— 預熱會把主執行緒一支一支地扣住，那比不預熱糟得多。
// 所以兩個條件都要成立才做：擴充在（＝真的非阻塞），而且首編實測真的慢。這樣同一份
// 程式碼在三種環境下都會做對的事，不必判斷平台，也不會在未來的新後端上猜錯。
// research 與 typewriter 是各自獨立的 FEATURE_* 旗標，不像 formation／melt
// 等造型模式那樣共用同一組 shapeField 組合鍵 —— 沒有任何一支既有目標會「順便」
// 編到它們，所以要自己各佔一個名額，否則使用者切過去時永遠是冷編。
const PREWARM_MOTIONS = [
  'formation', 'melt', 'morph', 'weave', 'shatter', 'jelly', 'capillary',
  'research', 'typewriter',
];
// 首編超過這個時間才值得預熱。個位數秒的環境多編幾支只是浪費。
const PREWARM_MIN_COMPILE_MS = 4000;
const prewarmStats = {
  狀態: '未啟動', 已備妥: 0, 本來就有: 0, 失敗: 0,
  進行中: null, 待編清單: [], 總耗時ms: 0,
};

// 回傳「不做的理由」，null 表示該做。
function prewarmSkipReason() {
  if (PREVIEW) return '預覽模式不預熱';
  if (DIAG.any || FORCE_FEATURES.length || SHADER_RUN !== null) {
    return '診斷模式不預熱（會污染 cold compile 量測與 GPU 的 shader 快取）';
  }
  if (mobileRenderQuery.matches) return '行動裝置不預熱（耗電，而且那邊的編譯器本來就快）';
  if (!renderer || !renderer.compileAsync || !mesh) return 'renderer 尚未就緒';
  let parallel = false;
  try { parallel = !!renderer.getContext().getExtension('KHR_parallel_shader_compile'); } catch (_) {}
  if (!parallel) return '沒有 KHR_parallel_shader_compile，預熱會阻塞主執行緒';
  if (initialCompileMs === null) return '首編耗時未知';
  if (initialCompileMs < PREWARM_MIN_COMPILE_MS) {
    return '首編只花 ' + Math.round(initialCompileMs) + 'ms，這個環境不需要預熱';
  }
  return null;
}

function prewarmVariants() {
  if (prewarmStats.狀態 !== '未啟動') return;
  const skip = prewarmSkipReason();
  if (skip) {
    prewarmStats.狀態 = '略過：' + skip;
    console.info('[bubble prewarm] ' + skip);
    return;
  }
  prewarmStats.狀態 = '進行中';
  const targets = [];
  const seen = new Set([activeVariantKey]);
  for (const motion of PREWARM_MOTIONS) {
    const V = variantState(motion);
    const key = variantKey(V);
    // 一支會被多個模式共用（例如融化與崩解噴濺的旗標組合完全相同），只編一次。
    if (seen.has(key) || variantCache.has(key)) continue;
    seen.add(key);
    targets.push({ motion, key, V });
  }
  prewarmStats.待編清單 = targets.map(t => t.motion + ' → ' + t.key);
  console.info('[bubble prewarm] 開始背景預熱 ' + targets.length + ' 支：'
    + prewarmStats.待編清單.join('、'));
  const t0All = performance.now();
  (async () => {
    for (const t of targets) {
      // 使用者的操作永遠優先。同時丟兩支給驅動只會讓使用者正在等的那一支更慢，
      // 所以正在為使用者編的時候就讓路。
      while (variantSwapInFlight) await new Promise(r => setTimeout(r, 400));
      if (variantCache.has(t.key)) { prewarmStats.本來就有++; continue; }
      const t0 = performance.now();
      prewarmStats.進行中 = { motion: t.motion, key: t.key, 開始於ms: Math.round(t0) };
      updateShaderState();
      const mat = buildVariantMaterial(t.V);
      const stage = new THREE.Scene();
      const stageMesh = new THREE.Mesh(mesh.geometry, mat);
      stageMesh.frustumCulled = false;
      stage.add(stageMesh);
      try {
        await renderer.compileAsync(stage, camera);
      } catch (err) {
        prewarmStats.失敗++;
        prewarmStats.進行中 = null;
        try { mat.dispose(); } catch (_) {}
        console.warn('[bubble prewarm] ' + t.key + ' 預熱失敗：' + err.message);
        continue;
      }
      prewarmStats.進行中 = null;
      // 這段時間使用者可能已經自己切過去、把同一支編好了。
      if (variantCache.has(t.key)) {
        try { mat.dispose(); } catch (_) {}
        prewarmStats.本來就有++;
        continue;
      }
      variantCache.set(t.key, mat);
      evictVariantsIfNeeded();
      prewarmStats.已備妥++;
      console.info('[bubble prewarm] ' + t.motion + ' ' + t.key + ' 已備妥（'
        + Math.round(performance.now() - t0) + 'ms，背景編譯）');
    }
    prewarmStats.總耗時ms = Math.round(performance.now() - t0All);
    prewarmStats.狀態 = '完成';
    prewarmStats.進行中 = null;
    updateShaderState();
    console.info('[bubble prewarm] 完成：新編 ' + prewarmStats.已備妥 + ' 支，共 '
      + prewarmStats.總耗時ms + 'ms');
  })();
}

// ===== 「正在準備 shader」的提示 =====
//
// 存在的理由：在慢的後端上切到造型模式之後，數十秒內畫面完全不會變，而在這之前
// 頁面上沒有任何訊號 —— 使用者只會覺得壞了。這一段不改變任何算繪行為，只是把已經
// 在 variantStats / prewarmStats 裡的狀態顯示出來。
//
// 只有等超過 SHADER_STATE_DELAY_MS 才顯示。快的後端（macOS Metal、Windows Vulkan）
// 這個等待只有一兩秒，閃一下反而吵。
const SHADER_STATE_DELAY_MS = 1500;
let shaderStateTicker = 0;

// 回傳 { 級別, 文字 }，沒有要顯示的東西就回 null。
function shaderStateNote() {
  // 使用者此刻正在等的那一支。兩種情況：切模式切在首編窗口內（等首編），或是
  // 一般的變體切換（等 syncShaderVariant 那一支）。
  const 等變體 = !!variantSwapInFlight && variantSwapInFlight === variantKey();
  const 等首編 = !initialCompileDone && !!initialCompilePromise;
  const 開始於 = 等變體 && variantStats.進行中 ? variantStats.進行中.開始於ms
    : 等首編 ? initialCompileStartedAt : null;
  if ((等變體 || 等首編) && 開始於 !== null) {
    const 已等ms = performance.now() - 開始於;
    if (已等ms < SHADER_STATE_DELAY_MS) return null;
    // 使用者正在等 → 亮一點。這是「你現在看不到造型是因為這個」的訊息。
    return { 級別: 'waiting', 文字: 'shader 首次編譯中 ' + Math.round(已等ms / 1000) + 's'
      + ' —— 頁面可正常操作，編好會自動顯示。同一個組合只需要編這一次。' };
  }
  if (prewarmStats.進行中) {
    const 全部 = prewarmStats.待編清單.length;
    const 第幾 = prewarmStats.已備妥 + prewarmStats.本來就有 + prewarmStats.失敗 + 1;
    // 使用者沒有在等 → 維持一般說明字的亮度，只是交代背景在忙什麼。
    return { 級別: 'busy',
      文字: '背景預先編譯其他動態模式的 shader（' + 第幾 + '/' + 全部 + '）—— 可正常使用' };
  }
  return null;
}

function updateShaderState() {
  const el = document.getElementById('shaderState');
  if (!el) return;
  const state = shaderStateNote();
  el.textContent = state ? state.文字 : '';
  el.hidden = !state;
  el.classList.toggle('busy', state ? state.級別 === 'busy' : false);
  el.classList.toggle('waiting', state ? state.級別 === 'waiting' : false);
  // 有事情在跑就每半秒刷一次秒數；跑完把 timer 收掉，不留背景輪詢。
  const 忙 = !!variantSwapInFlight || !!prewarmStats.進行中
    || (!initialCompileDone && !!initialCompilePromise);
  if (忙 && !shaderStateTicker) shaderStateTicker = setInterval(updateShaderState, 500);
  if (!忙 && shaderStateTicker) { clearInterval(shaderStateTicker); shaderStateTicker = 0; }
}

// ===== 變體狀態 =====
//
// 這個函式是「這一刻真正需要哪些 shader 功能」的唯一來源。shaderFeatures() 把它翻成
// defines，variantKey() 把它翻成快取鍵，兩者必須看同一份資料，否則會出現「鍵相同但
// 編出來的 shader 不同」這種很難查的錯。
//
// 收進來的都是會大幅改變 control flow / call graph 的東西。數值滑桿（厚度、IOR、
// 粗糙度、各種強度）一律不收 —— 它們只改變數字，不改變要編譯什麼，收進來只會造成
// 變體爆炸。
// 靜態模式的「匯入 SVG／GLB」是 staticShape 的第 8 個選項（值 7）。選內建幾何
// （0–6）時整條形狀場都不該存在：不只是不畫出來，連負形空腔、微滴、匯入 UI
// 都要一起關掉，否則內建展示造型的空腔會被挖進程序化幾何裡，變成畫面上莫名
// 其妙多出來的孔洞。
const {
  usesBaselineShader,
  staticUsesImportedShape,
  variantState,
  variantKey,
  shaderFeatures,
} = createShaderVariantPlanner({
  getParams: () => P,
  getMotionMemory: () => motionMemory,
  usesShapeField,
  isFormationMotion,
  getHasEnvironment: () => !!(uniforms && uniforms.uHasEnv.value === 1),
  diagnostics: DIAG,
  forceFeatures: FORCE_FEATURES,
  shaderRun: SHADER_RUN,
  isMobile: () => mobileRenderQuery.matches,
});

/* ===== WebGL 場景（延遲初始化，規避預覽時的 context 上限）===== */
let renderer = null, scene = null, camera = null, mesh = null, uniforms = null;
let pmremGenerator = null, pmremTarget = null;
let gpuProfiler = null;
let inited = false;
// 裝置本身撐得住的解析度上限，不受使用者「抗鋸齒」偏好影響——DIAG.lowres／
// PREVIEW 場景本來就該固定走最省資源那一路，不該被手動調高的超取樣蓋過去。
const deviceMaxDpr = DIAG.lowres ? 1 : PREVIEW ? 1 : mobileRenderQuery.matches
  ? Math.min(window.devicePixelRatio || 1, 1.5)
  : Math.min(window.devicePixelRatio || 1, 2);
// 這兩個原本是 const，現在會被 applyAntialiasLevel() 依使用者選的超取樣倍率
// 重算，所以改 let。倍率 ×1（預設）時算出來的值跟原本寫死的一模一樣。
const initialMaxRenderDpr = deviceMaxDpr;
// 拖曳時的解析度。fragment 成本與像素面積成線性（實測 1/12 像素 → 1/8.5 幀時），
// 所以這個下限是互動流暢度最大的單一槓桿：舊版桌面只從 2.0 降到 1.75，像素僅少
// 23%；降到 1.25 後只剩 39%。放手後會立刻回到 maxRenderDpr。
const initialMinRenderDpr = DIAG.lowres ? 1 : PREVIEW ? 1 : Math.min(initialMaxRenderDpr, 1.25);
const adaptiveQuality = createAdaptiveQuality({
  mobile: mobileRenderQuery.matches,
  preview: PREVIEW,
  maxDpr: initialMaxRenderDpr,
  minDpr: initialMinRenderDpr,
  onChange: state => {
    if (document.body) document.body.dataset.renderQuality = state.tier;
    inspector?.setQualityStatus(state);
    refreshRenderQuality();
  },
});

const rot = { x: P.cameraRotationX * Math.PI / 180, y: P.cameraRotationY * Math.PI / 180 };
const vel = { x: 0, y: 0 };
let compositionOffsetX = 0;
let dragging = false, activeCanvasPointerId = null, lastX = 0, lastY = 0;
const rotM4 = new THREE.Matrix4();
const tmpX = new THREE.Matrix4();
const tmpZ = new THREE.Matrix4();
const dropData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
const dropShapeData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(1, 0, 0, 1));
const dropPhysicsData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
// 新增模式共用的暫存輸出。各模式模組只寫純數值，不依賴 THREE 或場景狀態；
// 主迴圈在單一分支讀取，移除某模式時不必再修改這段。
const extendedMotionState = Array.from({ length: MAX_DROPS }, () => ({
  x: 0, y: 0, z: 0, radiusFactor: 1, shape: null,
}));
const extendedShapeContext = {
  anchors: [], surfaceAnchors: [], center: { x: 0, y: 0, z: 0 }, radius: 1,
};

function syncExtendedShapeContext() {
  extendedShapeContext.anchors = formationAnchors;
  extendedShapeContext.surfaceAnchors = weaveSurfaceAnchors;
  const pool = formationAnchors.length ? formationAnchors : weaveSurfaceAnchors;
  if (!pool.length) {
    extendedShapeContext.center.x = 0;
    extendedShapeContext.center.y = 0;
    extendedShapeContext.center.z = 0;
    extendedShapeContext.radius = 1;
    return;
  }
  let x = 0, y = 0, z = 0;
  for (const point of pool) { x += point.x; y += point.y; z += point.z; }
  x /= pool.length; y /= pool.length; z /= pool.length;
  extendedShapeContext.center.x = x;
  extendedShapeContext.center.y = y;
  extendedShapeContext.center.z = z;
  let radius = 0.1;
  for (const point of pool) radius = Math.max(radius,
    Math.hypot(point.x - x, point.y - y, point.z - z));
  extendedShapeContext.radius = radius;
}
const previousDropPositions = Array.from({ length: MAX_DROPS }, () => new THREE.Vector3());
const dropBounds = new THREE.Vector4(0, 0, 0, 1);
let previousDropT = null;
let shapeField = null;
// 每匯入一次形狀就 +1。崩解切法的錨點快取用它當 key 的一部分，換了形狀
// 才不會拿上一顆造型算出來的碎片繼續用。
let shapeFieldSerial = 0;
let shapeTargets = [];
let formationAnchors = [];
let microFormationAnchors = [];
let negativeFormationAnchors = [];
// 形狀 A 未套用「形狀 A 大小」倍率前的原始烘焙結果。滑桿拖動時只需要從這裡
// 重新縮放＋重挑錨點，不必整顆重新烘焙距離場（那是幾百毫秒到幾秒的 CPU 工作）。
let shapeTargetsBase = [];
let shapeCavityBase = [];

// 把候選點集合（THREE.Vector3，帶 radiusHint/thickness/surface 附加屬性）整體
// 縮放 scale 倍。scale === 1 時直接回傳原陣列，拖桿停在預設值時不用多做一次
// clone。
// 依目前的 P.shapeAScale 從 shapeTargetsBase 重新縮放並重挑錨點。呼叫端負責
// 視情況遞增 shapeFieldSerial（崩解切法／融化滴落點／變形配對都拿它當快取
// key 的一部分，serial 一變就會自動重算，不必逐一手動清快取）。
// 重挑錨點是 O(候選點 × 錨點數) 的貪婪取樣，跟崩解切法一樣不便宜，所以等
// 滑桿停下來才做——拖動期間先讓水滴留在舊尺寸，停手 120ms 後才重新分佈。
let shapeAScaleTimer = 0;
function scheduleShapeAScaleRebuild() {
  clearTimeout(shapeAScaleTimer);
  shapeAScaleTimer = setTimeout(() => {
    rebuildShapeAAnchors();
    shapeFieldSerial++;
  }, 120);
}
let shapeBScaleTimer = 0;
function scheduleShapeBScaleRebuild() {
  clearTimeout(shapeBScaleTimer);
  shapeBScaleTimer = setTimeout(() => {
    rebuildShapeBAnchors();
    shapeFieldSerial++;
  }, 120);
}

function rebuildShapeAAnchors() {
  if (!shapeTargetsBase.length) return;
  shapeTargets = scalePoints(shapeTargetsBase, P.shapeAScale);
  formationAnchors = distributePrimaryAnchors(shapeTargets, MAX_DROPS);
  microFormationAnchors = distributeDetailedAnchors(shapeTargets, MAX_MICRO_DROPS);
  negativeFormationAnchors = distributeFormationAnchors(
    scalePoints(shapeCavityBase, P.shapeAScale), MAX_NEGATIVE_DROPS,
  );
  rebuildWeaveAnchorSets();
  rebuildFormationEdgeScale();
}

// 成型波前的「邊緣擾動」尺度。
//
// 亂流參差、晶格碎法、前緣收頸這三項都是世界單位的絕對量，而它們全都是拿來
// 擾動／侵蝕形狀邊緣的——一旦幅度超過形狀本身的粗細，就不再是「邊緣參差」而是
// 整段筆畫憑空消失或亂閃。內建問號那類造型有 65% 的取樣點在內部（離邊界超過
// 0.056），撐得住 0.45 的亂流；但細筆畫的文字外框有 98% 的點都貼在邊界上，
// 同一組數值等於把材料整個吃掉。
//
// 所以用「有多少比例的取樣點不是表面點」當這顆造型的厚實度，把三項一起等比
// 縮下來。三項必須共用同一個係數：CPU 這邊的波前餘裕與水滴出發參差也讀同一個
// 幅度，各縮各的會讓實體與水滴脫鉤。
//
// 0.58 這個除數是量出來的：內建問號的內部點比例是 0.582，星形 0.600、冰塊更高，
// 三顆都因此落在 1.0（維持既有外觀，不動已經調好的手感）；只有比它們更薄的造型
// 才會被縮下來——實測細筆畫文字外框只有 0.016，係數約 0.03。
let formationEdgeScale = 1;
function rebuildFormationEdgeScale() {
  // 用完整的候選點集合，不是挑過的錨點：厚實度是這顆造型本身的性質，而挑錨點的
  // 最遠點取樣偏好邊界與極端位置，用它量會系統性地偏薄。
  formationEdgeScale = formationEdgeScaleFor(shapeTargets);
}
// 穿梭環繞的路徑點：只取 formationAnchors 裡標記為表面的錨點。每顆水滴分到
// 一個表面點當「家」，在旁邊小幅度飄浮晃動，而不是精確衝向某個目標點——
// 參考的泡泡影片裡，泡泡是懸浮在原地輕輕晃動，不是有明確路徑地移動。
let weaveSurfaceAnchors = [];
function rebuildWeaveAnchorSets() {
  weaveSurfaceAnchors = formationAnchors.filter(a => a.surface);
  if (!weaveSurfaceAnchors.length) weaveSurfaceAnchors = formationAnchors;
}

// 造型底部的 Y（本地座標）。起跳彈跳的擠壓拉伸要以「腳踩的那條地面」為支點，
// 不是以造型中心——中心支點會讓壓扁時整顆往上縮、底部離地，看起來是懸空的球
// 在自己變形，而不是撞在地上被壓扁。取樣點是烘焙好的，換形狀才需要重算，所以
// 跟滴落點一樣用 shapeFieldSerial 當快取 key。
let shapeBottomY = 0;
let shapeBottomKey = null;
function shapeBottom() {
  const key = `${shapeFieldSerial}`;
  if (key !== shapeBottomKey) {
    shapeBottomKey = key;
    let minY = 0;
    for (const p of shapeTargets) if (p.y < minY) minY = p.y;
    shapeBottomY = minY;
  }
  return shapeBottomY;
}

// 形狀變形的配對表：每顆水滴在形狀 A 的位置 → 在形狀 B 的位置（見 morph.js 的
// buildMorphPairs）。主滴與微滴各一份，兩者的錨點密度差很多，共用一份會讓微滴
// 全部擠在主滴那幾個位置上。
let morphPairs = [];
let morphMicroPairs = [];
let morphPairKey = null;

// 形狀 B（變形目標）自己的一份烘焙結果。它跟形狀 A 走完全獨立的匯入流程，但
// 來源種類跟著面板的「形狀來源」——兩個槽不允許一個 SVG 一個 GLB，因為兩種
// 距離場的編碼與查表方式完全不同，疊不進同一張貼圖（見 packShapePairTexture）。
//
// 貼圖要留著（不像早期只有水滴的版本烘完就 dispose）：實體變形要拿它的 g 通道。
let morphTargetPoints = null;
let morphTargetPending = null;
// 形狀 B 未套用「形狀 B 大小」倍率前的原始烘焙結果，用途同 shapeTargetsBase。
let morphTargetBaseField = null;

// 依目前的 P.shapeBScale 從 morphTargetBaseField 重新縮放並重挑錨點。
function rebuildShapeBAnchors() {
  if (!morphTargetBaseField || !morphTargetPoints) return;
  const scaled = scalePoints(morphTargetBaseField.targets, P.shapeBScale);
  morphTargetPoints.primary = distributePrimaryAnchors(scaled, MAX_DROPS);
  morphTargetPoints.micro = distributeDetailedAnchors(scaled, MAX_MICRO_DROPS);
  morphPairKey = null;
}
// 使用者自己匯入的形狀 B，跟形狀 A 一樣依來源分開記住；沒有就用內建預設
// （SVG 用星形、GLB 用多面體）。
const morphTargetFiles = { svg: null, gltf: null };

// 兩顆形狀疊進同一張貼圖（r = 形狀 A、g = 形狀 B）。有這張圖才顯示得出實體
// 變形，沒有就退回只有水滴的畫面。
let morphPackedTexture = null;
let morphPackedKey = null;

// 形狀 B 該是什麼，用一個字串描述完：來源種類、GLB 的體素解析度、使用者檔案。
// 其中任何一項變了就要重烘——特別是解析度，兩顆形狀的圖集尺寸必須一致才疊得
// 起來，所以 B 一定要跟著 A 用同一個 grid 烘。
function morphTargetKey() {
  const kind = P.shapeSource;
  const file = morphTargetFiles[kind];
  const grid = kind === 'gltf' ? (SELECTS.shapeQuality.map[P.shapeQuality] || 80) : 0;
  return `${kind}:${grid}:${file ? `${file.name}:${file.size}` : 'builtin'}`;
}

function rebuildMorphPairs() {
  if (P.motion !== 'morph' || !morphTargetPoints) return;
  // 兩顆形狀任一邊換了才要重配。配對是 O(A × B) 的最近點搜尋，不能每幀跑。
  const key = `${shapeFieldSerial}:${morphTargetPoints.key}`;
  if (key === morphPairKey) return;
  morphPairKey = key;
  morphPairs = buildMorphPairs(formationAnchors, morphTargetPoints.primary);
  morphMicroPairs = buildMorphPairs(microFormationAnchors, morphTargetPoints.micro);
  rebuildMorphPackedTexture(key);
}

// 打包只在兩顆形狀「疊得起來」時才成立：同一種來源、同樣的貼圖尺寸，GLB 還要
// 同樣的 grid 與圖集排列。任一項不符就回傳 null，畫面退回只有水滴——這比畫出
// 一顆錯位或錯解析度的形狀好。
function rebuildMorphPackedTexture(key) {
  if (key === morphPackedKey) return;
  const b = morphTargetPoints;
  const sameKind = shapeFieldSource === P.shapeSource && b?.kind === P.shapeSource;
  const sameGrid = shapeField?.grid === b?.grid
    && shapeField?.atlas?.x === b?.atlas?.x && shapeField?.atlas?.y === b?.atlas?.y;
  const next = sameKind && sameGrid && shapeField?.texture && b?.texture
    ? packShapePairTexture(shapeField.texture, b.texture)
    : null;
  morphPackedKey = key;
  morphPackedTexture?.dispose();
  morphPackedTexture = next;
}

// 形狀 B 的烘焙。烘焙是幾百毫秒到幾秒的 CPU 工作，放在幀迴圈裡會頓住，所以走
// 「發現不對就非同步補上，補完再重配」——這一幀先沿用舊的（或什麼都不畫），
// 下一幀就換好了。
//
// 形狀 A 正在烘的時候不併行開第二份：兩者都是純 CPU 的重活，同時跑只會互相
// 拖慢，而且 B 要用 A 的 grid 去對齊，A 還沒定案就烘等於白烘。
function ensureMorphTarget() {
  if (P.motion !== 'morph' || shapeConverting) return;
  const key = morphTargetKey();
  if (morphTargetPoints?.key === key || morphTargetPending === key) return;
  morphTargetPending = key;
  const kind = P.shapeSource;
  const file = morphTargetFiles[kind];
  const grid = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  const label = file
    ? file.name
    : (kind === 'svg' ? MORPH_TARGET_SVG_NAME : MORPH_TARGET_SOLID_NAME);
  setMorphTargetState(kind === 'svg'
    ? `正在分析變形目標：${label}`
    : `正在體素化變形目標：${label} → ${grid}³（可能需要幾秒）`);
  (async () => {
    try {
      const field = kind === 'svg'
        ? await svgToField(file || makeMorphTargetSvgFile(), {
          supersample: mobileRenderQuery.matches ? 2 : 3,
        })
        : file
          ? await gltfToField(file, grid)
          : await objectToField(buildMorphTargetSolid(), grid);
      // 烘的途中使用者又換了設定：這份已經過期，丟掉貼圖直接走，讓下一輪重烘。
      if (morphTargetPending !== key) { field.texture?.dispose(); return; }
      morphTargetPoints?.texture?.dispose();
      morphTargetBaseField = field;
      morphTargetPoints = {
        key,
        kind,
        texture: field.texture,
        grid: field.grid,
        atlas: field.atlas,
        primary: [],
        micro: [],
      };
      rebuildShapeBAnchors();
      morphPackedKey = null;
      setMorphTargetState(`變形目標已就緒：${label}${file ? '' : '（內建預設，可自行匯入取代）'}`);
    } catch (error) {
      console.error(error);
      setMorphTargetState(`變形目標轉換失敗：${error.message || '檔案格式不支援'}`);
    } finally {
      if (morphTargetPending === key) morphTargetPending = null;
    }
  })();
}

function setMorphTargetState(text) {
  const el = document.getElementById('morphTargetState');
  if (el) el.textContent = text;
}

// 崩解切法專用的錨點組。不能直接把種子套進 formationAnchors／microFormationAnchors，
// 那兩組是形狀匯聚／穿梭環繞／崩解噴濺共用的，動了會連帶改掉那三個模式的外觀。
// 這裡另外算一份，只有崩解噴濺會讀。
//
// 重算是 O(候選點 × 錨點數) 的貪婪取樣，不便宜，所以用 key 快取：切法種子沒變
// 就直接沿用上一份。種子 0 連算都不算，直接指回共用的那兩組（也就保證切法 0
// 與加這個參數之前完全相同）。
let shatterCutAnchors = null;
let shatterCutMicroAnchors = null;
let shatterCutKey = null;
let shatterCutPending = null;
let shatterCutTimer = 0;

function buildShatterCutAnchors(seed, key) {
  shatterCutKey = key;
  shatterCutPending = null;
  shatterCutAnchors = distributePrimaryAnchors(shapeTargets, MAX_DROPS, seed);
  shatterCutMicroAnchors = distributeDetailedAnchors(shapeTargets, MAX_MICRO_DROPS, seed);
}

function shatterAnchorSets() {
  const seed = Math.round(P.shatterCut);
  if (!seed) return { primary: formationAnchors, micro: microFormationAnchors };
  const key = `${seed}:${shapeFieldSerial}`;
  if (key !== shatterCutKey && shatterCutPending !== key) {
    // 重算的量級跟候選點數成正比：SVG 只有上百個點（實測 3.8ms），但 GLB 在
    // 128³ 下可以到近萬個，直接在幀迴圈裡算會讓拖動滑桿變成一格一頓。改成等
    // 滑桿停下來才算，拖動期間先沿用上一組錨點。
    shatterCutPending = key;
    clearTimeout(shatterCutTimer);
    shatterCutTimer = setTimeout(() => buildShatterCutAnchors(seed, key), 140);
  }
  // 還沒算出第一組之前先用共用錨點頂著，不要回傳 null 讓呼叫端炸掉。
  return shatterCutAnchors && shatterCutMicroAnchors
    ? { primary: shatterCutAnchors, micro: shatterCutMicroAnchors }
    : { primary: formationAnchors, micro: microFormationAnchors };
}

// 輸出時不能等 debounce：整段序列必須用同一組錨點，否則前幾幀會是舊切法。
function flushShatterCutAnchors() {
  if (!shatterCutPending) return;
  clearTimeout(shatterCutTimer);
  buildShatterCutAnchors(Math.round(P.shatterCut), shatterCutPending);
}
const TAU = Math.PI * 2;
// shader 用的兩組 uniform 每幀重算（syncEdgeDropMotion）；activeEdgeDrops 保存
// 它們的靜態來源資料（輪廓位置、切線、相位），切換分佈時才更新。
const edgeDropData = Array.from({ length: MAX_EDGE_DROPS }, () => new THREE.Vector4());
const edgeMotionData = Array.from({ length: MAX_EDGE_DROPS }, () => new THREE.Vector4());
const activeEdgeDrops = [];
const microDropData = new Float32Array(MAX_MICRO_DROPS * 4);
const microShapeData = new Float32Array(MAX_MICRO_DROPS * 4);
const negativeDropData = new Float32Array(MAX_NEGATIVE_DROPS * 4);
let microDropTexture = null;
let microShapeTexture = null;
let negativeDropTexture = null;

function applyEdgeDropDistribution(index = P.shapeLiquidPosition) {
  const sets = shapeField?.edgeDropSets || [];
  const selected = sets.length
    ? sets[Math.max(0, Math.min(sets.length - 1, Math.round(index)))]
    : (shapeField?.edgeDrops || []);
  activeEdgeDrops.length = 0;
  for (let i = 0; i < MAX_EDGE_DROPS; i++) {
    const drop = selected[i];
    if (!drop) break;
    // 切線在這裡就正規化一次，shader 端不必每步再做一次 normalize。
    // 沿用 shader 原本的 1e-5 偏置，讓兩者在退化（零長度）切線上也完全一致。
    const tx = (drop.tangentX || 1) + 0.00001;
    const ty = (drop.tangentY || 0) + 0.00001;
    const len = Math.hypot(tx, ty) || 1;
    activeEdgeDrops.push({
      x: drop.x || 0,
      y: drop.y || 0,
      radius: drop.radius || 0,
      phase: drop.phase || 0,
      tangentX: tx / len,
      tangentY: ty / len,
      speed: drop.speed || 1,
      travel: drop.travel || 0,
    });
  }
  if (uniforms) {
    uniforms.uEdgeDropCount.value = P.edgeDropsEnabled ? activeEdgeDrops.length : 0;
  }
  syncEdgeDropMotion(uniforms ? uniforms.uTime.value : 0);
}

/*
 * 邊緣水滴的本幀位置、脈動半徑與融合半徑全部與著色點無關，卻曾經在 shader 裡
 * 每一次 mapScene、每一顆水滴重算一次（每像素最多 124 次 mapScene × 8 顆
 * × 3 個 sin）。這裡每幀算一次，打包成 shader 直接可用的形式。
 */
function syncEdgeDropMotion(time) {
  if (!uniforms) return;
  // 讀 uniform 而非 P：輸出時的 LOD 覆寫也才會被一併尊重。
  const liquid = uniforms.uShapeLiquid.value;
  const size = uniforms.uShapeLiquidSize.value;
  const speed = uniforms.uShapeLiquidSpeed.value;
  const loopPhase = TAU * time / Math.max(uniforms.uLoopDuration.value, 0.001);
  for (let i = 0; i < activeEdgeDrops.length; i++) {
    const drop = activeEdgeDrops[i];
    const phase = loopPhase * drop.speed * speed + drop.phase * TAU;
    // 主位移沿輪廓切線；微小二次諧波讓速度不會像機械式往返。
    const travel = (Math.sin(phase) + Math.sin(phase * 2 + 1.7) * 0.16) * drop.travel;
    const radius = drop.radius * size;
    const pulse = 1 + Math.sin(phase - 0.9) * 0.08;
    edgeDropData[i].set(
      drop.x + drop.tangentX * travel * size,
      drop.y + drop.tangentY * travel * size,
      radius * pulse,
      radius * (0.48 + liquid * 0.16),
    );
    edgeMotionData[i].set(drop.tangentX, drop.tangentY, (1 - liquid) * radius * 1.35, 0);
  }
}

const dropSeeds = Array.from({ length: MAX_DROPS }, (_, i) => ({
  h1: hash11CPU(i + 1),
  h2: hash11CPU(i + 7),
  h3: hash11CPU(i + 13),
  radius: 0.72 + 0.55 * hash11CPU(i * 3.17 + 5),
}));

// 崩解噴濺的時間軸與彈道數學搬到 motions/shatter.js。這裡只留一次繫結：
// 那組函式只讀參數、不碰場景狀態，所以把 P 綁進去之後呼叫方式與拆檔前相同。
const {
  shatterSegmentSeconds, shatterTimeline, shatterSeed, shatterOffset,
  shatterShapeAmount, shatterFragmentRadius, shatterRadius,
} = createShatterMotion(P);

// 形狀匯聚的時間軸與自由軌道、穿梭環繞的飄浮位置都搬到 motions/formation.js。
// 錨點陣列在匯入新形狀時會整個換掉，所以用 getter 傳入而不是傳陣列本身。
const {
  holdBreathScale, formationAmount, formationFidelityAmount, formationReleaseAmount,
  freeOrbitPosition, formationDropPosition, formationArcLift, weaveDropPosition,
  formationLead, formationLocalAmount, formationCutFront,
} = createFormationMotion(P, {
  dropSeeds,
  anchors: () => formationAnchors,
  weaveAnchors: () => weaveSurfaceAnchors,
  // 成型波前的掃描範圍用密集的微滴錨點量，不用主滴那組：主滴只有幾顆，取出來
  // 的投影範圍會比形狀本身窄一大截，波前掃到頭時邊角還沒長出來。
  frontAnchors: () => (microFormationAnchors.length ? microFormationAnchors : formationAnchors),
  edgeScale: () => formationEdgeScale,
});

// 融化：底部滴落。滴落點、水滴包絡與形變都在模組裡；形狀與它的版本號用 getter
// 傳進去，換形狀或調取樣範圍後下一幀才會重挑滴落點。
const meltRuntime = createMeltRuntime({
  params: P,
  maxDrops: MAX_DROPS,
  shapeTargets: () => shapeTargets,
  shapeSerial: () => shapeFieldSerial,
});
// 配對表由 bubble.js 這邊持有（它才知道形狀什麼時候換），morph.js 只負責讀。
const {
  morphTimeline: morphTimelineOf, morphFronts, morphDropPosition, morphRadiusFactor,
  morphShapeBlend,
} = createMorphMotion(P);

// 造型本身的剛體動態（見 motions/shapeRigid.js）。每幀在 updateDropUniforms
// 頂端算一次存進 shapeRigidNow，本模組其餘地方（updateMicroDrops／
// updateNegativeDrops／主滴迴圈）都直接讀這個共用狀態，不必個別重算。
const { shapeRigidMotion } = createShapeRigidMotion(P);

// 果凍：兩條互斥的分支（原地戳擊／落地彈跳）都收在這個執行期模組裡。它產出的是
// 跟 shapeRigidMotion 同一種形狀的變換物件，所以下面那條「歐拉角 → 旋轉矩陣」的
// 通用轉換兩者共用。形狀底部與表面錨點以 getter 傳進去：那是這裡才知道何時失效
// 的形狀場狀態。
const jellyRuntime = createJellyRuntime({
  params: P,
  shapeBottom,
  surfaceAnchors: () => weaveSurfaceAnchors,
  fallbackAnchors: () => formationAnchors,
});
// 私語：主殼與伴生殼週期性融合，水滴是模式本體而不是裝飾（見該模組）。
const researchRuntime = createResearchRuntime({ params: P, dropSeeds });
let shapeRigidNow = null;
const shapeRigidVec = new THREE.Vector3();
// 旋轉現在是任意軸（XYZ 各自振幅），用歐拉角組出一個 3x3 旋轉矩陣，比逐軸
// 手算 sin/cos 疊加省事也不容易錯。這三個是每幀重算矩陣用的暫存物件，
// 不在 shapeRigidMotion 裡建是因為那個模組刻意不依賴 THREE。
const shapeRigidEuler = new THREE.Euler();
const shapeRigidMat4 = new THREE.Matrix4();
const shapeRigidRot = new THREE.Matrix3();
// 把形狀本地座標（形狀匯聚／穿梭環繞／融化／崩解噴濺／形狀變形的水滴都是拿
// 這個空間裡的錨點在算位置）套上本幀的剛體動態，變成最終世界座標。造型的
// SDF 取樣座標也套了同一份變換的反變換（見 shaders.js 的 shapeP），兩者才不
// 會分家。未啟用時（shapeRigidNow 為 null）就是恆等變換。
function applyShapeRigid(x, y, z, out) {
  if (!shapeRigidNow) return out.set(x, y, z);
  const { rotation, offsetX, offsetY, scaleX, scaleY, scaleZ } = shapeRigidNow;
  out.set(x * scaleX, y * scaleY, z * scaleZ).applyMatrix3(rotation);
  out.x += offsetX || 0;
  out.y += offsetY;
  return out;
}

// 形狀變形的「第二組」——形狀 B 自己的旋轉／呼吸／浮動，跟形狀 A（也就是上面
// 的 shapeRigidNow）分開算。只有形狀變形模式會算這個，其餘模式維持 null，
// applyShapeRigidBlend 在那些模式底下退化成跟 applyShapeRigid 完全一樣的結果。
let shapeRigid2Now = null;
const shapeRigid2Euler = new THREE.Euler();
const shapeRigid2Mat4 = new THREE.Matrix4();
const shapeRigid2Rot = new THREE.Matrix3();
// 混合兩組剛體變換時裝中間結果的暫存向量，不能跟 shapeRigidVec 共用——
// 兩組都要先各自算完整個變換後的位置，才能對兩個「已經是最終座標」的點
// 取插值；共用一顆會被下一組覆寫掉上一組的結果。
const shapeRigidBlendA = new THREE.Vector3();
const shapeRigidBlendB = new THREE.Vector3();
// blend：0＝完全套用第一組（形狀 A），1＝完全套用第二組（形狀 B），中間值
// 對兩組「已經套用完剛體變換的最終位置」取線性插值——不是對角度／縮放本身
// 插值。角度插值在小振幅（滑桿上限 45°）下不會有萬向鎖或角度繞遠路的問題，
// 但對最終位置插值同時更省——兩顆旋轉矩陣本來就要在算 shapeRigidNow／
// shapeRigid2Now 時各自建好一次（每幀一次，不是每顆水滴一次），這裡對每顆
// 水滴只是多做一次矩陣套用＋一次向量線性插值，不必再建新矩陣。
// 沒有第二組（非形狀變形模式，或造型動態關閉）時直接退化成 applyShapeRigid，
// 這樣呼叫端不用先判斷「這個模式有沒有第二組」再決定要叫哪一個函式。
function applyShapeRigidBlend(x, y, z, blend, out) {
  if (!shapeRigid2Now || blend <= 0) return applyShapeRigid(x, y, z, out);
  if (!shapeRigidNow || blend >= 1) {
    const { rotation, offsetX, offsetY, scaleX, scaleY, scaleZ } = shapeRigid2Now;
    out.set(x * scaleX, y * scaleY, z * scaleZ).applyMatrix3(rotation);
    out.x += offsetX || 0;
    out.y += offsetY;
    return out;
  }
  applyShapeRigid(x, y, z, shapeRigidBlendA);
  {
    const { rotation, offsetX, offsetY, scaleX, scaleY, scaleZ } = shapeRigid2Now;
    shapeRigidBlendB.set(x * scaleX, y * scaleY, z * scaleZ).applyMatrix3(rotation);
    shapeRigidBlendB.x += offsetX || 0;
    shapeRigidBlendB.y += offsetY;
  }
  return out.set(
    shapeRigidBlendA.x + (shapeRigidBlendB.x - shapeRigidBlendA.x) * blend,
    shapeRigidBlendA.y + (shapeRigidBlendB.y - shapeRigidBlendA.y) * blend,
    shapeRigidBlendA.z + (shapeRigidBlendB.z - shapeRigidBlendA.z) * blend,
  );
}

// 微滴的自由軌道在 updateMicroDrops 直接呼叫 freeOrbitPosition，需要自己的暫存向量。
const freeOrbitVec = new THREE.Vector3();
// 微滴的弧線隆起（formationArcLift）也在 updateMicroDrops 直接呼叫，不能跟主滴
// 迴圈共用 formationPosNow——理由跟 formation.js 的 orbitScratch 註解一樣：共用
// 同一顆在巢狀呼叫時會互相覆寫。
const microArcVec = new THREE.Vector3();

const formationPosNow = new THREE.Vector3();
const formationPosBefore = new THREE.Vector3();
const formationPosAfter = new THREE.Vector3();

function updateMicroDrops(phase, fidelityAbsorb = 0, morphSolid = false) {
  // 崩解噴濺不走匯聚管線，但微滴群正好是最好用的碎片來源（20 顆，是主滴的
  // 近兩倍），所以它也要把微滴開起來，只是位置改由彈道決定。
  const shattering = P.motion === 'shatter';
  // 融化也要微滴：滴落點就那幾個，只靠 12 顆主滴撐不出「不停在滴」的密度，
  // 微滴補上去之後同一個位置才會有前後好幾滴同時在不同高度。
  const melting = meltRuntime.active();
  // 形狀變形的微滴不是「細節補強」而是主力之一：整個畫面只有水滴，主滴 12 顆
  // 撐不出兩顆形狀的輪廓，微滴那 20 顆負責把輪廓填細。
  const morphing = P.motion === 'morph';
  // 果凍不列入：它的造型是完整靜止的實體，沒有「正在成形的細節」需要微滴去補，
  // 加上去只會變成貼在表面的一圈贅球。
  const activeCount = (isFormationMotion(P.motion) || shattering || melting || morphing)
    && shapeField
    ? Math.max(0, Math.min(MAX_MICRO_DROPS, Math.round(P.microCount)))
    : 0;
  const amount = formationAmount(phase);
  const shatter = shattering ? shatterTimeline(phase) : null;
  const shatterAnchors = shattering ? shatterAnchorSets().micro : null;
  const a = phase * Math.PI * 2;
  for (let i = 0; i < MAX_MICRO_DROPS; i++) {
    const o = i * 4;
    const pool = shattering ? shatterAnchors
      : melting ? meltRuntime.anchors()
      // 變形模式的微滴走配對表，不走單一錨點組；配對表還沒建好（形狀 B 還在
      // 烘）就當成沒有錨點，這一幀不畫。
      : morphing ? morphMicroPairs
      : microFormationAnchors;
    if (i >= activeCount || !pool.length) {
      microDropData[o + 3] = 0;
      continue;
    }
    const h1 = hash11CPU(i * 2.31 + 31);
    const h2 = hash11CPU(i * 3.77 + 47);
    const h3 = hash11CPU(i * 5.13 + 61);
    if (shattering) {
      const target = shatterAnchors[i % shatterAnchors.length];
      shatterOffset(
        target,
        shatterSeed(i * 2.31 + 31, i * 3.77 + 47, i * 5.13 + 61),
        shatter,
        formationPosNow,
      );
      applyShapeRigid(formationPosNow.x, formationPosNow.y, formationPosNow.z, formationPosNow);
      microDropData[o] = formationPosNow.x;
      microDropData[o + 1] = formationPosNow.y;
      microDropData[o + 2] = formationPosNow.z;
      microDropData[o + 3] = shatterRadius(shatterFragmentRadius(target, h2), shatter);
      // 碎片是自由飛散的獨立液滴，不該保留「貼在造型上被拉長」的橢球形變。
      microShapeData[o] = 1;
      microShapeData[o + 1] = 0;
      microShapeData[o + 2] = 0;
      microShapeData[o + 3] = 1;
      continue;
    }
    if (melting) {
      const melt = meltRuntime.microDrop(i, phase, formationPosNow);
      applyShapeRigid(formationPosNow.x, formationPosNow.y, formationPosNow.z, formationPosNow);
      microDropData[o] = formationPosNow.x;
      microDropData[o + 1] = formationPosNow.y;
      microDropData[o + 2] = formationPosNow.z;
      microDropData[o + 3] = melt.radius;
      // 微滴只套得上垂直拉長（理由見 motions/runtime/melt.js 的 microDrop）。
      microShapeData[o] = 0;
      microShapeData[o + 1] = 1;
      microShapeData[o + 2] = 0;
      microShapeData[o + 3] = melt.stretch;
      continue;
    }
    if (morphing) {
      morphDropPosition(morphMicroPairs, i, phase, formationPosNow);
      // 微滴跟主滴用同一份分組邏輯——沒有這個的話，微滴會全部套第一組（形狀 A）
      // 的動態，跟主滴各轉各的，輪廓細節看起來會跟主體錯開。
      const microBlend = morphShapeBlend(morphMicroPairs, i, phase);
      applyShapeRigidBlend(
        formationPosNow.x, formationPosNow.y, formationPosNow.z, microBlend, formationPosNow,
      );
      microDropData[o] = formationPosNow.x;
      microDropData[o + 1] = formationPosNow.y;
      microDropData[o + 2] = formationPosNow.z;
      // 錨點自帶的 radiusHint 是「這個位置的造型有多厚」，用它輪廓的粗細才會
      // 跟著形狀走（星形的角細、問號的桿粗）。兩端厚度不同，所以跟著一起插值；
      // 缺就退回一個依 h2 分散的尺寸。
      const pair = morphMicroPairs[i % morphMicroPairs.length];
      const { t, back } = morphTimelineOf(phase);
      const fallback = P.radius * (0.28 + h2 * 0.16);
      const fromHint = (back ? pair.b : pair.a).radiusHint || fallback;
      const toHint = (back ? pair.a : pair.b).radiusHint || fallback;
      microDropData[o + 3] = (fromHint + (toHint - fromHint) * t) * 0.72
        * morphRadiusFactor(morphMicroPairs, i, phase, morphSolid);
      microShapeData[o] = 1;
      microShapeData[o + 1] = 0;
      microShapeData[o + 2] = 0;
      microShapeData[o + 3] = 1;
      continue;
    }
    const anchor = i * Math.PI * 2 / activeCount + h1 * 0.8;
    const orbit = P.spread * (1.15 + h2 * 0.75);
    const free = freeOrbitPosition(a, anchor, orbit, h2, h3, MICRO_ORBIT_TUNE, freeOrbitVec);
    const freeX = free.x, freeY = free.y, freeZ = free.z;
    const target = microFormationAnchors[i % microFormationAnchors.length];
    // 抵達時機。波前開啟時順序由目標位置在掃描場上的投影決定（實體的波前是從
    // 同一條式子反解出來的，所以兩者咬合）；關閉時退回舊的 h3 亂數錯開，
    // formationJitter 在那條路徑上是錯開幅度的乘數。
    const local = P.formationFrontOn
      ? formationLocalAmount(amount, formationLead(target.x, target.y, i))
      : smoothstepCPU(
        amount,
        0.04 + h3 * 0.30 * P.formationJitter,
        0.62 + h3 * 0.20 * P.formationJitter,
      );
    const eased = local * local * (3 - 2 * local);
    // 飛行途中的膨脹包絡：0（尚未出發）與 1（已抵達）兩端恆為 1，中段依
    // formationSwell 脹大，模擬液體被推聚時先鼓起再收束的張力感。
    const swell = 1 + P.formationSwell * Math.sin(Math.PI * local);
    // 吸收（水滴讓位給實體）。波前開啟時必須逐顆算：全域的 fidelityAbsorb 是
    // 一條跟位置無關的曲線，波前先掃到的那區水滴會在自己早就該併進實體之後
    // 還留在原地，變成貼在成形處的一圈球。取兩者較大值，散開段仍由全域那條
    // 把所有水滴放回來。
    const absorb = P.formationFrontOn
      ? Math.max(fidelityAbsorb, smoothstepCPU(local, 0.74, 1))
      : fidelityAbsorb;
    const insetScale = 1 - absorb * 0.20;
    microArcVec.set(
      freeX + (target.x - freeX) * eased,
      freeY + (target.y - freeY) * eased,
      freeZ + (target.z - freeZ) * eased,
    );
    // 用逐顆水滴的 local（已含抵達時間錯開）而不是全域 amount，弧線隆起才會
    // 跟著同一批水滴的出發/抵達時機錯開，不是整群同時鼓起。
    formationArcLift(freeX, freeY, freeZ, target.x, target.y, target.z, local, microArcVec);
    applyShapeRigid(
      microArcVec.x * insetScale,
      microArcVec.y * insetScale,
      microArcVec.z * insetScale,
      shapeRigidVec,
    );
    microDropData[o] = shapeRigidVec.x;
    microDropData[o + 1] = shapeRigidVec.y;
    microDropData[o + 2] = shapeRigidVec.z;
    const targetRadius = target.radiusHint || P.radius * (0.28 + h2 * 0.16);
    // 自由飛行時仍是清楚可見的小滴；抵達後保留完整體積成為最終造型的一部分。
    // 半徑與位置共用相同 local，因此不會再出現「先縮掉、模型才淡入」。
    const freeRadius = targetRadius * (0.52 + h2 * 0.16);
    microDropData[o + 3] = (freeRadius + (targetRadius - freeRadius) * eased)
      * swell
      * (1 - absorb);
    const axis = target.axis || formationPosNow.set(1, 0, 0);
    microShapeData[o] = axis.x;
    microShapeData[o + 1] = axis.y;
    microShapeData[o + 2] = axis.z;
    // 拉伸要晚於位置/半徑到位，不能跟 eased 同步：eased 走到一半時水滴還在
    // 半路飄、半徑也還沒縮定，若這時就套一半拉伸，會看起來像「一顆浮在
    // 空中的橢球正同時縮小又被拉長」——不像正在組成形狀，像單顆水滴在
    // 變形。拉伸延到 eased 後段才起步，讀成「水滴先落定、才順著輪廓被
    // 拉開」，跟旁邊還沒到位的圓滴區隔開來。
    const stretchT = smoothstepCPU(eased, 0.55, 1);
    microShapeData[o + 3] = 1 + ((target.stretch || 1) - 1) * stretchT;
  }
  if (microDropTexture) microDropTexture.needsUpdate = true;
  if (microShapeTexture) microShapeTexture.needsUpdate = true;
  return activeCount;
}

function updateNegativeDrops(phase, fidelityAbsorb = 0) {
  // 空腔（負滴）是形狀的一部分，不是水滴的一部分。崩解噴濺沒有匯聚包絡可讀，
  // 直接跟著形狀本身的可見度走：炸開後形狀不在，空腔自然也不該留在畫面上。
  // 融化的形狀始終完整，空腔自然也要一直在，不隨任何包絡消長。
  // 果凍的實體同樣全程都在（uShapeProgress 恆為 1），空腔要一直在，否則有真
  // 孔洞的模型（例如環形 GLB）會被填實。
  const amount = meltRuntime.active() || jellyRuntime.active() || isExtendedMotion(P.motion)
    ? 1
    // 形狀變形不顯示距離場實體（uShapeProgress 為 0），空腔沒有母體可挖，留著
    // 只會變成幾顆漂在水滴群裡的隱形挖洞球，把輪廓咬掉幾塊。
    : P.motion === 'morph'
      ? 0
      : P.motion === 'shatter'
        ? shatterShapeAmount(shatterTimeline(phase))
        : smoothstepCPU(formationAmount(phase), 0.58, 0.96);
  const selected = negativeFormationAnchors;
  for (let i = 0; i < MAX_NEGATIVE_DROPS; i++) {
    const o = i * 4;
    const target = selected[i];
    if (!target || amount <= 0) {
      negativeDropData[o + 3] = 0;
      continue;
    }
    applyShapeRigid(target.x, target.y, target.z, shapeRigidVec);
    negativeDropData[o] = shapeRigidVec.x;
    negativeDropData[o + 1] = shapeRigidVec.y;
    negativeDropData[o + 2] = shapeRigidVec.z;
    negativeDropData[o + 3] = (target.radiusHint || 0.09) * amount
      * (1 - fidelityAbsorb);
  }
  if (negativeDropTexture) negativeDropTexture.needsUpdate = true;
  return Math.min(selected.length, MAX_NEGATIVE_DROPS);
}

// 水滴動畫只在 CPU 每幀計算一次；shader 的每個 march step 僅讀取 vec4 array。
function updateDropUniforms(t) {
  // 水滴數量可以是 0（例如崩解噴濺只想要微滴碎片、穿梭環繞只想留形狀本身）。
  // count 本身允許 0，交給 uCount 讓 shader 直接跳過主滴迴圈；但凡是拿它當
  // 除數或版面基準的地方一律改用 layoutCount，否則 0 會變成 Infinity／NaN。
  // 有些模式的水滴數量是模式本體的一部分，不是可增減的參數，由模組自己覆寫
  // （毛細波固定 0、私語固定兩顆殼，各自的理由見各自的模組）。其餘模式才吃
  // 面板上的數量。
  const fixedCount = staticCapillaryRuntime.dropCount() ?? researchRuntime.dropCount();
  const count = fixedCount ?? Math.max(0, Math.min(MAX_DROPS, Math.round(P.count)));
  const layoutCount = Math.max(1, count);
  const tau = Math.PI * 2;
  const phase = fract(t / Math.max(0.001, P.loopDuration));
  const a = phase * tau;
  // 只有走 SDF 的模式才有造型可動；不用形狀場的模式維持 null，
  // applyShapeRigid 在那些模式底下自然是恆等變換。
  //
  // 果凍走自己那條阻尼彈簧，不疊「造型動態」那組週期性旋轉／呼吸（理由見
  // motions/runtime/jelly.js）。
  if (jellyRuntime.active()) {
    // 原地戳擊與落地彈跳兩條分支都在模組裡選（見 motions/runtime/jelly.js）。
    shapeRigidNow = jellyRuntime.shapeRigid(phase);
  } else if (researchRuntime.active()) {
    shapeRigidNow = researchRuntime.shapeRigid(phase);
  } else {
    shapeRigidNow = usesShapeField(P.motion) ? shapeRigidMotion(phase) : null;
  }
  if (shapeRigidNow) {
    shapeRigidEuler.set(shapeRigidNow.angleX, shapeRigidNow.angleY, shapeRigidNow.angleZ, 'XYZ');
    shapeRigidRot.setFromMatrix4(shapeRigidMat4.makeRotationFromEuler(shapeRigidEuler));
    shapeRigidNow.rotation = shapeRigidRot;
  }
  // 第二組（形狀 B）只在形狀變形模式底下才有意義——其餘模式只有一顆形狀，
  // 沒有「另一顆」可以套第二組參數。跟第一組共用同一個「造型動態」總開關：
  // 開關本身不分組，分的是開了之後兩組各自的數值。
  shapeRigid2Now = (P.motion === 'morph' && P.shapeMotionOn)
    ? computeShapeRigid({
      cycles: P.shape2MotionCycles,
      ease: P.shape2MotionEase,
      spinX: P.shape2SpinX,
      spinY: P.shape2SpinY,
      spinZ: P.shape2SpinZ,
      breathe: P.shape2Breathe,
      bob: P.shape2Bob,
      squash: P.shape2Squash,
    }, phase)
    : null;
  if (shapeRigid2Now) {
    shapeRigid2Euler.set(shapeRigid2Now.angleX, shapeRigid2Now.angleY, shapeRigid2Now.angleZ, 'XYZ');
    shapeRigid2Rot.setFromMatrix4(shapeRigid2Mat4.makeRotationFromEuler(shapeRigid2Euler));
    shapeRigid2Now.rotation = shapeRigid2Rot;
  }
  const amount = formationAmount(phase);
  const fidelityAbsorb = isFormationMotion(P.motion) && shapeField
    ? formationFidelityAmount(phase)
    : 0;
  const holdEnd = Math.min(0.94, Math.max(0.15, P.gatherDuration) + P.shapeHold);
  const releasingShape = phase > holdEnd;
  const releaseTransfer = releasingShape ? formationReleaseAmount(phase) : 0;
  // 高密度細節場由可見主滴進入模型區域後才開始長出；它本身是預烘焙
  // Metaball union，而非原始 GLB SDF。
  // 穿梭環繞的形狀是恆定的背景主體，不走匯聚／散開的體積交接，永遠滿值顯示。
  const shatter = P.motion === 'shatter' ? shatterTimeline(phase) : null;
  const shatterPrimary = shatter ? shatterAnchorSets().primary : null;
  const melting = meltRuntime.active();
  const morphing = P.motion === 'morph';
  const jelly = jellyRuntime.active();
  const extended = isExtendedMotion(P.motion);
  if (extended) syncExtendedShapeContext();
  if (melting) meltRuntime.rebuildAnchors();
  if (morphing) { ensureMorphTarget(); rebuildMorphPairs(); }
  // 實體變形要有雙通道貼圖才成立；沒有就只剩水滴（見 rebuildMorphPackedTexture）。
  const morphSolid = morphing && !!morphPackedTexture && morphPairs.length > 0;
  const morphCut = morphSolid ? morphFronts(morphPairs, phase) : null;
  const morphCutT = morphSolid ? morphTimelineOf(phase).t : 0;
  const formationShapeProgress = !shapeField
    ? 0
    // 融化的形狀從頭到尾完整不變：滴下去的是額外長出來的水滴，不是造型被削掉的
    // 部分。所以跟穿梭環繞一樣永遠滿值，不參與任何體積交接。
    // 形狀變形的實體同樣永遠滿值：它不靠淡入淡出交接，兩顆形狀是被兩道波前
    // 各自削掉／放出來的（見 shaders.js 的 uShapeCut），整個循環都該全力顯示。
    // 果凍的形狀從頭到尾完整，只是在晃——完全不參與任何體積交接。
    // 靜態模式的匯入造型同樣要一直是滿值：沒有匯聚時間軸這回事，選了「匯入」
    // 就整顆展示，不管選的是哪種內建幾何都跟這個進度值無關（那條走
    // FEATURE_STATIC_SHAPE 自己的 uStaticShape 分支，不受這個值影響）。
    : P.motion === 'weave' || melting || morphSolid || jelly || extended
      || staticCapillaryRuntime.keepsShapeFull()
      ? 1
      : shatter
        ? shatterShapeAmount(shatter)
        : isFormationMotion(P.motion)
          // 成型波前開啟時，「哪裡看得到形狀」整個交給波前（uShapeCut），這條
          // 全域進度只剩兩個責任：把等距侵蝕在一開始就退場（否則會跟波前互相
          // 蓋住，變成兩層各自的成形），以及維持兩端為 0——uShapeProgress 還
          // 兼任 geometryWobble 的插值權重（見 shaders.js），突然跳成 1 會讓
          // 自由飛行段的水滴晃動整片變樣。
          ? P.formationFrontOn
            ? smoothstepCPU(amount, 0.01, 0.22)
            // 回程使用同一個體積交接進度：模型從第一幀開始退、水滴同步長回。
            // 舊版先維持完整模型、再集中侵蝕，會形成「模型上冒球後突然塌掉」。
            : releasingShape
              // 在水滴完全散開前清掉最後的模型核心，避免循環尾端留下 SDF 碎片。
              ? 1 - smoothstepCPU(releaseTransfer, 0.0, 0.84)
              : smoothstepCPU(amount, 0.42, 0.96)
          : 0;
  // 模型已大致長成後，讓可見水滴在目標體積內連續被 SDF 吸收。
  // 最後輪廓只剩匯入模型場；吸收在模型完成前不啟動，避免「水滴先縮、模型才出現」。
  const microCount = updateMicroDrops(phase, fidelityAbsorb, morphSolid);
  const negativeCount = updateNegativeDrops(phase, fidelityAbsorb);

  // 崩解噴濺、融化、形狀變形、形狀匯聚都是「一次出現很多顆」，需要同一套正規化
  // ——否則炸開／排成形狀的那一瞬間，滿半徑的水滴會被 smooth-min 黏成一大團而不是
  // 各自剝離，輪廓完全糊掉。
  const viscosityScale =
    isFormationMotion(P.motion) || P.motion === 'shatter' || melting || morphing || extended
      // smooth-min 連續合併很多顆時會累積膨脹；依數量正規化融合半徑，
      // 讓 12–16 顆仍只在真正接觸處形成液橋，不把整組擴成巨大距離場。
      ? Math.max(0.10, 0.42 / Math.sqrt(layoutCount))
      : 1;
  const effectiveViscosity = P.viscosity * viscosityScale;

  for (let i = 0; i < MAX_DROPS; i++) {
    const { h1, h2, h3, radius } = dropSeeds[i];
    let x = 0, y = 0, z = 0, radiusFactor = 1, morphBlend = 0;
    // 崩解噴濺的半徑不走 freeRadius 那條（見 shatterFragmentRadius），改記下
    // 這顆碎片配到的錨點，等下面統一由它的局部厚度算大小。
    let shatterTarget = null;
    // 融化的半徑同樣自成一套（長出→墜落→縮到 0 的包絡），在這裡先接住。
    let meltState = null;

    if (P.motion === 'weave') {
      weaveDropPosition(i, phase, layoutCount, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      // 「好幾顆大小不一的水滴」——每顆水滴的大小落在使用者設定的上下限之間，
      // 半徑固定不隨 phase 變化，只是「這顆水滴本來就比較大/小」。
      radiusFactor = P.weaveSizeMin + h3 * (P.weaveSizeMax - P.weaveSizeMin);
    } else if (shatter) {
      const target = shatterPrimary.length
        ? shatterPrimary[i % shatterPrimary.length]
        : null;
      if (target) {
        shatterOffset(target, shatterSeed(i + 1, i + 7, i + 13), shatter, formationPosNow);
        x = formationPosNow.x;
        y = formationPosNow.y;
        z = formationPosNow.z;
      }
      shatterTarget = target;
    } else if (melting) {
      meltState = meltRuntime.mainDrop(i, phase, formationPosNow);
      if (meltState) {
        x = formationPosNow.x;
        y = formationPosNow.y;
        z = formationPosNow.z;
      }
    } else if (morphing) {
      morphDropPosition(morphPairs, i, phase, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      radiusFactor = morphRadiusFactor(morphPairs, i, phase, morphSolid);
      // 這顆水滴此刻偏向形狀 A 還是形狀 B，餵給下面的 applyShapeRigidBlend，
      // 讓它在飛行途中混合兩組造型動態，而不是整場套同一份。
      morphBlend = morphShapeBlend(morphPairs, i, phase);
    } else if (jelly) {
      // 果凍的水滴貼在造型表面的錨點上（見 motions/runtime/jelly.js）。下面的
      // applyShapeRigid 會把果凍的形變一併套上去，水滴因此跟著一起晃。
      if (jellyRuntime.dropPosition(h2, formationPosNow)) {
        x = formationPosNow.x;
        y = formationPosNow.y;
        z = formationPosNow.z;
      }
    } else if (researchRuntime.active()) {
      radiusFactor = researchRuntime.dropPosition(i, phase, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
    } else if (extended) {
      const state = extendedMotions.sample(
        P.motion, i, phase, layoutCount, dropSeeds[i], extendedShapeContext, extendedMotionState[i],
      );
      if (state) {
        x = state.x; y = state.y; z = state.z;
        radiusFactor = state.radiusFactor;
      }
    } else if (isFormationMotion(P.motion)) {
      const formation = amount;
      formationDropPosition(i, phase, layoutCount, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      radiusFactor = 0.82 + formation * 0.18;
    }
    // 大滴受重力與慣性影響較明顯；常量位移不破壞循環接縫。
    // 融化不套這個：水滴必須正好從造型底部的滴落點長出來，先被推低一截就會
    // 憑空浮在造型下方。它自己的墜落已經在 meltPosition 裡算過了。
    // 形狀變形也排除：這個偏移隨每顆水滴的大小不同，而變形模式的輪廓完全由
    // 水滴自己排出來，大小不一的下沉量會讓靜止的形狀邊緣參差不齊。
    // 果凍同樣排除：它的水滴要正好貼在實體的表面錨點上，被推低一截就會在輪廓旁
    // 浮出一圈對不上的球。
    if (!melting && !morphing && !jelly && !extended && !researchRuntime.active()) {
      y -= P.gravity * P.spread * 0.045 * Math.pow(radius, 1.35);
    }
    if (isFormationMotion(P.motion)) {
      // anchor 可能落在模型表層；吸收時稍微往模型中心推入，避免半徑縮小後
      // 先失去液橋、在輪廓旁短暫留下孤立小球。
      const insetScale = 1 - fidelityAbsorb * 0.20;
      x *= insetScale;
      y *= insetScale;
      z *= insetScale;
    }
    // weave/shatter/melt/morph/formation 這五種都是拿形狀本地空間的錨點算
    // 位置，造型的剛體動態要在這裡套進去，水滴才會跟著造型一起轉/浮/呼吸，
    // 而不是各動各的。不用形狀場的模式 shapeRigidNow 恆為 null。
    // 形狀變形用 blend 版本：非 morph 模式 morphBlend 恆為 0，退化成跟
    // applyShapeRigid 完全一樣（見該函式開頭 blend<=0 的 early return）。
    if (shapeRigidNow || shapeRigid2Now) {
      applyShapeRigidBlend(x, y, z, morphBlend, shapeRigidVec);
      x = shapeRigidVec.x; y = shapeRigidVec.y; z = shapeRigidVec.z;
    }
    const freeRadius = P.radius * radius * radiusFactor;
    if (shatter) {
      const fragment = shatterTarget
        ? shatterFragmentRadius(shatterTarget, h3)
        : 0;
      dropData[i].set(x, y, z, shatterRadius(fragment, shatter));
    } else if (melting) {
      dropData[i].set(x, y, z, meltState ? meltState.radius : 0);
    } else if (morphing) {
      // 跟形狀匯聚成形後同一套：半徑由錨點所在位置的造型厚度決定，而不是
      // 「水滴大小」乘一個亂數。輪廓完全靠水滴排出來的模式，這件事更要緊——
      // 大小一致的球排出來的是一串珠子，粗細跟著形狀走才看得出是那個形狀。
      // 兩顆形狀的厚度不同，所以出發端與抵達端的 hint 也要跟著插值。
      const pair = morphPairs.length ? morphPairs[i % morphPairs.length] : null;
      const { t, back } = morphTimelineOf(phase);
      const fromHint = (back ? pair?.b : pair?.a)?.radiusHint || P.radius * 0.58;
      const toHint = (back ? pair?.a : pair?.b)?.radiusHint || P.radius * 0.58;
      dropData[i].set(x, y, z, (fromHint + (toHint - fromHint) * t) * radiusFactor);
    } else if (isFormationMotion(P.motion)) {
      const anchorTarget = formationAnchors[i % Math.max(1, formationAnchors.length)];
      const targetRadius = anchorTarget?.radiusHint || P.radius * 0.58;
      // 主滴跟微滴讀同一套抵達順序與同一套吸收（見 updateMicroDrops）：波前開啟
      // 時主滴若還照全域曲線走，就會用另一條時間軸浮在早已成形的區域上。
      const localAmount = P.formationFrontOn && anchorTarget
        ? formationLocalAmount(
          formationAmount(phase),
          formationLead(anchorTarget.x, anchorTarget.y, i),
        )
        : formationAmount(phase);
      const settle = smoothstepCPU(localAmount, 0.12, 0.88);
      const absorb = P.formationFrontOn && anchorTarget
        ? Math.max(fidelityAbsorb, smoothstepCPU(localAmount, 0.74, 1))
        : fidelityAbsorb;
      dropData[i].set(
        x,
        y,
        z,
        (freeRadius + (targetRadius - freeRadius) * settle) * (1 - absorb),
      );
    } else {
      dropData[i].set(x, y, z, freeRadius);
    }
  }

  const { pairA, pairB, surfaceGap } = findClosestDropPair(dropData, count);

  const frameDt = previousDropT == null || t < previousDropT
    ? 0 : Math.min(0.05, Math.max(0.0001, t - previousDropT));
  const contactRange = Math.max(0.12, P.viscosity * 0.55);
  const contactAmount = count >= 2
    ? 1 - smoothstepCPU(surfaceGap, 0.015, contactRange) : 0;
  // 兩顆最近的水滴真的碰到時互相脹大半徑，形成液橋。什麼時候允許融合，由
  // contactMergeAmount 那條週期性閘門決定（見 drop-physics.js）。
  // 融化排除在外：每一滴都是各自落下的獨立水滴，靠得近時互相脹大半徑會黏成
  // 一條斷不開的水柱，正好是這個模式最不該有的樣子。
  const fusionAmount = contactAmount * contactMergeAmount(phase);
  if (!isFormationMotion(P.motion) && !researchRuntime.active() && !melting
    && count >= 2 && fusionAmount > 0) {
    const radiusA = dropData[pairA].w, radiusB = dropData[pairB].w;
    const mergedRadius = Math.cbrt(radiusA ** 3 + radiusB ** 3);
    dropData[pairA].w += (mergedRadius - radiusA) * fusionAmount;
    dropData[pairB].w += (mergedRadius - radiusB) * fusionAmount;
  }
  // 穿梭環繞的物體要維持獨立完整、不是由水滴組成的材質——水滴是另外一批
  // 獨立球體，只在循環軌跡上貼著/穿過它的表面。融合半徑不能沿用形狀匯聚那種
  // 「黏性液體徹底融成一坨」的手感，水滴彼此、水滴與物體之間的 smooth-min
  // 半徑都要收到只剩貼合處一點點圓角，其餘時間各自維持清楚的球體輪廓。
  // 崩解噴濺同理，而且更嚴格：碎片一旦離開母體就該是各自獨立、邊緣清楚的液滴，
  // 不是一團彼此牽絲的黏液。但炸開的瞬間它們還在造型上，那一刻保留正常黏性才
  // 看得出「從表面剝離」，所以依飛行進度連續收緊，而不是一開始就切到最小。
  // 融化取中間值：這個 uniform 是整幀共用的，而畫面上同時有「還黏在造型底部
  // 正在形成」與「已經墜到半空」兩種水滴。收太緊，正在形成的那顆會變成貼在表面
  // 的一顆獨立球，失去液體被拉出來的樣子；放太鬆，落下的幾滴會彼此牽絲黏成
  // 一條水柱。0.4 是兩者都還能看的折衷，再細調交給「黏度」滑桿。
  // 果凍的水滴是貼在造型表面的點綴，跟穿梭環繞一樣該保持清楚的球體輪廓，
  // 不該跟造型融成一坨黏液。
  // 穿梭環繞的沾黏程度改由滑桿決定（原本跟果凍共用寫死的 0.15）：這個模式的
  // 水滴要能貼上玻璃、拉出液橋，就不能永遠把融合關到底。果凍維持 0.15——它的
  // 水滴是貼在表面的點綴，融成一坨就沒有點綴可言。
  const mergeScale = P.motion === 'weave'
    ? Math.max(0.02, P.weaveCling)
    : researchRuntime.active()
      ? researchRuntime.mergeScale()
    : extended
      ? 0.34
    : jelly
      ? 0.15
      : melting
        ? meltRuntime.mergeScale()
        : shatter
          ? 1 + (0.15 - 1) * shatter.flight
          : 1;
  if (uniforms) uniforms.uViscosity.value = effectiveViscosity * mergeScale;
  // 毛細波的程序紋理同時服務兩個模式：毛細波本身（作用在匯入的形狀場）與靜態
  // 方體（作用在程序化方體 SDF）。那一整組 uniform 由 static-capillary 模組寫，
  // 這裡只決定這一幀是不是交給它。
  const capillaryFamily = staticCapillaryRuntime.active();
  // 打字模式的排版與行狀態。回傳值是這一行需要的包圍球半徑（見下面 dropBounds）。
  const typewriterReach = P.motion === 'typewriter' ? updateTypewriterUniforms(phase) : 0;
  if (uniforms) {
    if (capillaryFamily) {
      staticCapillaryRuntime.writeUniforms(uniforms);
    } else {
      uniforms.uEdgeDropCount.value = P.edgeDropsEnabled ? activeEdgeDrops.length : 0;
      uniforms.uWobble.value = researchRuntime.active()
        ? researchRuntime.wobble(phase)
        : P.wobble;
      uniforms.uExtendedMotion.value = extended ? MOTION_UNIFORM_MAP[P.motion] : 0;
      uniforms.uExtendedParams.value.set(0, 0, 0, 0);
    }
    uniforms.uShapeProgress.value = formationShapeProgress;
    uniforms.uFidelityAbsorb.value = fidelityAbsorb;
    uniforms.uShapeSwell.value = shatter ? shatter.swell : 0;
    uniforms.uShapeScale.value = 1 + holdBreathScale(phase);
    if (shapeRigidNow) uniforms.uShapeRigidRot.value.copy(shapeRigidNow.rotation);
    else uniforms.uShapeRigidRot.value.identity();
    uniforms.uShapeRigidOffset.value.set(
      shapeRigidNow ? (shapeRigidNow.offsetX || 0) : 0,
      shapeRigidNow ? shapeRigidNow.offsetY : 0,
      0,
    );
    uniforms.uShapeRigidScale.value.set(
      shapeRigidNow ? shapeRigidNow.scaleX : 1,
      shapeRigidNow ? shapeRigidNow.scaleY : 1,
      shapeRigidNow ? shapeRigidNow.scaleZ : 1,
    );
    // 形狀 B 的實體。只有形狀變形模式會有第二組；其餘模式沿用第一組的值，
    // 讓 shader 那條 B 通道等價於改動前的共用一份（其餘模式根本不走 B 通道，
    // 但寫成一致的值可以避免任何殘留狀態在切模式時漏出來）。
    const rigidB = shapeRigid2Now || shapeRigidNow;
    if (rigidB) uniforms.uShapeRigid2Rot.value.copy(rigidB.rotation);
    else uniforms.uShapeRigid2Rot.value.identity();
    uniforms.uShapeRigid2Offset.value.set(
      rigidB ? (rigidB.offsetX || 0) : 0,
      rigidB ? rigidB.offsetY : 0,
      0,
    );
    uniforms.uShapeRigid2Scale.value.set(
      rigidB ? rigidB.scaleX : 1,
      rigidB ? rigidB.scaleY : 1,
      rigidB ? rigidB.scaleZ : 1,
    );
    // 融化一併關掉：contactLead 是「形狀在已抵達水滴附近先成形」，前提是形狀還在
    // 成形中。融化的 uShapeProgress 恆為 1、形狀始終完整，這條規則就只剩副作用——
    // 它的影響半徑 0.72 遠大於水滴本身，等於幾顆「不侵蝕球」隨著水滴墜落掃過造型，
    // 半徑外被往內削 0.015、半徑內不削，形狀表面就整片整片地漲縮。
    // 形狀變形也關掉，理由跟融化同一條：實體恆為滿值，contactLead 只剩副作用
    // ——影響半徑遠大於水滴本身，飛過去的水滴會像幾把刨刀掃過兩顆形狀的表面。
    // 果凍同理：它的實體恆為滿值，沒有「正在成形」可言。
    uniforms.uContactLead.value = (shatter || melting || morphSolid || jelly || extended) ? 0 : 1;
    if (morphSolid) {
      uniforms.uShapeTex.value = morphPackedTexture;
      uniforms.uShapeMorph.value = morphCut.mode;
      uniforms.uShapeCut.value.set(
        morphCut.nx, morphCut.ny, morphCut.fromFront, morphCut.toFront,
      );
      // 這幾個是打包型 uniform，不走「滑桿 key → u+首字大寫」那條自動對應，
      // 所以在這裡跟著波前一起送。
      uniforms.uMorphBreak.value.set(
        P.morphNoise, P.morphNoiseScale, P.morphCell, P.morphCellScale,
      );
      uniforms.uMorphNecking.value.set(P.morphNeck, P.morphNeckWidth);
      uniforms.uMorphActive.value.set(
        morphCut.fromActive ? 1 : 0, morphCut.toActive ? 1 : 0,
      );
    } else {
      // 離開變形模式（或還沒備妥雙通道貼圖）就把貼圖交還給形狀本身那張，
      // 否則其餘模式會繼續讀到打包過的圖。
      if (shapeField?.texture) uniforms.uShapeTex.value = shapeField.texture;
      uniforms.uShapeMorph.value = 0;
    }
    // 形狀匯聚的成型波前。跟 morph 共用 uShapeCut／uMorphBreak／uMorphNecking／
    // uShapeCutBlend 這組 uniform，所以要在 morphSolid 那個分支之後才寫——同一
    // 幀不可能兩個模式都成立，但這幾顆 uniform 平時是被「滑桿 key → u+首字大寫」
    // 那條自動對應塞成 morph 的值的，這裡要蓋掉它們。
    const formationCut = isFormationMotion(P.motion) && shapeField && P.formationFrontOn;
    uniforms.uFormationCut.value = formationCut ? 1 : 0;
    if (formationCut) {
      const front = formationCutFront(amount);
      // z 與 w 給同一個值：只有一道波前，而 dissolveField 的擾動加速帶是拿
      // 「離 z 或 w 較近的那個」在算的（見 shaders.js），兩個都指同一條線，
      // 帶子才會正好罩在這道波前上。
      uniforms.uShapeCut.value.set(front.nx, front.ny, front.front, front.front);
      uniforms.uShapeCutBlend.value = P.formationCutBlend;
      uniforms.uMorphFront.value = P.formationFront;
      uniforms.uMorphSpiral.value = P.formationSpiral;
      // 三項邊緣擾動一律乘上 formationEdgeScale，跟 formation.js 的 breakAmount
      // 讀同一個係數——實體的擾動幅度與水滴的出發參差必須同步縮，否則兩者脫鉤。
      const es = formationEdgeScale;
      uniforms.uMorphBreak.value.set(
        P.formationNoise * es, P.formationNoiseScale, P.formationCell * es, P.formationCellScale,
      );
      uniforms.uMorphNecking.value.set(P.formationNeck * es, P.formationNeckWidth);
    }
    // 半徑已連續收至零後才停止 shader 迴圈；切換當下幾何場完全相同。
    const fidelityComplete = fidelityAbsorb > 0.9999;
    // 形狀變形的定格段：所有水滴的存在包絡都是 0（它們此刻就是形狀的一部分），
    // 半徑全歸零，但 shader 每個 march step 仍會把 32 顆空球跑一遍——實測定格
    // 因此比整顆形狀常駐的穿梭環繞貴了兩倍多。定格佔循環三成，而且正是使用者
    // 盯著形狀看的時候，所以這裡明確把數量歸零。
    const morphIdle = morphSolid && (morphCutT <= 0 || morphCutT >= 1);
    const dropsHidden = fidelityComplete || morphIdle;
    uniforms.uCount.value = dropsHidden ? 0 : count;
    uniforms.uMicroCount.value = dropsHidden ? 0 : microCount;
    uniforms.uNegativeCount.value = dropsHidden ? 0 : negativeCount;
    // 完成時保留最多 0.02 的薄層，封住體素化在眼窩等薄區域產生的非原始孔洞；
    // 若使用者明確設為 0 仍尊重原值，不強制膨脹模型。
    const finalSurfaceGuard = Math.min(P.shapeSoftness, 0.02);
    uniforms.uShapeSoftness.value = P.shapeSoftness * (1 - fidelityAbsorb)
      + finalSurfaceGuard * fidelityAbsorb;
    // 形狀 B 走同一條公式，只是吃自己那根滑桿。形狀變形模式沒有匯聚吸收
    // （fidelityAbsorb 恆為 0），這裡照抄同一份寫法是為了讓兩顆形狀在任何
    // 模式下的行為都一致，而不是各自有一套規則。
    const finalSurfaceGuardB = Math.min(P.shapeSoftnessB, 0.02);
    uniforms.uShapeSoftnessB.value = P.shapeSoftnessB * (1 - fidelityAbsorb)
      + finalSurfaceGuardB * fidelityAbsorb;
    uniforms.uMicroBlend.value = Math.max(
      0.02,
      (effectiveViscosity * 0.60 + P.shapeSoftness * 0.35) * mergeScale,
    );
  }

  // 每滴以速度決定慣性拉伸；斷裂後的彈性留給位移回彈與局部毛細波。
  // 不再對整顆水滴施加正負長軸振盪，避免兩滴同步橫向縮放再復原。
  for (let i = 0; i < count; i++) {
    const d = dropData[i];
    let vx = 0, vy = 0, vz = 0;
    if (frameDt > 0) {
      const prev = previousDropPositions[i];
      vx = (d.x - prev.x) / frameDt;
      vy = (d.y - prev.y) / frameDt;
      vz = (d.z - prev.z) / frameDt;
    }
    // 形狀變形跟形狀匯聚同樣用解析速度（前後各取一次位置做中央差分）而不是
    // 幀間差分：位置只是 phase 的純函式，取樣比追前一幀準，暫停／跳轉也不會
    // 因為 frameDt 亂掉而讓水滴突然被拉成一條。
    if (isFormationMotion(P.motion) || morphing) {
      const epsilon = 1 / 2048;
      if (morphing) {
        morphDropPosition(morphPairs, i, fract(phase - epsilon), formationPosBefore);
        morphDropPosition(morphPairs, i, fract(phase + epsilon), formationPosAfter);
      } else {
        formationDropPosition(i, fract(phase - epsilon), layoutCount, formationPosBefore);
        formationDropPosition(i, fract(phase + epsilon), layoutCount, formationPosAfter);
      }
      const invDelta = 1 / (epsilon * 2 * Math.max(0.001, P.loopDuration));
      vx = (formationPosAfter.x - formationPosBefore.x) * invDelta;
      vy = (formationPosAfter.y - formationPosBefore.y) * invDelta;
      vz = (formationPosAfter.z - formationPosBefore.z) * invDelta;
    }
    const speed = Math.hypot(vx, vy, vz);
    let ax = speed > 0.0001 ? vx / speed : 1;
    let ay = speed > 0.0001 ? vy / speed : 0;
    let az = speed > 0.0001 ? vz / speed : 0;
    const sizeResponse = Math.sqrt(Math.max(0.2, d.w) / 0.54);
    const tensionResistance = 0.58 + P.surfaceTension * 0.42;
    let stretch = 1 + Math.min(0.24,
      speed * 0.055 * P.inertiaDeform * sizeResponse / tensionResistance);
    let flatten = 0, shapeOscillation = 0, tip = 0, blendWeight = 1;

    if (melting) {
      // 主軸固定朝上，不用量到的速度。理由有兩個：懸掛期水滴幾乎不動，speed 趨近
      // 0 時上面那段會退化成 (1,0,0)，變成把水滴橫向拉長；而水滴重生的那一幀位置
      // 會從半空瞬移回錨點，量到的速度是個假尖峰。
      //
      // 朝上（而不是朝著墜落方向）是因為 shader 的尖端長在 +軸端，而真實懸掛水滴
      // 的頸在上方、連著造型那一側。
      ax = 0; ay = 1; az = 0;
      const deform = meltRuntime.deform(i);
      if (deform) {
        stretch = deform.stretch;
        tip = deform.tip;
        shapeOscillation = deform.wobble;
      }
    }
    dropShapeData[i].set(ax, ay, az, stretch);
    dropPhysicsData[i].set(flatten, shapeOscillation, tip, blendWeight);
    if (extended) {
      const authored = extendedMotionState[i].shape;
      if (authored) {
        const axis = authored.axis || [1, 0, 0];
        const length = Math.max(0.0001, Math.hypot(axis[0], axis[1], axis[2]));
        dropShapeData[i].set(axis[0] / length, axis[1] / length, axis[2] / length,
          Math.max(0.38, authored.stretch ?? 1));
        dropPhysicsData[i].set(authored.flatten || 0, 0, authored.tip || 0, authored.blend ?? 1);
      }
    }
  }
  for (let i = count; i < MAX_DROPS; i++) {
    dropShapeData[i].set(1, 0, 0, 1);
    dropPhysicsData[i].set(0, 0, 0, 0);
  }

  for (let i = 0; i < count; i++) previousDropPositions[i].set(dropData[i].x, dropData[i].y, dropData[i].z);
  previousDropT = t;

  updateDropBounds({
    params: P,
    count,
    dropData,
    dropShapeData,
    dropBounds,
    typewriterReach,
    hasShapeField: usesShapeField(P.motion) && !!shapeField,
    microCount,
    microDropData,
  });
}

function makeBlankEnv() {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeBlankShape() {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/* ===== 打字模式 ===== */
const {
  glyphDataTexture, makeBlankGlyphAtlas, scheduleGlyphRebuild, ensureGlyphAtlas,
  uploadGlyphAtlas, updateTypewriterUniforms, refreshTypewriterReadouts,
  broadcastLoopDuration, loadCustomFont, resetCustomFont, browseLocalFonts,
  applyTypedSystemFont,
} = createTypewriterRuntime({
  THREE,
  params: P,
  getUniforms: () => uniforms,
  requestRender: requestPausedRender,
  formatters: fmt,
});

function makeMicroDropTexture() {
  microDropTexture = new THREE.DataTexture(
    microDropData,
    MAX_MICRO_DROPS,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  microDropTexture.minFilter = microDropTexture.magFilter = THREE.NearestFilter;
  microDropTexture.wrapS = microDropTexture.wrapT = THREE.ClampToEdgeWrapping;
  microDropTexture.generateMipmaps = false;
  microDropTexture.needsUpdate = true;
  microShapeTexture = new THREE.DataTexture(
    microShapeData, MAX_MICRO_DROPS, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  microShapeTexture.minFilter = microShapeTexture.magFilter = THREE.NearestFilter;
  microShapeTexture.needsUpdate = true;
  negativeDropTexture = new THREE.DataTexture(
    negativeDropData, MAX_NEGATIVE_DROPS, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  negativeDropTexture.minFilter = negativeDropTexture.magFilter = THREE.NearestFilter;
  negativeDropTexture.needsUpdate = true;
  return microDropTexture;
}

const {
  buildRampLUT,
  buildSpectralCausticLUT,
  makeEdgeTintUniforms,
  makeRampTexture,
  makeSpectralCausticTexture,
  pageBackgroundCss,
  setBgColorUniform,
  updateEdgeTintForKey,
  updateEdgeTintPalette,
} = createMaterialTextureController({
  THREE,
  params: P,
  spectralCausticDefaults: SPECTRAL_CAUSTIC_DEFAULTS,
  getUniforms: () => uniforms,
});

function initGL() {
  if (inited) return;
  inited = true;

  // 全螢幕 shader 本身沒有多邊形鋸齒，關閉 MSAA 可省下額外 framebuffer 成本。
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(adaptiveQuality.snapshot().dpr);
  gpuProfiler = createGpuProfiler(renderer.getContext());
  // 診斷：把 renderer 剛建立時的後端記下來（此時還沒有編譯任何 program），並開始
  // 監聽 context 遺失。「這個 context 一開始就是軟體算繪」與「編譯把 GPU process
  // 打掉之後才掉下去」在事後是分不出來的，除非兩個時間點都留下紀錄。
  if (DIAG.any || DIAG_TIMING) startGlTimeline();

  pmremGenerator = new PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const fallbackEnvScene = new THREE.Scene();
  fallbackEnvScene.background = new THREE.Color(0x000000);
  pmremTarget = pmremGenerator.fromScene(fallbackEnvScene, 0.04);

  scene = new THREE.Scene();
  camera = new THREE.Camera();

  uniforms = {
    uTime:       { value: 0 },
    uLoopDuration: { value: P.loopDuration },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uRot:        { value: new THREE.Matrix3() },
    uCameraDistance: { value: P.cameraDistance },
    uTanHalfFov: { value: 0.42 },
    uCompositionOffsetX: { value: 0 },
    uCompositionOffsetY: { value: 0 },
    uMaxSteps:   { value: adaptiveQuality.snapshot().steps },
    // 這兩顆的作用都不是調整取樣數，而是讓 calcNormal 兩條法線路徑的迴圈 trip count
    // 對 fxc 保持未知，迴圈才不會被靜態展開成一份一份的 mapScene（見 shaders.js 的
    // calcNormal）。所以值恆定：四面體 4 個 tap、SVG 分軸中央差分 6 個 tap。
    uNormalTaps: { value: 4 },
    uNormalAxisTaps: { value: 6 },
    uCount:      { value: Math.round(P.count) },
    uViscosity:  { value: P.viscosity },
    uWobble:     { value: P.wobble },
    uWobbleScale: { value: P.wobbleScale },
    uWobbleSpeed: { value: P.wobbleSpeed },
    uResearchShellAmount: { value: P.researchShellAmount },
    uResearchShellSpeed: { value: P.researchShellSpeed },
    uResearchShellDensity: { value: P.researchShellDensity },
    uResearchShellTexture: { value: P.researchShellTexture },
    ...makeEdgeTintUniforms(),
    uResearchShellTint: { value: P.researchShellTint },
    uResearchShellTintEdge: { value: P.researchShellTintEdge },
    uResearchShellTintColor: { value: new THREE.Color().setStyle(
      P.researchShellTintColor, THREE.LinearSRGBColorSpace
    ) },
    uResearchBubbles: { value: P.researchBubbles ? 1 : 0 },
    uResearchBubbleCount: { value: P.researchBubbleCount },
    uResearchBubbleMin: { value: P.researchBubbleMin },
    uResearchBubbleMax: { value: P.researchBubbleMax },
    uResearchTextureDirX: { value: P.researchTextureDirX },
    uResearchTextureDirY: { value: P.researchTextureDirY },
    uResearchTextureDirZ: { value: P.researchTextureDirZ },
    uResearchIconIOR: { value: P.researchIconIOR },
    uResearchIconTint: { value: P.researchIconTint },
    uResearchIconTintEdge: { value: P.researchIconTintEdge },
    uResearchIconTintColor: { value: new THREE.Color().setStyle(
      P.researchIconTintColor, THREE.LinearSRGBColorSpace
    ) },
    uResearchIconSizeA: { value: P.researchIconSizeA },
    uResearchIconSizeB: { value: P.researchIconSizeB },
    uResearchIconTailTip: { value: P.researchIconTailTip },
    uResearchIconAspect: { value: P.researchIconAspect },
    uResearchIconSpread: { value: P.researchIconSpread },
    uResearchIconStagger: { value: P.researchIconStagger },
    uResearchIconDepth: { value: P.researchIconDepth },
    uResearchIconPhaseOffset: { value: P.researchIconPhaseOffset },
    uResearchIconBirthStagger: { value: P.researchIconBirthStagger },
    // 打字模式。字形圖集在切進這個模式時才烘（見 scheduleGlyphRebuild），在那之前
    // 綁一張 1x1 的空貼圖——取樣器一定要綁著東西，某些驅動會直接拒絕未綁定的
    // sampler，即使 runtime 永遠不會走到那個分支。
    uTypeAtlas: { value: makeBlankGlyphAtlas() },
    uTypeGlyphData: { value: glyphDataTexture },
    uTypeAtlasInfo: { value: new THREE.Vector4(1, 1, 1, 1) },
    uTypeLine: { value: new THREE.Vector4(0.6, P.typeSize, 0.22, 0) },
    uTypeShape: { value: new THREE.Vector4(P.typeDepth, P.typeBevel, P.typeGrow, 0) },
    uTypeCaret: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTypeCaretDepth: { value: P.typeCaretDepth },
    uTypeSoftness: { value: P.typeSoftness },
    uDrops:      { value: dropData },
    uDropShape:  { value: dropShapeData },
    uDropPhysics: { value: dropPhysicsData },
    uBounds:     { value: dropBounds },
    uThickness:  { value: P.thickness },
    uThickVar:   { value: P.thickVar },
    uNoiseScale: { value: P.noiseScale },
    uDispersion: { value: P.dispersion },
    uDispersionSeparation: { value: P.dispersionSeparation },
    uCausticScale: { value: P.causticScale },
    uCausticSharpness: { value: P.causticSharpness },
    uRayBeamIntensity: { value: P.rayBeamIntensity },
    uRayBeamSeparation: { value: P.rayBeamSeparation },
    uRayBeamPattern: { value: SELECTS.rayBeamPattern.map[P.rayBeamPattern] },
    uRayBeamZoom: { value: P.rayBeamZoom },
    uRayBeamRings: { value: P.rayBeamRings },
    uRayBeamSpeed: { value: P.rayBeamSpeed },
    uRayBeamGlow: { value: P.rayBeamGlow },
    uRayBeamChroma: { value: P.rayBeamChroma },
    uRayBeamAzimuth: { value: P.rayBeamAzimuth },
    uRayBeamElevation: { value: P.rayBeamElevation },
    uRayBeamRefract: { value: P.rayBeamRefract },
    uRayBeamFresnelMask: { value: P.rayBeamFresnelMask },
    uRayBeamNoiseMask: { value: P.rayBeamNoiseMask },
    uRayBeamNoiseScale: { value: P.rayBeamNoiseScale },
    uSpectralCausticIntensity: { value: P.spectralCausticIntensity },
    uSpectralCausticMapping: { value: SELECTS.spectralCausticMapping.map[P.spectralCausticMapping] },
    uSpectralCausticFocus: { value: P.spectralCausticFocus },
    uSpectralCausticWidth: { value: P.spectralCausticWidth },
    uSpectralCausticLightSize: { value: P.spectralCausticLightSize },
    uSpectralCausticDensity: { value: P.spectralCausticDensity },
    uSpectralCausticSoftness: { value: P.spectralCausticSoftness },
    uSpectralCausticFilmSoften: { value: P.spectralCausticFilmSoften },
    uSpectralCausticWarp: { value: P.spectralCausticWarp },
    uSpectralCausticSeparation: { value: P.spectralCausticSeparation },
    uSpectralCausticBounce: { value: P.spectralCausticBounce },
    uSpectralCausticFlow: { value: P.spectralCausticFlow },
    uSpectralCausticFresnelMask: { value: P.spectralCausticFresnelMask },
    uSpectralCausticNoiseMask: { value: P.spectralCausticNoiseMask },
    uSpectralCausticNoiseScale: { value: P.spectralCausticNoiseScale },
    uSpectralCausticAzimuth: { value: P.spectralCausticAzimuth },
    uSpectralCausticElevation: { value: P.spectralCausticElevation },
    uSpectralCausticHdri: { value: P.spectralCausticHdri },
    uSpectralCausticIconAffect: { value: P.spectralCausticIconAffect ? 1 : 0 },
    uSpectralCausticRamp: { value: makeSpectralCausticTexture() },
    uArtThickness: { value: P.artThickness },
    uArtThickVar: { value: P.artThickVar },
    uArtNoiseScale: { value: P.artNoiseScale },
    uArtPatternSpeed: { value: P.artPatternSpeed },
    uArtGravity: { value: P.artGravity },
    uDispersionEnabled: { value: P.dispersionEnabled ? 1 : 0 },
    uRayDispersionEnabled: { value: P.rayDispersionEnabled ? 1 : 0 },
    uSpectralCausticEnabled: { value: P.spectralCausticEnabled ? 1 : 0 },
    uFilmEnabled: { value: P.filmEnabled ? 1 : 0 },
    uFilmBlur:   { value: P.filmBlur },
    uSaturation: { value: P.saturation },
    uFresnel:    { value: P.fresnel },
    uGravity:    { value: P.gravity },
    uPatternSpeed: { value: P.patternSpeed },
    uColorMode:  { value: SELECTS.colorMode.map[P.colorMode] },
    uRampTex:    { value: makeRampTexture() },
    uBgMode:     { value: SELECTS.bgMode.map[P.bgMode] },
    uMaterialStyle: { value: SELECTS.materialStyle.map[P.materialStyle] },
    uTransparentBackground: { value: 0 },
    uLightBackdrop: { value: SELECTS.backdrop.map[P.backdrop] },
    // 直接讀 P.backdrop 字串，不透過 SELECTS.backdrop.map（那張表兩個值目前都
    // 映射成 0，見 uLightBackdrop 旁的說明）。
    uLightBgGradientEnabled: { value: P.backdrop === 'light' ? 1 : 0 },
    uLightShow:  { value: P.lightShow },
    uLightClarity: { value: P.lightClarity },
    uLightDepth: { value: P.lightDepth },
    uLightCardStrength: { value: P.lightCardStrength },
    uLightChroma: { value: P.lightChroma },
    uLightIconColor: { value: new THREE.Color().setStyle(P.lightIconColor, THREE.LinearSRGBColorSpace) },
    uLightIconClarity: { value: P.lightIconClarity },
    uLightIconTint: { value: P.lightIconTint },
    uLightIconEdge: { value: P.lightIconEdge },
    uLightIconRimColor: { value: new THREE.Color().setStyle(P.lightIconRimColor, THREE.LinearSRGBColorSpace) },
    uLightIconRimStrength: { value: P.lightIconRimStrength },
    uBgColor:    { value: new THREE.Color().setStyle(P.bgColor, THREE.LinearSRGBColorSpace) },
    uLightBgGradientTop: { value: new THREE.Color().setStyle(P.lightBgGradientTop, THREE.LinearSRGBColorSpace) },
    uLightBgGradientBottom: { value: new THREE.Color().setStyle(P.lightBgGradientBottom, THREE.LinearSRGBColorSpace) },
    uMembraneBaseColor: { value: new THREE.Color(P.membraneBaseColor) },
    uMembraneVeilColor: { value: new THREE.Color(P.membraneVeilColor) },
    uMembraneReflectionColor: { value: new THREE.Color(P.membraneReflectionColor) },
    uMembraneCardColor: { value: new THREE.Color(P.membraneCardColor) },
    uMembraneShadeColor: { value: new THREE.Color(P.membraneShadeColor) },
    uEnvRefraction: { value: P.envRefraction },
    uReflect:    { value: P.reflect },
    uTransmission: { value: P.transmission },
    uHdrOutput: { value: 0 },
    uCoverageAlpha: { value: 0 },
    uHighlightGain: { value: 1 },
    uAbsorb: { value: P.absorb },
    uAbsorbColor: { value: new THREE.Color().setStyle(P.absorbColor, THREE.LinearSRGBColorSpace) },
    uMaterialExposure: { value: P.materialExposure },
    uMembraneDepth: { value: P.membraneDepth },
    uRoughness:  { value: P.roughness },
    uIOR:        { value: P.ior },
    uReflectionSampleCount: { value: adaptiveQuality.snapshot().reflectionSamples },
    uHdriYaw:    { value: P.hdriYaw },
    uHdriPitch:  { value: P.hdriPitch },
    uHdriBlur:   { value: P.hdriBlur },
    uEnvMap:     { value: makeBlankEnv() },
    uPmremMap:   { value: pmremTarget.texture },
    uHasEnv:     { value: 0 },
    uShapeType: { value: SELECTS.shapeSource.map[P.shapeSource] },
    uShapeProgress: { value: 0 },
    // 可插拔形狀互動模式：模式編號、專屬參數與三軸波向。SVG 與 GLB 共用同一個
    // 表面距離偏移，所以兩種匯入來源行為一致。
    uExtendedMotion: { value: 0 },
    uExtendedParams: { value: new THREE.Vector4() },
    uCapillaryStyle: { value: new THREE.Vector4() },
    uCapillaryDirection: { value: new THREE.Vector3(0, 0, 1) },
    uFidelityAbsorb: { value: 0 },
    // 崩解噴濺的蓄力膨脹量（等距擴張形狀距離場）；其他模式恆為 0。
    uShapeSwell: { value: 0 },
    // 形狀變形的雙形狀切削（見 shaders.js 的 uShapeMorph／uShapeCut）。
    // 0 是關閉，其餘模式一律維持 0，走原本的單一形狀路徑。
    uShapeMorph: { value: 0 },
    uShapeCut: { value: new THREE.Vector4(1, 0, 0, 0) },
    // 形狀匯聚的成型波前開關（見 shaders.js 的 uFormationCut）。
    uFormationCut: { value: 0 },
    uShapeCutBlend: { value: 0.08 },
    // 消失方式。uMorphBreak 與 uMorphNecking 各自把兩個滑桿打包成一個 uniform，
    // 因為它們一定成對使用（幅度沒開時尺度沒有意義），拆開只是多兩個 uniform。
    //
    // 名字刻意不叫 uMorphNeck：滑桿的 uniform 名是「u + key 首字大寫」自動推導
    // 的，morphNeck 這個滑桿會推導出 uMorphNeck，於是每幀把這顆打包用的
    // Vector2 直接覆寫成一個數字，下一次 .set() 就炸了。打包型 uniform 的名字
    // 一律要避開所有滑桿 key 推導得出的名稱。
    uMorphFront: { value: 0 },
    uMorphSpiral: { value: 1 },
    uMorphBreak: { value: new THREE.Vector4(0.6, 1.5, 0, 4) },
    uMorphNecking: { value: new THREE.Vector2(0.12, 0.55) },
    uMorphActive: { value: new THREE.Vector2(1, 1) },
    uMembraneOverWhite: { value: 0 },
    uShapeScale: { value: 1 },
    uShapeAScale: { value: 1 },
    uShapeBScale: { value: 1 },
    // 造型剛體動態（見 motions/shapeRigid.js）。未啟用時維持單位變換。
    // cache-bust 用（見 shaders.js 的 SHADER_RUN）。永遠是 0，只是讓
    // float(SHADER_RUN) * uShaderSalt 這個乘法無法在編譯期被折掉。
    uShaderSalt: { value: 0 },
    uShapeRigidRot: { value: new THREE.Matrix3() },
    uShapeRigidOffset: { value: new THREE.Vector3() },
    uShapeRigidScale: { value: new THREE.Vector3(1, 1, 1) },
    uShapeRigid2Rot: { value: new THREE.Matrix3() },
    uShapeRigid2Offset: { value: new THREE.Vector3() },
    uShapeRigid2Scale: { value: new THREE.Vector3(1, 1, 1) },
    // contactLead（形狀在已抵達水滴附近先成形）是形狀匯聚專用的邏輯。崩解噴濺
    // 是它的反向過程，同一條規則會變成「形狀黏著碎片不肯消失、碎片之間先溶掉」，
    // 在輪廓上結出一顆顆瘤；融化則是形狀從頭到尾完整，沒有「先成形」可言，只剩
    // 隨水滴掃過的整片漲縮。用這個 0/1 開關在那兩個模式關掉它。
    uContactLead: { value: 1 },
    uStaticShape: { value: P.staticShape },
    uBoxSize: { value: P.boxSize },
    uBoxCornerRadius: { value: P.boxCornerRadius },
    uPrimitiveSize: { value: P.primitiveSize },
    uPrimitiveHeight: { value: P.primitiveHeight },
    uPrimitiveTubeRatio: { value: P.primitiveTubeRatio },
    uShapeDepth: { value: P.shapeDepth },
    uShapeSoftness: { value: P.shapeSoftness },
    uShapeSoftnessB: { value: P.shapeSoftnessB },
    uShapeEdgeBevel: { value: P.shapeEdgeBevel },
    uShapeLiquid: { value: P.shapeLiquid },
    uShapeLiquidSize: { value: P.shapeLiquidSize },
    uShapeLiquidSpeed: { value: P.shapeLiquidSpeed },
    uEdgeDropCount: { value: 0 },
    uEdgeDrops: { value: edgeDropData },
    uEdgeMotion: { value: edgeMotionData },
    uShapeTex: { value: makeBlankShape() },
    uShapeGrid: { value: 0 },
    uShapeAtlas: { value: new THREE.Vector2(1, 1) },
    uMicroDrops: { value: makeMicroDropTexture() },
    uMicroShape: { value: microShapeTexture },
    uMicroCount: { value: 0 },
    uMicroBlend: { value: 0.02 },
    uNegativeDrops: { value: negativeDropTexture },
    uNegativeCount: { value: 0 },
  };

  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    // 基線探針換成獨立的最小 shader；其餘一切（renderer、camera、scene、uniforms、
    // 全螢幕 mesh、PMREM 環境貼圖）都維持原樣，這樣測到的才是 GLSL 本身。
    fragmentShader: usesBaselineShader() ? FRAG_BASELINE : FRAG,
    defines: shaderFeatures(),
    depthTest: false, depthWrite: false,
  });
  // 讓 Three.js 依 PMREM atlas 尺寸注入 CubeUV shader 常數。
  mat.envMap = pmremTarget.texture;
  variantCache.set(variantKey(), mat);
  activeVariantKey = variantKey();
  // 面板還原比 initGL 早，字形圖集可能已經烘好但還沒有 uniform 可以綁。
  uploadGlyphAtlas();
  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  updateDropUniforms(0);
  resize();
  window.addEventListener('resize', resize);
  if (!PREVIEW) bindPointer();
  syncPanelToUniforms();
  loadMaterialEnvironment(P.materialStyle);
  if (DIAG.any && !DIAG_TIMING) requestAnimationFrame(() => window.__bubbleDiagReport());
}

function resize() {
  if (!renderer) return;
  // DevTools 裝置模式有時會保留較大的 layout viewport（window.innerWidth），
  // 但 documentElement client size 才是使用者實際看到的裝置畫面。
  const w = Math.max(1, canvas.clientWidth || document.documentElement.clientWidth);
  const h = Math.max(1, canvas.clientHeight || document.documentElement.clientHeight);
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);
}

// 每一幀的步數上限。舊版在 refreshRenderQuality 裡也算過一份，但那份每幀都被
// frame() 覆寫掉，等於死碼；而 frame() 的 formation 分支又漏看了 dragging，
// 於是 Formation 模式拖曳時完全沒有降級。現在只有這一個決策點。
function resolveMaxSteps() {
  // 診斷：只壓 raymarch 主迴圈步數，其他視覺設定一概不動。
  if (DIAG.lowsteps) return 32;
  // 多水滴 + 形狀場會增加每一步的取樣成本；60 步仍足以覆蓋保守包圍球，
  // 並避免高 DPR 桌面在 Formation 模式失去即時預覽能力。
  const qualitySteps = adaptiveQuality.snapshot().steps;
  if (usesShapeField(P.motion)) return Math.min(qualitySteps, dragging ? 48 : 60);
  return dragging ? Math.min(qualitySteps, 56) : qualitySteps;
}

/* ===== 省電節流與自動品質 ===== */
// 30fps：主迴圈把 dt 夾在 0.05 秒，影格間隔一旦超過它，動畫就會開始「變慢」而不
// 只是「變頓」（因為每幀推進的時間被截掉）。30fps 的間隔是 0.033 秒還在安全範圍，
// 再往下就得先把那個夾值一起改，所以停在這裡。
const POWER_SAVE_FPS = 30;
// 主迴圈的 dt 上限（Math.min(..., 0.05)）換算成毫秒。超過它的影格間隔會被截掉，
// 動畫就會慢下來，所以節流必須自己避開這條線。
const DT_CLAMP_MS = 50;
const POWER_SAVE_INTERVAL = 1000 / POWER_SAVE_FPS;
// 停手多久算閒置。太短會在「調完一個滑桿、正在看效果」時就降頻，那一刻其實最需要
// 流暢；4 秒足夠跨過調參數的空檔。
const IDLE_DELAY_MS = 4000;
let lastInteractionAt = performance.now();
let lastRenderedAt = 0;
let windowFocused = true;
let powerSaveThrottled = false;

function markInteraction() {
  lastInteractionAt = performance.now();
}
// 判準只有一條：這個動作會不會改變畫面。會，才算互動。
//
// 依這條剔除掉的：
//   pointermove —— 游標移過或停在畫面上什麼都沒改變。收了的話滑鼠放著不動就會
//     一直把計時歸零，節流等於沒做。
//   wheel —— 看起來該收，但掛在 window 上連捲動參數面板都會觸發，而捲面板完全
//     不改變畫面。畫布上的滾輪縮放不需要它：那個處理本身就會改「鏡頭距離」滑桿
//     並發出 input（見下方 canvas 的 wheel 處理），已經被 input 蓋到了。
//   keydown —— 同理，用鍵盤捲面板不該喚醒；真正會改變畫面的按鍵（快捷暫存）
//     套用參數時一樣會發 input。
//
// 留下的：input/change 涵蓋所有控制項；click 涵蓋按鈕（播放暫停、匯入、快捷
// 暫存），捲動不會產生 click 所以不會誤觸。
if (!PREVIEW) {
  for (const type of ['input', 'change', 'click']) {
    window.addEventListener(type, markInteraction, { passive: true, capture: true });
  }
  window.addEventListener('focus', () => { windowFocused = true; markInteraction(); });
  window.addEventListener('blur', () => { windowFocused = false; });
}

// 回傳「這一幀該不該跳過」。拖曳中與輸出中一律不節流：前者是最需要即時回饋的
// 時候，後者根本不是給人看的（逐幀離線算繪，跳幀會漏影格）。
// 預覽 iframe 也排除——preview-performance.js 已經用自己那套 fps/DPR 節流接管了
// requestAnimationFrame，兩套疊在一起只會互相干擾。
function shouldSkipFrame(now) {
  powerSaveThrottled = false;
  if (PREVIEW || isExporting() || dragging) return false;
  const idle = now - lastInteractionAt > IDLE_DELAY_MS;
  if (!idle && windowFocused) return false;
  powerSaveThrottled = true;
  const sinceRendered = now - lastRenderedAt;
  // 絕不讓實際間隔超過主迴圈夾住 dt 的那個上限。60Hz 螢幕上跳一幀是 33ms、沒問題，
  // 但 30Hz 螢幕上跳一幀就變成 66ms，超過 0.05 秒的夾值之後每幀被截掉的時間會讓
  // 動畫真的變慢（不只是變頓），循環長度也就對不上了。寧可在低更新率的螢幕上
  // 不節流，也不能改變動畫速度。
  if (sinceRendered >= DT_CLAMP_MS - 5) return false;
  // 減 1ms 的寬容：影格時間不會剛好整除，嚴格比較會固定漏掉一幀變成 20fps。
  return sinceRendered < POWER_SAVE_INTERVAL - 1;
}

function refreshRenderQuality() {
  if (!renderer || !uniforms) return;
  const quality = adaptiveQuality.snapshot();
  uniforms.uReflectionSampleCount.value = quality.reflectionSamples;
  const interactionDpr = dragging ? Math.min(quality.dpr, quality.minDpr) : quality.dpr;
  if (Math.abs(renderer.getPixelRatio() - interactionDpr) > 0.01) {
    renderer.setPixelRatio(interactionDpr);
    resize();
  }
}

function setQualityTier(nextTier) {
  adaptiveQuality.setTier(nextTier);
}

// 使用者手動選的超取樣倍率套進 deviceMaxDpr。全螢幕 raymarch shader 沒有多邊形
// 邊緣，MSAA 幫不上忙（見 initGL 建立 renderer 時關閉 antialias 的說明）；唯一能
// 消鋸齒的手段就是把渲染解析度拉高過顯示解析度，讓瀏覽器把畫面縮小回去時順便
// 平滑掉——這正是 renderer.setPixelRatio 在做的事，這裡只是讓使用者自己決定
// 倍率，而不是被 devicePixelRatio 和寫死的 1.5／2 上限卡死。
//
// 自動品質會在這個新上限之下繼續運作；各層 DPR 都依新倍率重算。
function applyAntialiasLevel() {
  if (DIAG.lowres || PREVIEW) return; // 這兩個場景一律鎖最省資源那一路，不給覆寫
  const multiplier = SELECTS.antialiasLevel.map[P.antialiasLevel] ?? 1;
  const maxRenderDpr = deviceMaxDpr * multiplier;
  const minRenderDpr = Math.min(maxRenderDpr, 1.25 * multiplier);
  adaptiveQuality.updateLimits(maxRenderDpr, minRenderDpr);
}

function sampleRenderQuality(now) {
  // 編譯、拖曳、離線輸出與省電節流都有刻意的停頓或品質調整，不能拿來推斷 GPU
  // 的持續算繪能力。尤其 shader 背景切換若混進樣本，會在剛切模式時錯降一級。
  adaptiveQuality.sample(now, {
    blocked: powerSaveThrottled || dragging || isExporting() || shapeConverting || variantSwapInFlight,
  });
}

/* ===== 拖曳旋轉 ===== */
function bindPointer() {
  // 拖曳旋轉的互動標記只掛在畫布上：拖曳中本來就不節流，這裡真正的目的是讓
  // 放開手之後有一段緩衝——慣性旋轉還會滑行一小段，那段需要維持流暢。
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
    canvas.addEventListener(type, markInteraction, { passive: true });
  }
  canvas.addEventListener('pointerdown', e => {
    if (activeCanvasPointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !e.isPrimary) return;
    activeCanvasPointerId = e.pointerId;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.dataset.dragging = 'true';
    canvas.setPointerCapture(e.pointerId);
    refreshRenderQuality();
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== activeCanvasPointerId) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    rot.y = Math.max(-Math.PI, Math.min(Math.PI, rot.y + dx * 0.006));
    rot.x = Math.max(-1.2, Math.min(1.2, rot.x + dy * 0.006));
    const rotationX = document.getElementById('cameraRotationX');
    const rotationY = document.getElementById('cameraRotationY');
    if (rotationX) { rotationX.value = (rot.x * 180 / Math.PI).toFixed(1); rotationX.dispatchEvent(new Event('input', { bubbles: true })); }
    if (rotationY) { rotationY.value = (rot.y * 180 / Math.PI).toFixed(1); rotationY.dispatchEvent(new Event('input', { bubbles: true })); }
    vel.y = dx * 0.006; vel.x = dy * 0.006;
  });
  const end = e => {
    if (e.pointerId !== activeCanvasPointerId) return;
    dragging = false;
    activeCanvasPointerId = null;
    delete canvas.dataset.dragging;
    refreshRenderQuality();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const el = document.getElementById('cameraDistance');
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const next = Math.min(max, Math.max(min, parseFloat(el.value) + e.deltaY * 0.003));
    el.value = next.toFixed(2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });
}

/* ===== 面板綁定 ===== */
// 若 GL 尚未建立（預覽暫停中），把當前 P 推進 uniforms
function syncPanelToUniforms() {
  if (!uniforms) return;
  for (const key of Object.keys(DEFAULTS)) {
    const u = uniformNameFor(key);
    if (uniforms[u]) uniforms[u].value = (key === 'count') ? Math.round(P[key]) : P[key];
  }
  for (const key of Object.keys(SELECTS)) {
    const u = uniforms[SELECTS[key].uniform];
    if (u) u.value = SELECTS[key].map[P[key]];
  }
  uniforms.uLightBgGradientEnabled.value = P.backdrop === 'light' ? 1 : 0;
  for (const key of Object.keys(TOGGLES)) applyToggle(key);
  for (const key of Object.keys(COLORS)) {
    if (!COLORS[key]) continue;
    if (key === 'bgColor') setBgColorUniform(P[key]);
    // 吸收色不是「一道光的顏色」而是「每個通道剩下多少」的比例，所以要的是選色
    // 器上那三個原始數值，不能讓 three 的色彩管理把它當 sRGB 轉成線性（那會把
    // 比例整個扭掉）。同 uBgColor 的作法。
    else if (key === 'absorbColor' || key === 'researchIconTintColor'
      || key === 'researchShellTintColor'
      || key === 'lightIconColor' || key === 'lightIconRimColor'
      || key === 'lightBgGradientTop' || key === 'lightBgGradientBottom') {
      uniforms[COLORS[key]].value.setStyle(P[key], THREE.LinearSRGBColorSpace);
    }
    else uniforms[COLORS[key]].value.set(P[key]);
  }
  EDGE_TINT_TARGETS.forEach(updateEdgeTintPalette);
  document.body.style.background = (P.bgMode === 'hdri') ? '#000' : pageBackgroundCss(P.bgColor);
}

// 把「匯集時間／完成停留」換算回具體秒數並列出散開段，讓使用者一次看到循環
// 秒數怎麼被這三段分配掉——這三個數字本身就是 formationAmount 用來畫時間軸
// 的同一組邊界，這裡只是把它們攤開顯示，不影響實際計算。
function updateTimelineSummary() {
  const el = document.getElementById('timelineSummary');
  if (!el) return;
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  const loop = P.loopDuration;
  const gatherSec = gatherEnd * loop;
  const holdSec = (holdEnd - gatherEnd) * loop;
  const releaseSec = (1 - holdEnd) * loop;
  el.textContent = `匯集 ${gatherSec.toFixed(1)}s → 停留 ${holdSec.toFixed(1)}s → 散開 `
    + `${releaseSec.toFixed(1)}s（循環共 ${loop.toFixed(1)}s）`;
}

function saveMaterialProfile(style) {
  if (!materialProfiles[style]) return;
  materialProfiles[style] = pickMaterialProfile(P);
}

function applyMaterialProfile(style) {
  const profile = materialProfiles[style];
  if (!profile) return;
  for (const key of MATERIAL_PROFILE_KEYS) {
    const el = document.getElementById(key);
    if (!el || profile[key] === undefined) continue;
    el.value = String(profile[key]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function switchMaterialProfile(previousStyle, nextStyle) {
  if (previousStyle === nextStyle || !materialProfiles[nextStyle]) return;
  saveMaterialProfile(previousStyle);
  applyMaterialProfile(nextStyle);
  if (inited) loadMaterialEnvironment(nextStyle);
}

const {
  bindTextControls, bindControls, resetSpectralCausticColors, resetRamp, updateRampRows,
} = createPanelBindings({
  THREE, params: P, preview: PREVIEW, selects: SELECTS, toggles: TOGGLES, colors: COLORS,
  formatters: fmt, getUniforms: () => uniforms, uniformNameFor, rotation: rot,
  motionMemoryKeys: MOTION_MEMORY_KEYS, getMotionMemory: () => motionMemory, memorySlot,
  applyEdgeDropDistribution, scheduleShapeAScaleRebuild, scheduleShapeBScaleRebuild,
  refreshCapillaryHeightReadout, updateEdgeTintForKey, buildSpectralCausticLUT,
  applyGates: (...args) => applyGates(...args), syncShaderVariant, ensureShapeForCurrentSource,
  refreshShatterTimelineReadouts, shatterTimelineKeys: SHATTER_TIMELINE_KEYS,
  refreshTypewriterReadouts, typeTimelineKeys: TYPE_TIMELINE_KEYS, updateTimelineSummary,
  refreshLoopScaledReadouts, requestPausedRender, switchMaterialProfile, applyMemorySlots,
  backdropMemoryKeys: BACKDROP_MEMORY_KEYS, resetPreviousDropT: () => { previousDropT = null; },
  isInited: () => inited, loadMaterialEnvironment, updateUIState: (...args) => updateUIState(...args),
  scheduleGLBRebuild, applyAntialiasLevel, ensureGlyphAtlas, applyToggle,
  getDispersionMaster: () => dispersionMasterOn,
  setDispersionMaster: value => { dispersionMasterOn = value; },
  dispersionToggleKeys: DISPERSION_TOGGLE_KEYS, setBgColorUniform, pageBackgroundCss,
  scheduleGlyphRebuild, buildRampLUT, stopMax: STOP_MAX, rampDefault: RAMP_DEFAULT,
});

const { applyGates, updateUIState } = createPanelStateController({
  params: P,
  staticUsesImportedShape,
  pageBackgroundCss,
  getDispersionMaster: () => dispersionMasterOn,
  refreshInspector: () => inspector?.refresh(),
});

document.getElementById('resetBtn').addEventListener('click', () => {
  // 重設不換動態模式：按重設是想把「現在這個模式」的參數歸零，不是想被丟回
  // 分裂模式再自己切回來。
  const motion = P.motion;
  const backdrop = P.backdrop;
  Object.assign(P, DEFAULTS, MOTION_TEXT_DEFAULTS, SELECT_DEFAULTS, TOGGLE_DEFAULTS, COLOR_DEFAULTS);
  P.motion = motion;
  P.backdrop = backdrop;
  resetMaterialProfiles();
  if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
  motionMemory = buildMotionMemory();
  for (const mode of MOTION_KEYS) {
    if (motionMemory.spectralCausticFocus) motionMemory.spectralCausticFocus[`${mode}|dark`] = 1.0;
    if (motionMemory.spectralCausticSeparation) motionMemory.spectralCausticSeparation[`${mode}|dark`] = 1.0;
    if (motionMemory.transmission) motionMemory.transmission[`${mode}|light`] = 0.97;
    if (motionMemory.absorb) motionMemory.absorb[`${mode}|light`] = 1.35;
    if (motionMemory.envRefraction) motionMemory.envRefraction[`${mode}|light`] = 0.025;
    if (motionMemory.fresnel) motionMemory.fresnel[`${mode}|light`] = 0.12;
    if (motionMemory.rayDispersionEnabled) motionMemory.rayDispersionEnabled[`${mode}|light`] = false;
    if (motionMemory.bloomEnabled) motionMemory.bloomEnabled[`${mode}|light`] = false;
    if (motionMemory.streaksEnabled) motionMemory.streaksEnabled[`${mode}|light`] = false;
  }
  // 每個模式各自記憶的那幾項（顆數／滴徑／循環秒數／前後拉伸／擠出外觀）要套用
  // 「這個模式」的預設，不能停在共用預設上。共用預設是給分裂模式用的數字——
  // 例如循環 12 秒、顆數 2，留在形狀變形上就完全不對。
  //
  // 平常這件事是由模式切換的處理去做的，但這裡刻意不換模式，那條路徑不會觸發，
  // 所以得自己補。
  for (const key of MOTION_MEMORY_KEYS) P[key] = motionMemory[key][memorySlot(key, motion)];
  resetSpectralCausticColors();
  resetRamp();
  bindControls();
  bindTextControls();
  // 文字被還原成預設，字形圖集得跟著重烘（bindTextControls 只同步 DOM）。
  ensureGlyphAtlas(true);
  if (inited) loadMaterialEnvironment('universal');
});

// 離開效果頁後，下一次從首頁進入應從乾淨的預設狀態開始；
// 手動匯出／匯入的 JSON 不受影響，只清除 PresetIO 的自動保存快照。
const homeButton = document.getElementById('homeBtn');
const clearAutoSavedPreset = () => {
  try { localStorage.removeItem('vfx:prism-drops:last'); } catch (_) {}
};
homeButton?.addEventListener('click', clearAutoSavedPreset);
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    if (stagePresentTimer) { clearTimeout(stagePresentTimer); stagePresentTimer = 0; }
    stagePresented = false;
    delete document.body.dataset.stageReady;
    clearAutoSavedPreset();
    document.getElementById('resetBtn')?.click();
  }
});

/* ===== HDRI 載入（動態 import，離線也不會弄壞主程式）===== */
const hdriInput = document.getElementById('hdriInput');
const hdriState = document.getElementById('hdriState');
const { loadEnvironment } = createEnvironmentLoader({
  THREE,
  getPmremGenerator: () => pmremGenerator,
  getUniforms: () => uniforms,
  getPmremTarget: () => pmremTarget,
  setPmremTarget: target => { pmremTarget = target; },
  getVariantMaterials: () => variantCache.values(),
  onVariantChange: syncShaderVariant,
  onSettled: settleEnv,
  stateElement: hdriState,
});

function loadMaterialEnvironment(style = P.materialStyle) {
  // 優先序：使用者自己匯入的 > 這個動態模式指定的 > 材質類型的預設。
  // 模式指定的排在使用者之後，是因為它只是預設 —— 匯入了自己的 HDRI 還被模式
  // 蓋掉，那顆匯入按鈕在該模式下就等於壞的。
  //
  // 「使用者匯入的」要看 file，不能只看 materialEnvironments[style] 有沒有值：
  // 那張表在 resetMaterialProfiles 就先填好了材質類型的預設，永遠是真的。
  const environment = selectMaterialEnvironment({
    style,
    motion: P.motion,
    materialEnvironments,
    defaults: MATERIAL_ENVIRONMENT_DEFAULTS,
    motionEnvironment: motionEnvironmentFor,
  });
  if (environment.file) {
    const url = URL.createObjectURL(environment.file);
    loadEnvironment(url, environment.label, environment.isHDR, true);
  } else {
    loadEnvironment(environment.url, environment.label, environment.isHDR);
  }
}

document.getElementById('hdriBtn').addEventListener('click', () => hdriInput.click());
hdriInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!inited) initGL();
  materialEnvironments[P.materialStyle] = {
    url: '',
    label: file.name,
    isHDR: /\.hdr$/i.test(file.name),
    file,
  };
  loadMaterialEnvironment(P.materialStyle);
  e.target.value = '';
});

/* ===== SVG / GLB 形狀距離場 ===== */
const shapeInput = document.getElementById('shapeInput');
const shapeState = document.getElementById('shapeState');
let shapeConverting = false;
let lastGLBFile = null;
let shapeImportRequestId = 0;
let shapeRebuildTimer = 0;
// 目前 shapeField 是由哪個來源烘出來的。切換「形狀來源」時用它判斷是否需要
// 重新烘焙 —— 舊版切到 GLB 但沒選檔案，畫面仍是上一個 SVG 的距離場。
let shapeFieldSource = null;
// 烘焙途中要求換來源時記在這裡，等當前烘焙結束再補做。
let shapeEnsurePending = false;
// 正在烘焙中的那一份「將會」產出什麼來源／哪個內建變體。
//
// 這兩個值存在的理由是一個實際踩到的 bug：shapeFieldSource 與 builtinSvgVariant
// 都只在烘焙成功「之後」才更新，所以烘焙途中它們描述的是上一份。GLB 128³ 要烘
// 十幾秒，這段期間使用者把來源切回 SVG，ensureShapeForCurrentSource 拿
// shapeFieldSource（還是 'svg'）跟 P.shapeSource（'svg'）比，得到「沒變，不用
// 做事」就直接返回 —— 既沒有立刻重烘，也沒有記下待辦。等 GLB 烘完蓋上去之後，
// 就再也沒有任何東西會把它糾正回 SVG：下拉選單顯示 SVG、畫面是 GLB 的形狀、
// 狀態文字停在 GLB 那一行，而且不會自己恢復。
//
// 所以判斷「目前是什麼」時，烘焙途中要看這一份即將產出的結果，而不是已載入的。
let shapeImportingKind = null;
let shapeImportingVariant = null;
// 使用者自己匯入的檔案，依來源分開記住。有記錄就不再套用內建預設。
const userShapeFiles = { svg: null, gltf: null };
// 目前載入的內建 SVG 展示形狀是哪一版（'default' 問號／'melt' 冰塊）。只有在
// 使用者還沒自己匯入 SVG 時才有意義；匯入真正的檔案後這個值不再更新，
// ensureShapeForCurrentSource 也不會再拿它跟模式比對。
let builtinSvgVariant = null;
document.getElementById('shapeBtn').addEventListener('click', () => shapeInput.click());

/* ===== 打字模式：匯入字體的按鈕綁定 ===== */
{
  const fontBtn = document.getElementById('typeFontBtn');
  const fontInput = document.getElementById('typeFontInput');
  const fontResetBtn = document.getElementById('typeFontResetBtn');
  if (fontBtn && fontInput) {
    fontBtn.addEventListener('click', () => fontInput.click());
    fontInput.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) loadCustomFont(file);
    });
  }
  if (fontResetBtn) fontResetBtn.addEventListener('click', resetCustomFont);

  const systemFontInput = document.getElementById('typeSystemFontInput');
  const systemFontBtn = document.getElementById('typeSystemFontBtn');
  if (systemFontInput && systemFontBtn) {
    systemFontBtn.addEventListener('click', applyTypedSystemFont);
    // Enter 直接套用，不用特地點按鈕——這顆輸入框旁邊沒有其他會被 Enter
    // 意外觸發的控制項，跟表單提交無關（面板本來就不是 <form>）。
    systemFontInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyTypedSystemFont(); });
  }

  const browseBtn = document.getElementById('typeLocalFontBrowseBtn');
  if (browseBtn) browseBtn.addEventListener('click', browseLocalFonts);
}

/* ===== 形狀 B（變形目標）的匯入 ===== */
const morphTargetInput = document.getElementById('morphTargetInput');
document.getElementById('morphTargetBtn')
  .addEventListener('click', () => morphTargetInput.click());
morphTargetInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  morphTargetFiles[P.shapeSource] = file;
  // 重烘由 ensureMorphTarget 在下一幀認出 key 變了自己接手，這裡不直接呼叫——
  // 形狀 A 可能正在烘，那時候開第二份只會互相拖慢（見 ensureMorphTarget）。
  morphTargetPending = null;
});
document.getElementById('morphTargetResetBtn').addEventListener('click', () => {
  morphTargetFiles[P.shapeSource] = null;
  morphTargetPending = null;
});

// 「模型品質」是體素化的網格解析度，只有 GLB 這條路用得到（SVG 走的是解析式
// 距離場，跟網格無關，所以那個下拉本來就 data-gate="glb"）。
//
// 內建展示造型（importShapeFile 的 file = null）同樣是用同一個 glbGridSize 烘
// 出來的，所以沒有匯入自己的檔案時一樣要重烘。這裡原本卡了一個 `!lastGLBFile`
// 的提前 return，於是「還沒匯入模型就切品質」完全沒有任何反應——而那正是使用者
// 最先會遇到的情況（切到 GLB 來源時看到的就是內建造型）。
function scheduleGLBRebuild() {
  if (P.shapeSource !== 'gltf') return;
  // 靜態模式選內建幾何時根本沒有形狀場，烘出來也沒人看得到。
  if (!staticUsesImportedShape()) return;
  clearTimeout(shapeRebuildTimer);
  // 立刻使正在進行的舊品質結果失效；短暫 debounce 避免快速連切時重複開工。
  shapeImportRequestId++;
  const grid = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  const qualityLabel = document.querySelector('#shapeQuality option:checked')?.textContent
    || `${grid}³`;
  shapeState.textContent = `品質已切換，準備重新生成 ${qualityLabel}…`;
  shapeRebuildTimer = window.setTimeout(() => {
    // lastGLBFile 為 null 時走內建造型那條路（見 importShapeFile 的 builtin），
    // 兩種來源都會用當下的 glbGridSize 重新體素化。
    importShapeFile(lastGLBFile, 'gltf', { rebuilding: true });
  }, 160);
}

// file 為 null 代表套用內建預設造型（SVG 內嵌字串／3D 程式生成的環形）。
async function importShapeFile(file, kind, { rebuilding = false } = {}) {
  if (!inited) initGL();
  const requestId = ++shapeImportRequestId;
  // 每個模式各自預設的內建 SVG 展示形狀（見 motions/registry.js 的 svgDemo）。
  // 只在還沒匯入真正檔案時採用；GLB 沒有這個分歧，一律是內建環形。
  const svgVariant = MOTION_SVG_DEMO[P.motion] || 'question';
  const glbGridSize = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  const { builtin, label, status } = describeShapeImport({
    file,
    kind,
    svgVariant,
    gridSize: glbGridSize,
    rebuilding,
    defaultSvgName: DEFAULT_SVG_NAME,
    meltSvgName: MELT_DEFAULT_SVG_NAME,
    defaultSolidName: DEFAULT_SOLID_NAME,
  });
  shapeState.textContent = status;
  document.getElementById('shapeBtn').disabled = true;
  document.getElementById('shapeQuality').disabled = true;
  shapeConverting = true;
  shapeImportingKind = kind;
  shapeImportingVariant = (builtin && kind === 'svg') ? svgVariant : null;
  syncLoop();
  try {
    const next = await loadShapeAsset({
      file,
      kind,
      svgVariant,
      gridSize: glbGridSize,
      mobile: mobileRenderQuery.matches,
      svgToField,
      gltfToField,
      objectToField,
      makeDefaultSvgFile,
      makeMeltDemoSvgFile,
      buildDefaultSolid,
    });
    if (requestId !== shapeImportRequestId) {
      next.texture?.dispose();
      return;
    }
    const old = shapeField?.texture;
    shapeField = next;
    shapeFieldSerial++;
    shapeTargetsBase = next.targets;
    shapeCavityBase = next.cavityTargets || [];
    rebuildShapeAAnchors();
    // key 帶著 shapeFieldSerial，換形狀後下一幀就會重挑滴落點／重配變形配對。
    meltRuntime.resetAnchors();
    morphPairKey = null;
    applyEdgeDropDistribution(P.shapeLiquidPosition);
    uniforms.uShapeTex.value = next.texture;
    uniforms.uShapeGrid.value = next.grid;
    uniforms.uShapeAtlas.value.copy(next.atlas);
    uniforms.uShapeType.value = kind === 'svg' ? 1 : 2;
    if (old) old.dispose();
    shapeFieldSource = kind;
    // 只有 SVG 內建預設需要記；真正匯入的檔案或 GLB 都跟這個分歧無關，
    // 清成 null 讓 ensureShapeForCurrentSource 不會拿舊版本比對。
    builtinSvgVariant = (builtin && kind === 'svg') ? svgVariant : null;
    // 只有在還停在不需要形狀場的模式時才強制跳過去；已經在「形狀匯聚」
    // 「穿梭環繞」「崩解噴濺」任何一個都保持原模式，不要互相搶。
    if (!usesShapeField(P.motion)) {
      const motionEl = document.getElementById('motion');
      motionEl.value = 'formation';
      motionEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    simT = 0;
    const topologyNote = kind === 'gltf' && next.oddScanlines > 0
      ? `；已修復 ${next.oddScanlines} 條非封閉掃描線`
      : '';
    const qualityNote = kind === 'gltf' ? `；${glbGridSize}³` : '';
    const builtinNote = builtin ? '（內建預設，可自行匯入取代）' : '';
    shapeState.textContent = `${kind === 'svg' ? 'SVG' : '3D 模型'} 已就緒：${label}${qualityNote}${topologyNote}${builtinNote}`;
  } catch (error) {
    if (requestId !== shapeImportRequestId) return;
    console.error(error);
    shapeState.textContent = `轉換失敗：${error.message || '檔案格式不支援'}`;
  } finally {
    if (requestId === shapeImportRequestId) {
      shapeConverting = false;
      shapeImportingKind = null;
      shapeImportingVariant = null;
      updateUIState();
      syncLoop();
      if (shapeEnsurePending) {
        shapeEnsurePending = false;
        ensureShapeForCurrentSource();
      }
    }
  }
}

shapeInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const kind = P.shapeSource;
  if (kind === 'gltf') lastGLBFile = file;
  userShapeFiles[kind] = file;
  importShapeFile(file, kind);
  e.target.value = '';
});

// 切到需要距離場的模式、或換了形狀來源時，確保手上就有對應來源的形狀可用。
// 沒有使用者匯入的檔案就退回內建預設，讓這幾個模式不必先匯入檔案就看得到東西。
//
// 「換了形狀來源」不是唯一要重新烘焙的情況：使用者還沒自己匯入 SVG 時，
// 不同模式的內建展示形狀也不一樣（見 motions/registry.js 的 svgDemo，例如
// 融化用底部夠寬的冰塊、其餘模式用問號）。只要還在用內建預設、且目前載入的
// 版本跟新模式想要的不一致，也要重新烘焙——但使用者一旦自己匯入過 SVG，
// userShapeFiles.svg 就有值，這個判斷會直接短路，不會蓋掉使用者的檔案。
function ensureShapeForCurrentSource() {
  if (!usesShapeField(P.motion)) return;
  // 靜態模式選內建幾何時不吃形狀場，載進來的造型不會被畫出來，只是白花一次
  // 烘焙。切到「匯入」時 bindControls 的 staticShape 分支會再呼叫一次。
  if (!staticUsesImportedShape()) return;
  const usingBuiltinSvg = P.shapeSource === 'svg' && !userShapeFiles.svg;
  const desiredSvgVariant = MOTION_SVG_DEMO[P.motion] || 'question';
  // 烘焙途中要拿「這一份即將產出什麼」來比，不能拿已載入的那一份——見
  // shapeImportingKind 的註解，那正是「切回原來的來源之後畫面卻停在另一個
  // 來源、而且永遠不會恢復」的成因。
  const converting = shapeConverting && shapeImportingKind;
  const currentKind = converting ? shapeImportingKind : shapeFieldSource;
  const currentVariant = converting ? shapeImportingVariant : builtinSvgVariant;
  const sourceChanged = currentKind !== P.shapeSource;
  const variantChanged = usingBuiltinSvg && currentVariant !== desiredSvgVariant;
  if (!sourceChanged && !variantChanged) return;
  // 烘焙中不併行開第二份：兩者都是幾秒的 CPU 工作，同時跑只會互相拖慢。
  // 改成記下待辦，等當前這份收工後在 finally 裡補做，否則在烘焙途中切換來源
  // 會被整個吞掉 —— 畫面停在上一個來源的距離場，且沒有任何東西會再觸發。
  if (shapeConverting) { shapeEnsurePending = true; return; }
  shapeEnsurePending = false;
  importShapeFile(userShapeFiles[P.shapeSource], P.shapeSource);
}

/* ===== 播放/暫停：面板按鈕、postMessage、分頁隱藏三者共同決定 ===== */
let userPaused = false, extPaused = PREVIEW;
let reducedMotionPaused = !PREVIEW && reducedMotionQuery.matches;
let rafId = 0, last = 0;
let pausedRenderRaf = 0;
const pauseBtn = document.getElementById('playCtl');
const pauseBtnIcon = document.getElementById('playCtlIcon');
const pauseBtnLabel = document.getElementById('playCtlLabel');
const PAUSE_ICON = '<rect x="5" y="4" width="3.2" height="12" rx="1" fill="currentColor"/><rect x="11.8" y="4" width="3.2" height="12" rx="1" fill="currentColor"/>';
const PLAY_ICON = '<path d="M6 4.2v11.6a.9.9 0 0 0 1.37.76l9.2-5.8a.9.9 0 0 0 0-1.52l-9.2-5.8A.9.9 0 0 0 6 4.2Z" fill="currentColor"/>';
function playbackPaused() { return userPaused || reducedMotionPaused; }
function isPaused() { return playbackPaused() || extPaused || shapeConverting || isExporting() || document.hidden; }
function updatePlayControl() {
  const paused = playbackPaused();
  pauseBtnIcon.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  pauseBtnLabel.textContent = paused ? '播放' : '暫停';
  pauseBtn.setAttribute('aria-label', paused ? '播放動畫' : '暫停動畫');
  pauseBtn.setAttribute('aria-pressed', String(paused));
  pauseBtn.title = paused ? '播放動畫' : '暫停動畫';
}
// 後處理鏈。第一次真的要用到時才建立 —— 全部關閉時連 render target 都不該配置。
let postChain = null;
const bloomTintColor = new THREE.Color();

// 所有輸出畫面的地方都走這一支：即時預覽、暫停時的單幀重畫、以及匯出。三條路
// 共用同一條鏈，所見才等於所得 —— 匯出漏接是這種功能最典型的破法。
//
// target 為 null 代表直接輸出到 canvas。
// 後處理是否真的要跑。曝光與色調映射即使沒開 bloom 也是有效的效果，所以旁路的
// 條件是「三者都在中性值」，不是只看 bloom。
// 背景的亮度水平，取最強通道（跟亮部取樣的 br 同一個基準）。
function backdropLevel(transparent) {
  if (transparent || P.bgMode !== 'color') return 0;
  const hex = P.bgColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return Math.max(r, g, b);
}

function postActive() {
  return P.bloomEnabled || P.streaksEnabled
    || P.postExposure !== 1 || P.postToneMap !== 'none' || P.highlightGain !== 1
    || P.postAberration > 0 || P.postGrain > 0
    || P.postContrast !== 1 || P.postBrightness !== 0;
}

function renderComposite(target = null, superSample = 1) {
  gpuProfiler?.beginFrame();
  try {
  const transparent = uniforms.uTransparentBackground.value === 1;
  // 高於 1 的高光只有在「畫進後處理的半浮點貼圖」時才留得住。去背輸出例外：
  // 那條路徑的反預乘推導假設值域是 0–1（見主 shader 結尾），HDR 會讓它算出
  // 超出範圍的顏色。
  uniforms.uHdrOutput.value = (postActive() && !transparent) ? 1 : 0;
  uniforms.uHighlightGain.value = P.highlightGain;
  // 後處理需要一份物件遮罩（寫在 alpha，見 shaders.js 的 uCoverageAlpha）：亮部
  // 取樣與調色都只該作用在主體上。旁路時維持 0，alpha 就還是原本的 1.0。
  uniforms.uCoverageAlpha.value = (postActive() && !transparent) ? 1 : 0;
  if (!postActive()) {
    // 效果全關：完全走原本那條路（不配置 render target、不多任何一個 pass），
    // 畫面逐位元等於加入後處理之前。
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    if (target === null) markStagePresented();
    return;
  }
  if (!postChain) postChain = createPostChain(renderer);
  postChain.render(scene, camera, target, {
    // bloom 關著時強度給 0：合成 pass 仍要跑（曝光與色調映射在那裡），但光暈
    // 整條鏈的結果不參與。
    threshold: P.bloomThreshold,
    knee: P.bloomKnee,
    clampMax: P.bloomClamp,
    // 門檻是「比背景亮多少」。純色背景知道確切亮度就直接給；HDRI 背景每個
    // 方向都不一樣，沒有單一代表值，給 0 維持原本的絕對門檻。
    // 去背輸出的背景是全透明，同樣是 0。
    backdrop: backdropLevel(transparent),
    intensity: P.bloomEnabled ? P.bloomIntensity : 0,
    radius: P.bloomRadius,
    exposure: P.postExposure,
    toneMap: SELECTS.postToneMap.map[P.postToneMap],
    streaks: P.streaksEnabled,
    streakCount: P.streakCount,
    streakAngle: P.streakAngle,
    streakLength: P.streakLength,
    streakChroma: P.streakChroma,
    streakIntensity: P.streakIntensity,
    aberration: P.postAberration,
    contrast: P.postContrast,
    brightness: P.postBrightness,
    grain: P.postGrain,
    grainScale: P.postGrainScale,
    // 顆粒的亂數種子。步數取「循環秒數 × 24」：顆粒因此以每秒 24 次更新（底片的
    // 速率，比這慢會看成一格一格的閃爍），而步數是整數，所以每個循環的圖案精確
    // 重複 —— 這是一段會重播的背景，不循環的東西會在接點上被看見。
    grainSeed: Math.floor(
      (uniforms.uTime.value / Math.max(0.001, uniforms.uLoopDuration.value)) % 1
        * Math.max(1, Math.round(uniforms.uLoopDuration.value * 24)),
    ),
    tint: bloomTintColor.setStyle(P.bloomTint, THREE.LinearSRGBColorSpace),
    // 去背輸出寫的是 straight alpha，光暈的取樣與合成都要換一套（見 post.js）。
    transparent,
    // 匯出是超採樣的，模糊鏈要以「最終成品的尺寸」為基準展開，否則同一組參數在
    // 預覽與成品上的光暈大小會差一個超採樣倍率。
    superSample,
  });
  if (target === null) markStagePresented();
  } finally {
    gpuProfiler?.endFrame();
  }
}

function requestPausedRender() {
  // 暫停時 frame() 不跑，但循環秒數仍可能被改（拉時間軸、換模式、改文字），
  // 匯出對話框也常常是在暫停狀態下打開的，所以這條路也要廣播。
  broadcastLoopDuration();
  if (!isPaused() || shapeConverting || isExporting() || document.hidden || pausedRenderRaf) return;
  pausedRenderRaf = requestAnimationFrame(() => {
    pausedRenderRaf = 0;
    if (isPaused() && !shapeConverting && !isExporting() && !document.hidden) {
      if (!inited) initGL();
      updatePausedCameraRotation();
      refreshRenderQuality();
      uniforms.uResolution.value.set(
        Math.max(1, canvas.clientWidth || document.documentElement.clientWidth),
        Math.max(1, canvas.clientHeight || document.documentElement.clientHeight),
      );
      uniforms.uMaxSteps.value = resolveMaxSteps();
      renderComposite();
      updateExportCameraPreview();
    }
  });
}

function updatePausedCameraRotation() {
  if (!uniforms) return;
  rot.x = Math.max(-1.2, Math.min(1.2, rot.x));
  const phase01 = simT / Math.max(0.001, P.loopDuration);
  const loopAngle = phase01 * Math.PI * 2;
  const autoYaw = (Math.sin(loopAngle) * 0.85 + Math.sin(loopAngle * 2 + 0.6) * 0.15) * P.spin * 0.6;
  const autoPitch = Math.sin(loopAngle + 1.1) * P.spin * 0.14;
  const mobile = document.documentElement.clientWidth <= 760
    && document.documentElement.clientWidth / Math.max(1, document.documentElement.clientHeight) < 0.8;
  rotM4.makeRotationY(rot.y + autoYaw + (mobile ? -0.42 : 0));
  tmpX.makeRotationX(rot.x + autoPitch);
  rotM4.multiply(tmpX);
  tmpZ.makeRotationZ(-0.03);
  rotM4.multiply(tmpZ);
  uniforms.uRot.value.setFromMatrix4(rotM4);
}
const { collectGlEnvironment, computeShaderStats, captureFrameForDiff } = createRuntimeDiagnostics({
  params: P, preview: PREVIEW, diagnostics: DIAG, diagTimingEnabled: DIAG_TIMING,
  shaderRun: SHADER_RUN, frag: FRAG, fragBaseline: FRAG_BASELINE, usesBaselineShader,
  maxDrops: MAX_DROPS, maxMicroDrops: MAX_MICRO_DROPS, motionSvgDemo: MOTION_SVG_DEMO,
  usesShapeField, variantKey, variantState, variantCacheLimit: VARIANT_CACHE_LIMIT,
  diagTiming, glTimeline, adaptiveQuality, qualityTierNames: QUALITY_TIER_NAMES,
  setQualityTier, markInteraction, frame, setLast: value => { last = value; },
  cancelFrameLoop: () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } },
  runtime: () => ({
    renderer, mesh, uniforms, inited, gpuProfiler, dragging, powerSaveThrottled,
    reducedMotionPaused, shapeField, shapeTargetsBase, shapeTargets, shapeCavityBase,
    shapeFieldSource, builtinSvgVariant, shapeConverting, shapeImportingKind, userShapeFiles,
    activeVariantKey, initialCompileDone, pendingVariantSync, variantSwapInFlight,
    initialCompileMs, variantStats, prewarmStats, variantCache, dispersionMasterOn,
  }),
  canvas,
});

// 診斷 static / compileonly 只執行一次，避免後續的 syncLoop 重複啟動。
let diagOnceDone = false;
function syncLoop() {
  if (isPaused()) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // 系統減少動態效果在首次進頁時就暫停，但仍先完成初始化並畫一張靜態預覽。
    if (reducedMotionPaused && !document.hidden && !shapeConverting && !isExporting()) {
      if (!inited) initGL();
      ensureInitialCompile().then(requestPausedRender);
    }
  } else {
    if (!inited) initGL();
    // 計時模式：先跑非阻塞的編譯輪詢，量到數字之後才交回原本的流程。
    // 它自己會 compile + render 一次，所以完成後 compileonly / static 都已經有畫面。
    if (DIAG_TIMING && !isDiagTimingStarted()) {
      startDiagTiming(() => {
        // 量完之後：static / compileonly 就停在這裡，其餘模式照常啟動迴圈。
        if (!DIAG.static && !DIAG.compileonly && !rafId && !isPaused()) {
          last = performance.now();
          rafId = requestAnimationFrame(frame);
        }
      });
      return;
    }
    // 診斷：這兩個模式都不啟動 RAF 迴圈，用來把「初始化／編譯成本」與
    // 「持續算繪成本」分開。initGL() 已經跑完（renderer、scene、shader、
    // uniform、resize、環境貼圖都就緒），差別只在後面做到哪一步。
    if (DIAG.compileonly) {
      if (!diagOnceDone) {
        diagOnceDone = true;
        // 只把 program 編譯／連結起來，不送出全螢幕 draw call。
        renderer.compile(scene, camera);
        console.info('[bubble diag] compileonly: program 已編譯／連結，未算繪全螢幕影格');
      }
      return;
    }
    if (DIAG.static) {
      if (!diagOnceDone) {
        diagOnceDone = true;
        // 完整走一次 frame()，而不是只呼叫 renderer.render()。
        // 理由：每幀的 uniform 更新（updateDropUniforms）就在 frame() 裡，跳過它
        // 算出來的那一幀帶著初始化殘值 —— 例如 uMicroCount 會停在面板滑桿同步進去
        // 的 14，而毛細波模式實際上該是 0（syncPanelToUniforms 在 initGL 裡跑在
        // updateDropUniforms 之後，兩者都寫同一顆 uniform）。那樣量到的成本不具代表性。
        // frame() 開頭會自己排下一次，這裡算完立刻取消，只留這一幀。
        // 跟正式路徑一樣先等 env 狀態確定＋背景編譯完成，否則擷取到的會是
        // 「還沒切到最終 variant」的那一幀，A/B 比對就不是同一支 shader。
        ensureInitialCompile().then(() => {
          last = performance.now();
          frame(performance.now());
          // 讀像素必須緊接在 render 之後、同一個 task 內（見 DIAG_CAPTURE 的說明）。
          if (DIAG_CAPTURE) captureFrameForDiff(DIAG_CAPTURE);
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          console.info('[bubble diag] static: 已算繪 1 幀，不啟動 RAF 迴圈');
        });
      }
      return;
    }
    // 第一次算繪前先把 program 在背景編好。
    //
    // 這一段是「Chrome 整個卡住」的直接對策。three.js 在真正 render 時才準備 program，
    // 而取 uniform location 會強迫等待連結完成 —— 主執行緒因此被扣住整個編譯時間，
    // 而在 Windows 上那可能長到讓 GPU driver 逾時重置（本機實測：全功能 shader 在
    // 91.8 秒時觸發 webglcontextlost）。compileAsync 走的是
    // KHR_parallel_shader_compile 的非阻塞路徑，編好之前主執行緒完全自由。
    //
    // 代價是首幀會晚一點出現，但那段時間頁面是活的，而不是整個瀏覽器沒反應。
    if (!rafId) {
      ensureInitialCompile().then(() => {
        if (!rafId && !isPaused()) { last = performance.now(); rafId = requestAnimationFrame(frame); }
      });
    }
  }
}
pauseBtn.addEventListener('click', () => {
  if (reducedMotionPaused) reducedMotionPaused = false;
  else userPaused = !userPaused;
  document.body.dataset.reducedMotion = reducedMotionPaused ? 'paused' : 'allowed';
  updatePlayControl();
  syncLoop();
});
reducedMotionQuery.addEventListener('change', event => {
  if (PREVIEW) return;
  reducedMotionPaused = event.matches;
  document.body.dataset.reducedMotion = reducedMotionPaused ? 'paused' : 'allowed';
  if (reducedMotionPaused) setQualityTier(QUALITY_TIER_NAMES.length - 1);
  updatePlayControl();
  syncLoop();
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') { extPaused = true; syncLoop(); }
  else if (e.data === 'vfx-play') { extPaused = false; syncLoop(); }
});
document.addEventListener('visibilitychange', syncLoop);

/* ===== 面板開合 ===== */
const panel = document.getElementById('panel');
const panelToggle = document.getElementById('toggleBtn');
function syncPanelToggleState() {
  const expanded = !panel.classList.contains('collapsed');
  panelToggle.setAttribute('aria-expanded', String(expanded));
  panelToggle.setAttribute('aria-pressed', String(expanded));
}
panelToggle.addEventListener('click', () => {
  const exportDialog = document.getElementById('exportDialog');
  if (exportDialog?.open) {
    window.dispatchEvent(new CustomEvent('prism-workspace-panel-request'));
    return;
  }
  panel.classList.toggle('collapsed');
  syncPanelToggleState();
});
new MutationObserver(syncPanelToggleState).observe(panel, { attributes: true, attributeFilter: ['class'] });
syncPanelToggleState();

// 面板毛玻璃（backdrop-filter）是瀏覽器合成層自己的成本，跟畫布的節流是兩條
// 獨立路徑——捲動面板時雖然不會喚醒畫布（見 markInteraction 的判準），但每一
// 幀捲動都要重新取樣背後的模糊範圍，一樣會佔用 GPU。面板底色本身已經接近不
// 透明（見 switch2-theme.css 的 --sw-shell），捲動時暫時關閉模糊、停手後立刻
// 復原，視覺上幾乎看不出差異，卻能省掉這段重新合成的成本。
let panelScrollRestoreTimer = 0;
panel.addEventListener('scroll', () => {
  panel.classList.add('is-scrolling');
  clearTimeout(panelScrollRestoreTimer);
  panelScrollRestoreTimer = setTimeout(() => panel.classList.remove('is-scrolling'), 160);
}, { passive: true });

const {
  isExporting, getPreviewSettings: getExportPreviewSettings,
  exportEvent, settingsValue, settingsCenter, updateExportCameraPreview,
} = createExportRuntime({
  THREE, params: P, selects: SELECTS, getUniforms: () => uniforms,
  getRenderer: () => renderer, ensureInitialized: () => { if (!inited) initGL(); },
  updateDropUniforms, rotation: rot, rotM4, tmpX, tmpZ, isFormationMotion,
  getShapeField: () => shapeField, formationFidelityAmount, formationAmount, smoothstepCPU,
  syncEdgeDropMotion, renderComposite,
  isMobile: () => mobileRenderQuery.matches, flushShatterCutAnchors, syncLoop,
  getSimTime: () => simT, setSimTime: value => { simT = value; },
  resetPreviousDropT: () => { previousDropT = null; }, canvas, resize,
});

/* ===== 主迴圈 ===== */
let simT = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  broadcastLoopDuration();
  // 一定要在更新 last 之前就 return：last 沒動，下一張真正算繪的影格才會拿到
  // 累積起來的 dt，動畫速度維持不變，只是更新得比較疏。
  if (shouldSkipFrame(now)) return;
  lastRenderedAt = now;
  sampleRenderQuality(now);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  simT = (simT + dt) % Math.max(0.001, P.loopDuration);
  // 診斷：釘死動畫時間，讓兩個 shader 變體能在同一幀上做逐像素比對。
  if (DIAG_TIME !== null) simT = DIAG_TIME;
  updateDropUniforms(simT);

  if (!dragging) {
    vel.x *= 0.94; vel.y *= 0.94;
    rot.x += vel.x; rot.y += vel.y;
  }
  rot.x = Math.max(-1.2, Math.min(1.2, rot.x));

  const phase01 = simT / Math.max(0.001, P.loopDuration);
  const loopAngle = phase01 * Math.PI * 2;
  // 緩慢的弧線環繞 + 極輕的抬降，像手持/推軌的呼吸感，而非對稱來回。
  const autoYaw = (Math.sin(loopAngle) * 0.85 + Math.sin(loopAngle * 2 + 0.6) * 0.15) * P.spin * 0.6;
  const autoPitch = Math.sin(loopAngle + 1.1) * P.spin * 0.14;
  // 穩定英雄鏡：保留極輕的靜態荷蘭角增添張力，但移除擺動以維持畫面穩定。
  const roll = -0.03;
  // 推軌：在動作高潮（分裂 ~0.24、融合 ~0.80）輕微推近，漂浮段拉回，鏡頭隨敘事呼吸。
  // 這兩個固定相位是「分裂」模式專屬的敘事節拍，套用在所有模式的鏡頭距離上卻沒有
  // 開關——融化的形狀完全靜止時，這段推軌會把整個畫面一起放大縮小、跟滴落節奏
  // 毫無關係，看起來像定格呼吸。「前後拉伸」開關讓使用者自己決定要不要這段，
  // 每個模式各自記憶（見 P.dollyEnabled 與 motionMemory.dollyEnabled）。
  const dolly = !P.dollyEnabled ? 1 : 1
    - 0.05 * Math.exp(-Math.pow((phase01 - 0.80) / 0.10, 2))
    - 0.03 * Math.exp(-Math.pow((phase01 - 0.24) / 0.08, 2));
  // 直向螢幕的水平視野遠窄於桌面；依 aspect 拉遠，避免分裂後的大滴出框。
  // Bottom Sheet 展開時再把構圖上提，讓調參數時仍看得到結果。
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const aspect = viewportWidth / Math.max(1, viewportHeight);
  const isMobilePortrait = viewportWidth <= 760 && aspect < 0.8;
  let compositionDistance = isMobilePortrait
    ? Math.min(1.72, Math.max(1.15, 0.8 / aspect))
    : 1;
  let compositionOffsetY = isMobilePortrait ? -0.08 : 0;
  const sheetState = document.body.dataset.mobileSheet;
  if (isMobilePortrait && sheetState === 'half') {
    compositionDistance *= 1.12;
    compositionOffsetY = -0.32;
  } else if (isMobilePortrait && sheetState === 'full') {
    compositionDistance *= 1.2;
    compositionOffsetY = -0.48;
  }
  // 手機採較正面的英雄鏡，避免桌面的斜角透視讓右滴顯得特別巨大、整組視覺偏右。
  const mobileYawCorrection = isMobilePortrait ? -0.42 : 0;
  rotM4.makeRotationY(rot.y + autoYaw + mobileYawCorrection);
  tmpX.makeRotationX(rot.x + autoPitch);
  rotM4.multiply(tmpX);
  tmpZ.makeRotationZ(roll);
  rotM4.multiply(tmpZ);
  uniforms.uRot.value.setFromMatrix4(rotM4);

  // 匯聚完成時讓鏡頭跟著液滴群緩慢推近。模型距離場本身比自由漂浮軌道緊湊，
  // 若維持同一鏡距，外圍小滴剛收回時主體會顯得突然縮小。
  //
  // 這一段也歸「前後拉伸」管。它本來沒有開關，於是關掉前後拉伸之後鏡頭仍然會在
  // 成形時推近 30%（畫面上的造型等於放大 43%），看起來就是「成型的瞬間整個東西
  // 突然變大」——而且找不到地方關。上面那段敘事推軌只有 3~5%，這一段才是主因。
  const frameGatherEnd = Math.max(0.15, P.gatherDuration);
  const frameHoldEnd = Math.min(0.94, frameGatherEnd + P.shapeHold);
  const formationFocus = P.dollyEnabled && isFormationMotion(P.motion) && shapeField
    ? (phase01 > frameHoldEnd)
      ? formationFidelityAmount(phase01)
      : smoothstepCPU(formationAmount(phase01), 0.42, 0.92)
    : 0;
  const formationDolly = 1 - formationFocus * 0.30;
  // 首頁卡片預覽沿用上一版較寬鬆的取景距離，避免分裂時右側大滴貼近邊緣；
  // 完整調參頁仍使用面板中的鏡頭距離。
  const previewCameraDistance = PREVIEW ? 4.95 : P.cameraDistance;
  let cameraDistance = previewCameraDistance * dolly * compositionDistance * formationDolly;
  if (isMobilePortrait) {
    // 以主要水滴投影外輪廓的中點校正構圖。面積重心會被較大的水滴拉動，
    // 在展開狀態下反而讓整組水滴的左右留白不對稱。
    const e = rotM4.elements;
    // 同樣要允許 0：dropData 的每個槽位不論 count 多少都會被算過，夾成 1 會
    // 讓「沒有主滴」時仍拿第 0 顆去校正構圖。0 會讓下面的迴圈直接不跑，
    // hasProjectedBounds 落到 false，構圖偏移歸零。
    const count = Math.max(0, Math.min(MAX_DROPS, Math.round(P.count)));
    let minProjectedX = Infinity, maxProjectedX = -Infinity;
    for (let i = 0; i < count; i++) {
      const d = dropData[i];
      if (d.w <= 0.0001) continue;
      const localX = e[0] * d.x + e[1] * d.y + e[2] * d.z;
      const localZ = e[8] * d.x + e[9] * d.y + e[10] * d.z;
      const depth = Math.max(0.25, cameraDistance - localZ);
      const projectionScale = depth * 0.42;
      const projectedX = localX / projectionScale;
      const projectedRadius = d.w * Math.max(1, dropShapeData[i].w) / projectionScale;
      minProjectedX = Math.min(minProjectedX, projectedX - projectedRadius);
      maxProjectedX = Math.max(maxProjectedX, projectedX + projectedRadius);
    }
    const hasProjectedBounds = Number.isFinite(minProjectedX) && Number.isFinite(maxProjectedX);
    const targetOffsetX = hasProjectedBounds
      ? Math.max(-0.16, Math.min(0.16, (minProjectedX + maxProjectedX) * 0.5))
      : 0;
    compositionOffsetX += (targetOffsetX - compositionOffsetX) * Math.min(1, dt * 5);
  } else {
    compositionOffsetX = 0;
  }
  if (getExportPreviewSettings()) cameraDistance /= Math.max(0.5, Math.min(1.6, Number(getExportPreviewSettings().scale) || 1));
  uniforms.uCameraDistance.value = cameraDistance;
  uniforms.uCompositionOffsetX.value = getExportPreviewSettings()
    ? settingsCenter(settingsValue(getExportPreviewSettings(), 'centerX')) : compositionOffsetX;
  uniforms.uCompositionOffsetY.value = getExportPreviewSettings()
    ? settingsCenter(settingsValue(getExportPreviewSettings(), 'centerY')) : compositionOffsetY;
  uniforms.uTanHalfFov.value = getExportPreviewSettings()
    ? Math.tan(Math.max(10, Math.min(120, Number(getExportPreviewSettings().fov) || 42)) * Math.PI / 360)
    : 0.42;
  uniforms.uTime.value = simT;
  syncEdgeDropMotion(simT);
  uniforms.uMaxSteps.value = resolveMaxSteps();
  renderComposite();
  // 只在第一幀標記一次；之後 diagTiming.第一幀完成ms 已有值就不再量。

  updateExportCameraPreview();
}

buildExtendedMotionControls();
if (!PREVIEW) {
  inspector = buildInspector({ defaults: {
    ...DEFAULTS, ...MOTION_TEXT_DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS,
  } });
  inspector.setQualityStatus(adaptiveQuality.snapshot());
}
bindControls();
bindTextControls();

// 參數組合匯出/匯入。預覽模式要呈現正規預設值，不套用個人的自動保存狀態。
if (!PREVIEW && window.PresetIO) {
  const presetIO = window.PresetIO.init({
    effect: 'prism-drops',
    panel: '#panel',
    mount: '#presetIO',
    // 模式類控件必須先套用：切換動態模式會連帶覆寫水滴數量，
    // 配色數量會決定色標列的顯示，順序顛倒會讓後套的值被蓋掉。
    applyFirst: [
      'motion', 'backdrop', 'bgMode', 'bgColor',
      'materialStyle', 'colorMode', 'shapeSource', 'shapeQuality',
      'rayBeamPattern',
      'filmEnabled', 'dispersionEnabled', 'rayDispersionEnabled',
      'spectralCausticEnabled', 'rampCount',
    ],
    exclude: [
      'materialStyle', 'membraneDepth', 'membraneBaseColor', 'membraneVeilColor',
      'membraneReflectionColor', 'membraneCardColor', 'membraneShadeColor',
    ],
    assetNote: 'HDRI 與 SVG / GLB 素材無法存進參數檔，請自行載入',
    saveOn: ['#resetBtn'],
    serializeExtra: serializeTintMemory,
    afterApply: payload => {
      restoreTintMemory(payload);
      updateRampRows();
      buildRampLUT();
      buildSpectralCausticLUT();
      EDGE_TINT_TARGETS.forEach(updateEdgeTintPalette);
      // 其餘材質沿用既有載入規則；局部配色由 restoreTintMemory 分別還原，
      // 不參與另一底色的鏡射。
      mirrorBackdropMemory();
      updateUIState();
    },
  });
  // 自動保存的快照是使用者資料，可能來自任何一個舊版本，也可能已經壞掉。它要是
  // 丟出例外，這支 module script 就會就地中止 —— 底下的收尾（尤其是移除
  // data-bubble-boot 這道遮罩）永遠跑不到，面板就此卡在開機狀態，使用者連把壞
  // 掉的設定改回來的機會都沒有。所以還原失敗只能是「這次不還原」，不能是
  // 「整個效果起不來」：接住它、留下訊息、照常用預設值開機。
  // 手動貼上匯入那條路本來就有自己的錯誤提示（見 preset-io.js 的 applyText），
  // 不走這裡。
  try {
    presetIO?.restore();
  } catch (error) {
    console.error('[bubble] 自動保存的參數組合還原失敗，改用預設值開機', error);
  }
}

// 桌面版六格快速暫存：空格點一下儲存，已儲存的格子點一下載入。
if (!PREVIEW) {
  const quickSlots = document.getElementById('quickSlots');
  const quickStatus = document.getElementById('quickSlotsStatus');
  const preset = window.PresetIO?.of('prism-drops');
  initQuickSlots({ root: quickSlots, status: quickStatus, preset });
}

document.body.dataset.reducedMotion = reducedMotionPaused ? 'paused' : 'allowed';
if (reducedMotionPaused) setQualityTier(QUALITY_TIER_NAMES.length - 1);
else setQualityTier(adaptiveQuality.snapshot().tierIndex);
updatePlayControl();
// Reveal the final inspector only after controls, saved parameters, and all
// initial UI state have been applied. The critical HTML boot gate prevents a
// cached/raw panel from flashing before this point.
document.body.removeAttribute('data-bubble-boot');
syncLoop();
if (!PREVIEW) exportEvent('prism-export-ready', { loopDuration: P.loopDuration });
