// 玻璃的體積吸收色：單色與靜態模組的漸層色。
//
// 吸收照比爾–朗伯：exp(-係數 × 濃度 × 光走過的長度)。單色時係數是常數，只要總
// 光程；漸層時係數隨位置變，所以每一段光路各自積分（glassTintDepth），累加成
// 「光學深度」再取 exp。主射線（shaders.js）與地板影子（environment.js）走同一組
// 函式，玻璃跟它的影子顏色才對得上。
//
// 混色混的是吸收係數，不是顏色本身：兩種染料各一半，就是各自濃度的一半疊在一起。
// 這樣「顏色 1 純白」時漸層是「從清透到有色」，而不是從白色混向某個顏色。
//
// 要調整的地方：
// - 漸層曲線：glassTintWeight（目前是位置 ± 柔和度一半的 smoothstep）。
// - 積分精度：glassTintDepth（Simpson 三點；柔和度很低、光路又剛好橫跨交界時才
//   看得出差別）。
// - 方向：glassTintAxisValue，跟 bubble/glass-tint.js 的 GLASS_TINT_MODES 對應。
//
// 排在 environment 前面，地板影子才用得到；uAbsorb／uAbsorbColor 在 shaders.js
// 的 uniform 區已經宣告過。
export const GLASS_TINT_GLSL = /* glsl */ `
// 選色器給的是「穿過參考厚度之後還剩下多少光」，換成每單位長度的吸收係數。
// 參考厚度 20 與兩端的 clamp 的理由見 shaders.js 體積吸收那段。
vec3 absorbCoefficientOf(vec3 color){
  return -log(clamp(color, 0.002, 0.999)) / 20.0;
}

#ifdef FEATURE_STUDIO_GLASS
uniform int   uGlassTintMode;           // 0 單色、1 上下、2 左右、3 前後
uniform vec3  uAbsorbColorB;            // 漸層的第二個顏色
uniform float uAbsorbGradientMid;       // 交界在範圍裡的位置（0–1）
uniform float uAbsorbGradientSoftness;  // 過渡帶佔範圍的比例（1 = 鋪滿整個範圍）
uniform vec3  uGlassTintMin;            // 造型的包圍盒（見 glass-tint.js 的 glassTintBox）
uniform vec3  uGlassTintMax;

// p 在漸層方向上的位置，0 = 顏色 1 那一端，1 = 顏色 2 那一端。上下是從上往下，
// 跟背景的「上方／下方」同一個讀法。
float glassTintAxisValue(vec3 p){
  vec3 span = max(uGlassTintMax - uGlassTintMin, vec3(1e-4));
  vec3 s = (p - uGlassTintMin) / span;
  if (uGlassTintMode == 1) return 1.0 - s.y;
  if (uGlassTintMode == 2) return s.x;
  return s.z;
}

float glassTintWeight(vec3 p){
  float halfBand = 0.5 * max(uAbsorbGradientSoftness, 0.02);
  return smoothstep(uAbsorbGradientMid - halfBand, uAbsorbGradientMid + halfBand,
    clamp(glassTintAxisValue(p), 0.0, 1.0));
}

vec3 glassAbsorbCoefficient(vec3 p){
  vec3 a = absorbCoefficientOf(uAbsorbColor);
  return mix(a, absorbCoefficientOf(uAbsorbColorB), glassTintWeight(p));
}

// 一段直線光路（from → to，長度 len）的光學深度，還沒乘濃度。len 跟兩點的距離
// 可以不一樣：內部彈跳那段是按反射率打過折的長度。
vec3 glassTintDepth(vec3 from, vec3 to, float len){
  if (uGlassTintMode == 0) return absorbCoefficientOf(uAbsorbColor) * len;
  vec3 mid = 0.5 * (from + to);
  return (glassAbsorbCoefficient(from) + 4.0 * glassAbsorbCoefficient(mid)
    + glassAbsorbCoefficient(to)) * (len / 6.0);
}

// 一段直線光路的穿透率（地板影子用）。單色時照原本的乘法順序算：換成
// (係數 × 長度) × 濃度，浮點捨入就會讓個別像素差 1/255。
vec3 glassSegmentAbsorption(vec3 from, vec3 to, float len){
  if (uGlassTintMode == 0) {
    return exp(-absorbCoefficientOf(uAbsorbColor) * max(uAbsorb, 0.0) * len);
  }
  return exp(-glassTintDepth(from, to, len) * max(uAbsorb, 0.0));
}

// 單色時照原本的式子算（逐位元不變）；漸層時用累加好的光學深度。
vec3 glassVolumeAbsorption(float pathLength, vec3 tintDepth){
  if (uGlassTintMode == 0) {
    return exp(-absorbCoefficientOf(uAbsorbColor) * max(uAbsorb, 0.0) * pathLength);
  }
  return exp(-tintDepth * max(uAbsorb, 0.0));
}
#else
vec3 glassVolumeAbsorption(float pathLength, vec3 tintDepth){
  return exp(-absorbCoefficientOf(uAbsorbColor) * max(uAbsorb, 0.0) * pathLength);
}
#endif
`;
