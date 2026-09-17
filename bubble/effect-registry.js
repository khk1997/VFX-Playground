'use strict';

import { MOTIONS, MOTION_KEYS } from './motions/registry.js?v=edge-tint-1';

// 首頁清單裡的「液態玻璃」那一族。
//
// 每個動態模式都是首頁上的一張獨立卡片，但它們共用同一份頁面：連結帶 ?mode=，
// bubble.js 在初始化前就把那個模式套好（見該檔的 applyLaunchMotion），所以不必
// 為每個模式複製一份 HTML，也不會先以預設模式畫一幀再切過去。
//
// 標題直接讀 motions/registry.js 的 label —— 面板下拉選單與首頁卡片是同一份名字，
// 改名只要改一個地方。其餘欄位是首頁才需要的陳述性資料（分類、說明、標籤、主題
// 色），跟渲染參數無關，所以留在這裡而不是塞進動態模式的 registry。
const PAGE = 'bubble/index.html';

// 每個模式對應的執行期模組。靜態與毛細波共用同一支（同一組程序化表面紋理
// uniform），打字的那支在 bubble/ 根目錄，因為它還兼管字形圖集。
const RUNTIME = {
  static: 'bubble/motions/runtime/static-capillary.js',
  capillary: 'bubble/motions/runtime/static-capillary.js',
  jelly: 'bubble/motions/runtime/jelly.js',
  research: 'bubble/motions/runtime/research.js',
  melt: 'bubble/motions/runtime/melt.js',
  morph: 'bubble/motions/runtime/morph.js',
  shatter: 'bubble/motions/runtime/shatter.js',
  weave: 'bubble/motions/runtime/weave.js',
  formation: 'bubble/motions/runtime/formation.js',
  typewriter: 'bubble/typewriter-runtime.js',
};

// 首頁卡片用的陳述性資料。key 是動態模式的 id，跟 motions/registry.js 同一組。
const PRESENTATION = {
  static: {
    category: 'RAYMARCHING',
    description: '不動的玻璃幾何體，表面帶一層極淡的波紋質感',
    tags: ['Three.js', 'Raymarching', 'SDF Primitives'],
    theme: ['91, 181, 255', '238, 117, 204'],
  },
  capillary: {
    category: 'PROCEDURAL SURFACE',
    description: '同心波紋沿著匯入造型的表面向外推送',
    tags: ['Three.js', 'Procedural Noise', 'Surface Displacement'],
    theme: ['86, 206, 224', '120, 140, 255'],
  },
  jelly: {
    category: 'SOFT BODY',
    description: '果凍質感的造型，落地彈跳或原地被戳出餘震',
    tags: ['Three.js', 'Damped Spring', 'Squash & Stretch'],
    theme: ['255, 176, 92', '246, 108, 148'],
  },
  research: {
    category: 'PRODUCT LOOP',
    description: '主殼與伴生殼週期性融合，殼裡有互相繞行的玻璃核',
    tags: ['Three.js', 'Metaballs', 'Icon Tinting'],
    theme: ['121, 148, 255', '196, 122, 255'],
  },
  melt: {
    category: 'FLUID',
    description: '造型底部不斷長出水滴，拉出細頸後墜落',
    tags: ['Three.js', 'Surface Tension', 'Drip Envelope'],
    theme: ['96, 200, 214', '128, 166, 255'],
  },
  morph: {
    category: 'SHAPE TRANSITION',
    description: '兩顆造型被各自的波前削掉與放出，水滴在中間接力',
    tags: ['Three.js', 'Dual SDF', 'Dissolve Front'],
    theme: ['255, 138, 176', '148, 130, 255'],
  },
  shatter: {
    category: 'DESTRUCTION',
    description: '造型原地蓄力後炸成碎片飛出，再回頭重組',
    tags: ['Three.js', 'Ballistics', 'Fragment Anchors'],
    theme: ['255, 150, 106', '255, 96, 122'],
  },
  weave: {
    category: 'RAYMARCHING',
    description: '水滴沿著循環軌跡貼著並穿過完整的玻璃造型',
    tags: ['Three.js', 'Orbit Paths', 'Liquid Bridges'],
    theme: ['110, 196, 255', '128, 246, 214'],
  },
  formation: {
    category: 'SHAPE ASSEMBLY',
    description: '自由飛行的水滴逐漸排進造型，被距離場吸收',
    tags: ['Three.js', 'Anchor Distribution', 'Volume Handoff'],
    theme: ['124, 176, 255', '236, 134, 220'],
  },
  typewriter: {
    category: 'TYPOGRAPHY',
    description: '逐字長出的玻璃文字，可換字體與擠出厚度',
    tags: ['Three.js', 'SDF Glyph Atlas', 'Extrusion'],
    theme: ['186, 190, 208', '124, 198, 255'],
  },
};

// 首頁卡片是照這個順序排的。刻意不直接用 MOTION_KEYS 的順序——那份是面板下拉
// 選單的順序，跟「首頁想先給誰看」不是同一件事。
const ORDER = [
  'research', 'formation', 'morph', 'melt', 'jelly',
  'shatter', 'weave', 'capillary', 'typewriter', 'static',
];

export const BUBBLE_EFFECTS = ORDER.map(id => {
  const motion = MOTIONS[id];
  const presentation = PRESENTATION[id];
  if (!motion || !presentation) throw new Error(`首頁效果 registry 缺少模式：${id}`);
  return {
    id,
    title: motion.label,
    category: presentation.category,
    description: presentation.description,
    tags: [...new Set(['HTML', 'CSS', 'JavaScript', 'Three.js', ...presentation.tags])],
    theme: presentation.theme,
    href: `${PAGE}?mode=${id}`,
    previewSrc: `${PAGE}?mode=${id}&preview=1`,
    runtime: RUNTIME[id],
  };
});

// 清單與動態模式必須是同一組：漏掉一個模式（或留著一個已移除的）在這裡就會
// 炸掉，而不是等到首頁少一張卡片才發現。
const registered = new Set(ORDER);
for (const id of MOTION_KEYS) {
  if (!registered.has(id)) throw new Error(`動態模式 ${id} 沒有註冊成首頁效果`);
}
for (const id of ORDER) {
  if (!MOTION_KEYS.includes(id)) throw new Error(`首頁效果 ${id} 不是現存的動態模式`);
  if (!RUNTIME[id]) throw new Error(`首頁效果 ${id} 沒有對應的 runtime module`);
}
