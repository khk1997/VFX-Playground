import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAG } from '../bubble/shaders.js';

const runtime = readFileSync(new URL('../bubble/bubble.js', import.meta.url), 'utf8');
const variants = readFileSync(new URL('../bubble/shader-variants.js', import.meta.url), 'utf8');

assert.match(FRAG, /#ifndef MAX_REFLECTION_SAMPLES\s+#define MAX_REFLECTION_SAMPLES 8/);
assert.match(FRAG, /#if MAX_REFLECTION_SAMPLES > 4/);
assert.match(variants, /MAX_REFLECTION_SAMPLES: isMobile\(\) \? 4 : 8/);
assert.match(runtime, /uReflectionSampleCount\.value = quality\.reflectionSamples/);

console.log('reflection sample compile bound and adaptive runtime profile passed');
