import assert from 'node:assert/strict';
import {
  contactMergeAmount,
  findClosestDropPair,
  staticShapeBoundsRadius,
  updateDropBounds,
} from '../bubble/drop-physics.js';

const near = (actual, expected, epsilon = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

const vector = (x = 0, y = 0, z = 0, w = 0) => ({
  x, y, z, w,
  set(nextX, nextY, nextZ, nextW) {
    this.x = nextX;
    this.y = nextY;
    this.z = nextZ;
    this.w = nextW;
    return this;
  },
});

// 接觸融合閘門：循環兩端全開、中段完全關閉。這條曲線原本是已移除的「分裂」模式
// 的敘事時鐘裡的一段，但它同時在餵其餘模式的通用接觸融合，所以跟著模式一起刪會
// 改變穿梭環繞等模式的外觀。這裡把它的形狀釘住。
assert.equal(contactMergeAmount(0), 1);
assert.equal(contactMergeAmount(0.12), 1);
assert.equal(contactMergeAmount(0.26), 0);
assert.equal(contactMergeAmount(0.5), 0);
assert.equal(contactMergeAmount(0.8), 1);
assert.equal(contactMergeAmount(1), 1);
assert.ok(contactMergeAmount(0.2) > 0 && contactMergeAmount(0.2) < 1);

const pairDrops = [
  vector(0, 0, 0, 0.2),
  vector(2, 0, 0, 1.2),
  vector(3, 0, 0, 0.2),
];
const closestPair = findClosestDropPair(pairDrops, 3);
assert.deepEqual([closestPair.pairA, closestPair.pairB], [1, 2]);
near(closestPair.pairDistance, 1);
near(closestPair.surfaceGap, -0.4);

const bounds = vector();
updateDropBounds({
  params: { motion: 'weave', viscosity: 0, wobble: 0 },
  count: 2,
  dropData: [vector(-1, 0, 0, 0.5), vector(1, 0, 0, 0.5)],
  dropShapeData: [vector(1, 0, 0, 1), vector(1, 0, 0, 1)],
  dropBounds: bounds,
  typewriterReach: 0,
  hasShapeField: false,
  microCount: 0,
  microDropData: [],
});
near(bounds.x, 0);
near(bounds.y, 0);
near(bounds.z, 0);
near(bounds.w, 1.605);

updateDropBounds({
  params: {
    motion: 'static', staticShape: 6, primitiveSize: 1, primitiveTubeRatio: 0.5,
    viscosity: 0, wobble: 0,
  },
  count: 0,
  dropData: [],
  dropShapeData: [],
  dropBounds: bounds,
  typewriterReach: 0,
  hasShapeField: false,
  microCount: 0,
  microDropData: [],
});
near(bounds.w, staticShapeBoundsRadius({
  staticShape: 6, primitiveSize: 1, primitiveTubeRatio: 0.5,
}));
assert.deepEqual([bounds.x, bounds.y, bounds.z], [0, 0, 0]);

console.log('Contact merge gate, pair physics, and conservative bounds passed');
