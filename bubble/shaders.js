/* ===== 著色器 ===== */
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.02; a *= 0.5; }
  return s;
}
// 距離場專用的低成本版本；薄膜上色仍使用上方完整 4 octave。
float fbmFast(vec3 p){
  float s = 0.5 * snoise(p);
  s += 0.25 * snoise(p * 2.02);
  return s;
}
`;

// 全螢幕：頂點著色器直接輸出 clip 座標（忽略相機），frag 內自建相機射線做 raymarch
const VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uLoopDuration;
uniform vec2  uResolution;
uniform mat3  uRot;
uniform float uCameraDistance;
uniform float uTanHalfFov;
uniform float uCompositionOffsetX;
uniform float uCompositionOffsetY;
uniform int   uMaxSteps;

uniform int   uCount;
uniform float uViscosity;
uniform float uWobble;
uniform float uWobbleScale;
uniform float uWobbleSpeed;
uniform vec2  uElasticEvent;    // x：事件包絡，y：傳播進度
uniform float uElasticStrength;
uniform float uElasticDensity;
uniform float uElasticDamping;
uniform float uElasticSpeed;
uniform vec4  uDrops[12];       // xyz：中心，w：半徑（CPU 每幀更新）
uniform vec4  uDropShape[12];   // xyz：形變主軸，w：體積守恆的縱向伸縮
uniform vec4  uDropPhysics[12]; // x：接觸壓平，y：形狀振盪，z：斷裂尖端，w：融合權重
uniform vec2  uElasticPair;    // 正在接觸／斷裂的水滴索引
uniform vec4  uSatellites[3];  // xyz：衛星滴中心，w：半徑（斷裂處的小滴串）
uniform float uSatelliteBlend; // 衛星滴與頸部的融合度：成形時高（相連），掐斷時→0（分離）
uniform vec4  uBounds;         // xyz：包圍球中心，w：半徑
uniform int   uShapeType;      // 0 無, 1 SVG 擠出, 2 GLB/GLTF 體積
uniform float uShapeProgress;
uniform float uFidelityAbsorb;
uniform float uShapeSwell;
// 形狀整體縮放（1 = 原尺寸）。成形定格期間的「呼吸」走這裡：距離場的等距膨脹
// 會把輪廓加粗、細節連在一起，縮放才是整顆造型一起脹縮。均勻縮放對 SDF 是精確
// 的 d(p) = s·d(p/s)，所以 raymarch 的步長仍然安全。
uniform float uShapeScale;
uniform float uContactLead;
uniform float uShapeDepth;
uniform float uShapeSoftness;
uniform float uShapeEdgeBevel;
uniform float uShapeLiquid;
uniform float uShapeLiquidSize;
uniform float uShapeLiquidSpeed;
uniform int   uEdgeDropCount;
// 每幀由 CPU 預先算好（syncEdgeDropMotion）。原本這兩組存的是靜態的輪廓資料，
// 位置／脈動／融合半徑則在 shader 內用 sin 現算 —— 但那些值與 p 無關，卻在每一次
// mapScene、每一顆水滴重算一遍（每像素上千個 sin）。
uniform vec4  uEdgeDrops[8];   // xy：本幀中心，z：脈動後半徑，w：smin 融合半徑
uniform vec4  uEdgeMotion[8];  // xy：單位切線，z：未成形時的外推距離
uniform sampler2D uShapeTex;
uniform float uShapeGrid;
uniform vec2  uShapeAtlas;
uniform sampler2D uMicroDrops;
uniform sampler2D uMicroShape;
uniform int   uMicroCount;
uniform float uMicroBlend;
uniform sampler2D uNegativeDrops;
uniform int   uNegativeCount;

uniform float uThickness;
uniform float uThickVar;
uniform float uNoiseScale;
uniform float uDispersion;
uniform float uDispersionEnabled;
uniform float uDispersionSeparation;
uniform float uCausticScale;
uniform float uCausticSharpness;
uniform float uRealDispersion;
uniform float uRealDispersionSeparation;
uniform float uRealDispersionEnabled;
uniform float uSpectralCausticEnabled;
uniform float uSpectralCausticIntensity;
uniform float uSpectralCausticFocus;
uniform float uSpectralCausticWidth;
uniform float uSpectralCausticLightSize;
uniform float uSpectralCausticDensity;
uniform float uSpectralCausticSoftness;
uniform float uSpectralCausticWarp;
uniform float uSpectralCausticSeparation;
uniform float uSpectralCausticBounce;
uniform float uSpectralCausticFlow;
uniform float uSpectralCausticFresnelMask;
uniform float uSpectralCausticNoiseMask;
uniform float uSpectralCausticNoiseScale;
uniform float uSpectralCausticAzimuth;
uniform float uSpectralCausticElevation;
uniform float uSpectralCausticHdri;
uniform sampler2D uSpectralCausticRamp;
uniform float uArtThickness;
uniform float uArtThickVar;
uniform float uArtNoiseScale;
uniform float uArtPatternSpeed;
uniform float uArtGravity;
uniform float uFilmEnabled;
uniform float uFilmBlur;
uniform float uSaturation;
uniform float uFresnel;
uniform float uGravity;
uniform float uFlowSpeed;
uniform float uPatternSpeed;

uniform int       uColorMode;   // 0 光譜, 1 自訂漸層
uniform sampler2D uRampTex;      // 自訂漸層查找表（CPU 端依色標生成）

uniform int   uBgMode;      // 0 純色, 1 HDRI
uniform int   uMaterialStyle; // 0 厚玻璃, 1 液態薄膜
uniform int   uTransparentBackground;
// 1 = 液態薄膜的去背輸出：顏色照白底算完，再對白底反乘出 straight alpha
//（見 mainImage 末段）
uniform float uMembraneOverWhite;
uniform vec3  uBgColor;
uniform float uBrightBgAssist;
uniform float uEnvRefraction;
uniform float uReflect;
uniform float uTransmission;
uniform float uMaterialExposure;
uniform float uMembraneDepth;
uniform float uRoughness;
uniform float uIOR;
uniform int   uReflectionSampleCount;
uniform float uHdriYaw;
uniform float uHdriPitch;
uniform float uHdriBlur;
uniform sampler2D uEnvMap;
uniform sampler2D uPmremMap;
uniform int   uHasEnv;

#include <cube_uv_reflection_fragment>

const int   MAXN = 12;
const int   MAX_MICRO = 20;
const int   MAX_NEGATIVE = 4;
const float PI   = 3.14159265359;
const float TAU  = 6.28318530718;

${NOISE_GLSL}

float hash11(float n){ return fract(sin(n * 127.1) * 43758.5453123); }
vec3 loopNoiseOffset(float speed){
  float phase = TAU * uTime / max(uLoopDuration, 0.001);
  return vec3(cos(phase), sin(phase), sin(phase * 2.0)) * speed;
}

// 環境：程序化棚燈（無 HDRI 時的預設反射來源）；rough 越大光斑越柔散
vec3 proceduralEnv(vec3 d, float rough){
  vec3 col = mix(vec3(0.015, 0.02, 0.03), vec3(0.05, 0.06, 0.08), d.y * 0.5 + 0.5);
  col += vec3(1.0, 0.98, 0.95) * smoothstep(mix(0.55, 0.12, rough), 0.98, dot(d, normalize(vec3(0.35, 0.7, 0.5)))) * 1.1;
  col += vec3(0.55, 0.7, 0.95) * smoothstep(mix(0.6, 0.2, rough), 1.0, dot(d, normalize(vec3(-0.55, 0.15, 0.55)))) * 0.6;
  col += vec3(1.0) * pow(max(dot(d, normalize(vec3(0.2, 0.85, 0.25))), 0.0), mix(300.0, 24.0, rough)) * mix(1.5, 0.45, rough);
  return col;
}
vec3 rotateEnvDir(vec3 d){
  float yaw = uHdriYaw * PI / 180.0;
  float pitch = uHdriPitch * PI / 180.0;
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);
  float cp = cos(pitch), sp = sin(pitch);
  return vec3(d.x, cp * d.y - sp * d.z, sp * d.y + cp * d.z);
}
vec3 sampleReflection(vec3 d, float rough){
  if (uHasEnv == 1) {
    d = rotateEnvDir(d);
    vec3 center = textureCubeUV(uPmremMap, d, rough).rgb;
    // 高粗糙度直接取 PMREM 低階 mip 容易顯出 cube-UV 的格狀邊界。
    // 用 roughness² 控制 GGX lobe 寬度，再以 8 點環形半球近似補樣本。
    float blur = smoothstep(0.28, 0.92, rough);
    if (blur > 0.001) {
      vec3 axis = abs(d.y) < 0.92
        ? normalize(cross(d, vec3(0.0, 1.0, 0.0)))
        : normalize(cross(d, vec3(1.0, 0.0, 0.0)));
      vec3 ortho = normalize(cross(d, axis));
      float ggxAlpha = max(0.018, rough * rough);
      float radius = mix(0.006, 0.16, clamp(ggxAlpha, 0.0, 1.0));
      vec3 ring = vec3(0.0);
      const float SQRT_HALF = 0.70710678;
      ring += textureCubeUV(uPmremMap, normalize(d + axis * radius), rough).rgb;
      ring += textureCubeUV(uPmremMap, normalize(d - axis * radius), rough).rgb;
      ring += textureCubeUV(uPmremMap, normalize(d + ortho * radius), rough).rgb;
      ring += textureCubeUV(uPmremMap, normalize(d - ortho * radius), rough).rgb;
      if (uReflectionSampleCount > 4) {
        ring += textureCubeUV(uPmremMap, normalize(d + (axis + ortho) * radius * SQRT_HALF), rough).rgb;
        ring += textureCubeUV(uPmremMap, normalize(d + (axis - ortho) * radius * SQRT_HALF), rough).rgb;
        ring += textureCubeUV(uPmremMap, normalize(d + (-axis + ortho) * radius * SQRT_HALF), rough).rgb;
        ring += textureCubeUV(uPmremMap, normalize(d - (axis + ortho) * radius * SQRT_HALF), rough).rgb;
        vec3 prefiltered = (center + ring) / 9.0;
        float centerWeight = mix(0.68, 0.24, blur);
        center = mix(prefiltered, center, centerWeight);
      } else {
        vec3 prefiltered = (center + ring) / 5.0;
        float centerWeight = mix(0.68, 0.24, blur);
        center = mix(prefiltered, center, centerWeight);
      }
    }
    return center;
  }
  return proceduralEnv(d, rough);
}
vec3 sampleEnvironmentBackdrop(vec3 d){
  if (uHasEnv != 1) return uBgColor;
  d = rotateEnvDir(d);
  vec2 uvE = vec2(atan(d.z, d.x) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
  vec3 sharpEnv = texture2D(uEnvMap, uvE).rgb;
  if (uHdriBlur <= 0.001) return sharpEnv;
  vec3 blurredEnv = textureCubeUV(uPmremMap, d, uHdriBlur).rgb;
  float blurBlend = smoothstep(0.0, 0.08, uHdriBlur);
  return mix(sharpEnv, blurredEnv, blurBlend);
}
vec4 backgroundSample(vec3 rd){
  if (uBgMode == 1 && uHasEnv == 1){
    return vec4(sampleEnvironmentBackdrop(rd), 1.0);
  }
  return vec4(uBgColor, uTransparentBackground == 1 ? 0.0 : 1.0);
}

// C2 cubic smooth-min：曲率也連續，避免高光暴露每顆水滴的融合邊界。
float smin(float a, float b, float k){
  if (k <= 0.0001) return min(a, b);
  // cubic 中央下沉量為 k/6；放大 1.5 倍可維持原 quadratic 約 k/4 的頸部厚度。
  float kc = k * 1.5;
  float h = max(kc - abs(a - b), 0.0) / kc;
  return min(a, b) - h * h * h * kc * (1.0 / 6.0);
}
// 方向性液滴 SDF：縱向伸長時以 1/sqrt(s) 壓縮橫向，近似維持體積。
float dropletDistance(vec3 p, int i){
  vec3 local = p - uDrops[i].xyz;
  vec3 axis = normalize(uDropShape[i].xyz + vec3(0.00001));
  vec4 physics = uDropPhysics[i];
  float longScale = clamp(uDropShape[i].w, 0.68, 1.65);
  longScale *= 1.0 + physics.y * 0.16 + physics.z * 0.12;
  longScale *= 1.0 - physics.x * 0.1;
  float transverseScale = inversesqrt(max(longScale, 0.2));
  float along = dot(local, axis);
  vec3 across = local - axis * along;
  // 接觸面局部壓平；分離後同一極點短暫保留尖頭，再由表面張力收回。
  float pole = along / max(0.001, uDrops[i].w * longScale);
  float poleMask = smoothstep(0.05, 0.82, pole);
  along += physics.x * uDrops[i].w * 0.13 * poleMask;
  along -= physics.z * uDrops[i].w * 0.11 * poleMask;
  vec3 q = across / transverseScale + axis * (along / longScale);
  float conservativeScale = min(longScale, transverseScale);
  return (length(q) - uDrops[i].w) * conservativeScale;
}

float microDropletDistance(vec3 p, vec4 sphere, vec4 shape){
  vec3 local = p - sphere.xyz;
  vec3 axis = normalize(shape.xyz + vec3(0.00001));
  float stretch = clamp(shape.w, 1.0, 1.65);
  float transverse = inversesqrt(stretch);
  float along = dot(local, axis);
  vec3 across = local - axis * along;
  vec3 q = across / transverse + axis * (along / stretch);
  return (length(q) - sphere.w) * transverse;
}

float decodeShape(float v){ return (v - 0.5) * 48.0; }
// 硬體雙線性只有 C0 連續：梯度在每條 texel 邊界跳一次，格內近似常數。
// 擠出側壁的法線完全等於這個 xy 梯度，而 edge 不隨 z 變化，於是每格 texel
// 的固定法線會沿整個厚度重複，形成貫穿擠出深度的條紋（掠射角還會把 texel
// 網格橫向放大數十倍）。三次 B-spline 的梯度連續，且能精確重現線性函數 ——
// 距離場在局部本來就近似線性，所以輪廓不會被磨圓，只有高曲率處略微收斂。
// 以 4 次雙線性取樣合成 16 taps 的權重（Sigg & Hadwiger 的快速三階濾波）。
float sampleShapeField(vec2 uv){
  float n = max(uShapeGrid, 1.0);
  vec2 texSize = vec2(n);
  vec2 coord = uv * texSize - 0.5;
  vec2 base = floor(coord);
  vec2 f = coord - base;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  // 每一對相鄰 texel 用一次雙線性取樣代替，取樣點偏移由該對的權重比決定。
  vec2 uv0 = (base + 0.5 + w1 / s0 - 1.0) / texSize;
  vec2 uv1 = (base + 0.5 + w3 / s1 + 1.0) / texSize;
  float a = texture2D(uShapeTex, vec2(uv0.x, uv0.y)).r;
  float b = texture2D(uShapeTex, vec2(uv1.x, uv0.y)).r;
  float c = texture2D(uShapeTex, vec2(uv0.x, uv1.y)).r;
  float d = texture2D(uShapeTex, vec2(uv1.x, uv1.y)).r;
  return mix(mix(a, b, s1.x), mix(c, d, s1.x), s1.y);
}
// smoothShape 只在 calcNormal 求梯度時開啟。ray march 只需要一個保守的距離值，
// 次 texel 的差異不影響步長，因此在 march 迴圈裡用單次雙線性取樣就夠 ——
// 每步 4 taps 降回 1 tap，實測省下約 7%，畫面差異低於算繪雜訊。
float svgShapeDistance(vec3 p, bool smoothShape){
  vec2 uv = p.xy / 3.0 + 0.5;
  vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
  // SVG 距離場直接以世界單位編碼（範圍 ±1.5，覆蓋整個取樣盒），
  // 因此解碼與烘焙解析度無關；不再需要「像素距離 × texel」那層換算。
  float raw = smoothShape ? sampleShapeField(safeUv) : texture2D(uShapeTex, safeUv).r;
  float edge = (raw - 0.5) * 3.0;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    // 延續貼圖邊界上的真實正距離，再加上離開取樣盒的距離。舊版在盒外
    // 把 edge 重設成約一個 texel；uShapeSoftness 比它大時，減去 softness
    // 會令整個方形取樣盒外圍變成負距離實體，形成偶發的矩形「邊框」。
    // SVG 烘焙時已有透明 padding，因此邊界樣本應保持在形狀外部。
    edge += length((uv - safeUv) * 3.0);
  }
  float depth = abs(p.z) - uShapeDepth;
  // smooth-max 只圓化正面與側壁交界；半徑由 uShapeEdgeBevel 獨立控制，
  // 與液滴效果（uShapeLiquid）脫鉤，因此關閉液滴後仍可單獨調整圓角。
  float rounded = -smin(-edge, -depth, uShapeEdgeBevel);
  float result = rounded;
  if (uShapeLiquid > 0.001) {
    for (int i = 0; i < 8; i++) {
      if (i >= uEdgeDropCount) break;
      vec4 drop = uEdgeDrops[i];
      vec4 motion = uEdgeMotion[i];
      vec2 tangent = motion.xy;
      vec2 local = p.xy - drop.xy;
      vec2 normal = vec2(-tangent.y, tangent.x);
      // 沿移動方向略拉長、法向與厚度方向較扁，呈現滑動中的液滴而非圓珠。
      vec3 q = vec3(
        dot(local, tangent) / 1.28,
        dot(local, normal) / 0.92,
        p.z / 0.86
      );
      // drop.z 已含脈動；motion.z 是未成形時把水滴推離表面的距離。
      float movingDrop = length(q) - drop.z + motion.z;
      result = smin(result, movingDrop, drop.w);
    }
  }
  return result - uShapeSoftness;
}
float atlasVoxel(vec3 cell){
  float n = uShapeGrid;
  cell = clamp(cell, vec3(0.0), vec3(n - 1.0));
  float slice = cell.z;
  float col = mod(slice, uShapeAtlas.x);
  float row = floor(slice / uShapeAtlas.x);
  vec2 atlasSize = uShapeAtlas * n;
  vec2 uv = (vec2(col, row) * n + cell.xy + 0.5) / atlasSize;
  return decodeShape(texture2D(uShapeTex, uv).r);
}
float volumeShapeDistance(vec3 p){
  float n = uShapeGrid;
  vec3 gridP = (p / 2.1 + 0.5) * (n - 1.0);
  if (any(lessThan(gridP, vec3(0.0))) || any(greaterThan(gridP, vec3(n - 1.0)))) {
    // 同 SVG：SDF atlas 的取樣盒只負責界定資料範圍，本身不是幾何。
    // 加上一個 voxel 的正距離，避免 bounding box 被誤判成 d=0 表面。
    return length(max(abs(p) - vec3(1.05), 0.0))
      + 2.1 / max(1.0, n - 1.0);
  }
  vec3 base = floor(gridP);
  vec3 f = fract(gridP);
  float z0 = mix(
    mix(atlasVoxel(base), atlasVoxel(base + vec3(1,0,0)), f.x),
    mix(atlasVoxel(base + vec3(0,1,0)), atlasVoxel(base + vec3(1,1,0)), f.x), f.y);
  float z1 = mix(
    mix(atlasVoxel(base + vec3(0,0,1)), atlasVoxel(base + vec3(1,0,1)), f.x),
    mix(atlasVoxel(base + vec3(0,1,1)), atlasVoxel(base + vec3(1,1,1)), f.x), f.y);
  float voxelSize = 2.1 / max(1.0, n - 1.0);
  // 低解析度下薄耳、薄翼等部位可能只有一個 voxel，三線性插值後會斷裂。
  // 補不到半個 voxel 的解析度感知 guard；128³ 歸零，不改高品質輪廓。
  float lowResolution = clamp((128.0 - n) / 80.0, 0.0, 1.0);
  float topologyGuard = voxelSize * 0.48 * lowResolution;
  return mix(z0, z1, f.z) * voxelSize - uShapeSoftness - topologyGuard;
}

// 分離後由接觸極點向外傳播的局部毛細波；只處理主要水滴對 0/1。
float capillaryWave(vec3 p, int i){
  vec3 center = uDrops[i].xyz;
  int pairA = int(uElasticPair.x + 0.5);
  int pairB = int(uElasticPair.y + 0.5);
  vec3 other = (i == pairA) ? uDrops[pairB].xyz : uDrops[pairA].xyz;
  vec3 local = p - center;
  float localLen = length(local);
  vec3 contactAxis = other - center;
  float axisLen = length(contactAxis);
  if (localLen < 0.0001 || axisLen < 0.0001) return 0.0;

  float poleDistance = sqrt(max(0.0, 2.0 * (1.0 - dot(local / localLen, contactAxis / axisLen))));
  float travel = uElasticEvent.y * uElasticSpeed * 2.2;
  float behindFront = travel - poleDistance;
  if (behindFront < 0.0) return 0.0;

  float spatialDecay = 1.0 / (1.0 + behindFront * (2.0 + uElasticDamping * 10.0));
  float hemisphereMask = 1.0 - smoothstep(1.65, 2.0, poleDistance);
  float ripple = sin(behindFront * uElasticDensity * PI);
  return ripple * spatialDecay * hemisphereMask * uElasticEvent.x * uElasticStrength;
}

float mapScene(vec3 p, bool smoothShape){
  float d = 1e9;
  // 吸收時半徑歸零並不足以消除 smooth-min：零半徑點落在模型表面時
  // 仍會產生約 k/4 的鼓包。融合半徑必須同步收至 0，才能讓清除迴圈前後等價。
  float dropletBlendFade = 1.0 - uFidelityAbsorb;
  float mainBlend = uViscosity * dropletBlendFade;
  float detailBlend = uMicroBlend * dropletBlendFade;
  // 最近抵達水滴只需要用來決定形狀場的局部生長順序。比較平方距離，
  // 最後再做一次 sqrt，避免每次 mapScene 為所有主滴／微滴各多算一個 length。
  float arrivalDistanceSq = 1e18;
  bool needsArrivalDistance = uShapeProgress > 0.0001;
  for (int i = 0; i < MAXN; i++){
    if (i >= uCount) break;
    // 半徑 0 的主滴必須整顆跳過，不能只靠半徑歸零。smooth-min 對一個落在表面上
    // 的零半徑點仍會鼓出約 k/4 —— 崩解噴濺在炸開前正是這個狀態（碎片半徑 0、
    // uCount 卻是完整顆數），於是每顆未出生的碎片都在造型上頂出一個包，而 k 又
    // 是 uViscosity ∝ 1/sqrt(count)，水滴數量就這樣改變了形狀本身的外觀。
    // 微滴迴圈早就有同樣的 w > 0.0001 守衛，這裡補上。
    if (uDrops[i].w <= 0.0001) continue;
    float sphereD = dropletDistance(p, i);
    int pairA = int(uElasticPair.x + 0.5);
    int pairB = int(uElasticPair.y + 0.5);
    // 僅在事件期間、活動配對且接近表面時付出波紋成本。
    if (uElasticEvent.x > 0.0001 && (i == pairA || i == pairB) && abs(sphereD) < 0.3) {
      sphereD -= capillaryWave(p, i);
    }
    // 每滴融合權重只在分裂模式的子滴出生／吸收尾端低於 1；其餘模式固定為 1。
    // 讓 k 與子滴半徑一起平滑歸零，才能連續接上上方的零半徑守衛。
    float dropBlend = mainBlend * clamp(uDropPhysics[i].w, 0.0, 1.0);
    d = smin(d, sphereD, dropBlend);
    if (needsArrivalDistance) {
      vec3 arrivalDelta = p - uDrops[i].xyz;
      arrivalDistanceSq = min(arrivalDistanceSq, dot(arrivalDelta, arrivalDelta));
    }
  }
  // 衛星滴以「會釋放的 smin」與頸部相連：成形期 blend 高（細絲上的鼓包），
  // 掐斷時 blend→0，smin 退化為硬 min → 成為自由滴。
  for (int s = 0; s < 3; s++) {
    if (uSatellites[s].w > 0.001) {
      d = smin(d, length(p - uSatellites[s].xyz) - uSatellites[s].w, uSatelliteBlend);
    }
  }
  // 大量形狀微滴由資料紋理提供，突破 uniform array 的數量限制。
  // 它們先真正填滿目標體積，模型 SDF 只在最後階段補足細節。
  for (int m = 0; m < MAX_MICRO; m++) {
    if (m >= uMicroCount) break;
    vec4 micro = texture2D(uMicroDrops, vec2((float(m) + 0.5) / 20.0, 0.5));
    if (micro.w > 0.0001) {
      vec4 shape = texture2D(uMicroShape, vec2((float(m) + 0.5) / 20.0, 0.5));
      d = smin(d, microDropletDistance(p, micro, shape), detailBlend);
      if (needsArrivalDistance) {
        vec3 arrivalDelta = p - micro.xyz;
        arrivalDistanceSq = min(arrivalDistanceSq, dot(arrivalDelta, arrivalDelta));
      }
    }
  }
  float negativeD = 1e9;
  for (int n = 0; n < MAX_NEGATIVE; n++) {
    if (n >= uNegativeCount) break;
    vec4 negativeDrop = texture2D(
      uNegativeDrops,
      vec2((float(n) + 0.5) / 4.0, 0.5)
    );
    if (negativeDrop.w > 0.0001) {
      negativeD = min(negativeD, length(p - negativeDrop.xyz) - negativeDrop.w);
    }
  }
  if (negativeD < 1e8) {
    d = -smin(
      -d,
      negativeD,
      max(0.0001, max(0.018, uMicroBlend * 0.55) * dropletBlendFade)
    );
  }
  if (uShapeProgress > 0.0001) {
    // uShapeTex 在 GLB 模式儲存的是匯入時烘焙的高密度 Metaball 場，
    // 不是原模型距離場。以等距侵蝕讓每個細節球核逐步長大，避免 alpha 淡入。
    vec3 shapeP = p / uShapeScale;
    float detailD = (uShapeType == 1
      ? svgShapeDistance(shapeP, smoothShape)
      : volumeShapeDistance(shapeP)) * uShapeScale;
    float growth = smoothstep(0.0, 1.0, uShapeProgress);
    // 已抵達水滴附近先成形，遠處隨全域進度稍晚跟上；這是幾何侵蝕，
    // 不是透明淡入，因此水滴與模型輪廓之間始終有實際液橋。
    float arrivalDistance = needsArrivalDistance ? sqrt(arrivalDistanceSq) : 0.0;
    float contactLead = needsArrivalDistance
      ? clamp((0.72 - arrivalDistance) * 0.42, -0.12, 0.24)
      : 0.0;
    contactLead *= (1.0 - uFidelityAbsorb) * uContactLead;
    float localGrowth = smoothstep(0.0, 1.0, growth + contactLead);
    // uShapeSwell 是崩解噴濺炸開前的蓄力：對距離場做等距膨脹，讓造型像被內壓
    // 撐大。等距偏移是均勻的，不會像 contactLead 那樣在碎片附近結出局部的瘤。
    float growingDetail = detailD + (1.0 - localGrowth) * 0.38 - uShapeSwell;
    d = smin(
      d,
      growingDetail,
      max(0.0001, max(0.018, uMicroBlend * localGrowth) * dropletBlendFade)
    );
  }
  // 最大位移遠小於 0.25；遠離表面時略過 noise，不影響射線接近表面的安全性。
  float geometryWobble = uWobble * mix(1.0, 0.10, uShapeProgress);
  if (geometryWobble > 0.001 && d < 0.25) {
    d += fbmFast(p * uWobbleScale + loopNoiseOffset(uWobbleSpeed)) * geometryWobble * 0.25;
  }
  return d;
}

float mapScene(vec3 p){ return mapScene(p, false); }

vec3 calcNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  // 水滴使用細緻微分保留毛細波；體素模型完成時擴大取樣半徑，
  // 跨越數個 8-bit 距離階層平均法線，減少方格反射與折射閃爍。
  // Trilinear SDF 在單一 voxel 內仍是分段線性，若微分半徑小於格距，
  // 相鄰像素會取得近似固定的 cell gradient，鏡面反射便顯出方格。
  // 完成模型時跨越約 1.35 個 voxel 取樣，做幾何尺度一致的法線平均。
  float voxelH = 2.1 / max(1.0, uShapeGrid - 1.0);
  // 80³ 桌面場維持約 64³ 時相同的世界空間法線半徑，細化輪廓時不讓
  // 鏡面反射重新顯出 voxel cell。
  // SVG 同理：微分半徑若小於一個 texel，bilinear 在單一 texel 內是線性的，
  // 相鄰像素會取到同一個常數梯度，反射就顯出方格。舊版寫死 0.014，在 160²
  // 時只有 0.75 個 texel，正是上面註解警告的情形；改為隨 texel 縮放。
  float svgH = 3.0 / max(1.0, uShapeGrid) * 1.5;
  float shapeH = uShapeType == 2 ? voxelH * 1.70 : svgH;
  float h = mix(0.0009, shapeH, uShapeProgress);
  return normalize(
    k.xyy * mapScene(p + k.xyy * h, true) +
    k.yyx * mapScene(p + k.yyx * h, true) +
    k.yxy * mapScene(p + k.yxy * h, true) +
    k.xxx * mapScene(p + k.xxx * h, true));
}

// 從正面折射進入後，在實心 SDF 內尋找背面出口；只由亮底路徑呼叫。
bool traceExitSurface(
  vec3 entryPoint,
  vec3 insideDir,
  out vec3 exitPoint,
  out vec3 exitNormal,
  out float pathLength
){
  float travel = 0.012;
  float maxTravel = uBounds.w * 2.25;
  bool found = false;
  vec3 q = entryPoint + insideDir * travel;

  for (int i = 0; i < 28; i++) {
    q = entryPoint + insideDir * travel;
    float d = mapScene(q);
    if (travel > 0.025 && d > -0.0009) {
      q -= insideDir * max(d, 0.0);
      found = true;
      break;
    }
    travel += max(-d * 0.72, 0.004);
    if (travel > maxTravel) break;
  }

  exitPoint = q;
  pathLength = travel;
  exitNormal = found ? calcNormal(q) : vec3(0.0, 0.0, 1.0);
  return found;
}

struct FilmMaterial {
  vec3 darkColor;
  float darkAlpha;
  vec3 baseSurface;
  vec3 filmSurface;
  vec3 filmChroma;
  vec3 reflectionChroma;
  vec3 transmission;
  float filmAmount;
  float edgeFactor;
};

// 在光程差域柔化干涉色；只混合色帶，不影響幾何輪廓、折射或高光銳利度。
vec3 sampleFilmInterference(float opd){
  float blurNm = uFilmBlur * 72.0;
  if (uColorMode == 0){
    // 薄膜本身固定使用可見光 RGB 波長。uDispersion 專門控制折射後的
    // 色頻分離，不再同時改變薄膜條紋，兩個參數因而有清楚不同的功能。
    vec3 lambda = vec3(650.0, 550.0, 450.0);
    vec3 phase = TAU * opd / lambda;
    // Gaussian 卷積 cosine 後的解析解，避免光譜模式增加三倍三角函數成本。
    vec3 sigma = TAU * blurNm / lambda;
    vec3 attenuation = exp(-0.5 * sigma * sigma);
    return 0.5 - 0.5 * cos(phase) * attenuation;
  }

  float freq = 1.0;
  float phase = opd / 560.0 * freq;
  float phaseRadius = blurNm / 560.0 * freq;
  vec3 center = texture2D(uRampTex, vec2(fract(phase), 0.5)).rgb;
  vec3 lower = texture2D(uRampTex, vec2(fract(phase - phaseRadius), 0.5)).rgb;
  vec3 upper = texture2D(uRampTex, vec2(fract(phase + phaseRadius), 0.5)).rgb;
  return center * 0.5 + (lower + upper) * 0.25;
}

// 藝術色散使用固定可見光譜，完全獨立於薄膜的自訂漸層。
vec3 visibleSpectrum(float t){
  t = clamp(t, 0.0, 1.0);
  float red = smoothstep(0.46, 0.74, t)
    + (1.0 - smoothstep(0.0, 0.14, t)) * 0.28;
  float green = smoothstep(0.10, 0.38, t)
    * (1.0 - smoothstep(0.68, 0.94, t));
  float blue = 1.0 - smoothstep(0.27, 0.60, t);
  return clamp(vec3(red, green, blue), 0.0, 1.0);
}

vec3 separateSpectrum(vec3 spectrum){
  float lum = dot(spectrum, vec3(0.2126, 0.7152, 0.0722));
  vec3 separated = mix(
    vec3(lum),
    spectrum,
    clamp(uDispersionSeparation, 0.0, 1.0)
  );
  return mix(
    separated,
    clamp((separated - 0.5) * 1.45 + 0.5, 0.0, 1.0),
    clamp(uDispersionSeparation - 1.0, 0.0, 0.5) * 2.0
  );
}

float artisticDispersionOPD(vec3 p, vec3 N, vec3 V){
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  vec3 sp = p * uArtNoiseScale;
  vec3 flow = loopNoiseOffset(uArtPatternSpeed);
  vec3 warp = vec3(
    fbm(sp + flow),
    fbm(sp + vec3(5.2, 1.3, 0.0) + flow.yzx),
    fbm(sp + vec3(1.7, 9.2, 0.0) + flow.zxy)
  );
  float n = fbm(sp + warp * 0.6 + flow * 0.5);
  float thickness = uArtThickness + n * uArtThickVar;
  float top = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  thickness -= pow(top, 2.5) * uArtGravity * uArtThickness * 0.95;
  thickness = max(thickness, 0.0);
  float sinI = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float cosT = sqrt(max(0.0, 1.0 - (sinI / uIOR) * (sinI / uIOR)));
  return 2.0 * uIOR * thickness * cosT;
}

// 薄膜反射與透射分開計算；避免以暗色 alpha 覆蓋白色背景。
FilmMaterial thinFilm(vec3 p, vec3 N, vec3 V){
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);

  vec3 sp = p * uNoiseScale;
  vec3 flow = loopNoiseOffset(uPatternSpeed);
  vec3 warp = vec3(
    fbm(sp + flow),
    fbm(sp + vec3(5.2, 1.3, 0.0) + flow.yzx),
    fbm(sp + vec3(1.7, 9.2, 0.0) + flow.zxy)
  );
  float n = fbm(sp + warp * 0.6 + flow * 0.5);
  float thickness = uThickness + n * uThickVar;

  float top = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  thickness -= pow(top, 2.5) * uGravity * uThickness * 0.95;
  thickness = max(thickness, 0.0);

  // Snell 折射角：掠射角時 cosT 仍可觀 → 邊緣才有彩虹
  float sinI = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float cosT = sqrt(max(0.0, 1.0 - (sinI / uIOR) * (sinI / uIOR)));
  float opd = 2.0 * uIOR * thickness * cosT;

  vec3 interf = vec3(0.0);
  if (uFilmEnabled > 0.5) interf = sampleFilmInterference(opd);

  float lum = dot(interf, vec3(0.3333));
  interf = mix(vec3(lum), interf, uSaturation);
  vec3 darkInterf = interf;

  interf = max(interf, vec3(0.0));

  // 水膜 F0 約 2%；藝術化邊緣光只增強掠射角，不會讓中心變成灰色實體。
  float f0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
  float schlick = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
  float rim = pow(1.0 - cosTheta, 3.0) * uFresnel;
  float fres = mix(schlick, 1.0, clamp(rim * 0.28, 0.0, 0.82));

  // 干涉色是波長相關反射率；透射使用其互補值，白底仍能乾淨穿透。
  float filmAmount = clamp(0.035 + rim * 0.42, 0.0, 0.72) * uFilmEnabled;
  vec3 reflectance = clamp(vec3(fres) + interf * filmAmount, vec3(0.0), vec3(0.94));
  vec3 transmittance = (vec3(1.0) - reflectance) * uTransmission;

  vec3 env = sampleReflection(reflect(-V, N), uRoughness);
  vec3 refl = env * reflectance * uReflect;
  vec3 film = interf * filmAmount * (0.07 + 0.08 * uReflect);
  float envLum = dot(env, vec3(0.2126, 0.7152, 0.0722));
  vec3 reflectionChroma = clamp(env - vec3(envLum), vec3(-0.5), vec3(0.5))
    * reflectance * uReflect;

  // 玻璃亮點（粗糙度使其變寬變弱）
  float sharp = pow(max(dot(reflect(-V, N), normalize(vec3(-0.45, -0.2, 0.6))), 0.0), mix(220.0, 14.0, uRoughness)) * mix(1.0, 0.3, uRoughness);
  vec3 spec = vec3(sharp);

  // Commit 版的暗底美術模型：保留強薄膜、反射底值與深藍體積填光。
  float darkFres = pow(1.0 - cosTheta, 3.0);
  float darkRim = darkFres * uFresnel;
  vec3 darkFilm = darkInterf * (0.08 + 1.3 * darkRim);
  vec3 darkRefl = env * uReflect * (0.12 + 0.9 * darkFres);
  vec3 darkBodyTint = vec3(0.02, 0.03, 0.05) * (0.4 + 0.6 * lum);
  vec3 darkColor = 1.0 - exp(-(darkFilm + darkRefl + spec + darkBodyTint) * 1.7);
  float darkAlpha = clamp(
    0.05 + darkRim * 0.95 + sharp
      + dot(darkFilm, vec3(0.4)) + dot(darkRefl, vec3(0.4)),
    0.0,
    1.0
  );

  vec3 baseSurface = 1.0 - exp(-max(vec3(0.0), refl + spec) * uMaterialExposure * 1.45);
  vec3 filmSurface = 1.0 - exp(-max(vec3(0.0), film) * uMaterialExposure * 1.45);
  float filmLum = dot(interf, vec3(0.2126, 0.7152, 0.0722));
  vec3 filmChroma = clamp(interf - vec3(filmLum), vec3(-0.65), vec3(0.65));
  FilmMaterial material;
  material.darkColor = darkColor;
  material.darkAlpha = darkAlpha;
  material.baseSurface = baseSurface;
  material.filmSurface = filmSurface;
  material.filmChroma = filmChroma;
  material.reflectionChroma = reflectionChroma;
  material.transmission = transmittance;
  material.filmAmount = filmAmount;
  material.edgeFactor = pow(1.0 - cosTheta, 1.4);
  return material;
}

void main(){
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uResolution.x / uResolution.y;
  // 桌面維持英雄鏡置中；手機依可用視覺區上移，避免主體被底部控制面板切掉。
  uv += vec2(uCompositionOffsetX, uCompositionOffsetY);
  float tanHalfFov = uTanHalfFov;

  vec3 ro = uRot * vec3(0.0, 0.0, uCameraDistance);
  vec3 rd = uRot * normalize(vec3(uv * tanHalfFov, -1.0));

  vec4 bg = backgroundSample(rd);
  float dispersionStrength = uDispersion * uDispersionEnabled;
  float realDispersionStrength = uRealDispersion * uRealDispersionEnabled;

  // 僅追蹤真正穿過物件包圍球的射線；色散發生在透明材質內部，不生成
  // 幾何外側的彩虹描邊或光暈。
  vec3 oc = ro - uBounds.xyz;
  float qb = dot(oc, rd);
  float qc = dot(oc, oc) - uBounds.w * uBounds.w;
  float qh = qb * qb - qc;
  if (qh < 0.0){ gl_FragColor = bg; return; }
  qh = sqrt(qh);
  float tEnd = -qb + qh;
  if (tEnd < 0.0){ gl_FragColor = bg; return; }

  float t = max(0.0, -qb - qh);
  bool hit = false;
  for (int i = 0; i < 88; i++){
    if (i >= uMaxSteps) break;
    vec3 p = ro + rd * t;
    float d = mapScene(p);
    if (d < 0.0008){ hit = true; break; }
    t += d * 0.85;               // wobble 讓場非嚴格 Lipschitz → 縮步保險
    if (t > tEnd) break;
  }

  if (!hit){ gl_FragColor = bg; return; }

  vec3 p = ro + rd * t;
  vec3 N = calcNormal(p);
  FilmMaterial material = thinFilm(p, N, -rd);
  float membraneMode = uMaterialStyle == 1 ? 1.0 : 0.0;
  // 通用玻璃：顏色一律以黑場算出「水滴自身的能量」，最後再 over 疊到實際透射
  // 過來的背景上。加色合成需要暗畫布才顯色、吸收需要亮畫布才顯色 —— over 兩
  // 邊都成立，而且 alpha 直接就是去背輸出要的覆蓋率。
  bool universalGlass = uMaterialStyle == 2;
  // 暗底逐項還原 commit 版；亮底使用透射顯色，中間依背景明度平滑混合。
  float bgLum = dot(bg.rgb, vec3(0.2126, 0.7152, 0.0722));
  // 通用玻璃把顯色階段的「背景」視為黑場：不是丟掉背景，而是把背景的貢獻
  // 從顏色生成裡拿掉，改由最後的 over 合成負責 —— 折射進來的光仍然完整保留
  // 在 refractedBg 裡。
  if (universalGlass) bgLum = 0.0;
  float brightBg = smoothstep(0.45, 0.90, bgLum);
  // 灰底維持原本美術模型；只有純色畫布接近白色時才啟用保色補償。
  // 開關只控制合成方式，不覆寫任何材質或色散參數。
  float whiteBackdrop = uBrightBgAssist * (1.0 - float(uBgMode))
    * smoothstep(0.82, 0.97, bgLum);
  vec3 darkComposite = mix(universalGlass ? vec3(0.0) : bg.rgb,
    material.darkColor, material.darkAlpha);

  // 亮底：追蹤水滴內部到背面，取得實際光程、背面 Fresnel 與折射方向。
  vec3 refractedBg = bg.rgb;
  vec3 volumeAbsorption = vec3(1.0);
  vec3 backFilmChroma = vec3(0.0);
  float backFres = 0.0;
  float backRim = 0.0;
  vec3 transmissionDir = rd;
  vec3 dispersionNormal = N;
  float localPrism = material.edgeFactor * 0.18;
  vec3 realDispersionDelta = vec3(0.0);
  vec3 exitPoint = p;
  vec3 exitNormal = -N;
  float pathLength = 0.0;
  bool hasExitSurface = false;
  bool needsEnvironmentTransmission =
    uBgMode == 0 && uHasEnv == 1
      && (uEnvRefraction > 0.001
        || universalGlass
        || (realDispersionStrength > 0.001 && uRealDispersionSeparation > 0.001));
  if (brightBg > 0.001 || needsEnvironmentTransmission || universalGlass) {
    vec3 insideDir = refract(rd, N, 1.0 / uIOR);
    if (dot(insideDir, insideDir) > 0.0001) {
      transmissionDir = normalize(insideDir);
      if (traceExitSurface(p, normalize(insideDir), exitPoint, exitNormal, pathLength)) {
        hasExitSurface = true;
        insideDir = normalize(insideDir);
        float exitFacing = clamp(dot(exitNormal, insideDir), 0.0, 1.0);
        float f0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
        backFres = f0 + (1.0 - f0) * pow(1.0 - exitFacing, 5.0);
        backRim = pow(1.0 - exitFacing, 3.0) * uFresnel;

        vec3 exitDir = refract(insideDir, -exitNormal, uIOR);
        // 第一個出口若全內反射（GLSL refract 在超過臨界角時回傳零向量；uIOR
        // 越高、臨界角越窄，掠射角附近很容易發生），真正的厚玻璃球通常會在
        // 內部再彈一次才穿得出去，不是直接放棄折射、退回原始視線方向。這裡
        // 只補一次彈跳（够蓋大部分情形，又不必把整段追蹤邏輯包成迴圈）：
        // 沿反射方向重新找下一個出口，Fresnel、光程長度、背面薄膜全部改用
        // 第二個出口的結果，讓厚玻璃的內部光路看起來有轉折而不是一次到底。
        if (dot(exitDir, exitDir) < 0.0001) {
          vec3 bounceDir = normalize(reflect(insideDir, exitNormal));
          vec3 exitPoint2;
          vec3 exitNormal2;
          float pathLength2;
          if (traceExitSurface(exitPoint, bounceDir, exitPoint2, exitNormal2, pathLength2)) {
            insideDir = bounceDir;
            exitFacing = clamp(dot(exitNormal2, bounceDir), 0.0, 1.0);
            backFres = f0 + (1.0 - f0) * pow(1.0 - exitFacing, 5.0);
            backRim = pow(1.0 - exitFacing, 3.0) * uFresnel;
            exitDir = refract(bounceDir, -exitNormal2, uIOR);
            pathLength += pathLength2;
            exitPoint = exitPoint2;
            exitNormal = exitNormal2;
          }
        }
        if (dot(exitDir, exitDir) < 0.0001) exitDir = rd;
        exitDir = normalize(exitDir);
        transmissionDir = exitDir;
        refractedBg = backgroundSample(exitDir).rgb;

        // 白色背景也保留極淡的虛擬棚燈漸層，讓折射方向產生可見形變。
        float bend = clamp(length(exitDir - rd) * 0.55 + backRim * 0.18, 0.0, 1.0);
        // 只有折射真正彎曲、或背面接近掠射角時才產生局部稜鏡分離。
        // 平坦正視區維持無色透明，避免退化成整圈彩虹描邊。
        dispersionNormal = exitNormal;
        localPrism = clamp(bend * 1.35 + backRim * 0.75, 0.0, 1.0);
        refractedBg *= mix(vec3(1.0), vec3(0.965, 0.985, 1.0), bend);
        volumeAbsorption = exp(-vec3(0.045, 0.018, 0.005) * pathLength);

        // 背面使用低成本 2-octave 厚度場，產生內部彩色折線與融合區層次。
        vec3 backFlow = loopNoiseOffset(uPatternSpeed);
        float backNoise = fbmFast(exitPoint * uNoiseScale + backFlow);
        float backThickness = uThickness + backNoise * uThickVar;
        float backTop = clamp(exitNormal.y * 0.5 + 0.5, 0.0, 1.0);
        backThickness -= pow(backTop, 2.5) * uGravity * uThickness * 0.95;
        backThickness = max(backThickness, 0.0);
        float backOpd = 2.0 * uIOR * backThickness * max(exitFacing, 0.12);

        vec3 backInterf = sampleFilmInterference(backOpd);
        float backLum = dot(backInterf, vec3(0.2126, 0.7152, 0.0722));
        backInterf = mix(vec3(backLum), backInterf, uSaturation);
        backFilmChroma = clamp(
          backInterf - vec3(dot(backInterf, vec3(0.2126, 0.7152, 0.0722))),
          vec3(-0.65),
          vec3(0.65)
        ) * uFilmEnabled;
      }
    }
  }
  // 純色只控制畫布；水滴內部獨立取樣同一張 HDRI。若背面追蹤未命中，
  // transmissionDir 會保留前表面的 Snell 折射方向，滑桿仍能穩定產生效果。
  if (uBgMode == 0 && uHasEnv == 1
      && (uEnvRefraction > 0.001
        || (realDispersionStrength > 0.001 && uRealDispersionSeparation > 0.001))) {
    vec3 envRefraction = sampleEnvironmentBackdrop(transmissionDir);
    // 白底只借用 HDRI 的明暗結構，不把攝影棚的米黃色牆面染進玻璃。
    // envRefraction 滑桿仍控制混合量，因此 0 的語意完全不變。
    float envRefractionLum = dot(
      envRefraction,
      vec3(0.2126, 0.7152, 0.0722)
    );
    vec3 cleanBrightRefraction = vec3(envRefractionLum)
      * vec3(0.975, 0.995, 1.035);
    envRefraction = mix(
      envRefraction,
      cleanBrightRefraction,
      whiteBackdrop * 0.94
    );
    if (realDispersionStrength > 0.001 && uRealDispersionSeparation > 0.001) {
      // 參考 Prism Tunnel 的 thin-glass 方法：不是把同一方向做任意 RGB
      // 位移，而是用三個波長各自的 uIOR 做三次 Snell 折射，再抽取 R/G/B。
      // 1.50 / 1.53 / 1.57 的相對間距保留，但以目前材質 uIOR 為中心。
      float wavelengthScale = realDispersionStrength * uRealDispersionSeparation;
      float redIor = max(1.01, uIOR - 0.03 * wavelengthScale);
      float greenIor = uIOR;
      float blueIor = uIOR + 0.04 * wavelengthScale;
      vec3 redDir = refract(rd, N, 1.0 / redIor);
      vec3 greenDir = refract(rd, N, 1.0 / greenIor);
      vec3 blueDir = refract(rd, N, 1.0 / blueIor);
      if (dot(redDir, redDir) < 0.0001) redDir = transmissionDir;
      if (dot(greenDir, greenDir) < 0.0001) greenDir = transmissionDir;
      if (dot(blueDir, blueDir) < 0.0001) blueDir = transmissionDir;
      vec3 redSample = sampleEnvironmentBackdrop(redDir);
      vec3 greenSample = sampleEnvironmentBackdrop(greenDir);
      vec3 blueSample = sampleEnvironmentBackdrop(blueDir);
      // HDRI 在此只當作光場，不把它的 RGB 影像畫進玻璃。三個波長
      // 全部先轉亮度，再以跨波長的一、二階差分提取局部高頻光變化。
      // 大面積牆面、窗戶等低頻內容會被抵消，只留下折射邊界的能量。
      vec3 envLumaWeights = vec3(0.2126, 0.7152, 0.0722);
      float redLight = dot(redSample, envLumaWeights);
      float greenLight = dot(greenSample, envLumaWeights);
      float blueLight = dot(blueSample, envLumaWeights);
      float firstDerivative = redLight - blueLight;
      float secondDerivative = redLight - 2.0 * greenLight + blueLight;
      float spectralEnergy =
        abs(secondDerivative) * 1.25 + abs(firstDerivative) * 0.22;

      // 光譜顏色由波長差的方向決定，不沿用 HDRI 本身的顏色，因此不會
      // 把攝影棚染進模型。二階差分決定黃綠／紫紅側的局部偏移。
      float derivativeScale =
        abs(firstDerivative) + abs(secondDerivative) + 0.0001;
      float spectralCoordinate = clamp(
        0.5 + 0.34 * firstDerivative / derivativeScale
          + 0.16 * secondDerivative / derivativeScale,
        0.0,
        1.0
      );
      vec3 spectralColor = separateSpectrum(
        visibleSpectrum(spectralCoordinate)
      );
      float prismVisibility = smoothstep(0.10, 0.92, localPrism);
      prismVisibility = mix(0.08, 1.0, prismVisibility);
      realDispersionDelta =
        spectralColor * spectralEnergy * prismVisibility;
    }
    // 背景影像是否可見只由「環境折射」控制，與真實色散開關無關。
    refractedBg = mix(refractedBg, envRefraction, uEnvRefraction);
  } else if (uBgMode == 1 && uHasEnv == 1
    && realDispersionStrength > 0.001 && uRealDispersionSeparation > 0.001) {
    // HDRI 畫布同樣使用三個物理 uIOR；此模式保留完整折射影像。
    float wavelengthScale = realDispersionStrength * uRealDispersionSeparation;
    vec3 redDir = refract(rd, N, 1.0 / max(1.01, uIOR - 0.03 * wavelengthScale));
    vec3 greenDir = refract(rd, N, 1.0 / uIOR);
    vec3 blueDir = refract(rd, N, 1.0 / (uIOR + 0.04 * wavelengthScale));
    if (dot(redDir, redDir) < 0.0001) redDir = transmissionDir;
    if (dot(greenDir, greenDir) < 0.0001) greenDir = transmissionDir;
    if (dot(blueDir, blueDir) < 0.0001) blueDir = transmissionDir;
    vec3 redSample = sampleEnvironmentBackdrop(redDir);
    vec3 greenSample = sampleEnvironmentBackdrop(greenDir);
    vec3 blueSample = sampleEnvironmentBackdrop(blueDir);
    refractedBg = vec3(redSample.r, greenSample.g, blueSample.b);
  }

  // 白底以帶微冷色的透射衰減塑形；反射只填入剩餘亮度空間，避免大片 clipping。
  vec3 coolTransmission = mix(
    vec3(0.995, 0.998, 1.0),
    vec3(0.94, 0.97, 1.0),
    material.edgeFactor
  );
  vec3 brightBase = refractedBg * material.transmission * coolTransmission
    * volumeAbsorption * (1.0 - backFres * 0.72);
  // 參考白棚拍攝的透明液體：厚處保留極淡冷色，而不是讓白背景與
  // 暖色 HDRI 相乘成灰米色。僅由亮底保色開關控制，不借用其他滑桿。
  float brightBodyDepth = whiteBackdrop * clamp(
    (1.0 - volumeAbsorption.r) * 4.2
      + material.edgeFactor * 0.10
      + backRim * 0.08,
    0.0,
    0.24
  );
  brightBase = mix(
    brightBase,
    brightBase * vec3(0.82, 0.93, 1.0),
    brightBodyDepth
  );
  vec3 surfaceLight = clamp(
    material.baseSurface + material.filmSurface * 0.08 + vec3(backFres * 0.10),
    0.0,
    1.0
  );
  vec3 brightSurface = surfaceLight * max(vec3(0.0), vec3(1.0) - brightBase) * 0.82;
  float chromaLocal = mix(
    0.50,
    1.0,
    smoothstep(0.04, 0.22, material.filmAmount)
  );
  vec3 brightChroma = material.filmChroma * material.filmAmount
    * brightBg * 2.8 * chromaLocal * sqrt(max(uMaterialExposure, 0.0));
  brightChroma += material.reflectionChroma * brightBg * 0.75;
  brightChroma += backFilmChroma * brightBg * (0.08 + backRim * 0.65);
  vec3 brightComposite = clamp(
    brightBase + brightSurface + brightChroma,
    0.0,
    1.0
  );
  // 暗色純色背景也保留 HDRI 內部結構，但只在水滴中央以低權重 screen 合成；
  // 邊緣仍交給原有黑膜、Fresnel 與薄膜彩色輪廓，避免整顆變成明亮環境貼圖。
  // 通用玻璃的內部自身能量不能完全依賴「環境折射」滑桿：那顆滑桿只負責
  // 背景/環境貼圖折射進畫面的可見度，不是內部唯一的補光來源。滑桿為 0 時
  // 改用同一張 HDRI 的環境光量（與 refractedBg 平滑接軌），避免水滴內部
  // 在滑桿關閉時整顆塌成全黑。
  vec3 interiorFillLight = refractedBg;
  if (universalGlass && uBgMode == 0 && uHasEnv == 1) {
    vec3 ambientFill = sampleEnvironmentBackdrop(transmissionDir);
    interiorFillLight = mix(ambientFill, refractedBg, uEnvRefraction);
  }
  if (needsEnvironmentTransmission) {
    vec3 darkRefraction = 1.0 - exp(
      -max(interiorFillLight, vec3(0.0)) * uMaterialExposure * 0.82
    );
    float centerMask = 1.0 - material.edgeFactor * 0.68;
    float darkRefractionWeight = (1.0 - brightBg) * centerMask * 0.34;
    darkComposite = 1.0
      - (1.0 - darkComposite) * (1.0 - darkRefraction * darkRefractionWeight);
  }
  vec3 glassComposite = mix(darkComposite, brightComposite, brightBg);

  // 液態薄膜不是把厚玻璃調淡，而是以同一對前／背表面重新合成：中央主要
  // 透過背景，反射集中在輪廓；前後法線不再互相平行的位置形成膜褶與焦散核心。
  float membraneFold = 0.0;
  float membraneBoundary = 0.0;
  float membraneReflectionWeight = 0.0;
  float membraneFilmWeight = 0.0;
  float membraneThicknessGrade = 0.0;
  float membraneFoldGrade = 0.0;
  float membraneBlueCardGrade = 0.0;
  float membraneWhiteCardGrade = 0.0;
  vec3 membraneComposite = glassComposite;
  if (uMaterialStyle == 1) {
    float pairedNormal = hasExitSurface
      ? clamp(dot(N, -exitNormal), 0.0, 1.0)
      : 1.0;
    membraneFold = hasExitSurface
      ? smoothstep(0.035, 0.48, 1.0 - pairedNormal)
      : 0.0;
    membraneBoundary = clamp(
      material.edgeFactor * (0.72 + 0.24 * uFresnel)
        + backRim * 0.34
        + membraneFold * 0.72,
      0.0,
      1.0
    );

    vec3 transparentMembrane = mix(bg.rgb, refractedBg, 0.16);
    vec3 opaqueMembrane = vec3(0.48, 0.62, 0.78)
      * mix(0.72, 1.08, clamp(uMaterialExposure / 2.5, 0.0, 1.0));
    membraneComposite = mix(
      opaqueMembrane,
      transparentMembrane,
      clamp(uTransmission, 0.0, 1.0)
    );

    // 極淡青藍體積只負責把透明膜從白紙上分離；厚度與膜褶增加時才變明顯。
    float membraneVeil = clamp(
      uTransmission * (
        0.018
          + min(pathLength / max(uBounds.w * 2.0, 0.001), 1.0) * 0.035
          + membraneBoundary * 0.075
          + membraneFold * 0.11
      ),
      0.0,
      0.22
    );
    membraneComposite = mix(
      membraneComposite,
      membraneComposite * vec3(0.72, 0.90, 1.0),
      membraneVeil
    );

    // HDRI 在薄膜模式只形成明暗反射卡，不把暖色攝影棚塗滿中央。
    vec3 membraneEnv = sampleReflection(reflect(rd, N), uRoughness);
    float membraneEnvLum = dot(
      membraneEnv,
      vec3(0.2126, 0.7152, 0.0722)
    );
    vec3 membraneEnvChroma = clamp(
      membraneEnv - vec3(membraneEnvLum),
      vec3(-0.35),
      vec3(0.35)
    );
    vec3 membraneReflectionTone = clamp(
      vec3(0.58, 0.72, 0.90)
        + vec3(membraneEnvLum) * 0.22
        + membraneEnvChroma * 0.28,
      0.0,
      1.0
    );
    membraneReflectionWeight = clamp(
      uReflect * uMaterialExposure
        * (0.012 + membraneBoundary * 0.19 + membraneFold * 0.12)
        * mix(1.0, 0.48, uRoughness),
      0.0,
      0.46
    );
    membraneComposite = mix(
      membraneComposite,
      membraneReflectionTone,
      membraneReflectionWeight
    );

    // 低頻厚度塑形：光程長的區域只壓低少量亮度，保留白底透明感；
    // 方向項讓明暗不再完全對稱，曲面才讀得出朝向。
    float membranePathRatio = clamp(
      pathLength / max(uBounds.w * 2.0, 0.001),
      0.0,
      1.0
    );
    float membraneFacingShade = 0.5 + 0.5 * dot(
      N,
      normalize(vec3(-0.58, 0.34, 0.74))
    );
    membraneThicknessGrade = uMembraneDepth
      * smoothstep(0.10, 0.82, membranePathRatio)
      * mix(0.14, 0.052, membraneFacingShade)
      * (1.0 - material.edgeFactor * 0.34);

    // 前後表面不平行處是膜褶：除了彩色焦散，也需要一層柔和遮蔽才能
    // 讀出凹陷。它與光譜開關無關，因此關閉彩色後仍保留幾何立體感。
    membraneFoldGrade = uMembraneDepth
      * membraneFold
      * (0.11 + membraneBoundary * 0.19);

    // 兩張虛擬攝影棚反射卡：左上白卡拉出柔亮面，右下藍卡提供低頻暗面。
    // 反射強度、材質曝光與粗糙度仍分別控制能量、曝光與卡片柔散程度。
    vec3 membraneReflectDir = reflect(rd, N);
    vec3 membraneLocal = (p - uBounds.xyz) / max(uBounds.w, 0.001);
    float cardExponent = mix(7.0, 1.8, uRoughness);
    float whiteCard = pow(
      max(dot(membraneReflectDir, normalize(vec3(-0.52, 0.62, 0.59))), 0.0),
      cardExponent
    );
    float blueCard = pow(
      max(dot(membraneReflectDir, normalize(vec3(0.72, -0.18, 0.67))), 0.0),
      mix(5.2, 1.45, uRoughness)
    );
    float blueCardPlacement = smoothstep(-0.08, 0.72, membraneLocal.x)
      * (1.0 - smoothstep(0.28, 0.90, membraneLocal.y));
    float whiteCardPlacement = smoothstep(-0.12, 0.78, -membraneLocal.x)
      * smoothstep(-0.32, 0.72, membraneLocal.y);
    blueCard = max(blueCard, blueCardPlacement * 0.72);
    whiteCard = max(whiteCard, whiteCardPlacement * 0.58);
    float cardEnergy = clamp(
      uMembraneDepth * uReflect * uMaterialExposure
        * (0.028 + membraneBoundary * 0.085 + membraneFold * 0.065),
      0.0,
      0.32
    );
    membraneBlueCardGrade = blueCard * cardEnergy;
    membraneWhiteCardGrade = whiteCard * cardEnergy * 0.72;

    // 「薄膜效果」仍是獨立開關；關閉時這一層必須嚴格歸零。
    vec3 membraneFilmTone = clamp(
      vec3(0.82, 0.92, 1.0)
        + material.filmChroma * 1.15
        + backFilmChroma * 0.72,
      0.0,
      1.0
    );
    membraneFilmWeight = clamp(
      material.filmAmount
        * (0.24 + membraneBoundary * 0.76)
        * sqrt(max(uMaterialExposure, 0.0)),
      0.0,
      0.42
    );
    membraneComposite = mix(
      membraneComposite,
      membraneFilmTone,
      membraneFilmWeight
    );
  }

  vec3 finalColor = mix(glassComposite, membraneComposite, membraneMode);
  // 厚玻璃的亮底補償仍由原開關管理；液態薄膜本身就是透射模型，不依賴該開關。
  float brightColorSupport = max(
    whiteBackdrop,
    membraneMode * brightBg
  );

  // 色散沿用薄膜的 thickness → OPD mapping：厚度噪聲、花紋尺度、
  // 花紋流動、重力與入射角都和薄膜一致；唯一不同的是固定使用獨立
  // 可見光譜，不讀取自訂漸層。Fresnel 只控制亮度，不生成同心環。
  if (dispersionStrength > 0.001) {
    float artOpd = artisticDispersionOPD(p, N, -rd);
    float dispersionPeriod = 205.0 * max(0.35, uCausticScale);
    float spectrumCoordinate = fract(
      artOpd / dispersionPeriod
    );
    vec3 prismSpectrum = separateSpectrum(
      visibleSpectrum(spectrumCoordinate)
    );
    // 銳利度收束每個 OPD 週期的邊界，但週期內仍完整走過一次彩虹。
    float cycleEnvelope = sin(spectrumCoordinate * PI);
    cycleEnvelope = mix(
      1.0,
      pow(max(0.0, cycleEnvelope), mix(0.8, 4.5, uCausticSharpness)),
      uCausticSharpness
    );
    float fresnelGain = clamp(
      0.12 + material.edgeFactor * 0.72 + localPrism * 0.42 + backRim * 0.22,
      0.0,
      1.0
    );
    float prismAmount = dispersionStrength * fresnelGain
      * (0.28 + cycleEnvelope * 0.52);
    vec3 prismLight = prismSpectrum * prismAmount;
    // 黑底沒有透射底光可承托彩虹，因此依背景亮度自動補回焦散能量。
    // 指數曝光保留色帶層次並限制峰值；亮底增益回到 1，不會一起過曝。
    float darkBackdrop = 1.0 - smoothstep(0.06, 0.72, bgLum);
    float darkPrismGain = mix(1.0, 2.35, darkBackdrop);
    prismLight = 1.0 - exp(
      -prismLight * darkPrismGain * mix(1.0, 1.18, darkBackdrop)
    );
    // screen 合成使焦散維持透明發光感，而不是實體顏料。
    vec3 prismScreen = 1.0
      - (1.0 - finalColor) * (1.0 - prismLight);
    // 白色已沒有 screen 的加色空間；亮底改成彩色透射（選擇性吸收），
    // 強度仍由 prismAmount 單調控制，0 時與舊合成完全一致。
    vec3 prismTransmission = mix(
      vec3(0.76, 0.90, 1.0),
      prismSpectrum,
      0.62
    );
    // 平方根是感知式響應：低強度仍能在白底看見，高強度則逐漸壓縮，
    // 保持 0 → 無效果且全程單調，不會讓 50% 直接變成不透明彩色貼圖。
    float whitePrismLocality = clamp(
      material.edgeFactor * 0.76
        + localPrism * 0.62
        + backRim * 0.34
        + membraneFold * membraneMode * 0.52,
      0.0,
      1.0
    );
    float prismTransmissionAmount = brightColorSupport * clamp(
      sqrt(max(prismAmount, 0.0))
        * (0.42 + 0.08 * uDispersionSeparation)
        * mix(0.18, 1.0, whitePrismLocality)
        * mix(1.0, 1.36, membraneMode),
      0.0,
      0.30
    );
    finalColor = mix(
      prismScreen,
      prismTransmission,
      prismTransmissionAmount
    );
  }

  // 獨立虛擬光源驅動的光譜焦散。HDRI 不參與圖樣或顏色，只能選擇
  // 調節總亮度，因此純色畫布不會顯示攝影棚影像。
  float spectralCausticStrength =
    uSpectralCausticEnabled * uSpectralCausticIntensity;
  if (spectralCausticStrength > 0.001) {
    float lightAzimuth = radians(uSpectralCausticAzimuth);
    float lightElevation = radians(uSpectralCausticElevation);
    vec3 virtualLightDir = normalize(vec3(
      cos(lightElevation) * sin(lightAzimuth),
      sin(lightElevation),
      cos(lightElevation) * cos(lightAzimuth)
    ));
    vec3 basisUp = abs(virtualLightDir.y) > 0.94
      ? vec3(1.0, 0.0, 0.0)
      : vec3(0.0, 1.0, 0.0);
    vec3 causticTangent = normalize(cross(basisUp, virtualLightDir));
    vec3 causticBitangent = normalize(
      cross(virtualLightDir, causticTangent)
    );

    // 用一次入射折射與一次虛擬內反射建立聚焦方向。這不是路徑追蹤，
    // 但光斑會隨法線、視角與光源方向移動，而不是貼死在模型表面。
    vec3 internalLight = refract(-virtualLightDir, N, 1.0 / uIOR);
    if (dot(internalLight, internalLight) < 0.0001) {
      internalLight = -virtualLightDir;
    }
    vec3 internalBounce = normalize(reflect(internalLight, -N));
    float focusAlignment = clamp(
      dot(internalBounce, normalize(-rd)) * 0.5 + 0.5,
      0.0,
      1.0
    );
    focusAlignment = pow(
      focusAlignment,
      mix(1.2, 8.0, uSpectralCausticFocus)
        * mix(0.68, 1.0, 1.0 - uSpectralCausticLightSize)
    );

    // 兩組曲面座標形成寬窄不一的聚光帶；法線項讓它在彎折與液體
    // 融合區扭曲。光譜座標比亮度條紋更慢，單一光斑內仍能走過彩虹。
    float loopPhase = fract(uTime / max(uLoopDuration, 0.001)) * 2.0 * PI;
    vec2 flowOffset = vec2(cos(loopPhase), sin(loopPhase))
      * uSpectralCausticFlow * 1.4;
    float bandScale = mix(1.5, 8.5, uSpectralCausticDensity);
    float fieldU = (dot(p, causticTangent) + flowOffset.x) * bandScale;
    float fieldV = (dot(p, causticBitangent) + flowOffset.y) * bandScale;
    float warpedBand = fieldU
      + sin(fieldV * 1.7 + dot(N, virtualLightDir) * 4.0)
        * 0.82 * uSpectralCausticWarp
      + sin((fieldU - fieldV) * 0.73)
        * 0.36 * uSpectralCausticWarp;
    float bandWave = 0.5 + 0.5 * cos(warpedBand * PI);
    float bounceWave = 0.5 + 0.5 * cos(
      (warpedBand * 0.78 - fieldV * 0.36 + 1.7) * PI
    );
    bandWave = max(
      bandWave,
      bounceWave * uSpectralCausticBounce * 0.78
    );
    float sizeFactor = clamp(uSpectralCausticWidth / 2.5, 0.0, 1.0);
    float focusExponent = mix(0.8, 5.5, uSpectralCausticFocus)
      * mix(1.45, 0.52, sizeFactor)
      * mix(1.0, 0.48, uSpectralCausticSoftness)
      * mix(1.12, 0.78, uSpectralCausticLightSize);
    float bandFocus = pow(
      max(bandWave, 0.0),
      max(0.32, focusExponent)
    );
    float incidenceFold = pow(
      clamp(1.0 - abs(dot(N, virtualLightDir)), 0.0, 1.0),
      0.72
    );
    // 把每一條亮帶本身展開成完整光譜，而不是讓不同亮帶各自只有
    // 一種顏色。signedBand 是目前像素相對聚光帶中心的橫向位置。
    float signedBand = fract(warpedBand * 0.5 + 0.5) - 0.5;
    float rainbowCoordinate = clamp(
      0.5 + signedBand * mix(1.8, 10.0, uSpectralCausticSeparation)
        + dot(N, causticTangent) * 0.06,
      0.0,
      1.0
    );
    vec3 causticSpectrum = separateSpectrum(
      texture2D(uSpectralCausticRamp, vec2(rainbowCoordinate, 0.5)).rgb
    );

    // 可獨立混合的 Fresnel 與循環 Noise 遮罩。0 完全不限制焦散；
    // Fresnel=1 時彩光集中於掠射角，Noise=1 時連續光帶拆成局部光斑。
    float fresnelMask = pow(
      clamp(material.edgeFactor, 0.0, 1.0),
      1.8
    );
    fresnelMask = mix(1.0, fresnelMask, uSpectralCausticFresnelMask);
    // 薄膜模式下，前後表面不平行的膜褶也是合理的焦散來源；仍受同一個
    // Fresnel 遮罩滑桿控制，滑桿為 0 時維持「完全不限制」的原語意。
    fresnelMask = max(
      fresnelMask,
      membraneMode * membraneFold * uSpectralCausticFresnelMask * 0.86
    );
    vec3 causticNoiseFlow = loopNoiseOffset(uSpectralCausticFlow);
    float causticNoise = fbmFast(
      p * uSpectralCausticNoiseScale + causticNoiseFlow
    );
    float noiseMask = smoothstep(0.32, 0.68, 0.5 + causticNoise * 0.72);
    noiseMask = mix(1.0, noiseMask, uSpectralCausticNoiseMask);

    float hdriDrive = 1.0;
    if (uHasEnv == 1) {
      vec3 hdriLightSample = sampleEnvironmentBackdrop(virtualLightDir);
      float hdriLightLuma = dot(
        hdriLightSample,
        vec3(0.2126, 0.7152, 0.0722)
      );
      hdriDrive = mix(
        1.0,
        clamp(0.35 + hdriLightLuma * 1.25, 0.35, 1.8),
        uSpectralCausticHdri
      );
    }

    float causticEnergy = spectralCausticStrength * hdriDrive
      * bandFocus
      * (0.20 + incidenceFold * 0.80)
      * (0.30 + focusAlignment * 0.70)
      * mix(1.0, 0.72, uSpectralCausticLightSize)
      * fresnelMask
      * noiseMask
      * mix(1.45, 0.95, brightBg);
    vec3 causticLight = 1.0 - exp(
      -causticSpectrum * causticEnergy * 3.2
    );
    vec3 causticScreen = 1.0
      - (1.0 - finalColor) * (1.0 - causticLight);
    float causticPeak = max(
      causticLight.r,
      max(causticLight.g, causticLight.b)
    );
    vec3 causticTransmission = mix(
      vec3(0.76, 0.91, 1.0),
      causticSpectrum,
      0.68
    );
    float causticTransmissionAmount = brightColorSupport
      * clamp(
        causticPeak * mix(0.52, 0.78, membraneMode)
          + membraneMode * membraneFold * causticPeak * 0.18,
        0.0,
        0.62
      );
    finalColor = mix(
      causticScreen,
      causticTransmission,
      causticTransmissionAmount
    );
  }

  // 真實色散在純色／黑色畫布上只加入已去除無色 HDRI 的稜鏡光。
  // screen 合成保留光的能量與亮度，也不會把完整攝影棚背景露出來。
  if (realDispersionStrength > 0.001 && uRealDispersionSeparation > 0.001) {
    float deltaMagnitude = length(realDispersionDelta);
    float contrastGate = smoothstep(0.001, 0.035, deltaMagnitude);
    float darkRealGain = mix(1.15, 2.8, 1.0 - brightBg)
      * realDispersionStrength;
    vec3 spectralLight = 1.0 - exp(
      -realDispersionDelta * contrastGate * darkRealGain
    );
    vec3 realDispersionScreen = 1.0
      - (1.0 - finalColor) * (1.0 - spectralLight);
    float spectralPeak = max(
      spectralLight.r,
      max(spectralLight.g, spectralLight.b)
    );
    vec3 normalizedSpectrum = spectralLight / max(spectralPeak, 0.001);
    vec3 realDispersionTransmission = mix(
      vec3(0.78, 0.91, 1.0),
      normalizedSpectrum,
      0.68
    );
    finalColor = mix(
      realDispersionScreen,
      realDispersionTransmission,
      brightColorSupport * clamp(
        spectralPeak * mix(0.46, 0.62, membraneMode),
        0.0,
        0.56
      )
    );
  }

  // 立體明暗必須在所有色散與焦散之後套用，否則亮底的 transmission
  // 合成會把低頻厚薄關係洗回接近白色。這四個權重都含 uMembraneDepth，
  // 因此滑桿為 0 時與原本液態薄膜輸出完全一致。
  if (uMaterialStyle == 1 && uMembraneDepth > 0.001) {
    float membraneShadeGrade = clamp(
      membraneThicknessGrade + membraneFoldGrade,
      0.0,
      0.34
    );
    finalColor = mix(
      finalColor,
      finalColor * vec3(0.52, 0.72, 0.90),
      membraneShadeGrade
    );
    finalColor = mix(
      finalColor,
      vec3(0.58, 0.78, 1.0),
      clamp(membraneBlueCardGrade, 0.0, 0.28)
    );
    finalColor = mix(
      finalColor,
      vec3(1.0),
      clamp(membraneWhiteCardGrade, 0.0, 0.16)
    );
  }
  // 通用玻璃的 over 合成。finalColor 此刻是「黑場上的水滴自身能量」，也就是
  // premultiplied 的顏色；covered 是它佔掉的比例，剩下的 (1 - covered) 讓折射
  // 過來的背景通過。透射本身仍帶波長選擇性（material.transmission 是干涉反射
  // 率的互補），所以亮底會顯色、暗底則由自身能量顯色，全程沒有任何背景亮度
  // 的分支。
  float universalCovered = 0.0;
  vec3 universalTransmitted = vec3(0.0);
  if (universalGlass) {
    universalTransmitted = refractedBg * material.transmission * volumeAbsorption
      * (1.0 - backFres * 0.72);
    // 覆蓋率取材質不透明度與自身能量兩者的較大值：色散、焦散那些後面才疊上
    // 來的光同樣會遮住背景，只看 darkAlpha 會讓亮部透出過多背景而變灰。
    universalCovered = clamp(
      max(material.darkAlpha, dot(finalColor, vec3(0.2126, 0.7152, 0.0722))),
      0.0,
      1.0
    );
    finalColor = clamp(finalColor + universalTransmitted * (1.0 - universalCovered), 0.0, 1.0);
  }

  float outputAlpha = 1.0;
  if (uTransparentBackground == 1) {
    float surfaceLuma = dot(material.baseSurface + material.filmSurface, vec3(0.3333));
    float glassAlpha = clamp(
      0.12 + material.darkAlpha * 0.52 + material.edgeFactor * 0.30 + surfaceLuma * 0.24,
      0.08,
      1.0
    );
    float membraneAlpha = clamp(
      (1.0 - uTransmission) * 0.78
        + membraneBoundary * 0.34
        + membraneReflectionWeight * 0.28
        + membraneFilmWeight * 0.24,
      0.04,
      1.0
    );
    outputAlpha = mix(glassAlpha, membraneAlpha, membraneMode);
    if (universalGlass) {
      // 通用玻璃天生就是 over 合成，去背不需要任何特殊處理：把剛才疊上的透射
      // 光扣掉，剩下的就是自身能量，alpha 用同一個覆蓋率。
      finalColor = clamp(finalColor - universalTransmitted * (1.0 - universalCovered), 0.0, 1.0);
      outputAlpha = clamp(universalCovered, 0.02, 1.0);
      finalColor = clamp(finalColor / outputAlpha, 0.0, 1.0);
    } else if (uMembraneOverWhite > 0.5) {
      // 液態薄膜的去背輸出。膜身「就是背景」（見 transparentMembrane 那行），
      // 而且亮底顯色路徑是由背景亮度開的閘 —— 把背景抽成黑色等於連材質模型
      // 一起換掉，成品會整片變淡。所以顏色仍以白底算完，再對白底做反乘：
      //
      //   finalColor 此刻 = 疊在白底上的樣子 = rgb·a + white·(1-a)
      //   反解 rgb = (finalColor - white·(1-a)) / a
      //
      // a 取「表現得出這個顏色所需的最低不透明度」，也就是 1 - min(通道)：這樣
      // 至少有一個通道推到 0，在能重現白底外觀的前提下盡可能透明，背景才透得
      // 過來。這個 a 也是唯一能讓反乘結果全部落在 [0,1] 的下限 —— 再往上抬
      // （例如用 membraneAlpha 撐住鏡面）會讓暗通道算成負值被夾掉，白底重現
      // 就開始失真。
      //
      // 疊回白色版面與畫面完全一致；疊在其他顏色上，背景會依 (1-a) 透出來，
      // 疊上水滴自己的反射與色散 —— 那層顏色仍是白底下算出來的，因為薄膜的
      // 顯色在物理上本來就依附背後那片白。
      float representable = 1.0 - min(min(finalColor.r, finalColor.g), finalColor.b);
      outputAlpha = clamp(representable, 0.02, 1.0);
      finalColor = clamp(
        (finalColor - uBgColor * (1.0 - outputAlpha)) / max(outputAlpha, 0.004),
        0.0,
        1.0
      );
    } else {
      // finalColor 是在黑色光場上建立的 premultiplied-like 能量；PNG 的 RGBA
      // 則需要 straight alpha。若直接寫出，瀏覽器降採樣與後續合成會再乘一次
      // alpha，透明邊緣就會出現黑邊。輸出前反預乘，超採樣時仍由 Canvas
      // 以正確的 premultiplied coverage 做縮圖。
      finalColor = clamp(finalColor / max(outputAlpha, 0.001), 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(finalColor, outputAlpha);
}
`;

export { VERT, FRAG };
