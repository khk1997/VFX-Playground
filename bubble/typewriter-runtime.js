'use strict';

import { fract } from './motions/util.js?v=svg-shape-76';
import createTypewriterMotion from './motions/typewriter.js?v=typewriter-1';
import {
  bakeGlyphAtlas, makeBlankGlyphAtlas, parsePhrases, MAX_TYPE_GLYPHS,
  setCustomFont, useSystemFont, clearCustomFont, CUSTOM_FONT_FAMILY_NAME,
} from './glyph-field.js?v=typewriter-3';

export function createTypewriterRuntime({ THREE, params: P, getUniforms, requestRender, formatters }) {
  const glyphData = new Float32Array(MAX_TYPE_GLYPHS * 4);
  const glyphDataTexture = new THREE.DataTexture(
    glyphData, MAX_TYPE_GLYPHS, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  glyphDataTexture.minFilter = glyphDataTexture.magFilter = THREE.NearestFilter;
  glyphDataTexture.wrapS = glyphDataTexture.wrapT = THREE.ClampToEdgeWrapping;
  glyphDataTexture.generateMipmaps = false;
  glyphDataTexture.needsUpdate = true;

  let glyphAtlas = null;
  let glyphAtlasText = null;
  let glyphRebuildTimer = null;
  let phrases = [];
  let glyphBakeMs = 0;
  let customFontFace = null;
  let customFontRequestId = 0;
  let localFontsByFamily = null;
  let lastBroadcastLoopDuration = null;

  const {
    typeState,
    cycleSeconds,
  } = createTypewriterMotion(P, { phrases: () => phrases });

  function refreshReadouts() {
    syncLoopDuration();
    const show = (key, value) => {
      const el = document.getElementById(key + '_v');
      if (el) el.textContent = value;
    };
    show('typeCharTime', P.typeCharTime > 0 ? Math.round(P.typeCharTime) + ' ms/字' : '瞬間');
    show('typeHold', P.typeHold.toFixed(2) + ' s');
    show('typeEraseTime', P.typeEraseTime > 0 ? Math.round(P.typeEraseTime) + ' ms/字' : '瞬間');
    show('typeGap', P.typeGap.toFixed(2) + ' s');
    show('typeDepth', formatters.typeDepth(P.typeDepth));
    show('typeBevel', formatters.typeBevel(P.typeBevel));
    show('typeSoftness', formatters.typeSoftness(P.typeSoftness));
    const info = document.getElementById('typeTextInfo');
    if (!info) return;
    if (!glyphAtlas) {
      info.textContent = '沒有文字';
      return;
    }
    const longest = phrases.reduce((m, x) => Math.max(m, x.length), 0);
    const over = longest > MAX_TYPE_GLYPHS
      ? `，最長一句 ${longest} 字超過上限 ${MAX_TYPE_GLYPHS}` : '';
    const font = glyphAtlas.cjk ? `${glyphAtlas.font.note} + 系統中文字` : glyphAtlas.font.note;
    info.textContent = `${phrases.length} 句／${glyphAtlas.count} 個字形`
      + `／${glyphAtlas.tile}² 烘焙 ${glyphBakeMs}ms（${font}）${over}`;
  }

  function scheduleGlyphRebuild() {
    clearTimeout(glyphRebuildTimer);
    glyphRebuildTimer = setTimeout(() => {
      glyphRebuildTimer = null;
      ensureGlyphAtlas(true);
      requestRender();
    }, 220);
  }

  function ensureGlyphAtlas(force = false) {
    if (P.motion !== 'typewriter') return;
    const text = String(P.typeText ?? '');
    if (!force && glyphAtlasText === text && glyphAtlas) {
      refreshReadouts();
      return;
    }
    phrases = parsePhrases(text);
    const t0 = performance.now();
    const next = phrases.length ? bakeGlyphAtlas(phrases) : null;
    glyphBakeMs = Math.round(performance.now() - t0);
    if (glyphAtlas && glyphAtlas.texture !== next?.texture) glyphAtlas.texture.dispose();
    glyphAtlas = next;
    glyphAtlasText = text;
    if (glyphAtlas && !glyphAtlas.font.ok) console.warn('[打字] 字體驗證：' + glyphAtlas.font.note);
    if (glyphAtlas && glyphAtlas.truncated) {
      console.warn(`[打字] 不同字元數超過圖集上限，已忽略 ${glyphAtlas.truncated} 個`);
    }
    uploadGlyphAtlas();
    refreshReadouts();
  }

  function uploadGlyphAtlas() {
    const uniforms = getUniforms();
    if (!uniforms || !glyphAtlas) return;
    uniforms.uTypeAtlas.value = glyphAtlas.texture;
    uniforms.uTypeAtlasInfo.value.set(
      glyphAtlas.cols, glyphAtlas.rows, glyphAtlas.tile, glyphAtlas.range,
    );
  }

  function updateUniforms(phase) {
    const uniforms = getUniforms();
    if (!uniforms) return 0;
    const state = glyphAtlas ? typeState(phase) : null;
    if (!state || !glyphAtlas) {
      uniforms.uTypeLine.value.set(0.6, P.typeSize, 0.22, 0);
      uniforms.uTypeCaret.value.set(0, 0, 0, 0);
      return 0;
    }
    const visible = Math.min(state.chars, MAX_TYPE_GLYPHS);
    const anchor = Math.min(state.phrase.length, MAX_TYPE_GLYPHS);
    for (let i = 0; i < visible; i++) {
      const idx = glyphAtlas.indexOf.get(state.phrase[i]);
      const o = i * 4;
      if (idx === undefined) { glyphData[o + 1] = 0; continue; }
      glyphData[o] = idx;
      glyphData[o + 1] = i === state.chars - 1 ? state.charFrac : 1;
      glyphData[o + 2] = 0;
      glyphData[o + 3] = 0;
    }
    for (let i = visible; i < MAX_TYPE_GLYPHS; i++) glyphData[i * 4 + 1] = 0;
    glyphDataTexture.needsUpdate = true;

    const advance = glyphAtlas.advance * Math.max(0.1, P.typeTracking);
    const size = Math.max(0.01, P.typeSize);
    uniforms.uTypeLine.value.set(advance, size, glyphAtlas.baseline, anchor);
    uniforms.uTypeShape.value.set(P.typeDepth, P.typeBevel, P.typeGrow, glyphAtlas.feature);
    const caretWidth = Math.max(0, P.typeCaretWidth) * size * 0.5;
    if (caretWidth > 0.001) {
      const advWorld = advance * size;
      const x0 = -(anchor - 1) * 0.5 * advWorld;
      const caretX = visible > 0 ? x0 + visible * advWorld : 0;
      const blinks = Math.max(1, Math.round(P.loopDuration / 0.53));
      const on = fract(phase * blinks) < 0.5 ? 1 : 0;
      uniforms.uTypeCaret.value.set(caretX, size * 0.18, caretWidth, on);
    } else {
      uniforms.uTypeCaret.value.set(0, 0, 0, 0);
    }
    return (anchor * advance * size) * 0.5 + size * 0.9;
  }

  function syncLoopDuration() {
    if (P.motion !== 'typewriter') return;
    const total = Math.max(0.5, cycleSeconds());
    P.loopDuration = total;
    const uniforms = getUniforms();
    if (uniforms?.uLoopDuration) uniforms.uLoopDuration.value = total;
    const info = document.getElementById('typeLoopInfo');
    if (info) info.textContent = total.toFixed(2) + ' s';
  }

  function broadcastLoopDuration() {
    const seconds = P.loopDuration;
    if (!(seconds > 0) || seconds === lastBroadcastLoopDuration) return;
    lastBroadcastLoopDuration = seconds;
    window.dispatchEvent(new CustomEvent('prism-loop-duration', { detail: { seconds } }));
  }

  function setFontState(text) {
    const el = document.getElementById('typeFontState');
    if (el) el.textContent = text;
  }

  function setSystemFontState(text) {
    const el = document.getElementById('typeSystemFontState');
    if (el) el.textContent = text;
  }

  async function loadCustomFont(file) {
    const requestId = ++customFontRequestId;
    setFontState(`正在載入「${file.name}」…`);
    try {
      const buffer = await file.arrayBuffer();
      const face = new FontFace(CUSTOM_FONT_FAMILY_NAME, buffer);
      await face.load();
      if (requestId !== customFontRequestId) { document.fonts.delete(face); return; }
      if (customFontFace) document.fonts.delete(customFontFace);
      document.fonts.add(face);
      customFontFace = face;
      setCustomFont(file.name);
      ensureGlyphAtlas(true);
      requestRender();
      setFontState(`已套用：${file.name}`);
    } catch (err) {
      if (requestId !== customFontRequestId) return;
      setFontState(`載入失敗：${err.message || '檔案格式不支援'}`);
    }
  }

  function applySystemFont(name, weight, label) {
    const trimmed = name.trim();
    if (!trimmed) return;
    customFontRequestId++;
    if (customFontFace) { document.fonts.delete(customFontFace); customFontFace = null; }
    useSystemFont(trimmed, weight);
    ensureGlyphAtlas(true);
    requestRender();
    setSystemFontState(`已套用系統字體：${label || trimmed}`);
  }

  async function browseLocalFonts() {
    if (typeof window.queryLocalFonts !== 'function') {
      setSystemFontState('此瀏覽器不支援系統字體清單（僅 Chrome／Edge 有 Local Font Access API），請直接在下面手動輸入完整名稱。');
      return;
    }
    setSystemFontState('正在讀取系統字體清單…（可能會跳出瀏覽器授權詢問）');
    try {
      const list = await window.queryLocalFonts();
      const map = new Map();
      for (const font of list) {
        if (!map.has(font.family)) map.set(font.family, []);
        map.get(font.family).push(font);
      }
      localFontsByFamily = map;
      const datalist = document.getElementById('typeLocalFontDatalist');
      if (datalist) {
        datalist.innerHTML = '';
        const families = [...map.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        for (const family of families) {
          const option = document.createElement('option');
          option.value = family;
          datalist.appendChild(option);
        }
      }
      setSystemFontState(
        `已讀到 ${map.size} 個字體家族——下面打字會自動篩出符合的名稱。若系統裡確實有的字體沒出現在建議清單，`
        + `通常是瀏覽器基於系統保護排除了那顆字體（常見於作業系統內建的介面字型），`
        + `或它其實是網頁字型服務（例如 Adobe Fonts）還沒同步成系統字體，這兩種情況都可以直接手動打完整名稱送出試試。`,
      );
    } catch (err) {
      setSystemFontState(`無法讀取系統字體清單：${err.message || '使用者拒絕權限或環境不支援'}`);
    }
  }

  function applyTypedSystemFont() {
    const input = document.getElementById('typeSystemFontInput');
    const weight = document.getElementById('typeSystemFontWeight');
    if (!input) return;
    const trimmed = input.value.trim();
    if (!trimmed) return;
    const value = Number(weight?.value) || 700;
    applySystemFont(trimmed, value, `${trimmed}（${weight?.selectedOptions[0]?.textContent || value}）`);
  }

  function resetCustomFont() {
    customFontRequestId++;
    if (customFontFace) { document.fonts.delete(customFontFace); customFontFace = null; }
    clearCustomFont();
    ensureGlyphAtlas(true);
    requestRender();
    setFontState('已還原成內建字體 Menlo');
  }

  return {
    glyphDataTexture,
    makeBlankGlyphAtlas,
    scheduleGlyphRebuild,
    ensureGlyphAtlas,
    uploadGlyphAtlas,
    updateTypewriterUniforms: updateUniforms,
    refreshTypewriterReadouts: refreshReadouts,
    broadcastLoopDuration,
    loadCustomFont,
    resetCustomFont,
    browseLocalFonts,
    applyTypedSystemFont,
  };
}
