import assert from 'node:assert/strict';
import {
  createShaderVariantPlanner, VariantMaterialCache,
} from '../bubble/shader-variants.js';

const diagnostics = { any: false, list: [] };
const params = {
  motion: 'formation',
  staticShape: 7,
  shapeSource: 'svg',
  formationFrontOn: true,
  filmEnabled: true,
  materialStyle: 'membrane',
  dispersionEnabled: true,
  rayDispersionEnabled: true,
  spectralCausticEnabled: true,
  rayBeamPattern: 'ring',
};
const motionMemory = {
  materialStyle: { melt: 'universal' },
  spectralCausticEnabled: { melt: false },
};
const makePlanner = ({ diag = diagnostics, forced = [], mobile = false, run = null } = {}) => (
  createShaderVariantPlanner({
    getParams: () => params,
    getMotionMemory: () => motionMemory,
    usesShapeField: motion => ['formation', 'melt', 'morph', 'shatter'].includes(motion),
    isFormationMotion: motion => motion === 'formation',
    getHasEnvironment: () => true,
    diagnostics: diag,
    forceFeatures: forced,
    shaderRun: run,
    isMobile: () => mobile,
  })
);

const planner = makePlanner();
const formation = planner.variantState();
assert.equal(formation.shapeField, true);
assert.equal(formation.shapeSvg, true);
assert.equal(formation.shapeVolume, false);
assert.equal(formation.formationCut, true);
assert.equal(formation.dissolveField, true);
assert.equal(formation.microDrops, true);
assert.equal(formation.liquidFilm, true);
assert.equal(formation.spectralCaustics, true);
assert.equal(formation.beamPatterns, true);
assert.equal(formation.envPmrem, true);

const melt = planner.variantState('melt');
assert.equal(melt.shapeField, true);
assert.equal(melt.formationCut, false);
assert.equal(melt.microDrops, true);
assert.equal(melt.liquidFilm, false, 'prewarm state must read motion-scoped material memory');
assert.equal(melt.spectralCaustics, false, 'prewarm state must read motion-scoped caustic memory');

params.motion = 'static';
params.staticShape = 0;
const procedural = planner.variantState();
assert.equal(planner.staticUsesImportedShape(), false);
assert.equal(procedural.shapeField, false);
assert.equal(procedural.staticShape, true);
assert.equal(procedural.capillaryTexture, true);
params.motion = 'formation';
params.staticShape = 7;

const key = planner.variantKey(formation);
assert.equal(key, 'gSV--MN----T.oFLDPKBE');
assert.equal(planner.variantKey(formation), key, 'variant keys must be deterministic');

const desktopDefines = planner.shaderFeatures(formation);
assert.equal(desktopDefines.MAX_REFLECTION_SAMPLES, 8);
assert.equal(desktopDefines.FEATURE_SHAPE_FIELD, '');
assert.equal(desktopDefines.FEATURE_SHAPE_VOLUME, false);
assert.equal(desktopDefines.FEATURE_FORMATION_CUT, '');
assert.equal(desktopDefines.FEATURE_LIQUID_FILM, '');
assert.equal(makePlanner({ mobile: true }).shaderFeatures(formation).MAX_REFLECTION_SAMPLES, 4);

const forcedPlanner = makePlanner({ forced: ['FEATURE_SHAPE_VOLUME'], run: 23 });
assert.equal(forcedPlanner.shaderFeatures(formation).FEATURE_SHAPE_VOLUME, '');
assert.equal(forcedPlanner.shaderFeatures(formation).SHADER_RUN, 23);
assert.match(forcedPlanner.variantKey(formation), /\.d\[\|FEATURE_SHAPE_VOLUME\]$/);

const baselinePlanner = makePlanner({
  diag: { any: true, list: ['probe-snoise'], probeSnoise: true },
});
assert.equal(baselinePlanner.usesBaselineShader(), true);
assert.deepEqual(baselinePlanner.shaderFeatures(formation), {
  MAX_MARCH_COMPILE: 4,
  MAX_DROPS_COMPILE: 2,
  NEED_SNOISE: '',
  CALL_SNOISE_MAIN: '',
});

const disposed = [];
const evicted = [];
const material = name => ({ name, dispose: () => disposed.push(name) });
const cache = new VariantMaterialCache(2, keyName => evicted.push(keyName));
cache.set('a', material('a'));
cache.set('b', material('b'));
assert.equal(cache.touch('a').name, 'a');
assert.deepEqual([...cache.keys()], ['b', 'a']);
cache.set('c', material('c'));
cache.evict('a');
assert.deepEqual([...cache.keys()], ['a', 'c']);
assert.deepEqual(disposed, ['b']);
assert.deepEqual(evicted, ['b']);

console.log('Shader variant state, keys, feature defines, and LRU cache passed');
