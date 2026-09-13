import assert from 'node:assert/strict';
import {
  createEnvironmentLoader, selectMaterialEnvironment,
} from '../bubble/environment-loader.js';

const defaults = {
  universal: { url: 'universal' },
  crystal: { url: 'crystal' },
};
const motionEnvironment = motion => (motion === 'installing' ? { url: 'motion' } : null);
assert.equal(selectMaterialEnvironment({
  style: 'crystal', motion: 'installing', materialEnvironments: {}, defaults, motionEnvironment,
}).url, 'motion');
assert.equal(selectMaterialEnvironment({
  style: 'crystal', motion: 'static', materialEnvironments: {}, defaults, motionEnvironment,
}).url, 'crystal');
assert.equal(selectMaterialEnvironment({
  style: 'unknown', motion: 'static', materialEnvironments: {}, defaults, motionEnvironment,
}).url, 'universal');
assert.equal(selectMaterialEnvironment({
  style: 'crystal', motion: 'installing',
  materialEnvironments: { crystal: { url: 'stored' } }, defaults, motionEnvironment,
}).url, 'motion');
const userEnvironment = { url: '', file: { name: 'custom.hdr' } };
assert.equal(selectMaterialEnvironment({
  style: 'crystal', motion: 'installing',
  materialEnvironments: { crystal: userEnvironment }, defaults, motionEnvironment,
}), userEnvironment);

const loadedTexture = {
  disposed: false,
  dispose() { this.disposed = true; },
};
class TextureLoader {
  load(url, complete) {
    assert.equal(url, 'studio.jpg');
    complete(loadedTexture);
  }
}
const THREE = {
  TextureLoader,
  EquirectangularReflectionMapping: 'equirectangular',
  RepeatWrapping: 'repeat',
  ClampToEdgeWrapping: 'clamp',
  LinearFilter: 'linear',
  SRGBColorSpace: 'srgb',
};
const oldEnvironment = {
  disposed: false,
  dispose() { this.disposed = true; },
};
const oldPmremTarget = {
  disposed: false,
  dispose() { this.disposed = true; },
};
const nextPmremTarget = { texture: { name: 'pmrem' } };
const uniforms = {
  uEnvMap: { value: oldEnvironment },
  uPmremMap: { value: null },
  uHasEnv: { value: 0 },
};
const variantMaterial = { envMap: null, needsUpdate: false };
const stateElement = { textContent: '' };
const settled = [];
let currentPmremTarget = oldPmremTarget;
let variantChanges = 0;
const { loadEnvironment } = createEnvironmentLoader({
  THREE,
  getPmremGenerator: () => ({
    fromEquirectangular(texture) {
      assert.equal(texture, loadedTexture);
      return nextPmremTarget;
    },
  }),
  getUniforms: () => uniforms,
  getPmremTarget: () => currentPmremTarget,
  setPmremTarget: target => { currentPmremTarget = target; },
  getVariantMaterials: () => [variantMaterial],
  onVariantChange: () => { variantChanges += 1; },
  onSettled: message => settled.push(message),
  stateElement,
});

loadEnvironment('studio.jpg', 'Studio', false);
assert.equal(loadedTexture.mapping, 'equirectangular');
assert.equal(loadedTexture.wrapS, 'repeat');
assert.equal(loadedTexture.wrapT, 'clamp');
assert.equal(loadedTexture.colorSpace, 'srgb');
assert.equal(uniforms.uEnvMap.value, loadedTexture);
assert.equal(uniforms.uPmremMap.value, nextPmremTarget.texture);
assert.equal(uniforms.uHasEnv.value, 1);
assert.equal(currentPmremTarget, nextPmremTarget);
assert.equal(variantMaterial.envMap, nextPmremTarget.texture);
assert.equal(variantMaterial.needsUpdate, true);
assert.equal(oldEnvironment.disposed, true);
assert.equal(oldPmremTarget.disposed, true);
assert.equal(variantChanges, 1);
assert.equal(stateElement.textContent, 'HDRI 已載入：Studio');
assert.deepEqual(settled, ['HDRI 載入完成']);

console.log('Material environment selection and texture application passed');
