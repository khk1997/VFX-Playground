'use strict';

// 打字：逐字長出、停留、逐字刪除、換句，循環。
//
// 原型是 React 那種寫法：useRef 存「第幾句 / 第幾個字 / 是否在刪」，setTimeout
// 依當下狀態決定下一次的 delay，自己推自己往前跑。這裡不能照搬，因為整個模組的
// 動畫都建立在 phase01 = fract(uTime / uLoopDuration) 上——要能任意跳、要能無縫
// 循環、要能在暫停時算出同一幀。所以那個狀態機被攤平成一張時間軸表，再變成一支
// 對 phase 的純函式：同一個 phase 永遠得到同一個畫面，沒有累積狀態、沒有漂移。
//
// 四段時長是「相對權重」而不是絕對毫秒，理由跟 melt/shatter 一樣:loopDuration
// 是這個模組的主時鐘，所有模式都掛在它下面。把權重正規化進 loopDuration 之後，
// 拉「循環秒數」就是整段打字一起變快變慢，而四條滑桿只管彼此的比例——換成絕對
// 毫秒的話兩者會互相打架，總長超過 loopDuration 時句子會被截在一半。面板的讀數
// 會把權重換算回實際毫秒顯示，所以手感仍然是「每字 55 毫秒」那種直覺。
//
// shader 端完全不重算這條時間軸:CPU 每幀把「哪幾格、各自的成形進度、游標在哪」
// 打包成一張 1D 資料貼圖送過去（見 bubble.js 的 updateTypewriterUniforms)。研究
// 模式是在 shader 裡自己算相位的，那在只有兩顆圖示時還行，但一行字有二十幾格，
// 兩邊各算一次時間軸等於維護兩份會走偏的邏輯。
export default function createTypewriterMotion(P, deps) {
  const phrases = deps.phrases;

  // 一句話的四段：打字、停留、刪除、句間空檔。回傳的是權重，不是秒。
  function segmentWeights(length) {
    const type = Math.max(0, P.typeCharTime) * length;
    const hold = Math.max(0, P.typeHold);
    const erase = Math.max(0, P.typeEraseTime) * length;
    const gap = Math.max(0, P.typeGap);
    return { type, hold, erase, gap, total: type + hold + erase + gap };
  }

  // 整輪的總權重。長度不同的句子各自佔比不同——長句自然分到更多時間，這正是
  // 原型的行為（每個字固定 55ms，句子越長打得越久）。
  function cycleWeight() {
    let total = 0;
    for (const phrase of phrases()) total += segmentWeights(phrase.length).total;
    return total;
  }

  // phase01 → 當下的打字狀態。
  //
  // charFrac 是「正在打（或正在刪）的那個字」的成形進度 0→1,shader 靠它把字從
  // 基線抽出來；已經打完的字 charFrac 恆為 1。erasing 時進度反向，所以同一個
  // reveal 曲線兩邊都用得上。
  function typeState(phase01) {
    const list = phrases();
    if (!list.length) return null;
    const totalWeight = cycleWeight();
    if (!(totalWeight > 0)) {
      // 四條滑桿全歸零：時間軸沒有長度，退化成「第一句完整顯示、不動」。這比
      // 除以零之後整行消失要合理得多。
      return { phrase: list[0], chars: list[0].length, charFrac: 1, erasing: false };
    }
    let cursor = phase01 * totalWeight;
    for (const phrase of list) {
      const seg = segmentWeights(phrase.length);
      if (cursor >= seg.total) { cursor -= seg.total; continue; }
      const L = phrase.length;
      if (cursor < seg.type) {
        // 打字中。progress 是「已經打到第幾個字」的連續值。
        const progress = seg.type > 0 ? (cursor / seg.type) * L : L;
        const whole = Math.min(L, Math.floor(progress));
        return { phrase, chars: whole + (whole < L ? 1 : 0), charFrac: whole < L ? progress - whole : 1, erasing: false };
      }
      cursor -= seg.type;
      if (cursor < seg.hold) return { phrase, chars: L, charFrac: 1, erasing: false };
      cursor -= seg.hold;
      if (cursor < seg.erase) {
        // 刪除中。從尾巴往前收，最後那個字的 charFrac 從 1 退回 0。
        const progress = seg.erase > 0 ? (cursor / seg.erase) * L : L;
        const remaining = L - Math.floor(progress);
        return { phrase, chars: remaining, charFrac: 1 - (progress - Math.floor(progress)), erasing: true };
      }
      // 句間空檔：整行已經空了，只剩游標在閃。
      return { phrase, chars: 0, charFrac: 0, erasing: true };
    }
    // 浮點誤差讓 cursor 剛好掃過總長時的收尾，回到第一句的開頭。
    return { phrase: list[0], chars: 0, charFrac: 0, erasing: false };
  }

  // 把權重換算成實際毫秒，只給面板讀數用。
  function segmentMilliseconds() {
    const list = phrases();
    const totalWeight = cycleWeight();
    if (!list.length || !(totalWeight > 0)) return { char: 0, hold: 0, erase: 0, gap: 0 };
    const perWeight = (P.loopDuration * 1000) / totalWeight;
    return {
      char: P.typeCharTime * perWeight,
      hold: P.typeHold * perWeight,
      erase: P.typeEraseTime * perWeight,
      gap: P.typeGap * perWeight,
    };
  }

  // 整行不做剛體變換。字本身就是主體，再讓它整體晃動只會讓人讀不出字——
  // 液態感全部由每個字自己的成形曲線負責。回 null 走「沒有剛體動態」那條路。
  function shapeRigidMotion() { return null; }

  return { typeState, segmentMilliseconds, shapeRigidMotion, cycleWeight };
}
