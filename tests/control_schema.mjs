import assert from 'node:assert/strict';
import {
  COLORS,
  SELECTS,
  createFormatters,
  createToggleBindings,
} from '../bubble/control-schema.js';
import { EDGE_TINT_TARGETS, EDGE_TINT_STOPS } from '../bubble/edge-tint.js';
import { MOTION_UNIFORM_MAP } from '../bubble/motions/registry.js';

assert.deepEqual(SELECTS.motion.map, MOTION_UNIFORM_MAP);
assert.equal(SELECTS.backdrop.map.dark, 0);
assert.equal(SELECTS.backdrop.map.light, 0);
assert.equal(SELECTS.shapeQuality.map.high, 128);
assert.equal(SELECTS.antialiasLevel.map.medium, 1);
for (const prefix of EDGE_TINT_TARGETS) {
  for (let index = 0; index < EDGE_TINT_STOPS.length; index++) {
    assert.ok(`${prefix}TintStopColor${index}` in COLORS);
  }
}

let edgeDropsApplied = 0;
const toggles = createToggleBindings(() => { edgeDropsApplied++; });
toggles.edgeDropsEnabled();
assert.equal(edgeDropsApplied, 1);
assert.equal(toggles.dispersionEnabled, 'uDispersionEnabled');
assert.equal(toggles.researchBubbles, 'uResearchBubbles');
assert.equal(typeof toggles.bloomEnabled, 'function');
for (const prefix of EDGE_TINT_TARGETS) {
  assert.equal(toggles[`${prefix}MultiTint`],
    `u${prefix[0].toUpperCase()}${prefix.slice(1)}MultiTint`);
}

const params = { capillaryRings: 3, loopDuration: 12 };
const formatters = createFormatters(params, {
  effectiveCapillaryHeight: value => value * 0.5,
  shatterSegmentSeconds: segment => `${segment}:ok`,
});
assert.equal(formatters.capillaryHeight(0.2), '0.20→0.10');
assert.equal(formatters.gatherDuration(0.25), '3.0s');
assert.equal(formatters.researchIconPhaseOffset(-0.1), '提前 1.20s');
assert.equal(formatters.shatterRest(), 'rest:ok');
params.loopDuration = 8;
assert.equal(formatters.shapeHold(0.5), '4.0s', 'formatters should read live parameters');

console.log('Control mappings, toggle bindings, and live value formatters passed');
