'use strict';

// 字形距離場圖集。
//
// 打字模式的字必須逐字獨立動畫（正在打的那個字在長、正在刪的那個字在塌），所以
// 不能把整句話烘成一張距離場——那樣只能做整行的橫向擦除，做不出「一個字自己長
// 出來」。做法是每個字元各烘一格 SDF、拼成圖集，之後打字只是換 uniform，不再碰
// CPU。這是這個模式能存在的前提：shape-field.js 的 SVG 路徑一次烘焙是 1536² 的
// 同步 EDT，每按一個字重跑一次是不可能的。
//
// 管線本身完全沿用 SVG 那條（canvas 覆蓋率 → subpixelSigned2D → 箱型降採樣 →
// σ=0.7 微模糊 → RGBA32F），只是把「一張大圖」換成「n 格小圖」。三支工具函式從
// shape-field.js 匯入而不是複製，理由見那邊的匯出註解。
import * as THREE from 'three';
import { subpixelSigned2D, encodeFloat2D, blurField } from './shape-field.js?v=typewriter-1';

// 每格的圖集解析度。拉丁字母的筆畫在 64² 下大約 8 texel 寬，配上下面的超取樣
// 已經足夠讓擠出側壁的法線連續（那是 shape-field.js 那段「梯度階梯」分析的結論）。
// 中文要再往上加——繁體字的筆畫間距比拉丁字母密一個量級，見 TILE_CJK。
const TILE = 64;
// 繁體字實測結果：96² 下「態」這類字的筆畫間隙只剩約 4 texel，擠出之後相鄰筆畫
// 直接融成一團，整個字讀不出來。144² 讓間隙回到 6-7 texel，字形本身才成立。
// （筆畫間隙 vs 邊緣圓角的那個問題是另一回事，不是解析度能解的，見下面 CJK_TRACKING
// 上方的說明。）
const TILE_CJK = 144;
// 超取樣倍率。理由與 SVG 路徑相同：EDT 只在最終解析度上算的話，梯度會鎖在
// √（整數²+整數²) 的階梯上，而擠出側壁的法線正是那個梯度。
//
// CJK 降到 3：EDT 是 O(hi²)，144×4 = 576² 每格 33 萬格，二十個字就要跑 660 萬格
// （比一整張 1536² 的 SVG 還多三倍）。144×3 = 432² 折半到 19 萬格，而 144² 的最終
// 解析度本來就比 64² 高一倍，階梯效應已經被解析度本身吃掉一部分。
const SS = 4;
const SS_CJK = 3;
// 每格覆蓋的世界尺寸。字級（uTypeLine.y）是這個值的乘數，所以這裡只是「1 格 =
// 1 個 em 見方」的約定，不是最終大小。
const TILE_WORLD = 1;
// em 佔一格的比例。留 19% 邊界給距離場的正值 padding——沒有 padding 的話 SDF 在
// 格緣就被截斷，擠出時側壁會貼著格線出現硬邊（svgShapeDistance 用透明 padding
// 解同一個問題）。
const EM_RATIO = 0.62;
// 基線在一格內的高度（自上緣往下算的比例）。所有字元共用同一個值，這樣整行字
// 才會坐在同一條基線上——這是「一行字」跟「一堆各自居中的字」的差別。
const BASELINE_RATIO = 0.72;
// 距離場的編碼範圍（世界單位）。一格的對角半長是 0.707，取 0.75 剛好覆蓋整格而
// 不浪費精度。超出範圍會被夾住，但那已經在字的外面很遠，不影響 march。
const RANGE = 0.75;

// 圖集的格數上限。24 格同時可見的字對一行標語綽綽有餘，而 shader 端的每格資料
// 走的是 1D 資料貼圖（跟 uMicroDrops 同一個手法），所以這個數字只影響貼圖寬度，
// 不吃 uniform 額度。
export const MAX_TYPE_GLYPHS = 24;
// 圖集能容納的不同字元數上限。超過就截斷並回報，不要靜默吃掉。
const MAX_ATLAS_GLYPHS = 96;

// 等寬原本是硬要求：shader 端靠「字沿 x 軸等距」把每個 march step 的取樣數壓到
// 3 格（見 shaders.js 的 typewriterDistance）。比例字體的 advance 逐字不同，那條
// O(1) 的定位算式本該不成立——但 advance 的算法（見 bakeGlyphAtlas）取的是「這句話
// 裡最寬的那個字元」，所有字一律用這個寬度排版，等於把任何字體都「假裝」成等寬。
// 不是最貼合原字體手感的排法（窄字元兩側會有多餘留白），但不會錯位、不會重疊，
// 所以使用者匯入比例字體時仍然可以用，只是字距觀感跟原字體的排版不同。
//
// Menlo 是 macOS 一定有的等寬字，沒有 bundle 字體檔時的預設 fallback；SF Mono 要
// 裝 Xcode/Terminal 才有，不能假設。換一台機器會 fallback 到該平台的 monospace——
// 不會壞，但字形不同。verifyFont 會把這件事講出來。
const FONT_STACK = 'Menlo, Monaco, "DejaVu Sans Mono", monospace';
const FONT_WEIGHT = 700;

// 使用者換過的字體有兩種來源（見 bubble.js 的 loadCustomFont／useSystemFont）：
//   1. 匯入檔案——FontFace 註冊時固定用這個家族名，不用原始檔名，因為檔名可能
//      帶副檔名、空白，或剛好跟系統字體同名；使用者看到的原始檔名另外存在
//      customFontLabel，只給面板顯示，不進 ctx.font。
//   2. 直接輸入系統字體名稱（例如 Adobe Fonts 桌面同步裝好的字體）——這種情況下
//      customFontFamily 就是使用者輸入的名稱本身，customFontLabel 跟它相同。
const CUSTOM_FONT_FAMILY = 'TypewriterCustomFont';
let customFontActive = false;
let customFontLabel = '';
let customFontFamily = CUSTOM_FONT_FAMILY;
// 系統字體挑選器（Local Font Access API）可以指名特定字重／樣式（Regular／
// Bold／Light…），這裡另外存一個可覆寫的字重，預設仍是 700（走 A 路線的下限，
// 見下面 verifyFont 的說明）。手動輸入名稱那條路徑不指定，維持原本的 700。
let customFontWeight = FONT_WEIGHT;

// 目前實際要用的字型堆疊。有匯入字體時排在最前面，找不到才落回 Menlo 那條預設
// fallback 鏈——不是整個換掉，這樣匯入的字體檔本身若缺字（例如只做了英文，句子
// 裡卻混了中文），至少不會整格開天窗，會落到系統等寬字。
function fontStack() {
  return customFontActive ? `"${customFontFamily}", ${FONT_STACK}` : FONT_STACK;
}

// 註冊一顆使用者匯入的字體檔。呼叫端（bubble.js）已經完成 FontFace 的載入與
// document.fonts.add，這裡只負責「往後 fillText 用哪個家族名」與「快取要不要
// 整份作廢」——換字體之後，快取裡任何舊字元都是用舊字體烘的，必須全部丟掉，
// 否則畫面會出現新舊字體混雜的字元（新打的字用新字體，之前就在句子裡、剛好
// 被快取命中的字還是舊字體）。
export function setCustomFont(label) {
  customFontActive = true;
  customFontLabel = label;
  customFontFamily = CUSTOM_FONT_FAMILY;
  customFontWeight = FONT_WEIGHT;
  glyphCache.clear();
}

// 直接指名一個系統字體，不透過 FontFace／檔案——例如 Adobe Fonts 用「啟用桌面
// 字體」同步裝好的字體，本來就已經是這台機器上一個真正的系統字體，Canvas 原生
// 就找得到，不需要（也不該）另外去抓字體檔案。name 直接當 CSS 家族名使用，
// 呼叫端需自行確保沒有異常字元（bubble.js 的 useSystemFont 會先做基本檢查）。
// weight 可選——系統字體挑選器會帶正確的字重數字（100～900）過來，讓 Canvas
// 選到那個特定樣式的字面；手動輸入名稱時不帶，維持原本固定 700 的行為。
export function useSystemFont(name, weight) {
  customFontActive = true;
  customFontLabel = name;
  customFontFamily = name;
  customFontWeight = weight || FONT_WEIGHT;
  glyphCache.clear();
}

// 還原成內建的 Menlo。同樣要清快取，理由跟 setCustomFont 一樣。
export function clearCustomFont() {
  customFontActive = false;
  customFontLabel = '';
  customFontFamily = CUSTOM_FONT_FAMILY;
  customFontWeight = FONT_WEIGHT;
  glyphCache.clear();
}

export const CUSTOM_FONT_FAMILY_NAME = CUSTOM_FONT_FAMILY;

// 全角字的 advance 補正。
//
// 等寬拉丁字的 advance 本來就含左右側邊距（side bearing），字與字之間天生有空隙。
// 全角漢字不是——它的墨幾乎填滿整個 em 框，advance == 字寬，所以相鄰兩字的筆畫在
// 世界空間裡是「剛好貼著」。再加上擠出的邊緣圓角（uTypeShape.y）會把每個字往外
// 長一圈，兩個字就黏成一片。1.12 把空隙補回來，看起來才像一行字。
//
// 拉丁字不套這個倍率——Menlo 的側邊距已經夠，再撐開只會變成刻意的寬鬆字距。
const CJK_TRACKING = 1.12;

// CJK 統一漢字、相容漢字、全角標點與假名。判斷的用途是決定整份圖集的解析度、
// 超取樣倍率與 advance 補正，所以寧可寬鬆。
const isCJK = ch => /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch);

// 走 A 路線（字本身就是玻璃）時字重不能細：筆畫寬度一旦小於擠出厚度，字就變成
// 一束管子而不是字。700 是實用下限，這裡順手驗證瀏覽器真的解析到了等寬字——
// fillText 找不到字體時是靜默 fallback，烘出來的字形會悄悄變成另一套。
export function verifyFont() {
  const fonts = document.fonts;
  if (!fonts || typeof fonts.check !== 'function') return { ok: true, note: '無法驗證（瀏覽器不支援 document.fonts）' };
  if (customFontActive) {
    // 匯入的字體是 bubble.js 用 FontFace.load() 成功之後才呼叫 setCustomFont，
    // 所以理論上這裡一定查得到；仍然檢查一次是防禦性寫法，不是信不過呼叫端——
    // 例如分頁重新整理後 document.fonts 被清空、但某個殘留的 P.typeText 觸發
    // 這裡先跑到的極端情況。
    const ok = fonts.check(`${customFontWeight} 100px "${customFontFamily}"`);
    return {
      ok,
      note: ok ? customFontLabel : `字體「${customFontLabel}」目前讀不到，已 fallback 到 Menlo`,
    };
  }
  const ok = fonts.check(`${FONT_WEIGHT} 100px Menlo`);
  return {
    ok,
    note: ok ? 'Menlo' : `找不到 Menlo，已 fallback 到系統 monospace（字形會與 macOS 上不同）`,
  };
}

// 把使用者輸入的多行文字整理成句子陣列。空行直接丟掉——一個空句子在時間軸上是
// 一段什麼都沒發生的停頓，看起來像卡住而不像設計。
export function parsePhrases(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line.length > 0);
}

// 已烘過的字形快取，key 是「解析度|字元」。
//
// 存在的理由是編輯體驗：EDT 是同步的主執行緒工作，實測四個繁體字在 144² 下要
// 382ms——使用者每打一個字（debounce 之後）就重烘一次整份圖集，而其中只有一個字
// 是新的。快取之後重烘的成本只剩「把已算好的格子 memcpy 進圖集」。
//
// 上限存在是因為每格 144² float 就是 83KB，不設限的話長時間編輯會一直長。
const glyphCache = new Map();
const GLYPH_CACHE_MAX = 160;

function bakeGlyphCached(ch, tile, ctx, hi) {
  const key = `${tile}|${ch}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const baked = bakeOneGlyph(ch, tile, ctx, hi);
  // 超過上限就整份丟掉，而不是做 LRU：這是純函式的結果（同一個字元 + 同一個解析度
  // 永遠烘出同一份場），重算一次的代價明確且有界，不值得為它維護一條淘汰鏈。
  if (glyphCache.size >= GLYPH_CACHE_MAX) glyphCache.clear();
  glyphCache.set(key, baked);
  return baked;
}

function bakeOneGlyph(ch, tile, ctx, hi) {
  ctx.clearRect(0, 0, hi, hi);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, hi * 0.5, hi * BASELINE_RATIO);
  const pixels = ctx.getImageData(0, 0, hi, hi).data;
  const coverage = new Float32Array(hi * hi);
  let ink = 0;
  for (let i = 0; i < hi * hi; i++) {
    const a = pixels[i * 4 + 3] / 255;
    coverage[i] = a;
    if (a > 0.5) ink++;
  }
  // 空白字元沒有墨——不必付 EDT 的錢，直接填一格全正距離。夾在 RANGE 上，
  // 這樣它在 shader 眼裡就是「這格什麼都沒有」。
  if (!ink) return { field: new Float32Array(tile * tile).fill(RANGE), empty: true, inner: 0 };

  const hiField = subpixelSigned2D(coverage, hi, hi);
  const perPixel = TILE_WORLD / hi;
  for (let i = 0; i < hi * hi; i++) hiField[i] *= perPixel;

  // 箱型平均降採樣回 tile²。距離場局部近似線性，區塊平均即區塊中心的距離。
  const ss = hi / tile;
  const field = new Float32Array(tile * tile);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
    let sum = 0;
    for (let dy = 0; dy < ss; dy++) {
      const row = (y * ss + dy) * hi;
      for (let dx = 0; dx < ss; dx++) sum += hiField[row + x * ss + dx];
    }
    field[x + y * tile] = sum * inv;
  }
  const blurred = blurField(field, tile, 0.7);
  // 最深的內部距離 = 最粗筆畫的半厚（世界／格單位）。這是這個字的「特徵尺度」，
  // 拿來當邊緣圓角的上限：圓角一旦超過特徵尺度，相鄰筆畫就會被各自的圓角往外
  // 推到黏在一起——繁體字正是踩在這條線上（見 shaders.js 的 bevel 夾制）。
  let inner = 0;
  for (let i = 0; i < blurred.length; i++) if (blurred[i] < 0) inner = Math.max(inner, -blurred[i]);
  return { field: blurred, empty: false, inner };
}

// 烘焙一份字形圖集。同步計算（跟 SVG 路徑一樣），呼叫端負責 debounce。
//
// 回傳的 advance / baseline 都是「一格 = TILE_WORLD」下的值，shader 端再乘字級。
export function bakeGlyphAtlas(phrases) {
  const chars = [];
  const seen = new Set();
  let truncated = 0;
  for (const phrase of phrases) {
    for (const ch of phrase) {
      if (seen.has(ch)) continue;
      if (chars.length >= MAX_ATLAS_GLYPHS) { truncated++; continue; }
      seen.add(ch);
      chars.push(ch);
    }
  }
  if (!chars.length) return null;

  // 有中文就整份圖集升到 96²。混排時不能只升中文那幾格——圖集是規則網格，
  // 一格一個尺寸的話 shader 端的定位算式就要多帶一張尺寸表。
  const cjk = chars.some(isCJK);
  const tile = cjk ? TILE_CJK : TILE;
  const hi = tile * (cjk ? SS_CJK : SS);
  const emPx = hi * EM_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = hi;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = `${customFontActive ? customFontWeight : FONT_WEIGHT} ${emPx}px ${fontStack()}`;

  // advance 取所有字元的最大值。等寬字下每個字都一樣，這個 max 只在混入全角
  // 字元時起作用（全角是半角的兩倍寬），此時整行退化成全角網格——字距會偏寬，
  // 但不會重疊。真正的半/全角雙級網格留到中文那一階段。
  let advancePx = 0;
  for (const ch of chars) advancePx = Math.max(advancePx, ctx.measureText(ch).width);
  if (!(advancePx > 0)) advancePx = emPx * 0.6;

  const cols = Math.ceil(Math.sqrt(chars.length));
  const rows = Math.ceil(chars.length / cols);
  const atlasW = cols * tile;
  const atlasH = rows * tile;
  const atlas = new Float32Array(atlasW * atlasH).fill(RANGE);

  const indexOf = new Map();
  // 整份圖集取最小值：一行字裡最細的那個字決定圓角的安全上限。
  let feature = Infinity;
  for (let i = 0; i < chars.length; i++) {
    const { field, empty, inner } = bakeGlyphCached(chars[i], tile, ctx, hi);
    if (!empty) feature = Math.min(feature, inner);
    const col = i % cols;
    const row = (i / cols) | 0;
    // 每格自己翻轉列序：canvas 的 y=0 是上緣，DataTexture 的第一列是 v=0（下緣）。
    // 不翻的話字會上下顛倒（shape-field.js 的 SVG 路徑踩過同一個坑）。
    for (let y = 0; y < tile; y++) {
      const src = y * tile;
      const dst = (row * tile + (tile - 1 - y)) * atlasW + col * tile;
      for (let x = 0; x < tile; x++) atlas[dst + x] = field[src + x];
    }
    indexOf.set(chars[i], i);
  }

  return {
    texture: encodeFloat2D(atlas, atlasW, atlasH, RANGE),
    cjk,
    // 特徵尺度（格單位）。空白字元不計；整份都是空白時退回一個不會夾住任何東西
    // 的大值。
    feature: Number.isFinite(feature) ? feature : 1,
    cols,
    rows,
    tile,
    range: RANGE,
    // 世界單位（每格 = TILE_WORLD）。shader 端乘上字級。
    advance: advancePx * (TILE_WORLD / hi) * (cjk ? CJK_TRACKING : 1),
    // 基線相對格中心的位移，正值代表格中心在基線上方。
    baseline: (BASELINE_RATIO - 0.5) * TILE_WORLD,
    indexOf,
    count: chars.length,
    truncated,
    font: verifyFont(),
  };
}

// 圖集還沒烘好時綁的空貼圖。shader 只有在 uTypeLine.w（字數）> 0 時才會取樣，
// 但取樣器一定要綁著東西，否則某些驅動會直接拒絕這支 shader。
export function makeBlankGlyphAtlas() {
  const tex = new THREE.DataTexture(
    new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

