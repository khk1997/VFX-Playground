export const ENVIRONMENT_GLSL = `// ===== 程序化棚景（只有靜態模式編譯，見 FEATURE_STATIC_GLASS）=====
//
// 為什麼玻璃需要一個有結構的背景，而不只是換個底色：色散是「同一條視線的不同
// 波長落在背景的不同位置」，所以背景在那個角度差之內必須有東西不一樣。純色畫布
// 完全不看方向，三個波長取到同一個常數，相減恆為零 —— 這正是 traceExitSurface
// 之後那段註解記錄過的死路。垂直漸層好一點，但它是整張畫面最低頻的訊號，一個
// 波長差那麼小的角度掃過去，亮度差仍然在捨入誤差等級。
//
// 棚景補的就是這件事：地平線、地板、接觸陰影、漣漪與棚燈卡，每一項都在背景上
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
uniform float uStudioRipple;        // 地板漣漪振幅
uniform float uStudioRippleScale;   // 漣漪環的密度
uniform float uStudioCardStrength;  // 棚燈卡亮度
uniform float uStudioAmbient;       // 柔光罩強度（只作用於折射與反射取樣）
uniform float uStudioWallLift;      // 牆面的絕對亮度底（深底才看得出差別）
uniform float uStudioFloorLift;     // 地板的絕對亮度底
uniform float uStudioCardEdge;      // 棚燈卡邊緣的銳利度：越小邊越硬、色帶越明顯
uniform float uStudioCardGain;      // 棚燈卡相對背景紙的亮度倍率（可大於 1）
// OpenPBR: transmission_dispersion_abbe_number。越小色散越強（冕牌 59 / 火石 30 /
// 重火石 20）。
uniform float uDispersionAbbe;
uniform float uStudioCaustic;       // 焦散強度：光被玻璃聚到地板上的亮斑
uniform float uStudioCausticChroma; // 焦散外圈的彩度
uniform float uStudioFlag;          // 黑旗強度：框外的黑卡，專門用來在淺底製造對比
// ===== 光譜折射 =====
// OpenPBR: transmission_dispersion_scale。0 = 各波長同路，沒有色散。
uniform float uDispersionScale;
// 光譜取樣數。1 等於關閉；越多色帶越連續，但每一個都是一次背景取樣。
uniform int   uSpectralSamples;
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
  // 下限 1.02：折射率掉到 1 以下時 refract() 整個翻過來，掠射端會變成往外彎，
  // 畫面上是一圈突然反向的假邊。
  return max(uIOR + b * strength * (invL2 - INV_LD2), 1.02);
}

// 棚燈卡：方向球上的一塊圓盤，邊緣的銳利度自己控制。
//
// 為什麼要是「有邊的」而不是一團柔光：色散的顏色來自背景在一個很小的角度差內
// 的差異，所以平滑的漸層被分開之後仍然是平滑的漸層 —— 只會整片變淡，不會出現
// 色帶。要看到參考影片那種細而飽和的 ROYGBIV，環境裡必須有「邊」被拆開。柔光
// 板照亮物體、它的邊緣負責顯色，兩件事都需要。
// 主光方向。焦散必須跟棚燈卡讀同一個方向，否則地板上的亮斑會跟物體的高光
// 指向不同的光源，一眼就看得出是貼上去的。
vec3 studioKeyDir(){
  return normalize(vec3(-0.42, 0.52, 0.74));
}

float studioCard(vec3 rd, vec3 dir, float radius, float soft){
  float a = acos(clamp(dot(rd, dir), -1.0, 1.0));
  return 1.0 - smoothstep(radius - soft, radius + soft, a);
}

// soften：這條射線的 footprint 有多寬。0 = 直接看背景的那條（鏡頭射線，
// 一個像素就是一個方向），大於 0 = 穿過玻璃出去的那些。
//
// 為什麼需要它：玻璃把一大片立體角壓進幾個像素，單樣本折射打在硬邊上就會在
// 相鄰像素之間跳邊，色帶因此斷成碎斑 —— 參考影片裡是連續的緞帶。真正的解是
// 在錐內多重取樣，但那要乘上波長數，太貴。這裡改成把環境自己的邊按 footprint
// 攤開：結果等價於預濾波，成本是零（就是幾個 smoothstep 的區間變寬）。
// HDRI 那條路用 PMREM 的 mip 做同一件事，這是程序化棚景的對應版本。
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

vec4 studioBackdropSample(vec3 origin, vec3 rd, float extraBlur, float cards, float soften){
  vec4 paper = backgroundSample(rd, extraBlur);
  // HDRI 背景已經是有結構的環境，不需要也不該再蓋一層假棚景。
  if (uStudioBackdrop < 0.5 || uBgMode == 1) return paper;

  // 牆面抬底。深底的背景紙幾乎是純黑，而純黑乘上任何東西都還是黑 —— 地板、
  // 陰影、漣漪全部會一起消失（前一版就是這樣，深底只剩一團黑玻璃）。加一個
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

      // 接觸陰影：物體正下方最深，以高斯往外收。用平方距離而不是距離，邊界才
      // 不會有一圈看得出來的硬邊。
      float shadowR = max(uStudioShadowRadius, 0.001);
      float shadow = exp(-(dist * dist) / (shadowR * shadowR))
        * uStudioShadowStrength;

      // 地板明度隨距離往牆面收斂，近處比牆暗、遠處接回去，地平線因此自己浮出來。
      float recede = smoothstep(2.0, 14.0, dist);
      // 同樣要有絕對亮度底，否則深底的地板一樣是黑的。
      vec3 floorCol = col * mix(uStudioFloorTone, 1.0, recede)
        + vec3(uStudioFloorLift * (1.0 - recede * 0.65));

      // 漣漪。改成「細亮環」而不是正負起伏的正弦：pow 把波峰壓成一條窄帶，
      // 那是一條硬邊，正是色散顯色需要的東西；原本的正弦是平滑起伏，分光之後
      // 只會變淡。相位一個循環走整數圈，首尾精確接得回去。
      float phase = TAU * fract(uTime / max(uLoopDuration, 0.001));
      float wave = sin(dist * uStudioRippleScale - phase);
      float crest = pow(max(wave, 0.0), mix(7.0, 1.2, clamp(soften * 4.0, 0.0, 1.0)));
      floorCol += vec3(crest * uStudioRipple * exp(-dist * 0.75));
      floorCol *= (1.0 - shadow);
      // 焦散加在陰影之後：玻璃把光聚起來，所以亮核就長在自己的影子裡面 ——
      // 那個「暗斑中間有一塊更亮」正是玻璃與不透明物體最好認的差別。
      floorCol += studioCaustics(origin + rd * tFloor)
        * (1.0 - recede * 0.5);

      // 地平線收得比以前緊。它是畫面裡最長的一條邊，玻璃把它折彎、分色之後
      // 就是輪廓上那幾條色帶的主要來源。
      float horizon = smoothstep(0.0,
        max(uStudioHorizonSoft, 0.001) * (1.0 + soften * 8.0), -rd.y);
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
    float soft = max(uStudioCardEdge, 0.004) * (1.0 + soften * 10.0);
    float key  = studioCard(rd, normalize(vec3(-0.42, 0.52, 0.74)), 0.78, soft);
    float fill = studioCard(rd, normalize(vec3(0.76, 0.14, 0.63)), 0.70, soft * 2.2);
    float rim  = studioCard(rd, normalize(vec3(0.05, -0.30, -0.95)), 0.30, soft);
    // 相加而不是往白色 mix，而且刻意讓它超過 1。真正的柔光箱比背景紙亮一個
    // 數量級，被 mix 夾在 1.0 就等於「一張跟白紙一樣亮的燈」—— 那既打不出
    // 高光，也給不出飽和的色帶：色帶的飽和度就是背景那道邊的相對落差，落差
    // 只有兩成，顏色就只能淡兩成。超過 1 的部分留到合成時才壓（見 shaders.js
    // 的靜態合成），在那之前它是真的很亮。
    col += vec3(key + fill * 0.45 + rim * 0.7)
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
      float flag = studioCard(rd, normalize(vec3(0.34, -0.42, -0.84)), 0.68, soft * 1.6);
      float flag2 = studioCard(rd, normalize(vec3(-0.88, -0.12, 0.46)), 0.45, soft * 1.6);
      col *= 1.0 - clamp((flag + flag2 * 0.7) * uStudioFlag * cards, 0.0, 0.96);
    }
  }

  return vec4(col, paper.a);
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
vec3 spectralRefraction(vec3 rd, vec3 N, vec3 exitNormal, vec3 exitPoint,
                        vec3 exitDir, float bandSpread, float roughBlur,
                        float studioSoften){

  vec3 spectralSum = vec3(0.0);
  vec3 weightSum = vec3(0.0);
  for (int i = 0; i < MAX_SPECTRAL_COMPILE; i++) {
    if (i >= uSpectralSamples) break;
    // band 0 = 藍端，1 = 紅端。折射率由 Cauchy 曲線決定（見 bandIOR）。
    float band = (float(i) + 0.5) / float(uSpectralSamples);
    float iorBand = bandIOR(band, bandSpread);
    vec3 outBand = exitDir;
    vec3 inBand = refract(rd, N, 1.0 / iorBand);
    if (dot(inBand, inBand) > 0.0001) {
      inBand = normalize(inBand);
      vec3 o = refract(inBand, -exitNormal, iorBand);
      if (dot(o, o) > 0.0001) {
        outBand = normalize(o);
      } else {
        // 這個波長在出口面全內反射了。上一版在這裡退回參考出射方向，
        // 那正好把整個效果最強的地方抹掉：臨界角 θc = asin(1/n) 跟波長
        // 有關，所以掠射區一定存在一條「短波還過得去、長波已經反射
        // 回去」的分界，而 dθ_out/dθ_in 在那附近是發散的。兩側取到的
        // 是環境裡完全不同的兩塊，差異因此極大 —— 參考影片裡最飽和的
        // 那幾條細色帶就長在這條線上。讓它照實走內反射。
        outBand = normalize(reflect(inBand, exitNormal));
      }
    }
    vec3 w = spectralResponse(band);
    spectralSum += studioBackdropSample(
      exitPoint, outBand, roughBlur, 1.0, studioSoften
    ).rgb * w;
    weightSum += w;
  }
  // 逐通道除以權重和。這一步讓「背景是常數時結果精確等於那個常數」成為
  // 式子自己的性質，而不是靠參數調出來的：每個波長取到同一個值，加權
  // 平均把它原樣還原。也就是說彩虹只可能來自背景本身的梯度。
  return spectralSum / max(weightSum, vec3(1e-4));
        }

#endif // FEATURE_STATIC_GLASS

`;
