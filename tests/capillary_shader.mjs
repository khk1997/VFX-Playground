import assert from 'node:assert/strict';
import { FRAG } from '../bubble/shaders.js';

assert.match(FRAG, /uniform vec3\s+uCapillaryDirection;/,
  'capillary waves must accept a three-axis direction');
assert.match(FRAG, /float capillarySurfaceOffset\(vec3 p\)/,
  'capillary waves must offset the sampled surface distance');
assert.doesNotMatch(FRAG, /q\.xy\s*-=\s*displaceDirection/,
  'capillary waves must not fold the shape sampling coordinates toward the spiral core');
assert.match(FRAG, /smoothstep\([^;]+radius\)/,
  'the spiral angular term must fade smoothly near its singular core');
assert.match(FRAG, /slopeSafeAmplitude/,
  'high-density waves must cap their maximum surface slope');
assert.match(FRAG, /basePreservingCrest\s*=\s*smoothstep\(0\.0, 1\.0, crestInput\)/,
  'capillary motion must preserve the original surface and add outward crests only');
assert.doesNotMatch(FRAG, /contractionGuard/,
  'negative wave valleys must never erode SVG or GLB boundaries');
assert.match(FRAG, /crestSoftness/,
  'the hard crest threshold must expose an adjustable transition width');
assert.doesNotMatch(FRAG, /atan\(textureP\.y, textureP\.x\)/,
  'spiral coordinates must not contain an atan branch-cut seam');
assert.match(FRAG, /vec2 spiralP/,
  'spiral motion must use continuous swirl coordinates');
assert.match(FRAG, /movingA\s*=\s*phase \* TAU \* uExtendedParams\.z/,
  'speed zero and negative values must reach the shader unchanged');
assert.match(FRAG, /textureGain/,
  'procedural textures must normalize their visual amplitude');
assert.match(FRAG, /capillaryValueNoiseFieldLoop/,
  'noise must translate periodically along every selected wave field');
assert.match(FRAG, /capillaryCellularFieldLoop/,
  'Voronoi must translate periodically along every selected wave field');
assert.match(FRAG, /fieldTravel\s*=\s*phase \* uExtendedParams\.z \* fieldPeriod/,
  'procedural textures must travel by whole repeat periods for seamless looping');
assert.match(FRAG, /float along = dot\(p, direction\);/,
  'directional warp must retain the coordinate along the requested XYZ direction');
assert.match(FRAG, /float across = dot\(p, acrossAxis\);/,
  'directional warp must retain its first transverse coordinate');
assert.match(FRAG, /float depth = dot\(p, secondAxis\);/,
  'directional warp must retain its second transverse coordinate for 3D GLB surfaces');
assert.match(FRAG, /float field = directionalField \? along \+ directionalWarp : radius;/,
  'Wave must apply 3D transverse distortion to its forward phase coordinate');
assert.match(FRAG, /float travelPhase = movingA - field \* density \* TAU;/,
  'all analytic textures must derive motion from one wave-field phase');
assert.match(FRAG, /float ramp = fract\(field \* density - movingA \/ TAU\);/,
  'Gradient must follow radial and spiral fields instead of a Cartesian texture axis');
assert.doesNotMatch(FRAG, /\+ movingA\) \* 0\.28/,
  'Gabor must not contain a secondary wave travelling in the opposite direction');
assert.doesNotMatch(FRAG, /patternP \* density \* 1\.(?:15|35) \+ vec2\(cos\(movingA\)/,
  'Noise and Voronoi must not orbit in radial or spiral modes');
assert.match(FRAG, /capillarySurfaceOffset\(shapePA\)/,
  'wave mapping must use shape A object-space coordinates');
assert.doesNotMatch(FRAG, /capillarySurfaceOffset\(shapeP\)/,
  'object scaling must not change the number of waves across the shape');

console.log('capillary shader safeguards passed');
