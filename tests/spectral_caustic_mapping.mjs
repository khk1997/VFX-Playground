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
  /vec3 causticRampColor =\s*texture2D\(uSpectralCausticRamp,[\s\S]*?separateSpectrum\(\s*causticRampColor,\s*uSpectralCausticSeparation\s*\)/s,
  'Spectral caustics must use their own spectrum separation',
);

// 薄膜噪聲 mapping 的不變式：色帶只能在「固定座標」取樣。只要查表座標帶了任何
// 隨像素變動的量，色帶上的窄特徵就會沿著噪聲等值線被拉成細線 —— 那正是這個
// mapping 要避開的東西。
const filmNoiseBranch = shader.slice(
  shader.indexOf('float filmSpread'),
  shader.indexOf('vec3 causticSpectrum'),
);
assert.notEqual(filmNoiseBranch.length, 0, 'Film Noise branch must exist');
const filmRampLookups = filmNoiseBranch.match(
  /texture2D\(\s*uSpectralCausticRamp, vec2\(([^,]+),/g,
) || [];
assert.equal(filmRampLookups.length, 4, 'Film Noise must take four ramp taps');
for (const lookup of filmRampLookups) {
  assert.match(
    lookup,
    /vec2\(\s*0\.5 [-+] filmSpread/,
    `Film Noise ramp tap must stay at a fixed coordinate: ${lookup}`,
  );
}
assert.match(
  filmNoiseBranch,
  /causticRampColor = mix\(\s*mix\(filmStopA, filmStopB, filmWeight\.x\)/,
  'Film Noise must blend the fixed taps with noise weights',
);
assert.match(
  readFileSync(new URL('../bubble/bubble.js', import.meta.url), 'utf8'),
  /map: \{ wave: 0, objectNoise: 1, hybrid: 2, filmNoise: 3 \}/,
  'Film Noise must be wired to uSpectralCausticMapping == 3',
);

console.log('spectral caustic mapping controls are connected');
