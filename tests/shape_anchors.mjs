import assert from 'node:assert/strict';
import {
  distributeDetailedAnchors,
  distributeFormationAnchors,
  distributePrimaryAnchors,
  formationEdgeScaleFor,
  scaleShapePoints,
} from '../bubble/shape-anchors.js';

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() {
    const copy = new Vector3(this.x, this.y, this.z);
    for (const key of ['radiusHint', 'thickness', 'surface']) {
      if (this[key] != null) copy[key] = this[key];
    }
    return copy;
  }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  multiplyScalar(scale) { this.x *= scale; this.y *= scale; this.z *= scale; return this; }
  distanceToSquared(other) {
    return (this.x - other.x) ** 2 + (this.y - other.y) ** 2 + (this.z - other.z) ** 2;
  }
  distanceTo(other) { return Math.sqrt(this.distanceToSquared(other)); }
  length() { return Math.hypot(this.x, this.y, this.z); }
}

const source = Array.from({ length: 18 }, (_, index) => {
  const angle = index / 18 * Math.PI * 2;
  const point = new Vector3(
    Math.cos(angle) * (0.5 + index % 3 * 0.1),
    Math.sin(angle) * (0.5 + index % 2 * 0.12),
    (index % 5 - 2) * 0.08,
  );
  point.radiusHint = 0.08 + index % 4 * 0.02;
  point.thickness = 0.07 + index % 3 * 0.01;
  point.surface = index % 3 !== 0;
  return point;
});

assert.equal(scaleShapePoints(source, 1), source, 'identity scale should reuse baked points');
const scaled = scaleShapePoints(source, 1.5);
assert.notEqual(scaled, source);
assert.notEqual(scaled[0], source[0]);
assert.equal(scaled[0].surface, source[0].surface);
assert.equal(scaled[0].radiusHint, source[0].radiusHint * 1.5);
assert.equal(scaled[0].thickness, source[0].thickness * 1.5);
assert.equal(scaled[4].length(), source[4].length() * 1.5);

assert.equal(formationEdgeScaleFor([]), 1);
assert.ok(formationEdgeScaleFor(source) > 0.57 && formationEdgeScaleFor(source) < 0.58);
assert.equal(formationEdgeScaleFor(source.filter(point => point.surface)), 0);

const signature = points => points.map(point => [
  Number(point.x.toFixed(5)),
  Number(point.y.toFixed(5)),
  Number(point.z.toFixed(5)),
]);
const formationA = distributeFormationAnchors(source, 8, 0);
const formationB = distributeFormationAnchors(source, 8, 0);
assert.deepEqual(signature(formationA), signature(formationB));
assert.equal(formationA.length, 8);
assert.ok(formationA.every(point => point.radiusHint >= 0.1 && point.radiusHint <= 0.27));

const primary = distributePrimaryAnchors(source, 7, 0);
assert.equal(primary.length, 7);
assert.ok(primary.every(point => point.radiusHint >= 0.14 && point.radiusHint <= 0.24));
assert.ok(primary.every(point => Number.isFinite(point.thickness)));

const detailed = distributeDetailedAnchors(source, 9, 0);
assert.equal(detailed.length, 9);
assert.ok(detailed.every(point => point.axis instanceof Vector3));
assert.ok(detailed.every(point => point.stretch >= 1.06 && point.stretch <= 1.42));
assert.ok(detailed.every(point => point.radiusHint >= 0.1 && point.radiusHint <= 0.28));

const seededA = signature(distributeDetailedAnchors(source, 9, 2));
const seededB = signature(distributeDetailedAnchors(source, 9, 2));
const seededC = signature(distributeDetailedAnchors(source, 9, 7));
assert.deepEqual(seededA, seededB, 'same cut seed must remain deterministic');
assert.notDeepEqual(seededA, seededC, 'different cut seeds should change the partition');

console.log('Shape scaling, edge normalization, and anchor distributions passed');
