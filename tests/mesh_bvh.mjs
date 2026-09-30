import assert from 'node:assert/strict';
import {
  MAX_BVH_DEPTH, MESH_MAX_LEAF, MESH_TEXTURE_WIDTH, NODE_TEXELS, TRIANGLE_TEXELS,
  buildMeshBVH, intersectTriangleCPU, traceMeshCPU,
} from '../bubble/mesh-bvh.js';

// 決定性的亂數，測試失敗時才重現得了。
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

function randomMesh(count) {
  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const cx = rand() * 2 - 1, cy = rand() * 2 - 1, cz = rand() * 2 - 1;
    for (let v = 0; v < 3; v++) {
      positions[t * 9 + v * 3] = cx + (rand() - 0.5) * 0.3;
      positions[t * 9 + v * 3 + 1] = cy + (rand() - 0.5) * 0.3;
      positions[t * 9 + v * 3 + 2] = cz + (rand() - 0.5) * 0.3;
      normals[t * 9 + v * 3 + 2] = 1;
    }
  }
  return { positions, normals };
}

function randomRay() {
  const origin = [rand() * 6 - 3, rand() * 6 - 3, rand() * 6 - 3];
  const target = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
  const d = target.map((x, i) => x - origin[i]);
  const len = Math.hypot(...d);
  return { origin, dir: d.map(x => x / len) };
}

// 暴力法：每個三角形都試一次，取最近的。這是 BVH 必須完全一致的標準答案。
function bruteForce(mesh, origin, dir) {
  let best = null;
  for (let i = 0; i < mesh.triCount; i++) {
    const hit = intersectTriangleCPU(mesh, i, origin, dir, best ? best.t : Infinity);
    if (hit) best = { ...hit, tri: i };
  }
  return best;
}

for (const count of [1, 7, 200, 3000]) {
  const { positions, normals } = randomMesh(count);
  const mesh = buildMeshBVH(positions, normals);
  assert.equal(mesh.triCount, count);
  assert.equal(mesh.width, MESH_TEXTURE_WIDTH);
  assert.ok(mesh.nodeData.length >= mesh.nodeCount * NODE_TEXELS * 4);
  assert.ok(mesh.triData.length >= count * TRIANGLE_TEXELS * 4);
  assert.ok(mesh.stats.maxDepth < MAX_BVH_DEPTH, `depth ${mesh.stats.maxDepth}`);
  // 包圍盒涵蓋所有頂點（地板高度用它的 min.y）。
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      assert.ok(positions[i + k] >= mesh.bounds.min[k] - 1e-6 && positions[i + k] <= mesh.bounds.max[k] + 1e-6);
    }
  }
  // 每個三角形剛好出現在一個葉節點裡。
  let covered = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    covered += mesh.nodeData[n * 8 + 7];
    assert.ok(mesh.nodeData[n * 8 + 7] <= MESH_MAX_LEAF, 'leaf larger than the shader loop');
  }
  assert.equal(covered, count);

  let hits = 0, totalVisits = 0;
  for (let r = 0; r < 400; r++) {
    const { origin, dir } = randomRay();
    const expected = bruteForce(mesh, origin, dir);
    const got = traceMeshCPU(mesh, origin, dir);
    totalVisits += got.visits;
    if (!expected) { assert.equal(got.t, undefined, 'BVH found a hit brute force did not'); continue; }
    hits++;
    assert.ok(got.t !== undefined, 'BVH missed a hit');
    assert.ok(Math.abs(got.t - expected.t) < 1e-6, `t ${got.t} vs ${expected.t}`);
  }
  // 大網格上 BVH 必須真的有剪枝（平均走訪節點數遠少於三角形數）。
  if (count >= 3000) assert.ok(totalVisits / 400 < count / 10, `visits ${totalVisits / 400}`);
  if (count >= 200) assert.ok(hits > 20, `only ${hits} hits`);
}

// 重心全部重疊（SAH 分不動）時也要切得下去，葉節點不能超過 shader 的迴圈長度。
{
  const n = 200;
  const positions = new Float32Array(n * 9), normals = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    positions.set([-0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.2, 0], t * 9);
    normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1], t * 9);
  }
  const mesh = buildMeshBVH(positions, normals);
  for (let i = 0; i < mesh.nodeCount; i++) assert.ok(mesh.nodeData[i * 8 + 7] <= MESH_MAX_LEAF);
  assert.ok(traceMeshCPU(mesh, [0, 0, 1], [0, 0, -1]).t > 0);
}

// 空網格要擋下來，不能產出一棵沒有東西的樹。
assert.throws(() => buildMeshBVH(new Float32Array(0), new Float32Array(0)));

console.log('Mesh BVH matches brute-force triangle tracing and prunes large meshes');
