'use strict';

/* ===== 預覽嵌入模式（?preview=1）===== */
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

let skyGrad = null;      // 快取的夜空漸層
let starField = null;    // 快取的星星資料（每顆自帶閃爍相位）
let snowField = null;    // 快取的近景雪粒

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, W * DPR); canvas.height = Math.max(1, H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  skyGrad = null; starField = null; snowField = null;
}
window.addEventListener('resize', resize);
resize();

/* ===== 參數 ===== */
const DEFAULTS = {
  audioReact: 0.9,
  beatSens: 1.35,
  curtains: 3,
  waveSpeed: 1,
  waveScale: 1,
  intensity: PREVIEW ? 1.1 : 1,
  curtainH: 1,
  hueShift: 0,
  edgeTint: 0.65,
  starCount: PREVIEW ? 140 : 220,
};
const BOOL_DEFAULTS = { snowGlow: true, reflection: true, snowParticles: true };
const P = { ...DEFAULTS, ...BOOL_DEFAULTS };

const fmt = {
  waveSpeed: v => 'x' + v.toFixed(2),
  waveScale: v => 'x' + v.toFixed(2),
  intensity: v => 'x' + v.toFixed(2),
  curtainH: v => 'x' + v.toFixed(2),
  hueShift: v => (v > 0 ? '+' : '') + v + '°',
  curtains: v => v.toFixed(0),
  starCount: v => v.toFixed(0),
  audioReact: v => 'x' + v.toFixed(2),
  beatSens: v => 'x' + v.toFixed(2),
};
function bindControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const update = () => {
      P[key] = parseFloat(el.value);
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
      if (key === 'starCount') starField = null;
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('input', update); el._bound = true; }
    update();
  }
  for (const key of Object.keys(BOOL_DEFAULTS)) {
    const el = document.getElementById(key);
    el.checked = P[key];
    if (!el._bound) {
      el.addEventListener('change', () => { P[key] = el.checked; });
      el._bound = true;
    }
  }
}
bindControls();

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS, BOOL_DEFAULTS);
  bindControls();
  starField = null;
});

/* ===== Web Audio：音訊只提供平滑後的低／中／高頻包絡，不直接控制像素 ===== */
let actx = null, analyser = null, inputGain = null, outGain = null;
let audioMode = 'natural';
let bgMusic = null, bgMusicNode = null, micStream = null, micNode = null, fileNode = null, fileBuffer = null;
let freqData = new Uint8Array(1024);
let bassEnv = 0, midEnv = 0, trebleEnv = 0, beatFlash = 0, beatCooldown = 0;
const spectrumBands = new Float32Array(48);
const bassHistory = [];
const audioStateEl = document.getElementById('audioState');

function ensureAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = actx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.68;
  inputGain = actx.createGain(); inputGain.gain.value = 0.72;
  outGain = actx.createGain(); outGain.gain.value = 1;
  inputGain.connect(analyser); analyser.connect(outGain); outGain.connect(actx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}
function setAudioMode(mode, label) {
  audioMode = mode;
  for (const [id, value] of [['audioNatural','natural'],['audioSynth','synth'],['audioMic','mic'],['audioFile','file']]) {
    document.getElementById(id).classList.toggle('active', value === mode);
  }
  audioStateEl.textContent = label;
  audioStateEl.classList.toggle('live', mode !== 'natural');
}
function stopAudioSources() {
  if (bgMusic) {
    bgMusic.pause(); bgMusic.currentTime = 0; bgMusic = null;
  }
  if (bgMusicNode) { try { bgMusicNode.disconnect(); } catch (e) {} bgMusicNode = null; }
  if (micNode) { try { micNode.disconnect(); } catch (e) {} micNode = null; }
  if (micStream) { micStream.getTracks().forEach(track => track.stop()); micStream = null; }
  if (fileNode) { try { fileNode.stop(); fileNode.disconnect(); } catch (e) {} fileNode = null; }
  if (outGain && actx) outGain.gain.setTargetAtTime(1, actx.currentTime, .03);
}
async function activateSynth() {
  try {
    ensureAudio(); stopAudioSources();
    bgMusic = new Audio('audio/aurora-theme.mp3');
    bgMusic.loop = true;
    bgMusicNode = actx.createMediaElementSource(bgMusic);
    bgMusicNode.connect(inputGain);
    await actx.resume();
    await bgMusic.play();
    setAudioMode('synth', '背景音樂驅動中');
  } catch (err) {
    stopAudioSources(); setAudioMode('natural', '背景音樂無法播放');
  }
}
async function activateMic() {
  ensureAudio(); await actx.resume(); stopAudioSources();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micNode = actx.createMediaStreamSource(micStream); micNode.connect(inputGain);
    outGain.gain.setTargetAtTime(0, actx.currentTime, .03);
    setAudioMode('mic', '麥克風即時驅動中');
  } catch (e) {
    setAudioMode('natural', '無法取得麥克風權限');
  }
}
function playFile() {
  fileNode = actx.createBufferSource(); fileNode.buffer = fileBuffer; fileNode.loop = true;
  fileNode.connect(inputGain); fileNode.start(); setAudioMode('file', '音樂檔驅動中');
}
document.getElementById('audioNatural').addEventListener('click', () => {
  stopAudioSources(); setAudioMode('natural', '等待音訊輸入');
});
document.getElementById('audioSynth').addEventListener('click', activateSynth);
document.getElementById('audioMic').addEventListener('click', activateMic);
document.getElementById('audioFile').addEventListener('click', async () => {
  ensureAudio(); await actx.resume(); document.getElementById('audioFileInput').click();
});
document.getElementById('audioFileInput').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    fileBuffer = await actx.decodeAudioData(await file.arrayBuffer());
    stopAudioSources(); playFile();
  } catch (err) { setAudioMode('natural', '音訊檔案無法解碼'); }
  e.target.value = '';
});

function updateSpectrumBands(dt, silent = false) {
  const usable = Math.min(freqData.length, 520);
  for (let i = 0; i < spectrumBands.length; i++) {
    let target = 0;
    if (!silent) {
      const f0 = i / spectrumBands.length;
      const f1 = (i + 1) / spectrumBands.length;
      const a = Math.floor(Math.pow(f0, 1.72) * usable);
      const b = Math.max(a + 1, Math.floor(Math.pow(f1, 1.72) * usable));
      let sum = 0;
      for (let k = a; k < b; k++) sum += freqData[k];
      target = sum / (b - a) / 255;
    }
    const rate = target > spectrumBands[i] ? 17 : 5.5;
    spectrumBands[i] += (target - spectrumBands[i]) * Math.min(1, dt * rate);
  }
}
function spectrumAt(fraction) {
  const p = clamp(fraction, 0, 1) * (spectrumBands.length - 1);
  const i = Math.floor(p), q = p - i;
  const at = n => spectrumBands[Math.max(0, Math.min(spectrumBands.length - 1, n))];
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  const q2 = q * q, q3 = q2 * q;
  return clamp(0.5 * ((2 * p1) + (-p0 + p2) * q + (2 * p0 - 5 * p1 + 4 * p2 - p3) * q2 + (-p0 + 3 * p1 - 3 * p2 + p3) * q3), 0, 1);
}
function analyseAudio(dt) {
  if (audioMode === 'natural' || !analyser) {
    bassEnv += (0 - bassEnv) * Math.min(1, dt * 4);
    midEnv += (0 - midEnv) * Math.min(1, dt * 4);
    trebleEnv += (0 - trebleEnv) * Math.min(1, dt * 4);
    beatFlash = Math.max(0, beatFlash - dt * 4.5);
    updateSpectrumBands(dt, true);
    return;
  }
  analyser.getByteFrequencyData(freqData);
  updateSpectrumBands(dt);
  const band = (from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += freqData[i];
    return sum / Math.max(1, to - from) / 255;
  };
  const bass = band(1, 14), mid = band(14, 110), treble = band(110, 420);
  bassEnv += (bass - bassEnv) * Math.min(1, dt * 12);
  midEnv += (mid - midEnv) * Math.min(1, dt * 8);
  trebleEnv += (treble - trebleEnv) * Math.min(1, dt * 10);
  bassHistory.push(bass); if (bassHistory.length > 54) bassHistory.shift();
  const average = bassHistory.reduce((a, b) => a + b, 0) / Math.max(1, bassHistory.length);
  beatCooldown -= dt; beatFlash = Math.max(0, beatFlash - dt * 4.5);
  if (bassHistory.length > 18 && beatCooldown <= 0 && bass > .12 && bass > average * P.beatSens) {
    beatFlash = 1; beatCooldown = .22;
  }
}

/* ===== 播放/暫停：面板按鈕、postMessage（vfx-pause / vfx-play）、分頁隱藏三者共同決定 ===== */
let userPaused = false, extPaused = false;
let rafId = 0, last = 0;
const pauseBtn = document.getElementById('playCtl');
function isPaused() { return userPaused || extPaused || document.hidden; }
function syncLoop() {
  if (isPaused()) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (actx && actx.state === 'running') actx.suspend();
  } else if (!rafId) {
    last = performance.now();
    rafId = requestAnimationFrame(frame);
    if (actx && audioMode !== 'natural' && actx.state === 'suspended') actx.resume();
  }
}
pauseBtn.addEventListener('click', () => {
  userPaused = !userPaused;
  pauseBtn.textContent = userPaused ? '▶ 播放' : '⏸ 暫停';
  syncLoop();
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') { extPaused = true; syncLoop(); }
  else if (e.data === 'vfx-play') { extPaused = false; syncLoop(); }
});
document.addEventListener('visibilitychange', syncLoop);

/* ===== 面板開合 ===== */
const panel = document.getElementById('panel');
document.getElementById('toggleBtn').addEventListener('click', () => panel.classList.toggle('collapsed'));

/* ===== 工具 ===== */
const rand = (a, b) => a + Math.random() * (b - a);
const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ===== 確定性值噪聲（value noise）+ fBm ===== */
/* 整數座標雜湊 → 平滑插值。無需查表，重現性佳。 */
function hash2(ix, iy) {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h ^= h >> 16;
  return ((h >>> 0) % 1048576) / 1048576; // 0..1
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy),     b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  const ux = smooth(fx), uy = smooth(fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm2(x, y, oct) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    sum += vnoise2(x, y) * amp;
    tot += amp;
    amp *= 0.5; x *= 2.03; y *= 2.11;
  }
  return sum / tot; // 0..1
}
// 水平三點濾波：保留大尺度流動，去除簾腳會顯得鋸齒的高頻折角。
function smoothFbmX(x, y, oct, radius) {
  return (fbm2(x - radius, y, oct) + fbm2(x, y, oct) * 2 + fbm2(x + radius, y, oct)) * 0.25;
}

/* ===== 夜空漸層 ===== */
function buildSkyGrad() {
  skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#020308');
  skyGrad.addColorStop(0.45, '#04101c');
  skyGrad.addColorStop(0.78, '#071a26');
  skyGrad.addColorStop(1, '#0a2230');
  return skyGrad;
}

/* ===== 星空（保留資料以便逐顆閃爍）===== */
function buildStars() {
  const n = Math.round(P.starCount);
  starField = { count: n, stars: [] };
  for (let i = 0; i < n; i++) {
    starField.stars.push({
      x: hash2(i * 7 + 1, 13) * W,
      y: hash2(i * 7 + 2, 29) * H * 0.72,
      r: 0.3 + hash2(i * 7 + 3, 41) * 1.1,
      base: 0.25 + hash2(i * 7 + 4, 57) * 0.6,
      spd: 0.4 + hash2(i * 7 + 5, 71) * 2.2,
      ph: hash2(i * 7 + 6, 83) * TWO_PI,
    });
  }
}

/* ===== 近景雪粒：低密度、分層尺寸，提供空氣透視而不遮住極光 ===== */
function buildSnow() {
  const count = PREVIEW ? 34 : 64;
  snowField = [];
  for (let i = 0; i < count; i++) {
    snowField.push({
      x: hash2(i * 11 + 3, 101) * W,
      y: hash2(i * 11 + 5, 131) * (H + 40),
      r: 0.55 + Math.pow(hash2(i * 11 + 7, 151), 1.8) * 2.1,
      speed: 9 + hash2(i * 11 + 9, 181) * 18,
      sway: 7 + hash2(i * 11 + 10, 197) * 20,
      phase: hash2(i * 11 + 12, 211) * TWO_PI,
      alpha: 0.18 + hash2(i * 11 + 14, 227) * 0.42,
    });
  }
}

function drawReflection(t) {
  if (!P.reflection) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cy = H * 0.91;
  ctx.translate(0, cy); ctx.scale(1, 0.24);
  for (let i = 0; i < 3; i++) {
    const x = W * (0.2 + i * 0.3) + Math.sin(t * (0.07 + i * .015) + i * 2.1) * W * .045;
    const radius = W * (0.28 + i * .035);
    const hue = 138 + P.hueShift + i * 18;
    const alpha = (0.018 + bassEnv * P.audioReact * 0.026) * P.intensity;
    const g = ctx.createRadialGradient(x, 0, 0, x, 0, radius);
    g.addColorStop(0, `hsla(${hue},85%,60%,${alpha})`);
    g.addColorStop(.48, `hsla(${hue + 25},80%,58%,${alpha * .52})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - radius, -radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function drawSnow(t) {
  if (!P.snowParticles) return;
  if (!snowField) buildSnow();
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = '#e9fbff';
  for (const s of snowField) {
    const y = ((s.y + t * s.speed) % (H + 40)) - 20;
    const x = (s.x + Math.sin(t * .45 + s.phase) * s.sway + t * 2.2) % (W + 20) - 10;
    ctx.globalAlpha = s.alpha * (0.8 + trebleEnv * P.audioReact * .42);
    ctx.beginPath(); ctx.arc(x, y, s.r, 0, TWO_PI); ctx.fill();
  }
  ctx.restore();
}

/* ===== 極光簾幕 =====
 * 每道簾幕：一條沿 x 的基線，高度/亮度由分層噪聲隨時間流動；
 * 以許多細窄的縱向漸層條帶（底亮、向上淡出）用 'lighter' 疊加，
 * 形成典型的簾幕波褶。 */
const CURTAIN_DEFS = [
  { seed: 3.1,  baseY: 0.42, drift: 0.9,  hue: 140, span: 1.05 },
  { seed: 17.7, baseY: 0.55, drift: -0.6, hue: 158, span: 0.9 },
  { seed: 42.3, baseY: 0.33, drift: 0.45, hue: 128, span: 1.15 },
  { seed: 71.9, baseY: 0.62, drift: -1.1, hue: 168, span: 0.8 },
];

/* 流星 */
let meteor = null, meteorTimer = rand(4, 9);
function updateMeteor(dt) {
  if (!meteor) {
    meteorTimer -= dt;
    if (meteorTimer <= 0) {
      const x0 = rand(W * 0.15, W * 0.85), y0 = rand(H * 0.05, H * 0.3);
      const ang = rand(0.35, 0.75) * (Math.random() < 0.5 ? 1 : -1);
      const sp = rand(260, 420);
      meteor = {
        x: x0, y: y0,
        vx: Math.cos(ang) * sp * (Math.random() < 0.5 ? 1 : -1),
        vy: Math.abs(Math.sin(ang)) * sp * 0.5,
        life: 0, maxLife: rand(1.1, 2),
      };
      meteorTimer = rand(6, 14);
    }
  } else {
    meteor.life += dt;
    meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt;
    if (meteor.life >= meteor.maxLife || meteor.x < -60 || meteor.x > W + 60) meteor = null;
  }
}
function drawMeteor() {
  if (!meteor) return;
  const q = meteor.life / meteor.maxLife;
  const alpha = Math.sin(q * Math.PI) * 0.9;
  const tail = 90;
  const nx = meteor.vx, ny = meteor.vy;
  const len = Math.hypot(nx, ny) || 1;
  const tx = meteor.x - (nx / len) * tail, ty = meteor.y - (ny / len) * tail;
  const g = ctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.3, `rgba(190,220,255,${alpha * 0.45})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(meteor.x, meteor.y); ctx.lineTo(tx, ty); ctx.stroke();
}

/* ===== 主迴圈 ===== */
let simT = rand(0, 100); // 噪聲時間軸

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  analyseAudio(dt);
  const drive = P.audioReact;
  simT += dt * P.waveSpeed;
  updateMeteor(dt);
  render(now / 1000);
}

function drawCurtain(def, idx, count) {
  const step = PREVIEW ? 3 : 2;                   // 取樣間距（噪聲連續 → 相鄰條帶自然銜接）
  const stripW = step;                            // 精確拼接：無縫隙、也無加法重疊造成的梳狀紋
  const scale = P.waveScale;
  const baseY = H * def.baseY;
  const drive = P.audioReact;
  const maxH = H * 0.42 * P.curtainH * def.span;  // 簾幕最大高度
  const hue0 = def.hue + P.hueShift;
  const tint = P.edgeTint;
  const t = simT * (0.7 + idx * 0.13) + def.seed * 31.7;
  const inten = P.intensity * 2.0 * (1 - idx * 0.1);
  const edgeSamples = [];

  for (let x = 0; x <= W; x += step) {
    // 保留各頻帶驅動的局部跳動；最後以曲線繪製簾腳，避免頻帶交界形成硬折角。
    const localDrive = spectrumAt(x / Math.max(1, W)) * drive;
    const u = (x / W) * 3.0 * scale + def.seed;
    // 主體亮度：慢速大尺度 fBm，決定簾幕哪裡濃哪裡淡
    let bright = fbm2(u, t * 0.18, 4);
    bright = Math.pow(clamp((bright - 0.24) / 0.55, 0, 1), 1.25);

    // 波褶：較快的細尺度噪聲，讓底線起伏、條帶高度抖動
    const ripple = (smoothFbmX(u * 2.6 + 50, t * 0.55, 3, 0.042) - 0.5) * (1 + localDrive * .32);
    const sway = smoothFbmX(u * 0.8 + 90, t * 0.1, 3, 0.055) - 0.5;

    const y0 = baseY + sway * H * 0.14 + ripple * H * 0.038 * scale - localDrive * H * (0.048 + idx * .01);
    const hgt = maxH * (0.35 + bright * 0.65) * (1 + ripple * 0.32 + localDrive * .72);

    const a = clamp(bright * inten * (0.55 + localDrive * .48), 0, 1);
    // 底部翠綠 → 中段青 → 頂端紫粉，邊緣（亮度低處）暈彩更重
    const edge = (0.45 + (1 - bright) * 0.55) * tint;
    const hue = hue0 + Math.sin(u * 1.7) * 8;
    const topHue = hue + edge * 165;   // 綠 → 青 → 紫（色相向上走）
    const midHue = hue + edge * 60;    // 中段偏青
    // 低亮度只略過透明簾幕；底線幾何仍保留完整取樣，避免路徑從畫面中段開始。
    if (bright >= 0.015 && hgt >= 4) {
      const g = ctx.createLinearGradient(0, y0, 0, y0 - hgt);
      g.addColorStop(0, `hsla(${hue + 10},100%,68%,${a * 0.62})`);
      g.addColorStop(0.18, `hsla(${hue},95%,58%,${a * 0.72})`);
      g.addColorStop(0.48, `hsla(${midHue},90%,60%,${a * 0.42})`);
      g.addColorStop(0.78, `hsla(${topHue},88%,66%,${a * 0.3})`);
      g.addColorStop(0.94, `hsla(${topHue + 40},85%,72%,${a * 0.14})`); // 頂端泛粉
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y0 - hgt, stripW, hgt);

      // 簾腳輝光：往下柔和淡出，避免硬邊鋸齒
      const gl = hgt * 0.22;
      const g2 = ctx.createLinearGradient(0, y0 - 2, 0, y0 + gl);
      g2.addColorStop(0, `hsla(${hue + 14},100%,74%,${a * 0.14})`);
      g2.addColorStop(0.35, `hsla(${hue + 8},95%,62%,${a * 0.22})`);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(x, y0 - 2, stripW, gl + 2);
    }
    edgeSamples.push({ x, y: y0, a, hue });
  }

  // Catmull-style quadratic pass：視覺上連續通過頻帶起伏，但不改變頻譜驅動的節奏。
  if (edgeSamples.length > 2) {
    const first = edgeSamples[0], last = edgeSamples[edgeSamples.length - 1];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < edgeSamples.length - 1; i++) {
      const p = edgeSamples[i], next = edgeSamples[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) * 0.5, (p.y + next.y) * 0.5);
    }
    ctx.lineTo(last.x, last.y);
    ctx.globalAlpha = Math.min(0.78, edgeSamples.reduce((sum, p) => sum + p.a, 0) / edgeSamples.length * 0.85);
    ctx.strokeStyle = `hsl(${def.hue + P.hueShift + 12},100%,72%)`;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = `hsla(${def.hue + P.hueShift + 15},100%,70%,0.72)`;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.restore();
  }
}

function render(t) {
  /* --- 夜空 --- */
  ctx.globalCompositeOperation = 'source-over';
  if (!skyGrad) buildSkyGrad();
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  /* --- 星星（逐顆閃爍）--- */
  if (P.starCount > 0) {
    if (!starField || starField.count !== Math.round(P.starCount)) buildStars();
    ctx.fillStyle = '#fff';
    for (const s of starField.stars) {
      const tw = 0.6 + 0.4 * Math.sin(t * s.spd + s.ph);
      ctx.globalAlpha = s.base * tw;
      const spark = 1 + trebleEnv * P.audioReact * 1.8 + beatFlash * .18;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * spark, 0, TWO_PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawMeteor();

  /* --- 極光簾幕（加法混合）--- */
  ctx.globalCompositeOperation = 'lighter';
  const n = Math.round(P.curtains);
  for (let i = 0; i < n; i++) drawCurtain(CURTAIN_DEFS[i], i, n);

  /* --- 雪面接收極光的寬幅柔反射 --- */
  drawReflection(t);

  /* --- 雪地映光：地平線下方微微反照極光色 --- */
  if (P.snowGlow) {
    const gy = H * 0.82;
    const g = ctx.createLinearGradient(0, gy, 0, H);
    const glowHue = 145 + P.hueShift;
    const pulse = 0.05 + 0.04 * fbm2(simT * 0.2, 7.7, 2) + bassEnv * P.audioReact * .08;
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `hsla(${glowHue},70%,60%,${pulse * P.intensity})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, W, H - gy);
  }

  /* --- 近景雪粒位於最前景 --- */
  drawSnow(t);
}

syncLoop();
