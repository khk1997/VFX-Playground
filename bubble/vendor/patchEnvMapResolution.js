import * as THREE from 'three';

// Must stay paired with bubble/vendor/PMREMGenerator.js.
const MIN_MIP_LEVEL = 5;
const MIN_TILE_SIZE = 2 ** MIN_MIP_LEVEL;

let patched = false;

export default function patchEnvMapResolution() {
  if (patched) return;
  patched = true;

  const chunk = THREE.ShaderChunk.cube_uv_reflection_fragment;
  const next = chunk
    .replace('#define cubeUV_minMipLevel 4.0', `#define cubeUV_minMipLevel ${MIN_MIP_LEVEL}.0`)
    .replace('#define cubeUV_minTileSize 16.0', `#define cubeUV_minTileSize ${MIN_TILE_SIZE}.0`);

  if (next === chunk) {
    console.error(
      'patchEnvMapResolution: 找不到 cubeUV_minMipLevel / cubeUV_minTileSize；'
      + 'PMREMGenerator 與 three.js shader chunk 版本可能不一致。',
    );
    return;
  }

  THREE.ShaderChunk.cube_uv_reflection_fragment = next;
}
