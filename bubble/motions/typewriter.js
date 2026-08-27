'use strict';

// 打字：逐字長出、停留、逐字刪除、換句，循環。
//
// 原型是 React 那種寫法：useRef 存「第幾句 / 第幾個字 / 是否在刪」，setTimeout
// 依當下狀態決定下一次的 delay，自己推自己往前跑。這裡不能照搬，因為整個模組的
// 動畫都建立在 phase01 = fract(uTime / uLoopDuration) 上——要能任意跳、要能無縫
// 循環、要能在暫停時算出同一幀。所以那個狀態機被攤平成一張時間軸表，再變成一支
// 對 phase 的純函式：同一個 phase 永遠得到同一個畫面，沒有累積狀態、沒有漂移。
//
// 四段時長是絕對時間（每字幾毫秒、停留幾秒），loopDuration 反過來由它們算出來。
//
// 第一版是反過來的：四段是相對權重，正規化進固定的 loopDuration——跟 melt/shatter
// 一致。那對其他模式成立，對這個模式不成立，因為只有這個模式的「內容長度」是使用者
// 隨時在改的輸入，而且量級差很大。把預設的三句（共 15 字）換成「hi」之後，總權重從
// 101 掉到 29，但 8 秒沒變，於是每字從 79ms 變成 275ms——字打得越少反而越慢，而且
// 8 秒裡有 5.5 秒在乾等。這與任何人對打字的直覺都相反。
//
// 改成絕對時間之後，「每字 55 毫秒」就真的是 55 毫秒，與文字長短無關；循環秒數變成
// 推導出來的結果（見 bubble.js 的 syncTypewriterLoopDuration），面板上那條滑桿在這個
// 模式因此收起來，改用讀數顯示算出來的總長。
//
// shader 端完全不重算這條時間軸:CPU 每幀把「哪幾格、各自的成形進度、游標在哪」
// 打包成一張 1D 資料貼圖送過去（見 bubble.js 的 updateTypewriterUniforms)。研究
// 模式是在 shader 裡自己算相位的，那在只有兩顆圖示時還行，但一行字有二十幾格，
// 兩邊各算一次時間軸等於維護兩份會走偏的邏輯。
export default function createTypewriterMotion(P, deps) {
  const phrases = deps.phrases;

  // 一句話的四段：打字、停留、刪除、句間空檔。單位是秒。
  // typeCharTime / typeEraseTime 的滑桿單位是毫秒／字，其餘兩條是秒。
  function segmentSeconds(length) {
    const type = (Math.max(0, P.typeCharTime) / 1000) * length;
    const hold = Math.max(0, P.typeHold);
    const erase = (Math.max(0, P.typeEraseTime) / 1000) * length;
    const gap = Math.max(0, P.typeGap);
    return { type, hold, erase, gap, total: type + hold + erase + gap };
  }

  // 整輪的秒數。長句自然打得比短句久，這正是原型的行為（每個字固定 55ms）。
  function cycleSeconds() {
    let total = 0;
    for (const phrase of phrases()) total += segmentSeconds(phrase.length).total;
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
    const total = cycleSeconds();
    if (!(total > 0)) {
      // 四條滑桿全歸零：時間軸沒有長度，退化成「第一句完整顯示、不動」。這比
      // 除以零之後整行消失要合理得多。
      return { phrase: list[0], chars: list[0].length, charFrac: 1, erasing: false };
    }
    // phase 是 fract(t / loopDuration)，而 loopDuration 已經被設成 cycleSeconds
    // （見 bubble.js 的 syncTypewriterLoopDuration），所以這裡乘回去就是「現在走到
    // 這一輪的第幾秒」。萬一兩者不同步（loopDuration 被滑桿上下限夾住），整輪仍然
    // 完整播完，只是整體快慢與絕對毫秒對不上——不會壞掉，只是讀數不準。
    let cursor = phase01 * total;
    for (const phrase of list) {
      const seg = segmentSeconds(phrase.length);
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

  // 整行不做剛體變換。字本身就是主體，再讓它整體晃動只會讓人讀不出字——
  // 液態感全部由每個字自己的成形曲線負責。回 null 走「沒有剛體動態」那條路。
  function shapeRigidMotion() { return null; }

  return { typeState, segmentSeconds, cycleSeconds, shapeRigidMotion };
}
