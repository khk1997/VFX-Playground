import assert from 'node:assert/strict';
import { MOTIONS, MOTION_KEYS, motionGates, usesStudioGlass } from '../bubble/motions/registry.js';
import { createShaderVariantPlanner } from '../bubble/shader-variants.js';

// 走新玻璃模型（OpenPBR 材質 + 棚景）的模式。搬一批就改這一行：其餘地方
// （shader 變體、面板版面、視角、匯出去背、地板）都讀 registry 的 studioGlass。
const STUDIO_MODES = ['static', 'typewriter', 'formation', 'morph', 'capillary'];
// 不在這次搬遷範圍內的模式：安裝中保留舊的材質路徑與那幾層加色外觀。
const LEGACY_MODES = ['research'];

assert.deepEqual(MOTION_KEYS.filter(usesStudioGlass), STUDIO_MODES);
for (const motion of LEGACY_MODES) assert.equal(usesStudioGlass(motion), false, motion);
assert.equal(usesStudioGlass('no-such-mode'), false);

// 面板閘門跟 registry 同一個來源。
let current = 'static';
const gates = motionGates(() => current);
for (const motion of MOTION_KEYS) {
  current = motion;
  assert.equal(gates.studioGlass(), Boolean(MOTIONS[motion].studioGlass), motion);
}

// shader 變體：新模型的模式編 FEATURE_STUDIO_GLASS，而且不編舊的加色外觀。
const params = {
  motion: 'static', staticShape: 0, shapeSource: 'svg', formationFrontOn: false,
  filmEnabled: true, materialStyle: 'universal', dispersionEnabled: true,
  rayDispersionEnabled: true, spectralCausticEnabled: true, rayBeamPattern: 'ring',
};
const motionMemory = new Proxy({}, { get: () => new Proxy({}, { get: () => true }) });
const planner = createShaderVariantPlanner({
  getParams: () => params,
  getMotionMemory: () => motionMemory,
  usesShapeField: motion => Boolean(MOTIONS[motion]?.usesShapeField),
  usesStudioGlass,
  isFormationMotion: motion => motion === 'formation',
  getHasEnvironment: () => false,
  diagnostics: { any: false, list: [] },
  forceFeatures: [],
  shaderRun: null,
  isMobile: () => false,
});
for (const motion of MOTION_KEYS) {
  params.motion = motion;
  const defines = planner.shaderFeatures(planner.variantState(motion));
  const studio = usesStudioGlass(motion);
  assert.equal(defines.FEATURE_STUDIO_GLASS === '', studio, `${motion} FEATURE_STUDIO_GLASS`);
  if (studio) {
    for (const legacy of ['FEATURE_THIN_FILM', 'FEATURE_DISPERSION', 'FEATURE_PRISM_BEAM',
      'FEATURE_SPECTRAL_CAUSTICS', 'FEATURE_BEAM_PATTERNS']) {
      assert.equal(defines[legacy], false, `${motion} should not compile ${legacy}`);
    }
  }
}

console.log(`Studio glass registry passed (${STUDIO_MODES.join(', ')})`);
