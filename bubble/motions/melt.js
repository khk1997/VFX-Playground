'use strict';
import { fract, hash11CPU, smoothstepCPU } from './util.js?v=svg-shape-29';

// 融化：形狀本身完全不動、也不消融，只在它的底部持續有水滴形成、垂下、墜落、
// 縮小到消失，然後同一個位置再長出下一滴。是一段永遠播下去的循環動畫。
//
// 「隨機的滴落間隔」與「無縫循環」看起來互斥，其實不是。每顆水滴的滴落節奏寫成
//     u = fract(phase * cycles + offset)
// 只要 cycles 是整數，phase=0 與 phase=1 算出來的 u 完全相同，接縫就不會跳；而
// cycles 與 offset 都由各自的雜湊決定，所以每顆的頻率與起始時機都不一樣，看起來
// 就是雜亂無章地此起彼落。（跟穿梭環繞「只用整數諧波」是同一條限制，見
// formation.js 的 weaveDropPosition。）
//
// u 在繞回 0 的那一刻本身是不連續的。這一點靠半徑包絡吸收：u=0 與 u→1 兩端半徑
// 都是 0，水滴在看不見的時候才重生，所以那個跳變永遠不會被看到。這也是為什麼
// 「縮小到消失」不是裝飾而是循環的必要條件。

// 底部錨點：水滴要從哪些位置滴下來。
//
// 不是「最低的 N 個取樣點」——那會全部擠在同一個最低點旁邊，變成一條直線上的
// 水柱。要的是散在底部各處、彼此拉開的幾個滴落點，所以在「夠低」的候選裡再做
// 一次 XZ 平面上的最遠點取樣。
export function selectBottomAnchors(candidates, count, band, seed = 0) {
  if (!candidates.length) return [];
  // 只從表面點裡挑：內部點在造型肚子裡，水滴從那裡冒出來會穿模。
  const surface = candidates.filter(p => p.surface);
  const pool = surface.length ? surface : candidates;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pool) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(1e-4, maxY - minY);
  const bandClamped = Math.max(0.02, Math.min(0.9, band));
  let threshold = minY + bandClamped * span;
  let low = pool.filter(p => p.y <= threshold);
  // 只有在完全挑不到候選時才放寬，而且有天花板。以前是「放寬到湊滿 count 個為
  // 止」，取樣點少的造型（預設 SVG 只有 38 個表面點）會把門檻一路推到造型半腰，
  // 水滴就從肚子中間冒出來。寧可少幾個滴落點——反正水滴數比滴落點多時會自動
  // 共用，同一個位置輪流滴下反而更像真的在滴水。
  const ceiling = minY + Math.max(bandClamped, 0.45) * span;
  while (!low.length && threshold < ceiling) {
    threshold += span * 0.05;
    low = pool.filter(p => p.y <= threshold);
  }
  if (!low.length) return [];

  // 兩個滴落點在水平上必須分得開。擠在同一個 XZ 的點（擠出造型的前後面、垂直
  // 側壁都會產生）落下來會完全重疊成一條線，看起來只有一滴。
  let spanX = 0, spanZ = 0;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of low) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  spanX = maxX - minX; spanZ = maxZ - minZ;
  const minSeparation = Math.max(1e-3, Math.max(spanX, spanZ) * 0.06);

  const chosen = [];
  const remaining = low.slice();
  const weights = seed
    ? low.map((_, i) => 0.7 + 0.6 * hash11CPU(i * 2.71 + Math.round(seed) * 43.1))
    : null;
  const target = Math.min(count, remaining.length);
  while (chosen.length < target) {
    let bestIndex = -1, bestScore = -Infinity, bestSpacing = 0;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      // 間距只看水平距離：兩個滴落點在 XZ 上分得開就好，Y 差多少不重要
      // （底部本來就都在差不多的高度）。
      const spacing = chosen.length
        ? Math.min(...chosen.map(q => Math.hypot(p.x - q.x, p.z - q.z)))
        : Infinity;
      // 愈低愈適合當滴落點（水往低處積），同時要跟已選的點拉開。
      const depth = (threshold - p.y) / span;
      const score = (Math.min(spacing, 1) * 1.6 + depth * 1.0)
        * (weights ? weights[i] : 1);
      if (score > bestScore) { bestScore = score; bestIndex = i; bestSpacing = spacing; }
    }
    // 已經沒有離得夠遠的候選了就收手，不硬湊到 count 個。
    if (bestIndex < 0 || (chosen.length && bestSpacing < minSeparation)) break;
    chosen.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
    if (weights) weights.splice(bestIndex, 1);
  }
  return chosen;
}

export default function createMeltMotion(P, { bottomAnchors }) {

// 這顆水滴一個循環裡滴幾次。必須是整數，phase=0/1 才同值（見檔頭）。
// 節奏差異讓每顆的頻率各自不同：有的一個循環滴四次、有的只滴一次。
function meltCycles(h) {
  const vary = 1 + (h - 0.5) * 2 * Math.max(0, P.meltRateVary);
  return Math.max(1, Math.round(Math.max(1, P.meltRate) * vary));
}

// 單顆水滴在自己那一次滴落裡的進度。
//   grow   0→1：在底部形成、脹大
//   fall   0→1：脫離後的墜落進度
//   shrink 0→1：墜落途中縮小，到 1 就完全消失
function meltTimeline(i, phase, seedBase) {
  const h1 = hash11CPU(seedBase + 1.7);
  const h2 = hash11CPU(seedBase + 5.3);
  const h3 = hash11CPU(seedBase + 9.1);
  const cycles = meltCycles(h1);
  // 相位偏移讓每顆的起跑點錯開，不會整排同時滴。
  const u = fract(phase * cycles + h2);
  const hang = Math.max(0.05, Math.min(0.9, P.meltHang));
  const grow = smoothstepCPU(u, 0, hang);
  const fall = u <= hang ? 0 : (u - hang) / Math.max(1e-4, 1 - hang);
  // 縮小從墜落途中某一點開始，一定要在 fall=1（也就是 u→1）之前收乾淨，
  // 否則水滴會帶著半徑跳回起點。
  const shrink = smoothstepCPU(fall, Math.min(0.95, P.meltShrink), 1);
  return { u, grow, fall, shrink, h1, h2, h3 };
}

// 水滴位置：形成時略微下垂，脫離後隨時間平方加速墜落。
// 水平方向只給極小的擾動，讓幾滴不會像複製貼上那樣完全重疊。
function meltPosition(anchor, t, out) {
  const sag = P.meltSag * t.grow;
  const drop = P.meltFall * t.fall * t.fall;
  const jitter = (t.h3 - 0.5) * 2 * P.meltJitter;
  return out.set(
    anchor.x + jitter * t.fall,
    anchor.y - sag - drop,
    anchor.z + jitter * 0.6 * t.fall,
  );
}

// 水滴半徑。兩端都必須是 0：u=0 由 grow 保證，u→1 由 shrink 保證。
// 中間那段乘積就是「長出來 → 掉下去 → 縮掉」的完整包絡。
function meltRadius(t) {
  const size = P.meltSizeMin + t.h3 * Math.max(0, P.meltSizeMax - P.meltSizeMin);
  return P.radius * size * t.grow * (1 - t.shrink);
}

// 主滴與微滴共用同一套時間軸，只是餵不同的種子（所以同一個滴落點會有大小、
// 時機都不同的水滴輪流落下，看起來像連續不斷的水流而不是整齊的節拍器）。
function meltDrop(i, phase, seedBase, out) {
  const anchors = bottomAnchors();
  if (!anchors.length) return null;
  const seed = seedBase + Math.round(P.meltSeed) * 31.7;
  const t = meltTimeline(i, phase, seed);
  const anchor = anchors[i % anchors.length];
  meltPosition(anchor, t, out);
  return { radius: meltRadius(t), fall: t.fall, grow: t.grow };
}

  return { meltDrop, meltTimeline, meltRadius };
}
