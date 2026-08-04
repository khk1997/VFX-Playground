/* ===== 特效清單 =====
   href 為 null 代表尚未開放（顯示 敬請期待）。
   previewSrc 用 iframe 嵌入實際特效頁（?preview=1 隱藏 UI）。
   為了效能，只有 active 卡片附近的 iframe 會播放，其餘會收到 'vfx-pause' postMessage。 */
const EFFECTS = [
  {
    title: '櫻花飄落 Sakura Storm',
    category: 'PARTICLE SYSTEM',
    description: '風場驅動的櫻花粒子場景',
    theme: ['239, 105, 143', '119, 171, 255'],
    href: 'sakura-blizzard/index.html',
    tags: ['Canvas 2D', 'Particles', 'Wind Field'],
    previewSrc: 'sakura-blizzard/index.html?preview=1',
  },
  {
    title: '動態光環 Energy Ring',
    category: 'ENERGY SIMULATION',
    description: '多層電弧構成的旋轉能量核心',
    theme: ['85, 255, 121', '36, 178, 107'],
    href: 'energy-ring/index.html',
    tags: ['HTML5 Canvas', 'CSS', 'JavaScript'],
    previewSrc: 'energy-ring/index.html?preview=1',
  },
  {
    title: '粒子星雲 Nebula',
    category: 'FLOW FIELD',
    description: '流場驅動的深空粒子星雲',
    theme: ['80, 153, 255', '130, 91, 255'],
    href: 'nebula/index.html',
    tags: ['HTML5 Canvas', 'CSS', 'JavaScript'],
    previewSrc: 'nebula/index.html?preview=1',
  },
  {
    title: '流體墨水 Fluid Ink',
    category: 'FLUID DYNAMICS',
    description: '可互動的彩色墨流模擬',
    theme: ['39, 192, 213', '64, 108, 255'],
    href: 'fluid-ink/index.html',
    tags: ['HTML5 Canvas', 'CSS', 'JavaScript'],
    previewSrc: 'fluid-ink/index.html?preview=1',
  },
  {
    title: '極光 Aurora',
    category: 'AUDIO REACTIVE',
    description: '隨音訊頻率起伏的極光簾幕',
    theme: ['63, 233, 179', '80, 138, 255'],
    href: 'aurora/index.html',
    tags: ['HTML5 Canvas', 'Web Audio API', 'JavaScript'],
    previewSrc: 'aurora/index.html?preview=1',
  },
  {
    title: '虹彩水滴 Prism Drops',
    category: 'RAYMARCHING',
    description: '具有薄膜干涉色彩的融合水滴',
    theme: ['91, 181, 255', '238, 117, 204'],
    href: 'bubble/index.html',
    tags: ['Three.js', 'Raymarching', 'Metaballs'],
    previewSrc: 'bubble/index.html?preview=1',
  },
];

// iframe 內部渲染解析度（與卡片預覽框同比例 220:190，放大 3 倍後縮小顯示以求清晰）
