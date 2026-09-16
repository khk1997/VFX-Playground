export const GEOMETRY_GLSL = `// C2 cubic smooth-min：曲率也連續，避免高光暴露每顆水滴的融合邊界。
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
// Scene-space normals keep the palette attached to the geometry as the camera
// moves. atan's pole is faded out; its seam wraps continuously in the LUT.
vec3 researchBoundaryTint(
  sampler2D palette, vec3 normal, float edge, float bend,
  vec3 baseColor, float amount, float rotation, float focus
) {
  float radial = length(normal.xy);
  float angle = radial > 0.0001 ? atan(normal.y, normal.x) / TAU : 0.0;
  float phase = fract(angle - rotation / 360.0 + focus * bend * 0.12);
  vec3 color = texture2D(palette, vec2(phase, 0.5)).rgb;
  float boundary = smoothstep(0.025, 0.55, edge) * smoothstep(0.02, 0.22, radial);
  float weight = clamp(amount * boundary, 0.0, 1.0);
  // Mix transmission colors before taking log: layering colored absorption
  // coefficients would turn complementary neighboring colors muddy.
  return mix(baseColor, color, weight);
}

// A colored studio reflection for dark backdrops. Reuse optical depth so the
// palette follows curved, thick boundaries and fades with the actual icon hit.
// Keep bright white reflections and preserve the original result at zero strength.
vec3 researchDarkBoundaryReflection(vec3 surface, vec3 tint, float depth) {
  float peak = max(surface.r, max(surface.g, surface.b));
  float whiteHighlight = smoothstep(0.72, 1.15, min(surface.r, min(surface.g, surface.b)));
  float amount = (1.0 - exp(-max(depth, 0.0) * 3.0)) * (1.0 - whiteHighlight);
  vec3 reflectedTint = tint * (0.32 + min(peak, 1.0) * 0.68);
  vec3 colored = surface * mix(vec3(1.0), tint, 0.72)
    + reflectedTint * (vec3(1.0) - clamp(surface, 0.0, 1.0));
  return mix(surface, colored, clamp(amount, 0.0, 0.88));
}


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

vec2 researchIconDistances(vec3 p){
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
  return vec2(icons, researchBubbleMap(p, phase));
}

float researchIconMap(vec3 p){
  vec2 distances = researchIconDistances(p);
  return researchSmin(distances.x, distances.y, 0.012);
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

bool researchTraceIcon(vec3 ro, vec3 rd, float maxDistance, out vec3 hitPoint,
  out float iconWeight){
  iconWeight = 0.0;
  float t = 0.006;
  // 步數從 28 提到 40：下面的步進係數為了 smin 的頸部調得比較保守，同樣的步數
  // 走不完整條弦，遠端那顆 icon 會整個消失。
  for (int i = 0; i < 40; i++) {
    hitPoint = ro + rd * t;
    vec2 distances = researchIconDistances(hitPoint);
    float d = researchSmin(distances.x, distances.y, 0.012);
    if (d < 0.0012) {
      // 直接使用本次追蹤已算出的距離分辨對話泡與小氣泡，不多追一條射線。
      iconWeight = smoothstep(-0.012, 0.012, distances.y - distances.x);
      return true;
    }
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
    // 每滴融合權重目前所有模式都固定為 1；通道留著是因為 uDropPhysics 的
    // 其餘三格（壓平／振盪／尖端）仍在用，而且 authored 的擴充模式可以寫它。
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
`;
