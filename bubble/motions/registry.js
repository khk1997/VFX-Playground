'use strict';

// 動態模式的單一資料來源。
//
// 這些欄位原本散在 bubble.js 的六張表裡（SHAPE_MOTIONS、motionCounts、
// motionRadius、motionLoopDuration、SELECTS.motion.map、GATES），新增一個模式
// 得同時改六個地方、漏一個就是難查的錯。集中之後，「加一個模式」在這個檔案裡
// 就是加一筆，行為本身則放在各自的 motions/<name>.js。
//
// 欄位說明：
//   uniform        shader 的 uMotion 值。歷史編號有跳號（2 曾是已移除的脈動呼吸），
//                  沿用原值以免既有參數組合檔對不上。
//   usesShapeField 要不要匯入／顯示 SVG/GLB 形狀。比「走匯聚時間軸」範圍更廣：
//                  穿梭環繞與崩解噴濺也要同一顆形狀，只是不吸收水滴。
//   gate           UI 面板的 data-gate 值，決定哪些參數列在這個模式顯示。
//   count/radius/loopDuration/dolly
//                  該模式的預設值。這幾項按模式各自記憶——使用者在某個模式下
//                  調過的值會保留，切回來時恢復，只有初始預設不同。
//   svgDemo        使用者還沒自己匯入 SVG 時，這個模式該顯示哪個內建展示形狀
//                  （見 default-shapes.js）。只有需要形狀的模式才有意義。
export const MOTIONS = {
  cinematic: {
    label: '分裂 Split',
    uniform: 0,
    usesShapeField: false,
    gate: 'split',
    count: 2,
    radius: 0.4,
    loopDuration: 12,
    dolly: true,
  },
  formation: {
    label: '形狀匯聚 Formation',
    uniform: 1,
    usesShapeField: true,
    gate: 'formation',
    // 匯聚只需要 1 顆種子，其餘體積由微滴群逐漸填出來。
    count: 1,
    // 依賴外部形狀的模式改用較小的滴徑，吸附進外形時顆粒感更細。
    radius: 0.25,
    loopDuration: 12,
    dolly: true,
    svgDemo: 'default',
  },
  weave: {
    label: '穿梭環繞 Weave',
    uniform: 3,
    usesShapeField: true,
    gate: 'weave',
    // 沒有逐漸填滿的微滴群，畫面豐富度全靠主水滴撐，所以顆數比匯聚多得多。
    count: 6,
    radius: 0.25,
    loopDuration: 12,
    dolly: true,
    svgDemo: 'default',
  },
  melt: {
    label: '融化 Melt',
    // 2 是已移除的「脈動呼吸」留下的空號，正好補上。
    uniform: 2,
    usesShapeField: true,
    gate: 'melt',
    // 滴落點散在底部，主滴多一點才看得出「到處都在滴」；另外還有微滴群加量。
    count: 8,
    radius: 0.25,
    // 融化是永遠播下去的循環，沒有敘事段落要交代，循環短一點滴落密度才夠。
    loopDuration: 6,
    // 鏡頭推軌是「分裂 ~0.24、融合 ~0.80」那組敘事節拍，跟融化的持續滴落
    // 毫無關係；融化的形狀本身也該完全靜止，所以預設關掉。使用者仍可以在
    // UI 打開——見 bubble.js 的 dolly 計算與 index.html 的「前後拉伸」開關。
    dolly: false,
    // 問號的底部只有一個小圓點，滴落點會擠成一團看不出「整個底部在滴」；
    // 冰塊的底邊夠寬，才挑得出好幾個分散的滴落點。
    svgDemo: 'melt',
  },
  shatter: {
    label: '崩解噴濺 Shatter',
    uniform: 4,
    usesShapeField: true,
    gate: 'shatter',
    // 碎片愈多愈像噴濺，主水滴與微滴一起當碎片用。
    count: 8,
    // 「水滴大小」在這個模式是碎片的整體乘數，滑桿最小值 0.25 剛好＝×1 原尺寸
    // （見 shatter.js 的 SHATTER_RADIUS_BASE）。
    radius: 0.25,
    // 四段時長預設 1.1 / 0.5 / 0.4 / 2.0 合計正好 4 秒，面板才顯示得出實際秒數。
    loopDuration: 4,
    dolly: true,
    svgDemo: 'default',
  },
};

const entries = Object.entries(MOTIONS);
const pick = field => Object.fromEntries(entries.map(([key, m]) => [key, m[field]]));

export const MOTION_UNIFORM_MAP = pick('uniform');
export const MOTION_DEFAULT_COUNTS = pick('count');
export const MOTION_DEFAULT_RADIUS = pick('radius');
export const MOTION_DEFAULT_LOOP_DURATION = pick('loopDuration');
export const MOTION_DEFAULT_DOLLY = pick('dolly');
export const MOTION_SVG_DEMO = pick('svgDemo');

export const usesShapeField = motion => Boolean(MOTIONS[motion]?.usesShapeField);

// UI 面板的 data-gate → 判斷式。除了每個模式自己的 gate，另外有一個涵蓋全部
// 需要形狀的模式的 'shape'。
export function motionGates(currentMotion) {
  const gates = {};
  for (const [key, m] of entries) gates[m.gate] = () => currentMotion() === key;
  gates.shape = () => usesShapeField(currentMotion());
  return gates;
}
