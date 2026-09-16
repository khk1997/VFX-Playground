import { EDGE_TINT_TARGETS, EDGE_TINT_STOPS } from './edge-tint.js?v=dark-tint-1';
import { MOTION_UNIFORM_MAP } from './motions/registry.js?v=edge-tint-1';

// select 字串 → int uniform
export const SELECTS = {
  bgMode:    { uniform: 'uBgMode',    map: { color: 0, hdri: 1 } },
  // 這份淺底參數是在既有通用玻璃路徑上調成，因此兩種底色都使用同一 shader 路徑。
  backdrop:  { uniform: 'uLightBackdrop', map: { dark: 0, light: 0 } },
  materialStyle: { uniform: 'uMaterialStyle', map: { universal: 2 } },
  colorMode: { uniform: 'uColorMode', map: { spectral: 0, ramp: 1 } },
  rayBeamPattern: {
    uniform: 'uRayBeamPattern',
    map: { grid: 0, starburst: 1, ring: 2, softbox: 3, window: 4 },
  },
  spectralCausticMapping: {
    uniform: 'uSpectralCausticMapping',
    map: { wave: 0, objectNoise: 1, hybrid: 2, filmNoise: 3 },
  },
  motion:    { uniform: 'uMotion',    map: MOTION_UNIFORM_MAP },
  shapeSource: { uniform: 'uShapeType', map: { svg: 1, gltf: 2 } },
  // 僅控制下一次 GLB 烘焙尺寸，沒有對應 shader uniform。
  shapeQuality: { uniform: '', map: { performance: 48, balanced: 80, high: 128 } },
  // 超取樣倍率，沒有對應 shader uniform——直接乘進 renderer 的 pixel ratio
  // （見 applyAntialiasLevel）。medium=×1 是原本寫死的行為。
  antialiasLevel: { uniform: '', map: { low: 0.75, medium: 1, high: 1.5, ultra: 2 } },
  // 果凍底下的兩條分支。同樣沒有 shader uniform——差別純粹在 CPU 這邊走哪一條
  // 變換（見 updateDropUniforms 的 jelly 分支）。
  //
  // 之所以要分成兩種而不是「起跳高度調 0 就等於原地果凍」：兩者搶的是同一份
  // 造型變換，混在一起時參數會互相蓋掉——戳擊節奏由落地時機決定，「戳擊次數」
  // 就變成一條調了沒反應的死滑桿；而落地衝擊必須先壓扁、原地戳擊卻是先鼓起，
  // 同一組波形沒辦法同時是兩種極性。分支之後各自的參數才都是有效的。
  jellyStyle: { uniform: '', map: { poke: 0, bounce: 1 } },
  // 色調映射同樣沒有 uniform：它是後處理合成 pass 每幀直接讀的（見
  // renderComposite）。預設「無」＝只交給輸出格式夾掉，等於沒有這一段。
  postToneMap: { uniform: '', map: {
    none: 0, reinhard: 1, aces: 2, agx: 3, khronosNeutral: 4, filmic: 5,
  } },
};
export const COLORS = {
  ...Object.fromEntries(EDGE_TINT_TARGETS.flatMap(prefix =>
    EDGE_TINT_STOPS.map((_, i) => [`${prefix}TintStopColor${i}`, '']))),
  bgColor: 'uBgColor',
  absorbColor: 'uAbsorbColor',
  lightIconColor: 'uLightIconColor',
  lightIconRimColor: 'uLightIconRimColor',
  lightBgGradientTop: 'uLightBgGradientTop',
  lightBgGradientBottom: 'uLightBgGradientBottom',
  researchIconTintColor: 'uResearchIconTintColor',
  researchShellTintColor: 'uResearchShellTintColor',
  // 後處理的顏色不對應 uniform（它們是 post.js 每幀讀的），uniform 名稱留空，
  // 由下面兩處的特例分支處理。
  bloomTint: '',
  membraneBaseColor: 'uMembraneBaseColor',
  membraneVeilColor: 'uMembraneVeilColor',
  membraneReflectionColor: 'uMembraneReflectionColor',
  membraneCardColor: 'uMembraneCardColor',
  membraneShadeColor: 'uMembraneShadeColor',
};
// 值為 uniform 名稱（直接寫 0/1），或一個套用函式 —— 輪廓液滴的開關不是
// 布林 uniform，而是把 uEdgeDropCount 歸零，這樣關閉液滴時仍保留邊緣圓角
// （圓角半徑由獨立的 uShapeEdgeBevel 控制，見 svgShapeDistance 的 smin 半徑）。
export function createToggleBindings(applyEdgeDropDistribution) {
  return {
  ...Object.fromEntries(EDGE_TINT_TARGETS.map(prefix =>
    [`${prefix}MultiTint`, `u${prefix[0].toUpperCase()}${prefix.slice(1)}MultiTint`])),
  filmEnabled: 'uFilmEnabled',
  dispersionEnabled: 'uDispersionEnabled',
  rayDispersionEnabled: 'uRayDispersionEnabled',
  spectralCausticEnabled: 'uSpectralCausticEnabled',
  spectralCausticIconAffect: 'uSpectralCausticIconAffect',
  edgeDropsEnabled: () => applyEdgeDropDistribution(),
  // 沒有對應 uniform：dolly 是 CPU 端算好直接寫進 uCameraDistance 的純量，
  // render loop 每幀直接讀 P.dollyEnabled，這裡不用同步任何東西。
  dollyEnabled: () => {},
  // 同理：這顆開關只被 shapeRigidMotion 每幀直接讀，不對應任何 uniform。
  shapeMotionOn: () => {},
  // 成型波前也一樣：uFormationCut 是每幀跟著波前位置一起送的（見
  // updateDropUniforms），不是這裡寫一次就固定的布林 uniform——關掉的當下還要
  // 把 uShapeCut 那組還原成其他模式看得懂的值。
  formationFrontOn: () => {},
  // Bloom 不對應任何 uniform：它是 renderComposite 每幀直接讀的旗標。
  bloomEnabled: () => {},
  streaksEnabled: () => {},
  // 私語模式的內部氣泡。shader 端只讀這一顆 uniform 決定畫不畫（見
  // researchBubbleMap），折射率與 icon 共用，不需要別的同步。
  researchBubbles: 'uResearchBubbles',
};
}



export function createFormatters(P, { effectiveCapillaryHeight, shatterSegmentSeconds }) {
  return {
  typeDepth: v => v.toFixed(3),
  typeBevel: v => v.toFixed(3),
  typeSoftness: v => (v <= 0 ? '關閉' : v.toFixed(3)),
  thickness: v => v.toFixed(0) + 'nm',
  thickVar: v => '±' + v.toFixed(0),
  noiseScale: v => 'x' + v.toFixed(1),
  count: v => v.toFixed(0),
  radius: v => v.toFixed(2),
  viscosity: v => v.toFixed(2),
  spread: v => v.toFixed(2),
  spin: v => 'x' + v.toFixed(2),
  wobble: v => v.toFixed(3),
  wobbleScale: v => 'x' + v.toFixed(1),
  wobbleSpeed: v => 'x' + v.toFixed(2),
  capillaryHeight: v => {
    const effective = effectiveCapillaryHeight(v, P.capillaryRings);
    return effective < v - 0.005
      ? `${v.toFixed(2)}→${effective.toFixed(2)}`
      : v.toFixed(2);
  },
  capillarySpeed: v => v === 0
    ? '靜止'
    : `${v < 0 ? '反向' : '正向'}×${Math.abs(v).toFixed(0)}`,
  capillaryDirectionX: v => v.toFixed(2),
  capillaryDirectionY: v => v.toFixed(2),
  capillaryDirectionZ: v => v.toFixed(2),
  researchTextureDirX: v => v.toFixed(2),
  researchTextureDirY: v => v.toFixed(2),
  researchTextureDirZ: v => v.toFixed(2),
  postExposure: v => '×' + v.toFixed(2),
  highlightGain: v => '×' + v.toFixed(1),
  postAberration: v => (v <= 0 ? '關閉' : v.toFixed(2)),
  postContrast: v => '×' + v.toFixed(2),
  postBrightness: v => (v === 0 ? '0' : (v > 0 ? '+' : '') + v.toFixed(2)),
  postGrain: v => (v <= 0 ? '關閉' : v.toFixed(3)),
  postGrainScale: v => v.toFixed(1) + 'px',
  streakCount: v => v.toFixed(0),
  streakAngle: v => v.toFixed(0) + '°',
  streakLength: v => v.toFixed(2),
  streakChroma: v => v.toFixed(2),
  streakIntensity: v => '×' + v.toFixed(2),
  bloomThreshold: v => v.toFixed(2),
  bloomKnee: v => v.toFixed(2),
  bloomClamp: v => v.toFixed(1),
  bloomIntensity: v => '×' + v.toFixed(2),
  bloomRadius: v => v.toFixed(2),
  researchBubbleCount: v => v.toFixed(0),
  researchBubbleMin: v => v.toFixed(3),
  researchBubbleMax: v => v.toFixed(3),
  researchCompanionSize: v => 'x' + v.toFixed(2),
  researchCompanionExposure: v => Math.round(v * 100) + '%',
  researchCompanionDepth: v => Math.round(v * 100) + '%',
  researchCompanionHold: v => Math.round(v * 100) + '%',
  researchCompanionPathAngle: v => v.toFixed(0) + '°',
  researchCompanionOrbit: v => v.toFixed(0) + '°',
  researchCompanionDepthOrbit: v => v.toFixed(0) + '°',
  researchCompanionFusion: v => Math.round(v * 100) + '%',
  researchIconPhaseOffset: v => Math.abs(v) < 0.005
    ? '同步'
    : `${v < 0 ? '提前' : '延後'} ${(Math.abs(v) * P.loopDuration).toFixed(2)}s`,
  researchIconBirthStagger: v => (v * P.loopDuration).toFixed(2) + 's',
  capillaryCrestSoftness: v => Math.round(v * 100) + '%',
  capillaryWarp: v => Math.round(v * 100) + '%',
  patternSpeed: v => 'x' + v.toFixed(2),
  dispersion: v => Math.round(v * 100) + '%',
  dispersionSeparation: v => 'x' + v.toFixed(2),
  causticScale: v => 'x' + v.toFixed(2),
  causticSharpness: v => Math.round(v * 100) + '%',
  rayBeamIntensity: v => v === 0 ? '關閉' : 'x' + v.toFixed(2),
  rayBeamSeparation: v => v === 0 ? '無色散' : v.toFixed(3),
  rayBeamZoom: v => 'x' + v.toFixed(2),
  rayBeamRings: v => v.toFixed(1),
  rayBeamSpeed: v => {
    const n = Math.round(v);
    if (n === 0) return '靜止不動';
    // 讀數換算成「幾秒滑過一格」，比「幾格/循環」直觀得多 —— 這才是眼睛看到的
    // 速度。循環秒數一變也要重算，所以列進 LOOP_SCALED_KEYS。
    return (P.loopDuration / Math.abs(n)).toFixed(1) + 's/格' + (n < 0 ? '（反向）' : '');
  },
  rayBeamGlow: v => Math.round(v * 100) + '%',
  rayBeamChroma: v => v === 0 ? '去彩' : 'x' + v.toFixed(2),
  rayBeamAzimuth: v => v.toFixed(0) + '°',
  rayBeamElevation: v => v.toFixed(0) + '°',
  rayBeamRefract: v => v === 0 ? '不折射' : Math.round(v * 100) + '%',
  rayBeamFresnelMask: v => v === 0 ? '不限制' : Math.round(v * 100) + '%',
  rayBeamNoiseMask: v => v === 0 ? '不限制' : Math.round(v * 100) + '%',
  rayBeamNoiseScale: v => 'x' + v.toFixed(1),
  spectralCausticIntensity: v => Math.round(v * 100) + '%',
  spectralCausticFocus: v => Math.round(v * 100) + '%',
  spectralCausticWidth: v => 'x' + v.toFixed(2),
  spectralCausticLightSize: v => Math.round(v * 100) + '%',
  spectralCausticDensity: v => Math.round(v * 100) + '%',
  spectralCausticSoftness: v => Math.round(v * 100) + '%',
  spectralCausticFilmSoften: v => v === 0 ? '不柔化' : Math.round(v * 100) + '%',
  spectralCausticWarp: v => Math.round(v * 100) + '%',
  spectralCausticSeparation: v => 'x' + v.toFixed(2),
  spectralCausticBlend: v => v === 0 ? '不融合' : Math.round(v * 100) + '%',
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
  absorb: v => '×' + v.toFixed(2),
  materialExposure: v => 'x' + v.toFixed(2),
  membraneDepth: v => Math.round(v * 100) + '%',
  ior: v => v.toFixed(2),
  hdriYaw: v => v.toFixed(0) + '°',
  hdriPitch: v => v.toFixed(0) + '°',
  hdriBlur: v => Math.round(v * 100) + '%',
  envRefraction: v => Math.round(v * 100) + '%',
  cameraDistance: v => v.toFixed(2),
  cameraRotationX: v => v.toFixed(1) + '°',
  cameraRotationY: v => v.toFixed(1) + '°',
  loopDuration: v => v.toFixed(1) + 's',
  // 顯示成秒數而不是循環比例：匯集時間／完成停留描述的是「這段實際花多久」，
  // 但循環秒數是另一個獨立滑桿，同樣的百分比在 6 秒與 30 秒的循環裡代表天差
  // 地遠的時間長度。換算成秒數後兩個滑桿放在一起看才有直覺意義。
  gatherDuration: v => (v * P.loopDuration).toFixed(1) + 's',
  shapeDepth: v => v.toFixed(2),
  shapeSoftness: v => v.toFixed(3),
  shapeSoftnessB: v => v.toFixed(3),
  shapeEdgeBevel: v => v.toFixed(3),
  shapeLiquid: v => Math.round(v * 100) + '%',
  shapeLiquidPosition: v => `分佈 ${Math.round(v) + 1}`,
  shapeLiquidSize: v => 'x' + v.toFixed(2),
  shapeLiquidSpeed: v => v === 0 ? '停止' : 'x' + v.toFixed(0),
  shapeHold: v => (v * P.loopDuration).toFixed(1) + 's',
  microCount: v => v.toFixed(0),
  holdBreath: v => v === 0 ? '凍結' : '±' + Math.round(v * 100) + '%',
  formationVariety: v => v === 0 ? '整齊同向' : Math.round(v * 100) + '%',
  formationJitter: v => v === 0 ? '同步匯聚' : Math.round(v * 100) + '%',
  formationSwell: v => v === 0 ? '無膨脹' : '±' + Math.round(v * 100) + '%',
  formationArc: v => v === 0 ? '直線' : v.toFixed(2),
  formationStagger: v => v === 0 ? '同時抵達' : Math.round(v * 100) + '%',
  formationFront: v => ['平面掃描', '從中心放射', '螺旋'][Math.round(v)] || '平面掃描',
  formationSpiral: v => v.toFixed(2),
  formationWaveAngle: v => v.toFixed(0) + '°',
  formationNoise: v => v === 0 ? '關閉' : v.toFixed(2),
  formationNoiseScale: v => 'x' + v.toFixed(1),
  formationCell: v => v === 0 ? '關閉' : v.toFixed(2),
  formationCellScale: v => 'x' + v.toFixed(1),
  formationNeck: v => v === 0 ? '關閉' : v.toFixed(3),
  formationNeckWidth: v => v.toFixed(2),
  formationCutBlend: v => v === 0 ? '刀切' : v.toFixed(3),
  weaveSizeMin: v => 'x' + v.toFixed(2),
  weaveSizeMax: v => 'x' + v.toFixed(2),
  weaveDriftAmount: v => 'x' + v.toFixed(2),
  weaveDriftSpeed: v => 'x' + v.toFixed(0),
  weaveOrbit: v => v === 0 ? '原地飄浮' : Math.round(v * 100) + '%',
  weaveVariety: v => v === 0 ? '整齊同向' : Math.round(v * 100) + '%',
  weaveCling: v => v === 0 ? '完全不沾' : Math.round(v * 100) + '%',
  morphHold: v => (v * P.loopDuration).toFixed(1) + 's',
  morphStagger: v => v === 0 ? '全體同時' : Math.round(v * 100) + '%',
  morphWaveAngle: v => v.toFixed(0) + '°',
  morphArc: v => v === 0 ? '直線' : v.toFixed(2),
  morphSwell: v => v === 0 ? '基準' : '+' + Math.round(v * 100) + '%',
  morphCutBlend: v => v === 0 ? '刀切' : v.toFixed(3),
  morphFront: v => ['平面掃描', '從中心放射', '螺旋'][Math.round(v)] || '平面掃描',
  morphSpiral: v => v.toFixed(2),
  morphNoise: v => v === 0 ? '關閉' : v.toFixed(3),
  morphNoiseScale: v => 'x' + v.toFixed(1),
  morphCell: v => v === 0 ? '關閉' : v.toFixed(3),
  morphCellScale: v => 'x' + v.toFixed(1),
  morphNeck: v => v === 0 ? '不收頸' : v.toFixed(3),
  morphNeckWidth: v => v.toFixed(2),
  meltRate: v => v.toFixed(0) + ' 滴/循環',
  meltRateVary: v => v === 0 ? '整齊同步' : '±' + Math.round(v * 100) + '%',
  meltHang: v => Math.round(v * 100) + '%',
  meltSag: v => v.toFixed(3),
  meltFall: v => v.toFixed(2),
  meltShrink: v => Math.round(v * 100) + '%',
  meltSizeMin: v => 'x' + v.toFixed(2),
  meltSizeMax: v => 'x' + v.toFixed(2),
  meltJitter: v => v === 0 ? '關閉' : v.toFixed(3),
  meltBand: v => Math.round(v * 100) + '%',
  meltSeed: v => '#' + v.toFixed(0),
  meltStretch: v => v === 0 ? '正圓球' : '+' + Math.round(v * 100) + '%',
  meltNeck: v => v === 0 ? '無頸' : Math.round(v * 100) + '%',
  meltWobble: v => v === 0 ? '不彈動' : Math.round(v * 100) + '%',
  shatterRange: v => 'x' + v.toFixed(2),
  shatterDecel: v => v === 0 ? '等速' : Math.round(v * 100) + '%',
  shatterSpeedVary: v => '±' + Math.round(v * 100) + '%',
  shatterGravity: v => v === 0 ? '關閉' : 'x' + v.toFixed(2),
  shatterFade: v => Math.round(v * 100) + '%',
  shatterRest: () => shatterSegmentSeconds('rest'),
  shatterFlight: () => shatterSegmentSeconds('flight'),
  shatterReform: () => shatterSegmentSeconds('reform'),
  shatterSeed: v => '#' + v.toFixed(0),
  shatterCut: v => v === 0 ? '預設' : '#' + v.toFixed(0),
  shatterVariety: v => '±' + Math.round(v * 100) + '%',
  shatterCharge: v => v === 0 ? '關閉' : '+' + v.toFixed(3),
  shatterChargeTime: () => shatterSegmentSeconds('charge'),
  shapeMotionCycles: v => Math.round(v) + ' 圈/循環',
  shapeMotionEase: v => Math.round(v * 100) + '%',
  shapeSpinX: v => v.toFixed(0) + '°',
  shapeSpinY: v => v.toFixed(0) + '°',
  shapeSpinZ: v => v.toFixed(0) + '°',
  shapeBreathe: v => Math.round(v * 100) + '%',
  shapeBob: v => v.toFixed(2),
  shapeSquash: v => Math.round(v * 100) + '%',
  shape2MotionCycles: v => Math.round(v) + ' 圈/循環',
  shape2MotionEase: v => Math.round(v * 100) + '%',
  shape2SpinX: v => v.toFixed(0) + '°',
  shape2SpinY: v => v.toFixed(0) + '°',
  shape2SpinZ: v => v.toFixed(0) + '°',
  shape2Breathe: v => Math.round(v * 100) + '%',
  shape2Bob: v => v.toFixed(2),
  shape2Squash: v => Math.round(v * 100) + '%',
  shapeAScale: v => 'x' + v.toFixed(2),
  shapeBScale: v => 'x' + v.toFixed(2),
  jellyPokes: v => Math.round(v) + ' 下/循環',
  jellyBounces: v => Math.round(v) + ' 回',
  jellyAmount: v => v === 0 ? '關閉' : Math.round(v * 100) + '%',
  jellyDamping: v => v.toFixed(1),
  jellyTwist: v => v === 0 ? '不扭轉' : v.toFixed(0) + '°',
  hopCount: v => Math.round(v) + ' 跳/循環',
  hopHeight: v => v === 0 ? '不彈跳' : Math.round(v * 100) + '%',
  hopDecay: v => v === 1 ? '不衰減' : '每跳 x' + v.toFixed(2),
  hopGravity: v => v.toFixed(1) + (Math.abs(v - 2) < 0.05 ? '（真實重力）' : v < 2 ? '（飄浮）' : '（沉重）'),
  hopAnticipation: v => v === 0 ? '不蓄力' : Math.round(v * 100) + '%',
  hopStretch: v => v === 0 ? '不拉伸' : Math.round(v * 100) + '%',
  hopSway: v => v === 0 ? '不側移' : Math.round(v * 100) + '%',
};
}
