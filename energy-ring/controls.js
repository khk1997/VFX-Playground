'use strict';

// 預覽嵌入模式（?preview=1）：供首頁卡片用 iframe 嵌入，隱藏面板與導覽按鈕，只留純畫面
if (new URLSearchParams(location.search).has('preview')) {
  document.documentElement.classList.add('preview-mode');
}

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
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
  speed: 0.2, pulse: 0, loopSec: 5,
  radius: 0.26, ringCount: 7, ringGap: 2, thickness: 1.0, wobble: 0.79, warp: 0.5, widthVar: 1, filaments: 1, fray: 0, crackle: 0,
  spikeAmount: 0, spikeLength: 0.5, spikeWidth: 1, spikeBlur: 0.5,
  glow: 0.5, hotspots: 2, hotspotSize: 2, flicker: 0.26, trail: 0.34,
  bloomAmount: 0, bloomThreshold: 0.5, bloomRadius: 1,
  granule: 0, granuleSize: 0.5, granuleSpeed: 1,
  smoke: 0, smokeScale: 1, smokeSpeed: 1, smokeReach: 1,
  fps: 30, exportSec: 3,
  hue: 116, hueShift: -33, sat: 100,
  sparkAmount: 0, sparkSpeed: 0.2, sparkArc: 25, sparkReach: 0.25, turbulence: 1,
  accAmount: 0, accStart: 0.6, accSpeed: 1, accSpiral: 0.5, accFlash: 0.6,
  arcAmount: 0.85, arcSpan: 0.45, arcJag: 0.6, arcThickness: 2.65,
  waveAmount: 1.4, waveCount: 2, waveSpeed: 0.45, waveReach: 0.4, waveWidth: 2,
  starCount: 15, starMinSize: 0.4, starMaxSize: 2.5, starSharpness: 0.5, starSpread: 0.4, starSpeed: 0.2,
};
const P = { ...DEFAULTS, ccw: false };
// Q 是渲染程式碼實際讀取的參數來源：即時預覽時等於 P；匯出時暫時指向一份快照，
// 這樣使用者在匯出途中調整滑桿只會改到 P，不會污染正在進行中的那次匯出（見 exportBtn 的處理）。
let Q = P;
// 暫停中調整參數時標記為 true，讓主迴圈用同一個凍結的時間點重畫一張反映新參數的靜態畫面
let paramsDirty = false;
function wakeRenderer() {
  if (typeof syncLoop === 'function') syncLoop();
}

const fmt = {
  speed: v => v.toFixed(2), radius: v => v.toFixed(2), thickness: v => v.toFixed(1),
  hue: v => v + '°', hueShift: v => v + '°', sat: v => v + '%', sparkArc: v => v + '°',
  loopSec: v => v.toFixed(1) + 's',
};
function bindControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const update = () => {
      P[key] = parseFloat(el.value);
      if (valEl) valEl.textContent = (fmt[key] || (v => v.toFixed ? +v.toFixed(2) : v))(P[key]);
      paramsDirty = true;
      wakeRenderer();
    };
    el.addEventListener('input', update);
    el.value = P[key];
    update();
  }
  document.getElementById('ccw').addEventListener('change', e => {
    P.ccw = e.target.checked;
    paramsDirty = true;
    wakeRenderer();
  });
  updateEffSpeedHint();
}
// 顯示轉速滑桿貼齊整數圈之後的實際數值，滑桿寫的是「目標值」，這裡才是真正跑出來的速度
function updateEffSpeedHint() {
  const el = document.getElementById('effSpeedHint');
  if (!el) return;
  const turns = P.speed > 0 ? Math.max(1, Math.round(P.speed * P.loopSec)) : 0;
  const eff = turns / P.loopSec;
  const diffPct = P.speed > 0 ? Math.abs(eff - P.speed) / P.speed * 100 : 0;
  el.textContent = `${eff.toFixed(3)} 圈/秒（每循環 ${turns} 圈）` + (diffPct > 3 ? ` ⚠ 偏離 ${diffPct.toFixed(0)}%` : '');
}
bindControls();
document.getElementById('speed').addEventListener('input', updateEffSpeedHint);
document.getElementById('loopSec').addEventListener('input', updateEffSpeedHint);

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS);
  document.getElementById('ccw').checked = P.ccw = false;
  bindControls();
});

let paused = false;
const pauseBtn = document.getElementById('playCtl');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ 播放' : '⏸ 暫停';
  if (!paused) last = performance.now();
  wakeRenderer();
});

// 首頁卡片用 postMessage 控制預覽播放：非 active 卡片會收到 vfx-pause 以節省效能。
// previewPaused 與使用者的手動暫停互相獨立，任一為真都停止推進。
let msgPaused = false;
window.addEventListener('message', (e) => {
  if (e.data === 'vfx-pause') msgPaused = true;
  else if (e.data === 'vfx-play') {
    msgPaused = false;
    last = performance.now();
  }
  else return;
  wakeRenderer();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) last = performance.now();
  wakeRenderer();
});
function previewPaused() { return msgPaused || document.hidden; }

// 面板開啟時，特效畫面的圓心會平滑往右偏移，避開面板佔用的左側區域（見 renderFrame 的 panelInsetX）
const panel = document.getElementById('panel');
let panelOpen = true, panelInsetX = 0, panelInsetTarget = 0;
const PANEL_OCCUPIED_W = 340 + 12 + 24; // 面板寬度 + 左右邊距，跟 CSS 的數值對應
function updatePanelInset() {
  panelInsetTarget = (panelOpen && window.innerWidth > 760) ? PANEL_OCCUPIED_W / 2 : 0;
  wakeRenderer();
}
document.getElementById('toggleBtn').addEventListener('click', () => {
  panelOpen = !panelOpen;
  panel.classList.toggle('collapsed');
  updatePanelInset();
});
window.addEventListener('resize', updatePanelInset);
updatePanelInset();
