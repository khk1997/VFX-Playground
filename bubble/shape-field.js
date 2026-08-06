import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function chooseMetaballs(candidates, count = 96) {
  if (!candidates.length) return [];
  const chosen = [];
  const center = candidates.reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .multiplyScalar(1 / candidates.length);
  let first = candidates.reduce((best, p) =>
    p.distanceToSquared(center) > best.distanceToSquared(center) ? p : best,
  candidates[0]);
  chosen.push(first);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best = candidates[0], bestD = -1;
    for (const p of candidates) {
      let nearest = Infinity;
      for (const q of chosen) nearest = Math.min(nearest, p.distanceToSquared(q));
      const featureWeight = p.surface ? 1.35 : 1;
      if (nearest * featureWeight > bestD) { bestD = nearest * featureWeight; best = p; }
    }
    chosen.push(best);
  }
  return chosen.map((p, i) => {
    let nearest = Infinity;
    for (let j = 0; j < chosen.length; j++) {
      if (i !== j) nearest = Math.min(nearest, p.distanceTo(chosen[j]));
    }
    return {
      position: p,
      radius: clamp(Math.max(p.radiusHint || 0.07, nearest * 0.54), 0.055, 0.19),
    };
  });
}

function smoothMinCPU(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / Math.max(k, 1e-6);
  return Math.min(a, b) - h * h * h * k / 6;
}

async function bakeMetaballAtlas(size, cols, rows, targets, cavities, worldSize = 2.1) {
  const atlasW = cols * size, atlasH = rows * size;
  const atlas = new Float32Array(atlasW * atlasH).fill(24);
  const balls = chooseMetaballs(targets, 96);
  const negative = chooseMetaballs(cavities, 12);
  const voxel = worldSize / Math.max(1, size - 1);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const wx = (x / (size - 1) - 0.5) * worldSize;
      const wy = (y / (size - 1) - 0.5) * worldSize;
      const wz = (z / (size - 1) - 0.5) * worldSize;
      let d = 1e6;
      for (const ball of balls) {
        const p = ball.position;
        const sphereD = Math.hypot(wx - p.x, wy - p.y, wz - p.z) - ball.radius;
        d = smoothMinCPU(d, sphereD, 0.035);
      }
      let cut = 1e6;
      for (const ball of negative) {
        const p = ball.position;
        cut = Math.min(cut,
          Math.hypot(wx - p.x, wy - p.y, wz - p.z) - Math.min(0.1, ball.radius));
      }
      if (cut < 1e5) d = Math.max(d, -cut);
      const ax = (z % cols) * size + x;
      const ay = Math.floor(z / cols) * size + y;
      atlas[ax + ay * atlasW] = d / voxel;
    }
    if (z % 4 === 0) await new Promise(requestAnimationFrame);
  }
  return atlas;
}

function blurSignedVolume(source, size, passes = 2) {
  let current = new Float32Array(source);
  const index = (x, y, z) => x + size * (y + size * z);
  for (let pass = 0; pass < passes; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const next = new Float32Array(current.length);
      for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const xm = axis === 0 ? Math.max(0, x - 1) : x;
        const xp = axis === 0 ? Math.min(size - 1, x + 1) : x;
        const ym = axis === 1 ? Math.max(0, y - 1) : y;
        const yp = axis === 1 ? Math.min(size - 1, y + 1) : y;
        const zm = axis === 2 ? Math.max(0, z - 1) : z;
        const zp = axis === 2 ? Math.min(size - 1, z + 1) : z;
        next[index(x, y, z)] = current[index(xm, ym, zm)] * 0.25
          + current[index(x, y, z)] * 0.5
          + current[index(xp, yp, zp)] * 0.25;
      }
      current = next;
    }
  }
  return current;
}

function dilateVolumeMask(source, size) {
  const result = new Uint8Array(source);
  const index = (x, y, z) => x + size * (y + size * z);
  // 6-connected 一 voxel 膨脹：只補正交方向的薄層與小裂縫，
  // 比 26-neighbor 更不容易讓耳朵、翼片等斜面整體過度肥厚。
  for (let z = 1; z < size - 1; z++) {
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = index(x, y, z);
      if (source[i]
        || source[index(x - 1, y, z)] || source[index(x + 1, y, z)]
        || source[index(x, y - 1, z)] || source[index(x, y + 1, z)]
        || source[index(x, y, z - 1)] || source[index(x, y, z + 1)]) {
        result[i] = 1;
      }
    }
  }
  return result;
}

function chamferSigned(mask, w, h, d = 1) {
  const n = w * h * d;
  const inf = 1e6;
  const inside = new Float32Array(n);
  const outside = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = mask[i] ? inf : 0;
    outside[i] = mask[i] ? 0 : inf;
  }
  const idx = (x, y, z) => x + w * (y + h * z);
  const passes = [
    { zs: [0, d, 1], ys: [0, h, 1], xs: [0, w, 1], direction: 1 },
    { zs: [d - 1, -1, -1], ys: [h - 1, -1, -1], xs: [w - 1, -1, -1], direction: -1 },
  ];
  for (const field of [inside, outside]) {
    for (const p of passes) {
      for (let z = p.zs[0]; z !== p.zs[1]; z += p.zs[2]) {
        for (let y = p.ys[0]; y !== p.ys[1]; y += p.ys[2]) {
          for (let x = p.xs[0]; x !== p.xs[1]; x += p.xs[2]) {
            const i = idx(x, y, z);
            for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy && !oz) continue;
              // 只讀取目前掃描方向中已完成的鄰居。原本以 offset 總和判斷，
              // 不但會漏掉對角線，方向也相反，導致距離停在 Infinity。
              const prior = p.direction > 0
                ? (oz < 0 || (oz === 0 && (oy < 0 || (oy === 0 && ox < 0))))
                : (oz > 0 || (oz === 0 && (oy > 0 || (oy === 0 && ox > 0))));
              if (!prior) continue;
              const xx = x + ox, yy = y + oy, zz = z + oz;
              if (xx < 0 || yy < 0 || zz < 0 || xx >= w || yy >= h || zz >= d) continue;
              const cost = Math.sqrt(ox * ox + oy * oy + oz * oz);
              field[i] = Math.min(field[i], field[idx(xx, yy, zz)] + cost);
            }
          }
        }
      }
    }
  }
  const signed = new Float32Array(n);
  for (let i = 0; i < n; i++) signed[i] = mask[i] ? -inside[i] : outside[i];
  return signed;
}

/* ===== 精確歐氏距離場（Felzenszwalb & Huttenlocher, O(n)）=====
 * chamfer 3×3 每步只能走八個方向，累積誤差 2–4%，且誤差有方向性 ——
 * 斜向輪廓會被拉成八角形，正是鋸齒的一部分。這裡沿各軸做一維拋物線下包絡，
 * 得到精確的平方距離，沒有方向偏差。GLB 的 3D 路徑仍用 chamferSigned。
 */
function edt1d(f, d, v, z, n) {
  const INF = 1e20;
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dist = q - v[k];
    d[q] = dist * dist + f[v[k]];
  }
}

function edt2dSquared(f, w, h) {
  const span = Math.max(w, h);
  const line = new Float32Array(span);
  const out = new Float32Array(span);
  const v = new Int32Array(span);
  const z = new Float32Array(span + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[y] = f[x + y * w];
    edt1d(line, out, v, z, h);
    for (let y = 0; y < h; y++) f[x + y * w] = out[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) line[x] = f[row + x];
    edt1d(line, out, v, z, w);
    for (let x = 0; x < w; x++) f[row + x] = out[x];
  }
  return f;
}

function exactSigned2D(mask, w, h) {
  const INF = 1e20;
  const n = w * h;
  const inside = new Float32Array(n);
  const outside = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = mask[i] ? INF : 0;
    outside[i] = mask[i] ? 0 : INF;
  }
  edt2dSquared(inside, w, h);
  edt2dSquared(outside, w, h);
  const signed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    signed[i] = mask[i] ? -Math.sqrt(inside[i]) : Math.sqrt(outside[i]);
  }
  return signed;
}

function encodeFloat2D(field, w, h, range = 24) {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < field.length; i++) {
    const v = clamp(0.5 + field[i] / (range * 2), 0, 1);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 1;
  }
  // 8-bit atlas 只有 256 階，calcNormal 的微分會把量化階梯放大成反射色塊。
  // RGBA32F + linear filtering 保留連續距離梯度，讓薄膜著色使用平滑法線。
  const tex = new THREE.DataTexture(
    data, w, h, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function selectSvgEdgeDroplets(field, size, seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const random = () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const texel = SVG_WORLD / Math.max(1, size - 1);
  const candidates = [];
  for (let y = 2; y < size - 2; y += 2) for (let x = 2; x < size - 2; x += 2) {
    const i = x + y * size;
    if (Math.abs(field[i]) <= texel * 1.4) candidates.push({ x, y });
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const drops = [];
  const desired = Math.min(8, Math.max(6, Math.round(candidates.length / 100)));
  for (const candidate of candidates) {
    const radius = 0.085 + random() * 0.065;
    const gx = field[candidate.x + 1 + candidate.y * size]
      - field[candidate.x - 1 + candidate.y * size];
    const gy = field[candidate.x + (candidate.y + 1) * size]
      - field[candidate.x + (candidate.y - 1) * size];
    const gl = Math.hypot(gx, gy) || 1;
    // 大部分球體埋入 Logo，只保留一個柔軟鼓包；避免像珠子黏在表面。
    const cx = candidate.x - gx / gl * radius * 0.46 / texel;
    const cy = candidate.y - gy / gl * radius * 0.46 / texel;
    const separated = drops.every(drop =>
      Math.hypot((cx - drop.x) * texel, (cy - drop.y) * texel)
        > (radius + drop.radius) * 1.65);
    if (!separated) continue;
    const normalX = gx / gl;
    const normalY = -gy / gl;
    drops.push({
      x: (cx / (size - 1) - 0.5) * SVG_WORLD,
      y: (0.5 - cy / (size - 1)) * SVG_WORLD,
      radius,
      phase: random(),
      tangentX: -normalY,
      tangentY: normalX,
      speed: random() < 0.72 ? 1 : 2,
      travel: radius * (0.38 + random() * 0.24),
    });
    if (drops.length >= desired) break;
  }
  return drops;
}

const SVG_WORLD = 3;
// 距離場以世界單位編碼，範圍剛好覆蓋整個取樣盒（|x|,|y| ≤ 1.5）。
// 舊版存的是「像素距離 + range 24」，一旦提高解析度，可表示範圍會跟著縮小
// （512² 時只剩 0.14 世界單位），ray marcher 會被迫用極小步長前進。
const SVG_RANGE = SVG_WORLD / 2;

export async function svgToField(file, { size = 512, supersample = 3 } = {}) {
  const text = await file.text();
  if (!/<svg[\s>]/i.test(text)) throw new Error('不是有效的 SVG');
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // 距離場先在 supersample 倍的解析度上算，再降採樣回 size。
    // 只在最終解析度上做 EDT 是不夠的：EDT 量的是「到最近的異類『像素中心』」，
    // 值因此被鎖在 √(整數²+整數²) 這組階梯上（實測 512² 時，離邊界 1~4 texel
    // 的 7788 個像素只有 11 種不同的值）。零等值面可以靠下面的次像素修正救回來，
    // 但梯度仍是一塊塊的常數 —— 而擠出側面的法線正是這個梯度，於是側壁出現面片。
    // 在高解析度上計算再做箱型平均，能把階梯細化並抹平成連續梯度。
    const ss = Math.max(1, Math.round(supersample));
    const hi = size * ss;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = hi;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pad = Math.round(hi * 0.075);
    const scale = Math.min((hi - pad * 2) / Math.max(1, img.width), (hi - pad * 2) / Math.max(1, img.height));
    const dw = img.width * scale, dh = img.height * scale;
    ctx.clearRect(0, 0, hi, hi);
    ctx.drawImage(img, (hi - dw) / 2, (hi - dh) / 2, dw, dh);
    const pixels = ctx.getImageData(0, 0, hi, hi).data;
    // canvas 的抗鋸齒 alpha 就是次像素覆蓋率，先完整保留下來
    const coverage = new Float32Array(hi * hi);
    const mask = new Uint8Array(hi * hi);
    for (let i = 0; i < hi * hi; i++) {
      const a = pixels[i * 4 + 3] / 255;
      coverage[i] = a;
      mask[i] = a >= 0.5 ? 1 : 0;
    }
    const hiField = exactSigned2D(mask, hi, hi);
    // 部分覆蓋的像素改用覆蓋率推出的次像素距離：直線邊界穿過像素時，
    // 有號距離約為 0.5 - 覆蓋率。少了這步，零等值面只能落在整數格線上，
    // 輪廓就是階梯；這是正面鋸齒最主要的來源。
    for (let i = 0; i < hi * hi; i++) {
      if (coverage[i] > 0.02 && coverage[i] < 0.98) hiField[i] = 0.5 - coverage[i];
    }
    // 像素距離 → 世界距離，之後所有消費端都用世界單位
    const perPixel = SVG_WORLD / hi;
    for (let i = 0; i < hi * hi; i++) hiField[i] *= perPixel;

    // 箱型平均降採樣。距離場在局部近似線性，取區塊平均即區塊中心的距離；
    // 高曲率處會略微圓化，對液體外觀無害。
    let field;
    if (ss === 1) {
      field = hiField;
    } else {
      field = new Float32Array(size * size);
      const inv = 1 / (ss * ss);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = 0; dy < ss; dy++) {
          const row = (y * ss + dy) * hi;
          for (let dx = 0; dx < ss; dx++) sum += hiField[row + x * ss + dx];
        }
        field[x + y * size] = sum * inv;
      }
    }

    // 預先建立多組可重現的輪廓亂數分佈。UI 切換時只換 uniform 資料，
    // 不必重新計算 SVG 距離場，也不會在拖動控制時卡住。
    const edgeDropSets = Array.from({ length: 8 }, (_, i) =>
      selectSvgEdgeDroplets(field, size, `${text}\nedge-distribution:${i}`));
    const targets = [];
    // 以固定的世界空間密度取樣，讓候選點數不隨解析度暴增
    // （160² 的雜湊步長換算後約等於 5px 網格；此處沿用同樣的世界間距）。
    const step = Math.max(1, Math.round(size / 32));
    for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
      const i = x + y * size;
      if (field[i] >= 0) continue;
      const target = new THREE.Vector3(
        (x / (size - 1) - 0.5) * SVG_WORLD,
        (0.5 - y / (size - 1)) * SVG_WORLD,
        0,
      );
      // SVG 只當作球心分布模具；局部 2D 內距決定水滴尺寸，使寬區域鼓起、
      // 細部由小滴補足，而不是直接顯示原始向量硬邊。
      target.radiusHint = clamp(-field[i] * 0.58, 0.09, 0.24);
      target.surface = field[i] > -0.056;
      targets.push(target);
    }
    if (!targets.length) throw new Error('SVG 沒有可見的填色區域');
    // DataTexture 的第一列資料對應 v=0，也就是貼圖下緣；但 mask/field 沿用
    // canvas 的列序（y=0 是影像上緣）。直接上傳的話，shader 以
    // uv = p.xy / 3 + 0.5 取樣時會把影像上緣讀成世界下方，成品上下顛倒；
    // 而上面的 targets 已自行翻轉過 Y，兩者因此互為鏡像 —— 水滴飛向正立的
    // 錨點，長出來的表面卻是倒的。這裡只為貼圖翻轉列序，讓貼圖與 targets
    // 一致採用「世界 +Y 朝上」，與 GLB 路徑的 atlas 方向也就一致了。
    const texField = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const src = y * size;
      const dst = (size - 1 - y) * size;
      for (let x = 0; x < size; x++) texField[dst + x] = field[src + x];
    }
    return {
      // 8-bit 只有 256 階，calcNormal 的微分會把量化階梯放大成邊緣鋸齒與
      // 反射色塊；float 貼圖保留連續距離梯度（GLB 路徑早已如此）。
      texture: encodeFloat2D(texField, size, size, SVG_RANGE),
      targets,
      edgeDrops: edgeDropSets[0],
      edgeDropSets,
      cavityTargets: [],
      // 烘焙解析度。SVG 模式只用它推導盒外 epsilon 與法線微分半徑；
      // volumeShapeDistance 只在 uShapeType == 2 時呼叫，設值不影響 GLB。
      grid: size,
      atlas: new THREE.Vector2(1, 1),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const tris = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pos = obj.geometry.attributes.position;
    const index = obj.geometry.index;
    const count = index ? index.count : pos.count;
    const step = Math.max(1, Math.ceil(count / 3 / 12000));
    for (let i = 0; i < count; i += 3 * step) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(obj.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(obj.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(obj.matrixWorld);
      tris.push(new THREE.Triangle(a.clone(), b.clone(), c.clone()));
    }
  });
  return tris;
}

export async function gltfToField(file, size = 48) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const url = URL.createObjectURL(file);
  let gltf;
  try { gltf = await new GLTFLoader().loadAsync(url); } finally { URL.revokeObjectURL(url); }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  if (box.isEmpty()) throw new Error('模型沒有可用網格');
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  gltf.scene.position.sub(center);
  gltf.scene.scale.setScalar(1.72 / Math.max(maxDim, 1e-5));
  gltf.scene.updateMatrixWorld(true);
  const tris = collectTriangles(gltf.scene);
  if (!tris.length) throw new Error('模型沒有三角形');

  const mask = new Uint8Array(size ** 3);
  const hits = [];
  const origin = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0), hit = new THREE.Vector3();
  const ray = new THREE.Ray(origin, dir);
  const half = 1.05;
  let oddScanlines = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
    origin.set(-half * 1.2, (y / (size - 1) - 0.5) * half * 2, (z / (size - 1) - 0.5) * half * 2);
    ray.origin.copy(origin);
    hits.length = 0;
    for (const tri of tris) {
      const p = ray.intersectTriangle(tri.a, tri.b, tri.c, false, hit);
      if (p) hits.push(p.x);
    }
    hits.sort((a, b) => a - b);
    const unique = hits.filter((v, i) => i === 0 || Math.abs(v - hits[i - 1]) > 1e-4);
    if (unique.length % 2 !== 0) oddScanlines++;
    // 只填入完整的 entry/exit 配對。奇數交點通常來自開口、退化面或射線剛好
    // 穿過頂點；舊版 parity 會在最後一個落單交點後一路填到體素邊界，形成外層方盒。
    for (let pair = 0; pair + 1 < unique.length; pair += 2) {
      const entry = unique[pair], exit = unique[pair + 1];
      for (let x = 1; x < size - 1; x++) {
        const wx = (x / (size - 1) - 0.5) * half * 2;
        if (wx > entry && wx < exit) mask[x + size * (y + size * z)] = 1;
      }
    }
    if ((y + z * size) % 48 === 0) await new Promise(requestAnimationFrame);
  }

  // SDF atlas 的最外層必須明確屬於模型外部；這也是 ray marcher 安全離開
  // 取樣盒的保證，避免任何不封閉模型把負距離接到 bounding box 表面。
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
    mask[size * (y + size * z)] = 0;
    mask[(size - 1) + size * (y + size * z)] = 0;
  }
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    mask[x + size * (size * z)] = 0;
    mask[x + size * ((size - 1) + size * z)] = 0;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    mask[x + size * y] = 0;
    mask[x + size * (y + size * (size - 1))] = 0;
  }

  // 48³ 的薄部位可能在 scan conversion 後只剩零星 voxel，甚至斷線。
  // 距離場建立前補一層連通性；80³／128³ 已有足夠取樣，不改原 mask。
  const topologyMask = size <= 48 ? dilateVolumeMask(mask, size) : mask;
  const field = chamferSigned(topologyMask, size, size, size);
  const cols = Math.ceil(Math.sqrt(size)), rows = Math.ceil(size / cols);
  const atlasW = cols * size, atlasH = rows * size;
  const atlasField = new Float32Array(atlasW * atlasH).fill(24);
  const targets = [];
  const cavityTargets = [];
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const src = x + size * (y + size * z);
    const ax = (z % cols) * size + x, ay = Math.floor(z / cols) * size + y;
    atlasField[ax + ay * atlasW] = field[src];
    if (topologyMask[src] && ((x * 13 + y * 23 + z * 37) % 71 === 0)) {
      const target = new THREE.Vector3(
        (x / (size - 1) - 0.5) * 2.1,
        (y / (size - 1) - 0.5) * 2.1,
        (z / (size - 1) - 0.5) * 2.1,
      );
      // 內部距離近似局部厚度。半徑保留上限，避免少數深層球吞掉耳、嘴等輪廓。
      target.radiusHint = clamp(-field[src] * (2.1 / size) * 0.72, 0.085, 0.23);
      target.surface = field[src] > -2.25;
      targets.push(target);
    }
    // 模型外部但被實體從多個方向包圍的窄區域，通常對應眼窩、嘴縫等凹陷。
    // 這些點只生成負 Metaball，不會把原始網格表面帶進 renderer。
    if (!topologyMask[src] && field[src] > 0 && field[src] < 3.2
      && x > 2 && y > 2 && z > 2 && x < size - 3 && y < size - 3 && z < size - 3
      && ((x * 19 + y * 29 + z * 43) % 17 === 0)) {
      let surrounding = 0;
      for (let oz = -2; oz <= 2; oz += 2) for (let oy = -2; oy <= 2; oy += 2) for (let ox = -2; ox <= 2; ox += 2) {
        if (!ox && !oy && !oz) continue;
        surrounding += topologyMask[(x + ox) + size * ((y + oy) + size * (z + oz))] ? 1 : 0;
      }
      if (surrounding >= 12) {
        const cavity = new THREE.Vector3(
          (x / (size - 1) - 0.5) * 2.1,
          (y / (size - 1) - 0.5) * 2.1,
          (z / (size - 1) - 0.5) * 2.1,
        );
        cavity.radiusHint = clamp(field[src] * (2.1 / size) * 0.62, 0.045, 0.09);
        cavityTargets.push(cavity);
      }
    }
  }
  if (!targets.length) throw new Error('模型必須是封閉實體才能轉換');
  // Accurate Liquid Formation：保留 GLB 的零等值輪廓，但先在體積域做
  // separable Gaussian smoothing，去掉硬邊與體素階梯，再交給水滴區域式生長。
  // 64³ 已提供較細的體素輪廓；維持兩次平滑，避免眼窩、眉骨等薄凹結構
  // 被過度模糊後侵蝕成孔洞。表面著色的柔順度交由 voxel-aware normal 保留。
  const liquidField = blurSignedVolume(field, size, 2);
  const liquidAtlas = new Float32Array(atlasW * atlasH).fill(24);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const src = x + size * (y + size * z);
    const ax = (z % cols) * size + x;
    const ay = Math.floor(z / cols) * size + y;
    liquidAtlas[ax + ay * atlasW] = liquidField[src];
  }
  return {
    texture: encodeFloat2D(liquidAtlas, atlasW, atlasH),
    targets,
    cavityTargets,
    grid: size,
    atlas: new THREE.Vector2(cols, rows),
    oddScanlines,
  };
}
