import assert from 'node:assert/strict';
import { createMaterialTextureController, hexToRgb } from '../bubble/material-textures.js';

assert.deepEqual(hexToRgb('#12abef'), [18, 171, 239]);

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
const elements = new Map();
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

assert.equal(controller.pageBackgroundCss('#000000'), 'linear-gradient(to bottom, #ffffff, #ddeeff)');
controller.setBgColorUniform('#abcdef');
assert.deepEqual(appliedBackground, ['#abcdef', 'linear']);

const spectral = controller.makeSpectralCausticTexture();
assert.deepEqual([...spectral.image.data.slice(0, 4)], [255, 0, 0, 255]);
assert.deepEqual([...spectral.image.data.slice(-4)], [0, 0, 255, 255]);
assert.equal(spectral.needsUpdate, true);

console.log('Material color parsing, textures, and backdrop CSS passed');
