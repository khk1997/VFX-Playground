(() => {
  'use strict';

  // 首頁的預覽 iframe 只是個展示用的 renderer，沒有匯出流程可走（匯出按鈕與
  // 對話框都被 CSS 隱藏，也不可能被點到）。這支檔案原本仍會在每個預覽 iframe
  // 裡跑完整初始化——查完所有對話框元素、掛上一整組 listener 與 matchMedia，
  // 全是白付的。整支直接退出。
  if (new URLSearchParams(location.search).has('preview')) return;

  const dialog = document.getElementById('exportDialog');
  const trigger = document.getElementById('exportBtn');
  if (!dialog || !trigger) return;

  const width = document.getElementById('exportWidth');
  const height = document.getElementById('exportHeight');
  const aspect = document.getElementById('exportAspect');
  const summary = document.getElementById('exportSummary');
  const sequenceSection = document.getElementById('exportSequenceSection');
  const frameCount = document.getElementById('exportFrameCount');
  const fps = document.getElementById('exportFps');
  const fpsCustom = document.getElementById('exportFpsCustom');
  const fpsCustomField = document.getElementById('exportFpsCustomField');
  const duration = document.getElementById('exportDuration');
  // 面板上的「循環秒數」。輸出秒數預設就是它 —— 一個完整循環，接縫剛好接得起來。
  // 使用者自己動過秒數之後就不再跟隨，改以填的值為準（要客製長度的情形）。
  const loopDuration = document.getElementById('loopDuration');
  let durationCustomized = false;
  const start = document.getElementById('exportStart');
  const progress = document.getElementById('exportProgress');
  const progressBar = document.getElementById('exportProgressBar');
  const progressText = document.getElementById('exportProgressText');
  const previewCanvas = document.getElementById('exportPreviewCanvas');
  const previewSize = document.getElementById('exportPreviewSize');
  const stageSize = document.getElementById('exportStageSize');
  const desktopQuery = window.matchMedia('(min-width: 761px)');
  const parameterPanel = document.getElementById('panel');
  let restoreParameterPanel = false;
  let engineReady = false;
  let exporting = false;

  function greatestCommonDivisor(a, b) {
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function syncDimensions() {
    const w = Math.max(64, Number(width.value) || 64);
    const h = Math.max(64, Number(height.value) || 64);
    const divisor = greatestCommonDivisor(w, h);
    aspect.value = `${w / divisor}:${h / divisor}`;
    summary.textContent = `${w} × ${h}`;
    previewSize.textContent = `${w} × ${h}`;
    stageSize.textContent = `${w} × ${h}`;
    previewCanvas.style.aspectRatio = `${w} / ${h}`;
    document.querySelectorAll('.exportPresetGrid button').forEach(button => {
      button.classList.toggle('active', button.dataset.size === `${w}x${h}`);
    });
  }

  // 幀率選單選到「自訂…」時才讀數字框；其餘照選項本身的值。
  function effectiveFps() {
    if (fps.value !== 'custom') return Number(fps.value);
    return Math.max(1, Math.min(240, Math.round(Number(fpsCustom.value) || 1)));
  }

  function followLoopDuration() {
    if (durationCustomized || !loopDuration) return;
    duration.value = Number(loopDuration.value);
  }

  function syncSequence() {
    const sequence = document.querySelector('input[name="exportType"]:checked')?.value === 'sequence';
    sequenceSection.hidden = !sequence;
    document.querySelector('.exportFooter span').textContent = sequence ? 'PNG · 序列 ZIP' : 'PNG · 單張';
    fpsCustomField.hidden = fps.value !== 'custom';
    frameCount.value = `${Math.round(effectiveFps() * Number(duration.value))} 幀`;
    if (engineReady && !exporting) start.textContent = sequence ? '輸出 PNG 序列' : '輸出 PNG';
  }

  function exportSettings() {
    return {
      type: document.querySelector('input[name="exportType"]:checked')?.value || 'still',
      width: Number(width.value),
      height: Number(height.value),
      background: document.getElementById('exportBackground').value,
      fov: Number(document.getElementById('exportFov').value),
      scale: Number(document.getElementById('exportScale').value) / 100,
      centerX: Number(document.getElementById('exportCenterX').value) / 100,
      centerY: Number(document.getElementById('exportCenterY').value) / 100,
      antialias: 4,
      fps: effectiveFps(),
      duration: Number(duration.value),
    };
  }

  function syncWorkspaceLayout() {
    if (!dialog.open || !desktopQuery.matches) return;
    const w = Math.max(64, Number(width.value) || 64);
    const h = Math.max(64, Number(height.value) || 64);
    const ratio = w / h;
    const regionLeft = 16;
    const regionTop = 58;
    const regionWidth = Math.max(160, window.innerWidth - 420);
    const regionHeight = Math.max(160, window.innerHeight - 74);
    let frameWidth = regionWidth;
    let frameHeight = frameWidth / ratio;
    if (frameHeight > regionHeight) {
      frameHeight = regionHeight;
      frameWidth = frameHeight * ratio;
    }
    document.body.style.setProperty('--export-stage-width', `${frameWidth}px`);
    document.body.style.setProperty('--export-stage-height', `${frameHeight}px`);
    document.body.style.setProperty('--export-stage-left', `${regionLeft + (regionWidth - frameWidth) * 0.5}px`);
    document.body.style.setProperty('--export-stage-top', `${regionTop + (regionHeight - frameHeight) * 0.5}px`);
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('prism-export-workspace-resize')));
  }

  function openWorkspace() {
    restoreParameterPanel = !parameterPanel.classList.contains('collapsed');
    if (desktopQuery.matches) {
      parameterPanel.classList.add('collapsed');
      dialog.show();
    } else {
      dialog.showModal();
    }
    followLoopDuration();
    syncSequence();
    document.body.classList.add('export-workspace-open');
    syncWorkspaceLayout();
    requestAnimationFrame(syncPreview);
  }

  trigger.addEventListener('click', () => {
    if (dialog.open) dialog.close();
    else openWorkspace();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('export-workspace-open');
    if (desktopQuery.matches && restoreParameterPanel) parameterPanel.classList.remove('collapsed');
    ['--export-stage-width', '--export-stage-height', '--export-stage-left', '--export-stage-top']
      .forEach(property => document.body.style.removeProperty(property));
    window.dispatchEvent(new CustomEvent('prism-export-preview-clear'));
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('prism-export-workspace-resize')));
    trigger.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open && !dialog.matches(':modal')) dialog.close();
  });
  window.addEventListener('resize', syncWorkspaceLayout);
  desktopQuery.addEventListener('change', () => {
    if (dialog.open) dialog.close();
  });
  document.querySelectorAll('input[name="exportType"]').forEach(input => input.addEventListener('change', syncSequence));
  document.querySelectorAll('.exportPresetGrid button').forEach(button => button.addEventListener('click', () => {
    [width.value, height.value] = button.dataset.size.split('x');
    syncDimensions();
    syncPreview();
  }));
  [width, height].forEach(input => input.addEventListener('input', () => {
    syncDimensions();
    syncPreview();
  }));
  [fps, fpsCustom].forEach(input => input.addEventListener('input', syncSequence));
  duration.addEventListener('input', () => {
    durationCustomized = true;
    syncSequence();
  });
  // 面板的循環秒數改動時，還沒被客製的輸出秒數跟著走。
  loopDuration?.addEventListener('input', () => {
    followLoopDuration();
    syncSequence();
  });
  document.querySelectorAll('.exportRange').forEach(label => {
    const input = label.querySelector('input');
    const output = label.querySelector('output');
    input.addEventListener('input', () => {
      output.value = input.id === 'exportFov' ? `${input.value}°` : `${input.value}%`;
      if (input.id === 'exportCenterX' || input.id === 'exportCenterY') output.value = input.value;
      syncPreview();
    });
  });
  function syncPreview() {
    if (!dialog.open) return;
    syncWorkspaceLayout();
    window.dispatchEvent(new CustomEvent('prism-export-preview', { detail: exportSettings() }));
  }
  document.getElementById('exportCenterReset').addEventListener('click', () => {
    ['exportCenterX', 'exportCenterY'].forEach(id => {
      const input = document.getElementById(id);
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  document.getElementById('exportBackground').addEventListener('change', syncPreview);
  start.addEventListener('click', () => {
    if (exporting) {
      window.dispatchEvent(new CustomEvent('prism-export-cancel'));
      start.textContent = '正在取消…';
      start.disabled = true;
      return;
    }
    if (!engineReady) return;
    exporting = true;
    start.disabled = false;
    start.textContent = '取消輸出';
    progress.hidden = false;
    progressBar.style.width = '0%';
    progressText.value = '準備輸出…';
    window.dispatchEvent(new CustomEvent('prism-export-request', { detail: exportSettings() }));
  });
  window.addEventListener('prism-export-ready', () => {
    engineReady = true;
    start.disabled = false;
    syncSequence();
  });
  window.addEventListener('prism-export-progress', event => {
    const value = Math.max(0, Math.min(1, event.detail?.progress || 0));
    progressBar.style.width = `${value * 100}%`;
    progressText.value = event.detail?.message || `輸出 ${Math.round(value * 100)}%`;
  });
  window.addEventListener('prism-export-complete', event => {
    exporting = false;
    start.disabled = false;
    progressBar.style.width = '100%';
    progressText.value = event.detail?.message || '輸出完成';
    syncSequence();
  });
  window.addEventListener('prism-export-error', event => {
    exporting = false;
    start.disabled = false;
    progressBar.style.width = '0%';
    progressText.value = event.detail?.message || '輸出失敗，請降低尺寸後重試。';
    syncSequence();
  });

  syncDimensions();
  followLoopDuration();
  syncSequence();
})();
