'use strict';

import { smoothstepCPU } from '../util.js?v=svg-shape-76';

// 形狀匯聚的執行期模組。
//
// 這個模式是「一群自由飛行的水滴逐漸排進匯入的造型裡，被 SDF 吸收，再散開」。
// 它跟其他模式最不一樣的地方是：水滴與實體之間有一段真正的體積交接——水滴縮、
// 模型長，兩邊讀的必須是同一條時間軸，所以位置、半徑、造型進度與成型波前這四件
// 事要放在一起看。
//
// 時間軸本身（formationAmount 等）留在 bubble.js：那組函式不只這個模式在用，
// 微滴、鏡頭推軌與輸出流程也都在讀。這裡只接它們，不另外建一份——另建等於第二組
// 錨點與第二份亂數基底。
export function createFormationRuntime({
  params: P, isFormationMotion, hasShapeField, anchors, edgeScale,
  amount: formationAmount, fidelityAmount, releaseAmount,
  dropPosition: sampleDropPosition, lead, localAmount, cutFront,
}) {
  const active = () => isFormationMotion(P.motion);

  return {
    active,

    // 模型已大致長成後，讓可見水滴在目標體積內連續被 SDF 吸收。最後輪廓只剩匯入
    // 模型場；吸收在模型完成前不啟動，避免「水滴先縮、模型才出現」。
    fidelityAbsorb: phase => (active() && hasShapeField() ? fidelityAmount(phase) : 0),

    // 位置寫進 out，回傳半徑係數。
    dropPosition(index, phase, count, amount, out) {
      sampleDropPosition(index, phase, count, out);
      return 0.82 + amount * 0.18;
    },
    // 前後各取一次位置做中央差分用。
    sampleAt(index, phase, count, out) {
      sampleDropPosition(index, phase, count, out);
    },

    // anchor 可能落在模型表層；吸收時稍微往模型中心推入，避免半徑縮小後先失去
    // 液橋、在輪廓旁短暫留下孤立小球。
    insetScale: fidelityAbsorb => 1 - fidelityAbsorb * 0.20,

    // 主滴半徑：從自由半徑連續過渡到錨點所在位置的造型厚度，再被吸收收掉。
    //
    // 主滴跟微滴讀同一套抵達順序與同一套吸收（見 updateMicroDrops）：波前開啟時
    // 主滴若還照全域曲線走，就會用另一條時間軸浮在早已成形的區域上。
    dropRadius(index, phase, freeRadius, fidelityAbsorb) {
      const pool = anchors();
      const target = pool[index % Math.max(1, pool.length)];
      const targetRadius = target?.radiusHint || P.radius * 0.58;
      const local = P.formationFrontOn && target
        ? localAmount(formationAmount(phase), lead(target.x, target.y, index))
        : formationAmount(phase);
      const settle = smoothstepCPU(local, 0.12, 0.88);
      const absorb = P.formationFrontOn && target
        ? Math.max(fidelityAbsorb, smoothstepCPU(local, 0.74, 1))
        : fidelityAbsorb;
      return (freeRadius + (targetRadius - freeRadius) * settle) * (1 - absorb);
    },

    // 造型的全域進度。
    //
    // 成型波前開啟時，「哪裡看得到形狀」整個交給波前（uShapeCut），這條全域進度
    // 只剩兩個責任：把等距侵蝕在一開始就退場（否則會跟波前互相蓋住，變成兩層各自
    // 的成形），以及維持兩端為 0——uShapeProgress 還兼任 geometryWobble 的插值
    // 權重（見 shaders.js），突然跳成 1 會讓自由飛行段的水滴晃動整片變樣。
    shapeProgress(phase, amount, releasingShape) {
      if (P.formationFrontOn) return smoothstepCPU(amount, 0.01, 0.22);
      // 回程使用同一個體積交接進度：模型從第一幀開始退、水滴同步長回。舊版先維持
      // 完整模型、再集中侵蝕，會形成「模型上冒球後突然塌掉」。
      // 在水滴完全散開前清掉最後的模型核心，避免循環尾端留下 SDF 碎片。
      if (releasingShape) return 1 - smoothstepCPU(releaseAmount(phase), 0.0, 0.84);
      return smoothstepCPU(amount, 0.42, 0.96);
    },

    // 成型波前這一組 uniform。跟 morph 共用 uShapeCut／uMorphBreak／uMorphNecking／
    // uShapeCutBlend，所以呼叫端必須在 morph 那個分支之後才叫它——同一幀不可能
    // 兩個模式都成立，但這幾顆平時是被「滑桿 key → u+首字大寫」那條自動對應塞成
    // morph 的值的，這裡要蓋掉它們。
    cutActive: () => active() && hasShapeField() && P.formationFrontOn,
    writeCutUniforms(uniforms, amount) {
      const front = cutFront(amount);
      // z 與 w 給同一個值：只有一道波前，而 dissolveField 的擾動加速帶是拿
      // 「離 z 或 w 較近的那個」在算的（見 shaders.js），兩個都指同一條線，
      // 帶子才會正好罩在這道波前上。
      uniforms.uShapeCut.value.set(front.nx, front.ny, front.front, front.front);
      uniforms.uShapeCutBlend.value = P.formationCutBlend;
      uniforms.uMorphFront.value = P.formationFront;
      uniforms.uMorphSpiral.value = P.formationSpiral;
      // 三項邊緣擾動一律乘上 edgeScale，跟 formation.js 的 breakAmount 讀同一個
      // 係數——實體的擾動幅度與水滴的出發參差必須同步縮，否則兩者脫鉤。
      const es = edgeScale();
      uniforms.uMorphBreak.value.set(
        P.formationNoise * es, P.formationNoiseScale, P.formationCell * es, P.formationCellScale,
      );
      uniforms.uMorphNecking.value.set(P.formationNeck * es, P.formationNeckWidth);
    },
  };
}
