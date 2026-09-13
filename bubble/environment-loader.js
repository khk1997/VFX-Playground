export function selectMaterialEnvironment({
  style,
  motion,
  materialEnvironments,
  defaults,
  motionEnvironment,
}) {
  const stored = materialEnvironments[style];
  return (stored && stored.file)
    ? stored
    : (motionEnvironment(motion)
      || stored
      || defaults[style]
      || defaults.universal);
}

export function createEnvironmentLoader({
  THREE,
  getPmremGenerator,
  getUniforms,
  getPmremTarget,
  setPmremTarget,
  getVariantMaterials,
  onVariantChange,
  onSettled,
  stateElement,
  importRGBELoader = () => import('three/addons/loaders/RGBELoader.js'),
}) {
  let RGBELoaderClass = null;
  let requestId = 0;

  async function ensureRGBE() {
    if (!RGBELoaderClass) {
      const module = await importRGBELoader();
      RGBELoaderClass = module.RGBELoader;
    }
    return RGBELoaderClass;
  }

  function applyTexture(texture, label, currentRequestId) {
    if (currentRequestId !== requestId) {
      texture.dispose();
      return;
    }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const uniforms = getUniforms();
    const nextPmremTarget = getPmremGenerator().fromEquirectangular(texture);
    const oldEnv = uniforms.uEnvMap.value;
    const oldPmremTarget = getPmremTarget();
    uniforms.uEnvMap.value = texture;
    uniforms.uPmremMap.value = nextPmremTarget.texture;
    uniforms.uHasEnv.value = 1;
    setPmremTarget(nextPmremTarget);
    for (const material of getVariantMaterials()) {
      material.envMap = nextPmremTarget.texture;
      material.needsUpdate = true;
    }
    onVariantChange();

    oldEnv?.dispose?.();
    oldPmremTarget?.dispose?.();
    stateElement.textContent = 'HDRI 已載入：' + label;
  }

  function loadEnvironment(url, label, isHDR, revokeURL = false) {
    const currentRequestId = ++requestId;
    stateElement.textContent = 'HDRI 載入中：' + label;
    const finish = () => { if (revokeURL) URL.revokeObjectURL(url); };
    const apply = texture => {
      try {
        applyTexture(texture, label, currentRequestId);
        onSettled('HDRI 載入完成');
      } catch (_) {
        if (currentRequestId === requestId) stateElement.textContent = 'HDRI 載入失敗：' + label;
        texture?.dispose?.();
        onSettled('HDRI 套用失敗');
      }
      finish();
    };
    const fail = () => {
      if (currentRequestId === requestId) stateElement.textContent = 'HDRI 載入失敗：' + label;
      onSettled('HDRI 載入失敗');
      finish();
    };

    if (isHDR) {
      ensureRGBE()
        .then(RGBE => new RGBE().load(url, apply, undefined, fail))
        .catch(fail);
    } else {
      new THREE.TextureLoader().load(url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        apply(texture);
      }, undefined, fail);
    }
  }

  return { loadEnvironment };
}
