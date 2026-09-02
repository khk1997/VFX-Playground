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
// 方向取四個等距樣本、權重指數遞減，下一輪把步距乘四，三輪之後有效長度是 4^3 = 64
// 個取樣間距 —— 用 12 次取樣換到一條很長的光芒，而不是老實地沿線積分幾百次。
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

// 鏡頭鬼影（Blender Glare 的 Ghosts）。鬼影是光在鏡片組之間來回反射之後，落在
// 「光源—畫面中心」連線上的一串像 —— 所以做法就是把亮部緩衝以中心為原點做不同
// 倍率的縮放（含負值＝穿過中心翻到另一側）再疊起來。
//
// 取樣的來源是模糊過的那一層，不是銳利的亮部緩衝：真實的鬼影是嚴重離焦的光斑，
// 拿銳利的圖去縮放會直接認得出原本的形狀（實測第一版看得出是球的輪廓弧線），
// 那一眼就是假的。
//
// 兩個讓它像真鏡頭而不像貼圖的細節：
//   1. RGB 各自用略微不同的倍率取樣，鬼影邊緣因此帶一圈色散。
//   2. 越靠近畫面邊緣的鬼影越暗（真實鏡頭的鬼影在中心附近最亮），而且取樣點超出
//      畫面時必須淡出，否則會沿著邊界拖出一條硬邊。
const GHOST_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uCount;
uniform float uSpread;
uniform float uIntensity;
uniform float uChroma;
uniform vec2 uSourceTexel;

// 取樣來源是 1/32 解析度的那一層，放大回全螢幕時雙線性內插會留下軸向的方塊結構
// —— 鬼影因此看起來是柔邊的長方形，而不是離焦的圓斑。四個對角補樣把那個結構抹掉，
// 成本是每顆鬼影多九次取樣，而這一整個 pass 跑在四分之一解析度上。
vec3 tap(vec2 uvR, vec2 uvG, vec2 uvB){
  vec2 o = uSourceTexel * 0.75;
  vec3 acc = vec3(0.0);
  acc.r = 0.25 * (texture2D(uTex, uvR + o).r + texture2D(uTex, uvR - o).r
    + texture2D(uTex, uvR + vec2(o.x, -o.y)).r + texture2D(uTex, uvR - vec2(o.x, -o.y)).r);
  acc.g = 0.25 * (texture2D(uTex, uvG + o).g + texture2D(uTex, uvG - o).g
    + texture2D(uTex, uvG + vec2(o.x, -o.y)).g + texture2D(uTex, uvG - vec2(o.x, -o.y)).g);
  acc.b = 0.25 * (texture2D(uTex, uvB + o).b + texture2D(uTex, uvB - o).b
    + texture2D(uTex, uvB + vec2(o.x, -o.y)).b + texture2D(uTex, uvB - vec2(o.x, -o.y)).b);
  return acc;
}

vec3 sampleGhost(vec2 centered, float scale){
  // 通道之間只差 1.5%：鬼影本來就離光源很遠，位移是「距離 × 比例」，1.5% 在畫面上
  // 已經是好幾個像素的邊緣色散。第一版用 6%，結果三個通道整個分家，變成紅綠藍三條
  // 分開的色棒，不是鏡頭鬼影。
  vec2 uvR = 0.5 + centered * scale * (1.0 + uChroma * 0.015);
  vec2 uvG = 0.5 + centered * scale;
  vec2 uvB = 0.5 + centered * scale * (1.0 - uChroma * 0.015);
  vec3 c = tap(uvR, uvG, uvB);
  // 取樣點離開畫面就淡出，不然會沿著邊界拖出一條硬邊。
  vec2 edge = abs(uvG - 0.5) * 2.0;
  float inside = (1.0 - smoothstep(0.85, 1.0, max(edge.x, edge.y)));
  return c * inside;
}

void main(){
  vec2 centered = vUv - 0.5;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uCount) break;
    float t = float(i);
    // 倍率正負交錯：鬼影會分布在光源與中心連線的兩側。0.45 起跳、每顆遞增，
    // 是照鏡頭鬼影常見的疏密感排的，不是均勻分布 —— 均勻分布看起來像刻意畫的。
    float scale = (0.45 + 0.38 * t) * (mod(t, 2.0) < 0.5 ? -1.0 : 1.0);
    // 越後面的鬼影越暗。
    float weight = 1.0 / (1.0 + t * 0.85);
    acc += sampleGhost(centered, scale) * weight;
  }
  gl_FragColor = vec4(acc * uIntensity, 1.0);
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
  // 光暈與眩光都是「加上去的光」，所以先加在一起再一起走曝光與色調映射 ——
  // 分開套會讓同一道光在不同效果之間有不同的滾降。
  vec3 bloom = texture2D(uBloom, vUv).rgb * uIntensity * uTint
    + texture2D(uGlare, vUv).rgb;
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
// 鬼影取樣的那一層。第 4 層是 1/32 解析度 —— 要這麼糊是因為這個場景的亮部不是
// 一顆小太陽，而是一顆玻璃球上細長的高光弧。用 1/8 去縮放，鬼影會清楚地讀成
// 「那顆球的邊緣被搬過來」，一眼就假；糊到 1/32 之後才變成離焦的光斑。
const GHOST_MIP = 4;
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
  const ghostMaterial = makeMaterial(GHOST_FRAG, {
    uTex: { value: null },
    uSourceTexel: { value: new THREE.Vector2() },
    uCount: { value: 3 },
    uSpread: { value: 1 },
    uIntensity: { value: 1 },
    uChroma: { value: 0.5 },
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
  });

  // bloom 關著（強度 0）時整條模糊鏈都不跑，合成 pass 仍需要一張圖可以取樣。
  const blackPixel = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackPixel.colorSpace = THREE.NoColorSpace;
  blackPixel.needsUpdate = true;

  let sceneTarget = null;
  // 眩光（條紋＋鬼影）的累積緩衝與 ping-pong。跑在四分之一解析度：條紋本來就是
  // 大範圍的低頻結構，半解析度看不出差別，但 pass 數是四個方向 × 三輪。
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
    const wantsGhosts = params.ghosts && params.ghostIntensity > 0;

    // 亮部只取一次，bloom 與眩光共用同一張 —— 它們講的本來就是同一件事（畫面上
    // 哪些地方在發光），分兩份門檻只會讓兩個效果對不起來。
    if (wantsBloom || wantsStreaks || wantsGhosts) {
      thresholdMaterial.uniforms.uScene.value = sceneTarget.texture;
      thresholdMaterial.uniforms.uThreshold.value = params.threshold;
      thresholdMaterial.uniforms.uKnee.value = params.knee;
      thresholdMaterial.uniforms.uPremultiply.value = params.transparent ? 1 : 0;
      blit(thresholdMaterial, levels[0].down);
    }

    // 降採鏈：bloom 需要全部的層，鬼影只需要前幾層（它拿模糊過的那一層當光斑）。
    if (wantsBloom || wantsGhosts) {
      const depth = wantsBloom ? levels.length : Math.min(levels.length, GHOST_MIP + 1);
      for (let i = 1; i < depth; i++) {
        const source = levels[i - 1];
        downMaterial.uniforms.uTex.value = source.down.texture;
        downMaterial.uniforms.uHalfTexel.value.set(0.5 / source.width, 0.5 / source.height);
        blit(downMaterial, levels[i].down);
      }
    }

    let glareTexture = blackPixel;
    if (wantsStreaks || wantsGhosts) {
      glareTexture = renderGlare(params, wantsStreaks, wantsGhosts);
    }

    if (!wantsBloom) {
      // 只有曝光／色調映射／眩光在用時，跳過升採鏈 —— 那是十幾個 pass，不該為了
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
    blit(compositeMaterial, target || null);
    renderer.setRenderTarget(null);
  }

  // 條紋與鬼影都疊進同一顆眩光緩衝，合成階段只多讀一張圖。
  function renderGlare(params, wantsStreaks, wantsGhosts) {
    const source = levels[0].down.texture;
    renderer.setRenderTarget(glareTarget);
    renderer.clear();

    if (wantsStreaks) {
      const count = Math.max(1, Math.round(params.streakCount));
      const texel = 1 / glareTarget.width;
      // 每個通道的衰減。色彩調變讓紅衰得比藍慢，光芒外段因此偏暖。
      // 通道之間的差距必須很小：權重是 atten^(stride*k)，指數最大會到 48，
      // 差 1% 到了尾端就是 0.6 倍。第一版用 6%／12%，結果整條光芒變成純橙色。
      const atten = params.streakAttenuation;
      streakMaterial.uniforms.uAtten.value.set(
        atten,
        atten * (1 - params.streakChroma * 0.010),
        atten * (1 - params.streakChroma * 0.022),
      );
      for (let i = 0; i < count; i++) {
        // 方向平均分布在整圈。這裡不能只跑半圈 —— 濾波只沿著 +dir 前進（那是它
        // 便宜的原因），一個方向只長出一條臂，跑半圈的話星芒是單邊的。
        const angle = (params.streakAngle * Math.PI) / 180 + (Math.PI * 2 * i) / count;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle) * (glareTarget.width / glareTarget.height);
        let readTarget = glarePing;
        let writeTarget = glarePong;
        for (let pass = 0; pass < 3; pass++) {
          const stride = Math.pow(4, pass);
          streakMaterial.uniforms.uTex.value = pass === 0 ? source : readTarget.texture;
          streakMaterial.uniforms.uStride.value = stride;
          streakMaterial.uniforms.uStep.value.set(dirX * texel * stride, dirY * texel * stride);
          blit(streakMaterial, writeTarget);
          const swap = readTarget; readTarget = writeTarget; writeTarget = swap;
        }
        // 三輪之後結果在 readTarget（最後一次交換過）。每個方向的強度先除以方向數，
        // 加起來才不會因為條紋變多而整體變亮 —— 數量那根滑桿只該改造型。
        copyMaterial.uniforms.uTex.value = readTarget.texture;
        copyMaterial.uniforms.uScale.value = params.streakIntensity / count;
        blit(copyMaterial, glareTarget, true);
      }
    }

    if (wantsGhosts) {
      const ghostSource = levels[Math.min(GHOST_MIP, levels.length - 1)];
      ghostMaterial.uniforms.uTex.value = ghostSource.down.texture;
      ghostMaterial.uniforms.uSourceTexel.value.set(1 / ghostSource.width, 1 / ghostSource.height);
      ghostMaterial.uniforms.uCount.value = Math.round(params.ghostCount);
      ghostMaterial.uniforms.uSpread.value = params.ghostSpread;
      ghostMaterial.uniforms.uIntensity.value = params.ghostIntensity;
      ghostMaterial.uniforms.uChroma.value = params.ghostChroma;
      blit(ghostMaterial, glareTarget, true);
    }
    return glareTarget.texture;
  }

  return { render, dispose };
}
