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

// 亮部取出。這一步同時做「第一次降採」—— 從全解析度的畫面降到半解析度的亮部
// 緩衝，而降採的方式決定了整個光暈乾不乾淨：
//
//   * 13 tap 的取樣圖樣（COD Advanced Warfare 那篇提出、EEVEE 也是這一套）：
//     四個角落各一組 2×2、中央一組 2×2，權重 0.125×4 + 0.5。單純的雙線性一個
//     tap（第一版的作法）會漏掉一半的像素，糊出來帶著取樣的結構感。
//   * Karis 平均：每一組 2×2 以 1/(1+亮度) 加權。少了它，單一個過亮的像素會主導
//     整條 mip 鏈，在動畫裡表現成一閃一閃的螢火蟲；這是 bloom 最典型的雜訊來源。
//
// soft knee：門檻附近平滑過渡，不然高光邊緣會沿著等亮度線切出一圈硬邊，而且
// 鏡頭一動那圈邊就會跳。uClamp 是進 bloom 之前的上限（EEVEE 也有這一根）：
// 沒有它，一顆極亮的像素就能把整片光暈拉爆，使用者只能回頭壓門檻。
const THRESHOLD_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
// 背景亮度。門檻是「比背景亮多少」，不是絕對值 —— 光暈的物理意義是「超出周遭
// 環境的那部分能量散進鏡頭」，而不是「絕對值大於 1 的像素」。
//
// 黑底時它是 0，門檻與行為完全不變。白底時它是 1，門檻自動抬到 1 + 1：這才擋得住
// 「整顆球因為透出白背景而被當成光源」—— 那正是換白底之後物體整個爆掉消失的原因
// （球本身透過去就已經接近 1，配上為暗底校的門檻 1.0，整顆球都算高光）。
uniform float uBackdrop;
// alpha 在這裡一律代表「這個像素有多少是物體」：不透明算繪時它是主 shader 寫進來
// 的物件遮罩（uCoverageAlpha），去背輸出時它是 straight alpha 的覆蓋率。兩種情況
// 都要乘上去 —— 背景不是光源。
//
// 少了這一步，白底會被整片當成高光餵進 bloom 與條紋，糊回來之後蓋掉整個畫面，
// 症狀就是「換成白背景之後物體消失」。
uniform float uMaskByAlpha;

vec3 fetch(vec2 uv){
  vec4 s = texture2D(uScene, uv);
  vec3 c = s.rgb * mix(1.0, s.a, uMaskByAlpha);
  return min(c, vec3(uClamp));
}

float karisWeight(vec3 c){
  return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
}

vec3 karisAverage(vec3 a, vec3 b, vec3 c, vec3 d){
  float wa = karisWeight(a);
  float wb = karisWeight(b);
  float wc = karisWeight(c);
  float wd = karisWeight(d);
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}

void main(){
  vec2 t = uTexel;
  vec3 a = fetch(vUv + vec2(-2.0,  2.0) * t);
  vec3 b = fetch(vUv + vec2( 0.0,  2.0) * t);
  vec3 c = fetch(vUv + vec2( 2.0,  2.0) * t);
  vec3 d = fetch(vUv + vec2(-2.0,  0.0) * t);
  vec3 e = fetch(vUv);
  vec3 f = fetch(vUv + vec2( 2.0,  0.0) * t);
  vec3 g = fetch(vUv + vec2(-2.0, -2.0) * t);
  vec3 h = fetch(vUv + vec2( 0.0, -2.0) * t);
  vec3 i = fetch(vUv + vec2( 2.0, -2.0) * t);
  vec3 j = fetch(vUv + vec2(-1.0,  1.0) * t);
  vec3 k = fetch(vUv + vec2( 1.0,  1.0) * t);
  vec3 l = fetch(vUv + vec2(-1.0, -1.0) * t);
  vec3 m = fetch(vUv + vec2( 1.0, -1.0) * t);

  vec3 sum = karisAverage(j, k, l, m) * 0.5;
  sum += karisAverage(a, b, d, e) * 0.125;
  sum += karisAverage(b, c, e, f) * 0.125;
  sum += karisAverage(d, e, g, h) * 0.125;
  sum += karisAverage(e, f, h, i) * 0.125;

  float br = max(sum.r, max(sum.g, sum.b));
  float threshold = uThreshold + uBackdrop;
  float knee = threshold * uKnee + 1e-5;
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float contrib = max(soft, br - threshold) / max(br, 1e-5);
  gl_FragColor = vec4(sum * contrib, 1.0);
}
`;

// 之後每一層的降採用同一套 13 tap，但不再做 Karis 平均 —— 螢火蟲在第一層就已經
// 被壓掉，後面幾層再做只會白白讓光暈變暗（Karis 是加權平均，對高光有壓縮效果）。
const DOWN_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec3 a = texture2D(uTex, vUv + vec2(-2.0,  2.0) * t).rgb;
  vec3 b = texture2D(uTex, vUv + vec2( 0.0,  2.0) * t).rgb;
  vec3 c = texture2D(uTex, vUv + vec2( 2.0,  2.0) * t).rgb;
  vec3 d = texture2D(uTex, vUv + vec2(-2.0,  0.0) * t).rgb;
  vec3 e = texture2D(uTex, vUv).rgb;
  vec3 f = texture2D(uTex, vUv + vec2( 2.0,  0.0) * t).rgb;
  vec3 g = texture2D(uTex, vUv + vec2(-2.0, -2.0) * t).rgb;
  vec3 h = texture2D(uTex, vUv + vec2( 0.0, -2.0) * t).rgb;
  vec3 i = texture2D(uTex, vUv + vec2( 2.0, -2.0) * t).rgb;
  vec3 j = texture2D(uTex, vUv + vec2(-1.0,  1.0) * t).rgb;
  vec3 k = texture2D(uTex, vUv + vec2( 1.0,  1.0) * t).rgb;
  vec3 l = texture2D(uTex, vUv + vec2(-1.0, -1.0) * t).rgb;
  vec3 m = texture2D(uTex, vUv + vec2( 1.0, -1.0) * t).rgb;
  vec3 sum = (j + k + l + m) * 0.125;
  sum += (a + b + d + e) * 0.03125;
  sum += (b + c + e + f) * 0.03125;
  sum += (d + e + g + h) * 0.03125;
  sum += (e + f + h + i) * 0.03125;
  gl_FragColor = vec4(sum, 1.0);
}
`;

// 升採：把下一層（更小、更糊）的結果用 3×3 帳篷濾波放大之後，「加」到本層上。
//
// 帳篷（1 2 1 / 2 4 2 / 1 2 1）而不是單純的雙線性：雙線性放大會留下軸向的方塊
// 結構，一層一層疊上來會變成看得見的格狀花紋。這是 mip 鏈 bloom 的標準作法。
//
// 為什麼是「加」而不是 mix(here, lower, radius)：降採是平均，一小塊高光被攤到
// 4 倍面積之後每像素只剩四分之一，六層下來是千分之一。取代式混合等於「把緊實的
// 光暈換成一片看不見的霧」—— 實測過，擴散範圍從 0 拉到 1，畫面中線上的亮像素
// 只從 549 變成 590，也就是「看不出差別」。
//
// uWeight 可以大於 1（滑桿 0–1 對應 0–2），乘 2 抵掉一半的稀釋，寬的那幾層才有
// 可見的振幅。總亮度則由合成階段除掉，所以這根滑桿只改「散多開」。
const UP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uLower;
uniform sampler2D uHere;
uniform vec2 uTexel;
uniform float uWeight;
void main(){
  vec2 t = uTexel;
  vec3 sum = texture2D(uLower, vUv + vec2(-1.0,  1.0) * t).rgb;
  sum += texture2D(uLower, vUv + vec2( 0.0,  1.0) * t).rgb * 2.0;
  sum += texture2D(uLower, vUv + vec2( 1.0,  1.0) * t).rgb;
  sum += texture2D(uLower, vUv + vec2(-1.0,  0.0) * t).rgb * 2.0;
  sum += texture2D(uLower, vUv).rgb * 4.0;
  sum += texture2D(uLower, vUv + vec2( 1.0,  0.0) * t).rgb * 2.0;
  sum += texture2D(uLower, vUv + vec2(-1.0, -1.0) * t).rgb;
  sum += texture2D(uLower, vUv + vec2( 0.0, -1.0) * t).rgb * 2.0;
  sum += texture2D(uLower, vUv + vec2( 1.0, -1.0) * t).rgb;
  vec3 lower = sum / 16.0;
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
uniform float uContrast;
uniform float uBrightness;
uniform float uGrain;
uniform float uGrainScale;
uniform float uGrainSeed;

// 對照 Blender 的色調映射選單（Color Management → View Transform）。除了 AgX、
// Filmic、ACES 都是 LUT／完整色彩空間轉換，這裡放的是業界公認的即時擬合 ——
// 跟 Godot／Bevy／Filament「支援 AgX」時用的是同一批公式，觀感接近但不是逐位元
// 相同。Blender 選單裡的 Filmic Log 與 False Color 是合成器的除錯顯示模式，
// 不是給成品用的色調映射，這裡不提供。
//
// 0 無      對應 Standard／Raw：只交給輸出格式夾掉，等於後處理加入之前的行為。
// 1 Reinhard  c/(1+c)。不在 Blender 的選單裡，留著當最陽春的參考基準。
// 2 ACES    Narkowicz 的曲線擬合，不是完整的 ACES RRT+ODT。高光滾降得晚、對比
//           保留得好，是「電影感」那條。0.6 是把它對齊「1.0 大致仍是 1.0」的
//           常用係數。
// 3 AgX     矩陣＋log2 編碼＋多項式擬合，近似 Blender 預設的 AgX look。特徵是
//           高光先偏黃再收，飽和色會被「拉回」而不是死白，這是 AgX 讀起來比
//           Filmic 更耐看的原因。
// 4 Khronos PBR Neutral   khronos.org 發布的公開規格，這裡是精確實作（不是
//           近似）：中間調幾乎不動，只在高光壓縮並帶一點去飽和。glTF 生態系
//           的標準檢視器都用這條，所以拿它跟其他軟體對圖最不容易對不起來。
// 5 Filmic  Hable／Uncharted 2 算子，觀感類似但非 Blender Filmic 那條真正的
//           曲線（那是一整份 LUT）。
vec3 toneReinhard(vec3 c){ return c / (1.0 + c); }

vec3 toneACES(vec3 c){
  vec3 x = c * 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// 社群公認的 AgX 極簡擬合（Troy Sobotka 的 AgX 出發，經 Benjamin Wrensch 等人
// 簡化成矩陣＋多項式版本，Godot 4 / Bevy 都採這一版）。
const mat3 AGX_INSET = mat3(
  0.856627153315983, 0.0951212405381588, 0.0482516061458583,
  0.137318972929847, 0.761241990602591,  0.101439036467562,
  0.11189821299995,  0.0767994186031903, 0.811302368396859
);
const mat3 AGX_OUTSET = mat3(
  1.1271005818144368,  -0.1413297634984383,  -0.14132976349843826,
  -0.11060664309660323,  1.157823702216272,  -0.11060664309660294,
  -0.016493938717834573,-0.016493938717834257, 1.2519364065950405
);
vec3 agxContrastApprox(vec3 x){
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
    - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 toneAgX(vec3 c){
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  vec3 v = AGX_INSET * max(c, vec3(0.0));
  v = max(v, vec3(1e-10));
  v = (log2(v) - minEv) / (maxEv - minEv);
  v = clamp(v, 0.0, 1.0);
  v = agxContrastApprox(v);
  v = AGX_OUTSET * v;
  return pow(max(v, vec3(0.0)), vec3(2.2));
}

// Khronos PBR Neutral，逐字照官方參考實作：
// https://github.com/KhronosGroup/glTF-Sample-Renderer/blob/main/source/Renderer/shaders/tonemapping.glsl
vec3 tonePBRNeutral(vec3 c){
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(c.r, min(c.g, c.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= offset;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) return max(c, vec3(0.0));
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(c, vec3(newPeak), g);
}

vec3 toneFilmic(vec3 c){
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  const float whiteScale = 1.0 / (((11.2 * (A * 11.2 + C * B) + D * E)
    / (11.2 * (A * 11.2 + B) + D * F)) - E / F);
  vec3 x = c * 2.0;
  vec3 mapped = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
  return clamp(mapped * whiteScale, 0.0, 1.0);
}

vec3 applyToneMap(vec3 c){
  if (uToneMap == 1) return toneReinhard(c);
  if (uToneMap == 2) return toneACES(c);
  if (uToneMap == 3) return toneAgX(c);
  if (uToneMap == 4) return tonePBRNeutral(c);
  if (uToneMap == 5) return toneFilmic(c);
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

  vec3 lit = (base.rgb * (uTransparent < 0.5 ? 1.0 : base.a) + bloom) * uExposure;
  vec3 color = applyToneMap(lit);

  // 對比與亮度是「調色」，所以放在色調映射之後：那時候的值才是實際要顯示的
  // 畫面，拉對比拉到的是眼睛看到的反差。放在之前的話會先被色調映射的滾降吃掉
  // 一大半，滑桿推起來會覺得沒力。
  //
  // 這兩根跟上面的「曝光」是不同的東西，不是重複：曝光是場景端的乘法（進 bloom
  // 門檻之前就生效，會改變哪些地方在發光），這兩根純粹是最後的畫面調整。
  //
  // 對比以 0.5 為樞紐：中間調不動，亮的更亮、暗的更暗。亮度是加法偏移，
  // 對整條曲線平移 —— 這是「亮度／對比」這組配對的標準定義。
  //
  // 只作用在主體上：base.a 是物件遮罩（見主 shader 的 uCoverageAlpha），背景是 0。
  // 調色調的是「這顆水滴」，不是整張畫布 —— 背景本來就由背景色決定，被對比拉走
  // 只會讓人以為背景色設錯了。
  if (uContrast != 1.0 || uBrightness != 0.0) {
    vec3 graded = color;
    if (uContrast != 1.0) graded = (graded - 0.5) * uContrast + 0.5;
    graded = max(graded + uBrightness, vec3(0.0));
    color = mix(color, graded, clamp(base.a, 0.0, 1.0));
  }

  // 顆粒最後才加，而且加在色調映射之後：它是底片／感光元件上的東西，不是場景裡的
  // 光。暗部給多一點、亮部給少一點，跟真實的訊噪比一致。
  if (uGrain > 0.0) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float n = grainNoise(floor(gl_FragCoord.xy / max(uGrainScale, 0.25)), uGrainSeed) - 0.5;
    color += n * uGrain * mix(1.0, 0.35, luma) * (uTransparent < 0.5 ? 1.0 : base.a);
  }

  if (uTransparent < 0.5) {
    // base.a 這時候是物件遮罩，不是真的 alpha —— 不透明輸出一律寫 1，否則
    // 「背景用場景色」的匯出 PNG 會變成去背的。
    gl_FragColor = vec4(color, 1.0);
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
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 0.75 },
    uKnee: { value: 0.5 },
    uClamp: { value: 8 },
    uBackdrop: { value: 0 },
    uMaskByAlpha: { value: 0 },
  });
  const downMaterial = makeMaterial(DOWN_FRAG, {
    uTex: { value: null },
    uTexel: { value: new THREE.Vector2() },
  });
  const upMaterial = makeMaterial(UP_FRAG, {
    uLower: { value: null },
    uHere: { value: null },
    uTexel: { value: new THREE.Vector2() },
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
    uContrast: { value: 1 },
    uBrightness: { value: 0 },
    uGrain: { value: 0 },
    uGrainScale: { value: 1 },
    uGrainSeed: { value: 0 },
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
      // 取樣間距用「來源」的 texel：13 tap 的圖樣是相對於被降採的那一張圖定義的。
      thresholdMaterial.uniforms.uTexel.value.set(1 / width, 1 / height);
      thresholdMaterial.uniforms.uThreshold.value = params.threshold;
      thresholdMaterial.uniforms.uKnee.value = params.knee;
      thresholdMaterial.uniforms.uClamp.value = params.clampMax;
      thresholdMaterial.uniforms.uBackdrop.value = params.backdrop;
      // 去背輸出的 alpha 是覆蓋率、不透明算繪的 alpha 是物件遮罩 —— 兩種都要乘。
      thresholdMaterial.uniforms.uMaskByAlpha.value = 1;
      blit(thresholdMaterial, levels[0].down);
    }

    if (wantsBloom) {
      for (let i = 1; i < levels.length; i++) {
        const source = levels[i - 1];
        downMaterial.uniforms.uTex.value = source.down.texture;
        downMaterial.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
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
      upMaterial.uniforms.uTexel.value.set(1 / lower.width, 1 / lower.height);
      // 滑桿 0–1 → 權重 0–2，見 UP_FRAG 上方對稀釋的說明。
      upMaterial.uniforms.uWeight.value = params.radius * 2.0;
      blit(upMaterial, levels[i].up);
      lower = levels[i];
      lowerTexture = levels[i].up.texture;
    }

    // 只有一層時升採迴圈一次都沒跑，光暈就是那層降採的結果。
    //
    // 強度要除掉「擴散範圍帶進來的額外亮度」，兩根滑桿才各自只做一件事：擴散只改
    // 散多開、強度只改多亮。除數不是權重總和（那是總能量，除下去核心會暗六十幾倍），
    // 而是實測出來的峰值增益 —— 每往上疊一層，核心大約多拿到 0.55 倍的權重。
    const spreadGain = 1 + params.radius * 2.0 * 0.55;
    composite(target, params, lowerTexture, glareTexture, params.intensity / spreadGain);
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
    compositeMaterial.uniforms.uContrast.value = params.contrast;
    compositeMaterial.uniforms.uBrightness.value = params.brightness;
    compositeMaterial.uniforms.uGrain.value = params.grain;
    // 顆粒以「最終成品的像素」為單位：匯出是超採樣的，不除回去的話成品的顆粒會
    // 細到看不見。
    compositeMaterial.uniforms.uGrainScale.value = params.grainScale
      * Math.max(1, params.superSample || 1);
    compositeMaterial.uniforms.uGrainSeed.value = params.grainSeed;
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
