export function initQuickSlots({ root, status, preset, storage = localStorage }) {
  if (!root || !preset) return null;
  const storageKey = 'vfx:prism-drops:quick-slots';
  let savedSlots = [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
    savedSlots = Array.isArray(parsed) ? parsed : [];
  } catch (_) {}

  const buttons = [...root.querySelectorAll('[data-slot]')];
  const quickLabel = root.querySelector('.quickSlotsLabel');
  if (quickLabel) {
    quickLabel.textContent = 'A/B 比較';
    quickLabel.title = '空白鍵儲存目前參數；已有內容時點擊切換比較';
  }
  const slotName = index => index === 0 ? 'A' : index === 1 ? 'B' : String(index + 1);
  const announce = message => {
    if (!status) return;
    status.textContent = message;
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => { status.textContent = ''; }, 1800);
  };
  const persist = () => {
    try { storage.setItem(storageKey, JSON.stringify(savedSlots)); }
    catch (_) { announce('瀏覽器無法保存暫存'); }
  };
  const sync = () => buttons.forEach((button, index) => {
    const name = slotName(index);
    const saved = Boolean(savedSlots[index]);
    button.textContent = name;
    button.classList.toggle('is-saved', saved);
    button.setAttribute('aria-label', saved ? `載入比較 ${name}` : `儲存目前參數到比較 ${name}`);
    button.title = saved ? `載入比較 ${name}（右鍵清除）` : `儲存目前參數到比較 ${name}`;
  });

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const name = slotName(index);
      if (savedSlots[index]) {
        try {
          preset.apply(savedSlots[index]);
          announce(`已載入比較 ${name}`);
        } catch (_) {
          savedSlots[index] = null;
          persist();
          sync();
          announce('暫存資料已失效');
        }
      } else {
        savedSlots[index] = preset.serialize(`快速比較 ${name}`);
        persist();
        sync();
        announce(`已儲存比較 ${name}`);
      }
    });
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!savedSlots[index]) return;
      const name = slotName(index);
      savedSlots[index] = null;
      persist();
      sync();
      announce(`已清除比較 ${name}`);
    });
  });
  sync();
  return { sync };
}
