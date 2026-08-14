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

export function makeMeltDemoSvgFile() {
  return new File([MELT_DEFAULT_SVG_TEXT], `${MELT_DEFAULT_SVG_NAME}.svg`, { type: 'image/svg+xml' });
}
