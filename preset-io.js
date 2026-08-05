/*
 * preset-io.js — 通用參數組合匯出/匯入模組
 *
 * 設計前提:各 effect 的控制面板共用同一套 DOM 慣例 —— 一個 #panel 容器,
 * 底下每個參數都是帶 id 的 <input> / <select>,而渲染端一律以
 * getElementById(id).value 讀值。因此本模組不需要認識任何參數的名字或意義,
 * 只負責「掃描 → 記錄 id/value」與「寫回 value → 派發事件」。
 * 新增滑桿會自動被涵蓋,不必回來改這支檔案。
 *
 * 匯出時只記錄與 HTML 預設值不同的項目(預設值即 value= 屬性),因此
 * 檔案短、一眼看得出對方動了什麼,日後新增參數也不會讓舊檔案失效。
 * 相對地,匯入時會把「檔案沒提到的控件」一併還原成預設值,
 * 確保套用後兩人畫面完全一致,而不是疊加在各自原本的調整上。
 *
 *   PresetIO.init({ effect: 'prism-drops', label: 'PRISM DROPS', ... });
 */
(() => {
  'use strict';

  // 每個 effect 一個實例，方便從 console 直接呼叫 PresetIO.of('prism-drops')
  const registry = new Map();

  const SAVE_DEBOUNCE = 400;
  const STATUS_TIMEOUT = 4000;

  function isControl(el) {
    if (!el.id) return false;
    if (el.dataset.presetIgnore !== undefined) return false;
    const type = (el.type || '').toLowerCase();
    return !['file', 'hidden', 'button', 'submit', 'reset', 'image'].includes(type);
  }

  function readValue(el) {
    return el.type === 'checkbox' ? el.checked : el.value;
  }

  // HTML 上的 value= 屬性。僅作為初始化後才出現的控件的退路 ——
  // 真正的預設值來自 init 時對 DOM 拍下的基準快照,因為各 effect 常在 JS 裡
  // 另外維護一份 DEFAULTS,與 HTML 屬性並不一致。
  function htmlDefault(el) {
    if (el.type === 'checkbox') return el.defaultChecked;
    if (el.tagName === 'SELECT') {
      const marked = Array.from(el.options).find(o => o.defaultSelected);
      return (marked || el.options[0])?.value ?? '';
    }
    return el.defaultValue;
  }

  function sameValue(el, a, b) {
    if (el.type === 'checkbox') return Boolean(a) === Boolean(b);
    // 滑桿的 value 是字串,但 "0.50" 與 "0.5" 應視為相同
    if (el.type === 'range' || el.type === 'number') return Number(a) === Number(b);
    return String(a) === String(b);
  }

  function writeValue(el, value) {
    if (el.type === 'checkbox') {
      el.checked = (value === true || value === 'true');
    } else {
      el.value = String(value);
    }
    // 各 effect 的綁定分別掛在 input 或 change 上(滑桿/顏色用 input、
    // 下拉/開關用 change),兩個都派發最省事,而所有 update handler 都是
    // idempotent 的,重複觸發沒有副作用。
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function timestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function init(config) {
    const {
      effect,
      panel: panelSelector = '#panel',
      mount: mountSelector = null,
      version = 1,
      // 有依賴關係、必須先套用的「模式類」控件。例如動態模式切換會連帶
      // 覆寫水滴數量,若順序顛倒,後套的模式會把數量蓋回去。
      applyFirst = [],
      exclude = [],
      // 匯出時無法序列化的外部素材(HDRI / SVG / GLB / 音檔),
      // 套用後提醒使用者自行載入。
      assetNote = '',
      afterApply = null,
      autosave = true,
      storageKey = `vfx:${effect}:last`,
      // 這些按鈕會以程式方式改變參數而不派發事件(例如「重設」),
      // 點擊後補存一次,否則自動保存會留著舊狀態。
      saveOn = [],
    } = config;

    const panel = document.querySelector(panelSelector);
    if (!panel) return null;

    const excluded = new Set(exclude);
    const listeners = [];
    let applying = false;
    let saveTimer = null;

    const controls = () =>
      Array.from(panel.querySelectorAll('input[id], select[id], textarea[id]'))
        .filter(el => isControl(el) && !excluded.has(el.id));

    // 基準值 = init 當下的 DOM 狀態。呼叫端必須在完成自己的初始化綁定之後、
    // 套用任何已保存狀態之前呼叫 init,此刻面板顯示的正是該 effect 的真實預設值。
    const baseline = new Map(controls().map(el => [el.id, readValue(el)]));
    const baseOf = el => (baseline.has(el.id) ? baseline.get(el.id) : htmlDefault(el));

    /* ===== 序列化 ===== */

    function values() {
      const out = {};
      for (const el of controls()) {
        if (!sameValue(el, readValue(el), baseOf(el))) out[el.id] = readValue(el);
      }
      return out;
    }

    function serialize(note = '') {
      const payload = {
        effect,
        version,
        savedAt: new Date().toISOString(),
        values: values(),
      };
      if (note) payload.note = note;
      return payload;
    }

    /* ===== 套用 ===== */

    function apply(payload) {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!data || typeof data !== 'object' || !data.values) {
        throw new Error('檔案格式不正確,找不到 values 欄位');
      }
      if (data.effect && data.effect !== effect) {
        throw new Error(`這份參數屬於「${data.effect}」,不能套用到「${effect}」`);
      }

      const incoming = data.values;
      const byId = new Map(controls().map(el => [el.id, el]));
      const order = [
        ...applyFirst.filter(id => byId.has(id)),
        ...[...byId.keys()].filter(id => !applyFirst.includes(id)),
      ];

      applying = true;
      let changed = 0;
      try {
        for (const id of order) {
          const el = byId.get(id);
          // 檔案沒提到的控件一律還原成預設值,套用結果才是絕對的而非疊加的
          const target = Object.prototype.hasOwnProperty.call(incoming, id)
            ? incoming[id]
            : baseOf(el);
          const before = readValue(el);
          writeValue(el, target);
          if (!sameValue(el, before, readValue(el))) changed++;
        }
      } finally {
        applying = false;
      }

      if (typeof afterApply === 'function') afterApply();
      save();

      const unknown = Object.keys(incoming).filter(id => !byId.has(id));
      return { changed, applied: Object.keys(incoming).length, unknown };
    }

    /* ===== 自動保存 ===== */

    function save() {
      // 「重設」這類按鈕會直接改 DOM 而不派發事件，UI 收不到通知，
      // 因此統一在保存時機一併刷新。
      listeners.forEach(fn => fn());
      if (!autosave) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(serialize()));
      } catch (_) { /* 無痕模式或容量已滿,靜默略過 */ }
    }

    function restore() {
      if (!autosave) return false;
      let raw;
      try { raw = localStorage.getItem(storageKey); } catch (_) { return false; }
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        if (!data.values || !Object.keys(data.values).length) return false;
        apply(data);
        return true;
      } catch (_) {
        try { localStorage.removeItem(storageKey); } catch (_) {}
        return false;
      }
    }

    if (autosave) {
      const queueSave = () => {
        if (applying) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, SAVE_DEBOUNCE);
      };
      panel.addEventListener('input', queueSave);
      panel.addEventListener('change', queueSave);
      for (const selector of saveOn) {
        const btn = document.querySelector(selector);
        // 這類按鈕直接改 DOM 而不派發事件,等它跑完再存
        if (btn) btn.addEventListener('click', () => setTimeout(save, 0));
      }
    }

    /* ===== UI ===== */

    const api = {
      effect, serialize, apply, values, save, restore,
      onChange: fn => { listeners.push(fn); },
    };
    registry.set(effect, api);

    const mount = mountSelector ? document.querySelector(mountSelector) : null;
    if (mount) buildUI(mount, api, { panel, assetNote });

    return api;
  }

  function buildUI(mount, api, { panel, assetNote }) {
    mount.classList.add('presetIO');
    mount.innerHTML = `
      <div class="effectTitle"><span>SYNC</span> 匯出與匯入</div>
      <div class="note">把目前參數複製成一段 JSON 給同事,對方貼上即完整套用,不必手動對照。只記錄與預設值不同的項目。</div>
      <div class="presetIOGrid">
        <button type="button" data-act="copy"><i aria-hidden="true">⧉</i>複製參數</button>
        <button type="button" data-act="paste"><i aria-hidden="true">⤓</i>貼上參數</button>
        <button type="button" data-act="download"><i aria-hidden="true">↓</i>下載 JSON</button>
        <button type="button" data-act="upload"><i aria-hidden="true">↑</i>開啟 JSON</button>
      </div>
      <div class="presetIODrawer" hidden>
        <textarea spellcheck="false" data-preset-ignore placeholder="在此貼上參數 JSON…"></textarea>
        <div class="presetIODrawerBtns">
          <button type="button" data-act="applyText">套用</button>
          <button type="button" data-act="cancelText" class="ghost">取消</button>
        </div>
      </div>
      <output class="presetIOStatus" aria-live="polite"></output>
      <input type="file" accept="application/json,.json" hidden data-preset-ignore>
    `;

    const grid = mount.querySelector('.presetIOGrid');
    const drawer = mount.querySelector('.presetIODrawer');
    const textarea = mount.querySelector('textarea');
    const statusEl = mount.querySelector('.presetIOStatus');
    const fileInput = mount.querySelector('input[type=file]');
    let statusTimer = null;

    function status(message, tone = 'ok') {
      statusEl.textContent = message;
      statusEl.dataset.tone = tone;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        statusEl.textContent = '';
        delete statusEl.dataset.tone;
      }, STATUS_TIMEOUT);
    }

    function reportApply(result) {
      const parts = [`已套用 ${result.applied} 項參數`];
      if (result.unknown.length) parts.push(`忽略 ${result.unknown.length} 項未知參數`);
      status(parts.join(',') + (assetNote ? `。${assetNote}` : '。'));
    }

    function openDrawer() {
      drawer.hidden = false;
      grid.querySelector('[data-act=paste]').setAttribute('aria-expanded', 'true');
      textarea.focus();
    }

    function closeDrawer() {
      drawer.hidden = true;
      textarea.value = '';
      grid.querySelector('[data-act=paste]').setAttribute('aria-expanded', 'false');
    }

    function applyText(text) {
      try {
        const result = api.apply(text.trim());
        closeDrawer();
        reportApply(result);
      } catch (error) {
        status(error.message || '套用失敗', 'error');
      }
    }

    const actions = {
      async copy() {
        const text = JSON.stringify(api.serialize(), null, 2);
        const count = Object.keys(api.values()).length;
        try {
          await navigator.clipboard.writeText(text);
          status(`已複製 ${count} 項調整過的參數`);
        } catch (_) {
          // 剪貼簿寫入被拒(非 https、或未取得權限)時退回手動複製
          openDrawer();
          textarea.value = text;
          textarea.select();
          status('無法自動複製,請按 ⌘C 手動複製', 'warn');
        }
      },
      async paste() {
        if (!drawer.hidden) return closeDrawer();
        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) throw new Error('剪貼簿是空的');
          applyText(text);
        } catch (_) {
          // Safari / Firefox 不支援 readText,或使用者拒絕權限
          openDrawer();
          status('請將參數 JSON 貼進下方欄位', 'warn');
        }
      },
      download() {
        const payload = api.serialize();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${api.effect}-${timestamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        status(`已下載 ${Object.keys(payload.values).length} 項參數`);
      },
      upload() {
        fileInput.click();
      },
      applyText() {
        applyText(textarea.value);
      },
      cancelText() {
        closeDrawer();
      },
    };

    mount.addEventListener('click', event => {
      const act = event.target.closest('button')?.dataset.act;
      if (act && actions[act]) actions[act]();
    });

    textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) actions.applyText();
      if (event.key === 'Escape') closeDrawer();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => applyText(String(reader.result));
      reader.onerror = () => status('讀取檔案失敗', 'error');
      reader.readAsText(file);
      fileInput.value = '';
    });

    // 標題列右側顯示目前有幾項參數偏離預設值
    const counter = document.createElement('em');
    counter.className = 'presetIOCount';
    mount.querySelector('.effectTitle').appendChild(counter);
    const syncCounter = () => {
      const n = Object.keys(api.values()).length;
      counter.textContent = n ? `${n} 項已調整` : '全部為預設值';
    };
    panel.addEventListener('input', syncCounter);
    panel.addEventListener('change', syncCounter);
    api.onChange(syncCounter);
    syncCounter();
  }

  window.PresetIO = { init, of: effect => registry.get(effect) };
})();
