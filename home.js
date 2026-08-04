'use strict';

const PREVIEW_W = 660, PREVIEW_H = 570;

const cardsEl = document.getElementById('cards');
const viewportEl = document.getElementById('viewport');
const dotsEl = document.getElementById('dots');
const bgEl = document.getElementById('bg');
const bgThemeLayers = Array.from(bgEl.querySelectorAll('.bg-theme-layer'));
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const selectionIndexEl = document.getElementById('selectionIndex');
const selectionCategoryEl = document.getElementById('selectionCategory');
const selectionDescriptionEl = document.getElementById('selectionDescription');
const initialEffectIndex = Math.max(0, EFFECTS.findIndex(fx => fx.href === 'bubble/index.html'));
let active = initialEffectIndex;
let position = EFFECTS.length + initialEffectIndex;
let motionTimer = null;
let activeThemeLayer = 0;
const cardEls = [];
const iframes = [];   // 只保留目前實際掛載的 iframe；遠端卡片為 null。
const previewHosts = [];
const previewSources = [];
const dotEls = [];
const mobilePreviewQuery = window.matchMedia('(max-width: 760px)');
const primedMobilePreviews = new WeakSet();
const mobilePreviewPauseTimers = new WeakMap();
let previewUseTick = 0;

/* ===== WebAudio 合成音效（Switch 風的嗶啵聲，不用音檔） ===== */
let audioCtx = null;
let soundOn = (localStorage.getItem('vfx-sound') ?? '1') === '1';
function blip(freq, dur = 0.07, type = 'sine', gain = 0.12) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* 音效失敗不影響操作 */ }
}
const sndMove = () => blip(880, 0.06, 'sine', 0.10);
const sndEnter = () => { blip(660, 0.09, 'triangle', 0.14); setTimeout(() => blip(990, 0.12, 'triangle', 0.12), 70); };

const sndBtn = document.getElementById('sndBtn');
function renderSndBtn() { sndBtn.textContent = soundOn ? '🔊 音效' : '🔇 音效'; }
sndBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('vfx-sound', soundOn ? '1' : '0');
  renderSndBtn();
  if (soundOn) sndMove();
});
renderSndBtn();

function buildCards() {
  // 三組完整清單首尾相接，確保畫面兩側始終都有足夠的前後卡片。
  const sequence = [-1, 0, 1].flatMap(copy =>
    EFFECTS.map((fx, logicalIndex) => ({
      fx,
      logicalIndex,
      clone: copy !== 0,
    }))
  );

  sequence.forEach(({ fx, logicalIndex: i, clone }) => {
    const el = document.createElement(fx.href ? 'a' : 'div');
    el.className = 'card' + (fx.href ? '' : ' disabled');
    if (fx.href) el.href = fx.href;
    if (clone) el.setAttribute('aria-hidden', 'true');

    const preview = document.createElement('div');
    preview.className = 'card-preview';
    if (fx.previewSrc) {
      iframes.push(null);
      previewHosts.push(preview);
      previewSources.push(fx.previewSrc);
    } else {
      const soon = document.createElement('div');
      soon.className = 'soon';
      soon.textContent = 'COMING SOON';
      preview.appendChild(soon);
      iframes.push(null);
      previewHosts.push(null);
      previewSources.push(null);
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = fx.title;
    const tagWrap = document.createElement('div');
    tagWrap.className = 'card-tags';
    fx.tags.forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t;
      tagWrap.appendChild(tag);
    });
    body.appendChild(title);
    body.appendChild(tagWrap);

    el.appendChild(preview);
    el.appendChild(body);
    el.addEventListener('click', (e) => {
      if (!fx.href) { e.preventDefault(); return; }
      e.preventDefault();
      if (i !== active) { setActive(i); }
      else launch(i);
    });
    cardsEl.appendChild(el);
    cardEls.push(el);

    if (!clone) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.addEventListener('click', () => setActive(i, false, true));
      dotsEl.appendChild(dot);
      dotEls.push(dot);
    }
  });
}

function syncPreviewState(frame, index) {
  if (!frame || frame.dataset.loaded !== '1' || !frame.contentWindow) return;
  const distance = Math.abs(index - position);
  const mobile = mobilePreviewQuery.matches;
  const dpr = mobile ? 1.15 : 1.5;
  const existingTimer = mobilePreviewPauseTimers.get(frame);

  if (existingTimer) {
    clearTimeout(existingTimer);
    mobilePreviewPauseTimers.delete(frame);
  }

  if (mobile) {
    if (distance === 0 && !document.hidden) {
      try { frame.contentWindow.postMessage({ type: 'vfx-quality', fps: 30, dpr }, '*'); } catch (e) {}
      try { frame.contentWindow.postMessage('vfx-play', '*'); } catch (e) {}
      return;
    }

    // 左右卡片先跑幾幀取得完整靜態預覽，之後暫停，保留畫面質感但不持續佔用 CPU/GPU。
    if (distance === 1 && !document.hidden && !primedMobilePreviews.has(frame)) {
      primedMobilePreviews.add(frame);
      try { frame.contentWindow.postMessage({ type: 'vfx-quality', fps: 12, dpr }, '*'); } catch (e) {}
      try { frame.contentWindow.postMessage('vfx-play', '*'); } catch (e) {}
      const timer = setTimeout(() => {
        mobilePreviewPauseTimers.delete(frame);
        const currentIndex = Number(frame.dataset.index);
        if (Math.abs(currentIndex - position) === 1) {
          try { frame.contentWindow.postMessage('vfx-pause', '*'); } catch (e) {}
        }
      }, 500);
      mobilePreviewPauseTimers.set(frame, timer);
      return;
    }

    try { frame.contentWindow.postMessage({ type: 'vfx-quality', fps: 12, dpr }, '*'); } catch (e) {}
    try { frame.contentWindow.postMessage('vfx-pause', '*'); } catch (e) {}
    return;
  }

  const shouldPlay = distance <= 1 && !document.hidden;
  const fps = distance === 0 ? 60 : distance === 1 ? 24 : 12;
  try { frame.contentWindow.postMessage({ type: 'vfx-quality', fps, dpr }, '*'); } catch (e) {}
  try { frame.contentWindow.postMessage(shouldPlay ? 'vfx-play' : 'vfx-pause', '*'); } catch (e) {}
}

function ensurePreviewLoaded(index) {
  let frame = iframes[index];
  if (!frame) {
    const host = previewHosts[index];
    const src = previewSources[index];
    if (!host || !src) return null;
    frame = document.createElement('iframe');
    frame.dataset.src = src;
    frame.dataset.loaded = '1';
    frame.dataset.index = String(index);
    frame.width = PREVIEW_W;
    frame.height = PREVIEW_H;
    frame.tabIndex = -1;
    frame.loading = 'eager';
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.transform = `scale(${220 / PREVIEW_W})`;
    frame.addEventListener('load', () => syncPreviewState(frame, index));
    iframes[index] = frame;
    host.appendChild(frame);
    frame.src = src;
  }
  frame.dataset.lastUsed = String(++previewUseTick);
  return frame;
}

function unloadPreview(frame, index) {
  if (!frame) return;
  const timer = mobilePreviewPauseTimers.get(frame);
  if (timer) clearTimeout(timer);
  mobilePreviewPauseTimers.delete(frame);
  primedMobilePreviews.delete(frame);
  try { frame.contentWindow && frame.contentWindow.postMessage('vfx-pause', '*'); } catch (e) {}
  frame.remove();
  iframes[index] = null;
}

function trimPreviewCache(protectedIndices) {
  const loaded = iframes
    .map((frame, index) => ({ frame, index }))
    .filter(item => item.frame && item.frame.dataset.loaded === '1');
  const cacheLimit = mobilePreviewQuery.matches ? 3 : 5;
  if (loaded.length <= cacheLimit) return;

  loaded
    .filter(item => !protectedIndices.has(item.index))
    .sort((a, b) => Number(a.frame.dataset.lastUsed || 0) - Number(b.frame.dataset.lastUsed || 0))
    .slice(0, loaded.length - cacheLimit)
    .forEach(item => unloadPreview(item.frame, item.index));
}

/* 手機只載入中心與左右卡片；桌面保留較寬的預熱範圍與 LRU 緩存。 */
function updatePreviewPlayback() {
  const protectedIndices = new Set();
  const loadDistance = mobilePreviewQuery.matches ? 1 : 2;
  previewSources.forEach((src, i) => {
    if (!src) return;
    const distance = Math.abs(i - position);
    const shouldLoad = distance <= loadDistance;

    let frame = iframes[i];
    if (shouldLoad) {
      protectedIndices.add(i);
      frame = ensurePreviewLoaded(i);
    }
    if (frame) syncPreviewState(frame, i);
  });
  trimPreviewCache(protectedIndices);
}

function updateCardDepth() {
  cardEls.forEach((el, idx) => {
    const distance = idx - position;
    el.classList.remove('depth-near-left', 'depth-near-right', 'depth-far-left', 'depth-far-right');
    if (distance === -1) el.classList.add('depth-near-left');
    else if (distance === 1) el.classList.add('depth-near-right');
    else if (distance < -1) el.classList.add('depth-far-left');
    else if (distance > 1) el.classList.add('depth-far-right');
  });
}

function updateSelectionUI(instant = false) {
  const fx = EFFECTS[active];
  selectionIndexEl.textContent = `${String(active + 1).padStart(2, '0')} / ${String(EFFECTS.length).padStart(2, '0')}`;
  selectionCategoryEl.textContent = fx.category;
  selectionDescriptionEl.textContent = fx.description;
  if (instant) {
    bgEl.classList.add('theme-instant');
    bgThemeLayers[activeThemeLayer].style.setProperty('--theme-left', fx.theme[0]);
    bgThemeLayers[activeThemeLayer].style.setProperty('--theme-right', fx.theme[1]);
    bgThemeLayers[activeThemeLayer].classList.add('active');
  } else {
    const nextLayer = activeThemeLayer === 0 ? 1 : 0;
    bgThemeLayers[nextLayer].style.setProperty('--theme-left', fx.theme[0]);
    bgThemeLayers[nextLayer].style.setProperty('--theme-right', fx.theme[1]);
    bgThemeLayers[nextLayer].classList.add('active');
    bgThemeLayers[activeThemeLayer].classList.remove('active');
    activeThemeLayer = nextLayer;
  }
  prevBtn.style.setProperty('--theme-left', fx.theme[0]);
  nextBtn.style.setProperty('--theme-right', fx.theme[1]);
  dotsEl.style.setProperty('--theme-left', fx.theme[0]);
  dotsEl.style.setProperty('--theme-right', fx.theme[1]);
  selectionIndexEl.style.color = `rgb(${fx.theme[0]})`;
  if (instant) requestAnimationFrame(() => bgEl.classList.remove('theme-instant'));
}

/* 將 active 卡片捲動置中 */
function centerActive(instant = false) {
  const card = cardEls[position];
  if (!card) return;
  if (instant) cardsEl.classList.add('no-transition');
  const target = card.offsetLeft + card.offsetWidth / 2 - viewportEl.clientWidth / 2;
  cardsEl.style.transform = `translateX(${-target}px)`;
  if (instant) {
    cardsEl.getBoundingClientRect();
    requestAnimationFrame(() => cardsEl.classList.remove('no-transition'));
  }
}

function startCarouselMotion(direction, instant) {
  clearTimeout(motionTimer);
  cardsEl.classList.remove('is-moving', 'moving-forward', 'moving-backward');
  if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cardsEl.classList.add('is-moving', direction >= 0 ? 'moving-forward' : 'moving-backward');
  motionTimer = setTimeout(() => {
    cardsEl.classList.remove('is-moving', 'moving-forward', 'moving-backward');
  }, 460);
}

function setActive(i, silent, direct = false, instant = false) {
  const next = (i + EFFECTS.length) % EFFECTS.length;
  if (next !== active && !silent) sndMove();

  // 保留目前這組卡片，避免跨過首尾時在轉場結束後換成另一個 iframe 實例。
  // 只有真的要走出三組實體卡片時才先無動畫回到中間的等價位置；一般在
  // 首尾模組之間來回時會持續使用同一對預覽實例。
  if (!direct) {
    const wrapsForward = active === EFFECTS.length - 1 && next === 0;
    const wrapsBackward = active === 0 && next === EFFECTS.length - 1;
    const delta = wrapsForward ? 1 : wrapsBackward ? -1 : next - active;
    if (position + delta < 0 || position + delta >= cardEls.length) {
      position = EFFECTS.length + active;
      cardEls.forEach((el, idx) => el.classList.toggle('active', idx === position));
      updateCardDepth();
      centerActive(true);
      updatePreviewPlayback();
    }
  }

  const previousPosition = position;
  if (direct) {
    position = EFFECTS.length + next;
  } else if (active === EFFECTS.length - 1 && next === 0) {
    position += 1;
  } else if (active === 0 && next === EFFECTS.length - 1) {
    position -= 1;
  } else {
    position += next - active;
  }

  active = next;
  startCarouselMotion(position - previousPosition, instant);
  cardEls.forEach((el, idx) => el.classList.toggle('active', idx === position));
  dotEls.forEach((d, idx) => d.classList.toggle('on', idx === active));
  updateCardDepth();
  updateSelectionUI(instant);
  centerActive(instant);
  updatePreviewPlayback();
}

/* 進場轉場：卡片放大 + 其他元素淡出，再跳頁 */
let launching = false;
function launch(i) {
  const fx = EFFECTS[i];
  if (!fx.href || launching) return;
  launching = true;
  sndEnter();
  document.body.classList.add('leaving');
  cardEls[position].classList.add('launching');
  setTimeout(() => { window.location.href = fx.href; }, 380);
}

prevBtn.addEventListener('click', () => setActive(active - 1));
nextBtn.addEventListener('click', () => setActive(active + 1));
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') setActive(active - 1);
  else if (e.key === 'ArrowRight') setActive(active + 1);
  else if (e.key === 'Enter') launch(active);
  else if (e.key.toLowerCase() === 's') sndBtn.click();
});

/* 觸控滑動切換 */
let touchX = null;
window.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
window.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) setActive(active + (dx < 0 ? 1 : -1));
  touchX = null;
}, { passive: true });

window.addEventListener('resize', centerActive);
mobilePreviewQuery.addEventListener('change', updatePreviewPlayback);
/* iframe 載入完成後再同步一次播放狀態（load 前 postMessage 會沒人聽） */
iframesReady();
function iframesReady() {
  window.addEventListener('load', () => { updatePreviewPlayback(); setTimeout(updatePreviewPlayback, 1500); });
}
/* 頁面不可見時全部暫停 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    iframes.forEach(f => { try { f && f.contentWindow.postMessage('vfx-pause', '*'); } catch (e) {} });
  } else updatePreviewPlayback();
});

buildCards();
active = initialEffectIndex;
position = EFFECTS.length + initialEffectIndex;
cardEls[position].classList.add('active');
dotEls[active].classList.add('on');
updateCardDepth();
updateSelectionUI(true);
centerActive(true);
updatePreviewPlayback();
