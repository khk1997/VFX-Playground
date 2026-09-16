import assert from 'node:assert/strict';
import {
  COLOR_DEFAULTS,
  DEFAULTS,
  LEGACY_SELECT_VALUES,
  SELECT_DEFAULTS,
  SPECTRAL_CAUSTIC_DEFAULTS,
  TOGGLE_DEFAULTS,
  isFormationMotion,
} from '../bubble/runtime-defaults.js';
import {
  MOTION_COLOR_DEFAULTS,
  MOTION_PARAM_DEFAULTS,
  MOTION_TOGGLE_DEFAULTS,
} from '../bubble/motions/registry.js';

assert.ok(Object.keys(DEFAULTS).length > 100);
assert.ok(Object.values(DEFAULTS).every(Number.isFinite));
for (const [key, value] of Object.entries(MOTION_PARAM_DEFAULTS)) {
  assert.equal(DEFAULTS[key], value, `motion number default ${key}`);
}
for (const [key, value] of Object.entries(MOTION_TOGGLE_DEFAULTS)) {
  assert.equal(TOGGLE_DEFAULTS[key], value, `motion toggle default ${key}`);
}
for (const [key, value] of Object.entries(MOTION_COLOR_DEFAULTS)) {
  assert.equal(COLOR_DEFAULTS[key], value, `motion color default ${key}`);
}
assert.ok(Object.values(TOGGLE_DEFAULTS).every(value => typeof value === 'boolean'));
assert.ok(Object.values(COLOR_DEFAULTS).every(value => /^#[0-9a-f]{6}$/i.test(value)));
assert.equal(SPECTRAL_CAUSTIC_DEFAULTS.length, 7);
assert.equal(SELECT_DEFAULTS.motion, 'static');
assert.equal(SELECT_DEFAULTS.backdrop, 'dark');
// 分裂已移除：舊值與舊鍵名都導向行為最接近的現存模式，舊參數檔才打得開。
assert.equal(LEGACY_SELECT_VALUES.motion.split, 'research');
assert.equal(LEGACY_SELECT_VALUES.motion.cinematic, 'research');
assert.equal(LEGACY_SELECT_VALUES.motion.pulse, 'formation');
assert.equal(isFormationMotion('formation'), true);
assert.equal(isFormationMotion('morph'), false);

console.log('Runtime numeric, toggle, color, select, and legacy defaults passed');
