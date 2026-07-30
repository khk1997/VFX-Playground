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

function encode2D(field, w, h, range = 24) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round(clamp(0.5 + field[i] / (range * 2), 0, 1) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
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

export async function svgToField(file, size = 160) {
  const text = await file.text();
  if (!/<svg[\s>]/i.test(text)) throw new Error('不是有效的 SVG');
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pad = 12;
    const scale = Math.min((size - pad * 2) / Math.max(1, img.width), (size - pad * 2) / Math.max(1, img.height));
    const dw = img.width * scale, dh = img.height * scale;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = x + y * size;
      mask[i] = pixels[i * 4 + 3] > 32 ? 1 : 0;
    }
    const field = chamferSigned(mask, size, size);
    const targets = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = x + y * size;
      if (!mask[i] || (x * 17 + y * 31) % 29 !== 0) continue;
      const target = new THREE.Vector3(
        (x / (size - 1) - 0.5) * 3,
        (0.5 - y / (size - 1)) * 3,
        0,
      );
      // SVG 只當作球心分布模具；局部 2D 內距決定水滴尺寸，使寬區域鼓起、
      // 細部由小滴補足，而不是直接顯示原始向量硬邊。
      target.radiusHint = clamp(-field[i] * (3 / size) * 0.58, 0.09, 0.24);
      target.surface = field[i] > -3.0;
      targets.push(target);
    }
    if (!targets.length) throw new Error('SVG 沒有可見的填色區域');
    return {
      texture: encode2D(field, size, size),
      targets,
      cavityTargets: [],
      grid: 0,
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
