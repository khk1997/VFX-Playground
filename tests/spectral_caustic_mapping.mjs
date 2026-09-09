import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shader = readFileSync(new URL('../bubble/shaders.js', import.meta.url), 'utf8');

assert.match(
  shader,
  /float objectNoiseScale\s*=\s*mix\([^;]*uSpectralCausticDensity[^;]*\);/s,
  'Object Noise mapping density must control its coordinate scale',
);
assert.match(
  shader,
  /float noiseBandWidth\s*=\s*mix\([^;]*sizeFactor[^;]*\);/s,
  'Object Noise band size must control the ridge width',
);
assert.match(
  shader,
  /separateSpectrum\(\s*visibleSpectrum\(spectrumCoordinate\),\s*uDispersionSeparation\s*\)/s,
  'Art dispersion must use its own spectrum separation',
);
assert.match(
  shader,
  /separateSpectrum\(\s*texture2D\(uSpectralCausticRamp,[\s\S]*?\.rgb,\s*uSpectralCausticSeparation\s*\)/s,
  'Spectral caustics must use their own spectrum separation',
);

console.log('spectral caustic mapping controls are connected');
