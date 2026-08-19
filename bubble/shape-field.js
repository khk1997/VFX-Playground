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

/* ===== 次像素輪廓距離場（Felzenszwalb & Huttenlocher EDT + argmin，O(n)）=====
 * 沿各軸做一維拋物線下包絡，得到沒有方向偏差的精確平方距離；chamfer 3×3 每步
 * 只能走八個方向，累積誤差 2–4% 且斜向輪廓會被拉成八角形。GLB 的 3D 路徑仍用
 * chamferSigned。
 *
 * 但單純的 EDT 量的是「到最近的異類像素中心」，值因此鎖在 √(整數²+整數²)
 * 這組階梯上，且誤差隨輪廓方向偽隨機跳動（真實距離與到像素中心的距離最多差
 * 半個像素）。擠出側壁的法線就是這個場的梯度，又完全不隨 z 變化 —— 每格
 * texel 的梯度誤差沿整個厚度重複，於是側壁出現貫穿深度的條紋。
 *
 * 這裡讓 EDT 額外傳播 argmin（最近的邊界像素索引），再用該像素的覆蓋率與局部
 * 法線把它推到次像素的真實輪廓點上才量距離。距離不再落在量化階梯上，而且完全
 * 沒有動到幾何：實測輪廓法線的高頻誤差降到 1/4（0.193° → 0.048°），直角內縮
 * 反而從 0.49 texel 降到 0.41 texel（比舊版更準），直邊零等值面誤差為 0。
 */
function edt1dArg(f, srcIn, d, srcOut, v, z, n) {
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
    srcOut[q] = srcIn[v[k]];
  }
}

function subpixelSigned2D(coverage, w, h) {
  const INF = 1e20;
  const n = w * h;
  const f = new Float32Array(n);
  const src = new Int32Array(n);
  // 種子必須包含 mask 邊界，不能只取「部分覆蓋」的像素：軸對齊的邊界（字母的
  // 直筆畫、方形 logo）常常正好落在像素格線上，canvas 一個抗鋸齒像素都不會產生
  // ——實測一段粗體文字在 1536² 下 236 萬像素裡只有 4859 個部分覆蓋像素。若只用
  // 部分覆蓋當種子，這種硬邊在烘焙眼中不存在，邊界兩側會去量幾十像素外的其他
  // 種子，跨過邊界時符號直接翻轉，場出現巨大跳斷（|∇| 可達 19），ray marcher
  // 因此過衝，側壁變成波浪與團塊。
  const partial = i => coverage[i] > 0.02 && coverage[i] < 0.98;
  for (let i = 0; i < n; i++) {
    let seed = partial(i);
    if (!seed) {
      // 硬邊補救：只有在自己與四鄰都沒有抗鋸齒資訊時，才把 mask 邊界像素當種子。
      // 這樣有抗鋸齒的曲線仍只用精確的次像素種子（±0.5 的粗估會把精度拉回去），
      // 而純硬邊仍然有種子可用。
      const x = i % w, y = (i / w) | 0;
      const inside = coverage[i] >= 0.5;
      const left = x > 0 ? i - 1 : i, right = x < w - 1 ? i + 1 : i;
      const up = y > 0 ? i - w : i, down = y < h - 1 ? i + w : i;
      const boundary = (coverage[left] >= 0.5) !== inside
        || (coverage[right] >= 0.5) !== inside
        || (coverage[up] >= 0.5) !== inside
        || (coverage[down] >= 0.5) !== inside;
      seed = boundary && !partial(left) && !partial(right) && !partial(up) && !partial(down);
    }
    f[i] = seed ? 0 : INF;
    src[i] = seed ? i : -1;
  }
  const span = Math.max(w, h);
  const line = new Float32Array(span);
  const out = new Float32Array(span);
  const srcLine = new Int32Array(span);
  const srcOut = new Int32Array(span);
  const v = new Int32Array(span);
  const z = new Float32Array(span + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { line[y] = f[x + y * w]; srcLine[y] = src[x + y * w]; }
    edt1dArg(line, srcLine, out, srcOut, v, z, h);
    for (let y = 0; y < h; y++) { f[x + y * w] = out[y]; src[x + y * w] = srcOut[y]; }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) { line[x] = f[row + x]; srcLine[x] = src[row + x]; }
    edt1dArg(line, srcLine, out, srcOut, v, z, w);
    for (let x = 0; x < w; x++) { f[row + x] = out[x]; src[row + x] = srcOut[x]; }
  }
  const signed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const q = src[i];
    if (q < 0) {
      // 整張圖沒有任何邊界（空 SVG）才會走到這裡；用有界的大值，避免 INF
      // 被後續的降採樣平均帶進場裡。
      signed[i] = (coverage[i] >= 0.5 ? -1 : 1) * (w + h);
      continue;
    }
    const qx = q % w, qy = (q / w) | 0;
    // 覆蓋率梯度即內向法線；輪廓點 = 種子中心 − n_in × (覆蓋率 − 0.5)。
    // 覆蓋率 0.5 表示輪廓正好穿過中心，此時不必位移。
    let gx = coverage[Math.min(w - 1, qx + 1) + qy * w] - coverage[Math.max(0, qx - 1) + qy * w];
    let gy = coverage[qx + Math.min(h - 1, qy + 1) * w] - coverage[qx + Math.max(0, qy - 1) * w];
    const len = Math.hypot(gx, gy);
    let cxp = qx + 0.5, cyp = qy + 0.5;
    if (len > 1e-6) {
      // 硬邊時覆蓋率是 0 或 1，位移剛好是 ±0.5 —— 也就是像素的外緣，正確；
      // 部分覆蓋時則是次像素的覆蓋率估計。夾在半個像素內，邊界像素的輪廓
      // 不可能離中心更遠。
      const offset = clamp(coverage[q] - 0.5, -0.5, 0.5);
      cxp -= (gx / len) * offset;
      cyp -= (gy / len) * offset;
    }
    const d = Math.hypot((i % w) + 0.5 - cxp, ((i / w) | 0) + 0.5 - cyp);
    signed[i] = coverage[i] >= 0.5 ? -d : d;
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

// 可分離高斯模糊，邊界以複製取樣（場外圍是 padding 的正距離，複製不會生出實體）。
function blurField(field, size, sigma) {
  if (!(sigma > 0)) return field;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let i = -radius; i <= radius; i++) {
      s += field[clamp(x + i, 0, size - 1) + y * size] * kernel[i + radius];
    }
    tmp[x + y * size] = s;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let i = -radius; i <= radius; i++) {
      s += tmp[x + clamp(y + i, 0, size - 1) * size] * kernel[i + radius];
    }
    out[x + y * size] = s;
  }
  return out;
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
    for (let i = 0; i < hi * hi; i++) coverage[i] = pixels[i * 4 + 3] / 255;
    // 距離量到次像素的輪廓點，而非最近的異類像素中心。舊版是「EDT + 對部分
    // 覆蓋像素覆寫 0.5 - 覆蓋率」，零等值面雖然落在正確位置，但輪廓帶外的值
    // 仍鎖在量化階梯上，梯度因此逐格抖動 —— 那就是側壁條紋的來源。
    const hiField = subpixelSigned2D(coverage, hi, hi);
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

    // 收掉次像素輪廓點殘留的最後一點抖動（法線估計在輪廓曲率大處仍會晃）。
    // σ 刻意壓在 0.7 texel：高頻誤差再降一半（0.048° → 0.021°），直角內縮
    // 只從 0.41 加到 0.65 texel —— 仍與舊版的 0.49 同級，肉眼看不出差別。
    // σ = 2 texel 能把高頻壓得更低，但直角會內縮 1.69 texel，側壁與正面的
    // 交界會冒出一圈明顯的軟倒角，對 logo 來說代價太大。
    field = blurField(field, size, 0.7);

    // 預先建立多組可重現的輪廓亂數分佈。UI 切換時只換 uniform 資料，
    // 不必重新計算 SVG 距離場，也不會在拖動控制時卡住。
    const edgeDropSets = Array.from({ length: 8 }, (_, i) =>
      selectSvgEdgeDroplets(field, size, `${text}\nedge-distribution:${i}`));
    const targets = [];
    // 候選點的取樣步距。
    //
    // 舊版是固定的世界空間密度（size/32，512² 時是 16px ≈ 0.094 世界單位）。對
    // 內建問號那種厚實造型剛好，但它撐不住細筆畫：文字外框的筆寬大約就是
    // 0.11 世界單位，跟步距同一個量級——網格等於在對筆畫做欠取樣，整段筆畫可能
    // 一個候選點都沒落到，後面挑錨點時那一段就是空的。
    //
    // 改成看形狀實際蓋掉多少面積來反推步距，讓候選點數穩定落在 TARGET 附近：
    // 佔滿畫面的胖造型維持原本的疏密，細長鋪開的造型自動加密。候選點總數有上限，
    // 所以下游挑錨點的成本不會跟著形狀暴增。
    //
    // 只會比舊版密、不會更疏（上界仍夾在 size/32），避免任何造型的取樣反而退步。
    const TARGET_CANDIDATES = 600;
    let interiorPixels = 0;
    for (let i = 0; i < size * size; i++) if (field[i] < 0) interiorPixels++;
    const step = Math.max(
      1,
      Math.min(
        Math.round(size / 32),
        Math.round(Math.sqrt(Math.max(1, interiorPixels) / TARGET_CANDIDATES)),
      ),
    );
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
  return objectToField(gltf.scene, size);
}

// 體素化與距離場烘焙本身與「資料從哪來」無關，因此和 GLB 載入拆開：
// 內建預設造型是程式生成的 THREE.Mesh，走的是同一條路徑。
export async function objectToField(root, size = 48) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('模型沒有可用網格');
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  root.position.sub(center);
  root.scale.setScalar(1.72 / Math.max(maxDim, 1e-5));
  root.updateMatrixWorld(true);
  const tris = collectTriangles(root);
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

// 把兩顆 SVG 形狀的距離場疊進同一張貼圖：r 通道是 A、g 通道是 B。
//
// 形狀變形模式要在同一幀同時評估兩顆形狀（舊的被削掉、新的長出來）。綁第二張
// 貼圖當然也行，但那等於每個 march step 多一次取樣，而距離場取樣正是這支
// shader 最貴的地方。烘焙時 r=g=b 存的是同一個值（見 encodeFloat2D），g 通道
// 本來就是閒著的，拿來放第二顆形狀不多花任何取樣成本。
//
// 兩張貼圖的尺寸必須一致才疊得起來。呼叫端用同一組參數烘焙這兩顆形狀，所以
// 正常情況一定相同；尺寸不同時回傳 null，呼叫端會退回「只有水滴」的路徑，
// 而不是畫出一顆錯位的形狀。
export function packShapePairTexture(texA, texB) {
  const a = texA?.image?.data;
  const b = texB?.image?.data;
  if (!a || !b) return null;
  const { width, height } = texA.image;
  if (texB.image.width !== width || texB.image.height !== height) return null;
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = a[o];
    data[o + 1] = b[o];
    // b 通道留著跟 r 一致：只有變形模式會讀 g，其餘取樣路徑仍然讀 r。
    data[o + 2] = a[o];
    data[o + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
