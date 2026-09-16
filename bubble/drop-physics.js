import { smoothstepCPU } from './motions/util.js?v=svg-shape-76';

// 兩顆最近的水滴碰到時要不要互相脹大半徑（見 bubble.js 的 drainageHold）。
//
// 這條曲線本來是已經移除的「分裂」模式的敘事時鐘裡的一段（volumeSeparation）。
// 它同時也在餵其餘模式的通用接觸融合，所以隨著那個模式一起刪掉會改變穿梭環繞
// 等模式的外觀。刪模式不該順手改別人的樣子，於是把這一段原封不動留下來，換成
// 它現在真正的名字：一個 1 → 0 → 1 的週期性閘門，循環中段不融合。
export function contactMergeAmount(phase) {
  const absorb = smoothstepCPU(phase, 0.66, 0.80);
  const volumeSeparation = smoothstepCPU(phase, 0.135, 0.26) * (1 - absorb);
  return 1 - volumeSeparation;
}

export function findClosestDropPair(dropData, count) {
  let pairA = 0;
  let pairB = Math.min(1, count - 1);
  let pairDistance = Infinity;
  let surfaceGap = Infinity;

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

  return { pairA, pairB, pairDistance, surfaceGap };
}

// 包圍球在水滴半徑之外還要留的餘裕。這個值是量出來的，不是湊的：少 0.025，
// 穿梭環繞、融化、安裝中的輪廓最外緣就會被切掉一圈（實測深底安裝中最大有
// 94/255 的色差，約 0.4% 的像素）。改小之前請先跑一次逐像素比對。
const SURFACE_MARGIN = 0.105;

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
  dropBounds,
  typewriterReach,
  hasShapeField,
  microCount,
  microDropData,
}) {
  const padding = params.viscosity * 1.15 * 0.25 * Math.max(0, count - 1)
    + params.wobble * 0.25 + SURFACE_MARGIN;
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
