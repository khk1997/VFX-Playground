import { smoothstepCPU } from './motions/util.js?v=svg-shape-76';

// Rayleigh–Plateau satellite drops formed along the neck during split motion.
export const SATELLITE_SPECS = [
  { along: -0.55, size: 0.50, jitter: 0.05, seed: 0.7, drift: -0.22, absorbAt: 0.61 },
  { along: 0.35, size: 0.30, jitter: -0.06, seed: 2.4, drift: 0.12, absorbAt: 0.58 },
  { along: 1.05, size: 0.17, jitter: 0.05, seed: 4.9, drift: 0.28, absorbAt: 0.54 },
];

export const SATELLITE_COUNT = SATELLITE_SPECS.length;

function cyclicPulse(phase, center, width) {
  const distance = Math.abs(((phase - center + 0.5) % 1 + 1) % 1 - 0.5);
  const x = Math.max(0, Math.min(1, 1 - distance / Math.max(0.0001, width)));
  return x * x * (3 - 2 * x);
}

export function splitTimeline(phase) {
  const anticipation = cyclicPulse(phase, 0.09, 0.05);
  const pull = smoothstepCPU(phase, 0.10, 0.19);
  const detach = smoothstepCPU(phase, 0.18, 0.26);
  const approach = smoothstepCPU(phase, 0.50, 0.66);
  const absorb = smoothstepCPU(phase, 0.66, 0.80);
  const contact = smoothstepCPU(phase, 0.60, 0.70)
    * (1 - smoothstepCPU(phase, 0.80, 0.88));
  const volumeSeparation = smoothstepCPU(phase, 0.135, 0.26) * (1 - absorb);
  const travelOut = smoothstepCPU(phase, 0.13, 0.27);
  const distanceSeparation = travelOut * (1 - approach * 0.92) * (1 - absorb);
  const recoilProgress = Math.max(0, Math.min(1, (phase - 0.19) / 0.17));
  const recoil = 0.5 * (1 - Math.cos(2 * Math.PI * recoilProgress));
  const splitProgress = Math.max(0, Math.min(1, (phase - 0.11) / 0.18));
  const splitShape = 0.5 * (1 - Math.cos(2 * Math.PI * splitProgress))
    * (1 - smoothstepCPU(phase, 0.29, 0.36));
  const coalesce = Math.max(0, Math.min(1, (phase - 0.62) / 0.18));

  return {
    anticipation,
    pull,
    detach,
    approach,
    absorb,
    contact,
    volumeSeparation,
    distanceSeparation,
    recoil,
    splitShape,
    coalesce,
  };
}

export function applySplitVolumeTransfer(dropData, count, separation) {
  if (count <= 1) return;
  const childVolumeProgress = separation ** 3;
  let transferredVolume = 0;
  for (let i = 1; i < count; i++) {
    const targetRadius = dropData[i].w;
    transferredVolume += targetRadius ** 3 * (1 - childVolumeProgress);
    dropData[i].w = targetRadius * separation;
  }
  const primaryTargetRadius = dropData[0].w;
  dropData[0].w = Math.cbrt(primaryTargetRadius ** 3 + transferredVolume);
}

export function findClosestDropPair(dropData, count, lockPrimaryPair = false) {
  let pairA = 0;
  let pairB = Math.min(1, count - 1);
  let pairDistance = Infinity;
  let surfaceGap = Infinity;

  if (count >= 2 && lockPrimaryPair) {
    const da = dropData[pairA];
    const db = dropData[pairB];
    pairDistance = Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z);
    surfaceGap = pairDistance - da.w - db.w;
  } else {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const di = dropData[i];
        const dj = dropData[j];
        const distance = Math.hypot(di.x - dj.x, di.y - dj.y, di.z - dj.z);
        const gap = distance - di.w - dj.w;
        if (gap < surfaceGap) {
          pairA = i;
          pairB = j;
          pairDistance = distance;
          surfaceGap = gap;
        }
      }
    }
  }

  return { pairA, pairB, pairDistance, surfaceGap };
}

export function clearSatelliteDrops(satelliteDrops) {
  for (const drop of satelliteDrops) drop.w = 0;
}

export function updateSatelliteDrops({
  phase,
  dropData,
  pairA,
  pairB,
  radius,
  dropSeeds,
  satelliteCount,
  satelliteSize,
  satelliteDrops,
}) {
  const da = dropData[pairA];
  const db = dropData[pairB];
  const dx = db.x - da.x;
  const dy = db.y - da.y;
  const dz = db.z - da.z;
  const invDistance = 1 / Math.max(0.0001, Math.hypot(dx, dy, dz));
  const ux = dx * invDistance;
  const uy = dy * invDistance;
  const uz = dz * invDistance;
  const mx = (da.x + db.x) * 0.5;
  const my = (da.y + db.y) * 0.5;
  const mz = (da.z + db.z) * 0.5;

  let qx = -uy;
  let qy = ux;
  let qz = 0;
  const qLength = Math.hypot(qx, qy, qz);
  if (qLength < 0.1) {
    qx = 0;
    qy = -uz;
    qz = uy;
  } else {
    qx /= qLength;
    qy /= qLength;
    qz /= qLength;
  }
  const rx = uy * qz - uz * qy;
  const ry = uz * qx - ux * qz;
  const rz = ux * qy - uy * qx;
  const birth = smoothstepCPU(phase, 0.18, 0.205);
  const release = smoothstepCPU(phase, 0.235, 0.285);
  const freeAge = Math.max(0, phase - 0.26);
  const baseRadius = Math.min(da.w, db.w);
  const satelliteBaseRadius = radius
    * Math.min(dropSeeds[pairA].radius, dropSeeds[pairB].radius);
  const activeCount = Math.max(0,
    Math.min(SATELLITE_COUNT, Math.round(satelliteCount)));

  for (let index = 0; index < SATELLITE_COUNT; index++) {
    if (index >= activeCount) {
      satelliteDrops[index].set(0, 0, 0, 0);
      continue;
    }
    const spec = SATELLITE_SPECS[index];
    const along = spec.along * baseRadius;
    const neckJitter = spec.jitter * baseRadius * birth * (1 - release);
    const waveQ = Math.sin(spec.seed + freeAge * 16) - Math.sin(spec.seed);
    const waveR = Math.sin(spec.seed * 1.73 + freeAge * 11)
      - Math.sin(spec.seed * 1.73);
    const driftScale = baseRadius * release;
    const drift = along + spec.drift * baseRadius * freeAge * 2.2;
    const freeX = mx + ux * drift + qx * (neckJitter + waveQ * driftScale * 0.18)
      + rx * waveR * driftScale * 0.12;
    const freeY = my + uy * drift + qy * (neckJitter + waveQ * driftScale * 0.18)
      + ry * waveR * driftScale * 0.12;
    const freeZ = mz + uz * drift + qz * (neckJitter + waveQ * driftScale * 0.18)
      + rz * waveR * driftScale * 0.12;
    const absorb = smoothstepCPU(phase, spec.absorbAt, spec.absorbAt + 0.10);
    const target = spec.along < 0 ? da : db;
    const sizeEnvelope = birth * (1 - absorb);
    satelliteDrops[index].set(
      freeX + (target.x - freeX) * absorb,
      freeY + (target.y - freeY) * absorb,
      freeZ + (target.z - freeZ) * absorb,
      satelliteBaseRadius * spec.size * satelliteSize * sizeEnvelope,
    );
  }

  return 0.32 * birth * (1 - release);
}

export function staticShapeBoundsRadius(params) {
  if (params.staticShape === 0) {
    return params.boxSize * Math.SQRT2 * 1.5 + params.boxCornerRadius + 0.2;
  }
  if (params.staticShape === 6) {
    return params.primitiveSize * (1 + params.primitiveTubeRatio) * 1.5 + 0.2;
  }
  if (params.staticShape === 4 || params.staticShape === 5) {
    return Math.max(params.primitiveSize, params.primitiveHeight) * 1.8 + 0.2;
  }
  return params.primitiveSize * 1.8 + 0.2;
}

export function updateDropBounds({
  params,
  count,
  dropData,
  dropShapeData,
  satelliteDrops,
  dropBounds,
  typewriterReach,
  hasShapeField,
  microCount,
  microDropData,
}) {
  const padding = params.viscosity * 1.15 * 0.25 * Math.max(0, count - 1)
    + params.wobble * 0.25 + params.elasticStrength + 0.08;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const drop = dropData[i];
    const radius = drop.w * Math.max(1, dropShapeData[i].w) + padding;
    minX = Math.min(minX, drop.x - radius);
    maxX = Math.max(maxX, drop.x + radius);
    minY = Math.min(minY, drop.y - radius);
    maxY = Math.max(maxY, drop.y + radius);
    minZ = Math.min(minZ, drop.z - radius);
    maxZ = Math.max(maxZ, drop.z + radius);
  }
  const hasBounds = Number.isFinite(minX);
  const centerX = hasBounds ? (minX + maxX) * 0.5 : 0;
  const centerY = hasBounds ? (minY + maxY) * 0.5 : 0;
  const centerZ = hasBounds ? (minZ + maxZ) * 0.5 : 0;
  let boundRadius = 0;
  for (let i = 0; i < count; i++) {
    const drop = dropData[i];
    boundRadius = Math.max(boundRadius,
      Math.hypot(drop.x - centerX, drop.y - centerY, drop.z - centerZ)
        + drop.w * Math.max(1, dropShapeData[i].w) + padding);
  }
  for (const satellite of satelliteDrops) {
    if (satellite.w > 0) {
      boundRadius = Math.max(boundRadius,
        Math.hypot(satellite.x - centerX, satellite.y - centerY, satellite.z - centerZ)
          + satellite.w + padding);
    }
  }
  dropBounds.set(centerX, centerY, centerZ, boundRadius);
  if (typewriterReach > 0) {
    dropBounds.set(0, 0, 0, Math.max(boundRadius, typewriterReach));
  }
  if (hasShapeField) {
    dropBounds.set(0, 0, 0, Math.max(boundRadius, 2.25));
    for (let i = 0; i < microCount; i++) {
      const offset = i * 4;
      dropBounds.w = Math.max(dropBounds.w,
        Math.hypot(microDropData[offset], microDropData[offset + 1], microDropData[offset + 2])
          + microDropData[offset + 3] + 0.12);
    }
  }
  if (params.motion === 'static' && params.staticShape !== 7) {
    dropBounds.w = Math.max(dropBounds.w, staticShapeBoundsRadius(params));
  }
  return dropBounds;
}
