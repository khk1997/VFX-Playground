import assert from 'node:assert/strict';
import { describeShapeImport, loadShapeAsset } from '../bubble/shape-loader.js';

const names = {
  defaultSvgName: 'Question.svg',
  meltSvgName: 'Ice.svg',
  defaultSolidName: 'Ring.glb',
};
assert.deepEqual(describeShapeImport({
  file: null, kind: 'svg', svgVariant: 'question', gridSize: 80, rebuilding: false, ...names,
}), {
  builtin: true,
  label: 'Question.svg',
  status: '正在分析 SVG：Question.svg',
});
assert.equal(describeShapeImport({
  file: null, kind: 'svg', svgVariant: 'ice', gridSize: 80, rebuilding: false, ...names,
}).label, 'Ice.svg');
assert.deepEqual(describeShapeImport({
  file: null, kind: 'gltf', svgVariant: 'question', gridSize: 96, rebuilding: true, ...names,
}), {
  builtin: true,
  label: 'Ring.glb',
  status: '正在重新生成：Ring.glb → 96³（可能需要幾秒）',
});
const userFile = { name: 'logo.svg' };
assert.equal(describeShapeImport({
  file: userFile, kind: 'svg', svgVariant: 'ice', gridSize: 64, rebuilding: false, ...names,
}).label, 'logo.svg');

const calls = [];
const helpers = {
  svgToField: async (source, options) => { calls.push(['svg', source, options]); return 'svg-field'; },
  gltfToField: async (source, gridSize) => { calls.push(['gltf', source, gridSize]); return 'gltf-field'; },
  objectToField: async (source, gridSize) => { calls.push(['object', source, gridSize]); return 'object-field'; },
  makeDefaultSvgFile: () => 'default-svg',
  makeMeltDemoSvgFile: () => 'melt-svg',
  buildDefaultSolid: () => 'default-solid',
};

assert.equal(await loadShapeAsset({
  file: null, kind: 'svg', svgVariant: 'question', gridSize: 80, mobile: false, ...helpers,
}), 'svg-field');
assert.deepEqual(calls.pop(), ['svg', 'default-svg', { supersample: 3 }]);
assert.equal(await loadShapeAsset({
  file: null, kind: 'svg', svgVariant: 'ice', gridSize: 80, mobile: true, ...helpers,
}), 'svg-field');
assert.deepEqual(calls.pop(), ['svg', 'melt-svg', { supersample: 2 }]);
assert.equal(await loadShapeAsset({
  file: userFile, kind: 'gltf', svgVariant: 'question', gridSize: 72, mobile: false, ...helpers,
}), 'gltf-field');
assert.deepEqual(calls.pop(), ['gltf', userFile, 72]);
assert.equal(await loadShapeAsset({
  file: null, kind: 'gltf', svgVariant: 'question', gridSize: 64, mobile: false, ...helpers,
}), 'object-field');
assert.deepEqual(calls.pop(), ['object', 'default-solid', 64]);

console.log('Shape import labels and SVG/GLTF routing passed');
