'use strict';

// 後處理鏈。
//
// 主畫面本來是「一個全螢幕四邊形 + 一支大 fragment shader」直接畫到 canvas，
// 沒有任何中間影像可以加工。這支模組把那一步改成「先畫進一顆離屏貼圖，再跑幾個
// pass，最後才輸出」，並在上面實作第一個效果：Bloom。
//
// 兩個刻意的設計：
//
//   1. 效果全部關掉時整條鏈直接跳過（見 bubble.js 的 renderComposite），畫面
//      逐位元等於加入這支模組之前。預設就是全關，所以既有的參數組合檔與匯出
//      成品都不受影響。
//   2. 半浮點的中間貼圖是為了模糊鏈不要在暗部斷階（8-bit 連續降採升採會可見地
//      分層）。但要說清楚：主 shader 最後一行是 clamp(finalColor, 0, 1)，畫面
//      本身仍是 display-referred 的 LDR，這裡拿到的不是真正的 HDR。真要有高光
//      溢出的量級，得先把那個 clamp 拿掉，那是另一件事（會動到既有外觀與去背的
//      反預乘推導）。所以門檻的合理範圍在 1.0 以下，預設 0.75。
//
// Bloom 用 dual-filter（Kawase）降採／升採，而不是 three addons 的
// UnrealBloomPass：後者自帶一套門檻與色調處理、pass 數也多，這裡只需要「亮部
// 取出來、糊開、加回去」。而且每一層都是上一層的一半解析度，模糊半徑因此天然
// 跟著解析度縮放 —— 匯出是 4× 超採樣，用像素定義半徑的話 4K 的光暈會只有預覽
// 的四分之一。

import * as THREE from 'three';

const QUAD_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// 亮部取出。soft knee：門檻附近平滑過渡，不然高光邊緣會沿著等亮度線切出一圈
// 硬邊，而且鏡頭一動那圈邊就會跳。
//
// uPremultiply 是給去背輸出用的：那條路徑寫出的是 straight alpha，真正「發出來
// 的光」是 rgb × a，直接對 rgb 取門檻會讓半透明的地方虛胖。
const THRESHOLD_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
uniform float uPremultiply;
void main(){
  vec4 s = texture2D(uScene, vUv);
  vec3 c = s.rgb * mix(1.0, s.a, uPremultiply);
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

const DOWN_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uHalfTexel;
void main(){
  vec4 sum = texture2D(uTex, vUv) * 4.0;
  sum += texture2D(uTex, vUv - uHalfTexel);
  sum += texture2D(uTex, vUv + uHalfTexel);
  sum += texture2D(uTex, vUv + vec2(uHalfTexel.x, -uHalfTexel.y));
  sum += texture2D(uTex, vUv - vec2(uHalfTexel.x, -uHalfTexel.y));
  gl_FragColor = sum / 8.0;
}
`;

// 升採：把下一層（更小、更糊）的結果模糊之後，跟本層的降採結果混合。
// uRadius 就是混多少 —— 0 是幾乎只留本層（緊實的光暈），1 是幾乎只留低頻
// （大範圍的暈開）。這是 Unity 那套 bloom 的 scatter，比「半徑幾像素」好調，
// 也不會因為解析度改變而改變手感。
const UP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uLower;
uniform sampler2D uHere;
uniform vec2 uHalfTexel;
uniform float uRadius;
void main(){
  vec4 sum = texture2D(uLower, vUv + vec2(-uHalfTexel.x * 2.0, 0.0));
  sum += texture2D(uLower, vUv + vec2(-uHalfTexel.x, uHalfTexel.y)) * 2.0;
  sum += texture2D(uLower, vUv + vec2(0.0, uHalfTexel.y * 2.0));
  sum += texture2D(uLower, vUv + vec2(uHalfTexel.x, uHalfTexel.y)) * 2.0;
  sum += texture2D(uLower, vUv + vec2(uHalfTexel.x * 2.0, 0.0));
  sum += texture2D(uLower, vUv + vec2(uHalfTexel.x, -uHalfTexel.y)) * 2.0;
  sum += texture2D(uLower, vUv + vec2(0.0, -uHalfTexel.y * 2.0));
  sum += texture2D(uLower, vUv + vec2(-uHalfTexel.x, -uHalfTexel.y)) * 2.0;
  vec3 lower = (sum / 12.0).rgb;
  vec3 here = texture2D(uHere, vUv).rgb;
  gl_FragColor = vec4(mix(here, lower, clamp(uRadius, 0.0, 1.0)), 1.0);
}
`;

// 合成。不透明時就是單純的加法（光是加上去的，不是混合上去的）。
//
// 去背輸出沒有那麼單純：straight alpha 的 PNG 表達不了「加性光」，alpha 為 0 的
// 地方無論 rgb 寫什麼，疊回去都看不見。所以把光暈的亮度當成覆蓋率併進 alpha，
// 顏色再對新的 alpha 反乘 —— 疊回任何背景時光暈都在，代價是它會帶著一點背景的
// 遮蔽（真實的加性光不會遮住後面）。這是這個檔案格式下能做到最接近的近似。
const COMPOSITE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uIntensity;
uniform vec3 uTint;
uniform float uTransparent;
uniform float uExposure;
uniform int uToneMap;

// 0 無：只交給輸出格式夾掉，等於後處理加入之前的行為。
// 1 Reinhard：c/(1+c)，任何量級都收得進 0–1，但整體會偏灰。
// 2 ACES（Narkowicz 的曲線擬合）：高光滾降得更晚、對比保留得更好，是「電影感」
//   那條。0.6 是把它對齊「1.0 大致仍是 1.0」的常用係數。
vec3 applyToneMap(vec3 c){
  if (uToneMap == 1) return c / (1.0 + c);
  if (uToneMap == 2) {
    vec3 x = c * 0.6;
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  return c;
}

void main(){
  vec4 base = texture2D(uScene, vUv);
  vec3 bloom = texture2D(uBloom, vUv).rgb * uIntensity * uTint;
  if (uTransparent < 0.5) {
    gl_FragColor = vec4(applyToneMap((base.rgb + bloom) * uExposure), base.a);
    return;
  }
  vec3 premultiplied = applyToneMap((base.rgb * base.a + bloom) * uExposure);
  float alpha = clamp(base.a + max(bloom.r, max(bloom.g, bloom.b)), 0.0, 1.0);
  gl_FragColor = vec4(premultiplied / max(alpha, 0.0001), alpha);
}
`;

// 中間貼圖一律不做色彩空間轉換：主 shader 寫進來的是什麼值，合成 pass 就要原封
// 不動寫出去，bloom 關掉時畫面才會逐位元等於沒有這條鏈。（順帶一提，模糊因此是
// 在 display-referred 的值上做的，不是線性光 —— 見檔頭第 2 點。）
function createTarget(width, height, type = THREE.HalfFloatType) {
  const target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

// 全尺寸中間貼圖的型別。半浮點是為了留住高於 1 的高光（見主 shader 的
// uHdrOutput）—— 沒有它，bloom 的門檻只能設在 1 以下，取出的是正常畫面的一部分
// 而不是溢出的能量。
//
// 但匯出是 4× 超採樣：1080p 的成品換算成 7680×4320，半浮點 RGBA 就是 265MB。
// 超過上限時退回 8-bit（高光在那裡會被夾掉，光暈比預覽弱），並且明講 —— 靜默地
// 換掉輸出的成色是最糟的處理方式。
const MAX_HDR_BYTES = 512 * 1024 * 1024;
let hdrFallbackWarned = false;

function sceneTypeFor(target) {
  if (!target) return THREE.HalfFloatType;
  const bytes = target.width * target.height * 8;
  if (bytes <= MAX_HDR_BYTES) return THREE.HalfFloatType;
  if (!hdrFallbackWarned) {
    hdrFallbackWarned = true;
    console.warn('[bubble] 這個匯出尺寸的 HDR 中間緩衝區超過 '
      + Math.round(MAX_HDR_BYTES / 1024 / 1024) + 'MB，改用 8-bit：'
      + '高光會被夾在 1，光暈會比預覽弱。降低輸出尺寸即可恢復。');
  }
  return THREE.UnsignedByteType;
}

export function createPostChain(renderer) {
  const quadScene = new THREE.Scene();
  // 頂點著色器直接寫 clip space，所以相機的矩陣不參與運算，用最陽春的一顆即可。
  const quadCamera = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const makeMaterial = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const thresholdMaterial = makeMaterial(THRESHOLD_FRAG, {
    uScene: { value: null },
    uThreshold: { value: 0.75 },
    uKnee: { value: 0.5 },
    uPremultiply: { value: 0 },
  });
  const downMaterial = makeMaterial(DOWN_FRAG, {
    uTex: { value: null },
    uHalfTexel: { value: new THREE.Vector2() },
  });
  const upMaterial = makeMaterial(UP_FRAG, {
    uLower: { value: null },
    uHere: { value: null },
    uHalfTexel: { value: new THREE.Vector2() },
    uRadius: { value: 0.7 },
  });
  const compositeMaterial = makeMaterial(COMPOSITE_FRAG, {
    uScene: { value: null },
    uBloom: { value: null },
    uIntensity: { value: 0.6 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTransparent: { value: 0 },
    uExposure: { value: 1 },
    uToneMap: { value: 0 },
  });

  // bloom 關著（強度 0）時整條模糊鏈都不跑，合成 pass 仍需要一張圖可以取樣。
  const blackPixel = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackPixel.colorSpace = THREE.NoColorSpace;
  blackPixel.needsUpdate = true;

  let sceneTarget = null;
  let levels = [];
  let width = 0;
  let height = 0;
  let divisor = 0;
  let sceneType = null;

  function blit(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  // 層數由畫面大小決定，而不是寫死：最小的一層仍要有幾十個像素，太小的話升採
  // 回來是一片色塊而不是光暈。上限 6 層 —— 再往下每層的成本已經可以忽略，但
  // pass 的固定開銷不會。
  //
  // nextDivisor 是「第一層要縮多少」。預覽時是 2（就是常規的半解析度起手）；
  // 匯出是 4× 超採樣，就變成 8 —— 這樣第一層永遠是「最終成品的一半」，光暈的
  // 相對大小才會跟預覽一致，而不是縮成四分之一。順帶把匯出的記憶體壓下來：
  // 4K×4 的半解析度貼圖是很可觀的一塊。
  //
  // nextSceneType：預覽用半浮點（模糊鏈不斷階），匯出用 8-bit —— 超採樣的全尺寸
  // 緩衝區用半浮點會是原本的兩倍，1080p×4 就要 265MB，在中階 GPU 上會直接配置
  // 失敗。它馬上就被降採到很小的層去，那裡仍然是半浮點，斷階問題不在這一層。
  function resize(nextWidth, nextHeight, nextDivisor, nextSceneType) {
    if (nextWidth === width && nextHeight === height
      && nextDivisor === divisor && nextSceneType === sceneType && sceneTarget) return;
    dispose();
    width = nextWidth;
    height = nextHeight;
    divisor = nextDivisor;
    sceneType = nextSceneType;
    sceneTarget = createTarget(width, height, sceneType);
    let w = Math.max(1, Math.floor(width / divisor));
    let h = Math.max(1, Math.floor(height / divisor));
    const count = Math.max(1, Math.min(6, Math.floor(Math.log2(Math.max(w, h))) - 3));
    for (let i = 0; i < count; i++) {
      levels.push({ width: w, height: h, down: createTarget(w, h), up: createTarget(w, h) });
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  function dispose() {
    if (sceneTarget) sceneTarget.dispose();
    sceneTarget = null;
    for (const level of levels) { level.down.dispose(); level.up.dispose(); }
    levels = [];
    width = 0;
    height = 0;
    divisor = 0;
    sceneType = null;
  }

  // scene/camera 是主畫面那一顆全螢幕四邊形；target 為 null 時輸出到 canvas，
  // 匯出時則是那顆超採樣用的 render target。
  const drawingBufferSize = new THREE.Vector2();
  function render(scene, camera, target, params) {
    renderer.getDrawingBufferSize(drawingBufferSize);
    resize(
      target ? target.width : drawingBufferSize.x,
      target ? target.height : drawingBufferSize.y,
      2 * Math.max(1, params.superSample || 1),
      sceneTypeFor(target),
    );

    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);

    // 只有曝光／色調映射在用時，跳過整條模糊鏈 —— 那是十幾個 pass，不該為了一次
    // 乘法白跑。
    if (params.intensity <= 0) {
      compositeMaterial.uniforms.uScene.value = sceneTarget.texture;
      compositeMaterial.uniforms.uBloom.value = blackPixel;
      compositeMaterial.uniforms.uIntensity.value = 0;
      compositeMaterial.uniforms.uTint.value.copy(params.tint);
      compositeMaterial.uniforms.uTransparent.value = params.transparent ? 1 : 0;
      compositeMaterial.uniforms.uExposure.value = params.exposure;
      compositeMaterial.uniforms.uToneMap.value = params.toneMap;
      blit(compositeMaterial, target || null);
      renderer.setRenderTarget(null);
      return;
    }

    thresholdMaterial.uniforms.uScene.value = sceneTarget.texture;
    thresholdMaterial.uniforms.uThreshold.value = params.threshold;
    thresholdMaterial.uniforms.uKnee.value = params.knee;
    thresholdMaterial.uniforms.uPremultiply.value = params.transparent ? 1 : 0;
    blit(thresholdMaterial, levels[0].down);

    for (let i = 1; i < levels.length; i++) {
      const source = levels[i - 1];
      downMaterial.uniforms.uTex.value = source.down.texture;
      downMaterial.uniforms.uHalfTexel.value.set(0.5 / source.width, 0.5 / source.height);
      blit(downMaterial, levels[i].down);
    }

    // 最小的一層沒有「更小的下一層」可以混，它自己就是升採的起點。往上每混完
    // 一層，那層的結果就成為下一次的「更低頻」來源；level.up 只被寫、不被改寫成
    // 別人的貼圖，dispose 才不會重複釋放同一顆。
    const last = levels.length - 1;
    let lower = levels[last];
    let lowerTexture = levels[last].down.texture;
    for (let i = last - 1; i >= 0; i--) {
      upMaterial.uniforms.uLower.value = lowerTexture;
      upMaterial.uniforms.uHere.value = levels[i].down.texture;
      upMaterial.uniforms.uHalfTexel.value.set(0.5 / lower.width, 0.5 / lower.height);
      upMaterial.uniforms.uRadius.value = params.radius;
      blit(upMaterial, levels[i].up);
      lower = levels[i];
      lowerTexture = levels[i].up.texture;
    }

    compositeMaterial.uniforms.uScene.value = sceneTarget.texture;
    // 只有一層時升採迴圈一次都沒跑，光暈就是那層降採的結果。
    compositeMaterial.uniforms.uBloom.value = lowerTexture;
    compositeMaterial.uniforms.uIntensity.value = params.intensity;
    compositeMaterial.uniforms.uTint.value.copy(params.tint);
    compositeMaterial.uniforms.uTransparent.value = params.transparent ? 1 : 0;
    compositeMaterial.uniforms.uExposure.value = params.exposure;
    compositeMaterial.uniforms.uToneMap.value = params.toneMap;
    blit(compositeMaterial, target || null);
    renderer.setRenderTarget(null);
  }

  return { render, dispose };
}
