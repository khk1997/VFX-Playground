import assert from 'node:assert/strict';
import { createAdaptiveQuality } from '../bubble/adaptive-quality.js';

let clock = 0;
const changes = [];
const quality = createAdaptiveQuality({
  mobile: false,
  preview: false,
  maxDpr: 2,
  minDpr: 1.25,
  now: () => clock,
  onChange: state => changes.push(state),
});

function feedWindow(fps) {
  const frameMs = 1000 / fps;
  const end = clock + 2100;
  while (clock < end) {
    clock += frameMs;
    quality.sample(clock);
  }
}

assert.deepEqual(quality.snapshot(), {
  tier: 'high', tierIndex: 0, lastFps: null,
  dpr: 2, maxDpr: 2, minDpr: 1.25, steps: 88, reflectionSamples: 8,
});
feedWindow(30);
assert.equal(quality.snapshot().tier, 'high', 'one slow window must not lower quality');
feedWindow(30);
assert.equal(quality.snapshot().tier, 'balanced');
assert.equal(quality.snapshot().steps, 72);
assert.equal(quality.snapshot().dpr, 1.6);
assert.equal(quality.snapshot().reflectionSamples, 4);

clock += 8000;
quality.sample(clock);
assert.equal(quality.snapshot().tier, 'balanced', 'stale timing gaps must be ignored');
quality.resetSamples(clock);
feedWindow(60);
feedWindow(60);
feedWindow(60);
assert.equal(quality.snapshot().tier, 'high');

quality.setTier(2);
quality.updateLimits(1.5, 1.1);
assert.equal(quality.snapshot().dpr, 1.1);
assert.equal(quality.snapshot().steps, 60);
assert.equal(quality.snapshot().reflectionSamples, 4);

const mobileQuality = createAdaptiveQuality({
  mobile: true,
  preview: false,
  maxDpr: 1.5,
  minDpr: 1.25,
});
assert.equal(mobileQuality.snapshot().reflectionSamples, 4);
mobileQuality.setTier(2);
assert.equal(mobileQuality.snapshot().reflectionSamples, 4);
assert.ok(changes.length >= 3);
console.log('adaptive quality hysteresis, stale samples and DPR limits passed');
