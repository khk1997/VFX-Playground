'use strict';

// 靜態模組的漸層玻璃色：CPU 這一半。
//
// 玻璃顏色是體積吸收（見 shader-chunks/glass-tint.js）。漸層就是讓吸收色隨位置
// 變：沿著一個軸，從「顏色 1」（absorbColor）過渡到「顏色 2」（absorbColorB）。
// 這裡只負責兩件事：漸層有哪幾種方向，以及漸層要鋪在多大的範圍上（造型的包圍
// 盒）。怎麼沿光路積分、怎麼混色都在 shader 那一半。
//
// 要調整的地方：
// - 加一種方向：GLASS_TINT_MODES 加一項、shader 的 glassTintAxisValue 加一個分支、
//   index.html 的 #absorbGradient 加一個選項、inspector.js 的 GLASS_TINT_LABELS
//   加一組標籤。
// - 範圍的來源：glassTintBox。

// select 的值 → shader 的 uGlassTintMode。0 一律是「單色」，shader 走原本的公式。
// 軸向用世界座標：靜態的造型不動也不轉（轉的是鏡頭），世界軸就是物體自己的軸，
// 漸層會黏在物體上。
export const GLASS_TINT_MODES = { off: 0, vertical: 1, horizontal: 2, depth: 3 };

// 漸層鋪滿的範圍：造型的世界座標包圍盒 { min: [x, y, z], max: [x, y, z] }。
//
// - 靜態的內建造型：呼叫端傳 shapeExtents（drop-physics.js 的 staticShapeHalfExtents），
//   以原點為中心。其餘模式沒有內建造型，傳 null。
// - 匯入的 GLB 走三角網格時：網格自己的包圍盒，縮放與位移跟 mapScene 的 shapePA
//   同一組（uShapeScale × uShapeAScale，加上 uShapeRigidOffset）。靜態不套剛體旋轉。
// - 其餘（SVG、網格建不出來的 GLB）：不知道確切範圍，退回 raymarch 用的包圍球
//   （中心 ± 半徑）。那顆球刻意放寬過，漸層因此會比物體本身寬一點、兩端的顏色
//   不會完全到底。要更準就得從形狀場量出真正的範圍。
export function glassTintBox({ shapeExtents = null, mesh = null, bounds }) {
  if (shapeExtents) {
    return { min: shapeExtents.map(v => -v), max: shapeExtents };
  }
  if (mesh) {
    const { min, max, scale, offset } = mesh;
    return {
      min: min.map((v, i) => v * scale + offset[i]),
      max: max.map((v, i) => v * scale + offset[i]),
    };
  }
  const { center, radius } = bounds;
  return {
    min: center.map(v => v - radius),
    max: center.map(v => v + radius),
  };
}
