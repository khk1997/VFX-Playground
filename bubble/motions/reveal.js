'use strict';

// 打字機 Reveal：一道波從一側掃過去，形狀跟著波前「被寫出來」；定格一段；再
// 反向掃回去把它抹掉。水滴只存在於波前那一小撮——它們從波掃來的方向飛進來、
// 在波前抵達自己位置的那一刻併進實體，所以看起來是液體被那道波「鋪」上去的，
// 而不是一群球各自飛到定位。
//
// 整個模式重用形狀變形（morph）那套消失場與波前機制，但只作用在單一形狀上：
//
//   shaders.js 的兩形狀分支用 uShapeMorph 決定哪個通道是「消失中的舊形狀」
//   （fromCh）、哪個是「出現中的新形狀」（toCh），而 uMorphActive 可以把其中
//   一邊整個關掉。於是：
//     寫入 = uShapeMorph 2（toCh 指向通道 0）＋ uMorphActive (0,1)，掃 uShapeCut.w
//     抹除 = uShapeMorph 1（fromCh 指向通道 0）＋ uMorphActive (1,0)，掃 uShapeCut.z
//   兩者讀的都是通道 0，也就是形狀 A 自己那張貼圖的 r 通道 —— 不需要 morph 的
//   雙通道打包貼圖（packShapePairTexture），也因此不必等第二顆形狀烘焙。
//
//   定格段直接把 uShapeMorph 設回 0 走單一形狀那條路：整顆形狀完整顯示，而且
//   省掉兩次距離場取樣與整條切削運算。定格佔循環的一大段，這筆省得值得。
//
// 因為波前、收頸、亂流全都沿用同一條 dissolveField，「形狀怎麼被寫出來」的手感
// 不用重新調——它跟形狀變形是同一套材質語言。
//
// 波前形狀刻意固定成平面掃描（uMorphFront = 0），不開放放射／螺旋：那兩種讀起來
// 是「從中心綻開」與「捲進來」，都不是打字機。想要那些效果的話形狀變形模式已經
// 有了。
const DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));

export default function createRevealMotion(P, { anchors }) {

// 循環切成三段：寫入 → 定格 → 抹除。
//
// 一定要有抹除段：少了它，循環尾端會從「完整形狀」硬跳回「什麼都沒有」，接縫
// 上是一格瞬變。抹除掃回去之後，phase = 1 時畫面本來就是空的，跟 phase = 0
// 精確相接。
//
// 定格之外的時間對半分給寫入與抹除。兩段不分開給參數：真正有意義的選擇只有
// 「定格佔多久」，寫入比抹除快或慢並不構成另一種效果，只會讓人多調一個旋鈕。
function revealTimeline(phase) {
  const hold = Math.max(0, Math.min(0.6, P.revealHold));
  const travel = Math.max(0.05, (1 - hold) * 0.5);
  if (phase < travel) return { t: clamp01(phase / travel), erasing: false, holding: false };
  if (phase < travel + hold) return { t: 1, erasing: false, holding: true };
  return { t: clamp01((phase - travel - hold) / travel), erasing: true, holding: false };
}

// 抹除反向掃：寫入從左到右，抹除就從右到左，讀起來像倒退鍵把字一個個吃掉。
// 同方向掃兩趟的話，抹除看起來是「又寫了一次、只是這次在刪」，方向感自相矛盾。
const ERASE_WAVE_TURN = 180;

// 消失場的 CPU 版本。必須跟 shaders.js 的 dissolveField 是同一條式子，否則實體
// 被寫出來的位置會跟水滴抵達的位置對不上。這裡只需要平面掃描那一支（見檔頭：
// 波前形狀固定為 0），所以是單純的投影。
//
// 亂流那一層不複製：它在 shader 端是 3D fBm，CPU 逐字重現一份成本高、而且日後
// 只要有一邊改了就會悄悄走鐘。水滴那側改用等效做法——依索引雜湊給一個穩定的
// 出發偏移，幅度跟著亂流量走（見 dropProgress 的 breakJitter）。位置不會逐點
// 對齊，但「邊緣參差不齊、水滴也跟著參差地落下」這個讀感是對的。
const projectOf = (x, y, angle) => x * Math.cos(angle) + y * Math.sin(angle);

// 每幀對錨點掃一遍是幾十筆加法，但角度沒動時結果不變，所以拿它當 key 快取。
// 範圍一定要用「這個角度下實際的投影範圍」，不能用外接半徑之類的固定尺度：用
// 固定尺度時投影幾乎不可能真的取到兩端，波前在還沒掃完形狀時就走完了行程，
// 剩下那段變成不會動的死時間。
let waveKey = null;
let waveLo = 0;
let waveSpan = 1;
function waveRange(pool, angle) {
  const key = `${angle}:${pool.length}:${pool[0]?.x},${pool[0]?.y}`;
  if (waveKey === key) return;
  let lo = Infinity, hi = -Infinity;
  for (const s of pool) {
    const value = projectOf(s.x, s.y, angle);
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  waveKey = key;
  waveLo = lo;
  waveSpan = Math.max(1e-4, hi - lo);
}

const waveAngleOf = erasing => (P.revealWaveAngle + (erasing ? ERASE_WAVE_TURN : 0)) * DEG;
const staggerAmount = () => Math.max(0, Math.min(0.9, P.revealStagger));

// 同一顆水滴每幀必須拿到完全一樣的偏移，否則它會自己抖——所以雜湊吃的是索引
// 而不是位置或時間。
const hashJitter = i => {
  const v = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

// 波前超出錨點範圍多少才算「整顆形狀都掃完了」。錨點是表面的取樣點，形狀本身
// 一定比錨點的包圍範圍再大一圈（描邊有寬度、擠出有厚度），波前只掃到最後一個
// 錨點就停的話，形狀邊緣會留下一小條永遠寫不出來／抹不掉的殘料。
const FRONT_MARGIN = 0.18;
// 錯開量 0 會讓波前寬度歸零、反解發散（所有水滴同時出發，波前就沒有寬度可言），
// 夾一個下限當防呆。
const MIN_STAGGER = 0.05;

// 每顆水滴的進度。lead 是它在掃描軸上的位置（0 = 波最先掃到，1 = 最後），u 是
// 它自己這一趟飛行的進度（0 = 還沒出發，1 = 已經到位／已經離開）。
function dropProgress(i, phase) {
  const pool = anchors();
  const { t, erasing, holding } = revealTimeline(phase);
  if (!pool.length) return { anchor: null, u: 0, erasing, holding, lead: 0 };
  const anchor = pool[i % pool.length];
  const angle = waveAngleOf(erasing);
  waveRange(pool, angle);
  const value = projectOf(anchor.x, anchor.y, angle);
  const breakJitter = P.revealNoise * hashJitter(i) * 0.5;
  const lead = clamp01((value - waveLo) / waveSpan + breakJitter);
  const stagger = staggerAmount();
  return {
    anchor,
    lead,
    erasing,
    holding,
    u: clamp01((t - lead * stagger) / (1 - stagger)),
  };
}

// 水滴的進場點：從波掃來的方向後方、離形狀一段距離的地方。每顆依索引雜湊錯開
// 側向與深度，否則整排水滴會排成一條直線一起推進，看起來是一塊移動的板子而不
// 是一群液滴。
//
// 抹除段的角度多轉 180°，所以進場點會落在形狀的另一側 —— 水滴是往「已經被抹掉
// 的那一側」甩出去的，也就是波前剛剛騰空的地方，而不是逆著波飛進還沒抹到的實體
// 裡。代價是 phase 0 與 phase 1 的水滴位置不連續（差一整個 launch 距離）：這在
// 視覺上無害，因為兩端的存在包絡都精確為 0（見 revealDropletEnvelope，寫入起點
// u=0、抹除終點 u=1，sin(πu) 兩端皆為 0），畫面上根本沒有那顆水滴。
//
// 但這也是為什麼打字機刻意「不」加進 bubble.js 那條解析速度（前後各取一次位置
// 做中央差分）的分支：那條路徑的前提是位置對 phase 連續（形狀匯聚與形狀變形都
// 是），跨過接縫取樣會讀到這個跳變、算出一個假的巨大速度。留在幀間差分的話，
// 假尖峰只會出現在半徑為 0 的那一幀，看不見。
function launchPoint(anchor, i, angle, out) {
  const dist = P.spread * (0.85 + hashJitter(i * 1.7 + 3) * 0.5);
  const nx = Math.cos(angle), ny = Math.sin(angle);
  // 沿掃描軸的法向錯開（波前方向的垂直方向），讓進場的水滴散成一片而不是一線。
  const sideways = (hashJitter(i * 2.9 + 11) - 0.5) * P.spread * 0.5;
  return out.set(
    anchor.x - nx * dist - ny * sideways,
    anchor.y - ny * dist + nx * sideways,
    anchor.z + (hashJitter(i * 3.3 + 17) - 0.5) * 0.4,
  );
}

// 實體的波前，給 shader 的 uShapeCut 用。
//
// 這不是另外編出來的曲線，而是直接從水滴的 u 式子反解：水滴在 t > lead·stagger
// 時出發、在 t = lead·stagger + (1 - stagger) 時抵達，把 lead 解出來就是波前的
// 位置。所以實體與水滴天生咬合——波前掃到哪裡，那裡的水滴剛好併進去。
function revealFront(phase) {
  const pool = anchors();
  const { t, erasing, holding } = revealTimeline(phase);
  if (!pool.length) return null;
  const angle = waveAngleOf(erasing);
  waveRange(pool, angle);
  if (holding) return { holding: true, angle };
  const width = Math.max(MIN_STAGGER, staggerAmount());
  // 餘裕除了形狀本身比錨點大一圈之外，還要加上亂流把場值推開的幅度：擾動是直接
  // 加在場值上的，波前不多走這一段，邊角就會留下寫不出來的殘料。
  const margin = FRONT_MARGIN * waveSpan + P.revealNoise;
  const leadToProj = lead => waveLo - margin + lead * (waveSpan + margin * 2);
  // 寫入時波前是「抵達波前」（水滴到位的那條線），抹除時是「出發波前」。兩者
  // 各自對應 shader 裡的 uShapeCut.w 與 .z。
  const lead = erasing ? clamp01(t / width) : clamp01((t - (1 - width)) / width);
  const front = leadToProj(lead);
  return {
    holding: false,
    erasing,
    angle,
    nx: Math.cos(angle),
    ny: Math.sin(angle),
    front,
    // 1 = 通道 0 當「消失中的舊形狀」（抹除），2 = 通道 0 當「出現中的新形狀」（寫入）。
    mode: erasing ? 1 : 2,
    // 波前掃出範圍外 = 那個狀態已經走完，shader 可以整個跳過距離場取樣。
    active: erasing ? lead < 1 : lead > 0,
  };
}

// 水滴只在「還沒併進實體」或「已經離開實體」的飛行途中存在。兩端歸零很重要：
// 定格時畫面上該是一顆乾淨完整的形狀，不是形狀外面還黏著一圈球。
//
// 指數 0.55 讓包絡在中段更飽滿——純 sin 的話水滴一半的飛行時間都還在長大或
// 縮小，看起來像在淡入淡出而不是真的飛過來。
function revealDropletEnvelope(u) {
  return Math.pow(Math.sin(Math.PI * clamp01(u)), 0.55);
}

function revealDropPosition(i, phase, out) {
  const { anchor, u, erasing, holding } = dropProgress(i, phase);
  if (!anchor) return out.set(0, 0, 0);
  if (holding) return out.set(anchor.x, anchor.y, anchor.z);
  const angle = waveAngleOf(erasing);
  launchPoint(anchor, i, angle, out);
  const sx = out.x, sy = out.y, sz = out.z;
  // 寫入是「從外面飛進錨點」，抹除是「從錨點飛出去」——同一條路徑的正反向。
  const fromX = erasing ? anchor.x : sx;
  const fromY = erasing ? anchor.y : sy;
  const fromZ = erasing ? anchor.z : sz;
  const toX = erasing ? sx : anchor.x;
  const toY = erasing ? sy : anchor.y;
  const toZ = erasing ? sz : anchor.z;

  const eased = u * u * (3 - 2 * u);
  const dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
  let x = fromX + dx * eased;
  let y = fromY + dy * eased;
  let z = fromZ + dz * eased;

  // 朝外凸的弧。液體離開／貼上表面是「隆起 → 拉離」，直線插值看起來像瞬移；
  // 凸出去一點之後，慣性形變（速度驅動的那套）也才有東西可拉。弧高隨這一段
  // 實際要走的距離收放，幾乎不用移動的水滴才不會憑空往外彈一下。
  const mx = (fromX + toX) * 0.5, my = (fromY + toY) * 0.5, mz = (fromZ + toZ) * 0.5;
  const mLen = Math.hypot(mx, my, mz);
  const ox = mLen > 1e-4 ? mx / mLen : 0;
  const oy = mLen > 1e-4 ? my / mLen : 1;
  const oz = mLen > 1e-4 ? mz / mLen : 0;
  const lift = P.revealArc * Math.sin(Math.PI * u) * Math.min(1, Math.hypot(dx, dy, dz));
  return out.set(x + ox * lift, y + oy * lift, z + oz * lift);
}

// solid 為真（實體寫得出來）時回傳「只在飛行途中存在」的包絡；為假時退回「一直
// 都在」——沒有距離場貼圖時畫面上只剩水滴，這時再把兩端歸零就整個循環都沒東西
// 可看了（跟形狀變形是同一條退路）。
function revealRadiusFactor(i, phase, solid) {
  const { anchor, u, holding } = dropProgress(i, phase);
  if (!anchor) return solid ? 0 : 1;
  if (!solid) return 1;
  if (holding) return 0;
  return revealDropletEnvelope(u);
}

  return { revealTimeline, revealFront, revealDropPosition, revealRadiusFactor };
}
