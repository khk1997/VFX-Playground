'use strict';

import { buildStoredZip, downloadBlob, nextPaint, pixelsToPng } from './export-utils.js?v=1';

export function createExportRuntime(options) {
  const {
    THREE, params: P, selects: SELECTS, getUniforms, getRenderer, ensureInitialized,
    updateDropUniforms, rotation: rot, rotM4, tmpX, tmpZ, isFormationMotion,
    getShapeField, formationFidelityAmount, formationAmount, smoothstepCPU, syncEdgeDropMotion,
    renderComposite, isMobile, flushShatterCutAnchors, syncLoop,
    getSimTime, setSimTime, resetPreviousDropT, canvas, resize,
  } = options;
  let exportJob = null;
  let exportPreviewSettings = null;
  let exportPreviewContext = null;

/* ===== 高解析度 PNG / PNG 序列輸出 ===== */
function exportEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function applyExportCamera(time, width, height, fov, scale, settings = null) {
  updateDropUniforms(time);
  const phase01 = time / Math.max(0.001, P.loopDuration);
  const loopAngle = phase01 * Math.PI * 2;
  const autoYaw = (Math.sin(loopAngle) * 0.85 + Math.sin(loopAngle * 2 + 0.6) * 0.15) * P.spin * 0.6;
  const autoPitch = Math.sin(loopAngle + 1.1) * P.spin * 0.14;
  // 兩段推軌都要跟即時預覽讀同一顆開關（見 render loop 裡的同名計算）。這裡原本
  // 完全沒看 dollyEnabled，於是關掉前後拉伸之後，預覽不推、匯出的影片卻仍然推。
  const dolly = !P.dollyEnabled ? 1 : 1
    - 0.05 * Math.exp(-Math.pow((phase01 - 0.80) / 0.10, 2))
    - 0.03 * Math.exp(-Math.pow((phase01 - 0.24) / 0.08, 2));
  rotM4.makeRotationY(rot.y + autoYaw);
  tmpX.makeRotationX(rot.x + autoPitch);
  rotM4.multiply(tmpX);
  tmpZ.makeRotationZ(-0.03);
  rotM4.multiply(tmpZ);
  getUniforms().uRot.value.setFromMatrix4(rotM4);

  const frameGatherEnd = Math.max(0.15, P.gatherDuration);
  const frameHoldEnd = Math.min(0.94, frameGatherEnd + P.shapeHold);
  const formationFocus = P.dollyEnabled && isFormationMotion(P.motion) && getShapeField()
    ? (phase01 > frameHoldEnd)
      ? formationFidelityAmount(phase01)
      : smoothstepCPU(formationAmount(phase01), 0.42, 0.92)
    : 0;
  getUniforms().uCameraDistance.value = P.cameraDistance * dolly * (1 - formationFocus * 0.30) / scale;
  getUniforms().uCompositionOffsetX.value = settingsCenter(settingsValue(settings, 'centerX'));
  getUniforms().uCompositionOffsetY.value = settingsCenter(settingsValue(settings, 'centerY'));
  getUniforms().uTanHalfFov.value = Math.tan(Math.max(10, Math.min(120, fov)) * Math.PI / 360);
  getUniforms().uResolution.value.set(width, height);
  getUniforms().uTime.value = time;
  syncEdgeDropMotion(time);
  getUniforms().uMaxSteps.value = 88;
}

function settingsValue(settings, key) {
  return settings && Number.isFinite(Number(settings[key])) ? Number(settings[key]) : 0;
}

function settingsCenter(value) {
  return Math.max(-0.5, Math.min(0.5, value));
}

async function renderExportFrame(settings, time, target) {
  applyExportCamera(time, settings.renderWidth, settings.renderHeight, settings.fov, settings.scale, settings);
  renderComposite(target, settings.renderWidth / Math.max(1, settings.width));
  const pixels = new Uint8Array(settings.renderWidth * settings.renderHeight * 4);
  getRenderer().readRenderTargetPixels(target, 0, 0, settings.renderWidth, settings.renderHeight, pixels);
  getRenderer().setRenderTarget(null);
  return pixelsToPng(pixels, settings.renderWidth, settings.renderHeight, settings.width, settings.height);
}

async function runExport(settings) {
  if (exportJob) throw new Error('已有輸出工作正在進行');
  ensureInitialized();
  const width = Math.round(settings.width);
  const height = Math.round(settings.height);
  const antialias = 4;
  const renderWidth = width * antialias;
  const renderHeight = height * antialias;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
    throw new Error('輸出尺寸至少需要 64 × 64');
  }
  const maxTexture = getRenderer().capabilities.maxTextureSize;
  if (renderWidth > maxTexture || renderHeight > maxTexture) {
    throw new Error(`${antialias}× 抗鋸齒超過此裝置限制，請降低尺寸或品質`);
  }
  const frames = settings.type === 'sequence'
    ? Math.max(1, Math.round(settings.fps * settings.duration)) : 1;
  const totalPixels = renderWidth * renderHeight * frames;
  const safePixelBudget = isMobile() ? 140000000 : 900000000;
  if (totalPixels > safePixelBudget) {
    throw new Error(isMobile()
      ? '手機序列輸出量過大，請降低尺寸、幀率或秒數'
      : '序列輸出量過大，請降低尺寸、幀率或秒數');
  }

  const job = { cancelled: false };
  exportJob = job;
  flushShatterCutAnchors();
  syncLoop();
  const saved = {
    time: getSimTime(),
    resolution: getUniforms().uResolution.value.clone(),
    cameraDistance: getUniforms().uCameraDistance.value,
    compositionX: getUniforms().uCompositionOffsetX.value,
    compositionY: getUniforms().uCompositionOffsetY.value,
    tanHalfFov: getUniforms().uTanHalfFov.value,
    maxSteps: getUniforms().uMaxSteps.value,
    bgMode: getUniforms().uBgMode.value,
    transparent: getUniforms().uTransparentBackground.value,
    membraneOverWhite: getUniforms().uMembraneOverWhite.value,
    bgColor: getUniforms().uBgColor.value.clone(),
  };
  const target = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  const transparentExport = settings.background === 'transparent';
  // 液態薄膜的膜身是「透過白底看到的顏色」，而且亮底顯色路徑是由背景亮度開的
  // 閘 —— 把背景抽成黑的等於連材質模型一起換掉，成品會整片變淡、跟畫面對不上。
  // 改成保留白底把顏色算完，再由 shader 對白底反乘出 straight alpha
  //（uMembraneOverWhite 分支），背景照樣透得過來。通用玻璃維持原本的「黑場 +
  // 反預乘」，它的顏色本來就不依附背景。
  const membraneOverWhite = transparentExport && P.materialStyle === 'membrane';
  getUniforms().uTransparentBackground.value = transparentExport ? 1 : 0;
  getUniforms().uMembraneOverWhite.value = membraneOverWhite ? 1 : 0;
  getUniforms().uBgMode.value = settings.background === 'scene' ? SELECTS.bgMode.map[P.bgMode] : 0;
  if (transparentExport && !membraneOverWhite) getUniforms().uBgColor.value.setHex(0x000000, THREE.LinearSRGBColorSpace);

  try {
    resetPreviousDropT();
    if (settings.type === 'still') {
      exportEvent('prism-export-progress', { progress: 0.15, message: '正在渲染 PNG…' });
      const png = await renderExportFrame({ ...settings, width, height, renderWidth, renderHeight }, saved.time, target);
      if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
      downloadBlob(png, `prism-drops_${width}x${height}.png`);
    } else {
      const entries = [];
      const digits = Math.max(4, String(frames).length);
      for (let index = 0; index < frames; index++) {
        if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
        // Sample the requested export duration; when it follows the panel this
        // remains one complete loop, while a custom value controls the output
        // playback length as advertised by the export UI.
        const time = index / frames * settings.duration;
        const png = await renderExportFrame({ ...settings, width, height, renderWidth, renderHeight }, time, target);
        entries.push({
          name: `prism-drops_${String(index + 1).padStart(digits, '0')}.png`,
          bytes: new Uint8Array(await png.arrayBuffer()),
        });
        exportEvent('prism-export-progress', {
          progress: (index + 1) / frames * 0.92,
          message: `正在渲染 ${index + 1} / ${frames} 幀`,
        });
        await nextPaint();
      }
      if (job.cancelled) throw new DOMException('輸出已取消', 'AbortError');
      exportEvent('prism-export-progress', { progress: 0.96, message: '正在封裝 ZIP…' });
      const zip = buildStoredZip(entries);
      downloadBlob(zip, `prism-drops_${width}x${height}_${settings.fps}fps.zip`);
    }
    exportEvent('prism-export-complete', { message: '輸出完成，檔案已開始下載' });
  } catch (error) {
    if (error.name === 'AbortError') exportEvent('prism-export-complete', { message: '已取消輸出' });
    else throw error;
  } finally {
    target.dispose();
    getRenderer().setRenderTarget(null);
    getUniforms().uResolution.value.copy(saved.resolution);
    getUniforms().uCameraDistance.value = saved.cameraDistance;
    getUniforms().uCompositionOffsetX.value = saved.compositionX;
    getUniforms().uCompositionOffsetY.value = saved.compositionY;
    getUniforms().uTanHalfFov.value = saved.tanHalfFov;
    getUniforms().uMaxSteps.value = saved.maxSteps;
    getUniforms().uBgMode.value = saved.bgMode;
    getUniforms().uTransparentBackground.value = saved.transparent;
    getUniforms().uMembraneOverWhite.value = saved.membraneOverWhite;
    getUniforms().uBgColor.value.copy(saved.bgColor);
    resetPreviousDropT();
    setSimTime(saved.time);
    exportJob = null;
    syncLoop();
  }
}

window.addEventListener('prism-export-request', event => {
  runExport(event.detail).catch(error => {
    console.error(error);
    exportEvent('prism-export-error', { message: error.message || '輸出失敗' });
    if (exportJob) {
      exportJob = null;
      syncLoop();
    }
  });
});
window.addEventListener('prism-export-cancel', () => {
  if (exportJob) exportJob.cancelled = true;
});
window.addEventListener('prism-export-preview', event => {
  exportPreviewSettings = event.detail || null;
});
window.addEventListener('prism-export-preview-clear', () => {
  exportPreviewSettings = null;
});
window.addEventListener('prism-export-workspace-resize', resize);

function updateExportCameraPreview() {
  if (!exportPreviewSettings) return;
  const preview = document.getElementById('exportPreviewCanvas');
  if (!preview) return;
  const targetAspect = Math.max(0.05,
    Number(exportPreviewSettings.width) / Math.max(1, Number(exportPreviewSettings.height)));
  const longEdge = 480;
  const previewWidth = targetAspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * targetAspect));
  const previewHeight = targetAspect >= 1 ? Math.max(1, Math.round(longEdge / targetAspect)) : longEdge;
  if (preview.width !== previewWidth || preview.height !== previewHeight) {
    preview.width = previewWidth;
    preview.height = previewHeight;
    exportPreviewContext = preview.getContext('2d', { alpha: false });
  }
  if (!exportPreviewContext || !canvas.width || !canvas.height) return;

  const sourceAspect = canvas.width / canvas.height;
  let sourceX = 0, sourceY = 0, sourceWidth = canvas.width, sourceHeight = canvas.height;
  if (targetAspect < sourceAspect) {
    sourceWidth = canvas.height * targetAspect;
    sourceX = (canvas.width - sourceWidth) * 0.5;
  } else if (targetAspect > sourceAspect) {
    sourceHeight = canvas.width / targetAspect;
    sourceY = (canvas.height - sourceHeight) * 0.5;
  }
  exportPreviewContext.drawImage(
    canvas,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, previewWidth, previewHeight,
  );
}


  return {
    isExporting: () => Boolean(exportJob),
    getPreviewSettings: () => exportPreviewSettings,
    exportEvent,
    settingsValue,
    settingsCenter,
    updateExportCameraPreview,
  };
}
