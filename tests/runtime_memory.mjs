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
import { EDGE_TINT_BASE_BY_BACKDROP } from '../bubble/runtime-defaults.js';

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
  // 吸收色是液體本身的顏色。深底維持它原本手調的水藍色（見 runtime-memory
  // 的說明：那個值就是改動前寫死的吸收係數，預設外觀不變），但淺底沒有這層
  // 歷史包袱，預設就該跟淺底背景同色——不然一開箱就是一顆藍色的球浮在白色
  // 背景上。兩個底色各自記一格，調淺底不會污染已經定案的深底外觀。
  assert.equal(memory.absorbColor[`${motion}|dark`], '#68b2e7');
  assert.equal(memory.absorbColor[`${motion}|light`], EDGE_TINT_BASE_BY_BACKDROP.light);
}

console.log('Motion and backdrop memory slots, defaults, and tint isolation passed');
