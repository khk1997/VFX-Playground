export const ENVIRONMENT_GLSL = `// ===== 程序化棚景（只有靜態模式編譯，見 FEATURE_STATIC_GLASS）=====
//
// 為什麼玻璃需要一個有結構的背景，而不只是換個底色：色散是「同一條視線的不同
// 波長落在背景的不同位置」，所以背景在那個角度差之內必須有東西不一樣。純色畫布
// 完全不看方向，三個波長取到同一個常數，相減恆為零 —— 這正是 traceExitSurface
// 之後那段註解記錄過的死路。垂直漸層好一點，但它是整張畫面最低頻的訊號，一個
// 波長差那麼小的角度掃過去，亮度差仍然在捨入誤差等級。
//
// 棚景補的就是這件事：地平線、地板、接觸陰影與棚燈卡，每一項都在背景上
// 放一段夠陡的梯度。玻璃邊緣把大片立體角壓進幾個像素，梯度在那裡被放大，彩虹
// 因此自己長在輪廓與摺痕上，不必額外畫上去。
//
// 它同時服務深底與淺底：背景紙的顏色沿用既有的 uBgColor／漸層，棚景只在那之上
// 疊結構，所以換底色不會換成另一套美術。HDRI 背景（uBgMode==1）不套用 —— 那本來
// 就已經是有結構的環境。
//
// 宣告連同下面的實作一起關在旗標裡，其餘九個模式連這幾行都不會編到。
#ifdef FEATURE_STATIC_GLASS
uniform float uStudioBackdrop;      // 0 = 沿用原本的純色／漸層背景
uniform float uStudioFloorHeight;   // 地板平面的 y
uniform float uStudioFloorTone;     // 地板相對背景紙的明度（<1 壓暗）
uniform float uStudioHorizonSoft;   // 地平線的收斂柔度
uniform float uStudioShadowStrength;// 接觸陰影最深處
uniform float uStudioShadowRadius;  // 接觸陰影的半徑
uniform float uStudioCardStrength;  // 棚燈卡亮度
uniform float uStudioAmbient;       // 柔光罩強度（只作用於折射與反射取樣）
uniform float uStudioWallLift;      // 牆面的絕對亮度底（深底才看得出差別）
uniform float uStudioFloorLift;     // 地板的絕對亮度底
uniform float uStudioCardEdge;      // 棚燈卡邊緣的銳利度：越小邊越硬、色帶越明顯
uniform float uStudioCardGain;      // 棚燈卡相對背景紙的亮度倍率（可大於 1）
// 棚燈卡由中心往邊緣的衰減。0 = 整面一樣亮，1 = 邊緣暗到 0。真的柔光箱中間最亮，
// 平面玻璃正對著它的那一面才會是一道漸層，而不是整片剪成純白。
uniform float uStudioCardFalloff;
// 輪廓彩虹：掠射處額外的色散倍率（0 = 只有物理的那一份），乘在 shaders.js 的
// bandSpread 上。它是「色散強度不按幾何加權」那條規則的刻意例外：物理的那一份
// 只讓平面物體在圓角上長出幾點色斑，參考影片的 edge dispersion 是沿著整圈輪廓的
// 一條色帶。權重用視線與法線的夾角，連續、不必另外追蹤；輪廓正上方會被 Fresnel
// 反射蓋掉，所以色帶自然落在輪廓往內一點。
uniform float uEdgeDispersion;
// ===== 燈位 =====
// 每盞燈用球座標描述：方位角（繞 Y 軸，度）、仰角（度）、角半徑（度）、相對強度。
// 這些原本是寫死在 studioBackdropSample 裡的五個常數向量 —— 等於整個模組只有一種
// 打光。預設值就是那五個常數換算出來的角度，所以接上滑桿當下外觀不變。
uniform vec4  uLightKey;            // xy = 方位/仰角, z = 角半徑, w = 強度
uniform vec4  uLightFill;
uniform vec4  uLightRim;
uniform vec4  uFlagA;               // 黑卡 A：xy = 方位/仰角, z = 角半徑, w 未用
uniform vec4  uFlagB;
// OpenPBR: transmission_dispersion_abbe_number。越小色散越強（冕牌 59 / 火石 30 /
// 重火石 20）。
uniform float uDispersionAbbe;
uniform float uStudioCaustic;       // 焦散強度：光被玻璃聚到地板上的亮斑
uniform float uStudioCausticChroma; // 焦散外圈的彩度
uniform float uStudioFlag;          // 黑旗強度：框外的黑卡，專門用來在淺底製造對比
// 內部再彈一次。靜態模組已不讀它（彈跳的比例完全由出口面的 Fresnel 決定，見
// shaders.js），uniform 留著只是因為其他模式與參數檔還帶著這個名字。
uniform float uInternalBounce;
// 內部反射的最低出口反射率：低於它就不追彈跳。探針 probe-static-no-bounce 把它
// 拉到 2（反射率不可能超過 1），整段彈跳連同內部追蹤就都不跑。
#ifdef PROBE_STATIC_NO_BOUNCE
#define STATIC_BOUNCE_MIN_FRESNEL 2.0
#else
#define STATIC_BOUNCE_MIN_FRESNEL 0.004
#endif
// ===== 光譜折射 =====
// OpenPBR: transmission_dispersion_scale。0 = 各波長同路，沒有色散。
uniform float uDispersionScale;
// 光譜取樣數。1 等於關閉；越多色帶越連續，但每一個都是一次背景取樣。
uniform int   uSpectralSamples;
// 自動畫質等級（0 = high、1 = balanced、2 = low，見 adaptive-quality.js）。high
// 什麼都不動；往下依序關掉最貴、但少了也最不顯眼的幾項（見 staticSpectralSamples、
// spectralBounce 與地板影子）。輸出一律用 0。
uniform int   uStaticQualityTier;
// 地板影子判斷用的緊包圍球半徑（見 drop-physics.js 的 staticShapeShadowRadius）。
// 0 = 沒有精確值，改用 uBounds.w。
uniform float uStudioShadowBound;
// 新玻璃合成的混合量。1 = 完全走新模型，0 = 完全退回原本的暗底外殼，
// 中間值用來做並排比較（這是研究分支，能退回去才能判斷改動是不是進步）。
uniform float uStaticGlassMix;
#endif // FEATURE_STATIC_GLASS
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
#if MAX_REFLECTION_SAMPLES > 4
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
#else
      vec3 prefiltered = (center + ring) / 5.0;
      float centerWeight = mix(0.68, 0.24, blur);
      center = mix(prefiltered, center, centerWeight);
#endif
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
  if (uLightBgGradientEnabled > 0.5) {
    // 棚拍無縫背景紙：頂到底柔和過渡，S 曲線讓中段變化最快、頭尾趨緩收斂，
    // 讀起來才是「紙自然垂墜」的漸層，不是機械的線性內插。跟 proceduralEnv
    // 同一個慣例，用歸一化方向的 d.y 當「畫面垂直位置」，折射、反射取樣同一支
    // 函式時漸層會自然跟著彎折，穿過玻璃看仍是同一塊背景紙。
    float t = smoothstep(-0.55, 0.55, rd.y);
    vec3 gradient = mix(uLightBgGradientBottom, uLightBgGradientTop, t);
    return vec4(gradient, uTransparentBackground == 1 ? 0.0 : 1.0);
  }
  return vec4(uBgColor, uTransparentBackground == 1 ? 0.0 : 1.0);
}

#ifdef FEATURE_STATIC_GLASS
// 程序化棚景（見這個檔案開頭 uStudioBackdrop 那段說明）。只有靜態模式編它，
// 其餘九個模式的 backgroundSample 逐字不變。
//
// 它接一個 origin 而不是只吃方向：地板要跟平面求交，而穿過玻璃出去的那條射線
// 是從出口點出發的，不是從鏡頭。沿用鏡頭原點的話，折射影像裡的地平線會跟畫面上
// 那條對不齊 —— 而「折射影像與背景錯開多少」正是玻璃讀起來有沒有厚度的來源。
//
// 這裡刻意不做陰影的遮蔽測試。接觸陰影是一顆隨距離衰減的軟斑，不是投影：物體
// 本身是 SDF，真要投影得對每個地板像素再 march 一次，而那個成本換來的差別在
// 一顆離地不遠的玻璃上幾乎看不出來。
// cards：棚燈卡要不要算進來。0 = 不算（直接看背景的那條射線），1 = 算（折射與
// 反射的取樣）。
//
// 這不是開關語意的方便，是棚拍本來的樣子：棚燈在框外，鏡頭直接拍不到，但它照亮
// 物體、也映在物體上。畫進背景的話，深底就不再是黑的而是一大片光暈 —— 那等於把
// 「深底」這個選擇改掉了。分開之後，深底的背景仍然是乾淨的黑，而玻璃的輪廓與
// 高光有東西可以反射，這也是深底那顆玻璃不再是一團黑的原因。
// 光譜取樣的顯色響應。band 0 = 藍端，1 = 紅端。
//
// 不沿用 visibleSpectrum：那一支是給「把光譜畫上去」用的，三個瓣又寬又重疊，
// 相鄰取樣算出來的顏色幾乎一樣，平均完就是灰的。這裡要的相反 —— 瓣越窄，
// 相鄰波長取到不同背景時的顏色差越大，色帶才分得開。紅端補一個小的次瓣：
// 人眼對短波紅有殘餘響應，少了它紫色會缺一角、光譜尾端讀起來會斷掉。
//
// 權重不必歸一：呼叫端會逐通道除以權重和，所以這裡只決定「形狀」。
// 出射方向：折射與內反射按 Fresnel 連續混合，不做「有沒有全內反射」的二元切換。
//
// 舊路徑在全內反射時會重新追一次出口面，整個換掉 exitPoint、exitNormal 與
// pathLength。臨界角 θc 是一條等值線，兩側因此取到完全不同的光路，而下游的光譜
// 迴圈整個吃這些值 —— 畫面上就是一塊塊暗三角，斜邊帶著鋸齒（旋轉視角、拉近就
// 看得到；關掉黑旗只是讓它變淡，邊仍在，是這麼分辨出來的）。
//
// 物理上透射不是在 θc 突然中斷：Fresnel 反射率連續升到 1，同時折射方向連續轉到
// 與表面相切，所以按反射率混合兩個方向在 θc 兩側接得起來，越過之後就是內反射
// 本身。跟 spectralRefraction 裡逐波長做的是同一件事，這裡是參考路徑。
//
// 代價是厚玻璃少了「內部再彈一次才穿出去」那層結構 —— 那層結構本來就是靠第二次
// traceExitSurface 換來的，而它正是不連續的來源。
vec3 staticExitDirection(vec3 insideDir, vec3 exitNormal, vec3 refracted,
                         out float exitR){
  vec3 bounced = normalize(reflect(insideDir, exitNormal));
  float cosI = clamp(abs(dot(insideDir, exitNormal)), 0.0, 1.0);
  float sinT2 = uIOR * uIOR * (1.0 - cosI * cosI);
  exitR = 1.0;
  if (sinT2 < 1.0) {
    float cosT = sqrt(1.0 - sinT2);
    float rs = (uIOR * cosI - cosT) / (uIOR * cosI + cosT);
    float rp = (cosI - uIOR * cosT) / (cosI + uIOR * cosT);
    exitR = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
  }
  return dot(refracted, refracted) > 0.0001
    ? normalize(mix(normalize(refracted), bounced, exitR))
    : bounced;
}

vec3 spectralResponse(float band){
  float t = clamp(band, 0.0, 1.0);
  // 瓣的位置換算自波長（見 bandWavelength）：紅 610nm、綠 545nm、藍 470nm，
  // 在 430–660 這個取樣區間裡分別落在 0.78 / 0.50 / 0.17。
  float r = exp(-pow((t - 0.78) / 0.20, 2.0))
    + 0.20 * exp(-pow((t - 0.02) / 0.11, 2.0));
  float g = exp(-pow((t - 0.50) / 0.18, 2.0));
  float b = exp(-pow((t - 0.17) / 0.20, 2.0));
  return vec3(r, g, b);
}

// 取樣點的波長，單位 µm。band 0 = 藍端，1 = 紅端。
float bandWavelength(float band){
  return mix(0.430, 0.660, clamp(band, 0.0, 1.0));
}

// Cauchy 色散曲線 n(λ) = A + B/λ²，B 由阿貝數換算。
//
// 為什麼要換掉原本那條「折射率沿波段線性內插」：線性是左右對稱的，真實的
// 1/λ² 不是。以 n_d（587.6nm）為中心，440nm 的偏移量大約是 650nm 的四倍多 ——
// 所以真實玻璃的色散邊是「暖色擠成一條細邊、冷色拖出一條長尾」，而對稱的版本
// 會畫出一條紫色過重、紅橙偏弱的假色帶。顏色對不對就差在這裡。
//
// 阿貝數 Vd = (n_d - 1) / (n_F - n_C)，數字越小色散越強：冕牌玻璃約 59，
// 火石玻璃約 30，重火石約 20。參考影片面板上那個 15.81 落在「比任何真實玻璃
// 都更誇張」的區間，是美術值不是材料值，所以這裡的下限放得比現實低。
//
// strength 是邊緣加權與美術增益的總和。物理只決定曲線的「形狀」，強度仍然交給
// 使用者 —— 真實阿貝數算出來的分離量在單顆玻璃上只有零點幾度，不放大看不見。
float bandIOR(float band, float strength){
  const float INV_LD2 = 2.8959;   // 1/λd²，λd = 0.5876 µm
  const float INV_LF2 = 4.2318;   // 1/λF²，λF = 0.4861 µm
  const float INV_LC2 = 2.3215;   // 1/λC²，λC = 0.6563 µm
  float lambda = bandWavelength(band);
  float invL2 = 1.0 / (lambda * lambda);
  float b = (uIOR - 1.0) / max(uDispersionAbbe, 0.8) / (INV_LF2 - INV_LC2);
  float dn = b * strength * (invL2 - INV_LD2);
  // 偏移量要有上限。strength 裡含美術增益（×24）與輪廓加權（最多再 ×(1+邊緣彩虹)），
  // 乘起來預設值在掠射處的藍端就到 3.2、「稜鏡」到將近 19 —— 藍端整段落進全內反射，
  // 平均折射率被推高，輪廓附近的放大整個變形。紅端則是另一頭：原本硬夾在 1.02，
  // 一半的光譜樣本擠在同一個值上，彩虹缺掉半邊。
  //
  // 改成兩側各自軟性飽和：小的偏移原樣通過（斜率 1），大的連續地收斂到上限，樣本
  // 之間的先後順序不變，色帶就不會擠成一條。往下的上限讓 n 停在 1.08 以上，
  // refract() 不會翻過來；往上給兩倍的空間，保留 1/λ² 那種「冷色拖長尾」的不對稱。
  float dnDown = max(uIOR - 1.08, 0.01);
  float dnUp = dnDown * 2.0;
  float cap = dn > 0.0 ? dnUp : dnDown;
  float x = abs(dn) / cap;
  float softened = cap * (1.0 - 2.0 / (exp(2.0 * x) + 1.0));   // cap·tanh(x)
  return uIOR + sign(dn) * softened;
}

// 實際使用的光譜取樣數。low 畫質最多 6 個：少掉的是色帶的細緻度，抖動仍讓它
// 連續（見 spectralRefraction 的 bandJitter），不會退回一段一段。
int staticSpectralSamples(){
  return uStaticQualityTier >= 2 ? min(uSpectralSamples, 6) : uSpectralSamples;
}

// 棚燈卡：方向球上的一塊圓盤，邊緣的銳利度自己控制。
//
// 為什麼要是「有邊的」而不是一團柔光：色散的顏色來自背景在一個很小的角度差內
// 的差異，所以平滑的漸層被分開之後仍然是平滑的漸層 —— 只會整片變淡，不會出現
// 色帶。要看到參考影片那種細而飽和的 ROYGBIV，環境裡必須有「邊」被拆開。柔光
// 板照亮物體、它的邊緣負責顯色，兩件事都需要。
// 主光方向。焦散必須跟棚燈卡讀同一個方向，否則地板上的亮斑會跟物體的高光
// 指向不同的光源，一眼就看得出是貼上去的。
// 球座標轉方向。方位角繞 Y 軸，0 = +Z（正對鏡頭的後方），仰角 90 = 正上方。
// 跟 rayBeamLightDirection 同一個慣例，面板上的數字在兩處意思一致。
vec3 studioDir(vec2 angles){
  float az = radians(angles.x);
  float el = radians(angles.y);
  return normalize(vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az)));
}

vec3 studioKeyDir(){
  return studioDir(uLightKey.xy);
}

float studioCard(vec3 rd, vec3 dir, float radius, float soft){
  float a = acos(clamp(dot(rd, dir), -1.0, 1.0));
  return 1.0 - smoothstep(radius - soft, radius + soft, a);
}

// 發光的棚燈卡：外框的硬邊照舊（色散靠它），裡面由中心往外衰減。黑旗仍用上面
// 那支，黑卡本來就是一整片均勻的黑。
float studioSoftbox(vec3 rd, vec3 dir, float radius, float soft){
  float a = acos(clamp(dot(rd, dir), -1.0, 1.0));
  float r = clamp(a / max(radius, 0.001), 0.0, 1.0);
  float edge = 1.0 - smoothstep(radius - soft, radius + soft, a);
  return edge * (1.0 - clamp(uStudioCardFalloff, 0.0, 1.0) * r * r);
}

// soften：這條射線的 footprint 有多寬。0 = 直接看背景的那條（鏡頭射線，
// 一個像素就是一個方向），大於 0 = 穿過玻璃出去的那些。
//
// 為什麼需要它：玻璃把一大片立體角壓進幾個像素，單樣本折射打在硬邊上就會在
// 相鄰像素之間跳邊，色帶因此斷成碎斑 —— 參考影片裡是連續的緞帶。真正的解是
// 在錐內多重取樣，但那要乘上波長數，太貴。這裡改成把環境自己的邊按 footprint
// 攤開：結果等價於預濾波，成本是零（就是幾個 smoothstep 的區間變寬）。
// HDRI 那條路用 PMREM 的 mip 做同一件事，這是程序化棚景的對應版本。
// mapScene 定義在 geometry chunk，而這個 chunk 排在它前面（順序是
// environment → geometry → optics，見 shader_structure 的斷言）。前向宣告是
// GLSL ES 1.0 就支援的，比為了一個函式去改 chunk 順序安全 —— 那個順序是
// backgroundSample 與 sampleReflection 的相依決定的。
float mapScene(vec3 p);

// 玻璃的影子：從地板點往主光打一條 sphere trace，回傳地板要暗掉多少（逐通道，
// 0 = 沒有影子），caustic 帶回被玻璃聚進影子裡的光 —— 它是相對於地板本身亮度
// 的倍率，不是絕對亮度（見呼叫端）。
//
// 這是接觸陰影與焦散唯一「知道造型長什麼樣」的來源 —— 影子的形狀是眼睛判斷物體
// 形狀的主要線索之一。只有鏡頭直接看到的地板會跑這一段（cards 為 0 的那條射線）；
// 折射與反射的取樣每個波長各要一次，乘上去付不起，所以沿用 studioCaustics 與
// 高斯斑的解析近似（見 studioBackdropSample）。
//
// 不透明物體的影子是「光被擋掉」，玻璃的是「光被彎走」：穿過厚處的光大半照樣
// 落到地板上，只被吸收染上玻璃的顏色；真正暗下來的是輪廓那一圈 —— 光在那裡掠射
// 進出，偏折最大，被甩到別處去了。所以碰到物體之後不停，繼續穿過去量它有多深、
// 有多厚：深度決定暗邊與聚焦，厚度決定吸收。
//
// 半影是兩段接起來的同一條曲線。輪廓外是標準的 res = min(k·d/t)，d/t 是射線
// 離表面的角距；輪廓內把「射線在物體裡離表面最遠多深」換成負的角距。兩段在
// 輪廓上都是 0，一起經過同一條 smoothstep 形狀的曲線，所以半影跨在輪廓兩側、
// 寬度隨離物體的距離自然變寬。前一版只有輪廓外那一段，射線一穿進去就改用厚度，
// 輪廓內沒有半影 —— 影子邊怎麼樣都是硬的；遠處再把整塊拉向一個常數冒充糊化，
// 結果是一張均勻的灰色剪紙。
// 半影寬度 k（見 studioGlassShadow）。抽出來是因為下面的 studioShadowPossible
// 要跟 march 用同一個值，兩邊對不上的話「確定沒影子」的判斷就不成立。
float studioShadowK(){
  return clamp(2.2 / tan(radians(clamp(uLightKey.z, 2.0, 120.0)) * 0.5), 2.0, 16.0);
}

// 這個地板點「有沒有可能」落在影子裡。不可能的話 studioGlassShadow 的結果精確是
// 0，march 可以整段跳過 —— 這是純效能優化，畫面不變。
//
// 影子只來自兩件事：射線穿進物體（entered），或 res = min(k·d/t) 掉到 1 以下
// （輪廓外的半影；res ≥ 1 時 coverage 精確是 0）。物體整個包在 uBounds 那顆
// 球裡，所以 d 至少是「到球面的距離」。沿著射線 p(t) = f + L·t，若對所有 t 都有
//   |p(t) − c| − R  >  m·t，  m = 2 / k
// 射線就碰不到物體，而且 k·d/t 一路都大於 2 —— 留兩倍餘裕，是因為 march 裡的
// 最近點估計（見 studioGlassShadow 的 improved soft shadow）可能比真正的距離小。
// 左式減右式對 t 的最小值有解析解：a = (c − f)·L、h 是 c 到射線的垂距，極小點在
// t* = a + m·h / √(1 − m²)，值是 h·√(1 − m²) − R − m·a；t* 夾在 march 實際走得到
// 的範圍裡。
//
// 地板佔畫面大半，而大部分地板點離物體很遠 —— 這一段在預設構圖省下地板影子
// 七成以上的成本。
bool studioShadowPossible(vec3 floorPos, vec3 lightDir){
#ifdef PROBE_STATIC_NO_OPT
  return true;
#endif
  vec3 w = uBounds.xyz - floorPos;
  float R = uStudioShadowBound > 0.0 ? uStudioShadowBound : max(uBounds.w, 0.001);
  float a = dot(w, lightDir);
  float h = sqrt(max(dot(w, w) - a * a, 0.0));
  float m = 2.0 / studioShadowK();
  float root = sqrt(max(1.0 - m * m, 0.0));
  float tStar = clamp(a + m * h / max(root, 1e-4), 0.0, 13.2);
  float gap = length(floorPos + lightDir * tStar - uBounds.xyz) - R - m * tStar;
  float gapStart = length(w) - R;
  return min(gap, gapStart) <= 0.0;
}

vec3 studioGlassShadow(vec3 floorPos, vec3 lightDir, out vec3 caustic){
  caustic = vec3(0.0);
  float R = max(uBounds.w, 0.001);
  // 半影寬度跟著主光的大小走：k ≈ 1/tan(半角)。常數 2.2 讓預設那張 44.5° 的
  // 柔光箱落在 k ≈ 5，也就是前一版手調出來的寬度；夾住兩端，免得極小的燈把
  // 半影收成一條鋸齒、極大的燈把影子糊到看不見。
  float k = studioShadowK();
  float res = 1.0;
  float t = 0.05;
  float prevD = 1e10;
  bool entered = false;
  for (int i = 0; i < MAX_SHADOW_COMPILE; i++){
    float d = mapScene(floorPos + lightDir * t);
    // 最近點不一定落在取樣點上。用前後兩步的距離球交出真正的最近點再算角距
    // （Inigo Quilez 的 improved soft shadow）；只看取樣點的話，擦邊而過的射線
    // 量到的 res 偏大，輪廓外的半影到不了 0，跟輪廓內那一側接不起來，影子邊上
    // 就留一道硬線。
    //
    // 這一招只對精確的距離場成立：它假設相鄰兩步的距離球真的是「到表面的
    // 歐氏距離」。匯入的造型（形狀場）不是 —— SVG 的距離只在 xy 平面精確，擠出的
    // 厚度與圓角是用 max／smin 跟 z 合起來的，角落附近的距離跟真值差很多。拿它去
    // 交距離球，估出來的最近點每一步跳一次，地板上就是一圈一圈沿著輪廓外推的
    // 階梯（問號的影子就是這樣）。所以形狀場退回只看取樣點；它的輪廓邊本來就被
    // 貼圖的三次濾波抹軟了，那道硬線在它身上看不出來。
#ifdef FEATURE_SHAPE_FIELD
    res = min(res, k * d / t);
#else
    float y = d * d / (2.0 * prevD);
    float closest = sqrt(max(d * d - y * y, 0.0));
    res = min(res, k * closest / max(t - y, 0.001));
#endif
    prevD = d;
    if (d < 0.002){ entered = true; break; }
    if (t > 12.0) break;
    // 步長上限放寬到 1.2：遠處的地板點要走很長一段才碰得到物體，卡在 0.6 的話
    // 二十步走不完，march 會在半路停住 —— 影子的遠端因此被截成一排鋸齒。
    t += clamp(d, 0.05, 1.2);
  }

  float tIn = t;
  float thickness = 0.0;
  float depth = 0.0;
  if (entered) {
    // 穿過去。物體裡 d 是負的，|d| 仍是到表面距離的下限，照樣能拿來當步長。
    t += 0.01;
    for (int i = 0; i < MAX_SHADOW_COMPILE; i++){
      float d = mapScene(floorPos + lightDir * t);
      if (d > 0.0) break;
      t += max(-d, 0.012);
    }
    thickness = t - tIn;
    // 這條射線離輪廓多深：取弦中點到表面的距離。不用 march 途中 |d| 的最大值 ——
    // 那些取樣點落在哪裡跟著步長跳，相鄰像素量到的最大值忽高忽低，地板上會拉出
    // 一條條放射狀的紋。凸的造型最深處本來就在弦的中間。
    depth = max(-mapScene(floorPos + lightDir * (tIn + thickness * 0.5)), 0.0);
    res = -k * depth / max(tIn, 0.05);
  }
  res = clamp(res, -1.0, 1.0);
  // 燈被擋掉的比例：輪廓外 0 → 輪廓上 0.5 → 深入輪廓 1。
  float coverage = 1.0 - 0.25 * (1.0 + res) * (1.0 + res) * (2.0 - res);

  // 擋住燈的那片玻璃讓多少光過去。靠輪廓的薄邊偏折最大，光幾乎全被甩走；越深
  // 越接近本體的透射量。本體也不是全透：兩個面各反射掉一點，其餘被折到別處、
  // 聚成焦散，真正照原位落下的大約六成 —— 玻璃的影子比塑膠淡，但仍是一塊看得見
  // 的影子，不是只有一圈描邊。
  //
  // 輪廓外的半影（包括圓環的洞口）是被同一圈薄邊擋住的，depth 是 0，正好接上
  // 輪廓內那一側；而洞口只被擋掉一部分燈，所以比玻璃本體的影子淡 —— 前一版把
  // 它當不透明物體的半影，洞口反而比玻璃還暗。
  float rim = 1.0 - smoothstep(0.0, 0.15, depth);
  vec3 absorbCoefficient = -log(clamp(uAbsorbColor, 0.002, 0.999)) / 20.0;
  vec3 tint = exp(-absorbCoefficient * max(uAbsorb, 0.0) * thickness);
  vec3 through = tint * clamp(uTransmission, 0.0, 1.0) * mix(0.6, 0.12, rim);

  if (entered) {
    // 物體把光往它的中軸收，亮核長在影子最深處 —— 「暗斑中間有一塊更亮」正是
    // 玻璃與不透明物體最好認的差別。用深度而不是厚度：方體的厚度整片都一樣，
    // 拿厚度當聚焦量會投出一整塊均勻的亮板。彩邊長在暗邊往內那一段：跟玻璃
    // 本體的色散同一個理由，最掠射的那些光分得最開。
    float focus = smoothstep(0.2, 1.0, depth / (0.3 * R));
    float fringe = rim * (1.0 - rim) * 4.0;
    vec3 hue = spectralResponse(clamp(depth / 0.12, 0.0, 1.0));
    hue /= max(max(hue.r, max(hue.g, hue.b)), 0.001);
    caustic = (tint * focus * focus * 1.8
        + mix(vec3(1.0), hue, clamp(uStudioCausticChroma * 2.0, 0.0, 1.0)) * fringe * 0.25)
      * uStudioCaustic * uLightKey.w;
    // 聚焦的光也會隨距離散開：離物體越遠，柔光箱每一點聚出來的亮核錯開越多。
    caustic *= 1.0 - 0.6 * smoothstep(0.0, 2.5 * R, tIn);
  }
  // 影子是「主光被擋掉」，主光關掉就沒有影子可投。大於 1 的強度不會讓影子更黑
  // （擋掉的比例不會超過全部），所以夾在 1。
  return coverage * (vec3(1.0) - through) * clamp(uLightKey.w, 0.0, 1.0);
}

// 焦散：光穿過玻璃之後被聚到地板上。
//
// 真的算焦散要從光源那側打光子再收集，離線算繪才付得起。這裡用一個解析近似：
// 把物體當成它的包圍球，從地板點往主光方向看，量這條線離球心多遠。球透鏡會把
// 邊緣的光往軸線收，所以軸線附近是亮核、球緣對應的半徑上是一圈更亮的環 ——
// 那圈環正是焦散最顯眼的特徵，也是參考影片地板上那幾塊亮斑的形狀。
//
// 彩虹長在環上而不是核上，理由跟玻璃本體的色散同一個：環是邊緣的光聚起來的，
// 走的是最掠射、最接近臨界角的那條路，分離量在那裡最大。
//
// 用包圍球而不是真正的 SDF 是刻意的取捨：正確做法得對每個地板像素再 march 一次，
// 而地板佔了畫面大半。近似的代價是亮斑不會跟著造型的細節變形，只跟著它的大小
// 與位置走 —— 在一顆離地不遠的玻璃底下，那個差別遠小於「有沒有焦散」的差別。
vec3 studioCaustics(vec3 floorPos){
  if (uStudioCaustic <= 0.0001) return vec3(0.0);
  vec3 lightDir = studioKeyDir();
  vec3 toCenter = uBounds.xyz - floorPos;
  float along = dot(toCenter, lightDir);
  // 光源在地板點的另一側時沒有東西擋在中間，也就沒有焦散。用 smoothstep 而不是
  // 直接 return：硬切會在地板上留下一道筆直的邊，看起來像貼圖沒對齊。
  float front = smoothstep(0.0, uBounds.w * 1.5, along);
  if (front <= 0.0) return vec3(0.0);
  float axis = length(toCenter - lightDir * along);
  float t = axis / max(uBounds.w, 0.001);

  // 亮斑必須待在物體附近。光源方向相當側向，只看軸線距離的話那個橢圓會沿著
  // 光線拖得非常長 —— 畫面上是一圈跟物體無關的巨大彩環。再乘一個以物體正下方
  // 為中心的衰減把它收回來。
  vec2 ground = (floorPos.xz - uBounds.xz) / max(uBounds.w * 1.8, 0.001);
  float reach = exp(-dot(ground, ground));

  float core = exp(-t * t * 6.0);
  float ring = exp(-pow((t - 0.72) / 0.10, 2.0));

  // 環上跑一次光譜。spectralResponse 的三個瓣沒有歸一，除以最大分量才會是
  // 飽和的色相而不是一條偏暗的帶。
  vec3 hue = spectralResponse(clamp((t - 0.55) / 0.55, 0.0, 1.0));
  hue /= max(max(hue.r, max(hue.g, hue.b)), 0.001);
  vec3 rim = mix(vec3(1.0), hue, clamp(uStudioCausticChroma, 0.0, 1.0));

  return (vec3(core) * 0.65 + rim * ring * 1.5) * uStudioCaustic * front * reach;
}

// minEdge：棚景裡每一道邊（燈卡、黑旗、地平線）至少要有多寬（弧度，半寬）。
// soften 是按比例把邊放大，minEdge 是給一個絕對的下限 —— 光譜取樣要的是後者
// （見 spectralRefraction）：它要每道邊都追上相鄰波長之間的角距，而各道邊原本
// 的寬度差了好幾倍，用同一個倍率放大的話，最窄的地平線永遠追不上。
vec4 studioBackdropSampleEdge(vec3 origin, vec3 rd, float extraBlur, float cards,
                              float soften, float minEdge){
  vec4 paper = backgroundSample(rd, extraBlur);
  // HDRI 背景已經是有結構的環境，不需要也不該再蓋一層假棚景。
  if (uStudioBackdrop < 0.5 || uBgMode == 1) return paper;

  // 牆面抬底。深底的背景紙幾乎是純黑，而純黑乘上任何東西都還是黑 —— 地板、
  // 陰影全部會一起消失（前一版就是這樣，深底只剩一團黑玻璃）。加一個
  // 很小的絕對亮度，深底就變成「一張很暗的背景紙」而不是一個沒有光的空洞，
  // 這也是參考影片那支深底片子的實際樣子。淺底那邊 0.06 相對於 0.8 可以忽略。
  float wall = mix(0.35, 1.0, smoothstep(-0.35, 0.85, rd.y));
  vec3 col = paper.rgb + vec3(uStudioWallLift * wall);

  // 地板。只有往下走的射線會碰到；denom 的下限同時擋掉了近乎水平那些會把交點
  // 推到無窮遠的射線（那裡本來就該是地平線）。
  if (rd.y < -0.0005) {
    float tFloor = (uStudioFloorHeight - origin.y) / rd.y;
    if (tFloor > 0.0) {
      vec2 fp = (origin + rd * tFloor).xz;
      float dist = length(fp);

      // 接觸陰影。鏡頭直接看到的地板用真正的遮蔽測試，形狀才跟著造型走；
      // 折射與反射的取樣沿用高斯斑（見 studioGlassShadow 的說明）。
      //
      // 高斯斑的中心放在影子真正落下的地方：物體中心沿主光方向投到地板上。
      // 放在物體正下方的話，透過玻璃看到的影子跟旁邊直接看到的那一塊對不上 ——
      // 主光相當側向，兩者差了一大段。它也照玻璃的方式淡：中間透光，不是實心。
      vec3 floorPos = origin + rd * tFloor;
      vec3 keyDir = studioKeyDir();
      float keyOn = clamp(uLightKey.w, 0.0, 1.0);
      float shadowR = max(uStudioShadowRadius, 0.001);
      vec2 shadowCenter = uBounds.xz
        - keyDir.xz * ((uBounds.y - uStudioFloorHeight) / max(keyDir.y, 0.2));
      float blobDist = length(fp - shadowCenter);
      vec3 shadow = vec3(exp(-(blobDist * blobDist) / (shadowR * shadowR))
        * (1.0 - 0.6 * clamp(uTransmission, 0.0, 1.0)) * keyOn);
      vec3 caustic;
      if (cards < 0.5) {
        // 隨距離收掉。主光相當側向，純粹的幾何投影會把影子拖得又長又濃，畫面
        // 重心整個被拉走；而影子真正在講的是「物體就在這裡」，那件事只在物體
        // 附近成立。收掉遠端同時也讓 march 走不完的那一段完全看不到。
        float reach = smoothstep(shadowR * 14.0, shadowR * 5.0, dist);
        // reach 是 0（影子的有效範圍外）或射線確定碰不到物體時，下面的結果精確是 0，
        // 直接跳過 march（見 studioShadowPossible）。
        vec3 blobShadow = shadow;
        shadow = vec3(0.0);
        caustic = vec3(0.0);
#ifndef PROBE_STATIC_NO_SHADOW
        if (uStaticQualityTier >= 2) {
          // low 畫質：不 march，退回折射取樣那一份高斯斑與解析焦散。
          shadow = blobShadow;
          caustic = studioCaustics(floorPos);
#ifdef PROBE_STATIC_NO_OPT
        } else if (true) {
#else
        } else if (reach > 0.0 && studioShadowPossible(floorPos, keyDir)) {
#endif
          shadow = studioGlassShadow(floorPos, keyDir, caustic) * reach;
          caustic *= reach;
        }
#endif
      } else {
        caustic = studioCaustics(floorPos);
      }
      shadow *= uStudioShadowStrength;

      // 地板明度隨距離往牆面收斂，近處比牆暗、遠處接回去，地平線因此自己浮出來。
      float recede = smoothstep(2.0, 14.0, dist);
      // 同樣要有絕對亮度底，否則深底的地板一樣是黑的。
      vec3 floorCol = col * mix(uStudioFloorTone, 1.0, recede)
        + vec3(uStudioFloorLift * (1.0 - recede * 0.65));

      // 焦散跟陰影一樣是相對於地板本身的倍率。玻璃聚過來的是主光，落在深色的
      // 紙上就該暗、落在白紙上就該亮；前一版把它當絕對亮度加上去，深底的地板
      // 本身才零點一出頭，影子裡因此比沒被擋的地板還亮，整塊像一片發光的板子，
      // 淺底則反過來幾乎看不見。
      floorCol *= vec3(1.0) - shadow + caustic * (1.5 * (1.0 - recede * 0.5));

      // 地平線收得比以前緊。它是畫面裡最長的一條邊，玻璃把它折彎、分色之後
      // 就是輪廓上那幾條色帶的主要來源。
      float horizon = smoothstep(0.0,
        max(max(uStudioHorizonSoft, 0.001) * (1.0 + soften * 8.0), minEdge * 2.0), -rd.y);
      col = mix(col, floorCol, horizon);
    }
  }

  if (cards > 0.0) {
    // 柔光罩。棚拍的黑底不是一間沒有光的黑房間 —— 背景紙是黑的，但整個空間被
    // 大面積柔光填滿，物體因此有明暗、有輪廓。少了這一層，深底的玻璃會透到一片
    // 黑、也反射到一片黑，整顆就是黑的（實測過，只加棚燈卡救不回來：正視角的
    // Fresnel 只有 0.03，窄的高光撐不起一顆玻璃）。
    //
    // 用 screen 合成而不是 mix：淺底已經接近 1.0，mix 會把它往柔光罩的中灰拉、
    // 反而變暗；screen 只會往上加，兩種底色都安全。
    float sky = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 dome = vec3(mix(0.04, 0.30, sky)) * uStudioAmbient * cards;
    col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - clamp(dome, 0.0, 1.0));

    // 三張卡：主光、補光，加一條細長的邊光。邊緣銳利度由 uStudioCardEdge 控制 ——
    // 這根滑桿改的不是亮度而是「色散看不看得見」，推到 0 就只剩一團柔光，
    // 色帶會跟著消失。
    float soft = max(max(uStudioCardEdge, 0.004) * (1.0 + soften * 10.0), minEdge);
    float key  = studioSoftbox(rd, studioKeyDir(), radians(uLightKey.z), soft);
    float fill = studioSoftbox(rd, studioDir(uLightFill.xy), radians(uLightFill.z),
      soft * 2.2);
    float rim  = studioSoftbox(rd, studioDir(uLightRim.xy), radians(uLightRim.z), soft);
    // 相加而不是往白色 mix，而且刻意讓它超過 1。真正的柔光箱比背景紙亮一個
    // 數量級，被 mix 夾在 1.0 就等於「一張跟白紙一樣亮的燈」—— 那既打不出
    // 高光，也給不出飽和的色帶：色帶的飽和度就是背景那道邊的相對落差，落差
    // 只有兩成，顏色就只能淡兩成。超過 1 的部分留到合成時才壓（見 shaders.js
    // 的靜態合成），在那之前它是真的很亮。
    col += vec3(key * uLightKey.w + fill * uLightFill.w + rim * uLightRim.w)
      * uStudioCardStrength * uStudioCardGain * cards;

    // 黑旗（negative fill）。棚拍在白背景上拍玻璃就是靠這個：框外擺黑卡，讓
    // 玻璃有東西可以「反射出暗部」。
    //
    // 它同時是淺底色散飽和度的天花板所在。色帶的飽和度等於環境那道邊的相對
    // 落差，而白紙上的白燈只有兩成落差 —— 再怎麼加亮度都跨不過去，因為亮度
    // 是分子也是分母。黑旗把落差拉到接近 100%，色帶才能真的飽和。
    //
    // 只作用在折射與反射的取樣（cards > 0），所以背景紙照樣是乾淨的白，
    // 跟真正的黑旗一樣待在框外。
    if (uStudioFlag > 0.0) {
      float flag = studioCard(rd, studioDir(uFlagA.xy), radians(uFlagA.z), soft * 1.6);
      float flag2 = studioCard(rd, studioDir(uFlagB.xy), radians(uFlagB.z), soft * 1.6);
      col *= 1.0 - clamp((flag + flag2 * 0.7) * uStudioFlag * cards, 0.0, 0.96);
    }
  }

  return vec4(col, paper.a);
}

vec4 studioBackdropSample(vec3 origin, vec3 rd, float extraBlur, float cards, float soften){
  return studioBackdropSampleEdge(origin, rd, extraBlur, cards, soften, 0.0);
}

// ===== 霧面：OpenPBR specular_roughness =====
//
// 跟 OpenPBR／Blender 一樣是 GGX 微表面：α = roughness²。這條平方是面板上 0–0.3
// 幾乎還是清玻璃、大半的變化落在 0.5 以後的原因，也是換成這一套之後滑桿才有
// 那種「越後面越霧」的手感。
//
// 前一版把 roughness 線性乘進 soften，只是按比例把燈卡與地平線的邊放寬，拉滿
// 也才 14°，折射影像、地板影子、色帶全部還是清楚的 —— 0 到 1 看起來差不多。
// 這裡改成算出微表面把一條光線打散成多寬的錐，當成「每一道邊至少多寬」的絕對
// 下限（studioBackdropSampleEdge 的 minEdge），整個透過來的棚景一起糊。
//
// 錐的大小：GGX 法線分布裡含七成五能量的角度是 tan²θ = 3α²。光穿過玻璃要經過
// 兩個粗糙面，各自按折射把法線的歪斜換成方向的偏折：進去那一面偏
// θ − asin(sinθ/n)，出來那一面偏 asin(n·sinθ) − θ（超過臨界角就夾在切線）。
// 用完整的折射式而不是小角度近似 —— 法線歪到幾十度時兩者差很多，而那正是
// roughness 接近 1 的區間。兩面的偏折獨立，平方和開根號合起來。
float ggxLobeAngle(){
  float r = clamp(uRoughness, 0.0, 1.0);
  float alpha = r * r;
  return atan(1.7320508 * alpha);
}
float roughTransmissionEdge(){
  float theta = ggxLobeAngle();
  float n = max(uIOR, 1.0001);
  float s = sin(theta);
  float entry = theta - asin(clamp(s / n, 0.0, 1.0));
  float exit = asin(clamp(n * s, 0.0, 1.0)) - theta;
  return sqrt(entry * entry + max(exit, 0.0) * max(exit, 0.0));
}
// 反射的錐是法線錐的兩倍寬（入射角等於反射角，法線歪 θ，反射方向歪 2θ）。
// 上限 1.2 rad：再寬就是整個半球，棚景本來就只剩一片平均亮度了。
float roughReflectionEdge(){
  return min(2.0 * ggxLobeAngle(), 1.2);
}

// 霧面的另一半：把玻璃裡的結構也糊掉。
//
// roughTransmissionEdge 只糊得到「棚景的邊」。玻璃裡那些摺線、內部的方框、色帶
// 的邊界不是背景的邊，是相鄰像素的光線從不同的面出去 —— 那是幾何本身，撐寬
// 背景救不了。真正粗糙的玻璃會連它們一起糊掉，因為每條光線一進去就被打散到
// 不同方向、各自走不同的路；要照做就得每個像素重追好幾條光路，付不起。
//
// 近似：粗糙到一個程度之後，透過來的光接近「以視線為中心的一片散射」，看不出
// 折射的結構了。所以沿視線方向取一份很寬的棚景，按 GGX 的 α 混進來：
// 1 − e^(−3α) 在 roughness 0.25 約兩成、0.5 約五成、1.0 約九成五。色帶也跟著
// 淡掉 —— 粗糙的玻璃本來就不太打彩虹。roughness 為 0 時整段跳過，不多取樣。
vec3 frostedTransmission(vec3 refracted, vec3 exitPoint, vec3 rd, float roughBlur,
                         float studioSoften, float roughEdge){
  float r = clamp(uRoughness, 0.0, 1.0);
  float frost = 1.0 - exp(-3.0 * r * r);
  if (frost <= 0.002) return refracted;
  vec3 scattered = studioBackdropSampleEdge(
    exitPoint, rd, roughBlur, 1.0, studioSoften, max(roughEdge * 1.5, 0.35)
  ).rgb;
  return mix(refracted, scattered, frost);
}
// 光譜折射：沿著同一條已經追好的光路，逐波長重算兩次 refract()，取樣同一個
// 棚景再合回 RGB。
//
// 關鍵是這裡不重跑追蹤。色散的分離角只有零點幾度，出口點在那個角度差之內幾乎
// 不動，真正變的是出射方向 —— 所以入射點、入射法線、出口點、出口法線全部沿用
// 呼叫端那一次 traceExitSurface，N 個波長＝N 次背景取樣、零次額外 march。
// （舊版註解記錄過「五個波長各自穿過 SDF」太貴而被移除；那個結論沒錯，錯的是
// 「必須各自穿過」這個前提。）
//
// 已知的近似：發生全內反射彈跳時，出口面換成了第二個出口，而各波長仍用原始
// 視線與前表面法線入射。彈跳本來就只補一次，這一層近似在同一個量級。
// 一個波長的出射方向（見 spectralRefraction）。抽出來是因為迴圈之外還要多算
// 光譜兩端各一次，用來量相鄰波長之間錯開多少。
// 從玻璃內部沿 inBand 打到出口面 exitNormal 時的出射方向（折射與內反射按 Fresnel
// 連續混合）。主光路（spectralExitDir）與內部彈跳（spectralBounce）共用。
vec3 bandExitFromInside(vec3 inBand, vec3 exitNormal, float iorBand){
  vec3 outBand;
  vec3 bounced = normalize(reflect(inBand, exitNormal));
  vec3 o = refract(inBand, -exitNormal, iorBand);

  // 臨界角附近按 Fresnel 連續過渡，不要用「有沒有全內反射」當二元開關。
  //
  // 上一版是開關，而那會在畫面上切出硬邊：臨界角 θc = asin(1/n) 是一條等角
  // 線，在立方體的平面上就是直線，相鄰像素落在兩側時取到的是環境裡完全不同
  // 的兩塊 —— 表面因此被切成一塊塊三角形，而且色散開得越強越明顯（關掉色散
  // 就完全消失，這是分辨出來的）。
  //
  // 物理上本來就不是開關：透射的 Fresnel 係數在接近 θc 時連續趨近 0，同時
  // 折射方向連續轉向與表面相切，所以「按 R 混合兩個方向」在 θc 兩側是接得
  // 起來的 —— R 在那裡已經是 1，混出來就是內反射本身。用完整的 Fresnel
  // （s 與 p 偏振各半）而不是 Schlick 近似：Schlick 在臨界角附近正是誤差
  // 最大的地方，而這裡要的就是那一段。
  float cosI = clamp(abs(dot(inBand, exitNormal)), 0.0, 1.0);
  float sinT2 = iorBand * iorBand * (1.0 - cosI * cosI);
  float bandR = 1.0;
  if (sinT2 < 1.0) {
    float cosT = sqrt(1.0 - sinT2);
    float rs = (iorBand * cosI - cosT) / (iorBand * cosI + cosT);
    float rp = (cosI - iorBand * cosT) / (cosI + iorBand * cosT);
    bandR = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
  }
  outBand = dot(o, o) > 0.0001
    ? normalize(mix(normalize(o), bounced, bandR))
    : bounced;
  return outBand;
}
vec3 spectralExitDir(vec3 rd, vec3 N, vec3 exitNormal, vec3 exitDir, float iorBand){
  vec3 inBand = refract(rd, N, 1.0 / iorBand);
  if (dot(inBand, inBand) <= 0.0001) return exitDir;
  return bandExitFromInside(normalize(inBand), exitNormal, iorBand);
}

vec3 spectralRefraction(vec3 rd, vec3 N, vec3 exitNormal, vec3 exitPoint,
                        vec3 exitDir, float bandSpread, float roughBlur,
                        float studioSoften, float roughEdge){
#ifdef PROBE_STATIC_NO_SPECTRAL
  return studioBackdropSampleEdge(exitPoint, exitDir, roughBlur, 1.0, studioSoften, roughEdge).rgb;
#endif

  // 取樣之間要接得起來。光譜是連續的，但這裡只取 uSpectralSamples 個波長，每個
  // 波長各自折射出一份完整的棚景 —— 棚景的邊（燈卡、黑旗，尤其是地平線）是硬的，
  // 相鄰兩個波長的出射方向錯開得比那道邊寬的時候，畫面上就是十幾份錯開的邊疊在
  // 一起：一條一條分開的色帶，而不是連續的彩虹。色散開得越大、邊越硬，段落越明顯。
  //
  // 所以每個取樣裡的每道邊至少要跟「相鄰取樣之間的角距」一樣寬 —— 等於把每個
  // 取樣攤成它代表的那一小段波長，拼起來就是連續光譜的積分。跟 studioSoften 用
  // 像素 footprint 撐開邊是同一件事，這裡的 footprint 是光譜方向上的。只多兩次
  // refract 的算術，不多取樣。
  vec3 dirBlue = spectralExitDir(rd, N, exitNormal, exitDir, bandIOR(0.0, bandSpread));
  vec3 dirRed = spectralExitDir(rd, N, exitNormal, exitDir, bandIOR(1.0, bandSpread));
  // 取樣點在波段上的間距是 1/N（band = (i+0.5)/N），兩端之間的角距除以 N 就是它。
  float gap = length(dirRed - dirBlue) / max(float(staticSpectralSamples()), 1.0);
  // 上限：藍端接近全內反射時方向會轉向反射那一側，兩端的角距一下子變很大；
  // 不夾的話那一圈會整片糊掉，彩虹直接消失。0.25 rad ≈ 14°。
  // 霧面的錐跟這個取樣間距是兩回事，取大的那個：霧面糊掉的是整個影像（色帶
  // 也一起被抹平，粗糙的玻璃本來就不太打彩虹），不受上面那個 0.25 的限制。
  float minEdge = max(min(gap, 0.25), roughEdge);
  // 光譜兩端出去的方向幾乎一樣時，每個波長取到的都是同一個背景點，加權平均
  // 就等於取一次 —— 平行的入射面與出口面淨偏折是零（方體正對著看的大片平面
  // 就是這樣），這裡直接取一次，省下其餘的取樣。純效能優化，畫面不變。
#ifdef PROBE_STATIC_NO_OPT
  if (false) {
#else
  if (length(dirRed - dirBlue) < 1e-4) {
#endif
    return studioBackdropSampleEdge(exitPoint, normalize(dirBlue + dirRed), roughBlur, 1.0,
      studioSoften, minEdge).rgb;
  }

  // 每個像素把取樣點在自己那一格波長裡錯開一點（分層抖動）。
  //
  // 上面的 minEdge 只處理「棚景的邊」。另一個一樣會切出段落的來源是臨界角：
  // 每個波長的折射率不同，臨界角也不同，強色散時大半個表面都貼著臨界角，
  // 視線掃過去，十幾個波長一個接一個越過自己的臨界角 —— 每越過一個就是一階。
  // 那一階是光路本身的轉折，不是背景的邊，撐寬背景救不了。
  //
  // 取樣點固定在每格正中央的話，所有像素的階都對齊在同樣幾條等值線上，眼睛看到
  // 的就是一圈一圈的色帶。每個像素各自在格子裡錯開，階的位置就不再對齊，段落
  // 變成跟像素一樣細的顆粒，平均起來就是連續的光譜。用 interleaved gradient
  // noise 而不是白噪音：它在相鄰像素之間分布得很均勻，顆粒感低得多；而且它只看
  // 螢幕座標、不看時間，靜止的畫面不會閃。
  float bandJitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 spectralSum = vec3(0.0);
  vec3 weightSum = vec3(0.0);
  for (int i = 0; i < MAX_SPECTRAL_COMPILE; i++) {
    if (i >= staticSpectralSamples()) break;
    // band 0 = 藍端，1 = 紅端。折射率由 Cauchy 曲線決定（見 bandIOR）。
    float band = (float(i) + bandJitter) / float(staticSpectralSamples());
    float iorBand = bandIOR(band, bandSpread);
    vec3 outBand = spectralExitDir(rd, N, exitNormal, exitDir, iorBand);
    vec3 w = spectralResponse(band);
    spectralSum += studioBackdropSampleEdge(
      exitPoint, outBand, roughBlur, 1.0, studioSoften, minEdge
    ).rgb * w;
    weightSum += w;
  }
  // 逐通道除以權重和。這一步讓「背景是常數時結果精確等於那個常數」成為
  // 式子自己的性質，而不是靠參數調出來的：每個波長取到同一個值，加權
  // 平均把它原樣還原。也就是說彩虹只可能來自背景本身的梯度。
  return spectralSum / max(weightSum, vec3(1e-4));
        }

// 靜態模式的玻璃合成。
//
// 舊路徑對它是死路：唯一可達的材質是通用玻璃，它把 bgLum 歸零，而 uLightBackdrop
// 兩個底色都映射成 0，所以 brightBg 恆為 0，glassComposite 永遠只取 darkComposite
// —— 一個「自身能量疊在黑場上」的美術模型。那在黑底很漂亮，在淺底就是一層灰殼
// 蓋在背景前面。
//
// 這裡換成一般的玻璃排序：Fresnel 讓出去的部分留給反射，剩下的才是穿過來的背景
// （光譜已經在上游分好）。兩種底色共用同一個模型，因為掠射角的 Fresnel 自己會
// 讓輪廓變暗，正面則幾乎原樣透過去。
//
// transfer 回傳「光穿過這塊玻璃之後還剩多少」，也就是 over 合成裡的 (1 - alpha)，
// 去背輸出要用它反解 straight color。
// 內部彈跳的光譜版：光在第一個出口面反射回去、從第二個面出去，每個波長各算一次。
//
// 全內反射區（出口面反射率接近 1）裡，畫面幾乎全部來自這一條。它以前不分光
// （只取一次背景），而彈跳的比例改成完全由 Fresnel 決定之後，那一區的顏色就被
// 這一份沒有色散的結果整片蓋掉 —— 方體側面那幾塊藍與琥珀色就是這樣不見的。
// 物理上顏色本來就該在這條路上：全內反射的光不會從第一個面出去。
//
// 跟 spectralRefraction 同一個取巧：不重追，第二個出口點與法線沿用呼叫端那一次
// traceExitSurface，每個波長只重算入射、反射、出射三次方向。反射率低於 0.05 的
// 地方這一份只佔幾個百分點，就不分光，省下那 N 次取樣；那條分界上最多差出
// 5% × 色差，看不出來。
vec3 spectralBounce(vec3 rd, vec3 N, vec3 exitNormal, vec3 bouncePoint,
                    vec3 bounceNormal, vec3 bounceOut, float bandSpread, float backFres,
                    float roughBlur, float studioSoften, float roughEdge){
#ifdef PROBE_STATIC_NO_SPECTRAL_BOUNCE
  if (true) {
#else
  if (uStaticQualityTier >= 1 || bandSpread <= 0.0001 || uSpectralSamples <= 1
      || backFres < 0.05) {
#endif
    return studioBackdropSampleEdge(bouncePoint, bounceOut, roughBlur, 1.0,
      studioSoften, roughEdge).rgb;
  }
  // 跟 spectralRefraction 同一個捷徑：光譜兩端出去的方向幾乎一樣時只取一次。
  vec3 endBlue = bounceOut;
  vec3 endRed = bounceOut;
  for (int e = 0; e < 2; e++) {
    float iorEnd = bandIOR(float(e), bandSpread);
    vec3 inEnd = refract(rd, N, 1.0 / iorEnd);
    if (dot(inEnd, inEnd) <= 0.0001) continue;
    vec3 outEnd = bandExitFromInside(normalize(reflect(normalize(inEnd), exitNormal)),
      bounceNormal, iorEnd);
    if (e == 0) endBlue = outEnd; else endRed = outEnd;
  }
#ifdef PROBE_STATIC_NO_OPT
  if (false) {
#else
  if (length(endRed - endBlue) < 1e-4) {
#endif
    return studioBackdropSampleEdge(bouncePoint, normalize(endBlue + endRed), roughBlur, 1.0,
      studioSoften, roughEdge).rgb;
  }
  float bandJitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 spectralSum = vec3(0.0);
  vec3 weightSum = vec3(0.0);
  vec3 first = bounceOut;
  vec3 last = bounceOut;
  for (int i = 0; i < MAX_SPECTRAL_COMPILE; i++) {
    if (i >= staticSpectralSamples()) break;
    float band = (float(i) + bandJitter) / float(staticSpectralSamples());
    float iorBand = bandIOR(band, bandSpread);
    vec3 outBand = bounceOut;
    vec3 inBand = refract(rd, N, 1.0 / iorBand);
    if (dot(inBand, inBand) > 0.0001) {
      vec3 reflected = normalize(reflect(normalize(inBand), exitNormal));
      outBand = bandExitFromInside(reflected, bounceNormal, iorBand);
    }
    if (i == 0) first = outBand;
    last = outBand;
    vec3 w = spectralResponse(band);
    // 邊寬下限：跟主光路一樣要追上相鄰波長的角距（見 spectralRefraction），這裡
    // 用上一個樣本到這一個的距離估，不另外多算兩端。
    float gap = length(last - first) / max(float(i), 1.0);
    spectralSum += studioBackdropSampleEdge(bouncePoint, outBand, roughBlur, 1.0,
      studioSoften, max(min(gap, 0.25), roughEdge)).rgb * w;
    weightSum += w;
  }
  return spectralSum / max(weightSum, vec3(1e-4));
}

vec3 staticGlassShade(vec3 p, vec3 N, vec3 rd, vec3 refractedBg,
                      vec3 transmission, vec3 absorption, out vec3 transfer){
  float cosView = clamp(dot(N, -rd), 0.0, 1.0);
  float f0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
  float fresView = f0 + (1.0 - f0) * pow(1.0 - cosView, 5.0);
  // OpenPBR 的 specular_weight：F' = weight·F，範圍 0–1。反射拿走 F'，剩下的
  // (1 − F') 才進玻璃 —— 反射多一分、透射就少一分。前一版反射乘 uReflect（預設
  // 1.6）、透射卻只扣 (1 − F)，等於憑空多出六成反射光。
  float specWeight = clamp(uReflect, 0.0, 1.0);
  float fresSpec = specWeight * fresView;
  // OpenPBR 的 transmission_weight：T 的部分走透射，(1 − T) 交給底層（見下面的
  // baseLobe）。直接讀 uTransmission，不用傳進來的 transmission：那是舊的薄膜
  // 模型算的，已經乘過一次 (1 − reflectance)，再乘這裡的 (1 − F') 是同一筆
  // Fresnel 扣兩遍，整顆玻璃因此偏暗。
  //
  // 只扣入射面的 Fresnel：出口面的反射率已經用在方向的混合上了（見
  // staticExitDirection），再乘一次也是同一筆能量扣兩遍，掠射區會整片變暗。
  float transmissionWeight = clamp(uTransmission, 0.0, 1.0);
  transfer = vec3(transmissionWeight) * absorption * (1.0 - fresSpec);
  vec3 transmitted = refractedBg * transfer;
  // 底層：OpenPBR 裡 (1 − transmission_weight) 不是消失，而是交給 base 那一層
  // （漫射，顏色是 base_color，規格預設 0.8）。透射率調低的玻璃因此會變成乳白，
  // 而不是變暗。受光用一份很寬的棚景近似漫射的半球積分：沿法線取樣、邊寬撐到
  // 1.2 rad，跟 roughReflectionEdge 的上限同一個意思 —— 再寬就是整個半球。
  // 透射率為 1（靜態模組的預設）時整段跳過，不多取樣。
  vec3 baseLobe = vec3(0.0);
  if (transmissionWeight < 0.999) {
    const vec3 OPENPBR_BASE_COLOR = vec3(0.8);
    vec3 irradiance = studioBackdropSampleEdge(p, N, 0.0, 1.0, 0.0, 1.2).rgb;
    baseLobe = irradiance * OPENPBR_BASE_COLOR * (1.0 - transmissionWeight) * (1.0 - fresSpec);
  }
  // 反射必須來自同一個棚景。用 sampleReflection（HDRI／程序化棚燈）的話，反射
  // 與透射會來自兩個不同的場景，物體就對不上它所在的空間；深底更直接整顆變黑。
  //
  // 它也要量自己的 footprint。原本只傳粗糙度換算的
  // 常數 —— 而粗糙度預設是 0，等於完全沒有預濾波。黑旗與棚燈卡在反射裡的邊
  // 因此是硬的，曲面把它們壓縮之後就走樣成鋸齒（關掉黑旗，整張圖的高頻能量
  // 掉到 62%，是這麼量出來的）。
  //
  // 反射方向在曲率大的地方變化比折射還快（鏡射把法線的變化加倍），所以這一
  // 項不是可有可無的補強，而是同一件事在另一條路徑上。
  vec3 reflDir = reflect(rd, N);
  float reflSpread = length(dFdx(reflDir)) + length(dFdy(reflDir));
#ifdef PROBE_STATIC_NO_REFLECTION
  vec3 studioReflection = vec3(0.0);
#else
  vec3 studioReflection = studioBackdropSampleEdge(
    p, reflDir, uRoughness,
    1.0, reflSpread / (1.0 + reflSpread * 6.0) * 0.75, roughReflectionEdge()
  ).rgb * fresSpec;
#endif
  vec3 lit = transmitted + baseLobe + studioReflection;
  // HDR 輸出開著（後處理鏈在跑）時什麼都不壓：光暈是靠超過 1 的部分觸發的，
  // 在這裡先壓掉就等於把玻璃上最亮的那幾條交出去。
  if (uHdrOutput > 0.5) return lit;
  // 關掉後處理時自己收高光。棚燈卡是背景紙的好幾倍亮，原本只把「超過 1」的部分
  // 除回去，1 到 6 全部落在 0.86–1.0 之間，正對著燈的那一面就剪成一整片純白。
  //
  // 這裡改成一條有肩部的曲線：膝點以下原樣不動，以上用指數收斂到 1，但尾巴拉得
  // 夠長，燈卡的衰減在玻璃上才看得出漸層。膝點跟著背景紙走 —— 深底的紙很暗，
  // 膝點可以壓到 0.6，給高光留很大的空間；淺底的紙本身就接近 1，膝點抬到紙的
  // 上面，透射過來的背景紙才不會被壓灰、看起來比旁邊的紙暗一截。
  //
  // 曲線套在最大通道上、三個通道等比縮放：逐通道各壓一次的話，色帶裡很亮的紅與
  // 偏暗的藍會被壓向彼此，彩虹直接褪掉一半。
  float paper = dot(backgroundSample(rd, 0.0).rgb, vec3(0.2126, 0.7152, 0.0722));
  float knee = clamp(paper + 0.08, 0.5, 0.95);
  float peak = max(lit.r, max(lit.g, lit.b));
  if (peak <= knee) return lit;
  float room = 1.0 - knee;
  float mapped = knee + room * (1.0 - exp(-(peak - knee) / (room * 4.0)));
  return lit * (mapped / peak);
}

#endif // FEATURE_STATIC_GLASS

`;
