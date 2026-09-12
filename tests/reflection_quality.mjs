import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shader = readFileSync(new URL('../bubble/shaders.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../bubble/bubble.js', import.meta.url), 'utf8');

assert.match(shader, /#ifndef MAX_REFLECTION_SAMPLES\s+#define MAX_REFLECTION_SAMPLES 8/);
assert.match(shader, /#if MAX_REFLECTION_SAMPLES > 4/);
assert.match(runtime, /MAX_REFLECTION_SAMPLES: mobileRenderQuery\.matches \? 4 : 8/);
assert.match(runtime, /uReflectionSampleCount\.value = quality\.reflectionSamples/);

console.log('reflection sample compile bound and adaptive runtime profile passed');
