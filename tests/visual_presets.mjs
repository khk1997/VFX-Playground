import assert from 'node:assert/strict';
import { EDGE_TINT_TARGETS, edgeTintKeys, sanitizeEdgeTintValue } from '../bubble/edge-tint.js';
import { INSTALLING_VISUAL_PRESETS, installingVisualPresetValues } from '../bubble/visual-presets.js';
import { EDGE_TINT_BASE_BY_BACKDROP } from '../bubble/runtime-defaults.js';

assert.equal(INSTALLING_VISUAL_PRESETS.length, 3);
assert.equal(new Set(INSTALLING_VISUAL_PRESETS.map(item => item.id)).size, 3);

for (const preset of INSTALLING_VISUAL_PRESETS) {
  const dark = installingVisualPresetValues(preset.id, 'dark');
  const light = installingVisualPresetValues(preset.id, 'light');
  assert.notDeepEqual(dark, light, `${preset.id} must be tuned separately for each backdrop`);
  for (const prefix of EDGE_TINT_TARGETS) {
    assert.equal(dark[`${prefix}MultiTint`], true);
    assert.equal(light[`${prefix}MultiTint`], true);
    // 基底色不歸風格管：不分風格，它就是當下的底色本身。風格決定的是邊緣那幾個
    // 色標與混色方式；中央那塊跟背景同色，換風格才不會在物體中間多出一塊異色。
    assert.equal(dark[`${prefix}TintColor`], EDGE_TINT_BASE_BY_BACKDROP.dark,
      `${preset.id}/dark must keep the backdrop colour as its base tint`);
    assert.equal(light[`${prefix}TintColor`], EDGE_TINT_BASE_BY_BACKDROP.light,
      `${preset.id}/light must keep the backdrop colour as its base tint`);
    for (const key of edgeTintKeys(prefix)) {
      assert.ok(key in dark, `${preset.id}/dark is missing ${key}`);
      assert.ok(key in light, `${preset.id}/light is missing ${key}`);
      assert.notEqual(sanitizeEdgeTintValue(key, dark[key]), undefined, `${preset.id}/dark has invalid ${key}`);
      assert.notEqual(sanitizeEdgeTintValue(key, light[key]), undefined, `${preset.id}/light has invalid ${key}`);
    }
  }
}

const first = installingVisualPresetValues('prism', 'light');
first.researchShellTint = 0;
assert.notEqual(installingVisualPresetValues('prism', 'light').researchShellTint, 0, 'preset results must not share mutable state');
assert.throws(() => installingVisualPresetValues('missing', 'dark'));

console.log('Installing visual presets are complete, independent, and valid');
