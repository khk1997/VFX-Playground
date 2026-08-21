/* ===== 著色器 ===== */
const SNOISE_GLSL = `
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
`;
const FBM_GLSL = `float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.02; a *= 0.5; }
  return s;
}
`;
const FBMFAST_GLSL = `// 距離場專用的低成本版本；薄膜上色仍使用上方完整 4 octave。
float fbmFast(vec3 p){
  float s = 0.5 * snoise(p);
  s += 0.25 * snoise(p * 2.02);
  return s;
}
`;
// 串接回原本那一整份，正式 shader 用的仍是這個常數。
const NOISE_GLSL = SNOISE_GLSL + FBM_GLSL + FBMFAST_GLSL;

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
uniform int   uExtendedMotion;
uniform vec4  uExtendedParams;
uniform vec4  uCapillaryStyle; // x 波場、y 程序紋理、z 波峰過渡、w 保留
uniform vec3  uCapillaryDirection;
uniform float uFidelityAbsorb;
uniform float uShapeSwell;
// 形狀變形：0 = 關閉（其餘模式一律走原本的單一形狀路徑，一格都不變），
// 1 = 由 r 通道變成 g 通道，2 = 反向。
uniform float uShapeMorph;
// xy：波掃方向的單位向量；z：舊形狀的「消失波前」；w：新形狀的「出現波前」。
// 兩個波前分開，是因為水滴的出發與抵達本來就差一整個錯開量：先出發的那些
// 已經在飛了，後面的還沒動。舊形狀跟著出發波前被削掉、新形狀跟著抵達波前
// 長出來，實體與水滴才會咬合成同一道波，而不是三件各走各的事。
uniform vec4  uShapeCut;
// 形狀匯聚的成型波前開關。跟 uShapeMorph 分開：那個是「場上有兩顆形狀要交接」，
// 這個是「場上只有一顆形狀，被一道波前逐步放出來」，共用切削式子但不是同一件事。
uniform float uFormationCut;
// 切口本身的軟硬。0 是刀切。
uniform float uShapeCutBlend;
// 波前形狀：0 平面掃描、1 從中心放射、2 螺旋。
uniform float uMorphFront;
// 螺旋的纏繞強度（uMorphFront == 2 時才有意義）。
uniform float uMorphSpiral;
// 消失場的擾動：x 亂流幅度、y 亂流尺度、z 晶格幅度、w 晶格尺度。
uniform vec4  uMorphBreak;
// 前緣收頸：x 侵蝕量、y 作用寬度。
uniform vec2  uMorphNecking;
// 這一幀哪幾顆形狀真的在場（x 舊形狀、y 新形狀，0/1）。定格時只有一顆，另一
// 顆已經被波前掃光／還沒開始出現，卻仍然每個 march step 取樣一次距離場——
// 而距離場取樣正是這支 shader 最貴的地方。整個 uniform 對所有執行緒都一樣，
// 分支不會發散。定格佔了循環的三成，而那正是使用者盯著形狀看的時候。
uniform vec2  uMorphActive;
// 形狀整體縮放（1 = 原尺寸）。成形定格期間的「呼吸」走這裡：距離場的等距膨脹
// 會把輪廓加粗、細節連在一起，縮放才是整顆造型一起脹縮。均勻縮放對 SDF 是精確
// 的 d(p) = s·d(p/s)，所以 raymarch 的步長仍然安全。
uniform float uShapeScale;
// 形狀 A（來源）／形狀 B（變形目標）各自的大小倍率，獨立於上面共用的
// uShapeScale。做法跟 uShapeScale 一樣是均勻縮放 d(p) = s·d(p/s)，只是
// 分開套在 morph 的兩個通道（fromCh/toCh）與非 morph 時的單一形狀上，讓
// 兩顆形狀能各自放大縮小，不會互相牽動。
uniform float uShapeAScale;
uniform float uShapeBScale;
// 造型本身的剛體動態（見 motions/shapeRigid.js）：呼吸縮放、任意軸旋轉、上下
// 浮動、擠壓拉伸疊在 SDF 取樣座標上，讓匯入的 SVG/GLB 造型自己也會動，不只是
// 水滴在動。CPU 端算的是「本地座標 → 世界座標」的正變換（水滴的目標位置也套
// 同一份，兩者才不會分家）；這裡取樣 SDF 前要做反變換，把世界座標的 ray march
// 點換回造型本地座標。旋轉矩陣是正交矩陣，反矩陣就是轉置——GLSL ES 1.00 沒有
// transpose()，但 vec3 * mat3 本來就定義成 transpose(mat3) * vec3，直接拿同一顆
// 旋轉矩陣做「向量乘矩陣」即是反旋轉，不必另外傳一份轉置矩陣。
uniform mat3  uShapeRigidRot;
uniform vec3  uShapeRigidOffset;
uniform vec3  uShapeRigidScale;
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
// 稜光光芒（見 prismBeamField）。開關沿用 uRayDispersionEnabled ——「造型光線
// 色散」那個面板區塊本身還在，只是換了裡面的效果，總開關的接線不必動。
uniform float uRayDispersionEnabled;
uniform float uRayBeamIntensity;
uniform float uRayBeamSeparation;
// 打燈圖樣（見 prismBeamField）：換一種圖樣等於換一盞棚燈的形狀，座標與所有
// 遮罩都共用，只有「亮度怎麼分布在方向球上」不同。
uniform int uRayBeamPattern;
uniform float uRayBeamZoom;
uniform float uRayBeamRings;
uniform float uRayBeamSpeed;
uniform float uRayBeamGlow;
uniform float uRayBeamChroma;
uniform float uRayBeamAzimuth;
uniform float uRayBeamElevation;
uniform float uRayBeamRefract;
uniform float uRayBeamFresnelMask;
uniform float uRayBeamNoiseMask;
uniform float uRayBeamNoiseScale;
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
uniform float uPatternSpeed;

uniform int       uColorMode;   // 0 光譜, 1 自訂漸層
uniform sampler2D uRampTex;      // 自訂漸層查找表（CPU 端依色標生成）

uniform int   uBgMode;      // 0 純色, 1 HDRI
uniform int   uMaterialStyle; // 0 已移除的舊值（相容用途，視同通用玻璃）, 1 液態薄膜, 2 通用玻璃
uniform int   uTransparentBackground;
// 1 = 液態薄膜的去背輸出：顏色照白底算完，再對白底反乘出 straight alpha
//（見 mainImage 末段）
uniform float uMembraneOverWhite;
uniform vec3  uBgColor;
uniform float uEnvRefraction;
uniform float uReflect;
uniform float uTransmission;
uniform float uMaterialExposure;
uniform float uMembraneDepth;
// 液態薄膜原本各自寫死一個藍紫色常數的 5 處，各自開一顆 uniform 直接取代
// 常數（不是乘上去的濾鏡），畫面看到的顏色就是對應選色器選的那個顏色。
// 預設值等於原本那個常數本身，維持改動前的外觀。
uniform vec3  uMembraneBaseColor;       // 不透明底色（transmission 低時的膜身）
uniform vec3  uMembraneVeilColor;       // 面紗色調（把膜從白紙分離的淡青藍體積感）
uniform vec3  uMembraneReflectionColor; // 虛擬棚燈反射
uniform vec3  uMembraneCardColor;       // 左上藍卡反射
uniform vec3  uMembraneShadeColor;      // 立體明暗暗部
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

// 主滴迴圈的上限。uniform 陣列固定宣告成 [12]（見上方），這個常數只決定
// 「迴圈要展開幾次」。ANGLE 翻成 HLSL 時會嘗試展開這個迴圈，而迴圈體裡是
// dropletDistance + smin，展開 12 次的成本遠高於 4 次；preview 實際只用 2 顆。
// 由 ShaderMaterial.defines 覆寫，未指定時維持原本的 12。
#ifndef MAX_DROPS_COMPILE
#define MAX_DROPS_COMPILE 12
#endif
const int   MAXN = MAX_DROPS_COMPILE;
// 主 raymarch 迴圈與內部折射追蹤的「編譯期展開上限」。這兩個字面值跟執行期的
// uMaxSteps 是兩回事：uMaxSteps 只讓迴圈提早 break，而 ANGLE 仍必須為字面值那麼
//多次展開產生 HLSL。降低它們會讓步數不足、畫面破掉，所以只用於編譯規模的診斷探針，
// 未指定時維持原本的 88 / 28。
#ifndef MAX_MARCH_COMPILE
#define MAX_MARCH_COMPILE 88
#endif
#ifndef MAX_INTERIOR_COMPILE
#define MAX_INTERIOR_COMPILE 28
#endif
// 跟 bubble.js 的 MAX_MICRO_DROPS 綁死。下面的迴圈在 m >= uMicroCount 時動態跳出，
// 所以拉高這個值只是讓著色器能容納更多微滴，不會讓沒用到的那些也付出取樣成本。
const int   MAX_MICRO = 48;
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
  // 1K equirectangular HDRI 直接以 LOD 0 放進高解析度折射時，少量 texel
  // 會被厚玻璃大幅放大，攝影棚牆面看起來就像一塊塊方格。即使 UI 的模糊
  // 是 0，也保留一個只相當於射線 footprint 的 PMREM 下限；這是反鋸齒，
  // 不是美術模糊。滑桿往上時仍直接控制其餘 roughness 範圍。
  float rayFootprint = max(0.025, uHdriBlur);
  return textureCubeUV(uPmremMap, d, rayFootprint).rgb;
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

#ifdef FEATURE_MICRO_DROPS
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

#endif // FEATURE_MICRO_DROPS

#ifdef FEATURE_SHAPE_FIELD
float decodeShape(float v){ return (v - 0.5) * 48.0; }
// 硬體雙線性只有 C0 連續：梯度在每條 texel 邊界跳一次，格內近似常數。
// 擠出側壁的法線完全等於這個 xy 梯度，而 edge 不隨 z 變化，於是每格 texel
// 的固定法線會沿整個厚度重複，形成貫穿擠出深度的條紋（掠射角還會把 texel
// 網格橫向放大數十倍）。三次 B-spline 的梯度連續，且能精確重現線性函數 ——
// 距離場在局部本來就近似線性，所以輪廓不會被磨圓，只有高曲率處略微收斂。
// 以 4 次雙線性取樣合成 16 taps 的權重（Sigg & Hadwiger 的快速三階濾波）。
// ch 選的是距離場存在哪個通道。烘焙時 r=g=b 都是同一個值，只有形狀變形模式
// 例外：它把兩顆形狀打包進同一張貼圖（r 是形狀 A、g 是形狀 B，見 shape-field.js
// 的 packShapePairTexture），一次取樣就同時拿得到兩顆的距離，不必綁第二張貼圖、
// 也不必為了第二次取樣把每個 march step 的成本加倍。
float sampleShapeField(vec2 uv, int ch){
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
  vec4 ta = texture2D(uShapeTex, vec2(uv0.x, uv0.y));
  vec4 tb = texture2D(uShapeTex, vec2(uv1.x, uv0.y));
  vec4 tc = texture2D(uShapeTex, vec2(uv0.x, uv1.y));
  vec4 td = texture2D(uShapeTex, vec2(uv1.x, uv1.y));
  float a = ch == 1 ? ta.g : ta.r;
  float b = ch == 1 ? tb.g : tb.r;
  float c = ch == 1 ? tc.g : tc.r;
  float d = ch == 1 ? td.g : td.r;
  return mix(mix(a, b, s1.x), mix(c, d, s1.x), s1.y);
}
// smoothShape 只在 calcNormal 求梯度時開啟。ray march 只需要一個保守的距離值，
// 次 texel 的差異不影響步長，因此在 march 迴圈裡用單次雙線性取樣就夠 ——
// 每步 4 taps 降回 1 tap，實測省下約 7%，畫面差異低於算繪雜訊。
float svgShapeDistance(vec3 p, bool smoothShape, int ch){
  vec2 uv = p.xy / 3.0 + 0.5;
  vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
  // SVG 距離場直接以世界單位編碼（範圍 ±1.5，覆蓋整個取樣盒），
  // 因此解碼與烘焙解析度無關；不再需要「像素距離 × texel」那層換算。
  vec4 texel = texture2D(uShapeTex, safeUv);
  float raw = smoothShape
    ? sampleShapeField(safeUv, ch)
    : (ch == 1 ? texel.g : texel.r);
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
// ch 的意義與 sampleShapeField 相同：形狀變形模式把第二顆形狀的體素圖集放在
// g 通道，其餘情況 r=g=b 都是同一個值。
float atlasVoxel(vec3 cell, int ch){
  float n = uShapeGrid;
  cell = clamp(cell, vec3(0.0), vec3(n - 1.0));
  float slice = cell.z;
  float col = mod(slice, uShapeAtlas.x);
  float row = floor(slice / uShapeAtlas.x);
  vec2 atlasSize = uShapeAtlas * n;
  vec2 uv = (vec2(col, row) * n + cell.xy + 0.5) / atlasSize;
  vec4 texel = texture2D(uShapeTex, uv);
  return decodeShape(ch == 1 ? texel.g : texel.r);
}
float volumeShapeDistance(vec3 p, int ch){
  float n = uShapeGrid;
  vec3 gridP = (p / 2.1 + 0.5) * (n - 1.0);
  // 同 SVG（見 svgShapeDistance）：取樣盒外不能直接回傳一個跟形狀無關的方塊
  // 距離，那樣盒子邊界本身會被誤判成 d=0 的表面，崩解噴濺等會把取樣點推出
  // 盒外的模式就會炸出一個方框。改成延續盒邊界上真實的三線性距離，再加上
  // 離開取樣盒的實際距離——atlasVoxel 內部本來就會 clamp cell，邊界值本身
  // 就是「盒外最近的真實資料」，舊版只是沒有用它。
  vec3 clampedGridP = clamp(gridP, vec3(0.0), vec3(n - 1.0));
  vec3 base = floor(clampedGridP);
  vec3 f = clampedGridP - base;
  float z0 = mix(
    mix(atlasVoxel(base, ch), atlasVoxel(base + vec3(1,0,0), ch), f.x),
    mix(atlasVoxel(base + vec3(0,1,0), ch), atlasVoxel(base + vec3(1,1,0), ch), f.x), f.y);
  float z1 = mix(
    mix(atlasVoxel(base + vec3(0,0,1), ch), atlasVoxel(base + vec3(1,0,1), ch), f.x),
    mix(atlasVoxel(base + vec3(0,1,1), ch), atlasVoxel(base + vec3(1,1,1), ch), f.x), f.y);
  float voxelSize = 2.1 / max(1.0, n - 1.0);
  // 低解析度下薄耳、薄翼等部位可能只有一個 voxel，三線性插值後會斷裂。
  // 補不到半個 voxel 的解析度感知 guard；128³ 歸零，不改高品質輪廓。
  float lowResolution = clamp((128.0 - n) / 80.0, 0.0, 1.0);
  float topologyGuard = voxelSize * 0.48 * lowResolution;
  float edge = mix(z0, z1, f.z) * voxelSize - uShapeSoftness - topologyGuard;
  vec3 outside = max(gridP - (n - 1.0), vec3(0.0)) + max(-gridP, vec3(0.0));
  return edge + length(outside) * voxelSize;
}

#endif // FEATURE_SHAPE_FIELD

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

// 形狀變形的「消失場」。整套切削的核心就是這個純量場：舊形狀留在場值大於
// 消失波前的那一側、新形狀留在場值小於出現波前的那一側（見 mapScene 裡的
// uShapeMorph 分支）。所以「換一種消失方式」= 換這條式子，兩道波前的推進、
// 水滴的出發抵達、循環接縫全都不用動。
//
// 三個可疊加的層：
//   波前形狀   平面掃描／從中心放射／螺旋。只是把「點到平面的投影」換成
//              半徑或半徑加角度，卻讓同一種消失方式看起來完全不同。
//   亂流       fBm 擾動場值，波前變成撕裂的有機邊緣。幅度大時整片碎成島嶼。
//   晶格       Voronoi，但取的是「格子的隨機值」而不是到邊界的距離——同一格
//              內完全等值，波前掃過時才會整塊整塊剝落，而不是模糊的漸變。
//              這是碎裂鏡頭的讀感來源，糊掉就只是另一種噪聲了。
//
// 每個 march step 只算一次（兩顆形狀共用），所以成本與形狀數無關。
#ifdef FEATURE_SHAPE_FIELD
float voronoiCellValue(vec2 p){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float best = 1e9;
  float value = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 offset = vec2(float(i), float(j));
      // 格點的抖動與該格的隨機值取自同一個雜湊，換 uMorphBreak.w（格子尺度）
      // 就整組換一套碎法。
      float h = hash11(dot(cell + offset, vec2(127.1, 311.7)));
      vec2 site = offset + vec2(h, fract(h * 43.75)) * 0.85 + 0.075;
      float dist = dot(f - site, f - site);
      if (dist < best) { best = dist; value = fract(h * 97.31); }
    }
  }
  return value - 0.5;
}

float dissolveField(vec3 p){
  float base;
  if (uMorphFront < 0.5) {
    base = dot(p.xy, uShapeCut.xy);
  } else if (uMorphFront < 1.5) {
    // 放射：波前是一圈從中心擴張的環。uShapeCut.xy 在這裡用不到。
    base = length(p.xy);
  } else {
    // 螺旋：半徑再加上角度。atan 在 ±π 有接縫，那條接縫就是螺旋的那一臂
    // ——它是這個波前形狀的一部分，不是瑕疵。
    base = length(p.xy) + atan(p.y, p.x) * uMorphSpiral;
  }
  // 擾動只在波前附近才可能改變結果：離波前夠遠的地方，加不加這個幅度都還是
  // 同一側，白算。而 raymarch 的絕大多數取樣點都離波前很遠（波前是一條線／
  // 一個環，實體卻鋪滿整個取樣盒），所以擋掉這些是這裡最大的一筆節省——實測
  // 亂流從 +3.3ms/幀 降到接近零。
  //
  // 不能直接用 if 硬切：帶狀邊界上距離場會跳一個幅度，raymarch 會衝過表面、
  // 邊緣長出接縫。所以帶內用 smoothstep 把擾動淡出到 0，帶外才完全略過——
  // 兩者在邊界上都是 0，接得起來。
  float amp = uMorphBreak.x + uMorphBreak.z;
  if (amp > 0.0001) {
    float nearest = min(abs(base - uShapeCut.z), abs(base - uShapeCut.w));
    float band = 1.0 - smoothstep(amp * 1.2, amp * 2.6, nearest);
    if (band > 0.001) {
      if (uMorphBreak.x > 0.0001) base += fbmFast(p * uMorphBreak.y) * uMorphBreak.x * band;
      if (uMorphBreak.z > 0.0001) {
        base += voronoiCellValue(p.xy * uMorphBreak.w) * uMorphBreak.z * band;
      }
    }
  }
  return base;
}

#endif // FEATURE_SHAPE_FIELD

// 毛細波共用的程序紋理。最後只回傳表面距離偏移，不搬動距離場取樣座標；
// 這能避免高密度螺旋把座標映射折回中心，讓 SVG／GLB 縮成皺褶。
#ifdef FEATURE_CAPILLARY
float capillaryValueNoise(vec2 p){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash11(dot(cell, vec2(127.1, 311.7)));
  float b = hash11(dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)));
  float c = hash11(dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)));
  float d = hash11(dot(cell + vec2(1.0), vec2(127.1, 311.7)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 四鄰點的低成本 cellular 場。完整 3×3 Voronoi 每次距離場取樣要跑九次雜湊，
// 對 raymarch 太重；這個版本保留細胞聚散的讀感，成本控制在四個點。
float capillaryCellular(vec2 p){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float nearest = 10.0;
  for (int y = 0; y <= 1; y++) {
    for (int x = 0; x <= 1; x++) {
      vec2 corner = vec2(float(x), float(y));
      float h = hash11(dot(cell + corner, vec2(127.1, 311.7)));
      vec2 site = corner + vec2(h, fract(h * 43.75)) * 0.72 + 0.14;
      nearest = min(nearest, length(f - site));
    }
  }
  return 1.0 - smoothstep(0.05, 0.78, nearest) * 2.0;
}

// 定向模式不能用 cos/sin 繞圓來換取循環。把前進軸的晶格索引做週期化後，
// 紋理可以永遠沿 +x 直線平移；每個 loop 移動整數個 period，首尾取樣完全相同。
float capillaryValueNoiseFieldLoop(vec2 p, float period){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(cell.x, period);
  float x1 = mod(cell.x + 1.0, period);
  float a = hash11(dot(vec2(x0, cell.y), vec2(127.1, 311.7)));
  float b = hash11(dot(vec2(x1, cell.y), vec2(127.1, 311.7)));
  float c = hash11(dot(vec2(x0, cell.y + 1.0), vec2(127.1, 311.7)));
  float d = hash11(dot(vec2(x1, cell.y + 1.0), vec2(127.1, 311.7)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float capillaryCellularFieldLoop(vec2 p, float period){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float nearest = 10.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 sourceCell = cell + offset;
      vec2 hashCell = vec2(mod(sourceCell.x, period), sourceCell.y);
      float h = hash11(dot(hashCell, vec2(127.1, 311.7)));
      vec2 site = offset + vec2(h, fract(h * 43.75)) * 0.72 + 0.14;
      nearest = min(nearest, length(f - site));
    }
  }
  return 1.0 - smoothstep(0.05, 0.78, nearest) * 2.0;
}

float capillarySurfaceOffset(vec3 p){
  if (uExtendedMotion != 7) return 0.0;
  float phase = fract(uTime / max(0.001, uLoopDuration));
  // 整數速度維持循環無縫；0 靜止，負值沿同一條路徑反向播放。
  float movingA = phase * TAU * uExtendedParams.z;
  float density = max(0.25, uExtendedParams.y);
  float directionLength = length(uCapillaryDirection);
  vec3 direction = directionLength > 0.001
    ? uCapillaryDirection / directionLength
    : vec3(0.0, 0.0, 1.0);
  vec3 reference = abs(direction.z) < 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 acrossAxis = normalize(cross(reference, direction));
  vec3 secondAxis = normalize(cross(direction, acrossAxis));
  bool directionalField = uCapillaryStyle.x > 0.5 && uCapillaryStyle.x < 1.5;
  float along = dot(p, direction);
  float across = dot(p, acrossAxis);
  float depth = dot(p, secondAxis);

  // 扭曲只由兩條橫向軸決定，不依賴 along 或時間：波面會在完整 XYZ 空間彎曲，
  // 但沿前進軸的導數始終為 1，因此不會倒退、繞圈，phase 0/1 也仍能無縫銜接。
  float directionalWarp = (
    sin(across * density * 2.1 + depth * 0.43)
    + sin(depth * density * 1.7 - across * 0.37)
  ) * uExtendedParams.w * 0.055;
  float lateralWarp = sin(
    depth * density * 1.9 + across * density * 0.6
  ) * uExtendedParams.w * 0.08;
  vec2 planarWarp = vec2(
    sin(depth * density * 2.1 + across * 0.43),
    sin(across * density * 1.7 - depth * 0.37)
  ) * uExtendedParams.w * 0.055;

  vec2 textureP = directionalField
    ? vec2(along + directionalWarp, across + lateralWarp)
    : vec2(across, depth) + planarWarp;
  // 三種波場都使用靜態 3D 扭曲。時間只推進下方的主 field 相位，避免
  // 扭曲座標自己繞圈，造成放射／螺旋波局部倒退或改變傳播方向。

  float radius = length(textureP);
  float spiralCore = 1.0;
  float field = directionalField ? along + directionalWarp : radius;
  vec2 patternP = textureP;
  if (directionalField) {
    patternP = vec2(field, textureP.y);
  } else if (uCapillaryStyle.x >= 1.5) {
    // 以半徑驅動連續旋轉，整個平面都沒有 atan 的 -PI/+PI 接縫；核心旋轉量
    // 自然歸零，SVG 與 GLB 中心不再出現放射狀裂口。
    spiralCore = smoothstep(0.08, 0.30, radius);
    float twistA = radius * density * 0.90 * spiralCore;
    float twistC = cos(twistA);
    float twistS = sin(twistA);
    vec2 spiralP = mat2(twistC, -twistS, twistS, twistC) * textureP;
    field = radius + spiralP.x * 0.22 * spiralCore;
    patternP = spiralP;
  }

  float textureType = uCapillaryStyle.y;
  float wave;
  float textureGain = 1.0;
  float travelPhase = movingA - field * density * TAU;
  float fieldPeriod = max(2.0, floor(density * 3.0 + 0.5));
  float fieldTravel = phase * uExtendedParams.z * fieldPeriod;
  float lateral = patternP.y;
  if (textureType < 0.5) {
    // Blender Wave：規則、可讀性最強的基準波。
    wave = sin(travelPhase);
  } else if (textureType < 1.5) {
    // Noise 的第一軸永遠是波場 field；平移整數個週期，所以三種波場都單向且 loop。
    vec2 noiseP = vec2(field, lateral) * density * 1.35;
    wave = capillaryValueNoiseFieldLoop(
      noiseP - vec2(fieldTravel, 0.0), fieldPeriod
    ) * 2.0 - 1.0;
    textureGain = 1.35;
  } else if (textureType < 2.5) {
    // Voronoi 與 Noise 共用同一條場相位，不再於放射／螺旋模式繞圈。
    vec2 cellularP = vec2(field, lateral) * density * 1.15;
    wave = capillaryCellularFieldLoop(
      cellularP - vec2(fieldTravel, 0.0), fieldPeriod
    );
    textureGain = 1.10;
  } else if (textureType < 3.5) {
    // Gabor 的兩條窄頻波共用 travelPhase；橫向只改相位外觀，不產生反向次波。
    wave = sin(travelPhase) * 0.72
      + sin(travelPhase + lateral * density * TAU * 0.78) * 0.28;
    textureGain = 1.15;
  } else if (textureType < 4.5) {
    // Blender Gradient：直接使用 field，放射是環、螺旋是螺旋，不再退回直角座標。
    float ramp = fract(field * density - movingA / TAU);
    wave = 1.0 - abs(ramp * 2.0 - 1.0) * 2.0;
  } else {
    // Blender Magic：多頻干涉只調制同一個主相位，保留魔幻感但不再多向亂跑。
    float magicCross = lateral * density;
    wave = sin(travelPhase + sin(magicCross * 2.7) * 1.1)
      * cos(magicCross * 1.9)
      + sin(travelPhase * 2.0 + cos(magicCross * 3.3)) * 0.45;
    wave /= 1.45;
    textureGain = 1.25;
  }
  // 各程序函式的原始對比不同；校準後，同一個波高在切換紋理時維持接近的隆起量。
  wave = clamp(wave * textureGain, -1.0, 1.0);
  float coreAmplitude = uCapillaryStyle.x >= 1.5 ? mix(0.25, 1.0, spiralCore) : 1.0;
  float requestedAmplitude = uExtendedParams.x * 0.16;
  // 正弦波最大斜率約為 amplitude × density × TAU。限制這個乘積可避免使用者
  // 同時拉高波高與密度時產生針狀鋸齒；一般設定低於上限，不會被壓縮。
  float slopeSafeAmplitude = 2.4 / max(TAU, density * TAU);
  float amplitude = min(requestedAmplitude, slopeSafeAmplitude);
  // 原物體永遠是不可侵蝕的基底。過渡值把隆起起點向負半波展寬，類似 Blender
  // ColorRamp 的黑白色標拉開；0% 保留俐落波峰，100% 形成最寬的柔和肩部。
  float crestSoftness = clamp(uCapillaryStyle.z, 0.0, 1.0);
  float crestStart = -crestSoftness * 0.85;
  float crestInput = clamp((wave - crestStart) / (1.0 - crestStart), 0.0, 1.0);
  float basePreservingCrest = smoothstep(0.0, 1.0, crestInput);
  return basePreservingCrest * amplitude * coreAmplitude;
}
#endif // FEATURE_CAPILLARY

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
#ifdef FEATURE_MICRO_DROPS
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
#endif // FEATURE_MICRO_DROPS
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
#ifdef FEATURE_SHAPE_FIELD
  if (uShapeProgress > 0.0001) {
    // uShapeTex 在 GLB 模式儲存的是匯入時烘焙的高密度 Metaball 場，
    // 不是原模型距離場。以等距侵蝕讓每個細節球核逐步長大，避免 alpha 淡入。
    // 造型剛體動態的反變換：CPU 端把本地座標依序縮放、旋轉、上下平移變成世界
    // 座標，這裡要反過來——先減平移、再反旋轉、再反縮放——才能把 ray march
    // 的世界座標點換回造型原本定義的本地座標。未啟用時旋轉矩陣是單位矩陣、
    // scale 為單位值，等價於原本的 p / uShapeScale。
    vec3 rigidP = p - uShapeRigidOffset;
    vec3 unrotatedP = rigidP * uShapeRigidRot;
    vec3 shapeP = (unrotatedP / uShapeRigidScale) / uShapeScale;
    // 形狀 A/B 各自的獨立倍率再疊一層，跟 uShapeScale 是同一種均勻縮放，只是
    // 分開套在各自的通道上。fromCh/toCh 哪個是 A、哪個是 B 由 uShapeMorph 決定
    // （見下方），所以要先分出 shapeP 對應 A、B 各自的本地座標。
    vec3 shapePA = shapeP / uShapeAScale;
    vec3 shapePB = shapeP / uShapeBScale;
    float detailD;
    if (uShapeMorph > 0.5) {
      // 兩顆形狀同時在場：舊的被「消失波前」削掉，新的被「出現波前」放出來，
      // 兩者聯集。單一貼圖的兩個通道，所以這裡沒有多綁任何取樣器。
      int fromCh = uShapeMorph > 1.5 ? 1 : 0;
      int toCh = 1 - fromCh;
      // 通道 0 一律是形狀 A、通道 1 一律是形狀 B（見 bubble.js 的
      // rebuildMorphPackedTexture：r=A、g=B），跟 fromCh/toCh 哪個先哪個後無關。
      vec3 shapePFrom = fromCh == 0 ? shapePA : shapePB;
      vec3 shapePTo = toCh == 0 ? shapePA : shapePB;
      float scaleFrom = fromCh == 0 ? uShapeAScale : uShapeBScale;
      float scaleTo = toCh == 0 ? uShapeAScale : uShapeBScale;
      // 兩顆形狀一定是同一種來源（面板的「形狀來源」對兩個匯入槽共用），所以
      // 這裡只需要看一次 uShapeType，不會出現一顆走 SVG、一顆走體素的情況。
      float dFrom = uMorphActive.x > 0.5
        ? (uShapeType == 1
          ? svgShapeDistance(shapePFrom, smoothShape, fromCh)
          : volumeShapeDistance(shapePFrom, fromCh)) * uShapeScale * scaleFrom
        : 1e6;
      float dTo = uMorphActive.y > 0.5
        ? (uShapeType == 1
          ? svgShapeDistance(shapePTo, smoothShape, toCh)
          : volumeShapeDistance(shapePTo, toCh)) * uShapeScale * scaleTo
        : 1e6;
      float field = dissolveField(p);
      // 收頸：波前前方那一小段裡，對距離場加一個正偏移把實體「侵蝕變薄」。
      // 這不是切削——切削是憑空少一塊，收頸是材料自己先變細、收出一個頸、
      // 然後才斷開，也就是真正的液體在表面張力下離開表面的樣子。四種消失
      // 方式共用這一層，因為它給的是材質的身分，不是圖形花樣。
      float neckFrom = field - uShapeCut.z;
      float neckTo = uShapeCut.w - field;
      if (uMorphNecking.x > 0.0001) {
        float w = max(0.0001, uMorphNecking.y);
        dFrom += uMorphNecking.x * (1.0 - smoothstep(0.0, w, neckFrom));
        dTo += uMorphNecking.x * (1.0 - smoothstep(0.0, w, neckTo));
      }
      // 半空間的距離場：舊形狀只留在波前之後（field > cut.z），新形狀只留在
      // 波前之前（field < cut.w）。用 smooth-max（-smin 的對偶）取交集，
      // uShapeCutBlend 控制切口本身的軟硬。
      float k = max(0.0001, uShapeCutBlend);
      float keptFrom = -smin(-dFrom, -(uShapeCut.z - field), k);
      float keptTo = -smin(-dTo, -(field - uShapeCut.w), k);
      detailD = smin(keptFrom, keptTo, k);
    } else {
      // 非 morph 情境下場上只有形狀 A（通道 0）。
      detailD = (uShapeType == 1
        ? svgShapeDistance(shapePA, smoothShape, 0)
        : volumeShapeDistance(shapePA, 0)) * uShapeScale * uShapeAScale;
      // 形狀匯聚的成型波前：跟上面那組消失波前共用同一個 dissolveField、同一組
      // 擾動與收頸 uniform，差別只有兩點——只有一道波前（沒有第二顆形狀要交接），
      // 而且方向相反：morph 保留波前「之後」的舊形狀，這裡保留波前「之前」掃過
      // 的區域，也就是掃到哪裡才長到哪裡。
      if (uFormationCut > 0.5) {
        float field = dissolveField(p);
        // 收頸在這裡的身分也跟著反過來：morph 是斷開前先變薄，這裡是剛長出來
        // 的前緣還很薄、往後才補足厚度——同樣是液體在表面張力下的樣子，只是
        // 一個在收、一個在長。
        float behind = uShapeCut.w - field;
        if (uMorphNecking.x > 0.0001) {
          float w = max(0.0001, uMorphNecking.y);
          detailD += uMorphNecking.x * (1.0 - smoothstep(0.0, w, behind));
        }
        // 半空間的距離場：只保留 field < uShapeCut.w 的那一側。smooth-max
        // （-smin 的對偶）取交集，uShapeCutBlend 控制切口本身的軟硬。
        detailD = -smin(-detailD, -(field - uShapeCut.w), max(0.0001, uShapeCutBlend));
      }
    }
    // 以 signed-distance 偏移形成表面波，不再把多個取樣座標擠向螺旋中心。
#ifdef FEATURE_CAPILLARY
    detailD -= capillarySurfaceOffset(shapePA) * uShapeScale * uShapeAScale;
#endif
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
#endif // FEATURE_SHAPE_FIELD
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
  float svgTexel = 3.0 / max(1.0, uShapeGrid);
  // SVG 實際烘焙為 512²；舊公式的 1.5 texel 上限會讓 bevel-aware
  // 值被夾回舊值，cb2ac5d 因此在真實 SVG 路徑上沒有改變 footprint。
  // 側壁需要跨過約 2 texels 才能平均 SDF 殘留的次像素梯度跳動；
  // 厚度方向則不能用同樣的大步長，否則會跨過正面／側壁倒角。
  // 因此 SVG 改用分軸中央差分：XY 平滑輪廓梯度，Z 獨立保留倒角。
  if (uShapeType == 1 && uShapeProgress > 0.001) {
    float xyH = min(svgTexel * 2.0, max(svgTexel * 0.75, uShapeEdgeBevel * 0.48));
    float zH = min(xyH, max(0.0009, uShapeEdgeBevel * 0.22));
    float dx = mapScene(p + vec3(xyH, 0.0, 0.0), true)
      - mapScene(p - vec3(xyH, 0.0, 0.0), true);
    float dy = mapScene(p + vec3(0.0, xyH, 0.0), true)
      - mapScene(p - vec3(0.0, xyH, 0.0), true);
    float dz = mapScene(p + vec3(0.0, 0.0, zH), true)
      - mapScene(p - vec3(0.0, 0.0, zH), true);
    return normalize(vec3(dx / xyH, dy / xyH, dz / zH));
  }
  float svgH = svgTexel * 1.5;
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

  for (int i = 0; i < MAX_INTERIOR_COMPILE; i++) {
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

// ===== 稜光光芒 Prism Beams（面板上叫「模擬色散」）=====
//
// 取代原本的「造型光線色散」。舊版走的是物理路線：由 IOR 與阿貝數反推 Cauchy
// 色散曲線，五個波長各自穿過 SDF、找自己的背面出口再折射出去。物理上是對的，
// 但代價是每個 fragment 多跑四次完整的內部追蹤（各含 28 步 traceExitSurface
// 與法線估計），而換來的畫面只是輪廓上一層很薄的邊緣分光 —— 不是「光芒」。
//
// 這一版改走程序化路線，靈感來自 Shadertoy 的 "Creation"（作者 Danilo
// Guanabara，原作要求重用時標註來源，故記於此）。它的三個核心手法：
//
//   1. 三個顏色通道取樣同一個圖樣，但相位各錯開一點。色散因此不是來自折射率
//      差，而是來自「同一個花樣的三個時間切片」—— 便宜得多，顏色也更飽。
//   2. 沿徑向位移取樣座標，位移量由一組往外跑的同心環決定，形成放射狀的漣漪。
//   3. 把座標切成單位格、取「到格心的反距離」。反距離在格心爆出亮點並沿格線
//      拖出十字光芒 —— 這就是光束感的來源，跟噪聲完全不同的質地。
//
// 兩處對原作的必要改寫：
//
//   取樣座標不是螢幕座標，而是「出射光線方向相對光源方向的偏移」。原作是滿版
//   2D 圖樣，貼在 3D 物體上會像後製濾鏡、不隨物體轉動。改用折射後的出射方向
//   之後，物體變成一顆會把光束扭曲、放大、分光的透鏡，光芒也就真的長在玻璃裡。
//
//   時間必須能無縫循環。原作直接吃 iTime，永遠不會接回起點；這裡把相位換成
//   「一個循環轉整數圈」，sin 與 abs(sin) 兩層在 phase 0 與 1 因此完全同值。

// 光芒放射出來的方向。這是圖樣球面座標的極點，不是一顆真的光源 —— 圖樣鋪滿
// 整個方向球，這個方向只決定「從哪裡開始放射」。
vec3 rayBeamLightDirection(){
  float azimuth = radians(uRayBeamAzimuth);
  float elevation = radians(uRayBeamElevation);
  return normalize(vec3(
    cos(elevation) * sin(azimuth),
    sin(elevation),
    cos(elevation) * cos(azimuth)
  ));
}

// 圖樣的取樣座標。這裡是整個效果成敗的關鍵，前兩版都踩過坑：
//
// 第一版：把座標算成「出射方向在垂直於光源方向那個平面上的分量」，長度是
// sin(夾角)。sin 在 90° 折返 —— 夾角 100° 與 80° 得到同一個長度，圖樣因此在
// 半球交界鏡射、糊成一團斑塊，完全讀不出放射狀。
//
// 第二版：改成錨定畫面座標。光束確實成形了，但那是「以鏡頭前一點為中心的平面
// 投影」，看起來像貼在鏡頭上的同心圓，不是環境。
//
// 這一版：用以光源方向為極點的球面極座標 —— 也就是方位等距投影。
//   半徑 = 出射方向與光源方向的實際夾角（0..π）。用夾角而不是 sin(夾角) 是
//          第一版問題的根治：acos 在整個球面上單調遞增，永遠不會折返。
//   角度 = 繞著光源方向的方位角。
// 於是圖樣鋪滿整個方向球：光芒從光源方向放射出來、在對側收斂，而物體是用自己
// 的折射方向去查這個環境 —— 跟 HDRI 的取樣方式同一個道理，所以會有全方位透射
// 的感覺，而不是平貼在鏡頭前。
vec3 prismBeamCoord(vec3 viewDir, vec3 exitDir){
  vec3 lightDir = rayBeamLightDirection();
  // 折射強度：0 = 沿原視線取樣（環境不被造型扭曲，像背景直接透過去），
  // 1 = 完全用折射後的出射方向（造型變成真正的透鏡）。
  vec3 dir = mix(viewDir, exitDir, clamp(uRayBeamRefract, 0.0, 1.0));
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : viewDir;

  // 以光源方向為極點建切線基底。y 接近極點時 up 會與 lightDir 平行、cross 退化
  // 成零向量，所以換一根軸（跟虛擬光譜焦散的基底建構同一套處理）。
  vec3 basisUp = abs(lightDir.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(basisUp, lightDir));
  vec3 bitangent = cross(lightDir, tangent);

  float angle = acos(clamp(dot(dir, lightDir), -1.0, 1.0));
  float theta = atan(dot(dir, bitangent), dot(dir, tangent));
  // 正規化成 0..1（1 = 對側）。z 帶著這個未縮放的半徑出去：環紋與中心衰減都吃
  // 它，只有格點密度吃縮放後的 xy —— 這樣「光芒尺度」不會連帶改變亮度與環數，
  // 三根滑桿各管一件事。
  float radius = angle / PI;
  vec2 q = radius * vec2(cos(theta), sin(theta)) * max(0.05, uRayBeamZoom);
  return vec3(q, radius);
}

// 回傳三通道各自的光芒強度（未上色，RGB 之間的差異本身就是色散）。
//
// 一共五種打燈圖樣，共用同一組座標、同一組遮罩與同一個相位，差別只在「亮度
// 怎麼分布在方向球上」—— 等於換一盞棚燈的形狀，而不是換一套效果。每一種都得
// 守住兩件事：隨時間走的量一律是週期 1 的 fract/mod（循環才接得回去），三個
// 通道之間只差一個相位 z（色散才不必額外取樣）。
vec3 prismBeamField(vec2 q, float radius){
  float l = max(length(q), 0.02);
  // 未縮放的半徑，用於環紋與中心衰減（見 prismBeamCoord）。
  float r = max(radius, 0.02);
  // 繞著放射方向的方位角。q 是「半徑 × 方向」，所以角度可以直接從 q 讀回來，
  // 不必再從 prismBeamCoord 多帶一個分量出來。
  float theta = atan(q.y, q.x);
  // 流動：所有圖樣共用同一個相位。
  //
  // 為什麼一定是整數速度：圖樣裡隨時間走的量全部寫成「週期 1 的 fract/mod」，
  // 一個循環滑過整數個週期才精確接得回原狀。晶格在球面上有幾十格（隨「光芒
  // 尺度」而定），所以 1 就已經是很慢的流速。
  //
  // 速度可正可負（反向流動），0 = 完全靜止。
  float speed = floor(uRayBeamSpeed + (uRayBeamSpeed < 0.0 ? -0.5 : 0.5));
  float phase = speed * fract(uTime / max(0.001, uLoopDuration));
  // 亮點／光帶的核心尺寸。銳利度調高 → 分子變小、收緊成細長的光針；調低 →
  // 糊成一團柔光。
  float core = mix(0.035, 0.004, clamp(uRayBeamGlow, 0.0, 1.0));
  // 「環紋 / 分支數」在每種圖樣裡都有意義，只是意義不同：晶格是徑向漣漪的環數，
  // 星芒是分支數，光環是環數，條光與窗光是垂直方向的分割數。
  float rings = max(0.5, uRayBeamRings);
  // 線狀圖樣（星芒、光環、條光、窗光）量的是「到一條線的距離」，晶格量的是
  // 「到一個點的距離」。同樣的核心尺寸，一維的線會細到幾乎取樣不到，所以線狀
  // 那幾種統一放大核心，銳利度滑桿的手感才跟晶格一致。
  float lineCore = core * 3.0;

  vec3 beams = vec3(0.0);
  // 中心衰減：越靠放射方向越亮。夾一個下限，否則極點那一點會除到爆掉。用未縮放
  // 的半徑，亮度才不會隨「光芒尺度」漂移。棚燈類的圖樣（條光、窗光）本來就該像
  // 一整面均勻的燈板，所以換一條平緩得多的衰減，不然中央會燒成一個白洞。
  float falloff = max(r, 0.12);
  // 各圖樣的覆蓋率差很多（點狀的晶格最疏、線狀的窗格最密），不補一個增益的話
  // 切換圖樣時整體亮度會跳。
  float gain = 1.0;

// 五種圖樣裡 preview 只用到預設的晶格（uRayBeamPattern = 0），其餘四種各含一個
// 3 次迴圈。未定義 FEATURE_BEAM_PATTERNS 時整條 if/else 鏈消失，只留下最後那個
// 晶格區塊本身（GLSL 允許裸的 block）。
#ifdef FEATURE_BEAM_PATTERNS
  if (uRayBeamPattern == 1) {
    // 放射星芒：一圈等角的光刺，像鏡頭前的星光鏡或一盞裸燈的繞射芒。
    // 分支數必須取整數，否則 theta 繞回 ±π 時接縫會裂開。
    float spokes = max(2.0, floor(rings * 4.0 + 0.5));
    for (int i = 0; i < 3; i++) {
      float z = float(i) * uRayBeamSeparation;
      // 相位推進 1 = 剛好轉過一根光刺，所以循環無縫。
      float a = abs(fract(theta / TAU * spokes + phase + z * 0.5) - 0.5);
      // 角寬乘上 (0.35 + r)：光刺往外略微收細，才不會遠處看起來像扇形色塊。
      beams[i] = lineCore / max(a * (0.35 + r) * 2.0, 0.004);
    }
    gain = 0.85;
  } else if (uRayBeamPattern == 2) {
    // 同心光環：以放射方向為心的一圈圈光暈，像環形燈或鏡頭鬼影。
    // r 只走 0..1（1 = 對側），環數取整數時 fract 在兩極都連續。
    float ringCount = max(1.0, floor(rings * 3.0 + 0.5));
    for (int i = 0; i < 3; i++) {
      float z = float(i) * uRayBeamSeparation;
      float d = abs(fract(r * ringCount - phase + z * 0.5) - 0.5);
      beams[i] = lineCore / max(d * 1.4, 0.004);
    }
    gain = 0.7;
  } else if (uRayBeamPattern == 3) {
    // 條狀棚燈：一排平行的長條光，像攝影棚的燈管或百葉窗打進來的光。
    // 條的間距吃「光芒尺度」（q 已經被它縮放過），分割數再乘上環紋滑桿。
    for (int i = 0; i < 3; i++) {
      float z = float(i) * uRayBeamSeparation;
      float v = q.y * rings + phase + z * 0.5;
      float d = abs(fract(v) - 0.5);
      // 沿條長方向收一個柔邊，讓每條光有頭有尾而不是無限延伸的斑馬紋。
      float span = exp(-pow(abs(q.x) / max(0.6, uRayBeamZoom * 0.75), 3.0));
      beams[i] = lineCore / max(d * 1.6, 0.004) * span;
    }
    falloff = 0.35 + r * 0.9;
    gain = 0.8;
  } else if (uRayBeamPattern == 4) {
    // 窗光格柵：兩個方向的光帶交織成的框線，像窗框或柔光罩的格柵留在反射裡。
    // 取 min(dx, dy) 而不是相乘 —— 相乘只在交點亮，取 min 才會留下整片格線。
    for (int i = 0; i < 3; i++) {
      float z = float(i) * uRayBeamSeparation;
      vec2 w = vec2(q.x + phase, q.y * rings * 2.0) + z * 0.5;
      vec2 d2 = abs(fract(w) - 0.5);
      beams[i] = lineCore / max(min(d2.x, d2.y) * 1.6, 0.004);
    }
    falloff = 0.35 + r * 0.9;
    gain = 0.65;
  } else
#endif // FEATURE_BEAM_PATTERNS
  {
    // 晶格光針（預設）：切格 + 到格心的反距離，亮點沿格線拖出十字光芒。
    vec2 drift = vec2(phase, 0.0);
    for (int i = 0; i < 3; i++) {
      // 色散：三個通道的相位各錯開一點（見檔頭）。這一層不隨時間走，只負責把
      // 三個通道的圖樣錯開，時間交給 drift。
      float z = float(i) * uRayBeamSeparation;
      // 徑向漣漪：(q/l) 是徑向單位向量，(sin(z)+1) 是整體幅度，
      // abs(sin(r*rings*π - 2z)) 是一組同心環。
      vec2 cellUv = q * 0.5 + 0.5 + drift
        + (q / l) * (sin(z) + 1.0)
          * abs(sin(r * rings * PI - z * 2.0));
      vec2 cell = mod(cellUv, 1.0) - 0.5;
      beams[i] = core / max(length(cell), 0.004);
    }
  }

  return beams * gain / falloff;
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
  for (int i = 0; i < MAX_MARCH_COMPILE; i++){
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
  // 真正的背景亮度，在通用玻璃把 bgLum 歸零之前先留一份。稜光光芒需要它：光束
  // 的彩度要隨背景變亮而收回來（見 beamEnergy 的 brightWash），而 bgLum 歸零之後
  // 就問不出「背景到底有多亮」了。
  float trueBgLum = bgLum;
  if (universalGlass) bgLum = 0.0;
  float brightBg = smoothstep(0.45, 0.90, bgLum);
  // 灰底維持原本美術模型；只有純色畫布接近白色時才做保色補償。
  //
  // 這裡原本還乘一個「亮底保色」開關，已移除：它在唯一預設材質（通用玻璃）下
  // 恆為無效 —— 上一行就把 bgLum 歸零了，smoothstep(0.82, 0.97, 0) 是 0，乘什麼
  // 都還是 0。而 UI 的啟用條件又剛好相反（只在非液態薄膜時可按，也就是只在它
  // 無效的那個材質上可按），所以那顆開關在任何可達的設定下都碰不到畫面。
  //
  // 移除後等於「永遠開啟」，與移除前的預設狀態完全一致（該參數預設為 true，
  // 液態薄膜下 UI 只是停用、並不會把值改掉）。順帶修掉一個殘留狀態的坑：先在
  // 通用玻璃把它關掉、再切到液態薄膜，那個 false 會跟著生效並悄悄改掉薄膜的
  // 外觀，而此時滑桿是灰的、使用者無從得知。
  float whiteBackdrop = (1.0 - float(uBgMode))
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
  // 稜光光芒（見 prismBeamField）。beamLight 是已經乘完所有遮罩的最終加光量，
  // beamMask 供後面的彩度後處理使用。
  vec3 beamLight = vec3(0.0);
  float beamMask = 0.0;
  // 亮底的吸收乘數（見下方合成處）。1 = 不吸收。暗底恆為 1。
  vec3 beamAbsorb = vec3(1.0);
  vec3 exitPoint = p;
  vec3 exitNormal = -N;
  float pathLength = 0.0;
  bool hasExitSurface = false;
  bool needsEnvironmentTransmission =
    uBgMode == 0 && uHasEnv == 1
      && (uEnvRefraction > 0.001 || universalGlass);
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
  // 稜光光芒：沿折射後的出射方向取樣程序化光束圖樣（見 prismBeamField）。
  // 完全不用額外的 raymarch —— 舊版在這裡每個 fragment 要多跑四次波長追蹤。
  if (uRayDispersionEnabled > 0.5 && uRayBeamIntensity > 0.001) {
    // 背面追蹤成功時 transmissionDir 是穿過整塊玻璃後的方向；沒命中時它會保留
    // 前表面的 Snell 折射方向，效果仍然成立（只是少了背面那一次彎折）。
    vec3 beamQ = prismBeamCoord(rd, transmissionDir);
    vec3 beams = prismBeamField(beamQ.xy, beamQ.z);
    // 讓光芒真的「在玻璃裡」而不是浮在表面上：
    //   透射率決定有多少光穿得過來（反射掉的那部分不該帶著光束）
    //   體積吸收讓光程長的地方偏色、變暗，光束因此有厚度感
    //   折射彎曲量讓光束集中在造型真正起透鏡作用的地方，平坦處自然收斂
    // material.transmission 是 vec3（各通道的透射率不同），所以這裡也必須是
    // vec3 —— 順帶讓光束被玻璃自身的透射色染色，比取單一純量更對。
    vec3 transmit = material.transmission * (1.0 - backFres * 0.55);
    // 下限刻意留高（0.5 而非更低）：localPrism 在平坦的中央幾乎為 0，壓太狠會讓
    // 光芒只剩輪廓一圈，變成邊緣描邊而不是「光束穿過整塊玻璃」。
    float lensing = mix(0.5, 1.0, clamp(localPrism * 1.6, 0.0, 1.0));

    // Fresnel 遮罩。跟虛擬光譜焦散同一套寫法：mix(1.0, mask, 滑桿)，所以滑桿為 0
    // 時是「完全不限制」，語意乾淨。
    //
    // 它跟上面的 lensing 是同一個軸（都把光芒往邊緣集中），不是新維度 —— 存在的
    // 理由是 lensing 的下限刻意留在 0.5 以保住內部可見度，這根滑桿讓那個決定可以
    // 被覆寫，想要純邊緣描邊的畫面時才用得到。
    //
    // 焦散那邊還會用膜褶（membraneFold）補一項，這裡沒有：membraneFold 要到更
    // 後面才算得出來，而把整段光芒搬到它後面只為了一個薄膜專屬的加成不值得。
    float beamFresnel = pow(clamp(material.edgeFactor, 0.0, 1.0), 1.8);
    beamFresnel = mix(1.0, beamFresnel, clamp(uRayBeamFresnelMask, 0.0, 1.0));

    // Noise 遮罩。圖樣本身是完美規則的極座標晶格，那正是它有時看起來機械的原因；
    // 用噪聲把它打散成參差的斑塊，質地才像光穿過不均勻的介質而不是印上去的網格。
    //
    // 噪聲的流動速度直接掛在「流動速度」上（乘 0.02 收成很慢），不另外開滑桿：
    // 兩者本來就該同步，光點在流、底下的遮罩卻不動會看出分層。loopNoiseOffset 是
    // 現成的循環安全位移（相位式，不是線性累加），速度為 0 時回傳零向量，所以
    // 靜止時噪聲也精確靜止。
    float beamNoise = fbmFast(
      p * max(0.05, uRayBeamNoiseScale)
        + loopNoiseOffset(abs(uRayBeamSpeed) * 0.02)
    );
    float beamNoiseMask = mix(
      1.0,
      smoothstep(0.32, 0.68, 0.5 + beamNoise * 0.72),
      clamp(uRayBeamNoiseMask, 0.0, 1.0)
    );

    beamLight = beams * volumeAbsorption * transmit * lensing
      * beamFresnel * beamNoiseMask * uRayBeamIntensity;
    beamMask = clamp(max(beamLight.r, max(beamLight.g, beamLight.b)), 0.0, 1.0);
  }
  // 純色只控制畫布；水滴內部獨立取樣同一張 HDRI。若背面追蹤未命中，
  // transmissionDir 會保留前表面的 Snell 折射方向，滑桿仍能穩定產生效果。
  if (uBgMode == 0 && uHasEnv == 1 && uEnvRefraction > 0.001) {
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
    refractedBg = mix(refractedBg, envRefraction, uEnvRefraction);
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
  // 通用玻璃的內部自身能量不能依賴「環境折射」滑桿，也不能依賴畫布背景色：
  // refractedBg 在純色畫布上是 mix(bgColor, envSample, uEnvRefraction)，兩層
  // mix 疊在一起會讓畫布背景色以 k(1-k) 的權重滲進「自身能量」（k 為滑桿值，
  // 0.5 時滲入比例高達 25%）。去背輸出時背景會被強制改成黑色，這個殘留的
  // bg 依賴會讓輸出結果跟畫面上看到的不一致。改成固定取同一張 HDRI 的環境
  // 光量，完全不讀 refractedBg／uEnvRefraction，內部自身能量才能真正跟畫布
  // 背景與滑桿脫鉤；沒有 HDRI 時沒有其他光源可用，才退回 refractedBg。
  vec3 interiorFillLight = refractedBg;
  if (universalGlass && uBgMode == 0 && uHasEnv == 1) {
    interiorFillLight = sampleEnvironmentBackdrop(transmissionDir);
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

  // 液態薄膜不是把通用玻璃調淡，而是以同一對前／背表面重新合成：中央主要
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
    vec3 opaqueMembrane = uMembraneBaseColor
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
      membraneComposite * uMembraneVeilColor,
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
      uMembraneReflectionColor
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
  // 稜光光芒的合成。舊版在這裡有兩套完全不同的路徑（HDRI 差值相消 + 獨立光源
  // 光譜），再加上前面三個 mix 注入點，一共四處 —— 一個效果散在四個地方、還
  // 依背景模式分岔，難以預測也難以調。現在只有這一處。
  //
  // 暗底用 screen 加光（光束是額外的能量，不該讓底下的玻璃變暗）；白底改成
  // 選擇性透射 —— 白底上 screen 完全看不出來（1 已經飽和），所以改成保留色相、
  // 壓掉亮度，光束才會在白底上顯示成彩色而不是消失。這是 ART 與 LIGHT 兩層
  // 已經在用的同一套雙路合成，三者行為因此一致。
  if (beamMask > 0.001) {
    vec3 beamEnergy = 1.0 - exp(-max(beamLight, vec3(0.0)) * uMaterialExposure * 2.2);
    float beamPeak = max(beamEnergy.r, max(beamEnergy.g, beamEnergy.b));
    // 等亮度彩度調整：色散分離已經讓三通道不同步，這裡只是讓差異更明顯。
    float beamLuma = dot(beamEnergy, vec3(0.2126, 0.7152, 0.0722));
    beamEnergy = max(
      vec3(beamLuma) + (beamEnergy - vec3(beamLuma)) * max(0.0, uRayBeamChroma),
      vec3(0.0)
    );
    // 亮底 ↔ 暗底的交叉淡化：加光換成減光。
    //
    // 為什麼非換不可：白色已經沒有任何加色空間，額外的光加上去只會被夾在 1，
    // 所以在白底「加光」本質上是看不見的。要在白底看得見，唯一的辦法是反過來
    // 「減光」—— 真實的稜鏡打在燈箱上，看到的也是比白紙暗的彩帶，不是更亮的。
    //
    // 上一版只把加光壓掉、沒給白底任何替代，所以變得太淡。這一版是真的交叉：
    //   加法隨背景變亮而淡出（白底上的突兀原色斑因此消失）
    //   減法隨背景變亮而長出（白光被光譜濾過，彩帶清楚而且飽和）
    //
    // 兩者都由 brightWash 驅動，而它用的是 trueBgLum（見上方）而不是 bgLum ——
    // 後者在通用玻璃底下被歸零，問不出背景亮度。暗底時 brightWash 為 0：加法
    // 完整保留、減法乘數為 1，所以黑底外觀完全不變。
    float brightWash = smoothstep(0.35, 0.92, trueBgLum);
    vec3 beamAdd = beamEnergy * (1.0 - brightWash * 0.88);
    vec3 beamScreen = 1.0 - (1.0 - finalColor) * (1.0 - beamAdd);
    // 亮底路徑。之前這裡是「把顏色整片換成一個偏藍的色相、權重上限 0.68」，在白底
    // 上就變成一塊塊不透明的彩色貼片 —— 底下玻璃的明暗結構有近七成被蓋掉，所以
    // 難看。改成跟 ART 藝術色散同一套經過調校的做法，三個關鍵差別：
    //
    //   局部性遮罩：只在物理上說得通的地方著色 —— 邊緣、折射真正彎曲處、背面
    //   rim、薄膜的膜褶。原本無視位置整片上色，才會糊成色塊。
    //
    //   sqrt 感知響應：低強度在白底仍看得見，高強度則逐漸壓縮，而不是一過某個
    //   值就跳成不透明貼圖。
    //
    //   上限收到 0.30（原本 0.68）：底下玻璃至少保留七成，色散是「染上去」而不是
    //   「蓋掉」。這是白底好不好看最主要的一項。
    //
    // 暗底那條 screen 路徑完全沒動 —— 純黑底目前的樣子是刻意保留的。
    vec3 beamHue = beamEnergy / max(beamPeak, 0.001);

    // 減法那一半：白光被光譜濾過。乘法永遠不會超過 1,所以不會像加法那樣被截頂
    // 沖成灰白。深度給得夠（上限 0.72）彩帶才看得清楚 —— 這正是上一版太淡的地方，
    // 它只染在「透過去的背景」上、而且深度只有 0.32。
    //
    // 色相直接用 beamHue 不再降彩度：減法出來的顏色比白底暗，讀起來是彩帶而不是
    // 發光的原色斑，所以飽和在這裡是對的，不會有上一版那種突兀感。
    // sqrt 而不是線性：線性只有在最亮的那幾個點才吃到有意義的深度，而那些點面積
    // 很小 —— 在黑底上小點靠明暗對比就很搶眼，在白底上一樣大的小點卻不顯眼，這是
    // 白底看起來還是比較弱的真正原因。sqrt 把中低能量一起抬起來，彩帶因此鋪得開，
    // 而峰值處又不會過飽和（跟 ART 藝術色散用的是同一招）。
    beamAbsorb = mix(
      vec3(1.0),
      beamHue,
      clamp(sqrt(max(beamPeak, 0.0)) * 0.85, 0.0, 0.72) * brightWash
    );

    vec3 beamTransmission = mix(vec3(0.76, 0.90, 1.0), beamHue, 0.62);
    float beamLocality = clamp(
      material.edgeFactor * 0.76
        + localPrism * 0.62
        + backRim * 0.34
        + membraneFold * membraneMode * 0.52,
      0.0,
      1.0
    );
    float beamBrightSupport = max(whiteBackdrop, membraneMode * brightBg);
    float beamTransmissionAmount = beamBrightSupport * clamp(
      sqrt(max(beamPeak, 0.0))
        * 0.42
        * mix(0.18, 1.0, beamLocality)
        * mix(1.0, 1.36, membraneMode),
      0.0,
      0.30
    );
    finalColor = mix(beamScreen, beamTransmission, beamTransmissionAmount);
  }
  // 通用玻璃的亮底補償仍由原開關管理；液態薄膜本身就是透射模型，不依賴該開關。
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
      finalColor * uMembraneShadeColor,
      membraneShadeGrade
    );
    finalColor = mix(
      finalColor,
      uMembraneCardColor,
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
  // 去背輸出要反解回「自身能量」，必須留一份還沒被 over 合成的 clamp 動過
  // 的版本：加上透射光後夾到 [0,1] 是給不透明畫面用的，亮部很容易在那裡就
  // 先被截頂，再拿截頂後的值去反減、反除只會把能量憑空削掉，去背結果就會
  // 比畫面上看到的暗、也比較不飽和。
  vec3 universalOwnEnergy = finalColor;
  if (universalGlass) {
    universalTransmitted = refractedBg * material.transmission * volumeAbsorption
      * (1.0 - backFres * 0.72);
    // 覆蓋率取材質不透明度與自身能量兩者的較大值。不能只用
    // luma：純藍光的亮度權重只有 0.072，飽和色散即使能量很高也會
    // 被計成幾乎透明，PNG 疊在亮底上就會被背景沖成淡灰色。以最強
    // RGB 通道當能量下限，才能在 straight-alpha 裡完整容納高彩度光譜。
    float ownEnergyPeak = max(finalColor.r, max(finalColor.g, finalColor.b));
    universalCovered = clamp(
      max(material.darkAlpha, ownEnergyPeak),
      0.0,
      1.0
    );
    finalColor = clamp(finalColor + universalTransmitted * (1.0 - universalCovered), 0.0, 1.0);
  }

  // 稜光光芒的減法那一半，套在「已經合成完背景」的顏色上。
  //
  // 位置很關鍵：必須在通用玻璃把透射背景加進來之後。白底的亮度絕大部分來自那一
  // 項，光譜濾色要吃得到它才看得見 —— 上一版套在 universalTransmitted 上（加進來
  // 之前）只影響透過去的那部分，自身能量沒被濾到，所以效果被稀釋掉一半。
  //
  // 對其餘材質同樣有效：universalGlass 為假時上面那個 if 整段跳過，但 finalColor
  // 此時也已經是合成完的顏色，乘上去的語意一致。暗底時 beamAbsorb 恆為 vec3(1)，
  // 這一行是精確的恆等運算。
  finalColor = clamp(finalColor * beamAbsorb, 0.0, 1.0);

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
      // 通用玻璃天生就是 over 合成，去背不需要任何特殊處理：直接拿還沒被
      // over 合成夾過的自身能量除以覆蓋率反解出 straight color，不從已經
      // 截頂的畫面反減，亮部才不會在去背後失真變暗。
      outputAlpha = clamp(universalCovered, 0.02, 1.0);
      // 自身能量也要吃同一份光譜吸收，否則去背輸出會比畫面上看到的少一層彩帶。
      finalColor = clamp(universalOwnEnergy * beamAbsorb / outputAlpha, 0.0, 1.0);
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

// ===== 編譯器基線探針（?diag=compilerbaseline）=====
//
// 這不是 Bubble 的簡化版，而是一支獨立的最小 fragment shader，只為了回答一個問題：
// 在完全相同的 Three.js / WebGL2 / ShaderMaterial / renderer / camera / scene /
// 全螢幕算繪架構下，Windows Chrome 的 ANGLE 到不到得了「能正常快速編譯」的狀態。
//
// 之所以另外寫一支而不是在正式 shader 上再包幾十個 #ifdef：要排除的東西多到幾乎
// 沒有原本的程式碼會留下，那樣的 #ifdef 密度既難驗證也容易誤刪，而且會動到正式
// shader。獨立一支可以保證正式 shader 完全沒被觸碰。
//
// 刻意完全不含：
//   procedural noise（snoise / fbm / fbmFast）、內部折射追蹤、薄膜干涉、色散、
//   OPD、光譜、稜光光芒、衛星滴、負形場、微滴、造型距離場（SVG/GLB）、毛細波、
//   geometry wobble、背景合成、環境反射、任何 sampler / texture lookup。
//
// 只剩：相機射線 → 極短 raymarch → 命中 → 四面體法線 → Lambert → 輸出。
// 畫面只會是一兩顆藍色的球，很醜，這是預期的。
const FRAG_BASELINE = `
precision highp float;
varying vec2 vUv;

uniform vec2  uResolution;
uniform mat3  uRot;
uniform float uCameraDistance;
uniform float uTanHalfFov;
uniform float uCompositionOffsetX;
uniform float uCompositionOffsetY;
uniform vec4  uDrops[12];
uniform int   uCount;

#ifdef CALL_FBMFAST_MAPSCENE
// 對應正式 shader 的 geometry wobble 與 loopNoiseOffset 所需
uniform float uTime;
uniform float uLoopDuration;
uniform float uWobble;
uniform float uWobbleScale;
uniform float uWobbleSpeed;
#endif

// 兩個上限都是編譯期常數（由 ShaderMaterial.defines 覆寫），不是 runtime uniform。
#ifndef MAX_MARCH_COMPILE
#define MAX_MARCH_COMPILE 4
#endif
#ifndef MAX_DROPS_COMPILE
#define MAX_DROPS_COMPILE 2
#endif

// 以下三段直接沿用正式 shader 拆出來的同一份 GLSL，逐字元相同 —— 重寫一份等價的
// noise 測不出原本那份的編譯行為，診斷就失去意義。三段各自獨立開關，好把
// 「snoise 本體」「fbm 的 4 次迴圈」「fbmFast 的兩次取樣」分開量。
#ifdef NEED_SNOISE
${SNOISE_GLSL}
#endif
#ifdef NEED_FBM
${FBM_GLSL}
#endif
#ifdef NEED_FBMFAST
${FBMFAST_GLSL}
#endif
#ifdef CALL_FBMFAST_MAPSCENE
// 正式 shader 裡 fbmFast 的取樣座標會加上這個循環位移，一併帶進來。
const float TAU = 6.28318530718;
vec3 loopNoiseOffset(float speed){
  float phase = TAU * uTime / max(uLoopDuration, 0.001);
  return vec3(cos(phase), sin(phase), sin(phase * 2.0)) * speed;
}
#endif

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// 只有球體 SDF 與 smooth union，沒有形變、沒有 noise、沒有取樣。
float mapScene(vec3 p){
  float d = 1e9;
  for (int i = 0; i < MAX_DROPS_COMPILE; i++){
    if (i >= uCount) break;
    d = smin(d, length(p - uDrops[i].xyz) - uDrops[i].w, 0.35);
  }
#ifdef CALL_FBMFAST_MAPSCENE
  // 對應正式 shader mapScene 尾端那一行 geometry wobble。呼叫點刻意放在這裡：
  // mapScene 是被 raymarch 迴圈重複呼叫的，noise 的展開成本會被乘上迴圈次數。
  d += fbmFast(p * uWobbleScale + loopNoiseOffset(uWobbleSpeed)) * uWobble * 0.25;
#endif
  return d;
}

vec3 calcNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  float h = 0.002;
  return normalize(
    k.xyy * mapScene(p + k.xyy * h) +
    k.yyx * mapScene(p + k.yyx * h) +
    k.yxy * mapScene(p + k.yxy * h) +
    k.xxx * mapScene(p + k.xxx * h));
}

void main(){
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uResolution.x / uResolution.y;
  uv += vec2(uCompositionOffsetX, uCompositionOffsetY);

  vec3 ro = uRot * vec3(0.0, 0.0, uCameraDistance);
  vec3 rd = uRot * normalize(vec3(uv * uTanHalfFov, -1.0));

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < MAX_MARCH_COMPILE; i++){
    float d = mapScene(ro + rd * t);
    if (d < 0.001){ hit = true; break; }
    t += d;
    if (t > 12.0) break;
  }

  if (!hit){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec3 N = calcNormal(ro + rd * t);
  float lambert = max(0.0, dot(N, normalize(vec3(0.4, 0.7, 0.6))));
  // 以下三種呼叫都在 raymarch 迴圈「之外」，只執行一次，用來把「函式本身的編譯
  // 成本」與「被迴圈重複呼叫的成本」分開。
#ifdef CALL_SNOISE_MAIN
  lambert *= 0.9 + 0.1 * snoise(N * 2.0);
#endif
#ifdef CALL_FBMFAST_MAIN
  lambert *= 0.9 + 0.1 * fbmFast(N * 2.0);
#endif
#ifdef CALL_FBM_MAIN
  lambert *= 0.9 + 0.1 * fbm(N * 2.0);
#endif
  gl_FragColor = vec4(vec3(0.15, 0.35, 0.7) * (0.15 + 0.85 * lambert), 1.0);
}
`;

export { FRAG_BASELINE };
