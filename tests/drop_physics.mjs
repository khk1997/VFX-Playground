import assert from 'node:assert/strict';
import {
  SATELLITE_COUNT,
  applySplitVolumeTransfer,
  clearSatelliteDrops,
  findClosestDropPair,
  splitTimeline,
  staticShapeBoundsRadius,
  updateDropBounds,
  updateSatelliteDrops,
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

const start = splitTimeline(0);
assert.equal(start.volumeSeparation, 0);
assert.equal(start.distanceSeparation, 0);
assert.equal(start.recoil, 0);
const detached = splitTimeline(0.26);
assert.ok(detached.volumeSeparation > 0.99);
assert.ok(detached.distanceSeparation > 0.98);
const absorbed = splitTimeline(0.8);
assert.equal(absorbed.volumeSeparation, 0);
assert.equal(absorbed.distanceSeparation, 0);

const splitDrops = [vector(0, 0, 0, 1), vector(0, 0, 0, 0.5), vector(0, 0, 0, 0.25)];
const targetVolume = splitDrops.reduce((sum, drop) => sum + drop.w ** 3, 0);
applySplitVolumeTransfer(splitDrops, splitDrops.length, 0.4);
near(splitDrops.reduce((sum, drop) => sum + drop.w ** 3, 0), targetVolume);
near(splitDrops[1].w, 0.2);
near(splitDrops[2].w, 0.1);

const pairDrops = [
  vector(0, 0, 0, 0.2),
  vector(2, 0, 0, 1.2),
  vector(3, 0, 0, 0.2),
];
const closestPair = findClosestDropPair(pairDrops, 3, false);
assert.deepEqual([closestPair.pairA, closestPair.pairB], [1, 2]);
near(closestPair.pairDistance, 1);
near(closestPair.surfaceGap, -0.4);
const lockedPair = findClosestDropPair(pairDrops, 3, true);
assert.deepEqual([lockedPair.pairA, lockedPair.pairB], [0, 1]);
near(lockedPair.pairDistance, 2);
near(lockedPair.surfaceGap, 0.6);

const satelliteDrops = Array.from({ length: SATELLITE_COUNT }, () => vector());
const blend = updateSatelliteDrops({
  phase: 0.24,
  dropData: [vector(-0.5, 0, 0, 0.45), vector(0.5, 0, 0, 0.4)],
  pairA: 0,
  pairB: 1,
  radius: 0.5,
  dropSeeds: [{ radius: 0.8 }, { radius: 0.6 }],
  satelliteCount: 2,
  satelliteSize: 0.75,
  satelliteDrops,
});
assert.ok(blend > 0 && blend < 0.32);
assert.ok(satelliteDrops[0].w > satelliteDrops[1].w);
assert.equal(satelliteDrops[2].w, 0);
assert.ok(satelliteDrops.every(drop => [drop.x, drop.y, drop.z, drop.w].every(Number.isFinite)));
clearSatelliteDrops(satelliteDrops);
assert.ok(satelliteDrops.every(drop => drop.w === 0));

const bounds = vector();
updateDropBounds({
  params: { motion: 'split', viscosity: 0, wobble: 0, elasticStrength: 0 },
  count: 2,
  dropData: [vector(-1, 0, 0, 0.5), vector(1, 0, 0, 0.5)],
  dropShapeData: [vector(1, 0, 0, 1), vector(1, 0, 0, 1)],
  satelliteDrops: [],
  dropBounds: bounds,
  typewriterReach: 0,
  hasShapeField: false,
  microCount: 0,
  microDropData: [],
});
near(bounds.x, 0);
near(bounds.y, 0);
near(bounds.z, 0);
near(bounds.w, 1.58);

updateDropBounds({
  params: {
    motion: 'static', staticShape: 6, primitiveSize: 1, primitiveTubeRatio: 0.5,
    viscosity: 0, wobble: 0, elasticStrength: 0,
  },
  count: 0,
  dropData: [],
  dropShapeData: [],
  satelliteDrops: [],
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

console.log('Drop timelines, pair physics, satellites, and conservative bounds passed');
