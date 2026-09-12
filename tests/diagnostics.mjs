import assert from 'node:assert/strict';
import { parseBubbleRuntimeOptions } from '../bubble/diagnostics.js';

const defaults = parseBubbleRuntimeOptions('');
assert.equal(defaults.preview, false);
assert.equal(defaults.shaderRun, null);
assert.equal(defaults.diagTiming, false);
assert.equal(defaults.diagTime, null);
assert.equal(defaults.diagCapture, null);
assert.deepEqual(defaults.forceFeatures, []);
assert.equal(defaults.diagnostics.any, false);
assert.deepEqual(defaults.diagnostics.list, []);
assert.equal(defaults.diagnostics.probeMarchBound, 0);

const configured = parseBubbleRuntimeOptions(
  '?preview=1&shaderRun=2.6&diagTiming=1&diagTime=4.2&diagCapture=frame-a'
  + '&forceFeatures=FEATURE_A,%20FEATURE_B&diag=lowres,%20probe-noise-mapscene-120,nodispersion',
);
assert.equal(configured.preview, true);
assert.equal(configured.shaderRun, 3);
assert.equal(configured.diagTiming, true);
assert.equal(configured.diagTime, 4.2);
assert.equal(configured.diagCapture, 'frame-a');
assert.deepEqual(configured.forceFeatures, ['FEATURE_A', 'FEATURE_B']);
assert.deepEqual(configured.diagnostics.list, ['lowres', 'probe-noise-mapscene-120', 'nodispersion']);
assert.equal(configured.diagnostics.lowres, true);
assert.equal(configured.diagnostics.nodispersion, true);
assert.equal(configured.diagnostics.probeMarchBound, 88);

const invalid = parseBubbleRuntimeOptions('?shaderRun=nope&diagTime=nope&diag=probe-noise-mapscene-0');
assert.equal(invalid.shaderRun, null);
assert.equal(invalid.diagTime, null);
assert.equal(invalid.diagnostics.probeMarchBound, 1);

console.log('Bubble URL and diagnostic options parse independently from the runtime');
