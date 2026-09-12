export const OPTICS_GLSL = `// ===== 法線路徑：兩條路徑共用一個迴圈 =====
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

vec3 separateSpectrum(vec3 spectrum, float separationControl){
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
  float separation = separationControl * (1.0 - transmissionSpread() * 0.65);
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

`;
