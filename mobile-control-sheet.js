/*
 * Shared mobile control sheet for effect pages.
 * Desktop keeps each effect's original drawer behavior.
 */
(() => {
  'use strict';

  const mobileQuery = window.matchMedia('(max-width: 760px)');
  const states = ['peek', 'half', 'full'];
  let panel;
  let home;
  let toggle;
  let mobileNav;
  let homeParent;
  let homeNextSibling;
  let toggleParent;
  let toggleNextSibling;
  let handle;
  let handleAction;
  let play;
  let playParent;
  let playNextSibling;
  let state = 'half';
  let activePointerId = null;
  let dragStartY = 0;
  let dragDeltaY = 0;
  let dragStartOffset = 0;
  let dragOffset = 0;
  let dragVelocity = 0;
  let lastDragY = 0;
  let lastDragTime = 0;
  let dragFrame = 0;
  let didDrag = false;
  let suppressHandleClick = false;
  let sheetHeight = 0;
  let sheetHalf = 0;
  let sheetPeek = 64;
  const selectSyncers = [];

  function isPreview() {
    return document.documentElement.classList.contains('preview-mode') ||
      new URLSearchParams(location.search).has('preview');
  }

  function syncViewportMetrics() {
    if (!panel || !mobileQuery.matches) return;
    const root = document.documentElement;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const safeAreaProbe = document.createElement('div');
    safeAreaProbe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
    document.body.append(safeAreaProbe);
    const safeAreaBottom = parseFloat(getComputedStyle(safeAreaProbe).paddingBottom) || 0;
    safeAreaProbe.remove();
    sheetHeight = Math.min(height * 0.78, 720);
    sheetHalf = height * 0.46;
    sheetPeek = 64 + safeAreaBottom;
    panel.style.setProperty('--mobile-viewport-width', `${width}px`);
    panel.style.setProperty('--mobile-viewport-height', `${height}px`);
    panel.style.setProperty('--mobile-sheet-height', `${sheetHeight}px`);
    panel.style.setProperty('--mobile-sheet-half', `${sheetHalf}px`);
    panel.style.setProperty('--mobile-sheet-peek', `${sheetPeek}px`);
  }

  function applyState(next) {
    if (!panel || !states.includes(next)) return;
    state = next;
    states.forEach(name => panel.classList.toggle(`mobile-sheet--${name}`, name === state));
    document.body.dataset.mobileSheet = state;

    const expanded = state !== 'peek';
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', 'panel');
    }
    if (handle) {
      handle.setAttribute('aria-expanded', String(expanded));
      handle.setAttribute('aria-label', state === 'peek' ? '展開參數面板' : state === 'full' ? '縮小參數面板' : '展開完整參數面板');
    }
    if (handleAction) handleAction.textContent = state === 'peek' ? '展開' : state === 'half' ? '完整' : '收合';
  }

  function cycleSheet() {
    applyState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek');
  }

  function restoreNode(node, parent, nextSibling) {
    if (!node || !parent) return;
    if (nextSibling?.parentNode === parent) parent.insertBefore(node, nextSibling);
    else parent.append(node);
  }

  function syncMobileNavPlacement() {
    if (!mobileNav || !home || !toggle) return;
    if (mobileQuery.matches) {
      mobileNav.append(home, toggle);
    } else {
      restoreNode(home, homeParent, homeNextSibling);
      restoreNode(toggle, toggleParent, toggleNextSibling);
    }
  }

  function syncPlayPlacement() {
    if (!play || !handle || !playParent) return;
    if (mobileQuery.matches) {
      handle.append(play);
    } else if (playNextSibling?.parentNode === playParent) {
      playParent.insertBefore(play, playNextSibling);
    } else {
      playParent.append(play);
    }
  }

  function syncPlayState() {
    if (!play) return;
    const action = play.textContent.includes('播放') ? 'play' : 'pause';
    const label = action === 'play' ? '播放動畫' : '暫停動畫';
    play.dataset.action = action;
    play.setAttribute('aria-label', label);
    play.title = label;
  }

  function stateOffset(name) {
    if (name === 'full') return 0;
    if (name === 'half') return Math.max(0, sheetHeight - sheetHalf);
    return Math.max(0, sheetHeight - sheetPeek);
  }

  function renderDrag() {
    dragFrame = 0;
    panel.style.setProperty('transform', `translate3d(0, ${dragOffset}px, 0)`, 'important');
  }

  function nearestState(offset) {
    return states.reduce((nearest, name) => (
      Math.abs(stateOffset(name) - offset) < Math.abs(stateOffset(nearest) - offset) ? name : nearest
    ), states[0]);
  }

  function settleDrag(event, cancelled = false) {
    if (event && event.pointerId !== activePointerId) return;
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      renderDrag();
    }

    if (event && event.timeStamp - lastDragTime > 80) dragVelocity = 0;
    let next = nearestState(dragOffset);
    const travelled = Math.abs(dragDeltaY);
    if (!cancelled && travelled > 12 && Math.abs(dragVelocity) > 0.25) {
      const verticalStates = ['full', 'half', 'peek'];
      const currentIndex = verticalStates.indexOf(state);
      const direction = dragVelocity > 0 ? 1 : -1;
      next = verticalStates[Math.max(0, Math.min(verticalStates.length - 1, currentIndex + direction))];
    }

    applyState(next);
    panel.getBoundingClientRect();
    panel.classList.remove('mobile-sheet--dragging');
    panel.style.removeProperty('transform');
    if (didDrag && !cancelled) suppressHandleClick = true;
    activePointerId = null;
    dragDeltaY = 0;
    dragVelocity = 0;
    didDrag = false;
  }

  function enhanceSelect(select) {
    if (select.closest('.mobile-select-shell')) return;

    const shell = document.createElement('div');
    shell.className = 'mobile-select-shell';
    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    select.classList.add('mobile-select-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'mobile-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'mobile-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    const optionButtons = Array.from(select.options, option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-select-option';
      button.textContent = option.textContent;
      button.dataset.value = option.value;
      button.setAttribute('role', 'option');
      button.addEventListener('click', event => {
        event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        trigger.focus({ preventScroll: true });
      });
      menu.appendChild(button);
      return button;
    });
    shell.append(trigger, menu);

    const sync = () => {
      const selected = select.options[select.selectedIndex];
      trigger.textContent = selected?.textContent || '';
      optionButtons.forEach(button => {
        const active = button.dataset.value === select.value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
    };
    const close = () => {
      menu.hidden = true;
      shell.classList.remove('open', 'opens-up');
      trigger.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      document.querySelectorAll('.mobile-select-shell.open').forEach(openShell => {
        if (openShell !== shell) {
          openShell.classList.remove('open', 'opens-up');
          const openMenu = openShell.querySelector('.mobile-select-menu');
          const openTrigger = openShell.querySelector('.mobile-select-trigger');
          if (openMenu) openMenu.hidden = true;
          if (openTrigger) openTrigger.setAttribute('aria-expanded', 'false');
        }
      });
      sync();
      menu.hidden = false;
      shell.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const panelRect = panel.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const visibleBottom = Math.min(panelRect.bottom, document.documentElement.clientHeight);
      const spaceBelow = visibleBottom - triggerRect.bottom;
      const spaceAbove = triggerRect.top - Math.max(panelRect.top, 0);
      const opensUp = spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow;
      const availableSpace = Math.max(96, (opensUp ? spaceAbove : spaceBelow) - 8);
      menu.style.maxHeight = `${availableSpace}px`;
      shell.classList.toggle('opens-up', opensUp);
    };

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      menu.hidden ? open() : close();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowDown' && menu.hidden) {
        event.preventDefault();
        open();
      }
    });
    select.addEventListener('change', sync);
    selectSyncers.push(sync);
    sync();
  }

  function init() {
    if (isPreview()) return;
    panel = document.getElementById('panel');
    home = document.getElementById('homeBtn') || document.querySelector('.home');
    toggle = document.getElementById('toggleBtn') || document.getElementById('toggle');
    if (!panel || !home || !toggle) return;

    homeParent = home.parentNode;
    homeNextSibling = home.nextSibling;
    toggleParent = toggle.parentNode;
    toggleNextSibling = toggle.nextSibling;
    mobileNav = document.createElement('nav');
    mobileNav.className = 'vfx-mobile-nav';
    mobileNav.setAttribute('aria-label', '特效頁面導覽');
    document.body.append(mobileNav);
    syncMobileNavPlacement();

    handle = document.createElement('div');
    handle.className = 'mobile-sheet-handle';
    handle.setAttribute('role', 'button');
    handle.tabIndex = 0;
    handle.innerHTML = '<span class="mobile-sheet-grabber" aria-hidden="true"></span><span class="mobile-sheet-label">參數控制</span><span class="mobile-sheet-action" aria-hidden="true">展開</span>';
    panel.prepend(handle);
    handleAction = handle.querySelector('.mobile-sheet-action');
    panel.querySelectorAll('select').forEach(enhanceSelect);

    play = document.getElementById('playCtl');
    if (play) {
      playParent = play.parentNode;
      playNextSibling = play.nextSibling;
      syncPlayState();
      new MutationObserver(syncPlayState).observe(play, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      syncPlayPlacement();
    }
    const reset = document.getElementById('resetBtn');
    const usesCompactMobileLayout = document.body.dataset.mobileUi === 'compact';
    if (reset && !usesCompactMobileLayout) {
      const mobileReset = document.createElement('button');
      mobileReset.type = 'button';
      mobileReset.className = 'mobile-sheet-reset';
      mobileReset.textContent = '↺';
      mobileReset.setAttribute('aria-label', '重設所有參數');
      mobileReset.title = '重設所有參數';
      mobileReset.addEventListener('click', event => {
        event.stopPropagation();
        reset.click();
      });
      handle.append(mobileReset);
    }

    handle.addEventListener('click', event => {
      if (event.target.closest('#playCtl, .mobile-sheet-reset')) return;
      if (suppressHandleClick) {
        suppressHandleClick = false;
        event.preventDefault();
        return;
      }
      cycleSheet();
    });

    handle.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        applyState(state === 'peek' ? 'half' : 'full');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        applyState(state === 'full' ? 'half' : 'peek');
      }
    });

    handle.addEventListener('pointerdown', event => {
      if (!mobileQuery.matches || activePointerId !== null ||
          (event.pointerType === 'mouse' && event.button !== 0) ||
          event.target.closest('#playCtl, .mobile-sheet-reset')) return;
      activePointerId = event.pointerId;
      dragStartY = event.clientY;
      dragDeltaY = 0;
      dragStartOffset = stateOffset(state);
      dragOffset = dragStartOffset;
      dragVelocity = 0;
      lastDragY = event.clientY;
      lastDragTime = event.timeStamp;
      didDrag = false;
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('mobile-sheet--dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (event.pointerId !== activePointerId) return;
      dragDeltaY = event.clientY - dragStartY;
      const elapsed = event.timeStamp - lastDragTime;
      if (elapsed > 0) dragVelocity = (event.clientY - lastDragY) / elapsed;
      lastDragY = event.clientY;
      lastDragTime = event.timeStamp;
      didDrag ||= Math.abs(dragDeltaY) > 5;

      const minOffset = 0;
      const maxOffset = stateOffset('peek');
      const rawOffset = dragStartOffset + dragDeltaY;
      if (rawOffset < minOffset) dragOffset = minOffset + (rawOffset - minOffset) * 0.22;
      else if (rawOffset > maxOffset) dragOffset = maxOffset + (rawOffset - maxOffset) * 0.22;
      else dragOffset = rawOffset;
      if (!dragFrame) dragFrame = requestAnimationFrame(renderDrag);
    });
    handle.addEventListener('pointerup', event => settleDrag(event));
    handle.addEventListener('pointercancel', event => settleDrag(event, true));

    document.addEventListener('click', event => {
      if (!event.target.closest('.mobile-select-shell')) {
        document.querySelectorAll('.mobile-select-shell.open').forEach(shell => {
          shell.classList.remove('open', 'opens-up');
          const menu = shell.querySelector('.mobile-select-menu');
          const trigger = shell.querySelector('.mobile-select-trigger');
          if (menu) menu.hidden = true;
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      }
      if (event.target.closest('#resetBtn')) {
        requestAnimationFrame(() => selectSyncers.forEach(sync => sync()));
      }
      if (!mobileQuery.matches) return;
      if (event.target.closest('#toggleBtn, #toggle')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applyState(state === 'peek' ? 'half' : 'peek');
        return;
      }
      if (state !== 'peek' && event.target.closest('#stage')) applyState('peek');
    }, true);

    mobileQuery.addEventListener('change', event => {
      syncMobileNavPlacement();
      syncPlayPlacement();
      if (event.matches) {
        panel.classList.remove('collapsed', 'hidden');
        syncViewportMetrics();
        applyState('half');
      } else {
        states.forEach(name => panel.classList.remove(`mobile-sheet--${name}`));
        panel.style.removeProperty('transform');
        delete document.body.dataset.mobileSheet;
      }
    });

    if (mobileQuery.matches) {
      panel.classList.remove('collapsed', 'hidden');
      syncViewportMetrics();
      applyState('half');
    }
    window.addEventListener('resize', syncViewportMetrics);
    window.visualViewport?.addEventListener('resize', syncViewportMetrics);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
