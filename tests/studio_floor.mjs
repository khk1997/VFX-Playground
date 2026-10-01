import assert from 'node:assert/strict';
import { FLOOR_GAP, lowestPointOverLoop, shapeFieldFloorHeight } from '../bubble/studio-floor.js';
import { computeShapeRigid } from '../bubble/motions/shapeRigid.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// three.js 的 Euler 'XYZ' = Rx · Ry · Rz。用完整矩陣乘 8 個角點當對照，
// 驗 studio-floor.js 手寫的那一列。
const mul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
function rotation(ax, ay, az) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mul(mul(Rx, Ry), Rz);
}
function bruteLowest(localBounds, rigid, scale) {
  const R = rigid ? rotation(rigid.angleX, rigid.angleY, rigid.angleZ) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const s = rigid ? [rigid.scaleX, rigid.scaleY, rigid.scaleZ] : [1, 1, 1];
  let lowest = Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const p = [0, 1, 2].map(i => ((corner >> i) & 1 ? localBounds.max[i] : localBounds.min[i]) * s[i] * scale);
    const y = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + (rigid ? rigid.offsetY : 0);
    lowest = Math.min(lowest, y);
  }
  return lowest;
}

const box = { min: [-1.2, -0.9, -0.3], max: [1.0, 1.1, 0.25] };

// 不動：最低點就是包圍盒底部 × 縮放。
near(lowestPointOverLoop({ localBounds: box, rigidAt: () => null, scaleAt: () => 1.5 }), -0.9 * 1.5);

// 隨機的剛體參數：逐相位跟完整矩陣比。
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let trial = 0; trial < 50; trial++) {
  const params = {
    cycles: 1 + Math.floor(rand() * 3), ease: rand(),
    spinX: (rand() - 0.5) * 120, spinY: (rand() - 0.5) * 360, spinZ: (rand() - 0.5) * 120,
    breathe: rand() * 0.2, bob: rand() * 0.4, squash: rand() * 0.5,
  };
  const scale = 0.5 + rand();
  const samples = 48;
  let expected = Infinity;
  for (let i = 0; i < samples; i++) {
    expected = Math.min(expected, bruteLowest(box, computeShapeRigid(params, i / samples), scale));
  }
  near(lowestPointOverLoop({
    localBounds: box, rigidAt: phase => computeShapeRigid(params, phase), scaleAt: () => scale, samples,
  }), expected);
}

// 地板 = 最低點 - 額外下墜 - 縫；還沒烘好時用 fallback。
near(shapeFieldFloorHeight({ localBounds: box, rigidAt: () => null, scaleAt: () => 1, extraDrop: 0.3, fallback: -9 }),
  -0.9 - 0.3 - FLOOR_GAP);
assert.equal(shapeFieldFloorHeight({ localBounds: null, rigidAt: () => null, scaleAt: () => 1, fallback: -1.15 }), -1.15);

console.log('Studio floor follows the lowest point over the loop');
