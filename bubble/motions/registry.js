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
//                  （見 default-shapes.js）。只有需要形狀的模式才有意義。值取的是
//                  形狀本身的名字（question／ice），不是模式名——同一顆形狀可能
//                  被多個模式共用，用模式名當值會誤導。
//   overrides      稀疏表：「擠出外形／輪廓液滴」那組參數（shapeDepth、
//                  edgeDropsEnabled…）原本是全域共用一份 DEFAULTS，只有某個
//                  模式需要不一樣的預設時才在這裡列一筆，沒列到的鍵繼續沿用
//                  共用預設。跟 count/radius/loopDuration/dolly 不同——那三項
//                  是「每個模式的值天生就不一樣」，這裡是「大多數模式相同，
//                  少數模式需要覆寫」，不必為了一個模式的特例把同樣的數字
//                  在五個模式裡各抄一次。
export const MOTIONS = {
  split: {
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
    svgDemo: 'question',
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
    svgDemo: 'question',
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
    svgDemo: 'ice',
    // 融化持續滴落、水滴本身就在動，跟形狀匯聚那套「擠出外形＋輪廓液滴」
    // 的共用預設（原本是設計給靜止展示模型用的）不搭：擠出深度、邊緣圓角
    // 都要拉高才看得出冰塊的立體感；輪廓液滴則直接打開、水滴分佈與大小
    // 調整過、流速歸零（融化的水滴已經有自己的滴落動畫，輪廓液滴只負責
    // 靜態鑲邊，動起來反而互相干擾）。
    overrides: {
      shapeDepth: 0.28,
      shapeEdgeBevel: 0.129,
      edgeDropsEnabled: true,
      shapeLiquid: 1,
      shapeLiquidPosition: 6,
      shapeLiquidSize: 0.77,
      shapeLiquidSpeed: 0,
    },
  },
  morph: {
    label: '形狀變形 Morph',
    uniform: 5,
    usesShapeField: true,
    gate: 'morph',
    // 實體全程都在畫面上，水滴只是波前那一小撮飛行中的液體，不必多。
    count: 6,
    radius: 0.25,
    loopDuration: 6.5,
    // 變形本身已經是全畫面的運動，鏡頭再推軌只會讓人看不清波掃到哪裡。
    dolly: false,
    // 形狀 A。B 目前固定是內建星形（見 default-shapes.js 的 MORPH_TARGET_SVG_TEXT），
    // 還不能由使用者匯入——兩個匯入槽留到下一步。
    svgDemo: 'question',
    // 這個模式的形狀從頭到尾都是實體，擠出厚度與邊緣圓角的手感跟「水滴逐漸
    // 長成形狀」那套共用預設不一樣：薄一點、圓角大一點，切口與收頸才不會被
    // 厚實的側壁蓋住。
    overrides: {
      shapeDepth: 0.09,
      shapeEdgeBevel: 0.086,
    },
  },
  reveal: {
    label: '打字機 Reveal',
    uniform: 6,
    usesShapeField: true,
    gate: 'reveal',
    // 水滴只是波前那一小撮正在落下的液體，實體全程都在畫面上，不必多。但要比
    // 形狀變形多一點：這裡只有一趟波，同一時間在飛的水滴少一半。
    count: 8,
    radius: 0.25,
    loopDuration: 7,
    // 波已經是全畫面的橫向運動，鏡頭再推軌只會讓人看不清波掃到哪裡。
    dolly: false,
    svgDemo: 'question',
    // 跟形狀變形同一個理由：這個模式的形狀從頭到尾都是實體，擠出厚度薄一點、
    // 邊緣圓角大一點，波前的切口與收頸才不會被厚實的側壁蓋住。
    overrides: {
      shapeDepth: 0.09,
      shapeEdgeBevel: 0.086,
    },
  },
  jelly: {
    label: '果凍 Jelly',
    uniform: 7,
    usesShapeField: true,
    gate: 'jelly',
    // 造型本身就是全部的戲：水滴預設不出場。使用者想加幾顆點綴仍然可以調高，
    // 那些水滴會貼在表面錨點上跟著果凍一起晃（見 bubble.js 的 jelly 分支）。
    count: 0,
    radius: 0.25,
    // 戳一下、晃幾下、平息——這個節奏要短才有彈性感，12 秒會變成慢動作。
    loopDuration: 4,
    // 果凍是原地晃動，鏡頭推軌會跟形變混在一起，分不清是誰在動。
    dolly: false,
    svgDemo: 'question',
    // 厚實圓潤才像一塊果凍；薄片擠出被壓扁時看起來是紙在抖，不是膠體在晃。
    overrides: {
      shapeDepth: 0.3,
      shapeEdgeBevel: 0.13,
    },
  },
  shatter: {
    label: '崩解噴濺 Shatter',
    uniform: 4,
    usesShapeField: true,
    gate: 'shatter',
    // 碎片愈多愈像噴濺，主水滴與微滴一起當碎片用。
    count: 8,
    // 「水滴大小」在這個模式是碎片的整體乘數，0.25 這個預設值剛好＝×1 原尺寸
    // （見 shatter.js 的 SHATTER_RADIUS_BASE）。滑桿本身可以拉到 0（碎片完全
    // 消失），所以這個值是「基準」而不是「下限」。
    radius: 0.25,
    // 四段時長預設 1.1 / 0.5 / 0.4 / 2.0 合計正好 4 秒，面板才顯示得出實際秒數。
    loopDuration: 4,
    dolly: true,
    svgDemo: 'question',
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
export const MOTION_OVERRIDES = pick('overrides');
export const MOTION_KEYS = Object.keys(MOTIONS);

export const usesShapeField = motion => Boolean(MOTIONS[motion]?.usesShapeField);

// UI 面板的 data-gate → 判斷式。除了每個模式自己的 gate，另外有一個涵蓋全部
// 需要形狀的模式的 'shape'。
export function motionGates(currentMotion) {
  const gates = {};
  for (const [key, m] of entries) gates[m.gate] = () => currentMotion() === key;
  gates.shape = () => usesShapeField(currentMotion());
  return gates;
}
