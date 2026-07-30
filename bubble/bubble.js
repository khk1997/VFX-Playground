'use strict';
import * as THREE from 'three';
import { svgToField, gltfToField } from './shape-field.js';

/* ===== 預覽嵌入模式（?preview=1）===== */
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview-mode');

const canvas = document.getElementById('stage');
const mobileRenderQuery = window.matchMedia('(max-width: 760px)');
const DEFAULT_HDRI_URL = new URL('./assets/photo_studio_london_hall_1k.hdr', import.meta.url).href;
const DEFAULT_HDRI_LABEL = 'photo_studio_london_hall_1k.hdr';
const MAX_DROPS = 12;
const FORMATION_DEFAULT_COUNT = 6;
const MAX_MICRO_DROPS = 20;
const MAX_NEGATIVE_DROPS = 4;

/* ===== 參數 ===== */
const DEFAULTS = {              // 數值滑桿
  thickness: 195,
  thickVar: 40,
  noiseScale: 1.0,
  dispersion: 0.09,
  dispersionSeparation: 1.5,
  causticScale: 1.0,
  causticSharpness: 0.65,
  realDispersion: 0.32,
  realDispersionSeparation: 0.22,
  spectralCausticIntensity: 1.5,
  spectralCausticFocus: 0.31,
  spectralCausticWidth: 0.42,
  spectralCausticLightSize: 0.26,
  spectralCausticDensity: 0.03,
  spectralCausticSoftness: 1,
  spectralCausticWarp: 0.57,
  spectralCausticSeparation: 0.24,
  spectralCausticBounce: 0.19,
  spectralCausticFlow: 0.18,
  spectralCausticFresnelMask: 1,
  spectralCausticNoiseMask: 1,
  spectralCausticNoiseScale: 2.5,
  spectralCausticAzimuth: -177,
  spectralCausticElevation: -19,
  spectralCausticHdri: 0.3,
  artThickness: 165,
  artThickVar: 95,
  artNoiseScale: 1.0,
  artPatternSpeed: 0.21,
  artGravity: 1,
  filmBlur: 0.25,
  saturation: 1.94,
  patternSpeed: 0.21,
  count: 2,
  radius: 0.4,
  viscosity: 0.78,
  surfaceTension: 0.82,
  inertiaDeform: 0.68,
  spread: 0.75,
  fresnel: 0.8,
  gravity: 1,
  roughness: 0.2,
  flowSpeed: 0.47,
  reflect: 1.6,
  transmission: 0.96,
  materialExposure: 1,
  hdriYaw: 0,
  hdriPitch: 0,
  hdriBlur: 0.11,
  envRefraction: 0.03,
  cameraDistance: 4.95,
  loopDuration: 12,
  wobble: 0.305,
  wobbleScale: 0.7,
  wobbleSpeed: 0.65,
  elasticStrength: 0.024,
  elasticDensity: 3.5,
  elasticDamping: 0.55,
  elasticSpeed: 1.75,
  satelliteSize: 0.22,
  satelliteCount: 3,
  spin: 0.08,
  gatherDuration: 0.48,
  shapeDepth: 0.28,
  shapeSoftness: 0,
  shapeHold: 0.22,
  microCount: 14,
};
const SELECT_DEFAULTS = {
  bgMode: 'color',
  colorMode: 'spectral',
  motion: 'cinematic',
  shapeSource: 'svg',
  shapeQuality: 'balanced',
};
const TOGGLE_DEFAULTS = {
  filmEnabled: false,
  dispersionEnabled: true,
  realDispersionEnabled: true,
  spectralCausticEnabled: true,
};
const COLOR_DEFAULTS  = { bgColor: '#bdbdbd' };
const P = { ...DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS };
const motionCounts = { cinematic: 2, formation: FORMATION_DEFAULT_COUNT };

// 自訂漸層色標（最多 6，可調位置）— reset 用
const STOP_MAX = 6;
const RAMP_DEFAULT = {
  count: 6,
  cols: ['#3698d8', '#b794a6', '#d1aa75', '#b2b3b4', '#9e7d98', '#5dbded'],
  pos:  [0.56, 0.20, 0.39, 0.60, 0.27, 0.66],
};

// select 字串 → int uniform
const SELECTS = {
  bgMode:    { uniform: 'uBgMode',    map: { color: 0, hdri: 1 } },
  colorMode: { uniform: 'uColorMode', map: { spectral: 0, ramp: 1 } },
  motion:    { uniform: 'uMotion',    map: { cinematic: 0, formation: 1 } },
  shapeSource: { uniform: 'uShapeType', map: { svg: 1, gltf: 2 } },
  // 僅控制下一次 GLB 烘焙尺寸，沒有對應 shader uniform。
  shapeQuality: { uniform: '', map: { performance: 48, balanced: 80, high: 128 } },
};
const COLORS = { bgColor: 'uBgColor' };
const TOGGLES = {
  filmEnabled: 'uFilmEnabled',
  dispersionEnabled: 'uDispersionEnabled',
  realDispersionEnabled: 'uRealDispersionEnabled',
  spectralCausticEnabled: 'uSpectralCausticEnabled',
};

const fmt = {
  thickness: v => v.toFixed(0) + 'nm',
  thickVar: v => '±' + v.toFixed(0),
  noiseScale: v => 'x' + v.toFixed(1),
  count: v => v.toFixed(0),
  radius: v => v.toFixed(2),
  viscosity: v => v.toFixed(2),
  spread: v => v.toFixed(2),
  flowSpeed: v => 'x' + v.toFixed(2),
  spin: v => 'x' + v.toFixed(2),
  wobble: v => v.toFixed(3),
  wobbleScale: v => 'x' + v.toFixed(1),
  wobbleSpeed: v => 'x' + v.toFixed(2),
  patternSpeed: v => 'x' + v.toFixed(2),
  dispersion: v => Math.round(v * 100) + '%',
  dispersionSeparation: v => 'x' + v.toFixed(2),
  causticScale: v => 'x' + v.toFixed(2),
  causticSharpness: v => Math.round(v * 100) + '%',
  realDispersion: v => Math.round(v * 100) + '%',
  realDispersionSeparation: v => 'x' + v.toFixed(2),
  spectralCausticIntensity: v => Math.round(v * 100) + '%',
  spectralCausticFocus: v => Math.round(v * 100) + '%',
  spectralCausticWidth: v => 'x' + v.toFixed(2),
  spectralCausticLightSize: v => Math.round(v * 100) + '%',
  spectralCausticDensity: v => Math.round(v * 100) + '%',
  spectralCausticSoftness: v => Math.round(v * 100) + '%',
  spectralCausticWarp: v => Math.round(v * 100) + '%',
  spectralCausticSeparation: v => 'x' + v.toFixed(2),
  spectralCausticBounce: v => Math.round(v * 100) + '%',
  spectralCausticFlow: v => 'x' + v.toFixed(2),
  spectralCausticFresnelMask: v => Math.round(v * 100) + '%',
  spectralCausticNoiseMask: v => Math.round(v * 100) + '%',
  spectralCausticNoiseScale: v => 'x' + v.toFixed(1),
  spectralCausticAzimuth: v => v.toFixed(0) + '°',
  spectralCausticElevation: v => v.toFixed(0) + '°',
  spectralCausticHdri: v => Math.round(v * 100) + '%',
  artThickness: v => v.toFixed(0) + 'nm',
  artThickVar: v => '±' + v.toFixed(0),
  artNoiseScale: v => 'x' + v.toFixed(1),
  artPatternSpeed: v => 'x' + v.toFixed(2),
  artGravity: v => Math.round(v * 100) + '%',
  filmBlur: v => v.toFixed(2),
  reflect: v => 'x' + v.toFixed(2),
  transmission: v => v.toFixed(2),
  materialExposure: v => 'x' + v.toFixed(2),
  hdriYaw: v => v.toFixed(0) + '°',
  hdriPitch: v => v.toFixed(0) + '°',
  hdriBlur: v => Math.round(v * 100) + '%',
  envRefraction: v => Math.round(v * 100) + '%',
  cameraDistance: v => v.toFixed(2),
  loopDuration: v => v.toFixed(1) + 's',
  elasticStrength: v => v.toFixed(3),
  elasticDensity: v => 'x' + v.toFixed(1),
  elasticDamping: v => v.toFixed(2),
  elasticSpeed: v => 'x' + v.toFixed(2),
  satelliteSize: v => v.toFixed(2),
  satelliteCount: v => v.toFixed(0),
  gatherDuration: v => Math.round(v * 100) + '%',
  shapeDepth: v => v.toFixed(2),
  shapeSoftness: v => v.toFixed(3),
  shapeHold: v => Math.round(v * 100) + '%',
  microCount: v => v.toFixed(0),
};

import { VERT, FRAG } from './shaders.js?v=spectral-caustic-6';

/* ===== WebGL 場景（延遲初始化，規避預覽時的 context 上限）===== */
let renderer = null, scene = null, camera = null, mesh = null, uniforms = null;
let pmremGenerator = null, pmremTarget = null;
let inited = false;
const maxRenderDpr = PREVIEW ? 1 : mobileRenderQuery.matches
  ? Math.min(window.devicePixelRatio || 1, 1.5)
  : Math.min(window.devicePixelRatio || 1, 2);
const minRenderDpr = PREVIEW ? 1 : mobileRenderQuery.matches
  ? Math.min(maxRenderDpr, 1.25)
  : Math.max(1, maxRenderDpr - 0.25);
let qualityDpr = maxRenderDpr;
let qualitySteps = PREVIEW ? 56 : mobileRenderQuery.matches ? 64 : 88;
let qualitySampleStarted = performance.now();
let qualitySampleFrames = 0;
let qualityLowSamples = 0;
let qualityHighSamples = 0;

const rot = { x: 0.17, y: 0.52 };
const vel = { x: 0, y: 0 };
let compositionOffsetX = 0;
let dragging = false, lastX = 0, lastY = 0;
const rotM4 = new THREE.Matrix4();
const tmpX = new THREE.Matrix4();
const tmpZ = new THREE.Matrix4();
const dropData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
const dropShapeData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(1, 0, 0, 1));
const dropPhysicsData = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
const previousDropPositions = Array.from({ length: MAX_DROPS }, () => new THREE.Vector3());
const dropBounds = new THREE.Vector4(0, 0, 0, 1);
const elasticEvent = new THREE.Vector2(0, 0);
const elasticPair = new THREE.Vector2(0, 1);
// 斷裂處的衛星滴串（Rayleigh–Plateau）：沿收頸軸形成，釋放後各自漂移並被主滴回收。
const SAT_N = 3;
const SAT_SPEC = [
  { along: -0.55, size: 0.50, jitter:  0.05, seed: 0.7, drift: -0.22, absorbAt: 0.61 },
  { along:  0.35, size: 0.30, jitter: -0.06, seed: 2.4, drift:  0.12, absorbAt: 0.58 },
  { along:  1.05, size: 0.17, jitter:  0.05, seed: 4.9, drift:  0.28, absorbAt: 0.54 },
];
const satelliteDrops = Array.from({ length: SAT_N }, () => new THREE.Vector4(0, 0, 0, 0));
let previousDropT = null;
let previousPairKey = '';
let previousPairGap = 0;
let shapeField = null;
let shapeTargets = [];
let formationAnchors = [];
let microFormationAnchors = [];
let negativeFormationAnchors = [];
const microDropData = new Float32Array(MAX_MICRO_DROPS * 4);
const microShapeData = new Float32Array(MAX_MICRO_DROPS * 4);
const negativeDropData = new Float32Array(MAX_NEGATIVE_DROPS * 4);
let microDropTexture = null;
let microShapeTexture = null;
let negativeDropTexture = null;

const fract = x => x - Math.floor(x);
const hash11CPU = n => fract(Math.sin(n * 127.1) * 43758.5453123);
const dropSeeds = Array.from({ length: MAX_DROPS }, (_, i) => ({
  h1: hash11CPU(i + 1),
  h2: hash11CPU(i + 7),
  h3: hash11CPU(i + 13),
  radius: 0.72 + 0.55 * hash11CPU(i * 3.17 + 5),
}));

function distributeFormationAnchors(candidates, count = MAX_DROPS) {
  if (!candidates.length) return [];
  const center = candidates.reduce((sum, p) => sum.add(p), new THREE.Vector3())
    .multiplyScalar(1 / candidates.length);
  const chosen = [];
  let first = candidates[0];
  let farthest = -1;
  for (const p of candidates) {
    const d = p.distanceToSquared(center);
    if (d > farthest) { farthest = d; first = p; }
  }
  chosen.push(first);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best = candidates[0], bestDistance = -1;
    for (const p of candidates) {
      let nearest = Infinity;
      for (const q of chosen) nearest = Math.min(nearest, p.distanceToSquared(q));
      if (nearest > bestDistance) { bestDistance = nearest; best = p; }
    }
    chosen.push(best);
  }
  return chosen.map((p, i) => {
    const copy = p.clone();
    let nearest = Infinity;
    for (let j = 0; j < chosen.length; j++) {
      if (i === j) continue;
      nearest = Math.min(nearest, p.distanceTo(chosen[j]));
    }
    // Farthest-point sampling 保證覆蓋輪廓，但局部間距可能大於原始厚度提示。
    // 半徑至少跨過一半鄰距，才能形成連續液橋；上限則保留耳、嘴等造型辨識度。
    const bridgeRadius = Number.isFinite(nearest) ? nearest * 0.56 : 0.18;
    copy.radiusHint = Math.min(0.27, Math.max(p.radiusHint || 0.1, bridgeRadius));
    return copy;
  });
}

function distributePrimaryAnchors(candidates, count = MAX_DROPS) {
  if (!candidates.length) return [];
  const chosen = [];
  const remaining = candidates.slice();
  while (chosen.length < Math.min(count, candidates.length)) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const thickness = p.radiusHint || 0.1;
      const spacing = chosen.length
        ? Math.min(...chosen.map(q => p.distanceTo(q)))
        : thickness;
      // 主滴服務於體積與重量，優先落在厚實內部；間距僅防止全部擠在同一區。
      const score = thickness * 3.2 + spacing * 0.42;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const source = remaining.splice(bestIndex, 1)[0];
    const copy = source.clone();
    copy.radiusHint = Math.min(0.24, Math.max(0.14, source.radiusHint || 0.14));
    chosen.push(copy);
  }
  return chosen;
}

function distributeDetailedAnchors(candidates, count = MAX_MICRO_DROPS) {
  if (!candidates.length) return [];
  const weighted = [
    ...candidates,
    ...candidates.filter(p => p.surface),
  ];
  const centers = distributeFormationAnchors(weighted, count);
  const groups = Array.from({ length: centers.length }, () => []);
  // 少量 Lloyd iterations，把每顆橢球變成一塊模型區域的代表，而非單一體素。
  for (let iteration = 0; iteration < 5; iteration++) {
    groups.forEach(group => { group.length = 0; });
    for (const point of weighted) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = point.distanceToSquared(centers[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best].push(point);
    }
    for (let i = 0; i < centers.length; i++) {
      if (!groups[i].length) continue;
      centers[i].set(0, 0, 0);
      groups[i].forEach(point => centers[i].add(point));
      centers[i].multiplyScalar(1 / groups[i].length);
    }
  }
  for (let i = 0; i < centers.length; i++) {
    const group = groups[i];
    let vx = 0, vy = 0, vz = 0, radiusHint = 0.1;
    for (const point of group) {
      vx += (point.x - centers[i].x) ** 2;
      vy += (point.y - centers[i].y) ** 2;
      vz += (point.z - centers[i].z) ** 2;
      radiusHint = Math.max(radiusHint, point.radiusHint || 0.1);
    }
    const denom = Math.max(1, group.length);
    const variances = [vx / denom, vy / denom, vz / denom];
    const major = variances.indexOf(Math.max(...variances));
    centers[i].axis = new THREE.Vector3(
      major === 0 ? 1 : 0,
      major === 1 ? 1 : 0,
      major === 2 ? 1 : 0,
    );
    const sorted = variances.slice().sort((a, b) => b - a);
    centers[i].stretch = Math.min(1.42, Math.max(1.06,
      Math.sqrt((sorted[0] + 1e-4) / (sorted[1] + 1e-4))));
    centers[i].radiusHint = Math.min(0.28, Math.max(
      radiusHint,
      Math.sqrt(sorted[1] + sorted[2]) * 1.15,
    ));
  }
  return centers;
}

function cyclicPulse(phase, center, width) {
  const d = Math.abs(((phase - center + 0.5) % 1 + 1) % 1 - 0.5);
  if (d >= width) return 0;
  const x = 1 - d / width;
  return x * x * (3 - 2 * x);
}

function smoothstepCPU(value, edge0, edge1) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function formationAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  const gather = smoothstepCPU(phase, 0.04, gatherEnd);
  const release = smoothstepCPU(phase, holdEnd, 0.98);
  return gather * (1 - release);
}

function formationFidelityAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  // 直接使用循環 phase，而非已 smoothstep 過的 formationAmount 再平滑一次。
  // 預設 12 秒循環約有 2.6 秒完成吸收，避免末段在幾幀內由水滴跳成模型。
  const absorbStart = Math.max(0.08, gatherEnd - 0.22);
  const gatherAbsorb = smoothstepCPU(phase, absorbStart, gatherEnd);
  const releaseAbsorb = 1 - smoothstepCPU(phase, holdEnd, 0.98);
  return gatherAbsorb * releaseAbsorb;
}

function formationReleaseAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  return smoothstepCPU(phase, holdEnd, 0.98);
}

// 每顆水滴的自由段只使用整數諧波，因此 phase=0/1 的位置與速度完全相同。
// 匯集與散開共用同一個 formationAmount，故兩段是同一路徑的正反向。
function formationDropPosition(i, phase, count, out) {
  const tau = Math.PI * 2;
  const a = phase * tau;
  const { h1, h2 } = dropSeeds[i];
  const anchor = i * tau / count + h1 * 1.4;
  const orbit = P.spread * (1.25 + h2 * 0.65);
  const freeX = Math.cos(a + anchor) * orbit
    + Math.cos(a * 2 + anchor * 1.7) * orbit * 0.12;
  const freeY = Math.sin(a + anchor) * orbit * 0.62
    + Math.sin(a * 3 + anchor * 0.8) * orbit * 0.08;
  const freeZ = Math.sin(a * 2 + anchor * 1.3) * orbit * 0.48;
  const target = formationAnchors.length
    ? formationAnchors[i % formationAnchors.length]
    : null;
  const amount = formationAmount(phase);
  const eased = amount * amount * (3 - 2 * amount);
  const tx = target ? target.x : Math.cos(anchor) * 0.7;
  const ty = target ? target.y : Math.sin(anchor) * 0.7;
  const tz = target ? target.z : 0;
  return out.set(
    freeX + (tx - freeX) * eased,
    freeY + (ty - freeY) * eased,
    freeZ + (tz - freeZ) * eased,
  );
}

const formationPosNow = new THREE.Vector3();
const formationPosBefore = new THREE.Vector3();
const formationPosAfter = new THREE.Vector3();

function updateMicroDrops(phase, fidelityAbsorb = 0) {
  const activeCount = P.motion === 'formation' && shapeField
    ? Math.max(0, Math.min(MAX_MICRO_DROPS, Math.round(P.microCount)))
    : 0;
  const amount = formationAmount(phase);
  const a = phase * Math.PI * 2;
  for (let i = 0; i < MAX_MICRO_DROPS; i++) {
    const o = i * 4;
    if (i >= activeCount || !microFormationAnchors.length) {
      microDropData[o + 3] = 0;
      continue;
    }
    const h1 = hash11CPU(i * 2.31 + 31);
    const h2 = hash11CPU(i * 3.77 + 47);
    const h3 = hash11CPU(i * 5.13 + 61);
    const anchor = i * Math.PI * 2 / activeCount + h1 * 0.8;
    const orbit = P.spread * (1.15 + h2 * 0.75);
    const freeX = Math.cos(a + anchor) * orbit
      + Math.cos(a * 2 + anchor * 1.3) * orbit * 0.16;
    const freeY = Math.sin(a + anchor) * orbit * 0.72
      + Math.sin(a * 3 + anchor * 0.7) * orbit * 0.10;
    const freeZ = Math.sin(a * 2 + anchor * 1.9) * orbit * 0.52;
    // 錯開抵達時間，讓形狀像被液滴逐區域填滿，而不是所有粒子同步縮放。
    const arriveStart = 0.04 + h3 * 0.30;
    const arriveEnd = 0.62 + h3 * 0.20;
    const local = smoothstepCPU(amount, arriveStart, arriveEnd);
    const eased = local * local * (3 - 2 * local);
    const target = microFormationAnchors[i % microFormationAnchors.length];
    const insetScale = 1 - fidelityAbsorb * 0.20;
    microDropData[o] = (freeX + (target.x - freeX) * eased) * insetScale;
    microDropData[o + 1] = (freeY + (target.y - freeY) * eased) * insetScale;
    microDropData[o + 2] = (freeZ + (target.z - freeZ) * eased) * insetScale;
    const targetRadius = target.radiusHint || P.radius * (0.28 + h2 * 0.16);
    // 自由飛行時仍是清楚可見的小滴；抵達後保留完整體積成為最終造型的一部分。
    // 半徑與位置共用相同 local，因此不會再出現「先縮掉、模型才淡入」。
    const freeRadius = targetRadius * (0.52 + h2 * 0.16);
    microDropData[o + 3] = (freeRadius + (targetRadius - freeRadius) * eased)
      * (1 - fidelityAbsorb);
    const axis = target.axis || formationPosNow.set(1, 0, 0);
    microShapeData[o] = axis.x;
    microShapeData[o + 1] = axis.y;
    microShapeData[o + 2] = axis.z;
    microShapeData[o + 3] = 1 + ((target.stretch || 1) - 1) * eased;
  }
  if (microDropTexture) microDropTexture.needsUpdate = true;
  if (microShapeTexture) microShapeTexture.needsUpdate = true;
  return activeCount;
}

function updateNegativeDrops(phase, fidelityAbsorb = 0) {
  const amount = smoothstepCPU(formationAmount(phase), 0.58, 0.96);
  const selected = negativeFormationAnchors;
  for (let i = 0; i < MAX_NEGATIVE_DROPS; i++) {
    const o = i * 4;
    const target = selected[i];
    if (!target || amount <= 0) {
      negativeDropData[o + 3] = 0;
      continue;
    }
    negativeDropData[o] = target.x;
    negativeDropData[o + 1] = target.y;
    negativeDropData[o + 2] = target.z;
    negativeDropData[o + 3] = (target.radiusHint || 0.09) * amount
      * (1 - fidelityAbsorb);
  }
  if (negativeDropTexture) negativeDropTexture.needsUpdate = true;
  return Math.min(selected.length, MAX_NEGATIVE_DROPS);
}

function cinematicTimeline(phase) {
  // 12 秒敘事，節奏配平：停留 → 蓄力 → 拉斷 → 漂浮 → 靠近 → 接觸融合 → 毛細平復 → 停留。
  // 位置與體積分開控制：聚合時 approach 幾乎收滿距離，最後由表面接觸完成融合。
  // 分裂與融合各自擁有一次守恆的毛細事件（recoil / coalesce），維持敘事對稱。
  const anticipation = cyclicPulse(phase, 0.09, 0.05);
  const pull = smoothstepCPU(phase, 0.10, 0.19);
  const detach = smoothstepCPU(phase, 0.18, 0.26);
  // 靠近提前到 0.50，把原本 ~4 秒的空拍漂浮段壓成與分裂段對稱的長度。
  const approach = smoothstepCPU(phase, 0.50, 0.66);
  const absorb = smoothstepCPU(phase, 0.66, 0.80);
  const contact = smoothstepCPU(phase, 0.60, 0.70)
    * (1 - smoothstepCPU(phase, 0.80, 0.88));

  const volumeSeparation = smoothstepCPU(phase, 0.135, 0.26) * (1 - absorb);
  const travelOut = smoothstepCPU(phase, 0.13, 0.27);
  // approach 收到 0.92：保留真實接觸殘距（兩滴接觸時球心相距約 r1+r2，不重合），
  // 剩餘閉合交給 absorb 期子滴收縮，讀起來是「表面貼合後排液」而非「原地被吸乾」。
  const distanceSeparation = travelOut
    * (1 - approach * 0.92)
    * (1 - absorb);

  const recoilProgress = Math.max(0, Math.min(1, (phase - 0.19) / 0.17));
  // raised-cosine（Hann）脈衝取代半正弦：峰值與時機不變，但兩端斜率為 0。
  // sin(π·x) 在 clamp 邊界（分離起點 phase 0.19）斜率從 0 突跳到 π/0.17，
  // 是 C1 不連續 → 無限 jerk（加速度脈衝），視覺上就是分離瞬間那下不自然的猛晃。
  const recoil = 0.5 * (1 - Math.cos(2 * Math.PI * recoilProgress));
  const splitProgress = Math.max(0, Math.min(1, (phase - 0.11) / 0.18));
  const splitShape = 0.5 * (1 - Math.cos(2 * Math.PI * splitProgress))
    * (1 - smoothstepCPU(phase, 0.29, 0.36));

  // 融合毛細震盪進度：接觸建立後（~0.62）發源，於 absorb 完成（0.80，接觸軸退化）前
  // ring-down 歸零；尾段為 0 亦維持循環週期性。
  const coalesce = Math.max(0, Math.min(1, (phase - 0.62) / 0.18));

  return {
    anticipation,
    pull,
    detach,
    approach,
    absorb,
    contact,
    volumeSeparation,
    distanceSeparation,
    recoil,
    splitShape,
    coalesce,
  };
}

// 水滴動畫只在 CPU 每幀計算一次；shader 的每個 march step 僅讀取 vec4 array。
function updateDropUniforms(t) {
  const count = Math.max(1, Math.min(MAX_DROPS, Math.round(P.count)));
  const tau = Math.PI * 2;
  const phase = fract(t / Math.max(0.001, P.loopDuration));
  const a = phase * tau;
  const energy = 0.55 + P.flowSpeed * 0.9;
  const amount = formationAmount(phase);
  const fidelityAbsorb = P.motion === 'formation' && shapeField
    ? formationFidelityAmount(phase)
    : 0;
  const holdEnd = Math.min(0.94, Math.max(0.15, P.gatherDuration) + P.shapeHold);
  const releasingShape = phase > holdEnd;
  const releaseTransfer = releasingShape ? formationReleaseAmount(phase) : 0;
  // 高密度細節場由可見主滴進入模型區域後才開始長出；它本身是預烘焙
  // Metaball union，而非原始 GLB SDF。
  const formationShapeProgress = P.motion === 'formation' && shapeField
    // 回程使用同一個體積交接進度：模型從第一幀開始退、水滴同步長回。
    // 舊版先維持完整模型、再集中侵蝕，會形成「模型上冒球後突然塌掉」。
    ? releasingShape
      // 在水滴完全散開前清掉最後的模型核心，避免循環尾端留下 SDF 碎片。
      ? 1 - smoothstepCPU(releaseTransfer, 0.0, 0.84)
      : smoothstepCPU(amount, 0.42, 0.96)
    : 0;
  // 模型已大致長成後，讓可見水滴在目標體積內連續被 SDF 吸收。
  // 最後輪廓只剩匯入模型場；吸收在模型完成前不啟動，避免「水滴先縮、模型才出現」。
  const microCount = updateMicroDrops(phase, fidelityAbsorb);
  const negativeCount = updateNegativeDrops(phase, fidelityAbsorb);

  const cinema = cinematicTimeline(phase);
  const separation = cinema.volumeSeparation;
  const merge = 1 - separation;
  const tension = cinema.pull * (1 - cinema.detach);
  const breakaway = cinema.recoil;
  const bounceProgress = Math.max(0, Math.min(1, (phase - 0.19) / 0.17));
  // 只保留一次小幅回彈；不再疊加多週正負振盪。
  const followThrough = breakaway * Math.sin(bounceProgress * Math.PI * 2)
    * Math.exp(-3.2 * bounceProgress);
  // 滑桿值仍是基準黏度；電影模式依事件暫時改變融合半徑。
  // 接觸時增黏，拉伸時開始收頸，斷裂時快速卸除 smooth-min 的連接。
  let viscosityScale = P.motion === 'cinematic'
    ? Math.max(0.35, 1 + merge * 0.15 - tension * 0.25 - breakaway * 0.55)
    : P.motion === 'formation'
      // smooth-min 連續合併很多顆時會累積膨脹；依數量正規化融合半徑，
      // 讓 12–16 顆仍只在真正接觸處形成液橋，不把整組擴成巨大距離場。
      ? Math.max(0.10, 0.42 / Math.sqrt(count))
      : 1;
  let effectiveViscosity = P.viscosity * viscosityScale;
  const groupX = Math.sin(a) * P.spread * 0.12 * energy;
  const groupY = Math.sin(a * 2 + 0.4) * P.spread * 0.08 * energy;
  const groupZ = Math.cos(a) * P.spread * 0.07 * energy;

  for (let i = 0; i < MAX_DROPS; i++) {
    const { h1, h2, h3, radius } = dropSeeds[i];
    let x = 0, y = 0, z = 0, radiusFactor = 1;

    if (P.motion === 'cinematic') {
      // 所有水滴共用同一個緩慢旋轉的分離軸；不再各自沿亂數弧線交叉碰撞。
      const anchor = i * tau / count + Math.sin(a) * 0.18;
      const radial = P.spread * (1.04 + h2 * 0.06) * energy;
      const recoil = 1 + breakaway * (0.11 + h2 * 0.018)
        + followThrough * (0.035 + h3 * 0.012);
      const actionScale = cinema.distanceSeparation * recoil;
      x = groupX + Math.cos(anchor) * radial * actionScale;
      y = groupY + Math.sin(anchor) * radial * 0.24 * actionScale;
      z = groupZ + Math.sin(anchor) * radial * 0.52 * actionScale;
      // 形變本身已近似守恆體積，避免再用半徑做一次「呼吸」而產生橫向縮放感。
      radiusFactor = 1 + cinema.anticipation * 0.01
        + breakaway * 0.006 + followThrough * 0.004;
    } else if (P.motion === 'formation') {
      const formation = amount;
      formationDropPosition(i, phase, count, formationPosNow);
      x = formationPosNow.x;
      y = formationPosNow.y;
      z = formationPosNow.z;
      radiusFactor = 0.82 + formation * 0.18;
    }
    // 大滴受重力與慣性影響較明顯；常量位移不破壞循環接縫。
    y -= P.gravity * P.spread * 0.045 * Math.pow(radius, 1.35);
    if (P.motion === 'formation') {
      // anchor 可能落在模型表層；吸收時稍微往模型中心推入，避免半徑縮小後
      // 先失去液橋、在輪廓旁短暫留下孤立小球。
      const insetScale = 1 - fidelityAbsorb * 0.20;
      x *= insetScale;
      y *= insetScale;
      z *= insetScale;
    }
    const freeRadius = P.radius * radius * radiusFactor;
    if (P.motion === 'formation') {
      const targetRadius = formationAnchors[i % Math.max(1, formationAnchors.length)]?.radiusHint
        || P.radius * 0.58;
      const settle = smoothstepCPU(formationAmount(phase), 0.12, 0.88);
      dropData[i].set(
        x,
        y,
        z,
        (freeRadius + (targetRadius - freeRadius) * settle) * (1 - fidelityAbsorb),
      );
    } else {
      dropData[i].set(x, y, z, freeRadius);
    }
  }

  // 電影模式的合體狀態是真正的一顆母滴：其餘水滴由零半徑連續長出，而不是讓
  // 多顆完整半徑的 SDF 重疊後再突然解鎖。以 q^3 轉移體積，子滴半徑會隨 q
  // 近似線性增長，同時嚴格維持總體積，輪廓便能自然經過鼓包、細頸、斷裂。
  if (P.motion === 'cinematic' && count > 1) {
    const childVolumeProgress = separation * separation * separation;
    let transferredVolume = 0;
    for (let i = 1; i < count; i++) {
      const targetRadius = dropData[i].w;
      const targetVolume = targetRadius ** 3;
      transferredVolume += targetVolume * (1 - childVolumeProgress);
      dropData[i].w = targetRadius * separation;
    }
    const primaryTargetRadius = dropData[0].w;
    dropData[0].w = Math.cbrt(primaryTargetRadius ** 3 + transferredVolume);
  }

  // 電影敘事期間鎖定主配對，避免多滴的最近距離交替造成形變軸跳動。
  // 其他模式仍使用即時最近配對。
  let pairA = 0, pairB = Math.min(1, count - 1), pairDistance = Infinity, surfaceGap = Infinity;
  if (count >= 2 && P.motion === 'cinematic') {
    const da = dropData[pairA], db = dropData[pairB];
    pairDistance = Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z);
    surfaceGap = pairDistance - da.w - db.w;
  } else {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const di = dropData[i], dj = dropData[j];
        const distance = Math.hypot(di.x - dj.x, di.y - dj.y, di.z - dj.z);
        const gap = distance - di.w - dj.w;
        if (gap < surfaceGap) {
          pairA = i; pairB = j; pairDistance = distance; surfaceGap = gap;
        }
      }
    }
  }

  const frameDt = previousDropT == null || t < previousDropT
    ? 0 : Math.min(0.05, Math.max(0.0001, t - previousDropT));
  const pairKey = `${pairA}:${pairB}`;
  const gapVelocity = frameDt > 0 && pairKey === previousPairKey
    ? (surfaceGap - previousPairGap) / frameDt : 0;
  const contactRange = Math.max(0.12, P.viscosity * 0.55);
  const contactAmount = count >= 2
    ? 1 - smoothstepCPU(surfaceGap, 0.015, contactRange) : 0;
  const drainageHold = contactAmount * merge;
  const separationSpeed = Math.max(0, gapVelocity);
  // 電影模式由體積轉移本身完成分裂／融合，不再額外鎖中心或複製合體半徑。
  // 額外的 fusion lock 正是先縮放、再雙葉化的第二套互相衝突的形變來源。
  const fusionLock = 0;
  const fusionAmount = Math.max(drainageHold, fusionLock);
  let pairAxisX = 1, pairAxisY = 0, pairAxisZ = 0;

  // 非電影模式仍可依實際接觸做黏性融合；電影模式已在上方守恆轉移體積。
  if (P.motion !== 'formation' && P.motion !== 'cinematic' && count >= 2 && fusionAmount > 0) {
    const da = dropData[pairA], db = dropData[pairB];
    const axisX = db.x - da.x, axisY = db.y - da.y, axisZ = db.z - da.z;
    const axisInv = 1 / Math.max(0.0001, Math.hypot(axisX, axisY, axisZ));
    pairAxisX = axisX * axisInv; pairAxisY = axisY * axisInv; pairAxisZ = axisZ * axisInv;
    const midX = (da.x + db.x) * 0.5;
    const midY = (da.y + db.y) * 0.5;
    const midZ = (da.z + db.z) * 0.5;
    da.x += (midX - da.x) * fusionLock; db.x += (midX - db.x) * fusionLock;
    da.y += (midY - da.y) * fusionLock; db.y += (midY - db.y) * fusionLock;
    da.z += (midZ - da.z) * fusionLock; db.z += (midZ - db.z) * fusionLock;
    const radiusA = dropData[pairA].w, radiusB = dropData[pairB].w;
    const mergedRadius = Math.cbrt(radiusA ** 3 + radiusB ** 3);
    dropData[pairA].w += (mergedRadius - radiusA) * fusionAmount;
    dropData[pairB].w += (mergedRadius - radiusB) * fusionAmount;
  }

  // 實際接觸距離修正事件黏性：壓平時增黏，頸部拉伸與快速分離時卸黏。
  if (P.motion === 'cinematic' && count >= 2) {
    viscosityScale = Math.max(0.35,
      1 + cinema.contact * 0.2 - tension * 0.18
      - breakaway * (0.42 + Math.min(0.1, separationSpeed * 0.035)));
    effectiveViscosity = P.viscosity * viscosityScale;
  }
  if (uniforms) uniforms.uViscosity.value = effectiveViscosity;
  if (uniforms) {
    uniforms.uShapeProgress.value = formationShapeProgress;
    uniforms.uFidelityAbsorb.value = fidelityAbsorb;
    // 半徑已連續收至零後才停止 shader 迴圈；切換當下幾何場完全相同。
    const fidelityComplete = fidelityAbsorb > 0.9999;
    uniforms.uCount.value = fidelityComplete ? 0 : count;
    uniforms.uMicroCount.value = fidelityComplete ? 0 : microCount;
    uniforms.uNegativeCount.value = fidelityComplete ? 0 : negativeCount;
    // 完成時保留最多 0.02 的薄層，封住體素化在眼窩等薄區域產生的非原始孔洞；
    // 若使用者明確設為 0 仍尊重原值，不強制膨脹模型。
    const finalSurfaceGuard = Math.min(P.shapeSoftness, 0.02);
    uniforms.uShapeSoftness.value = P.shapeSoftness * (1 - fidelityAbsorb)
      + finalSurfaceGuard * fidelityAbsorb;
    uniforms.uMicroBlend.value = Math.max(
      0.035,
      effectiveViscosity * 0.60 + P.shapeSoftness * 0.35,
    );
  }

  // 每滴以速度決定慣性拉伸；斷裂後的彈性留給位移回彈與局部毛細波。
  // 不再對整顆水滴施加正負長軸振盪，避免兩滴同步橫向縮放再復原。
  for (let i = 0; i < count; i++) {
    const d = dropData[i];
    let vx = 0, vy = 0, vz = 0;
    if (frameDt > 0) {
      const prev = previousDropPositions[i];
      vx = (d.x - prev.x) / frameDt;
      vy = (d.y - prev.y) / frameDt;
      vz = (d.z - prev.z) / frameDt;
    }
    if (P.motion === 'formation') {
      const epsilon = 1 / 2048;
      formationDropPosition(i, fract(phase - epsilon), count, formationPosBefore);
      formationDropPosition(i, fract(phase + epsilon), count, formationPosAfter);
      const invDelta = 1 / (epsilon * 2 * Math.max(0.001, P.loopDuration));
      vx = (formationPosAfter.x - formationPosBefore.x) * invDelta;
      vy = (formationPosAfter.y - formationPosBefore.y) * invDelta;
      vz = (formationPosAfter.z - formationPosBefore.z) * invDelta;
    }
    const speed = Math.hypot(vx, vy, vz);
    let ax = speed > 0.0001 ? vx / speed : 1;
    let ay = speed > 0.0001 ? vy / speed : 0;
    let az = speed > 0.0001 ? vz / speed : 0;
    const sizeResponse = Math.sqrt(Math.max(0.2, d.w) / 0.54);
    const tensionResistance = 0.58 + P.surfaceTension * 0.42;
    let stretch = 1 + Math.min(0.24,
      speed * 0.055 * P.inertiaDeform * sizeResponse / tensionResistance);
    let flatten = 0, shapeOscillation = 0, tip = 0, paired = 0;

    if (P.motion === 'cinematic' && count >= 2 && (i === pairA || i === pairB)) {
      const other = dropData[i === pairA ? pairB : pairA];
      const dx = other.x - d.x, dy = other.y - d.y, dz = other.z - d.z;
      const invDistance = 1 / Math.max(0.0001, Math.hypot(dx, dy, dz));
      const contactAxisX = dx * invDistance;
      const contactAxisY = dy * invDistance;
      const contactAxisZ = dz * invDistance;
      // 完全分離時沿速度方向形變；只有事件或接觸期間才轉向兩滴之間的軸線。
      // 電影模式回彈期把形變軸完全鎖到 contactAxis（法線），確保斷裂尖端嚴格沿法線
      // 回彈、不隨殘餘速度分量抖動；breakaway 為 C1 的 Hann，鎖定權重本身平滑。
      const breakawayLock = P.motion === 'cinematic' ? breakaway : breakaway * 0.85;
      const pairInfluence = Math.min(1,
        Math.max(contactAmount, fusionLock, tension, breakawayLock));
      // 分離時速度軸 ≈ −contactAxis（往外飛，背向另一顆）；直接線性混向法線會在中途
      // 抵消成零向量，使 normalize 病態、尖端指向翻面而抖動。先把速度軸翻到與法線
      // 同半球再混合。尖端(physics.z)只在 +axis 極點，故軸的正負號需與法線一致；
      // 拉伸(longScale)對稱、drift 期無尖端，翻號不影響外觀。
      if (ax * contactAxisX + ay * contactAxisY + az * contactAxisZ < 0) {
        ax = -ax; ay = -ay; az = -az;
      }
      ax += (contactAxisX - ax) * pairInfluence;
      ay += (contactAxisY - ay) * pairInfluence;
      az += (contactAxisZ - az) * pairInfluence;
      const axisLength = Math.max(0.0001, Math.hypot(ax, ay, az));
      ax /= axisLength; ay /= axisLength; az /= axisLength;
      const physicalStretch = stretch
        + tension * (0.12 + P.surfaceTension * 0.05)
        + breakaway * 0.055;
      if (P.motion === 'cinematic') {
        // 電影模式由單一包絡擁有長軸形變；速度只提供少量次級慣性。
        const designedStretch = 1
          + cinema.splitShape * (0.085 + P.surfaceTension * 0.025)
          + cinema.contact * (0.025 + P.surfaceTension * 0.012);
        stretch = designedStretch + (physicalStretch - 1) * 0.22;
      } else {
        stretch = physicalStretch;
      }
      // 壓平只在聚合接觸／排液期發生，不再於分裂與融合兩側各出現一次。
      const drainageTransition = contactAmount * (P.motion === 'cinematic'
        ? cinema.contact
        : Math.sin(Math.PI * merge));
      flatten = drainageTransition * (0.55 + P.surfaceTension * 0.2);
      // 電影模式用平滑解析包絡驅動尖端回彈，與逐幀量測的 separationSpeed 解耦，
      // 避免量測噪聲讓尖頭幅度抖動；非電影模式仍依實際分離速度觸發。
      tip = P.motion === 'cinematic'
        ? breakaway * Math.exp(-4.2 * bounceProgress)
        : breakaway * Math.exp(-4.2 * bounceProgress)
          * smoothstepCPU(separationSpeed, 0.02, 0.35);
      // Q 彈：擾動後整顆果凍震盪，經 physics.y 調變長軸；shader 以
      // transverseScale=1/√longScale 補償橫向 → 體積守恆的 prolate↔oblate 脈動。
      // 振幅用 C1 的事件包絡（breakaway 的 Hann / 融合 settle 的 Hann），兩端斜率為 0，
      // 事件內與循環接縫都無跳變；頻率隨滴徑 √(σ/R³) 提高，小滴抖得快、符合物理。
      if (P.motion === 'cinematic') {
        const jellyFreq = Math.sqrt(0.54 / Math.max(0.2, d.w));
        const wobbleGain = 0.45 + P.elasticStrength * 4.5;
        // 分裂回彈：斷裂後盪約兩下收斂。
        const sepWobble = breakaway
          * Math.sin(2 * Math.PI * (2.3 * jellyFreq) * bounceProgress);
        // 融合著陸：獨立於 coalesce，延伸到 absorb 完成後的 hold 段（0.74→0.98）平復，
        // 於接縫前歸零。
        const settleProg = Math.max(0, Math.min(1, (phase - 0.74) / 0.24));
        const settleEnv = 0.5 * (1 - Math.cos(2 * Math.PI * settleProg));
        const mergeWobble = settleEnv
          * Math.sin(2 * Math.PI * (2.0 * jellyFreq) * settleProg);
        shapeOscillation = Math.max(-1.2, Math.min(1.2,
          (sepWobble + mergeWobble * 1.1) * wobbleGain));
      }
      paired = 1;
      // 鎖定合體後兩個 SDF 使用完全相同的主軸與伸縮，視覺上成為單一液滴。
      ax += (pairAxisX - ax) * fusionLock;
      ay += (pairAxisY - ay) * fusionLock;
      az += (pairAxisZ - az) * fusionLock;
      stretch += (1 - stretch) * fusionLock;
      flatten *= 1 - fusionLock;
    }
    dropShapeData[i].set(ax, ay, az, stretch);
    dropPhysicsData[i].set(flatten, shapeOscillation, tip, paired);
  }
  for (let i = count; i < MAX_DROPS; i++) {
    dropShapeData[i].set(1, 0, 0, 1);
    dropPhysicsData[i].set(0, 0, 0, 0);
  }

  // 以實際 SDF 頸部是否斷裂觸發毛細波，並把活動配對傳給 shader。
  if (P.motion === 'cinematic' && count >= 2) {
    elasticPair.set(pairA, pairB);
    const neckGap = pairDistance - dropData[pairA].w - dropData[pairB].w
      - effectiveViscosity * 0.5;
    const detachGate = smoothstepCPU(neckGap, 0, 0.08);
    const progress = Math.max(0, Math.min(1, (phase - 0.19) / 0.20));
    const pulse = Math.sin(Math.PI * progress);
    const sizeFrequency = Math.sqrt(0.54 / Math.max(0.2,
      (dropData[pairA].w + dropData[pairB].w) * 0.5));
    const detachEnvelope = detachGate * pulse * pulse * P.surfaceTension
      * Math.pow(1 - progress, 0.25 + P.elasticDamping * 1.5);

    // 毛細回彈波只在分裂（pinch-off）發生；融合為平順接合，不再產生回彈漣漪。
    elasticEvent.set(detachEnvelope, Math.min(1, progress * sizeFrequency));
    if (uniforms) {
      uniforms.uElasticStrength.value = P.elasticStrength
        * (0.62 + P.surfaceTension * 0.58) / (1 + P.viscosity * 0.32);
      uniforms.uElasticDamping.value = Math.max(0, Math.min(1,
        P.elasticDamping + P.viscosity * 0.12 - P.surfaceTension * 0.06));
      uniforms.uElasticSpeed.value = P.elasticSpeed
        * (0.74 + P.surfaceTension * 0.3) * sizeFrequency;
    }

    // 衛星滴串：在液橋上形成，pinch-off 後保留為自由滴，最後分批被鄰近主滴吸收。
    // 全程由 phase 的解析軌跡驅動，因此播放、拖動時間與循環接縫都不會累積誤差。
    const da = dropData[pairA], db = dropData[pairB];
    const sdx = db.x - da.x, sdy = db.y - da.y, sdz = db.z - da.z;
    const sInv = 1 / Math.max(0.0001, Math.hypot(sdx, sdy, sdz));
    const ux = sdx * sInv, uy = sdy * sInv, uz = sdz * sInv;
    const mx = (da.x + db.x) * 0.5, my = (da.y + db.y) * 0.5, mz = (da.z + db.z) * 0.5;
    // 建立與收頸軸垂直的穩定基底，供二維低頻漂移使用。
    let qx = -uy, qy = ux, qz = 0;
    const qLen = Math.hypot(qx, qy, qz);
    if (qLen < 0.1) { qx = 0; qy = -uz; qz = uy; }
    else { qx /= qLen; qy /= qLen; qz /= qLen; }
    const rx = uy * qz - uz * qy;
    const ry = uz * qx - ux * qz;
    const rz = ux * qy - uy * qx;
    // 在頸部內快速成形；釋放後半徑鎖定，不再跟著仍在長大的子滴一起膨脹。
    const satBirth = smoothstepCPU(phase, 0.18, 0.205);
    const release = smoothstepCPU(phase, 0.235, 0.285);
    const freeAge = Math.max(0, phase - 0.26);
    if (uniforms) uniforms.uSatelliteBlend.value = 0.32 * satBirth * (1 - release);
    const baseR = Math.min(da.w, db.w);
    const satelliteBaseR = P.radius
      * Math.min(dropSeeds[pairA].radius, dropSeeds[pairB].radius);
    const activeSatelliteCount = Math.max(0, Math.min(SAT_N, Math.round(P.satelliteCount)));
    for (let s = 0; s < SAT_N; s++) {
      if (s >= activeSatelliteCount) {
        satelliteDrops[s].set(0, 0, 0, 0);
        continue;
      }
      const spec = SAT_SPEC[s];
      const along = spec.along * baseR;
      const neckJitter = spec.jitter * baseR * satBirth * (1 - release);

      // 低頻連續 noise-like 軌跡；減去起始相位值，確保釋放瞬間位置不跳動。
      const waveQ = Math.sin(spec.seed + freeAge * 16.0) - Math.sin(spec.seed);
      const waveR = Math.sin(spec.seed * 1.73 + freeAge * 11.0)
        - Math.sin(spec.seed * 1.73);
      const driftScale = baseR * release;
      const freeX = mx + ux * (along + spec.drift * baseR * freeAge * 2.2)
        + qx * (neckJitter + waveQ * driftScale * 0.18)
        + rx * waveR * driftScale * 0.12;
      const freeY = my + uy * (along + spec.drift * baseR * freeAge * 2.2)
        + qy * (neckJitter + waveQ * driftScale * 0.18)
        + ry * waveR * driftScale * 0.12;
      const freeZ = mz + uz * (along + spec.drift * baseR * freeAge * 2.2)
        + qz * (neckJitter + waveQ * driftScale * 0.18)
        + rz * waveR * driftScale * 0.12;

      // 小滴先回收，主衛星最後回收；吸收目標依形成位置選擇較近的主滴。
      const absorb = smoothstepCPU(phase, spec.absorbAt, spec.absorbAt + 0.10);
      const target = spec.along < 0 ? da : db;
      const sizeEnvelope = satBirth * (1 - absorb);
      satelliteDrops[s].set(
        freeX + (target.x - freeX) * absorb,
        freeY + (target.y - freeY) * absorb,
        freeZ + (target.z - freeZ) * absorb,
        satelliteBaseR * spec.size * P.satelliteSize * sizeEnvelope,
      );
    }
  } else {
    elasticEvent.set(0, 0);
    for (let s = 0; s < SAT_N; s++) satelliteDrops[s].w = 0;
    if (uniforms) uniforms.uSatelliteBlend.value = 0;
  }

  for (let i = 0; i < count; i++) previousDropPositions[i].set(dropData[i].x, dropData[i].y, dropData[i].z);
  previousDropT = t;
  previousPairKey = pairKey;
  previousPairGap = surfaceGap;

  // smooth-min 與 wobble 都可能讓表面超出單顆球體，因此加入保守 padding。
  const padding = P.viscosity * 1.15 * 0.25 * Math.max(0, count - 1)
    + P.wobble * 0.25 + P.elasticStrength + 0.08;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = dropData[i], r = d.w * Math.max(1, dropShapeData[i].w) + padding;
    minX = Math.min(minX, d.x - r); maxX = Math.max(maxX, d.x + r);
    minY = Math.min(minY, d.y - r); maxY = Math.max(maxY, d.y + r);
    minZ = Math.min(minZ, d.z - r); maxZ = Math.max(maxZ, d.z + r);
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  let boundRadius = 0;
  for (let i = 0; i < count; i++) {
    const d = dropData[i];
    boundRadius = Math.max(boundRadius, Math.hypot(d.x - cx, d.y - cy, d.z - cz)
      + d.w * Math.max(1, dropShapeData[i].w) + padding);
  }
  for (let s = 0; s < SAT_N; s++) {
    const sd = satelliteDrops[s];
    if (sd.w > 0) {
      boundRadius = Math.max(boundRadius,
        Math.hypot(sd.x - cx, sd.y - cy, sd.z - cz) + sd.w + padding);
    }
  }
  dropBounds.set(cx, cy, cz, boundRadius);
  if (P.motion === 'formation' && shapeField) {
    dropBounds.set(0, 0, 0, Math.max(boundRadius, 2.25));
    for (let i = 0; i < microCount; i++) {
      const o = i * 4;
      dropBounds.w = Math.max(dropBounds.w,
        Math.hypot(microDropData[o], microDropData[o + 1], microDropData[o + 2])
          + microDropData[o + 3] + 0.12);
    }
  }
}

function makeBlankEnv() {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeBlankShape() {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeMicroDropTexture() {
  microDropTexture = new THREE.DataTexture(
    microDropData,
    MAX_MICRO_DROPS,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  microDropTexture.minFilter = microDropTexture.magFilter = THREE.NearestFilter;
  microDropTexture.wrapS = microDropTexture.wrapT = THREE.ClampToEdgeWrapping;
  microDropTexture.generateMipmaps = false;
  microDropTexture.needsUpdate = true;
  microShapeTexture = new THREE.DataTexture(
    microShapeData, MAX_MICRO_DROPS, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  microShapeTexture.minFilter = microShapeTexture.magFilter = THREE.NearestFilter;
  microShapeTexture.needsUpdate = true;
  negativeDropTexture = new THREE.DataTexture(
    negativeDropData, MAX_NEGATIVE_DROPS, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  negativeDropTexture.minFilter = negativeDropTexture.magFilter = THREE.NearestFilter;
  negativeDropTexture.needsUpdate = true;
  return microDropTexture;
}

/* ===== 自訂漸層查找表（LUT）===== */
let rampTex = null;
const RAMP_W = 256;
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function readStops() {
  const n = Math.round(parseFloat(document.getElementById('rampCount').value));
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push({
      p: Math.min(1, Math.max(0, parseFloat(document.getElementById('stopPos' + i).value))),
      rgb: hexToRgb(document.getElementById('stopCol' + i).value),
    });
  }
  return stops;
}
// 循環取樣：色標依位置排序，末色與首色跨接縫接回
function sampleStops(stops, t) {
  const n = stops.length;
  if (n === 1) return stops[0].rgb;
  for (let i = 0; i < n; i++) {
    const a = stops[i], b = stops[(i + 1) % n];
    let p0 = a.p, p1 = b.p, tt = t;
    if (i === n - 1) { p1 += 1; if (t < a.p) tt = t + 1; }   // 接縫段
    if (tt >= p0 && tt <= p1) {
      const f = (p1 > p0) ? (tt - p0) / (p1 - p0) : 0;
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f];
    }
  }
  return stops[0].rgb;
}
function buildRampLUT() {
  if (!rampTex) return;
  const stops = readStops().sort((s1, s2) => s1.p - s2.p);
  const data = rampTex.image.data;
  for (let x = 0; x < RAMP_W; x++) {
    const c = sampleStops(stops, x / RAMP_W);
    data[x * 4] = c[0]; data[x * 4 + 1] = c[1]; data[x * 4 + 2] = c[2]; data[x * 4 + 3] = 255;
  }
  rampTex.needsUpdate = true;
}
function makeRampTexture() {
  rampTex = new THREE.DataTexture(new Uint8Array(RAMP_W * 4), RAMP_W, 1, THREE.RGBAFormat);
  rampTex.colorSpace = THREE.SRGBColorSpace;
  rampTex.wrapS = THREE.RepeatWrapping;
  rampTex.wrapT = THREE.ClampToEdgeWrapping;
  rampTex.minFilter = THREE.LinearFilter;
  rampTex.magFilter = THREE.LinearFilter;
  rampTex.generateMipmaps = false;
  buildRampLUT();
  return rampTex;
}

function initGL() {
  if (inited) return;
  inited = true;

  // 全螢幕 shader 本身沒有多邊形鋸齒，關閉 MSAA 可省下額外 framebuffer 成本。
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(qualityDpr);

  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const fallbackEnvScene = new THREE.Scene();
  fallbackEnvScene.background = new THREE.Color(0x000000);
  pmremTarget = pmremGenerator.fromScene(fallbackEnvScene, 0.04);

  scene = new THREE.Scene();
  camera = new THREE.Camera();

  uniforms = {
    uTime:       { value: 0 },
    uLoopDuration: { value: P.loopDuration },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uRot:        { value: new THREE.Matrix3() },
    uCameraDistance: { value: P.cameraDistance },
    uCompositionOffsetX: { value: 0 },
    uCompositionOffsetY: { value: 0 },
    uMaxSteps:   { value: qualitySteps },
    uCount:      { value: Math.round(P.count) },
    uViscosity:  { value: P.viscosity },
    uWobble:     { value: P.wobble },
    uWobbleScale: { value: P.wobbleScale },
    uWobbleSpeed: { value: P.wobbleSpeed },
    uElasticEvent: { value: elasticEvent },
    uElasticStrength: { value: P.elasticStrength },
    uElasticDensity: { value: P.elasticDensity },
    uElasticDamping: { value: P.elasticDamping },
    uElasticSpeed: { value: P.elasticSpeed },
    uDrops:      { value: dropData },
    uDropShape:  { value: dropShapeData },
    uDropPhysics: { value: dropPhysicsData },
    uElasticPair: { value: elasticPair },
    uSatellites: { value: satelliteDrops },
    uSatelliteBlend: { value: 0 },
    uBounds:     { value: dropBounds },
    uThickness:  { value: P.thickness },
    uThickVar:   { value: P.thickVar },
    uNoiseScale: { value: P.noiseScale },
    uDispersion: { value: P.dispersion },
    uDispersionSeparation: { value: P.dispersionSeparation },
    uCausticScale: { value: P.causticScale },
    uCausticSharpness: { value: P.causticSharpness },
    uRealDispersion: { value: P.realDispersion },
    uRealDispersionSeparation: { value: P.realDispersionSeparation },
    uSpectralCausticIntensity: { value: P.spectralCausticIntensity },
    uSpectralCausticFocus: { value: P.spectralCausticFocus },
    uSpectralCausticWidth: { value: P.spectralCausticWidth },
    uSpectralCausticLightSize: { value: P.spectralCausticLightSize },
    uSpectralCausticDensity: { value: P.spectralCausticDensity },
    uSpectralCausticSoftness: { value: P.spectralCausticSoftness },
    uSpectralCausticWarp: { value: P.spectralCausticWarp },
    uSpectralCausticSeparation: { value: P.spectralCausticSeparation },
    uSpectralCausticBounce: { value: P.spectralCausticBounce },
    uSpectralCausticFlow: { value: P.spectralCausticFlow },
    uSpectralCausticFresnelMask: { value: P.spectralCausticFresnelMask },
    uSpectralCausticNoiseMask: { value: P.spectralCausticNoiseMask },
    uSpectralCausticNoiseScale: { value: P.spectralCausticNoiseScale },
    uSpectralCausticAzimuth: { value: P.spectralCausticAzimuth },
    uSpectralCausticElevation: { value: P.spectralCausticElevation },
    uSpectralCausticHdri: { value: P.spectralCausticHdri },
    uArtThickness: { value: P.artThickness },
    uArtThickVar: { value: P.artThickVar },
    uArtNoiseScale: { value: P.artNoiseScale },
    uArtPatternSpeed: { value: P.artPatternSpeed },
    uArtGravity: { value: P.artGravity },
    uDispersionEnabled: { value: P.dispersionEnabled ? 1 : 0 },
    uRealDispersionEnabled: { value: P.realDispersionEnabled ? 1 : 0 },
    uSpectralCausticEnabled: { value: P.spectralCausticEnabled ? 1 : 0 },
    uFilmEnabled: { value: P.filmEnabled ? 1 : 0 },
    uFilmBlur:   { value: P.filmBlur },
    uSaturation: { value: P.saturation },
    uFresnel:    { value: P.fresnel },
    uGravity:    { value: P.gravity },
    uFlowSpeed:  { value: P.flowSpeed },
    uPatternSpeed: { value: P.patternSpeed },
    uColorMode:  { value: SELECTS.colorMode.map[P.colorMode] },
    uRampTex:    { value: makeRampTexture() },
    uBgMode:     { value: SELECTS.bgMode.map[P.bgMode] },
    uBgColor:    { value: new THREE.Color(P.bgColor) },
    uEnvRefraction: { value: P.envRefraction },
    uReflect:    { value: P.reflect },
    uTransmission: { value: P.transmission },
    uMaterialExposure: { value: P.materialExposure },
    uRoughness:  { value: P.roughness },
    uHdriYaw:    { value: P.hdriYaw },
    uHdriPitch:  { value: P.hdriPitch },
    uHdriBlur:   { value: P.hdriBlur },
    uEnvMap:     { value: makeBlankEnv() },
    uPmremMap:   { value: pmremTarget.texture },
    uHasEnv:     { value: 0 },
    uShapeType: { value: SELECTS.shapeSource.map[P.shapeSource] },
    uShapeProgress: { value: 0 },
    uFidelityAbsorb: { value: 0 },
    uShapeDepth: { value: P.shapeDepth },
    uShapeSoftness: { value: P.shapeSoftness },
    uShapeTex: { value: makeBlankShape() },
    uShapeGrid: { value: 0 },
    uShapeAtlas: { value: new THREE.Vector2(1, 1) },
    uMicroDrops: { value: makeMicroDropTexture() },
    uMicroShape: { value: microShapeTexture },
    uMicroCount: { value: 0 },
    uMicroBlend: { value: 0.02 },
    uNegativeDrops: { value: negativeDropTexture },
    uNegativeCount: { value: 0 },
  };

  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  // 讓 Three.js 依 PMREM atlas 尺寸注入 CubeUV shader 常數。
  mat.envMap = pmremTarget.texture;
  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  updateDropUniforms(0);
  resize();
  window.addEventListener('resize', resize);
  bindPointer();
  syncPanelToUniforms();
  loadDefaultEnvironment();
}

function resize() {
  if (!renderer) return;
  // DevTools 裝置模式有時會保留較大的 layout viewport（window.innerWidth），
  // 但 documentElement client size 才是使用者實際看到的裝置畫面。
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  renderer.setSize(w, h, true);
  uniforms.uResolution.value.set(w, h);
}

function refreshRenderQuality() {
  if (!renderer || !uniforms) return;
  const interactionDpr = dragging ? Math.min(qualityDpr, minRenderDpr) : qualityDpr;
  const interactionSteps = dragging ? Math.min(qualitySteps, 56) : qualitySteps;
  if (Math.abs(renderer.getPixelRatio() - interactionDpr) > 0.01) {
    renderer.setPixelRatio(interactionDpr);
    resize();
  }
  uniforms.uMaxSteps.value = interactionSteps;
}

function sampleRenderQuality(now) {
  if (PREVIEW || !mobileRenderQuery.matches) return;
  qualitySampleFrames++;
  const elapsed = now - qualitySampleStarted;
  if (elapsed < 2000) return;

  const fps = qualitySampleFrames * 1000 / elapsed;
  qualitySampleStarted = now;
  qualitySampleFrames = 0;

  if (fps < 42) {
    qualityLowSamples++;
    qualityHighSamples = 0;
    if (qualityLowSamples >= 2 && (qualityDpr > minRenderDpr || qualitySteps > 56)) {
      qualityDpr = minRenderDpr;
      qualitySteps = 56;
      qualityLowSamples = 0;
      refreshRenderQuality();
    }
  } else if (fps > 55) {
    qualityHighSamples++;
    qualityLowSamples = 0;
    if (qualityHighSamples >= 3 && (qualityDpr < maxRenderDpr || qualitySteps < 64)) {
      qualityDpr = maxRenderDpr;
      qualitySteps = 64;
      qualityHighSamples = 0;
      refreshRenderQuality();
    }
  } else {
    qualityLowSamples = 0;
    qualityHighSamples = 0;
  }
}

/* ===== 拖曳旋轉 ===== */
function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    refreshRenderQuality();
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    rot.y += dx * 0.006; rot.x += dy * 0.006;
    vel.y = dx * 0.006; vel.x = dy * 0.006;
  });
  const end = e => {
    dragging = false;
    refreshRenderQuality();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const el = document.getElementById('cameraDistance');
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const next = Math.min(max, Math.max(min, parseFloat(el.value) + e.deltaY * 0.003));
    el.value = next.toFixed(2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });
}

/* ===== 面板綁定 ===== */
// 若 GL 尚未建立（預覽暫停中），把當前 P 推進 uniforms
function syncPanelToUniforms() {
  if (!uniforms) return;
  for (const key of Object.keys(DEFAULTS)) {
    const u = 'u' + key.charAt(0).toUpperCase() + key.slice(1);
    if (uniforms[u]) uniforms[u].value = (key === 'count') ? Math.round(P[key]) : P[key];
  }
  for (const key of Object.keys(SELECTS)) {
    const u = uniforms[SELECTS[key].uniform];
    if (u) u.value = SELECTS[key].map[P[key]];
  }
  for (const key of Object.keys(TOGGLES)) {
    uniforms[TOGGLES[key]].value = P[key] ? 1 : 0;
  }
  for (const key of Object.keys(COLORS)) uniforms[COLORS[key]].value.set(P[key]);
  document.body.style.background = (P.bgMode === 'hdri') ? '#000' : P.bgColor;
}

function bindControls() {
  // 數值滑桿
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const uName = 'u' + key.charAt(0).toUpperCase() + key.slice(1);
    const update = () => {
      P[key] = parseFloat(el.value);
      if (key === 'count') motionCounts[P.motion] = Math.round(P[key]);
      if (valEl) valEl.textContent = (fmt[key] || (v => +v.toFixed(2)))(P[key]);
      if (uniforms && uniforms[uName]) uniforms[uName].value = (key === 'count') ? Math.round(P[key]) : P[key];
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('input', update); el._bound = true; }
    update();
  }
  // 下拉選單
  for (const key of Object.keys(SELECTS)) {
    const el = document.getElementById(key);
    const { uniform, map } = SELECTS[key];
    const update = () => {
      const previousMotion = P.motion;
      const previousValue = P[key];
      P[key] = el.value;
      if (key === 'motion' && previousMotion !== P.motion) {
        motionCounts[previousMotion] = Math.round(P.count);
        const countEl = document.getElementById('count');
        countEl.value = motionCounts[P.motion];
        countEl.dispatchEvent(new Event('input', { bubbles: true }));
        previousDropT = null;
      }
      if (uniforms && uniforms[uniform]) uniforms[uniform].value = map[el.value];
      updateUIState();
      if (key === 'shapeQuality' && previousValue !== P[key]) {
        scheduleLastGLBRebuild();
      }
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 材質功能開關
  for (const key of Object.keys(TOGGLES)) {
    const el = document.getElementById(key);
    const valEl = document.getElementById(key + '_v');
    const label = el.closest('.toggleRow')?.querySelector('label');
    const update = () => {
      P[key] = el.checked;
      if (valEl) valEl.textContent = P[key] ? '開啟' : '關閉';
      if (uniforms) uniforms[TOGGLES[key]].value = P[key] ? 1 : 0;
      updateUIState();
    };
    el.checked = P[key];
    // 原生 checkbox 為視覺隱藏狀態；將文字標籤正式連到 input，
    // 讓使用者點標籤也能切換，而不必精準命中 34px 的滑軌。
    if (label) label.htmlFor = key;
    const track = el.nextElementSibling;
    if (track && !track._bound) {
      track.addEventListener('click', () => {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      track._bound = true;
    }
    if (!el._bound) { el.addEventListener('change', update); el._bound = true; }
    update();
  }
  // 顏色
  for (const key of Object.keys(COLORS)) {
    const el = document.getElementById(key);
    const uName = COLORS[key];
    const update = () => {
      P[key] = el.value;
      if (uniforms) uniforms[uName].value.set(el.value);
      if (key === 'bgColor') document.body.style.background = (P.bgMode === 'hdri') ? '#000' : el.value;
    };
    el.value = P[key];
    if (!el._bound) { el.addEventListener('input', update); el._bound = true; }
    update();
  }
  bindRamp();
  updateUIState();
}

// 自訂漸層色標：數量 + 每色位置
function updateRampRows() {
  const n = Math.round(parseFloat(document.getElementById('rampCount').value));
  for (let i = 0; i < STOP_MAX; i++) {
    document.getElementById('stopRow' + i).style.display = (i < n) ? 'flex' : 'none';
  }
}
function bindRamp() {
  const rc = document.getElementById('rampCount');
  const rcv = document.getElementById('rampCount_v');
  const onCount = () => { rcv.textContent = Math.round(parseFloat(rc.value)).toFixed(0); updateRampRows(); buildRampLUT(); updateUIState(); };
  if (!rc._bound) { rc.addEventListener('input', onCount); rc._bound = true; }
  onCount();
  for (let i = 0; i < STOP_MAX; i++) {
    const col = document.getElementById('stopCol' + i);
    const pos = document.getElementById('stopPos' + i);
    const pv = document.getElementById('stopPos' + i + '_v');
    const upd = () => { if (pv) pv.textContent = parseFloat(pos.value).toFixed(2); buildRampLUT(); };
    if (!col._bound) { col.addEventListener('input', upd); col._bound = true; }
    if (!pos._bound) { pos.addEventListener('input', upd); pos._bound = true; }
    upd();
  }
}
function resetRamp() {
  document.getElementById('rampCount').value = RAMP_DEFAULT.count;
  for (let i = 0; i < STOP_MAX; i++) {
    document.getElementById('stopCol' + i).value = RAMP_DEFAULT.cols[i];
    document.getElementById('stopPos' + i).value = RAMP_DEFAULT.pos[i];
  }
}

// 依模式反灰不適用的控制項
function updateUIState() {
  const spectral = P.colorMode === 'spectral';
  const rampGroup = document.getElementById('rampGroup');
  const rampDisabled = spectral || !P.filmEnabled;
  rampGroup.classList.toggle('is-disabled', rampDisabled);
  rampGroup.querySelectorAll('input').forEach(el => {
    el.disabled = rampDisabled;
  });
  const colorBackground = P.bgMode === 'color';
  const bgc = document.getElementById('bgColor');
  bgc.disabled = !colorBackground;
  bgc.closest('.row').style.opacity = colorBackground ? 1 : 0.4;
  document.body.style.background = colorBackground ? P.bgColor : '#000';
  const forming = P.motion === 'formation';
  const formationGroup = document.getElementById('formationGroup');
  formationGroup.style.opacity = forming ? 1 : 0.38;
  formationGroup.querySelectorAll('input, select, button').forEach(el => { el.disabled = !forming; });
  const isSvg = P.shapeSource === 'svg';
  const shapeBtn = document.getElementById('shapeBtn');
  const shapeInput = document.getElementById('shapeInput');
  shapeBtn.textContent = isSvg ? '選擇 SVG…' : '選擇 GLB / GLTF…';
  shapeInput.accept = isSvg ? '.svg,image/svg+xml' : '.glb,.gltf,model/gltf-binary,model/gltf+json';
  const qualityRow = document.getElementById('shapeQualityRow');
  const qualitySelect = document.getElementById('shapeQuality');
  qualitySelect.disabled = !forming || isSvg;
  qualityRow.style.opacity = isSvg ? 0.4 : 1;
  const depthControl = document.getElementById('shapeDepth');
  depthControl.disabled = !forming || !isSvg;
  depthControl.closest('.row').style.opacity = isSvg ? 1 : 0.4;
}

document.getElementById('resetBtn').addEventListener('click', () => {
  Object.assign(P, DEFAULTS, SELECT_DEFAULTS, TOGGLE_DEFAULTS, COLOR_DEFAULTS);
  motionCounts.cinematic = DEFAULTS.count;
  motionCounts.formation = FORMATION_DEFAULT_COUNT;
  resetRamp();
  bindControls();
  if (inited) loadDefaultEnvironment();
});

/* ===== HDRI 載入（動態 import，離線也不會弄壞主程式）===== */
let RGBELoaderClass = null;
async function ensureRGBE() {
  if (!RGBELoaderClass) {
    const m = await import('three/addons/loaders/RGBELoader.js');
    RGBELoaderClass = m.RGBELoader;
  }
  return RGBELoaderClass;
}
const hdriInput = document.getElementById('hdriInput');
const hdriState = document.getElementById('hdriState');
let environmentRequestId = 0;

function applyEnvironmentTexture(tex, label, requestId) {
  if (requestId !== environmentRequestId) {
    tex.dispose();
    return;
  }
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const nextPmremTarget = pmremGenerator.fromEquirectangular(tex);
  const oldEnv = uniforms.uEnvMap.value;
  const oldPmremTarget = pmremTarget;

  uniforms.uEnvMap.value = tex;
  uniforms.uPmremMap.value = nextPmremTarget.texture;
  uniforms.uHasEnv.value = 1;
  pmremTarget = nextPmremTarget;
  mesh.material.envMap = nextPmremTarget.texture;
  mesh.material.needsUpdate = true;

  if (oldEnv && oldEnv.dispose) oldEnv.dispose();
  if (oldPmremTarget) oldPmremTarget.dispose();
  hdriState.textContent = 'HDRI 已載入：' + label;
}

function loadEnvironment(url, label, isHDR, revokeURL = false) {
  const requestId = ++environmentRequestId;
  hdriState.textContent = 'HDRI 載入中：' + label;
  const finish = () => { if (revokeURL) URL.revokeObjectURL(url); };
  const apply = tex => {
    try { applyEnvironmentTexture(tex, label, requestId); }
    catch (_) {
      if (requestId === environmentRequestId) hdriState.textContent = 'HDRI 載入失敗：' + label;
      if (tex && tex.dispose) tex.dispose();
    }
    finish();
  };
  const fail = () => {
    if (requestId === environmentRequestId) hdriState.textContent = 'HDRI 載入失敗：' + label;
    finish();
  };

  if (isHDR) {
    ensureRGBE()
      .then(RGBE => new RGBE().load(url, apply, undefined, fail))
      .catch(fail);
  } else {
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      apply(tex);
    }, undefined, fail);
  }
}

function loadDefaultEnvironment() {
  loadEnvironment(DEFAULT_HDRI_URL, DEFAULT_HDRI_LABEL, true);
}

document.getElementById('hdriBtn').addEventListener('click', () => hdriInput.click());
hdriInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!inited) initGL();
  const url = URL.createObjectURL(file);
  loadEnvironment(url, file.name, /\.hdr$/i.test(file.name), true);
  e.target.value = '';
});

/* ===== SVG / GLB 形狀距離場 ===== */
const shapeInput = document.getElementById('shapeInput');
const shapeState = document.getElementById('shapeState');
let shapeConverting = false;
let lastGLBFile = null;
let shapeImportRequestId = 0;
let shapeRebuildTimer = 0;
document.getElementById('shapeBtn').addEventListener('click', () => shapeInput.click());

function scheduleLastGLBRebuild() {
  if (!lastGLBFile || P.shapeSource !== 'gltf') return;
  clearTimeout(shapeRebuildTimer);
  // 立刻使正在進行的舊品質結果失效；短暫 debounce 避免快速連切時重複開工。
  shapeImportRequestId++;
  const grid = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  const qualityLabel = document.querySelector('#shapeQuality option:checked')?.textContent
    || `${grid}³`;
  shapeState.textContent = `品質已切換，準備重新生成 ${qualityLabel}…`;
  shapeRebuildTimer = window.setTimeout(() => {
    importShapeFile(lastGLBFile, 'gltf', true);
  }, 160);
}

async function importShapeFile(file, kind, rebuilding = false) {
  if (!inited) initGL();
  const requestId = ++shapeImportRequestId;
  const glbGridSize = SELECTS.shapeQuality.map[P.shapeQuality] || 80;
  shapeState.textContent = kind === 'svg'
    ? `正在分析 SVG：${file.name}`
    : rebuilding
      ? `正在重新生成：${file.name} → ${glbGridSize}³（可能需要幾秒）`
      : `正在體素化模型：${file.name} → ${glbGridSize}³（可能需要幾秒）`;
  document.getElementById('shapeBtn').disabled = true;
  document.getElementById('shapeQuality').disabled = true;
  shapeConverting = true;
  syncLoop();
  try {
    const next = kind === 'svg'
      ? await svgToField(file)
      : await gltfToField(file, glbGridSize);
    if (requestId !== shapeImportRequestId) {
      next.texture?.dispose();
      return;
    }
    const old = shapeField?.texture;
    shapeField = next;
    shapeTargets = next.targets;
    formationAnchors = distributePrimaryAnchors(shapeTargets);
    microFormationAnchors = distributeDetailedAnchors(shapeTargets, MAX_MICRO_DROPS);
    negativeFormationAnchors = distributeFormationAnchors(
      next.cavityTargets || [],
      MAX_NEGATIVE_DROPS,
    );
    uniforms.uShapeTex.value = next.texture;
    uniforms.uShapeGrid.value = next.grid;
    uniforms.uShapeAtlas.value.copy(next.atlas);
    uniforms.uShapeType.value = kind === 'svg' ? 1 : 2;
    if (old) old.dispose();
    document.getElementById('motion').value = 'formation';
    document.getElementById('motion').dispatchEvent(new Event('change', { bubbles: true }));
    simT = 0;
    const topologyNote = kind === 'gltf' && next.oddScanlines > 0
      ? `；已修復 ${next.oddScanlines} 條非封閉掃描線`
      : '';
    const qualityNote = kind === 'gltf' ? `；${glbGridSize}³` : '';
    shapeState.textContent = `${kind === 'svg' ? 'SVG' : '3D 模型'} 已就緒：${file.name}${qualityNote}${topologyNote}`;
  } catch (error) {
    if (requestId !== shapeImportRequestId) return;
    console.error(error);
    shapeState.textContent = `轉換失敗：${error.message || '檔案格式不支援'}`;
  } finally {
    if (requestId === shapeImportRequestId) {
      shapeConverting = false;
      updateUIState();
      syncLoop();
    }
  }
}

shapeInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const kind = P.shapeSource;
  if (kind === 'gltf') lastGLBFile = file;
  importShapeFile(file, kind);
  e.target.value = '';
});

/* ===== 播放/暫停：面板按鈕、postMessage、分頁隱藏三者共同決定 ===== */
let userPaused = false, extPaused = PREVIEW;
let rafId = 0, last = 0;
const pauseBtn = document.getElementById('playCtl');
function isPaused() { return userPaused || extPaused || shapeConverting || document.hidden; }
function syncLoop() {
  if (isPaused()) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  } else {
    if (!inited) initGL();
    if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(frame); }
  }
}
pauseBtn.addEventListener('click', () => {
  userPaused = !userPaused;
  pauseBtn.textContent = userPaused ? '▶ 播放' : '⏸ 暫停';
  syncLoop();
});
window.addEventListener('message', e => {
  if (e.data === 'vfx-pause') { extPaused = true; syncLoop(); }
  else if (e.data === 'vfx-play') { extPaused = false; syncLoop(); }
});
document.addEventListener('visibilitychange', syncLoop);

/* ===== 面板開合 ===== */
const panel = document.getElementById('panel');
document.getElementById('toggleBtn').addEventListener('click', () => panel.classList.toggle('collapsed'));

/* ===== 主迴圈 ===== */
let simT = 0;
function frame(now) {
  rafId = requestAnimationFrame(frame);
  sampleRenderQuality(now);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  simT = (simT + dt) % Math.max(0.001, P.loopDuration);
  updateDropUniforms(simT);

  if (!dragging) {
    vel.x *= 0.94; vel.y *= 0.94;
    rot.x += vel.x; rot.y += vel.y;
  }
  rot.x = Math.max(-1.2, Math.min(1.2, rot.x));

  const phase01 = simT / Math.max(0.001, P.loopDuration);
  const loopAngle = phase01 * Math.PI * 2;
  // 緩慢的弧線環繞 + 極輕的抬降，像手持/推軌的呼吸感，而非對稱來回。
  const autoYaw = (Math.sin(loopAngle) * 0.85 + Math.sin(loopAngle * 2 + 0.6) * 0.15) * P.spin * 0.6;
  const autoPitch = Math.sin(loopAngle + 1.1) * P.spin * 0.14;
  // 穩定英雄鏡：保留極輕的靜態荷蘭角增添張力，但移除擺動以維持畫面穩定。
  const roll = -0.03;
  // 推軌：在動作高潮（分裂 ~0.24、融合 ~0.80）輕微推近，漂浮段拉回，鏡頭隨敘事呼吸。
  const dolly = 1
    - 0.05 * Math.exp(-Math.pow((phase01 - 0.80) / 0.10, 2))
    - 0.03 * Math.exp(-Math.pow((phase01 - 0.24) / 0.08, 2));
  // 直向螢幕的水平視野遠窄於桌面；依 aspect 拉遠，避免分裂後的大滴出框。
  // Bottom Sheet 展開時再把構圖上提，讓調參數時仍看得到結果。
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const aspect = viewportWidth / Math.max(1, viewportHeight);
  const isMobilePortrait = viewportWidth <= 760 && aspect < 0.8;
  let compositionDistance = isMobilePortrait
    ? Math.min(1.72, Math.max(1.15, 0.8 / aspect))
    : 1;
  let compositionOffsetY = isMobilePortrait ? -0.08 : 0;
  const sheetState = document.body.dataset.mobileSheet;
  if (isMobilePortrait && sheetState === 'half') {
    compositionDistance *= 1.12;
    compositionOffsetY = -0.32;
  } else if (isMobilePortrait && sheetState === 'full') {
    compositionDistance *= 1.2;
    compositionOffsetY = -0.48;
  }
  // 手機採較正面的英雄鏡，避免桌面的斜角透視讓右滴顯得特別巨大、整組視覺偏右。
  const mobileYawCorrection = isMobilePortrait ? -0.42 : 0;
  rotM4.makeRotationY(rot.y + autoYaw + mobileYawCorrection);
  tmpX.makeRotationX(rot.x + autoPitch);
  rotM4.multiply(tmpX);
  tmpZ.makeRotationZ(roll);
  rotM4.multiply(tmpZ);
  uniforms.uRot.value.setFromMatrix4(rotM4);

  // 匯聚完成時讓鏡頭跟著液滴群緩慢推近。模型距離場本身比自由漂浮軌道緊湊，
  // 若維持同一鏡距，外圍小滴剛收回時主體會顯得突然縮小。
  const frameGatherEnd = Math.max(0.15, P.gatherDuration);
  const frameHoldEnd = Math.min(0.94, frameGatherEnd + P.shapeHold);
  const formationFocus = P.motion === 'formation' && shapeField
    ? phase01 > frameHoldEnd
      ? formationFidelityAmount(phase01)
      : smoothstepCPU(formationAmount(phase01), 0.42, 0.92)
    : 0;
  const formationDolly = 1 - formationFocus * 0.30;
  const cameraDistance = P.cameraDistance * dolly * compositionDistance * formationDolly;
  if (isMobilePortrait) {
    // 以主要水滴投影外輪廓的中點校正構圖。面積重心會被較大的水滴拉動，
    // 在展開狀態下反而讓整組水滴的左右留白不對稱。
    const e = rotM4.elements;
    const count = Math.max(1, Math.min(MAX_DROPS, Math.round(P.count)));
    let minProjectedX = Infinity, maxProjectedX = -Infinity;
    for (let i = 0; i < count; i++) {
      const d = dropData[i];
      if (d.w <= 0.0001) continue;
      const localX = e[0] * d.x + e[1] * d.y + e[2] * d.z;
      const localZ = e[8] * d.x + e[9] * d.y + e[10] * d.z;
      const depth = Math.max(0.25, cameraDistance - localZ);
      const projectionScale = depth * 0.42;
      const projectedX = localX / projectionScale;
      const projectedRadius = d.w * Math.max(1, dropShapeData[i].w) / projectionScale;
      minProjectedX = Math.min(minProjectedX, projectedX - projectedRadius);
      maxProjectedX = Math.max(maxProjectedX, projectedX + projectedRadius);
    }
    const hasProjectedBounds = Number.isFinite(minProjectedX) && Number.isFinite(maxProjectedX);
    const targetOffsetX = hasProjectedBounds
      ? Math.max(-0.16, Math.min(0.16, (minProjectedX + maxProjectedX) * 0.5))
      : 0;
    compositionOffsetX += (targetOffsetX - compositionOffsetX) * Math.min(1, dt * 5);
  } else {
    compositionOffsetX = 0;
  }
  uniforms.uCameraDistance.value = cameraDistance;
  uniforms.uCompositionOffsetX.value = compositionOffsetX;
  uniforms.uCompositionOffsetY.value = compositionOffsetY;
  uniforms.uTime.value = simT;
  // 多水滴 + 形狀場會增加每一步的取樣成本；64 步仍足以覆蓋保守包圍球，
  // 並避免高 DPR 桌面在 Formation 模式失去即時預覽能力。
  uniforms.uMaxSteps.value = P.motion === 'formation'
    ? Math.min(qualitySteps, 60)
    : (dragging ? Math.min(qualitySteps, 56) : qualitySteps);
  renderer.render(scene, camera);
}

bindControls();
syncLoop();
if (!PREVIEW) syncLoop();
