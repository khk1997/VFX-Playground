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
// 三個作用點：liftedCover（抬高覆蓋率打破抵銷）、低彩度自身能量的去暖色偏、
// 以及 researchIconColor／researchIconMask（內部 icon 的獨立顯色）。深底時全部
// 是恆等運算。
uniform float uLightBackdrop;
// 淺底的顯色強度（見 liftedCover）。只在 uLightBackdrop 為 1 時有作用。
uniform float uLightShow;
// 淺底時內部 icon 的獨立顯色（見 researchIconColor）。刻意跟體積吸收脫鉤：
// 這三根只在淺底作用，深底一律不讀，所以調它們動不到黑底的任何外觀。
//
// uLightIconColor 只取色相，亮度會被歸一化（見套用處）—— 選色器選的是「偏哪個
// 顏色」而不是「多暗」，這也是黑邊不會回來的保證。
uniform vec3  uLightIconColor;
uniform float uLightIconTint;
uniform float uLightIconEdge;
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
// 環境／PMREM 探針：保留簽章、換掉本體，讓所有呼叫點與 main() 的控制流都不變，
// 量到的就是「PMREM 取樣這一整塊」的純編譯成本。退回程序化棚燈（原本就是沒有
// HDRI 時的路徑），所以仍然回傳合理的環境色，不會讓下游拿到常數而被摺掉。
#ifndef FEATURE_ENV_PMREM
  return proceduralEnv(d, rough);
#endif
#ifdef FEATURE_ENV_PMREM
  if (uHasEnv == 1) {
    d = rotateEnvDir(d);
    vec3 center = textureCubeUV(uPmremMap, d, rough).rgb;
    // 高粗糙度直接取 PMREM 低階 mip 容易顯出 cube-UV 的格狀邊界。
    // 用 roughness² 控制 GGX lobe 寬度，再以 8 點環形半球近似補樣本。
    //
    // 診斷探針（?diag=single-reflection-sample）會把下面整段環形補樣在編譯期移除，
    // 只留上面那一次 textureCubeUV。目的是量「同一支 shader、只差這一塊」的 cold
    // compile 差距 —— textureCubeUV 每次都會展開整份 three.js cube_uv_reflection_fragment
    // （getFace / getUV / bilinearCubeUV × 2 個 mip），所以這裡最多 9 次取樣在
    // ANGLE 翻成 HLSL 之後是很大的一塊。fxc 也只對這支與 backgroundSample 發出
    // X4000 警告，所以它是第一個該被單獨量的對象。
    //
    // 未帶這個 diag 時整段照常編譯，正式版行為完全不變。畫面會少掉高粗糙度的
    // 環形預濾波，所以這只是探針，不是可以直接上線的設定。
#ifndef PROBE_SINGLE_REFLECTION_SAMPLE
    // 起跳點原本是 0.28，但粗糙度滑桿的預設值就是 0.2、幾個模式的 override 是
    // 0.26，全都落在起跳點以下——等於滑桿前四分之一是死行程，推了沒反應。
    // 降到 0.05，讓補樣從滑桿一離開 0 就開始接手。
    float blur = smoothstep(0.05, 0.92, rough);
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
#endif // PROBE_SINGLE_REFLECTION_SAMPLE
    return center;
  }
  return proceduralEnv(d, rough);
#endif // FEATURE_ENV_PMREM
}
// extraBlur：呼叫端額外要求的預濾波寬度。穿過玻璃的取樣（折射背景、內部填光）
// 傳粗糙度換算過的值進來，看向背景畫布的那一次傳 0——後者是「物體背後的背景」，
// 不該被物體自己的表面粗糙度糊掉。
//
// PMREM 的 mip 本身就是預濾波過的環境模糊，拿它當霧面玻璃的模糊來源是零額外
// 取樣成本的：不必在錐內多打好幾根射線，換 mip 就好。
vec3 sampleEnvironmentBackdrop(vec3 d, float extraBlur){
#ifndef FEATURE_ENV_PMREM
  return proceduralEnv(rotateEnvDir(d), max(max(0.025, uHdriBlur), extraBlur));
#endif
#ifdef FEATURE_ENV_PMREM
  if (uHasEnv != 1) return uBgColor;
  d = rotateEnvDir(d);
  // 1K equirectangular HDRI 直接以 LOD 0 放進高解析度折射時，少量 texel
  // 會被厚玻璃大幅放大，攝影棚牆面看起來就像一塊塊方格。即使 UI 的模糊
  // 是 0，也保留一個只相當於射線 footprint 的 PMREM 下限；這是反鋸齒，
  // 不是美術模糊。滑桿往上時仍直接控制其餘 roughness 範圍。
  float rayFootprint = max(max(0.025, uHdriBlur), extraBlur);
  return textureCubeUV(uPmremMap, d, rayFootprint).rgb;
#endif // FEATURE_ENV_PMREM
}
vec4 backgroundSample(vec3 rd, float extraBlur){
  if (uBgMode == 1 && uHasEnv == 1){
    return vec4(sampleEnvironmentBackdrop(rd, extraBlur), 1.0);
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
// ===== 造型距離場的來源特化 =====
//
// 造型有兩種來源：SVG 擠出（uShapeType == 1）與 GLB 體積（uShapeType == 2），
// 面板的「形狀來源」二選一。原版把兩支距離場都編進去，再用 uShapeType 在
// runtime 選一支 —— 而 mapScene 攤平之後每一份都帶著兩支，其中一支必定是死碼。
//
// volumeShapeDistance 是 8 次 atlasVoxel（＝8 個 texture2D 加三線性插值），
// 所以在 SVG 模式下這一刀砍掉的是編譯規模裡最大的一塊。
#ifdef FEATURE_SHAPE_SVG
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
// ch 就是通道身分：0＝形狀 A、1＝形狀 B（見 sampleShapeField 的 ch 註解）。
// 兩顆形狀的距離場本來就各自帶著自己的 ch 走完全程，所以邊緣液化只要在這裡
// 依 ch 取對應的那一份，兩顆就能各自調粗細，不需要任何額外的分支或取樣。
float shapeSoftnessFor(int ch){
  return ch == 1 ? uShapeSoftnessB : uShapeSoftness;
}

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
  return result - shapeSoftnessFor(ch);
}
#endif // FEATURE_SHAPE_SVG

#ifdef FEATURE_SHAPE_VOLUME
float decodeShape(float v){ return (v - 0.5) * 48.0; }
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
  float edge = mix(z0, z1, f.z) * voxelSize - shapeSoftnessFor(ch) - topologyGuard;
  vec3 outside = max(gridP - (n - 1.0), vec3(0.0)) + max(-gridP, vec3(0.0));
  return edge + length(outside) * voxelSize;
}
#endif // FEATURE_SHAPE_VOLUME

// 造型距離場的單一入口。mapScene 有三個呼叫點，原本每一個都寫成
//   uShapeType == 1 ? svgShapeDistance(...) : volumeShapeDistance(...)
// 於是兩支都被編一份。這裡把那個三元運算子搬進一個函式，兩支的存在與否交給
// FEATURE_SHAPE_SVG / FEATURE_SHAPE_VOLUME 決定。
//
// 兩者都開時（?diag=allfeatures 的驗證組合）三條 if 覆蓋了 uShapeType 的所有取值，
// 最後那個 return 到不了，行為與原本的三元運算子逐位元相同。
//
// 只開一支時多出一個型別檢查，那不是保險而是有意義的：換「形狀來源」的當下
// uShapeType 就變成新值，而對應的變體要在背景編好幾秒後才會換上來。這幾秒裡寧可
// 回傳遠距離（＝此刻沒有造型，跟切換模式時造型還沒出現是同一種過渡），也不要把
// 體素圖集當成 SVG 高度場、或反過來，解讀出一團跟形狀無關的東西。
float shapeDistance(vec3 p, bool smoothShape, int ch){
#ifdef FEATURE_SHAPE_SVG
  if (uShapeType == 1) return svgShapeDistance(p, smoothShape, ch);
#endif
#ifdef FEATURE_SHAPE_VOLUME
  if (uShapeType != 1) return volumeShapeDistance(p, ch);
#endif
  return 1e6;
}

#endif // FEATURE_SHAPE_FIELD

// 分離後由接觸極點向外傳播的局部毛細波；只處理主要水滴對 0/1。
// 只有分裂模式會呼叫（見 mapScene 的 FEATURE_CAPILLARY_WAVE），所以函式本體也一起關。
#ifdef FEATURE_CAPILLARY_WAVE
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
#endif // FEATURE_CAPILLARY_WAVE

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
//
// FEATURE_DISSOLVE_FIELD 由 bubble.js 在「形狀變形的交接」或「形狀匯聚的成型波前」
// 任一個成立時開啟（見 shaderFeatures）。其餘造型模式兩道波前都不存在，這整段
// 連著裡面那個 3x3 Voronoi 迴圈都是死碼 —— 而它在攤平後是跟著 mapScene 一起乘的。
#ifdef FEATURE_DISSOLVE_FIELD
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

#endif // FEATURE_DISSOLVE_FIELD

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
  // 7 是毛細波、8 是靜態模式（見 motions/registry.js 的 uniform 編號）；兩者共用
  // 同一支程序紋理，只是分別套在形狀場座標與內建幾何的座標上。
  if (uExtendedMotion != 7 && uExtendedMotion != 8) return 0.0;
  // 程序紋理選「無」（6）：表面完全不產生偏移，物體維持原本的幾何。
  if (uCapillaryStyle.y > 5.5) return 0.0;
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

// 靜態模式的內建幾何：一組經典 Inigo Quilez SDF 公式，不吃水滴也不吃匯入
// 造型（那是 uStaticShape == 7 時的「匯入」分支，走的是上面的形狀場）。
#ifdef FEATURE_STATIC_SHAPE
// 圓角方體。圓角半徑在呼叫端已夾在半邊長以內，避免拉滿時塌成自交錯誤形狀。
float sdRoundBox(vec3 p, vec3 halfExtents, float cornerRadius){
  vec3 q = abs(p) - halfExtents + cornerRadius;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - cornerRadius;
}
// 球體。UV Sphere／Ico Sphere 在多邊形網格上有差別，SDF 上是同一顆球，
// 所以面板把兩者併成一個選項。
float sdSphere(vec3 p, float r){
  return length(p) - r;
}
// 圓柱（含平面／圓盤：兩者都是「很扁的圓柱」，半高改小就好，不必另開一支）。
// 軸沿 y，r 半徑、h 半高。
float sdCylinder(vec3 p, float r, float h){
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
// 實心圓錐（尖端朝 +y、底面在 -y），Inigo Quilez 的 capped cone 公式令頂端
// 半徑固定為 0 的特例。r1 是底面半徑，h 是半高。
float sdCone(vec3 p, float r1, float h){
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(0.0, h);
  vec2 k2 = vec2(-r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : 0.0), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// 圓環，軸沿 y。majorR 是環心到管中心的距離，minorR 是管半徑。
float sdTorus(vec3 p, float majorR, float minorR){
  vec2 q = vec2(length(p.xz) - majorR, p.y);
  return length(q) - minorR;
}
#endif // FEATURE_STATIC_SHAPE

#ifdef FEATURE_RESEARCH
// 側面／下緣權重的圓角半徑。這個常數存在的理由是折痕，不是造型：
//
// 這個遮罩原本寫成 abs(q.x) + max(-q.y, 0.0) * 0.55。q 是球心指向表面的單位
// 方向，所以 abs() 在 q.x=0 那整圈子午線上、max() 在 q.y=0 那整圈赤道上斜率
// 反號 —— 值是連續的，跳掉的是梯度。偏移量又直接減進距離場（見 mapScene），
// 法線是對同一個 mapScene 做中央差分，於是那兩圈折線變成兩道法線硬折，在
// roughness 0.035 的透射玻璃上被折射放大成「一條把球切開」的亮線；因為
// mapScene 同時被 traceExitSurface 用來找第二表面，正面與背面各有一道，看
// 起來就像貫穿整顆球。GPU 實測（預設 amount 0.022、density 1，掃過折線 ±0.12、
// 16 個相位，單步 h=0.0018 的法線轉角）：跨越 x=0 峰值 5.94°、y=0 峰值 1.77°，
// 而同一條掃描帶的平均只有 0.33° —— 折線是唯一的離群值，所以看得見。
//
// 換掉的是那兩個不可微運算，不是造型意圖：
//   sqrt(x*x + k*k)                 abs(x) 的雙曲線圓角版
//   0.5 * (sqrt(y*y + k*k) - y)     max(-y, 0) 的同款平滑版
// 兩者的兩條尾巴都逐字收斂回原式（|值| ≫ k 時），只在寬約 k 的那條窄帶內
// 抬高一點 —— 也就是只有折線本身被抹平，側面與下緣的鼓包手感沒動。
//
// k 取 0.06 是量出來的：同一組掃描的峰值降到 x=0 為 0.62°、y=0 為 0.64°，而且
// 峰值位置移到帶緣（|q| ≈ 0.12，那是鼓包本身最陡的地方），折線處不再有殘留；
// 帶內平均維持 0.31–0.32°，與舊式的最大高度差 0.0025 世界單位（半徑的 0.32%）。
// k 再往上加只多磨掉 0.1° 左右，純粹是白付偏差。折痕與周圍的自然變化都與
// uResearchShellAmount 成正比，所以這個比例在滑桿拉到上限 0.08 時同樣成立。
const float RESEARCH_SIDE_SOFT = 0.06;

// 兩顆 icon 的出生時刻與錨點方向。外殼的隆起／漣漪、icon 的頸子與位置都要讀
// 同一組值，所以集中在這裡 —— 分成兩份各自寫死,遲早會漂掉一邊。
//
// A 的出生時刻不能小於預備動作的長度(0.06)：預備動作發生在區域時間 t 為負的
// 那一段,而 t = phase - birth。birth 若小於 0.06,那段會落到 phase < 0,在 loop
// 接點上被 fract 切斷 —— 隆起會在 phase 0 那一幀憑空跳出一塊。
#define RESEARCH_ANTICIPATE 0.06
#define RESEARCH_BIRTH_A 0.0
// B 的出生時刻由 uResearchIconBirthStagger 控制。
// 每顆的壽命,以及淡出的起點。壽命必須跟淡出的終點一致,scale 才會剛好在生命
// 結束那一刻歸零。最晚出生的 B 在 0.14 + 0.84 = 0.98 收完,留 0.02 給 loop 接點。
// 每顆 icon 的生命週期現在正好填滿一整個循環,兩顆錯開可調的出生間隔。
//
// 這是為了「重複播的背景」改的。舊版是兩顆一起生、一起死,中間留下約一成的
// 空景 —— 而外殼的環境起伏被設成靜止,那段時間畫面上真的什麼都不動,看起來
// 像卡住。生命週期填滿整圈之後,任何時刻都是一顆在消融、另一顆在冒芽或停留,
// 沒有全體歸零的瞬間,也就沒有接縫。同框時間反而從 49% 變成約 52%。
//
// 代價:區域時間不再有「不在生命週期內」這種狀態,原本那個 early-out 失效,
// 兩顆每次都要算。成本增加不多但不是零。
#define RESEARCH_LIFE 1.0
// 退場三拍。都以區域時間計,而且必須在 1.0 之前收乾淨 —— 區域時間是繞圈的,
// 拖過 1.0 會和自己的下一次出生重疊。
#define RESEARCH_EXIT_START 0.82
// 幾何特徵的最小世界尺寸。小過這個的球或錐,中央差分會取到物體外面,算出來的
// 是噪音而不是法線 —— 這條線在這個檔案裡已經付過三次學費(頸子、衛星、icon
// 本體),統一用一個常數。
#define RESEARCH_MIN_FEATURE 0.008
// 芽的出生位置相對於錨點的內縮比例。
//
// 錨點在殼壁上(半徑約 0.698,水滴半徑 0.76),而 icon 只在外殼的進入點與出射點
// 之間被追蹤 —— 芽長在錨點上的話有一半在殼外,那段根本畫不出來,看起來就是
// 「移動到殼內一段距離後才憑空出現」。
//
// 把出生位置往內縮,但錨點本身不動:外殼的隆起是用 normalize(anchor) 定位的,
// 只看方向不看半徑,所以隆起仍然落在殼壁的同一點;頸子的遠端也仍然拉到錨點,
// 還是連著殼壁。動的只有芽自己,現在它完整落在可追蹤的範圍內。
#define RESEARCH_BUD_INSET 0.78
// 衛星水滴:液柱夾斷幾乎必定在斷點留下一顆小珠子,再被兩端吸收。這是賣「這是
// 液體」最便宜也最有效的細節 —— 少了它,再怎麼調曲線都像「兩個物件分開」而不是
// 「一坨液體斷了」。
//
// R 取 0.034:0.018(頸子被砍掉時的粗細)在實際算繪尺寸下只有約 11 像素,幾乎
// 看不見;0.080 又大到跟腳差不多、看起來像第三顆 icon。MIN 是收掉的下限,
// 理由同 NECK_SAFE_R —— 半徑掉到跟法線取樣間距(0.0018)同量級就會開始算出
// 垃圾法線,寧可在還有幾個像素寬的時候乾脆消失。
#define RESEARCH_SAT_R 0.034
#define RESEARCH_SAT_MIN 0.008
#define RESEARCH_SAT_LIFE 0.16
// 頸子從開始變細到完全夾斷的區間(以每顆自己的區域時間計)。
#define RESEARCH_NECK_START 0.11
#define RESEARCH_NECK_END 0.19

// sideSign 為 +1 是右邊那顆(A)、-1 是左邊那顆(B)。
vec3 researchAnchor(float sideSign){
  return vec3(sideSign * 0.575, -0.395, sideSign * 0.03);
}

// 內部 icon 的誕生在外殼上留下的痕跡：先鼓起、放開、再盪一圈漣漪。
//
// 這一段存在的理由是因果。原本外殼完全不知道殼裡在發生什麼事,兩顆 icon 像貼在
// 玻璃球裡的貼紙;有了預備動作,誕生才是「被外殼頂出來的」而不是憑空的。順帶
// 解掉一個渲染限制:icon 只在外殼的進入點與出射點之間被追蹤(researchTraceIcon
// 的 maxDistance 就是那段光程),冒芽時它有一半在殼外,根本畫不出來 —— 而外殼
// 本身永遠看得見,所以「長出來」這件事交給外殼演比交給 icon 演可靠。
//
// 兩項都必須 C1 連續。這個偏移量直接減進距離場,法線是對同一個場做中央差分,
// 任何梯度跳變都會被折射放大成一條亮線(理由同上面 RESEARCH_SIDE_SOFT 那段)。
// 所以距離量取 ad = 1 - dot(q, an):它在錨點正中央對角度是二次的,不像 length()
// 或 acos() 會在中心留下一個尖點。
float researchShellEvent(vec3 q, float sideSign, float t){
  vec3 an = normalize(researchAnchor(sideSign));
  float ad = 1.0 - dot(q, an);
  // 區域時間現在繞著整個循環走(0..1),預備動作發生在「出生之前」,也就是繞到
  // 接近 1.0 的那一段。tb 把它換算成以出生為原點的有號時間 [-0.5, 0.5),預備
  // 動作因此仍然是單純的 tb < 0 —— 不必為了接縫在時間軸上分兩段判斷。
  float tb = t > 0.5 ? t - 1.0 : t;

  // 預備動作:出生前 RESEARCH_ANTICIPATE 這段時間鼓起來,頂到最高點芽才冒出;
  // 頸子夾斷的同時放掉,所以「放開」與「斷裂」是同一個瞬間。
  float swellAmt = smoothstep(-RESEARCH_ANTICIPATE, 0.0, tb)
    * (1.0 - smoothstep(RESEARCH_NECK_START, RESEARCH_NECK_END, tb));
  float swell = exp(-ad * 26.0) * swellAmt * 0.080;

  // 反作用力:夾斷瞬間從錨點擴出去的一圈漣漪。不設時間上界,靠 exp 自己衰減到
  // 遠小於一個像素(age=0.5 時只剩 5e-5),這樣就沒有「關掉」那一幀的跳變;
  // 起手的 smoothstep 則保證 age=0 那一刻是從 0 長出來的。
  float age = t - RESEARCH_NECK_END;
  float ripple = 0.0;
  if (age > 0.0) {
    ripple = sin((ad * 7.0 - age * 9.0) * 3.0)
      * exp(-age * 11.0)
      * exp(-ad * 3.0)
      * smoothstep(0.0, 0.015, age)
      * 0.013;
  }
  return swell + ripple;
}

// 六種程序紋理,詞彙與數學都直接對應毛細波模式的「程序紋理」選單
// (Wave/Noise/Voronoi/Gabor/Gradient/Magic,見 capillarySurfaceOffset)。
// 刻意不去改毛細波那邊、抽成共用函式——那段已經上線、調校過,任何抽換都是
// 拿已驗證的東西冒險;這裡另外寫一份相同公式,用私語自己的 field/lateral
// 座標餵進去。field/lateral/travelPhase 的角色與毛細波完全一致:
//   field       沿「行進方向」的座標,Noise/Voronoi 靠它做整數格點平移循環。
//   lateral     橫向座標,決定花紋在行進方向以外的變化。
//   travelPhase 給 Wave/Gabor/Gradient/Magic 用的連續相位。
//   fieldTravel 給 Noise/Voronoi 用的離散格點平移量,見下方函式內的說明。
// 私語沒有毛細波的「波場類型」(同心放射／定向推進／螺旋擴散)——外殼是封閉
// 球面,沒有一個自然的「方向」可以做定向或放射波場,所以固定用兩個 q 分量
// 當 field/lateral,不提供那三種波場選擇。
// 這三支是私語自己的版本,不是拿毛細波那兩支來用。差別全部在「連續性」上:
// 外殼的紋理是直接減進距離場的,法線是對同一個場做中央差分 —— 場只要有一處
// 梯度跳變(C0 而不是 C1),折射就會把它放大成一條看得見的稜線,整片紋理於是
// 讀起來像被切成一塊一塊的。毛細波那邊是拿來做橫向的表面位移、又疊在別的
// 起伏上,同樣的公式在那裡看不出問題,所以那邊不動,這裡另寫一份。
//
// 值雜訊:淡入用五次式 f³(6f²-15f+10) 而不是 smoothstep 的 f²(3-2f)。三次式的
// 二階導數在格線上是跳的,而法線是一階導數 —— 一階連續、二階不連續的場,在
// 折射下就是沿著格線的一格一格明暗,正是「切塊」最典型的來源。五次式的一、二
// 階導數在格點上都是 0,格線因此完全消失。
float researchValueNoiseLoop(vec2 p, float period){
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float x0 = mod(cell.x, period);
  float x1 = mod(cell.x + 1.0, period);
  float a = hash11(dot(vec2(x0, cell.y), vec2(127.1, 311.7)));
  float b = hash11(dot(vec2(x1, cell.y), vec2(127.1, 311.7)));
  float c = hash11(dot(vec2(x0, cell.y + 1.0), vec2(127.1, 311.7)));
  float d = hash11(dot(vec2(x1, cell.y + 1.0), vec2(127.1, 311.7)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 細胞雜訊:取最近距離時用平滑最小值而不是 min()。兩個格點等距的那條線上,
// min() 的梯度是硬折(左右兩邊各自指向不同的格點),那正好就是 Voronoi 的
// 每一道邊界 —— 於是整片紋理被切成一塊一塊多邊形。平滑最小值把那道折線抹成
// 一段有寬度的圓角,細胞感還在,邊界不再是稜線。
float researchCellularLoop(vec2 p, float period){
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
      float dist = length(f - site);
      // k = 0.14:比細胞尺寸(約 1.0)小一個量級,所以只影響邊界那一圈。
      float hMix = clamp(0.5 + 0.5 * (nearest - dist) / 0.14, 0.0, 1.0);
      nearest = mix(nearest, dist, hMix) - 0.14 * hMix * (1.0 - hMix);
    }
  }
  return 1.0 - smoothstep(0.05, 0.78, nearest) * 2.0;
}

// 平滑飽和,取代原本的 clamp(wave * gain, -1, 1)。clamp 在飽和點是 C0:斜坡
// 一路上去、突然變成平台,那個轉角同樣是梯度跳變。Noise 的 gain 是 1.35、
// Magic 是 1.25,兩者經常撞到上限,於是滿面都是那種「削平的邊」。
// |x| < 0.75 完全不動(絕大多數取樣落在這裡,外觀不變),之後指數地收向 ±1;
// 接點兩側的值與斜率都相等,所以是 C1。
float researchSoftLimit(float x){
  float a = abs(x);
  float soft = 1.0 - 0.25 * exp(-(a - 0.75) * 4.0);
  return sign(x) * (a < 0.75 ? a : soft);
}

float researchProceduralTexture(
  float textureType, float field, float lateral, float travelPhase,
  float density, float fieldTravel, float fieldPeriod
){
  float wave;
  float textureGain = 1.0;
  if (textureType < 0.5) {
    // Wave:與毛細波同一行,規則、可讀性最強的基準波。
    wave = sin(travelPhase);
  } else if (textureType < 1.5) {
    // Noise 的座標與週期化手法跟 capillaryValueNoiseFieldLoop 的用法一致:
    // fieldTravel 是 fieldPeriod 的整數倍時,函式內部的 mod(cell, fieldPeriod)
    // 在循環頭尾給出完全相同的雜湊,因此無縫。
    vec2 noiseP = vec2(field, lateral) * density * 1.35;
    wave = researchValueNoiseLoop(
      noiseP - vec2(fieldTravel, 0.0), fieldPeriod
    ) * 2.0 - 1.0;
    textureGain = 1.35;
  } else if (textureType < 2.5) {
    vec2 cellularP = vec2(field, lateral) * density * 1.15;
    wave = researchCellularLoop(
      cellularP - vec2(fieldTravel, 0.0), fieldPeriod
    );
    textureGain = 1.10;
  } else if (textureType < 3.5) {
    wave = sin(travelPhase) * 0.72
      + sin(travelPhase + lateral * density * TAU * 0.78) * 0.28;
    textureGain = 1.15;
  } else if (textureType < 4.5) {
    // 化簡自毛細波原式 fract(field*density - movingA/TAU):movingA 展開後
    // 兩個 field*density 項互相消掉,只剩 -travelPhase/TAU,純用 travelPhase
    // 表達,不必另外傳 movingA。
    float ramp = fract(-travelPhase / TAU);
    // 三角波的頂點與谷底各是一個尖角,尖角在折射下就是一圈亮線。用 smoothstep
    // 把三角波整形成 S 形:形狀(單調的爬升與下降)保留,兩端的尖角變成平順的
    // 轉向,值域仍是 [-1, 1]。
    float tri = 1.0 - abs(ramp * 2.0 - 1.0);
    wave = (tri * tri * (3.0 - 2.0 * tri)) * 2.0 - 1.0;
  } else {
    float magicCross = lateral * density;
    wave = sin(travelPhase + sin(magicCross * 2.7) * 1.1)
      * cos(magicCross * 1.9)
      + sin(travelPhase * 2.0 + cos(magicCross * 3.3)) * 0.45;
    wave /= 1.45;
    textureGain = 1.25;
  }
  return researchSoftLimit(wave * textureGain);
}

// 自創的外殼動態「駐波」,跟上面的六種程序紋理並存,不是取代——選單裡佔一格
// (值 7,避開毛細波沿用的 0-6 編號)。
//
// 駐波:兩組不同頻率的正弦疊加,時間項讓圖案緩慢旋轉。跟毛細波的「Wave」
// (單純 sin(travelPhase))不同,這裡是兩項相乘再疊加第三項,花紋更複雜;
// 保留成獨立選項而不是併進 Wave,兩種讀起來確實不一樣。
//
// 這裡原本還有「湍流」(3D fbm)與「脈動」(離散阻尼拍打)兩種,值 8/9。兩者
// 都已移除:湍流的 fbm 起伏在這顆殼的尺度下讀起來只是雜訊,脈動的拍點在一段
// 重複播的背景裡會變成重音。researchShellOffset 仍然接受 8/9 —— 舊的參數
// 組合檔存得到那兩個值,一律導向駐波,而不是靜悄悄地變成沒有紋理。
// q 是 researchTextureFrame 轉過的座標（沿軸／橫向／深度），不是原始球面方向 ——
// 三根「紋理方向」滑桿因此同樣轉得動駐波的花紋。
float researchShellStanding(vec3 q, float density, float phase){
  return sin(q.x * 4.6 * density + phase)
    * sin(q.y * 3.8 * density - phase)
    + 0.55 * sin((q.x - q.y + q.z) * 7.2 * density + phase * 2.0);
}

// 紋理座標的正交基底。三根「紋理方向」滑桿給的是沿軸方向,另外兩軸由它推出來,
// 構造與毛細波的 capillarySurfaceOffset 逐字相同（reference 的挑法也是,那是為了
// 避開 cross() 在方向接近 ±z 時退化）。回傳 vec3(沿軸, 橫向, 深度)。
//
// 預設方向 (1, 0, 0) 代進來剛好得到 (q.x, q.y, q.z),也就是加上這三根滑桿之前
// 寫死的座標,所以預設值下畫面完全不變。
vec3 researchTextureFrame(vec3 q){
  vec3 dir = vec3(uResearchTextureDirX, uResearchTextureDirY, uResearchTextureDirZ);
  float dirLength = length(dir);
  vec3 direction = dirLength > 0.001 ? dir / dirLength : vec3(1.0, 0.0, 0.0);
  vec3 reference = abs(direction.z) < 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 acrossAxis = normalize(cross(reference, direction));
  vec3 secondAxis = normalize(cross(direction, acrossAxis));
  return vec3(dot(q, direction), dot(q, acrossAxis), dot(q, secondAxis));
}

float researchShellOffset(vec3 p){
  vec3 q = normalize(p - uDrops[0].xyz + vec3(0.0001));
  // 紋理一律看這組轉過的座標,原始的 q 只留給下面的側面遮罩與誕生事件 ——
  // 那兩者是「這顆殼的上下左右」與「錨點在哪」,跟花紋朝哪個方向無關。
  vec3 t = researchTextureFrame(q);
  float phase01 = fract(uTime / max(uLoopDuration, 0.001));
  float cycles = floor(max(uResearchShellSpeed, 0.0) + 0.5);
  float phase = phase01 * TAU * cycles;
  float density = max(uResearchShellDensity, 0.1);

  // 「無」(6,跟毛細波同一個編號)只把紋理本身歸零,不是整段提早 return——
  // 下面的側面遮罩與誕生事件跟紋理選擇無關,選「無」時外殼仍該呼吸、icon
  // 誕生時仍該有隆起。7 是自創動態「駐波」,跟 0-6 的毛細波紋理並存於同一個
  // 選單,不是取代關係。
  float textureType = uResearchShellTexture;
  float pattern = 0.0;
  if (textureType < 5.5) {
    float field = t.x;
    float lateral = t.y;
    float fieldPeriod = max(2.0, floor(density * 3.0 + 0.5));
    // fieldTravel 每圈前進 cycles 個 fieldPeriod——cycles 是整數,所以循環邊界
    // 精確對齊(理由同 researchShellEvent 上方那段駐波用整數諧波的說明)。
    float fieldTravel = phase01 * cycles * fieldPeriod;
    float travelPhase = phase - field * density * TAU;
    pattern = researchProceduralTexture(
      textureType, field, lateral, travelPhase, density, fieldTravel, fieldPeriod
    );
  } else if (textureType > 6.5) {
    // 6.5 以上一律是駐波:7 是它自己,8/9 是已移除的湍流／脈動,舊存檔導過來。
    pattern = researchShellStanding(t, density, phase);
  }

  float k2 = RESEARCH_SIDE_SOFT * RESEARCH_SIDE_SOFT;
  float lateralMask = sqrt(q.x * q.x + k2);
  float lower = 0.5 * (sqrt(q.y * q.y + k2) - q.y);
  float side = smoothstep(-0.15, 0.9, lateralMask + lower * 0.55);
  // 誕生事件不乘 uResearchShellAmount。那根滑桿控制的是「環境起伏」的振幅,
  // 拉到 0 的語意是外殼平滑,不該連帶把因果關係一起關掉。
  float iconPhase = fract(phase01 - uResearchIconPhaseOffset);
  float events = researchShellEvent(q, 1.0, fract(iconPhase - RESEARCH_BIRTH_A))
    + researchShellEvent(q, -1.0, fract(iconPhase - uResearchIconBirthStagger));
  return pattern * side * uResearchShellAmount + events;
}

// 平滑併集。k 是融合半徑：兩個面靠近到 k 以內時,接縫會被拉成圓角而不是硬折。
// 這裡不能用 min()——內物件的法線同樣是中央差分求得的,硬折會在透射玻璃裡被
// 放大成一條亮線(理由與上面 RESEARCH_SIDE_SOFT 那段註解相同)。
float researchSmin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// 橢球。r 三軸半徑;回傳的是有界近似(iq 的二階式),比 length(p/r)-1 準得多,
// 對 sphere tracing 的步長友善。
float researchEllipsoid(vec3 p, vec3 r){
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

// 圓錐膠囊:a 端半徑 r1、b 端半徑 r2 的圓錐,兩端各封一個球。對話泡的腳需要
// 「粗端接本體、細端收成尖」,等半徑的膠囊做不出來,所以用這個。
float researchRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / max(l2, 0.000001);
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xp = pa * l2 - ba * y;
  float x2 = dot(xp, xp);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  // a2 = l2 - rr*rr 必須為正，最後一行才有意義：那裡是 sqrt(x2 * a2 * il2)，
  // a2 為負就是開負數根，回傳 NaN。而 NaN 會一路傳進 researchSmin 的 clamp()，
  // clamp(NaN, 0, 1) 的結果是驅動相依的 —— 畫面上時而整片亂掉、時而正常，
  // 換台機器又不一樣，正是這個未定義行為的典型症狀。
  //
  // a2 <= 0 的幾何意義是「圓錐比兩端半徑差還短」，也就是小的那顆端球完全被
  // 大的那顆包住，整個形狀退化成單一顆球。直接回傳那顆球，而不是硬算下去。
  if (a2 <= 0.0) {
    return r1 >= r2 ? length(p - a) - r1 : length(p - b) - r2;
  }
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// 對話泡:略寬於高的圓潤本體,加一隻從底緣長出來的短腳。
// 腳刻意做短、末端不收成針尖(r2 沒有小很多),整體才圓潤;smin 的 k 拉到 0.05,
// 讓腳與本體之間是一段飽滿的頸子而不是硬接上去的一根錐。
// z 軸壓成約 2/3,保留厚度讓 researchIconNormal 產生正常的折射法線。
// tailX 決定腳倒向哪一邊,兩顆用相反符號。
//
// stretch 是黏性拉伸量:沿發射軸(局部 x)拉長,另外兩軸等比收窄,體積大致守恆,
// 所以看起來是被扯成長條而不是整顆變大。距離場除以縮放後就不再是距離,回傳前
// 必須乘回最小的那個縮放係數才重新是合法的下界,sphere tracing 才不會跨過表面。
// bodyK / tailK 讓本體與腳各自縮放。退場時本體收、腳脹,視覺上就是這顆泡泡
// 往自己的尾巴裡瀝乾 —— 質量往低處流、頸縮、最後剩一顆珠,和開頭那段頸子是
// 同一套液體文法,而且完全原地完成,不會把視線帶到殼壁那個追蹤死角。
float researchIconOne(
  vec3 p, vec3 center, float scale, float angle, float tailX, float stretch,
  float bodyK, float tailK
){
  p = (p - center) / max(scale, 0.001);
  float c = cos(angle), s = sin(angle);
  p.xy = mat2(c, -s, s, c) * p.xy;
  float sx = max(1.0 + stretch, 0.20);
  float sr = 1.0 / sqrt(sx);
  vec3 q = vec3(p.x / sx, p.y / sr, p.z / sr);
  // 兩塊各自判斷還畫不畫得出來。任一塊的最小特徵掉到 RESEARCH_MIN_FEATURE 以下
  // 就整塊不畫 —— 硬撐著算只會得到噪音法線。缺席的一塊回傳 1e4,而 researchSmin
  // 遇到 1e4 會精確退化成另一邊(h 被 clamp 到端點),所以不必為此另外分支。
  // 本體的三軸。y 是基準,x 由「本體扁度」拉寬,z(厚度)不跟著變 —— 參考的
  // 玻璃對話框是一片扁平的板,寬度變了厚度不該跟著變。
  //
  // 最小半軸恆為 z,所以下面的可見性判斷只需要看 0.120,與扁度無關。
  float aspect = clamp(uResearchIconAspect, 1.0, 2.2);
  float body = 1e4;
  if (0.120 * bodyK * scale > RESEARCH_MIN_FEATURE) {
    body = researchEllipsoid(q, vec3(0.180 * aspect, 0.180, 0.120) * bodyK);
  }
  // 尾端半徑由滑桿控制。下限 0.010 是刻意的：局部 0.010 換算成世界尺度約 0.008，
  // 仍是法線取樣間距 h(0.0018) 的 4.5 倍。真正的針尖會讓中央差分取到物體外面，
  // 算出噪音法線——跟 icon 太小時同一個坑。
  float tail = 1e4;
  float tailR = 0.074 * tailK;
  if (tailR * scale > RESEARCH_MIN_FEATURE) {
    float tailTip = mix(0.055, 0.010, clamp(uResearchIconTailTip, 0.0, 1.0)) * tailK;
    tail = researchRoundCone(
      q,
      vec3(tailX * 0.060, -0.116, 0.0),
      vec3(tailX * 0.148, -0.208, 0.0),
      tailR,
      max(tailTip, tailR * 0.2)
    );
  }
  // 融合半徑跟著本體收:本體快消失時頸子也該收乾淨,否則會在腳上留一塊圓角殘肉。
  float k = 0.050 * min(bodyK, 1.0) + 0.004;
  return researchSmin(body, tail, k) * min(sx, sr) * scale;
}

// 一顆 icon 的完整生命週期,以它自己的區域時間 t 表示(t = phase 減掉出生時刻)。
//
// 造型上的重點是「它是從外殼上長出來的」,不是憑空出現在半空中再飄進來:
// anchor 是外殼內壁上的一點,芽從那裡冒出來、長大,期間一直有一段頸子連回
// anchor;頸子收細到斷掉,才真的變成一顆獨立的 icon。腳(researchIconOne 的
// tail)就長在頸子那一側,所以斷開後留下的那隻腳,正是它剛才連著外殼的地方 ——
// 「從各自的腳長出來」在幾何上是這樣成立的。
//
// 生命週期外回傳一個很大的值,讓呼叫端整段跳過;researchIconMap 在 march 迴圈、
// 法線的 6 次取樣、以及內部出口追蹤裡都會被呼叫,這個 early-out 值得留。
// 對答用的單次脈衝:在 at 那一刻迅速鼓起,振盪一兩下就靜下來。
// 事件之前恆為 0,所以兩顆各自的拍點互不干擾。
float researchChatPulse(float ph, float at){
  // fract 而不是相減:拍點的餘波可能跨過 loop 接點,直接用 ph - at 在 ph 繞回 0
  // 時會變成負數而被當成「還沒發生」,餘波就在接縫上被硬切掉。
  float d = fract(ph - at + 1.0);
  if (d > 0.35) return 0.0;
  return exp(-d * 14.0) * sin(d * 42.0);
}

float researchIconStage(
  vec3 p, float phase, float t, vec3 anchor, vec3 target,
  float size, float tailX, float angle, float chatAt, float exitEarly
){
  float grow = smoothstep(0.0, 0.14, t);
  float travel = smoothstep(0.09, 0.40, t);

  // 頸子:先維持飽滿、末段俯衝、再用一段硬收束切乾淨(見 researchIconOne 上方
  // 對 pow 尾巴的說明)。
  float nx = smoothstep(RESEARCH_NECK_START, RESEARCH_NECK_END, t);
  float neck = pow(1.0 - nx, 0.35) * (1.0 - smoothstep(0.85, 1.0, nx));

  // 夾斷後的阻尼振盪。
  float post = max(t - RESEARCH_NECK_END, 0.0);
  float ring = exp(-post * 9.0) * sin(post * 30.0);

  // ---- 退場三拍 ----
  //
  // 這是重複播的背景,所以退場不能有重音,也不能有句號 —— 任何明確的收束都會
  // 變成節拍點,讓人意識到「這東西會重播」。三拍都在原地完成:移動會把視線帶走,
  // 而且會走到殼壁那圈追蹤死角(icon 只在外殼進出點之間被畫得出來)。
  //
  //   sink     漂浮停下、微微下沉。「這一顆說完了」,但不強調。
  //   drain    本體的體積往腳裡轉移:本體收、腳脹、中間頸縮。
  //   collapse 剩下那顆珠收乾。液滴收乾的最後一刻是塌陷,所以這一段短而快;
  //            因為只剩一顆小珠、對比低,快也不會變成重音。
  // 消失:原地塌陷。
  //
  // 這是重複播的背景,所以退場不能有重音;而且必須原地完成 —— 橫向移動會把視線
  // 帶走,還會把收尾送到殼壁那圈追蹤死角(icon 只在外殼進出點之間畫得出來)。
  // 輪廓也維持完整到最後:先前試過讓本體流進腳裡,結果是垮成一團才消失,看起來
  // 像壞掉而不是離開。
  //
  // 曲線用 k 的三次方:前段幾乎不動,最後急收。液滴收乾就是這樣,等速縮小才會
  // 像「被關掉」。
  float k = smoothstep(RESEARCH_EXIT_START - exitEarly, 1.0, t);
  float exitScale = 1.0 - k * k * k;
  // 本體與腳維持原樣,不做形變。
  float bodyK = 1.0;
  float tailK = 1.0;

  // 黏性:斷開前被頸子拉著、沿發射軸扯長;斷開後表面張力收回球形,會收過頭,
  // 所以疊上同一個彈簧的振盪。
  float stretch = (1.0 - smoothstep(0.04, RESEARCH_NECK_END, t)) * 0.55 + ring * 0.34;

  // 對答。拍點寫在全域相位上,兩顆才交錯得開;幅度刻意很小,大了就變成卡通。
  float chat = researchChatPulse(phase, chatAt)
    + researchChatPulse(phase, chatAt + 0.16);

  float scale = size * grow * exitScale * (1.0 + chat * 0.035);
  if (scale < 0.001) return 1e4;

  // 起點是往內縮過的芽位置,不是錨點本身(見 RESEARCH_BUD_INSET)。
  vec3 budStart = anchor * RESEARCH_BUD_INSET;
  vec3 center = mix(budStart, target, travel);
  center += (target - budStart) * ring * 0.10;

  // 漂浮。脫離之後才有意義,退場開始後跟著 sink 收掉 —— 動作停下來本身就是
  // 「要結束了」的訊號,不需要另外強調。
  float orbit = t * TAU;
  center += vec3(cos(orbit + angle), sin(orbit + angle), sin(orbit * 0.7 + angle))
    * vec3(0.020, 0.017, 0.015) * travel;
  // 說話時朝對方傾一點。兩顆落點在 x 上左右對稱,「對方」就是 -x 方向。
  center.x -= sign(target.x) * chat * 0.022;

  // 拖曳。腳是重的部分,加速時應該落後於本體 —— 少了這個,整顆是剛體平移,
  // 一眼就看得出是程式在跑參數而不是動畫。
  //
  // 用整顆傾斜來表達,而不是單獨位移腳:angle 會一起轉動本體與腳,一個純量就
  // 做到了,而且傾斜本身也是動畫裡表達加速的標準手法。速度取 travel 那條
  // smoothstep 的解析導數。
  float tu = clamp((t - 0.09) / 0.31, 0.0, 1.0);
  float travelVel = 6.0 * tu * (1.0 - tu) / 0.31;
  float lead = angle - travelVel * 0.025 * sign(target.x - budStart.x);

  // 把 icon 收在外殼裡。半徑取 uDrops[0].w(CPU 每幀寫入的實際半徑,已含呼吸與
  // 形變),再扣掉外殼起伏與 icon 自身半徑。夾制是軟的:75% 以內完全自由,之後
  // 平滑漸近極限,接點兩側斜率都是 1。硬 clamp 會在同時拉大「大小」與「間距」時
  // 突然頂死,看起來像滑桿壞了。
  // 最大半徑是 x 軸,會被「本體扁度」拉寬,夾制得跟著走,不然拉寬之後會穿出殼外。
  float iconReach = 0.180 * clamp(uResearchIconAspect, 1.0, 2.2) * scale;
  float wallLimit = max(uDrops[0].w - abs(uResearchShellAmount) - iconReach, 0.02);
  float cr = length(center);
  float freeR = wallLimit * 0.75;
  if (cr > freeR) {
    float soft = freeR + (wallLimit - freeR)
      * (1.0 - exp(-(cr - freeR) / max(wallLimit - freeR, 0.0001)));
    center *= soft / max(cr, 0.0001);
  }

  float d = researchIconOne(p, center, scale, lead, tailX, stretch, bodyK, tailK);
  vec3 foot = center + vec3(tailX * 0.148, -0.208, 0.0) * scale;

  // 衛星水滴:液柱夾斷幾乎必定在斷點留下一顆小珠子,再被兩端吸收。
  float satAge = t - RESEARCH_NECK_END;
  if (satAge > 0.0) {
    float k = satAge / RESEARCH_SAT_LIFE;
    // 1 - k*k 收得先慢後快;前面那段極短的長入是為了不讓它在一幀之內從無變成
    // 滿尺寸 —— 實測那一下是看得見的彈出。
    float satR = RESEARCH_SAT_R * (1.0 - k * k) * smoothstep(0.0, 0.06, k);
    if (satR > RESEARCH_MIN_FEATURE) {
      vec3 satPos = mix(mix(anchor, foot, 0.45), anchor, smoothstep(0.0, 1.0, k));
      d = min(d, length(p - satPos) - satR);
    }
  }

  // 頸子:從腳尖拉回 anchor。半徑跟著芽一起長,比例才不會退化成畸形圓錐
  // (見 researchRoundCone 裡 a2 <= 0 的說明)。細過安全下限就整段不畫。
  const float NECK_SAFE_R = 0.014;
  float nr = 0.075 * neck * min(1.0, scale / 0.35);
  if (nr >= NECK_SAFE_R) {
    float neckD = researchRoundCone(p, foot, anchor, nr, max(nr * 0.55, NECK_SAFE_R * 0.4));
    d = researchSmin(d, neckD, max(0.055 * neck, NECK_SAFE_R * 0.3));
  }
  return d;
}

// 內部氣泡。參考照片裡的水球內部總有幾顆大小不一的泡泡 —— 有了它們,球體
// 內部才是「一坨有體積的液體」而不是一層空殼包著兩顆 icon。
//
// 泡泡直接併進 researchIconMap 的距離場,而不是另外拉一條追蹤:併進去之後,
// 折射整條路徑完全走 icon 那一套(同一個相對折射率 researchIconRelIOR、同一段
// 內部光程吸收、同一份色散加成),不必複製一份渲染流程,也保證泡泡與 icon
// 看起來就是同一種玻璃 —— 那正是「折射率跟 icon 共用」該有的實作方式。
// 顆數的編譯上限。實際畫幾顆由「氣泡數量」滑桿決定(uResearchBubbleCount),
// 這個常數只是迴圈的靜態邊界 —— GLSL ES 1.0 的迴圈上界必須是常數,不能直接
// 拿 uniform 當上界。
//
// 執行期成本跟著滑桿走(迴圈到顆數就 break),不跟著這個上限走;上限影響的是
// 編譯:編譯器會把這圈展開成 40 份,shader 變長、cold compile 變慢。40 是使用者
// 要的上限,不是可以隨手再加大的數字 —— 真要再往上加,先量一次編譯時間。
#define RESEARCH_BUBBLE_MAX 40

// 每顆泡泡的四個亂數。用無理數倍數取小數(低差異序列)而不是 hash11 的 sin:
// 這支函式每次距離場求值都要跑「目前顆數」次,而距離場一幀被呼叫上百萬次,
// 省下的 sin 是實打實的;低差異序列的分佈也比雜湊均勻,泡泡不結團。
//
// 資料只跟 index 有關,所以「數量」滑桿是純粹的增減:已經在場上的泡泡不會因為
// 多加一顆就整批換位置,只會在尾端多長一顆出來。
vec4 researchBubbleRand(float i){
  return fract(vec4(0.7548777, 0.5698403, 0.8191725, 0.3819660) * (i + 1.0));
}

float researchBubbleMap(vec3 p, float phase){
  if (uResearchBubbles < 0.5) return 1e4;
  // 外殼的實際半徑(CPU 每幀寫入,已含呼吸與形變)。泡泡的位置與大小全部以它
  // 為單位,外殼脹縮時泡泡跟著被帶動,而不是釘死在世界座標上。
  float shellR = max(uDrops[0].w, 0.05);
  float count = max(uResearchBubbleCount, 0.0);
  if (count < 0.5) return 1e4;
  float d = 1e4;
  for (int i = 0; i < RESEARCH_BUBBLE_MAX; i++) {
    // 迴圈上界是編譯期常數,真正的顆數在這裡收 —— 滑桿調低時後面那幾圈整個
    // 跳過,不是照跑完再把結果丟掉。
    if (float(i) >= count) break;
    vec4 rnd = researchBubbleRand(float(i));
    // 方向:cos(theta) 均勻取樣才會在球面上均勻分佈,直接對 theta 取樣會擠在兩極。
    float cy = rnd.x * 2.0 - 1.0;
    float sy = sqrt(max(1.0 - cy * cy, 0.0));
    float az = rnd.y * TAU;
    vec3 dir = vec3(sy * cos(az), cy, sy * sin(az));
    // 半徑用 rnd.w 的平方分佈:小泡泡多、大泡泡少,跟參考照片一致。
    // 兩根滑桿定義範圍,rnd.w 的平方分佈讓小泡泡多、大泡泡少。上限被拉到比
    // 下限小的時候取兩者較大值,而不是讓 mix 反轉 —— 反轉本身看不出來,只會
    // 讓「最大」那根滑桿的行為變得無法解釋。
    float rMin = max(uResearchBubbleMin, 0.0);
    float rMax = max(uResearchBubbleMax, rMin);
    float radius = mix(rMin, rMax, rnd.w * rnd.w) * shellR;
    // 出生時刻落在兩顆 icon 的出生之間,各自再錯開一點 —— 全部同時彈出來會
    // 讀成一次事件,錯開才像液體裡陸續冒出來的氣泡。
    float birth = mix(RESEARCH_BIRTH_A, uResearchIconBirthStagger, rnd.z) + rnd.x * 0.05;
    float t = fract(phase - birth);
    // 生成就是縮放:長進來、整圈停留、末段收乾。收乾的時刻正好接回自己的下一次
    // 出生,所以循環的接縫上沒有任何跳變(跟 icon 的生命週期同一套作法)。
    float scale = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.88, 1.0, t));
    float r = radius * scale;
    // 太小的球中央差分會取到球外面,算出來的是噪音法線而不是梯度 —— 這條線
    // 在這個檔案裡已經付過幾次學費(見 RESEARCH_MIN_FEATURE)。
    if (r < RESEARCH_MIN_FEATURE) continue;
    // 落點留在外圈:中間是兩顆 icon 的活動範圍,泡泡擠進去只會互相干擾,而
    // 參考照片裡的泡泡本來也都靠近球的邊緣。limit 是「不穿出殼外」的上界,
    // 已扣掉外殼起伏的振幅與泡泡自身半徑。
    float limit = max(shellR - abs(uResearchShellAmount) - r, 0.02);
    vec3 center = dir * (mix(0.72, 0.97, rnd.z) * limit);
    // 晃動:跟著外殼輕輕搖。相位用整數諧波(1 圈與 2 圈),循環邊界精確接回;
    // 幅度只有殼半徑的百分之幾,讀起來是「浮在液體裡」而不是「在飛」。
    float a = phase * TAU;
    center += vec3(
      sin(a + rnd.y * TAU),
      sin(a * 2.0 + rnd.z * TAU),
      cos(a + rnd.w * TAU)
    ) * 0.022 * shellR;
    float cr = length(center);
    if (cr > limit) center *= limit / cr;
    d = min(d, length(p - center) - r);
  }
  return d;
}

float researchIconMap(vec3 p){
  // 整體位移只作用在 icon、誕生漣漪與伴隨泡泡，不綁定第二外殼的融合時刻。
  // fract 讓正負位移都保持無縫循環；正值代表視覺事件延後。
  float phase = fract(uTime / max(uLoopDuration, 0.001) - uResearchIconPhaseOffset);
  // A 在右、小顆,腳往右下;B 在左、大顆,腳往左下 —— 兩隻腳方向相反。
  // anchor 落在外殼內壁偏下的位置,與腳同一側,芽才會從腳的方向長出來。
  // 兩顆的時間差由面板控制；預設 B 在 0.14 才開始自己的生命週期。
  // 落點由「間距」與「高度錯位」對稱決定。z 保留原本的小幅前後差，讓兩顆不完全
  // 共平面——那點深度差在折射下看得出來，但不值得再開一根滑桿。
  float spread = uResearchIconSpread;
  float stagger = uResearchIconStagger;
  float depth = uResearchIconDepth;
  // 對答的拍點寫在全域相位上:A 先開口(0.44),B 回應(0.52),各自的第二拍
  // 在自己的第一拍之後 0.16。四拍剛好落在兩顆都已就位、還沒開始退場的區間。
  // 區域時間用 fract 繞圈:生命週期填滿整個循環,不再有「還沒出生／已經死了」
  // 這種狀態,兩顆一前一後永遠都在場(見 RESEARCH_LIFE 上方的說明)。
  //
  // 對答拍點落在兩顆都已就位、都還沒開始退場的區間(A 停留 0.26–0.76,
  // B 停留 0.40–0.90,交集 0.40–0.76)。exitEarly 讓兩顆的消融長度差一點,
  // 眼睛才抓不到規律。
  float a = researchIconStage(
    p, phase, fract(phase - RESEARCH_BIRTH_A),
    researchAnchor(1.0), vec3(spread, stagger, depth),
    max(uResearchIconSizeA, 0.2), 1.0, 0.10, 0.46, 0.0
  );
  float b = researchIconStage(
    p, phase, fract(phase - uResearchIconBirthStagger),
    researchAnchor(-1.0), vec3(-spread, -stagger, -depth),
    max(uResearchIconSizeB, 0.2), -1.0, -0.16, 0.54, 0.02
  );
  // 用 smin 而不是 min。間距可調之後兩顆就可能被推到相鄰，而 min 在交界會留下
  // 梯度硬折——硬折在折射玻璃裡會被放大成一條亮線（同 RESEARCH_SIDE_SOFT 那段）。
  // 融合半徑取小：離得遠時與 min 沒有可見差異，靠近時才自然拉出液體的頸子。
  float icons = researchSmin(a, b, 0.03);
  // 泡泡用更小的融合半徑併進來:它們不該跟 icon 黏成一坨(那是兩種東西),
  // 但也不能用 min —— 剛好擦過 icon 的那條交界會是梯度硬折,在折射玻璃裡
  // 就是一條亮線(同上)。0.012 只夠把交界抹成一圈細圓角。
  return researchSmin(icons, researchBubbleMap(p, phase), 0.012);
}

vec3 researchIconNormal(vec3 p){
  const float h = 0.0018;
  return normalize(vec3(
    researchIconMap(p + vec3(h, 0, 0)) - researchIconMap(p - vec3(h, 0, 0)),
    researchIconMap(p + vec3(0, h, 0)) - researchIconMap(p - vec3(0, h, 0)),
    researchIconMap(p + vec3(0, 0, h)) - researchIconMap(p - vec3(0, 0, h))
  ));
}

// 從 icon 內部往前走到另一側表面。與外殼的 traceExitSurface 同構,只是距離場
// 換成 researchIconMap,出口法線用 researchIconNormal 的 6 tap 而不是 calcNormal
// 的 10 tap —— icon 的距離場比 mapScene 便宜很多,沒必要共用那支。
void researchTraceIconExit(vec3 ro, vec3 rd, out vec3 exitPoint, out float pathLength){
  // 步進地板從 0.0025 提到 0.006、步數從 24 提到 32。
  //
  // 從內部做 sphere tracing 有個陷阱:步進係數 0.70 小於 1,只會幾何逼近出口
  // 表面、永遠不會真的跨過去,真正讓 d 轉正的是那個地板。所以「最壞情況能走
  // 多遠」= 步數 × 地板 —— 舊值是 24 × 0.0025 = 0.06,而大顆 icon 光是本體
  // 直徑就有 0.43。穿過中心的射線靠幾何成長 7 步就出去了,但接近切線的射線
  // |d| 一路都很小,整段都在吃地板,走到 0.06 就用完預算。那些正是輪廓附近、
  // 以及沿著被壓扁的 z 軸(半徑只有 0.12)進來的射線,佔比並不低。
  //
  // 新值保證覆蓋 32 × 0.006 = 0.19,配上中段的幾何成長,實際遠超過 icon 尺寸。
  // 地板 0.006 仍遠小於最細的特徵(頸子已由 NECK_SAFE_R 保證至少 0.014),不會
  // 跨過任何畫得出來的東西。
  float t = 0.004;
  for (int i = 0; i < 32; i++) {
    exitPoint = ro + rd * t;
    float d = researchIconMap(exitPoint);
    if (d > 0.0) { pathLength = t; return; }
    // 在內部 d 是負的,-d 才是到表面的下界。
    t += max(-d * 0.70, 0.006);
    if (t > 1.2) break;
  }
  // 走不完也不回報失敗。呼叫端原本是用一個 bool 去二選一法線,而「這條射線
  // 走得完嗎」剛好是內部光程的等值線函數 —— 通過/失敗的邊界沿著等光程輪廓
  // 走,於是螢幕上長出一圈一圈的同心紋路,位置隨動畫飄移。
  //
  // 這裡改成永遠回傳「最後走到的那一點」:它是射線的連續函數,所以在它上面
  // 取的法線也是連續的,不論追蹤有沒有真的抵達表面。寧可讓極少數射線拿到
  // 稍微不精確的法線,也不要留一個會沿等值線炸開的二元切換。
  pathLength = t;
}

bool researchTraceIcon(vec3 ro, vec3 rd, float maxDistance, out vec3 hitPoint){
  float t = 0.006;
  // 步數從 28 提到 40：下面的步進係數為了 smin 的頸部調得比較保守，同樣的步數
  // 走不完整條弦，遠端那顆 icon 會整個消失。
  for (int i = 0; i < 40; i++) {
    hitPoint = ro + rd * t;
    float d = researchIconMap(hitPoint);
    if (d < 0.0012) return true;
    // smin 併集不再是嚴格 Lipschitz(頸部附近會低估距離),步長係數比一般
    // sphere tracing 保守,否則兩顆球中間那條頸子會被跨過去、出現破洞。
    //
    // 地板從 0.0012 提到 0.0025:掠射過 icon 輪廓的射線 d 一路很小、整段都在
    // 吃地板,40 步只走得了 0.048,還沒穿過水滴就用完預算而漏打,在輪廓邊緣
    // 留下沿等值線分布的破洞。頸子的粗細已由 NECK_SAFE_R 保證至少 0.014,
    // 是新地板的 5.6 倍,不會被跨過去。
    t += max(d * 0.58, 0.0025);
    if (t > maxDistance) break;
  }
  return false;
}
#endif

#ifdef FEATURE_TYPEWRITER
// 每格字的資料貼圖寬度，必須跟 glyph-field.js 的 MAX_TYPE_GLYPHS 一致。
#define TYPE_MAX 24.0

// 從字形圖集取一格的距離。
//
// 收半個 texel 是必要的：圖集是規則網格，硬體雙線性在格緣會跨到隔壁那個字，
// 於是每個字的邊上都會浮出鄰居的殘影。SVG 路徑不必處理這件事（只有一張圖），
// 這是圖集特有的問題。
float typeAtlasSample(float idx, vec2 tileUV){
  float cols = uTypeAtlasInfo.x;
  float tile = uTypeAtlasInfo.z;
  float col = mod(idx, cols);
  float row = floor(idx / cols);
  vec2 inset = clamp(tileUV, vec2(0.5 / tile), vec2(1.0 - 0.5 / tile));
  vec2 uv = (vec2(col, row) + inset) / vec2(cols, uTypeAtlasInfo.y);
  return (texture2D(uTypeAtlas, uv).r - 0.5) * 2.0 * uTypeAtlasInfo.w;
}

// 圖集版的三次 B-spline 取樣，理由跟 shape-field 那邊的 sampleShapeField 完全一樣
// （見那邊的說明）：硬體雙線性只有 C0 連續，梯度在每條 texel 邊界跳一次，法線
// 因此會沿著曲線一格一格地跳——這正是使用者截圖裡那圈「格狀」的來源，字放大到
// 接近圖集烘焙解析度（拉丁 64²、中文 144²）時特別明顯，肉眼看起來像低面數模型的
// 平面拼接，不是單純的鋸齒。三次 B-spline 梯度連續，用 4 次雙線性取樣合成 16
// taps 的權重（Sigg & Hadwiger 的快速三階濾波）。
//
// 跟 sampleShapeField 的差別只在於這裡是圖集：取樣範圍要夾在單一格自己的版面內，
// 不能跨到隔壁字。每格四周本來就留了約 19% 的透明 padding（見 glyph-field.js 的
// EM_RATIO），bicubic 最多探出 1.5 texel，遠小於這圈 padding，只要先把 tileUV
// 夾回格子本體（跟上面 typeAtlasSample 同一招），taps 就不會越界到鄰居格。
float typeAtlasSampleSmooth(float idx, vec2 tileUV){
  float cols = uTypeAtlasInfo.x;
  float rows = uTypeAtlasInfo.y;
  float tile = uTypeAtlasInfo.z;
  float col = mod(idx, cols);
  float row = floor(idx / cols);
  vec2 origin = vec2(col, row) * tile;
  vec2 atlasSize = vec2(cols, rows) * tile;

  vec2 inset = clamp(tileUV, vec2(0.5 / tile), vec2(1.0 - 0.5 / tile));
  vec2 coord = inset * tile - 0.5;
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
  vec2 t0 = base + 0.5 + w1 / s0 - 1.0;
  vec2 t1 = base + 0.5 + w3 / s1 + 1.0;
  vec2 uv0 = (origin + t0) / atlasSize;
  vec2 uv1 = (origin + t1) / atlasSize;
  float a = texture2D(uTypeAtlas, vec2(uv0.x, uv0.y)).r;
  float b = texture2D(uTypeAtlas, vec2(uv1.x, uv0.y)).r;
  float c = texture2D(uTypeAtlas, vec2(uv0.x, uv1.y)).r;
  float d = texture2D(uTypeAtlas, vec2(uv1.x, uv1.y)).r;
  float raw = mix(mix(a, b, s1.x), mix(c, d, s1.x), s1.y);
  return (raw - 0.5) * 2.0 * uTypeAtlasInfo.w;
}

// 單一格字的 2D 距離（還沒擠出）。slot 是它在行內的位置。smoothShape 沿用
// svgShapeDistance 的同一個省成本手法：raymarch 步進只需要保守的距離值，次
// texel 的差異不影響收斂，所以步進迴圈仍用便宜的單次雙線性；只有 calcNormal
// 求梯度（法線）時才切到 16-tap 的三次 B-spline，讓「格狀」只在真正決定明暗的
// 那一步被磨平，不必每個 march step 都多付 4 倍取樣成本。
float typeGlyphEdge(vec2 xy, float slot, float count, bool smoothShape){
  vec4 g = texture2D(uTypeGlyphData, vec2((slot + 0.5) / TYPE_MAX, 0.5));
  float reveal = clamp(g.y, 0.0, 1.0);
  // 完全還沒出現的格子直接跳過。這不只是省成本：reveal→0 時下面的除法會炸。
  if (reveal < 0.004) return 1e9;
  float size = max(uTypeLine.y, 0.001);
  float adv = uTypeLine.x * size;
  // 行置中：slot 0 在最左。count 是 uTypeLine.w，語意是「這句話的總長」（見
  // bubble.js 的 anchorLen），不是目前打出來的字數——用可見字數置中的話，每打一個
  // 字整行的中心點都會跟著移動，兩三個字的短句尤其明顯，看起來是整行在抖而不是
  // 在長。固定用總長置中，字只會往兩側長出、不會重新置中。
  float cx = (slot - (count - 1.0) * 0.5) * adv;

  // 取樣一律用「真實比例」的字形——這是這一版最關鍵的修正。第一版在這裡對 x/y
  // 做不等比縮放（寬度先鼓、高度從基線壓扁再長開），問題是 SDF 一旦被非等比縮放，
  // 保留下來的只有「零等值面」（輪廓本身還在正確位置），中間的距離場整個扭曲，
  // 而擠出用的是這個扭曲後的距離值。壓得越扁，扭曲越嚴重——實測預設參數下
  // 「P」被壓扁到某個中間畫面時，看起來完全是另一個字「F」；「D」看起來像「7」。
  // 這不是筆畫模糊或崩裂，是形狀本身在動畫過程中真的變成了別的字，比崩裂更糟：
  // 崩裂還看得出「這裡出問題了」，長成別的字看起來像打錯字。
  //
  // 換掉整套機制：字形本身永遠用真實比例取樣（不擠壓），液態長出改成「一道從基線
  // 往上升的截平面」跟真實形狀做 SDF 交集——液面以下的部分完整可見，液面以上的
  // 部分被切掉。這跟液體真的從容器底部往上填是同一件事，字的比例全程不變，改變的
  // 只有「填到多高」，所以不會有任何一幀看起來像別的字。
  float baselineWorld = uTypeLine.z * size;
  vec2 tileUV = (xy - vec2(cx, baselineWorld)) / size + 0.5;
  vec2 safeUV = clamp(tileUV, vec2(0.0), vec2(1.0));
  float raw = smoothShape ? typeAtlasSampleSmooth(g.x, safeUV) : typeAtlasSample(g.x, safeUV);
  float d = raw * size;
  // 取樣盒外：延續盒緣的正距離，再加上「離開盒子」那一段，讓盒外的步長不會被
  // 壓得太小。手法跟 svgShapeDistance 的 3×3 取樣盒一致。
  vec2 boxHalf = vec2(0.5 * size);
  vec2 over = abs(xy - vec2(cx, baselineWorld)) - boxHalf;
  d += length(max(over, vec2(0.0)));

  // 邊緣液化。跟其他模式那根「邊緣液化」（uShapeSoftness，見 sampleShapeField
  // 結尾的 result - uShapeSoftness）是同一件事、同一個單位：把距離場整體外推，
  // 等值面往外跑，筆畫因此變粗，靠得近的筆畫會先熔在一起——液體在表面張力下
  // 該有的樣子。常數位移不改變梯度，距離場仍然合法，raymarch 不需要任何保護。
  //
  // 套在盒外延續項之後：先讓盒外是連續的正距離，再一起外推，否則盒緣會被推成
  // 一圈矩形實體（uShapeSoftness 當年就踩過這個，見 sampleShapeField 的註解）。
  //
  // 位置在液面交集之前：只把「字」變粗，不動「液態長出」的液面高度。
  d -= uTypeSoftness;

  float grow = clamp(uTypeShape.z, 0.0, 1.0);
  // 液面高度：從略低於基線（蓋住多數字母的下伸部）長到蓋過整格上緣（安全地蓋過
  // 大寫字母與筆畫最高點）。grow 是總開關：0 時液面直接鎖在最高，字元一出現就是
  // 完整形狀（對應 DOM 原型 c.current++ 那種瞬間出現）；1 時液面確實跟著 reveal
  // 從底往上升滿整格。
  float fillTop = baselineWorld + size * 0.5;
  float fillStart = baselineWorld - size * 0.3;
  float fillLevel = mix(fillTop, mix(fillStart, fillTop, reveal), grow);
  // 液面本身留一點鼓起（表面張力的視覺痕跡），而不是一刀切的平面——半徑跟其他
  // 液態表面用的量級一致，太大會看起來像整個字泡在圓角裡。
  float meniscus = 0.035 * size;
  float wipe = xy.y - fillLevel;
  // SDF 交集（-smin(-a,-b,k) 是 smooth-max，兩場都要滿足才算在形狀內）：字形
  // 與液面以下同時成立的地方才是實體，液面以上一律被切掉，不管字形本身怎麼說。
  return -smin(-d, -wipe, meniscus);
}

float typewriterDistance(vec3 p, bool smoothShape){
  // 這句話的總長（固定），不是目前打出來的字數——見 typeGlyphEdge 的 cx 註解。
  // 還沒出現的格子 reveal 已在 CPU 端清成 0，typeGlyphEdge 自己會跳過，所以拿
  // 總長當迴圈上限並不會多畫出還沒打的字，只是讓置中基準穩定。
  float count = uTypeLine.w;
  if (count < 0.5) return 1e9;
  float size = max(uTypeLine.y, 0.001);
  float adv = uTypeLine.x * size;
  float x0 = -(count - 1.0) * 0.5 * adv;

  // x 軸切片剔除：字沿 x 等距排列，所以任一點只有最近幾格可能是最小值。
  // 少了這一步，每個 march step 要對 24 格各取一次樣，這個模式就不可能跑。
  //
  // 窗口原本只有 3 格（±1），實測在鏡頭極近＋極斜（貼近字、視角接近側面）時會
  // 讓相鄰字母的側壁在畫面上互相穿插——不是誰被裁掉，是兩個字的厚度疊在一起，
  // 但視覺上讀起來就像某個字缺了一角。用「靜態方體」在同樣的距離／角度下對照
  // 過：單一物體完全乾淨，只有多字並排的這條路徑會壞，證明問題出在這個窗口
  // 太窄，不是 raymarch 精度或字形本身的問題——窄窗口在正面／中距離時夠用，
  // 但視線幾乎貼著字面走時，真正該納入比較的候選格會超出 ±1 的範圍。
  // 放到 ±4（9 格）在同一組重現條件（QU、字級 2、鏡頭距離 2.8～5、水平視角
  // -45°）下測過，乾淨。9 格對每個 march step 是三倍的取樣成本，但這個模式的
  // 內層迴圈本來就遠低於其他模式的上限（見診斷面板「內層實際跑幾次」），有
  // 餘裕撐得住。
  float k = floor((p.x - x0) / adv + 0.5);
  float edge = 1e9;
  for (int j = -4; j <= 4; j++) {
    float slot = k + float(j);
    if (slot < -0.5 || slot > count - 0.5) continue;
    edge = min(edge, typeGlyphEdge(p.xy, slot, count, smoothShape));
  }

  // 擠出。與 svgShapeDistance 同一個作法：smooth-max 只圓化正面與側壁的交界，
  // 半徑由獨立的圓角參數控制。
  //
  // 圓角／厚度要不要夾在字形特徵尺度（烘焙時量到的最細筆畫半厚）之下，只在
  // 圓角／擠出厚度直接使用使用者設定的原始值，不做 CJK 特徵尺度夾制——
  // 中文筆畫較密時數值調太高確實可能黏成一團或side wall碎裂，但那是使用者
  // 自行拉滑桿要承擔的取捨，不由程式自動夾住。
  float bevel = max(uTypeShape.y, 0.0001);
  float depth = abs(p.z) - max(uTypeShape.x, 0.0001);
  float d3 = edge > 1e8 ? 1e9 : -smin(-edge, -depth, bevel);

  // 游標。DOM 版是一個閃爍的 .caret span；這裡是行尾的一根液柱，閃爍相位鎖在
  // 循環上（見 bubble.js），所以循環接回去時不會跳。
  //
  // 厚度跟字形分開算，不是併進上面同一個 edge 再共用一次擠出——共用的話游標的
  // 「厚度」只能等於字的擠出厚度，使用者要能把兩者錯開調，游標就得有自己的
  // depth 通道，各自 smin 擠出後再取 min 合併成最終的 3D 距離場。圓角沿用同一個
  // bevel：兩個都是液態表面，共用圓角手感一致，也少一根滑桿。
  if (uTypeCaret.w > 0.5 && uTypeCaret.z > 0.001) {
    vec2 halfExtent = vec2(uTypeCaret.z, size * 0.36);
    vec2 q = abs(p.xy - uTypeCaret.xy) - halfExtent + vec2(size * 0.05);
    float caret = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - size * 0.05;
    float caretDepth = abs(p.z) - max(uTypeCaretDepth, 0.0001);
    d3 = min(d3, -smin(-caret, -caretDepth, bevel));
  }

  return d3;
}
#endif // FEATURE_TYPEWRITER

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
// 分裂 pinch-off 的彈性回彈波紋。只有 P.motion === 'split' 會把 elasticEvent 設成
// 非零（見 bubble.js：其餘所有模式走 else 分支 elasticEvent.set(0, 0)），所以
// 非分裂模式下這整段的 runtime 條件恆為 false —— 編譯期拿掉是行為等價的。
#ifdef FEATURE_CAPILLARY_WAVE
    int pairA = int(uElasticPair.x + 0.5);
    int pairB = int(uElasticPair.y + 0.5);
    // 僅在事件期間、活動配對且接近表面時付出波紋成本。
    if (uElasticEvent.x > 0.0001 && (i == pairA || i == pairB) && abs(sphereD) < 0.3) {
      sphereD -= capillaryWave(p, i);
    }
#endif // FEATURE_CAPILLARY_WAVE
    // 每滴融合權重只在分裂模式的子滴出生／吸收尾端低於 1；其餘模式固定為 1。
    // 讓 k 與子滴半徑一起平滑歸零，才能連續接上上方的零半徑守衛。
    float dropBlend = mainBlend * clamp(uDropPhysics[i].w, 0.0, 1.0);
    d = smin(d, sphereD, dropBlend);
    if (needsArrivalDistance) {
      vec3 arrivalDelta = p - uDrops[i].xyz;
      arrivalDistanceSq = min(arrivalDistanceSq, dot(arrivalDelta, arrivalDelta));
    }
  }
#ifdef FEATURE_RESEARCH
  if (uCount > 0) d -= researchShellOffset(p);
#endif
// 打字模式的字就是玻璃本體（不是球裡的內容物），所以直接聯集進 d，法線與第二
// 表面因此自動走既有的 calcNormal／traceExitSurface，折射與色散一併作用在字上。
// 用 min 而不是 smin：預設沒有主滴（count 0），而使用者若把主滴拉出來，那些水滴
// 的身分是繞著行走的墨滴，不該跟字融成一團。
#ifdef FEATURE_TYPEWRITER
  d = min(d, typewriterDistance(p, smoothShape));
#endif
  // 衛星滴以「會釋放的 smin」與頸部相連：成形期 blend 高（細絲上的鼓包），
  // 掐斷時 blend→0，smin 退化為硬 min → 成為自由滴。
  //
  // 衛星滴串只在分裂的 pinch-off 產生：bubble.js 只有 P.motion === 'split' 那個分支
  // 會寫入 satelliteDrops，其餘模式一律 satelliteDrops[s].w = 0 且 uSatelliteBlend = 0。
  // 所以非分裂模式下 uSatellites[s].w > 0.001 恆為 false。
#ifdef FEATURE_SATELLITES
  for (int s = 0; s < 3; s++) {
    if (uSatellites[s].w > 0.001) {
      d = smin(d, length(p - uSatellites[s].xyz) - uSatellites[s].w, uSatelliteBlend);
    }
  }
#endif
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
// 負形（空腔）場。它是「造型的一部分」，不是水滴的一部分：negativeFormationAnchors
// 只在 rebuildShapeAAnchors() 裡由 shapeCavityBase 產生，而那需要匯入的造型；沒有造型時
// shapeTargetsBase 是空的、rebuildShapeAAnchors 直接 return，anchors 永遠是 []，
// updateNegativeDrops 回傳 0 且所有半徑為 0。所以無造型模式下這整段恆為 no-op。
// 附帶效益：這是 mapScene 裡唯一的 texture2D 取樣。
#ifdef FEATURE_NEGATIVE_FIELD
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
#endif // FEATURE_NEGATIVE_FIELD
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
    // 形狀 B 走自己的那一組剛體變換（形狀變形模式的「形狀 B（第二組）」）。
    // 兩個通道本來就各自取樣一次，這裡只是餵進不同的座標，不是多取樣一次。
    // 其餘模式 CPU 端把第二組寫成跟第一組相同的值，等價於共用一份。
    vec3 rigid2P = p - uShapeRigid2Offset;
    vec3 unrotated2P = rigid2P * uShapeRigid2Rot;
    vec3 shape2P = (unrotated2P / uShapeRigid2Scale) / uShapeScale;
    // 形狀 A/B 各自的獨立倍率再疊一層，跟 uShapeScale 是同一種均勻縮放，只是
    // 分開套在各自的通道上。fromCh/toCh 哪個是 A、哪個是 B 由 uShapeMorph 決定
    // （見下方），所以要先分出 A、B 各自的本地座標。
    vec3 shapePA = shapeP / uShapeAScale;
#ifdef FEATURE_SHAPE_MORPH
    vec3 shapePB = shape2P / uShapeBScale;
#endif
    float detailD;
// ===== 兩顆形狀交接（形狀變形）的編譯期特化 =====
//
// uShapeMorph 只有形狀變形模式會設成非 0（見 bubble.js 的 morphSolid：其餘模式一律
// uShapeMorph = 0），所以其他模式下這整條分支的 runtime 條件恆為 false。
//
// 它是造型場裡最貴的一塊：兩顆形狀各求一次造型距離（＝兩份 shapeDistance），再加
// 一次 dissolveField。拿掉之後 mapScene 裡的造型距離場從 3 份降到 1 份，而每一份都
// 要跟著 mapScene 的攤平份數一起乘。
//
// 形狀變形模式本身兩條都要編：雙通道貼圖還沒備妥時 morphSolid 是 false、
// uShapeMorph 是 0，那時走的是下面的單形狀路徑。
#ifdef FEATURE_SHAPE_MORPH
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
        ? shapeDistance(shapePFrom, smoothShape, fromCh) * uShapeScale * scaleFrom
        : 1e6;
      float dTo = uMorphActive.y > 0.5
        ? shapeDistance(shapePTo, smoothShape, toCh) * uShapeScale * scaleTo
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
    } else
#endif // FEATURE_SHAPE_MORPH
    {
      // 非 morph 情境下場上只有形狀 A（通道 0）。
      detailD = shapeDistance(shapePA, smoothShape, 0) * uShapeScale * uShapeAScale;
      // 形狀匯聚的成型波前：跟上面那組消失波前共用同一個 dissolveField、同一組
      // 擾動與收頸 uniform，差別只有兩點——只有一道波前（沒有第二顆形狀要交接），
      // 而且方向相反：morph 保留波前「之後」的舊形狀，這裡保留波前「之前」掃過
      // 的區域，也就是掃到哪裡才長到哪裡。
// 成型波前只有形狀匯聚會用：uFormationCut 是 isFormationMotion(motion) && shapeField
// && P.formationFrontOn 才會被設成 1（見 bubble.js 的 updateDropUniforms），其餘造型
// 模式恆為 0。裡面的 dissolveField 含一個 3x3 Voronoi 迴圈，是跟著 mapScene 攤平
// 份數一起乘的，所以其他模式不編它省下來的量很可觀。
#ifdef FEATURE_FORMATION_CUT
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
#endif // FEATURE_FORMATION_CUT
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
    // 註：靜態模式選內建幾何時根本不會編譯到這一段——variantState 的 shapeField
    // 已經把那種情況排除掉了（見 staticUsesImportedShape），FEATURE_SHAPE_FIELD
    // 與 FEATURE_STATIC_SHAPE 因此是互斥的，不必在執行期再判斷一次。
    d = smin(
      d,
      growingDetail,
      max(0.0001, max(0.018, uMicroBlend * localGrowth) * dropletBlendFade)
    );
  }
#endif // FEATURE_SHAPE_FIELD
#ifdef FEATURE_STATIC_SHAPE
  // 無水滴、無造型場：d 在這裡仍是初始的 1e9，程序化 SDF 就是全部的可見表面。
  // uStaticShape == 7（匯入）不會走到這裡——那個值讓 variantState 不編這段
  // FEATURE_STATIC_SHAPE（見 bubble.js 的 staticShape 判斷），交給上面的
  // 形狀場處理。
  {
    float shapeD;
    if (uStaticShape == 0) {
      float boxHalf = max(uBoxSize, 0.05);
      float boxCorner = clamp(uBoxCornerRadius, 0.0, boxHalf * 0.98);
      shapeD = sdRoundBox(p, vec3(boxHalf), boxCorner);
    } else if (uStaticShape == 1) {
      // 平面：極扁的方體，厚度固定抓尺寸的一小部分，不需要另外開一個滑桿。
      // 註：不能叫 half——GLSL ES 保留給未來的半精度型別，拿來當識別字會編譯失敗。
      float halfSize = max(uPrimitiveSize, 0.05);
      shapeD = sdRoundBox(p, vec3(halfSize, halfSize * 0.06, halfSize), 0.0);
    } else if (uStaticShape == 2) {
      // 圓盤：極扁的圓柱。
      float r = max(uPrimitiveSize, 0.05);
      shapeD = sdCylinder(p, r, r * 0.06);
    } else if (uStaticShape == 3) {
      shapeD = sdSphere(p, max(uPrimitiveSize, 0.05));
    } else if (uStaticShape == 4) {
      shapeD = sdCylinder(p, max(uPrimitiveSize, 0.05), max(uPrimitiveHeight, 0.05));
    } else if (uStaticShape == 5) {
      shapeD = sdCone(p, max(uPrimitiveSize, 0.05), max(uPrimitiveHeight, 0.05));
    } else {
      // uStaticShape == 6：圓環。管半徑夾在主半徑以內，避免比例拉滿時管子比
      // 環心還粗，SDF 會自交出錯誤形狀。
      float major = max(uPrimitiveSize, 0.05);
      float minor = clamp(uPrimitiveTubeRatio, 0.05, 0.9) * major;
      shapeD = sdTorus(p, major, minor);
    }
#ifdef FEATURE_CAPILLARY
    // 跟毛細波共用的程序紋理，直接套在物體本地座標上（這些幾何沒有形狀場的
    // 縮放／剛體變換要反解，p 本身就是它們的本地座標）。
    shapeD -= capillarySurfaceOffset(p);
#endif
    d = min(d, shapeD);
  }
#endif // FEATURE_STATIC_SHAPE
  // 最大位移遠小於 0.25；遠離表面時略過 noise，不影響射線接近表面的安全性。
  //
  // 診斷探針 C（?diag=probe-no-wobble）只把這一段在編譯期拿掉。
  // 它測的是「同一份 noise 被重複 inline」的代價：mapScene 在造型模式有 6 個靜態
  // 呼叫點（raymarch 迴圈體 1、calcNormal 1、traceExitSurface 2 個呼叫點各帶自己的
  // march 與一份 calcNormal），每個都會把這裡的 fbmFast 展開成 2 份 snoise。
  // probe 階梯已經量到「noise 進 mapScene」是 148ms → 600ms 那一跳的來源，這一刀
  // 就是同一個機制在正式規模下的代價。
  // 拿掉之後水滴表面會少一層擾動，所以這是探針不是可上線的設定。
#ifndef PROBE_NO_GEOMETRY_WOBBLE
  float geometryWobble = uWobble * mix(1.0, 0.10, uShapeProgress);
  if (geometryWobble > 0.001 && d < 0.25) {
    d += fbmFast(p * uWobbleScale + loopNoiseOffset(uWobbleSpeed)) * geometryWobble * 0.25;
  }
#endif
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
// ===== 法線路徑：兩條路徑共用一個迴圈 =====
//
// 這裡的成本不是「算幾次」而是「編幾份」。原版是兩條展開的路徑：SVG 分軸中央差分
// 6 份 mapScene ＋ 四面體 4 份 ＝ 每個呼叫點 10 份；而 calcNormal 有 3 個呼叫點
// （main 一個、traceExitSurface 兩個），所以 33 份總展開量裡有 30 份出自這裡
// （實測 B1a：把 traceExitSurface 那 20 份拿掉就從 127 秒降到 30 秒）。
//
// 兩條路徑其實是同一個形狀的取樣：
//   法線 = normalize( Σ w_i · mapScene(p + w_i·h_i) / divisor )
// 四面體是 4 個 tap、w_i 是四面體的正負號向量、divisor 為 1；SVG 是 6 個 tap、
// w_i 是 ±單位軸、divisor 是各軸自己的步長。既然形狀一樣，就不需要兩份程式碼 ——
// 收成一個 uniform 守衛的迴圈之後，整個 calcNormal 只剩 1 份 mapScene，三個呼叫點
// 合計 3 份（原版 30 份）。
//
// 這個改寫是逐位元等價的，不是近似：
//   * 四面體：svgPath 為 false 時 w = e、h_i = h、divisor = 1，acc 的累加式與展開式
//     逐字相同，而 acc / vec3(1.0) 在 IEEE754 下就是 acc。
//   * SVG：offset 由 axis*(sgn*h) 改成 (axis*sgn)*h，逐分量都是 ±1/±0 乘上同一個 h，
//     兩種結合順序的結果完全相同（含 ±0 的正負號）；除法仍然留到最後一次做，
//     所以每一軸都還是「(正 tap − 負 tap) / 該軸步長」。
//   * 兩者唯一的差別是多了起始的 0.0 + 與其他軸加上的 ±0.0。那只可能改變零的正負號，
//     而零的正負號經過 normalize 之後對下游沒有可見影響。
// 這個主張是量出來的，不是推論：?diag=probe-unrolled-svg-taps 會編出上面那份展開的
// 兩路徑原版，同一個造型模式、同一個 ?diagTime 下擷取兩次比對，實測全畫面 FNV hash
// 相同、最大通道誤差 0（formation／SVG，1899x1209）。
//
// NORMAL_TAPS_SVG / NORMAL_TAPS_TETRA 由 bubble.js 決定。SVG 模式兩條都要編：
// uShapeProgress 從 0 長到 1，在 0 附近走的是四面體那條，所以「造型此刻是否已經
// 生效」不能拿來當變體條件，否則成形過程中法線會換一條路徑。
#ifdef PROBE_UNROLLED_SVG_TAPS
// 驗證用（?diag=probe-unrolled-svg-taps）：迴圈化之前那份展開的兩路徑原版，逐字保留。
// 它是上面那個等價主張的可重現證據，不是備援 —— 唯一該開它的時候就是重跑那組比對。
// 代價很實在：mapScene 的靜態展開份數會從 3 拉回 24，formation 的 cold compile 實測
// 從 75 秒變成 218 秒。
#ifdef NORMAL_TAPS_SVG
#ifdef NORMAL_TAPS_TETRA
  if (uShapeType == 1 && uShapeProgress > 0.001)
#endif
  {
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
#endif // NORMAL_TAPS_SVG
#ifdef NORMAL_TAPS_TETRA
  {
    float svgH = svgTexel * 1.5;
    float shapeH = uShapeType == 2 ? voxelH * 1.70 : svgH;
    float h = mix(0.0009, shapeH, uShapeProgress);
    // 四面體那條在這一輪之前就已經是迴圈了（見 uNormalTaps 的說明），所以這份
    // 「原版」保留它原本的迴圈形式，只把 SVG 那條還原成展開式 —— 這一輪要驗的
    // 就是 SVG 那條。
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      if (i >= uNormalTaps) break;
      vec3 e = i == 0 ? k.xyy : (i == 1 ? k.yyx : (i == 2 ? k.yxy : k.xxx));
      acc += e * mapScene(p + e * h, true);
    }
    return normalize(acc);
  }
#endif // NORMAL_TAPS_TETRA
#endif // PROBE_UNROLLED_SVG_TAPS

#ifndef PROBE_UNROLLED_SVG_TAPS
  // 這一刻走的是 SVG 分軸差分還是四面體。只留一條路徑的變體裡它是編譯期常數，
  // 下面所有的 svgPath ? A : B 都會被摺掉，等於直接寫死那一條。
#ifdef NORMAL_TAPS_SVG
#ifdef NORMAL_TAPS_TETRA
  bool svgPath = uShapeType == 1 && uShapeProgress > 0.001;
#endif
#ifndef NORMAL_TAPS_TETRA
  bool svgPath = true;
#endif
#endif
#ifndef NORMAL_TAPS_SVG
  bool svgPath = false;
#endif
  // SVG 的兩個步長：XY 跨約 2 texels 平滑輪廓梯度，Z 獨立且更小，才不會跨過
  // 正面／側壁的倒角（見上方那段 texel 說明）。
  float xyH = min(svgTexel * 2.0, max(svgTexel * 0.75, uShapeEdgeBevel * 0.48));
  float zH = min(xyH, max(0.0009, uShapeEdgeBevel * 0.22));
  // 四面體的單一步長：造型成形後跨到造型自己的尺度（體素 1.70 個格距、SVG 1.5 個
  // texel），成形前收回 0.0009 的水滴尺度。
  float svgH = svgTexel * 1.5;
  float shapeH = uShapeType == 2 ? voxelH * 1.70 : svgH;
  float tetraH = mix(0.0009, shapeH, uShapeProgress);
  // trip count 必須對 fxc 未知，迴圈才不會被展開成一份一份的 mapScene ——
  // 這兩顆 uniform 恆為 6 / 4，存在的唯一理由就是這件事（見它們的宣告）。
  int taps = svgPath ? uNormalAxisTaps : uNormalTaps;
  // 分軸差分的除法留到最後一次做，才與展開式的 dx/xyH、dy/xyH、dz/zH 逐位元相同。
  vec3 divisor = svgPath ? vec3(xyH, xyH, zH) : vec3(1.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (i >= taps) break;
    // SVG：i = 0..5 依序是 +x, -x, +y, -y, +z, -z，與展開式的評估順序一致。
    vec3 axis = i < 2
      ? vec3(1.0, 0.0, 0.0)
      : (i < 4 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    float sgn = (i == 0 || i == 2 || i == 4) ? 1.0 : -1.0;
    // 四面體：i = 0..3 的四個正負號向量，與展開式的順序一致。
    vec3 e = i == 0 ? k.xyy : (i == 1 ? k.yyx : (i == 2 ? k.yxy : k.xxx));
    // 權重向量同時當取樣偏移的方向：offset = w * h，累加也是 w * 該 tap 的值。
    vec3 w = svgPath ? axis * sgn : e;
    float h = svgPath ? (i < 4 ? xyH : zH) : tetraH;
    acc += w * mapScene(p + w * h, true);
  }
  return normalize(acc / divisor);
#endif // PROBE_UNROLLED_SVG_TAPS
}

#ifdef PROBE_LEAN_NORMALS
// 出口法線專用的四面體法線（?diag=probe-lean-normals）。
//
// 存在的理由純粹是 inline 展開量。它是在 calcNormal 還是兩條展開路徑（SVG 6 份 ＋
// 四面體 4 份，每個呼叫點 10 份）的時候加的，那時 traceExitSurface 的 2 個呼叫點光
// 自己就貢獻 20 份。calcNormal 收成單一迴圈之後每個呼叫點只剩 1 份，這支 probe 能
// 省下的量因此小很多，留著只是為了跟當時的量測結果對得上。
//
// 這一版只保留四面體那條，h 的算法與 calcNormal 的非 SVG 路徑逐字相同，所以在
// 非 SVG 造型上結果應該一致；差別只出現在 SVG 造型的出口法線上 —— 那裡會少掉
// 倒角感知的分軸差分。出口法線只餵背面 Fresnel、出射折射方向與背面薄膜，
// 正面輪廓完全不經過它，所以這是這次要用畫面 A/B 驗證的取捨。
vec3 exitNormalTetra(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  float voxelH = 2.1 / max(1.0, uShapeGrid - 1.0);
  float svgTexel = 3.0 / max(1.0, uShapeGrid);
  float svgH = svgTexel * 1.5;
  float shapeH = uShapeType == 2 ? voxelH * 1.70 : svgH;
  float h = mix(0.0009, shapeH, uShapeProgress);
  return normalize(
    k.xyy * mapScene(p + k.xyy * h, true) +
    k.yyx * mapScene(p + k.yyx * h, true) +
    k.yxy * mapScene(p + k.yxy * h, true) +
    k.xxx * mapScene(p + k.xxx * h, true));
}
#endif

// traceExitSurface 用哪一支算出口法線。預設就是完整的 calcNormal，所以不帶 probe
// 時展開結果與加入這個巨集之前完全相同。
#ifndef TRACE_EXIT_NORMAL_FN
#define TRACE_EXIT_NORMAL_FN calcNormal
#endif

// 從正面折射進入後，在實心 SDF 內尋找背面出口；只由亮底路徑呼叫。
bool traceExitSurface(
  vec3 entryPoint,
  vec3 insideDir,
  out vec3 exitPoint,
  out vec3 exitNormal,
  out float pathLength
){
// 診斷探針 B（?diag=probe-no-refraction）把函式「本體」在編譯期換成常數，簽章保留。
// 這樣所有呼叫點都還是合法的 GLSL，main() 會自然走「找不到出口」那條路，而我們量到的
// 就是這個本體在 ANGLE/fxc 眼中的純成本。刻意不刪呼叫點 —— 刪呼叫點會連帶改動 main()
// 的控制流，那樣量到的就不只是這一塊。
// 這一支是三者中最重的嫌疑：它有自己的 raymarch 迴圈，迴圈體呼叫 mapScene，結尾再
// 呼叫一次 calcNormal（本身又是 10 個 mapScene tap），而它在 main() 有 2 個呼叫點。
// 用 #ifdef 給 stub、#ifndef 包真正的本體，而不是「stub + return」就了事：return 之後
// 的程式碼雖然執行不到，但它仍然要通過編譯，成本不會消失 —— 那就量不到東西了。
#ifdef PROBE_NO_TRACE_EXIT
  exitPoint = entryPoint;
  exitNormal = vec3(0.0, 0.0, 1.0);
  pathLength = 0.0;
  return false;
#endif
#ifndef PROBE_NO_TRACE_EXIT
  float travel = 0.012;
  float maxTravel = uBounds.w * 2.25;
  bool found = false;
  vec3 q = entryPoint + insideDir * travel;

// 診斷探針 B1b（?diag=probe-no-trace-march）：只把這個 march 迴圈在編譯期移除，
// 結尾的 calcNormal 保留。用來把 traceExitSurface 裡的兩個放大來源分開量。
#ifndef PROBE_NO_TRACE_MARCH
  for (int i = 0; i < MAX_INTERIOR_COMPILE; i++) {
    q = entryPoint + insideDir * travel;
// 診斷探針 B1b-clean（?diag=probe-cheap-trace-sdf）：只把「迴圈體裡的這一份 mapScene」
// 換掉，迴圈結構、found 的動態性、結尾的 calcNormal 全部保留。
//
// 換成包圍球的 SDF。這個選擇有三個必要條件，缺一個這次量測就沒有意義：
//   便宜   —— 一次 length + 一次減法，相對 mapScene 幾乎免費
//   動態   —— uBounds 是 uniform，編譯器摺不掉；q 也跟著射線走
//   可命中也可落空 —— 起點在包圍球內（d < 0），往外 march 會穿出去（d > 0），
//                    超過 maxTravel 則 found 維持 false
// 第三點是重點：舊版 B1b 直接拿掉迴圈，found 變成編譯期常數 false，於是 main() 裡
// 依賴回傳值的整個折射分支（含第二次 traceExitSurface、背面薄膜、全內反射彈跳）
// 被 fxc 一起消掉，量到的就不只是迴圈的成本。這一版不會有那個問題。
#ifndef PROBE_CHEAP_TRACE_SDF
    float d = mapScene(q);
#endif
#ifdef PROBE_CHEAP_TRACE_SDF
    float d = length(q - uBounds.xyz) - uBounds.w;
#endif
    if (travel > 0.025 && d > -0.0009) {
      q -= insideDir * max(d, 0.0);
      found = true;
      break;
    }
    travel += max(-d * 0.72, 0.004);
    if (travel > maxTravel) break;
  }
#endif

  exitPoint = q;
  pathLength = travel;
// 法線的來源，三種組態互斥：
//   預設   found ? calcNormal(q) : 常數
//   B1a    完全不呼叫 calcNormal，改用最便宜的診斷用法線
//   B1b    無條件呼叫 calcNormal
//
// B1b 為什麼要改成無條件：march 迴圈一旦被移除，found 就是編譯期常數 false，
// 三元運算子會被摺疊掉、calcNormal 跟著被 fxc 消除 —— 那樣 B1b 就同時砍掉了兩個
// 變因，量到的數字沒有意義。無條件呼叫才能保證 B1b 只少了迴圈這一個變因。
#ifdef PROBE_NO_TRACE_NORMAL
  exitNormal = normalize(-insideDir);
#endif
#ifndef PROBE_NO_TRACE_NORMAL
#ifdef PROBE_NO_TRACE_MARCH
  exitNormal = calcNormal(q);
#endif
#ifndef PROBE_NO_TRACE_MARCH
  exitNormal = found ? TRACE_EXIT_NORMAL_FN(q) : vec3(0.0, 0.0, 1.0);
#endif
#endif
  return found;
#endif // PROBE_NO_TRACE_EXIT
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
  // 註：色散的分離角由 dn/dλ 決定，是材質本身的性質，不會因為表面變粗糙而改變。
  // 所以這裡的相位差要維持原值——粗糙度該做的是讓每個波長「各自變寬然後互相
  // 重疊」，不是把它們往中間收。收分離量會讓色帶縮小，方向剛好相反。
  // 真正的處理在函式尾端（攤開 + 重疊）。
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

  beams = beams * gain / falloff;

  // B：粗糙度把光針的尖端削鈍。
  //
  // 這裡不能去動上面的 core —— 每種圖樣都是「core / 距離」，core 是整個光場的
  // 乘數而不是寬度，推大它等於整體加亮（銳利度拉滿時 core 只有 0.004，推到
  // 0.05 就是十倍亮度），看起來會像「粗糙度變成了亮度滑桿」。
  //
  // 改用軟膝壓縮 x/(1+kx)：它對 x 單調遞增、恆 ≤ x，所以**只會變暗不會變亮**；
  // 亮到爆的針尖被壓成平頂，暗的尾巴幾乎原封不動——正是「散射把尖峰攤平」
  // 該有的樣子。k = 0 時逐位元等於原式，粗糙度 0 完全不影響既有畫面。
  float knee = transmissionSpread() * 0.03;
  if (knee > 0.0) beams = beams / (1.0 + beams * knee);

  // 粗糙度對色散做的第二件事：重疊。
  //
  // 上面的軟膝把每個通道的尖峰壓成平頂，等於各自「變寬」；三束變寬的光疊在
  // 一起，疊到的地方各波長混合，就洗回接近白光——這才是霧面稜鏡只透出一片
  // 彩色暈光、而不是清楚彩虹的成因。
  //
  // 往三通道的算術平均收（不是往亮度收）：算術平均讓 r+g+b 精確不變，所以
  // 這一步只重新分配顏色，不會動到總光量。
  //
  // 刻意不收到底（上限 0.7）：扇形的最外緣永遠只有最外側的波長到得了，真實的
  // 霧面稜鏡在很粗糙時仍保有淡淡的彩色，不會變成純灰。
  float wash = transmissionSpread() * 0.7;
  if (wash > 0.0) {
    float beamMean = (beams.r + beams.g + beams.b) / 3.0;
    beams = mix(beams, vec3(beamMean), wash);
  }
  return beams;
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
  // 粗糙度會把色散「洗掉」，而不只是「弄柔」——這是霧面玻璃不會打出彩虹的原因。
  //
  // 色散的分離角由 dn/dλ 決定，是一個很小的固定角；粗糙度則讓每個波長的出射
  // 方向各自散開成一個錐。當角度模糊大過那個分離角，紅綠藍三個錐就互相重疊，
  // 疊回來的結果是白光。所以粗糙度上升時，彩虹該做的是褪色成消色差的霧，
  // 不是保持一樣鮮豔只把邊緣糊掉。
  //
  // 單樣本渲染沒辦法真的去疊那些錐，改用等效的做法：把有效分離量往下收，
  // separated 就往純亮度 vec3(lum) 靠，也就是褪色。
  //
  // 但刻意保留 35% 不收（係數 0.65 而不是 1.0）：扇形最外緣永遠只有最外側的
  // 波長到得了，所以即使很粗糙也還是「霧玻璃透出的彩色暈光」，不是純灰。
  // 收到 0 會過頭，看起來像色散被關掉，而不是被散射。
  float separation = uDispersionSeparation * (1.0 - transmissionSpread() * 0.65);
  vec3 separated = mix(
    vec3(lum),
    spectrum,
    clamp(separation, 0.0, 1.0)
  );
  return mix(
    separated,
    clamp((separated - 0.5) * 1.45 + 0.5, 0.0, 1.0),
    clamp(separation - 1.0, 0.0, 0.5) * 2.0
  );
}

float artisticDispersionOPD(vec3 p, vec3 N, vec3 V){
// 診斷探針 B（?diag=probe-no-refraction）。本體含 4 次 fbm＝16 份展開的 snoise。
#ifdef PROBE_NO_ART_DISPERSION
  return 0.0;
#endif
#ifndef PROBE_NO_ART_DISPERSION
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
#endif // PROBE_NO_ART_DISPERSION
}

// 薄膜反射與透射分開計算；避免以暗色 alpha 覆蓋白色背景。
FilmMaterial thinFilm(vec3 p, vec3 N, vec3 V){
  float cosTheta = clamp(dot(N, V), 0.0, 1.0);

  vec3 interf = vec3(0.0);
// 薄膜干涉的整條計算鏈：4 次 fbm（＝16 份展開的 snoise）→ 厚度 → 光程差 →
// sampleFilmInterference（3 次 texture2D）。
//
// 它唯一的產物是 interf，而 interf 在 uFilmEnabled 為 0 時：這裡維持 vec3(0.0)，
// 下游的 filmAmount 又整個乘上 uFilmEnabled，film / filmChroma / darkInterf 因此
// 全部歸零。thickness 與 opd 沒有別的去處。所以薄膜關閉時整條鏈是死碼，
// 編譯期移除與 uFilmEnabled=0 的執行結果逐位元相同 —— 不是降級，是不編用不到的東西。
//
// 面板預設 filmEnabled = false，所以預設變體不含這一整塊。
#ifdef FEATURE_THIN_FILM
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

  if (uFilmEnabled > 0.5) interf = sampleFilmInterference(opd);
#endif

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
#ifdef FEATURE_RESEARCH
  bool researchIconHit = false;
  vec3 researchIconPoint = vec3(0.0);
  vec3 researchIconN = vec3(0.0, 0.0, 1.0);
  vec3 researchInsideDir = rd;
  float researchIconFres = 0.0;
  float researchIconBend = 0.0;
  // 淺底時 icon 的顯色結果：要染成什麼顏色（researchIconColor）、以及這個像素被
  // 染了多少（researchIconMask）。套用點在下面通用玻璃的 over 合成之後。
  //
  // 為什麼淺底不能沿用深底那條 screen：screen 加進去的是水滴的自身能量，而
  // over 合成是 final = own + bg·(1 - covered)，covered 又是取自身能量的峰值。
  // 背景為白（1.0）時代入就是 final = V + 1·(1 - V) = 1 —— 不管 V 多大，結果
  // 恆等於純白。也就是說任何自身能量項在白底上數學上必然隱形，不是強度不夠。
  //
  // 為什麼是「指定顏色 + 遮罩」而不是「乘一層濾色」：乘法的結果會跟著底下那層
  // 的濃淡跑，而底下那層受淺底顯色（uLightShow）影響 —— 於是調淺底顯色就會把
  // icon 的顏色一起帶走，選色器選的顏色跟畫面上看到的對不起來。用 mix 直接指定
  // 之後，遮罩為 1 的地方就精確等於選到的顏色，跟其他任何滑桿都無關。
  vec3 researchIconColor = vec3(1.0);
  // icon 表面的正對程度（1 = 正視，0 = 掠射）。淺底的濾色遮罩要用它自己算一條
  // 比 Schlick 寬的曲線，見下方 iconBodyMask。
  float researchIconFacing = 1.0;
  // 光在 icon 內部走過的長度。深底時它只是併進總光程（見 pathLength），淺底另外
  // 需要它單獨算一份「這顆 icon 自己的吸收」—— 全域的體積吸收是整顆水滴一起
  // 染色，沒辦法只讓 icon 顯色而外殼維持接近白。
  float researchIconPath = 0.0;
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
          researchIconPoint
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
          float iconF0 = pow((relIOR - 1.0) / (relIOR + 1.0), 2.0);
          float iconFres = iconF0 + (1.0 - iconF0) * pow(1.0 - iconFacing, 5.0);
          vec3 iconReflection = sampleEnvironmentBackdrop(
            reflect(researchInsideDir, researchIconN), roughBlur
          );
          iconFres = clamp(iconFres, 0.0, 1.0);
          researchIconFres = iconFres;
          // 淺底時界面反射不能直接用棚燈取樣。掠射處 iconFres 接近 1，下面那個
          // mix 會把 refractedBg 整個換成棚燈的值，而棚燈的平均亮度遠低於白紙
          // —— 結果就是 icon 邊緣一圈很深的黑邊。
          //
          // 改成「背景亮度、但帶冷色偏」：輪廓因此是靠顏色跟外殼分開，不是靠一
          // 條暗線，跟參考的做法一致（藍色與白色的漸層勾出形狀）。冷色的來源是
          // 這個材質本來的吸收色系，所以看起來仍是同一個材質的內含物。
          //
          // 深底時 uLightBackdrop 為 0，這一行是精確的恆等運算：那裡的暗邊正是
          // 「暗心亮邊」的成因，一個係數都不能動。
          vec3 iconReflectionLight = iconTransmitted * vec3(0.86, 0.93, 1.03);
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
    float sizeFactor = clamp(uSpectralCausticWidth / 2.5, 0.0, 1.0);
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
    float signedBand = fract(warpedBand * 0.5 + 0.5) - 0.5;
    float rainbowCoordinate = clamp(
      0.5 + signedBand * mix(1.8, 10.0, uSpectralCausticSeparation)
        + dot(causticN, causticTangent) * 0.06,
      0.0,
      1.0
    );
    vec3 causticSpectrum = separateSpectrum(
      texture2D(uSpectralCausticRamp, vec2(rainbowCoordinate, 0.5)).rgb
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
    vec3 causticNoiseFlow = loopNoiseOffset(uSpectralCausticFlow);
    float causticNoise = fbmFast(
      causticP * uSpectralCausticNoiseScale + causticNoiseFlow
    );
    float noiseMask = smoothstep(0.32, 0.68, 0.5 + causticNoise * 0.72);
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
    // 淺底：icon 用「偏冷色」勾輪廓，不用「壓暗」。
    //
    // 上一版是把界面反射與厚度直接當吸收乘上去，兩者都在掠射處最強，結果是
    // icon 周圍一圈黑邊 —— 跟參考完全相反，那裡是用藍與白的漸層勾形狀的。
    //
    // 所以這裡的濾色刻意做成亮度接近 1、只有色相偏移：icon 是「比外殼偏色」而
    // 不是「比外殼暗一截」。
    // 淺底 icon 的獨立顯色。三根專屬控制（顏色／濃度／邊緣集中），跟體積吸收
    // 完全脫鉤 —— 上一版是從 uAbsorbColor 推的，結果 icon 的顏色與濃淡會跟著
    // 體積吸收一起被拉走，沒辦法單獨造型。
    //
    // 分佈刻意做成「輪廓帶」：光程短代表接近剪影邊緣，光程長代表中央，所以
    // exp(-path·k) 在邊緣最強、往中央衰減。這正是要的「藍色包圍輪廓、中間留
    // 透明」；上一版用的是 1 - exp(-path)，那是中央最濃，剛好相反。
    //
    // 中央不會完全歸零（exp 只是衰減），所以裡面仍留一層很淡的漸層色。
    float iconEdge = exp(-researchIconPath * max(uLightIconEdge, 0.01));
    float iconDensity = clamp(
      iconEdge * uLightIconTint
        + iconRim * (0.35 + uFresnel) * 0.18,
      0.0,
      1.0
    );
    // 棚燈打到的高光維持透明。周圍偏了色之後，這一小塊留白就自己讀成高光點，
    // 不必再加光 —— 白底上本來就沒有比白更亮的空間。
    //
    // 門檻不能用 clamp(iconSpecLum, 0, 1)：HDRI 是高動態範圍的，棚燈亮度在相當
    // 大的立體角裡都超過 1，clamp 之後幾乎整片是 1，等於把密度無條件砍掉大半。
    float iconHighlight = smoothstep(1.6, 5.0, iconSpecLum);
    iconDensity *= 1.0 - iconHighlight * 0.75;
    researchIconMask = iconDensity * uLightBackdrop;
    // 顏色只取色相：把選到的顏色除掉自己的亮度，歸一化到 1。
    //
    // 這一步是「不會再出現黑邊」的保證。直接乘一個飽和藍（線性亮度遠低於 1）
    // 等於乘一個暗值，最濃的地方就會變成一圈暗環 —— 那正是前幾版的問題。歸一化
    // 之後不管選什麼顏色，最濃處都只是換色而不是變暗。
    float iconPickLum = dot(uLightIconColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 iconTintColor = uLightIconColor / max(iconPickLum, 0.001);
    researchIconColor = iconTintColor;
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
    float showWeight = uLightShow;
#ifdef FEATURE_RESEARCH
    // 淺底顯色不能作用在 icon 上。
    //
    // 它抬的是「這個材質在白底上要留下多少痕跡」，講的是外殼那件事。作用到 icon
    // 身上的話，icon 的顏色會先被它乘一層濃淡、再乘上選到的色相 —— 等於在選色器
    // 前面疊了一層濾鏡，調出來的顏色跟畫面上看到的對不起來。
    //
    // 用 icon 的染色量把抬升收回來：icon 越濃的地方 uLightShow 越不介入，最濃處
    // 完全不介入。那裡的底色因此就是「白背景穿過玻璃」（在白底上約等於 1.0），
    // 乘上歸一化過的色相之後，畫面上就是選色器選的那個顏色本身。
    // 用 smoothstep 而不是直接乘 (1 - mask)：遮罩的峰值只到 0.7 上下，直接乘的話
    // 抬升仍有三成打在 icon 上，實測 icon 的像素在淺底顯色 0→1 之間平均還會變動
    // 85/255。改成只要有可觀的 icon 密度就整個收掉。
    showWeight *= 1.0 - smoothstep(0.02, 0.30, researchIconMask);
#endif
    float liftedCover = clamp(
      pow(universalCovered, mix(1.0, 0.45, showWeight))
        * mix(1.0, 1.28, showWeight),
      0.0,
      1.0
    );
    float cover = mix(universalCovered, liftedCover, uLightBackdrop);
    finalColor = clampOutput(finalColor + universalTransmitted * (1.0 - cover));
#ifdef FEATURE_RESEARCH
    // icon 的顯色。遮罩為 1 的地方就精確等於選到的顏色，不受前面任何濃淡影響
    // —— 這是「調淺底顯色不會動到 icon 顏色」的保證（見上方宣告處的說明）。
    //
    // 遮罩在輪廓最高、往中央衰減（見 iconEdge），所以 mix 出來就是「漸層色包圍
    // 輪廓、中間讓外殼透出來」。深底時遮罩恆為 0，這一行是精確的恆等運算。
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
