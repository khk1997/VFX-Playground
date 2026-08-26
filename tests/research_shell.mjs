import assert from 'node:assert/strict';
import { FRAG } from '../bubble/shaders.js';

// researchShellOffset 的偏移量直接減進距離場，而法線是對同一個 mapScene 做中央
// 差分，所以「值連續但斜率跳變」的運算會在球面上留下一整圈可見的折痕。舊版用
// abs(q.x) 與 max(-q.y, 0.0) 當側面／下緣權重，於是 x=0 子午線與 y=0 赤道各有
// 一道法線硬折（實測單步轉角峰值 5.94° 與 1.77°，鄰近位置只有 0.33°），在透射
// 玻璃上被折射放大成一條把球切開的亮線。這幾條斷言守的就是「不要再回去」。

const start = FRAG.indexOf('float researchShellOffset(vec3 p){');
assert.notStrictEqual(start, -1, 'the research shell must keep its surface offset function');
let depth = 0;
let end = -1;
for (let i = FRAG.indexOf('{', start); i < FRAG.length; i++) {
  if (FRAG[i] === '{') depth++;
  else if (FRAG[i] === '}' && --depth === 0) { end = i + 1; break; }
}
const shellOffset = FRAG.slice(start, end);

// 這一條是重點：折痕的成因是「對方向向量的分量取 abs()／max()」，不是某個特定
// 寫法。改成別的不可微形式（sign、step、clamp 到 0）一樣會長出折痕，所以斷言直接
// 守住「不可微運算不得作用在 q 的分量上」。作用在 uniform 上的 max() 不在此列
// ——那些值全畫面相同，不產生空間上的斜率跳變。
assert.doesNotMatch(shellOffset, /(?:abs|max|min|sign|step|clamp)\s*\([^)]*\bq\.[xyz]/,
  'the shell weight must not apply a non-differentiable operator to a direction component');
assert.match(shellOffset, /float lateral = sqrt\(q\.x \* q\.x \+ k2\);/,
  'the lateral weight must use the rounded soft-abs instead of abs()');
assert.match(shellOffset, /float lower = 0\.5 \* \(sqrt\(q\.y \* q\.y \+ k2\) - q\.y\);/,
  'the lower-edge weight must use the smooth max(-y, 0) instead of max()');
assert.match(FRAG, /const float RESEARCH_SIDE_SOFT = 0\.0[0-9]+;/,
  'the crease rounding radius must stay a single named constant');

console.log('research shell safeguards passed');
