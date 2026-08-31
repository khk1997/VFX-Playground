'use strict';

// 造型本身的剛體動態：呼吸縮放、旋轉、上下浮動、擠壓拉伸。跟所有走 SDF 的模式
// （形狀匯聚／穿梭環繞／融化／崩解噴濺／形狀變形）共用同一份時間軸，疊加在
// 水滴目標位置與 SDF 取樣座標的最終世界座標上——造型因此會「自己動」，而不是
// 只有水滴在動（見 bubble.js 的 applyShapeRigid／shaders.js 的 shapeP 反變換）。
//
// 用整數圈數驅動 sin/cos 是唯一的循環保證：sin(2π·n·phase) 對任何整數 n 在
// phase ∈ [0,1) 上都精確首尾相接，不需要額外收尾緩動段，也不會在循環接縫跳動。
//
// 旋轉／呼吸／浮動三個通道各自錯開 120° 相位，避免三者同步鼓動，看起來比較
// 像有機的晃動，而不是機械式的統一節拍。
// 純函式版本：給一組參數與相位，算出造型的剛體變換。抽出來是因為形狀變形
// 模式需要兩份獨立的造型動態同時存在——形狀 A 用一組參數、形狀 B 用另一組，
// 水滴在兩者之間過渡時混合兩份結果（見 bubble.js 的 shapeRigid2Now／
// applyShapeRigidBlend）。其餘模式只有一顆形狀，仍然只呼叫一次。
export function computeShapeRigid(params, phase) {
  const cycles = Math.max(1, Math.round(params.cycles));
  const base = phase * cycles * Math.PI * 2;
  // 疊加二次諧波做出不對稱的「蓄力→回彈」波形；ease 是疊加比例，
  // ease=0 時退化回單純正弦，跟加這個參數之前的行為完全等價。
  const ease = Math.max(0, Math.min(1, params.ease));
  const h2 = ease * 0.35;
  const wave = a => Math.sin(a) + h2 * Math.sin(2 * a);
  const waveVel = a => Math.cos(a) + h2 * 2 * Math.cos(2 * a);
  const maxVel = 1 + 2 * h2;

  // 三軸共用同一條波形（同一個 base），只是各自的振幅不同——這樣三軸疊起來
  // 是繞著一根固定傾斜軸來回擺動，而不是三個不同頻率各轉各的、看起來會亂晃。
  const spin = wave(base);
  const angleX = spin * params.spinX * Math.PI / 180;
  const angleY = spin * params.spinY * Math.PI / 180;
  const angleZ = spin * params.spinZ * Math.PI / 180;

  const breatheAngle = base + Math.PI * 2 / 3;
  const breathe = 1 + wave(breatheAngle) * params.breathe;

  const bobAngle = base + Math.PI * 4 / 3;
  const offsetY = wave(bobAngle) * params.bob;
  // 正規化到 [-1, 1]，0 代表浮動的最高／最低點（瞬時靜止）。
  const bobVel = waveVel(bobAngle) / maxVel;

  // 擠壓拉伸：瞬時速度愈快，沿 Y 拉長、XZ 收窄，模擬動態中的張力；
  // 靜止點（bobVel = 0）退回單純呼吸縮放，沒有額外形變。
  const stretch = bobVel * params.squash;

  return {
    angleX,
    angleY,
    angleZ,
    offsetY,
    scaleX: breathe * (1 - stretch * 0.22),
    scaleY: breathe * (1 + stretch * 0.35),
    scaleZ: breathe * (1 - stretch * 0.22),
  };
}

export default function createShapeRigidMotion(P) {
  function shapeRigidMotion(phase) {
    if (!P.shapeMotionOn) return null;
    return computeShapeRigid({
      cycles: P.shapeMotionCycles,
      ease: P.shapeMotionEase,
      spinX: P.shapeSpinX,
      spinY: P.shapeSpinY,
      spinZ: P.shapeSpinZ,
      breathe: P.shapeBreathe,
      bob: P.shapeBob,
      squash: P.shapeSquash,
    }, phase);
  }

  return { shapeRigidMotion };
}
