'use strict';

import { EFFECTS } from './effects.js?v=ios27-gallery-1';

const PREVIEW_W = 660;
const PREVIEW_H = 570;
const PREVIEW_DELAY_MS = 260;
const PREVIEW_REVEAL_DELAY_MS = 320;
const livePreviewQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const cardsEl = document.getElementById('cards');
const visibleCountEl = document.getElementById('visibleCount');
const sndBtn = document.getElementById('sndBtn');
const filterButtons = [...document.querySelectorAll('.filter-btn')];
const cardEls = [];

let activePreview = null;
let previewTimer = 0;
let pendingCard = null;
let launching = false;
let audioCtx = null;
let soundOn = (localStorage.getItem('vfx-sound') ?? '1') === '1';
let masonryRaf = 0;

function scheduleMasonryLayout() {
  if (masonryRaf) return;
  masonryRaf = requestAnimationFrame(() => {
    masonryRaf = 0;
    const gridStyle = getComputedStyle(cardsEl);
    const rowHeight = Number.parseFloat(gridStyle.gridAutoRows);
    const rowGap = Number.parseFloat(gridStyle.rowGap);
    if (!rowHeight || !Number.isFinite(rowGap)) return;

    const visibleCards = cardEls.filter(card => !card.hidden);
    visibleCards.forEach(card => { card.style.gridRowEnd = 'auto'; });
    // 先完成所有讀取，再一次寫回 span，避免每張卡各自觸發同步重排。
    const spans = visibleCards.map(card =>
      Math.ceil((card.scrollHeight + rowGap) / (rowHeight + rowGap))
    );
    visibleCards.forEach((card, index) => {
      card.style.gridRowEnd = `span ${spans[index]}`;
    });
  });
}

function blip(freq, duration = 0.055, gain = 0.055) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const oscillator = audioCtx.createOscillator();
    const volume = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, now);
    volume.gain.setValueAtTime(gain, now);
    volume.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(volume).connect(audioCtx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + .02);
  } catch (_) {
    // 音效是裝飾性回饋，瀏覽器若不允許建立 AudioContext 就保持安靜。
  }
}

function renderSoundButton() {
  sndBtn.setAttribute('aria-pressed', String(soundOn));
  sndBtn.title = soundOn ? '關閉介面音效' : '開啟介面音效';
}

sndBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('vfx-sound', soundOn ? '1' : '0');
  renderSoundButton();
  if (soundOn) blip(780, .07, .07);
});
renderSoundButton();

function categoriesFor(effect) {
  const categories = ['all'];
  if (effect.runtime) categories.push('liquid');
  if (effect.tags.some(tag => tag.includes('Canvas'))) categories.push('canvas');
  if (effect.tags.includes('Web Audio API')) categories.push('audio');
  if (effect.id === 'typewriter') categories.push('typography');
  return categories;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function fitPreview(frame, host) {
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.max(rect.width / PREVIEW_W, rect.height / PREVIEW_H);
  frame.style.left = '50%';
  frame.style.top = '50%';
  frame.style.right = 'auto';
  frame.style.bottom = 'auto';
  frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function stopLivePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = 0;
  pendingCard = null;
  if (!activePreview) return;
  const { card, frame } = activePreview;
  try { frame.contentWindow?.postMessage('vfx-pause', '*'); } catch (_) {}
  card.classList.remove('is-loading-preview', 'is-previewing');
  frame.remove();
  activePreview = null;
}

function startLivePreview(card, effect) {
  if (!livePreviewQuery.matches || reducedMotionQuery.matches || !effect.previewSrc) return;
  if (activePreview?.card === card) return;
  stopLivePreview();

  const host = card.querySelector('.card-preview');
  const frame = document.createElement('iframe');
  frame.width = PREVIEW_W;
  frame.height = PREVIEW_H;
  frame.tabIndex = -1;
  frame.loading = 'eager';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = `${effect.title} 即時預覽`;
  frame.addEventListener('load', () => {
    if (activePreview?.frame !== frame) return;
    fitPreview(frame, host);
    try { frame.contentWindow?.postMessage({ type: 'vfx-quality', fps: 30, dpr: 1.25 }, '*'); } catch (_) {}
    try { frame.contentWindow?.postMessage('vfx-play', '*'); } catch (_) {}
    const reveal = () => {
      if (activePreview?.frame === frame && frame.isConnected) {
        frame.classList.add('is-ready');
        card.classList.remove('is-loading-preview');
        card.classList.add('is-previewing');
      }
    };
    if (!effect.runtime) {
      window.setTimeout(reveal, PREVIEW_REVEAL_DELAY_MS);
      return;
    }
    // Three.js 預覽的 load 只代表 HTML/JS 已載入，不代表距離場烘焙與 shader
    // 編譯已經完成。等子頁真正畫出第一幀才從海報切到 iframe，避免卡片先顯示
    // 一張黑畫面或尚未開始的靜止畫面，卻已經錯標成 LIVE。
    const waitForFirstFrame = () => {
      if (activePreview?.frame !== frame || !frame.isConnected) return;
      let stageReady = false;
      try { stageReady = frame.contentDocument?.body?.dataset.stageReady === 'true'; } catch (_) {}
      if (stageReady) reveal();
      else window.setTimeout(waitForFirstFrame, 80);
    };
    waitForFirstFrame();
  }, { once: true });

  activePreview = { card, frame, host };
  // 先指定真正的網址再插入 DOM。若先插入空 iframe，瀏覽器會先派發一次
  // about:blank 的 load，讓上面 once:true 的監聽器過早被消耗；真正效果載完後
  // 就不會再加 is-ready，使用者只會一直看到海報。
  frame.src = effect.previewSrc;
  host.insertBefore(frame, host.querySelector('.preview-prism'));
  card.classList.add('is-loading-preview');
  fitPreview(frame, host);
}

function queueLivePreview(card, effect) {
  window.clearTimeout(previewTimer);
  if (activePreview?.card === card) { pendingCard = null; return; }
  pendingCard = card;
  previewTimer = window.setTimeout(() => {
    pendingCard = null;
    startLivePreview(card, effect);
  }, PREVIEW_DELAY_MS);
}

// 只取消「這張卡自己排的」那個計時器。捲動會讓游標底下換一張卡，瀏覽器補發的
// pointerleave 可能晚於新卡的 pointerenter；無條件清掉計時器就會把剛排好的預覽
// 一起取消，那張卡從此停在海報上。
function leaveCard(card) {
  if (pendingCard === card) {
    window.clearTimeout(previewTimer);
    previewTimer = 0;
    pendingCard = null;
  }
  if (activePreview?.card === card) stopLivePreview();
}

function launch(card, effect) {
  if (launching || !effect.href) return;
  launching = true;
  stopLivePreview();
  blip(940, .11, .08);
  document.body.classList.add('leaving');
  card.classList.add('launching');
  window.setTimeout(() => { window.location.href = effect.href; }, reducedMotionQuery.matches ? 0 : 340);
}

function buildCard(effect, index) {
  const card = document.createElement('a');
  card.className = `card${[0, 3, 8].includes(index) ? ' card--featured' : ''}`;
  card.href = effect.href;
  card.dataset.categories = categoriesFor(effect).join(' ');
  card.style.setProperty('--order', String(index));
  card.style.setProperty('--theme-left', effect.theme[0]);
  card.style.setProperty('--theme-right', effect.theme[1]);
  card.setAttribute('aria-label', `${effect.title}：${effect.description}`);

  const preview = makeElement('div', 'card-preview');
  const poster = makeElement('img', 'card-poster');
  poster.src = effect.posterSrc;
  poster.alt = `${effect.title} 預覽畫面`;
  poster.loading = index < 3 ? 'eager' : 'lazy';
  poster.decoding = 'async';
  poster.addEventListener('error', () => { poster.hidden = true; }, { once: true });
  poster.addEventListener('load', scheduleMasonryLayout, { once: true });
  const prism = makeElement('span', 'preview-prism');
  prism.setAttribute('aria-hidden', 'true');
  const previewState = makeElement('span', 'preview-state');
  previewState.appendChild(makeElement('span', '', 'Preview'));
  preview.append(poster, prism, previewState);

  const body = makeElement('div', 'card-body');
  const meta = makeElement('div', 'card-meta');
  meta.append(
    makeElement('span', 'card-index', String(index + 1).padStart(2, '0')),
    makeElement('span', 'card-category', effect.category),
  );
  const titleRow = makeElement('div', 'card-title-row');
  const title = makeElement('h3', 'card-title', effect.title);
  const arrow = makeElement('span', 'card-arrow', '↗');
  arrow.setAttribute('aria-hidden', 'true');
  titleRow.append(title, arrow);
  const description = makeElement('p', 'card-description', effect.description);
  const tags = makeElement('div', 'card-tags');
  effect.tags.forEach(technology => {
    const tag = makeElement('span', 'tag', technology);
    tag.dataset.tech = technology;
    tags.appendChild(tag);
  });
  body.append(meta, titleRow, description, tags);
  card.append(preview, body);

  card.addEventListener('pointerenter', () => {
    queueLivePreview(card, effect);
    blip(510 + index * 12);
  });
  card.addEventListener('pointerleave', () => leaveCard(card));
  card.addEventListener('focus', () => queueLivePreview(card, effect));
  card.addEventListener('blur', () => leaveCard(card));
  card.addEventListener('pointermove', event => {
    if (!livePreviewQuery.matches) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  });
  card.addEventListener('click', event => {
    event.preventDefault();
    launch(card, effect);
  });
  return card;
}

EFFECTS.forEach((effect, index) => {
  const card = buildCard(effect, index);
  cardEls.push(card);
  cardsEl.appendChild(card);
});

function applyFilter(filter) {
  stopLivePreview();
  let visible = 0;
  cardEls.forEach(card => {
    const show = card.dataset.categories.split(' ').includes(filter);
    card.hidden = !show;
    if (show) visible += 1;
  });
  visibleCountEl.textContent = String(visible).padStart(2, '0');
  cardsEl.setAttribute('aria-label', `視覺特效作品，目前顯示 ${visible} 件`);
  filterButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  });
  scheduleMasonryLayout();
  blip(690, .06, .05);
}

filterButtons.forEach(button => {
  button.addEventListener('click', () => applyFilter(button.dataset.filter));
});

window.addEventListener('resize', () => {
  if (activePreview) fitPreview(activePreview.frame, activePreview.host);
  scheduleMasonryLayout();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLivePreview();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') stopLivePreview();
});

livePreviewQuery.addEventListener('change', () => stopLivePreview());
scheduleMasonryLayout();
