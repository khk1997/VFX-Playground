import assert from 'node:assert/strict';
import { EDGE_TINT_TARGETS, edgeTintKeys } from '../bubble/edge-tint.js';
import { MOTION_KEYS } from '../bubble/motions/registry.js';
import {
  BACKDROP_SCOPED_KEYS,
  MOTION_SCOPED_KEYS,
  createMemorySlot,
  createMotionMemory,
  motionDefaultsFor,
} from '../bubble/runtime-memory.js';

assert.equal(new Set(MOTION_SCOPED_KEYS).size, MOTION_SCOPED_KEYS.length,
  'motion-scoped parameter keys must be unique');
for (const prefix of EDGE_TINT_TARGETS) {
  for (const key of edgeTintKeys(prefix)) {
    assert.ok(BACKDROP_SCOPED_KEYS.has(key), `${key} should be backdrop scoped`);
  }
}

const params = { motion: 'static', backdrop: 'dark' };
const slotFor = createMemorySlot(params);
assert.equal(slotFor('count'), 'static|dark');
assert.equal(slotFor('shapeDepth'), 'static');
params.motion = 'research';
params.backdrop = 'light';
assert.equal(slotFor('count'), 'research|light');
assert.equal(slotFor('shapeDepth'), 'research');

const countDefaults = motionDefaultsFor('count');
assert.equal(Object.keys(countDefaults).length, MOTION_KEYS.length * 2);
assert.ok(MOTION_KEYS.every(motion => Number.isFinite(countDefaults[`${motion}|dark`])));
const shapeDepthDefaults = motionDefaultsFor('shapeDepth');
assert.equal(Object.keys(shapeDepthDefaults).length, MOTION_KEYS.length);

const memory = createMotionMemory();
assert.deepEqual(Object.keys(memory).sort(), [
  'count', 'radius', 'loopDuration', 'dollyEnabled', ...MOTION_SCOPED_KEYS,
].sort());
for (const motion of MOTION_KEYS) {
  assert.equal(memory.spectralCausticFocus[`${motion}|dark`], 1);
  assert.equal(memory.spectralCausticSeparation[`${motion}|dark`], 1);
  assert.equal(memory.transmission[`${motion}|light`], 0.97);
  assert.equal(memory.rayDispersionEnabled[`${motion}|light`], false);
  assert.equal(memory.bloomEnabled[`${motion}|light`], false);
  for (const prefix of EDGE_TINT_TARGETS) {
    assert.equal(memory[`${prefix}Tint`][`${motion}|dark`], 0);
    assert.ok(memory[`${prefix}Tint`][`${motion}|light`] >= 0);
  }
}

console.log('Motion and backdrop memory slots, defaults, and tint isolation passed');
