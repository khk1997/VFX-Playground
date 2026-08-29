'use strict';

// 私語：低幅度的液態外殼呼吸，以及兩顆延遲生成、互相繞行的內部玻璃核。
// 這一版先使用既有 metaball 管線驗證節奏；真正的 SVG glyph 厚度留給下一階段。
export default function createResearchMotion(P) {
  // 外殼全程保持液態起伏；時間項使用整數諧波，因此不需要在首尾淡回圓球。
  const shellEnvelope = () => 1;

  function shapeRigidMotion(phase) {
    const cycles = Math.max(0, Math.round(P.researchShellSpeed));
    const a = phase * Math.PI * 2 * cycles;
    const envelope = shellEnvelope(phase);
    const breath = Math.max(0, P.researchBreath);
    const swell = (Math.sin(a - 0.55) * breath * 1.9
      + Math.sin(a * 2 + 1.2) * breath * 0.65) * envelope;
    const squeeze = Math.sin(a * 2 - 0.8) * breath * 1.45 * envelope;
    return {
      angleX: Math.sin(a + 0.8) * 0.025 * envelope,
      angleY: Math.sin(a - 1.1) * 0.04 * envelope,
      angleZ: Math.sin(a * 2 + 0.4) * 0.018 * envelope,
      offsetY: Math.sin(a - 1.8) * 0.012 * envelope,
      scaleX: 1 + swell - squeeze * 0.28,
      scaleY: 1 + swell + squeeze * 0.45,
      scaleZ: 1 + swell - squeeze * 0.28,
    };
  }

  function dropPosition(index, phase, out) {
    const cycles = Math.max(0, Math.round(P.researchShellSpeed));
    const a = phase * Math.PI * 2 * cycles;
    // 主滴只負責完整外殼；兩個 glyph 由私語模式專用 shader 畫在殼內。
    out.set(0, 0, 0);
    return {
      reveal: 1,
      pulse: 1 + Math.sin(a - 0.5) * Math.max(0, P.researchBreath) * shellEnvelope(phase),
    };
  }

  return { shapeRigidMotion, dropPosition, shellEnvelope };
}
