import * as THREE from 'three';

/* ===== 內建預設外形 =====
 * 「形狀匯聚」等依賴形狀的模式原本一定要先匯入 SVG 或 GLB 才看得到東西，切過去只會
 * 得到一團自由漂浮的水滴。這裡提供兩個刻意做得很單純的預設造型，讓兩個模式
 * 一開啟就有畫面；使用者自己匯入檔案後會直接蓋掉預設，之後不再自動載回。
 *
 * SVG 以字串內嵌、3D 以程式生成，兩者都不經過 fetch —— 這頁常直接用 file://
 * 開啟預覽，任何相對路徑的網路請求都會被 CORS 擋掉。
 */

export const DEFAULT_SVG_NAME = '內建問號';

// 問號。svgToField 是把 SVG 光柵化後拿 alpha 當覆蓋率，描邊和填色一樣都算進
// 距離場，所以這裡直接用粗描邊畫，不必先把字形轉成填色外框 —— 圓端點與正圓
// 弧的曲率比手工外框更順，Metaball 收邊也乾淨。
//
// 線寬 24 對上鉤子半徑 36：內圈還留得下 48 直徑的孔，匯聚成液體後那個孔不會
// 被表面張力糊死。下方的點是獨立元件，剛好順便示範距離場支援不連通的外形。
export const DEFAULT_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M 64 64 A 36 36 0 1 1 100 100 L 100 124"
        fill="none" stroke="#ffffff" stroke-width="24"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="100" cy="160" r="16" fill="#ffffff"/>
</svg>`;

export const MELT_DEFAULT_SVG_NAME = '內建冰塊';

// 融化模式專用的展示形狀。曾經試過兩種替代方案，都有問題：
//   底部疊一顆小圓暗示「已經開始滴」——光柵化後只會在整齊輪廓上長出一顆
//   不對稱的疣，看起來像瑕疵而不是設計；水滴本身在動畫裡就已經在滴了，
//   不需要這種提示。
//   平頂平底的六角形（想強調「有稜有角的固態」對比融化後的圓潤液滴）——
//   實測 selectBottomAnchors 只挑到 6 個滴落點、還有一半集中在兩側斜邊、
//   正中央的底部完全沒有取樣點：六角形往下收窄，固定間距的取樣網格會漏掉
//   中間那段真正最低的水平邊，滴落點變成「只從兩側角落滴」。
// 圓角方塊沒有這個問題：整個寬度從上到下沒有收窄，底邊到哪裡都一樣低，取樣
// 網格不會漏掉任何一段。實測 49 個表面取樣點、12 個滴落點沿底邊均勻鋪滿整個
// 寬度（-0.655～0.66），是目前這個機制下最可靠的底部形狀。
export const MELT_DEFAULT_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect x="46" y="52" width="108" height="108" rx="18" ry="18" fill="#ffffff"/>
</svg>`;

export const MORPH_TARGET_SVG_NAME = '內建星形';

// 形狀變形的目標形狀 B。挑星形是因為它跟問號（形狀 A）在兩件事上都不一樣：
// 輪廓分佈是放射狀而不是集中在一側，錨點數量也差得多。配對演算法（見
// motions/morph.js 的 buildMorphPairs）正是要在這種不對等的情況下才看得出
// 有沒有做對——兩顆長得差不多的形狀就算用索引取模亂配也看不出破綻。
//
// 內圓角半徑取外徑的 42%（80 / 34）：再尖一點，五個角的錨點會稀疏到只剩
// 一兩顆水滴，角就消失了；再鈍一點就跟圓形沒兩樣，變形前後的差異不夠。
//
// 用描邊而不是填色，這一點是實測出來的：填色的星形錨點會鋪滿整個內部，而
// 錨點的半徑取決於該處造型有多厚，於是正中央就長出一顆蓋住整顆星的巨大水滴，
// 五個角只剩幾顆小球掛在外面，完全讀不出是星形。這個模式的畫面全部由水滴排
// 出來（不顯示距離場實體），所以形狀必須是「細的」——問號那個內建形狀正好
// 也是描邊，同樣的道理。
export const MORPH_TARGET_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <polygon points="100.0,20.0 120.0,72.5 176.1,75.3 132.3,110.5 147.0,164.7 100.0,134.0 53.0,164.7 67.7,110.5 23.9,75.3 80.0,72.5"
           fill="none" stroke="#ffffff" stroke-width="20"
           stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

export const DEFAULT_SOLID_NAME = '內建環形';

// Torus 是封閉實體，體素化不會產生非封閉掃描線；中央開孔讓匯聚效果比一顆
// 球體明顯得多，旋轉視角時也立刻看得出這是 3D 而不是擠出的平面外形。
// 管徑取 0.26（總尺寸的 ~30%），在最低的 48³ 品質下仍有約 11 個體素厚。
export function buildDefaultSolid() {
  return new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.26, 24, 64),
    new THREE.MeshBasicMaterial(),
  );
}


export const MORPH_TARGET_SOLID_NAME = '內建多面體';

// 形狀變形在 GLB 來源下的目標形狀 B。挑二十面體的理由跟星形一樣是「跟形狀 A
// 差得夠遠」：內建環形是有孔的細管，這顆是實心的多面體，體積分佈與拓樸都相反，
// 波前掃過時看得出真的換了一顆東西。
//
// 半徑 0.78 對上環形的外徑 0.88，兩者的包圍尺寸接近，波前的掃描範圍才不會被
// 其中一顆撐得特別大。detail 0 保留平整的三角面——體素化後本來就會被平滑掉
// 一部分稜角，再細分下去只是變成球。
export function buildMorphTargetSolid() {
  return new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.78, 0),
    new THREE.MeshBasicMaterial(),
  );
}

export function makeMorphTargetSvgFile() {
  return new File([MORPH_TARGET_SVG_TEXT], `${MORPH_TARGET_SVG_NAME}.svg`, { type: 'image/svg+xml' });
}

// 其餘各模式的展示形狀。每個模式挑一顆跟自己的動態有關的造型，首頁卡片才
// 不會整排都是同一個問號。挑選依據同上面幾顆的教訓：
//   水滴排出輪廓的模式（匯聚、變形 A）用描邊或本身就細的造型，不用大面積填色；
//   以實體為主的模式（果凍、崩解、毛細波）用飽滿的填色或粗環，形變才有東西可看。

// 形狀匯聚：微滴聚成晶體。六支主幹各帶一對分岔，全部是描邊——放射狀的細線
// 讓匯聚過程一路都看得出輪廓，不會先糊成一團再慢慢長出形狀。
export const SNOWFLAKE_SVG_NAME = '內建雪花';
export const SNOWFLAKE_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M 100 100 L 100.0 28.0 M 100.0 56.0 L 117.0 39.0 M 100.0 56.0 L 83.0 39.0
           M 100 100 L 37.6 64.0 M 61.9 78.0 L 55.7 54.8 M 61.9 78.0 L 38.7 84.2
           M 100 100 L 37.6 136.0 M 61.9 122.0 L 38.7 115.8 M 61.9 122.0 L 55.7 145.2
           M 100 100 L 100.0 172.0 M 100.0 144.0 L 83.0 161.0 M 100.0 144.0 L 117.0 161.0
           M 100 100 L 162.4 136.0 M 138.1 122.0 L 144.3 145.2 M 138.1 122.0 L 161.3 115.8
           M 100 100 L 162.4 64.0 M 138.1 78.0 L 161.3 84.2 M 138.1 78.0 L 144.3 54.8"
        fill="none" stroke="#ffffff" stroke-width="18"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// 形狀變形的 A：月牙變成星形（B）。外圓 R66 扣掉偏右上的內圓 r56，最厚處約 40，
// 往兩端收成尖角——本身就是細長造型，填色也不會在中央長出巨大水滴。輪廓集中
// 在左側，跟星形的放射狀分佈正好相反，配對演算法才有得考。
export const CRESCENT_SVG_NAME = '內建月牙';
export const CRESCENT_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M 100.8 34 A 66 66 0 1 0 159.3 129.1 A 56 56 0 1 1 100.8 34 Z" fill="#ffffff"/>
</svg>`;

// 果凍：小熊軟糖。整隻由圓與橢圓疊成，輪廓圓潤、肚子厚實，被戳的時候才有
// 膠體在晃的感覺；兩隻腳的底邊就是落地彈跳踩的那一面。
export const GUMMY_SVG_NAME = '內建小熊軟糖';
export const GUMMY_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <g fill="#ffffff">
    <circle cx="74" cy="34" r="13"/>
    <circle cx="126" cy="34" r="13"/>
    <circle cx="100" cy="60" r="31"/>
    <ellipse cx="100" cy="124" rx="37" ry="40"/>
    <ellipse cx="62" cy="110" rx="15" ry="12" transform="rotate(-30 62 110)"/>
    <ellipse cx="138" cy="110" rx="15" ry="12" transform="rotate(30 138 110)"/>
    <circle cx="76" cy="160" r="17"/>
    <circle cx="124" cy="160" r="17"/>
  </g>
</svg>`;

// 崩解噴濺：一座抽象玻璃雕塑被打碎。輪廓是不對稱的有機曲線（Arp／Moore 那類
// 雕塑）：寬底座、收腰、上半身往右傾，頭部與底座各挖一個孔。碎片飛出去之前先
// 讀得出這是一件「作品」，碎掉才有可惜的感覺；水滴形本身太像液體，炸開跟沒炸
// 差不多。孔周圍的壁厚最薄處約 20，跟問號的描邊同一個量級。
export const SCULPTURE_SVG_NAME = '內建玻璃雕塑';
export const SCULPTURE_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path fill="#ffffff" fill-rule="evenodd"
        d="M 100.0 174.0
           C 111.3 174.3 125.3 175.0 134.0 172.0
           C 142.7 169.0 149.7 163.3 152.0 156.0
           C 154.3 148.7 152.3 136.3 148.0 128.0
           C 143.7 119.7 129.0 113.0 126.0 106.0
           C 123.0 99.0 125.7 93.0 130.0 86.0
           C 134.3 79.0 148.7 72.3 152.0 64.0
           C 155.3 55.7 154.3 43.0 150.0 36.0
           C 145.7 29.0 134.7 23.3 126.0 22.0
           C 117.3 20.7 105.3 23.7 98.0 28.0
           C 90.7 32.3 84.3 40.7 82.0 48.0
           C 79.7 55.3 85.3 64.0 84.0 72.0
           C 82.7 80.0 79.0 88.0 74.0 96.0
           C 69.0 104.0 58.3 111.0 54.0 120.0
           C 49.7 129.0 46.0 141.7 48.0 150.0
           C 50.0 158.3 57.3 166.0 66.0 170.0
           C 74.7 174.0 88.7 173.7 100.0 174.0 Z
           M 118 34 A 13 18 20 1 0 118 70 A 13 18 20 1 0 118 34 Z
           M 92 130 A 18 13 -15 1 0 128 140 A 18 13 -15 1 0 92 130 Z"/>
</svg>`;

// 穿梭環繞：無限符號。水滴繞著兩個圈與中間的交叉點穿梭，正好是「交織」的意象；
// 兩個圈都留得下孔，表面錨點會分佈在內外兩側。
export const INFINITY_SVG_NAME = '內建無限';
export const INFINITY_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <path d="M 100 100 C 120 66 174 66 174 100 C 174 134 120 134 100 100
           C 80 66 26 66 26 100 C 26 134 80 134 100 100 Z"
        fill="none" stroke="#ffffff" stroke-width="22"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// 毛細波：粗圓環。波紋需要大片平整的頂面才看得出來，中間的孔讓環波在內外
// 兩圈各自收斂，像水滴落進水面。
export const RING_SVG_NAME = '內建圓環';
export const RING_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <circle cx="100" cy="100" r="56" fill="none" stroke="#ffffff" stroke-width="40"/>
</svg>`;

// registry 的 svgDemo 值 → 內建 SVG。沒列在這裡的值一律退回問號。
const BUILTIN_SVGS = {
  question: { name: DEFAULT_SVG_NAME, text: DEFAULT_SVG_TEXT },
  ice: { name: MELT_DEFAULT_SVG_NAME, text: MELT_DEFAULT_SVG_TEXT },
  snowflake: { name: SNOWFLAKE_SVG_NAME, text: SNOWFLAKE_SVG_TEXT },
  crescent: { name: CRESCENT_SVG_NAME, text: CRESCENT_SVG_TEXT },
  gummy: { name: GUMMY_SVG_NAME, text: GUMMY_SVG_TEXT },
  sculpture: { name: SCULPTURE_SVG_NAME, text: SCULPTURE_SVG_TEXT },
  infinity: { name: INFINITY_SVG_NAME, text: INFINITY_SVG_TEXT },
  ring: { name: RING_SVG_NAME, text: RING_SVG_TEXT },
};

export function builtinSvgName(variant) {
  return (BUILTIN_SVGS[variant] || BUILTIN_SVGS.question).name;
}

export function makeBuiltinSvgFile(variant) {
  const { name, text } = BUILTIN_SVGS[variant] || BUILTIN_SVGS.question;
  return new File([text], `${name}.svg`, { type: 'image/svg+xml' });
}
