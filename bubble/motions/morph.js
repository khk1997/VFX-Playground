'use strict';

// 形狀變形 Morph：水滴群先排成形狀 A，接著像一道波掃過去、流成形狀 B，再掃回來。
//
// 這個模式刻意「只有水滴」——uShapeProgress 在 bubble.js 那邊對 morph 是 0，
// 距離場實體完全不顯示。原因是這個版本要先把手感最關鍵的一段調對：波掃過去的
// 樣子。實體疊上去之後（距離場插值）反而會蓋住水滴，手感對不對根本看不出來，
// 所以留到下一步。
//
// 三個設計決定，每個都有替代方案被否決過：
//
//   配對用最近距離，不用索引取模。A[i] → B[i] 的配法在兩顆形狀輪廓不一樣時
//   會讓水滴滿場交叉飛行，看起來是「一群水滴各自亂跑」而不是「形狀在變」。
//
//   路徑走朝外的弧線，不走直線。液體離開表面是「隆起 → 拉離」，直線插值看
//   起來像瞬移；凸出去一點之後，慣性形變（速度驅動的那套）也才有東西可拉。
//
//   每顆水滴的出發時間依它在空間中的位置錯開，不是全體同時走。這是整個模式
//   最重要的一項：同時走的話變形只是「所有東西一起抽動一下」，錯開之後才會
//   讀成一道波掃過形狀。morphStagger 就是這個錯開量。

const DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));

// 一對一配對：把所有 A×B 的距離排序，由近而遠挑，兩端都還沒被用過才成立。
//
// 一定要一對一，而且配對表的長度就是實際會畫出來的水滴數。這裡踩過一次坑：
// 起初的寫法是「每個 A 找最近的 B，B 裡沒被選到的再回頭補一筆」，配對表因此
// 比水滴數長。但水滴迴圈只跑到 count 為止（i < count，取的是表的前 count 筆），
// 補在尾巴那些「只有 B 有」的配對永遠輪不到 —— 畫面上的結果是形狀 A 排得很
// 完整、形狀 B 缺一大半，星形的角整個不見。
//
// 兩組錨點都由 distributePrimaryAnchors 挑成同樣的上限筆數（最遠點取樣，本來
// 就分佈均勻），所以一對一不會有剩，也不必擔心誰配不到。
export function buildMorphPairs(fromAnchors, toAnchors) {
  const pairs = [];
  if (!fromAnchors?.length || !toAnchors?.length) return withExtent(pairs);
  const candidates = [];
  for (let i = 0; i < fromAnchors.length; i++) {
    for (let j = 0; j < toAnchors.length; j++) {
      const a = fromAnchors[i], b = toAnchors[j];
      candidates.push({
        i, j,
        d: (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2,
      });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const usedFrom = new Set(), usedTo = new Set();
  for (const c of candidates) {
    if (usedFrom.has(c.i) || usedTo.has(c.j)) continue;
    usedFrom.add(c.i);
    usedTo.add(c.j);
    pairs.push({ a: fromAnchors[c.i], b: toAnchors[c.j] });
  }
  // 兩組數量不等時會剩下一邊。剩的那幾顆退回「最近的對象」，允許重疊——重疊的
  // 水滴由 smooth-min 融成一顆，正好就是液體匯流的樣子，總比憑空消失好。
  const nearest = (pool, p) => pool.reduce((best, q) => (
    (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2
      < (best.x - p.x) ** 2 + (best.y - p.y) ** 2 + (best.z - p.z) ** 2 ? q : best
  ), pool[0]);
  for (let i = 0; i < fromAnchors.length; i++) {
    if (!usedFrom.has(i)) pairs.push({ a: fromAnchors[i], b: nearest(toAnchors, fromAnchors[i]) });
  }
  for (let j = 0; j < toAnchors.length; j++) {
    if (!usedTo.has(j)) pairs.push({ a: nearest(fromAnchors, toAnchors[j]), b: toAnchors[j] });
  }
  return pairs;
}

export default function createMorphMotion(P) {

// 循環切成四段：定格 A → 變形去 → 定格 B → 變形回。
//
// 回程走完正好是 phase = 1，也就是循環接縫上水滴剛好回到 A、而且速度為 0
// （緩動兩端一階導數為 0）。不必像自由飛行那些模式一樣受「只能用整數諧波」
// 的限制——這裡根本沒有諧波，接縫是被時間軸本身保證的。
function morphTimeline(phase) {
  const hold = Math.max(0, Math.min(0.4, P.morphHold));
  const travel = Math.max(0.05, (1 - hold * 2) * 0.5);
  if (phase < hold) return { t: 0, back: false };
  if (phase < hold + travel) return { t: (phase - hold) / travel, back: false };
  if (phase < hold * 2 + travel) return { t: 1, back: false };
  return { t: clamp01((phase - (hold * 2 + travel)) / travel), back: true };
}

// 回程換一個掃描方向（+90°），否則兩趟看起來就是同一段動畫正放再倒放。
// 先不開成參數：真正有意義的選擇只有「跟去程不同」，具體差幾度看不出來。
const BACK_WAVE_TURN = 90;

// 出發順序：錨點在掃描軸上的投影，正規化成 0（最先動）到 1（最後動）。
//
// 正規化一定要用「這個角度下實際的投影範圍」，不能用形狀的外接半徑之類的
// 固定尺度。用固定尺度時投影幾乎不可能真的取到兩端，最後一顆水滴的 lead 只到
// 0.8 左右，於是整波在 t≈0.9 就走完了 —— 剩下那段變形時間變成不會動的死時間，
// 看起來就是「定格特別長、變形特別急」，而且長多少還隨形狀與角度而變。
//
// 消失場的 CPU 版本，必須跟 shaders.js 的 dissolveField 是同一條式子（波前
// 形狀那一層）。兩邊算的不一樣，實體被削掉的位置就跟水滴出發的位置對不上。
//
// 只複製「波前形狀」，不複製亂流與晶格那兩層：那兩層是 3D simplex 與 Voronoi，
// 要在 CPU 逐字重現一份成本高、而且日後只要有一邊改了就會悄悄走鐘。水滴那側
// 改用等效的做法——每顆水滴依索引雜湊給一個穩定的出發偏移，幅度跟著擾動量走
// （見 dropProgress 的 breakJitter）。位置不會逐點對齊，但「邊緣參差不齊、
// 水滴也跟著參差地離開」這個讀感是對的，而水滴很小很多，看的人讀的是整體。
function dissolveFieldCPU(x, y, angle) {
  const front = Math.round(P.morphFront);
  if (front === 1) return Math.hypot(x, y);
  if (front === 2) return Math.hypot(x, y) + Math.atan2(y, x) * P.morphSpiral;
  return x * Math.cos(angle) + y * Math.sin(angle);
}

// 每幀對 pairs 掃一遍是幾十筆的加法，但角度與波前形狀沒動時結果不變，所以拿
// 它們當 key 快取。範圍取兩顆形狀所有錨點的聯集，不分去程回程：水滴的出發
// 順序與實體的兩道波前必須落在同一把尺上，各用各的範圍會讓兩者各走各的。
function waveRange(pairs, angle) {
  const key = `${angle}:${P.morphFront}:${P.morphSpiral}`;
  if (pairs.waveKey !== key) {
    let lo = Infinity, hi = -Infinity;
    for (const pair of pairs) {
      for (const s of [pair.a, pair.b]) {
        const value = dissolveFieldCPU(s.x, s.y, angle);
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    pairs.waveKey = key;
    pairs.waveLo = lo;
    pairs.waveSpan = Math.max(1e-4, hi - lo);
  }
  return pairs;
}

const waveAngleOf = back => (P.morphWaveAngle + (back ? BACK_WAVE_TURN : 0)) * DEG;
const staggerAmount = () => Math.max(0, Math.min(0.9, P.morphStagger));

// 擾動開得愈大，實體的邊緣愈參差，水滴的出發時機也該跟著參差。用索引雜湊而
// 不是位置雜湊：同一顆水滴每幀拿到的偏移必須完全一樣，否則它會自己抖動。
const hashJitter = i => (Math.sin(i * 78.233 + 12.9898) * 43758.5453) % 1;

// 位置與半徑都要同一個 u，拆出來共用，免得兩邊的式子日後改到不一致。
function dropProgress(pairs, i, phase) {
  const { a, b } = pairs[i % pairs.length];
  const { t, back } = morphTimeline(phase);
  const from = back ? b : a;
  const to = back ? a : b;
  const angle = waveAngleOf(back);
  waveRange(pairs, angle);
  const value = dissolveFieldCPU(from.x, from.y, angle);
  const breakJitter = (P.morphNoise + P.morphCell) * hashJitter(i) * 0.5;
  const lead = clamp01((value - pairs.waveLo) / pairs.waveSpan + breakJitter);
  const stagger = staggerAmount();
  return { from, to, u: clamp01((t - lead * stagger) / (1 - stagger)) };
}

// 波前超出錨點範圍多少才算「整顆形狀都掃完了」。錨點是表面的取樣點，形狀本身
// 一定比錨點的包圍範圍再大一圈（描邊有寬度、擠出有厚度），波前只掃到最後一個
// 錨點就停的話，形狀邊緣會留下一小條永遠削不掉的殘料。
const FRONT_MARGIN = 0.18;

// 實體的兩道波前，給 shader 的 uShapeCut 用。
//
// 舊形狀跟著「出發波前」消失、新形狀跟著「抵達波前」出現，兩者差一整個錯開量
// ——中間那段就是水滴在飛的區域。這不是另外編出來的曲線，而是直接從水滴的
// u 式子反解：水滴在 t > lead·stagger 時出發、在 t = lead·stagger + (1-stagger)
// 時抵達，把 lead 解出來就是這兩條波前。所以實體與水滴天生咬合。
//
// 錯開量 0 會讓反解發散（所有水滴同時出發，波前就沒有寬度可言），夾一個下限。
// 這個下限只是防呆，不是想調出什麼效果：錯開量調得很低時，兩道波前之間會空出
// 一大片兩顆形狀都不在的區域，畫面在那段時間確實只剩水滴——那是「全體同時
// 移動」這個設定本來的樣子，不該偷偷改掉它。
//
// 反過來說，錯開量正是「畫面上隨時有多少實體」的旋鈕：它同時是波前的掃描
// 寬度與水滴飛行時間的補數（水滴飛行 = 1 - 錯開量）。調高 → 波掃得長、每顆
// 水滴只飛一小段、舊形狀退到哪裡新形狀就跟到哪裡；調低 → 舊形狀整個化成
// 水滴飛很久才重組。預設偏高就是為了前者那種廣告感。
const MIN_STAGGER = 0.05;

function morphFronts(pairs, phase) {
  const { t, back } = morphTimeline(phase);
  const angle = waveAngleOf(back);
  waveRange(pairs, angle);
  const width = Math.max(MIN_STAGGER, staggerAmount());
  // 餘裕除了形狀本身比錨點大一圈之外，還要加上亂流與晶格把場值推開的幅度：
  // 擾動是直接加在場值上的，波前不多走這一段，邊角就會留下削不掉的殘料。
  const margin = FRONT_MARGIN * pairs.waveSpan + P.morphNoise + P.morphCell;
  const leadToProj = lead => pairs.waveLo - margin + lead * (pairs.waveSpan + margin * 2);
  const fromLead = clamp01(t / width);
  const toLead = clamp01((t - (1 - width)) / width);
  return {
    // 波前已經掃過整個範圍 → 那顆形狀完全不在場，shader 可以整個跳過它的距離場
    // 取樣（見 shaders.js 的 uMorphActive）。定格時一定有一顆是這種狀態。
    fromActive: fromLead < 1,
    toActive: toLead > 0,
    // 1 = r 通道（形狀 A）變成 g 通道（形狀 B），2 = 反向。
    mode: back ? 2 : 1,
    nx: Math.cos(angle),
    ny: Math.sin(angle),
    fromFront: leadToProj(fromLead),
    toFront: leadToProj(toLead),
  };
}

// 水滴只在「已經離開舊形狀、還沒併進新形狀」的這段期間存在。兩端歸零很重要：
// 定格時畫面上該是一顆乾淨完整的形狀，不是形狀外面還黏著一圈球。
//
// 指數 0.55 讓包絡在中段更飽滿——純 sin 的話水滴一半的飛行時間都還在長大或
// 縮小，看起來像在淡入淡出而不是被甩出去。
function morphDropletEnvelope(u) {
  return Math.pow(Math.sin(Math.PI * clamp01(u)), 0.55);
}

function morphDropPosition(pairs, i, phase, out) {
  if (!pairs.length) return out.set(0, 0, 0);
  const { from, to, u } = dropProgress(pairs, i, phase);
  const eased = u * u * (3 - 2 * u);

  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  let x = from.x + dx * eased;
  let y = from.y + dy * eased;
  let z = from.z + dz * eased;

  // 朝外凸的弧。方向取起訖中點相對造型中心的向外向量；中點正好落在中心時
  // （對稱穿越的少數幾顆）退回 +Y，總比 NaN 好。
  const mx = (from.x + to.x) * 0.5, my = (from.y + to.y) * 0.5, mz = (from.z + to.z) * 0.5;
  const mLen = Math.hypot(mx, my, mz);
  const ox = mLen > 1e-4 ? mx / mLen : 0;
  const oy = mLen > 1e-4 ? my / mLen : 1;
  const oz = mLen > 1e-4 ? mz / mLen : 0;
  // 弧高隨這一段實際要走的距離收放：不跟距離掛鉤的話，幾乎不用移動的水滴也會
  // 憑空往外彈一下，整片沒在變的區域跟著抖。
  const lift = P.morphArc * Math.sin(Math.PI * u) * Math.min(1, Math.hypot(dx, dy, dz));
  x += ox * lift;
  y += oy * lift;
  z += oz * lift;
  return out.set(x, y, z);
}

// 正在移動的那一圈水滴脹大，已經到位的縮回原尺寸——質量被推著跑的感覺，
// 也讓波前自己看得出來在哪裡。sin(πu) 在起訖兩端都是 0，定格段完全不受影響。
// solid 為真（實體變形可用）時回傳「只在飛行途中存在」的包絡；為假時退回舊的
// 「一直都在、飛行中脹大」——匯入的是 GLB 時打包不了雙通道貼圖，畫面上只剩
// 水滴，這時再把兩端歸零就整個循環都沒東西可看了。
function morphRadiusFactor(pairs, i, phase, solid) {
  if (!pairs.length) return solid ? 0 : 1;
  const { u } = dropProgress(pairs, i, phase);
  return solid
    ? morphDropletEnvelope(u) * (1 + P.morphSwell)
    : 1 + P.morphSwell * Math.sin(Math.PI * u);
}

  return { morphTimeline, morphFronts, morphDropPosition, morphRadiusFactor };
}
