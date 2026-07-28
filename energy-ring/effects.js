/* ===== 雜訊工具（層疊正弦，穩定又便宜）===== */
function n1(x) { // 1D pseudo-noise, ~[-1,1]
  return Math.sin(x) * 0.55 + Math.sin(x * 2.13 + 1.7) * 0.3 + Math.sin(x * 4.7 + 0.4) * 0.15;
}
// 沿環方向專用：整數諧波 → 以 2π 為週期，繞一圈首尾必定無縫接合
function pn(t, f, seed) {
  return Math.sin(t * f + seed) * 0.55 +
         Math.sin(t * f * 2 + seed * 1.7 + 1.7) * 0.3 +
         Math.sin(t * f * 5 + seed * 2.3 + 0.4) * 0.15;
}

/* ===== Loop Animation 核心：把「一直往前跑的時間」換成「繞一圈精確歸零的相位」=====
   loopPhase 每經過 P.loopSec 秒就精確增加 2π，只要所有雜訊呼叫都用它的整數倍當引數，
   動畫在 t=0 與 t=loopSec 的畫面就會逐像素完全相同 → 天生無縫循環，不用再找「第幾幀開始重複」。 */
const TWO_PI = Math.PI * 2;
// CASE 1／3：時間項直接當 pn()/vn4() 的「t」或「角度」引數 → 只需是 loopPhase 的整數倍即可安全循環
function loopN(loopSec, coef) {
  return Math.max(1, Math.round(coef * loopSec / TWO_PI));
}
// CASE 2：時間項是加進 pn() 的「seed」引數（seed 內部會被乘上 1.7 / 2.3 兩個諧波係數）
// 兩者的最小公倍分母是 10，因此時間項必須是 20π 的整數倍，才能讓三個諧波同時精確回到原值
function loopSeedTerm(loopSec, loopPhase, coef) {
  const n = Math.max(1, Math.round(Math.abs(coef) * loopSec / (TWO_PI * 10)));
  return Math.sign(coef || 1) * loopPhase * 10 * n;
}

/* ===== 環的每一圈固定屬性（避免每幀隨機跳動）===== */
const RING_SEEDS = Array.from({ length: 24 }, (_, i) => ({
  radiusJitter: (Math.random() - 0.5) * 2,     // 半徑微偏
  phase: Math.random() * Math.PI * 2,          // 亮度相位
  speedMul: 0.75 + Math.random() * 0.55,       // 各環轉速略不同 → 流動感
  freq: 2 + Math.floor(Math.random() * 3),     // 亮度波瓣數
  widthMul: 0.7 + Math.random() * 0.7,
}));

/* ===== 電漿火花粒子（確定性排程版：可無縫循環）=====
   不用 Math.random() 即時噴發，改用固定種子預先生成一批「虛擬火花」：
   每顆有固定的出生時刻（均勻散佈在循環內）與壽命，渲染時以 (目前時間 mod 循環秒數) 算年齡，
   位置用封閉式公式從年齡直接算出（不逐幀積分）→ 每一循環的火花軌跡逐幀完全相同。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SPARK_MAX_RATE = 360; // sparkAmount=1 時每秒的火花數（對齊舊版「每幀 6 顆 × 60fps」的密度）
let sparkPool = [], sparkPoolKey = '';
function getSparkPool(loopSec) {
  const key = loopSec.toFixed(3);
  if (sparkPoolKey === key) return sparkPool;
  sparkPoolKey = key;
  const count = Math.ceil(SPARK_MAX_RATE * loopSec);
  const rnd = mulberry32(1234567);
  sparkPool = Array.from({ length: count }, (_, i) => ({
    birth: (i + rnd() * 0.9) / count * loopSec, // 均勻散佈 + 些許抖動
    maxLife: 0.7 + rnd() * 1.4,
    size: 1.5 + rnd() * 4.5,
    seed: rnd() * 100,
    angJitter: rnd() - 0.5,          // 在噴發扇區內的位置（-0.5..0.5，乘上即時的扇區角）
    speed0: 20 + rnd() * 60,         // 徑向初速（未乘 sparkReach）
    velScale: 0.4 + rnd() * 0.8,
    tangent: (rnd() - 0.5) * 40,     // 切線加速 → 掃過去的感覺
  }));
  return sparkPool;
}

/* ===== 吸積粒子（確定性排程版：可無縫循環）=====
   跟火花完全獨立的另一套池子：粒子從環外某個半徑往核心「向內」墜落，同時繞著核心螺旋，
   落到核心時淡出並閃一下。一樣用固定種子 + 年齡取模 + 封閉式位置公式 → 每一循環逐幀相同。 */
const ACC_MAX_RATE = 90; // accAmount=1 時每秒的吸積粒子數
let accPool = [], accPoolKey = '';
function getAccretionPool(loopSec) {
  const key = loopSec.toFixed(3);
  if (accPoolKey === key) return accPool;
  accPoolKey = key;
  const count = Math.ceil(ACC_MAX_RATE * loopSec);
  const rnd = mulberry32(5551212);
  accPool = Array.from({ length: count }, (_, i) => ({
    birth: (i + rnd() * 0.9) / count * loopSec, // 均勻散佈 + 些許抖動
    maxLife: 0.8 + rnd() * 1.2,
    angle0: rnd() * Math.PI * 2,          // 出生角（環外某處）
    startJitter: 0.7 + rnd() * 0.6,       // 起始半徑的個體差異（乘上起始距離滑桿）
    spiralDir: rnd() < 0.5 ? -1 : 1,      // 螺旋方向（順/逆各半）
    spiralTurns: 0.5 + rnd() * 1.5,       // 墜落全程繞核心的圈數
    size: 1 + rnd() * 3,
    briT: 0.4 + rnd() * 0.6,
    seed: rnd() * 100,
  }));
  return accPool;
}

/* ===== 環間電弧（確定性排程版：可無縫循環）=====
   跟火花同一套思路：固定種子池預生成整循環的電弧事件，每道有固定出生時刻與短壽命，
   渲染時以年齡取模判斷是否活著。鋸齒路徑的「重擲」用 floor(age × 頻率) 當亂數種子 →
   同一道電弧在生命期內會頻閃換形，但形狀只取決於年齡，天生無縫循環。 */
const ARC_MAX_RATE = 5; // arcAmount=1 時每秒的電弧數
let arcPool = [], arcPoolKey = '';
function getArcPool(loopSec) {
  const key = loopSec.toFixed(3);
  if (arcPoolKey === key) return arcPool;
  arcPoolKey = key;
  const count = Math.ceil(ARC_MAX_RATE * loopSec);
  const rnd = mulberry32(9182736);
  arcPool = Array.from({ length: count }, (_, i) => ({
    birth: (i + rnd() * 0.9) / count * loopSec, // 均勻散佈 + 些許抖動
    maxLife: 0.15 + rnd() * 0.25,
    angle0: rnd() * Math.PI * 2,
    spanT: 0.4 + rnd() * 0.6,        // 個體跨幅差異（乘上跨幅滑桿）
    ringA: rnd(), ringB: rnd(),      // 0..1，映射到當下的環索引（環數改變也不用重生池）
    seed: Math.floor(rnd() * 1e9),
  }));
  return arcPool;
}

/* ===== 星辰粒子（固定不消散版）=====
   跟電漿火花是獨立的一層：沒有生命週期，單純固定分佈在環外側、跟著環旋轉。
   同樣用固定種子池 + 封閉式角度公式 → 每顆星星的位置只取決於「目前時間」，天生無縫循環。 */
// 星辰的獨立畫布：每幀清空重畫，跟主畫布的拖尾殘影完全隔離（見下方渲染區塊的說明）
const starCanvas = document.createElement('canvas');
const starCtx = starCanvas.getContext('2d');
let starPool = [], starPoolKey = -1;
function getStarPool(count) {
  if (starPoolKey === count) return starPool;
  starPoolKey = count;
  const rnd = mulberry32(7654321);
  starPool = Array.from({ length: count }, () => ({
    angle0: rnd() * Math.PI * 2,
    radiusFactor: Math.sqrt(rnd()),   // 開根號 → 面積均勻分布，不會擠在內圈
    sizeT: rnd(),                     // 0..1，配合當下的最小/最大顆粒插值
    briT: 0.35 + rnd() * 0.65,        // 每顆星星固定的亮度差異（靜態，不影響循環）
    seed: rnd() * 100,
  }));
  return starPool;
}

/* ===== 放射狀光芒（god rays）：從環面往外放射的錐形光束，基部亮、往外收尖淡出 =====
   數量是密度滑桿（0-1），所以池子固定生成夠多筆，密度只決定要畫前面幾筆，不需要重新生成。 */
const SPIKE_POOL_MAX = 260;
const SPIKE_POOL = (() => {
  const rnd = mulberry32(2468013);
  return Array.from({ length: SPIKE_POOL_MAX }, () => ({
    angle0: rnd() * Math.PI * 2,
    // 長度用非線性分布：多數中短、少數特別長 → 放射光芒的長短交錯質感
    lenT: Math.pow(rnd(), 2.2),
    widT: rnd(),                    // 0..1，基部粗細的個體差異
    baseJitter: (rnd() - 0.5) * 2,  // 基部沿半徑的微偏，讓起點不是死板同一圈
    briT: 0.35 + rnd() * 0.65,
  }));
})();
// 放射光芒的獨立緩衝畫布：先畫銳利的錐形，再整層模糊做出柔邊 god-ray 質感
const spikeCanvas = document.createElement('canvas');
const spikeCtx = spikeCanvas.getContext('2d');

// 全域 Bloom 的獨立緩衝畫布：故意用縮小的解析度畫，放大回去時自帶柔化，
// 疊加 CSS filter 的模糊只是再加強一點，同時大幅省下模糊運算的成本
const bloomCanvas = document.createElement('canvas');
const bloomCtx = bloomCanvas.getContext('2d');

/* ===== 太陽米粒組織：低解析 3D FBM 雜訊逐格重算 → 放大成翻騰的對流紋理 ===== */
const SUN_N = 128; // 雜訊紋理解析度（放大後靠平滑內插，故意低解析以求效能與柔和感）
const sunCanvas = document.createElement('canvas');
sunCanvas.width = sunCanvas.height = SUN_N;
const sunCtx = sunCanvas.getContext('2d');
const sunImg = sunCtx.createImageData(SUN_N, SUN_N);

// 4D value noise（時間用 (cos,sin) 兩維繞圓圈取樣 → 對流胞會融合、分裂、翻騰而非平移，且可無縫循環）
const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
// 4D value noise：多一維 w，時間可用 (cos θ, sin θ) 當 (z,w) 沿圓圈取樣 → 繞一圈後座標精確歸位，
// 天生無縫循環（比起讓 z 隨時間一直增加，繞圈取樣不需要「回頭銜接」，起點終點本來就是同一點）。
function vn4(x, y, z, w) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), wi = Math.floor(w);
  const xf = x - xi, yf = y - yi, zf = z - zi, wf = w - wi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const s = zf * zf * (3 - 2 * zf), t = wf * wf * (3 - 2 * wf);
  const h = (a, b, c, d) => PERM[(PERM[(PERM[(PERM[a & 255] + b) & 255] + c) & 255] + d) & 255] / 255;
  const l = (a, b, k) => a + (b - a) * k;
  const corner = (dz, dw) => l(
    l(h(xi, yi, zi + dz, wi + dw),     h(xi + 1, yi, zi + dz, wi + dw),     u),
    l(h(xi, yi + 1, zi + dz, wi + dw), h(xi + 1, yi + 1, zi + dz, wi + dw), u),
    v
  );
  return l(l(corner(0, 0), corner(1, 0), s), l(corner(0, 1), corner(1, 1), s), t);
}

// 亮度 → RGB 色階表（暗紅 → 橙 → 亮黃白），色相跟主色走，換色時才重算
let sunLUT = null, sunLUTKey = '';
function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function buildSunLUT() {
  const key = Q.hue + '_' + Q.sat;
  if (sunLUTKey === key) return;
  sunLUTKey = key;
  sunLUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const q = i / 255;
    // 暗部偏深色低亮度、亮部色相微偏暖並拉高亮度 → 對流胞的立體感
    const [r, g, b] = hsl2rgb(Q.hue + q * 18 - 6, Q.sat, 8 + q * 64);
    sunLUT[i * 3] = r; sunLUT[i * 3 + 1] = g; sunLUT[i * 3 + 2] = b;
  }
}

const SUN_EXT = 1.38; // 紋理涵蓋範圍（環半徑的倍數）
const SUN_TURNS = [3, 5, 8]; // 3 個八度各自每循環繞的圈數（取相異整數避免同步重複）
function drawSunTexture(rotA, loopPhase) {
  buildSunLUT();
  const data = sunImg.data;
  const freq = 3.5 + (1 - Q.granuleSize) * 10.5; // 米粒大小 → 雜訊頻率（越大顆頻率越低）
  const inten = Math.min(1, Q.granule);
  const ca = Math.cos(rotA), sa = Math.sin(rotA); // 表層跟著環旋轉
  // 對流翻騰的時間軸改成繞圓圈取樣（circle-embedding）：半徑決定一次循環內變化的幅度（翻騰速度）
  const gRad = 1.6 * Math.max(0.15, Q.granuleSpeed);
  const octCirc = SUN_TURNS.map(nT => { const a = loopPhase * nT; return [Math.cos(a) * gRad, Math.sin(a) * gRad]; });
  for (let py = 0; py < SUN_N; py++) {
    const ny = ((py / SUN_N) * 2 - 1) * SUN_EXT;
    for (let px = 0; px < SUN_N; px++) {
      const idx = (py * SUN_N + px) * 4;
      const nx = ((px / SUN_N) * 2 - 1) * SUN_EXT;
      // 帶狀遮罩：貼著環表面（rho=1），內側收得快、外側像日冕拖尾較長
      const rho = Math.sqrt(nx * nx + ny * ny);
      const dR = rho - 1.0;
      const prof = Math.exp(-(dR * dR) / (dR < 0 ? 0.010 : 0.050));
      if (prof < 0.02) { data[idx + 3] = 0; continue; }
      // 取樣座標隨環旋轉 → 對流層跟著環轉動
      const rx = nx * ca + ny * sa, ry = -nx * sa + ny * ca;
      // 3 個八度的 billow 亂流：亮胞平原 + 細窄暗縫（米粒組織的特徵）
      let tv = 0, amp = 0.55, f = 1;
      for (let o = 0; o < 3; o++) {
        const [zc, zs] = octCirc[o];
        tv += amp * Math.abs(2 * vn4(rx * freq * f + 37, ry * freq * f + 19, zc, zs) - 1);
        f *= 2.15; amp *= 0.5;
      }
      let c = 1 - tv * 1.4;          // 反轉：胞內亮、縫隙暗
      c = (c - 0.22) * 1.75;         // 拉對比
      if (c < 0) c = 0; else if (c > 1) c = 1;
      c *= 0.35 + 0.65 * prof;       // 離表面越遠越暗
      const q = (c * 255) | 0;
      data[idx] = sunLUT[q * 3]; data[idx + 1] = sunLUT[q * 3 + 1]; data[idx + 2] = sunLUT[q * 3 + 2];
      data[idx + 3] = 255 * inten * prof;
    }
  }
  sunCtx.putImageData(sunImg, 0, 0);
}

/* ===== 流體煙霧：domain warping（雜訊扭曲雜訊座標）→ 墨水般的流體紋理 ===== */
const SMOKE_N = 192, SMOKE_EXT = 2.3;
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = smokeCanvas.height = SMOKE_N;
const smokeCtx = smokeCanvas.getContext('2d');
const smokeImg = smokeCtx.createImageData(SMOKE_N, SMOKE_N);
let smokeTick = 0;
const SMOKE_TURNS = [4, 6, 10, 13]; // fbm4 四個八度各自每循環繞的圈數（大略對應原本 1x/1.6x/2.4x/3.2x 的相對演化速度)

function fbm4(x, y, circles) { // 4 個八度的平滑雜訊（末段高頻讓絲縷更銳利），時間軸皆為圓圈取樣
  return vn4(x, y, circles[0][0], circles[0][1]) * 0.5 +
         vn4(x * 2.1, y * 2.1, circles[1][0], circles[1][1]) * 0.27 +
         vn4(x * 4.3, y * 4.3, circles[2][0], circles[2][1]) * 0.15 +
         vn4(x * 8.7, y * 8.7, circles[3][0], circles[3][1]) * 0.08;
}

function drawSmokeTexture(rotA, loopPhase) {
  buildSunLUT(); // 共用色階表
  const data = smokeImg.data;
  const sc = 1.6 * Q.smokeScale;
  const inten = Math.min(1, Q.smoke);
  const kDecay = 1.7 / Math.max(0.2, Q.smokeReach); // 擴散範圍 → 徑向衰減
  const ca = Math.cos(rotA), sa = Math.sin(rotA);
  const spd = Math.max(0.15, Q.smokeSpeed);
  // domain warping 與 fbm 的時間軸都改成繞圓圈取樣，半徑＝一次循環內的變化幅度（取代原本的翻騰速度）
  const wRad = 1.2 * spd, fRad = 1.3 * spd;
  const wAngX = loopPhase * 5, wAngY = loopPhase * 6 + 13;
  const wcx = Math.cos(wAngX) * wRad, wcy = Math.sin(wAngX) * wRad;
  const wdx = Math.cos(wAngY) * wRad, wdy = Math.sin(wAngY) * wRad;
  const fCircles = SMOKE_TURNS.map(nT => { const a = loopPhase * nT; return [Math.cos(a) * fRad, Math.sin(a) * fRad]; });
  for (let py = 0; py < SMOKE_N; py++) {
    const ny = ((py / SMOKE_N) * 2 - 1) * SMOKE_EXT;
    for (let px = 0; px < SMOKE_N; px++) {
      const idx = (py * SMOKE_N + px) * 4;
      const nx = ((px / SMOKE_N) * 2 - 1) * SMOKE_EXT;
      const rho = Math.sqrt(nx * nx + ny * ny);
      if (rho < 0.7 || rho > SMOKE_EXT - 0.05) { data[idx + 3] = 0; continue; }
      // 徑向包絡：環表面外側升起、越遠越淡
      const rise = rho < 1 ? Math.max(0, (rho - 0.7) / 0.3) : Math.exp(-(rho - 1) * kDecay);
      if (rise < 0.03) { data[idx + 3] = 0; continue; }
      const rx = nx * ca + ny * sa, ry = -nx * sa + ny * ca;
      // domain warping：先取一次低頻雜訊當座標偏移 → 流體的拉絲、捲曲感
      const wx = vn4(rx * sc * 0.9 + 11, ry * sc * 0.9 + 71, wcx, wcy);
      const wy = vn4(rx * sc * 0.9 + 41, ry * sc * 0.9 + 23, wdx, wdy);
      let v = fbm4(rx * sc + (wx - 0.5) * 2.6, ry * sc + (wy - 0.5) * 2.6, fCircles);
      v = (v - 0.32) * 2.2;
      if (v < 0) v = 0; else if (v > 1) v = 1;
      const a = v * rise * inten;
      if (a < 0.015) { data[idx + 3] = 0; continue; }
      // 用色階表的中低段 → 暗色霧狀（不會蓋過主環的亮度）
      const q = (40 + v * 130) | 0;
      data[idx] = sunLUT[q * 3]; data[idx + 1] = sunLUT[q * 3 + 1]; data[idx + 2] = sunLUT[q * 3 + 2];
      data[idx + 3] = 255 * a * 0.55;
    }
  }
  smokeCtx.putImageData(smokeImg, 0, 0);
}
