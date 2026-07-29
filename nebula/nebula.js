'use strict';

// 預覽嵌入模式（?preview=1）：隱藏 UI，只留純畫面，並限制粒子數量以節省效能
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');
const PREVIEW_MAX_COUNT = 1200;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
}
window.addEventListener('resize', resize);
resize();

/* ===== 參數 ===== */
const DEFAULTS = {
  count: 3500, size: 1.4, speed: 1, trail: 0.88,
  flowScale: 1, flowSpeed: 0.35, flowStrength: 1.2,
  mouseForce: 1.2,
  hue: 200, hueShift: 90, sat: 90,
};
const P = { ...DEFAULTS, repel: false, mode: 'nebula' };

const fmt = {
  count: v => Math.round(v),
  hue: v => v + '°', hueShift: v => v + '°', sat: v => v + '%',
};
function bindControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const update = () => {
      P[key] = parseFloat(el.value);
      if (valEl) valEl.textContent = (fmt[key] || (v => v.toFixed ? +v.toFixed(2) : v))(P[key]);
    };
    el.addEventListener('input', update);
    el.value = P[key];
    update();
  }
  document.getElementById('repel').addEventListener('change', e => { P.repel = e.target.checked; });
}
bindControls();

/* ===== 模式切換 ===== */
const MODE_BTNS = { nebula: 'modeNebula', vortex: 'modeVortex', burst: 'modeBurst' };
function setMode(mode) {
  P.mode = mode;
  for (const [m, id] of Object.entries(MODE_BTNS)) {
    document.getElementById(id).classList.toggle('active', m === mode);
  }
  if (mode === 'burst') burstTimer = 0.5; // 進入爆發模式時很快先爆一次
}
for (const [m, id] of Object.entries(MODE_BTNS)) {
  document.getElementById(id).addEventListener('click', () => setMode(m));
}

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS);
  document.getElementById('repel').checked = P.repel = false;
  bindControls();
  setMode('nebula');
});

/* ===== 播放 / 暫停 ===== */
let paused = false, msgPaused = false;
const pauseBtn = document.getElementById('playCtl');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ 播放' : '⏸ 暫停';
  syncLoop();
});
// 預覽卡片用 postMessage 控制暫停/續播（首頁滾出視野時省電）
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') msgPaused = true;
  else if (e.data === 'vfx-play') msgPaused = false;
  else return;
  syncLoop();
});
document.addEventListener('visibilitychange', () => {
  syncLoop();
});

/* ===== 面板開關 ===== */
const panel = document.getElementById('panel');
document.getElementById('toggleBtn').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
});

/* ===== 滑鼠 / 觸控互動 ===== */
const mouse = { x: 0, y: 0, active: false };
function setPointer(x, y) { mouse.x = x; mouse.y = y; mouse.active = true; }
window.addEventListener('mousemove', e => setPointer(e.clientX, e.clientY));
window.addEventListener('mouseleave', () => { mouse.active = false; });
window.addEventListener('touchstart', e => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); }, { passive: true });
window.addEventListener('touchmove', e => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); }, { passive: true });
window.addEventListener('touchend', () => { mouse.active = false; });

/* ===== 廉價的 pseudo-curl 流場：層疊三角函數 value-noise =====
   potential(x,y,t) 是一個平滑的純量場；取其偏導旋轉 90°（curl）→ 得到無散度的流向，
   粒子沿著它走會形成自然的捲曲絲縷而不會全部堆積到同一處。偏導用中央差分近似。 */
function potential(x, y, t) {
  return Math.sin(x * 1.7 + t * 0.9) * Math.cos(y * 1.3 - t * 0.7)
       + 0.55 * Math.sin(x * 3.1 - y * 2.3 + t * 1.3)
       + 0.35 * Math.cos(x * 5.3 + y * 4.1 - t * 1.9)
       + 0.7 * Math.sin(y * 2.1 + t * 0.5 + Math.sin(x * 1.1 + t * 0.3) * 1.5);
}
const EPS = 0.01;
function curl(x, y, t, out) {
  const dpdx = (potential(x + EPS, y, t) - potential(x - EPS, y, t)) / (2 * EPS);
  const dpdy = (potential(x, y + EPS, t) - potential(x, y - EPS, t)) / (2 * EPS);
  out.x = dpdy;   // 旋轉 90° → 沿等位線流動（divergence-free）
  out.y = -dpdx;
}

/* ===== 粒子系統（typed arrays 以支撐 8000 顆）===== */
const MAX_N = 8000;
const px = new Float32Array(MAX_N), py = new Float32Array(MAX_N);
const vx = new Float32Array(MAX_N), vy = new Float32Array(MAX_N);
const pseed = new Float32Array(MAX_N);
let aliveN = 0;

function spawn(i) {
  px[i] = Math.random() * W;
  py[i] = Math.random() * H;
  vx[i] = (Math.random() - 0.5) * 20;
  vy[i] = (Math.random() - 0.5) * 20;
  pseed[i] = Math.random();
}
function ensureCount(n) {
  n = Math.min(MAX_N, Math.round(n));
  if (PREVIEW) n = Math.min(n, PREVIEW_MAX_COUNT);
  while (aliveN < n) { spawn(aliveN); aliveN++; }
  if (aliveN > n) aliveN = n; // 縮減直接截斷即可
  return aliveN;
}

/* ===== 爆發模式的排程 ===== */
let burstTimer = 1.2;          // 距下次爆炸的秒數
const BURST_PERIOD = 3.2;      // 爆炸週期
let burstFlash = 0;            // 爆炸瞬間的核心閃光餘量

/* ===== 主迴圈 ===== */
let last = performance.now();
let flowT = 0;
let rafId = 0;
const tmpV = { x: 0, y: 0 };

function syncLoop() {
  if (paused || msgPaused || document.hidden) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    return;
  }
  if (!rafId) {
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); // dt 上限 50ms
  last = now;
  step(dt);
  draw();
}

function step(dt) {
  const n = ensureCount(P.count);
  flowT += dt * P.flowSpeed;
  const cx = W / 2, cy = H / 2;
  const minDim = Math.min(W, H) || 1;
  const scale = (P.flowScale * 4) / minDim; // 螢幕座標 → 雜訊座標
  const flowF = P.flowStrength * 90;        // 流場推力（px/s² 等級）
  const spd = P.speed;
  const mode = P.mode;
  const mForce = P.mouseForce * 60000;
  const repelSign = P.repel ? -1 : 1;

  // 爆發模式排程
  let burstKick = 0;
  if (mode === 'burst') {
    burstTimer -= dt;
    if (burstTimer <= 0) {
      burstTimer += BURST_PERIOD;
      burstKick = 1;
      burstFlash = 1;
    }
  }
  burstFlash = Math.max(0, burstFlash - dt * 1.8);

  const drag = Math.exp(-dt * 1.6); // 阻尼：速度自然衰減，讓流場主導

  for (let i = 0; i < n; i++) {
    let x = px[i], y = py[i];

    // --- 流場力（三種模式都吃，星雲模式為主導） ---
    curl(x * scale, y * scale, flowT + pseed[i] * 0.13, tmpV);
    let ax = tmpV.x * flowF, ay = tmpV.y * flowF;

    const dxC = x - cx, dyC = y - cy;
    const distC = Math.sqrt(dxC * dxC + dyC * dyC) + 0.001;

    if (mode === 'vortex') {
      // 切線方向公轉 + 些許呼吸式的內外漂移
      const tX = -dyC / distC, tY = dxC / distC;
      const orbit = 140 * spd * (0.6 + pseed[i] * 0.8);
      const breathe = Math.sin(flowT * 1.7 + pseed[i] * 6.28) * 30 - 12; // 平均微微向內
      ax += tX * orbit * 2.2 + (dxC / distC) * breathe;
      ay += tY * orbit * 2.2 + (dyC / distC) * breathe;
      // 太靠近核心時輕推出去，避免全部塌縮成一點
      if (distC < minDim * 0.05) { ax += dxC / distC * 400; ay += dyC / distC * 400; }
    } else if (mode === 'burst') {
      // 平時往核心緩緩聚攏，爆炸瞬間給一發強力徑向脈衝
      ax += -dxC * 1.1; ay += -dyC * 1.1;
      if (burstKick) {
        const kick = (260 + pseed[i] * 420) * spd;
        vx[i] += dxC / distC * kick;
        vy[i] += dyC / distC * kick;
      }
    }

    // --- 滑鼠吸引 / 排斥（反比衰減 + 內距避免爆衝） ---
    if (mouse.active && P.mouseForce > 0) {
      const dx = mouse.x - x, dy = mouse.y - y;
      const d2 = dx * dx + dy * dy + 2500;
      const f = repelSign * mForce / d2;
      ax += dx * f / Math.sqrt(d2) * 40;
      ay += dy * f / Math.sqrt(d2) * 40;
    }

    // --- 積分 ---
    vx[i] = vx[i] * drag + ax * dt * spd;
    vy[i] = vy[i] * drag + ay * dt * spd;
    x += vx[i] * dt * (0.5 + spd);
    y += vy[i] * dt * (0.5 + spd);

    // --- 邊界環繞（帶一點緩衝避免邊緣閃現） ---
    if (x < -20) x += W + 40; else if (x > W + 20) x -= W + 40;
    if (y < -20) y += H + 40; else if (y > H + 20) y -= H + 40;
    px[i] = x; py[i] = y;
  }
}

function draw() {
  // 拖尾：半透明黑覆蓋 → 絲滑殘影
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${1 - P.trail})`;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  const n = aliveN;
  const baseSize = P.size;
  const hue = P.hue, hueShift = P.hueShift, sat = P.sat;

  // 依速度分成 12 個色桶批次繪製，省下每顆粒子各設一次 fillStyle 的成本
  const BUCKETS = 12;
  const maxSpd = 220 * (0.5 + P.speed); // 映射用的參考速度上限
  if (!draw.paths) draw.paths = [];
  const counts = draw.counts || (draw.counts = new Uint16Array(BUCKETS));
  const bx = draw.bx || (draw.bx = new Float32Array(MAX_N));
  const by = draw.by || (draw.by = new Float32Array(MAX_N));
  const bi = draw.bi || (draw.bi = new Uint8Array(MAX_N));
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const s = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    let t = s / maxSpd; if (t > 1) t = 1;
    bi[i] = (t * (BUCKETS - 1)) | 0;
    bx[i] = px[i]; by[i] = py[i];
    counts[bi[i]]++;
  }
  for (let b = 0; b < BUCKETS; b++) {
    if (!counts[b]) continue;
    const t = b / (BUCKETS - 1);
    const h = hue + hueShift * t;
    const light = 45 + t * 25;
    const alpha = 0.35 + t * 0.4;
    ctx.fillStyle = `hsla(${h},${sat}%,${light}%,${alpha})`;
    ctx.beginPath();
    const r = baseSize * (0.7 + t * 0.9);
    for (let i = 0; i < n; i++) {
      if (bi[i] !== b) continue;
      ctx.moveTo(bx[i] + r, by[i]);
      ctx.arc(bx[i], by[i], r, 0, 6.2832);
    }
    ctx.fill();
  }

  // 爆發模式的核心閃光
  if (burstFlash > 0.01) {
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.25 * (1.4 - burstFlash);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(10, R));
    g.addColorStop(0, `hsla(${hue + hueShift * 0.5},${sat}%,85%,${burstFlash * 0.8})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
}

syncLoop();
