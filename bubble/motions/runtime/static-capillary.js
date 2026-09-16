'use strict';

// 靜態方體與毛細波的執行期模組。
//
// 這兩個模式在渲染端是同一家人：程序化表面紋理（uCapillaryStyle／uCapillaryDirection／
// uExtendedParams）同一組 uniform、同一支 capillarySurfaceOffset，差別只在呼叫端喂
// 進去的是哪顆 SDF 的座標——毛細波作用在匯入的形狀場，靜態方體作用在程序化方體。
// 所以兩者共用一個模組，而不是各自複製一份同樣的 uniform 寫法。
//
// 模組只負責「這一家人成立時要寫什麼」；其餘模式的通用分支仍留在 bubble.js，
// 由呼叫端依 handles() 決定走哪一邊。
export function createStaticCapillaryRuntime({ params: P, motionUniformMap }) {
  const MOTIONS = new Set(['capillary', 'static']);

  const handles = motion => MOTIONS.has(motion);

  return {
    handles,
    // 這一幀是不是由這個模組接手。
    active: () => handles(P.motion),

    // 毛細波是純形狀場模式。即使舊參數檔還保存著 count > 0，也不允許主滴重新出現。
    // 回傳 null 表示「不覆寫」，交還給呼叫端的一般水滴數量。
    // 靜態方體不在此列：它的水滴數量仍沿用面板上的值。
    dropCount: () => (P.motion === 'capillary' ? 0 : null),

    // 靜態模式的匯入造型要一直是滿值：沒有匯聚時間軸這回事，選了「匯入」就整顆
    // 展示，不管選的是哪種內建幾何都跟這個進度值無關（那條走 FEATURE_STATIC_SHAPE
    // 自己的 uStaticShape 分支，不受這個值影響）。
    keepsShapeFull: () => P.motion === 'static',

    // 這一家人成立時的 uniform。呼叫端已經確認 active() 為真。
    writeUniforms(uniforms) {
      // 封住舊參數檔可能保存的輪廓液滴與一般水滴噪聲；切離毛細波後會立即
      // 從 P 恢復原模式各自記憶的值。
      uniforms.uEdgeDropCount.value = 0;
      // 靜態方體沒有水滴系統，「表面起伏」這段通用 fbm 噪聲不該波及它——用戶
      // 明確要求靜態模式不吃任何水滴形態參數，波紋只能來自下面這組毛細波參數。
      uniforms.uWobble.value = 0;
      uniforms.uExtendedMotion.value = motionUniformMap[P.motion];
      uniforms.uExtendedParams.value.set(
        P.capillaryHeight, P.capillaryRings, P.capillarySpeed, P.capillaryWarp,
      );
      uniforms.uCapillaryStyle.value.set(
        Math.round(P.capillaryField), Math.round(P.capillaryTexture), P.capillaryCrestSoftness, 0,
      );
      uniforms.uCapillaryDirection.value.set(
        P.capillaryDirectionX, P.capillaryDirectionY, P.capillaryDirectionZ,
      );
    },
  };
}
