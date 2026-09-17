import { EDGE_TINT_BASE_BY_BACKDROP } from './runtime-defaults.js?v=1';

const POSITIONS = [0, 0.16, 0.29, 0.39, 0.62, 0.82];

// Each style owns separate dark/light tuning and separate shell/icon palettes.
// Applying one is only a starting point: the normal controls remain independent.
//
// 風格不帶基底色。基底色的規則只有一條、而且不分風格：它就是當下的底色本身
// （見 runtime-defaults 的 EDGE_TINT_BASE_BY_BACKDROP）。風格要決定的是邊緣那
// 幾個色標、染色強度與混色方式——中央那塊跟背景同色，換風格時才不會在物體中間
// 突然多出一塊跟背景不一樣的顏色。
export const INSTALLING_VISUAL_PRESETS = [
  {
    id: 'prism', label: '稜彩', swatch: 'linear-gradient(90deg,#2478ff,#57dcf0,#ff9ad8,#ffe08a)',
    dark: {
      shell: { tint: 0.58, edge: 0.86, mix: 0.92, rotation: 12, focus: 0.58, colors: ['#1768f0','#3dd7f0','#f497d2','#ffe085','#b7edf4','#b187e2'] },
      icon: { tint: 0.76, edge: 0.91, mix: 1, rotation: 338, focus: 0.68, colors: ['#176ff2','#54ddf2','#ff9bd5','#ffe6a0','#c8f4f7','#9e83e8'] },
    },
    light: {
      shell: { tint: 0.34, edge: 0.84, mix: 0.88, rotation: 10, focus: 0.48, colors: ['#2f7ee7','#61d8ef','#efa7d3','#f7d993','#bdebf2','#a995dc'] },
      icon: { tint: 0.58, edge: 0.9, mix: 0.96, rotation: 342, focus: 0.6, colors: ['#2678e8','#64dff2','#f2a7d4','#ffe2a0','#c8f1f5','#a38de1'] },
    },
  },
  {
    id: 'arctic', label: '冰川', swatch: 'linear-gradient(90deg,#155ce8,#32bce9,#b9f4f7,#799be8)',
    dark: {
      shell: { tint: 0.52, edge: 0.88, mix: 0.9, rotation: 24, focus: 0.62, colors: ['#1356dc','#168fdc','#39cce8','#b9f3f5','#80d6ee','#547be0'] },
      icon: { tint: 0.72, edge: 0.93, mix: 0.96, rotation: 350, focus: 0.72, colors: ['#155ce4','#20a8e7','#66e3f0','#d8fbfa','#8cdcf1','#5d79df'] },
    },
    light: {
      shell: { tint: 0.3, edge: 0.86, mix: 0.82, rotation: 18, focus: 0.52, colors: ['#327ed7','#43b8df','#83dfe9','#dcf7f5','#a8deeb','#7995dc'] },
      icon: { tint: 0.54, edge: 0.92, mix: 0.92, rotation: 346, focus: 0.65, colors: ['#287ad8','#43bde4','#8de8ef','#effdfb','#b4e5ef','#758edb'] },
    },
  },
  {
    id: 'pearl', label: '珠光', swatch: 'linear-gradient(90deg,#d786bc,#ffb49f,#ffe39b,#9ddfe6)',
    dark: {
      shell: { tint: 0.5, edge: 0.84, mix: 0.9, rotation: 330, focus: 0.55, colors: ['#9179dc','#e58fbd','#ffb09d','#ffe39b','#aee8e8','#709ede'] },
      icon: { tint: 0.7, edge: 0.9, mix: 0.98, rotation: 316, focus: 0.66, colors: ['#977bde','#ec91be','#ffb49c','#ffe6a2','#b5eceb','#769cdf'] },
    },
    light: {
      shell: { tint: 0.3, edge: 0.82, mix: 0.84, rotation: 328, focus: 0.46, colors: ['#a28bd0','#dfa1bd','#edb5a4','#ead99e','#b6dfe2','#8fa6d2'] },
      icon: { tint: 0.52, edge: 0.9, mix: 0.94, rotation: 312, focus: 0.58, colors: ['#9c82d3','#e19abb','#f0b09e','#f4dda0','#b5e5e6','#879fd7'] },
    },
  },
];

function targetValues(prefix, style, base) {
  const values = {
    [`${prefix}Tint`]: style.tint,
    [`${prefix}TintEdge`]: style.edge,
    [`${prefix}TintColor`]: base,
    [`${prefix}MultiTint`]: true,
    [`${prefix}MultiTintStrength`]: style.mix,
    [`${prefix}MultiTintRotation`]: style.rotation,
    [`${prefix}MultiTintFocus`]: style.focus,
  };
  style.colors.forEach((color, index) => {
    values[`${prefix}TintStopColor${index}`] = color;
    values[`${prefix}TintStopPos${index}`] = POSITIONS[index];
  });
  return values;
}

export function installingVisualPresetValues(id, backdrop) {
  const preset = INSTALLING_VISUAL_PRESETS.find(item => item.id === id);
  if (!preset) throw new Error(`Unknown Installing visual preset: ${id}`);
  const theme = backdrop === 'light' ? preset.light : preset.dark;
  const base = EDGE_TINT_BASE_BY_BACKDROP[backdrop] ?? EDGE_TINT_BASE_BY_BACKDROP.dark;
  return {
    ...targetValues('researchShell', theme.shell, base),
    ...targetValues('researchIcon', theme.icon, base),
  };
}
