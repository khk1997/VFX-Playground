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

// 升採：把下一層（更小、更糊）的結果模糊之後，「加」到本層的降採結果上。
//
// 這裡本來是 mix(here, lower, radius)，也就是兩者取代式地混合。那個寫法有個致命
// 的問題：降採是平均，一小塊高光被攤到 64 倍面積之後每像素只剩幾百分之一，取代式
// 混合等於「把緊實的光暈換成一片看不見的霧」—— 擴散範圍拉到 1 反而什麼都看不到，
// 使用者只好把門檻壓到 0.03、強度拉到 3 硬換亮度，結果整顆球糊掉。
//
// 改成累加之後，每一個尺度都疊在一起（等於一組不同寬度的高斯相加，那正是 Blender
// Fog Glow 用 FFT 卷積一個大核心在做的事）：uWeight 控制每往低頻走一層要加多少。
//
// 權重可以大於 1，而且預設就會 —— 滑桿的 0–1 對應到 0–2。理由是能量守恆：降採是
// 平均，一小塊高光被攤到 4 倍面積之後每像素只剩四分之一，六層下來是千分之一，
// 照原值累加等於什麼都看不到（實測過：擴散範圍從 0 拉到 1，畫面中線上的亮像素
// 只從 549 變成 590，也就是使用者說的「看不出差別」）。乘 2 剛好抵掉一半的稀釋，
// 讓寬的那幾層仍然有可見的振幅。
//
// 這不是物理上正確的做法，但這根滑桿要的本來就是美術控制：「光暈散多開」。代價是
// 拉寬時整體也會變亮 —— 那符合直覺，Unity 的 scatter 同樣如此。
const UP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uLower;
uniform sampler2D uHere;
uniform vec2 uHalfTexel;
uniform float uWeight;
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
  gl_FragColor = vec4(here + lower * max(uWeight, 0.0), 1.0);
}
`;

// 條紋光芒（Blender Glare 的 Streaks）。做法是 Kawase 的光條濾波：每一輪沿同一個
// 方向取四個等距樣本、權重指數遞減，下一輪把步距乘四 —— 用 16 次取樣換到一條很長
// 的光芒，而不是老實地沿線積分上千次。
//
// 輪數是 STREAK_PASSES（4）。第一版只跑三輪，最遠只到 63 個取樣間距，換算成畫面
// 是離光源約 250px 就沒了 —— 實測 320px 處還有 111/255，420px 剩 14，520px 是 0，
// 也就是使用者說的「條紋效果蠻弱」：不是不夠亮，是不夠長。多跑一輪，步距 ×4，
// 覆蓋範圍變成 255 個間距（整個畫面寬）。
//
// 色彩調變讓 RGB 三個通道用不同的衰減：紅衰得慢、藍衰得快，所以光芒外段偏暖、
// 靠近光源偏冷。真實鏡頭的條紋來自光柵繞射，本來就有色散，少了這個會像一根塑膠棒。
const STREAK_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uStride;
uniform vec3 uAtten;
void main(){
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    vec2 uv = vUv + uStep * fk;
    // 取樣點跑出畫面就算 0。少了這一行，ClampToEdge 會把邊緣那一列像素沿著整條
    // 光芒複製出去，畫面邊上會出現一整片矩形色塊 —— 實測踩過。
    vec2 outside = step(vec2(0.0), -uv) + step(vec2(1.0), uv);
    float inside = 1.0 - min(1.0, outside.x + outside.y);
    vec3 weight = pow(uAtten, vec3(uStride * fk));
    acc += texture2D(uTex, uv).rgb * weight * inside;
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;

// 把一張圖乘上係數疊進另一張（條紋的每個方向各自累加時用）。
const COPY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uScale;
void main(){
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uScale, 1.0);
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
uniform sampler2D uGlare;
uniform float uIntensity;
uniform vec3 uTint;
uniform float uTransparent;
uniform float uExposure;
uniform int uToneMap;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uGrainScale;
uniform float uGrainSeed;
uniform float uAspect;

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

// 顆粒。用 gl_FragCoord 而不是 vUv 當座標，顆粒才是「底片上的」固定大小，不會跟著
// 解析度變粗變細。uSeed 每個循環走整數步，所以動畫重播時顆粒的圖案精確重複 ——
// 這是個會一直重播的背景，任何不循環的東西都會在接點上被看見。
float grainNoise(vec2 p, float seed){
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 1.61803) * 43758.5453);
}

void main(){
  vec2 centered = vUv - 0.5;

  // 鏡頭色差：以畫面中心為原點，紅藍往相反方向徑向位移。中心無位移、邊緣最大 ——
  // 真實鏡頭的橫向色差就是這個形狀。0 時三個取樣座標完全相同，等於沒有這一段。
  vec2 uvR = 0.5 + centered * (1.0 + uAberration * 0.01);
  vec2 uvB = 0.5 + centered * (1.0 - uAberration * 0.01);

  vec4 base = texture2D(uScene, vUv);
  base.r = texture2D(uScene, uvR).r;
  base.b = texture2D(uScene, uvB).b;

  // 光暈與眩光都是「加上去的光」，所以先加在一起再一起走曝光與色調映射 ——
  // 分開套會讓同一道光在不同效果之間有不同的滾降。色差同樣要吃到它們，不然
  // 光暈會是唯一沒有色差的東西，看起來像貼上去的。
  vec3 bloom = vec3(
    texture2D(uBloom, uvR).r,
    texture2D(uBloom, vUv).g,
    texture2D(uBloom, uvB).b
  ) * uIntensity * uTint + vec3(
    texture2D(uGlare, uvR).r,
    texture2D(uGlare, vUv).g,
    texture2D(uGlare, uvB).b
  );

  // 暗角在曝光與色調映射之前：它是鏡頭少收了光，不是事後把畫面壓暗。
  // 用畫面對角線正規化，比例才不隨長寬比改變。
  float vignette = 1.0;
  if (uVignette > 0.0) {
    float r = length(centered * vec2(uAspect, 1.0)) * 1.4142;
    vignette = mix(1.0, 1.0 - smoothstep(0.35, 1.05, r), uVignette);
  }

  vec3 lit = (base.rgb * (uTransparent < 0.5 ? 1.0 : base.a) + bloom) * vignette * uExposure;
  vec3 color = applyToneMap(lit);

  // 顆粒最後才加，而且加在色調映射之後：它是底片／感光元件上的東西，不是場景裡的
  // 光。暗部給多一點、亮部給少一點，跟真實的訊噪比一致。
  if (uGrain > 0.0) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float n = grainNoise(floor(gl_FragCoord.xy / max(uGrainScale, 0.25)), uGrainSeed) - 0.5;
    color += n * uGrain * mix(1.0, 0.35, luma) * (uTransparent < 0.5 ? 1.0 : base.a);
  }

  if (uTransparent < 0.5) {
    gl_FragColor = vec4(color, base.a);
    return;
  }
  float alpha = clamp(base.a + max(bloom.r, max(bloom.g, bloom.b)), 0.0, 1.0);
  gl_FragColor = vec4(color / max(alpha, 0.0001), alpha);
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
// 條紋的迭代輪數。每多一輪，覆蓋距離乘四；成本是每個方向多一個 pass。
const STREAK_PASSES = 4;
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
    uWeight: { value: 0.7 },
  });
  const streakMaterial = makeMaterial(STREAK_FRAG, {
    uTex: { value: null },
    uStep: { value: new THREE.Vector2() },
    uStride: { value: 1 },
    uAtten: { value: new THREE.Vector3(0.9, 0.9, 0.9) },
  });
  const copyMaterial = makeMaterial(COPY_FRAG, {
    uTex: { value: null },
    uScale: { value: 1 },
  });
  const compositeMaterial = makeMaterial(COMPOSITE_FRAG, {
    uScene: { value: null },
    uBloom: { value: null },
    uGlare: { value: null },
    uIntensity: { value: 0.6 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTransparent: { value: 0 },
    uExposure: { value: 1 },
    uToneMap: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uGrainScale: { value: 1 },
    uGrainSeed: { value: 0 },
    uAspect: { value: 1 },
  });

  // bloom 關著（強度 0）時整條模糊鏈都不跑，合成 pass 仍需要一張圖可以取樣。
  const blackPixel = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackPixel.colorSpace = THREE.NoColorSpace;
  blackPixel.needsUpdate = true;

  let sceneTarget = null;
  // 條紋的累積緩衝與 ping-pong。跑在四分之一解析度：條紋本來就是大範圍的低頻
  // 結構，半解析度看不出差別，但 pass 數是四個方向 × 四輪。
  let glareTarget = null;
  let glarePing = null;
  let glarePong = null;
  let levels = [];
  let width = 0;
  let height = 0;
  let divisor = 0;
  let sceneType = null;

  function blit(material, target, additive = false) {
    quad.material = material;
    material.blending = additive ? THREE.AdditiveBlending : THREE.NoBlending;
    renderer.setRenderTarget(target);
    // 累加的那幾筆不能讓 renderer 先清掉畫面 —— 四個方向的條紋是一筆一筆疊上去的。
    if (additive) renderer.autoClear = false;
    renderer.render(quadScene, quadCamera);
    renderer.autoClear = true;
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
    const glare = levels[Math.min(1, levels.length - 1)];
    glareTarget = createTarget(glare.width, glare.height);
    glarePing = createTarget(glare.width, glare.height);
    glarePong = createTarget(glare.width, glare.height);
  }

  function dispose() {
    if (sceneTarget) sceneTarget.dispose();
    sceneTarget = null;
    for (const rt of [glareTarget, glarePing, glarePong]) if (rt) rt.dispose();
    glareTarget = glarePing = glarePong = null;
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

    const wantsBloom = params.intensity > 0;
    const wantsStreaks = params.streaks && params.streakIntensity > 0;

    // 亮部只取一次，bloom 與條紋共用同一張 —— 它們講的本來就是同一件事（畫面上
    // 哪些地方在發光），分兩份門檻只會讓兩個效果對不起來。
    if (wantsBloom || wantsStreaks) {
      thresholdMaterial.uniforms.uScene.value = sceneTarget.texture;
      thresholdMaterial.uniforms.uThreshold.value = params.threshold;
      thresholdMaterial.uniforms.uKnee.value = params.knee;
      thresholdMaterial.uniforms.uPremultiply.value = params.transparent ? 1 : 0;
      blit(thresholdMaterial, levels[0].down);
    }

    if (wantsBloom) {
      for (let i = 1; i < levels.length; i++) {
        const source = levels[i - 1];
        downMaterial.uniforms.uTex.value = source.down.texture;
        downMaterial.uniforms.uHalfTexel.value.set(0.5 / source.width, 0.5 / source.height);
        blit(downMaterial, levels[i].down);
      }
    }

    const glareTexture = wantsStreaks ? renderStreaks(params) : blackPixel;

    if (!wantsBloom) {
      // 只有曝光／色調映射／條紋在用時，跳過升採鏈 —— 那是十幾個 pass，不該為了
      // 一次乘法白跑。
      composite(target, params, blackPixel, glareTexture, 0);
      return;
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
      // 滑桿 0–1 → 權重 0–2，見 UP_FRAG 上方對稀釋的說明。
      upMaterial.uniforms.uWeight.value = params.radius * 2.0;
      blit(upMaterial, levels[i].up);
      lower = levels[i];
      lowerTexture = levels[i].up.texture;
    }

    // 只有一層時升採迴圈一次都沒跑，光暈就是那層降採的結果。
    composite(target, params, lowerTexture, glareTexture, params.intensity);
  }

  function composite(target, params, bloomTexture, glareTexture, intensity) {
    compositeMaterial.uniforms.uScene.value = sceneTarget.texture;
    compositeMaterial.uniforms.uBloom.value = bloomTexture;
    compositeMaterial.uniforms.uGlare.value = glareTexture;
    compositeMaterial.uniforms.uIntensity.value = intensity;
    compositeMaterial.uniforms.uTint.value.copy(params.tint);
    compositeMaterial.uniforms.uTransparent.value = params.transparent ? 1 : 0;
    compositeMaterial.uniforms.uExposure.value = params.exposure;
    compositeMaterial.uniforms.uToneMap.value = params.toneMap;
    compositeMaterial.uniforms.uAberration.value = params.aberration;
    compositeMaterial.uniforms.uVignette.value = params.vignette;
    compositeMaterial.uniforms.uGrain.value = params.grain;
    // 顆粒以「最終成品的像素」為單位：匯出是超採樣的，不除回去的話成品的顆粒會
    // 細到看不見。
    compositeMaterial.uniforms.uGrainScale.value = params.grainScale
      * Math.max(1, params.superSample || 1);
    compositeMaterial.uniforms.uGrainSeed.value = params.grainSeed;
    compositeMaterial.uniforms.uAspect.value = width / Math.max(1, height);
    blit(compositeMaterial, target || null);
    renderer.setRenderTarget(null);
  }

  // 每個方向的條紋都疊進同一顆緩衝，合成階段只多讀一張圖。
  function renderStreaks(params) {
    const source = levels[0].down.texture;
    renderer.setRenderTarget(glareTarget);
    renderer.clear();

    {
      const count = Math.max(1, Math.round(params.streakCount));
      const texel = 1 / glareTarget.width;
      // 每個通道的衰減。色彩調變讓紅衰得比藍慢，光芒外段因此偏暖。
      // 滑桿是「長度」0–1，這裡換算成每個取樣間距的衰減率。在對數空間內插：
      // 0 → 0.80（很短的光暈），1 → 0.996（跨越整個畫面）。線性內插不行 ——
      // 尾端的權重是 atten^255，0.99 與 0.995 差了 3.6 倍，靠近 1 的那一段必須
      // 有足夠的解析度。
      const t = Math.min(Math.max(params.streakLength, 0), 1);
      const atten = Math.exp(-Math.exp(Math.log(0.2231) * (1 - t) + Math.log(0.0040) * t));
      // 通道之間的差距必須很小：權重是 atten^(stride*k)，指數最大會到 192，
      // 差 1% 到了尾端就整個分家。第一版用 6%／12%，結果整條光芒變成純橙色。
      // 係數要跟著長度縮：權重是 atten^(stride*k)，四輪之後指數上看 192，1% 的
      // 通道差在尾端就是 10 倍，光芒會斷成一段一段的色帶。除以 (1 + 長度 × 3)
      // 讓短光芒仍有明顯色散、長光芒維持連續。
      const chroma = params.streakChroma / (1 + t * 3);
      streakMaterial.uniforms.uAtten.value.set(
        atten,
        atten * (1 - chroma * 0.010),
        atten * (1 - chroma * 0.022),
      );
      for (let i = 0; i < count; i++) {
        // 方向平均分布在整圈。這裡不能只跑半圈 —— 濾波只沿著 +dir 前進（那是它
        // 便宜的原因），一個方向只長出一條臂，跑半圈的話星芒是單邊的。
        const angle = (params.streakAngle * Math.PI) / 180 + (Math.PI * 2 * i) / count;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle) * (glareTarget.width / glareTarget.height);
        let readTarget = glarePing;
        let writeTarget = glarePong;
        for (let pass = 0; pass < STREAK_PASSES; pass++) {
          const stride = Math.pow(4, pass);
          streakMaterial.uniforms.uTex.value = pass === 0 ? source : readTarget.texture;
          streakMaterial.uniforms.uStride.value = stride;
          streakMaterial.uniforms.uStep.value.set(dirX * texel * stride, dirY * texel * stride);
          blit(streakMaterial, writeTarget);
          const swap = readTarget; readTarget = writeTarget; writeTarget = swap;
        }
        // 跑完之後結果在 readTarget（最後一次交換過）。除以 sqrt(方向數) 而不是
        // 方向數：條紋的臂彼此不重疊，除以 count 等於「臂越多每條越暗」，四條就
        // 只剩四分之一 —— 那正是它看起來弱的另一半原因。開平方是兩者的折衷：
        // 臂變多時整體亮度略升，但單條不會塌掉。
        copyMaterial.uniforms.uTex.value = readTarget.texture;
        copyMaterial.uniforms.uScale.value = params.streakIntensity / Math.sqrt(count);
        blit(copyMaterial, glareTarget, true);
      }
    }

    return glareTarget.texture;
  }

  return { render, dispose };
}
