export function createShaderVariantPlanner({
  getParams,
  getMotionMemory,
  usesShapeField,
  isFormationMotion,
  getHasEnvironment,
  diagnostics,
  forceFeatures,
  shaderRun,
  isMobile,
}) {
  const DIAG = diagnostics;

  function usesBaselineShader() {
    return DIAG.compilerbaseline || DIAG.probeNoise || DIAG.probeSnoise
      || DIAG.probeFbm || DIAG.probeNoiseMapscene || DIAG.probeMarchBound > 0;
  }

  function staticUsesImportedShape(motion = getParams().motion) {
    const params = getParams();
    return motion !== 'static' || params.staticShape === 7;
  }

  function variantState(motion = getParams().motion) {
    const params = getParams();
    const motionMemory = getMotionMemory();
    const scoped = key => (motion === params.motion ? params[key] : motionMemory[key][motion]);
    const shapeField = usesShapeField(motion) && staticUsesImportedShape(motion);
    const svgNormals = shapeField && params.shapeSource === 'svg';
    const shapeMorph = shapeField && motion === 'morph';
    const formationCut = shapeField && isFormationMotion(motion) && params.formationFrontOn;
    return {
      shapeField,
      svgNormals,
      shapeSvg: svgNormals,
      shapeVolume: shapeField && params.shapeSource !== 'svg',
      shapeMorph,
      formationCut,
      dissolveField: shapeMorph || formationCut,
      capillaryTexture: motion === 'capillary' || motion === 'static' || motion === 'research',
      staticShape: motion === 'static' && params.staticShape !== 7,
      research: motion === 'research',
      typewriter: motion === 'typewriter',
      microDrops: shapeField
        && (isFormationMotion(motion) || motion === 'shatter'
          || motion === 'melt' || motion === 'morph'),
      negativeField: shapeField,
      thinFilm: !!params.filmEnabled,
      liquidFilm: scoped('materialStyle') === 'membrane',
      dispersion: !!params.dispersionEnabled,
      prismBeam: !!params.rayDispersionEnabled,
      spectralCaustics: !!scoped('spectralCausticEnabled'),
      beamPatterns: params.rayBeamPattern !== 'grid',
      envPmrem: !!getHasEnvironment(),
    };
  }

  function variantKey(state = variantState()) {
    const flag = (on, character) => (on ? character : '-');
    const diagSalt = DIAG.any || forceFeatures.length
      ? '.d[' + DIAG.list.join('+') + (forceFeatures.length ? '|' + forceFeatures.join('+') : '') + ']'
      : '';
    return [
      'g' + flag(state.shapeField, 'S') + flag(state.svgNormals, 'V')
        + flag(state.shapeVolume, 'G') + flag(state.capillaryTexture, 'C')
        + flag(state.microDrops, 'M') + flag(state.negativeField, 'N')
        + flag(state.staticShape, 'X') + flag(state.research, 'H')
        + flag(state.typewriter, 'Y') + flag(state.shapeMorph, 'R')
        + flag(state.formationCut, 'T'),
      'o' + flag(state.thinFilm, 'F') + flag(state.liquidFilm, 'L')
        + flag(state.dispersion, 'D') + flag(state.prismBeam, 'P')
        + flag(state.spectralCaustics, 'K') + flag(state.beamPatterns, 'B')
        + flag(state.envPmrem, 'E'),
    ].join('.') + diagSalt;
  }

  function shaderFeatures(state = variantState()) {
    const withRun = defines => {
      if (shaderRun !== null) defines.SHADER_RUN = shaderRun;
      return defines;
    };
    if (usesBaselineShader()) {
      const defines = { MAX_MARCH_COMPILE: 4, MAX_DROPS_COMPILE: 2 };
      if (DIAG.probeSnoise) {
        defines.NEED_SNOISE = '';
        defines.CALL_SNOISE_MAIN = '';
      }
      if (DIAG.probeFbm) {
        defines.NEED_SNOISE = '';
        defines.NEED_FBM = '';
        defines.CALL_FBM_MAIN = '';
      }
      if (DIAG.probeNoiseMapscene || DIAG.probeMarchBound > 0) {
        defines.NEED_SNOISE = '';
        defines.NEED_FBMFAST = '';
        defines.CALL_FBMFAST_MAPSCENE = '';
        if (DIAG.probeMarchBound > 0) defines.MAX_MARCH_COMPILE = DIAG.probeMarchBound;
      }
      if (DIAG.probeNoise) {
        defines.NEED_SNOISE = '';
        defines.NEED_FBM = '';
        defines.NEED_FBMFAST = '';
        defines.CALL_FBMFAST_MAPSCENE = '';
        defines.CALL_FBM_MAIN = '';
      }
      return withRun(defines);
    }

    const defines = {
      MAX_REFLECTION_SAMPLES: isMobile() ? 4 : 8,
      FEATURE_SHAPE_FIELD: state.shapeField ? '' : false,
      FEATURE_CAPILLARY: state.capillaryTexture ? '' : false,
      FEATURE_STATIC_SHAPE: state.staticShape ? '' : false,
      FEATURE_MICRO_DROPS: state.microDrops ? '' : false,
      FEATURE_NEGATIVE_FIELD: state.negativeField ? '' : false,
      FEATURE_RESEARCH: state.research ? '' : false,
      FEATURE_TYPEWRITER: state.typewriter ? '' : false,
      FEATURE_SHAPE_SVG: state.shapeSvg ? '' : false,
      FEATURE_SHAPE_VOLUME: state.shapeVolume ? '' : false,
      FEATURE_SHAPE_MORPH: state.shapeMorph ? '' : false,
      FEATURE_FORMATION_CUT: state.formationCut ? '' : false,
      FEATURE_DISSOLVE_FIELD: state.dissolveField ? '' : false,
      NORMAL_TAPS_TETRA: '',
      NORMAL_TAPS_SVG: state.svgNormals ? '' : false,
      FEATURE_THIN_FILM: state.thinFilm ? '' : false,
      FEATURE_LIQUID_FILM: state.liquidFilm ? '' : false,
      FEATURE_LIQUID_FILM_DEPTH: state.liquidFilm ? '' : false,
      FEATURE_DISPERSION: state.dispersion ? '' : false,
      FEATURE_PRISM_BEAM: state.prismBeam ? '' : false,
      FEATURE_PRISM_SATURATION: state.prismBeam ? '' : false,
      FEATURE_SPECTRAL_CAUSTICS: state.spectralCaustics ? '' : false,
      FEATURE_ENV_PMREM: state.envPmrem ? '' : false,
      FEATURE_BEAM_PATTERNS: state.beamPatterns ? '' : false,
    };

    if (DIAG.allFeatures) {
      for (const key of Object.keys(defines)) {
        if (key.startsWith('FEATURE_') || key.startsWith('NORMAL_TAPS_')) defines[key] = '';
      }
    }
    for (const key of forceFeatures) defines[key] = '';

    if (DIAG.minshader || DIAG.minshader2 || DIAG.lowcompileloops) {
      defines.FEATURE_SHAPE_FIELD = false;
      defines.FEATURE_CAPILLARY = false;
      defines.FEATURE_MICRO_DROPS = false;
      defines.FEATURE_DISSOLVE_FIELD = false;
    }
    if (DIAG.minshader2 || DIAG.lowcompileloops) {
      defines.FEATURE_BEAM_PATTERNS = false;
      defines.MAX_DROPS_COMPILE = 4;
    }
    if (DIAG.lowcompileloops) {
      defines.MAX_MARCH_COMPILE = 16;
      defines.MAX_INTERIOR_COMPILE = 8;
    }
    const late = DIAG.probeNoLateShading;
    if (late || DIAG.probeNoPrismBeam) defines.FEATURE_PRISM_BEAM = false;
    if (late || DIAG.probeNoPrismSaturation) defines.FEATURE_PRISM_SATURATION = false;
    if (late || DIAG.probeNoLiquidFilmMaterial) defines.FEATURE_LIQUID_FILM = false;
    if (late || DIAG.probeNoThinFilmDepth) defines.FEATURE_LIQUID_FILM_DEPTH = false;
    if (late || DIAG.probeNoDispersionSpectral) defines.FEATURE_DISPERSION = false;
    if (late || DIAG.probeNoSpectralCaustics) defines.FEATURE_SPECTRAL_CAUSTICS = false;
    if (DIAG.probeNoEnvPmrem) defines.FEATURE_ENV_PMREM = false;
    if (DIAG.probeNoThinFilm || DIAG.probeNoRefractionFilm) defines.FEATURE_THIN_FILM = false;
    if (DIAG.probeMapscenePlain) {
      defines.FEATURE_NEGATIVE_FIELD = false;
      defines.NORMAL_TAPS_SVG = false;
    }
    if (DIAG.probeModeSvg) {
      defines.NORMAL_TAPS_SVG = '';
      defines.NORMAL_TAPS_TETRA = false;
    }
    if (DIAG.probeModeNone || DIAG.probeModeVoxel) {
      defines.NORMAL_TAPS_SVG = false;
      defines.NORMAL_TAPS_TETRA = '';
    }
    if (DIAG.singleReflectionSample) defines.PROBE_SINGLE_REFLECTION_SAMPLE = '';
    if (DIAG.probeUnrolledSvgTaps) defines.PROBE_UNROLLED_SVG_TAPS = '';
    if (DIAG.probeNoWobble) defines.PROBE_NO_GEOMETRY_WOBBLE = '';
    if (DIAG.probeNoRefractionFilm || DIAG.probeNoTraceExit) defines.PROBE_NO_TRACE_EXIT = '';
    if (DIAG.probeNoRefractionFilm || DIAG.probeNoArtDispersion) defines.PROBE_NO_ART_DISPERSION = '';
    if (DIAG.probeNoTraceNormal) defines.PROBE_NO_TRACE_NORMAL = '';
    if (DIAG.probeNoTraceMarch) defines.PROBE_NO_TRACE_MARCH = '';
    if (DIAG.probeCheapTraceSdf) defines.PROBE_CHEAP_TRACE_SDF = '';
    if (DIAG.probeLeanNormals) {
      defines.PROBE_LEAN_NORMALS = '';
      defines.TRACE_EXIT_NORMAL_FN = 'exitNormalTetra';
    }
    return withRun(defines);
  }

  return {
    usesBaselineShader,
    staticUsesImportedShape,
    variantState,
    variantKey,
    shaderFeatures,
  };
}

export class VariantMaterialCache extends Map {
  constructor(limit = 12, onEvict = () => {}) {
    super();
    this.limit = limit;
    this.onEvict = onEvict;
  }

  touch(key) {
    const material = this.get(key);
    if (material) {
      this.delete(key);
      this.set(key, material);
    }
    return material;
  }

  evict(activeKey) {
    while (this.size > this.limit) {
      const oldest = this.keys().next().value;
      if (oldest === activeKey) break;
      const material = this.get(oldest);
      this.delete(oldest);
      try { material.dispose(); } catch (_) {}
      this.onEvict(oldest);
    }
  }
}
