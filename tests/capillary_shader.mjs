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
assert.match(FRAG, /capillarySurfaceOffset\(shapePA\)/,
  'wave mapping must use shape A object-space coordinates');
assert.doesNotMatch(FRAG, /capillarySurfaceOffset\(shapeP\)/,
  'object scaling must not change the number of waves across the shape');

console.log('capillary shader safeguards passed');
