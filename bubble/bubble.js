'use strict';
import * as THREE from 'three';
import { svgToField, gltfToField, objectToField } from './shape-field.js?v=svg-shape-29';
import {
  DEFAULT_SVG_NAME, DEFAULT_SOLID_NAME, buildDefaultSolid, makeDefaultSvgFile,
} from './default-shapes.js?v=svg-shape-29';
import { PMREMGenerator } from './vendor/PMREMGenerator.js';
import patchEnvMapResolution from './vendor/patchEnvMapResolution.js';

// 提高 PMREM 高粗糙度的最低預過濾解析度，避免 16×16 tile 造成方格反射。
patchEnvMapResolution();

/* ===== 預覽嵌入模式（?preview=1）===== */
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');

const canvas = document.getElementById('stage');
const mobileRenderQuery = window.matchMedia('(max-width: 760px)');
const GLASS_HDRI_URL = new URL('./assets/photo_studio2_london_hall_1k.hdr', import.meta.url).href;
const GLASS_HDRI_LABEL = 'photo_studio2_london_hall_1k.hdr';
const MEMBRANE_HDRI_URL = new URL('./assets/christmas_photo_studio_04_1k.hdr', import.meta.url).href;
const MEMBRANE_HDRI_LABEL = 'christmas_photo_studio_04_1k.hdr';
const MAX_DROPS = 12;
const FORMATION_DEFAULT_COUNT = 1;
// 穿梭環繞沒有「逐漸填滿」的微滴群，畫面上的豐富度全靠主水滴撐，
// 所以預設顆數遠比形狀匯聚（只需要 1 顆種子）多。
const WEAVE_DEFAULT_COUNT = 6;
// 崩解噴濺相反：畫面上的碎片愈多愈像噴濺，主水滴與微滴一起當碎片用。
const SHATTER_DEFAULT_COUNT = 8;
// 崩解噴濺的碎片大小基準：「水滴大小」滑桿的最小值，在這個模式代表 ×1 原尺寸。
const SHATTER_RADIUS_BASE = 0.25;
const MAX_MICRO_DROPS = 20;
const MAX_EDGE_DROPS = 8;
const MAX_NEGATIVE_DROPS = 4;

/* ===== 參數 ===== */
const DEFAULTS = {              // 數值滑桿
  thickness: 195,
  thickVar: 40,
  noiseScale: 1.0,
  dispersion: 0.02,
  dispersionSeparation: 1.5,
  causticScale: 1.0,
  causticSharpness: 0.65,
  realDispersion: 1,
  realDispersionSeparation: 0.6,
  spectralCausticIntensity: 1.5,
  spectralCausticFocus: 0.12,
  spectralCausticWidth: 0.42,
  spectralCausticLightSize: 0.33,
  spectralCausticDensity: 0.03,
  spectralCausticSoftness: 1,
  spectralCausticWarp: 0.57,
  spectralCausticSeparation: 0,
  spectralCausticBounce: 0.19,
  spectralCausticFlow: 0.18,
  spectralCausticFresnelMask: 1,
  spectralCausticNoiseMask: 1,
  spectralCausticNoiseScale: 2.5,
  spectralCausticAzimuth: 5,
  spectralCausticElevation: -19,
  spectralCausticHdri: 0.3,
  artThickness: 295,
  artThickVar: 130,
  artNoiseScale: 1.2,
  artPatternSpeed: 0.27,
  artGravity: 0.52,
  filmBlur: 0.25,
  saturation: 1.94,
  patternSpeed: 0.21,
  count: 2,
  radius: 0.4,
  viscosity: 0.78,
  surfaceTension: 0.82,
  inertiaDeform: 0.68,
  spread: 0.75,
  fresnel: 0.8,
  gravity: 1,
  roughness: 0.26,
  flowSpeed: 0.47,
  reflect: 1.6,
  transmission: 1.0,
  materialExposure: 1,
  // 液態薄膜專用的低頻塑形：0 回到純透明膜，1 完整加入厚度暗部、膜褶遮蔽
  // 與非對稱反射卡。厚玻璃模式不讀取這個值。
  membraneDepth: 0.65,
  // 水的折射率約 1.33，玻璃約 1.5；預設維持原本水滴的手感，改高會讓邊緣
  // 反射（Fresnel）變強、折射彎曲角度變陡，看起來更像玻璃而不是水珠。
  ior: 1.33,
  hdriYaw: -45,
  hdriPitch: 20,
  hdriBlur: 0.21,
  envRefraction: 0.21,
  cameraDistance: 5.5,
  cameraRotationX: 9.7,
  cameraRotationY: 29.8,
  loopDuration: 12,
  wobble: 0.305,
  wobbleScale: 0.7,
  wobbleSpeed: 0.65,
  elasticStrength: 0.024,
  elasticDensity: 3.5,
  elasticDamping: 0.55,
  elasticSpeed: 1.75,
  satelliteSize: 0.22,
  satelliteCount: 3,
  spin: 0.08,
  // 較快匯聚 + 較長停留：成形後的定格時間由 2.6 秒拉到 5.4 秒（12 秒循環），
  // 讓形狀本身而不是散開過程佔據大部分畫面。
  gatherDuration: 0.25,
  shapeDepth: 0.1,
  shapeSoftness: 0,
  shapeEdgeBevel: 0.025,
  shapeLiquid: 0.1,
  shapeLiquidPosition: 2,
  shapeLiquidSize: 1.5,
  shapeLiquidSpeed: 1,
  shapeHold: 0.45,
  microCount: 14,
  // 定格呼吸：成形停留那段期間整顆造型的縮放幅度（0.05 = 最大脹到 105%）。
  // 0 = 維持舊版完全凍結的定格。
  holdBreath: 0.05,
  // 匯聚前自由飛行段的軌跡多樣性：0 = 全體同方向、同軌道平面（舊行為），
  // 1 = 約半數反向繞行、軌道平面散佈到 ±90°。
  formationVariety: 0.35,
  // 穿梭環繞：每顆水滴的大小在這個範圍內隨機決定（乘在「水滴大小」滑桿上），
  // 上下限拉開才會看起來「好幾顆大小不一」，而不是差不多大的一團。
  weaveSizeMin: 0.1,
  weaveSizeMax: 0.25,
  // 穿梭環繞：飄浮幅度是整個晃動範圍的乘數（1 = 預設手感）；飄浮速度是晃動
  // 用的諧波倍率，只能是整數才能維持循環接縫不跳（跟 formationDropPosition
  // 自由段的「只用整數諧波」是同一個限制）。
  weaveDriftAmount: 1,
  weaveDriftSpeed: 1,
  // 崩解噴濺的時間軸拆成四段時長（見 shatterSegments）：靜止 → 蓄力 → 飛散 →
  // 重組。四個值是相對權重，正規化後填滿整個循環，所以任何組合都合法、不會出現
  // 「滑桿有數字但實際被夾住」的情形。預設 1.0 / 1.8 / 4.2 / 3.0 合計剛好 10，
  // 等同舊版「第 0.28 處炸開、尾端 0.3 重組」的節奏。
  shatterRest: 1.0,
  shatterFlight: 4.2,
  // 噴散運動拆成三軸（見 shatterTravel／shatterOffset）：散多遠、曲線多前傾、
  // 每顆差多少。減速預設 1.0 —— 真實的爆炸碎片會被空氣阻力拖慢，0 是舊版的等速。
  shatterRange: 0.54,
  shatterDecel: 1,
  shatterSpeedVary: 0.9,
  shatterGravity: 0,
  // 碎片在飛散途中縮小的比例（0 = 保持原大小飛到底）。
  shatterFade: 1,
  // 收尾：把碎片收回錨點、形狀重新長回來。這一段必須存在，phase=0/1 兩端才
  // 都是「完整形狀 + 零半徑碎片」，循環接縫不跳。
  shatterReform: 3.0,
  // 噴散亂數種子（見 shatterSeed）。0 是加這個參數之前的那一組飛散路徑。
  shatterSeed: 0,
  // 崩解切法（見 shatterAnchorSets）。換的是形狀被切成哪幾塊，跟 shatterSeed
  // 換飛散路徑是兩件不同的事。0 沿用共用錨點，不額外重算。
  shatterCut: 0,
  // 碎片彼此的大小差異（見 shatterFragmentRadius）。乘在各自的局部厚度上，
  // 所以調大只是讓大小更參差，不會讓任何一顆撐出輪廓。
  shatterVariety: 0.3,
  // 蓄力：炸開前形狀被內壓撐大的量（距離場的等距膨脹，單位同世界座標），
  // 以及這股力道累積多久。0 = 完全不蓄力，維持原本直接炸開。
  shatterCharge: 0.005,
  shatterChargeTime: 1.8,
};

// 走完整 SDF 匯聚管線（錨點、細節滴、負滴、體積交接）＋ 匯聚→停留→散開時間軸
// 的模式。目前只有「形狀匯聚」，但保留這個述詞是因為十幾處判斷讀的是「要不要跑
// 匯聚管線」而不是「是不是某個特定模式」，語意不同，日後加模式時也接得上。
//
// 舊的「脈動呼吸」曾是這裡的第二個成員：它共用整條管線，只把 formationAmount 換成
// 一條餘弦。但那條餘弦壓低的是「匯聚程度」，谷底等於把水滴又吐回去 —— 也就是形狀
// 匯聚 gather/release 兩段在做的事，只是沒有中間的定格。它沒有自己的敘事，等於一個
// 修飾器冒充模式，所以移除，把「呼吸」併進形狀匯聚的定格段（見 holdBreathSwell）。
const isFormationMotion = motion => motion === 'formation';
// 「需要距離場」比「走匯聚→散開時間軸」範圍更廣：穿梭環繞與崩解噴濺也要
// 匯入/顯示同一顆形狀，只是不吸收水滴、也不走 gather/hold/release 那套編排。
const SHAPE_MOTIONS = new Set(['formation', 'weave', 'shatter']);
const usesShapeField = motion => SHAPE_MOTIONS.has(motion);
const SELECT_DEFAULTS = {
  bgMode: 'color',
  materialStyle: 'glass',
  colorMode: 'spectral',
  motion: 'cinematic',
  shapeSource: 'svg',
  shapeQuality: 'balanced',
};
// 已移除的下拉選項 → 現存選項。用來讓舊的參數組合檔仍然打得開。選項本身必須還
// 留在 <select> 裡（標成 hidden），否則瀏覽器會在寫入當下就把 value 丟成空字串，
// 這裡根本讀不到原值。
const LEGACY_SELECT_VALUES = {
  motion: { pulse: 'formation' },
};
const TOGGLE_DEFAULTS = {
  edgeDropsEnabled: false,
  brightBgAssist: true,
  filmEnabled: false,
  dispersionEnabled: true,
  realDispersionEnabled: false,
  spectralCausticEnabled: true,
};
const COLOR_DEFAULTS  = {
  bgColor: '#000000',
};
const P = { ...DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS };

// 材質切換不是同一組滑桿換 shader 分支：厚玻璃與液態薄膜各自保留一份
// HDRI／材質狀態。離開時記住使用者微調，回來時恢復；第一次進入薄膜則使用
// 白底參考圖的校準值。鏡頭、動畫與配色不在這裡，切材質時不應改變構圖或動作。
const MATERIAL_PROFILE_KEYS = [
  'hdriYaw', 'hdriPitch', 'hdriBlur', 'envRefraction',
  'membraneDepth', 'reflect', 'transmission', 'materialExposure',
  'roughness', 'fresnel', 'ior',
];
const pickMaterialProfile = source => Object.fromEntries(
  MATERIAL_PROFILE_KEYS.map(key => [key, source[key]])
);
const MATERIAL_PROFILE_DEFAULTS = {
  glass: pickMaterialProfile(P),
  membrane: {
    hdriYaw: -45,
    hdriPitch: 20,
    hdriBlur: 0.18,
    envRefraction: 0.21,
    membraneDepth: 0.65,
    reflect: 1.6,
    transmission: 1,
    materialExposure: 1,
    roughness: 0.17,
    fresnel: 1.05,
    ior: 1.6,
  },
};
const MATERIAL_ENVIRONMENT_DEFAULTS = {
  glass: { url: GLASS_HDRI_URL, label: GLASS_HDRI_LABEL, isHDR: true, file: null },
  membrane: { url: MEMBRANE_HDRI_URL, label: MEMBRANE_HDRI_LABEL, isHDR: true, file: null },
};
let materialProfiles = {};
let materialEnvironments = {};
function resetMaterialProfiles() {
  materialProfiles = {
    glass: { ...MATERIAL_PROFILE_DEFAULTS.glass },
    membrane: { ...MATERIAL_PROFILE_DEFAULTS.membrane },
  };
  materialEnvironments = {
    glass: { ...MATERIAL_ENVIRONMENT_DEFAULTS.glass },
    membrane: { ...MATERIAL_ENVIRONMENT_DEFAULTS.membrane },
  };
}
resetMaterialProfiles();
const MOBILE_CAMERA_DISTANCE_DEFAULT = 4.3;
if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
const motionCounts = {
  cinematic: 2,
  formation: FORMATION_DEFAULT_COUNT,
  weave: WEAVE_DEFAULT_COUNT,
  shatter: SHATTER_DEFAULT_COUNT,
};
// 水滴大小的預設值依模式不同：分裂維持原本較大的滴徑，形狀匯聚這個
// 依賴外部形狀的模式改用較小的滴徑，讓吸附進外形時的顆粒感更細。切換模式時的
// 記憶方式與 motionCounts 相同——使用者在某個模式下調過的值會被保留，只有預設
// 的初始值不同。穿梭環繞的水滴不吸附進形狀，維持跟形狀匯聚一樣的顆粒感即可。
const FORMATION_DEFAULT_RADIUS = 0.25;
const motionRadius = {
  cinematic: DEFAULTS.radius,
  formation: FORMATION_DEFAULT_RADIUS,
  weave: FORMATION_DEFAULT_RADIUS,
  // 崩解噴濺的「水滴大小」是碎片的整體乘數，滑桿最小值 0.25 剛好＝×1 原尺寸。
  shatter: SHATTER_RADIUS_BASE,
};

// 自訂漸層色標（最多 6，可調位置）— reset 用
const STOP_MAX = 6;
const RAMP_DEFAULT = {
  count: 6,
  cols: ['#3698d8', '#b794a6', '#d1aa75', '#b2b3b4', '#9e7d98', '#5dbded'],
  pos:  [0.56, 0.20, 0.39, 0.60, 0.27, 0.66],
};

// select 字串 → int uniform
const SELECTS = {
  bgMode:    { uniform: 'uBgMode',    map: { color: 0, hdri: 1 } },
  materialStyle: { uniform: 'uMaterialStyle', map: { glass: 0, membrane: 1 } },
  colorMode: { uniform: 'uColorMode', map: { spectral: 0, ramp: 1 } },
  motion:    { uniform: 'uMotion',    map: { cinematic: 0, formation: 1, weave: 3, shatter: 4 } },
  shapeSource: { uniform: 'uShapeType', map: { svg: 1, gltf: 2 } },
  // 僅控制下一次 GLB 烘焙尺寸，沒有對應 shader uniform。
  shapeQuality: { uniform: '', map: { performance: 48, balanced: 80, high: 128 } },
};
const COLORS = {
  bgColor: 'uBgColor',
};
// shader 的光譜座標由紫端（0）走向紅端（1）。七個色標固定等距，
// 讓每種彩虹顏色都能單獨編輯，同時保持色帶之間連續混色。
const SPECTRAL_CAUSTIC_DEFAULTS = [
  '#52e6fc', '#40b3f9', '#3aa3e3', '#3fabf9', '#4dd8fb', '#3ba6f9', '#52e6fc',
];
// 值為 uniform 名稱（直接寫 0/1），或一個套用函式 —— 輪廓液滴的開關不是
// 布林 uniform，而是把 uEdgeDropCount 歸零，這樣關閉液滴時仍保留邊緣圓角
// （圓角半徑由獨立的 uShapeEdgeBevel 控制，見 svgShapeDistance 的 smin 半徑）。
const TOGGLES = {
  brightBgAssist: 'uBrightBgAssist',
  filmEnabled: 'uFilmEnabled',
  dispersionEnabled: 'uDispersionEnabled',
  realDispersionEnabled: 'uRealDispersionEnabled',
  spectralCausticEnabled: 'uSpectralCausticEnabled',
  edgeDropsEnabled: () => applyEdgeDropDistribution(),
};

function applyToggle(key) {
  const target = TOGGLES[key];
  if (typeof target === 'function') target();
  else if (uniforms && uniforms[target]) uniforms[target].value = P[key] ? 1 : 0;
}

// DEFAULTS 的 key 一律用 'u' + 首字大寫推導 uniform 名稱（uReflect、uRoughness...），
// 但 IOR 照慣例整個縮寫大寫，'uIor' 對不上 shader 裡宣告的 uIOR，需要例外表。
const UNIFORM_NAME_OVERRIDES = { ior: 'uIOR' };
function uniformNameFor(key) {
  return UNIFORM_NAME_OVERRIDES[key] || ('u' + key.charAt(0).toUpperCase() + key.slice(1));
}

const fmt = {
  thickness: v => v.toFixed(0) + 'nm',
  thickVar: v => '±' + v.toFixed(0),
  noiseScale: v => 'x' + v.toFixed(1),
  count: v => v.toFixed(0),
  radius: v => v.toFixed(2),
  viscosity: v => v.toFixed(2),
  spread: v => v.toFixed(2),
  flowSpeed: v => 'x' + v.toFixed(2),
  spin: v => 'x' + v.toFixed(2),
  wobble: v => v.toFixed(3),
  wobbleScale: v => 'x' + v.toFixed(1),
  wobbleSpeed: v => 'x' + v.toFixed(2),
  patternSpeed: v => 'x' + v.toFixed(2),
  dispersion: v => Math.round(v * 100) + '%',
  dispersionSeparation: v => 'x' + v.toFixed(2),
  causticScale: v => 'x' + v.toFixed(2),
  causticSharpness: v => Math.round(v * 100) + '%',
  realDispersion: v => Math.round(v * 100) + '%',
  realDispersionSeparation: v => 'x' + v.toFixed(2),
  spectralCausticIntensity: v => Math.round(v * 100) + '%',
  spectralCausticFocus: v => Math.round(v * 100) + '%',
  spectralCausticWidth: v => 'x' + v.toFixed(2),
  spectralCausticLightSize: v => Math.round(v * 100) + '%',
  spectralCausticDensity: v => Math.round(v * 100) + '%',
  spectralCausticSoftness: v => Math.round(v * 100) + '%',
  spectralCausticWarp: v => Math.round(v * 100) + '%',
  spectralCausticSeparation: v => 'x' + v.toFixed(2),
  spectralCausticBounce: v => Math.round(v * 100) + '%',
  spectralCausticFlow: v => 'x' + v.toFixed(2),
  spectralCausticFresnelMask: v => Math.round(v * 100) + '%',
  spectralCausticNoiseMask: v => Math.round(v * 100) + '%',
  spectralCausticNoiseScale: v => 'x' + v.toFixed(1),
  spectralCausticAzimuth: v => v.toFixed(0) + '°',
  spectralCausticElevation: v => v.toFixed(0) + '°',
  spectralCausticHdri: v => Math.round(v * 100) + '%',
  artThickness: v => v.toFixed(0) + 'nm',
  artThickVar: v => '±' + v.toFixed(0),
  artNoiseScale: v => 'x' + v.toFixed(1),
  artPatternSpeed: v => 'x' + v.toFixed(2),
  artGravity: v => Math.round(v * 100) + '%',
  filmBlur: v => v.toFixed(2),
  reflect: v => 'x' + v.toFixed(2),
  transmission: v => v.toFixed(2),
  materialExposure: v => 'x' + v.toFixed(2),
  membraneDepth: v => Math.round(v * 100) + '%',
  ior: v => v.toFixed(2),
  hdriYaw: v => v.toFixed(0) + '°',
  hdriPitch: v => v.toFixed(0) + '°',
  hdriBlur: v => Math.round(v * 100) + '%',
  envRefraction: v => Math.round(v * 100) + '%',
  cameraDistance: v => v.toFixed(2),
  cameraRotationX: v => v.toFixed(1) + '°',
  cameraRotationY: v => v.toFixed(1) + '°',
  loopDuration: v => v.toFixed(1) + 's',
  elasticStrength: v => v.toFixed(3),
  elasticDensity: v => 'x' + v.toFixed(1),
  elasticDamping: v => v.toFixed(2),
  elasticSpeed: v => 'x' + v.toFixed(2),
  satelliteSize: v => v.toFixed(2),
  satelliteCount: v => v.toFixed(0),
  // 顯示成秒數而不是循環比例：匯集時間／完成停留描述的是「這段實際花多久」，
  // 但循環秒數是另一個獨立滑桿，同樣的百分比在 6 秒與 30 秒的循環裡代表天差
  // 地遠的時間長度。換算成秒數後兩個滑桿放在一起看才有直覺意義。
  gatherDuration: v => (v * P.loopDuration).toFixed(1) + 's',
  shapeDepth: v => v.toFixed(2),
  shapeSoftness: v => v.toFixed(3),
  shapeEdgeBevel: v => v.toFixed(3),
  shapeLiquid: v => Math.round(v * 100) + '%',
  shapeLiquidPosition: v => `分佈 ${Math.round(v) + 1}`,
  shapeLiquidSize: v => 'x' + v.toFixed(2),
  shapeLiquidSpeed: v => v === 0 ? '停止' : 'x' + v.toFixed(0),
  shapeHold: v => (v * P.loopDuration).toFixed(1) + 's',
  microCount: v => v.toFixed(0),
  holdBreath: v => v === 0 ? '凍結' : '±' + Math.round(v * 100) + '%',
  formationVariety: v => v === 0 ? '整齊同向' : Math.round(v * 100) + '%',
  weaveSizeMin: v => 'x' + v.toFixed(2),
  weaveSizeMax: v => 'x' + v.toFixed(2),
  weaveDriftAmount: v => 'x' + v.toFixed(2),
  weaveDriftSpeed: v => 'x' + v.toFixed(0),
  shatterRange: v => 'x' + v.toFixed(2),
  shatterDecel: v => v === 0 ? '等速' : Math.round(v * 100) + '%',
  shatterSpeedVary: v => '±' + Math.round(v * 100) + '%',
  shatterGravity: v => v === 0 ? '關閉' : 'x' + v.toFixed(2),
  shatterFade: v => Math.round(v * 100) + '%',
  shatterRest: () => shatterSegmentSeconds('rest'),
  shatterFlight: () => shatterSegmentSeconds('flight'),
  shatterReform: () => shatterSegmentSeconds('reform'),
  shatterSeed: v => '#' + v.toFixed(0),
  shatterCut: v => v === 0 ? '預設' : '#' + v.toFixed(0),
  shatterVariety: v => '±' + Math.round(v * 100) + '%',
  shatterCharge: v => v === 0 ? '關閉' : '+' + v.toFixed(3),
  shatterChargeTime: () => shatterSegmentSeconds('charge'),
};

// 崩解噴濺的四段時長是正規化的相對權重，所以動任何一段，其他三段實際佔的秒數
// 都會跟著變 —— 讀數必須一起重畫，不能只更新被拖動的那一個。
const SHATTER_TIMELINE_KEYS = ['shatterRest', 'shatterChargeTime', 'shatterFlight', 'shatterReform'];
function refreshShatterTimelineReadouts() {
  for (const key of SHATTER_TIMELINE_KEYS) {
    const valEl = document.getElementById(key + '_v');
    if (valEl) valEl.textContent = fmt[key]();
  }
  const total = document.getElementById('shatterTotal');
  if (total) total.textContent = `四段合計 ${P.loopDuration.toFixed(1)}s（＝循環秒數）`;
}

import { VERT, FRAG } from './shaders.js?v=membrane-depth-2';

/* ===== WebGL 場景（延遲初始化，規避預覽時的 context 上限）===== */
let renderer = null, scene = null, camera = null, mesh = null, uniforms = null;
let pmremGenerator = null, pmremTarget = null;
let inited = false;
const maxRenderDpr = PREVIEW ? 1 : mobileRenderQuery.matches
  ? Math.min(window.devicePixelRatio || 1, 1.5)
  : Math.min(window.devicePixelRatio || 1, 2);
// 拖曳時的解析度。fragment 成本與像素面積成線性（實測 1/12 像素 → 1/8.5 幀時），
// 所以這個下限是互動流暢度最大的單一槓桿：舊版桌面只從 2.0 降到 1.75，像素僅少
// 23%；降到 1.25 後只剩 39%。放手後會立刻回到 maxRenderDpr。
const minRenderDpr = PREVIEW ? 1 : Math.min(maxRenderDpr, 1.25);
let qualityDpr = maxRenderDpr;
let qualitySteps = PREVIEW ? 56 : mobileRenderQuery.matches ? 64 : 88;
let qualitySampleStarted = performance.now();
let qualitySampleFrames = 0;
let qualityLowSamples = 0;
let qualityHighSamples = 0;

const rot = { x: P.cameraRotationX * Math.PI / 180, y: P.cameraRotationY * Math.PI / 180 };
const vel = { x: 0, y: 0 };
let compositionOffsetX = 0;
let dragging = false, lastX = 0, lastY = 0;
const rotM4 = new THREE.Matrix4();
const tmpX = new THREE.Matrix4();
const tmpZ = new THREE.Matrix4();
const dropData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
const dropShapeData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(1, 0, 0, 1));
const dropPhysicsData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
const previousDropPositions = Array.from({ length: MAX_DROPS }, () => new THREE.Vector3());
const dropBounds = new THREE.Vector4(0, 0, 0, 1);
const elasticEvent = new THREE.Vector2(0, 0);
const elasticPair = new THREE.Vector2(0, 1);
// 斷裂處的衛星滴串（Rayleigh–Plateau）：沿收頸軸形成，釋放後各自漂移並被主滴回收。
const SAT_N = 3;
const SAT_SPEC = [
  { along: -0.55, size: 0.50, jitter:  0.05, seed: 0.7, drift: -0.22, absorbAt: 0.61 },
  { along:  0.35, size: 0.30, jitter: -0.06, seed: 2.4, drift:  0.12, absorbAt: 0.58 },
  { along:  1.05, size: 0.17, jitter:  0.05, seed: 4.9, drift:  0.28, absorbAt: 0.54 },
];
const satelliteDrops = Array.from({ length: SAT_N }, () => new THREE.Vector4(0, 0, 0, 0));
let previousDropT = null;
let previousPairKey = '';
let previousPairGap = 0;
let shapeField = null;
// 每匯入一次形狀就 +1。崩解切法的錨點快取用它當 key 的一部分，換了形狀
// 才不會拿上一顆造型算出來的碎片繼續用。
let shapeFieldSerial = 0;
let shapeTargets = [];
let formationAnchors = [];
let microFormationAnchors = [];
let negativeFormationAnchors = [];
// 穿梭環繞的路徑點：只取 formationAnchors 裡標記為表面的錨點。每顆水滴分到
// 一個表面點當「家」，在旁邊小幅度飄浮晃動，而不是精確衝向某個目標點——
// 參考的泡泡影片裡，泡泡是懸浮在原地輕輕晃動，不是有明確路徑地移動。
let weaveSurfaceAnchors = [];
function rebuildWeaveAnchorSets() {
  weaveSurfaceAnchors = formationAnchors.filter(a => a.surface);
  if (!weaveSurfaceAnchors.length) weaveSurfaceAnchors = formationAnchors;
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

const fract = x => x - Math.floor(x);
const hash11CPU = n => fract(Math.sin(n * 127.1) * 43758.5453123);
const dropSeeds = Array.from({ length: MAX_DROPS }, (_, i) => ({
  h1: hash11CPU(i + 1),
  h2: hash11CPU(i + 7),
  h3: hash11CPU(i + 13),
  radius: 0.72 + 0.55 * hash11CPU(i * 3.17 + 5),
}));

// 切法種子：這幾個分佈函式本身完全是決定性的（最遠點取樣、貪婪評分），同一顆
// 形狀永遠切出同一組錨點。要換一種切法，就替每個候選點配一個穩定的權重去擾動
// 評分——名次一變，最遠點取樣的整條鏈就跟著換，Lloyd 收斂到的區塊也不同。
// 種子 0 回傳 null，呼叫端會完全走原本的式子，因此既有模式一格都不會變。
function cutWeights(candidates, seed, salt) {
  if (!seed) return null;
  const base = Math.round(seed) * 29.7 + salt;
  return candidates.map((_, i) => 0.74 + 0.52 * hash11CPU(i * 1.37 + base));
}

function distributeFormationAnchors(candidates, count = MAX_DROPS, seed = 0) {
  if (!candidates.length) return [];
  const weights = cutWeights(candidates, seed, 3.1);
  const center = candidates.reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .multiplyScalar(1 / candidates.length);
  const chosen = [];
  let first = candidates[0];
  let farthest = -1;
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    // 起點換了，後面整條最遠點取樣鏈就全部跟著換——這是切法差異最大的來源。
    const d = p.distanceToSquared(center) * (weights ? weights[i] : 1);
    if (d > farthest) { farthest = d; first = p; }
  }
  chosen.push(first);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best = candidates[0], bestDistance = -1;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      let nearest = Infinity;
      for (const q of chosen) nearest = Math.min(nearest, p.distanceToSquared(q));
      if (weights) nearest *= weights[i];
      if (nearest > bestDistance) { bestDistance = nearest; best = p; }
    }
    chosen.push(best);
  }
  return chosen.map((p, i) => {
    const copy = p.clone();
    let nearest = Infinity;
    for (let j = 0; j < chosen.length; j++) {
      if (i === j) continue;
      nearest = Math.min(nearest, p.distanceTo(chosen[j]));
    }
    // Farthest-point sampling 保證覆蓋輪廓，但局部間距可能大於原始厚度提示。
    // 半徑至少跨過一半鄰距，才能形成連續液橋；上限則保留耳、嘴等造型辨識度。
    const bridgeRadius = Number.isFinite(nearest) ? nearest * 0.56 : 0.18;
    copy.radiusHint = Math.min(0.27, Math.max(p.radiusHint || 0.1, bridgeRadius));
    return copy;
  });
}

function distributePrimaryAnchors(candidates, count = MAX_DROPS, seed = 0) {
  if (!candidates.length) return [];
  const chosen = [];
  const remaining = candidates.slice();
  // remaining 會被 splice，索引跟著位移，所以權重必須同步 splice，不能用索引
  // 回頭查原陣列 —— 否則挑掉幾顆之後每個點拿到的都是別人的權重。
  const remainingWeights = cutWeights(candidates, seed, 8.6);
  while (chosen.length < Math.min(count, candidates.length)) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const thickness = p.radiusHint || 0.1;
      const spacing = chosen.length
        ? Math.min(...chosen.map(q => p.distanceTo(q)))
        : thickness;
      // 主滴服務於體積與重量，優先落在厚實內部；間距僅防止全部擠在同一區。
      const score = (thickness * 3.2 + spacing * 0.42)
        * (remainingWeights ? remainingWeights[i] : 1);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const source = remaining.splice(bestIndex, 1)[0];
    if (remainingWeights) remainingWeights.splice(bestIndex, 1);
    const copy = source.clone();
    // 下面那個 0.14 下限是形狀匯聚要的：主滴在那裡負責撐體積、接液橋，寧可比
    // 真實厚度粗。崩解噴濺剛好相反，碎片一旦比所在位置的造型厚就會撐破輪廓，
    // 所以把沒有夾過的原始厚度另存一份給它用。
    copy.thickness = source.radiusHint || 0.1;
    copy.radiusHint = Math.min(0.24, Math.max(0.14, source.radiusHint || 0.14));
    chosen.push(copy);
  }
  return chosen;
}

function distributeDetailedAnchors(candidates, count = MAX_MICRO_DROPS, seed = 0) {
  if (!candidates.length) return [];
  const weighted = [
    ...candidates,
    ...candidates.filter(p => p.surface),
  ];
  const centers = distributeFormationAnchors(weighted, count, seed);
  const groups = Array.from({ length: centers.length }, () => []);
  // 只把種子餵給初始中心點是不夠的：Lloyd iterations 會收斂到重心 Voronoi，
  // 不管從哪裡起步都趨向同一組區塊，實測換種子後畫面幾乎沒變。真正要換切法，
  // 得改變分割本身 —— 給每個中心一個固定權重、用加權距離指派，等於畫一張
  // 乘法加權 Voronoi 圖：有的中心搶到大塊、有的只分到小塊，碎片大小與邊界
  // 都跟著換。權重固定不隨 iteration 變，所以照樣會收斂。
  const centerWeights = seed
    ? centers.map((_, i) => 0.62 + 0.85 * hash11CPU(i * 4.19 + Math.round(seed) * 51.3))
    : null;
  // 少量 Lloyd iterations，把每顆橢球變成一塊模型區域的代表，而非單一體素。
  for (let iteration = 0; iteration < 5; iteration++) {
    groups.forEach(group => { group.length = 0; });
    for (const point of weighted) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        let d = point.distanceToSquared(centers[i]);
        if (centerWeights) d *= centerWeights[i];
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best].push(point);
    }
    for (let i = 0; i < centers.length; i++) {
      if (!groups[i].length) continue;
      centers[i].set(0, 0, 0);
      groups[i].forEach(point => centers[i].add(point));
      centers[i].multiplyScalar(1 / groups[i].length);
    }
  }
  for (let i = 0; i < centers.length; i++) {
    const group = groups[i];
    let vx = 0, vy = 0, vz = 0, radiusHint = 0.1;
    for (const point of group) {
      vx += (point.x - centers[i].x) ** 2;
      vy += (point.y - centers[i].y) ** 2;
      vz += (point.z - centers[i].z) ** 2;
      radiusHint = Math.max(radiusHint, point.radiusHint || 0.1);
    }
    const denom = Math.max(1, group.length);
    const variances = [vx / denom, vy / denom, vz / denom];
    const major = variances.indexOf(Math.max(...variances));
    centers[i].axis = new THREE.Vector3(
      major === 0 ? 1 : 0,
      major === 1 ? 1 : 0,
      major === 2 ? 1 : 0,
    );
    const sorted = variances.slice().sort((a, b) => b - a);
    centers[i].stretch = Math.min(1.42, Math.max(1.06,
      Math.sqrt((sorted[0] + 1e-4) / (sorted[1] + 1e-4))));
    centers[i].radiusHint = Math.min(0.28, Math.max(
      radiusHint,
      Math.sqrt(sorted[1] + sorted[2]) * 1.15,
    ));
  }
  return centers;
}

function cyclicPulse(phase, center, width) {
  const d = Math.abs(((phase - center + 0.5) % 1 + 1) % 1 - 0.5);
  if (d >= width) return 0;
  const x = 1 - d / width;
  return x * x * (3 - 2 * x);
}

function smoothstepCPU(value, edge0, edge1) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

// 定格呼吸：成形停留那段期間（gatherEnd → holdEnd）整顆造型的縮放呼吸，回傳
// 縮放增量（0 = 原尺寸）。
//
// 兩個「不是」：
//   不走距離場的等距膨脹（uShapeSwell，崩解噴濺蓄力用的那條）—— 等距偏移是把
//   輪廓整圈加粗，細筆畫之間還會互相靠攏黏起來，看起來是造型變胖而不是呼吸。
//   不走 formationAmount —— 那個值被十幾處 smoothstep 讀成「匯聚程度」，壓低它
//   等於把水滴又吐回去，正是舊「脈動呼吸」模式跟形狀匯聚看起來重疊的原因。
//
// 用 (1-cos) 的整數個週期，值與一階導數在 hold 兩端都是 0：呼吸不會滲進 gather /
// release，定格的頭尾也沒有速度跳變（慣性形變會讀速度）。
const HOLD_BREATH_CYCLES = 2;
function holdBreathScale(phase) {
  if (P.motion !== 'formation' || P.holdBreath <= 0) return 0;
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  if (holdEnd <= gatherEnd || phase <= gatherEnd || phase >= holdEnd) return 0;
  const u = (phase - gatherEnd) / (holdEnd - gatherEnd);
  return P.holdBreath * 0.5 * (1 - Math.cos(u * HOLD_BREATH_CYCLES * Math.PI * 2));
}

function formationAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  const gather = smoothstepCPU(phase, 0.04, gatherEnd);
  const release = smoothstepCPU(phase, holdEnd, 0.98);
  return gather * (1 - release);
}

function formationFidelityAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  // 直接使用循環 phase，而非已 smoothstep 過的 formationAmount 再平滑一次。
  // 預設 12 秒循環約有 2.6 秒完成吸收，避免末段在幾幀內由水滴跳成模型。
  const absorbStart = Math.max(0.08, gatherEnd - 0.22);
  const gatherAbsorb = smoothstepCPU(phase, absorbStart, gatherEnd);
  const releaseAbsorb = 1 - smoothstepCPU(phase, holdEnd, 0.98);
  return gatherAbsorb * releaseAbsorb;
}

// 崩解噴濺的時間軸。跟其他模式最大的不同是它的「靜止態」不是散開的水滴而是
// 完整的形狀：phase=0 與 phase=1 兩端都必須是「形狀滿值 + 碎片零半徑」，循環
// 才接得起來。所以尾端一定要留一段重組期，把碎片收回錨點、形狀重新長回來。
//   burst    0→1：碎片由零半徑長到滿
//   shapeOut 0→1：形狀退場。刻意比 burst 晚起步、也拖得更久（見下）
//   charge   0→1：炸開前的蓄力，形狀被內壓撐大
//   flight   0→1：碎片的飛行時間，用來算彈道位移
//   reform   0→1：收尾。用 smoothstep 讓 phase=1 處的速度也是 0，不只位置對上。
//
// burst 與 shapeOut 一定要分成兩條並且重疊。它們原本共用一條曲線，但形狀是靠
// 「距離場侵蝕」退場的，而侵蝕量是固定的 0.38 —— 問號筆畫半厚只有 ~0.09，才削
// 到四成形狀就整個不見了，碎片那時卻只長到四成大小，中間會出現一段剪影變細的
// 空窗。（現況之所以看不出來，是因為 contactLead 讓形狀黏在碎片上硬撐，也就是
// 那些疙瘩——等於用一個瑕疵蓋掉另一個。）
// 讓碎片先長滿、形狀才開始退，任何一刻至少有一邊是滿的，剪影就不會塌下去。
//
// 兩者都以「碎片實際位移」為時鐘，而不是 phase。先前 burst/shapeOut 走固定的
// 絕對 phase 視窗（0.022 / 0.06），碎片位移卻是相對飛散進度 —— 兩個時鐘會隨
// 減速與飛散時間走鐘，調出「碎片都噴出去了、造型還留在原地慢慢淡」的狀態。
// 減速愈大差距愈誇張：減速 100% 時碎片在那 0.06 內已經跑掉六成距離。
// 改用位移當時鐘之後，這層關係與減速、飛散時間、擴散範圍全部無關 —— 造型永遠
// 在碎片離開 15% 行程前退乾淨，也不再需要「飛散段太短要縮視窗」那組夾制。
const SHATTER_BURST_TRAVEL = 0.05;
const SHATTER_OUT_TRAVEL = 0.15;

// 四段時長 → 循環上的絕對位置。四個滑桿是「相對權重」而不是循環佔比：先加總再
// 正規化，所以任何組合都填滿整個循環、永遠不會互相擠爆。
//
// 舊版是「崩解時機（從頭算的絕對位置）」＋「重組時間（從尾端倒推）」兩個方向相反
// 的座標，而真正想控制的飛散長度是 reformStart - at 這個殘值 —— 動任何一邊都會
// 連帶改到它。更糟的是 reformStart = max(at + 0.1, 1 - reform) 這個夾制：崩解時機
// 拉到 0.7、重組拉到 0.6 時實際重組只有 0.2，滑桿卻仍顯示 7.2s，數字是假的。
// 改成四段時長之後，每個滑桿各自對應時間軸上的一段，讀數就是它真正的長度。
//
// 飛散與重組不能為 0：前者沒有飛散就沒有崩解可言，後者是循環接縫的必要條件
// （phase=0/1 兩端都必須回到「完整形狀 + 零半徑碎片」）。
function shatterSegments() {
  const rest = Math.max(0, P.shatterRest);
  const charge = Math.max(0, P.shatterChargeTime);
  const flight = Math.max(0.2, P.shatterFlight);
  const reform = Math.max(0.2, P.shatterReform);
  const total = rest + charge + flight + reform;
  return {
    rest: rest / total,
    charge: charge / total,
    flight: flight / total,
    reform: reform / total,
  };
}

// 面板讀數：每段實際佔幾秒。四段相加恆等於循環秒數。
function shatterSegmentSeconds(key) {
  return (shatterSegments()[key] * P.loopDuration).toFixed(1) + 's';
}

function shatterTimeline(phase) {
  const seg = shatterSegments();
  const at = seg.rest + seg.charge;
  const reformStart = at + seg.flight;
  const flight = Math.max(0, Math.min(1, (phase - at) / Math.max(0.02, reformStart - at)));
  const travel = shatterTravel(flight);
  const burst = smoothstepCPU(travel, 0, SHATTER_BURST_TRAVEL);
  const shapeOut = smoothstepCPU(travel, SHATTER_BURST_TRAVEL, SHATTER_OUT_TRAVEL);
  const reform = smoothstepCPU(phase, reformStart, 0.998);
  // 蓄力：從靜止段結束一路漲到炸開那一刻，再隨形狀退場釋放。
  // 兩端的連續性：phase=0 時 charge=0（smoothstep 起點導數為 0，靜止段為 0 也
  // 一樣）；phase→1 時 shapeOut 早已飽和成 1，(1 - shapeOut) 把 swell 壓回 0。
  // 所以循環接縫兩側的膨脹量與變化率都是 0，不會在 phase 0 突然鼓一下。
  // 蓄力時間歸零時 seg.rest === at，smoothstepCPU 會在 phase 剛好等於邊界時算出
  // 0/0＝NaN 並一路汙染 uShapeSwell。沒有蓄力時間本來就等於沒有蓄力，直接給 0。
  const charge = seg.charge > 1e-6 ? smoothstepCPU(phase, seg.rest, at) : 0;
  const swell = P.shatterCharge * charge * (1 - shapeOut);
  return { burst, shapeOut, flight, travel, reform, swell };
}

// 噴散亂數種子。碎片的初速快慢與噴散方向的擾動都由這三個雜湊值決定，換一個
// 種子就換一整組飛散路徑。實作只是把雜湊的取樣點整段平移 —— 種子 0 會讓參數
// 退化回原本的式子（主滴 hash11CPU(i+1)、微滴 hash11CPU(i*2.31+31)…），所以
// 預設值與加種子之前的畫面完全一致。
//
// 注意這個種子不會改變「形狀被切成哪幾塊」：碎片的出發點是匯入形狀算出來的
// 錨點，由幾何決定而非亂數，換種子只換它們往哪飛、飛多快。
const SHATTER_SEED_STRIDE = 17.3;
function shatterSeed(k1, k2, k3) {
  const s = Math.round(P.shatterSeed) * SHATTER_SEED_STRIDE;
  return { h1: hash11CPU(k1 + s), h2: hash11CPU(k2 + s), h3: hash11CPU(k3 + s) };
}

// 碎片的位移曲線。舊版是等速直線（位移 ∝ flight），只有一個「噴散力道」同時
// 決定初速與最終距離 —— 兩件事綁死，而且完全沒有真實碎片該有的減速。拆成三個
// 彼此獨立的軸：
//   擴散範圍 shatterRange —— f=1 時散到多遠，與曲線形狀無關
//   噴發減速 shatterDecel —— 運動曲線的前傾程度。0＝等速，愈大愈接近「一瞬間
//                            衝出去再慢下來」
//   力道差異 shatterSpeedVary —— 每顆碎片快慢／遠近的參差
//
// shape(f) = 1 - (1-f)^k 恆通過 (0,0) 與 (1,1)，所以調減速只改過程、不改最終
// 散開的大小，兩個滑桿不會互相干擾 —— 這正是舊版做不到的地方。
//
// 附帶一個連貫性上的好處：k>1 時 shape'(1)=0，碎片會自己減速到停，剛好接上重組
// 期把位移收回的動作；舊版是等速飛到底再被 keep 硬生生拉回來。
function shatterTravel(f) {
  const k = 1 + Math.max(0, P.shatterDecel) * 5;
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, f)), k);
}

// 碎片的彈道位移：從造型中心往外炸開（每顆錨點自己的方向），加上往下累積的
// 重力。重組期把位移整個收回 0，所以最後一定回得到錨點上。
function shatterOffset(anchor, seed, timeline, out) {
  let dx = anchor.x, dy = anchor.y, dz = anchor.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.001) {
    // 錨點正好落在中心時沒有向外的方向可用，改用亂數方向，否則它會原地不動。
    dx = seed.h1 - 0.5; dy = seed.h2 - 0.5; dz = seed.h3 - 0.5;
  } else {
    dx /= length; dy /= length; dz /= length;
  }
  // 每顆碎片散開的遠近略有差異，且噴散方向帶一點亂數擾動，避免整批像同心圓膨脹。
  // 差異 0.45 時是 0.55~1.45 倍，與舊版寫死的 (0.55 + h1 * 0.9) 完全等價。
  const vary = 1 + (seed.h1 - 0.5) * 2 * P.shatterSpeedVary;
  const reach = P.shatterRange * Math.max(0.05, vary);
  const jitter = 0.35;
  const vx = (dx + (seed.h2 - 0.5) * jitter) * reach;
  const vy = (dy + (seed.h3 - 0.5) * jitter) * reach;
  const vz = (dz + (seed.h1 - 0.5) * jitter) * reach * 0.8;
  const f = timeline.flight;
  const travel = timeline.travel;
  // 重力照舊用 f² 而不是 travel²：空氣阻力讓橫向衝勢慢下來，但下墜是另一回事，
  // 仍然隨時間平方累積。減速調大時碎片會先衝出去、停住、然後繼續往下掉。
  const fall = P.shatterGravity * f * f * 0.9;
  const keep = 1 - timeline.reform;
  return out.set(
    anchor.x + vx * travel * keep,
    anchor.y + (vy * travel - fall) * keep,
    anchor.z + vz * travel * keep,
  );
}

// 形狀本身的可見度：崩解前滿值，炸開時讓位給碎片，重組期再長回來。兩端都是 1，
// 所以 phase=0 與 phase=1 的畫面完全相同。
function shatterShapeAmount(timeline) {
  // 形狀的重新長出刻意落後碎片的回收一段：兩者同步的話，碎片還飄在遠處時
  // 造型就已經幾乎補滿，看起來像憑空冒出一個鬼影，而不是被碎片重新填回去。
  return Math.max(1 - timeline.shapeOut, smoothstepCPU(timeline.reform, 0.4, 1));
}

// 碎片的基準大小一律由「它代表的那塊造型有多厚」決定，而不是沿用其他模式那個
// 與形狀無關的全域水滴大小。這是「炸開瞬間主體會變形」的根治：舊版主滴半徑
// 0.166–0.260、微滴只有 0.089–0.098（實測差 2.65 倍、體積 18.6 倍），主滴在
// 問號那種細筆畫上等於長出三倍粗的球，形狀還沒退場就先被撐出一個包。
//
// 「水滴大小」滑桿在這個模式退化成整體乘數（最小值 0.25 = 原尺寸）；碎片之間
// 的大小差異改由「碎片大小差異」控制，且是乘在各自的局部厚度上，所以厚的地方
// 剝下大塊、細的地方是小屑，不會有哪一顆突出到輪廓外。
function shatterFragmentRadius(anchor, h) {
  const thickness = anchor.thickness || anchor.radiusHint || 0.1;
  const variety = 1 + (h - 0.5) * 2 * P.shatterVariety;
  return thickness * (P.radius / SHATTER_RADIUS_BASE) * Math.max(0.2, variety);
}

// 碎片半徑：炸開瞬間由 0 長出，飛行途中依「碎片消散」縮小，重組期收回 0。
function shatterRadius(base, timeline) {
  return base * timeline.burst * (1 - timeline.flight * P.shatterFade)
    * (1 - timeline.reform);
}

function formationReleaseAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  return smoothstepCPU(phase, holdEnd, 0.98);
}

// 每顆水滴的自由段只使用整數諧波，因此 phase=0/1 的位置與速度完全相同。
// 匯集與散開共用同一個 formationAmount，故兩段是同一路徑的正反向。
// 匯聚前的自由飛行軌道。原本每顆水滴共用同一組 sin/cos 相位，只有起始角不同，
// 於是整群一律同方向繞行、又都在同一個軌道平面上，看起來像一塊剛體在轉。
// formationVariety 讓每顆各自決定旋轉方向與軌道平面傾角。
//
// 方向只取 ±1、諧波仍然只用整數倍，所以 phase=0/1 的位置與速度依舊完全相同 ——
// 循環接縫不會跳（跟 weaveDropPosition 是同一條限制）。
const freeOrbitVec = new THREE.Vector3();
function freeOrbitPosition(a, anchor, orbit, h2, h3, tune, out) {
  const variety = Math.max(0, Math.min(1, P.formationVariety));
  // h3 < variety/2 的那些反向繞行：variety=0 時沒有任何一顆反向，=1 時約半數。
  const spin = a * (h3 < variety * 0.5 ? -1 : 1);
  const radial = 1 + (h2 - 0.5) * variety * 0.6;
  const x = (Math.cos(spin + anchor) * orbit
    + Math.cos(spin * 2 + anchor * tune.x2) * orbit * tune.ax2) * radial;
  const y = (Math.sin(spin + anchor) * orbit * tune.y1
    + Math.sin(spin * 3 + anchor * tune.y3) * orbit * tune.ay3) * radial;
  const z = Math.sin(spin * 2 + anchor * tune.z2) * orbit * tune.az2 * radial;
  // 繞 X 軸把整條軌道傾斜；y/z 一起轉，軌道本身的形狀不變，只是換了個平面。
  const tilt = (h3 - 0.5) * variety * Math.PI;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return out.set(x, y * ct - z * st, y * st + z * ct);
}
const MAIN_ORBIT_TUNE = { x2: 1.7, ax2: 0.12, y1: 0.62, y3: 0.8, ay3: 0.08, z2: 1.3, az2: 0.48 };
const MICRO_ORBIT_TUNE = { x2: 1.3, ax2: 0.16, y1: 0.72, y3: 0.7, ay3: 0.10, z2: 1.9, az2: 0.52 };

function formationDropPosition(i, phase, count, out) {
  const tau = Math.PI * 2;
  const a = phase * tau;
  const { h1, h2, h3 } = dropSeeds[i];
  const anchor = i * tau / count + h1 * 1.4;
  const orbit = P.spread * (1.25 + h2 * 0.65);
  const free = freeOrbitPosition(a, anchor, orbit, h2, h3, MAIN_ORBIT_TUNE, freeOrbitVec);
  const freeX = free.x, freeY = free.y, freeZ = free.z;
  const target = formationAnchors.length
    ? formationAnchors[i % formationAnchors.length]
    : null;
  const amount = formationAmount(phase);
  const eased = amount * amount * (3 - 2 * amount);
  const tx = target ? target.x : Math.cos(anchor) * 0.7;
  const ty = target ? target.y : Math.sin(anchor) * 0.7;
  const tz = target ? target.z : 0;
  return out.set(
    freeX + (tx - freeX) * eased,
    freeY + (ty - freeY) * eased,
    freeZ + (tz - freeZ) * eased,
  );
}

// 穿梭環繞：每顆水滴分到一個表面錨點當「家」，然後用整數諧波的 sin/cos
// 組合（跟 formationDropPosition 的自由段同一手法）在家的附近小幅飄浮，
// 不精確衝向任何目標點——參考的泡泡影片裡，泡泡是懸浮在原地輕輕晃動、
// 大小各異，不是沿明確路徑移動。整數諧波保證 phase=0/1 時位置與速度完全
// 相同，循環接縫不會跳；h1/h2/h3 錯開每顆水滴的頻率相位，才不會一起同步晃。
function weaveDropPosition(i, phase, out) {
  const pool = weaveSurfaceAnchors.length ? weaveSurfaceAnchors : formationAnchors;
  if (!pool.length) return out.set(0, 0, 0);
  const { h1, h2, h3 } = dropSeeds[i];
  const home = pool[Math.floor(h2 * pool.length) % pool.length];
  // 速度只能用整數倍率：sin(k·phase·2π) 對整數 k 而言在 phase=0/1 仍完全同值，
  // 换成非整數會在循環接縫留下跳變。
  const speed = Math.max(1, Math.round(P.weaveDriftSpeed));
  const a = phase * TAU * speed;
  const driftScale = (0.14 + h1 * 0.12) * P.weaveDriftAmount;
  const wx = Math.cos(a + h1 * TAU) * driftScale
    + Math.cos(a * 2 + h3 * TAU) * driftScale * 0.4;
  const wy = Math.sin(a * 2 + h2 * TAU) * driftScale * 0.8
    + Math.sin(a * 3 + h1 * TAU) * driftScale * 0.3;
  const wz = Math.sin(a + h3 * TAU) * driftScale * 0.6;
  return out.set(home.x + wx, home.y + wy, home.z + wz);
}

const formationPosNow = new THREE.Vector3();
const formationPosBefore = new THREE.Vector3();
const formationPosAfter = new THREE.Vector3();

function updateMicroDrops(phase, fidelityAbsorb = 0) {
  // 崩解噴濺不走匯聚管線，但微滴群正好是最好用的碎片來源（20 顆，是主滴的
  // 近兩倍），所以它也要把微滴開起來，只是位置改由彈道決定。
  const shattering = P.motion === 'shatter';
  const activeCount = (isFormationMotion(P.motion) || shattering) && shapeField
    ? Math.max(0, Math.min(MAX_MICRO_DROPS, Math.round(P.microCount)))
    : 0;
  const amount = formationAmount(phase);
  const shatter = shattering ? shatterTimeline(phase) : null;
  const shatterAnchors = shattering ? shatterAnchorSets().micro : null;
  const a = phase * Math.PI * 2;
  for (let i = 0; i < MAX_MICRO_DROPS; i++) {
    const o = i * 4;
    if (i >= activeCount || !(shattering ? shatterAnchors : microFormationAnchors).length) {
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
    const anchor = i * Math.PI * 2 / activeCount + h1 * 0.8;
    const orbit = P.spread * (1.15 + h2 * 0.75);
    const free = freeOrbitPosition(a, anchor, orbit, h2, h3, MICRO_ORBIT_TUNE, freeOrbitVec);
    const freeX = free.x, freeY = free.y, freeZ = free.z;
    // 錯開抵達時間，讓形狀像被液滴逐區域填滿，而不是所有粒子同步縮放。
    const arriveStart = 0.04 + h3 * 0.30;
    const arriveEnd = 0.62 + h3 * 0.20;
    const local = smoothstepCPU(amount, arriveStart, arriveEnd);
    const eased = local * local * (3 - 2 * local);
    const target = microFormationAnchors[i % microFormationAnchors.length];
    const insetScale = 1 - fidelityAbsorb * 0.20;
    microDropData[o] = (freeX + (target.x - freeX) * eased) * insetScale;
    microDropData[o + 1] = (freeY + (target.y - freeY) * eased) * insetScale;
    microDropData[o + 2] = (freeZ + (target.z - freeZ) * eased) * insetScale;
    const targetRadius = target.radiusHint || P.radius * (0.28 + h2 * 0.16);
    // 自由飛行時仍是清楚可見的小滴；抵達後保留完整體積成為最終造型的一部分。
    // 半徑與位置共用相同 local，因此不會再出現「先縮掉、模型才淡入」。
    const freeRadius = targetRadius * (0.52 + h2 * 0.16);
    microDropData[o + 3] = (freeRadius + (targetRadius - freeRadius) * eased)
      * (1 - fidelityAbsorb);
    const axis = target.axis || formationPosNow.set(1, 0, 0);
    microShapeData[o] = axis.x;
    microShapeData[o + 1] = axis.y;
    microShapeData[o + 2] = axis.z;
    microShapeData[o + 3] = 1 + ((target.stretch || 1) - 1) * eased;
  }
  if (microDropTexture) microDropTexture.needsUpdate = true;
  if (microShapeTexture) microShapeTexture.needsUpdate = true;
  return activeCount;
}

function updateNegativeDrops(phase, fidelityAbsorb = 0) {
  // 空腔（負滴）是形狀的一部分，不是水滴的一部分。崩解噴濺沒有匯聚包絡可讀，
  // 直接跟著形狀本身的可見度走：炸開後形狀不在，空腔自然也不該留在畫面上。
  const amount = P.motion === 'shatter'
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
    negativeDropData[o] = target.x;
    negativeDropData[o + 1] = target.y;
    negativeDropData[o + 2] = target.z;
    negativeDropData[o + 3] = (target.radiusHint || 0.09) * amount
      * (1 - fidelityAbsorb);
  }
  if (negativeDropTexture) negativeDropTexture.needsUpdate = true;
  return Math.min(selected.length, MAX_NEGATIVE_DROPS);
}

function cinematicTimeline(phase) {
  // 12 秒敘事，節奏配平：停留 → 蓄力 → 拉斷 → 漂浮 → 靠近 → 接觸融合 → 毛細平復 → 停留。
  // 位置與體積分開控制：聚合時 approach 幾乎收滿距離，最後由表面接觸完成融合。
  // 分裂與融合各自擁有一次守恆的毛細事件（recoil / coalesce），維持敘事對稱。
  const anticipation = cyclicPulse(phase, 0.09, 0.05);
  const pull = smoothstepCPU(phase, 0.10, 0.19);
  const detach = smoothstepCPU(phase, 0.18, 0.26);
  // 靠近提前到 0.50，把原本 ~4 秒的空拍漂浮段壓成與分裂段對稱的長度。
  const approach = smoothstepCPU(phase, 0.50, 0.66);
  const absorb = smoothstepCPU(phase, 0.66, 0.80);
  const contact = smoothstepCPU(phase, 0.60, 0.70)
    * (1 - smoothstepCPU(phase, 0.80, 0.88));

  const volumeSeparation = smoothstepCPU(phase, 0.135, 0.26) * (1 - absorb);
  const travelOut = smoothstepCPU(phase, 0.13, 0.27);
  // approach 收到 0.92：保留真實接觸殘距（兩滴接觸時球心相距約 r1+r2，不重合），
  // 剩餘閉合交給 absorb 期子滴收縮，讀起來是「表面貼合後排液」而非「原地被吸乾」。
  const distanceSeparation = travelOut
    * (1 - approach * 0.92)
    * (1 - absorb);

  const recoilProgress = Math.max(0, Math.min(1, (phase - 0.19) / 0.17));
  // raised-cosine（Hann）脈衝取代半正弦：峰值與時機不變，但兩端斜率為 0。
  // sin(π·x) 在 clamp 邊界（分離起點 phase 0.19）斜率從 0 突跳到 π/0.17，
  // 是 C1 不連續 → 無限 jerk（加速度脈衝），視覺上就是分離瞬間那下不自然的猛晃。
  const recoil = 0.5 * (1 - Math.cos(2 * Math.PI * recoilProgress));
  const splitProgress = Math.max(0, Math.min(1, (phase - 0.11) / 0.18));
  const splitShape = 0.5 * (1 - Math.cos(2 * Math.PI * splitProgress))
    * (1 - smoothstepCPU(phase, 0.29, 0.36));

  // 融合毛細震盪進度：接觸建立後（~0.62）發源，於 absorb 完成（0.80，接觸軸退化）前
  // ring-down 歸零；尾段為 0 亦維持循環週期性。
  const coalesce = Math.max(0, Math.min(1, (phase - 0.62) / 0.18));

  return {
    anticipation,
    pull,
    detach,
    approach,
    absorb,
    contact,
    volumeSeparation,
    distanceSeparation,
    recoil,
    splitShape,
    coalesce,
  };
}

// 水滴動畫只在 CPU 每幀計算一次；shader 的每個 march step 僅讀取 vec4 array。
function updateDropUniforms(t) {
  // 水滴數量可以是 0（例如崩解噴濺只想要微滴碎片、穿梭環繞只想留形狀本身）。
  // count 本身允許 0，交給 uCount 讓 shader 直接跳過主滴迴圈；但凡是拿它當
  // 除數或版面基準的地方一律改用 layoutCount，否則 0 會變成 Infinity／NaN。
  const count = Math.max(0, Math.min(MAX_DROPS, Math.round(P.count)));
  const layoutCount = Math.max(1, count);
  const tau = Math.PI * 2;
  const phase = fract(t / Math.max(0.001, P.loopDuration));
  const a = phase * tau;
  const energy = 0.55 + P.flowSpeed * 0.9;
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
  const formationShapeProgress = !shapeField
    ? 0
    : P.motion === 'weave'
      ? 1
      : shatter
        ? shatterShapeAmount(shatter)
        : isFormationMotion(P.motion)
          // 回程使用同一個體積交接進度：模型從第一幀開始退、水滴同步長回。
          // 舊版先維持完整模型、再集中侵蝕，會形成「模型上冒球後突然塌掉」。
          ? releasingShape
            // 在水滴完全散開前清掉最後的模型核心，避免循環尾端留下 SDF 碎片。
            ? 1 - smoothstepCPU(releaseTransfer, 0.0, 0.84)
            : smoothstepCPU(amount, 0.42, 0.96)
          : 0;
  // 模型已大致長成後，讓可見水滴在目標體積內連續被 SDF 吸收。
  // 最後輪廓只剩匯入模型場；吸收在模型完成前不啟動，避免「水滴先縮、模型才出現」。
  const microCount = updateMicroDrops(phase, fidelityAbsorb);
  const negativeCount = updateNegativeDrops(phase, fidelityAbsorb);

  const cinema = cinematicTimeline(phase);
  const separation = cinema.volumeSeparation;
  const merge = 1 - separation;
  const tension = cinema.pull * (1 - cinema.detach);
  const breakaway = cinema.recoil;
  const bounceProgress = Math.max(0, Math.min(1, (phase - 0.19) / 0.17));
  // 只保留一次小幅回彈；不再疊加多週正負振盪。
  const followThrough = breakaway * Math.sin(bounceProgress * Math.PI * 2)
    * Math.exp(-3.2 * bounceProgress);
  // 滑桿值仍是基準黏度；電影模式依事件暫時改變融合半徑。
  // 接觸時增黏，拉伸時開始收頸，斷裂時快速卸除 smooth-min 的連接。
  let viscosityScale = P.motion === 'cinematic'
    ? Math.max(0.35, 1 + merge * 0.15 - tension * 0.25 - breakaway * 0.55)
    // 崩解噴濺同樣是「一次出現很多顆」，需要同一套正規化，否則炸開那一瞬間
    // 8 顆滿半徑的碎片會被 smooth-min 黏成一大團而不是各自剝離。
    : isFormationMotion(P.motion) || P.motion === 'shatter'
      // smooth-min 連續合併很多顆時會累積膨脹；依數量正規化融合半徑，
      // 讓 12–16 顆仍只在真正接觸處形成液橋，不把整組擴成巨大距離場。
      ? Math.max(0.10, 0.42 / Math.sqrt(layoutCount))
      : 1;
  let effectiveViscosity = P.viscosity * viscosityScale;
  const groupX = Math.sin(a) * P.spread * 0.12 * energy;
  const groupY = Math.sin(a * 2 + 0.4) * P.spread * 0.08 * energy;
  const groupZ = Math.cos(a) * P.spread * 0.07 * energy;

  for (let i = 0; i < MAX_DROPS; i++) {
    const { h1, h2, h3, radius } = dropSeeds[i];
    let x = 0, y = 0, z = 0, radiusFactor = 1;
    // 崩解噴濺的半徑不走 freeRadius 那條（見 shatterFragmentRadius），改記下
    // 這顆碎片配到的錨點，等下面統一由它的局部厚度算大小。
    let shatterTarget = null;

    if (P.motion === 'cinematic') {
      // 所有水滴共用同一個緩慢旋轉的分離軸；不再各自沿亂數弧線交叉碰撞。
      const anchor = i * tau / layoutCount + Math.sin(a) * 0.18;
      const radial = P.spread * (1.04 + h2 * 0.06) * energy;
      const recoil = 1 + breakaway * (0.11 + h2 * 0.018)
        + followThrough * (0.035 + h3 * 0.012);
      const actionScale = cinema.distanceSeparation * recoil;
      x = groupX + Math.cos(anchor) * radial * actionScale;
      y = groupY + Math.sin(anchor) * radial * 0.24 * actionScale;
      z = groupZ + Math.sin(anchor) * radial * 0.52 * actionScale;
      // 形變本身已近似守恆體積，避免再用半徑做一次「呼吸」而產生橫向縮放感。
      radiusFactor = 1 + cinema.anticipation * 0.01
        + breakaway * 0.006 + followThrough * 0.004;
    } else if (P.motion === 'weave') {
      weaveDropPosition(i, phase, formationPosNow);
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
    } else if (isFormationMotion(P.motion)) {
      const formation = amount;
      formationDropPosition(i, phase, layoutCount, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      radiusFactor = 0.82 + formation * 0.18;
    }
    // 大滴受重力與慣性影響較明顯；常量位移不破壞循環接縫。
    y -= P.gravity * P.spread * 0.045 * Math.pow(radius, 1.35);
    if (isFormationMotion(P.motion)) {
      // anchor 可能落在模型表層；吸收時稍微往模型中心推入，避免半徑縮小後
      // 先失去液橋、在輪廓旁短暫留下孤立小球。
      const insetScale = 1 - fidelityAbsorb * 0.20;
      x *= insetScale;
      y *= insetScale;
      z *= insetScale;
    }
    const freeRadius = P.radius * radius * radiusFactor;
    if (shatter) {
      const fragment = shatterTarget
        ? shatterFragmentRadius(shatterTarget, h3)
        : 0;
      dropData[i].set(x, y, z, shatterRadius(fragment, shatter));
    } else if (isFormationMotion(P.motion)) {
      const targetRadius = formationAnchors[i % Math.max(1, formationAnchors.length)]?.radiusHint
        || P.radius * 0.58;
      const settle = smoothstepCPU(formationAmount(phase), 0.12, 0.88);
      dropData[i].set(
        x,
        y,
        z,
        (freeRadius + (targetRadius - freeRadius) * settle) * (1 - fidelityAbsorb),
      );
    } else {
      dropData[i].set(x, y, z, freeRadius);
    }
  }

  // 電影模式的合體狀態是真正的一顆母滴：其餘水滴由零半徑連續長出，而不是讓
  // 多顆完整半徑的 SDF 重疊後再突然解鎖。以 q^3 轉移體積，子滴半徑會隨 q
  // 近似線性增長，同時嚴格維持總體積，輪廓便能自然經過鼓包、細頸、斷裂。
  if (P.motion === 'cinematic' && count > 1) {
    const childVolumeProgress = separation * separation * separation;
    let transferredVolume = 0;
    for (let i = 1; i < count; i++) {
      const targetRadius = dropData[i].w;
      const targetVolume = targetRadius ** 3;
      transferredVolume += targetVolume * (1 - childVolumeProgress);
      dropData[i].w = targetRadius * separation;
    }
    const primaryTargetRadius = dropData[0].w;
    dropData[0].w = Math.cbrt(primaryTargetRadius ** 3 + transferredVolume);
  }

  // 電影敘事期間鎖定主配對，避免多滴的最近距離交替造成形變軸跳動。
  // 其他模式仍使用即時最近配對。
  let pairA = 0, pairB = Math.min(1, count - 1), pairDistance = Infinity, surfaceGap = Infinity;
  if (count >= 2 && P.motion === 'cinematic') {
    const da = dropData[pairA], db = dropData[pairB];
    pairDistance = Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z);
    surfaceGap = pairDistance - da.w - db.w;
  } else {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const di = dropData[i], dj = dropData[j];
        const distance = Math.hypot(di.x - dj.x, di.y - dj.y, di.z - dj.z);
        const gap = distance - di.w - dj.w;
        if (gap < surfaceGap) {
          pairA = i; pairB = j; pairDistance = distance; surfaceGap = gap;
        }
      }
    }
  }

  const frameDt = previousDropT == null || t < previousDropT
    ? 0 : Math.min(0.05, Math.max(0.0001, t - previousDropT));
  const pairKey = `${pairA}:${pairB}`;
  const gapVelocity = frameDt > 0 && pairKey === previousPairKey
    ? (surfaceGap - previousPairGap) / frameDt : 0;
  const contactRange = Math.max(0.12, P.viscosity * 0.55);
  const contactAmount = count >= 2
    ? 1 - smoothstepCPU(surfaceGap, 0.015, contactRange) : 0;
  const drainageHold = contactAmount * merge;
  const separationSpeed = Math.max(0, gapVelocity);
  // 電影模式由體積轉移本身完成分裂／融合，不再額外鎖中心或複製合體半徑。
  // 額外的 fusion lock 正是先縮放、再雙葉化的第二套互相衝突的形變來源。
  const fusionLock = 0;
  const fusionAmount = Math.max(drainageHold, fusionLock);
  let pairAxisX = 1, pairAxisY = 0, pairAxisZ = 0;

  // 非電影模式仍可依實際接觸做黏性融合；電影模式已在上方守恆轉移體積。
  if (!isFormationMotion(P.motion) && P.motion !== 'cinematic' && count >= 2 && fusionAmount > 0) {
    const da = dropData[pairA], db = dropData[pairB];
    const axisX = db.x - da.x, axisY = db.y - da.y, axisZ = db.z - da.z;
    const axisInv = 1 / Math.max(0.0001, Math.hypot(axisX, axisY, axisZ));
    pairAxisX = axisX * axisInv; pairAxisY = axisY * axisInv; pairAxisZ = axisZ * axisInv;
    const midX = (da.x + db.x) * 0.5;
    const midY = (da.y + db.y) * 0.5;
    const midZ = (da.z + db.z) * 0.5;
    da.x += (midX - da.x) * fusionLock; db.x += (midX - db.x) * fusionLock;
    da.y += (midY - da.y) * fusionLock; db.y += (midY - db.y) * fusionLock;
    da.z += (midZ - da.z) * fusionLock; db.z += (midZ - db.z) * fusionLock;
    const radiusA = dropData[pairA].w, radiusB = dropData[pairB].w;
    const mergedRadius = Math.cbrt(radiusA ** 3 + radiusB ** 3);
    dropData[pairA].w += (mergedRadius - radiusA) * fusionAmount;
    dropData[pairB].w += (mergedRadius - radiusB) * fusionAmount;
  }

  // 實際接觸距離修正事件黏性：壓平時增黏，頸部拉伸與快速分離時卸黏。
  if (P.motion === 'cinematic' && count >= 2) {
    viscosityScale = Math.max(0.35,
      1 + cinema.contact * 0.2 - tension * 0.18
      - breakaway * (0.42 + Math.min(0.1, separationSpeed * 0.035)));
    effectiveViscosity = P.viscosity * viscosityScale;
  }
  // 穿梭環繞的物體要維持獨立完整、不是由水滴組成的材質——水滴是另外一批
  // 獨立球體，只在循環軌跡上貼著/穿過它的表面。融合半徑不能沿用形狀匯聚那種
  // 「黏性液體徹底融成一坨」的手感，水滴彼此、水滴與物體之間的 smooth-min
  // 半徑都要收到只剩貼合處一點點圓角，其餘時間各自維持清楚的球體輪廓。
  // 崩解噴濺同理，而且更嚴格：碎片一旦離開母體就該是各自獨立、邊緣清楚的液滴，
  // 不是一團彼此牽絲的黏液。但炸開的瞬間它們還在造型上，那一刻保留正常黏性才
  // 看得出「從表面剝離」，所以依飛行進度連續收緊，而不是一開始就切到最小。
  const mergeScale = P.motion === 'weave'
    ? 0.15
    : shatter
      ? 1 + (0.15 - 1) * shatter.flight
      : 1;
  if (uniforms) uniforms.uViscosity.value = effectiveViscosity * mergeScale;
  if (uniforms) {
    uniforms.uShapeProgress.value = formationShapeProgress;
    uniforms.uFidelityAbsorb.value = fidelityAbsorb;
    uniforms.uShapeSwell.value = shatter ? shatter.swell : 0;
    uniforms.uShapeScale.value = 1 + holdBreathScale(phase);
    uniforms.uContactLead.value = shatter ? 0 : 1;
    // 半徑已連續收至零後才停止 shader 迴圈；切換當下幾何場完全相同。
    const fidelityComplete = fidelityAbsorb > 0.9999;
    uniforms.uCount.value = fidelityComplete ? 0 : count;
    uniforms.uMicroCount.value = fidelityComplete ? 0 : microCount;
    uniforms.uNegativeCount.value = fidelityComplete ? 0 : negativeCount;
    // 完成時保留最多 0.02 的薄層，封住體素化在眼窩等薄區域產生的非原始孔洞；
    // 若使用者明確設為 0 仍尊重原值，不強制膨脹模型。
    const finalSurfaceGuard = Math.min(P.shapeSoftness, 0.02);
    uniforms.uShapeSoftness.value = P.shapeSoftness * (1 - fidelityAbsorb)
      + finalSurfaceGuard * fidelityAbsorb;
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
    if (isFormationMotion(P.motion)) {
      const epsilon = 1 / 2048;
      formationDropPosition(i, fract(phase - epsilon), layoutCount, formationPosBefore);
      formationDropPosition(i, fract(phase + epsilon), layoutCount, formationPosAfter);
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
    let flatten = 0, shapeOscillation = 0, tip = 0, paired = 0;

    if (P.motion === 'cinematic' && count >= 2 && (i === pairA || i === pairB)) {
      const other = dropData[i === pairA ? pairB : pairA];
      const dx = other.x - d.x, dy = other.y - d.y, dz = other.z - d.z;
      const invDistance = 1 / Math.max(0.0001, Math.hypot(dx, dy, dz));
      const contactAxisX = dx * invDistance;
      const contactAxisY = dy * invDistance;
      const contactAxisZ = dz * invDistance;
      // 完全分離時沿速度方向形變；只有事件或接觸期間才轉向兩滴之間的軸線。
      // 電影模式回彈期把形變軸完全鎖到 contactAxis（法線），確保斷裂尖端嚴格沿法線
      // 回彈、不隨殘餘速度分量抖動；breakaway 為 C1 的 Hann，鎖定權重本身平滑。
      const breakawayLock = P.motion === 'cinematic' ? breakaway : breakaway * 0.85;
      const pairInfluence = Math.min(1,
        Math.max(contactAmount, fusionLock, tension, breakawayLock));
      // 分離時速度軸 ≈ −contactAxis（往外飛，背向另一顆）；直接線性混向法線會在中途
      // 抵消成零向量，使 normalize 病態、尖端指向翻面而抖動。先把速度軸翻到與法線
      // 同半球再混合。尖端(physics.z)只在 +axis 極點，故軸的正負號需與法線一致；
      // 拉伸(longScale)對稱、drift 期無尖端，翻號不影響外觀。
      if (ax * contactAxisX + ay * contactAxisY + az * contactAxisZ < 0) {
        ax = -ax; ay = -ay; az = -az;
      }
      ax += (contactAxisX - ax) * pairInfluence;
      ay += (contactAxisY - ay) * pairInfluence;
      az += (contactAxisZ - az) * pairInfluence;
      const axisLength = Math.max(0.0001, Math.hypot(ax, ay, az));
      ax /= axisLength; ay /= axisLength; az /= axisLength;
      const physicalStretch = stretch
        + tension * (0.12 + P.surfaceTension * 0.05)
        + breakaway * 0.055;
      if (P.motion === 'cinematic') {
        // 電影模式由單一包絡擁有長軸形變；速度只提供少量次級慣性。
        const designedStretch = 1
          + cinema.splitShape * (0.085 + P.surfaceTension * 0.025)
          + cinema.contact * (0.025 + P.surfaceTension * 0.012);
        stretch = designedStretch + (physicalStretch - 1) * 0.22;
      } else {
        stretch = physicalStretch;
      }
      // 壓平只在聚合接觸／排液期發生，不再於分裂與融合兩側各出現一次。
      const drainageTransition = contactAmount * (P.motion === 'cinematic'
        ? cinema.contact
        : Math.sin(Math.PI * merge));
      flatten = drainageTransition * (0.55 + P.surfaceTension * 0.2);
      // 電影模式用平滑解析包絡驅動尖端回彈，與逐幀量測的 separationSpeed 解耦，
      // 避免量測噪聲讓尖頭幅度抖動；非電影模式仍依實際分離速度觸發。
      tip = P.motion === 'cinematic'
        ? breakaway * Math.exp(-4.2 * bounceProgress)
        : breakaway * Math.exp(-4.2 * bounceProgress)
          * smoothstepCPU(separationSpeed, 0.02, 0.35);
      // Q 彈：擾動後整顆果凍震盪，經 physics.y 調變長軸；shader 以
      // transverseScale=1/√longScale 補償橫向 → 體積守恆的 prolate↔oblate 脈動。
      // 振幅用 C1 的事件包絡（breakaway 的 Hann / 融合 settle 的 Hann），兩端斜率為 0，
      // 事件內與循環接縫都無跳變；頻率隨滴徑 √(σ/R³) 提高，小滴抖得快、符合物理。
      if (P.motion === 'cinematic') {
        const jellyFreq = Math.sqrt(0.54 / Math.max(0.2, d.w));
        const wobbleGain = 0.45 + P.elasticStrength * 4.5;
        // 分裂回彈：斷裂後盪約兩下收斂。
        const sepWobble = breakaway
          * Math.sin(2 * Math.PI * (2.3 * jellyFreq) * bounceProgress);
        // 融合著陸：獨立於 coalesce，延伸到 absorb 完成後的 hold 段（0.74→0.98）平復，
        // 於接縫前歸零。
        const settleProg = Math.max(0, Math.min(1, (phase - 0.74) / 0.24));
        const settleEnv = 0.5 * (1 - Math.cos(2 * Math.PI * settleProg));
        const mergeWobble = settleEnv
          * Math.sin(2 * Math.PI * (2.0 * jellyFreq) * settleProg);
        shapeOscillation = Math.max(-1.2, Math.min(1.2,
          (sepWobble + mergeWobble * 1.1) * wobbleGain));
      }
      paired = 1;
      // 鎖定合體後兩個 SDF 使用完全相同的主軸與伸縮，視覺上成為單一液滴。
      ax += (pairAxisX - ax) * fusionLock;
      ay += (pairAxisY - ay) * fusionLock;
      az += (pairAxisZ - az) * fusionLock;
      stretch += (1 - stretch) * fusionLock;
      flatten *= 1 - fusionLock;
    }
    dropShapeData[i].set(ax, ay, az, stretch);
    dropPhysicsData[i].set(flatten, shapeOscillation, tip, paired);
  }
  for (let i = count; i < MAX_DROPS; i++) {
    dropShapeData[i].set(1, 0, 0, 1);
    dropPhysicsData[i].set(0, 0, 0, 0);
  }

  // 以實際 SDF 頸部是否斷裂觸發毛細波，並把活動配對傳給 shader。
  if (P.motion === 'cinematic' && count >= 2) {
    elasticPair.set(pairA, pairB);
    const neckGap = pairDistance - dropData[pairA].w - dropData[pairB].w
      - effectiveViscosity * 0.5;
    const detachGate = smoothstepCPU(neckGap, 0, 0.08);
    const progress = Math.max(0, Math.min(1, (phase - 0.19) / 0.20));
    const pulse = Math.sin(Math.PI * progress);
    const sizeFrequency = Math.sqrt(0.54 / Math.max(0.2,
      (dropData[pairA].w + dropData[pairB].w) * 0.5));
    const detachEnvelope = detachGate * pulse * pulse * P.surfaceTension
      * Math.pow(1 - progress, 0.25 + P.elasticDamping * 1.5);

    // 毛細回彈波只在分裂（pinch-off）發生；融合為平順接合，不再產生回彈漣漪。
    elasticEvent.set(detachEnvelope, Math.min(1, progress * sizeFrequency));
    if (uniforms) {
      uniforms.uElasticStrength.value = P.elasticStrength
        * (0.62 + P.surfaceTension * 0.58) / (1 + P.viscosity * 0.32);
      uniforms.uElasticDamping.value = Math.max(0, Math.min(1,
        P.elasticDamping + P.viscosity * 0.12 - P.surfaceTension * 0.06));
      uniforms.uElasticSpeed.value = P.elasticSpeed
        * (0.74 + P.surfaceTension * 0.3) * sizeFrequency;
    }

    // 衛星滴串：在液橋上形成，pinch-off 後保留為自由滴，最後分批被鄰近主滴吸收。
    // 全程由 phase 的解析軌跡驅動，因此播放、拖動時間與循環接縫都不會累積誤差。
    const da = dropData[pairA], db = dropData[pairB];
    const sdx = db.x - da.x, sdy = db.y - da.y, sdz = db.z - da.z;
    const sInv = 1 / Math.max(0.0001, Math.hypot(sdx, sdy, sdz));
    const ux = sdx * sInv, uy = sdy * sInv, uz = sdz * sInv;
    const mx = (da.x + db.x) * 0.5, my = (da.y + db.y) * 0.5, mz = (da.z + db.z) * 0.5;
    // 建立與收頸軸垂直的穩定基底，供二維低頻漂移使用。
    let qx = -uy, qy = ux, qz = 0;
    const qLen = Math.hypot(qx, qy, qz);
    if (qLen < 0.1) { qx = 0; qy = -uz; qz = uy; }
    else { qx /= qLen; qy /= qLen; qz /= qLen; }
    const rx = uy * qz - uz * qy;
    const ry = uz * qx - ux * qz;
    const rz = ux * qy - uy * qx;
    // 在頸部內快速成形；釋放後半徑鎖定，不再跟著仍在長大的子滴一起膨脹。
    const satBirth = smoothstepCPU(phase, 0.18, 0.205);
    const release = smoothstepCPU(phase, 0.235, 0.285);
    const freeAge = Math.max(0, phase - 0.26);
    if (uniforms) uniforms.uSatelliteBlend.value = 0.32 * satBirth * (1 - release);
    const baseR = Math.min(da.w, db.w);
    const satelliteBaseR = P.radius
      * Math.min(dropSeeds[pairA].radius, dropSeeds[pairB].radius);
    const activeSatelliteCount = Math.max(0, Math.min(SAT_N, Math.round(P.satelliteCount)));
    for (let s = 0; s < SAT_N; s++) {
      if (s >= activeSatelliteCount) {
        satelliteDrops[s].set(0, 0, 0, 0);
        continue;
      }
      const spec = SAT_SPEC[s];
      const along = spec.along * baseR;
      const neckJitter = spec.jitter * baseR * satBirth * (1 - release);

      // 低頻連續 noise-like 軌跡；減去起始相位值，確保釋放瞬間位置不跳動。
      const waveQ = Math.sin(spec.seed + freeAge * 16.0) - Math.sin(spec.seed);
      const waveR = Math.sin(spec.seed * 1.73 + freeAge * 11.0)
        - Math.sin(spec.seed * 1.73);
      const driftScale = baseR * release;
      const freeX = mx + ux * (along + spec.drift * baseR * freeAge * 2.2)
        + qx * (neckJitter + waveQ * driftScale * 0.18)
        + rx * waveR * driftScale * 0.12;
      const freeY = my + uy * (along + spec.drift * baseR * freeAge * 2.2)
        + qy * (neckJitter + waveQ * driftScale * 0.18)
        + ry * waveR * driftScale * 0.12;
      const freeZ = mz + uz * (along + spec.drift * baseR * freeAge * 2.2)
        + qz * (neckJitter + waveQ * driftScale * 0.18)
        + rz * waveR * driftScale * 0.12;

      // 小滴先回收，主衛星最後回收；吸收目標依形成位置選擇較近的主滴。
      const absorb = smoothstepCPU(phase, spec.absorbAt, spec.absorbAt + 0.10);
      const target = spec.along < 0 ? da : db;
      const sizeEnvelope = satBirth * (1 - absorb);
      satelliteDrops[s].set(
        freeX + (target.x - freeX) * absorb,
        freeY + (target.y - freeY) * absorb,
        freeZ + (target.z - freeZ) * absorb,
        satelliteBaseR * spec.size * P.satelliteSize * sizeEnvelope,
      );
    }
  } else {
    elasticEvent.set(0, 0);
    for (let s = 0; s < SAT_N; s++) satelliteDrops[s].w = 0;
    if (uniforms) uniforms.uSatelliteBlend.value = 0;
  }

  for (let i = 0; i < count; i++) previousDropPositions[i].set(dropData[i].x, dropData[i].y, dropData[i].z);
  previousDropT = t;
  previousPairKey = pairKey;
  previousPairGap = surfaceGap;

  // smooth-min 與 wobble 都可能讓表面超出單顆球體，因此加入保守 padding。
  const padding = P.viscosity * 1.15 * 0.25 * Math.max(0, count - 1)
    + P.wobble * 0.25 + P.elasticStrength + 0.08;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = dropData[i], r = d.w * Math.max(1, dropShapeData[i].w) + padding;
    minX = Math.min(minX, d.x - r); maxX = Math.max(maxX, d.x + r);
    minY = Math.min(minY, d.y - r); maxY = Math.max(maxY, d.y + r);
    minZ = Math.min(minZ, d.z - r); maxZ = Math.max(maxZ, d.z + r);
  }
  // count=0 時上面的迴圈一次都沒跑，minX/maxX 還是 ±Infinity，相加會得到 NaN
  // 並一路傳進 uDropBounds。沒有主滴就沒有需要涵蓋的範圍，直接退回原點。
  const hasBounds = Number.isFinite(minX);
  const cx = hasBounds ? (minX + maxX) * 0.5 : 0;
  const cy = hasBounds ? (minY + maxY) * 0.5 : 0;
  const cz = hasBounds ? (minZ + maxZ) * 0.5 : 0;
  let boundRadius = 0;
  for (let i = 0; i < count; i++) {
    const d = dropData[i];
    boundRadius = Math.max(boundRadius, Math.hypot(d.x - cx, d.y - cy, d.z - cz)
      + d.w * Math.max(1, dropShapeData[i].w) + padding);
  }
  for (let s = 0; s < SAT_N; s++) {
    const sd = satelliteDrops[s];
    if (sd.w > 0) {
      boundRadius = Math.max(boundRadius,
        Math.hypot(sd.x - cx, sd.y - cy, sd.z - cz) + sd.w + padding);
    }
  }
  dropBounds.set(cx, cy, cz, boundRadius);
  // 穿梭環繞的形狀恆定顯示，射線邊界必須永遠涵蓋整個形狀範圍，不能只依水滴
  // 目前分佈算——水滴群聚集中時，形狀本身仍完整存在，邊界縮小會讓外圍被裁掉。
  if (usesShapeField(P.motion) && shapeField) {
    dropBounds.set(0, 0, 0, Math.max(boundRadius, 2.25));
    for (let i = 0; i < microCount; i++) {
      const o = i * 4;
      dropBounds.w = Math.max(dropBounds.w,
        Math.hypot(microDropData[o], microDropData[o + 1], microDropData[o + 2])
          + microDropData[o + 3] + 0.12);
    }
  }
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

/* ===== 自訂漸層查找表（LUT）===== */
let rampTex = null;
const RAMP_W = 256;
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function readStops() {
  const n = Math.round(parseFloat(document.getElementById('rampCount').value));
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push({
      p: Math.min(1, Math.max(0, parseFloat(document.getElementById('stopPos' + i).value))),
      rgb: hexToRgb(document.getElementById('stopCol' + i).value),
    });
  }
  return stops;
}
// 循環取樣：色標依位置排序，末色與首色跨接縫接回
function sampleStops(stops, t) {
  const n = stops.length;
  if (n === 1) return stops[0].rgb;
  for (let i = 0; i < n; i++) {
    const a = stops[i], b = stops[(i + 1) % n];
    let p0 = a.p, p1 = b.p, tt = t;
    if (i === n - 1) { p1 += 1; if (t < a.p) tt = t + 1; }   // 接縫段
    if (tt >= p0 && tt <= p1) {
      const f = (p1 > p0) ? (tt - p0) / (p1 - p0) : 0;
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f];
    }
  }
  return stops[0].rgb;
}
function buildRampLUT() {
  if (!rampTex) return;
  const stops = readStops().sort((s1, s2) => s1.p - s2.p);
  const data = rampTex.image.data;
  for (let x = 0; x < RAMP_W; x++) {
    const c = sampleStops(stops, x / RAMP_W);
    data[x * 4] = c[0]; data[x * 4 + 1] = c[1]; data[x * 4 + 2] = c[2]; data[x * 4 + 3] = 255;
  }
  rampTex.needsUpdate = true;
}
function makeRampTexture() {
  rampTex = new THREE.DataTexture(new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat);
  rampTex.colorSpace = THREE.SRGBColorSpace;
  rampTex.wrapS = THREE.RepeatWrapping;
  rampTex.wrapT = THREE.ClampToEdgeWrapping;
  rampTex.minFilter = THREE.LinearFilter;
  rampTex.magFilter = THREE.LinearFilter;
  rampTex.generateMipmaps = false;
  buildRampLUT();
  return rampTex;
}

/* ===== 虛擬光譜焦散七色查找表 ===== */
let spectralCausticTex = null;
function readSpectralCausticColors() {
  return SPECTRAL_CAUSTIC_DEFAULTS.map((fallback, i) => {
    const input = document.getElementById('spectralCausticCol' + i);
    return hexToRgb(input ? input.value : fallback);
  });
}
function buildSpectralCausticLUT() {
  if (!spectralCausticTex) return;
  const colors = readSpectralCausticColors();
  const data = spectralCausticTex.image.data;
  for (let x = 0; x < RAMP_W; x++) {
    const position = (x / (RAMP_W - 1)) * (colors.length - 1);
    const left = Math.min(colors.length - 1, Math.floor(position));
    const right = Math.min(colors.length - 1, left + 1);
    const mixAmount = position - left;
    for (let channel = 0; channel < 3; channel++) {
      data[x * 4 + channel] = Math.round(
        colors[left][channel] + (colors[right][channel] - colors[left][channel]) * mixAmount
      );
    }
    data[x * 4 + 3] = 255;
  }
  spectralCausticTex.needsUpdate = true;
}
function makeSpectralCausticTexture() {
  spectralCausticTex = new THREE.DataTexture(
    new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat
  );
  spectralCausticTex.colorSpace = THREE.SRGBColorSpace;
  spectralCausticTex.wrapS = spectralCausticTex.wrapT = THREE.ClampToEdgeWrapping;
  spectralCausticTex.minFilter = spectralCausticTex.magFilter = THREE.LinearFilter;
  spectralCausticTex.generateMipmaps = false;
  buildSpectralCausticLUT();
  return spectralCausticTex;
}

function initGL() {
  if (inited) return;
  inited = true;

  // 全螢幕 shader 本身沒有多邊形鋸齒，關閉 MSAA 可省下額外 framebuffer 成本。
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(qualityDpr);

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
    uMaxSteps:   { value: qualitySteps },
    uCount:      { value: Math.round(P.count) },
    uViscosity:  { value: P.viscosity },
    uWobble:     { value: P.wobble },
    uWobbleScale: { value: P.wobbleScale },
    uWobbleSpeed: { value: P.wobbleSpeed },
    uElasticEvent: { value: elasticEvent },
    uElasticStrength: { value: P.elasticStrength },
    uElasticDensity: { value: P.elasticDensity },
    uElasticDamping: { value: P.elasticDamping },
    uElasticSpeed: { value: P.elasticSpeed },
    uDrops:      { value: dropData },
    uDropShape:  { value: dropShapeData },
    uDropPhysics: { value: dropPhysicsData },
    uElasticPair: { value: elasticPair },
    uSatellites: { value: satelliteDrops },
    uSatelliteBlend: { value: 0 },
    uBounds:     { value: dropBounds },
    uThickness:  { value: P.thickness },
    uThickVar:   { value: P.thickVar },
    uNoiseScale: { value: P.noiseScale },
    uDispersion: { value: P.dispersion },
    uDispersionSeparation: { value: P.dispersionSeparation },
    uCausticScale: { value: P.causticScale },
    uCausticSharpness: { value: P.causticSharpness },
    uRealDispersion: { value: P.realDispersion },
    uRealDispersionSeparation: { value: P.realDispersionSeparation },
    uSpectralCausticIntensity: { value: P.spectralCausticIntensity },
    uSpectralCausticFocus: { value: P.spectralCausticFocus },
    uSpectralCausticWidth: { value: P.spectralCausticWidth },
    uSpectralCausticLightSize: { value: P.spectralCausticLightSize },
    uSpectralCausticDensity: { value: P.spectralCausticDensity },
    uSpectralCausticSoftness: { value: P.spectralCausticSoftness },
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
    uSpectralCausticRamp: { value: makeSpectralCausticTexture() },
    uArtThickness: { value: P.artThickness },
    uArtThickVar: { value: P.artThickVar },
    uArtNoiseScale: { value: P.artNoiseScale },
    uArtPatternSpeed: { value: P.artPatternSpeed },
    uArtGravity: { value: P.artGravity },
    uDispersionEnabled: { value: P.dispersionEnabled ? 1 : 0 },
    uRealDispersionEnabled: { value: P.realDispersionEnabled ? 1 : 0 },
    uSpectralCausticEnabled: { value: P.spectralCausticEnabled ? 1 : 0 },
    uFilmEnabled: { value: P.filmEnabled ? 1 : 0 },
    uFilmBlur:   { value: P.filmBlur },
    uSaturation: { value: P.saturation },
    uFresnel:    { value: P.fresnel },
    uGravity:    { value: P.gravity },
    uFlowSpeed:  { value: P.flowSpeed },
    uPatternSpeed: { value: P.patternSpeed },
    uColorMode:  { value: SELECTS.colorMode.map[P.colorMode] },
    uRampTex:    { value: makeRampTexture() },
    uBgMode:     { value: SELECTS.bgMode.map[P.bgMode] },
    uMaterialStyle: { value: SELECTS.materialStyle.map[P.materialStyle] },
    uTransparentBackground: { value: 0 },
    uBgColor:    { value: new THREE.Color(P.bgColor) },
    uBrightBgAssist: { value: P.brightBgAssist ? 1 : 0 },
    uEnvRefraction: { value: P.envRefraction },
    uReflect:    { value: P.reflect },
    uTransmission: { value: P.transmission },
    uMaterialExposure: { value: P.materialExposure },
    uMembraneDepth: { value: P.membraneDepth },
    uRoughness:  { value: P.roughness },
    uIOR:        { value: P.ior },
    uReflectionSampleCount: { value: mobileRenderQuery.matches ? 4 : 8 },
    uHdriYaw:    { value: P.hdriYaw },
    uHdriPitch:  { value: P.hdriPitch },
    uHdriBlur:   { value: P.hdriBlur },
    uEnvMap:     { value: makeBlankEnv() },
    uPmremMap:   { value: pmremTarget.texture },
    uHasEnv:     { value: 0 },
    uShapeType: { value: SELECTS.shapeSource.map[P.shapeSource] },
    uShapeProgress: { value: 0 },
    uFidelityAbsorb: { value: 0 },
    // 崩解噴濺的蓄力膨脹量（等距擴張形狀距離場）；其他模式恆為 0。
    uShapeSwell: { value: 0 },
    uShapeScale: { value: 1 },
    // contactLead（形狀在已抵達水滴附近先成形）是形狀匯聚專用的邏輯。崩解噴濺
    // 是它的反向過程，同一條規則會變成「形狀黏著碎片不肯消失、碎片之間先溶掉」，
    // 在輪廓上結出一顆顆瘤。用這個 0/1 開關在崩解模式關掉它。
    uContactLead: { value: 1 },
    uShapeDepth: { value: P.shapeDepth },
    uShapeSoftness: { value: P.shapeSoftness },
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
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  // 讓 Three.js 依 PMREM atlas 尺寸注入 CubeUV shader 常數。
  mat.envMap = pmremTarget.texture;
  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  updateDropUniforms(0);
  resize();
  window.addEventListener('resize', resize);
  bindPointer();
  syncPanelToUniforms();
  loadMaterialEnvironment(P.materialStyle);
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
  // 多水滴 + 形狀場會增加每一步的取樣成本；60 步仍足以覆蓋保守包圍球，
  // 並避免高 DPR 桌面在 Formation 模式失去即時預覽能力。
  if (usesShapeField(P.motion)) return Math.min(qualitySteps, dragging ? 48 : 60);
  return dragging ? Math.min(qualitySteps, 56) : qualitySteps;
}

function refreshRenderQuality() {
  if (!renderer || !uniforms) return;
  const interactionDpr = dragging ? Math.min(qualityDpr, minRenderDpr) : qualityDpr;
  if (Math.abs(renderer.getPixelRatio() - interactionDpr) > 0.01) {
    renderer.setPixelRatio(interactionDpr);
    resize();
  }
}

function sampleRenderQuality(now) {
  if (PREVIEW || !mobileRenderQuery.matches) return;
  qualitySampleFrames++;
  const elapsed = now - qualitySampleStarted;
  if (elapsed < 2000) return;

  const fps = qualitySampleFrames * 1000 / elapsed;
  qualitySampleStarted = now;
  qualitySampleFrames = 0;

  if (fps < 42) {
    qualityLowSamples++;
    qualityHighSamples = 0;
    if (qualityLowSamples >= 2 && (qualityDpr > minRenderDpr || qualitySteps > 56)) {
      qualityDpr = minRenderDpr;
      qualitySteps = 56;
      qualityLowSamples = 0;
      refreshRenderQuality();
    }
  } else if (fps > 55) {
    qualityHighSamples++;
    qualityLowSamples = 0;
    if (qualityHighSamples >= 3 && (qualityDpr < maxRenderDpr || qualitySteps < 64)) {
      qualityDpr = maxRenderDpr;
      qualitySteps = 64;
      qualityHighSamples = 0;
      refreshRenderQuality();
    }
  } else {
    qualityLowSamples = 0;
    qualityHighSamples = 0;
  }
}

/* ===== 拖曳旋轉 ===== */
function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    refreshRenderQuality();
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    rot.y = Math.max(-Math.PI, Math.min(Math.PI, rot.y + dx * 0.006));
    rot.x = Math.max(-Math.PI * 0.5, Math.min(Math.PI * 0.5, rot.x + dy * 0.006));
    const rotationX = document.getElementById('cameraRotationX');
    const rotationY = document.getElementById('cameraRotationY');
    if (rotationX) { rotationX.value = (rot.x * 180 / Math.PI).toFixed(1); rotationX.dispatchEvent(new Event('input', { bubbles: true })); }
    if (rotationY) { rotationY.value = (rot.y * 180 / Math.PI).toFixed(1); rotationY.dispatchEvent(new Event('input', { bubbles: true })); }
    vel.y = dx * 0.006; vel.x = dy * 0.006;
  });
  const end = e => {
    dragging = false;
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
  for (const key of Object.keys(TOGGLES)) applyToggle(key);
  for (const key of Object.keys(COLORS)) uniforms[COLORS[key]].value.set(P[key]);
  document.body.style.background = (P.bgMode === 'hdri') ? '#000' : P.bgColor;
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

function bindControls() {
  // 數值滑桿
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const uName = uniformNameFor(key);
    const update = () => {
      P[key] = parseFloat(el.value);
      if (key === 'cameraRotationX') rot.x = P[key] * Math.PI / 180;
      if (key === 'cameraRotationY') rot.y = P[key] * Math.PI / 180;
      if (key === 'count') motionCounts[P.motion] = Math.round(P[key]);
      if (key === 'radius') motionRadius[P.motion] = P[key];
      if (key === 'shapeLiquidPosition') applyEdgeDropDistribution(P[key]);
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
      if (uniforms && uniforms[uName]) uniforms[uName].value = (key === 'count') ? Math.round(P[key]) : P[key];
      if (SHATTER_TIMELINE_KEYS.includes(key)) refreshShatterTimelineReadouts();
      if (key === 'gatherDuration' || key === 'shapeHold' || key === 'loopDuration') {
        updateTimelineSummary();
        // 循環秒數變了，匯集時間／完成停留的秒數顯示也要跟著換算，
        // 但不動使用者設定的比例值，所以只重畫文字，不重新觸發 input。
        if (key === 'loopDuration') {
          document.getElementById('gatherDuration_v').textContent = fmt.gatherDuration(P.gatherDuration);
          document.getElementById('shapeHold_v').textContent = fmt.shapeHold(P.shapeHold);
          refreshShatterTimelineReadouts();
        }
      }
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('input', update); el._bound = true; }
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
      if (key === 'motion' && previousMotion !== P.motion) {
        motionCounts[previousMotion] = Math.round(P.count);
        const countEl = document.getElementById('count');
        countEl.value = motionCounts[P.motion];
        countEl.dispatchEvent(new Event('input', { bubbles: true }));
        motionRadius[previousMotion] = P.radius;
        const radiusEl = document.getElementById('radius');
        radiusEl.value = motionRadius[P.motion];
        radiusEl.dispatchEvent(new Event('input', { bubbles: true }));
        previousDropT = null;
      }
      if (uniforms && uniforms[uniform]) uniforms[uniform].value = map[el.value];
      updateUIState();
      if (key === 'shapeQuality' && previousValue !== P[key]) {
        scheduleLastGLBRebuild();
      }
      if ((key === 'motion' || key === 'shapeSource') && previousValue !== P[key]) {
        ensureShapeForCurrentSource();
      }
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 材質功能開關
  for (const key of Object.keys(TOGGLES)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const label = el.closest('.toggleRow')?.querySelector('label');
    const update = () => {
      P[key] = el.checked;
      if (valEl) valEl.textContent = P[key] ? '開啟' : '關閉';
      applyToggle(key);
      updateUIState();
    };
    el.checked = P[key];
    // 原生 checkbox 為視覺隱藏狀態；將文字標籤正式連到 input，
    // 讓使用者點標籤也能切換，而不必精準命中 34px 的滑軌。
    if (label) label.htmlFor = key;
    const track = el.nextElementSibling;
    if (track && !track._bound) {
      track.addEventListener('click', () => {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      track._bound = true;
    }
    if (!el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 顏色
  for (const key of Object.keys(COLORS)) {
    const el = document.getElementById(key);
    const uName = COLORS[key];
    const update = () => {
      P[key] = el.value;
      if (uniforms) uniforms[uName].value.set(el.value);
      if (key === 'bgColor') {
        document.body.style.background = (P.bgMode === 'hdri') ? '#000' : el.value;
        updateUIState();
      }
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('input', update); el._bound = true; }
    update();
  }
  bindSpectralCausticColors();
  bindRamp();
  updateUIState();
}

function bindSpectralCausticColors() {
  for (let i = 0; i < SPECTRAL_CAUSTIC_DEFAULTS.length; i++) {
    const el = document.getElementById('spectralCausticCol' + i);
    if (!el._bound) {
      el.addEventListener('input', buildSpectralCausticLUT);
      el._bound = true;
    }
  }
  buildSpectralCausticLUT();
}

function resetSpectralCausticColors() {
  SPECTRAL_CAUSTIC_DEFAULTS.forEach((color, i) => {
    document.getElementById('spectralCausticCol' + i).value = color;
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
  if (!rc._bound) { rc.addEventListener('input', onCount); rc._bound = true; }
  onCount();
  for (let i = 0; i < STOP_MAX; i++) {
    const col = document.getElementById('stopCol' + i);
    const pos = document.getElementById('stopPos' + i);
    const pv = document.getElementById('stopPos' + i + '_v');
    const upd = () => { if (pv) pv.textContent = parseFloat(pos.value).toFixed(2); buildRampLUT(); };
    if (!col._bound) { col.addEventListener('input', upd); col._bound = true; }
    if (!pos._bound) { pos.addEventListener('input', upd); pos._bound = true; }
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

// 依模式反灰不適用的控制項
function updateUIState() {
  const setFeatureState = (id, enabled) => {
    const group = document.getElementById(id);
    if (!group) return;
    group.classList.toggle('is-disabled', !enabled);
    // 這裡管理的區塊都自帶主開關，一律套用「只反灰內容、開關保持清晰」的樣式
    group.classList.add('featureGroup');
    // .keepEnabled 的控制項不受主開關影響（見 bubble.css 的同名說明）
    group.querySelectorAll(
      '.row:not(.toggleRow):not(.keepEnabled) input,'
      + ' .row:not(.toggleRow):not(.keepEnabled) select,'
      + ' .row:not(.toggleRow):not(.keepEnabled) button')
      .forEach(el => { el.disabled = !enabled; });
    group.querySelectorAll('.effectBlock input, .effectBlock select, .effectBlock button')
      .forEach(el => {
        if (!el.closest('.toggleRow')) el.disabled = !enabled;
      });
  };
  setFeatureState('thinFilmGroup', P.filmEnabled);
  setFeatureState('artDispersionGroup', P.dispersionEnabled);
  setFeatureState('physicalDispersionGroup', P.realDispersionEnabled);
  setFeatureState('spectralCausticGroup', P.spectralCausticEnabled);
  const spectral = P.colorMode === 'spectral';
  const rampGroup = document.getElementById('rampGroup');
  const rampDisabled = spectral || !P.filmEnabled;
  rampGroup.classList.toggle('is-disabled', rampDisabled);
  rampGroup.querySelectorAll('input').forEach(el => {
    el.disabled = rampDisabled;
  });
  const colorBackground = P.bgMode === 'color';
  const bgc = document.getElementById('bgColor');
  const materialStyle = document.getElementById('materialStyle');
  const membraneOption = materialStyle.querySelector('option[value="membrane"]');
  const brightBgAssist = document.getElementById('brightBgAssist');
  bgc.disabled = !colorBackground;
  bgc.closest('.row').style.opacity = colorBackground ? 1 : 0.4;
  // 液態薄膜的合成是專為純白畫布設計。背景一旦離開 #fff，立即收斂回
  // 厚玻璃，避免下拉顯示一個實際不成立、shader 又無法合理解讀的組合。
  const pureWhiteBackground = colorBackground
    && P.bgColor.toLowerCase() === '#ffffff';
  membraneOption.disabled = !pureWhiteBackground;
  if (!pureWhiteBackground && P.materialStyle === 'membrane') {
    const previousStyle = P.materialStyle;
    P.materialStyle = 'glass';
    materialStyle.value = 'glass';
    switchMaterialProfile(previousStyle, 'glass');
    if (uniforms) uniforms.uMaterialStyle.value = SELECTS.materialStyle.map.glass;
  }
  const membraneMaterial = P.materialStyle === 'membrane';
  const membraneDepth = document.getElementById('membraneDepth');
  membraneDepth.disabled = !membraneMaterial;
  document.getElementById('membraneDepthRow').style.opacity = membraneMaterial ? 1 : 0.4;
  // 液態薄膜本身就是前後表面透射模型，不讀取厚玻璃專用的亮底補償。
  const brightAssistUsable = colorBackground && !membraneMaterial;
  brightBgAssist.disabled = !brightAssistUsable;
  brightBgAssist.closest('.row').style.opacity = brightAssistUsable ? 1 : 0.4;
  document.body.style.background = colorBackground ? P.bgColor : '#000';
  // hasShape：三個依賴距離場的模式（形狀匯聚／穿梭環繞／崩解噴濺）共用的
  // 「需要匯入/顯示形狀」閘門，管的是形狀來源、模型品質、外形細節這些跟
  // 「有沒有形狀」相關的控制項。hasTimeline 縮小到只剩「形狀匯聚」本身，
  // 因為只有它真的走匯聚→停留→散開那套時間軸；穿梭環繞恆為完整顯示、
  // 崩解噴濺自己有一條四段時間軸，都不需要那條。
  const hasShape = usesShapeField(P.motion);
  const hasTimeline = P.motion === 'formation';
  const weaving = P.motion === 'weave';
  const shattering = P.motion === 'shatter';
  // 定格呼吸只在定格那段有意義；軌跡多樣性只影響匯聚前的自由飛行段。兩者都
  // 跟匯集時間／完成停留一樣綁在 hasTimeline 上。
  document.getElementById('holdBreath').disabled = !hasTimeline;
  document.getElementById('holdBreathRow').style.opacity = hasTimeline ? 1 : 0.4;
  document.getElementById('formationVariety').disabled = !hasTimeline;
  ['formationVarietyRow', 'formationVarietyNote']
    .forEach(id => { document.getElementById(id).style.opacity = hasTimeline ? 1 : 0.4; });
  // 穿梭環繞專屬的控制項——大小差異上下限、飄浮幅度／速度——在其他動態
  // 模式下完全沒有效果（weaveDropPosition 只在 P.motion === 'weave' 時才會
  // 被呼叫到），統一反灰。
  ['weaveSizeMin', 'weaveSizeMax', 'weaveDriftAmount', 'weaveDriftSpeed'].forEach(id => {
    document.getElementById(id).disabled = !weaving;
  });
  ['weaveSizeMinRow', 'weaveSizeMaxRow', 'weaveSizeNote', 'weaveDriftAmountRow', 'weaveDriftSpeedRow']
    .forEach(id => { document.getElementById(id).style.opacity = weaving ? 1 : 0.4; });
  // 崩解噴濺的專屬控制項同理：它的參數只有 shatterTimeline 會讀，而那整段
  // 鎖在 P.motion === 'shatter' 分支裡，其他模式下調了完全沒有效果。
  ['shatterRest', 'shatterChargeTime', 'shatterCharge', 'shatterFlight', 'shatterReform',
   'shatterRange', 'shatterDecel', 'shatterSpeedVary', 'shatterGravity',
   'shatterFade', 'shatterVariety',
   'shatterSeed', 'shatterCut'].forEach(id => {
    document.getElementById(id).disabled = !shattering;
    document.getElementById(id + 'Row').style.opacity = shattering ? 1 : 0.4;
  });
  document.getElementById('shatterNote').style.opacity = shattering ? 1 : 0.4;
  const formationGroup = document.getElementById('formationGroup');
  // 「循環秒數」搬進時間軸區塊只是視覺上跟匯集/停留放在一起，它本身是分裂模式
  // 也在用的共用參數，不能被「只有需要形狀場才啟用」這條規則反灰或鎖住。用逐個
  // 子項套用取代原本直接對整個 formationGroup 設 opacity ——inline opacity 會
  // 對子樹整體生效，子項再怎麼把自己設回 1 也蓋不掉祖先的半透明。
  formationGroup.querySelectorAll(':scope > .row, :scope > .effectSubhead, :scope > .note, :scope > .effectTitle')
    .forEach(el => {
      if (el.id === 'loopDurationRow') { el.style.opacity = 1; return; }
      el.style.opacity = hasShape ? 1 : 0.38;
    });
  formationGroup.querySelectorAll('input, select, button').forEach(el => {
    if (el.id === 'loopDuration') { el.disabled = false; return; }
    el.disabled = !hasShape;
  });
  formationGroup.querySelectorAll('.timelineRow').forEach(row => {
    row.style.opacity = !hasShape ? 0.38 : hasTimeline ? 1 : 0.4;
    row.querySelectorAll('input').forEach(el => { el.disabled = !hasShape || !hasTimeline; });
  });
  // 輪廓細節滴（micro 填色滴）只在形狀匯聚的「逐漸長成」過程有意義；
  // 穿梭環繞的形狀從第一幀就完整顯示，沒有可以填的東西。
  const microCountRow = document.getElementById('microCountRow');
  microCountRow.style.opacity = !hasShape ? 0.38 : weaving ? 0.4 : 1;
  microCountRow.querySelectorAll('input').forEach(el => { el.disabled = !hasShape || weaving; });
  // 輪廓液滴有兩層閘門：外層是模式（只有 SVG 擠出且需要形狀場的模式用得到），
  // 內層是自己的主開關。主開關關閉時只停掉會移動的液滴，「邊緣水滴」因為同時
  // 決定擠出邊緣的圓角，標了 .keepEnabled 而保持可用 —— 這樣才做得出
  // 「圓角擠出但沒有液滴」。
  const edgeDropGroup = document.getElementById('edgeDropGroup');
  const edgeDropUsable = hasShape && P.shapeSource === 'svg';
  edgeDropGroup.style.opacity = edgeDropUsable ? 1 : 0.38;
  edgeDropGroup.classList.add('featureGroup');
  edgeDropGroup.classList.toggle('is-disabled', edgeDropUsable && !P.edgeDropsEnabled);
  edgeDropGroup.querySelectorAll('input').forEach(el => {
    const row = el.closest('.row');
    const survivesToggle = !!row && (row.classList.contains('keepEnabled')
      || row.classList.contains('toggleRow'));
    el.disabled = !edgeDropUsable || (!P.edgeDropsEnabled && !survivesToggle);
  });
  const isSvg = P.shapeSource === 'svg';
  const shapeBtn = document.getElementById('shapeBtn');
  const shapeInput = document.getElementById('shapeInput');
  shapeBtn.textContent = isSvg ? '選擇 SVG…' : '選擇 GLB / GLTF…';
  shapeInput.accept = isSvg ? '.svg,image/svg+xml' : '.glb,.gltf,model/gltf-binary,model/gltf+json';
  const qualityRow = document.getElementById('shapeQualityRow');
  const qualitySelect = document.getElementById('shapeQuality');
  qualitySelect.disabled = !hasShape || isSvg;
  qualityRow.style.opacity = isSvg ? 0.4 : 1;
  const depthControl = document.getElementById('shapeDepth');
  depthControl.disabled = !hasShape || !isSvg;
  depthControl.closest('.row').style.opacity = isSvg ? 1 : 0.4;
  // 邊緣圓角只圓化 SVG 擠出正面與側壁的交界（svgShapeDistance 專用），GLB 走
  // volumeShapeDistance 完全不會讀這個 uniform，調它在 GLB 來源下沒有任何效果。
  const bevelControl = document.getElementById('shapeEdgeBevel');
  bevelControl.disabled = !hasShape || !isSvg;
  bevelControl.closest('.row').style.opacity = isSvg ? 1 : 0.4;

  // 分裂 Split 以外的兩個模式都不會觸發毛細回彈或衛星滴串（updateDropUniforms
  // 裡整段邏輯鎖在 P.motion === 'cinematic'），這六個滑桿在形狀匯聚
  // 下完全沒有視覺效果。動態張力（flowSpeed）同理——它只餵給分裂模式的群體
  // 漂移位移，形狀匯聚的位置完全由 formationDropPosition 決定。
  const splitOnly = P.motion === 'cinematic';
  document.getElementById('flowSpeedRow').style.opacity = splitOnly ? 1 : 0.4;
  document.getElementById('flowSpeed').disabled = !splitOnly;
  const capillaryGroup = document.getElementById('capillaryGroup');
  capillaryGroup.style.opacity = splitOnly ? 1 : 0.4;
  capillaryGroup.querySelectorAll('input').forEach(el => { el.disabled = !splitOnly; });
}

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS, SELECT_DEFAULTS, TOGGLE_DEFAULTS, COLOR_DEFAULTS);
  resetMaterialProfiles();
  if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
  motionCounts.cinematic = DEFAULTS.count;
  motionCounts.formation = FORMATION_DEFAULT_COUNT;
  motionCounts.weave = WEAVE_DEFAULT_COUNT;
  motionCounts.shatter = SHATTER_DEFAULT_COUNT;
  motionRadius.cinematic = DEFAULTS.radius;
  motionRadius.formation = FORMATION_DEFAULT_RADIUS;
  motionRadius.weave = FORMATION_DEFAULT_RADIUS;
  motionRadius.shatter = SHATTER_RADIUS_BASE;
  resetSpectralCausticColors();
  resetRamp();
  bindControls();
  if (inited) loadMaterialEnvironment('glass');
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
    clearAutoSavedPreset();
    document.getElementById('resetBtn')?.click();
  }
});

/* ===== HDRI 載入（動態 import，離線也不會弄壞主程式）===== */
let RGBELoaderClass = null;
async function ensureRGBE() {
  if (!RGBELoaderClass) {
    const m = await import('three/addons/loaders/RGBELoader.js');
    RGBELoaderClass = m.RGBELoader;
  }
  return RGBELoaderClass;
}
const hdriInput = document.getElementById('hdriInput');
const hdriState = document.getElementById('hdriState');
let environmentRequestId = 0;

function applyEnvironmentTexture(tex, label, requestId) {
  if (requestId !== environmentRequestId) {
    tex.dispose();
    return;
  }
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const nextPmremTarget = pmremGenerator.fromEquirectangular(tex);
  const oldEnv = uniforms.uEnvMap.value;
  const oldPmremTarget = pmremTarget;

  uniforms.uEnvMap.value = tex;
  uniforms.uPmremMap.value = nextPmremTarget.texture;
  uniforms.uHasEnv.value = 1;
  pmremTarget = nextPmremTarget;
  mesh.material.envMap = nextPmremTarget.texture;
  mesh.material.needsUpdate = true;

  if (oldEnv && oldEnv.dispose) oldEnv.dispose();
  if (oldPmremTarget) oldPmremTarget.dispose();
  hdriState.textContent = 'HDRI 已載入：' + label;
}

function loadEnvironment(url, label, isHDR, revokeURL = false) {
  const requestId = ++environmentRequestId;
  hdriState.textContent = 'HDRI 載入中：' + label;
  const finish = () => { if (revokeURL) URL.revokeObjectURL(url); };
  const apply = tex => {
    try { applyEnvironmentTexture(tex, label, requestId); }
    catch (_) {
      if (requestId === environmentRequestId) hdriState.textContent = 'HDRI 載入失敗：' + label;
      if (tex && tex.dispose) tex.dispose();
    }
    finish();
  };
  const fail = () => {
    if (requestId === environmentRequestId) hdriState.textContent = 'HDRI 載入失敗：' + label;
    finish();
  };

  if (isHDR) {
    ensureRGBE()
      .then(RGBE => new RGBE().load(url, apply, undefined, fail))
      .catch(fail);
  } else {
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      apply(tex);
    }, undefined, fail);
  }
}

function loadMaterialEnvironment(style = P.materialStyle) {
  const environment = materialEnvironments[style]
    || MATERIAL_ENVIRONMENT_DEFAULTS[style]
    || MATERIAL_ENVIRONMENT_DEFAULTS.glass;
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
// 使用者自己匯入的檔案，依來源分開記住。有記錄就不再套用內建預設。
const userShapeFiles = { svg: null, gltf: null };
document.getElementById('shapeBtn').addEventListener('click', () => shapeInput.click());

function scheduleLastGLBRebuild() {
  if (!lastGLBFile || P.shapeSource !== 'gltf') return;
  clearTimeout(shapeRebuildTimer);
  // 立刻使正在進行的舊品質結果失效；短暫 debounce 避免快速連切時重複開工。
  shapeImportRequestId++;
  const grid = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  const qualityLabel = document.querySelector('#shapeQuality option:checked')?.textContent
    || `${grid}³`;
  shapeState.textContent = `品質已切換，準備重新生成 ${qualityLabel}…`;
  shapeRebuildTimer = window.setTimeout(() => {
    importShapeFile(lastGLBFile, 'gltf', { rebuilding: true });
  }, 160);
}

// file 為 null 代表套用內建預設造型（SVG 內嵌字串／3D 程式生成的環形）。
async function importShapeFile(file, kind, { rebuilding = false } = {}) {
  if (!inited) initGL();
  const requestId = ++shapeImportRequestId;
  const builtin = !file;
  const label = builtin
    ? (kind === 'svg' ? DEFAULT_SVG_NAME : DEFAULT_SOLID_NAME)
    : file.name;
  const glbGridSize = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  shapeState.textContent = kind === 'svg'
    ? `正在分析 SVG：${label}`
    : rebuilding
      ? `正在重新生成：${label} → ${glbGridSize}³（可能需要幾秒）`
      : `正在體素化模型：${label} → ${glbGridSize}³（可能需要幾秒）`;
  document.getElementById('shapeBtn').disabled = true;
  document.getElementById('shapeQuality').disabled = true;
  shapeConverting = true;
  syncLoop();
  try {
    const next = kind === 'svg'
      // 超取樣的距離場暫時佔用 (size*ss)² 個 float；桌面用 3（1536²，約 38MB
      // 峰值），行動裝置降一級避免配置失敗。
      ? await svgToField(builtin ? makeDefaultSvgFile() : file,
        { supersample: mobileRenderQuery.matches ? 2 : 3 })
      : builtin
        ? await objectToField(buildDefaultSolid(), glbGridSize)
        : await gltfToField(file, glbGridSize);
    if (requestId !== shapeImportRequestId) {
      next.texture?.dispose();
      return;
    }
    const old = shapeField?.texture;
    shapeField = next;
    shapeFieldSerial++;
    shapeTargets = next.targets;
    formationAnchors = distributePrimaryAnchors(shapeTargets);
    microFormationAnchors = distributeDetailedAnchors(shapeTargets, MAX_MICRO_DROPS);
    negativeFormationAnchors = distributeFormationAnchors(
      next.cavityTargets || [],
      MAX_NEGATIVE_DROPS,
    );
    rebuildWeaveAnchorSets();
    applyEdgeDropDistribution(P.shapeLiquidPosition);
    uniforms.uShapeTex.value = next.texture;
    uniforms.uShapeGrid.value = next.grid;
    uniforms.uShapeAtlas.value.copy(next.atlas);
    uniforms.uShapeType.value = kind === 'svg' ? 1 : 2;
    if (old) old.dispose();
    shapeFieldSource = kind;
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
// 沒有使用者匯入的檔案就退回內建預設，讓這三個模式不必先匯入檔案就看得到東西。
function ensureShapeForCurrentSource() {
  if (!usesShapeField(P.motion)) return;
  if (shapeFieldSource === P.shapeSource) return;
  // 烘焙中不併行開第二份：兩者都是幾秒的 CPU 工作，同時跑只會互相拖慢。
  // 改成記下待辦，等當前這份收工後在 finally 裡補做，否則在烘焙途中切換來源
  // 會被整個吞掉 —— 畫面停在上一個來源的距離場，且沒有任何東西會再觸發。
  if (shapeConverting) { shapeEnsurePending = true; return; }
  shapeEnsurePending = false;
  importShapeFile(userShapeFiles[P.shapeSource], P.shapeSource);
}

/* ===== 播放/暫停：面板按鈕、postMessage、分頁隱藏三者共同決定 ===== */
let userPaused = false, extPaused = PREVIEW;
let exportJob = null;
let exportPreviewSettings = null;
let exportPreviewContext = null;
let rafId = 0, last = 0;
const pauseBtn = document.getElementById('playCtl');
function isPaused() { return userPaused || extPaused || shapeConverting || exportJob || document.hidden; }
function syncLoop() {
  if (isPaused()) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  } else {
    if (!inited) initGL();
    if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(frame); }
  }
}
pauseBtn.addEventListener('click', () => {
  userPaused = !userPaused;
  pauseBtn.textContent = userPaused ? '▶ 播放' : '⏸ 暫停';
  syncLoop();
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') { extPaused = true; syncLoop(); }
  else if (e.data === 'vfx-play') { extPaused = false; syncLoop(); }
});
document.addEventListener('visibilitychange', syncLoop);

/* ===== 面板開合 ===== */
const panel = document.getElementById('panel');
document.getElementById('toggleBtn').addEventListener('click', () => panel.classList.toggle('collapsed'));

/* ===== 高解析度 PNG / PNG 序列輸出 ===== */
function exportEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('PNG 編碼失敗'));
  }, type));
}

async function pixelsToPng(pixels, renderWidth, renderHeight, outputWidth, outputHeight) {
  const supersampled = document.createElement('canvas');
  supersampled.width = renderWidth;
  supersampled.height = renderHeight;
  const supersampledContext = supersampled.getContext('2d', { alpha: true });
  const flipped = new Uint8ClampedArray(pixels.length);
  const rowBytes = renderWidth * 4;
  for (let y = 0; y < renderHeight; y++) {
    const sourceStart = (renderHeight - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(sourceStart, sourceStart + rowBytes), y * rowBytes);
  }
  supersampledContext.putImageData(new ImageData(flipped, renderWidth, renderHeight), 0, 0);
  if (renderWidth === outputWidth && renderHeight === outputHeight) return canvasToBlob(supersampled);

  // 4× 直接縮成 1× 時，各瀏覽器採用的 filter kernel 差異很大。
  // 固定分兩次 2× downsample，透明 coverage 與一像素高光會穩定許多。
  let current = supersampled;
  while (current.width > outputWidth || current.height > outputHeight) {
    const nextWidth = Math.max(outputWidth, Math.round(current.width * 0.5));
    const nextHeight = Math.max(outputHeight, Math.round(current.height * 0.5));
    const next = document.createElement('canvas');
    next.width = nextWidth;
    next.height = nextHeight;
    const context = next.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, nextWidth, nextHeight);
    context.drawImage(current, 0, 0, nextWidth, nextHeight);
    current = next;
  }
  return canvasToBlob(current);
}

function setUint16(view, offset, value) { view.setUint16(offset, value, true); }
function setUint32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function buildStoredZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const stamp = zipDateTime();
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const bytes = entry.bytes;
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    setUint32(localView, 0, 0x04034b50);
    setUint16(localView, 4, 20);
    setUint16(localView, 8, 0);
    setUint16(localView, 10, stamp.time);
    setUint16(localView, 12, stamp.date);
    setUint32(localView, 14, checksum);
    setUint32(localView, 18, bytes.length);
    setUint32(localView, 22, bytes.length);
    setUint16(localView, 26, name.length);
    local.set(name, 30);
    localParts.push(local, bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, stamp.time);
    setUint16(centralView, 14, stamp.date);
    setUint32(centralView, 16, checksum);
    setUint32(centralView, 20, bytes.length);
    setUint32(centralView, 24, bytes.length);
    setUint16(centralView, 28, name.length);
    setUint32(centralView, 42, offset);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 8, entries.length);
  setUint16(endView, 10, entries.length);
  setUint32(endView, 12, centralSize);
  setUint32(endView, 16, offset);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function applyExportCamera(time, width, height, fov, scale, settings = null) {
  updateDropUniforms(time);
  const phase01 = time / Math.max(0.001, P.loopDuration);
  const loopAngle = phase01 * Math.PI * 2;
  const autoYaw = (Math.sin(loopAngle) * 0.85 + Math.sin(loopAngle * 2 + 0.6) * 0.15) * P.spin * 0.6;
  const autoPitch = Math.sin(loopAngle + 1.1) * P.spin * 0.14;
  const dolly = 1
    - 0.05 * Math.exp(-Math.pow((phase01 - 0.80) / 0.10, 2))
    - 0.03 * Math.exp(-Math.pow((phase01 - 0.24) / 0.08, 2));
  rotM4.makeRotationY(rot.y + autoYaw);
  tmpX.makeRotationX(rot.x + autoPitch);
  rotM4.multiply(tmpX);
  tmpZ.makeRotationZ(-0.03);
  rotM4.multiply(tmpZ);
  uniforms.uRot.value.setFromMatrix4(rotM4);

  const frameGatherEnd = Math.max(0.15, P.gatherDuration);
  const frameHoldEnd = Math.min(0.94, frameGatherEnd + P.shapeHold);
  const formationFocus = isFormationMotion(P.motion) && shapeField
    ? (phase01 > frameHoldEnd)
      ? formationFidelityAmount(phase01)
      : smoothstepCPU(formationAmount(phase01), 0.42, 0.92)
    : 0;
  uniforms.uCameraDistance.value = P.cameraDistance * dolly * (1 - formationFocus * 0.30) / scale;
  uniforms.uCompositionOffsetX.value = settingsCenter(settingsValue(settings, 'centerX'));
  uniforms.uCompositionOffsetY.value = settingsCenter(settingsValue(settings, 'centerY'));
  uniforms.uTanHalfFov.value = Math.tan(Math.max(10, Math.min(120, fov)) * Math.PI / 360);
  uniforms.uResolution.value.set(width, height);
  uniforms.uTime.value = time;
  syncEdgeDropMotion(time);
  uniforms.uMaxSteps.value = 88;
}

function settingsValue(settings, key) {
  return settings && Number.isFinite(Number(settings[key])) ? Number(settings[key]) : 0;
}

function settingsCenter(value) {
  return Math.max(-0.5, Math.min(0.5, value));
}

function applyExportDetailLOD(settings) {
  const savedRadii = satelliteDrops.map(drop => drop.w);
  const savedBlend = uniforms.uSatelliteBlend.value;
  const pixelsPerWorldUnit = settings.height /
    Math.max(0.001, 2 * uniforms.uCameraDistance.value * uniforms.uTanHalfFov.value);
  let strongestSatellite = 0;

  satelliteDrops.forEach((drop, index) => {
    const projectedDiameter = savedRadii[index] * 2 * pixelsPerWorldUnit;
    // 小於 1.25 個最終像素沒有穩定輪廓；在 1.25–2.75 px 間平滑淡出，
    // 避免一幀突然消失，也避免 4× render 將不可辨識碎滴重新帶回 512 成品。
    const visibility = smoothstepCPU(projectedDiameter, 1.25, 2.75);
    drop.w = savedRadii[index] * visibility;
    strongestSatellite = Math.max(strongestSatellite, visibility);
  });
  uniforms.uSatelliteBlend.value = savedBlend * strongestSatellite;

  return () => {
    satelliteDrops.forEach((drop, index) => { drop.w = savedRadii[index]; });
    uniforms.uSatelliteBlend.value = savedBlend;
  };
}

async function renderExportFrame(settings, time, target) {
  applyExportCamera(time, settings.renderWidth, settings.renderHeight, settings.fov, settings.scale, settings);
  const restoreDetail = applyExportDetailLOD(settings);
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(settings.renderWidth * settings.renderHeight * 4);
    renderer.readRenderTargetPixels(target, 0, 0, settings.renderWidth, settings.renderHeight, pixels);
    renderer.setRenderTarget(null);
    return pixelsToPng(pixels, settings.renderWidth, settings.renderHeight, settings.width, settings.height);
  } finally {
    restoreDetail();
  }
}

async function runExport(settings) {
  if (exportJob) throw new Error('已有輸出工作正在進行');
  if (!inited) initGL();
  const width = Math.round(settings.width);
  const height = Math.round(settings.height);
  const antialias = 4;
  const renderWidth = width * antialias;
  const renderHeight = height * antialias;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
    throw new Error('輸出尺寸至少需要 64 × 64');
  }
  const maxTexture = renderer.capabilities.maxTextureSize;
  if (renderWidth > maxTexture || renderHeight > maxTexture) {
    throw new Error(`${antialias}× 抗鋸齒超過此裝置限制，請降低尺寸或品質`);
  }
  const frames = settings.type === 'sequence'
    ? Math.max(1, Math.round(settings.fps * settings.duration)) : 1;
  const totalPixels = renderWidth * renderHeight * frames;
  const safePixelBudget = mobileRenderQuery.matches ? 140000000 : 900000000;
  if (totalPixels > safePixelBudget) {
    throw new Error(mobileRenderQuery.matches
      ? '手機序列輸出量過大，請降低尺寸、幀率或秒數'
      : '序列輸出量過大，請降低尺寸、幀率或秒數');
  }

  const job = { cancelled: false };
  exportJob = job;
  flushShatterCutAnchors();
  syncLoop();
  const saved = {
    time: simT,
    resolution: uniforms.uResolution.value.clone(),
    cameraDistance: uniforms.uCameraDistance.value,
    compositionX: uniforms.uCompositionOffsetX.value,
    compositionY: uniforms.uCompositionOffsetY.value,
    tanHalfFov: uniforms.uTanHalfFov.value,
    maxSteps: uniforms.uMaxSteps.value,
    bgMode: uniforms.uBgMode.value,
    transparent: uniforms.uTransparentBackground.value,
    bgColor: uniforms.uBgColor.value.clone(),
  };
  const target = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  uniforms.uTransparentBackground.value = settings.background === 'transparent' ? 1 : 0;
  uniforms.uBgMode.value = settings.background === 'scene' ? SELECTS.bgMode.map[P.bgMode] : 0;
  if (settings.background === 'transparent') uniforms.uBgColor.value.set(0x000000);

  try {
    previousDropT = null;
    if (settings.type === 'still') {
      exportEvent('prism-export-progress', { progress: 0.15, message: '正在渲染 PNG…' });
      const png = await renderExportFrame({ ...settings, width, height, renderWidth, renderHeight }, saved.time, target);
      if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
      downloadBlob(png, `prism-drops_${width}x${height}.png`);
    } else {
      const entries = [];
      const digits = Math.max(4, String(frames).length);
      for (let index = 0; index < frames; index++) {
        if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
        // Sample the requested export duration; when it follows the panel this
        // remains one complete loop, while a custom value controls the output
        // playback length as advertised by the export UI.
        const time = index / frames * settings.duration;
        const png = await renderExportFrame({ ...settings, width, height, renderWidth, renderHeight }, time, target);
        entries.push({
          name: `prism-drops_${String(index + 1).padStart(digits, '0')}.png`,
          bytes: new Uint8Array(await png.arrayBuffer()),
        });
        exportEvent('prism-export-progress', {
          progress: (index + 1) / frames * 0.92,
          message: `正在渲染 ${index + 1} / ${frames} 幀`,
        });
        await nextPaint();
      }
      if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
      exportEvent('prism-export-progress', { progress: 0.96, message: '正在封裝 ZIP…' });
      const zip = buildStoredZip(entries);
      downloadBlob(zip, `prism-drops_${width}x${height}_${settings.fps}fps.zip`);
    }
    exportEvent('prism-export-complete', { message: '輸出完成，檔案已開始下載' });
  } catch (error) {
    if (error.name === 'AbortError') exportEvent('prism-export-complete', { message: '已取消輸出' });
    else throw error;
  } finally {
    target.dispose();
    renderer.setRenderTarget(null);
    uniforms.uResolution.value.copy(saved.resolution);
    uniforms.uCameraDistance.value = saved.cameraDistance;
    uniforms.uCompositionOffsetX.value = saved.compositionX;
    uniforms.uCompositionOffsetY.value = saved.compositionY;
    uniforms.uTanHalfFov.value = saved.tanHalfFov;
    uniforms.uMaxSteps.value = saved.maxSteps;
    uniforms.uBgMode.value = saved.bgMode;
    uniforms.uTransparentBackground.value = saved.transparent;
    uniforms.uBgColor.value.copy(saved.bgColor);
    previousDropT = null;
    simT = saved.time;
    exportJob = null;
    syncLoop();
  }
}

window.addEventListener('prism-export-request', event => {
  runExport(event.detail).catch(error => {
    console.error(error);
    exportEvent('prism-export-error', { message: error.message || '輸出失敗' });
    if (exportJob) {
      exportJob = null;
      syncLoop();
    }
  });
});
window.addEventListener('prism-export-cancel', () => {
  if (exportJob) exportJob.cancelled = true;
});
window.addEventListener('prism-export-preview', event => {
  exportPreviewSettings = event.detail || null;
});
window.addEventListener('prism-export-preview-clear', () => {
  exportPreviewSettings = null;
});
window.addEventListener('prism-export-workspace-resize', resize);

function updateExportCameraPreview() {
  if (!exportPreviewSettings) return;
  const preview = document.getElementById('exportPreviewCanvas');
  if (!preview) return;
  const targetAspect = Math.max(0.05,
    Number(exportPreviewSettings.width) / Math.max(1, Number(exportPreviewSettings.height)));
  const longEdge = 480;
  const previewWidth = targetAspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * targetAspect));
  const previewHeight = targetAspect >= 1 ? Math.max(1, Math.round(longEdge / targetAspect)) : longEdge;
  if (preview.width !== previewWidth || preview.height !== previewHeight) {
    preview.width = previewWidth;
    preview.height = previewHeight;
    exportPreviewContext = preview.getContext('2d', { alpha: false });
  }
  if (!exportPreviewContext || !canvas.width || !canvas.height) return;

  const sourceAspect = canvas.width / canvas.height;
  let sourceX = 0, sourceY = 0, sourceWidth = canvas.width, sourceHeight = canvas.height;
  if (targetAspect < sourceAspect) {
    sourceWidth = canvas.height * targetAspect;
    sourceX = (canvas.width - sourceWidth) * 0.5;
  } else if (targetAspect > sourceAspect) {
    sourceHeight = canvas.width / targetAspect;
    sourceY = (canvas.height - sourceHeight) * 0.5;
  }
  exportPreviewContext.drawImage(
    canvas,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, previewWidth, previewHeight,
  );
}

/* ===== 主迴圈 ===== */
let simT = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  sampleRenderQuality(now);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  simT = (simT + dt) % Math.max(0.001, P.loopDuration);
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
  const dolly = 1
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
  const frameGatherEnd = Math.max(0.15, P.gatherDuration);
  const frameHoldEnd = Math.min(0.94, frameGatherEnd + P.shapeHold);
  const formationFocus = isFormationMotion(P.motion) && shapeField
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
  if (exportPreviewSettings) cameraDistance /= Math.max(0.5, Math.min(1.6, Number(exportPreviewSettings.scale) || 1));
  uniforms.uCameraDistance.value = cameraDistance;
  uniforms.uCompositionOffsetX.value = exportPreviewSettings
    ? settingsCenter(settingsValue(exportPreviewSettings, 'centerX')) : compositionOffsetX;
  uniforms.uCompositionOffsetY.value = exportPreviewSettings
    ? settingsCenter(settingsValue(exportPreviewSettings, 'centerY')) : compositionOffsetY;
  uniforms.uTanHalfFov.value = exportPreviewSettings
    ? Math.tan(Math.max(10, Math.min(120, Number(exportPreviewSettings.fov) || 42)) * Math.PI / 360)
    : 0.42;
  uniforms.uTime.value = simT;
  syncEdgeDropMotion(simT);
  uniforms.uMaxSteps.value = resolveMaxSteps();
  renderer.render(scene, camera);
  updateExportCameraPreview();
}

bindControls();

// 參數組合匯出/匯入。預覽模式要呈現正規預設值，不套用個人的自動保存狀態。
if (!PREVIEW && window.PresetIO) {
  window.PresetIO.init({
    effect: 'prism-drops',
    panel: '#panel',
    mount: '#presetIO',
    // 模式類控件必須先套用：切換動態模式會連帶覆寫水滴數量，
    // 配色數量會決定色標列的顯示，順序顛倒會讓後套的值被蓋掉。
    applyFirst: [
      'motion', 'bgMode', 'bgColor', 'materialStyle', 'colorMode', 'shapeSource', 'shapeQuality',
      'filmEnabled', 'dispersionEnabled', 'realDispersionEnabled',
      'spectralCausticEnabled', 'rampCount',
    ],
    assetNote: 'HDRI 與 SVG / GLB 素材無法存進參數檔，請自行載入',
    saveOn: ['#resetBtn'],
    afterApply: () => {
      updateRampRows();
      buildRampLUT();
      buildSpectralCausticLUT();
      updateUIState();
    },
  }).restore();
}

// 桌面版六格快速暫存：空格點一下儲存，已儲存的格子點一下載入。
if (!PREVIEW) {
  const quickSlots = document.getElementById('quickSlots');
  const quickStatus = document.getElementById('quickSlotsStatus');
  const preset = window.PresetIO?.of('prism-drops');
  const storageKey = 'vfx:prism-drops:quick-slots';
  let savedSlots = [];
  try { savedSlots = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) { savedSlots = []; }

  if (quickSlots && preset) {
    const buttons = [...quickSlots.querySelectorAll('[data-slot]')];
    const announce = message => {
      quickStatus.textContent = message;
      clearTimeout(announce.timer);
      announce.timer = setTimeout(() => { quickStatus.textContent = ''; }, 1800);
    };
    const syncSlots = () => buttons.forEach((button, index) => {
      const saved = Boolean(savedSlots[index]);
      button.classList.toggle('is-saved', saved);
      button.title = saved ? `載入暫存 ${index + 1}（右鍵清除）` : `儲存目前參數到 ${index + 1}`;
    });
    const persist = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(savedSlots)); } catch (_) { announce('瀏覽器無法保存暫存'); }
    };
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => {
        if (savedSlots[index]) {
          try {
            preset.apply(savedSlots[index]);
            announce(`已載入暫存 ${index + 1}`);
          } catch (_) { savedSlots[index] = null; persist(); syncSlots(); announce('暫存資料已失效'); }
        } else {
          savedSlots[index] = preset.serialize(`快速暫存 ${index + 1}`);
          persist(); syncSlots(); announce(`已儲存暫存 ${index + 1}`);
        }
      });
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (!savedSlots[index]) return;
        savedSlots[index] = null;
        persist(); syncSlots(); announce(`已清除暫存 ${index + 1}`);
      });
    });
    syncSlots();
  }
}

syncLoop();
if (!PREVIEW) syncLoop();
if (!PREVIEW) exportEvent('prism-export-ready', { loopDuration: P.loopDuration });
