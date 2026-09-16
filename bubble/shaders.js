import { ENVIRONMENT_GLSL } from './shader-chunks/environment.js';
import { GEOMETRY_GLSL } from './shader-chunks/geometry.js';
import { OPTICS_GLSL } from './shader-chunks/optics.js';

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
// 法線取樣數。四面體 4 個 tap、SVG 分軸中央差分 6 個 tap，兩者都恆定。
//
// 它們是 uniform 而不是常數，作用不是「可以調」，而是讓 calcNormal 那個共用迴圈的
// trip count 對 fxc 保持未知：上界若是編譯期常數，fxc 會把迴圈攤平成一份一份的
// mapScene，這一整套編譯規模的改善就沒了（見 calcNormal 的說明）。
uniform int   uNormalTaps;
uniform int   uNormalAxisTaps;

// ===== shader cache 破壞用的 salt（?shaderRun=N）=====
// 目的：強迫每次都是 cold compile。
//
// 這裡的難點是一組互相拉扯的要求：要讓驅動的 D3D bytecode 快取 miss，翻譯出來的
// HLSL 就必須不同；但又不能改變畫面或動到熱路徑的數值。
//
// 做法：讓「整數字面值」出現在 HLSL 裡，但把它乘上一個恆為 0 的 uniform。
//   * float(SHADER_RUN) 是編譯期字面值 → 不同 N 產生不同的 HLSL → 快取必然 miss
//   * uShaderSalt 恆為 0，而且是 uniform，編譯器無法在前端把整式折掉
//   * 乘積在執行期恆為 0.0（正常浮點零，不是 denormal）→ 畫面完全不變
//
// 前一版用 float(SHADER_RUN) * 1e-30 並加在 raymarch 的起始 t 上，那是錯的：
// 1e-30 雖然還在 float 的正規範圍內，但那種量級容易踩到 D3D 編譯器的
// denormal / flush-to-zero 特殊路徑，而且它直接動到了 raymarch 的數值。
// 現在改成只加在「背景色」上 —— 那在 SDF 與 raymarch 之外。
uniform float uShaderSalt;   // 一律為 0，只是為了讓上面的乘法無法被折掉

uniform int   uCount;
uniform float uViscosity;
uniform float uWobble;
uniform float uWobbleScale;
uniform float uWobbleSpeed;
uniform float uResearchShellAmount;
uniform float uResearchShellSpeed;
uniform float uResearchShellDensity;
uniform float uResearchShellTexture;
uniform float uResearchShellTint;
uniform vec3 uResearchShellTintColor;
uniform float uResearchShellTintEdge;
uniform sampler2D uResearchShellTintRamp;
uniform float uResearchShellMultiTint;
uniform float uResearchShellMultiTintStrength;
uniform float uResearchShellMultiTintRotation;
uniform float uResearchShellMultiTintFocus;
// 紋理方向。三個分量合起來是一個向量,長度不重要(shader 會正規化),只有方向
// 有意義;全為 0 時退回 +x。
uniform float uResearchTextureDirX;
uniform float uResearchTextureDirY;
uniform float uResearchTextureDirZ;
// 內部氣泡的開關（1 開、0 關）、顆數，與大小範圍（外殼半徑的倍數）。
uniform float uResearchBubbles;
uniform float uResearchBubbleCount;
uniform float uResearchBubbleMin;
uniform float uResearchBubbleMax;
uniform float uResearchIconIOR;
uniform float uResearchIconTint;
uniform vec3 uResearchIconTintColor;
uniform float uResearchIconTintEdge;
uniform sampler2D uResearchIconTintRamp;
uniform float uResearchIconMultiTint;
uniform float uResearchIconMultiTintStrength;
uniform float uResearchIconMultiTintRotation;
uniform float uResearchIconMultiTintFocus;
uniform float uResearchIconSizeA;
uniform float uResearchIconSizeB;
uniform float uResearchIconTailTip;
uniform float uResearchIconAspect;
uniform float uResearchIconSpread;
uniform float uResearchIconStagger;
uniform float uResearchIconDepth;
// 相對循環的整體位移（正值延後）與 B 相對 A 的出生錯開。
uniform float uResearchIconPhaseOffset;
uniform float uResearchIconBirthStagger;

// icon 相對於外殼玻璃的折射率。內外是同一種液態玻璃,材質流程完全共用,只有這個
// 比值不同 —— 大於 1 表示內部這一坨比外殼更「稠」,光路彎得更多,所以看得出形狀。
// 等於 1 時在光學上與外殼無法分辨(icon 直接消失),而小於等於 0 會讓 refract 的
// eta 變成除以零,所以這裡夾住下限,不信任外部傳進來的值。
float researchIconRelIOR(){ return max(uResearchIconIOR, 1.02); }
// 打字模式。字形距離場圖集（glyph-field.js 烘的）與整行的排版／擠出參數。
// 每一格字自己的資料（哪一個字形、成形進度）走 uTypeGlyphData 這張 1D 資料貼圖，
// 跟 uMicroDrops 同一個手法——GLSL ES 1.0 對 uniform 陣列的非常數索引限制不一，
// 換成貼圖取樣就完全繞開這個問題。
uniform sampler2D uTypeAtlas;
uniform sampler2D uTypeGlyphData;
uniform vec4  uTypeAtlasInfo;  // x：圖集列數，y：行數，z：每格解析度，w：距離編碼範圍
uniform vec4  uTypeLine;       // x：字距（格單位），y：字級，z：基線位移，w：可見字數
uniform vec4  uTypeShape;      // x：擠出厚度，y：邊緣圓角，z：液態長出，w：字形特徵尺度
uniform vec4  uTypeCaret;      // xy：游標中心，z：半寬，w：>0.5 代表這一幀亮著
uniform float uTypeCaretDepth;  // 游標自己的擠出厚度，跟字形的 uTypeShape.x 分開
uniform float uTypeSoftness;    // 邊緣液化：把字形距離場整體外推，筆畫變粗、細節熔合
uniform vec4  uDrops[12];       // xyz：中心，w：半徑（CPU 每幀更新）
uniform vec4  uDropShape[12];   // xyz：形變主軸，w：體積守恆的縱向伸縮
uniform vec4  uDropPhysics[12]; // x：接觸壓平，y：形狀振盪，z：斷裂尖端，w：融合權重
uniform vec4  uBounds;         // xyz：包圍球中心，w：半徑
uniform int   uShapeType;      // 0 無, 1 SVG 擠出, 2 GLB/GLTF 體積
uniform float uShapeProgress;
uniform int   uExtendedMotion;
uniform vec4  uExtendedParams;
uniform vec4  uCapillaryStyle; // x 波場、y 程序紋理、z 波峰過渡、w 保留
uniform vec3  uCapillaryDirection;
uniform int   uStaticShape;     // 靜態模式的幾何：0 方體 1 平面 2 圓盤 3 球體
                                 // 4 圓柱 5 圓錐 6 圓環 7 匯入（見 registry.js）
uniform float uBoxSize;         // 靜態模式：方體半邊長
uniform float uBoxCornerRadius; // 靜態模式：方體圓角半徑
uniform float uPrimitiveSize;   // 靜態模式：平面/圓盤/球體/圓柱/圓錐/圓環的主尺寸
uniform float uPrimitiveHeight; // 靜態模式：圓柱/圓錐的半高
uniform float uPrimitiveTubeRatio; // 靜態模式：圓環管半徑／主半徑的比例
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
uniform mat3  uShapeRigid2Rot;
uniform vec3  uShapeRigid2Offset;
uniform vec3  uShapeRigid2Scale;
uniform float uContactLead;
uniform float uShapeDepth;
uniform float uShapeSoftness;
// 形狀 B 自己的邊緣液化。形狀變形模式下兩顆形狀各有一份，其餘模式場上只有
// 形狀 A（ch 恆為 0），這顆用不到（見 shapeSoftnessFor）。
uniform float uShapeSoftnessB;
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
uniform int uSpectralCausticMapping;
uniform float uSpectralCausticFocus;
uniform float uSpectralCausticWidth;
uniform float uSpectralCausticLightSize;
uniform float uSpectralCausticDensity;
uniform float uSpectralCausticSoftness;
// 薄膜噪聲的色塊柔化：壓低 fbm 第二個 octave 的權重。見 causticOctaves。
uniform float uSpectralCausticFilmSoften;
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
// 0 = 對話泡 icon 不受焦散影響（icon 所在像素維持原樣），1 = 焦散改用 icon
// 自己的表面與法線（跟 FEATURE_DISPERSION 換座標系是同一套處理），讓聚光帶
// 貼著 icon 的曲率走。見 FEATURE_SPECTRAL_CAUSTICS 區塊。
uniform float uSpectralCausticIconAffect;
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
// 淺底專屬的漸層背景（棚拍常見的無縫背景紙）：由頂到底柔和過渡，取代淺底時
// 原本的純色 uBgColor。用畫面垂直方向（見 backgroundSample 裡的 d.y）驅動，
// 不吃 uBgMode/uBgColor —— 選了淺底就直接是這個漸層，不需要另外切換。
uniform vec3  uLightBgGradientTop;
uniform vec3  uLightBgGradientBottom;
// 只驅動這個漸層背景，刻意不用 uLightBackdrop（那顆目前釘死在兩個值都是 0，
// 因為它還接著一大批尚未定案的淺底外觀邏輯 —— icon 顯色、brightComposite 等。
// 這裡要的只是「選了淺底就顯示漸層背景」這一件事，所以另開一個乾淨的開關，
// 不去牽動那些休眠中的路徑）。
uniform float uLightBgGradientEnabled;
// 底色情境（見 bubble.js 的 SELECT_DEFAULTS.backdrop）。0 = 深底，1 = 淺底。
//
// 這個材質在深底上的顯色方式是「自身能量」：水滴自己發出的光疊在黑場上，最後
// 由 over 合成把背景讓進來。那套在白背景上會失效，而且失效的方式是數學上的必然
// 而不是強度不足 —— over 合成是 final = own + bg·(1 - cover)，cover 取自身能量
// 的峰值，背景為 1.0 時整式恆等於 1.0。自身能量被精確地抵銷掉。
//
// 淺底因此走另一條合成：同一份自身能量，改成「對背景的選擇性吸收」。留下來的
// 顏色仍然是這個材質自己的顏色，所以換到白底看起來還是同一個材質，不是另外配
// 一組美術模型（那是液態薄膜走的路，見 uMembraneOverWhite）。
//
// 三個作用點：白底專屬 brightComposite、低彩度自身能量的去暖色偏，以及
// researchIconColor／researchIconMask（內部 icon 的獨立顯色）。深底時全部不讀。
uniform float uLightBackdrop;
// 淺底的體積強化。只在 uLightBackdrop 為 1 時壓低背光與掠射面。
uniform float uLightShow;
// 完整的淺底外觀。這組值只進入 bright/light 分支，深底路徑不讀取。
uniform float uLightClarity;
uniform float uLightDepth;
uniform float uLightCardStrength;
uniform float uLightChroma;
// 淺底時內部 icon 的獨立顯色（見 researchIconColor）。刻意跟體積吸收脫鉤：
// 這三根只在淺底作用，深底一律不讀，所以調它們動不到黑底的任何外觀。
//
// 顏色控制淡體積色；明暗反射卡獨立保留，避免可讀性依賴選色。
uniform vec3  uLightIconColor;
uniform float uLightIconClarity;
uniform float uLightIconTint;
uniform float uLightIconEdge;
uniform vec3 uLightIconRimColor;
uniform float uLightIconRimStrength;
uniform float uEnvRefraction;
uniform float uReflect;
uniform float uTransmission;
// 輸出是否保留高於 1 的量級。0（直接畫到 8-bit canvas，也是後處理加入之前的
// 行為）時最後一步照舊夾在 0–1；1（畫進後處理的半浮點貼圖）時只擋負值。
//
// 這一顆存在的理由是 bloom：夾在 1 的畫面沒有「溢出來的能量」這種東西，門檻只能
// 設在 1 以下，取出的是正常畫面的一部分，糊開之後是一層白霧而不是光。環境反射
// （HDRI 經 PMREM 之後本來就可能遠大於 1）乘上反射強度與材質曝光，真正的高光
// 量級一直都在，只是被最後那行 clamp 丟掉了。
uniform float uHdrOutput;
// 後處理要不要一份「物件遮罩」。1 時 alpha 改寫成「這個像素是不是物體」：命中
// 幾何是 1、純背景是 0，顏色完全不動。
//
// 這是給後處理鏈用的：亮部取樣如果把背景也算進去，白底就會整片被當成光源餵進
// bloom 與條紋，糊回來之後整個畫面爆掉、物體消失；對比與亮度同理，那是調色，
// 應該只作用在主體上，不該連背景一起推。
//
// 只在「後處理有在跑」而且「不是去背輸出」時開啟：去背那條路的 alpha 有它自己的
// 意義（straight alpha 的覆蓋率），不能被遮罩蓋掉；而後處理旁路時 alpha 必須維持
// 原本的 1.0，否則不透明的匯出 PNG 會變成透明背景。
uniform float uCoverageAlpha;

// 高光增益。只推「已經接近上限」的那一段，中間調幾乎不動 —— 所以它幾乎不改變
// 畫面本身的樣子，改變的是餵給後處理的高光有多少量級可以溢出。
//
// 這根存在的理由：實測畫面峰值只有 1.25（黑底）到 2.2（HDRI），而 bloom 與眩光
// 的門檻要能當「只取高光」用，高光就得明顯高過 1。沒有它，門檻只能壓到 0.5 以下，
// 那等於把正常畫面也倒進去糊。
//
// 只在 HDR 輸出時生效：直接畫到 8-bit canvas 時被推上去的部分反正會被夾掉，
// 開了也看不出差別，不如明確地不做。
uniform float uHighlightGain;

// 純背景像素。後處理要遮罩時 alpha 寫 0，其餘情況維持背景本來的 alpha
// （去背輸出是 0、不透明是 1）。
vec4 backgroundPixel(vec4 bg){
  return vec4(bg.rgb, uCoverageAlpha > 0.5 ? 0.0 : bg.a);
}

vec3 clampOutput(vec3 c){
  if (uHdrOutput > 0.5) {
    c = max(c, vec3(0.0));
    if (uHighlightGain > 1.0) {
      float peak = max(c.r, max(c.g, c.b));
      // 0.75 起算：低於這裡的完全不動，到 1.0 才吃滿增益。用 smoothstep 而不是
      // 硬切，否則會在等亮度線上留下一圈看得見的邊。
      c *= mix(1.0, uHighlightGain, smoothstep(0.75, 1.0, peak));
    }
    return c;
  }
  return clamp(c, 0.0, 1.0);
}

// 體積吸收：濃度倍率與液體顏色。預設（×1 與 #68b2e7）算出來的係數就是這兩個
// 控制項出現以前寫死的 vec3(0.045, 0.018, 0.005)，誤差在 8-bit 選色器的捨入
// 範圍內 —— 預設不改變任何模式的外觀。
uniform float uAbsorb;
uniform vec3  uAbsorbColor;
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

// 環境／PMREM 探針（?diag=probe-no-env-pmrem）：連 three.js 這一整塊都不編。
// 底下 sampleReflection / sampleEnvironmentBackdrop 的本體同時會被換成不含
// textureCubeUV 的版本，所以拿掉這個 chunk 之後沒有任何東西會參照到它。
#ifdef FEATURE_ENV_PMREM
#include <cube_uv_reflection_fragment>
#endif

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
// 行動版永遠只用四方向環形補樣，編譯時直接移除另外四次展開的 textureCubeUV。
// 桌面版仍保留八方向，由 uReflectionSampleCount 在執行時選完整或省電路徑。
#ifndef MAX_REFLECTION_SAMPLES
#define MAX_REFLECTION_SAMPLES 8
#endif
// 跟 bubble.js 的 MAX_MICRO_DROPS 綁死。下面的迴圈在 m >= uMicroCount 時動態跳出，
// 所以拉高這個值只是讓著色器能容納更多微滴，不會讓沒用到的那些也付出取樣成本。
const int   MAX_MICRO = 48;
const int   MAX_NEGATIVE = 4;
const float PI   = 3.14159265359;
const float TAU  = 6.28318530718;

${NOISE_GLSL}

float hash11(float n){ return fract(sin(n * 127.1) * 43758.5453123); }

// ===== 粗糙度在「透射側」的作用量 =====
//
// uRoughness 原本只接在反射那一條線上（sampleReflection 的 PMREM lobe 寬度，
// 以及玻璃亮點的指數）。問題是通用玻璃的反射權重極小：正視角的 Fresnel 只有
// f0 = ((n-1)/(n+1))² ≈ 2%，而透射率預設 0.96，畫面絕大部分是折射進來的背景。
// 於是滑桿實際上只在 Fresnel 衝高的輪廓那一圈有反應，中央幾乎不動——「調粗糙度
// 好像沒作用」就是這麼來的。而且色散（稜光光芒／光譜焦散）整條都掛在透射方向
// 上，完全沒接粗糙度，會出現「霧面玻璃卻打出針一樣銳利的彩虹光芒」這種矛盾。
//
// 這支函式把同一根滑桿接到透射側的兩個地方：折射／內部填光取樣的預濾波寬度，
// 以及色散圖樣的銳利度。兩者共用同一個換算，滑桿才會是一致的一件事。
//
// 注意這裡只做「模糊」與「鈍化」，不做任何方向擾動——單樣本渲染下的確定性擾動
// 只會變成一層看得見的花紋（見下方 exitDir 附近那段註解）。
//
// 刻意用 rough 而不是 GGX 慣用的 rough²。理由有兩個：
//
// 一、rough² 會把滑桿的低段整個吃掉。粗糙度預設 0.2、幾個模式的 override 是
//     0.26，平方之後只剩 0.04～0.07，幾乎貼著下面那個 0.025 的抗鋸齒下限——
//     等於換一種方式重演「推了沒感覺」，正是這次要修的問題本身。
// 二、sampleReflection 裡的 PMREM 取樣本來就是把 rough 直接當 lod 參數用
//     （textureCubeUV(uPmremMap, d, rough)），只有補樣環的半徑才用 rough²。
//     這裡的用途跟前者同類（選 mip），所以線性才是跟既有程式一致的那個選擇。
float transmissionSpread(){
  return clamp(uRoughness, 0.0, 1.0);
}
vec3 loopNoiseOffset(float speed){
  float phase = TAU * uTime / max(uLoopDuration, 0.001);
  return vec3(cos(phase), sin(phase), sin(phase * 2.0)) * speed;
}

// 焦散專用的兩 octave 噪聲。detail = 1.0 時與 fbmFast 完全等價（同樣兩次 snoise，
// 同樣的權重），所以柔化滑桿在 0 的時候是精確的恆等運算，不動既有畫面。
//
// detail 往 0 收時只削掉第二個 octave —— 那一項正是讓色塊邊界皺起來的來源。
// 色塊的大小由第一個 octave 決定，不受影響，所以視覺上是「邊界糊掉但大小不變」，
// 而不是「整個變大」。這是它跟「Noise 相對尺度」的分工。
float causticOctaves(vec3 p, float detail){
  return 0.5 * snoise(p) + 0.25 * detail * snoise(p * 2.02);
}

${ENVIRONMENT_GLSL}${GEOMETRY_GLSL}${OPTICS_GLSL}void main(){
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uResolution.x / uResolution.y;
  // 桌面維持英雄鏡置中；手機依可用視覺區上移，避免主體被底部控制面板切掉。
  uv += vec2(uCompositionOffsetX, uCompositionOffsetY);
  float tanHalfFov = uTanHalfFov;

  vec3 ro = uRot * vec3(0.0, 0.0, uCameraDistance);
  vec3 rd = uRot * normalize(vec3(uv * tanHalfFov, -1.0));

  // 物體背後的背景畫布：不吃粗糙度（那是物體表面的性質，不是背景的）。
  vec4 bg = backgroundSample(rd, 0.0);
  // 透射側的粗糙度預濾波寬度（見 transmissionSpread 的說明），直接當 PMREM 的
  // lod 參數用。上限壓在 0.85 而不是 1.0：PMREM 最高階的那幾層已經接近一顆單色
  // 球，糊到底會讓玻璃裡什麼結構都不剩，看起來像實心塑膠而不是霧面玻璃。
  float roughBlur = transmissionSpread() * 0.85;
#ifdef SHADER_RUN
  // cache-bust：恆為 0，不影響畫面。放在這裡是因為它在 SDF 與 raymarch 之外。
  bg.rgb += vec3(float(SHADER_RUN) * uShaderSalt);
#endif
  float dispersionStrength = uDispersion * uDispersionEnabled;

  // 僅追蹤真正穿過物件包圍球的射線；色散發生在透明材質內部，不生成
  // 幾何外側的彩虹描邊或光暈。
  vec3 oc = ro - uBounds.xyz;
  float qb = dot(oc, rd);
  float qc = dot(oc, oc) - uBounds.w * uBounds.w;
  float qh = qb * qb - qc;
  // 三個「這條射線沒碰到任何東西」的提早返回都要寫成背景遮罩（alpha 0），
  // 少一個就會有一整塊背景被後處理當成物體 —— 包圍球外那一大片正是走這裡。
  if (qh < 0.0){ gl_FragColor = backgroundPixel(bg); return; }
  qh = sqrt(qh);
  float tEnd = -qb + qh;
  if (tEnd < 0.0){ gl_FragColor = backgroundPixel(bg); return; }

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

  if (!hit){ gl_FragColor = backgroundPixel(bg); return; }

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
  // 通用玻璃的 bgLum 會刻意歸零，因為暗底自身能量要在黑場生成；但使用者明確
  // 選擇淺底時，最終材質仍必須切到 brightComposite。舊寫法只看歸零後的 bgLum，
  // 使整條 Light Look 永遠不可達，畫面實際仍是黑底 HDRI 反射再疊白背景。
  float brightBg = max(
    smoothstep(0.45, 0.90, bgLum),
    universalGlass ? clamp(uLightBackdrop, 0.0, 1.0) : 0.0
  );
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
    * smoothstep(0.82, 0.97, trueBgLum);
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
#ifdef FEATURE_RESEARCH
  bool researchIconHit = false;
  vec3 researchIconPoint = vec3(0.0);
  vec3 researchIconN = vec3(0.0, 0.0, 1.0);
  vec3 researchInsideDir = rd;
  float researchIconFres = 0.0;
  float researchIconBend = 0.0;
  // 淺底局部玻璃的反射／厚度色，在外殼合成後套用以保持辨識度。
  vec3 researchIconColor = vec3(1.0);
  // icon 表面的正對程度（1 = 正視，0 = 掠射），用來柔化真正剪影邊界。
  float researchIconFacing = 1.0;
  // 光在 icon 內部走過的長度。深底時它只是併進總光程（見 pathLength），淺底另外
  // 需要它單獨算一份「這顆 icon 自己的吸收」—— 全域的體積吸收是整顆水滴一起
  // 染色，沒辦法只讓 icon 顯色而外殼維持接近白。
  float researchIconPath = 0.0;
  float researchIconWeight = 0.0;
  vec3 researchIconTransmissionTint = vec3(1.0);
  vec3 researchShellTransmissionTint = vec3(1.0);
  vec3 researchBoundaryColor = vec3(1.0);
  float researchBoundaryDepth = 0.0;
  // icon 在這個像素上「被染色了多少」。淺底顯色（uLightShow）要靠它把自己從
  // icon 身上收回來 —— 見下方 showWeight。
  float researchIconMask = 0.0;
#endif
  bool needsEnvironmentTransmission =
    uBgMode == 0 && uHasEnv == 1
      && (uEnvRefraction > 0.001 || universalGlass);
  if (brightBg > 0.001 || needsEnvironmentTransmission || universalGlass) {
    vec3 insideDir = refract(rd, N, 1.0 / uIOR);
    if (dot(insideDir, insideDir) > 0.0001) {
      transmissionDir = normalize(insideDir);
      bool tracedExit = traceExitSurface(
        p, normalize(insideDir), exitPoint, exitNormal, pathLength
      );
      if (tracedExit) {
        hasExitSurface = true;
        insideDir = normalize(insideDir);
#ifdef FEATURE_RESEARCH
        researchInsideDir = insideDir;
        researchIconHit = researchTraceIcon(
          p + insideDir * 0.004,
          insideDir,
          max(pathLength - 0.008, 0.0),
          researchIconPoint, researchIconWeight
        );
        if (researchIconHit) researchIconN = researchIconNormal(researchIconPoint);
#endif
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
          bool tracedBounce = traceExitSurface(
            exitPoint, bounceDir, exitPoint2, exitNormal2, pathLength2
          );
          if (tracedBounce) {
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
        // 註：這裡曾經有一段「微觀刻面」——用一個平滑的三角函數場擾動出射方向，
        // 想模擬霧面把光打散成一個錐。那是錯的：單樣本渲染沒辦法用擾動做出
        // 「散開」，任何確定性的擾動場都會被原封不動地畫成一層看得見的圖案，
        // 結果是壓花玻璃的紋路而不是霧面（粗糙度不該長出花紋）。真正的霧面
        // 要嘛在錐內多重取樣（每根都得重跑 traceExitSurface，太貴），要嘛就是
        // 現在的做法：模糊全部交給 PMREM 的預濾波（roughBlur），那本來就是
        // 已經濾好的環境，零額外取樣。
        transmissionDir = exitDir;
        // A：折射進來的背景依粗糙度預濾波。這是「霧面玻璃」最主要的視覺來源——
        // 畫面九成以上的內容走這條路徑，接上這裡滑桿才真的有感。
        refractedBg = backgroundSample(exitDir, roughBlur).rgb;
        // 註：這裡試過「RGB 通道各自以不同折射率取樣」的真色散（chromatic
        // aberration），結論是不划算，已經移除。留個記錄避免重踩：
        //
        // 一、做在這一行沒有意義。純色畫布下 backgroundSample 完全不看方向
        // （直接回傳 uBgColor），三個通道取到同一個常數，相減恆為零。
        //
        // 二、改成對 HDRI 取樣（白底時唯一帶方向資訊的來源）雖然會動，但要多
        // 付兩次環境取樣，而效果在均勻白底上肉眼分辨不出來 —— 這是物理限制而
        // 不是實作問題：所有方向看過去都一樣亮的背景，折射影像本身就沒有錯位
        // 可言。真實產品照的彩虹來自棚燈與反光板的不均勻，不是那張白紙。
        //
        // 所以白底的色散顯色一律走互補扣除（RAY／ART／LIGHT 三條線都是，各自
        // 見 beamAbsorbAmount／absorbAmount／causticAbsorbAmount）。

#ifdef FEATURE_RESEARCH
        // 內部物件與外殼是同一種液態玻璃,只有折射率不同,所以它不該自己疊一層
        // 顏色 —— 它要走的是跟外殼一模一樣的流程:折射進去、量光程、折射出來、
        // 用同一支 backgroundSample 取環境、用同一組係數吸收。合成點放在這裡
        // (而不是 finalColor 算完之後)也是同一個理由:refractedBg 的語意就是
        // 「透過玻璃看到的東西」,把它換成 icon 的玻璃,後面的 Fresnel、薄膜、
        // 高光、色散就會照常疊在上面,不必再各補一份。
        // 註：icon 是用「尚未發生全內反射彈跳」的那條方向追到的，而 insideDir
        // 在上面的 bounce 分支裡可能已經被改寫成 bounceDir。這一段一律用當時存下來
        // 的 researchInsideDir，否則 icon 的入射方向會跟命中它的那條射線對不起來。
        if (researchIconHit) {
          float relIOR = researchIconRelIOR();
          vec3 iconIn = refract(researchInsideDir, researchIconN, 1.0 / relIOR);
          vec3 iconDir = dot(iconIn, iconIn) > 0.0001 ? normalize(iconIn) : researchInsideDir;
          vec3 iconExitPoint;
          float iconPath;
          researchTraceIconExit(
            researchIconPoint + iconDir * 0.004, iconDir, iconExitPoint, iconPath
          );
          // 一律用出口點上的法線。舊版在追蹤失敗時改用 -researchIconN，那是一個
          // 逐像素的二元切換，正是同心紋路的來源（見 researchTraceIconExit 的註解）。
          vec3 iconExitN = researchIconNormal(iconExitPoint);
          vec3 iconOut = refract(iconDir, -iconExitN, relIOR);
          // 由稠往稀出去,掠射角會全內反射(refract 回傳零向量)。真正的玻璃在
          // 這裡會把光彈回內部,而那正是參考照片裡內側那圈亮邊的來源,所以
          // fallback 用反射而不是「直接放行」。
          if (dot(iconOut, iconOut) < 0.0001) iconOut = reflect(iconDir, iconExitN);
          iconOut = normalize(iconOut);
          // 出了 icon 之後還要穿過外殼那一面。這裡沿用主射線已經算好的出口面,
          // 省下第三次 traceExitSurface(它自帶 march + 10 tap 的 calcNormal)。
          // 近似的是「從哪一點出去」,折射率與環境取樣都與外殼逐字相同;icon 只
          // 佔畫面很小一塊,出口面在那個立體角內幾乎沒有變化。
          vec3 shellOut = refract(iconOut, -exitNormal, uIOR);
          if (dot(shellOut, shellOut) < 0.0001) shellOut = iconOut;
          vec3 iconTransmitted = backgroundSample(normalize(shellOut), roughBlur).rgb;
          float iconFacing = clamp(dot(-researchInsideDir, researchIconN), 0.0, 1.0);
          researchIconFacing = iconFacing;
          researchIconPath = iconPath;
          if (uResearchIconTint > 0.0) {
            // 局部 Beer–Lambert 吸收：中央近乎無色，側下方累積藍色。
            // 不替換反射、不混入白色、不改覆蓋率。薄邊與出生/消融自然退色。
            float side = smoothstep(-0.22, 0.78,
              dot(researchIconN, normalize(vec3(0.75, -0.58, 0.12))));
            float visibleBoundary = smoothstep(0.0, 0.09, iconFacing);
            float edgeBand = pow(1.0 - iconFacing, 1.45) * visibleBoundary;
            float broadDistribution = 0.045 + 0.955 * side;
            // 集中度越高，中央吸收越少，顏色移到仍有穩定 ray hit 的內側輪廓。
            // side 保留參考圖右下方較濃的方向，不退化成均勻描邊。
            float edgeDistribution = (0.055 + edgeBand * 1.55)
              * (0.34 + side * 0.66);
            float tintDistribution = mix(
              broadDistribution,
              edgeDistribution,
              clamp(uResearchIconTintEdge, 0.0, 1.0)
            );
            float opticalDepth = (1.0 - exp(-max(iconPath, 0.0) * 8.0))
              * tintDistribution
              * researchIconWeight * clamp(uResearchIconTint, 0.0, 1.0);
            vec3 tintColor = uResearchIconTintColor;
            if (uResearchIconMultiTint > 0.5) {
              float multi = clamp(uResearchIconMultiTintStrength, 0.0, 1.0);
              float bend = clamp(length(iconOut - researchInsideDir), 0.0, 1.0);
              tintColor = researchBoundaryTint(uResearchIconTintRamp, researchIconN,
                1.0 - iconFacing, bend, tintColor, multi,
                uResearchIconMultiTintRotation, uResearchIconMultiTintFocus);
              // Let all palette segments show, retaining a softer directional bias.
              float multiDistribution = mix(0.35 + 0.65 * side,
                (0.035 + edgeBand * 1.65) * (0.75 + 0.25 * side),
                clamp(uResearchIconTintEdge, 0.0, 1.0));
              float focusWeight = mix(1.0, 0.65 + 0.85 * bend,
                clamp(uResearchIconMultiTintFocus, 0.0, 1.0));
              opticalDepth = (1.0 - exp(-max(iconPath, 0.0) * 8.0))
                * mix(tintDistribution, multiDistribution * focusWeight, multi)
                * researchIconWeight * clamp(uResearchIconTint, 0.0, 1.0);
            }
            vec3 tintAbsorption = -log(clamp(tintColor, 0.002, 0.999));
            researchIconTransmissionTint = exp(-tintAbsorption * opticalDepth);
            researchBoundaryColor = tintColor;
            researchBoundaryDepth = opticalDepth;
          }
          float iconF0 = pow((relIOR - 1.0) / (relIOR + 1.0), 2.0);
          float iconFres = iconF0 + (1.0 - iconF0) * pow(1.0 - iconFacing, 5.0);
          vec3 iconReflection = sampleEnvironmentBackdrop(
            reflect(researchInsideDir, researchIconN), roughBlur
          );
          iconFres = clamp(iconFres, 0.0, 1.0);
          researchIconFres = iconFres;
          // 淺底的明暗由後面的局部反射卡塑形。此處只保留透射，避免
          // Fresnel 在整圈剪影同時拉暗；深底仍用原本的環境反射。
          vec3 iconReflectionLight = iconTransmitted;
          iconReflection = mix(iconReflection, iconReflectionLight, uLightBackdrop);
          refractedBg = mix(iconTransmitted, iconReflection, iconFres);
          // icon 內部那一段光程併進總光程,體積吸收因此自然變厚一點。
          pathLength += iconPath;
          // 這條射線最後其實是沿著 shellOut 離開的,不是外殼單獨算出來的 exitDir。
          // transmissionDir 下游還有兩個讀者:HDRI 的 uEnvRefraction 混合(不接手
          // 的話會用外殼方向重新取樣、把 icon 洗掉)與稜光光芒的座標。
          transmissionDir = normalize(shellOut);
          // icon 把光彎掉多少 —— 色散的強度項要用。
          researchIconBend = clamp(length(shellOut - researchInsideDir) * 0.55, 0.0, 1.0);
        }
#endif

        // 白色背景也保留極淡的虛擬棚燈漸層，讓折射方向產生可見形變。
        float bend = clamp(length(exitDir - rd) * 0.55 + backRim * 0.18, 0.0, 1.0);
        // 只有折射真正彎曲、或背面接近掠射角時才產生局部稜鏡分離。
        // 平坦正視區維持無色透明，避免退化成整圈彩虹描邊。
        dispersionNormal = exitNormal;
        localPrism = clamp(bend * 1.35 + backRim * 0.75, 0.0, 1.0);
#ifdef FEATURE_RESEARCH
        // icon 也是玻璃,而且比外殼更稠、把光彎得更多,可是色散的強度項 localPrism
        // 原本只讀外殼的偏折量,結果 icon 那一塊變成沒有色散的死區 —— 明明是折射
        // 最強的地方。這一行把 icon 造成的偏折併進去。
        //
        // 注意順序:localPrism 在上一行才被指派,加成必須放在它之後,放進前面那個
        // 換掉 refractedBg 的區塊會被這一行整個蓋掉。
        if (researchIconHit) {
          localPrism = clamp(localPrism + researchIconBend * 1.45, 0.0, 1.0);
        }
#endif
        refractedBg *= mix(vec3(1.0), vec3(0.965, 0.985, 1.0), bend);
        // 比爾–朗伯定律：穿過的液體越厚，被吸走的光越多，而且各波長吸得不一樣
        // 快。這就是「看起來有體積」的來源 —— 厚的地方濃、薄的邊緣清透。
        //
        // 選色器給的是「穿過參考厚度之後還剩下多少光」，也就是液體本身看起來的
        // 顏色（同 Blender 的 Volume Absorption 與 glTF 的 attenuationColor：
        // 選藍色就得到藍色的液體）。20.0 是那個參考厚度，取這個值是為了讓預設
        // 落在選色器好操作的中段：係數本身很小，若用「走 1 單位剩多少」來表達，
        // 所有可用的顏色會全部擠在 244–255 那一小段裡，滑一格就過頭。
        //
        // clamp 的兩端各有理由：0 會讓 log 發散成 -inf，1 則是完全不吸收 ——
        // 純白因此等於把這個效果關掉，濃度滑桿再拉也沒有作用，那是對的語意。
        vec3 absorbCoefficient = -log(clamp(uAbsorbColor, 0.002, 0.999)) / 20.0;
        volumeAbsorption = exp(-absorbCoefficient * max(uAbsorb, 0.0) * pathLength);

        // 背面使用低成本 2-octave 厚度場，產生內部彩色折線與融合區層次。
        //
        // 跟正面那條鏈同樣的道理：唯一產物 backFilmChroma 最後整個乘上 uFilmEnabled，
        // 薄膜關閉時恆為 vec3(0.0)，而 backThickness / backOpd 沒有別的去處。
        // 所以薄膜關閉時這一段（1 次 fbmFast + sampleFilmInterference 的 3 次 texture2D）
        // 也是死碼，編譯期移除與執行結果逐位元相同。
#ifdef FEATURE_THIN_FILM
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
#endif // FEATURE_THIN_FILM
      }
    }
  }
  // 稜光光芒：沿折射後的出射方向取樣程序化光束圖樣（見 prismBeamField）。
  // 完全不用額外的 raymarch —— 舊版在這裡每個 fragment 要多跑四次波長追蹤。
#ifdef FEATURE_PRISM_BEAM   // 單獨隔離：稜光光芒 prism beam
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
#endif // FEATURE_PRISM_BEAM：稜光光芒 prism beam
  // 純色只控制畫布；水滴內部獨立取樣同一張 HDRI。若背面追蹤未命中，
  // transmissionDir 會保留前表面的 Snell 折射方向，滑桿仍能穩定產生效果。
  if (uBgMode == 0 && uHasEnv == 1 && uEnvRefraction > 0.001) {
    vec3 envRefraction = sampleEnvironmentBackdrop(transmissionDir, roughBlur);
    // 白底只借用 HDRI 的明暗結構，不把攝影棚的米黃色牆面染進玻璃。
    // envRefraction 滑桿仍控制混合量，因此 0 的語意完全不變。
    float envRefractionLum = dot(
      envRefraction,
      vec3(0.2126, 0.7152, 0.0722)
    );
    // 淺底只保留 HDRI 的亮度結構。暗部用 sqrt 曲線柔和抬起，中間調與高光
    // 逐步退回原亮度，避免硬 clamp 造成乳白塑膠感。
    float envShadowWeight = 1.0 - smoothstep(0.18, 0.86, envRefractionLum);
    float liftedEnvLum = mix(
      envRefractionLum,
      sqrt(max(envRefractionLum, 0.0)),
      envShadowWeight * 0.58
    );
    vec3 cleanBrightRefraction = vec3(liftedEnvLum)
      * vec3(0.985, 1.0, 1.025);
    envRefraction = mix(
      envRefraction,
      cleanBrightRefraction,
      whiteBackdrop
    );
    refractedBg = mix(refractedBg, envRefraction, uEnvRefraction);
  }

#ifdef FEATURE_RESEARCH
  // 環境折射混合完成後才吸收，避免環境滑桿把染色洗掉。後續表面高光照常疊加。
  if (uResearchShellTint > 0.0
      && !researchIconHit) {
    float shellSide = smoothstep(-0.22, 0.78,
      dot(N, normalize(vec3(0.75, -0.58, 0.12))));
    float shellEdge = pow(clamp(material.edgeFactor, 0.0, 1.0), 1.35);
    float shellBroadDistribution = 0.045 + 0.955 * shellSide;
    float shellEdgeDistribution = (0.045 + shellEdge * 1.65)
      * (0.34 + shellSide * 0.66);
    float shellDistribution = mix(
      shellBroadDistribution,
      shellEdgeDistribution,
      clamp(uResearchShellTintEdge, 0.0, 1.0)
    );
    float shellOpticalDepth = (1.0 - exp(-max(pathLength, 0.0) * 3.6))
      * shellDistribution * clamp(uResearchShellTint, 0.0, 1.0);
    vec3 shellTintColor = uResearchShellTintColor;
    if (uResearchShellMultiTint > 0.5) {
      float multi = clamp(uResearchShellMultiTintStrength, 0.0, 1.0);
      float bend = clamp(localPrism, 0.0, 1.0);
      shellTintColor = researchBoundaryTint(uResearchShellTintRamp, N,
        material.edgeFactor, bend, shellTintColor, multi,
        uResearchShellMultiTintRotation, uResearchShellMultiTintFocus);
      float multiDistribution = mix(0.35 + 0.65 * shellSide,
        (0.025 + shellEdge * 1.75) * (0.75 + 0.25 * shellSide),
        clamp(uResearchShellTintEdge, 0.0, 1.0));
      float focusWeight = mix(1.0, 0.65 + 0.85 * bend,
        clamp(uResearchShellMultiTintFocus, 0.0, 1.0));
      shellOpticalDepth = (1.0 - exp(-max(pathLength, 0.0) * 3.6))
        * mix(shellDistribution, multiDistribution * focusWeight, multi)
        * clamp(uResearchShellTint, 0.0, 1.0);
    }
    vec3 shellTintAbsorption = -log(clamp(shellTintColor, 0.002, 0.999));
    researchShellTransmissionTint = exp(-shellTintAbsorption * shellOpticalDepth);
    researchBoundaryColor = shellTintColor;
    researchBoundaryDepth = shellOpticalDepth;
  }
  refractedBg *= researchShellTransmissionTint;
  refractedBg *= researchIconTransmissionTint;
#endif
  // 白底以帶微冷色的透射衰減塑形；反射只填入剩餘亮度空間，避免大片 clipping。
  vec3 coolTransmission = mix(
    vec3(0.995, 0.998, 1.0),
    vec3(0.94, 0.97, 1.0),
    material.edgeFactor
  );
  // 借用液態薄膜的乾淨白底模型：中央先以近乎無色的背景透射為主，厚度吸收
  // 只保留使用者指定的比例；輪廓仍由 Fresnel、折射與後面的反射卡塑形。
  vec3 lightVolumeAbsorption = mix(
    vec3(1.0), volumeAbsorption, clamp(uLightDepth * 0.72, 0.0, 1.0)
  );
  vec3 brightBase = refractedBg * material.transmission * coolTransmission
    * lightVolumeAbsorption * (1.0 - backFres * 0.12);
  vec3 cleanLightTransmission = refractedBg * coolTransmission
    * (1.0 - backFres * 0.06);
  float lightClarityMask = clamp(uLightClarity, 0.0, 1.0)
    * (1.0 - material.edgeFactor * material.edgeFactor * material.edgeFactor * 0.48)
    * (1.0 - backRim * 0.10);
  brightBase = mix(brightBase, cleanLightTransmission, lightClarityMask);
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
    brightBodyDepth * clamp(uLightDepth, 0.0, 1.0)
  );
  vec3 surfaceLight = clamp(
    material.baseSurface + material.filmSurface * 0.08 + vec3(backFres * 0.10),
    0.0,
    1.0
  );
  // 表面反射在淺底轉成中性冷白，並只保留 HDRI 最亮的棚燈區域；一般牆面與
  // 暖灰中間調不再大面積鋪進玻璃。使用已算好的 surfaceLight，不增加環境取樣。
  float surfaceLightLum = dot(surfaceLight, vec3(0.2126, 0.7152, 0.0722));
  float studioHighlight = smoothstep(0.42, 0.88, surfaceLightLum);
  vec3 neutralSurfaceLight = vec3(surfaceLightLum) * vec3(0.985, 1.0, 1.02);
  surfaceLight = mix(surfaceLight, neutralSurfaceLight, whiteBackdrop * 0.96);
  vec3 brightSurface = surfaceLight * max(vec3(0.0), vec3(1.0) - brightBase)
    * mix(0.12, 0.82, clamp(uLightCardStrength, 0.0, 1.0))
    * mix(1.0, 0.16 + studioHighlight * 0.84, whiteBackdrop);
  // 淺底的彩色不平均鋪滿輪廓：一般曲面只留淡藍青色，完整光譜集中在折射
  // 彎曲最強的折角、融合處與局部掠射面。全部重用既有遮罩，不增加射線取樣。
  float prismColorFocus = smoothstep(0.18, 0.72, localPrism);
  float rimColorFocus = smoothstep(0.12, 0.78, material.edgeFactor);
  float rainbowFocus = clamp(
    prismColorFocus * (0.42 + rimColorFocus * 0.58),
    0.0,
    1.0
  );
  float coolColorFocus = rimColorFocus * (1.0 - rainbowFocus * 0.55);
  float chromaLocal = smoothstep(0.055, 0.24, material.filmAmount)
    * rainbowFocus;
  vec3 brightChroma = material.filmChroma * material.filmAmount
    * brightBg * 2.45 * chromaLocal * sqrt(max(uMaterialExposure, 0.0))
    * clamp(uLightChroma, 0.0, 1.0);
  brightChroma += material.reflectionChroma * brightBg
    * mix(0.62, 0.08, whiteBackdrop) * rainbowFocus
    * clamp(uLightChroma, 0.0, 1.0);
  brightChroma += backFilmChroma * brightBg
    * (backRim * 0.54 + material.filmAmount * 0.10) * rainbowFocus
    * clamp(uLightChroma, 0.0, 1.0);
  brightChroma += vec3(0.10, 0.48, 1.0) * brightBg
    * coolColorFocus * (0.025 + localPrism * 0.055)
    * clamp(uLightChroma, 0.0, 1.0);
  vec3 brightComposite = clamp(
    brightBase + brightSurface + brightChroma,
    0.0,
    1.0
  );
  // 右側藍色折射帶：以兩段邊緣遮罩相減，把色帶放在剪影內側而不是直接描邊；
  // 再用右側法線、折射彎曲與內部光程控制強度，讓它跟著液體曲面變形。
  float blueBandSide = smoothstep(
    0.02,
    0.78,
    dot(N, normalize(vec3(0.82, -0.08, 0.56)))
  );
  float blueBandInner = smoothstep(0.14, 0.62, material.edgeFactor);
  float blueBandOuterCut = smoothstep(0.78, 0.98, material.edgeFactor);
  float blueBandDepth = clamp(pathLength * 1.45, 0.0, 1.0);
  float blueBandMask = blueBandSide * blueBandInner * (1.0 - blueBandOuterCut)
    * (0.34 + localPrism * 0.66) * (0.45 + blueBandDepth * 0.55);
  vec3 blueBandColor = mix(
    vec3(0.30, 0.78, 1.0),
    vec3(0.08, 0.38, 1.0),
    clamp(localPrism, 0.0, 1.0)
  );
  vec3 blueBandLight = blueBandColor * blueBandMask * 0.18
    * clamp(uLightCardStrength, 0.0, 1.0) * whiteBackdrop;
  brightComposite = 1.0
    - (1.0 - brightComposite) * (1.0 - clamp(blueBandLight, 0.0, 0.42));
  // 白底仍需要少量暗反射才能讀出曲面，但不能把低亮度 HDRI 直接鋪滿整顆。
  // 沿用液態薄膜的做法：由反射方向生成一張寬而柔的冷藍卡，只在側下方與
  // 掠射區域局部壓低亮度；中央大面積透射保持乾淨。
  vec3 lightStudioReflectDir = reflect(rd, N);
  float lightCoolCard = pow(max(dot(
    lightStudioReflectDir, normalize(vec3(0.70, -0.30, 0.64))
  ), 0.0), mix(4.2, 1.7, uRoughness));
  lightCoolCard = max(
    lightCoolCard,
    smoothstep(-0.22, 0.84, dot(N, normalize(vec3(0.78, -0.42, 0.18)))) * 0.52
  );
  float lightCoolCardWeight = lightCoolCard
    * clamp(uLightCardStrength, 0.0, 1.0)
    * (material.edgeFactor * material.edgeFactor * material.edgeFactor * 0.045
      + backRim * 0.012);
  // 鏡面卡只會形成小片高光，不能單獨描述大體積；再以真正的曲面法線建立
  // 一個寬廣的棚燈明暗面。上左方受光、右下方轉成冷藍，沒有噪聲或 HDRI
  // 低頻紋理，因此有立體感但不會重新變髒。
  float lightFormFacing = clamp(
    dot(N, normalize(vec3(-0.46, 0.58, 0.68))) * 0.5 + 0.5,
    0.0,
    1.0
  );
  float lightFormShade = pow(1.0 - lightFormFacing, 1.35);
  lightCoolCardWeight += lightFormShade
    * clamp(uLightCardStrength, 0.0, 1.0)
    * material.edgeFactor * material.edgeFactor * material.edgeFactor * 0.035;
  brightComposite = mix(
    brightComposite,
    brightComposite * vec3(0.72, 0.86, 1.0),
    clamp(lightCoolCardWeight, 0.0, 0.08)
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
    interiorFillLight = sampleEnvironmentBackdrop(transmissionDir, roughBlur);
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
#ifdef FEATURE_LIQUID_FILM   // 單獨隔離：液態薄膜材質分支 liquid-film material branch
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
#endif // FEATURE_LIQUID_FILM：液態薄膜材質分支 liquid-film material branch

  vec3 finalColor = mix(glassComposite, membraneComposite, membraneMode);
  // 稜光光芒的合成。舊版在這裡有兩套完全不同的路徑（HDRI 差值相消 + 獨立光源
  // 光譜），再加上前面三個 mix 注入點，一共四處 —— 一個效果散在四個地方、還
  // 依背景模式分岔，難以預測也難以調。現在只有這一處。
  //
  // 暗底用 screen 加光（光束是額外的能量，不該讓底下的玻璃變暗）；白底改成
  // 選擇性透射 —— 白底上 screen 完全看不出來（1 已經飽和），所以改成保留色相、
  // 壓掉亮度，光束才會在白底上顯示成彩色而不是消失。這是 ART 與 LIGHT 兩層
  // 已經在用的同一套雙路合成，三者行為因此一致。
#ifdef FEATURE_PRISM_SATURATION   // 單獨隔離：稜光彩度後處理 beam chroma post-processing
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
    // 位置遮罩：白底的顯色只發生在物理上說得通的地方 —— 邊緣、折射真正彎曲
    // 處、背面 rim。指數 2.2 是刻意的「沒有下限」：舊版這裡是
    // mix(0.18, 1.0, beamLocality)，下限 0.18 的語意是「即使完全不在邊界也還是
    // 塗 18%」，大片平坦白區因此被染色，那就是「色塊貼在玻璃上」的來源。
    float beamLocality = clamp(
      material.edgeFactor * 0.76
        + localPrism * 0.62
        + backRim * 0.34
        + membraneFold * membraneMode * 0.52,
      0.0,
      1.0
    );
    // 這一層是套在整張 finalColor 上的濾色（見下方 beamAbsorb 的使用處），
    // 原本無視位置，而 beamPeak 的圖樣覆蓋面積很大，所以它是白底色塊感最主要
    // 的來源。同樣接上 locality 閘門。
    //
    // 純黑底時 brightWash 為 0 → depth 為 0 → mix 回傳 vec3(1)，是精確的恆等
    // 運算，黑底的定案外觀不受影響。
    float beamAbsorbDepth = clamp(
      sqrt(max(beamPeak, 0.0)) * 0.85, 0.0, 0.72
    ) * brightWash;
    beamAbsorb = mix(
      vec3(1.0), beamHue, beamAbsorbDepth * pow(beamLocality, 2.2)
    );

    // 白底的顯色：從白光扣掉光譜的補色。互補關係讓紅／青、綠／洋紅成對出現，
    // 讀起來是分光；舊版是把一個飽和色平塗混進去，沒有互補關係，讀起來是顏料。
    //
    // beamBrightSupport 在深底為 0（membraneMode 恆為 0，材質已統一為通用玻璃），
    // 所以 amount 為 0、乘數為 vec3(1)，深底同樣是精確的恆等運算。
    float beamBrightSupport = max(whiteBackdrop, membraneMode * brightBg);
    float beamAbsorbAmount = beamBrightSupport * clamp(
      sqrt(max(beamPeak, 0.0)) * 0.78 * pow(beamLocality, 2.2),
      0.0,
      0.46
    );
    vec3 beamComplement = vec3(1.0) - beamHue;
    finalColor = beamScreen * (vec3(1.0) - beamComplement * beamAbsorbAmount);
  }
#endif // FEATURE_PRISM_SATURATION：稜光彩度後處理 beam chroma post-processing
  // 通用玻璃的亮底補償仍由原開關管理；液態薄膜本身就是透射模型，不依賴該開關。
  float brightColorSupport = max(
    whiteBackdrop,
    membraneMode * brightBg
  );

  // 色散沿用薄膜的 thickness → OPD mapping：厚度噪聲、花紋尺度、
  // 花紋流動、重力與入射角都和薄膜一致；唯一不同的是固定使用獨立
  // 可見光譜，不讀取自訂漸層。Fresnel 只控制亮度，不生成同心環。
#ifdef FEATURE_DISPERSION   // 單獨隔離：色散／光譜 dispersion / spectral
  if (dispersionStrength > 0.001) {
    float artOpd = artisticDispersionOPD(p, N, -rd);
#ifdef FEATURE_RESEARCH
    // 光程差的取樣點換成 icon 自己的表面與法線。只加強度不換座標的話,彩帶的
    // 花紋仍然是外殼的,看起來會像「外殼的色散剛好蓋在 icon 上」;換過來之後
    // 條紋才跟著 icon 的曲面走,讀得出來是那顆內含物在分光。
    if (researchIconHit) {
      artOpd = artisticDispersionOPD(
        researchIconPoint, researchIconN, -researchInsideDir
      );
    }
#endif
    float dispersionPeriod = 205.0 * max(0.35, uCausticScale);
    float spectrumCoordinate = fract(
      artOpd / dispersionPeriod
    );
    vec3 prismSpectrum = separateSpectrum(
      visibleSpectrum(spectrumCoordinate),
      uDispersionSeparation
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
    // 白色已沒有 screen 的加色空間，所以亮底走「互補扣除」：真實色散是把白光
    // 分開，某個方向多了紅就必然少了青，所以從白光裡扣掉光譜的補色，紅／青、
    // 綠／洋紅會自動成對出現。舊版是把一個飽和色平塗混進去，沒有互補關係，
    // 讀起來是顏料而不是光。
    //
    // 位置遮罩的指數 2.2 同樣是刻意「沒有下限」：舊版是
    // mix(0.18, 1.0, whitePrismLocality)，那個 0.18 下限讓完全不在邊界的平坦
    // 白區照樣被塗色 —— 「色塊貼在玻璃上」就是這麼來的。
    //
    // sqrt 是感知式響應：低強度在白底仍看得見，高強度逐漸壓縮，保持 0 → 無效果
    // 且全程單調。brightColorSupport 在深底為 0（membraneMode 恆為 0，材質已
    // 統一為通用玻璃），amount 為 0、乘數為 vec3(1)，深底是精確的恆等運算。
    float whitePrismLocality = clamp(
      material.edgeFactor * 0.76
        + localPrism * 0.62
        + backRim * 0.34
        + membraneFold * membraneMode * 0.52,
      0.0,
      1.0
    );
    float absorbAmount = brightColorSupport * clamp(
      sqrt(max(prismAmount, 0.0))
        * (0.62 + 0.18 * uDispersionSeparation)
        * pow(whitePrismLocality, 2.2),
      0.0,
      0.42
    );
    vec3 prismAbsorb = vec3(1.0) - prismSpectrum;
    finalColor = prismScreen * (vec3(1.0) - prismAbsorb * absorbAmount);
  }
#endif // FEATURE_DISPERSION：色散／光譜 dispersion / spectral

  // 獨立虛擬光源驅動的光譜焦散。HDRI 不參與圖樣或顏色，只能選擇
  // 調節總亮度，因此純色畫布不會顯示攝影棚影像。
#ifdef FEATURE_SPECTRAL_CAUSTICS   // 單獨隔離：光譜焦散 spectral caustics
  float spectralCausticStrength =
    uSpectralCausticEnabled * uSpectralCausticIntensity;
  bool spectralCausticSkipIcon = false;
  vec3 causticP = p;
  vec3 causticN = N;
  vec3 causticViewDir = rd;
  float causticEdgeFactor = material.edgeFactor;
#ifdef FEATURE_RESEARCH
  if (researchIconHit) {
    if (uSpectralCausticIconAffect > 0.5) {
      // 焦散圖案改用 icon 自己的表面、法線與視線方向，讓聚光帶跟著 icon 的
      // 曲率走，而不是外殼——跟 FEATURE_DISPERSION 換座標系（見上方
      // artisticDispersionOPD 那段）是同一套處理。
      causticP = researchIconPoint;
      causticN = researchIconN;
      causticViewDir = researchInsideDir;
      causticEdgeFactor = researchIconFres;
    } else {
      // 使用者選擇讓焦散完全不影響對話泡 icon：略過整段運算，icon 所在
      // 像素維持原本顏色。
      spectralCausticSkipIcon = true;
    }
  }
#endif
  if (spectralCausticStrength > 0.001 && !spectralCausticSkipIcon) {
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
    vec3 internalLight = refract(-virtualLightDir, causticN, 1.0 / uIOR);
    if (dot(internalLight, internalLight) < 0.0001) {
      internalLight = -virtualLightDir;
    }
    vec3 internalBounce = normalize(reflect(internalLight, -causticN));
    float focusAlignment = clamp(
      dot(internalBounce, normalize(-causticViewDir)) * 0.5 + 0.5,
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
    // Object Coordinate → Mapping → 3D Noise。這一份 Noise 後面也直接供遮罩使用，
    // 三種 mapping 都只付一次 fbmFast，不重複生成另一張噪聲場。
    float sizeFactor = clamp(uSpectralCausticWidth / 2.5, 0.0, 1.0);
    float objectNoiseScale = mix(0.55, 2.4, uSpectralCausticDensity);
    vec3 causticNoiseFlow = loopNoiseOffset(uSpectralCausticFlow);
    // 柔化只掛在薄膜噪聲上。其餘三種 mapping 的 detail 恆為 1，causticOctaves
    // 就等於原本的 fbmFast，一格都不變。uniform 決定的分支，不會發散。
    float causticDetail = 1.0;
    if (uSpectralCausticMapping == 3) {
      causticDetail = 1.0 - uSpectralCausticFilmSoften;
    }
    float causticNoise = causticOctaves(
      causticP * uSpectralCausticNoiseScale * objectNoiseScale + causticNoiseFlow,
      causticDetail
    );
    float causticNoise01 = clamp(0.5 + causticNoise * 0.72, 0.0, 1.0);
    float noiseRidge = clamp(1.0 - abs(causticNoise01 * 2.0 - 1.0), 0.0, 1.0);
    float noiseBandWidth = mix(0.18, 0.78, sizeFactor);
    float noiseBand = smoothstep(1.0 - noiseBandWidth, 1.0, noiseRidge);
    float noiseSignedBand = causticNoise01 - 0.5;
    // 薄膜噪聲（Blender 風）用的另外兩份噪聲。Blender 的 Noise Texture「Color」
    // 輸出是三份彼此獨立的噪聲各當一個通道，不是把一個純量場丟進色帶查表 ——
    // 所以它永遠不會出現等高線。這裡沿用同一個思路（見下面 mapping == 3）。
    // 只有 mapping == 3 會走進來，其餘三種 mapping 不付這兩次 fbm。
    vec3 filmNoiseVec = vec3(causticNoise, 0.0, 0.0);
    if (uSpectralCausticMapping == 3) {
      vec3 filmP = causticP * uSpectralCausticNoiseScale * objectNoiseScale
        + causticNoiseFlow;
      filmNoiseVec.y = causticOctaves(filmP + vec3(19.3, 7.1, 3.7), causticDetail);
      filmNoiseVec.z = causticOctaves(filmP + vec3(-5.2, 11.9, 27.4), causticDetail);
    }
    float bandScale = mix(1.5, 8.5, uSpectralCausticDensity);
    float fieldU = (dot(causticP, causticTangent) + flowOffset.x) * bandScale;
    float fieldV = (dot(causticP, causticBitangent) + flowOffset.y) * bandScale;
    float warpedBand = fieldU
      + sin(fieldV * 1.7 + dot(causticN, virtualLightDir) * 4.0)
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
    float signedBand = fract(warpedBand * 0.5 + 0.5) - 0.5;
    if (uSpectralCausticMapping == 1) {
      // 純物件噪聲：Noise 同時決定亮帶強度與 LUT 橫向色彩座標。
      bandWave = noiseBand;
      signedBand = noiseSignedBand;
    } else if (uSpectralCausticMapping == 2) {
      // 混合：保留 Wave 的受光方向，以 3D Noise 打散規律條紋與色彩位置。
      bandWave = clamp(bandWave * (0.45 + noiseBand * 0.75), 0.0, 1.0);
      signedBand = mix(signedBand, noiseSignedBand, 0.48);
    } else if (uSpectralCausticMapping == 3) {
      // 薄膜噪聲：沒有亮帶。亮度只做很淺的起伏（0.62..1），讓後面的
      // focusExponent 仍然有作用，但不會把畫面切成一條一條。
      bandWave = mix(
        0.62,
        1.0,
        clamp(0.5 + filmNoiseVec.z * 0.9, 0.0, 1.0)
      );
    }
    // B：粗糙度把焦散的亮帶攤開。bandWave 落在 0..1，pow 的指數調低會讓亮帶
    // 變寬——但同時整體變亮（底數 < 1，指數越小值越大）。所以這個乘數不能單獨
    // 用，必須配下面那個補償。
    float roughFocus = mix(1.0, 0.42, transmissionSpread());
    float focusExponent = mix(0.8, 5.5, uSpectralCausticFocus)
      * mix(1.45, 0.52, sizeFactor)
      * mix(1.0, 0.48, uSpectralCausticSoftness)
      * mix(1.12, 0.78, uSpectralCausticLightSize)
      * roughFocus;
    float bandFocus = pow(
      max(bandWave, 0.0),
      max(0.32, focusExponent)
    );
    // 上面那個 roughFocus 的能量補償。cos 型亮帶取 p 次方後，帶內平均值大致
    // 正比於 p^(-1/2)，所以指數乘上 m 之後平均會變成原本的 m^(-1/2) 倍；乘回
    // sqrt(m) 就把總光量拉回原位，只留下「變寬變柔」而不帶亮度變化。
    // roughFocus ≤ 1，所以這個補償恆 ≤ 1：一樣是只會變暗、不會變亮。
    bandFocus *= sqrt(roughFocus);
    float incidenceFold = pow(
      clamp(1.0 - abs(dot(causticN, virtualLightDir)), 0.0, 1.0),
      0.72
    );
    // 把每一條亮帶本身展開成完整光譜，而不是讓不同亮帶各自只有
    // 一種顏色。signedBand 是目前像素相對聚光帶中心的橫向位置。
    float rainbowCoordinate = clamp(
      0.5 + signedBand * mix(1.8, 10.0, uSpectralCausticSeparation)
        + dot(causticN, causticTangent) * 0.06,
      0.0,
      1.0
    );
    vec3 causticRampColor =
      texture2D(uSpectralCausticRamp, vec2(rainbowCoordinate, 0.5)).rgb;
    if (uSpectralCausticMapping == 3) {
      // 薄膜噪聲的顏色來源。
      //
      // 這裡刻意「不」用噪聲當色帶座標。只要色帶是用一個隨像素變動的座標去查，
      // 色帶上任何一個窄特徵——一顆跟鄰居差很多的色標、或線性內插留下的折點——
      // 都會沿著噪聲的等值線被拉成一條細線。這跟色標之間怎麼內插無關，是
      // 「平滑場 → 一維查表」這個結構本身的產物。
      //
      // 改成：色帶只在四個「固定」座標各取一次色，每個像素取到的都是同一組
      // 顏色，色帶上有什麼特徵都不會投影到畫面上；變動的只有這四個顏色之間的
      // 混合權重，而權重是兩份獨立噪聲的平滑函數。等值線無從產生，剩下的只有
      // 柔和的斑塊 —— 也就是 Blender 那張參考圖的樣子。
      //
      // 光譜分離控制四個取樣點離色帶中央多遠：0 時四點重疊成單色，1 時攤開到
      // 整條色帶，語意跟其他 mapping 一致（顏色的變化幅度）。
      float filmSpread = mix(0.12, 0.5, uSpectralCausticSeparation);
      vec3 filmStopA = texture2D(
        uSpectralCausticRamp, vec2(0.5 - filmSpread, 0.5)
      ).rgb;
      vec3 filmStopB = texture2D(
        uSpectralCausticRamp, vec2(0.5 - filmSpread * 0.33, 0.5)
      ).rgb;
      vec3 filmStopC = texture2D(
        uSpectralCausticRamp, vec2(0.5 + filmSpread * 0.33, 0.5)
      ).rgb;
      vec3 filmStopD = texture2D(
        uSpectralCausticRamp, vec2(0.5 + filmSpread, 0.5)
      ).rgb;
      // 權重。clamp 之後再過一次 smoothstep：clamp 本身是折點（噪聲一撞到 0 或
      // 1，斜率就從增益直接掉到 0），那條「剛好飽和」的等值線也會浮成細邊；
      // smoothstep 兩端導數為 0，接上去整段映射的斜率才連續。
      vec2 filmWeight = clamp(vec2(0.5) + filmNoiseVec.xy * 1.35, 0.0, 1.0);
      filmWeight = filmWeight * filmWeight * (3.0 - 2.0 * filmWeight);
      causticRampColor = mix(
        mix(filmStopA, filmStopB, filmWeight.x),
        mix(filmStopC, filmStopD, filmWeight.x),
        filmWeight.y
      );
      // 亮度歸一化。色帶裡有深有淺，四個取樣點的亮度不一樣，混合權重一漂
      // 亮度就跟著上上下下，在畫面上仍會讀成一塊一塊的明暗。薄膜的變化是
      // 「色相在變」不是「亮度在變」，所以除掉自己的亮度統一拉到同一水平，
      // 明暗一律交給焦散強度與遮罩決定。
      float filmLuma = max(
        dot(causticRampColor, vec3(0.2126, 0.7152, 0.0722)),
        0.0025
      );
      causticRampColor = clamp(
        causticRampColor * (0.66 / filmLuma),
        0.0,
        1.0
      );
    }
    vec3 causticSpectrum = separateSpectrum(
      causticRampColor,
      uSpectralCausticSeparation
    );

    // 可獨立混合的 Fresnel 與循環 Noise 遮罩。0 完全不限制焦散；
    // Fresnel=1 時彩光集中於掠射角，Noise=1 時連續光帶拆成局部光斑。
    float fresnelMask = pow(
      clamp(causticEdgeFactor, 0.0, 1.0),
      1.8
    );
    fresnelMask = mix(1.0, fresnelMask, uSpectralCausticFresnelMask);
    // 薄膜模式下，前後表面不平行的膜褶也是合理的焦散來源；仍受同一個
    // Fresnel 遮罩滑桿控制，滑桿為 0 時維持「完全不限制」的原語意。
    fresnelMask = max(
      fresnelMask,
      membraneMode * membraneFold * uSpectralCausticFresnelMask * 0.86
    );
    float noiseMask = smoothstep(0.32, 0.68, causticNoise01);
    noiseMask = mix(1.0, noiseMask, uSpectralCausticNoiseMask);

    float hdriDrive = 1.0;
    if (uHasEnv == 1) {
      // 虛擬光源的取色：這是「光是什麼顏色」，不是「穿過玻璃看到什麼」，
      // 所以不吃粗糙度，焦散的色調才不會隨著粗糙度漂掉。
      vec3 hdriLightSample = sampleEnvironmentBackdrop(virtualLightDir, 0.0);
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
    // 白底的顯色跟 RAY／ART 同一套：互補扣除加上位置遮罩。
    //
    // 這一條原本是三者裡色塊感最重的，因為舊版連 locality 都沒有 —— 混色權重
    // 只看光帶強度 causticPeak，上限還開到 0.62，所以白底上整條光帶都會被塗成
    // 飽和色。這裡補上位置遮罩：焦散的顯色集中在掠射（causticEdgeFactor）與
    // 入射角折疊（incidenceFold）真的強的地方。
    //
    // brightColorSupport 在深底為 0，amount 為 0、乘數為 vec3(1)，深底是精確的
    // 恆等運算。
    float causticLocality = pow(
      clamp(causticEdgeFactor * 0.85 + incidenceFold * 0.55, 0.0, 1.0),
      2.0
    );
    float causticAbsorbAmount = brightColorSupport * clamp(
      causticPeak * 0.85 * causticLocality,
      0.0,
      0.5
    );
    vec3 causticAbsorb = vec3(1.0) - causticSpectrum;
    finalColor = causticScreen
      * (vec3(1.0) - causticAbsorb * causticAbsorbAmount);
  }
#endif // FEATURE_SPECTRAL_CAUSTICS：光譜焦散 spectral caustics

  // 立體明暗必須在所有色散與焦散之後套用，否則亮底的 transmission
  // 合成會把低頻厚薄關係洗回接近白色。這四個權重都含 uMembraneDepth，
  // 因此滑桿為 0 時與原本液態薄膜輸出完全一致。
#ifdef FEATURE_LIQUID_FILM_DEPTH   // 單獨隔離：液態薄膜深度 membrane depth
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
#endif // FEATURE_LIQUID_FILM_DEPTH：液態薄膜深度 membrane depth
#ifdef FEATURE_RESEARCH
  if (researchIconHit) {
    // icon 的「表面」項。上面換掉 refractedBg 處理的是穿過去的部分，但在深色背景
    // 下 backgroundSample 回傳的就是背景色，純折射等於看不見 —— 外殼本身也一樣，
    // 它之所以讀得出形狀，靠的是這一層 Fresnel 環境反射（sampleEnvironmentBackdrop
    // 走的是程序化棚燈，不會跟著背景一起變黑）。內含物既然是同一種液態玻璃，就
    // 該拿到同一項，而不是自己配一個顏色疊上去。
    //
    // 權重用的是上面算好的 researchIconFres：那是 icon 與外殼折射率比值算出來的
    // Schlick 項，法線正對時很低、掠射時接近 1，所以呈現出來是一圈亮邊加上薄薄的
    // 面反射 —— 跟參考照片裡「暗心亮邊」的內部氣泡是同一個成因。uFresnel 讓它跟
    // 著材質滑桿走。
    float iconRim = clamp(researchIconFres * (0.35 + uFresnel), 0.0, 1.0);
    vec3 iconSpec = sampleEnvironmentBackdrop(
      reflect(researchInsideDir, researchIconN), roughBlur * 0.35
    );
    // 棚燈那一份的亮度。淺底只用它的「明暗結構」來決定哪裡該留白（見下面
    // iconDensity 的高光那一行），不把米黃色的牆面染進 icon。
    float iconSpecLum = dot(iconSpec, vec3(0.2126, 0.7152, 0.0722));
    // screen 合成：亮處不會爆掉，暗處等於直接加上去。
    //
    // 位置很關鍵：必須在下面那段通用玻璃的 over 合成「之前」。這一圈亮邊是水滴
    // 的自身能量（內部界面的 Fresnel 反射），不是透射過來的背景，所以它必須進到
    // universalOwnEnergy 與 universalCovered 裡。放在後面的話，去背輸出那條路
    // （見結尾的 uTransparentBackground 分支）是拿 universalOwnEnergy 反解的，
    // 會整個略過這一圈亮邊 —— 症狀就是「viewer 看得到氣泡邊界，去背 PNG 疊回
    // 黑底卻淡掉了」，而且 alpha 也沒把它算進覆蓋率。
    // 深底：原本那條 screen，一個係數都沒動。
    vec3 iconScreened = 1.0
      - (1.0 - finalColor) * (1.0 - clamp(iconSpec * iconRim, 0.0, 1.0));
    finalColor = mix(finalColor, iconScreened, 1.0 - uLightBackdrop);
    // 淺底：寬暗卡、窄白卡與厚度色共同塑形，明暗跟隨真正的反射方向。
    // 不用 Fresnel 把整圈塗黑；正面仍保留淡色與透射，掠射處才局部加深。
    if (uLightBackdrop > 0.0) {
      vec3 iconReflectDir = reflect(researchInsideDir, researchIconN);
      float iconDarkCard = pow(max(dot(iconReflectDir,
        normalize(vec3(0.72, -0.38, 0.58))), 0.0), mix(3.8, 1.8, uRoughness));
      // 寬卡的柔和包覆：只靠鏡面峰值在旋轉時會縮成小點，補上同側低頻暗面。
      iconDarkCard = max(iconDarkCard, smoothstep(-0.35, 0.85,
        dot(researchIconN, normalize(vec3(0.82, -0.48, 0.12)))) * 0.78);
      float iconWhiteCard = pow(max(dot(iconReflectDir,
        normalize(vec3(-0.48, 0.66, 0.58))), 0.0), mix(24.0, 7.0, uRoughness));
      float iconHighlight = max(iconWhiteCard, smoothstep(1.6, 5.0, iconSpecLum) * 0.65);
      float iconThickness = 1.0 - exp(-max(researchIconPath, 0.0) * 4.5);
      float iconEdge = exp(-researchIconPath * max(uLightIconEdge, 0.01));
      // 真正剪影處收柔，避免 ray hit / miss 形成一條硬描邊。
      float iconBoundary = smoothstep(0.0, 0.12, researchIconFacing);
      float iconDensity = (0.42 + iconThickness * 0.35 + iconEdge * 0.10)
        * clamp(uLightIconTint, 0.0, 1.0);
      // 選擇性透射：厚處累積色彩，薄處透亮。不要先與白色大幅混合，
      // 否則最後的背景合成會再稀釋一次，把 icon 洗成乳白色。
      float iconClarity = clamp(uLightIconClarity, 0.0, 1.0);
      float iconOpticalDepth = (0.24 + iconThickness * 1.20)
        * clamp(uLightIconTint, 0.0, 1.0) * mix(1.0, 0.34, iconClarity);
      vec3 iconBodyColor = pow(clamp(uLightIconColor, 0.035, 1.0),
        vec3(iconOpticalDepth));
      // 彩色只在曲面轉折聚集；本體色與邊緣色分開，才能保留清透中央。
      // 取真正的 icon 法線，動畫旋轉時色帶跟著曲面移動。
      float iconColorRim = pow(1.0 - researchIconFacing,
        max(0.4, uLightIconEdge * 0.35));
      iconColorRim *= clamp(uLightIconRimStrength, 0.0, 1.0);
      // 白棚玻璃的色彩不只是一條描邊：下側寬反射面帶色，上側留柔白窗光。
      // 使用同一顆自訂邊緣色，色帶仍跟著 icon 法線旋轉，沒有貼死的平面漸層。
      float iconColorCard = iconDarkCard * clamp(uLightIconRimStrength, 0.0, 1.0);
      float iconColorWeight = clamp(iconColorRim + iconColorCard * 1.25, 0.0, 0.94);
      iconBodyColor *= mix(vec3(1.0),
        clamp(uLightIconRimColor, 0.035, 1.0), iconColorWeight);
      float iconCardStrength = iconDarkCard * (0.58 + iconEdge * 0.22)
        * clamp(uReflect * uMaterialExposure, 0.0, 2.0) * 0.5
        * mix(1.0, 0.62, iconClarity);
      // icon 需要比外殼更清楚的內部界面。暗卡保持局部並染成乾淨冷藍，不使用
      // HDRI 原本的灰褐低頻反射；如此中央仍透，側面卻有接近黑底版的曲面層次。
      float iconCoolCardWeight = clamp(
        iconCardStrength * (0.52 + uLightCardStrength * 0.54), 0.0, 0.58
      );
      researchIconColor = mix(
        iconBodyColor,
        iconBodyColor * vec3(0.22, 0.52, 0.84),
        iconCoolCardWeight
      );
      // 厚度與掠射面再形成一層柔和藍色暗面。它不依賴 HDRI 的平均亮度，因此在
      // 白紙上仍持續存在；白卡高光會在下一段覆回去，保留玻璃的亮暗反射層次。
      float iconSculptShade = clamp(
        iconDarkCard * 0.38
          + iconThickness * 0.14
          + iconColorRim * 0.16,
        0.0,
        0.46
      ) * mix(0.72, 1.0, clamp(uLightCardStrength, 0.0, 1.0));
      float iconFormFacing = clamp(
        dot(researchIconN, normalize(vec3(-0.46, 0.58, 0.68))) * 0.5 + 0.5,
        0.0,
        1.0
      );
      iconSculptShade = clamp(
        iconSculptShade
          + pow(1.0 - iconFormFacing, 1.25)
            * (0.18 + uLightCardStrength * 0.22),
        0.0,
        0.58
      );
      researchIconColor = mix(
        researchIconColor,
        researchIconColor * vec3(0.34, 0.68, 0.98),
        iconSculptShade
      );
      float iconSoftbox = pow(max(dot(iconReflectDir,
        normalize(vec3(-0.48, 0.66, 0.58))), 0.0), mix(4.0, 2.0, uRoughness));
      researchIconColor = mix(researchIconColor, vec3(0.97, 0.99, 1.0), iconSoftbox * 0.62);
      researchIconColor = mix(researchIconColor, vec3(1.0), iconHighlight * 0.88);
      float iconClearCenter = (1.0 - iconEdge) * (1.0 - iconColorWeight);
      researchIconColor = mix(
        researchIconColor,
        vec3(0.975, 0.993, 1.0),
        iconClarity * iconClearCenter * 0.82
      );
      // 反射不依賴色彩濃度；把濃度歸零仍是能讀出曲面的無色玻璃。
      // 柔白反射也要有覆蓋率，否則低染色濃度會把外殼紋理再次透進亮面，
      // 讓 icon 像一片起皺的薄膜。仍保留至少 14% 的下層透射。
      float iconSurfaceCoverage = mix(0.50, 0.22, iconClarity)
        + iconThickness * mix(0.18, 0.08, iconClarity);
      researchIconMask = clamp((max(max(iconDensity, iconSurfaceCoverage), iconColorWeight * 0.92) + iconDarkCard * 0.42
        + iconHighlight * 0.24) * iconBoundary, 0.0, mix(0.86, 0.72, iconClarity)) * uLightBackdrop;
    }

  }
  // Include the colored reflection in own energy before coverage / transparent export.
  if (uLightBgGradientEnabled < 0.5 && researchBoundaryDepth > 0.0) {
    finalColor = researchDarkBoundaryReflection(finalColor, researchBoundaryColor, researchBoundaryDepth);
  }
#endif
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
  // 淺底：把「低彩度」的自身能量去掉暖色偏。
  //
  // 棚燈 HDRI 是米黃色的，那點暖色在深底上完全看不出來（周圍全黑，眼睛沒有
  // 白參考），一旦被抬到白背景上就變成一層灰褐色的濁 —— 這就是原本「黑黑
  // 髒髒」裡的「髒」，跟體積吸收造成的「黑」是兩件不同的事。
  //
  // 只處理低彩度的部分：藍色焦散、色散彩虹、薄膜彩邊這些有彩度的項目是這個
  // 材質的識別特徵，一律原封不動保留，換到白底也要看得出是同一個材質。
  if (universalGlass && uLightBackdrop > 0.0) {
    float ownLum = dot(finalColor, vec3(0.2126, 0.7152, 0.0722));
    float ownChroma = max(finalColor.r, max(finalColor.g, finalColor.b))
      - min(finalColor.r, min(finalColor.g, finalColor.b));
    // 留一點冷偏而不是純灰：這個材質本來就是冷色系的液態玻璃（吸收色預設
    // #68b2e7），純灰會讓它在白底上讀起來像水泥。
    vec3 ownClean = vec3(ownLum) * vec3(0.94, 0.975, 1.03);
    finalColor = mix(
      finalColor,
      ownClean,
      (1.0 - smoothstep(0.04, 0.22, ownChroma)) * uLightBackdrop
    );
  }
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
    // 淺底把覆蓋率抬高。這是整個白底問題的核心一行，說明如下。
    //
    // over 合成是 final = own + bg·(1 - cover)，而 cover 取的是自身能量的峰值。
    // 背景為白（1.0）時代進去就是：
    //
    //     final = own + 1·(1 - peak(own))
    //
    // 對灰階的自身能量，這恆等於 1.0 —— 不管 own 多大都一樣。也就是說「覆蓋率
    // 等於能量峰值」這個設定，在白背景上會精確地把自身能量抵銷掉。深底時它是
    // 對的（bg 為 0，final = own，能量完整保留），白底時它是災難。
    //
    // 抬高 cover 就打破這個抵銷：讓開的背景比自身能量還多，差額就是這個材質在
    // 白底上留下的痕跡，而留下來的顏色仍然是 own 自己的顏色 —— 也就是黑底那套
    // 材質的色相，不是另外配一組。這正是「同一個材質換到白底」該有的做法。
    //
    // pow 的指數小於 1，作用是把「暗但有色相」的大片區域抬起來。這個材質在黑底
    // 上絕大部分面積都是暗的（深藍玻璃），線性的 cover 會讓那些區域在白底上幾乎
    // 完全消失，只剩幾道高光 —— 症狀就是「輪廓跟顏色都看不清楚」。
    // uLightShow 是唯一的美術旋鈕（面板上的「淺底顯色」）。0 = 完全不抬，行為
    // 與深底的公式逐字相同，水滴在白底上會像原本那樣被抵銷掉；1 = 抬到最強，
    // 材質幾乎不透明。指數與增益一起走同一根，因為它們表達的是同一件事：
    // 「這個材質在白底上要留下多少痕跡」。
    if (uLightBackdrop > 0.5) {
      // brightComposite 已經包含白底透射、厚度、反射卡與彩邊，是一張完成的白底
      // 合成。若再套一次暗底用的 own + bg·(1-cover)，白色透射會被重複加回來，
      // 前面建立的所有明暗都被洗成接近純白，正是畫面看起來 2D 的主因。
      float lightVolumeMask = clamp(
        material.edgeFactor * 0.34
          + backRim * 0.18
          + pow(1.0 - lightFormFacing, 1.2) * 0.64,
        0.0,
        1.0
      );
#ifdef FEATURE_RESEARCH
      // icon 有自己的材質明暗，避免外殼的體積強化再次壓過它們。
      lightVolumeMask *= 1.0 - smoothstep(0.04, 0.42, researchIconMask);
#endif
      finalColor = mix(
        finalColor,
        finalColor * vec3(0.68, 0.84, 0.98),
        clamp(uLightShow, 0.0, 1.0) * lightVolumeMask
      );
      finalColor = clampOutput(finalColor);
    } else {
      // 深底維持原本的自身能量 over 路徑，公式與定案輸出不變。
      finalColor = clampOutput(
        finalColor + universalTransmitted * (1.0 - universalCovered)
      );
    }
#ifdef FEATURE_RESEARCH
    // 局部反射卡保留明暗面；深底 mask 為零，沿用原本合成。
    finalColor = clampOutput(
      mix(finalColor, researchIconColor, clamp(researchIconMask, 0.0, 1.0))
    );
#endif
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
  finalColor = clampOutput(finalColor * beamAbsorb);


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
#ifdef FEATURE_RESEARCH
      if (researchIconMask > 0.0) {
        float iconAlpha = clamp(researchIconMask, 0.0, 1.0);
        float combinedAlpha = iconAlpha + outputAlpha * (1.0 - iconAlpha);
        finalColor = clamp((finalColor * outputAlpha * (1.0 - iconAlpha)
          + researchIconColor * beamAbsorb * iconAlpha) / combinedAlpha, 0.0, 1.0);
        outputAlpha = combinedAlpha;
      }
#endif
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
  gl_FragColor = vec4(finalColor, uCoverageAlpha > 0.5 ? 1.0 : outputAlpha);
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


// shader cache 破壞用的 salt（?shaderRun=N）。原理見正式 shader 那一段的註解：
// 整數字面值 × 恆為 0 的 uniform，讓 HLSL 不同但執行期恆為 0。
uniform float uShaderSalt;

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
  vec3 outColor = vec3(0.15, 0.35, 0.7) * (0.15 + 0.85 * lambert);
#ifdef SHADER_RUN
  outColor += vec3(float(SHADER_RUN) * uShaderSalt);   // 恆為 0
#endif
  gl_FragColor = vec4(outColor, 1.0);
}
`;

export { FRAG_BASELINE };
