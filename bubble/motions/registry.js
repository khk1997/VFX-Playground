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
//   count/radius/loopDuration
//                  該模式的預設值。這三項按模式各自記憶——使用者在某個模式下
//                  調過的值會保留，切回來時恢復，只有初始預設不同。
export const MOTIONS = {
  cinematic: {
    label: '分裂 Split',
    uniform: 0,
    usesShapeField: false,
    gate: 'split',
    count: 2,
    radius: 0.4,
    loopDuration: 12,
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
  },
};

const entries = Object.entries(MOTIONS);
const pick = field => Object.fromEntries(entries.map(([key, m]) => [key, m[field]]));

export const MOTION_UNIFORM_MAP = pick('uniform');
export const MOTION_DEFAULT_COUNTS = pick('count');
export const MOTION_DEFAULT_RADIUS = pick('radius');
export const MOTION_DEFAULT_LOOP_DURATION = pick('loopDuration');

export const usesShapeField = motion => Boolean(MOTIONS[motion]?.usesShapeField);

// UI 面板的 data-gate → 判斷式。除了每個模式自己的 gate，另外有一個涵蓋全部
// 需要形狀的模式的 'shape'。
export function motionGates(currentMotion) {
  const gates = {};
  for (const [key, m] of entries) gates[m.gate] = () => currentMotion() === key;
  gates.shape = () => usesShapeField(currentMotion());
  return gates;
}
