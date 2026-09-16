'use strict';

// 穿梭環繞的執行期模組。
//
// 這個模式的物體是恆定的背景主體，不是由水滴組成的材質：造型從頭到尾完整顯示，
// 水滴是另外一批獨立球體，只在循環軌跡上貼著／穿過它的表面。
//
// 飄浮位置的數學跟形狀匯聚共用同一支 motions/formation.js（同一份錨點、同一組
// 亂數基底），所以那支的工廠仍由 bubble.js 建一次，這裡只接它交出來的
// weaveDropPosition。這是刻意的：另外再建一份會是第二組錨點與第二份種子。
export function createWeaveRuntime({ params: P, dropPosition: sampleDropPosition }) {
  const active = () => P.motion === 'weave';

  return {
    active,

    // 穿梭環繞的形狀是恆定的背景主體，永遠滿值顯示，不參與任何體積交接。
    keepsShapeFull: active,

    // 位置寫進 out，回傳這顆水滴的半徑係數。
    //
    //「好幾顆大小不一的水滴」——每顆水滴的大小落在使用者設定的上下限之間，半徑
    // 固定不隨 phase 變化，只是「這顆水滴本來就比較大／小」。
    dropPosition(index, phase, count, seed, out) {
      sampleDropPosition(index, phase, count, out);
      return P.weaveSizeMin + seed * (P.weaveSizeMax - P.weaveSizeMin);
    },

    // 沾黏程度由滑桿決定：這個模式的水滴要能貼上玻璃、拉出液橋，就不能永遠把
    // 融合關到底。下限留一點點，全關會讓貼合處出現硬邊。
    mergeScale: () => Math.max(0.02, P.weaveCling),
  };
}
