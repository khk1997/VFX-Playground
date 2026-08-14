'use strict';
import * as THREE from 'three';
import {
  svgToField, gltfToField, objectToField, packShapePairTexture,
} from './shape-field.js?v=svg-shape-49';
import {
  DEFAULT_SVG_NAME, DEFAULT_SOLID_NAME, buildDefaultSolid, makeDefaultSvgFile,
  MELT_DEFAULT_SVG_NAME, makeMeltDemoSvgFile,
  MORPH_TARGET_SVG_NAME, makeMorphTargetSvgFile,
  MORPH_TARGET_SOLID_NAME, buildMorphTargetSolid,
} from './default-shapes.js?v=svg-shape-49';
import {
  MOTION_UNIFORM_MAP, MOTION_DEFAULT_COUNTS, MOTION_DEFAULT_RADIUS,
  MOTION_DEFAULT_LOOP_DURATION, MOTION_DEFAULT_DOLLY, MOTION_SVG_DEMO,
  MOTION_OVERRIDES, MOTION_KEYS, usesShapeField, motionGates,
} from './motions/registry.js?v=svg-shape-49';
import { fract, hash11CPU, smoothstepCPU } from './motions/util.js?v=svg-shape-49';
import createShatterMotion from './motions/shatter.js?v=svg-shape-49';
import createFormationMotion, { MICRO_ORBIT_TUNE } from './motions/formation.js?v=svg-shape-49';
import createMeltMotion, { selectBottomAnchors } from './motions/melt.js?v=svg-shape-49';
import createMorphMotion, { buildMorphPairs } from './motions/morph.js?v=svg-shape-49';
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
  rayDispersion: 6,
  rayDispersionAbbe: 25,
  rayDispersionLightIntensity: 4,
  rayDispersionLightSize: 0.32,
  rayDispersionFocus: 0.55,
  rayDispersionAzimuth: 0,
  rayDispersionElevation: 0,
  spectralCausticIntensity: 3,
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
  // 與非對稱反射卡。通用玻璃模式不讀取這個值。
  membraneDepth: 0.65,
  // 水的折射率約 1.33，玻璃約 1.5；預設維持原本水滴的手感，改高會讓邊緣
  // 反射（Fresnel）變強、折射彎曲角度變陡，看起來更像玻璃而不是水珠。
  ior: 1.33,
  hdriYaw: -45,
  hdriPitch: 20,
  hdriBlur: 0.21,
  envRefraction: 0,
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
  // 形狀變形（見 motions/morph.js）。四段時間軸「定格 A → 變形 → 定格 B → 變形回」，
  // morphHold 是單邊定格佔循環的比例，剩下的對半分給兩趟變形。
  morphHold: 0.28,
  // 波前錯開：每顆水滴的出發時間依它在掃描軸上的位置差開多少。0 = 全體同時
  // 移動（看起來只是整個形狀抽動一下），調高才會讀成一道波掃過去。這是這個
  // 模式手感的關鍵參數。
  morphStagger: 0.82,
  // 掃描方向（度，XY 平面）。回程固定轉 90°，否則兩趟像同一段動畫正放再倒放。
  morphWaveAngle: 125,
  // 路徑往外凸多少。液體離開表面是「隆起 → 拉離」，直線插值看起來像瞬移。
  morphArc: 0.8,
  // 飛行途中那些水滴的大小加成。實體變形成立時，水滴的存在包絡本身已經是
  // 「飛行中才有」，這個值只調它們飛起來有多大。
  morphSwell: 0.5,
  // 切口本身的軟硬（送進 shader 的 uShapeCutBlend）。0 是刀切。
  morphCutBlend: 0.08,
  // 消失方式（見 shaders.js 的 dissolveField）。這四項都是往同一條消失場上疊，
  // 所以可以任意組合，不是互斥的選單。
  //   morphFront   波前形狀：0 平面掃描、1 從中心放射、2 螺旋。
  //   morphSpiral  螺旋的纏繞強度，只有 morphFront === 2 時有意義。
  //   morphNoise/morphNoiseScale   亂流：撕裂的有機邊緣，幅度大時碎成島嶼。
  //   morphCell/morphCellScale     晶格：整塊整塊剝落的碎裂感。
  //   morphNeck/morphNeckWidth     前緣收頸：斷開前先變薄收頸，液體的身分。
  morphFront: 0,
  morphSpiral: 1,
  morphNoise: 0.6,
  morphNoiseScale: 1.5,
  morphCell: 0,
  morphCellScale: 4,
  morphNeck: 0.12,
  morphNeckWidth: 0.55,
  // 融化（見 motions/melt.js）。滴落間隔要隨機、又要能無縫循環，靠的是「每顆水滴
  // 一個循環滴整數次」：頻率與相位偏移各自由雜湊決定，看起來雜亂，phase=0/1 卻同值。
  // 滴落頻率是每個循環的基準滴數，節奏差異讓各顆在這個基準上下錯開。
  meltRate: 3,
  meltRateVary: 0.6,
  // 水滴在底部形成／懸掛佔一次滴落的多少比例，剩下的都是墜落。
  meltHang: 0.35,
  // 懸掛時往下垂多少、脫離後墜落多遠。
  meltSag: 0.03,
  meltFall: 0.85,
  // 墜落到幾成才開始縮小。必須在墜落結束前收乾淨，否則水滴會帶著半徑跳回起點
  // ——「縮小到消失」不只是效果，是循環接縫的必要條件。
  meltShrink: 0.25,
  // 每滴大小落在這個範圍（乘在「水滴大小」上）。
  meltSizeMin: 0.1,
  meltSizeMax: 0.43,
  // 墜落時的水平擾動，避免同一個滴落點的水滴完全重疊成一直線。
  meltJitter: 0.04,
  // 底部取樣範圍：形狀高度的多少比例算「底部」，滴落點就從那一段裡挑。
  meltBand: 0.22,
  meltSeed: 0,
  // 水滴的形狀（見 melt.js 的 meltDeform）。懸掛時被重力拉長、上方收出一個頸；
  // 脫離後頸縮回，水滴在表面張力下彈動著收斂回接近球形。
  meltStretch: 0.3,
  meltNeck: 0.5,
  meltWobble: 0.5,
  // 崩解噴濺的時間軸拆成四段時長（見 shatterSegments）：靜止 → 蓄力 → 飛散 →
  // 重組。四個值是相對權重，正規化後填滿整個循環，所以任何組合都合法、不會出現
  // 「滑桿有數字但實際被夾住」的情形。崩解模式預設循環為 4 秒，四段權重
  // 1.1 / 0.5 / 0.4 / 2.0 合計正好也是 4，因此右側直接顯示實際秒數。
  shatterRest: 1.1,
  shatterFlight: 0.4,
  // 噴散運動拆成三軸（見 shatterTravel／shatterOffset）：散多遠、曲線多前傾、
  // 每顆差多少。減速預設 1.0 —— 真實的爆炸碎片會被空氣阻力拖慢，0 是舊版的等速。
  shatterRange: 0.3,
  shatterDecel: 1,
  shatterSpeedVary: 0.9,
  shatterGravity: 0,
  // 碎片在飛散途中縮小的比例（0 = 保持原大小飛到底）。
  shatterFade: 1,
  // 收尾：把碎片收回錨點、形狀重新長回來。這一段必須存在，phase=0/1 兩端才
  // 都是「完整形狀 + 零半徑碎片」，循環接縫不跳。
  shatterReform: 2.0,
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
  shatterCharge: 0.025,
  shatterChargeTime: 0.5,
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
// 判斷式與各模式的預設值現在都由 motions/registry.js 提供。
const SELECT_DEFAULTS = {
  bgMode: 'color',
  materialStyle: 'universal',
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
  materialStyle: { glass: 'universal' },
};
const TOGGLE_DEFAULTS = {
  edgeDropsEnabled: false,
  brightBgAssist: true,
  filmEnabled: false,
  dispersionEnabled: true,
  rayDispersionEnabled: false,
  spectralCausticEnabled: true,
  // 前後拉伸（見下方 dolly 計算）。跟 count/radius/loopDuration 一樣按模式
  // 各自記憶，這裡只是進入畫面時的初始值。
  dollyEnabled: MOTION_DEFAULT_DOLLY[SELECT_DEFAULTS.motion],
  // 閒置或視窗失焦時把影格率壓到 30fps。只降更新頻率、不降解析度，所以畫面
  // 品質不變。預設開啟：桌面沒有任何自動降載，不開就是一直滿載。
  powerSave: true,
};
const COLOR_DEFAULTS  = {
  bgColor: '#000000',
  // 液態薄膜原本各自寫死一個偏藍紫色常數的 5 處，現在各自開一個選色器直接
  // 取代常數，選色器選什麼顏色，畫面上那一處就是那個顏色。預設值都是原本
  // 那個常數本身，維持改動前的外觀。
  membraneBaseColor: '#7a9ec7',
  membraneVeilColor: '#b8e6ff',
  membraneReflectionColor: '#94b8e6',
  membraneCardColor: '#94c7ff',
  membraneShadeColor: '#85b8e6',
};
const P = { ...DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS };

// 材質切換不是同一組滑桿換 shader 分支：通用玻璃與液態薄膜各自保留一份
// HDRI／材質狀態。離開時記住使用者微調，回來時恢復；第一次進入薄膜則使用
// 白底參考圖的校準值。鏡頭、動畫與配色不在這裡，切材質時不應改變構圖或動作。
const MATERIAL_PROFILE_KEYS = [
  'hdriYaw', 'hdriPitch', 'hdriBlur', 'envRefraction',
  'membraneDepth', 'reflect', 'transmission', 'materialExposure',
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
    dispersion: 0.05,
    dispersionSeparation: 1.5,
    artThickness: 295,
    artThickVar: 130,
    artNoiseScale: 0.5,
    artPatternSpeed: 0.01,
    artGravity: 0.52,
    causticScale: 1,
    causticSharpness: 0.65,
  },
};
const MATERIAL_ENVIRONMENT_DEFAULTS = {
  membrane: { url: MEMBRANE_HDRI_URL, label: MEMBRANE_HDRI_LABEL, isHDR: true, file: null },
  universal: { url: GLASS_HDRI_URL, label: GLASS_HDRI_LABEL, isHDR: true, file: null },
};
let materialProfiles = {};
let materialEnvironments = {};
function resetMaterialProfiles() {
  materialProfiles = {
    membrane: { ...MATERIAL_PROFILE_DEFAULTS.membrane },
    universal: { ...MATERIAL_PROFILE_DEFAULTS.universal },
  };
  materialEnvironments = {
    membrane: { ...MATERIAL_ENVIRONMENT_DEFAULTS.membrane },
    universal: { ...MATERIAL_ENVIRONMENT_DEFAULTS.universal },
  };
}
resetMaterialProfiles();
const MOBILE_CAMERA_DISTANCE_DEFAULT = 4.3;
if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
// 按動態模式各自記憶的參數：使用者在某個模式下調過的值會被保留，切回來時
// 恢復。count/radius/loopDuration/dolly 每個模式的初始值天生就不同，直接來自
// registry.js 各自的一張表；SHAPE_APPEARANCE_KEYS 這幾個原本是全域共用一份
// DEFAULTS/TOGGLE_DEFAULTS，只有某個模式的 overrides 有列到才不一樣（目前只有
// 融化），沒列到的模式沿用共用預設，不必五個模式各抄一次同樣的數字。
const SHAPE_APPEARANCE_KEYS = [
  'shapeDepth', 'shapeEdgeBevel', 'edgeDropsEnabled',
  'shapeLiquid', 'shapeLiquidPosition', 'shapeLiquidSize', 'shapeLiquidSpeed',
];
function motionDefaultsFor(key) {
  const base = key in DEFAULTS ? DEFAULTS[key] : TOGGLE_DEFAULTS[key];
  return Object.fromEntries(MOTION_KEYS.map(m => [m, MOTION_OVERRIDES[m]?.[key] ?? base]));
}
function buildMotionMemory() {
  return {
    count: { ...MOTION_DEFAULT_COUNTS },
    radius: { ...MOTION_DEFAULT_RADIUS },
    loopDuration: { ...MOTION_DEFAULT_LOOP_DURATION },
    dollyEnabled: { ...MOTION_DEFAULT_DOLLY },
    ...Object.fromEntries(SHAPE_APPEARANCE_KEYS.map(k => [k, motionDefaultsFor(k)])),
  };
}
let motionMemory = buildMotionMemory();
const MOTION_MEMORY_KEYS = Object.keys(motionMemory);

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
  materialStyle: { uniform: 'uMaterialStyle', map: { membrane: 1, universal: 2 } },
  colorMode: { uniform: 'uColorMode', map: { spectral: 0, ramp: 1 } },
  motion:    { uniform: 'uMotion',    map: MOTION_UNIFORM_MAP },
  shapeSource: { uniform: 'uShapeType', map: { svg: 1, gltf: 2 } },
  // 僅控制下一次 GLB 烘焙尺寸，沒有對應 shader uniform。
  shapeQuality: { uniform: '', map: { performance: 48, balanced: 80, high: 128 } },
};
const COLORS = {
  bgColor: 'uBgColor',
  membraneBaseColor: 'uMembraneBaseColor',
  membraneVeilColor: 'uMembraneVeilColor',
  membraneReflectionColor: 'uMembraneReflectionColor',
  membraneCardColor: 'uMembraneCardColor',
  membraneShadeColor: 'uMembraneShadeColor',
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
  rayDispersionEnabled: 'uRayDispersionEnabled',
  spectralCausticEnabled: 'uSpectralCausticEnabled',
  edgeDropsEnabled: () => applyEdgeDropDistribution(),
  // 沒有對應 uniform：dolly 是 CPU 端算好直接寫進 uCameraDistance 的純量，
  // render loop 每幀直接讀 P.dollyEnabled，這裡不用同步任何東西。
  dollyEnabled: () => {},
  // 純 CPU 端的節流開關，主迴圈每幀直接讀 P.powerSave（見 shouldSkipFrame），
  // 沒有對應 uniform 要同步。
  powerSave: () => {},
};

function applyToggle(key) {
  const target = TOGGLES[key];
  if (typeof target === 'function') target();
  else if (uniforms && uniforms[target]) uniforms[target].value = P[key] ? 1 : 0;
}

// DEFAULTS 的 key 一律用 'u' + 首字大寫推導 uniform 名稱（uReflect、uRoughness...），
// 但 IOR 照慣例整個縮寫大寫，'uIor' 對不上 shader 裡宣告的 uIOR，需要例外表。
// 形狀變形的波前軟硬屬於「形狀切削」那組 uniform（uShapeCut／uShapeMorph），
// 命名跟著那組走，而不是跟著滑桿 key 走。
const UNIFORM_NAME_OVERRIDES = { ior: 'uIOR', morphCutBlend: 'uShapeCutBlend' };
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
  rayDispersion: v => 'x' + v.toFixed(2),
  rayDispersionAbbe: v => v.toFixed(0),
  rayDispersionLightIntensity: v => 'x' + v.toFixed(2),
  rayDispersionLightSize: v => Math.round(v * 100) + '%',
  rayDispersionFocus: v => Math.round(v * 100) + '%',
  rayDispersionAzimuth: v => v.toFixed(0) + '°',
  rayDispersionElevation: v => v.toFixed(0) + '°',
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
  morphHold: v => (v * P.loopDuration).toFixed(1) + 's',
  morphStagger: v => v === 0 ? '全體同時' : Math.round(v * 100) + '%',
  morphWaveAngle: v => v.toFixed(0) + '°',
  morphArc: v => v === 0 ? '直線' : v.toFixed(2),
  morphSwell: v => v === 0 ? '基準' : '+' + Math.round(v * 100) + '%',
  morphCutBlend: v => v === 0 ? '刀切' : v.toFixed(3),
  morphFront: v => ['平面掃描', '從中心放射', '螺旋'][Math.round(v)] || '平面掃描',
  morphSpiral: v => v.toFixed(2),
  morphNoise: v => v === 0 ? '關閉' : v.toFixed(3),
  morphNoiseScale: v => 'x' + v.toFixed(1),
  morphCell: v => v === 0 ? '關閉' : v.toFixed(3),
  morphCellScale: v => 'x' + v.toFixed(1),
  morphNeck: v => v === 0 ? '不收頸' : v.toFixed(3),
  morphNeckWidth: v => v.toFixed(2),
  meltRate: v => v.toFixed(0) + ' 滴/循環',
  meltRateVary: v => v === 0 ? '整齊同步' : '±' + Math.round(v * 100) + '%',
  meltHang: v => Math.round(v * 100) + '%',
  meltSag: v => v.toFixed(3),
  meltFall: v => v.toFixed(2),
  meltShrink: v => Math.round(v * 100) + '%',
  meltSizeMin: v => 'x' + v.toFixed(2),
  meltSizeMax: v => 'x' + v.toFixed(2),
  meltJitter: v => v === 0 ? '關閉' : v.toFixed(3),
  meltBand: v => Math.round(v * 100) + '%',
  meltSeed: v => '#' + v.toFixed(0),
  meltStretch: v => v === 0 ? '正圓球' : '+' + Math.round(v * 100) + '%',
  meltNeck: v => v === 0 ? '無頸' : Math.round(v * 100) + '%',
  meltWobble: v => v === 0 ? '不彈動' : Math.round(v * 100) + '%',
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

// 這幾個滑桿存的是「佔循環的比例」，讀數卻顯示換算後的秒數，所以循環秒數一變
// 就得重畫，否則會停在用舊循環長度算出來的數字。切換動態模式時循環秒數會跟著
// 換（每個模式各自記憶），所以這不是罕見情況——morphHold 一開始就漏了列進來，
// 結果切到形狀變形時定格時間顯示的是用上一個模式的循環秒數算的值。
const LOOP_SCALED_KEYS = ['gatherDuration', 'shapeHold', 'morphHold'];
function refreshLoopScaledReadouts() {
  for (const key of LOOP_SCALED_KEYS) {
    const valEl = document.getElementById(key + '_v');
    if (valEl) valEl.textContent = fmt[key](P[key]);
  }
  refreshShatterTimelineReadouts();
}

import { VERT, FRAG } from './shaders.js?v=universal-37';

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

// 融化的滴落點：形狀底部散開的幾個位置（見 motions/melt.js 的 selectBottomAnchors）。
// 取樣範圍與種子是滑桿，改了要重挑，所以跟崩解切法一樣用 key 快取，不是每幀重算。
let meltBottomAnchors = [];
let meltAnchorKey = null;
function rebuildMeltAnchors() {
  const key = `${shapeFieldSerial}:${P.meltBand.toFixed(3)}:${Math.round(P.meltSeed)}`;
  if (key === meltAnchorKey) return;
  meltAnchorKey = key;
  meltBottomAnchors = selectBottomAnchors(
    shapeTargets, MAX_DROPS, P.meltBand, Math.round(P.meltSeed),
  );
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
      morphTargetPoints = {
        key,
        kind,
        texture: field.texture,
        grid: field.grid,
        atlas: field.atlas,
        primary: distributePrimaryAnchors(field.targets),
        micro: distributeDetailedAnchors(field.targets, MAX_MICRO_DROPS),
      };
      morphPairKey = null;
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
  freeOrbitPosition, formationDropPosition, weaveDropPosition,
} = createFormationMotion(P, {
  dropSeeds,
  anchors: () => formationAnchors,
  weaveAnchors: () => weaveSurfaceAnchors,
});

// 融化：底部滴落。錨點同樣用 getter，換形狀或調取樣範圍後才拿得到新的那組。
const { meltDrop } = createMeltMotion(P, { bottomAnchors: () => meltBottomAnchors });
// 配對表由 bubble.js 這邊持有（它才知道形狀什麼時候換），morph.js 只負責讀。
const {
  morphTimeline: morphTimelineOf, morphFronts, morphDropPosition, morphRadiusFactor,
} = createMorphMotion(P);

// 微滴的自由軌道在 updateMicroDrops 直接呼叫 freeOrbitPosition，需要自己的暫存向量。
const freeOrbitVec = new THREE.Vector3();

// 融化每顆水滴這一幀的形狀（拉長／頸／彈動）。主滴迴圈算出來，下面的形變迴圈
// 讀取——那個迴圈拿不到位置迴圈的區域變數，所以在這裡接一手。
const meltDeformNow = Array.from({ length: MAX_DROPS }, () => null);

const formationPosNow = new THREE.Vector3();
const formationPosBefore = new THREE.Vector3();
const formationPosAfter = new THREE.Vector3();

function updateMicroDrops(phase, fidelityAbsorb = 0, morphSolid = false) {
  // 崩解噴濺不走匯聚管線，但微滴群正好是最好用的碎片來源（20 顆，是主滴的
  // 近兩倍），所以它也要把微滴開起來，只是位置改由彈道決定。
  const shattering = P.motion === 'shatter';
  // 融化也要微滴：滴落點就那幾個，只靠 12 顆主滴撐不出「不停在滴」的密度，
  // 微滴補上去之後同一個位置才會有前後好幾滴同時在不同高度。
  const melting = P.motion === 'melt';
  // 形狀變形的微滴不是「細節補強」而是主力之一：整個畫面只有水滴，主滴 12 顆
  // 撐不出兩顆形狀的輪廓，微滴那 20 顆負責把輪廓填細。
  const morphing = P.motion === 'morph';
  const activeCount = (isFormationMotion(P.motion) || shattering || melting || morphing) && shapeField
    ? Math.max(0, Math.min(MAX_MICRO_DROPS, Math.round(P.microCount)))
    : 0;
  const amount = formationAmount(phase);
  const shatter = shattering ? shatterTimeline(phase) : null;
  const shatterAnchors = shattering ? shatterAnchorSets().micro : null;
  const a = phase * Math.PI * 2;
  for (let i = 0; i < MAX_MICRO_DROPS; i++) {
    const o = i * 4;
    const pool = shattering ? shatterAnchors
      : melting ? meltBottomAnchors
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
      // 種子基底刻意跟主滴那條（i * 7.13）錯開，同一個滴落點的主滴與微滴才不會
      // 同步落下、疊成一顆。
      const state = meltDrop(i, phase, i * 3.41 + 101.7, formationPosNow);
      microDropData[o] = formationPosNow.x;
      microDropData[o + 1] = formationPosNow.y;
      microDropData[o + 2] = formationPosNow.z;
      // 微滴是主滴的縮小版，撐體積的是主滴，這裡只負責補密度。
      microDropData[o + 3] = state ? state.radius * 0.62 : 0;
      // 微滴的 SDF（microDropletDistance）只吃主軸與拉長，沒有尖端與彈動那兩個
      // 通道，所以這裡只套得上垂直拉長；而且它把 stretch 夾在 [1, 1.65]，墜落期
      // 的壓扁（<1）會被夾成 1，等於微滴只在懸掛時被拉長。以微滴的尺寸來說看不
      // 出差別，不值得為它擴一組 uniform。
      microShapeData[o] = 0;
      microShapeData[o + 1] = 1;
      microShapeData[o + 2] = 0;
      microShapeData[o + 3] = state ? state.deform.stretch : 1;
      continue;
    }
    if (morphing) {
      morphDropPosition(morphMicroPairs, i, phase, formationPosNow);
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
  // 融化的形狀始終完整，空腔自然也要一直在，不隨任何包絡消長。
  const amount = P.motion === 'melt'
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
  const melting = P.motion === 'melt';
  const morphing = P.motion === 'morph';
  if (melting) rebuildMeltAnchors();
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
    : P.motion === 'weave' || melting || morphSolid
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
  const microCount = updateMicroDrops(phase, fidelityAbsorb, morphSolid);
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
    // 融化也是一次出現很多顆各自獨立的水滴，同樣需要這套正規化。
    // 形狀變形同樣是「一次出現很多顆」：水滴群就是整個畫面，沒有正規化的話
    // 排成形狀的那一刻整組會黏成一大團，輪廓完全糊掉。
    : isFormationMotion(P.motion) || P.motion === 'shatter' || melting || morphing
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
    // 融化的半徑同樣自成一套（長出→墜落→縮到 0 的包絡），在這裡先接住。
    let meltState = null;

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
    } else if (melting) {
      // 主滴與微滴餵不同的種子基底，同一個滴落點才會有大小、時機都不同的水滴
      // 輪流落下，看起來是連續的水流而不是整齊的節拍器。
      meltState = meltDrop(i, phase, i * 7.13, formationPosNow);
      if (meltState) {
        x = formationPosNow.x;
        y = formationPosNow.y;
        z = formationPosNow.z;
      }
      meltDeformNow[i] = meltState ? meltState.deform : null;
    } else if (morphing) {
      morphDropPosition(morphPairs, i, phase, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      radiusFactor = morphRadiusFactor(morphPairs, i, phase, morphSolid);
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
    if (!melting && !morphing) y -= P.gravity * P.spread * 0.045 * Math.pow(radius, 1.35);
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
  // 融化排除在外：每一滴都是各自落下的獨立水滴，靠得近時互相脹大半徑會黏成
  // 一條斷不開的水柱，正好是這個模式最不該有的樣子。
  if (!isFormationMotion(P.motion) && P.motion !== 'cinematic' && !melting
    && count >= 2 && fusionAmount > 0) {
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
  // 融化取中間值：這個 uniform 是整幀共用的，而畫面上同時有「還黏在造型底部
  // 正在形成」與「已經墜到半空」兩種水滴。收太緊，正在形成的那顆會變成貼在表面
  // 的一顆獨立球，失去液體被拉出來的樣子；放太鬆，落下的幾滴會彼此牽絲黏成
  // 一條水柱。0.4 是兩者都還能看的折衷，再細調交給「黏度」滑桿。
  const mergeScale = P.motion === 'weave'
    ? 0.15
    : melting
      ? 0.4
      : shatter
        ? 1 + (0.15 - 1) * shatter.flight
        : 1;
  if (uniforms) uniforms.uViscosity.value = effectiveViscosity * mergeScale;
  if (uniforms) {
    uniforms.uShapeProgress.value = formationShapeProgress;
    uniforms.uFidelityAbsorb.value = fidelityAbsorb;
    uniforms.uShapeSwell.value = shatter ? shatter.swell : 0;
    uniforms.uShapeScale.value = 1 + holdBreathScale(phase);
    // 融化一併關掉：contactLead 是「形狀在已抵達水滴附近先成形」，前提是形狀還在
    // 成形中。融化的 uShapeProgress 恆為 1、形狀始終完整，這條規則就只剩副作用——
    // 它的影響半徑 0.72 遠大於水滴本身，等於幾顆「不侵蝕球」隨著水滴墜落掃過造型，
    // 半徑外被往內削 0.015、半徑內不削，形狀表面就整片整片地漲縮。
    // 形狀變形也關掉，理由跟融化同一條：實體恆為滿值，contactLead 只剩副作用
    // ——影響半徑遠大於水滴本身，飛過去的水滴會像幾把刨刀掃過兩顆形狀的表面。
    uniforms.uContactLead.value = (shatter || melting || morphSolid) ? 0 : 1;
    if (morphSolid) {
      uniforms.uShapeTex.value = morphPackedTexture;
      uniforms.uShapeMorph.value = morphCut.mode;
      uniforms.uShapeCut.value.set(
        morphCut.nx, morphCut.ny, morphCut.fromFront, morphCut.toFront,
      );
      // 這兩個是打包型 uniform，不走「滑桿 key → u+首字大寫」那條自動對應，
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
      const deform = meltDeformNow[i];
      if (deform) {
        stretch = deform.stretch;
        tip = deform.tip;
        shapeOscillation = deform.wobble;
      }
    } else if (P.motion === 'cinematic' && count >= 2 && (i === pairA || i === pairB)) {
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
      // 鎖定合體後兩個 SDF 使用完全相同的主軸與伸縮，視覺上成為單一液滴。
      ax += (pairAxisX - ax) * fusionLock;
      ay += (pairAxisY - ay) * fusionLock;
      az += (pairAxisZ - az) * fusionLock;
      stretch += (1 - stretch) * fusionLock;
      flatten *= 1 - fusionLock;
    }
    // 分裂模式的子滴在出生／吸收尾端半徑會趨近 0。若 smooth-min 融合半徑仍
    // 維持滿值，極小子滴仍會留下約 k/6 的鼓包，直到半徑守衛下一幀把它整顆
    // 跳過，輪廓便瞬間縮小。只讓子滴的融合權重隨體積交接平滑淡入／淡出；
    // 其他模式固定為 1，崩解模式的零半徑守衛也維持原語意。
    if (P.motion === 'cinematic' && i > 0) {
      blendWeight = separation;
    }
    dropShapeData[i].set(ax, ay, az, stretch);
    dropPhysicsData[i].set(flatten, shapeOscillation, tip, blendWeight);
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
    uRayDispersion: { value: P.rayDispersion },
    uRayDispersionAbbe: { value: P.rayDispersionAbbe },
    uRayDispersionLightIntensity: { value: P.rayDispersionLightIntensity },
    uRayDispersionLightSize: { value: P.rayDispersionLightSize },
    uRayDispersionFocus: { value: P.rayDispersionFocus },
    uRayDispersionAzimuth: { value: P.rayDispersionAzimuth },
    uRayDispersionElevation: { value: P.rayDispersionElevation },
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
    uRayDispersionEnabled: { value: P.rayDispersionEnabled ? 1 : 0 },
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
    uMembraneBaseColor: { value: new THREE.Color(P.membraneBaseColor) },
    uMembraneVeilColor: { value: new THREE.Color(P.membraneVeilColor) },
    uMembraneReflectionColor: { value: new THREE.Color(P.membraneReflectionColor) },
    uMembraneCardColor: { value: new THREE.Color(P.membraneCardColor) },
    uMembraneShadeColor: { value: new THREE.Color(P.membraneShadeColor) },
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
    // 形狀變形的雙形狀切削（見 shaders.js 的 uShapeMorph／uShapeCut）。
    // 0 是關閉，其餘模式一律維持 0，走原本的單一形狀路徑。
    uShapeMorph: { value: 0 },
    uShapeCut: { value: new THREE.Vector4(1, 0, 0, 0) },
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
    // contactLead（形狀在已抵達水滴附近先成形）是形狀匯聚專用的邏輯。崩解噴濺
    // 是它的反向過程，同一條規則會變成「形狀黏著碎片不肯消失、碎片之間先溶掉」，
    // 在輪廓上結出一顆顆瘤；融化則是形狀從頭到尾完整，沒有「先成形」可言，只剩
    // 隨水滴掃過的整片漲縮。用這個 0/1 開關在那兩個模式關掉它。
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

/* ===== 省電節流 =====
 * 桌面完全沒有自動降載：sampleRenderQuality 開頭就有 `!mobileRenderQuery.matches`
 * 的早退，所以在桌面上永遠是滿 DPR、滿步數、跟著螢幕更新率一路算下去。機器夠快
 * 就不會掉幀，於是它會很樂意把整張 GPU 燒滿來維持 60fps —— 這就是「放著跑一陣子
 * 機器就發燙」的來源，不是哪裡寫得慢。
 *
 * 這裡只在「使用者沒有在互動」時降影格率，不動解析度、不動步數，所以每一張畫面
 * 的品質完全不變，只有更新頻率變低。要降解析度才會影響畫質，那個代價這裡不付。
 */
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
let lastInteractionAt = 0;
let lastRenderedAt = 0;
let windowFocused = true;
let powerSaveThrottled = false;

function markInteraction() {
  lastInteractionAt = performance.now();
}
// 刻意不收 pointermove：游標只是移過畫面或停在上面，什麼都沒有改變，不該算成
// 互動。收了的話，滑鼠放在視窗上不動、或閱讀時隨手晃一下，就會一直把閒置計時
// 歸零，節流幾乎永遠不會生效。
//
// 真正會改變畫面的是「拖曳旋轉」「滾輪縮放」「動控制項」，這三件事分別由
// pointerdown/up、wheel、input/change 蓋到。拖曳過程本身不必額外收 pointermove
// ——旋轉時會持續對鏡頭的兩個滑桿發 input 事件（見 canvas 的 pointermove 處理），
// 計時器自然一直是新的；而且拖曳中本來就完全不節流。
// pointerup/cancel 是為了放開手之後有一段緩衝：慣性旋轉還會滑行一小段，那段
// 需要維持流暢。
for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'input', 'change']) {
  window.addEventListener(type, markInteraction, { passive: true, capture: true });
}
window.addEventListener('focus', () => { windowFocused = true; markInteraction(); });
window.addEventListener('blur', () => { windowFocused = false; });

// 回傳「這一幀該不該跳過」。拖曳中與輸出中一律不節流：前者是最需要即時回饋的
// 時候，後者根本不是給人看的（逐幀離線算繪，跳幀會漏影格）。
// 預覽 iframe 也排除——preview-performance.js 已經用自己那套 fps/DPR 節流接管了
// requestAnimationFrame，兩套疊在一起只會互相干擾。
function shouldSkipFrame(now) {
  powerSaveThrottled = false;
  if (!P.powerSave || PREVIEW || exportJob || dragging) return false;
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
  const interactionDpr = dragging ? Math.min(qualityDpr, minRenderDpr) : qualityDpr;
  if (Math.abs(renderer.getPixelRatio() - interactionDpr) > 0.01) {
    renderer.setPixelRatio(interactionDpr);
    resize();
  }
}

function sampleRenderQuality(now) {
  if (PREVIEW || !mobileRenderQuery.matches) return;
  // 節流期間不要取樣：這時候的 30fps 是我們自己壓的，不是 GPU 跟不上。混進統計
  // 會讓行動裝置把解析度與步數一起降下去，變成「省電模式順便掉畫質」。
  if (powerSaveThrottled) {
    qualitySampleStarted = now;
    qualitySampleFrames = 0;
    return;
  }
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
    rot.x = Math.max(-1.2, Math.min(1.2, rot.x + dy * 0.006));
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
      if (MOTION_MEMORY_KEYS.includes(key)) {
        motionMemory[key][P.motion] = key === 'count' ? Math.round(P[key]) : P[key];
      }
      if (key === 'shapeLiquidPosition') applyEdgeDropDistribution(P[key]);
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
      if (uniforms && uniforms[uName]) uniforms[uName].value = (key === 'count') ? Math.round(P[key]) : P[key];
      if (SHATTER_TIMELINE_KEYS.includes(key)) refreshShatterTimelineReadouts();
      if (key === 'gatherDuration' || key === 'shapeHold' || key === 'loopDuration') {
        updateTimelineSummary();
        // 循環秒數變了，那些「比例 × 循環秒數」的讀數也要跟著換算，但不動
        // 使用者設定的比例值，所以只重畫文字，不重新觸發 input。
        if (key === 'loopDuration') refreshLoopScaledReadouts();
      }
      requestPausedRender();
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
        // 每個按模式記憶的參數：先把舊模式剛才的值存回去，再把新模式記得的值
        // 寫回控制項並觸發它自己的 input/change，讓 uniform、顯示文字、
        // applyEdgeDropDistribution 之類的副作用照常跑一次，不必在這裡重複。
        for (const memKey of MOTION_MEMORY_KEYS) {
          motionMemory[memKey][previousMotion] = P[memKey];
          const memEl = document.getElementById(memKey);
          if (memEl.type === 'checkbox') {
            memEl.checked = motionMemory[memKey][P.motion];
            memEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            memEl.value = motionMemory[memKey][P.motion];
            memEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
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
      requestPausedRender();
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
      if (MOTION_MEMORY_KEYS.includes(key)) motionMemory[key][P.motion] = P[key];
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
      requestPausedRender();
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
      el.addEventListener('input', () => {
        buildSpectralCausticLUT();
        requestPausedRender();
      });
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
  const upd = () => {
    if (pv) pv.textContent = parseFloat(pos.value).toFixed(2);
    buildRampLUT();
    requestPausedRender();
  };
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
// 面板閘門。哪條參數在哪些情況下有效，宣告在 HTML 的 data-gate 上（空白分隔＝
// AND，前綴 ! ＝反相），這裡只負責把宣告翻成 disabled 與 .gated-off。
//
// 之所以不是把條件寫在 JS 裡逐個 getElementById：那份清單有四十幾條，每加一個
// 模式專屬參數就要回來補一次，而且 row / note / 控制項三者要各補一次，漏掉一個
// 不會報錯、只會安靜地讓某條滑桿在無效的模式下看起來可用。
//
// 巢狀是允許的：子孫只宣告自己額外的條件，祖先的條件由 applyGates 自動疊上。
//
// 每個動態模式自己的 gate 由 registry 產生（新增模式時不必回來補一行），
// 形狀來源這種與模式無關的條件仍寫在這裡。
const GATES = {
  ...motionGates(() => P.motion),
  svg:       () => P.shapeSource === 'svg',
  glb:       () => P.shapeSource !== 'svg',
};

function gateOpen(spec) {
  return spec.trim().split(/\s+/).every(token => {
    const negated = token.startsWith('!');
    const gate = GATES[negated ? token.slice(1) : token];
    // 未知的條件名一律放行：打錯字的後果是「該藏的沒藏」，而不是把控制項鎖死。
    if (!gate) return true;
    return gate() !== negated;
  });
}

// 閘門先跑，功能開關後跑。後者用 setDisabled 疊加，才不會把閘門關掉的控制項
// 重新打開（`el.disabled = !enabled` 這種寫法會直接覆蓋掉前一段的結論）。
const setDisabled = (el, disabled) => { el.disabled = el.gateOff || disabled; };

function applyGates() {
  const panel = document.getElementById('panel');
  // querySelectorAll 是文件順序，所以處理到某個元素時它的祖先已經標好了 ——
  // 巢狀的閘門因此只需要宣告「自己額外的條件」，不必把祖先的條件再抄一遍。
  panel.querySelectorAll('[data-gate]').forEach(el => {
    const open = gateOpen(el.dataset.gate) && !el.parentElement?.closest('.gated-off');
    el.classList.toggle('gated-off', !open);
  });
  // 收起來的東西一律連同停用：display:none 的控制項雖然點不到，但仍可能被
  // 程式或鍵盤觸及，狀態必須跟外觀一致。closest 包含元素自己，所以閘門直接
  // 標在控制項上（例如隱藏的檔案輸入框）也涵蓋得到。
  panel.querySelectorAll('input, select, button').forEach(el => {
    el.gateOff = !!el.closest('.gated-off');
    el.disabled = el.gateOff;
  });
}

function updateUIState() {
  applyGates();
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
      .forEach(el => { setDisabled(el, !enabled); });
    group.querySelectorAll('.effectBlock input, .effectBlock select, .effectBlock button')
      .forEach(el => {
        if (!el.closest('.toggleRow')) setDisabled(el, !enabled);
      });
  };
  setFeatureState('thinFilmGroup', P.filmEnabled);
  setFeatureState('artDispersionGroup', P.dispersionEnabled);
  setFeatureState('rayDispersionGroup', P.rayDispersionEnabled);
  setFeatureState('spectralCausticGroup', P.spectralCausticEnabled);
  const spectral = P.colorMode === 'spectral';
  const rampGroup = document.getElementById('rampGroup');
  const rampDisabled = spectral || !P.filmEnabled;
  rampGroup.classList.toggle('is-disabled', rampDisabled);
  rampGroup.querySelectorAll('input').forEach(el => {
    setDisabled(el, rampDisabled);
  });
  const colorBackground = P.bgMode === 'color';
  const bgc = document.getElementById('bgColor');
  const materialStyle = document.getElementById('materialStyle');
  const membraneOption = materialStyle.querySelector('option[value="membrane"]');
  const brightBgAssist = document.getElementById('brightBgAssist');
  bgc.disabled = !colorBackground;
  bgc.closest('.row').style.opacity = colorBackground ? 1 : 0.4;
  // 液態薄膜的合成是專為純白畫布設計（見 shaders.js 對應段落的白底假設）。
  // 背景一旦離開 #fff，立即收斂回通用玻璃，避免下拉顯示一個實際不成立、
  // shader 又無法合理解讀的組合。之前拿掉這個限制想讓薄膜通用背景，但薄膜
  // 的顯色路徑（亮底 transmission、白卡/藍卡反射、去背用的白底反乘）都是
  // 針對白底寫死的美術模型，不是簡單的背景取樣，所以重新鎖回純白。
  const pureWhiteBackground = colorBackground
    && P.bgColor.toLowerCase() === '#ffffff';
  membraneOption.disabled = !pureWhiteBackground;
  if (!pureWhiteBackground && P.materialStyle === 'membrane') {
    const previousStyle = P.materialStyle;
    P.materialStyle = 'universal';
    materialStyle.value = 'universal';
    switchMaterialProfile(previousStyle, 'universal');
    if (uniforms) uniforms.uMaterialStyle.value = SELECTS.materialStyle.map.universal;
  }
  const membraneMaterial = P.materialStyle === 'membrane';
  const membraneDepth = document.getElementById('membraneDepth');
  membraneDepth.disabled = !membraneMaterial;
  document.getElementById('membraneDepthRow').style.opacity = membraneMaterial ? 1 : 0.4;
  for (const key of ['membraneBaseColor', 'membraneVeilColor', 'membraneReflectionColor', 'membraneCardColor', 'membraneShadeColor']) {
    document.getElementById(key).disabled = !membraneMaterial;
    document.getElementById(key + 'Row').style.opacity = membraneMaterial ? 1 : 0.4;
  }
  // 液態薄膜本身就是前後表面透射模型，不讀取通用玻璃專用的亮底補償。
  const brightAssistUsable = colorBackground && !membraneMaterial;
  brightBgAssist.disabled = !brightAssistUsable;
  brightBgAssist.closest('.row').style.opacity = brightAssistUsable ? 1 : 0.4;
  document.body.style.background = colorBackground ? P.bgColor : '#000';
  // 輪廓液滴的模式閘門（形狀場 + SVG 擠出）走 data-gate；這裡只剩它自己的主
  // 開關。主開關關閉時只停掉會移動的液滴，「邊緣水滴」因為同時決定擠出邊緣的
  // 圓角，標了 .keepEnabled 而保持可用 —— 這樣才做得出「圓角擠出但沒有液滴」。
  const edgeDropGroup = document.getElementById('edgeDropGroup');
  edgeDropGroup.classList.add('featureGroup');
  edgeDropGroup.classList.toggle(
    'is-disabled',
    !edgeDropGroup.classList.contains('gated-off') && !P.edgeDropsEnabled,
  );
  edgeDropGroup.querySelectorAll('input').forEach(el => {
    const row = el.closest('.row');
    const survivesToggle = !!row && (row.classList.contains('keepEnabled')
      || row.classList.contains('toggleRow'));
    setDisabled(el, !P.edgeDropsEnabled && !survivesToggle);
  });
  const isSvg = P.shapeSource === 'svg';
  const shapeBtn = document.getElementById('shapeBtn');
  const shapeInput = document.getElementById('shapeInput');
  const fileAccept = isSvg
    ? '.svg,image/svg+xml'
    : '.glb,.gltf,model/gltf-binary,model/gltf+json';
  shapeBtn.textContent = isSvg ? '選擇 SVG…' : '選擇 GLB / GLTF…';
  shapeInput.accept = fileAccept;
  // 形狀 B 的匯入槽跟著同一個來源：兩顆形狀必須同種編碼才疊得進一張貼圖。
  const morphTargetBtn = document.getElementById('morphTargetBtn');
  if (morphTargetBtn) {
    morphTargetBtn.textContent = isSvg ? '選擇變形目標 SVG…' : '選擇變形目標 GLB / GLTF…';
    document.getElementById('morphTargetInput').accept = fileAccept;
  }
  // 模型品質（GLB 專用）、形狀厚度與邊緣圓角（都只作用於 SVG 擠出的
  // svgShapeDistance，GLB 走 volumeShapeDistance 根本不讀）全部走 data-gate。

}

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS, SELECT_DEFAULTS, TOGGLE_DEFAULTS, COLOR_DEFAULTS);
  resetMaterialProfiles();
  if (mobileRenderQuery.matches && !PREVIEW) P.cameraDistance = MOBILE_CAMERA_DISTANCE_DEFAULT;
  motionMemory = buildMotionMemory();
  resetSpectralCausticColors();
  resetRamp();
  bindControls();
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
    || MATERIAL_ENVIRONMENT_DEFAULTS.universal;
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
  // 每個模式各自預設的內建 SVG 展示形狀（見 motions/registry.js 的 svgDemo）。
  // 只在還沒匯入真正檔案時採用；GLB 沒有這個分歧，一律是內建環形。
  const svgVariant = MOTION_SVG_DEMO[P.motion] || 'default';
  const label = builtin
    ? (kind === 'svg'
      ? (svgVariant === 'melt' ? MELT_DEFAULT_SVG_NAME : DEFAULT_SVG_NAME)
      : DEFAULT_SOLID_NAME)
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
  shapeImportingKind = kind;
  shapeImportingVariant = (builtin && kind === 'svg') ? svgVariant : null;
  syncLoop();
  try {
    const next = kind === 'svg'
      // 超取樣的距離場暫時佔用 (size*ss)² 個 float；桌面用 3（1536²，約 38MB
      // 峰值），行動裝置降一級避免配置失敗。
      ? await svgToField(
        builtin ? (svgVariant === 'melt' ? makeMeltDemoSvgFile() : makeDefaultSvgFile()) : file,
        { supersample: mobileRenderQuery.matches ? 2 : 3 },
      )
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
    // key 帶著 shapeFieldSerial，換形狀後下一幀就會重挑滴落點／重配變形配對。
    meltAnchorKey = null;
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
  const usingBuiltinSvg = P.shapeSource === 'svg' && !userShapeFiles.svg;
  const desiredSvgVariant = MOTION_SVG_DEMO[P.motion] || 'default';
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
let exportJob = null;
let exportPreviewSettings = null;
let exportPreviewContext = null;
let rafId = 0, last = 0;
let pausedRenderRaf = 0;
const pauseBtn = document.getElementById('playCtl');
function isPaused() { return userPaused || extPaused || shapeConverting || exportJob || document.hidden; }
function requestPausedRender() {
  if ((!userPaused && !extPaused) || shapeConverting || exportJob || document.hidden || pausedRenderRaf) return;
  pausedRenderRaf = requestAnimationFrame(() => {
    pausedRenderRaf = 0;
    if (isPaused() && !shapeConverting && !exportJob && !document.hidden) {
      if (!inited) initGL();
      updatePausedCameraRotation();
      refreshRenderQuality();
      uniforms.uResolution.value.set(
        Math.max(1, canvas.clientWidth || document.documentElement.clientWidth),
        Math.max(1, canvas.clientHeight || document.documentElement.clientHeight),
      );
      uniforms.uMaxSteps.value = resolveMaxSteps();
      renderer.render(scene, camera);
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
    membraneOverWhite: uniforms.uMembraneOverWhite.value,
    bgColor: uniforms.uBgColor.value.clone(),
  };
  const target = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  const transparentExport = settings.background === 'transparent';
  // 液態薄膜的膜身是「透過白底看到的顏色」，而且亮底顯色路徑是由背景亮度開的
  // 閘 —— 把背景抽成黑的等於連材質模型一起換掉，成品會整片變淡、跟畫面對不上。
  // 改成保留白底把顏色算完，再由 shader 對白底反乘出 straight alpha
  //（uMembraneOverWhite 分支），背景照樣透得過來。通用玻璃維持原本的「黑場 +
  // 反預乘」，它的顏色本來就不依附背景。
  const membraneOverWhite = transparentExport && P.materialStyle === 'membrane';
  uniforms.uTransparentBackground.value = transparentExport ? 1 : 0;
  uniforms.uMembraneOverWhite.value = membraneOverWhite ? 1 : 0;
  uniforms.uBgMode.value = settings.background === 'scene' ? SELECTS.bgMode.map[P.bgMode] : 0;
  if (transparentExport && !membraneOverWhite) uniforms.uBgColor.value.set(0x000000);

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
    uniforms.uMembraneOverWhite.value = saved.membraneOverWhite;
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
  // 一定要在更新 last 之前就 return：last 沒動，下一張真正算繪的影格才會拿到
  // 累積起來的 dt，動畫速度維持不變，只是更新得比較疏。
  if (shouldSkipFrame(now)) return;
  lastRenderedAt = now;
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
      'filmEnabled', 'dispersionEnabled', 'rayDispersionEnabled',
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
