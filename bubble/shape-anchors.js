import { hash11CPU } from './motions/util.js?v=svg-shape-76';

const EDGE_SCALE_REFERENCE = 0.58;

export function scaleShapePoints(points, scale) {
  if (!points.length || scale === 1) return points;
  return points.map(point => {
    const copy = point.clone();
    copy.multiplyScalar(scale);
    if (point.radiusHint != null) copy.radiusHint = point.radiusHint * scale;
    if (point.thickness != null) copy.thickness = point.thickness * scale;
    copy.surface = point.surface;
    return copy;
  });
}

export function formationEdgeScaleFor(points) {
  if (!points.length) return 1;
  const interiorCount = points.filter(point => !point.surface).length;
  return Math.max(0, Math.min(1, interiorCount / points.length / EDGE_SCALE_REFERENCE));
}

function cutWeights(candidates, seed, salt) {
  if (!seed) return null;
  const base = Math.round(seed) * 29.7 + salt;
  return candidates.map((_, index) => 0.74 + 0.52 * hash11CPU(index * 1.37 + base));
}

export function distributeFormationAnchors(candidates, count, seed = 0) {
  if (!candidates.length) return [];
  const weights = cutWeights(candidates, seed, 3.1);
  const Vector3 = candidates[0].constructor;
  const center = candidates.reduce((sum, point) => sum.add(point), new Vector3())
    .multiplyScalar(1 / candidates.length);
  const chosen = [];
  let first = candidates[0];
  let farthest = -1;
  for (let index = 0; index < candidates.length; index++) {
    const point = candidates[index];
    const distance = point.distanceToSquared(center) * (weights ? weights[index] : 1);
    if (distance > farthest) {
      farthest = distance;
      first = point;
    }
  }
  chosen.push(first);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best = candidates[0];
    let bestDistance = -1;
    for (let index = 0; index < candidates.length; index++) {
      const point = candidates[index];
      let nearest = Infinity;
      for (const selected of chosen) {
        nearest = Math.min(nearest, point.distanceToSquared(selected));
      }
      if (weights) nearest *= weights[index];
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = point;
      }
    }
    chosen.push(best);
  }
  return chosen.map((point, index) => {
    const copy = point.clone();
    let nearest = Infinity;
    for (let otherIndex = 0; otherIndex < chosen.length; otherIndex++) {
      if (index === otherIndex) continue;
      nearest = Math.min(nearest, point.distanceTo(chosen[otherIndex]));
    }
    const bridgeRadius = Number.isFinite(nearest) ? nearest * 0.56 : 0.18;
    copy.radiusHint = Math.min(0.27, Math.max(point.radiusHint || 0.1, bridgeRadius));
    return copy;
  });
}

export function distributePrimaryAnchors(candidates, count, seed = 0) {
  if (!candidates.length) return [];
  const chosen = [];
  const remaining = candidates.slice();
  const remainingWeights = cutWeights(candidates, seed, 8.6);
  while (chosen.length < Math.min(count, candidates.length)) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const point = remaining[index];
      const thickness = point.radiusHint || 0.1;
      const spacing = chosen.length
        ? Math.min(...chosen.map(selected => point.distanceTo(selected)))
        : thickness;
      const score = (thickness * 3.2 + spacing * 0.42)
        * (remainingWeights ? remainingWeights[index] : 1);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const source = remaining.splice(bestIndex, 1)[0];
    if (remainingWeights) remainingWeights.splice(bestIndex, 1);
    const copy = source.clone();
    copy.thickness = source.radiusHint || 0.1;
    copy.radiusHint = Math.min(0.24, Math.max(0.14, source.radiusHint || 0.14));
    chosen.push(copy);
  }
  return chosen;
}

export function distributeDetailedAnchors(candidates, count, seed = 0) {
  if (!candidates.length) return [];
  const weighted = [...candidates, ...candidates.filter(point => point.surface)];
  const centers = distributeFormationAnchors(weighted, count, seed);
  const groups = Array.from({ length: centers.length }, () => []);
  const centerWeights = seed
    ? centers.map((_, index) => 0.62
      + 0.85 * hash11CPU(index * 4.19 + Math.round(seed) * 51.3))
    : null;
  for (let iteration = 0; iteration < 5; iteration++) {
    groups.forEach(group => { group.length = 0; });
    for (const point of weighted) {
      let best = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < centers.length; index++) {
        let distance = point.distanceToSquared(centers[index]);
        if (centerWeights) distance *= centerWeights[index];
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      groups[best].push(point);
    }
    for (let index = 0; index < centers.length; index++) {
      if (!groups[index].length) continue;
      centers[index].set(0, 0, 0);
      groups[index].forEach(point => centers[index].add(point));
      centers[index].multiplyScalar(1 / groups[index].length);
    }
  }
  for (let index = 0; index < centers.length; index++) {
    const group = groups[index];
    let varianceX = 0;
    let varianceY = 0;
    let varianceZ = 0;
    let radiusHint = 0.1;
    for (const point of group) {
      varianceX += (point.x - centers[index].x) ** 2;
      varianceY += (point.y - centers[index].y) ** 2;
      varianceZ += (point.z - centers[index].z) ** 2;
      radiusHint = Math.max(radiusHint, point.radiusHint || 0.1);
    }
    const denominator = Math.max(1, group.length);
    const variances = [
      varianceX / denominator,
      varianceY / denominator,
      varianceZ / denominator,
    ];
    const major = variances.indexOf(Math.max(...variances));
    const Vector3 = centers[index].constructor;
    centers[index].axis = new Vector3(
      major === 0 ? 1 : 0,
      major === 1 ? 1 : 0,
      major === 2 ? 1 : 0,
    );
    const sorted = variances.slice().sort((a, b) => b - a);
    centers[index].stretch = Math.min(1.42, Math.max(1.06,
      Math.sqrt((sorted[0] + 1e-4) / (sorted[1] + 1e-4))));
    centers[index].radiusHint = Math.min(0.28, Math.max(
      radiusHint,
      Math.sqrt(sorted[1] + sorted[2]) * 1.15,
    ));
  }
  return centers;
}
