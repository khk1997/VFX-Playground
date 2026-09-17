/* ===== 特效清單 =====
   href 為 null 代表尚未開放（顯示 敬請期待）。
   previewSrc 用 iframe 嵌入實際特效頁（?preview=1 隱藏 UI）。
   為了效能，只有 active 卡片附近的 iframe 會播放，其餘會收到 'vfx-pause' postMessage。

   液態玻璃那一族的十個模式不寫在這裡：它們共用同一份頁面、只差 ?mode= 參數，
   卡片資料由 bubble/effect-registry.js 從動態模式的 registry 產生，標題直接讀
   面板下拉選單用的同一份 label。加一個新模式不必動這個檔。 */
import { BUBBLE_EFFECTS } from './bubble/effect-registry.js?v=home-registry-1';

const STANDALONE_EFFECTS = [
  {
    id: 'sakura',
    title: '櫻花飄落 Sakura Storm',
    category: 'PARTICLE SYSTEM',
    description: '風場驅動的櫻花粒子場景',
    theme: ['239, 105, 143', '119, 171, 255'],
    href: 'sakura-blizzard/index.html',
    tags: ['HTML', 'CSS', 'JavaScript', 'Canvas 2D', 'Particles'],
    previewSrc: 'sakura-blizzard/index.html?preview=1',
  },
  {
    id: 'energy-ring',
    title: '動態光環 Energy Ring',
    category: 'ENERGY SIMULATION',
    description: '多層電弧構成的旋轉能量核心',
    theme: ['85, 255, 121', '36, 178, 107'],
    href: 'energy-ring/index.html',
    tags: ['HTML', 'CSS', 'JavaScript', 'Canvas 2D'],
    previewSrc: 'energy-ring/index.html?preview=1',
  },
  {
    id: 'aurora',
    title: '極光 Aurora',
    category: 'AUDIO REACTIVE',
    description: '隨音訊頻率起伏的極光簾幕',
    theme: ['63, 233, 179', '80, 138, 255'],
    href: 'aurora/index.html',
    tags: ['HTML', 'CSS', 'JavaScript', 'Canvas 2D', 'Web Audio API'],
    previewSrc: 'aurora/index.html?preview=1',
  },
];

export const EFFECTS = [...STANDALONE_EFFECTS, ...BUBBLE_EFFECTS].map(effect => ({
  ...effect,
  posterSrc: `image/previews/${effect.id}.webp`,
}));

// iframe 內部渲染解析度（與卡片預覽框同比例 220:190，放大 3 倍後縮小顯示以求清晰）
