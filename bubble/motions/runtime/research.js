'use strict';

import createResearchMotion from '../research.js?v=whisper-shell-2';

// 私語的執行期模組。
//
// 這個模式的形狀是「主殼 + 伴生殼」兩顆，週期性融合再分開，殼裡還有兩顆延遲
// 生成、互相繞行的玻璃核（那部分在 shader 那側）。所以它跟其他模式不同的地方
// 大多集中在「水滴不是可增減的裝飾，而是模式本體」這一件事上：數量固定兩顆、
// 不吃重力偏移、不參與通用的接觸融合、融合半徑由自己的滑桿決定。
//
// dropSeeds 是 bubble.js 持有的那份（每顆水滴的亂數基底），以 context 傳進來，
// 模組不自己生成一份——伴生殼的大小是拿主殼的 seed 去換算的，兩邊必須是同一份。
export function createResearchRuntime({ params: P, dropSeeds }) {
  const {
    shapeRigidMotion, dropPosition: samplePosition, shellEnvelope,
  } = createResearchMotion(P, { dropSeeds });

  const active = () => P.motion === 'research';

  return {
    active,

    // 私語的第二外殼是模式本體，不是通用的可增減水滴。這層是舊 preset 的保險：
    // 即使檔案裡還存著改版前的 count=1，渲染端仍固定產生主殼與伴生殼兩顆。
    // 回傳 null 表示「不覆寫」。
    dropCount: () => (active() ? 2 : null),

    shapeRigid: phase => shapeRigidMotion(phase),

    // 寫進 out 的是這一顆殼的位置，回傳值是它的半徑係數。
    dropPosition(index, phase, out) {
      const state = samplePosition(index, phase, out);
      return state.reveal * state.pulse;
    },

    // 外殼全程保持液態起伏，但起伏幅度跟著殼本身的包絡走，融合時不會憑空多出
    // 一層跟兩顆殼對不上的噪聲。
    wobble: phase => P.wobble * shellEnvelope(phase),

    // 伴生殼要能貼上主殼、拉出液橋，所以沾黏程度由自己的滑桿決定，而不是沿用
    // 通用的黏度。下限留一點點，全關會讓兩顆殼在接觸處出現硬邊。
    mergeScale: () => Math.max(0.02, P.researchCompanionFusion),
  };
}
