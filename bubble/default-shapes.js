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

export function makeDefaultSvgFile() {
  return new File([DEFAULT_SVG_TEXT], `${DEFAULT_SVG_NAME}.svg`, { type: 'image/svg+xml' });
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

export function makeMeltDemoSvgFile() {
  return new File([MELT_DEFAULT_SVG_TEXT], `${MELT_DEFAULT_SVG_NAME}.svg`, { type: 'image/svg+xml' });
}
