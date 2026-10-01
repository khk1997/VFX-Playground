import assert from 'node:assert/strict';
import { GLASS_TINT_MODES, glassTintBox } from '../bubble/glass-tint.js';
import { SELECTS, COLORS, LINEAR_COLOR_KEYS } from '../bubble/control-schema.js';
import { DEFAULTS, SELECT_DEFAULTS, COLOR_DEFAULTS } from '../bubble/runtime-defaults.js';
import { staticShapeFloorHeight, staticShapeHalfExtents } from '../bubble/drop-physics.js';
import { FRAG } from '../bubble/shaders.js';

const base = {
  staticShape: 0, boxSize: 0.8, boxCornerRadius: 0.1,
  primitiveSize: 0.9, primitiveHeight: 0.7, primitiveTubeRatio: 0.35,
};
const bounds = { center: [0.1, 0.2, 0.3], radius: 2 };

// 單色一定是 0：shader 用它判斷要不要走原本的式子。
assert.equal(GLASS_TINT_MODES.off, 0);
assert.deepEqual(SELECTS.absorbGradient.map, GLASS_TINT_MODES);
assert.ok(SELECT_DEFAULTS.absorbGradient in GLASS_TINT_MODES);
assert.equal(SELECT_DEFAULTS.absorbGradient, 'off', '預設要是單色，畫面才跟以前一樣');
assert.equal(COLORS.absorbColorB, 'uAbsorbColorB');
assert.ok(LINEAR_COLOR_KEYS.has('absorbColorB'), '第二個吸收色要跟第一個一樣不做色彩轉換');
assert.ok(COLOR_DEFAULTS.absorbColorB);
assert.ok(DEFAULTS.absorbGradientMid >= 0 && DEFAULTS.absorbGradientMid <= 1);
assert.ok(DEFAULTS.absorbGradientSoftness > 0 && DEFAULTS.absorbGradientSoftness <= 1);

// 內建造型：範圍就是 SDF 的包圍盒，以原點為中心。
assert.deepEqual(glassTintBox({ params: base, bounds }), { min: [-0.8, -0.8, -0.8], max: [0.8, 0.8, 0.8] });
const torus = { ...base, staticShape: 6 };
const minor = 0.35 * 0.9;
assert.deepEqual(glassTintBox({ params: torus, bounds }).max, [0.9 + minor, minor, 0.9 + minor]);

// 地板跟漸層讀同一份半尺寸：坐在地板上的那一面就是漸層的底端。
for (const staticShape of [0, 1, 2, 3, 4, 5, 6]) {
  const params = { ...base, staticShape };
  assert.ok(Math.abs(staticShapeFloorHeight(params) - (-staticShapeHalfExtents(params)[1] - 0.02)) < 1e-12);
}

// 匯入走三角網格：網格包圍盒 × 縮放 + 位移。
const imported = { ...base, staticShape: 7 };
const mesh = { min: [-1, -2, -0.5], max: [1, 2, 0.5], scale: 0.5, offset: [0, 0.1, 0] };
assert.deepEqual(glassTintBox({ params: imported, mesh, bounds }), {
  min: [-0.5, -0.9, -0.25], max: [0.5, 1.1, 0.25],
});
// 沒有網格（SVG、網格建不出來）：退回包圍球。
assert.deepEqual(glassTintBox({ params: imported, bounds }), {
  min: [-1.9, -1.8, -1.7], max: [2.1, 2.2, 2.3],
});

// shader 端：漸層只編進靜態，主射線與影子都走同一組函式，單色保留原本的式子。
assert.match(FRAG, /vec3 glassVolumeAbsorption\(float pathLength, vec3 tintDepth\)/);
assert.match(FRAG, /volumeAbsorption = glassVolumeAbsorption\(pathLength, tintDepth\)/);
assert.match(FRAG, /tintDepth \+= glassTintDepth\(exitPoint, bouncePoint/);
assert.match(FRAG, /tint = glassSegmentAbsorption\(floorPos/);
assert.ok(!/absorbCoefficient = -log/.test(FRAG), '吸收係數只能在 glass-tint.js 定義一次');
const staticBlock = FRAG.indexOf('#ifdef FEATURE_STATIC_GLASS\nuniform int   uGlassTintMode');
assert.ok(staticBlock >= 0, '漸層的 uniform 與函式要包在 FEATURE_STATIC_GLASS 裡');

console.log('Glass tint modes, ranges, and shader wiring passed');
