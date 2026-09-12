import { EDGE_TINT_TARGETS, EDGE_TINT_STOPS, edgeTintParams } from './edge-tint.js';

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

// Move the original controls, preserving IDs, handlers, gates and preset state.
export function buildInspector({ defaults }) {
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
  panel.prepend(header);
  header.append(sub, heading, rowOf('motion'), rowOf('backdrop'));
  rowOf('motion').querySelector('label').textContent = '動態模式';
  rowOf('backdrop').querySelector('label').textContent = '預覽底色';

  let controlDepth = 'concise';
  try {
    const saved = localStorage.getItem(DEPTH_KEY);
    if (saved === 'concise' || saved === 'complete') controlDepth = saved;
  } catch (_) {}
  const depthWrap = element('div', 'inspectorDepth');
  const depthHeading = element('span', 'inspectorDepthLabel', '控制深度');
  const depthHelp = element('span', 'inspectorDepthHelp', '常用保留主要調整；完整顯示所有參數');
  const depthPicker = segmented([['concise', '常用'], ['complete', '完整']], value => {
    setControlDepth(value);
  }, '控制深度');
  depthPicker.group.classList.add('inspectorDepthPicker');
  depthWrap.append(depthHeading, depthPicker.group, depthHelp);
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
  }

  const tabs = element('div', 'inspectorTabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '參數分類');
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
  for (const [key, text] of [['shape', '造型'], ['motion', '動態'], ['look', '外觀'], ['scene', '場景']]) {
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
  panes.scene.append(tips);
  const reset = panel.querySelector(':scope > .btns');
  $('resetBtn').textContent = '重設目前模式';
  panes.scene.append(reset);

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
  title(icons, 'Icons 造型與排列');
  title(companion, '外殼融合');
  title(texture, '表面紋理');
  title(bubbles, '內部氣泡');
  panes.shape.prepend(shell, icons, bubbles);
  panes.motion.append(companion);
  panes.look.append(texture);
  const timing = section('呼吸與 Icons 時序', 'research');
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
  for (const key of ['typeText', 'typeSize', 'typeTracking', 'typeDepth', 'typeBevel', 'typeSoftness', 'typeCaretWidth', 'typeCaretDepth']) {
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
    'flowSpeed', 'shapeMotionOn', 'shapeSpinY', 'shapeBreathe', 'shapeBob',
    'shapeSource', 'shapeQuality', 'shapeAScale', 'shapeInput', 'gatherDuration',
    'shapeHold', 'microCount', 'shapeDepth', 'shapeEdgeBevel', 'shapeLiquid',
    'shapeLiquidPosition', 'shapeLiquidSize', 'shapeLiquidSpeed',
    'count', 'radius', 'viscosity', 'spread', 'wobble',
    'materialStyle', 'reflect', 'transmission', 'absorb', 'absorbColor',
    'materialExposure', 'roughness', 'fresnel', 'ior',
    'cameraDistance', 'cameraRotationY', 'cameraRotationX', 'spin', 'dollyEnabled',
    'bgMode', 'bgColor', 'lightBgGradientTop', 'lightBgGradientBottom', 'lightShow',
    'lightClarity', 'lightDepth', 'lightChroma', 'hdriYaw', 'hdriPitch', 'hdriBlur',
    'researchShellTint', 'researchShellTintColor', 'researchShellTintEdge',
    'researchBreath', 'researchCompanionSize', 'researchCompanionExposure',
    'researchCompanionDepth', 'researchCompanionHold', 'researchCompanionPath',
    'researchShellTexture', 'researchShellAmount', 'researchShellSpeed',
    'researchShellDensity', 'researchBubbles', 'researchBubbleCount',
    'researchIconTint', 'researchIconTintColor', 'researchIconTintEdge',
    'researchIconPhaseOffset', 'researchIconBirthStagger', 'researchIconSizeA',
    'researchIconSizeB', 'researchIconAspect', 'researchIconSpread',
    'researchIconStagger', 'researchIconDepth',
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
  const objectPicker = segmented([['researchShell', '外殼'], ['researchIcon', 'Icons']], value => {
    target = value; refresh();
  }, '配色對象');
  colorBody.append(objectPicker.group);
  const status = element('output', 'inspectorStatus');
  status.setAttribute('aria-live', 'polite');
  let undo = null;
  let colorContext = `${$('motion').value}|${$('backdrop').value}`;
  const colorDefault = key => $('backdrop').value === 'dark'
    && EDGE_TINT_TARGETS.some(prefix => key === `${prefix}Tint`) ? 0 : defaults[key];
  function applyValues(values, message) {
    undo = Object.fromEntries(Object.keys(values).map(key => [key, readControl(key)]));
    for (const [key, value] of Object.entries(values)) writeControl(key, value);
    status.textContent = message;
    refresh();
  }
  for (const prefix of EDGE_TINT_TARGETS) {
    const card = element('div', 'inspectorColorCard');
    card.dataset.tintTarget = prefix;
    const name = prefix === 'researchShell' ? '外殼' : 'Icons';
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
    const advanced = section('進階配色', null, false);
    advanced.className = 'subgroup inspectorAdvanced';
    const baseSlot = element('div');
    const mix = rowOf(`${prefix}MultiTintStrength`);
    mix.querySelector('label').textContent = '多色比例';
    advanced.append(baseSlot, mix, rowOf(`${prefix}MultiTintFocus`),
      element('p', 'inspectorNote', '基底色保留中央與過渡色。多色比例越高，邊界越偏向漸層；折射聚色強化光線轉折處的色彩。'));
    const singleSlot = element('div');
    const actions = element('div', 'inspectorActions');
    const copy = button(other === 'researchShell' ? '從外殼複製' : '從 Icons 複製', () => {
      applyValues(Object.fromEntries(keys.map(key => [key, readControl(key.replace(prefix, other))])), `已複製到${name}，之後仍可獨立調整。`);
    });
    const resetColor = button('重設這組配色', () => {
      applyValues(Object.fromEntries(keys.map(key => [key, colorDefault(key)])), `已重設${name}配色。`);
    });
    actions.append(copy, resetColor);
    card.append(picker.group, modeRow, singleSlot, palette.root, strength, edge, edgeHint, rotation, advanced, actions);
    if (prefix === 'researchIcon') {
      const optics = section('Icons 折射', null, false);
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

  // Labels also serve keyboard/screen-reader users, including older HTML rows.
  panel.querySelectorAll('.row').forEach(row => {
    const label = row.querySelector('label');
    const input = row.querySelector('input[id], select[id], textarea[id]');
    if (label && input) label.htmlFor = input.id;
  });
  installNumberEditing(panel);
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
        const current = readControl(key), baseline = colorDefault(key);
        const changed = typeof baseline === 'number' ? Number(current) !== baseline : current !== baseline;
        el.closest('.row')?.classList.toggle('is-modified', changed);
      }
      for (const suffix of ['Tint', 'TintEdge', 'MultiTintStrength']) {
        const readout = $(`${prefix}${suffix}_v`);
        if (!readout.querySelector('input')) readout.textContent = `${Math.round(Number($(`${prefix}${suffix}`).value) * 100)}%`;
      }
      $(`${prefix}MultiTintRotation_v`).textContent = `${$(`${prefix}MultiTintRotation`).value}°`;
    }
  }
  let initialPage = 'look';
  try {
    const saved = localStorage.getItem(PAGE_KEY);
    if (saved && panes[saved]) initialPage = saved;
  } catch (_) {}
  setControlDepth(controlDepth, false);
  selectPage(initialPage);
  refresh();
  return { refresh };
}

function buildPalette(prefix, applyValues) {
  const old = $(`${prefix}TintPalette`);
  const root = element('section', 'inspectorPalette');
  root.id = old.id;
  const name = prefix === 'researchShell' ? '外殼' : 'Icons';
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
