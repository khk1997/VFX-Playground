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
uniform vec4  uDrops[8];       // xyz：中心，w：半徑（CPU 每幀更新）
uniform vec4  uDropShape[8];   // xyz：形變主軸，w：體積守恆的縱向伸縮
uniform vec4  uDropPhysics[8]; // x：接觸壓平，y：形狀振盪，z：斷裂尖端，w：配對權重
uniform vec2  uElasticPair;    // 正在接觸／斷裂的水滴索引
uniform vec4  uSatellites[3];  // xyz：衛星滴中心，w：半徑（斷裂處的小滴串）
uniform float uSatelliteBlend; // 衛星滴與頸部的融合度：成形時高（相連），掐斷時→0（分離）
uniform vec4  uBounds;         // xyz：包圍球中心，w：半徑

uniform float uThickness;
uniform float uThickVar;
uniform float uNoiseScale;
uniform float uDispersion;
uniform float uFilmBlur;
uniform float uSaturation;
uniform float uFresnel;
uniform float uGravity;
uniform float uFlowSpeed;
uniform float uPatternSpeed;

uniform int       uColorMode;   // 0 光譜, 1 自訂漸層
uniform sampler2D uRampTex;      // 自訂漸層查找表（CPU 端依色標生成）

uniform int   uBgMode;      // 0 純色, 1 HDRI
uniform vec3  uBgColor;
uniform float uEnvRefraction;
uniform float uReflect;
uniform float uTransmission;
uniform float uMaterialExposure;
uniform float uRoughness;
uniform float uHdriYaw;
uniform float uHdriPitch;
uniform float uHdriBlur;
uniform sampler2D uEnvMap;
uniform sampler2D uPmremMap;
uniform int   uHasEnv;

#include <cube_uv_reflection_fragment>

const int   MAXN = 8;
const float IOR  = 1.33;
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
  if (uHasEnv == 1) return textureCubeUV(uPmremMap, rotateEnvDir(d), rough).rgb;
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
  return vec4(uBgColor, 1.0);
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

float mapScene(vec3 p){
  float d = 1e9;
  for (int i = 0; i < MAXN; i++){
    if (i >= uCount) break;
    float sphereD = dropletDistance(p, i);
    int pairA = int(uElasticPair.x + 0.5);
    int pairB = int(uElasticPair.y + 0.5);
    // 僅在事件期間、活動配對且接近表面時付出波紋成本。
    if (uElasticEvent.x > 0.0001 && (i == pairA || i == pairB) && abs(sphereD) < 0.3) {
      sphereD -= capillaryWave(p, i);
    }
    d = smin(d, sphereD, uViscosity);
  }
  // 衛星滴以「會釋放的 smin」與頸部相連：成形期 blend 高（細絲上的鼓包），
  // 掐斷時 blend→0，smin 退化為硬 min → 成為自由滴。
  for (int s = 0; s < 3; s++) {
    if (uSatellites[s].w > 0.001) {
      d = smin(d, length(p - uSatellites[s].xyz) - uSatellites[s].w, uSatelliteBlend);
    }
  }
  // 最大位移遠小於 0.25；遠離表面時略過 noise，不影響射線接近表面的安全性。
  if (uWobble > 0.001 && d < 0.25) {
    d += fbmFast(p * uWobbleScale + loopNoiseOffset(uWobbleSpeed)) * uWobble * 0.25;
  }
  return d;
}

vec3 calcNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0009;
  return normalize(
    k.xyy * mapScene(p + k.xyy * h) +
    k.yyx * mapScene(p + k.yyx * h) +
    k.yxy * mapScene(p + k.yxy * h) +
    k.xxx * mapScene(p + k.xxx * h));
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
    vec3 lambda = mix(vec3(550.0), vec3(650.0, 550.0, 450.0), uDispersion);
    vec3 phase = TAU * opd / lambda;
    // Gaussian 卷積 cosine 後的解析解，避免光譜模式增加三倍三角函數成本。
    vec3 sigma = TAU * blurNm / lambda;
    vec3 attenuation = exp(-0.5 * sigma * sigma);
    return 0.5 - 0.5 * cos(phase) * attenuation;
  }

  float freq = mix(0.4, 1.4, uDispersion);
  float phase = opd / 560.0 * freq;
  float phaseRadius = blurNm / 560.0 * freq;
  vec3 center = texture2D(uRampTex, vec2(fract(phase), 0.5)).rgb;
  vec3 lower = texture2D(uRampTex, vec2(fract(phase - phaseRadius), 0.5)).rgb;
  vec3 upper = texture2D(uRampTex, vec2(fract(phase + phaseRadius), 0.5)).rgb;
  return center * 0.5 + (lower + upper) * 0.25;
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
  float cosT = sqrt(max(0.0, 1.0 - (sinI / IOR) * (sinI / IOR)));
  float opd = 2.0 * IOR * thickness * cosT;

  vec3 interf = sampleFilmInterference(opd);

  float lum = dot(interf, vec3(0.3333));
  interf = mix(vec3(lum), interf, uSaturation);
  vec3 darkInterf = interf;

  interf = max(interf, vec3(0.0));

  // 水膜 F0 約 2%；藝術化邊緣光只增強掠射角，不會讓中心變成灰色實體。
  float f0 = pow((IOR - 1.0) / (IOR + 1.0), 2.0);
  float schlick = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
  float rim = pow(1.0 - cosTheta, 3.0) * uFresnel;
  float fres = mix(schlick, 1.0, clamp(rim * 0.28, 0.0, 0.82));

  // 干涉色是波長相關反射率；透射使用其互補值，白底仍能乾淨穿透。
  float filmAmount = clamp(0.035 + rim * 0.42, 0.0, 0.72);
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
  float tanHalfFov = 0.42; // fov ~46°：稍廣、加強近遠水滴的透視景深

  vec3 ro = uRot * vec3(0.0, 0.0, uCameraDistance);
  vec3 rd = uRot * normalize(vec3(uv * tanHalfFov, -1.0));

  vec4 bg = backgroundSample(rd);

  // 先裁掉沒有穿過水滴群包圍球的射線，避免背景畫素進入 raymarch。
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
  // 暗底逐項還原 commit 版；亮底使用透射顯色，中間依背景明度平滑混合。
  float bgLum = dot(bg.rgb, vec3(0.2126, 0.7152, 0.0722));
  float brightBg = smoothstep(0.45, 0.90, bgLum);
  vec3 darkComposite = mix(bg.rgb, material.darkColor, material.darkAlpha);

  // 亮底：追蹤水滴內部到背面，取得實際光程、背面 Fresnel 與折射方向。
  vec3 refractedBg = bg.rgb;
  vec3 volumeAbsorption = vec3(1.0);
  vec3 backFilmChroma = vec3(0.0);
  float backFres = 0.0;
  float backRim = 0.0;
  vec3 transmissionDir = rd;
  bool needsEnvironmentTransmission =
    uBgMode == 0 && uHasEnv == 1 && uEnvRefraction > 0.001;
  if (brightBg > 0.001 || needsEnvironmentTransmission) {
    vec3 insideDir = refract(rd, N, 1.0 / IOR);
    if (dot(insideDir, insideDir) > 0.0001) {
      transmissionDir = normalize(insideDir);
      vec3 exitPoint;
      vec3 exitNormal;
      float pathLength;
      if (traceExitSurface(p, normalize(insideDir), exitPoint, exitNormal, pathLength)) {
        insideDir = normalize(insideDir);
        float exitFacing = clamp(dot(exitNormal, insideDir), 0.0, 1.0);
        float f0 = pow((IOR - 1.0) / (IOR + 1.0), 2.0);
        backFres = f0 + (1.0 - f0) * pow(1.0 - exitFacing, 5.0);
        backRim = pow(1.0 - exitFacing, 3.0) * uFresnel;

        vec3 exitDir = refract(insideDir, -exitNormal, IOR);
        if (dot(exitDir, exitDir) < 0.0001) exitDir = rd;
        exitDir = normalize(exitDir);
        transmissionDir = exitDir;
        refractedBg = backgroundSample(exitDir).rgb;

        // 白色背景也保留極淡的虛擬棚燈漸層，讓折射方向產生可見形變。
        float bend = clamp(length(exitDir - rd) * 0.55 + backRim * 0.18, 0.0, 1.0);
        refractedBg *= mix(vec3(1.0), vec3(0.965, 0.985, 1.0), bend);
        volumeAbsorption = exp(-vec3(0.045, 0.018, 0.005) * pathLength);

        // 背面使用低成本 2-octave 厚度場，產生內部彩色折線與融合區層次。
        vec3 backFlow = loopNoiseOffset(uPatternSpeed);
        float backNoise = fbmFast(exitPoint * uNoiseScale + backFlow);
        float backThickness = uThickness + backNoise * uThickVar;
        float backTop = clamp(exitNormal.y * 0.5 + 0.5, 0.0, 1.0);
        backThickness -= pow(backTop, 2.5) * uGravity * uThickness * 0.95;
        backThickness = max(backThickness, 0.0);
        float backOpd = 2.0 * IOR * backThickness * max(exitFacing, 0.12);

        vec3 backInterf = sampleFilmInterference(backOpd);
        float backLum = dot(backInterf, vec3(0.2126, 0.7152, 0.0722));
        backInterf = mix(vec3(backLum), backInterf, uSaturation);
        backFilmChroma = clamp(
          backInterf - vec3(dot(backInterf, vec3(0.2126, 0.7152, 0.0722))),
          vec3(-0.65),
          vec3(0.65)
        );
      }
    }
  }
  // 純色只控制畫布；水滴內部獨立取樣同一張 HDRI。若背面追蹤未命中，
  // transmissionDir 會保留前表面的 Snell 折射方向，滑桿仍能穩定產生效果。
  if (uBgMode == 0 && uHasEnv == 1 && uEnvRefraction > 0.001) {
    vec3 envRefraction = sampleEnvironmentBackdrop(transmissionDir);
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
  if (needsEnvironmentTransmission) {
    vec3 darkRefraction = 1.0 - exp(
      -max(refractedBg, vec3(0.0)) * uMaterialExposure * 0.82
    );
    float centerMask = 1.0 - material.edgeFactor * 0.68;
    float darkRefractionWeight = (1.0 - brightBg) * centerMask * 0.34;
    darkComposite = 1.0
      - (1.0 - darkComposite) * (1.0 - darkRefraction * darkRefractionWeight);
  }
  vec3 finalColor = mix(darkComposite, brightComposite, brightBg);
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export { VERT, FRAG };
