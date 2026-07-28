'use strict';

/* ===== 預覽嵌入模式（?preview=1）：隱藏 UI、粒子減量、自動循環照常 ===== */
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

let needRetarget = true; // 尺寸 / 文字 / 取樣參數改變時，重新取樣目標點

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  needRetarget = true;
}
window.addEventListener('resize', resize);
resize();

/* ===== 參數 ===== */
const DEFAULTS = {
  fontSize: 170, gap: 4, hold: 2.5,
  spring: 7.5, damping: 6.4, burst: 0.9,
  repelRadius: 110, repelForce: 1.2,
  hue: 160, hueShift: 90, sat: 100,
  glow: 0.55, trail: 0.78,
};
const DEFAULT_TEXT = 'VFX|PLAYGROUND|你好世界';
const DEFAULT_STYLE = 'explode';
const P = { ...DEFAULTS, text: DEFAULT_TEXT, style: DEFAULT_STYLE };

const fmt = {
  hold: v => v.toFixed(1) + 's',
  hue: v => v + '°', hueShift: v => v + '°', sat: v => v + '%',
  gap: v => v + 'px', fontSize: v => v + 'px', repelRadius: v => v + 'px',
};
const RESAMPLE_KEYS = new Set(['fontSize', 'gap']);
function bindControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const update = () => {
      P[key] = parseFloat(el.value);
      if (valEl) valEl.textContent = (fmt[key] || (v => v.toFixed ? +v.toFixed(2) : v))(P[key]);
      if (RESAMPLE_KEYS.has(key)) needRetarget = true;
    };
    el.addEventListener('input', update);
    el.value = P[key];
    update();
  }
}
bindControls();

const textInput = document.getElementById('textInput');
textInput.addEventListener('input', () => {
  P.text = textInput.value;
  wordIndex = 0;
  needRetarget = true;
  phase = 'form'; phaseT = 0;
});

/* 轉場樣式按鈕 */
const styleBtns = Array.from(document.querySelectorAll('.stylebtns button'));
function setStyle(s) {
  P.style = s;
  styleBtns.forEach(b => b.classList.toggle('active', b.dataset.style === s));
}
styleBtns.forEach(b => b.addEventListener('click', () => setStyle(b.dataset.style)));
setStyle(P.style);

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS);
  P.text = DEFAULT_TEXT;
  textInput.value = DEFAULT_TEXT;
  setStyle(DEFAULT_STYLE);
  bindControls();
  wordIndex = 0;
  needRetarget = true;
  phase = 'form'; phaseT = 0;
});

/* ===== 播放 / 暫停 ===== */
let paused = false;        // 使用者手動暫停
let extPaused = false;     // 來自父頁 postMessage 或分頁隱藏的暫停
const pauseBtn = document.getElementById('playCtl');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ 播放' : '⏸ 暫停';
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') extPaused = true;
  else if (e.data === 'vfx-play') { extPaused = false; last = performance.now(); }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) last = performance.now();
});

/* ===== 面板開合：畫面重心平滑右移避開面板 ===== */
const panel = document.getElementById('panel');
let panelOpen = !PREVIEW, panelInsetX = 0, panelInsetTarget = 0;
const PANEL_OCCUPIED_W = 340 + 12 + 24;
function updatePanelInset() {
  panelInsetTarget = (panelOpen && !PREVIEW && window.innerWidth > 760) ? PANEL_OCCUPIED_W / 2 : 0;
}
document.getElementById('toggleBtn').addEventListener('click', () => {
  panelOpen = !panelOpen;
  panel.classList.toggle('collapsed');
  updatePanelInset();
});
window.addEventListener('resize', updatePanelInset);
updatePanelInset();

/* ===== 滑鼠 / 觸控斥力 ===== */
const pointer = { x: -9999, y: -9999, active: false };
function setPointer(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; }
canvas.addEventListener('pointermove', e => setPointer(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', e => setPointer(e.clientX, e.clientY));
canvas.addEventListener('pointerleave', () => { pointer.active = false; pointer.x = pointer.y = -9999; });
canvas.addEventListener('touchmove', e => {
  const t = e.touches[0];
  if (t) setPointer(t.clientX, t.clientY);
}, { passive: true });
canvas.addEventListener('touchend', () => { pointer.active = false; pointer.x = pointer.y = -9999; });

/* ===== 文字取樣：畫到離屏畫布 → 掃描不透明像素當目標點 ===== */
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

function getWords() {
  const words = (P.text || '').split('|').map(s => s.trim()).filter(s => s.length > 0);
  return words.length ? words : ['VFX'];
}

// 回傳 [{x, y, t}]：畫面座標 + 橫向 0..1（供色相漸層用）
function sampleText(word) {
  const availW = Math.max(80, W - (panelInsetTarget > 0 ? PANEL_OCCUPIED_W : 0) - 60);
  const availH = Math.max(80, H - 120);
  let fs = P.fontSize;
  const font = f => `700 ${f}px "SF Pro", "PingFang TC", "Microsoft JhengHei", sans-serif`;
  sampleCtx.font = font(fs);
  let tw = sampleCtx.measureText(word).width;
  // 太寬 / 太高就縮字級，確保整句都在畫面內
  const fit = Math.min(1, availW / Math.max(1, tw), availH / (fs * 1.3));
  if (fit < 1) { fs = Math.max(16, Math.floor(fs * fit)); sampleCtx.font = font(fs); tw = sampleCtx.measureText(word).width; }

  const sw = Math.ceil(tw) + 20, sh = Math.ceil(fs * 1.5) + 20;
  sampleCanvas.width = sw; sampleCanvas.height = sh;
  sampleCtx.clearRect(0, 0, sw, sh);
  sampleCtx.font = font(fs);
  sampleCtx.textBaseline = 'middle';
  sampleCtx.textAlign = 'center';
  sampleCtx.fillStyle = '#fff';
  sampleCtx.fillText(word, sw / 2, sh / 2);

  // 預覽模式取樣間距放大 → 粒子減量
  const gap = Math.max(2, Math.round(P.gap * (PREVIEW ? 2 : 1)));
  const data = sampleCtx.getImageData(0, 0, sw, sh).data;
  const cx = W / 2 + panelInsetX, cy = H / 2;
  const targets = [];
  for (let y = 0; y < sh; y += gap) {
    for (let x = 0; x < sw; x += gap) {
      if (data[(y * sw + x) * 4 + 3] > 128) {
        targets.push({
          x: cx + (x - sw / 2),
          y: cy + (y - sh / 2),
          t: x / sw,
        });
      }
    }
  }
  // 安全上限：極端參數下避免爆量
  const cap = PREVIEW ? 1800 : 9000;
  if (targets.length > cap) {
    const step = targets.length / cap;
    const out = [];
    for (let i = 0; i < cap; i++) out.push(targets[Math.floor(i * step)]);
    return out;
  }
  return targets;
}

/* ===== 粒子池 ===== */
const particles = [];
function retarget(word, scatterNew) {
  const targets = sampleText(word);
  const cx = W / 2 + panelInsetX, cy = H / 2;
  // 依環形角度配對，避免大量粒子互相穿越造成急促、機械式交叉。
  targets.sort((a,b) => Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  particles.sort((a,b) => Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  // 補足 / 裁減粒子數
  while (particles.length < targets.length) {
    particles.push({
      x: Math.random() * W, y: Math.random() * H, px: 0, py: 0,
      vx: 0, vy: 0, tx: 0, ty: 0, hueT: 0,
      size: 0.8 + Math.random() * 1.6,
      jit: Math.random() * Math.PI * 2, flow: 0.65 + Math.random() * 0.9,
    });
  }
  particles.length = targets.length;
  for (let i = 0; i < targets.length; i++) {
    const p = particles[i], t = targets[i];
    p.tx = t.x; p.ty = t.y; p.hueT = t.t;
    if (scatterNew) { // 首次進場：從畫面外圍飛入
      const a = Math.random() * Math.PI * 2, r = Math.max(W, H) * (0.55 + Math.random() * 0.25);
      p.x = W / 2 + Math.cos(a) * r; p.y = H / 2 + Math.sin(a) * r;
      p.vx = p.vy = 0;
    }
  }
}

/* ===== 詞句循環狀態機：form（聚合）→ hold（停留）→ disperse（散開）→ 換詞 ===== */
let wordIndex = 0;
let phase = 'form';   // 'form' | 'hold' | 'disperse'
let phaseT = 0;
const FORM_SEC = 2.15, DISPERSE_SEC = 1.35;
let firstEntry = true;

function beginDisperse() {
  phase = 'disperse'; phaseT = 0;
  const cx = W / 2 + panelInsetX, cy = H / 2;
  const B = P.burst;
  for (const p of particles) {
    if (P.style === 'explode') {
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.max(20, Math.hypot(dx, dy));
      const s = (250 + Math.random() * 450) * B;
      p.vx += (dx / d) * s + (Math.random() - 0.5) * 120 * B;
      p.vy += (dy / d) * s + (Math.random() - 0.5) * 120 * B;
    } else if (P.style === 'swirl') {
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.max(20, Math.hypot(dx, dy));
      const s = (220 + Math.random() * 260) * B;
      p.vx += (-dy / d) * s + (dx / d) * 60 * B;
      p.vy += (dx / d) * s + (dy / d) * 60 * B;
    } else { // gravity：先微微上拋，之後靠重力墜落
      p.vx += (Math.random() - 0.5) * 140 * B;
      p.vy += (-60 - Math.random() * 160) * B;
    }
  }
}

/* ===== 主迴圈 ===== */
let last = performance.now();
let rafId = null;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); // dt 上限 50ms
  last = now;
  if (extPaused || document.hidden) return;

  // 面板開合的畫面重心過渡（暫停時也繼續，純 UI 動作）
  panelInsetX += (panelInsetTarget - panelInsetX) * Math.min(1, dt * 10);
  if (Math.abs(panelInsetTarget - panelInsetX) < 0.5 && Math.abs(panelInsetTarget - panelInsetX) > 0.01) {
    needRetarget = true; // 過渡結束時把目標點對齊新中心
    panelInsetX = panelInsetTarget;
  }

  if (needRetarget) {
    needRetarget = false;
    const words = getWords();
    wordIndex = wordIndex % words.length;
    retarget(words[wordIndex], firstEntry);
    firstEntry = false;
  }

  if (paused) { render(0); return; }

  phaseT += dt;
  if (phase === 'form' && phaseT >= FORM_SEC) { phase = 'hold'; phaseT = 0; }
  else if (phase === 'hold' && phaseT >= P.hold) { beginDisperse(); }
  else if (phase === 'disperse' && phaseT >= DISPERSE_SEC) {
    phase = 'form'; phaseT = 0;
    const words = getWords();
    wordIndex = (wordIndex + 1) % words.length;
    retarget(words[wordIndex], false);
  }

  step(dt);
  render(dt);
}

function step(dt) {
  const k = P.spring * P.spring;      // 彈性係數（滑桿取平方根尺度，手感較線性）
  const damp = Math.exp(-P.damping * dt);
  const rr = P.repelRadius, rr2 = rr * rr;
  const rf = P.repelForce * 22000;
  const seeking = phase !== 'disperse';
  const gravity = P.style === 'gravity';

  for (const p of particles) {
    p.px = p.x; p.py = p.y;
    if (seeking) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      p.vx += dx * k * dt;
      p.vy += dy * k * dt;
      // 接近字形前保留少量旋流，每顆粒子的相位不同，形成柔順的電影感收束。
      const curl = Math.min(1, dist / 180) * p.flow * 34;
      p.vx += Math.cos(p.jit + phaseT * 1.7) * curl * dt;
      p.vy += Math.sin(p.jit + phaseT * 1.5) * curl * dt;
    } else if (gravity) {
      p.vy += 1400 * P.burst * dt;
    } else if (P.style === 'swirl') {
      // 散開期間持續一點切向力 → 漩渦感
      const cx = W / 2 + panelInsetX, cy = H / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.max(30, Math.hypot(dx, dy));
      p.vx += (-dy / d) * 500 * P.burst * dt;
      p.vy += (dx / d) * 500 * P.burst * dt;
    }

    // 滑鼠斥力：距離內反比推開
    if (pointer.active && rf > 0) {
      const dx = p.x - pointer.x, dy = p.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = rf * (1 - d / rr) / Math.max(d, 8);
        p.vx += (dx / d) * f * dt * 60;
        p.vy += (dy / d) * f * dt * 60;
      }
    }

    p.vx *= damp; p.vy *= damp;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 重力墜落：落出畫面底部就停在外面等待重組（避免無限往下）
    if (gravity && !seeking && p.y > H + 60) { p.y = H + 60; p.vy = 0; }
  }
}

function render(dt) {
  // 拖尾：半透明黑覆蓋，trail 越高殘影越長
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.05, 1 - P.trail)})`;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  const hue0 = P.hue, hs = P.hueShift, sat = P.sat;
  const glow = P.glow;
  const useGlow = glow > 0.02 && !PREVIEW; // 預覽模式跳過大光暈省效能

  for (const p of particles) {
    const h = (hue0 + p.hueT * hs + 360) % 360;
    const spd = Math.hypot(p.vx, p.vy);
    const bri = Math.min(1, 0.55 + spd / 900);
    const r = p.size * (phase === 'disperse' ? 1.25 : 1);
    // 速度方向短拖尾，比單純全畫面殘影更流暢，也保留字形清晰度。
    if (p.px !== undefined && spd > 14) {
      const tail = Math.min(1, spd / 420);
      ctx.strokeStyle = `hsla(${h},${sat}%,72%,${0.16 + tail * 0.34})`;
      ctx.lineWidth = Math.max(0.35, r * 0.72); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    // 柔和光暈（大而淡）
    if (useGlow) {
      ctx.fillStyle = `hsla(${h},${sat}%,60%,${0.045 * glow})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (4 + glow * 3), 0, 6.2832);
      ctx.fill();
    }
    // 核心亮點
    ctx.fillStyle = `hsla(${h},${sat}%,${55 + bri * 30}%,${0.9})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

rafId = requestAnimationFrame(frame);
