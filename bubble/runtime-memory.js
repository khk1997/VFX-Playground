import { EDGE_TINT_TARGETS, edgeTintKeys } from './edge-tint.js?v=dark-tint-1';
import {
  MOTION_DEFAULT_COUNTS, MOTION_DEFAULT_DOLLY, MOTION_DEFAULT_LOOP_DURATION,
  MOTION_DEFAULT_RADIUS, MOTION_KEYS, MOTION_OVERRIDES,
} from './motions/registry.js?v=type-center-1';
import {
  COLOR_DEFAULTS, DEFAULTS, EDGE_TINT_BASE_BY_BACKDROP, EDGE_TINT_STRENGTH_BY_BACKDROP, SELECT_DEFAULTS,
  SPECTRAL_CAUSTIC_DEFAULTS, TOGGLE_DEFAULTS,
} from './runtime-defaults.js?v=tint-light-1';

// 按動態模式各自記憶的參數：使用者在某個模式下調過的值會被保留，切回來時
// 恢復。count/radius/loopDuration/dolly 每個模式的初始值天生就不同，直接來自
// registry.js 各自的一張表；MOTION_SCOPED_KEYS 這些控制原本是全域共用一份
// DEFAULTS/TOGGLE_DEFAULTS，只有某個模式的 overrides 有列到才使用特別預設。
// 因此毛細波的鏡頭與光束設定不會在切換後汙染其他動態模式。
export const MOTION_SCOPED_KEYS = [
  ...EDGE_TINT_TARGETS.flatMap(edgeTintKeys),
  'shapeDepth', 'shapeEdgeBevel', 'edgeDropsEnabled',
  'shapeLiquid', 'shapeLiquidPosition', 'shapeLiquidSize', 'shapeLiquidSpeed',
  'rayBeamIntensity', 'rayBeamSeparation', 'rayBeamChroma', 'rayBeamZoom',
  // 這兩條是稜光光芒的遮罩，跟上面那四條同一組；原本漏了，靜態模式要用自己的
  // 值就得連它們一起按模式記憶，否則調完切走再切回來會被別的模式蓋掉。
  'rayBeamFresnelMask', 'rayBeamNoiseScale',
  // 稜光光芒的其餘控制項。上面那六條早就按模式記憶了，剩下這些沒列，於是
  // registry 的 override 寫不回控制項——私語模式要一整組指定的光芒設定，
  // 缺一條就會沿用全域值，看起來像 override 沒生效。
  'rayBeamRings', 'rayBeamGlow', 'rayBeamSpeed',
  'rayBeamAzimuth', 'rayBeamElevation', 'rayBeamRefract', 'rayBeamNoiseMask',
  'rayDispersionEnabled', 'rayBeamPattern',
  'spectralCausticEnabled',
  'spectralCausticIntensity', 'spectralCausticFocus', 'spectralCausticSeparation',
  'spectralCausticBlend', 'spectralCausticWidth',
  'spectralCausticDensity', 'spectralCausticWarp', 'spectralCausticNoiseScale',
  'spectralCausticFilmSoften',
  'spectralCausticAzimuth', 'spectralCausticElevation',
  'spectralCausticMapping',
  ...SPECTRAL_CAUSTIC_DEFAULTS.map((_, index) => `spectralCausticCol${index}`),
  // 藝術色散的開關，跟上面的光譜焦散開關同一個身分。
  'dispersionEnabled',
  'cameraDistance', 'cameraRotationX', 'cameraRotationY',
  // 環繞幅度也是構圖的一部分，跟上面三條鏡頭參數同一組。
  'spin',
  // 私語的外殼需要比一般水滴低很多的 FBM 起伏；列入模式記憶後 registry
  // 的 wobble override 才會真的寫回控制項與 uniform，而不是仍沿用全域 0.305。
  'wobble',
  // 起伏的時間項。私語模式要把外殼定格（wobbleSpeed 0），而 wobble 本身保留，
  // 所以兩條都得按模式記憶，只列 wobble 會讓外殼照樣流動。
  'wobbleSpeed',
  // 白底預設需要切換純色背景；兩個底色各自記憶，不影響深底設定。
  'bgMode', 'bgColor',
  'materialStyle',
  // 材質那一組。必須排在 materialStyle 後面：切換材質類型會由
  // switchMaterialProfile 還原該類型記住的整組材質值，而模式記憶是照這個陣列
  // 的順序逐一寫回的，排在後面模式的 override 才蓋得過材質類型的 profile。
  'transmission', 'reflect', 'materialExposure', 'roughness', 'fresnel', 'ior',
  'hdriYaw', 'hdriPitch', 'hdriBlur', 'envRefraction',
  'dispersion', 'artPatternSpeed', 'absorbColor', 'researchIconIOR',
  // 水滴形態這兩條同樣沒列進來，所以 research overrides 裡的 viscosity 0.82 /
  // surfaceTension 0.92 從來沒被寫回控制項，面板一直是全域的 0.78 / 0.82。
  'viscosity', 'surfaceTension',
  // 這一組波紋參數是靜態模式與毛細波共用的同一批控制項（見 registry.js 的
  // capillaryTextureUI），但兩個模式要的預設不一樣：毛細波是整個模式的主角，
  // 靜態模式只是拿它在幾何體表面做一層很淡的質感。不按模式記憶的話，把靜態
  // 想要的數值設成預設會連帶改掉毛細波，反之亦然。
  'capillaryTexture', 'capillaryHeight', 'capillaryRings', 'capillarySpeed',
  // 後處理是全域一份 DEFAULTS/TOGGLE_DEFAULTS，跟材質那組同樣的道理：私語
  // 指定了一組後處理手感（見 registry.js 的 overrides），沒有按模式記憶的話
  // 這些值只會在切進私語的那一刻套用一次，之後被使用者調過、切到別的模式
  // 再切回來就再也拿不回研究預設，而是沿用使用者上次調到的全域值。
  'absorb', 'postExposure', 'postContrast', 'postBrightness', 'postGrain', 'postGrainScale',
  'bloomEnabled', 'streaksEnabled', 'streakCount', 'streakAngle', 'streakLength',
  'streakChroma', 'streakIntensity',
];
// 會按「模式＋底色情境」各記一格的參數。
//
// 這裡原本掛著一份白底定案數值（LIGHT_BACKDROP_PRESET），切到淺底時整組寫進
// 控制項。那組值已經整批捨棄：它是在「深底 shader 路徑 + 白背景」上調出來的，
// 而那條路徑的美術模型是「在黑場上加光」，白底上加光會被最終 over 合成精確
// 抵銷（見 shaders.js 的 universalCovered 那段），所以再怎麼調都到不了深底的
// 質感。淺底的做法要重新來，起點回到「跟深底一模一樣」。
//
// 名單本身保留：兩個底色仍各自記一格，所以在淺底上調參數不會污染已經定案的
// 深底外觀。淺底每一格的初始值現在都等於同一個模式的深底值（見
// motionDefaultsFor）。
export const BACKDROP_SCOPED_KEYS = new Set([
  ...EDGE_TINT_TARGETS.flatMap(edgeTintKeys),
  'bgMode', 'bgColor', 'materialStyle',
  'loopDuration', 'radius', 'count',
  'wobble', 'wobbleSpeed', 'researchIconIOR',
  'capillaryHeight', 'capillaryRings', 'capillarySpeed',
  'viscosity', 'surfaceTension',
  'reflect', 'absorb', 'absorbColor',
  'transmission',
  'roughness', 'fresnel', 'ior',
  'rayBeamIntensity', 'rayBeamSeparation', 'rayBeamChroma',
  'rayBeamZoom', 'rayBeamRings',
  'rayBeamAzimuth', 'rayBeamElevation', 'rayBeamRefract',
  'rayBeamFresnelMask', 'rayBeamNoiseScale',
  // 淺底預設關閉 RAY 模擬色散；列入底色記憶後，切回深底仍會恢復深底的開啟
  // 狀態，使用者在任一底色手動切換也只會改到該底色自己的記憶格。
  'rayDispersionEnabled',
  'spectralCausticEnabled',
  'spectralCausticCol2', 'spectralCausticCol4',
  'spectralCausticCol5', 'spectralCausticCol6',
  'spectralCausticIntensity', 'spectralCausticFocus',
  'spectralCausticSeparation', 'spectralCausticBlend',
  'spectralCausticWidth', 'spectralCausticDensity',
  'spectralCausticWarp', 'spectralCausticNoiseScale',
  'spectralCausticFilmSoften',
  'spectralCausticAzimuth', 'spectralCausticElevation',
  'dispersion', 'artPatternSpeed',
  'postExposure', 'postBrightness',
  'postContrast', 'postGrain', 'postGrainScale',
  'bloomEnabled', 'streaksEnabled',
  'streakCount', 'streakLength', 'streakIntensity',
  'cameraDistance', 'cameraRotationY', 'cameraRotationX',
  'spin', 'hdriYaw', 'hdriPitch', 'hdriBlur',
  'envRefraction',
]);
// 就是 SELECTS.backdrop.map 的那兩個鍵。不從 SELECTS 讀是因為那張表在這一行
// 之後才宣告，讀它會撞上 const 的 TDZ。
export const BACKDROP_KEYS = ['dark', 'light'];

export function createMemorySlot(params) {
  return (key, motion = params.motion, backdrop = params.backdrop) => (
    BACKDROP_SCOPED_KEYS.has(key) ? `${motion}|${backdrop}` : motion
  );
}

// 特定底色下另有起點的參數。淺底那一組是白底玻璃的基本調校（透射拉高、吸收
// 加重、邊緣光收斂，並關掉在白底上只會糊成一片的色散與光暈）；深底那兩個焦散
// 參數則是沿用改版前的值。
//
// 這張表以前是寫在 createMotionMemory 裡、在 motionDefaultsFor 之後再補寫一輪，
// 於是「記憶格的初值」跟「motionDefaultsFor 算出來的預設」對不起來——面板的
// 「已調整」標記與重設都讀後者，一進淺底就會把這幾根標成已調整。合併成一張表，
// 兩邊只剩一個來源。
const BACKDROP_OVERRIDES = {
  dark: {
    spectralCausticFocus: 1,
    spectralCausticSeparation: 1,
  },
  light: {
    transmission: 0.97,
    absorb: 1.35,
    envRefraction: 0.025,
    fresnel: 0.12,
    rayDispersionEnabled: false,
    bloomEnabled: false,
    streaksEnabled: false,
  },
};

export function motionDefaultsFor(key) {
  const intrinsicByMode = {
    count: MOTION_DEFAULT_COUNTS,
    radius: MOTION_DEFAULT_RADIUS,
    loopDuration: MOTION_DEFAULT_LOOP_DURATION,
    dollyEnabled: MOTION_DEFAULT_DOLLY,
  };
  const base = key in DEFAULTS ? DEFAULTS[key]
    : key in TOGGLE_DEFAULTS ? TOGGLE_DEFAULTS[key]
      : key in COLOR_DEFAULTS ? COLOR_DEFAULTS[key]
        : SELECT_DEFAULTS[key];
  const darkValue = motion => MOTION_OVERRIDES[motion]?.[key]
    ?? intrinsicByMode[key]?.[motion]
    ?? base;
  if (!BACKDROP_SCOPED_KEYS.has(key)) {
    return Object.fromEntries(MOTION_KEYS.map(motion => [motion, darkValue(motion)]));
  }
  return Object.fromEntries(MOTION_KEYS.flatMap(motion => BACKDROP_KEYS.map(backdrop => [
    `${motion}|${backdrop}`,
    key in BACKDROP_OVERRIDES[backdrop]
      ? BACKDROP_OVERRIDES[backdrop][key]
    // 染色強度兩個底色各有自己的起點（見 runtime-defaults 的
    // EDGE_TINT_STRENGTH_BY_BACKDROP）：深底 0、淺底滿。
    : EDGE_TINT_TARGETS.some(prefix => key === `${prefix}Tint`)
      ? EDGE_TINT_STRENGTH_BY_BACKDROP[backdrop]
      // 基底色跟著底色走（見 runtime-defaults 的 EDGE_TINT_BASE_BY_BACKDROP）。
      // COLOR_DEFAULTS 那邊給的是深底的值，淺底在這裡補上自己的。
      : EDGE_TINT_TARGETS.some(prefix => key === `${prefix}TintColor`)
        ? EDGE_TINT_BASE_BY_BACKDROP[backdrop]
        // 吸收色是液體本身的顏色，深底那個手調的水藍色維持原樣（見
        // runtime-defaults 的說明：這個值就是改動前寫死的吸收係數，預設外觀
        // 不變）。淺底沒有這層歷史包袱，預設就該跟淺底背景同色——不然一開箱
        // 就是一顆藍色的球浮在白色背景上，看起來像沒調好。
        : key === 'absorbColor' && backdrop === 'light'
          ? EDGE_TINT_BASE_BY_BACKDROP.light
          : darkValue(motion),
  ])));
}

export function createMotionMemory() {
  return {
    count: motionDefaultsFor('count'),
    radius: motionDefaultsFor('radius'),
    loopDuration: motionDefaultsFor('loopDuration'),
    dollyEnabled: motionDefaultsFor('dollyEnabled'),
    ...Object.fromEntries(MOTION_SCOPED_KEYS.map(key => [key, motionDefaultsFor(key)])),
  };
}
