import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VERT, FRAG, FRAG_BASELINE } from '../bubble/shaders.js';
import { ENVIRONMENT_GLSL } from '../bubble/shader-chunks/environment.js';
import { GEOMETRY_GLSL } from '../bubble/shader-chunks/geometry.js';
import { OPTICS_GLSL } from '../bubble/shader-chunks/optics.js';

const chunks = [ENVIRONMENT_GLSL, GEOMETRY_GLSL, OPTICS_GLSL];
const positions = chunks.map(chunk => FRAG.indexOf(chunk));

for (const [index, chunk] of chunks.entries()) {
  assert.ok(chunk.length > 0, `shader chunk ${index} must not be empty`);
  assert.ok(positions[index] >= 0, `shader chunk ${index} must be assembled into FRAG`);
  assert.equal(FRAG.indexOf(chunk, positions[index] + 1), -1, `shader chunk ${index} must appear exactly once`);
}
assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'shader chunks must keep dependency order');
assert.ok(FRAG.indexOf('void main(){') > positions[2], 'fragment main must follow shared chunks');
assert.ok(VERT.includes('void main(){'), 'vertex shader must remain available');
assert.ok(FRAG_BASELINE.includes('void main(){'), 'baseline fragment shader must remain available');
assert.ok(!FRAG.includes('${ENVIRONMENT_GLSL}'), 'assembled shader must not contain interpolation placeholders');

const sourcePath = fileURLToPath(new URL('../bubble/shaders.js', import.meta.url));
const source = await readFile(sourcePath, 'utf8');
assert.ok(source.split('\n').length < 2500, 'shader entry module should stay below 2,500 lines');
assert.ok(ENVIRONMENT_GLSL.split('\n').length > 80, 'environment module boundary is unexpectedly small');
assert.ok(GEOMETRY_GLSL.split('\n').length > 1000, 'geometry module boundary is unexpectedly small');
assert.ok(OPTICS_GLSL.split('\n').length > 400, 'optics module boundary is unexpectedly small');

console.log('Shader chunks assemble once, in order, with all shader entry points intact');
