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
      // 靜態模式專屬的玻璃光學。刻意不重用上面那個 staticShape —— 它為了「有沒有
      // 形狀場」而排除了匯入造型（值 7），而新的玻璃模型兩種都要吃到：這個模組
      // 的賣點就是自己丟 SVG／GLB 進來，只有內建幾何漂亮等於沒做。
      //
      // 其餘九個模式因此完全不編這一塊，畫面逐位元不變（tests/glass_baseline.py
      // 會驗）。等靜態這條路成立了再決定要不要推廣出去。
      staticGlass: motion === 'static',
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
        + flag(state.envPmrem, 'E') + flag(state.staticGlass, 'A'),
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
      FEATURE_STATIC_GLASS: state.staticGlass ? '' : false,
      // 光譜迴圈的編譯期上限。跟 MAX_MARCH_COMPILE 同一個用法：實際圈數由
      // uSpectralSamples 在執行期決定，編譯期只知道一個上限，fxc 才不會把整段
      // 展開成一份一份的背景取樣（README 那條 154 秒就是這樣來的）。
      //
      // 其餘模式給 false 而不是給個數字：那會多一行 #define 進到它們的 shader
      // 前綴，而「原始碼有動、輸出就不保證相同」這件事這個分支已經踩過一次。
      MAX_SPECTRAL_COMPILE: state.staticGlass ? 32 : false,
      // 地板遮蔽的 march 上限。跟其餘 MAX_*_COMPILE 同一個用法：編譯期只知道
      // 上限，實際步數由場景決定，fxc 才不會把整段展開。
      MAX_SHADOW_COMPILE: state.staticGlass ? 20 : false,
    };

    // 靜態模式不編舊的外觀層。這不是精簡，是它們與新模型互相衝突：
    //
    //   薄膜干涉、藝術色散、稜光光芒、光譜焦散全部是「把算好的光譜加到畫面上」。
    //   新模型的顏色是折射本身分出來的，而那兩種顏色疊在一起就互相稀釋 ——
    //   加色層先把邊緣填成淡彩，真正的分光帶再疊上去就看不出來了。要的是細而
    //   飽和的色帶，不是一層淡彩加一條細帶。
    //
    // 順帶把靜態變體的編譯量降回來：這幾塊是整支 shader 裡最大的幾段。
    if (state.staticGlass) {
      defines.FEATURE_THIN_FILM = false;
      defines.FEATURE_DISPERSION = false;
      defines.FEATURE_PRISM_BEAM = false;
      defines.FEATURE_PRISM_SATURATION = false;
      defines.FEATURE_SPECTRAL_CAUSTICS = false;
      defines.FEATURE_BEAM_PATTERNS = false;
      // 玻璃內部的 march 上限。內部彈跳那一段（shaders.js 的 uInternalBounce）
      // 從出口面反射回來，常常貼著另一個面幾乎平行地走：步長是 -d·0.72，d 就是
      // 到那個面的距離，一路都很小，28 步走不到出口就放棄，那個像素的彈跳整份
      // 被丟掉。放棄與否在相鄰像素之間跳來跳去，畫面上就是彈跳亮面邊上那一排
      // 鋸齒（實測 96 步完全消失）。
      //
      // 迴圈不展開，上限只是編譯期常數，編譯量不變；執行期只有那些貼面走的像素
      // 會多跑，其餘照樣早早 break。
      defines.MAX_INTERIOR_COMPILE = 64;
    }

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
