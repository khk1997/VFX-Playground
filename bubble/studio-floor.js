'use strict';

// 棚景地板的高度：物體要坐在地板上，影子才貼得住它。
//
// 靜態的內建造型不動，最低點直接照 SDF 的尺寸算（drop-physics.js 的
// staticShapeFloorHeight）。形狀場的模式不一樣：造型會自己轉、浮動、呼吸
// （motions/shapeRigid.js），最低點每一幀都在變 —— 地板跟著跳的話整個場景會晃，
// 所以取「整段循環裡最低的那一點」，地板在循環裡固定不動。
//
// 世界座標跟 shader 的 mapScene 是同一組變換的反向（geometry.js 的 shapeP）：
//   世界 = 剛體位移 + R ·（剛體縮放 ⊙ 整體縮放 · 本地）
// 整體縮放是 uShapeScale × uShapeAScale。本地的範圍來自形狀場烘焙時記下的
// localBounds（shape-field.js）。
//
// 要調整的地方：
// - 取樣密度：FLOOR_SAMPLES。剛體動態是整數圈的正弦，48 點對任何圈數都夠密。
// - 地板跟物體之間的縫：FLOOR_GAP（太小會在接觸處閃爍）。
// - 水滴：呼叫端把整段循環掃過一遍的最低點用 dropLowest 傳進來（bubble.js 的
//   sweepDropLowest），地板取它跟造型最低點兩者較低的那個。
// - 其他往外推的量（例如表面波紋）：extraDrop。

export const FLOOR_SAMPLES = 48;
export const FLOOR_GAP = 0.02;

// 歐拉角 XYZ（跟 three 的 Euler 'XYZ' 一致）轉成旋轉矩陣的第二列：只需要世界 y。
function worldYRow(ax, ay, az) {
  const a = Math.cos(ax), b = Math.sin(ax);
  const c = Math.cos(ay), d = Math.sin(ay);
  const e = Math.cos(az), f = Math.sin(az);
  // three.js Matrix4.makeRotationFromEuler（order XYZ）的第二列。
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [af + be * d, ae - bf * d, -b * c];
}

// localBounds：{ min: [x, y, z], max: [x, y, z] }（本地座標）。
// rigidAt(phase)：該相位的剛體變換（computeShapeRigid 的回傳值）或 null。
// scaleAt(phase)：該相位的整體縮放（uShapeScale × uShapeAScale）。
// 回傳整段循環裡物體最低點的世界 y。
export function lowestPointOverLoop({ localBounds, rigidAt, scaleAt, samples = FLOOR_SAMPLES }) {
  const { min, max } = localBounds;
  let lowest = Infinity;
  for (let i = 0; i < samples; i++) {
    const phase = i / samples;
    const rigid = rigidAt(phase);
    const scale = scaleAt(phase);
    const row = rigid ? worldYRow(rigid.angleX, rigid.angleY, rigid.angleZ) : [0, 1, 0];
    const s = rigid ? [rigid.scaleX, rigid.scaleY, rigid.scaleZ] : [1, 1, 1];
    // 包圍盒在某個方向上的最低點：每個軸各自挑讓 y 最小的那一端。
    let y = rigid ? rigid.offsetY : 0;
    for (let axis = 0; axis < 3; axis++) {
      const k = row[axis] * s[axis] * scale;
      y += Math.min(k * min[axis], k * max[axis]);
    }
    if (y < lowest) lowest = y;
  }
  return lowest;
}

// 形狀場模式的地板高度。localBounds 是 null（形狀還沒烘好）時只看水滴；兩者都
// 沒有時回傳 fallback。
export function shapeFieldFloorHeight({
  localBounds, rigidAt, scaleAt, extraDrop = 0, dropLowest = Infinity, fallback,
}) {
  const shape = localBounds && Number.isFinite(localBounds.min[1])
    ? lowestPointOverLoop({ localBounds, rigidAt, scaleAt }) - extraDrop
    : Infinity;
  const lowest = Math.min(shape, dropLowest);
  return Number.isFinite(lowest) ? lowest - FLOOR_GAP : fallback;
}
