// 三角網格的 BVH（bounding volume hierarchy），給靜態模組直接對 GLB 的三角形算光線。
//
// 為什麼要有這一條：GLB 平常會先烘成體素距離場（見 shape-field.js 的 objectToField），
// 那一步把面位置量化到體素、再做兩次高斯模糊，模型的細節（眼窩、鼻樑、薄邊）全部
// 被磨掉。靜態模組只展示一顆不會變形的物體，不需要距離場才能做的那些事（水滴融合、
// 成形、切開），所以玻璃本身直接打三角形，距離場只留給地板影子。
//
// 這支檔案刻意不依賴 three.js：它只吃 Float32Array、吐 Float32Array，node 測試可以
// 直接拿 CPU 版的走訪跟暴力逐一比對。之後要換分割策略、壓縮節點格式，只動這裡。
//
// ===== 打包格式（shader 端見 shader-chunks/optics.js 的 FEATURE_STATIC_MESH） =====
//
// 節點：每個節點 2 個 RGBA texel（8 個 float）
//   texel 0 = (bbox.min.xyz, a)
//   texel 1 = (bbox.max.xyz, count)
//   count > 0：葉節點，a = 第一個三角形的索引，count = 三角形數
//   count = 0：內部節點，左子節點就是下一個節點（深度優先排列），a = 右子節點索引
//
// 三角形：每個 6 個 RGBA texel
//   v0、e1 = v1 − v0、e2 = v2 − v0（Möller–Trumbore 直接要邊向量，shader 少兩次減法）
//   n0、n1、n2（頂點法線，插值出平滑表面 —— 跟 Blender 的 smooth shading 一樣）
//   w 分量不用（留 0），之後要塞材質索引或 UV 時有位置。
//
// 貼圖寬固定 MESH_TEXTURE_WIDTH，列數依資料量決定；shader 用 texelFetch 按索引讀。

export const MESH_TEXTURE_WIDTH = 2048;
export const NODE_TEXELS = 2;
export const TRIANGLE_TEXELS = 6;
// 葉節點最多幾個三角形。小一點樹比較深、每個葉比較便宜；4 是常見的平衡點。
export const MAX_LEAF_TRIANGLES = 4;
// 葉節點的硬上限，shader 端葉節點迴圈的長度（optics.js 的 MESH_MAX_LEAF）。SAH 分不
// 下去（例如很多三角形的重心重疊）時改用中位數硬切，只有撞到深度上限才可能超過
// MAX_LEAF_TRIANGLES；超過這個硬上限就放棄網格、退回距離場。
export const MESH_MAX_LEAF = 16;
// SAH 分割的 bin 數。
const SAH_BINS = 12;
// 走訪時堆疊的深度上限（shader 端的陣列長度）。建樹時超過就停止往下分，保證
// shader 的堆疊不會溢位。
export const MAX_BVH_DEPTH = 32;
// 超過這個數量就不走三角網格（退回距離場）：貼圖會超過常見的 4096 上限。
export const MAX_MESH_TRIANGLES = Math.floor((MESH_TEXTURE_WIDTH * 4096) / TRIANGLE_TEXELS);

// positions / normals：每個三角形 9 個 float（三個頂點）。
export function buildMeshBVH(positions, normals) {
  const triCount = Math.floor(positions.length / 9);
  if (triCount === 0) throw new Error('網格沒有三角形');
  if (triCount > MAX_MESH_TRIANGLES) {
    throw new Error(`三角形太多（${triCount}，上限 ${MAX_MESH_TRIANGLES}）`);
  }
  const centroids = new Float32Array(triCount * 3);
  const boundsMin = new Float32Array(triCount * 3);
  const boundsMax = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let axis = 0; axis < 3; axis++) {
      const a = positions[t * 9 + axis];
      const b = positions[t * 9 + 3 + axis];
      const c = positions[t * 9 + 6 + axis];
      boundsMin[t * 3 + axis] = Math.min(a, b, c);
      boundsMax[t * 3 + axis] = Math.max(a, b, c);
      centroids[t * 3 + axis] = (a + b + c) / 3;
    }
  }
  const order = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;

  const nodes = [];
  let maxDepth = 0;
  let leafCount = 0;

  const bounds = (start, end, useCentroid) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let axis = 0; axis < 3; axis++) {
        const lo = useCentroid ? centroids[t * 3 + axis] : boundsMin[t * 3 + axis];
        const hi = useCentroid ? centroids[t * 3 + axis] : boundsMax[t * 3 + axis];
        if (lo < min[axis]) min[axis] = lo;
        if (hi > max[axis]) max[axis] = hi;
      }
    }
    return { min, max };
  };
  const area = (min, max) => {
    const dx = Math.max(0, max[0] - min[0]);
    const dy = Math.max(0, max[1] - min[1]);
    const dz = Math.max(0, max[2] - min[2]);
    return 2 * (dx * dy + dy * dz + dz * dx);
  };

  // 回傳分割點（order 裡的索引）；回傳 -1 代表不值得分（做成葉節點）。
  const splitSAH = (start, end, box) => {
    const count = end - start;
    const cbox = bounds(start, end, true);
    let bestCost = Infinity, bestAxis = -1, bestBin = -1;
    for (let axis = 0; axis < 3; axis++) {
      const lo = cbox.min[axis], hi = cbox.max[axis];
      if (hi - lo < 1e-12) continue;
      const binCount = new Uint32Array(SAH_BINS);
      const binMin = Array.from({ length: SAH_BINS }, () => [Infinity, Infinity, Infinity]);
      const binMax = Array.from({ length: SAH_BINS }, () => [-Infinity, -Infinity, -Infinity]);
      const scale = SAH_BINS / (hi - lo);
      for (let i = start; i < end; i++) {
        const t = order[i];
        const b = Math.min(SAH_BINS - 1, Math.floor((centroids[t * 3 + axis] - lo) * scale));
        binCount[b]++;
        for (let k = 0; k < 3; k++) {
          if (boundsMin[t * 3 + k] < binMin[b][k]) binMin[b][k] = boundsMin[t * 3 + k];
          if (boundsMax[t * 3 + k] > binMax[b][k]) binMax[b][k] = boundsMax[t * 3 + k];
        }
      }
      // 由左往右、由右往左各掃一次累積包圍盒與數量。
      const leftArea = new Float64Array(SAH_BINS), leftCount = new Uint32Array(SAH_BINS);
      const accMin = [Infinity, Infinity, Infinity], accMax = [-Infinity, -Infinity, -Infinity];
      let acc = 0;
      for (let b = 0; b < SAH_BINS; b++) {
        acc += binCount[b];
        for (let k = 0; k < 3; k++) {
          accMin[k] = Math.min(accMin[k], binMin[b][k]); accMax[k] = Math.max(accMax[k], binMax[b][k]);
        }
        leftArea[b] = acc ? area(accMin, accMax) : 0; leftCount[b] = acc;
      }
      const rMin = [Infinity, Infinity, Infinity], rMax = [-Infinity, -Infinity, -Infinity];
      let racc = 0;
      for (let b = SAH_BINS - 1; b > 0; b--) {
        racc += binCount[b];
        for (let k = 0; k < 3; k++) {
          rMin[k] = Math.min(rMin[k], binMin[b][k]); rMax[k] = Math.max(rMax[k], binMax[b][k]);
        }
        const lc = leftCount[b - 1];
        if (!lc || !racc) continue;
        const cost = leftArea[b - 1] * lc + area(rMin, rMax) * racc;
        if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestBin = b; }
      }
    }
    if (bestAxis < 0) return -1;
    // 葉節點的成本 = 三角形數 × 包圍盒面積；分下去不划算就停。
    const leafCost = count * area(box.min, box.max);
    if (count <= MAX_LEAF_TRIANGLES && bestCost >= leafCost) return -1;
    const lo = cbox.min[bestAxis], scale = SAH_BINS / (cbox.max[bestAxis] - lo);
    let i = start, j = end - 1;
    while (i <= j) {
      const b = Math.min(SAH_BINS - 1, Math.floor((centroids[order[i] * 3 + bestAxis] - lo) * scale));
      if (b < bestBin) i++;
      else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
    }
    return (i === start || i === end) ? Math.floor((start + end) / 2) : i;
  };

  // 深度優先建樹：左子節點緊接在父節點後面，右子節點的索引寫回父節點。
  const build = (start, end, depth) => {
    const index = nodes.length;
    const box = bounds(start, end, false);
    const node = { min: box.min, max: box.max, a: 0, count: 0 };
    nodes.push(node);
    maxDepth = Math.max(maxDepth, depth);
    const count = end - start;
    let split = (count > 1 && depth < MAX_BVH_DEPTH - 1) ? splitSAH(start, end, box) : -1;
    if (split < 0 && count > MAX_LEAF_TRIANGLES && depth < MAX_BVH_DEPTH - 1) {
      split = Math.floor((start + end) / 2);   // SAH 分不動：中位數硬切，保證葉節點夠小
    }
    if (split < 0) {
      if (count > MESH_MAX_LEAF) throw new Error(`BVH 葉節點過大（${count}）`);
      node.a = start;
      node.count = count;
      leafCount++;
      return index;
    }
    build(start, split, depth + 1);
    node.a = build(split, end, depth + 1);
    return index;
  };
  build(0, triCount, 0);

  const nodeTexels = nodes.length * NODE_TEXELS;
  const nodeRows = Math.ceil(nodeTexels / MESH_TEXTURE_WIDTH);
  const nodeData = new Float32Array(MESH_TEXTURE_WIDTH * nodeRows * 4);
  nodes.forEach((node, i) => {
    const o = i * NODE_TEXELS * 4;
    nodeData.set([node.min[0], node.min[1], node.min[2], node.a,
      node.max[0], node.max[1], node.max[2], node.count], o);
  });

  const triTexels = triCount * TRIANGLE_TEXELS;
  const triRows = Math.ceil(triTexels / MESH_TEXTURE_WIDTH);
  const triData = new Float32Array(MESH_TEXTURE_WIDTH * triRows * 4);
  for (let i = 0; i < triCount; i++) {
    const t = order[i];
    const p = t * 9;
    const o = i * TRIANGLE_TEXELS * 4;
    const v0 = [positions[p], positions[p + 1], positions[p + 2]];
    triData.set([v0[0], v0[1], v0[2], 0,
      positions[p + 3] - v0[0], positions[p + 4] - v0[1], positions[p + 5] - v0[2], 0,
      positions[p + 6] - v0[0], positions[p + 7] - v0[1], positions[p + 8] - v0[2], 0,
      normals[p], normals[p + 1], normals[p + 2], 0,
      normals[p + 3], normals[p + 4], normals[p + 5], 0,
      normals[p + 6], normals[p + 7], normals[p + 8], 0], o);
  }

  return {
    nodeData, nodeRows, nodeCount: nodes.length,
    triData, triRows, triCount,
    width: MESH_TEXTURE_WIDTH,
    // 整個網格的包圍盒（造型本地空間）。地板高度要貼到模型底部就靠它。
    bounds: { min: nodes[0].min.slice(), max: nodes[0].max.slice() },
    stats: { maxDepth, leafCount },
  };
}

// ===== CPU 版走訪（給測試用，跟 shader 同一套資料與同一套演算法） =====

function readVec(data, texel) {
  const o = texel * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

// Möller–Trumbore。回傳 { t, u, v } 或 null。雙面都算（玻璃要從裡面打出去）。
export function intersectTriangleCPU(mesh, triIndex, origin, dir, tMax) {
  const base = triIndex * TRIANGLE_TEXELS;
  const v0 = readVec(mesh.triData, base), e1 = readVec(mesh.triData, base + 1), e2 = readVec(mesh.triData, base + 2);
  const px = dir[1] * e2[2] - dir[2] * e2[1];
  const py = dir[2] * e2[0] - dir[0] * e2[2];
  const pz = dir[0] * e2[1] - dir[1] * e2[0];
  const det = e1[0] * px + e1[1] * py + e1[2] * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = origin[0] - v0[0], ty = origin[1] - v0[1], tz = origin[2] - v0[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1[2] - tz * e1[1];
  const qy = tz * e1[0] - tx * e1[2];
  const qz = tx * e1[1] - ty * e1[0];
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
  if (t <= 1e-6 || t >= tMax) return null;
  return { t, u, v };
}

function hitBox(min, max, origin, invDir, tMax) {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    let a = (min[k] - origin[k]) * invDir[k];
    let b = (max[k] - origin[k]) * invDir[k];
    if (a > b) { const tmp = a; a = b; b = tmp; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export function traceMeshCPU(mesh, origin, dir, tMax = Infinity) {
  const invDir = dir.map(d => (Math.abs(d) < 1e-12 ? 1e12 * Math.sign(d || 1) : 1 / d));
  let best = null;
  let closest = tMax;
  let visits = 0;
  const stack = [0];
  while (stack.length) {
    const index = stack.pop();
    visits++;
    const a = readVec(mesh.nodeData, index * NODE_TEXELS);
    const b = readVec(mesh.nodeData, index * NODE_TEXELS + 1);
    if (hitBox(a, b, origin, invDir, closest) === Infinity) continue;
    const count = b[3];
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const hit = intersectTriangleCPU(mesh, a[3] + i, origin, dir, closest);
        if (hit) { closest = hit.t; best = { ...hit, tri: a[3] + i }; }
      }
      continue;
    }
    stack.push(a[3], index + 1);
  }
  return best ? { ...best, visits } : { visits };
}
