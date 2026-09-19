export const ENVIRONMENT_GLSL = `// 環境：程序化棚燈（無 HDRI 時的預設反射來源）；rough 越大光斑越柔散
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
// 程序化棚景（見 shaders.js 的 uStudioBackdrop 那段說明）。只有靜態模式編它，
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
vec4 studioBackdropSample(vec3 origin, vec3 rd, float extraBlur, float cards){
  vec4 paper = backgroundSample(rd, extraBlur);
  // HDRI 背景已經是有結構的環境，不需要也不該再蓋一層假棚景。
  if (uStudioBackdrop < 0.5 || uBgMode == 1) return paper;

  vec3 col = paper.rgb;

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

      // 漣漪。振幅隨距離衰減（能量往外攤開），相位一個循環剛好走整數圈，所以
      // 首尾精確接得回去 —— 跟 loopNoiseOffset 同一個慣例。
      float phase = TAU * fract(uTime / max(uLoopDuration, 0.001));
      float rings = sin(dist * uStudioRippleScale - phase)
        * exp(-dist * 1.1) * uStudioRipple;

      // 地板明度隨距離往背景紙收斂。少了這一段，地板只是「整片乘一個常數的
      // 漸層」，跟牆面的漸層疊起來讀不出交界 —— 也就沒有地平線。有了它，近處
      // 的地板明顯比牆暗、遠處接回牆面，交界自己就浮出來了，而那條線正是
      // 折射影像裡最強的一段梯度。
      float recede = smoothstep(2.0, 14.0, dist);
      vec3 floorCol = paper.rgb * mix(uStudioFloorTone, 1.0, recede)
        * (1.0 - shadow) * (1.0 + rings);

      // 地平線：越接近水平越還原成背景紙，避免地板與紙之間出現一條硬邊。
      float horizon = smoothstep(0.0, max(uStudioHorizonSoft, 0.001), -rd.y);
      col = mix(paper.rgb, floorCol, horizon);
    }
  }

  // 棚燈卡。用 mix 往白色靠而不是相加：淺底已經接近 1.0，相加只會 clip 成一片
  // 死白，而 mix 在兩種底色上都還留得住形狀。
  //
  // 兩張都是大面積柔光板（smoothstep 的區間很寬），不是點光源。窄的高光在
  // 玻璃上只會變成幾顆亮點，撐不起形狀；柔光板才會在輪廓上拉出一條長的高光帶，
  // 而那條帶子正是玻璃讀得出曲面的地方 —— 也是彩虹最容易被看見的位置。
  if (cards > 0.0) {
    // 柔光罩。棚拍的黑底不是一間沒有光的黑房間 —— 背景紙是黑的，但整個空間被
    // 大面積柔光填滿，物體因此有明暗、有輪廓。少了這一層，深底的玻璃會透到一片
    // 黑、也反射到一片黑，整顆就是黑的（實測過，只加棚燈卡救不回來：正視角的
    // Fresnel 只有 0.03，窄的高光撐不起一顆玻璃）。
    //
    // 用 screen 合成而不是 mix：淺底已經接近 1.0，mix 會把它往柔光罩的中灰拉、
    // 反而變暗；screen 只會往上加，兩種底色都安全。
    float sky = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 dome = vec3(mix(0.05, 0.36, sky)) * uStudioAmbient * cards;
    col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - clamp(dome, 0.0, 1.0));

    float key = smoothstep(0.55, 0.99, dot(rd, normalize(vec3(-0.42, 0.52, 0.74))));
    float fill = smoothstep(0.38, 0.96, dot(rd, normalize(vec3(0.76, 0.14, 0.63))));
    col = mix(col, vec3(1.0), clamp(
      (key + fill * 0.5) * uStudioCardStrength * cards, 0.0, 1.0
    ));
  }

  return vec4(col, paper.a);
}
#endif // FEATURE_STATIC_GLASS

`;
