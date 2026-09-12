import { EDGE_TINT_TARGETS, readEdgeTintStops, sampleEdgeTint } from './edge-tint.js';

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Cyclic sampling keeps the final and first color connected across the seam.
export function sampleLoopingStops(stops, t) {
  const n = stops.length;
  if (n === 1) return stops[0].rgb;
  for (let i = 0; i < n; i++) {
    const a = stops[i], b = stops[(i + 1) % n];
    let p0 = a.p, p1 = b.p, tt = t;
    if (i === n - 1) { p1 += 1; if (t < a.p) tt = t + 1; }
    if (tt >= p0 && tt <= p1) {
      const f = (p1 > p0) ? (tt - p0) / (p1 - p0) : 0;
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f];
    }
  }
  return stops[0].rgb;
}

export function createMaterialTextureController({
  THREE,
  params: P,
  spectralCausticDefaults: SPECTRAL_CAUSTIC_DEFAULTS,
  getUniforms,
  documentRef = document,
}) {
  const document = documentRef;
/* ===== 自訂漸層查找表（LUT）===== */
let rampTex = null;
const RAMP_W = 256;
function readStops() {
  const n = Math.round(parseFloat(document.getElementById('rampCount').value));
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push({
      p: Math.min(1, Math.max(0, parseFloat(document.getElementById('stopPos' + i).value))),
      rgb: hexToRgb(document.getElementById('stopCol' + i).value),
    });
  }
  return stops;
}
function buildRampLUT() {
  if (!rampTex) return;
  const stops = readStops().sort((s1, s2) => s1.p - s2.p);
  const data = rampTex.image.data;
  for (let x = 0; x < RAMP_W; x++) {
    const c = sampleLoopingStops(stops, x / RAMP_W);
    data[x * 4] = c[0]; data[x * 4 + 1] = c[1]; data[x * 4 + 2] = c[2]; data[x * 4 + 3] = 255;
  }
  rampTex.needsUpdate = true;
}
// 面板色票 → uniform。
//
// THREE.Color 預設把色票當 sRGB，寫進 uniform 前轉成線性工作空間；但這個 shader
// 從頭到尾沒有 linear→sRGB 的輸出轉換（整套材質都是在顯示空間裡用眼睛調出來
// 的），於是那次轉換沒有人轉回來 —— 挑 #808080，畫布畫出來的是 55,55,55
// （0.5^2.2），面板旁邊 body 用的又是原始色票，兩邊對不起來。
//
// 背景色是唯一「挑什麼就該是什麼」的顏色：它是一片使用者直接看得到的純色，而且
// 亮底判斷（bgLum / whiteBackdrop）與去背輸出對白底的反乘都以它為準，值不對這些
// 都會跟著偏。所以這裡叫 THREE.Color 不要轉 —— setStyle 的第二個參數就是「這個
// 值本來就在工作空間裡」。
//
// 只有背景色這樣處理。薄膜的五個色票與兩張漸層 LUT 走同一條轉換，但它們是被人眼
// 在現況下調出來的美術輸入，改了會讓所有既有的參數組合換一個樣子。
function setBgColorUniform(hex) {
  const uniforms = getUniforms();
  if (!uniforms) return;
  uniforms.uBgColor.value.setStyle(hex, THREE.LinearSRGBColorSpace);
}

// canvas 是 position:absolute; inset:0，正常情況下完全蓋住 body，這個背景色
// 只在畫面還沒畫出第一幀（或極端縮放留出的縫）時看得到。淺底時同步成跟 shader
// 一樣的漸層，避免那個瞬間跟畫出來的漸層不一致。
function pageBackgroundCss(fallback) {
  return P.backdrop === 'light'
    ? `linear-gradient(to bottom, ${P.lightBgGradientTop}, ${P.lightBgGradientBottom})`
    : fallback;
}

function makeRampTexture() {
  rampTex = new THREE.DataTexture(new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat);
  rampTex.colorSpace = THREE.SRGBColorSpace;
  rampTex.wrapS = THREE.RepeatWrapping;
  rampTex.wrapT = THREE.ClampToEdgeWrapping;
  rampTex.minFilter = THREE.LinearFilter;
  rampTex.magFilter = THREE.LinearFilter;
  rampTex.generateMipmaps = false;
  buildRampLUT();
  return rampTex;
}

// Raw channel ratios, matching the existing single-color absorption uniforms.
// Reuse textures on reinitialization; editing one palette uploads only that LUT.
const edgeTintTextures = {};
function updateEdgeTintPalette(prefix) {
  const stops = readEdgeTintStops(P, prefix);
  const texture = edgeTintTextures[prefix];
  if (texture) {
    const data = texture.image.data;
    for (let x = 0; x < RAMP_W; x++) {
      const rgb = sampleEdgeTint(stops, (x + 0.5) / RAMP_W);
      data.set([...rgb.map(Math.round), 255], x * 4);
    }
    texture.needsUpdate = true;
  }
  const preview = document.getElementById(`${prefix}TintPreview`);
  if (preview) {
    const cssStops = Array.from({ length: 65 }, (_, i) => {
      const rgb = sampleEdgeTint(stops, i / 64).map(Math.round);
      return `rgb(${rgb.join(',')}) ${i / 64 * 100}%`;
    });
    preview.style.background = `linear-gradient(to right, ${cssStops.join(',')})`;
  }
}
function updateEdgeTintForKey(key) {
  const prefix = EDGE_TINT_TARGETS.find(target => key.startsWith(`${target}TintStop`));
  if (prefix) updateEdgeTintPalette(prefix);
}
function makeEdgeTintUniforms() {
  const result = {};
  for (const prefix of EDGE_TINT_TARGETS) {
    if (!edgeTintTextures[prefix]) {
      const texture = new THREE.DataTexture(new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat);
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      edgeTintTextures[prefix] = texture;
    }
    updateEdgeTintPalette(prefix);
    const u = `u${prefix[0].toUpperCase()}${prefix.slice(1)}`;
    result[`${u}TintRamp`] = { value: edgeTintTextures[prefix] };
    for (const suffix of ['MultiTint', 'MultiTintStrength', 'MultiTintRotation', 'MultiTintFocus']) {
      result[`${u}${suffix}`] = { value: Number(P[`${prefix}${suffix}`]) };
    }
  }
  return result;
}

/* ===== 虛擬光譜焦散七色查找表 ===== */
let spectralCausticTex = null;
function readSpectralCausticColors() {
  return SPECTRAL_CAUSTIC_DEFAULTS.map((fallback, i) => {
    const input = document.getElementById('spectralCausticCol' + i);
    return hexToRgb(input ? input.value : fallback);
  });
}
function buildSpectralCausticLUT() {
  if (!spectralCausticTex) return;
  const colors = readSpectralCausticColors();
  const data = spectralCausticTex.image.data;
  // 先算出未模糊的線性內插版本，模糊融合滑桿要用它做環形卷積的來源。
  const raw = new Array(RAMP_W);
  for (let x = 0; x < RAMP_W; x++) {
    const position = (x / (RAMP_W - 1)) * (colors.length - 1);
    const left = Math.min(colors.length - 1, Math.floor(position));
    const right = Math.min(colors.length - 1, left + 1);
    const mixAmount = position - left;
    raw[x] = [0, 1, 2].map(channel =>
      colors[left][channel] + (colors[right][channel] - colors[left][channel]) * mixAmount
    );
  }

  // 模糊融合：把七色查找表當成環形帶（首尾兩色本來就設計成同一色，見
  // SPECTRAL_CAUSTIC_DEFAULTS），對它做環繞式的重複箱形模糊,三次箱形模糊
  // 疊起來近似高斯模糊。滑桿為 0 時半徑是 0，raw 陣列原樣輸出，不動既有畫面。
  const blend = Math.min(1, Math.max(0, P.spectralCausticBlend || 0));
  const radius = Math.round(blend * RAMP_W * 0.5);
  let blurred = raw;
  if (radius > 0) {
    for (let pass = 0; pass < 3; pass++) {
      const next = new Array(RAMP_W);
      for (let x = 0; x < RAMP_W; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = -radius; k <= radius; k++) {
          const src = blurred[((x + k) % RAMP_W + RAMP_W) % RAMP_W];
          r += src[0]; g += src[1]; b += src[2];
        }
        const n = radius * 2 + 1;
        next[x] = [r / n, g / n, b / n];
      }
      blurred = next;
    }
  }

  for (let x = 0; x < RAMP_W; x++) {
    data[x * 4 + 0] = Math.round(blurred[x][0]);
    data[x * 4 + 1] = Math.round(blurred[x][1]);
    data[x * 4 + 2] = Math.round(blurred[x][2]);
    data[x * 4 + 3] = 255;
  }
  spectralCausticTex.needsUpdate = true;
}
function makeSpectralCausticTexture() {
  spectralCausticTex = new THREE.DataTexture(
    new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat
  );
  spectralCausticTex.colorSpace = THREE.SRGBColorSpace;
  spectralCausticTex.wrapS = spectralCausticTex.wrapT = THREE.ClampToEdgeWrapping;
  spectralCausticTex.minFilter = spectralCausticTex.magFilter = THREE.LinearFilter;
  spectralCausticTex.generateMipmaps = false;
  buildSpectralCausticLUT();
  return spectralCausticTex;
}

  return {
    buildRampLUT,
    buildSpectralCausticLUT,
    makeEdgeTintUniforms,
    makeRampTexture,
    makeSpectralCausticTexture,
    pageBackgroundCss,
    setBgColorUniform,
    updateEdgeTintForKey,
    updateEdgeTintPalette,
  };
}
