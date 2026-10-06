import { EDGE_TINT_TARGETS, EDGE_TINT_STOPS, edgeTintParams } from './edge-tint.js';
import { EDGE_TINT_BASE_BY_BACKDROP, EDGE_TINT_STRENGTH_BY_BACKDROP } from './runtime-defaults.js?v=no-membrane-1';
import { INSTALLING_VISUAL_PRESETS, installingVisualPresetValues } from './visual-presets.js?v=tint-light-1';
import { motionParamsGate, usesShapeField, usesStudioGlass } from './motions/registry.js?v=studio-glass-1';

const PAGES = [['shape', '造型'], ['motion', '動態'], ['look', '外觀'], ['scene', '場景']];

const $ = id => document.getElementById(id);
const rowOf = id => $(id)?.closest('.row');
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function button(text, action) {
  const el = element('button', 'inspectorButton', text);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}
function writeControl(id, value) {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = String(value);
  el.dispatchEvent(new Event(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function readControl(id) {
  const el = $(id);
  return el.type === 'checkbox' ? el.checked : el.value;
}
// 滑桿只停在 step 的整數倍上，而預設值不保證落在格子上：邊緣光的淺底預設是
// 0.12，滑桿的間距是 0.05，瀏覽器會把它吸到 0.1。差這半格不是使用者調的，
// 照嚴格相等去比會讓一堆參數一進頁面就掛上「已調整」。
//
// 所以先把預設值照瀏覽器的規則吸到格子上再比。只給半格的容差不夠：預設剛好落在
// 兩格正中間時（補光強度 0.45、間距 0.02 → 0.46），差值是 0.010000000000000009，
// 浮點誤差讓它剛好超過半格。
function differsFromDefault(control, baseline) {
  const current = control.type === 'checkbox' ? control.checked : control.value;
  if (typeof baseline !== 'number') return current !== baseline;
  const step = Number.parseFloat(control.step);
  if (!(Number.isFinite(step) && step > 0)) return Math.abs(Number(current) - baseline) > 1e-9;
  const min = Number.parseFloat(control.min);
  const base = Number.isFinite(min) ? min : 0;
  const max = Number.parseFloat(control.max);
  // 正中間時瀏覽器取大的那格；(0.45 - 0) / 0.02 算出來是 22.499999999999996，
  // 補一點點才會跟瀏覽器一樣進位。
  let snapped = base + Math.round((baseline - base) / step + 1e-7) * step;
  if (Number.isFinite(max)) snapped = Math.min(snapped, max);
  snapped = Math.max(snapped, base);
  return Math.abs(Number(current) - snapped) > step * 1e-3;
}
function title(group, text) {
  group.querySelector(':scope > summary h3, :scope > summary h4').textContent = text;
}
function section(text, gate, open = true) {
  const group = element('details', 'group');
  group.open = open;
  if (gate) { group.dataset.gate = gate; group.classList.add('modeBlock'); }
  const summary = element('summary');
  summary.append(element('h3', '', text));
  group.append(summary);
  return group;
}
function segmented(labels, onSelect, name) {
  const group = element('div', 'inspectorSegments');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', name);
  const buttons = labels.map(([value, text]) => {
    const el = button(text, () => onSelect(value));
    el.dataset.value = value;
    el.setAttribute('aria-pressed', 'false');
    group.append(el);
    return el;
  });
  return { group, select(value) {
    buttons.forEach(el => el.setAttribute('aria-pressed', String(el.dataset.value === value)));
  } };
}

// 打字模式的「文字與造型」：分頁版面與單頁面板都把這幾列獨立成一區，跟時間軸分開。
const TYPOGRAPHY_KEYS = [
  'typeText', 'typeSize', 'typeTracking', 'typeDepth', 'typeBevel', 'typeSoftness',
  'typeCaretWidth', 'typeCaretDepth',
];

// 棚景的燈與黑卡：方位盤、彈出的「細調」、單頁面板的「燈光」區都從這張表產生。
// 加一盞燈：這裡加一筆，shader 那邊（environment.js 的 studioDir 與 bubble.js 的
// syncStudioLights）另外接。黑卡（flag）沒有強度。
const STUDIO_LIGHTS = [
  { id: 'key', label: '主光', short: '主光', azimuth: 'lightKeyAzimuth', elevation: 'lightKeyElevation',
    size: 'lightKeySize', power: 'lightKeyPower' },
  { id: 'fill', label: '補光', short: '補光', azimuth: 'lightFillAzimuth', elevation: 'lightFillElevation',
    size: 'lightFillSize', power: 'lightFillPower' },
  { id: 'rim', label: '邊光', short: '邊光', azimuth: 'lightRimAzimuth', elevation: 'lightRimElevation',
    size: 'lightRimSize', power: 'lightRimPower' },
  { id: 'flagA', label: '黑卡 A', short: '黑卡A', azimuth: 'flagAAzimuth', elevation: 'flagAElevation',
    size: 'flagASize', flag: true },
  { id: 'flagB', label: '黑卡 B', short: '黑卡B', azimuth: 'flagBAzimuth', elevation: 'flagBElevation',
    size: 'flagBSize', flag: true },
];
// 全部燈共用的設定。
const SHARED_LIGHT_ENTRIES = [
  ['studioCardGain', '燈的亮度'], ['studioCardFalloff', '燈的衰減'],
  ['studioCardEdge', '燈的銳利度'], ['studioAmbient', '環境亮度'],
];
// 單頁面板「燈光」區（手機的抽屜用）：每一盞的方向、高度、大小、強度，最後是共用設定。
const LIGHT_ENTRIES = [
  ...STUDIO_LIGHTS.flatMap(light => [
    [light.azimuth, `${light.short} 方向`], [light.elevation, `${light.short} 高度`],
    [light.size, `${light.short} 大小`],
    ...(light.power ? [[light.power, `${light.short} 強度`]] : []),
  ]),
  ...SHARED_LIGHT_ENTRIES,
];

// Move the original controls, preserving IDs, handlers, gates and preset state.
export function buildInspector({ defaults, modeDefault = () => undefined, launchMotion = null }) {
  const panel = $('panel');
  panel.classList.add('inspector');
  const DEPTH_KEY = 'vfx:bubble:control-depth';
  const PAGE_KEY = 'vfx:bubble:inspector-page';
  const groups = [...panel.querySelectorAll(':scope > details.group')];
  const groupOf = id => $(id).closest('details.group');
  const motion = groupOf('motion');
  const shape = groupOf('shapeSource');
  const drops = groupOf('radius');
  const material = groupOf('reflect');
  const post = groupOf('postExposure');
  const camera = groupOf('cameraDistance');
  const quality = groupOf('antialiasLevel');
  const background = groupOf('backdrop');
  const share = groupOf('presetIO');
  const header = element('header', 'inspectorHeader');
  const heading = panel.querySelector(':scope > h2');
  heading.textContent = '液態玻璃';
  const sub = panel.querySelector(':scope > .sub');
  sub.textContent = 'LIQUID GLASS · 即時預覽';
  const identity = element('div', 'inspectorIdentity');
  identity.append(heading, sub);
  const context = element('div', 'inspectorContext');
  panel.prepend(header);
  header.append(identity, context);
  context.append(rowOf('motion'), rowOf('backdrop'));
  // 每個模式是首頁上一個獨立的模組，進來之後不能切成另一個。選單留在 DOM 裡只是
  // 給參數檔與模式記憶讀寫用，任何深度都不顯示。
  const motionRow = rowOf('motion');
  motionRow.hidden = true;
  motionRow.style.display = 'none';
  rowOf('backdrop').querySelector('label').textContent = '預覽底色';

  let controlDepth = 'concise';
  // 面板還在組裝時不要跑 refresh：它會去讀配色卡片那些還沒建立的狀態。
  let built = false;
  try {
    const saved = localStorage.getItem(DEPTH_KEY);
    if (saved === 'concise' || saved === 'complete') controlDepth = saved;
  } catch (_) {}
  const depthWrap = element('div', 'inspectorDepth');
  const depthMeta = element('div', 'inspectorDepthMeta');
  const depthHeading = element('span', 'inspectorDepthLabel', '控制深度');
  const qualityStatus = element('output', 'inspectorQuality');
  qualityStatus.id = 'renderQualityStatus';
  qualityStatus.setAttribute('aria-live', 'polite');
  qualityStatus.title = '預覽品質會依裝置效能自動調整，輸出不受影響';
  depthMeta.append(depthHeading, qualityStatus);
  const depthHelp = element('span', 'inspectorDepthHelp', '常用保留主要調整；完整顯示所有參數');
  depthHelp.setAttribute('role', 'status');
  depthHelp.setAttribute('aria-live', 'polite');
  const depthPicker = segmented([['concise', '常用'], ['complete', '完整']], value => {
    setControlDepth(value);
  }, '控制深度');
  depthPicker.group.classList.add('inspectorDepthPicker');
  depthWrap.append(depthMeta, depthPicker.group, depthHelp);
  header.append(depthWrap);

  function setControlDepth(value, persist = true) {
    controlDepth = value === 'complete' ? 'complete' : 'concise';
    panel.dataset.controlDepth = controlDepth;
    document.body.dataset.controlDepth = controlDepth;
    depthPicker.select(controlDepth);
    depthHelp.textContent = controlDepth === 'complete'
      ? '目前顯示全部參數'
      : '常用保留主要調整；完整顯示所有參數';
    if (persist) {
      try { localStorage.setItem(DEPTH_KEY, controlDepth); } catch (_) {}
    }
    // 切換深度會讓整批進階控制出現或消失，空區塊的名單跟著變。
    if (built) refresh();
  }

  function setQualityStatus(state = {}) {
    const labels = { high: '高品質', balanced: '平衡', low: '效能' };
    const tier = labels[state.tier] ? state.tier : 'high';
    qualityStatus.dataset.tier = tier;
    qualityStatus.textContent = `預覽 · ${labels[tier]}`;
  }

  const tabs = element('div', 'inspectorTabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '參數分類');
  tabs.setAttribute('aria-orientation', 'horizontal');
  header.append(tabs);
  const panes = {};
  const tabButtons = [];
  function selectPage(key) {
    if (!panes[key]) return;
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== key;
    tabButtons.forEach(el => {
      const active = el.dataset.page === key;
      el.setAttribute('aria-selected', String(active));
      el.tabIndex = active ? 0 : -1;
    });
    panel.scrollTop = 0;
    try { localStorage.setItem(PAGE_KEY, key); } catch (_) {}
  }
  for (const [key, text] of PAGES) {
    const tab = button(text, () => selectPage(key));
    tab.id = `inspectorTab-${key}`;
    tab.dataset.page = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `inspectorPage-${key}`);
    tab.addEventListener('keydown', event => {
      const index = tabButtons.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % 4
        : event.key === 'ArrowLeft' ? (index + 3) % 4
        : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : -1;
      if (next < 0) return;
      event.preventDefault();
      selectPage(tabButtons[next].dataset.page);
      tabButtons[next].focus();
    });
    const pane = element('section', 'inspectorPage');
    pane.id = `inspectorPage-${key}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tab.id);
    panes[key] = pane;
    tabButtons.push(tab);
    tabs.append(tab);
    panel.append(pane);
  }
  panes.shape.append(shape, drops);
  panes.motion.append(motion);
  panes.look.append(material, post);
  panes.scene.append(background, camera, quality, share);
  title(motion, '動態節奏');
  title(shape, '匯入與形狀');
  title(material, '整體玻璃');
  title(post, '光暈與後期');
  title(background, '背景與環境光');
  title(camera, '鏡頭');
  title(quality, '預覽品質');
  title(share, '儲存與載入');
  material.querySelector('summary').after(element('p', 'inspectorNote', '影響整體玻璃；局部配色可在上方分別調整。'));
  material.open = false;
  post.open = false;
  background.open = true;
  const backgroundNotes = [...background.querySelectorAll(':scope > .note')];
  backgroundNotes[0].textContent = '深底與淺底會分別記住材質調整。';
  backgroundNotes[1].textContent = '淺底使用由上到下的背景漸層。';
  quality.querySelector('.hint').textContent = '提高品質可減少邊緣鋸齒；預覽不順時可降低。';
  for (const group of groups) {
    if (group.parentElement === panel) panes.scene.append(group);
  }
  const tips = section('操作提示', null, false);
  panel.querySelectorAll(':scope > .hint').forEach(el => tips.append(el));
  const reset = panel.querySelector(':scope > .btns');
  $('resetBtn').textContent = '重設目前模式';
  const utilities = section('更多與管理', null, false);
  utilities.classList.add('inspectorUtilities');
  // 桌面上這些在右上角的 ⋯ 選單裡（見 buildTopBar），面板這一區只留給手機。
  utilities.classList.add('inspectorTopBarMirrored');
  utilities.append(share, tips, reset);
  panes.scene.append(utilities);

  // Installing-specific controls are separated by purpose, with their original
  // research gate copied to each destination. Borrow anchors remain live.
  const research = panel.querySelector('#extendedMotionControls > [data-gate="research"]');
  const shell = rowOf('researchShellTint').closest('details');
  const icons = rowOf('researchIconTint').closest('details');
  const companion = rowOf('researchCompanionSize').closest('details');
  const texture = rowOf('researchShellTexture').closest('details');
  const bubbles = $('researchBubbles').closest('details');
  for (const group of [shell, icons, companion, texture, bubbles]) {
    group.dataset.gate = 'research';
    group.classList.add('modeBlock');
  }
  title(shell, '外殼造型');
  title(icons, '圖示造型與排列');
  title(companion, '融合與第二外殼');
  title(texture, '表面紋理');
  title(bubbles, '內部氣泡');
  panes.shape.prepend(shell, icons, bubbles);
  panes.motion.append(companion);
  panes.look.append(texture);
  const timing = section('呼吸與圖示時序', 'research');
  timing.append(rowOf('researchBreath'), rowOf('researchIconPhaseOffset'), rowOf('researchIconBirthStagger'));
  panes.motion.append(timing);
  const companionSize = rowOf('researchCompanionSize');
  companionSize.querySelector('label').textContent = '第二外殼大小';
  shell.append(companionSize);
  const surface = section('表面細節', 'research', false);
  for (const key of ['wobble', 'wobbleScale', 'wobbleSpeed']) {
    const anchor = research.querySelector(`[data-borrow="${key}"]`) || shell.querySelector(`[data-borrow="${key}"]`);
    surface.append(anchor);
    // Initial binding may already have borrowed these rows before the layout.
    if (rowOf(key)?.parentElement === shell) anchor.after(rowOf(key));
  }
  panes.look.append(surface);
  const directions = section('進階紋理方向', null, false);
  directions.className = 'subgroup inspectorAdvanced';
  for (const key of ['researchTextureDirX', 'researchTextureDirY', 'researchTextureDirZ']) directions.append(rowOf(key));
  texture.append(directions);

  const staticBlock = panel.querySelector('#extendedMotionControls > [data-gate="static"]');
  if (staticBlock) {
    const geometry = section('幾何造型', 'static');
    geometry.append(staticBlock);
    panes.shape.prepend(geometry);
  }
  const capillary = panel.querySelector('#extendedMotionControls > [data-gate="capillaryTextureUI"]');
  if (capillary) {
    const waves = section('表面波紋', 'capillaryTextureUI');
    waves.append(capillary);
    panes.look.append(waves);
  }
  const typography = section('文字與造型', 'typewriter');
  for (const key of TYPOGRAPHY_KEYS) {
    typography.append(rowOf(key));
    if (key === 'typeText') typography.append($('typeTextInfo'));
  }
  const fonts = section('字體', 'typewriter', false);
  fonts.append($('typeFontGroup'));
  panes.shape.prepend(typography, fonts);
  const formationTiming = section('成型時間軸', 'formation');
  const oldTimelineTitle = shape.querySelector('.effectSubhead[data-gate="formation"]');
  if (oldTimelineTitle) oldTimelineTitle.hidden = true;
  formationTiming.append(rowOf('gatherDuration'), rowOf('shapeHold'), $('timelineSummary'));
  panes.motion.prepend(formationTiming);

  // 常用模式是展示層，控制項本體仍留在 DOM，完整模式可立即恢復。這份清單只挑
  // 會直接改變構圖、節奏或主要材質印象的控制；精細噪聲、光學與後期參數歸完整。
  const primaryControls = new Set([
    'loopDuration', 'holdBreath', 'formationVariety', 'formationArc',
    'weaveSizeMin', 'weaveSizeMax', 'weaveDriftAmount', 'weaveOrbit',
    'shatterRest', 'shatterChargeTime', 'shatterFlight', 'shatterReform', 'shatterRange',
    'meltRate', 'meltHang', 'meltSag', 'meltFall', 'meltSizeMin', 'meltSizeMax',
    'morphHold', 'morphStagger', 'morphArc', 'morphSwell',
    'jellyStyle', 'jellyPokes', 'jellyAmount', 'jellyBounces', 'jellyDamping',
    'typeText', 'typeSize', 'typeTracking', 'typeDepth', 'typeBevel',
    'shapeMotionOn', 'shapeSpinY', 'shapeBreathe', 'shapeBob',
    'shapeSource', 'shapeQuality', 'shapeAScale', 'shapeInput', 'gatherDuration',
    'shapeHold', 'microCount', 'shapeDepth', 'shapeEdgeBevel', 'shapeLiquid',
    'shapeLiquidPosition', 'shapeLiquidSize', 'shapeLiquidSpeed',
    'count', 'radius', 'viscosity', 'spread', 'wobble',
    'materialStyle', 'reflect', 'transmission', 'absorb', 'absorbColor',
    'materialExposure', 'roughness', 'fresnel', 'ior',
    'cameraDistance', 'cameraFov', 'cameraRotationY', 'cameraRotationX', 'spin', 'dollyEnabled',
    'bgMode', 'bgColor', 'lightBgGradientTop', 'lightBgGradientBottom', 'lightShow',
    'lightClarity', 'lightDepth', 'lightChroma',
    // HDRI 的三根（水平／垂直／模糊）移到完整模式。它們只有在「預覽底色」走
    // HDRI 背景時才有作用，而那是一個要先知道 HDRI 是什麼才會選的分支 ——
    // 擺在常用等於先問使用者一個他還沒遇到的問題。所有模式一致。
    'researchShellTint', 'researchShellTintColor', 'researchShellTintEdge',
    'researchBreath', 'researchCompanionSize', 'researchCompanionExposure',
    'researchCompanionDepth', 'researchCompanionHold', 'researchCompanionPath',
    'researchShellTexture', 'researchShellAmount', 'researchShellSpeed',
    'researchShellDensity', 'researchBubbles', 'researchBubbleCount',
    'researchIconTint', 'researchIconTintColor', 'researchIconTintEdge',
    'researchIconPhaseOffset', 'researchIconBirthStagger', 'researchIconSizeA',
    'researchIconSizeB', 'researchIconAspect', 'researchIconSpread',
    'researchIconStagger', 'researchIconDepth',
    // 靜態模式的玻璃。六根，而且全部是「看得到就懂」的量：彩虹多不多、燈亮不
    // 亮、對比夠不夠、影子多深、地板上有沒有光斑與波紋。
    //
    // 其餘的留在完整模式，因為它們都需要先知道一件事才調得動：阿貝數要知道那是
    // 材料常數、光譜取樣是品質不是外觀、燈的銳利度改的其實是「色帶看不看得見」。
    // 那些是 3D 出身的人才會有的前提，不該擋在第一次開面板的人前面。
    'dispersionScale', 'studioCardStrength', 'studioFlag',
    // 主光的方位與高度：換一種打光是這個材質最大的表情變化，兩根就夠。
    // 其餘十六根燈位參數留在完整模式。
    'lightKeyAzimuth', 'lightKeyElevation',
    'studioShadowStrength', 'studioCaustic',
    // 幾何造型的選擇器與它的尺寸。這幾根本來歸在完整模式，等於把這個模組最
    // 主要的操作藏在第二層 —— 常用模式下的「造型」分頁整頁是空的。
    // 全部由 staticShape* 閘門控制，只有靜態模式看得到，不影響其餘模式。
    'staticShape', 'boxSize', 'boxCornerRadius',
    'primitiveSize', 'primitiveHeight', 'primitiveTubeRatio',
    // 圓角是第一級的外觀控制，尤其對匯入的 SVG：平行面偏折為零，色散只可能
    // 長在那一圈圓角上，所以圓角大小直接決定「看不看得到彩虹」。這一根的閘門
    // 是 shape，其餘形狀場模式的常用面板也會一起出現它 —— 那是刻意的。
    'shapeEdgeBevel',
  ]);
  for (const prefix of EDGE_TINT_TARGETS) {
    primaryControls.add(`${prefix}MultiTint`);
    primaryControls.add(`${prefix}MultiTintStrength`);
    primaryControls.add(`${prefix}MultiTintRotation`);
    for (let index = 0; index < EDGE_TINT_STOPS.length; index++) {
      primaryControls.add(`${prefix}TintStopColor${index}`);
      primaryControls.add(`${prefix}TintStopPos${index}`);
    }
  }
  panel.querySelectorAll('.row').forEach(row => {
    if (row.closest('.inspectorHeader')) return;
    const control = row.querySelector('input[id], select[id], textarea[id]');
    if (control && !primaryControls.has(control.id)) row.classList.add('inspectorExpert');
  });
  for (const expertGroup of [post, quality, share, tips, surface]) {
    expertGroup.classList.add('inspectorExpert');
  }

  const colors = section('局部配色', 'research');
  colors.classList.add('inspectorColors');
  panes.look.prepend(colors);
  const notice = element('div', 'inspectorNotice');
  notice.append(element('p', '', '深底與淺底的配色會分別保存。'));
  const colorBody = element('div', 'inspectorColorBody');
  colors.append(notice, colorBody);
  let target = 'researchShell';
  const cards = new Map();
  const objectPicker = segmented([['researchShell', '外殼'], ['researchIcon', '圖示']], value => {
    target = value; refresh();
  }, '配色對象');
  colorBody.append(objectPicker.group);
  const status = element('output', 'inspectorStatus');
  status.setAttribute('aria-live', 'polite');
  let undo = null;
  let colorContext = `${$('motion').value}|${$('backdrop').value}`;
  // 「這一格算不算被調過」與「重設這組配色」讀的是同一個基準。基底色的基準是
  // 當下的底色本身，所以要看 backdrop，不能只讀一份固定的 defaults。
  const colorDefault = key => {
    // 有模式記憶的參數以那一格為準（它已經含深／淺底的差異，見
    // runtime-memory 的 motionDefaultsFor）。其餘才走下面的全域規則。
    const scoped = modeDefault(key);
    if (scoped !== undefined) return scoped;
    const backdrop = $('backdrop').value;
    if (EDGE_TINT_TARGETS.some(prefix => key === `${prefix}Tint`)) {
      return EDGE_TINT_STRENGTH_BY_BACKDROP[backdrop] ?? defaults[key];
    }
    if (EDGE_TINT_TARGETS.some(prefix => key === `${prefix}TintColor`)) {
      return EDGE_TINT_BASE_BY_BACKDROP[backdrop] ?? defaults[key];
    }
    // 吸收色只有淺底跟著背景走；深底維持它原本手調的水藍色（見
    // runtime-memory 的同一段說明）。
    if (key === 'absorbColor' && backdrop === 'light') {
      return EDGE_TINT_BASE_BY_BACKDROP.light;
    }
    return defaults[key];
  };
  function applyValues(values, message) {
    undo = Object.fromEntries(Object.keys(values).map(key => [key, readControl(key)]));
    for (const [key, value] of Object.entries(values)) writeControl(key, value);
    status.textContent = message;
    refresh();
  }
  const stylePresets = element('div', 'inspectorStylePresets');
  const stylePresetHeading = element('div', 'inspectorStylePresetHeading');
  stylePresetHeading.append(
    element('span', '', '推薦風格'),
    element('span', '', '深／淺底自動對應'),
  );
  const stylePresetButtons = element('div', 'inspectorStylePresetButtons');
  for (const preset of INSTALLING_VISUAL_PRESETS) {
    const presetButton = button(preset.label, () => {
      applyValues(
        installingVisualPresetValues(preset.id, $('backdrop').value),
        `已套用${preset.label}風格；外殼與 Icons 仍可分別調整。`,
      );
    });
    presetButton.classList.add('inspectorStylePreset');
    presetButton.dataset.visualPreset = preset.id;
    presetButton.style.setProperty('--preset-swatch', preset.swatch);
    stylePresetButtons.append(presetButton);
  }
  stylePresets.append(stylePresetHeading, stylePresetButtons);
  colorBody.prepend(stylePresets);
  for (const prefix of EDGE_TINT_TARGETS) {
    const card = element('div', 'inspectorColorCard');
    card.dataset.tintTarget = prefix;
    const name = prefix === 'researchShell' ? '外殼' : '圖示';
    const other = prefix === 'researchShell' ? 'researchIcon' : 'researchShell';
    const keys = [`${prefix}Tint`, `${prefix}TintEdge`, `${prefix}TintColor`, ...edgeTintParams(prefix).map(p => p.key)];
    const modeRow = rowOf(`${prefix}MultiTint`);
    modeRow.hidden = true;
    const picker = segmented([['single', '單色'], ['multi', '多色']], mode => {
      writeControl(`${prefix}MultiTint`, mode === 'multi');
    }, `${name}配色方式`);
    const palette = buildPalette(prefix, applyValues);
    const single = rowOf(`${prefix}TintColor`);
    const strength = rowOf(`${prefix}Tint`);
    strength.querySelector('label').textContent = '染色強度';
    const edge = rowOf(`${prefix}TintEdge`);
    edge.querySelector('label').textContent = '邊緣集中';
    const edgeHint = element('div', 'inspectorEndpoints');
    edgeHint.append(element('span', '', '向內擴散'), element('span', '', '集中邊緣'));
    const rotation = rowOf(`${prefix}MultiTintRotation`);
    rotation.querySelector('label').textContent = '色彩旋轉';
    // 進階配色預設展開：基底色與多色比例是決定整體感的兩項，收起來會讓人以為
    // 只有上面那排色標可調。
    const advanced = section('進階配色', null, true);
    advanced.className = 'subgroup inspectorAdvanced';
    const baseSlot = element('div');
    const mix = rowOf(`${prefix}MultiTintStrength`);
    mix.querySelector('label').textContent = '多色比例';
    advanced.append(baseSlot, mix, rowOf(`${prefix}MultiTintFocus`),
      element('p', 'inspectorNote', '基底色保留中央與過渡色。多色比例越高，邊界越偏向漸層；折射聚色強化光線轉折處的色彩。'));
    const singleSlot = element('div');
    const actions = element('div', 'inspectorActions');
    const copy = button(other === 'researchShell' ? '從外殼複製' : '從圖示複製', () => {
      applyValues(Object.fromEntries(keys.map(key => [key, readControl(key.replace(prefix, other))])), `已複製到${name}，之後仍可獨立調整。`);
    });
    const resetColor = button('重設這組配色', () => {
      applyValues(Object.fromEntries(keys.map(key => [key, colorDefault(key)])), `已重設${name}配色。`);
    });
    actions.append(copy, resetColor);
    card.append(picker.group, modeRow, singleSlot, palette.root, strength, edge, edgeHint, rotation, advanced, actions);
    if (prefix === 'researchIcon') {
      const optics = section('圖示折射', null, false);
      optics.className = 'subgroup inspectorAdvanced';
      optics.append(rowOf('researchIconIOR'));
      card.append(optics);
    }
    colorBody.append(card);
    cards.set(prefix, { card, picker, palette, single, singleSlot, baseSlot, advanced, rotation, keys });
  }
  const undoButton = button('復原上次配色操作', () => {
    if (!undo) return;
    const values = undo; undo = null;
    for (const [key, value] of Object.entries(values)) writeControl(key, value);
    status.textContent = '已復原配色。'; refresh();
  });
  colorBody.append(status, undoButton);

  // 標題只分三級：分頁裡的區塊、區塊裡的子區塊，以及子區塊裡的小標。
  //
  // 原本的層級是各自從來源帶過來的：作品頁的 .group 是 16px、動態模式 registry
  // 產生的 .subgroup 是 13px、面板內建的 .inspectorAdvanced 是 12px。搬進分頁
  // 之後，位階相同的東西會因為出身不同而有三種大小——「表面紋理」跟「局部配色」
  // 在外觀分頁裡是同一級，卻一個 13px 一個 16px。這裡照「在分頁裡的實際深度」
  // 重新標一次，CSS 只認這兩個 class，不再看 .group / .subgroup。
  for (const pane of Object.values(panes)) {
    for (const node of pane.querySelectorAll('details')) {
      const top = node.parentElement === pane;
      node.classList.toggle('inspectorSection', top);
      node.classList.toggle('inspectorSubsection', !top);
    }
  }

  // Labels also serve keyboard/screen-reader users, including older HTML rows.
  panel.querySelectorAll('.row').forEach(row => {
    const label = row.querySelector('label');
    const input = row.querySelector('input[id], select[id], textarea[id]');
    if (label && input) label.htmlFor = input.id;
  });
  installNumberEditing(panel);

  // 重設的顆粒度跟分頁一致。原本每個區塊底下各掛一顆「重設此區」，光是「場景」
  // 一頁就有四顆，而且「此區」指的是哪一區要往上找標題才知道；分頁本身已經是
  // 使用者心裡的分類，一頁一顆說得清楚，也對得上「重設目前模式」的層級。
  //
  // 做法是「整個模式重設一次，再把這一頁以外的值寫回去」，而不是自己算這一頁
  // 每一根的預設值。一根參數的預設其實有三層——全域、模式／底色記憶格、材質
  // 類型的 profile——自己重算一定會跟真正的重設對不起來（例如體積吸收在融化
  // 模式下是材質 profile 給的，跟全域預設不同）。借用那條唯一正確的路徑，就不
  // 會有第二份規則要維護。
  for (const [key, label] of PAGES) {
    const pane = panes[key];
    const resetPage = button(`重設「${label}」`, () => {
      const keep = panel.querySelectorAll('.inspectorPage input[id], .inspectorPage select[id], .inspectorPage textarea[id]');
      const outside = [...keep]
        .filter(control => Object.hasOwn(defaults, control.id) && !pane.contains(control))
        .map(control => [control.id, readControl(control.id)]);
      $('resetBtn').click();
      for (const [id, value] of outside) writeControl(id, value);
      undo = null;
      status.textContent = '';
      resetPage.textContent = `已重設「${label}」`;
      window.setTimeout(() => { resetPage.textContent = `重設「${label}」`; }, 1400);
      refresh();
    });
    resetPage.classList.add('inspectorPageReset');
    resetPage.setAttribute('aria-label', `重設${label}分頁的所有參數`);
    // 「更多與管理」放的是存檔、提示與整個模式的重設，不屬於這一頁的參數，
    // 所以分頁重設排在它前面，也不會把它一起清掉（見 pageControls）。
    pane.insertBefore(resetPage, pane.querySelector(':scope > .inspectorUtilities'));
  }
  // 「這個東西現在看得到嗎」——刻意不用 offsetParent 之類的版面查詢：沒被選到的
  // 分頁整頁是 hidden，量出來會是全部都看不到。這裡讀的是面板自己那四條隱藏
  // 規則，跟哪一頁在前面無關。
  function isHiddenNode(node) {
    return node.hidden
      || node.classList.contains('gated-off')
      || node.classList.contains('is-emptyHidden')
      || (controlDepth === 'concise' && node.classList.contains('inspectorExpert'))
      || node.style.display === 'none';
  }
  function hasVisibleControl(node) {
    for (const child of node.children) {
      if (child.tagName === 'SUMMARY' || isHiddenNode(child)) continue;
      // [role="slider"]：自己畫的控制項（例如燈光方向盤是一張 canvas）也算。
      // 靜態模組的燈光區只剩方向盤時，少了這一條整塊會被當成空區塊收掉。
      if (child.matches('input, select, textarea, button, [role="slider"]')) return true;
      // 標題上有開關的子區塊（例如光暈的總開關）在 pruneEmptySections 裡會留成一列
      // 開關，所以對外層來說它就是一個看得到的控制項 —— 不算的話，光暈關著時整個
      // 「後期」區會被當成空的收掉，開關也跟著不見。
      if (child.tagName === 'DETAILS'
        && child.querySelector(':scope > summary input, :scope > summary button')) return true;
      if (hasVisibleControl(child)) return true;
    }
    return false;
  }
  // 點開之後是一片空白的區塊，比沒有那個區塊還糟：使用者會以為東西壞了。
  // 常用深度會藏掉大部分參數，「進階紋理方向」「色散」「薄膜外觀」這幾個區塊
  // 的內容剛好整組都是進階項，剩下一個打不開的空殼。
  //
  // 內容全空又沒有開關 → 整塊收起來。摘要列上有開關的（色散、薄膜這種整組
  // 開關）留著，但拿掉展開箭頭、也擋掉展開，讓它讀起來就是一列開關。
  function pruneEmptySections() {
    // 由深到淺：子區塊先定案，外層才數得到「裡面其實沒東西」。
    // 用自己的 class 而不是 hidden —— hidden 是 refresh 拿來開關配色卡片與
    // 進階區塊的，寫進去會把那些刻意的隱藏一起蓋掉。
    const sections = [...panel.querySelectorAll('.inspectorPage details')].reverse();
    for (const node of sections) {
      const body = hasVisibleControl(node);
      const summaryControl = !!node.querySelector(':scope > summary input, :scope > summary button');
      node.classList.toggle('is-bodyEmpty', !body);
      node.classList.toggle('is-emptyHidden', !body && !summaryControl);
      if (!body) node.open = false;
    }
    // 小標不是容器，是一排兄弟節點的分隔線，所以得往後看到下一個小標為止。
    // 色散那一組在常用深度只剩下開關，九個小標之間全是空的。
    for (const subhead of panel.querySelectorAll('.inspectorPage .effectSubhead')) {
      let covers = false;
      for (let node = subhead.nextElementSibling; node; node = node.nextElementSibling) {
        if (node.classList.contains('effectSubhead')) break;
        if (!isHiddenNode(node) && (node.matches('input, select, textarea, button') || hasVisibleControl(node))) {
          covers = true;
          break;
        }
      }
      subhead.classList.toggle('is-emptyHidden', !covers);
    }
  }
  panel.addEventListener('click', event => {
    const summary = event.target.closest('.inspectorPage details.is-bodyEmpty > summary');
    if (summary && !event.target.closest('input, button, .summaryToggle')) event.preventDefault();
  });

  let pending = false;
  function scheduleRefresh(event) {
    if (event?.target?.dataset?.presetIgnore !== undefined) return;
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; refresh(); });
  }
  panel.addEventListener('input', scheduleRefresh);
  panel.addEventListener('change', scheduleRefresh);
  $('resetBtn').addEventListener('click', () => { undo = null; status.textContent = ''; scheduleRefresh(); });
  function refresh() {
    // Presentation only: keep the filled slider track in sync with native values.
    panel.querySelectorAll('input[type="range"]').forEach(input => {
      const min = Number(input.min || 0), max = Number(input.max || 100);
      const progress = max > min ? (Number(input.value) - min) / (max - min) * 100 : 0;
      input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
    });
    const light = $('backdrop').value === 'light';
    const nextContext = `${$('motion').value}|${$('backdrop').value}`;
    if (colorContext !== nextContext) {
      colorContext = nextContext;
      undo = null;
      status.textContent = '';
    }
    rowOf('bgMode').hidden = light;
    rowOf('bgColor').hidden = light;
    rowOf('lightBgGradientTop').hidden = !light;
    rowOf('lightBgGradientBottom').hidden = !light;
    backgroundNotes[1].hidden = !light;
    notice.hidden = false;
    colorBody.hidden = false;
    objectPicker.select(target);
    undoButton.hidden = !undo;
    panel.querySelectorAll('.val[role="button"]').forEach(readout => {
      const label = readout.closest('.row')?.querySelector('label')?.textContent;
      if (label) readout.setAttribute('aria-label', `輸入${label}數值`);
    });
    panel.querySelectorAll('.inspectorPage .row').forEach(row => {
      const control = row.querySelector('input[id], select[id], textarea[id]');
      if (!control || !Object.hasOwn(defaults, control.id)) return;
      row.classList.toggle('is-modified', differsFromDefault(control, colorDefault(control.id)));
    });
    for (const [prefix, state] of cards) {
      state.card.hidden = prefix !== target;
      const multi = $(`${prefix}MultiTint`).checked;
      state.picker.select(multi ? 'multi' : 'single');
      state.palette.root.hidden = !multi;
      state.rotation.hidden = !multi;
      state.advanced.hidden = !multi;
      state.single.querySelector('label').textContent = multi ? '基底色' : '染色色彩';
      const destination = multi ? state.baseSlot : state.singleSlot;
      if (state.single.parentElement !== destination) destination.append(state.single);
      state.palette.refresh();
      state.palette.root.querySelectorAll('button, input[data-preset-ignore]').forEach(el => {
        el.disabled = !multi || $('motion').value !== 'research';
      });
      for (const key of state.keys) {
        const el = $(key);
        el.closest('.row')?.classList.toggle('is-modified', differsFromDefault(el, colorDefault(key)));
      }
      for (const suffix of ['Tint', 'TintEdge', 'MultiTintStrength']) {
        const readout = $(`${prefix}${suffix}_v`);
        if (!readout.querySelector('input')) readout.textContent = `${Math.round(Number($(`${prefix}${suffix}`).value) * 100)}%`;
      }
      $(`${prefix}MultiTintRotation_v`).textContent = `${$(`${prefix}MultiTintRotation`).value}°`;
    }
    // 最後才跑：閘門、深度與上面那些 hidden 都定案之後，空區塊才數得準。
    pruneEmptySections();
    staticDial?.draw();
    studioQuickDock?.sync();
    studioShapeCard?.sync();
    studioFloorCard?.sync();
    syncLightPopover();
    splitSync?.();
    iorPresetSync?.();
    glassTintSync?.();
    antialiasSync?.();
    backdropSync?.();
  }
  let staticDial = null;
  let lightPopover = null;
  let studioQuickDock = null;
  let studioShapeCard = null;
  let studioFloorCard = null;
  let splitSync = null;
  let iorPresetSync = null;
  let glassTintSync = null;
  let antialiasSync = null;
  let backdropSync = null;
  let alignSideStack = null;
  built = true;
  if (usesStudioGlass(launchMotion)) {
    buildStudioLayout();
    // 單頁面板沒有「常用／完整」之分；不寫回 localStorage，其餘模式的深度照舊。
    setControlDepth('complete', false);
  } else {
    let initialPage = 'look';
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      if (saved && panes[saved]) initialPage = saved;
    } catch (_) {}
    setControlDepth(controlDepth, false);
    selectPage(initialPage);
  }
  // 排在面板之後：面板會把參數檔（#presetIO）搬到它在頁面上的位置，右上角的 ⋯
  // 要記住的是那個位置，手機寬度時才搬得回去。
  buildTopBar();
  refresh();
  return { refresh, setQualityStatus };

  // 折射率的常見材料。設計師不必知道 1.33 是水：點一下就套用，數值剛好對上
  // 時那一顆會亮起來（拖滑桿、重設、匯入都會經過 refresh 重新對一次）。
  function buildIorPresets() {
    const MATERIALS = [['水', 1.33], ['玻璃', 1.5], ['水晶', 1.54], ['鑽石', 2.42]];
    const root = element('div', 'inspectorSegments inspectorIorPresets');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '常見材料的折射率');
    const buttons = MATERIALS.map(([name, value]) => {
      const chip = button(`${name} ${value.toFixed(2)}`, () => {
        writeControl('ior', value);
        refresh();
      });
      chip.dataset.ior = String(value);
      root.append(chip);
      return chip;
    });
    iorPresetSync = () => {
      const current = Number($('ior').value);
      for (const chip of buttons) {
        chip.setAttribute('aria-pressed', String(Math.abs(current - Number(chip.dataset.ior)) < 0.005));
      }
    };
    iorPresetSync();
    return root;
  }

  // 玻璃顏色的單色／漸層切換。真的控制項是 #absorbGradient 那個下拉（參數檔、
  // 重設、閘門都認它），這裡換成一排按鈕放在那一列的位置，兩個色票的標籤跟著
  // 方向改成「上方／下方」這類讀法，跟背景色的上下兩個色票一致。
  //
  // 加一種方向：GLASS_TINT_LABELS 加一組，其餘見 glass-tint.js 開頭。
  function buildGlassTint() {
    const GLASS_TINT_LABELS = {
      off: ['玻璃顏色', ''],
      vertical: ['上方顏色', '下方顏色'],
      horizontal: ['左側顏色', '右側顏色'],
      depth: ['前方顏色', '後方顏色'],
    };
    const source = rowOf('absorbGradient');
    source.hidden = true;
    const picker = segmented(
      [['off', '單色'], ['vertical', '上下'], ['horizontal', '左右'], ['depth', '前後']],
      value => { writeControl('absorbGradient', value); refresh(); },
      '玻璃顏色的漸層方向',
    );
    const row = element('div', 'row inspectorGlassTint');
    row.append(element('label', '', '玻璃顏色'), picker.group);
    glassTintSync = () => {
      const mode = $('absorbGradient').value;
      picker.select(mode);
      const [first, second] = GLASS_TINT_LABELS[mode] ?? GLASS_TINT_LABELS.off;
      rowOf('absorbColor').querySelector('label').textContent = mode === 'off' ? '顏色' : first;
      rowOf('absorbColorB').querySelector('label').textContent = second;
    };
    return row;
  }

  // 畫面右下角的常駐調整區。
  //
  // 裡面是「鏡像」滑桿，不是把面板裡那一列搬出來：參數檔的保存與自動保存、
  // 「已調整」標記、數值輸入、閘門都只掃 #panel；而 #panel 的 transform 與
  // backdrop-filter 又會讓它裡面 position: fixed 的東西改成相對面板定位，放不到
  // 畫面角落。所以真正的控制項原地留著（不放進任何一個看得到的區塊），這裡拖曳
  // 時走 writeControl 寫回去 —— 跟使用者拖面板那根完全同一條路；反過來重設、
  // 風格、匯入改了真值時，refresh 呼叫 sync 把這邊對齊。
  // shown(key)：額外的顯示條件（閘門之外）。燈光細調用它只留目前選中那盞燈的列。
  function buildQuickDock(title, entries, lead = null, id = 'studioQuickDock', parent = document.body,
                          leadEntries = [], shown = () => true) {
    const root = element('aside', 'studioQuickDock');
    root.id = id;
    root.setAttribute('aria-label', `${title}快速調整`);
    root.append(element('div', 'studioQuickDockTitle', title));
    // lead：放在滑桿前面的自訂控制項（燈光方向盤）。它本來就是直接讀寫參數
    // id 的，不靠 #panel，搬過來不需要鏡像。
    if (lead) root.append(lead);
    const sliders = element('div', 'studioQuickDockSliders');
    root.append(sliders);
    // leadEntries：塞在 lead 旁邊那一欄（方向盤的讀數底下）的鏡像，例如背景色。
    const leadSlot = lead?.querySelector('.lightDialInfo') ?? sliders;
    // 鏡像本身不是參數：不能被參數檔掃到，也不能帶 id 跟真值撞名，所以一律
    // data-preset-ignore、不給 id。
    const items = [...entries.map(entry => [...entry, sliders]),
      ...leadEntries.map(entry => [...entry, leadSlot])].map(([key, label, slot]) => {
      const source = $(key);
      if (source.type === 'color') {
        // 顏色：標籤在左、色票在右，一列就好（放在方向盤旁邊那一欄，空間很窄）。
        const row = element('label', 'studioQuickDockRow studioQuickDockColorRow');
        const name = element('span', 'studioQuickDockHead', label);
        const mirror = element('input', 'studioQuickDockColor');
        mirror.type = 'color';
        mirror.dataset.presetIgnore = '';
        mirror.setAttribute('aria-label', label);
        mirror.addEventListener('input', () => writeControl(key, mirror.value));
        row.append(name, mirror);
        slot.append(row);
        return { key, kind: 'color', row, mirror };
      }
      if (source.tagName === 'BUTTON') {
        // 按鈕（例如「選擇 SVG…」）：點鏡像就是點真的那顆，檔案選擇器與後續流程
        // 完全照舊。
        const row = element('div', 'studioQuickDockRow studioQuickDockButtonRow');
        const mirror = element('button', 'inspectorButton studioQuickDockButton');
        mirror.type = 'button';
        mirror.dataset.presetIgnore = '';
        mirror.addEventListener('click', () => source.click());
        row.append(mirror);
        slot.append(row);
        return { key, kind: 'button', row, mirror };
      }
      if (source.tagName === 'SELECT') {
        const row = element('label', 'studioQuickDockRow studioQuickDockSelectRow');
        const name = element('span', 'studioQuickDockHead', label);
        const mirror = element('select', 'studioQuickDockSelect');
        mirror.dataset.presetIgnore = '';
        mirror.addEventListener('change', () => { writeControl(key, mirror.value); refresh(); });
        row.append(name, mirror);
        slot.append(row);
        return { key, kind: 'select', row, mirror };
      }
      const row = element('label', 'studioQuickDockRow');
      const head = element('span', 'studioQuickDockHead');
      const name = element('span', '', label);
      const value = element('output', 'studioQuickDockValue');
      head.append(name, value);
      const input = element('input');
      input.type = 'range';
      input.min = source.min; input.max = source.max; input.step = source.step;
      input.dataset.presetIgnore = '';
      input.addEventListener('input', () => writeControl(key, input.value));
      row.append(head, input);
      slot.append(row);
      return { key, kind: 'range', row, input, value };
    });
    parent.append(root);
    // 真的那一列被 gate 收起來（例如方體的圓角在選圓環時）時，鏡像跟著收：造型卡
    // 的高度因此跟著形狀變，外層的欄位由下往上長，燈光卡不會跟著跳。
    const gatedOff = source => !!source.closest('.gated-off') || !!source.closest('.row')?.hidden;
    const sync = () => {
      for (const item of items) {
        const source = $(item.key);
        item.row.hidden = gatedOff(source) || !shown(item.key);
        if (item.kind === 'button') {
          item.mirror.textContent = source.textContent;
          item.mirror.disabled = source.disabled;
          continue;
        }
        if (item.kind === 'color') {
          if (document.activeElement !== item.mirror) item.mirror.value = source.value;
          continue;
        }
        if (item.kind === 'select') {
          const options = [...source.options].map(o => [o.value, o.text]);
          const current = [...item.mirror.options].map(o => [o.value, o.text]);
          if (JSON.stringify(options) !== JSON.stringify(current)) {
            item.mirror.replaceChildren(...options.map(([value, text]) => {
              const option = element('option', '', text);
              option.value = value;
              return option;
            }));
          }
          item.mirror.value = source.value;
          continue;
        }
        const { input, value } = item;
        if (document.activeElement !== input) input.value = source.value;
        const readout = $(`${item.key}_v`);
        value.textContent = readout && !readout.querySelector('input')
          ? readout.textContent : source.value;
        const min = Number(input.min || 0), max = Number(input.max || 1);
        const progress = max > min ? (Number(input.value) - min) / (max - min) * 100 : 0;
        input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
      }
    };
    sync();
    return { root, sync };
  }

  // 右上角那一組（桌面）：由右而左「面板、⋯、輸出、畫質、深淺底、播放」。
  //
  // - 畫質：抗鋸齒（#antialiasLevel，超取樣倍率），點開是四個等級的選單。面板裡
  //   不再有「畫質」區；光譜取樣不開給使用者。
  // - ⋯：參數檔（複製、貼上、下載、開啟）、操作提示、全部重設 —— 偶爾才用、跟畫面
  //   本身無關的操作。參數檔就是原本面板裡那個 #presetIO，整個搬進選單，行為不變。
  //   面板底部的「更多與管理」在桌面上藏起來；手機沒有這一組按鈕，留在抽屜裡。
  // - 靜態模組是一張靜止的展示照，沒有播放鍵（body[data-still-module]，見 CSS）。
  // - 位置照各按鈕的實際寬度排（layoutTopBar），不寫死 right：字型、語系、有沒有
  //   播放鍵都會改變寬度。共用的 switch2-theme.css 給的是另一種排法（其他頁面還在用），
  //   這裡只在液態玻璃頁面覆寫。
  function buildTopBar() {
    if (launchMotion === 'static') document.body.dataset.stillModule = '';
    const desktop = window.matchMedia('(min-width: 761px)');
    const menus = [];
    // 右上角的下拉選單：按鈕開關、Esc 或點到外面就關，一次只開一個。
    function topMenu(id, label, title, build) {
      const trigger = button(label, () => setOpen(panel.hidden));
      trigger.id = `${id}Btn`;
      trigger.classList.add('topBarButton');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-controls', `${id}Menu`);
      trigger.setAttribute('aria-expanded', 'false');
      const panel = element('div', 'topMenu');
      panel.id = `${id}Menu`;
      panel.setAttribute('role', 'menu');
      panel.hidden = true;
      panel.append(element('div', 'topMenuTitle', title));
      document.body.append(panel);
      const menu = { trigger, panel, setOpen, onOpen: null };
      function setOpen(open) {
        if (open) for (const other of menus) if (other !== menu) other.setOpen(false);
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        if (!open) return;
        const box = trigger.getBoundingClientRect();
        panel.style.top = `${Math.round(box.bottom + 8)}px`;
        panel.style.right = `${Math.round(window.innerWidth - box.right)}px`;
        menu.onOpen?.();
      }
      menus.push(menu);
      build(menu);
      return menu;
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') for (const menu of menus) menu.setOpen(false);
    });
    document.addEventListener('pointerdown', event => {
      for (const menu of menus) {
        if (menu.panel.hidden || menu.panel.contains(event.target) || menu.trigger.contains(event.target)) continue;
        menu.setOpen(false);
      }
    }, true);

    // 畫質（抗鋸齒）。
    const source = $('antialiasLevel');
    let qualityItems = [];
    const quality = topMenu('quality', '畫質', '畫質（邊緣平滑度）', menu => {
      qualityItems = [...source.options].map(option => {
        const item = button(option.textContent.replace(/（.*?）/, ''), () => {
          writeControl('antialiasLevel', option.value);
          menu.setOpen(false);
          refresh();
        });
        item.setAttribute('role', 'menuitemradio');
        item.dataset.value = option.value;
        menu.panel.append(item);
        return item;
      });
      menu.panel.append(element('p', 'topMenuNote', '越高邊緣越平滑，但越吃效能；畫面不順時往低調。'));
    });
    antialiasSync = () => {
      const current = source.value;
      for (const item of qualityItems) item.setAttribute('aria-checked', String(item.dataset.value === current));
      const label = qualityItems.find(item => item.dataset.value === current)?.textContent ?? '';
      quality.trigger.title = `畫質：${label}`;
      quality.trigger.setAttribute('aria-label', `畫質：${label}`);
    };
    antialiasSync();

    // ⋯：參數檔、操作提示、全部重設。
    const presetIO = $('presetIO');
    const presetHome = presetIO ? { parent: presetIO.parentNode, next: presetIO.nextSibling } : null;
    let presetSlot = null;
    const more = topMenu('more', '⋯', '參數與重設', menu => {
      menu.trigger.setAttribute('aria-label', '更多：參數檔、操作提示、重設');
      menu.trigger.title = '參數檔、操作提示、重設';
      presetSlot = element('div', 'topMenuPresets');
      const tipsToggle = button('操作提示', () => { tips.hidden = !tips.hidden; });
      tipsToggle.classList.add('topMenuItem');
      const tips = element('div', 'topMenuTips');
      tips.hidden = true;
      // 「全部重設」要按兩次：第一次只是把按鈕換成確認，幾秒內沒按就還原。
      const reset = button('全部重設', () => {
        if (!('armed' in reset.dataset)) {
          reset.dataset.armed = '';
          reset.textContent = '再按一次確認重設';
          clearTimeout(reset.timer);
          reset.timer = setTimeout(disarm, 5000);
          return;
        }
        disarm();
        menu.setOpen(false);
        $('resetBtn').click();
      });
      const disarm = () => { delete reset.dataset.armed; reset.textContent = '全部重設'; };
      reset.classList.add('topMenuItem', 'topMenuDanger');
      menu.panel.append(presetSlot, element('hr', 'topMenuRule'), tipsToggle, tips,
        element('hr', 'topMenuRule'), reset);
      // 操作提示照目前模式顯示：提示文字本身在面板裡，靠閘門分模式，打開時抄一份。
      menu.onOpen = () => {
        disarm();
        tips.hidden = true;
        tips.replaceChildren(...[...document.querySelectorAll('#panel .hint')]
          .filter(hint => !hint.closest('.gated-off') && hint.closest('.inspectorUtilities, [data-gate]'))
          .map(hint => {
            const copy = element('p', 'topMenuTip');
            copy.innerHTML = hint.innerHTML;
            return copy;
          }));
      };
    });
    // 桌面：參數檔搬進選單；手機：回到面板底部。跨過寬度的時候跟著搬。
    function placePresets() {
      if (!presetIO || !presetSlot) return;
      if (desktop.matches) presetSlot.append(presetIO);
      else presetHome.parent.insertBefore(presetIO, presetHome.next);
    }
    placePresets();

    // 深底／淺底：一顆開關（打開＝淺底）。真的控制項是 #backdrop 那個下拉，切換走
    // writeControl，兩個底色各自記憶的那些參數照原本的路換過去。面板頂端的「預覽
    // 底色」在桌面上藏起來，手機沒有這一組按鈕，留在抽屜裡。
    const backdropSource = $('backdrop');
    const backdropSwitch = button('', () => {
      writeControl('backdrop', backdropSource.value === 'light' ? 'dark' : 'light');
      refresh();
    });
    backdropSwitch.id = 'backdropBtn';
    backdropSwitch.classList.add('topBarButton', 'topBarSwitch');
    backdropSwitch.setAttribute('role', 'switch');
    backdropSwitch.title = '淺底（關掉是深底）';
    backdropSwitch.append(element('span', 'topBarSwitchLabel', '淺底'), element('span', 'topBarSwitchTrack'));
    rowOf('backdrop')?.classList.add('inspectorTopBarMirrored');
    backdropSync = () => {
      const light = backdropSource.value === 'light';
      backdropSwitch.setAttribute('aria-checked', String(light));
      backdropSwitch.setAttribute('aria-label', light ? '淺底（點一下換成深底）' : '深底（點一下換成淺底）');
    };
    backdropSync();

    $('exportBtn').before(quality.trigger);
    quality.trigger.before(backdropSwitch);
    $('exportBtn').after(more.trigger);

    const GAP = 8;
    // 由右而左排：面板的位置由共用主題決定，其餘一顆接一顆往左排。
    function layoutTopBar() {
      const order = ['moreBtn', 'exportBtn', 'qualityBtn', 'backdropBtn', 'playCtl'].map(id => $(id)).filter(Boolean);
      if (!desktop.matches) {
        for (const el of order) el.style.removeProperty('right');
        for (const menu of menus) menu.setOpen(false);
        return;
      }
      const toggle = $('toggleBtn').getBoundingClientRect();
      let right = window.innerWidth - toggle.left + GAP;
      for (const el of order) {
        if (getComputedStyle(el).display === 'none') continue;
        el.style.setProperty('right', `${Math.round(right)}px`, 'important');
        right += el.getBoundingClientRect().width + GAP;
      }
      alignSideStack?.();
    }
    layoutTopBar();
    window.addEventListener('resize', layoutTopBar);
    desktop.addEventListener?.('change', () => { placePresets(); layoutTopBar(); });
    document.fonts?.ready?.then(layoutTopBar);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(layoutTopBar);
      for (const id of ['toggleBtn', 'moreBtn', 'exportBtn', 'qualityBtn', 'backdropBtn', 'playCtl']) if ($(id)) observer.observe($(id));
    }
  }

  // 燈光的「細調」：方位盤選中那盞燈的大小與強度，加上全部燈共用的設定。浮在右側
  // 那一欄的左邊（絕對定位，不佔欄位的空間），所以打開它不會改變任何卡片的大小與
  // 位置；面板收起、輸出對話框開著時跟著那一欄一起收。標題列上的「細調」開關它，
  // Esc 或點到外面就關。
  function buildLightPopover(sideStack, getSelected) {
    const lightOf = key => STUDIO_LIGHTS.find(light => light.size === key || light.power === key);
    const shared = new Set(SHARED_LIGHT_ENTRIES.map(([key]) => key));
    const perLight = STUDIO_LIGHTS.flatMap(light => [
      [light.size, '大小'], ...(light.power ? [[light.power, '強度']] : []),
    ]);
    lightPopover = buildQuickDock('燈光細調', [...perLight, ...SHARED_LIGHT_ENTRIES],
      null, 'studioLightPopover', sideStack, [],
      key => shared.has(key) || lightOf(key)?.id === getSelected());
    const popover = lightPopover.root;
    popover.hidden = true;
    // 各列照傳進去的順序排，共用設定從第 perLight.length 列開始。
    popover.querySelectorAll('.studioQuickDockRow')[perLight.length]
      ?.before(element('div', 'studioQuickDockSubhead', '全部燈光'));
    lightPopover.title = popover.querySelector('.studioQuickDockTitle');
    lightPopover.getSelected = getSelected;

    const toggle = button('細調', () => setOpen(popover.hidden));
    toggle.className = 'studioQuickDockToggle';
    toggle.setAttribute('aria-controls', popover.id);
    toggle.setAttribute('aria-expanded', 'false');
    $('studioQuickDock').querySelector('.studioQuickDockTitle').append(toggle);
    function setOpen(open) {
      popover.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.classList.toggle('is-active', open);
      if (open) syncLightPopover();
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !popover.hidden) setOpen(false);
    });
    document.addEventListener('pointerdown', event => {
      if (popover.hidden || popover.contains(event.target)) return;
      // 在右下卡片上換燈、拖方位盤時不關（細調本來就是跟著它看的）；「細調」按鈕
      // 自己會切換。
      if ($('studioQuickDock').contains(event.target)) return;
      setOpen(false);
    }, true);
    syncLightPopover();
  }
  // 右側卡片跟左邊面板一樣可以收合：點標題（或在標題上按 Enter／空白鍵）切換，
  // 收起來只剩標題列。標題列裡的按鈕（背景與燈光的「細調」）自己處理點擊，不連帶
  // 收合。收起背景與燈光時，浮在旁邊的燈光細調一起關掉 —— 它是跟著那張卡看的。
  function makeDockCollapsible(root) {
    const title = root.querySelector('.studioQuickDockTitle');
    root.classList.add('is-collapsible');
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    title.setAttribute('aria-expanded', 'true');
    const toggle = () => {
      const collapsed = root.classList.toggle('is-collapsed');
      title.setAttribute('aria-expanded', String(!collapsed));
      if (collapsed && root.id === 'studioQuickDock') {
        const fine = root.querySelector('.studioQuickDockToggle[aria-expanded="true"]');
        fine?.click();
      }
    };
    title.addEventListener('click', event => {
      if (event.target.closest('button') !== null && event.target !== title) return;
      toggle();
    });
    title.addEventListener('keydown', event => {
      if (event.target !== title || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      toggle();
    });
  }
  function syncLightPopover() {
    if (!lightPopover) return;
    const light = STUDIO_LIGHTS.find(item => item.id === lightPopover.getSelected()) ?? STUDIO_LIGHTS[0];
    lightPopover.title.textContent = `${light.label} 細調`;
    lightPopover.sync();
  }

  // 右側那一欄（桌面）：造型卡在上、燈光卡在下，由下往上堆。左緣對齊「輸出」、
  // 右緣對齊「面板」—— 按鈕的寬度跟著字型與語系變，所以量實際位置，不寫死。
  function buildSideStack() {
    const stack = element('div', 'studioSideStack');
    stack.id = 'studioSideStack';
    document.body.append(stack);
    const align = () => {
      // 欄位從「輸出」的左緣到「面板」的右緣（中間是 ⋯）。畫質與播放鍵在它更左邊，
      // 不算進來：有沒有播放鍵（靜態沒有）、畫質的字寬都不該改變卡片的寬度。
      const first = $('exportBtn')?.getBoundingClientRect();
      const last = $('toggleBtn')?.getBoundingClientRect();
      if (!first?.width || !last?.width) return;
      stack.style.setProperty('--stack-left', `${Math.round(first.left)}px`);
      stack.style.setProperty('--stack-right', `${Math.round(window.innerWidth - last.right)}px`);
      stack.style.setProperty('--stack-top', `${Math.round(Math.max(first.bottom, last.bottom) + 12)}px`);
    };
    window.addEventListener('resize', align);
    // 右上角的按鈕重排只改位置、不改大小，ResizeObserver 看不到，由 layoutTopBar 通知。
    alignSideStack = align;
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(align);
      for (const id of ['qualityBtn', 'exportBtn', 'moreBtn', 'playCtl', 'toggleBtn']) if ($(id)) observer.observe($(id));
    }
    document.fonts?.ready?.then(align);
    requestAnimationFrame(align);
    return stack;
  }

  // 新玻璃模型（registry 的 studioGlass）的面板：一頁、由上而下照「東西 → 材質 →
  // 動態 → 水滴 → 地板 → 鏡頭 → 背景」排，只放看得到效果的參數。其餘控制項留在
  // 隱藏的分頁裡，參數檔與重設照常讀寫它們。
  //
  // 各模式自己的那一段（動態、水滴）不在這裡逐一列：舊的分頁版面已經用閘門把
  // 每個模式的區塊標好了（.modeBlock[data-gate=<模式>]、#shapeMotionGroup、水滴那一
  // 組……），這裡把它們整塊搬進來，閘門照樣收掉別的模式的部分。新增一個模式的
  // 參數只要在 registry 加 params，不必回來改這裡。
  function buildStudioLayout() {
    const isStatic = launchMotion === 'static';
    panel.dataset.layout = 'studio';
    // 靜態的面板拆成一張張卡片（桌面，見 inspector.css 的 [data-split]），跟右側那一欄
    // 同樣的卡片與間距。標題列接在第一張看得到的卡片上面，所以要標出是哪一張。
    if (isStatic) {
      panel.dataset.split = '';
      splitSync = () => {
        const sections = [...page.children].filter(node => node.classList.contains('inspectorSection'));
        const first = sections.find(node => getComputedStyle(node).display !== 'none');
        for (const node of sections) node.classList.toggle('is-firstCard', node === first);
      };
    }
    tabs.hidden = true;
    depthHeading.hidden = true;
    depthPicker.group.hidden = true;
    depthHelp.hidden = true;
    for (const pane of Object.values(panes)) pane.hidden = true;

    const page = element('section', 'inspectorPage');
    page.id = 'inspectorPage-studio';
    header.after(page);
    const relabel = (key, text) => {
      const label = rowOf(key)?.querySelector('label');
      if (label) label.textContent = text;
    };
    const group = (text, entries, open = true) => {
      const block = section(text, null, open);
      for (const [key, label] of entries) {
        const row = rowOf(key);
        if (!row) continue;
        if (label) relabel(key, label);
        block.append(row);
      }
      page.append(block);
      return block;
    };

    // 造型：靜態先選內建幾何或「匯入」，其餘形狀場模式一律是匯入的 SVG／GLB。
    const STATIC_SHAPE_ENTRIES = [
      ['staticShape', '形狀'],
      ['boxSize', '大小'], ['boxCornerRadius', '圓角'],
      ['primitiveSize', '大小'], ['primitiveHeight', '高度'], ['primitiveTubeRatio', '管徑'],
    ];
    const IMPORT_ENTRIES = [
      ['shapeSource', '檔案類型'], ['shapeQuality', '模型品質'], ['shapeBtn', null],
      ['shapeAScale', '大小'], ['shapeDepth', '厚度'], ['shapeEdgeBevel', '圓角'],
      // 靜態的玻璃要乾淨的表面，不給邊緣液化；其餘形狀場模式的形狀本來就是液體。
      ...(isStatic ? [] : [['shapeSoftness', '邊緣液化']]),
      // 形狀變形的形狀 B（變形後的那一顆）。這幾列的閘門是 morph，其餘模式自然收起。
      ['morphTargetBtn', null], ['morphTargetResetBtn', null],
      ['shapeBScale', '形狀 B 大小'], ['shapeSoftnessB', '形狀 B 邊緣液化'],
    ];
    const shapeBlock = group('造型', isStatic ? STATIC_SHAPE_ENTRIES : []);
    // 匯入的 SVG／GLB 借用形狀匯聚那組控制；原本的外層閘門（shape）搬出來後就不在了，
    // 所以自己包一層 shapeImport。
    const importBlock = element('div');
    importBlock.dataset.gate = 'shapeImport';
    for (const [key, label] of IMPORT_ENTRIES) {
      const row = rowOf(key);
      if (!row) continue;
      if (label) relabel(key, label);
      importBlock.append(row);
    }
    shapeBlock.append(importBlock);
    // 桌面上造型改到畫面右側的獨立卡片（見 buildSideStack），面板裡這一區藏起來；
    // 手機的空間已經被頂部燈光區和底部抽屜佔滿，造型留在抽屜裡。
    shapeBlock.classList.add('studioDesktopMirrored');

    // 「邊緣彩虹」（edgeDispersion）不開給使用者：跟「彩虹強度」看起來差不多，
    // 兩根放在一起只是讓人猜哪一根在做什麼。它仍留在隱藏的分頁裡，風格按鈕
    // 與參數檔照常讀寫。
    // 反射是 OpenPBR 的 specular_weight，範圍 0–1（shader 也夾在 1，見
    // studioGlassShade）。只有靜態頁會跑到這裡，其餘模式的滑桿範圍不動。
    $('reflect').max = '1';
    // 阿貝數不開給使用者：它跟彩虹強度在 shader 裡只以比值出現（見 environment.js
    // 的 bandIOR），兩根滑桿做的是同一件事，對設計師只是多一個要猜的名詞。固定在
    // 預設 22，參數本身保留，參數檔與舊檔照常讀寫（舊檔的值見 bubble.js 的
    // beforeApply，會併進彩虹強度）。
    //
    // 折射率可以到 2.5，鑽石（2.42）才放得進來。只有靜態頁會跑到這裡。
    $('ior').max = '2.5';
    // 常調的在上：顏色、濃度、霧面、彩虹、反射；折射率連同底下的材料按鈕放最後。
    // 材料按鈕跟著折射率那一列走（見下面的 after）。
    // 玻璃顏色：單色或漸層（見 buildGlassTint）。漸層那三列靠 glassGradientOn
    // 閘門收放，單色時面板跟以前一模一樣。
    group('玻璃', [
      ['absorbGradient', null],
      ['absorbColor', null],
      ['absorbColorB', null],
      ['absorbGradientMid', '漸層位置'],
      // 柔和度跟著漸層那幾列走（同一個 glassGradientOn 閘門），單色時收起來。
      ['absorbGradientSoftness', '漸層柔和度'],
      ['absorb', '顏色濃度'],
      ['roughness', '霧面'],
      ['dispersionScale', '彩虹強度'],
      ['reflect', '反射'],
      ['transmission', '透射率'],
      ['ior', '折射率'],
    ]);
    // 邊緣光（fresnel）不開給使用者：新模型的反射已經照 Fresnel 算，這一根在上面
    // 再加的量調了看不太出差別。參數本身保留，參數檔照常讀寫。
    rowOf('ior').after(buildIorPresets());
    rowOf('absorbGradient').after(buildGlassTint());
    // 燈光整組（方向盤、燈光強度、明暗對比）是最常一邊看畫面一邊調的，拉到
    // 畫面右下角常駐（見 buildQuickDock），面板裡不再有燈光區。
    // 方位盤要調哪一盞燈（STUDIO_LIGHTS 的 id）。不存進參數檔：它是介面狀態，不是畫面。
    // 手機的卡片沒有選燈按鈕（見 inspector.css），方位盤一律調主光。
    let selectedLight = 'key';
    const phoneDock = window.matchMedia('(max-width: 760px)');
    const currentLight = () => (phoneDock.matches ? 'key' : selectedLight);
    phoneDock.addEventListener?.('change', () => { staticDial.draw(); syncLightPopover(); });
    staticDial = buildLightDial({
      getSelected: currentLight,
      onSelect: id => {
        selectedLight = id;
        staticDial.draw();
        syncLightPopover();
      },
    });
    const sideStack = buildSideStack();
    // 卡片上不放「高度」：圓柱與圓錐已經不在選單裡了（見 registry 的 staticShape）。
    studioShapeCard = usesShapeField(launchMotion) ? buildQuickDock('造型', [
      ...(isStatic ? STATIC_SHAPE_ENTRIES.filter(([key]) => key !== 'primitiveHeight') : []),
      ...IMPORT_ENTRIES,
    ], null, 'studioShapeCard', sideStack) : null;
    // 地板（影子、透光光斑）獨立一張卡，排在造型與燈光中間。
    studioFloorCard = buildQuickDock('地板', [
      ['studioShadowStrength', '影子深度'],
      ['studioCaustic', '透光光斑'],
    ], null, 'studioFloorCard', sideStack);
    // 背景色也放進這張卡（方向盤讀數的下面）：它就一兩個色票，單獨在左邊佔一整區
    // 太浪費。深底是一個背景色，淺底是上下兩個漸層色，跟著底色切換（真的那幾列由
    // refresh 依底色收起，鏡像照著 hidden 走）。
    studioQuickDock = buildQuickDock('背景與燈光', [
      ['studioCardStrength', '燈光強度'],
      ['studioFlag', '明暗對比'],
    ], staticDial.root, 'studioQuickDock', sideStack, [
      ['bgColor', '背景'],
      ['lightBgGradientTop', '上方'],
      ['lightBgGradientBottom', '下方'],
    ]);
    buildLightPopover(sideStack, currentLight);
    for (const card of [studioShapeCard, studioFloorCard, studioQuickDock]) {
      if (card) makeDockCollapsible(card.root);
    }
    // 鏡像要跟著 gate 走，但 gate 不是在 change 事件當下套的：換形狀之後要等 shader
    // 變體換好、updateUIState 跑完才更新，那時沒有任何事件會再觸發 refresh。只靠
    // 事件同步的話，切回方體後「選擇 SVG…」會一直掛在卡片上，直到下一次操作。
    // 所以直接看面板裡 class／hidden 的變化，同一批變化只同步一次。
    //
    // 排在 microtask 而不是 requestAnimationFrame：切到「匯入」會在主執行緒上烘焙
    // SVG 的距離場，那段時間畫格會被往後推好幾秒 —— 排在下一格的同步就跟著晚好幾秒，
    // 切回方體之後「選擇 SVG…」還掛在卡片上。鏡像卡片在 #panel 外面，同步本身不會
    // 再觸發這個 observer。
    let mirrorSyncQueued = false;
    new MutationObserver(() => {
      if (mirrorSyncQueued) return;
      mirrorSyncQueued = true;
      queueMicrotask(() => {
        mirrorSyncQueued = false;
        studioShapeCard?.sync();
        studioFloorCard?.sync();
        studioQuickDock?.sync();
        syncLightPopover();
      });
    }).observe(panel, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (!isStatic) buildMotionSections();
    // 桌面上地板在右側的卡片裡（studioFloorCard），這一區只留給手機的抽屜。
    group('地板', [
      ['studioShadowStrength', '影子深度'],
      ['studioCaustic', '透光光斑'],
    ]).classList.add('studioDesktopMirrored');
    // 每一盞燈與黑卡的位置、大小、強度，以及全部燈共用的設定。常用的那三樣
    // （主光方向、燈光強度、明暗對比）在右下的「背景與燈光」卡片上。
    // 桌面上這些都在右下卡片：方位盤選燈調方向與高度，「細調」調大小、強度與共用
    // 設定。這一區只留給手機的抽屜（手機的卡片太小，沒有選燈與細調）。
    group('燈光', LIGHT_ENTRIES, false).classList.add('studioDesktopMirrored');
    // 會動的模式另有鏡頭的環繞與推軌；靜態是一張靜止的展示照，不給。
    const cameraBlock = group('鏡頭', [
      ['cameraFov', '視角'],
      ['cameraDistance', '距離'],
      ['cameraRotationY', '水平角度'],
      ['cameraRotationX', '垂直角度'],
      ...(isStatic ? [] : [['spin', '自動環繞'], ['dollyEnabled', '前後推軌']]),
    ]);
    cameraBlock.append(element('p', 'inspectorNote', '也可以直接在畫面上拖曳旋轉、滾輪縮放。'));
    // 桌面上背景色在右側「背景與燈光」卡片裡（見 buildQuickDock 的 leadEntries），
    // 這一區只留給手機的抽屜。
    const backgroundBlock = group('背景', [
      ['bgColor', '背景顏色'],
      ['lightBgGradientTop', '上方顏色'],
      ['lightBgGradientBottom', '下方顏色'],
    ]);
    backgroundBlock.classList.add('studioDesktopMirrored');

    // 光譜取樣不開給使用者，用預設值（畫質分級另外會壓低）。抗鋸齒是右上角的
    // 「AA」按鈕（見 buildAntialiasButton）。
    // 後期預設展開：只有光暈一組，收著的話要點兩下（展開、開光暈）才調得到。
    const postBlock = group('後期', []);
    postBlock.append($('bloomGroup'));
    postBlock.classList.add('studioPostCard');
    // 光暈只留開關、強度與範圍。門檻、門檻柔度、最大亮度照背景自動決定，光暈色固定
    // 白光（見 bubble.js 的 studioBloomSettings）；參數本身保留，參數檔照常讀寫。
    // 後期只剩光暈這一組，不必再收一層：展開跟著開關走，打開光暈兩根滑桿就出現。
    // （光暈關著時這一組是空的，pruneEmptySections 會把它收起來，之後不會自己再打開。）
    const syncBloomOpen = () => { $('bloomGroup').open = $('bloomEnabled').checked; };
    $('bloomEnabled').addEventListener('change', () => queueMicrotask(syncBloomOpen));
    syncBloomOpen();
    title($('bloomGroup'), '光暈');
    relabel('bloomIntensity', '光暈強度');
    relabel('bloomRadius', '光暈範圍');
    // 兩根都是 0–1，拉滿對應強度 0.07、範圍 0.6（換算在 bubble.js 的
    // bloomIntensityFor／bloomRadiusFor）。
    $('bloomIntensity').max = '1';
    $('bloomRadius').max = '1';
    for (const key of ['bloomThreshold', 'bloomKnee', 'bloomClamp', 'bloomTint']) {
      const row = rowOf(key);
      if (row) { row.hidden = true; row.classList.add('studioRetiredRow'); }
    }

    // 存檔、提示與整個模組的重設。
    $('resetBtn').textContent = '全部重設';
    // 存檔按鈕直接放在這一層，不要再包一層要另外展開的「儲存與載入」。
    share.before($('presetIO'));
    share.hidden = true;
    page.append(utilities);

    for (const node of page.querySelectorAll('details')) {
      const top = node.parentElement === page;
      node.classList.toggle('inspectorSection', top);
      node.classList.toggle('inspectorSubsection', !top);
    }

    // 「動態」與「水滴」：把舊版面裡標好閘門的區塊整塊搬進來（理由見上面的說明）。
    // 搬進來的區塊不分是哪個模式的，閘門會收掉不屬於這個模式的那些；整區都被
    // 收掉時 pruneEmptySections 會連標題一起藏起來。
    function buildMotionSections() {
      const gate = motionParamsGate(launchMotion);
      // 打字的字本身就是造型（沒有形狀場、沒有右側的造型卡），文字與字體獨立成一區，
      // 放在動態前面。
      const typography = group('文字', TYPOGRAPHY_KEYS.map(key => [key, null]));
      // 這幾列搬出了原本有 typewriter 閘門的區塊，閘門要跟著帶過來。
      // 閘門只看 data-gate；不加 modeBlock，免得下面挑「這個模式的區塊」時把它也搬走。
      typography.dataset.gate = 'typewriter';
      if ($('typeTextInfo')) rowOf('typeText')?.after($('typeTextInfo'));
      if ($('typeFontGroup')) typography.append($('typeFontGroup'));
      const motion = group('動態', [['loopDuration', '循環秒數']]);
      motion.append(...[
        $('typeLoopInfoRow'),
        ...panel.querySelectorAll(`.modeBlock[data-gate="${gate}"]`),
        $('shapeMotionGroup'),
      ].filter(Boolean));
      // 造型動態預設是關的（總開關在標題上），內容先收起來，開了再展開看。
      if ($('shapeMotionGroup') && !$('shapeMotionOn')?.checked) $('shapeMotionGroup').open = false;
      // 水滴那一組在舊版面是整組掛一個閘門（不是每一列），搬出來之後要照抄過來。
      const dropsGate = $('count')?.closest('details.group')?.dataset.gate;
      const drops = group('水滴', [
        ['count', '水滴數量'], ['radius', '水滴大小'], ['viscosity', '黏性融合'],
        ['surfaceTension', '表面張力'], ['inertiaDeform', '慣性形變'], ['spread', '漂浮範圍'],
        ['wobble', '表面起伏'], ['wobbleScale', '起伏尺度'], ['wobbleSpeed', '起伏動畫'],
        ['microCount', '輪廓細節滴'],
      ]);
      if (dropsGate) drops.dataset.gate = dropsGate;
      if ($('edgeDropGroup')) drops.append($('edgeDropGroup'));
      // 輪廓液滴那三列跟主水滴擠在同一區，舊名「水滴大小」會跟上面那根撞名。
      relabel('shapeLiquidPosition', '液滴分佈');
      relabel('shapeLiquidSize', '液滴大小');
      relabel('shapeLiquidSpeed', '液滴流速');
    }
  }
}

function buildPalette(prefix, applyValues) {
  const old = $(`${prefix}TintPalette`);
  const root = element('section', 'inspectorPalette');
  root.id = old.id;
  const name = prefix === 'researchShell' ? '外殼' : '圖示';
  root.append(element('p', 'inspectorNote', '拖曳色標調整分布，點選色標更換顏色。'));
  const rail = element('div', 'inspectorRamp');
  const preview = $(`${prefix}TintPreview`);
  preview.className = 'inspectorRampPreview';
  rail.append(preview);
  root.append(rail);
  let selected = 0;
  const markers = [], rows = [];
  const controls = element('div', 'inspectorStopControls');
  const positionLabel = element('label', '', '位置 %');
  const position = element('input', 'inspectorNumber');
  position.type = 'number'; position.min = '0'; position.max = '99'; position.step = '1';
  position.id = `${prefix}StopPositionEditor`;
  position.dataset.presetIgnore = '';
  positionLabel.htmlFor = position.id;
  const updatePosition = () => {
    const value = position.valueAsNumber;
    if (Number.isFinite(value)) writeControl(`${prefix}TintStopPos${selected}`, Math.max(0, Math.min(99, value)) / 100);
    refresh();
  };
  position.addEventListener('input', updatePosition);
  position.addEventListener('change', updatePosition);
  position.addEventListener('blur', () => {
    position.value = String(Math.round(Number($(`${prefix}TintStopPos${selected}`).value) * 100));
  });
  const positionRow = element('div', 'inspectorPosition');
  positionRow.append(positionLabel, position);
  for (let i = 0; i < EDGE_TINT_STOPS.length; i++) {
    const color = rowOf(`${prefix}TintStopColor${i}`);
    const pos = rowOf(`${prefix}TintStopPos${i}`);
    pos.hidden = true;
    controls.append(color, pos);
    rows.push(color);
    const marker = button(String(i + 1), () => { selected = i; refresh(); });
    marker.className = 'inspectorStop';
    marker.setAttribute('role', 'slider');
    marker.setAttribute('aria-label', `${name}色標 ${i + 1} 位置`);
    marker.setAttribute('aria-valuemin', '0'); marker.setAttribute('aria-valuemax', '99');
    let bounds = null;
    const move = event => {
      if (!bounds) return;
      const p = Math.round(Math.max(0, Math.min(0.99, (event.clientX - bounds.left) / bounds.width)) * 100) / 100;
      writeControl(`${prefix}TintStopPos${i}`, p);
      refresh();
    };
    marker.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      selected = i; bounds = rail.getBoundingClientRect();
      marker.setPointerCapture(event.pointerId); refresh();
    });
    marker.addEventListener('pointermove', move);
    marker.addEventListener('pointerup', () => { bounds = null; });
    marker.addEventListener('pointercancel', () => { bounds = null; });
    marker.addEventListener('lostpointercapture', () => { bounds = null; });
    marker.addEventListener('keydown', event => {
      const at = Number($(`${prefix}TintStopPos${i}`).value);
      const delta = event.shiftKey ? 0.1 : 0.01;
      const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? at - delta
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? at + delta
        : event.key === 'Home' ? 0 : event.key === 'End' ? 0.99 : null;
      if (next === null) return;
      event.preventDefault(); selected = i;
      writeControl(`${prefix}TintStopPos${i}`, Math.max(0, Math.min(0.99, next))); refresh();
    });
    rail.append(marker); markers.push(marker);
  }
  controls.append(positionRow);
  root.append(controls);
  const presets = element('div', 'inspectorPalettePresets');
  for (const [label, colors] of [
    ['藍青粉黃', EDGE_TINT_STOPS.map(s => s.color)],
    ['冰藍', ['#1257e8', '#22bde8', '#9fe8f2', '#e2f7ff', '#a2d7ee', '#638bde']],
    ['暖粉', ['#d66b99', '#edb2b1', '#ffe29a', '#fff1ce', '#e7bad7', '#b486d6']],
  ]) {
    presets.append(button(label, () => {
      const values = {};
      colors.forEach((color, i) => {
        values[`${prefix}TintStopColor${i}`] = color;
        values[`${prefix}TintStopPos${i}`] = EDGE_TINT_STOPS[i].position;
      });
      applyValues(values, `已套用${label}色盤。`);
    }));
  }
  root.append(presets);
  old.replaceWith(root);
  function refresh() {
    markers.forEach((marker, i) => {
      const p = Number($(`${prefix}TintStopPos${i}`).value);
      marker.style.left = `${p * 100}%`;
      marker.style.setProperty('--stop-color', $(`${prefix}TintStopColor${i}`).value);
      marker.dataset.selected = String(i === selected);
      marker.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      marker.setAttribute('aria-valuetext', `${Math.round(p * 100)}%，${$(`${prefix}TintStopColor${i}`).value}`);
      rows[i].hidden = i !== selected;
    });
    if (document.activeElement !== position) position.value = String(Math.round(Number($(`${prefix}TintStopPos${selected}`).value) * 100));
    position.setAttribute('aria-label', `${name}色標 ${selected + 1} 位置百分比`);
  }
  return { root, refresh };
}

// 棚燈的方位盤：從正上方俯瞰，鏡頭固定在下方，所以光點往上拖是逆光、往下是順光，
// 跟畫面上看到的方向一致（鏡頭轉了，盤面跟著轉）。半徑是高度：中心是正上方，
// 細的那一圈是地平線，地平線外面那一圈是地平線以下（補光、邊光、黑卡的預設都在
// 那裡），最外圈是 DIAL_MIN_ELEVATION。寫回的仍是那幾根滑桿，參數檔與重設不必
// 知道這個盤的存在。
//
// 盤面上畫出 STUDIO_LIGHTS 的每一盞：選中的那盞是亮點、可以拖，其餘是淡點；黑卡
// 畫成小方塊。上面那排按鈕切換要調哪一盞，方向鍵也跟著調選中的那盞。
const DIAL_MIN_ELEVATION = -45;
function buildLightDial({ getSelected, onSelect }) {
  // 盤面照實際顯示的尺寸畫：右下角的常駐區在桌面與手機給的大小不同（見
  // inspector.css 的 .studioQuickDock），寫死一個尺寸會被 CSS 拉伸而糊掉。
  const FALLBACK_SIZE = 132;
  const wrap = element('div', 'lightDialWrap');
  const picker = segmented(
    STUDIO_LIGHTS.map(light => [light.id, light.short]),
    id => onSelect(id),
    '要調整的燈',
  );
  picker.group.classList.add('lightDialPicker');
  const root = element('div', 'lightDial');
  const canvas = element('canvas', 'lightDialCanvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'slider');
  const info = element('div', 'lightDialInfo');
  const readout = element('strong', 'lightDialReadout');
  const note = element('p', 'inspectorNote', '拖曳光點改變方向；越靠近中心，光越從正上方打下來。方向鍵也可以微調。');
  info.append(readout, note);
  root.append(canvas, info);
  wrap.append(picker.group, root);
  const wrapDeg = deg => ((((deg + 180) % 360) + 360) % 360) - 180;
  const clampElevation = value => Math.max(DIAL_MIN_ELEVATION, Math.min(89, value));
  const snap = value => Math.round(value * 2) / 2;
  // 高度 ↔ 半徑（0 = 中心、1 = 最外圈）。
  const radiusOf = el => (90 - clampElevation(el)) / (90 - DIAL_MIN_ELEVATION);
  const elevationOf = r => 90 - Math.min(1, r) * (90 - DIAL_MIN_ELEVATION);
  const camera = () => Number($('cameraRotationY').value);
  const selected = () => STUDIO_LIGHTS.find(light => light.id === getSelected()) ?? STUDIO_LIGHTS[0];
  function setFromPointer(event) {
    const light = selected();
    const box = canvas.getBoundingClientRect();
    const dx = event.clientX - box.left - box.width / 2;
    const dy = event.clientY - box.top - box.height / 2;
    const r = Math.hypot(dx, dy) / (box.width / 2 - 10);
    const angle = Math.atan2(dx, dy) * 180 / Math.PI;
    writeControl(light.azimuth, snap(wrapDeg(angle + camera())));
    writeControl(light.elevation, snap(clampElevation(elevationOf(r))));
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    setFromPointer(event);
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', event => {
    if (canvas.hasPointerCapture(event.pointerId)) setFromPointer(event);
  });
  canvas.addEventListener('keydown', event => {
    const light = selected();
    const az = Number($(light.azimuth).value);
    const el = Number($(light.elevation).value);
    const step = event.shiftKey ? 15 : 5;
    // 高度跟拖曳同一個範圍（DIAL_MIN_ELEVATION 到 89）：盤面外圈就是下限，再往下
    // 光點會停在外圈不動、讀數卻一直掉。滑桿本身仍可以設到 -89。
    if (event.key === 'ArrowLeft') writeControl(light.azimuth, wrapDeg(az - step));
    else if (event.key === 'ArrowRight') writeControl(light.azimuth, wrapDeg(az + step));
    else if (event.key === 'ArrowUp') writeControl(light.elevation, clampElevation(el + step));
    else if (event.key === 'ArrowDown') writeControl(light.elevation, clampElevation(el - step));
    else return;
    event.preventDefault();
  });
  function draw() {
    const SIZE = Math.round(canvas.clientWidth) || FALLBACK_SIZE;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== SIZE * dpr) { canvas.width = SIZE * dpr; canvas.height = SIZE * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const c = SIZE / 2, R = c - 10;
    const circle = (x, y, radius) => { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); };
    circle(c, c, R + 6); ctx.fillStyle = '#141416'; ctx.fill();
    // 地平線以下那一圈壓暗一點，看得出光是從下面打上來的。
    const horizon = R * radiusOf(0);
    circle(c, c, R); ctx.fillStyle = '#0b0b0c'; ctx.fill();
    circle(c, c, horizon); ctx.fillStyle = '#141416'; ctx.fill();
    ctx.lineWidth = 1;
    for (const ring of [0, 30, 60]) {
      circle(c, c, R * radiusOf(ring));
      ctx.strokeStyle = ring === 0 ? '#ffffff2e' : '#ffffff14';
      ctx.stroke();
    }
    // 鏡頭在盤面下方。
    ctx.beginPath();
    ctx.moveTo(c, SIZE - 12); ctx.lineTo(c - 6, SIZE - 2); ctx.lineTo(c + 6, SIZE - 2); ctx.closePath();
    ctx.fillStyle = '#8e8e93'; ctx.fill();
    circle(c, c, 4); ctx.fillStyle = '#ffffff3a'; ctx.fill();
    const cam = camera();
    const active = selected();
    const place = light => {
      const a = (Number($(light.azimuth).value) - cam) * Math.PI / 180;
      const r = radiusOf(Number($(light.elevation).value));
      return [c + R * r * Math.sin(a), c + R * r * Math.cos(a)];
    };
    // 先畫沒選中的（淡），選中的最後畫在最上面。
    for (const light of STUDIO_LIGHTS) {
      if (light === active) continue;
      const [x, y] = place(light);
      if (light.flag) {
        ctx.fillStyle = '#5a5a60'; ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      } else {
        circle(x, y, 3.5); ctx.fillStyle = '#ffe3a366'; ctx.fill();
      }
    }
    const [x, y] = place(active);
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(x, y);
    ctx.strokeStyle = active.flag ? '#ffffff40' : '#ffd98a80'; ctx.stroke();
    if (active.flag) {
      ctx.fillStyle = '#d8d8de'; ctx.strokeStyle = '#000'; ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    } else {
      ctx.save();
      ctx.shadowColor = '#ffd98a'; ctx.shadowBlur = 12;
      circle(x, y, 7); ctx.fillStyle = '#ffe3a3'; ctx.fill();
      ctx.restore();
    }
    picker.select(active.id);
    const az = Math.round(Number($(active.azimuth).value));
    const el = Math.round(Number($(active.elevation).value));
    canvas.setAttribute('aria-label', `${active.label}方向與高度`);
    canvas.setAttribute('aria-valuetext', `${active.label}：方向 ${az}° · 高度 ${el}°`);
    canvas.title = `拖曳${active.label}改變方向；越靠近中心，光越從正上方打下來。方向鍵也可以微調。`;
    // 拆成兩段：窄的地方（右側卡片）各佔一行，寬的地方照樣排成一行（見 CSS）。
    const direction = element('span', 'lightDialReadoutPart', `方向 ${az}°`);
    const elevation = element('span', 'lightDialReadoutPart', `高度 ${el}°`);
    readout.replaceChildren(direction, element('span', 'lightDialReadoutSep', ' · '), elevation);
  }
  return { root: wrap, draw };
}

function installNumberEditing(panel) {
  panel.querySelectorAll('input[type="range"][id]').forEach(slider => {
    const readout = $(`${slider.id}_v`);
    if (!readout || slider.id.includes('TintStopPos')) return;
    const label = slider.closest('.row')?.querySelector('label')?.textContent || slider.id;
    readout.tabIndex = 0;
    readout.setAttribute('role', 'button');
    readout.setAttribute('aria-label', `輸入${label}數值`);
    readout.title = '點擊輸入數值';
    function edit() {
      if (slider.disabled || readout.querySelector('input')) return;
      const input = element('input', 'inspectorValueInput');
      const currentLabel = slider.closest('.row')?.querySelector('label')?.textContent || label;
      const scale = readout.textContent.endsWith('%') ? 100
        : ['researchIconBirthStagger', 'researchIconPhaseOffset', 'gatherDuration', 'shapeHold'].includes(slider.id)
          ? Number($('loopDuration').value) : 1;
      input.type = 'number'; input.min = String(Number(slider.min) * scale); input.max = String(Number(slider.max) * scale); input.step = String(Number(slider.step) * scale);
      input.value = String(Number((Number(slider.value) * scale).toFixed(4))); input.dataset.presetIgnore = '';
      input.setAttribute('aria-label', currentLabel);
      const savedText = readout.textContent;
      readout.textContent = ''; readout.append(input);
      input.focus(); input.select();
      let finished = false;
      function finish(cancel) {
        if (finished) return; finished = true;
        const value = input.valueAsNumber;
        readout.textContent = savedText;
        if (!cancel && Number.isFinite(value)) writeControl(slider.id, Math.max(Number(slider.min), Math.min(Number(slider.max), value / scale)));
      }
      input.addEventListener('blur', () => finish(false));
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Escape'); readout.focus(); }
      });
    }
    readout.addEventListener('click', edit);
    readout.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); }
    });
  });
}
