import { EDGE_TINT_TARGETS, EDGE_TINT_STOPS, edgeTintParams } from './edge-tint.js';
import { EDGE_TINT_BASE_BY_BACKDROP, EDGE_TINT_STRENGTH_BY_BACKDROP } from './runtime-defaults.js?v=tint-light-1';
import { INSTALLING_VISUAL_PRESETS, installingVisualPresetValues } from './visual-presets.js?v=tint-light-1';

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
function differsFromDefault(control, baseline) {
  const current = control.type === 'checkbox' ? control.checked : control.value;
  if (typeof baseline !== 'number') return current !== baseline;
  const step = Number.parseFloat(control.step);
  const tolerance = Number.isFinite(step) && step > 0 ? step / 2 : 1e-9;
  return Math.abs(Number(current) - baseline) > tolerance;
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
export function buildInspector({ defaults, modeDefault = () => undefined }) {
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
  rowOf('motion').querySelector('label').textContent = '動態模式';
  // 動態模式收進「完整」深度。首頁的每張卡片就是一個模式（見 effect-registry），
  // 從那裡進來的人要看的就是那一個，頭上不需要一個會把頁面變成另一個效果的下拉。
  // 要互相比較時切到完整就有，而且深度選擇是記住的，所以只要切一次。
  // 這一列在頭部，不會被下面那個 .row 分類迴圈掃到，得自己標。
  rowOf('motion').classList.add('inspectorExpert');
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
    'shapeMotionOn', 'shapeSpinY', 'shapeBreathe', 'shapeBob',
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
      if (child.matches('input, select, textarea, button')) return true;
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
  }
  let initialPage = 'look';
  try {
    const saved = localStorage.getItem(PAGE_KEY);
    if (saved && panes[saved]) initialPage = saved;
  } catch (_) {}
  built = true;
  setControlDepth(controlDepth, false);
  selectPage(initialPage);
  refresh();
  return { refresh, setQualityStatus };
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
