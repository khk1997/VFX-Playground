'use strict';

import createMorphMotion from '../morph.js?v=post-mask-3';

// 形狀變形的執行期模組。
//
// 這個模式的畫面上只有兩件事：兩顆形狀的實體被兩道波前各自削掉／放出來，以及
// 一整群水滴沿著配對表從 A 飛到 B。所以它的每幀內容分成三塊——時間軸與波前、
// 水滴（主滴與微滴共用同一套規則，只是讀不同的配對表）、以及那組雙形狀切削的
// uniform。
//
// 配對表與雙通道貼圖不在這裡：那是「形狀 B 匯進來之後烘出來的東西」，跟形狀
// 匯入管線同一條生命週期，由 bubble.js 持有並以 getter 傳進來（morph.js 本來就
// 只負責讀）。
export function createMorphRuntime({ params: P, packedTexture, mainPairs }) {
  const motion = createMorphMotion(P);

  const active = () => P.motion === 'morph';

  // 實體變形要有雙通道貼圖才成立；沒有就只剩水滴（見 rebuildMorphPackedTexture）。
  const isSolid = () => active() && !!packedTexture() && mainPairs().length > 0;

  // 錨點自帶的 radiusHint 是「這個位置的造型有多厚」，用它輪廓的粗細才會跟著
  // 形狀走（星形的角細、問號的桿粗）。兩顆形狀的厚度不同，所以出發端與抵達端
  // 的 hint 要跟著一起插值；缺就退回呼叫端給的 fallback。
  function radiusFromHints(pairs, index, phase, fallback) {
    const pair = pairs.length ? pairs[index % pairs.length] : null;
    const { t, back } = motion.morphTimeline(phase);
    const fromHint = (back ? pair?.b : pair?.a)?.radiusHint || fallback;
    const toHint = (back ? pair?.a : pair?.b)?.radiusHint || fallback;
    return fromHint + (toHint - fromHint) * t;
  }

  return {
    active,
    isSolid,
    timeline: phase => motion.morphTimeline(phase),
    fronts: (pairs, phase) => motion.morphFronts(pairs, phase),

    // 位置寫進 out。回傳這顆水滴此刻偏向形狀 A 還是 B，呼叫端拿它去混合兩組
    // 造型動態，而不是整場套同一份。
    dropPosition(pairs, index, phase, out) {
      motion.morphDropPosition(pairs, index, phase, out);
      return motion.morphShapeBlend(pairs, index, phase);
    },
    // 前後各取一次位置做中央差分用；位置只是 phase 的純函式。
    sampleAt(pairs, index, phase, out) {
      motion.morphDropPosition(pairs, index, phase, out);
    },

    // 主滴半徑：厚度插值 × 這顆水滴自己的包絡。
    dropRadius: (pairs, index, phase, radiusFactor, fallback) =>
      radiusFromHints(pairs, index, phase, fallback) * radiusFactor,
    radiusFactor: (pairs, index, phase) =>
      motion.morphRadiusFactor(pairs, index, phase, isSolid()),
    // 微滴是主滴的縮小版，同一套厚度規則再乘 0.72。
    microRadius: (pairs, index, phase, fallback) =>
      radiusFromHints(pairs, index, phase, fallback) * 0.72
        * motion.morphRadiusFactor(pairs, index, phase, isSolid()),

    // 定格段：所有水滴的存在包絡都是 0（它們此刻就是形狀的一部分），半徑全歸零，
    // 但 shader 每個 march step 仍會把空球跑一遍——實測定格因此比整顆形狀常駐的
    // 穿梭環繞貴了兩倍多。定格佔循環三成，而且正是使用者盯著形狀看的時候。
    isIdle(phase) {
      if (!isSolid()) return false;
      const { t } = motion.morphTimeline(phase);
      return t <= 0 || t >= 1;
    },

    // 雙形狀切削那一組 uniform。呼叫端已經確認 isSolid()。
    writeUniforms(uniforms, cut) {
      uniforms.uShapeTex.value = packedTexture();
      uniforms.uShapeMorph.value = cut.mode;
      uniforms.uShapeCut.value.set(cut.nx, cut.ny, cut.fromFront, cut.toFront);
      // 這幾個是打包型 uniform，不走「滑桿 key → u+首字大寫」那條自動對應，
      // 所以在這裡跟著波前一起送。
      uniforms.uMorphBreak.value.set(
        P.morphNoise, P.morphNoiseScale, P.morphCell, P.morphCellScale,
      );
      uniforms.uMorphNecking.value.set(P.morphNeck, P.morphNeckWidth);
      uniforms.uMorphActive.value.set(cut.fromActive ? 1 : 0, cut.toActive ? 1 : 0);
    },
  };
}
