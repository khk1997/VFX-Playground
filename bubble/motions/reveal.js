'use strict';

// 打字機 Reveal：形狀一格一格跳出來，右邊跟著一條一閃一閃的游標；打完定格一段，
// 再用倒退鍵一格一格刪回去。
//
// 「一格一格」是這個模式的全部重點，也是它跟形狀變形（morph）最根本的差別。
// 第一版做的是「一道波連續掃過去、水滴從波前飛進來補上」，那讀起來是液體被澆
// 上去，不是打字 —— 打字的節奏是離散的：字在那裡等著，然後「跳」出來，中間沒有
// 過渡。所以這裡的波前位置被量化成 revealSteps 格，每格瞬間跳、然後停住等下一格。
// 連續的波前、飛行中的水滴、弧線路徑那些都拿掉了：它們是「液體流動」的語彙，
// 疊在打字上只會把離散感糊掉。
//
// 實作上仍重用形狀變形那套消失場與波前機制，但只作用在單一形狀上：
//
//   shaders.js 的兩形狀分支用 uShapeMorph 決定哪個通道是「消失中的舊形狀」
//   （fromCh）、哪個是「出現中的新形狀」（toCh），而 uMorphActive 可以把其中
//   一邊整個關掉。於是：
//     打字 = uShapeMorph 2（toCh 指向通道 0）＋ uMorphActive (0,1)，跳 uShapeCut.w
//     倒退 = uShapeMorph 1（fromCh 指向通道 0）＋ uMorphActive (1,0)，跳 uShapeCut.z
//   兩者讀的都是通道 0，也就是形狀 A 自己那張貼圖的 r 通道 —— 不需要 morph 的
//   雙通道打包貼圖（packShapePairTexture），也不必等第二顆形狀烘焙。
//
//   定格段直接把 uShapeMorph 設回 0 走單一形狀那條路：整顆形狀完整顯示，而且
//   省掉兩次距離場取樣與整條切削運算。
//
// 倒退段的掃描角度多轉 180°，這不是為了「換個方向比較好看」，而是倒退鍵的定義：
// shader 裡消失中的形狀留在「場值大於波前」那一側，角度 0 時場值就是 x，留下的
// 會是右半邊 —— 那是從左邊開始刪。轉 180° 之後場值變成 -x，留下的是左半邊，
// 刪除從右邊開始，也就是真正的倒退鍵。
//
// 波前形狀固定平面掃描（uMorphFront = 0）：放射與螺旋讀起來是「從中心綻開」與
// 「捲進來」，跟打字無關。想要那些效果的話形狀變形模式已經有了。
const DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));

export default function createRevealMotion(P, { anchors }) {

// 循環切成三段：打字 → 定格 → 倒退。
//
// 一定要有倒退段：少了它，循環尾端會從「打完的整段字」硬跳回空白，接縫上是一格
// 瞬變。倒退刪完之後 phase = 1 時畫面本來就是空的，跟 phase = 0 精確相接。
//
// 定格之外的時間對半分給打字與倒退。兩段不分開給參數：真正有意義的選擇只有
// 「打完停多久」，打字比倒退快或慢並不構成另一種效果。
function revealTimeline(phase) {
  const hold = Math.max(0, Math.min(0.6, P.revealHold));
  const travel = Math.max(0.05, (1 - hold) * 0.5);
  if (phase < travel) return { t: clamp01(phase / travel), erasing: false, holding: false };
  if (phase < travel + hold) return { t: 1, erasing: false, holding: true };
  return { t: clamp01((phase - travel - hold) / travel), erasing: true, holding: false };
}

// 倒退鍵的方向定義，見檔頭。
const ERASE_WAVE_TURN = 180;

const stepCount = () => Math.max(1, Math.round(P.revealSteps));

// 波前位置量化成整數格。這就是「一個一個字」：
//   ceil 而不是 floor —— floor 會讓 t 剛過 0 時還是 0 格，第一個字要等到 1/n
//   才出現，而且最後一格永遠等不到（t < 1 時 floor 恆 < n）。ceil 讓 t 一離開 0
//   就跳出第一格、t = 1 時剛好滿格，每一格佔的時間也完全相同。
// 倒退是同一把尺反過來讀：刪掉 ceil(t·n) 格。
function quantizedLead(t, erasing) {
  const n = stepCount();
  const filled = Math.ceil(clamp01(t) * n) / n;
  return erasing ? 1 - filled : filled;
}

// 消失場的 CPU 版本。必須跟 shaders.js 的 dissolveField 是同一條式子，否則實體
// 被切開的位置會跟游標的位置對不上。這裡只需要平面掃描那一支（見檔頭），所以是
// 單純的投影。
const projectOf = (x, y, angle) => x * Math.cos(angle) + y * Math.sin(angle);

// 掃描軸上的投影範圍（決定波前要走多遠），以及垂直於掃描軸的範圍（決定游標要
// 多高、擺在哪）。每幀對錨點掃一遍是幾十筆加法，但角度沒動時結果不變，所以拿
// 它當 key 快取。
//
// 範圍一定要用「這個角度下實際的投影範圍」，不能用外接半徑之類的固定尺度：用
// 固定尺度時投影幾乎不可能真的取到兩端，波前在還沒掃完形狀時就走完了行程，
// 最後幾格會變成不會動的死時間。
let waveKey = null;
let waveLo = 0;
let waveSpan = 1;
let perpLo = 0;
let perpSpan = 1;
function waveRange(pool, angle) {
  const key = `${angle}:${pool.length}:${pool[0]?.x},${pool[0]?.y}`;
  if (waveKey === key) return;
  const nx = Math.cos(angle), ny = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, plo = Infinity, phi = -Infinity;
  for (const s of pool) {
    const along = s.x * nx + s.y * ny;
    // 掃描軸的法向量。游標是沿著它站起來的那條豎線。
    const across = s.x * -ny + s.y * nx;
    if (along < lo) lo = along;
    if (along > hi) hi = along;
    if (across < plo) plo = across;
    if (across > phi) phi = across;
  }
  waveKey = key;
  waveLo = lo;
  waveSpan = Math.max(1e-4, hi - lo);
  perpLo = plo;
  perpSpan = Math.max(1e-4, phi - plo);
}

const waveAngleOf = erasing => (P.revealWaveAngle + (erasing ? ERASE_WAVE_TURN : 0)) * DEG;

// 波前超出錨點範圍多少才算「整顆形狀都出來了」。錨點是表面的取樣點，形狀本身
// 一定比錨點的包圍範圍再大一圈（描邊有寬度、擠出有厚度），波前只走到最後一個
// 錨點就停的話，形狀邊緣會留下一小條永遠打不出來／刪不掉的殘料。
const FRONT_MARGIN = 0.18;

// 實體的波前與游標，一起算：兩者讀的是同一個 lead，游標才會精確站在剛打出來的
// 那一格後面，而不是自己另外算一條會慢半拍的曲線。
function revealFront(phase) {
  const pool = anchors();
  if (!pool.length) return null;
  const { t, erasing, holding } = revealTimeline(phase);
  const angle = waveAngleOf(erasing);
  waveRange(pool, angle);
  const lead = holding ? 1 : quantizedLead(t, erasing);
  // 餘裕除了形狀本身比錨點大一圈之外，還要加上亂流把場值推開的幅度：擾動是直接
  // 加在場值上的，波前不多走這一段，邊角就會留下打不出來的殘料。
  const margin = FRONT_MARGIN * waveSpan + P.revealNoise;
  const front = waveLo - margin + lead * (waveSpan + margin * 2);
  const nx = Math.cos(angle), ny = Math.sin(angle);

  // 游標：站在剛打出來那一格的後面，也就是「下一格會出現的位置」。
  //
  // 實體留在「場值小於波前」那一側（倒退段是大於），所以游標要往另一側偏移半個
  // 自己的寬度再加一點間隙，否則它會有一半埋在剛打出來的那個字裡面。倒退段的
  // 偏移方向跟著反過來 —— 那一側才是下一次倒退會吃掉的地方。
  const halfWidth = Math.max(0, P.revealCaret) * 0.5;
  const gap = halfWidth > 0 ? halfWidth * 0.9 : 0;
  const caretAlong = front + (erasing ? -1 : 1) * (halfWidth + gap);

  return {
    holding,
    erasing,
    lead,
    nx,
    ny,
    front,
    // 1 = 通道 0 當「消失中的舊形狀」（倒退），2 = 通道 0 當「出現中的新形狀」（打字）。
    mode: erasing ? 1 : 2,
    // lead 為 0 時那顆形狀完全不在場，shader 可以整個跳過它的距離場取樣。打字段
    // 是「還沒打第一個字」、倒退段是「已經刪完」，兩者都落在 lead 0 上，所以不必
    // 分開判斷。
    active: lead > 0,
    caretAlong,
    caretHalfWidth: halfWidth,
    // 游標的高度取錨點垂直範圍的一部分。取滿的話，形狀有高有低時（例如問號的
    // 點跟鉤子）游標會比字還高出一截；0.75 大約是一般文字游標對字高的比例。
    caretHalfHeight: perpSpan * 0.5 * 0.75,
    caretCenterAcross: perpLo + perpSpan * 0.5,
  };
}

// 游標的明滅。整數次閃爍才能讓循環頭尾對上：phase 0 與 phase 1 都落在「亮」的
// 那半格開頭。0 = 不閃，恆亮。
function caretVisible(phase) {
  const blinks = Math.max(0, Math.round(P.revealBlink));
  if (blinks <= 0) return true;
  return Math.floor(phase * blinks * 2) % 2 === 0;
}

// 水滴在這個模式預設不出場（見 registry.js 的 count: 0）——打字不需要一堆泡泡
// 做轉場。使用者調高「水滴數量」時，讓它們貼在「已經打出來的那幾格」的錨點上，
// 當成打好的字上面的液體點綴；還沒打到的那幾格半徑為 0，才不會有球提前浮在
// 空白處預告下一個字。
function revealDropPosition(i, phase, out) {
  const pool = anchors();
  if (!pool.length) return out.set(0, 0, 0);
  const anchor = pool[i % pool.length];
  return out.set(anchor.x, anchor.y, anchor.z);
}

function revealDropVisible(i, phase) {
  const pool = anchors();
  if (!pool.length) return 0;
  const anchor = pool[i % pool.length];
  const { erasing, holding } = revealTimeline(phase);
  const cut = revealFront(phase);
  if (!cut) return 0;
  if (holding) return 1;
  const value = projectOf(anchor.x, anchor.y, waveAngleOf(erasing));
  // 打字段實體留在「場值小於波前」那一側，倒退段相反。水滴跟著自己那一格在不在。
  return (erasing ? value > cut.front : value < cut.front) ? 1 : 0;
}

  return { revealTimeline, revealFront, caretVisible, revealDropPosition, revealDropVisible };
}
