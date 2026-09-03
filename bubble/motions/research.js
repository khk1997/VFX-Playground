'use strict';

// 私語：主殼與伴生殼週期性融合，同時保留兩顆延遲生成、互相繞行的內部玻璃核。
export default function createResearchMotion(P, { dropSeeds = [] } = {}) {
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
    const pulse = 1 + Math.sin(a - 0.5) * Math.max(0, P.researchBreath) * shellEnvelope(phase);
    // 第一顆是包住 icon 的主殼；第二顆沿著同一個循環靠近、吞入，再回到只有頸部
    // 相連的姿勢。cosine 的兩端位置與速度都相同，所以影片首尾不會跳接。
    if (index === 0) {
      out.set(0, 0, 0);
      return { reveal: 1, pulse };
    }

    const tau = Math.PI * 2;
    const mergeWave = 0.5 - 0.5 * Math.cos(tau * phase);
    // 停留越大，曲線在高點附近越平；仍維持 0→1→0 與首尾零速度。
    const holdExponent = 1.75 - Math.max(0, Math.min(1, P.researchCompanionHold)) * 1.4;
    const immersion = Math.pow(mergeWave, holdExponent);
    const mainSeed = dropSeeds[0]?.radius || 1;
    const companionSeed = dropSeeds[index]?.radius || 1;
    const size = Math.max(0.12, P.researchCompanionSize);
    const radiusScale = size * mainSeed / companionSeed;
    const mainRadius = P.radius * mainSeed * pulse;
    const companionRadius = mainRadius * size;
    const exposure = Math.max(0, Math.min(1.25, P.researchCompanionExposure));
    const restDistance = mainRadius + companionRadius * exposure;
    const mergeDepth = Math.max(0, Math.min(1, P.researchCompanionDepth));
    const mergedDistance = mainRadius * (1 - mergeDepth);
    const distance = restDistance + (mergedDistance - restDistance) * immersion;

    // 軌跡改用「徑向靠近 + 固定世界尺度的側／深弧線」，不再直接轉方位角。
    // 舊做法的弧線幅度會跟 distance 一起縮：快吞進主殼時突然收緊，正是繞行看起來
    // 怪的原因。現在弧線以 mainRadius 為尺度，進入融合點前會均勻地走完整段。
    const route = Math.max(0, Math.min(2, Math.round(P.researchCompanionPath)));
    const traverse = Math.sin(tau * phase);
    const pathWave = route === 1
      // 同側弧線：靠近與退出都從同一側繞，中心點仍回到融合主軸。
      ? traverse * traverse
      // 8 字：徑向只融合一次，但橫向跨軸兩次。
      : route === 2
        ? Math.sin(tau * phase * 2) * 0.82
        // 雙側環繞：靠近與退出分走主軸兩側，形成最乾淨的一圈。
        : traverse;
    const angle = P.researchCompanionPathAngle * Math.PI / 180;
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const tangentX = -radialY;
    const tangentY = radialX;
    const sideArc = mainRadius
      * Math.sin(P.researchCompanionOrbit * Math.PI / 180) * pathWave;
    const depthArc = mainRadius
      * Math.sin(P.researchCompanionDepthOrbit * Math.PI / 180) * pathWave;
    out.set(
      radialX * distance + tangentX * sideArc,
      radialY * distance + tangentY * sideArc,
      depthArc,
    );
    return {
      reveal: 1,
      pulse: pulse * radiusScale,
    };
  }

  return { shapeRigidMotion, dropPosition, shellEnvelope };
}
