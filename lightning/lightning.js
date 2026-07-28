'use strict';

// 預覽嵌入模式（?preview=1）：首頁卡片 iframe 用，隱藏所有 UI
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.max(1, W * DPR); canvas.height = Math.max(1, H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  initRain();
}
window.addEventListener('resize', resize);

/* ===== 參數 ===== */
const DEFAULTS = {
  freq: 0.9, branchiness: 0.55, jag: 0.6, thickness: 2.2, chain: 1,
  glow: 1, decay: 0.9, flash: 0.55,
  hue: 210, sat: 90,
  rain: 0.45, rainSpeed: 1.2,
};
const P = { ...DEFAULTS };

const fmt = {
  freq: v => v.toFixed(2), thickness: v => v.toFixed(1), decay: v => v.toFixed(2) + 's',
  hue: v => v + '°', sat: v => v + '%', chain: v => '' + v,
};
function bindControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const update = () => {
      P[key] = parseFloat(el.value);
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
    };
    el.addEventListener('input', update);
    el.value = P[key];
    update();
  }
}
bindControls();

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS);
  bindControls();
});

/* ===== 播放 / 暫停（面板按鈕 + postMessage + 分頁隱藏）===== */
let paused = false;        // 使用者按鈕
let extPaused = false;     // 外部 postMessage 控制（首頁卡片捲出畫面時）
const pauseBtn = document.getElementById('playCtl');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ 播放' : '⏸ 暫停';
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') extPaused = true;
  else if (e.data === 'vfx-play') { extPaused = false; last = performance.now(); }
});
function isHalted() { return paused || extPaused || document.hidden; }
document.addEventListener('visibilitychange', () => { if (!document.hidden) last = performance.now(); });

const panel = document.getElementById('panel');
document.getElementById('toggleBtn').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
});

/* ===== 工具 ===== */
const rand = (a, b) => a + Math.random() * (b - a);

/* ===== 閃電骨架生成：遞迴中點位移 + 分支 ===== */
// 回傳線段陣列 [{x1,y1,x2,y2,w,main}]，w 為相對粗細（0..1），main 標記主幹
function genBolt(x1, y1, x2, y2) {
  const segs = [];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const disp = len * (0.10 + P.jag * 0.22); // 鋸齒感 → 初始位移幅度

  function subdivide(ax, ay, bx, by, d, w, main, depth) {
    if (d < 8 || depth > 9) {
      segs.push({ x1: ax, y1: ay, x2: bx, y2: by, w, main });
      return;
    }
    // 中點 + 垂直方向隨機位移
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const sdx = bx - ax, sdy = by - ay;
    const sl = Math.hypot(sdx, sdy) || 1;
    const nx = -sdy / sl, ny = sdx / sl;
    const off = rand(-d, d);
    const px = mx + nx * off, py = my + ny * off;
    subdivide(ax, ay, px, py, d * 0.5, w, main, depth + 1);
    subdivide(px, py, bx, by, d * 0.5, w, main, depth + 1);
    // 分支：從中點岔出一條較短較細的支線
    if (main && depth >= 1 && depth <= 5 && Math.random() < P.branchiness * 0.55) {
      const bl = sl * rand(0.5, 1.1);            // 分支長度
      const ba = Math.atan2(by - ay, bx - ax) + rand(-1, 1) * (0.35 + P.jag * 0.5);
      const ex = px + Math.cos(ba) * bl, ey = py + Math.sin(ba) * bl;
      subdivide(px, py, ex, ey, d * 0.45, w * rand(0.3, 0.55), false, depth + 1);
    }
  }
  subdivide(x1, y1, x2, y2, disp, 1, true, 0);
  return segs;
}

/* ===== 活躍閃電（含殘影淡出）===== */
// bolt = { segs, born(秒), hueJit, strong }
let bolts = [];
let simT = 0; // 模擬時間（秒，暫停時凍結）
let flashLevel = 0; // 畫面閃光 0..1，隨時間衰減

function spawnStrike(tx, ty, fromTop = true) {
  const sx = fromTop ? rand(W * 0.08, W * 0.92) : tx + rand(-W * 0.25, W * 0.25);
  const sy = fromTop ? rand(-20, H * 0.06) : ty;
  const ex = tx !== undefined ? tx : sx + rand(-W * 0.22, W * 0.22);
  const ey = ty !== undefined ? ty : rand(H * 0.72, H * 0.98);
  addBolt(sx, sy, ex, ey, true);
  // 鏈式跳躍：從落點再跳向 1..chain 個附近隨機點
  let hx = ex, hy = ey;
  const hops = Math.round(P.chain);
  for (let i = 0; i < hops; i++) {
    const nx2 = Math.min(W - 10, Math.max(10, hx + rand(-1, 1) * W * 0.28));
    const ny2 = Math.min(H - 6, Math.max(H * 0.15, hy + rand(-0.6, 0.6) * H * 0.3));
    addBolt(hx, hy, nx2, ny2, false);
    hx = nx2; hy = ny2;
  }
  flashLevel = Math.min(1, flashLevel + 0.5 + Math.random() * 0.5);
}

function addBolt(x1, y1, x2, y2, strong) {
  bolts.push({
    segs: genBolt(x1, y1, x2, y2),
    born: simT,
    hueJit: rand(-14, 14),
    strong,
    endX: x2, endY: y2,
  });
  if (bolts.length > 40) bolts.splice(0, bolts.length - 40);
}

// 點擊/觸控：從頂部隨機點打到點擊位置
canvas.addEventListener('pointerdown', e => {
  if (isHalted()) return;
  spawnStrike(e.clientX, e.clientY, true);
});

/* ===== 雨 ===== */
const RAIN_MAX = 320;
let rainDrops = [];
function initRain() {
  rainDrops = Array.from({ length: RAIN_MAX }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    spd: rand(0.75, 1.35), len: rand(9, 22), drift: rand(-40, -10),
  }));
}

function drawRain(dt) {
  const count = Math.floor(P.rain * RAIN_MAX);
  if (count <= 0) return;
  ctx.strokeStyle = `hsla(${P.hue},${Math.min(60, P.sat)}%,70%,0.28)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const fall = 900 * P.rainSpeed;
  for (let i = 0; i < count; i++) {
    const d = rainDrops[i];
    d.y += fall * d.spd * dt;
    d.x += d.drift * P.rainSpeed * dt;
    if (d.y > H + 24) { d.y = -24; d.x = Math.random() * (W + 80); }
    if (d.x < -40) d.x += W + 80;
    const lx = d.drift * 0.02, ly = d.len * (0.7 + 0.6 * P.rainSpeed);
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x + lx, d.y + ly);
  }
  ctx.stroke();
}

/* ===== 風暴雲層 ===== */
function drawClouds() {
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  g.addColorStop(0, `hsla(${P.hue},45%,10%,0.95)`);
  g.addColorStop(0.5, `hsla(${P.hue},40%,6%,0.55)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.4);
  // 幾團橢圓雲影增加層次（固定 pattern，靠 simT 慢慢平移）
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) {
    const cx2 = ((i * 0.23 + 0.08 + simT * 0.006 * (1 + i * 0.2)) % 1.2 - 0.1) * W;
    const cy2 = H * (0.03 + (i % 3) * 0.045);
    const rw = W * 0.3, rh = H * 0.08;
    const cg = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, rw);
    cg.addColorStop(0, `hsla(${P.hue},30%,8%,0.75)`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.save();
    ctx.translate(cx2, cy2); ctx.scale(1, rh / rw); ctx.translate(-cx2, -cy2);
    ctx.beginPath(); ctx.arc(cx2, cy2, rw, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/* ===== 閃電繪製 ===== */
function drawBolt(b, alpha) {
  const hue = P.hue + b.hueJit;
  const flicker = 0.75 + Math.random() * 0.25;
  const a = alpha * flicker;
  if (a < 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 外層彩色光暈
  if (P.glow > 0.01) {
    ctx.strokeStyle = `hsla(${hue},${P.sat}%,60%,${0.35 * a * Math.min(1.5, P.glow)})`;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = `hsla(${hue},${P.sat}%,55%,${0.9 * a})`;
    ctx.shadowBlur = 14 * P.glow * (b.strong ? 1 : 0.7);
    strokeSegs(b, P.thickness * 2.6);
  }
  // 中層色光
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `hsla(${hue},${P.sat}%,70%,${0.7 * a})`;
  strokeSegs(b, P.thickness * 1.5);
  // 白熱核心
  ctx.strokeStyle = `hsla(${hue},30%,97%,${a})`;
  strokeSegs(b, P.thickness * 0.7);

  // 落點灼熱光點（僅新鮮時）
  if (alpha > 0.55 && b.strong) {
    const r = P.thickness * 9 * alpha;
    const g = ctx.createRadialGradient(b.endX, b.endY, 0, b.endX, b.endY, r);
    g.addColorStop(0, `hsla(${hue},40%,95%,${0.85 * a})`);
    g.addColorStop(0.4, `hsla(${hue},${P.sat}%,60%,${0.4 * a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.endX, b.endY, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function strokeSegs(b, baseW) {
  // 依線段相對粗細分兩批畫（主幹粗、分支細），減少 lineWidth 切換
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.4, baseW);
  ctx.beginPath();
  for (const s of b.segs) {
    if (!s.main) continue;
    ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(0.3, baseW * 0.45);
  ctx.beginPath();
  for (const s of b.segs) {
    if (s.main) continue;
    ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
}

/* ===== 主迴圈 ===== */
let last = performance.now();
let strikeTimer = 0, nextStrike = 0.4;
let rafId = 0;

function scheduleNext() {
  // 預覽模式維持約 1.5 秒一擊；一般模式依頻率滑桿（附隨機抖動）
  if (PREVIEW) { nextStrike = 1.1 + Math.random() * 0.8; return; }
  const f = Math.max(0.001, P.freq);
  nextStrike = (1 / f) * rand(0.45, 1.55);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (isHalted()) { last = now; return; }
  const dt = Math.min((now - last) / 1000, 0.05); // dt 上限 50ms
  last = now;
  simT += dt;

  // 自動打雷排程
  if (P.freq > 0 || PREVIEW) {
    strikeTimer += dt;
    if (strikeTimer >= nextStrike) {
      strikeTimer = 0;
      scheduleNext();
      // 偶爾打「點對點」而非落地雷，增加變化
      if (Math.random() < 0.25) {
        spawnStrike(rand(W * 0.15, W * 0.85), rand(H * 0.3, H * 0.7), true);
      } else {
        spawnStrike(undefined, undefined, true);
      }
    }
  } else {
    strikeTimer = 0;
  }

  /* --- 背景 --- */
  ctx.globalCompositeOperation = 'source-over';
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, `hsl(${P.hue},35%,7%)`);
  bg.addColorStop(0.55, `hsl(${P.hue},30%,3.5%)`);
  bg.addColorStop(1, `hsl(${P.hue},25%,2%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  drawClouds();

  /* --- 畫面閃光（打雷瞬間整個畫面亮起）--- */
  flashLevel = Math.max(0, flashLevel - dt * 3.2);
  if (flashLevel > 0.003 && P.flash > 0.003) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `hsla(${P.hue},60%,75%,${flashLevel * P.flash * 0.28})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* --- 雨（畫在閃電之下）--- */
  drawRain(dt);

  /* --- 閃電與殘影 --- */
  const decay = Math.max(0.1, P.decay);
  bolts = bolts.filter(b => simT - b.born < decay);
  for (const b of bolts) {
    const age = simT - b.born;
    // 前 12% 全亮（頻閃），之後平滑衰減
    const t = age / decay;
    const alpha = t < 0.12 ? 1 : Math.pow(1 - (t - 0.12) / 0.88, 1.6);
    drawBolt(b, alpha);
  }

  /* --- 地面反光 --- */
  if (flashLevel > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createLinearGradient(0, H * 0.82, 0, H);
    gg.addColorStop(0, 'rgba(0,0,0,0)');
    gg.addColorStop(1, `hsla(${P.hue},${P.sat}%,55%,${flashLevel * 0.12})`);
    ctx.fillStyle = gg;
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    ctx.globalCompositeOperation = 'source-over';
  }
}

resize();
scheduleNext();
// 開場先來一發，畫面不空等
spawnStrike(undefined, undefined, true);
rafId = requestAnimationFrame(frame);
