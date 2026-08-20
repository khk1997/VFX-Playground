import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAG } from '../bubble/shaders.js';

const html = readFileSync(new URL('../bubble/index.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../bubble/bubble.js', import.meta.url), 'utf8');

for (const pattern of ['grid', 'starburst', 'ring', 'softbox', 'window']) {
  assert.match(html, new RegExp(`option value="${pattern}"`), `${pattern} must remain available`);
}

assert.doesNotMatch(html, /threePoint|三點棚燈|rayBeamLightSize|rayBeam(?:Red|Green|Blue)Gain/,
  'three-point-only controls must be removed from the panel');
assert.doesNotMatch(controller, /threePoint|rayBeamLightSize|rayBeam(?:Red|Green|Blue)Gain/,
  'three-point-only state must be removed from the controller');
assert.doesNotMatch(FRAG, /uRayBeamPattern == 5|prismLamp|uRayBeamLightSize|uRayBeam(?:Red|Green|Blue)Gain/,
  'three-point-only shader code must be removed');

console.log('five ray beam patterns retained; three-point lighting removed');
