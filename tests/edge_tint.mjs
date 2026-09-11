import assert from 'node:assert/strict';
import { edgeTintParams, readEdgeTintStops, sampleEdgeTint } from '../bubble/edge-tint.js';

const params = Object.fromEntries(['researchShell', 'researchIcon'].flatMap(prefix =>
  edgeTintParams(prefix).map(param => [param.key, param.value])));
const iconBefore = readEdgeTintStops(params, 'researchIcon');
params.researchShellTintStopColor0 = '#ff3300';
params.researchShellTintStopPos0 = 0.89;
assert.deepEqual(readEdgeTintStops(params, 'researchIcon'), iconBefore,
  'Editing shell stops must leave the icon palette unchanged');
const shell = readEdgeTintStops(params, 'researchShell');
assert.ok(shell.every((stop, i) => !i || stop.p > shell[i - 1].p));
for (const stop of shell) {
  const actual = sampleEdgeTint(shell, stop.p);
  actual.forEach((v, i) => assert.ok(Math.abs(v - stop.rgb[i]) < 1e-9));
}
for (const phase of [-2, -0.01, 0, 0.27, 0.999, 1, 2.27]) {
  const a = sampleEdgeTint(shell, phase), b = sampleEdgeTint(shell, phase + 1);
  a.forEach((v, i) => {
    assert.ok(v >= 0 && v <= 255);
    assert.ok(Math.abs(v - b[i]) < 1e-9, 'Palette must wrap without a seam');
  });
}
for (let i = 0; i < 6; i++) params[`researchShellTintStopPos${i}`] = 0.5;
const collapsed = readEdgeTintStops(params, 'researchShell');
assert.equal(collapsed.length, 1);
for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
  assert.deepEqual(sampleEdgeTint(collapsed, phase), collapsed[0].rgb,
    'Coincident stops must produce a stable single color');
}
assert.equal(params.researchShellMultiTint, false, 'Old presets retain single-color appearance');
console.log('edge tint palette independence, wrapping and coincident stops passed');
