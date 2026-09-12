import assert from 'node:assert/strict';
import {
  createMaterialTextureController, hexToRgb, sampleLoopingStops,
} from '../bubble/material-textures.js';

assert.deepEqual(hexToRgb('#12abef'), [18, 171, 239]);
const stops = [
  { p: 0.25, rgb: [255, 0, 0] },
  { p: 0.75, rgb: [0, 0, 255] },
];
assert.deepEqual(sampleLoopingStops(stops, 0.5), [127.5, 0, 127.5]);
assert.deepEqual(sampleLoopingStops(stops, 0), [127.5, 0, 127.5], 'ramp seam must wrap');
assert.deepEqual(sampleLoopingStops([{ p: 0, rgb: [1, 2, 3] }], 0.8), [1, 2, 3]);

class DataTexture {
  constructor(data, width, height) {
    this.image = { data, width, height };
    this.needsUpdate = false;
  }
}
const THREE = {
  DataTexture,
  RGBAFormat: 'rgba',
  SRGBColorSpace: 'srgb',
  LinearSRGBColorSpace: 'linear',
  NoColorSpace: 'none',
  RepeatWrapping: 'repeat',
  ClampToEdgeWrapping: 'clamp',
  LinearFilter: 'linear',
};
const elements = new Map([
  ['rampCount', { value: '2' }],
  ['stopPos0', { value: '0' }],
  ['stopCol0', { value: '#ff0000' }],
  ['stopPos1', { value: '0.5' }],
  ['stopCol1', { value: '#0000ff' }],
]);
const documentRef = { getElementById: id => elements.get(id) || null };
const params = {
  backdrop: 'light',
  lightBgGradientTop: '#ffffff',
  lightBgGradientBottom: '#ddeeff',
  spectralCausticBlend: 0,
};
let appliedBackground = null;
const controller = createMaterialTextureController({
  THREE,
  params,
  spectralCausticDefaults: ['#ff0000', '#00ff00', '#0000ff'],
  getUniforms: () => ({
    uBgColor: { value: { setStyle: (...args) => { appliedBackground = args; } } },
  }),
  documentRef,
});

const ramp = controller.makeRampTexture();
assert.equal(ramp.image.data.length, 256 * 4);
assert.deepEqual([...ramp.image.data.slice(0, 4)], [255, 0, 0, 255]);
assert.equal(ramp.needsUpdate, true);
assert.equal(controller.pageBackgroundCss('#000000'), 'linear-gradient(to bottom, #ffffff, #ddeeff)');
controller.setBgColorUniform('#abcdef');
assert.deepEqual(appliedBackground, ['#abcdef', 'linear']);

const spectral = controller.makeSpectralCausticTexture();
assert.deepEqual([...spectral.image.data.slice(0, 4)], [255, 0, 0, 255]);
assert.deepEqual([...spectral.image.data.slice(-4)], [0, 0, 255, 255]);
assert.equal(spectral.needsUpdate, true);

console.log('Material color parsing, cyclic ramps, textures, and backdrop CSS passed');
