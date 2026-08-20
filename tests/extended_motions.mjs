import assert from 'node:assert/strict';
import {
  MOTIONS, MOTION_PARAMS, MOTION_PARAM_DEFAULTS,
} from '../bubble/motions/registry.js';
import {
  createExtendedMotionRuntime,
} from '../bubble/motions/extended/index.js';
import {
  effectiveCapillaryHeight,
} from '../bubble/motions/extended/capillary.js';

const names = ['capillary'];
const P = { ...MOTION_PARAM_DEFAULTS, spread: 0.75, radius: 0.24 };
const runtime = createExtendedMotionRuntime(P);
const seed = { h1: 0.17, h2: 0.43, h3: 0.79, radius: 1 };
const makeContext = shift => ({
  anchors: [
    { x: -0.8 + shift, y: 0.2, z: 0, radiusHint: 0.2 },
    { x: 0.1 + shift, y: 0.9, z: 0.1, radiusHint: 0.16 },
    { x: 0.9 + shift, y: -0.5, z: -0.1, radiusHint: 0.18 },
  ],
  surfaceAnchors: [
    { x: -0.8 + shift, y: 0.2, z: 0, radiusHint: 0.2 },
    { x: 0.9 + shift, y: -0.5, z: -0.1, radiusHint: 0.18 },
  ],
  center: { x: shift, y: 0.1, z: 0 },
  radius: 1.1,
});
const context = makeContext(0);
for (const key of [
  'capillaryHeight', 'capillaryRings', 'capillarySpeed', 'capillaryField',
  'capillaryTexture', 'capillaryDirectionX', 'capillaryDirectionY',
  'capillaryDirectionZ', 'capillaryWarp', 'capillaryCrestSoftness',
]) {
  assert(Number.isFinite(P[key]), `${key} must have a numeric default`);
}

const paramByKey = Object.fromEntries(MOTION_PARAMS.capillary.map(param => [param.key, param]));
assert.equal(paramByKey.capillaryField.type, 'select');
assert.deepEqual(
  paramByKey.capillaryField.options.map(option => option.label),
  ['同心放射', '定向推進', '螺旋擴散'],
);
assert.equal(paramByKey.capillaryTexture.type, 'select');
assert.deepEqual(
  paramByKey.capillaryTexture.options.map(option => option.label),
  ['Wave', 'Noise', 'Voronoi', 'Gabor', 'Gradient', 'Magic'],
);
assert.equal(paramByKey.capillarySpeed.min, -4);
assert.equal(paramByKey.capillarySpeed.max, 4);
assert.equal(paramByKey.capillarySpeed.step, 1);
assert.equal(MOTIONS.capillary.loopDuration, 4);
assert.equal(paramByKey.capillaryHeight.value, 0.09);
assert.equal(paramByKey.capillaryCrestSoftness.value, 1);
assert.equal(paramByKey.capillaryRings.value, 3);
assert.equal(paramByKey.capillaryField.value, 1);
assert.equal(paramByKey.capillaryDirectionX.value, 0.4);
assert.equal(paramByKey.capillaryDirectionY.value, 0.5);
assert.equal(paramByKey.capillaryDirectionZ.value, 0);
assert.deepEqual(MOTIONS.capillary.overrides, {
  shapeEdgeBevel: 0.051,
  materialStyle: 'universal',
  rayBeamIntensity: 13.5,
  rayBeamSeparation: 0.065,
  rayBeamChroma: 1.3,
  rayBeamZoom: 5,
  spectralCausticEnabled: false,
  cameraDistance: 3.7,
  cameraRotationX: 9.4,
  cameraRotationY: 27.9,
});
assert.equal(MOTIONS.jelly.radius, 0.24);
assert.deepEqual(MOTIONS.jelly.overrides, {
  shapeDepth: 0.14,
  shapeEdgeBevel: 0.051,
  materialStyle: 'universal',
  rayBeamIntensity: 13.5,
  rayBeamSeparation: 0.065,
  rayBeamChroma: 1.3,
  rayBeamZoom: 5,
  spectralCausticEnabled: false,
  cameraDistance: 3.7,
  cameraRotationX: 9.4,
  cameraRotationY: 27.9,
});
assert.equal(effectiveCapillaryHeight(0.8, 8).toFixed(3), '0.298');
assert.equal(effectiveCapillaryHeight(0.28, 4), 0.28);

for (const name of names) {
  assert(MOTIONS[name], `${name} must be registered`);
  assert(MOTIONS[name].usesShapeField, `${name} must load and display imported SVG/GLB shape fields`);
  assert.equal(MOTIONS[name].count, 0, `${name} must not render surrounding droplets`);
  for (let i = 0; i < MOTIONS[name].count; i++) {
    for (const phase of [0, 0.125, 0.25, 0.5, 0.75, 0.999999, 1]) {
      const state = runtime.sample(name, i, phase, MOTIONS[name].count, seed, context, {});
      assert(state, `${name} must return a state`);
      assert([state.x, state.y, state.z, state.radiusFactor].every(Number.isFinite),
        `${name} returned a non-finite state at phase ${phase}`);
      assert(state.radiusFactor >= 0, `${name} returned a negative radius`);
    }
    const start = runtime.sample(name, i, 0, MOTIONS[name].count, seed, context, {});
    const end = runtime.sample(name, i, 1, MOTIONS[name].count, seed, context, {});
    const seam = Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z)
      + Math.abs(start.radiusFactor - end.radiusFactor);
    assert(seam < 1e-8, `${name} loop seam is ${seam}`);
  }
  const original = runtime.sample(name, 1, 0.4, MOTIONS[name].count, seed, context, {});
  const shifted = runtime.sample(name, 1, 0.4, MOTIONS[name].count, seed, makeContext(2), {});
  assert(Math.hypot(original.x - shifted.x, original.y - shifted.y, original.z - shifted.z) > 0.5,
    `${name} must derive its choreography from the imported shape context`);
}

console.log(`extended motions: ${names.length} mode${names.length === 1 ? '' : 's'} passed`);
