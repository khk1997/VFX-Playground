'use strict';
import { smoothstepCPU } from './util.js?v=svg-shape-53';

// 這個模組同時服務兩個模式：形狀匯聚（完整的 gather → hold → release 時間軸）
// 與穿梭環繞（只借用自由飛行軌道的手法，不吸收水滴）。兩者共用 freeOrbitPosition
// 這條「整數諧波軌道」，拆開反而要把同一段數學複製兩份，所以放在一起。
//
// 錨點是 bubble.js 那邊隨匯入形狀重算的陣列（會整個換掉，不是就地修改），所以
// 用 getter 取得而不是把陣列本身傳進來——直接傳會抓到換掉之前的舊陣列。
export const MAIN_ORBIT_TUNE = { x2: 1.7, ax2: 0.12, y1: 0.62, y3: 0.8, ay3: 0.08, z2: 1.3, az2: 0.48 };
export const MICRO_ORBIT_TUNE = { x2: 1.3, ax2: 0.16, y1: 0.72, y3: 0.7, ay3: 0.10, z2: 1.9, az2: 0.52 };

const TAU = Math.PI * 2;

export default function createFormationMotion(P, { dropSeeds, anchors, weaveAnchors }) {

// 自由軌道的暫存向量。刻意不與 bubble.js 那顆共用：那邊算微滴時也會呼叫
// freeOrbitPosition，共用同一顆就會在巢狀呼叫時互相覆寫。
const orbitScratch = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

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

function formationDropPosition(i, phase, count, out) {
  const a = phase * TAU;
  const { h1, h2, h3 } = dropSeeds[i];
  const anchor = i * TAU / count + h1 * 1.4;
  const orbit = P.spread * (1.25 + h2 * 0.65);
  const free = freeOrbitPosition(a, anchor, orbit, h2, h3, MAIN_ORBIT_TUNE, orbitScratch);
  const freeX = free.x, freeY = free.y, freeZ = free.z;
  const pool = anchors();
  const target = pool.length ? pool[i % pool.length] : null;
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
  const surface = weaveAnchors();
  const pool = surface.length ? surface : anchors();
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

  return {
    holdBreathScale,
    formationAmount,
    formationFidelityAmount,
    formationReleaseAmount,
    freeOrbitPosition,
    formationDropPosition,
    weaveDropPosition,
  };
}
