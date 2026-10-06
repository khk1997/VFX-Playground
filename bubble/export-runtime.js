'use strict';

import { buildStoredZip, downloadBlob, nextPaint, pixelsToPng } from './export-utils.js?v=1';
import { usesStudioGlass } from './motions/registry.js?v=type-glass-1';

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
  // 輸出一律用最高畫質：自動降級是給即時預覽的，成品不該跟著當下的 fps 變。
  getUniforms().uGlassQualityTier.value = 0;
}

function settingsValue(settings, key) {
  return settings && Number.isFinite(Number(settings[key])) ? Number(settings[key]) : 0;
}

function settingsCenter(value) {
  return Math.max(-0.5, Math.min(0.5, value));
}

function renderExportPixels(settings, target) {
  renderComposite(target, settings.renderWidth / Math.max(1, settings.width));
  const pixels = new Uint8Array(settings.renderWidth * settings.renderHeight * 4);
  getRenderer().readRenderTargetPixels(target, 0, 0, settings.renderWidth, settings.renderHeight, pixels);
  getRenderer().setRenderTarget(null);
  return pixels;
}

// 靜態玻璃的去背：同一幀在全黑、全白兩張背景紙上各算一次，由兩者的差解出
// alpha 與顏色（difference matting）。
//
// 單張去背（shader 裡 uTransparentBackground 那條）對靜態玻璃是錯的：它假設
// 「畫面 = 自身 + 正後方的背景 × 透過率」，但玻璃透過來的是折射、分光之後的
// 背景。那份差距被除以很小的 alpha（平面玻璃只有一成左右）之後大半超出 0–1
// 被截掉 —— 輸出的 PNG 幾乎沒有色散，淺底更整顆變白（背景紙的漸層沒關，玻璃
// 裡看到的還是灰紙）；地板影子則因為屬於背景，alpha 直接是 0 而整個消失。
//
// 兩張背景紙的差正是「背景透過來多少」，不管它是從正後方還是被折過來的：
//   黑底 = F·a            白底 = F·a + (1 − a)
// 所以 1 − (白 − 黑) 就是覆蓋率。燈卡、反射、色散是玻璃自己的光，兩張都有、
// 相減就留在顏色裡；地板影子是把紙壓暗，自然解成半透明的黑。疊回黑底或白底
// 時與直接算繪一致。
//
// 單一 alpha 表示不了有色的透過率，所以 a 取透過率的亮度，顏色取「讓黑底與白底
// 兩邊誤差平均」的那個值。直接在 8 位元的輸出值上解，而不是線性空間：PNG 的
// 使用者（瀏覽器、設計軟體）就是在這個空間裡做 over 合成的。
function matteExportPixels(black, white) {
  const out = new Uint8Array(black.length);
  for (let i = 0; i < black.length; i += 4) {
    const tr = Math.min(Math.max((white[i] - black[i]) / 255, 0), 1);
    const tg = Math.min(Math.max((white[i + 1] - black[i + 1]) / 255, 0), 1);
    const tb = Math.min(Math.max((white[i + 2] - black[i + 2]) / 255, 0), 1);
    const alpha = 1 - (0.2126 * tr + 0.7152 * tg + 0.0722 * tb);
    if (alpha < 0.5 / 255) continue;   // 全透明：留 0,0,0,0
    const leak = 1 - alpha;
    for (let c = 0; c < 3; c++) {
      const b = black[i + c] / 255;
      const w = white[i + c] / 255;
      out[i + c] = Math.round(Math.min(Math.max((b + w - leak) / (2 * alpha), 0), 1) * 255);
    }
    out[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

async function renderExportFrame(settings, time, target) {
  applyExportCamera(time, settings.renderWidth, settings.renderHeight, settings.fov, settings.scale, settings);
  let pixels;
  if (settings.staticMatte) {
    const paper = getUniforms().uBgColor.value;
    paper.setRGB(0, 0, 0, THREE.LinearSRGBColorSpace);
    const black = renderExportPixels(settings, target);
    paper.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);
    const white = renderExportPixels(settings, target);
    pixels = matteExportPixels(black, white);
  } else {
    pixels = renderExportPixels(settings, target);
  }
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
    bgColor: getUniforms().uBgColor.value.clone(),
    lightGradient: getUniforms().uLightBgGradientEnabled.value,
    wallLift: getUniforms().uStudioWallLift.value,
    floorLift: getUniforms().uStudioFloorLift.value,
    floorTone: getUniforms().uStudioFloorTone.value,
    shadowStrength: getUniforms().uStudioShadowStrength.value,
  };
  const target = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  const transparentExport = settings.background === 'transparent';
  // 舊材質路徑（通用玻璃）走「黑場 + 反預乘」，它的顏色本來就不依附背景。
  // 新玻璃模型改走雙背景去背（見 matteExportPixels）。兩張都照一般的不透明輸出
  // 來算，後處理與 HDR 的行為就跟畫面上一模一樣；背景紙要是一張均勻的紙，
  // 牆面與地板的抬底、地板的壓暗、淺底的漸層都拿掉 —— 不然它們兩張都有，
  // 會被當成玻璃自己的東西，成品上浮出一整片灰色的地板。
  const staticMatte = transparentExport && usesStudioGlass(P.motion);
  getUniforms().uTransparentBackground.value = transparentExport && !staticMatte ? 1 : 0;
  getUniforms().uBgMode.value = settings.background === 'scene' ? SELECTS.bgMode.map[P.bgMode] : 0;
  if (transparentExport) getUniforms().uBgColor.value.setHex(0x000000, THREE.LinearSRGBColorSpace);
  if (staticMatte) {
    getUniforms().uLightBgGradientEnabled.value = 0;
    getUniforms().uStudioWallLift.value = 0;
    getUniforms().uStudioFloorLift.value = 0;
    getUniforms().uStudioFloorTone.value = 1;
    // 不留影子：地板在兩張背景紙上就都是一張乾淨的紙，解出來整片透明。
    if (settings.shadow === false) getUniforms().uStudioShadowStrength.value = 0;
  }
  const frameSettings = { ...settings, width, height, renderWidth, renderHeight, staticMatte };

  try {
    resetPreviousDropT();
    if (settings.type === 'still') {
      exportEvent('prism-export-progress', { progress: 0.15, message: '正在渲染 PNG…' });
      const png = await renderExportFrame(frameSettings, saved.time, target);
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
        const png = await renderExportFrame(frameSettings, time, target);
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
    getUniforms().uBgColor.value.copy(saved.bgColor);
    getUniforms().uLightBgGradientEnabled.value = saved.lightGradient;
    getUniforms().uStudioWallLift.value = saved.wallLift;
    getUniforms().uStudioFloorLift.value = saved.floorLift;
    getUniforms().uStudioFloorTone.value = saved.floorTone;
    getUniforms().uStudioShadowStrength.value = saved.shadowStrength;
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
