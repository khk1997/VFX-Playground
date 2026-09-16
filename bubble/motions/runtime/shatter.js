'use strict';

import createShatterMotion from '../shatter.js?v=svg-shape-76';

// 崩解噴濺的執行期模組。
//
// 這個模式的內容是「造型在原地蓄力、炸成一組碎片飛出去、再回來重組」。時間軸與
// 彈道數學本來就在 motions/shatter.js；這裡加上的是它自己那組錨點——切法種子
// 決定碎片怎麼分，而重算是 O(候選點 × 錨點數) 的貪婪取樣，不便宜，所以要 key
// 快取加 debounce。
//
// 形狀、它的版本號與共用錨點都是 bubble.js 才知道何時失效的狀態，以 getter
// 傳進來；錨點分佈函式同理，由呼叫端注入，模組不自己去認識 shape-anchors。
export function createShatterRuntime({
  params: P, maxDrops, maxMicroDrops,
  shapeTargets, shapeSerial, sharedAnchors, sharedMicroAnchors,
  distributePrimaryAnchors, distributeDetailedAnchors,
}) {
  const motion = createShatterMotion(P);

  // 這組錨點是崩解專用的。共用的那兩組（形狀匯聚／穿梭環繞／崩解共用）動了會
  // 連帶改掉那三個模式的外觀，所以另外算一份，只有這裡會讀。
  let cutAnchors = null;
  let cutMicroAnchors = null;
  let cutKey = null;
  let pendingKey = null;
  let cutTimer = 0;

  const active = () => P.motion === 'shatter';

  function build(seed, key) {
    cutKey = key;
    pendingKey = null;
    cutAnchors = distributePrimaryAnchors(shapeTargets(), maxDrops, seed);
    cutMicroAnchors = distributeDetailedAnchors(shapeTargets(), maxMicroDrops, seed);
  }

  // 種子 0 連算都不算，直接指回共用的那兩組（也就保證切法 0 與加這個參數之前
  // 完全相同）。
  function anchorSets() {
    const seed = Math.round(P.shatterCut);
    if (!seed) return { primary: sharedAnchors(), micro: sharedMicroAnchors() };
    const key = `${seed}:${shapeSerial()}`;
    if (key !== cutKey && pendingKey !== key) {
      // 重算的量級跟候選點數成正比：SVG 只有上百個點（實測 3.8ms），但 GLB 在
      // 128³ 下可以到近萬個，直接在幀迴圈裡算會讓拖動滑桿變成一格一頓。改成等
      // 滑桿停下來才算，拖動期間先沿用上一組錨點。
      pendingKey = key;
      clearTimeout(cutTimer);
      cutTimer = setTimeout(() => build(seed, key), 140);
    }
    // 還沒算出第一組之前先用共用錨點頂著，不要回傳 null 讓呼叫端炸掉。
    return cutAnchors && cutMicroAnchors
      ? { primary: cutAnchors, micro: cutMicroAnchors }
      : { primary: sharedAnchors(), micro: sharedMicroAnchors() };
  }

  // 輸出時不能等 debounce：整段序列必須用同一組錨點，否則前幾幀會是舊切法。
  function flushCutAnchors() {
    if (!pendingKey) return;
    clearTimeout(cutTimer);
    build(Math.round(P.shatterCut), pendingKey);
  }

  return {
    active,
    anchorSets,
    flushCutAnchors,
    // 這一幀的節拍；不是崩解模式就回 null，呼叫端拿它當旗標用。
    beat: phase => (active() ? motion.shatterTimeline(phase) : null),
    // 造型本身的可見度：炸開後形狀不在。
    shapeAmount: beat => motion.shatterShapeAmount(beat),
    // 碎片的位置。錨點加上這顆碎片自己的亂數彈道。
    offset(target, seedA, seedB, seedC, beat, out) {
      motion.shatterOffset(target, motion.shatterSeed(seedA, seedB, seedC), beat, out);
    },
    // 碎片半徑由錨點所在位置的局部厚度決定，不是「水滴大小」乘一個亂數。
    fragmentRadius: (target, seed, beat) => motion.shatterRadius(
      target ? motion.shatterFragmentRadius(target, seed) : 0, beat,
    ),
    // 碎片一旦離開母體就該是各自獨立、邊緣清楚的液滴，不是一團彼此牽絲的黏液。
    // 但炸開的瞬間它們還在造型上，那一刻保留正常黏性才看得出「從表面剝離」，
    // 所以依飛行進度連續收緊，而不是一開始就切到最小。
    mergeScale: beat => 1 + (0.15 - 1) * beat.flight,
    // 面板讀數要的每段秒數。
    segmentSeconds: (...args) => motion.shatterSegmentSeconds(...args),
  };
}
