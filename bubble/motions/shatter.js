'use strict';
import { hash11CPU, smoothstepCPU } from './util.js?v=svg-shape-76';

// 崩解噴濺的碎片大小基準：「水滴大小」滑桿等於這個值時，在這個模式代表 ×1 原尺寸。
export const SHATTER_RADIUS_BASE = 0.25;

// burst 與 shapeOut 的時鐘（見下方 shatterTimeline 的說明）。
const SHATTER_BURST_TRAVEL = 0.05;
const SHATTER_OUT_TRAVEL = 0.15;

// 噴散亂數種子的取樣間距（見 shatterSeed）。
const SHATTER_SEED_STRIDE = 17.3;

// 這個模組只讀參數、不改參數，也不碰場景狀態，所以用工廠把 P 綁進來一次，
// 呼叫端的函式簽章與拆檔前完全相同。
export default function createShatterMotion(P) {

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
// 「水滴大小」滑桿在這個模式退化成整體乘數（0.25 = 原尺寸，拉到 0 碎片就完全
// 消失）；碎片之間的大小差異改由「碎片大小差異」控制，且是乘在各自的局部厚度
// 上，所以厚的地方剝下大塊、細的地方是小屑，不會有哪一顆突出到輪廓外。
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

  return {
    shatterSegments,
    shatterSegmentSeconds,
    shatterTimeline,
    shatterSeed,
    shatterTravel,
    shatterOffset,
    shatterShapeAmount,
    shatterFragmentRadius,
    shatterRadius,
  };
}
