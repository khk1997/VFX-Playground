import {
  MOTION_DEFAULT_DOLLY, MOTION_PARAM_DEFAULTS, MOTION_TOGGLE_DEFAULTS,
  MOTION_COLOR_DEFAULTS,
} from './motions/registry.js?v=edge-tint-1';

/* ===== 參數 ===== */
export const DEFAULTS = {              // 數值滑桿
  // 淺底的體積強化：只壓低背光面與掠射面，正面透射保持乾淨。
  lightShow: 0.25,
  // 白底專屬的完整外觀控制。shader 只在 uLightBackdrop > 0 時讀取，Dark
  // 分支的公式與定案參數完全不受影響。
  lightClarity: 0.65,
  lightDepth: 0.30,
  lightCardStrength: 0.75,
  lightChroma: 0.58,
  // 淺底 icon 的獨立顯色（見 shaders.js 的 researchIconFilter）。只在底色情境為
  // 淺底時作用，深底一律不讀 —— 調這幾根動不到黑底的任何外觀。
  //
  // 濃度控制體積顯色，明暗反射卡獨立保留；邊緣集中微調輪廓帶寬度。
  lightIconClarity: 0.58,
  lightIconTint: 0.42,
  lightIconEdge: 5.2,
  lightIconRimStrength: 0.62,
  ...MOTION_PARAM_DEFAULTS,
  thickness: 250,
  thickVar: 400,
  noiseScale: 0.8,
  dispersion: 0.02,
  dispersionSeparation: 1.5,
  causticScale: 1.0,
  causticSharpness: 0.65,
  // 稜光光芒（見 shaders.js 的 prismBeamField）。取代原本走 Cauchy 曲線的物理
  // 分光：那條路每個 fragment 要多跑四次波長追蹤，換來的只是輪廓上一層很薄的
  // 邊緣分光。這一版是程序化的放射光束，零額外 raymarch。
  // 上限 32。加光走的是 1-exp(-x) 的飽和曲線，所以 4 遠不是天花板 —— 實測平均
  // 亮度到 32 都還在線性地往上走（4→56、16→82、32→105，全畫面只有個位數像素
  // 被截頂）。預設維持 4，只是把後面那段本來就存在、卻被滑桿擋住的範圍放出來。
  rayBeamIntensity: 4,
  // 色散的來源：三個顏色通道取樣同一個圖樣時的相位差。這是整個效果的靈魂，
  // 0 = 三通道同步（純白光束，完全沒有彩虹）。
  rayBeamSeparation: 0.04,
  // 圖樣的尺度與同心環密度。
  rayBeamZoom: 6,
  rayBeamRings: 0.5,
  // 流動速度：一個循環把格點晶格滑過幾個格子。0 = 完全靜止，負值 = 反向。
  // 必須是整數，否則循環接縫會跳（見 prismBeamField 的說明）。格子在球面上有
  // 幾十個，所以 1 就已經是很慢的流速。
  rayBeamSpeed: 0,
  // 亮點的收束程度：調高是細長的光針，調低是糊成一團的柔光。
  rayBeamGlow: 1,
  // 等亮度彩度調整。1 = 原樣，調高讓三通道的差異更明顯。
  rayBeamChroma: 1.5,
  // 光芒從哪個方向放射出來（球座標）。圖樣鋪滿整個方向球，這只決定極點在哪。
  rayBeamAzimuth: -54,
  rayBeamElevation: 0,
  // 折射強度：0 = 沿原視線取樣（環境直接透過去、不被造型扭曲），1 = 完全用
  // 折射後的出射方向（造型變成真正的透鏡）。
  rayBeamRefract: 1,
  // 兩個遮罩，寫法與虛擬光譜焦散一致：0 = 完全不限制。
  // Fresnel 把光芒往邊緣集中（跟內部的 lensing 同一個軸，見 shaders.js 的說明）。
  rayBeamFresnelMask: 0.33,
  // Noise 把規則的極座標晶格打散成參差斑塊，是這兩者裡比較有感的一個。
  rayBeamNoiseMask: 1,
  rayBeamNoiseScale: 1.6,
  spectralCausticIntensity: 3,
  spectralCausticFocus: 0.12,
  spectralCausticWidth: 0.42,
  spectralCausticLightSize: 0.33,
  spectralCausticDensity: 0.03,
  spectralCausticSoftness: 1,
  spectralCausticFilmSoften: 0,
  spectralCausticWarp: 0.57,
  spectralCausticSeparation: 0,
  // 把七色查找表沿環形方向模糊融合：0 = 保留色標間的硬邊界，1 = 色彩與
  // 邊界都糊成一片,近似對色標序列做一次很重的高斯模糊。純粹在 LUT 的
  // 建表階段做（見 buildSpectralCausticLUT）,不影響 shader 端的取樣邏輯。
  spectralCausticBlend: 0,
  spectralCausticBounce: 0.19,
  spectralCausticFlow: 0,
  spectralCausticFresnelMask: 1,
  spectralCausticNoiseMask: 1,
  spectralCausticNoiseScale: 2.5,
  spectralCausticAzimuth: 5,
  spectralCausticElevation: -19,
  spectralCausticHdri: 0.3,
  artThickness: 295,
  artThickVar: 130,
  artNoiseScale: 1.2,
  artPatternSpeed: 0.27,
  artGravity: 0.52,
  filmBlur: 1.00,
  saturation: 2,
  patternSpeed: 0.07,
  count: 2,
  radius: 0.4,
  viscosity: 0.78,
  surfaceTension: 0.82,
  inertiaDeform: 0.68,
  spread: 0.75,
  fresnel: 0.8,
  gravity: 1,
  // 粗糙度改成全域預設 0（原本 0.26）。這一條不做成「只有靜態模式」的覆寫，
  // 因為 roughness 屬於材質設定檔（MATERIAL_PROFILE_KEYS），跟動態模式記憶是
  // 兩套系統，同時掛會互相搶同一個控制項。
  //
  // 而且全域改成 0 反而更安全：粗糙度接上透射側之後（見 shaders.js 的
  // transmissionSpread），0.26 產生的模糊比改動前明顯得多；設成 0 時所有計算
  // 都退化成原式，其餘動態模式的外觀因此跟這次改動之前完全一致。
  roughness: 0,
  reflect: 1.6,
  transmission: 1.0,
  // 體積吸收的濃度。1 是這根滑桿出現以前寫死的值（見 shaders.js 的
  // volumeAbsorption），所以預設不動任何模式的外觀；往上拉是「同一坨液體更濃」
  // —— 光程長的地方變暗偏青、邊緣薄的地方仍然清透，那是眼睛判斷「這東西有
  // 厚度」的主要線索。
  absorb: 1,
  // 後處理。全部預設關閉（bloomEnabled 在 TOGGLE_DEFAULTS），關閉時整條鏈直接
  // 跳過，畫面逐位元等於加入後處理之前 —— 見 renderComposite。
  //
  // 門檻預設 1.0：後處理開著時主 shader 不再把輸出夾在 1（見 shaders.js 的
  // uHdrOutput），高於 1 的部分就是物理上「溢出來」的能量，門檻放在那裡取出的
  // 才是高光本身，而不是從正常畫面裡切一塊下來糊。
  // 曝光在後處理鏈的合成階段套用（在 tone map 之前、bloom 加進來之後），跟材質
  // 那根「材質曝光」不同：那一根改的是材質的能量，這一根改的是整張畫面。
  postExposure: 1,
  // 高光增益。只作用在接近上限的那一段（見 shaders.js 的 clampOutput），1 = 不動。
  highlightGain: 1,
  // 鏡頭與底片。三者都是 0 = 沒有這個效果，所以不另外開開關。
  postAberration: 0,
  // 對比與亮度是色調映射之後的調色（見 post.js 的合成 pass），跟「曝光」不同：
  // 曝光是場景端的乘法、會改變 bloom 門檻選到哪些地方，這兩根只動最後的畫面。
  postContrast: 1,
  postBrightness: 0,
  postGrain: 0,
  postGrainScale: 1.5,
  // 條紋光芒（Blender Glare 的 Streaks）。
  // 條數是「臂」的數量，不是軸數：濾波只沿著單一方向前進，一個方向長一條臂。
  streakCount: 4,
  streakAngle: 0,
  // 光芒長度 0–1。post.js 會在對數空間換算成每個取樣間距的衰減率（0.80–0.996），
  // 1 時光芒跨越整個畫面。
  streakLength: 0.45,
  streakChroma: 0.5,
  streakIntensity: 0.5,
  bloomThreshold: 1,
  bloomKnee: 0.5,
  // 進 bloom 之前的上限（EEVEE 也有這一根）。沒有它，一顆極亮的像素就能把整片
  // 光暈拉爆，使用者只能回頭壓門檻，結果是把正常畫面也倒進去糊。
  bloomClamp: 8,
  bloomIntensity: 0.6,
  bloomRadius: 0.7,
  materialExposure: 1,
  // 液態薄膜專用的低頻塑形：0 回到純透明膜，1 完整加入厚度暗部、膜褶遮蔽
  // 與非對稱反射卡。通用玻璃模式不讀取這個值。
  membraneDepth: 0.65,
  // 水的折射率約 1.33，玻璃約 1.5；預設維持原本水滴的手感，改高會讓邊緣
  // 反射（Fresnel）變強、折射彎曲角度變陡，看起來更像玻璃而不是水珠。
  ior: 1.33,
  hdriYaw: -45,
  hdriPitch: 20,
  hdriBlur: 0.21,
  envRefraction: 0,
  cameraDistance: 5.5,
  cameraRotationX: 9.7,
  cameraRotationY: 29.8,
  loopDuration: 12,
  wobble: 0.305,
  wobbleScale: 0.7,
  wobbleSpeed: 0.65,
  spin: 0.08,
  // 較快匯聚 + 較長停留：成形後的定格時間由 2.6 秒拉到 5.4 秒（12 秒循環），
  // 讓形狀本身而不是散開過程佔據大部分畫面。
  gatherDuration: 0.25,
  shapeDepth: 0.1,
  shapeSoftness: 0,
  shapeSoftnessB: 0,
  shapeEdgeBevel: 0.025,
  shapeLiquid: 0.1,
  shapeLiquidPosition: 2,
  shapeLiquidSize: 1.5,
  shapeLiquidSpeed: 1,
  shapeHold: 0.45,
  microCount: 14,
  // 定格呼吸：成形停留那段期間整顆造型的縮放幅度（0.05 = 最大脹到 105%）。
  // 0 = 維持舊版完全凍結的定格。
  holdBreath: 0.05,
  // 匯聚前自由飛行段的軌跡多樣性：0 = 全體同方向、同軌道平面（舊行為），
  // 1 = 約半數反向繞行、軌道平面散佈到 ±90°。
  formationVariety: 0.35,
  // 疊在成型波前的空間順序之上的隨機參差：0 = 完全照波前掃描的順序抵達，
  // 調高則愈來愈多水滴提早／延後脫隊。波前關閉時這個值改為控制舊的 h3 亂數
  // 錯開幅度（1 = 舊預設）。
  formationJitter: 0.35,
  // 微滴飛向目標途中的膨脹包絡：0 = 純粹由小長大，無膨脹；數值愈高，飛行中段
  // 愈明顯先脹大再收回原尺寸，模擬液體被擠聚時的張力感。兩端（尚未出發／已
  // 抵達）恆為 1，不影響定格時的最終外形。
  formationSwell: 0.18,
  // 匯聚/散開途中朝造型外側鼓起的弧線高度（同一套手法搬自 morph.js 的
  // morphArc）：0 = 直線飛向目標（舊行為），數值愈高，水滴愈像先被推擠鼓起
  // 再拉進造型，而不是憑空飄過去。兩端（自由飄浮／已定格）恆為 0。
  formationArc: 0.3,
  // 成型方式（見 motions/formation.js 的「成型波前」與 shaders.js 的 dissolveField）。
  // 這是形狀變形那組「消失方式」的反向版本：morph 是波掃過的地方消失，這裡是波
  // 掃過的地方才長出來，而且水滴的抵達順序跟波前讀同一把尺，所以形體是從水滴
  // 落定的地方長出來的，不是各自淡入。
  //   formationFrontOn  總開關。關掉退回舊的全域等距侵蝕（水滴照 h3 亂數抵達）。
  //   formationStagger  波前錯開：水滴的抵達時間依它在掃描軸上的位置差開多少。
  //                     0 = 全體同時抵達（波前退化成沒有寬度），愈高波掃得愈長。
  //   formationFront    波前形狀：0 平面掃描、1 從中心放射、2 螺旋。
  //   formationSpiral   螺旋的纏繞強度，只有 formationFront === 2 時有意義。
  //   formationWaveAngle 掃描方向（度，XY 平面）。
  //   formationNoise/formationNoiseScale  亂流：有機的參差邊緣。
  //   formationCell/formationCellScale    晶格：整塊整塊浮現的碎裂感。
  //   formationNeck/formationNeckWidth    前緣收頸：剛長出來的前緣先薄、往後補厚。
  //   formationCutBlend 切口本身的軟硬。0 是刀切。
  // （總開關 formationFrontOn 是布林，放在 TOGGLE_DEFAULTS 那邊。）
  formationStagger: 0.72,
  formationFront: 0,
  formationSpiral: 1,
  formationWaveAngle: 125,
  formationNoise: 0.45,
  formationNoiseScale: 1.5,
  formationCell: 0,
  formationCellScale: 4,
  formationNeck: 0.09,
  formationNeckWidth: 0.55,
  formationCutBlend: 0.08,
  // 穿梭環繞：每顆水滴的大小在這個範圍內隨機決定（乘在「水滴大小」滑桿上），
  // 上下限拉開才會看起來「好幾顆大小不一」，而不是差不多大的一團。
  weaveSizeMin: 0.1,
  weaveSizeMax: 0.25,
  // 穿梭環繞：飄浮幅度是整個晃動範圍的乘數（1 = 預設手感）；飄浮速度是晃動
  // 用的諧波倍率，只能是整數才能維持循環接縫不跳（跟 formationDropPosition
  // 自由段的「只用整數諧波」是同一個限制）。
  weaveDriftAmount: 1,
  weaveDriftSpeed: 1,
  // 繞行程度：0 = 舊行為（每顆水滴只在自己的表面錨點附近原地飄浮），
  // 1 = 繞著造型跑一整圈，途中會經過造型正面與背面（背面那段會被玻璃折射過去，
  // 這個模式最好看的畫面就在那裡）。中間值是兩條路徑的插值。
  weaveOrbit: 0.8,
  // 繞行軌跡的多樣性，跟 formationVariety 同一套手法但各自一根滑桿：
  // 0 = 全體同方向、同軌道平面，1 = 約半數反向、軌道平面散佈到 ±90°。
  weaveVariety: 0.55,
  // 水滴碰到造型時有多沾黏（乘在黏度上）。原本是寫死的 0.15，等於把這個引擎
  // 最強的 metaball 融合關掉、水滴永遠是清晰的球；開高會讓水滴貼上玻璃表面、
  // 拉出液橋再脫離。0.15 維持舊外觀。
  weaveCling: 0.15,
  // 形狀變形（見 motions/morph.js）。四段時間軸「定格 A → 變形 → 定格 B → 變形回」，
  // morphHold 是單邊定格佔循環的比例，剩下的對半分給兩趟變形。
  morphHold: 0.28,
  // 波前錯開：每顆水滴的出發時間依它在掃描軸上的位置差開多少。0 = 全體同時
  // 移動（看起來只是整個形狀抽動一下），調高才會讀成一道波掃過去。這是這個
  // 模式手感的關鍵參數。
  morphStagger: 0.82,
  // 掃描方向（度，XY 平面）。回程固定轉 90°，否則兩趟像同一段動畫正放再倒放。
  morphWaveAngle: 125,
  // 路徑往外凸多少。液體離開表面是「隆起 → 拉離」，直線插值看起來像瞬移。
  morphArc: 0.8,
  // 飛行途中那些水滴的大小加成。實體變形成立時，水滴的存在包絡本身已經是
  // 「飛行中才有」，這個值只調它們飛起來有多大。
  morphSwell: 0.5,
  // 切口本身的軟硬（送進 shader 的 uShapeCutBlend）。0 是刀切。
  morphCutBlend: 0.08,
  // 消失方式（見 shaders.js 的 dissolveField）。這四項都是往同一條消失場上疊，
  // 所以可以任意組合，不是互斥的選單。
  //   morphFront   波前形狀：0 平面掃描、1 從中心放射、2 螺旋。
  //   morphSpiral  螺旋的纏繞強度，只有 morphFront === 2 時有意義。
  //   morphNoise/morphNoiseScale   亂流：撕裂的有機邊緣，幅度大時碎成島嶼。
  //   morphCell/morphCellScale     晶格：整塊整塊剝落的碎裂感。
  //   morphNeck/morphNeckWidth     前緣收頸：斷開前先變薄收頸，液體的身分。
  morphFront: 0,
  morphSpiral: 1,
  morphNoise: 0.6,
  morphNoiseScale: 1.5,
  morphCell: 0,
  morphCellScale: 4,
  morphNeck: 0.12,
  morphNeckWidth: 0.55,
  // 果凍（見 motions/jelly.js）。一個循環戳幾下、每下晃幾回、以及晃動的幅度與
  // 衰減。戳擊次數與回彈次數都必須是整數，循環接縫才精確接得上。
  jellyPokes: 2,
  jellyBounces: 3,
  jellyAmount: 0.22,
  jellyDamping: 2.4,
  // 每次戳擊附帶的扭轉／側傾（度）。刻意小，主角是擠壓拉伸。預設不扭轉。
  jellyTwist: 0,
  // 落地彈跳（見 motions/hop.js）。果凍底下的第二條分支（jellyStyle === 'bounce'），
  // 經典落球彈跳：一圈裡跳 hopCount 次，一次比一次矮（每次乘上 hopDecay），最後
  // 貼地歸零、接回下一圈的第一跳。起跳負責位移與速度拉伸，果凍只在每次落地被
  // 撞出餘震——是「驅動」而不是「疊加」，所以這條路上果凍不跑自己的戳擊節奏。
  // 原地戳擊那條分支完全不碰這組參數。
  hopCount: 1,
  hopHeight: 0.6,
  hopDecay: 0.55,
  // 重力有多重（見 hop.js 的 arcLift）。2 = 真實的等加速度重力（拋物線）；
  // 調高＝頂點滯空更久、撞地更快更重；調低＝飄浮感。
  hopGravity: 3.5,
  hopAnticipation: 0.4,
  hopStretch: 0.25,
  hopSway: 0,
  // 融化（見 motions/melt.js）。滴落間隔要隨機、又要能無縫循環，靠的是「每顆水滴
  // 一個循環滴整數次」：頻率與相位偏移各自由雜湊決定，看起來雜亂，phase=0/1 卻同值。
  // 滴落頻率是每個循環的基準滴數，節奏差異讓各顆在這個基準上下錯開。
  meltRate: 3,
  meltRateVary: 0.6,
  // 水滴在底部形成／懸掛佔一次滴落的多少比例，剩下的都是墜落。
  meltHang: 0.35,
  // 懸掛時往下垂多少、脫離後墜落多遠。
  meltSag: 0.03,
  meltFall: 0.85,
  // 墜落到幾成才開始縮小。必須在墜落結束前收乾淨，否則水滴會帶著半徑跳回起點
  // ——「縮小到消失」不只是效果，是循環接縫的必要條件。
  meltShrink: 0.25,
  // 每滴大小落在這個範圍（乘在「水滴大小」上）。
  meltSizeMin: 0.1,
  meltSizeMax: 0.43,
  // 墜落時的水平擾動，避免同一個滴落點的水滴完全重疊成一直線。
  meltJitter: 0.04,
  // 底部取樣範圍：形狀高度的多少比例算「底部」，滴落點就從那一段裡挑。
  meltBand: 0.22,
  meltSeed: 0,
  // 水滴的形狀（見 melt.js 的 meltDeform）。懸掛時被重力拉長、上方收出一個頸；
  // 脫離後頸縮回，水滴在表面張力下彈動著收斂回接近球形。
  meltStretch: 0.3,
  meltNeck: 0.5,
  meltWobble: 0.5,
  // 崩解噴濺的時間軸拆成四段時長（見 shatterSegments）：靜止 → 蓄力 → 飛散 →
  // 重組。四個值是相對權重，正規化後填滿整個循環，所以任何組合都合法、不會出現
  // 「滑桿有數字但實際被夾住」的情形。崩解模式預設循環為 4 秒，四段權重
  // 1.1 / 0.5 / 0.4 / 2.0 合計正好也是 4，因此右側直接顯示實際秒數。
  shatterRest: 1.1,
  shatterFlight: 0.4,
  // 噴散運動拆成三軸（見 shatterTravel／shatterOffset）：散多遠、曲線多前傾、
  // 每顆差多少。減速預設 1.0 —— 真實的爆炸碎片會被空氣阻力拖慢，0 是舊版的等速。
  shatterRange: 0.3,
  shatterDecel: 1,
  shatterSpeedVary: 0.9,
  shatterGravity: 0,
  // 碎片在飛散途中縮小的比例（0 = 保持原大小飛到底）。
  shatterFade: 1,
  // 收尾：把碎片收回錨點、形狀重新長回來。這一段必須存在，phase=0/1 兩端才
  // 都是「完整形狀 + 零半徑碎片」，循環接縫不跳。
  shatterReform: 2.0,
  // 噴散亂數種子（見 shatterSeed）。0 是加這個參數之前的那一組飛散路徑。
  shatterSeed: 0,
  // 崩解切法（見 shatterAnchorSets）。換的是形狀被切成哪幾塊，跟 shatterSeed
  // 換飛散路徑是兩件不同的事。0 沿用共用錨點，不額外重算。
  shatterCut: 0,
  // 碎片彼此的大小差異（見 shatterFragmentRadius）。乘在各自的局部厚度上，
  // 所以調大只是讓大小更參差，不會讓任何一顆撐出輪廓。
  shatterVariety: 0.3,
  // 蓄力：炸開前形狀被內壓撐大的量（距離場的等距膨脹，單位同世界座標），
  // 以及這股力道累積多久。0 = 完全不蓄力，維持原本直接炸開。
  shatterCharge: 0.025,
  shatterChargeTime: 0.5,
  // 造型剛體動態（見 motions/shapeRigid.js）：讓匯入的 SVG/GLB 造型本身也有
  // 旋轉、呼吸縮放、上下浮動與擠壓拉伸，疊在既有的匯聚/散開時間軸之上。
  // 圈數決定循環內擺動幾次；ease 是二次諧波疊加比例，做出蓄力回彈的不對稱感。
  shapeMotionCycles: 1,
  shapeMotionEase: 0.3,
  // 三軸各自的旋轉幅度（度）；三軸共用同一條波形，只是振幅不同，疊起來是
  // 繞一根固定傾斜軸擺動。預設只給 Z 軸，跟加 X/Y 軸之前的畫面完全一致。
  shapeSpinX: 0,
  shapeSpinY: 0,
  shapeSpinZ: 10,
  shapeBreathe: 0.05,
  shapeBob: 0.08,
  shapeSquash: 0.35,
  // 第二組：只有形狀變形模式用得到，形狀 B 自己的旋轉／呼吸／浮動，跟上面
  // 那組（形狀 A）分開調。跟第一組共用「造型動態」總開關，開關本身不分組。
  // 預設值跟第一組不同（Y 軸旋轉、無 Z 軸），這樣沒調過的使用者切到形狀變形
  // 也能立刻看出兩顆形狀動得不一樣，而不是預設值剛好長得一樣看不出差別。
  shape2MotionCycles: 1,
  shape2MotionEase: 0.3,
  shape2SpinX: 0,
  shape2SpinY: 14,
  shape2SpinZ: 0,
  shape2Breathe: 0.05,
  shape2Bob: 0.08,
  shape2Squash: 0.35,
  // 形狀 A（來源）／形狀 B（變形目標）各自的大小倍率，1 = 原尺寸。兩者獨立，
  // 不共用同一個縮放，才能讓來源跟變形目標各自放大縮小。
  shapeAScale: 1,
  shapeBScale: 1,
};

// 走完整 SDF 匯聚管線（錨點、細節滴、負滴、體積交接）＋ 匯聚→停留→散開時間軸
// 的模式。目前只有「形狀匯聚」，但保留這個述詞是因為十幾處判斷讀的是「要不要跑
// 匯聚管線」而不是「是不是某個特定模式」，語意不同，日後加模式時也接得上。
//
// 舊的「脈動呼吸」曾是這裡的第二個成員：它共用整條管線，只把 formationAmount 換成
// 一條餘弦。但那條餘弦壓低的是「匯聚程度」，谷底等於把水滴又吐回去 —— 也就是形狀
// 匯聚 gather/release 兩段在做的事，只是沒有中間的定格。它沒有自己的敘事，等於一個
// 修飾器冒充模式，所以移除，把「呼吸」併進形狀匯聚的定格段（見 holdBreathSwell）。
export const isFormationMotion = motion => motion === 'formation';
// 「需要距離場」比「走匯聚→散開時間軸」範圍更廣：穿梭環繞與崩解噴濺也要
// 匯入/顯示同一顆形狀，只是不吸收水滴、也不走 gather/hold/release 那套編排。
// 判斷式與各模式的預設值現在都由 motions/registry.js 提供。
export const SELECT_DEFAULTS = {
  postToneMap: 'none',
  bgMode: 'color',
  // 淺底版本尚未定案，目前固定走既有深底材質路徑。
  backdrop: 'dark',
  materialStyle: 'universal',
  colorMode: 'spectral',
  motion: 'static',
  shapeSource: 'svg',
  shapeQuality: 'balanced',
  // 虛擬光譜焦散的空間 mapping。wave 保留既有 preset 外觀。
  spectralCausticMapping: 'wave',
  // 抗鋸齒程度：全螢幕 raymarch shader 沒有多邊形邊緣可以靠 MSAA 磨平（見 initGL
  // 建立 renderer 時關閉 antialias 的說明），畫面唯一能消鋸齒的手段是把渲染解析度
  // 拉高過顯示解析度、再讓瀏覽器縮小回去——也就是超取樣。這個滑桿控制的正是超取樣
  // 倍率，不是 MSAA。'medium'（×1）等於原本寫死的行為，不改預設觀感；非 Retina
  // 螢幕想要更平滑或效能吃緊的機器想換流暢度，可以自己往上或往下調。
  antialiasLevel: 'medium',
  jellyStyle: 'bounce',
  // 稜光光芒的打燈圖樣（見 shaders.js 的 prismBeamField）。grid 是原本唯一的
  // 那一種，其餘四種共用同一組座標與遮罩，只換亮度在方向球上的分布。
  rayBeamPattern: 'grid',
};
// 已移除的下拉選項 → 現存選項。用來讓舊的參數組合檔仍然打得開。選項本身必須還
// 留在 <select> 裡（標成 hidden），否則瀏覽器會在寫入當下就把 value 丟成空字串，
// 這裡根本讀不到原值。
export const LEGACY_SELECT_VALUES = {
  // split（舊鍵名 cinematic）是已經移除的「分裂」模式。這裡不是改名而是退路：
  // 舊的參數組合檔還打得開，只是會落在現存模式裡行為最接近的那個——安裝中同樣
  // 是「兩顆殼靠近／融合／分開」，而不是把使用者丟回一顆靜止的方體。
  motion: { cinematic: 'research', split: 'research', pulse: 'formation' },
  materialStyle: { glass: 'universal' },
};
export const TOGGLE_DEFAULTS = {
  edgeDropsEnabled: false,
  filmEnabled: false,
  dispersionEnabled: true,
  rayDispersionEnabled: true,
  spectralCausticEnabled: true,
  // 焦散是否影響對話泡 icon：關閉時 icon 所在像素完全跳過焦散運算，維持
  // 原本顏色；開啟時焦散改用 icon 自己的表面與法線（見 shaders.js 的
  // uSpectralCausticIconAffect）。
  spectralCausticIconAffect: true,
  // 前後拉伸（見下方 dolly 計算）。跟 count/radius/loopDuration 一樣按模式
  // 各自記憶，這裡只是進入畫面時的初始值。
  dollyEnabled: MOTION_DEFAULT_DOLLY[SELECT_DEFAULTS.motion],
  // 純粹是「這幀要不要算造型剛體動態」的開關，沒有對應 uniform——關閉時
  // shapeRigidMotion 直接回傳 null，各處的 applyShapeRigid 就地退化成恆等變換。
  shapeMotionOn: false,
  // 形狀匯聚的成型波前總開關（見 motions/formation.js 的「成型波前」）。關閉時
  // 退回舊的全域等距侵蝕，水滴也改回照 h3 亂數錯開抵達。
  formationFrontOn: true,
  // Bloom 總開關。關閉時 renderComposite 走原本那條「直接畫到輸出」的路，
  // 連 render target 都不會配置。
  bloomEnabled: false,
  streaksEnabled: false,
  // 模式自己宣告的布林參數（registry 的 type: 'toggle'）。面板控制項由
  // buildExtendedMotionControls 生成，其餘一切（綁定、存檔、重設）都跟上面
  // 這幾顆手寫的開關走同一條路。
  ...MOTION_TOGGLE_DEFAULTS,
};
// shader 的光譜座標由紫端（0）走向紅端（1）。七個色標固定等距，
// 讓每種彩虹顏色都能單獨編輯，同時保持色帶之間連續混色。
export const SPECTRAL_CAUSTIC_DEFAULTS = [
  '#52e6fc', '#40b3f9', '#3aa3e3', '#3fabf9', '#4dd8fb', '#3ba6f9', '#52e6fc',
];
export const COLOR_DEFAULTS  = {
  ...MOTION_COLOR_DEFAULTS,
  bgColor: '#000000',
  // 光暈的顏色。白 = 不染色。
  bloomTint: '#ffffff',
  // 液體本身的顏色（穿過參考厚度之後剩下的光，見 shaders.js 的
  // absorbCoefficient）。這個值配上濃度 ×1，算出來就是這兩個控制項出現以前
  // 寫死的吸收係數，所以預設外觀不變。
  absorbColor: '#68b2e7',
  // 淺底 icon 的體積色，與清透底色混合；明暗反射由材質獨立塑形。
  lightIconColor: '#d9f3ff',
  lightIconRimColor: '#3aa9df',
  // 淺底專屬的棚拍無縫背景紙漸層（見 shaders.js 的 backgroundSample）。只在
  // uLightBackdrop 為 1 時取代 bgColor，不受 bgMode/bgColor 影響，選淺底就是
  // 這個漸層。頂到底：近白 → 冷調柔灰，是常見的攝影棚無縫背景紙配色。
  lightBgGradientTop: '#ffffff',
  lightBgGradientBottom: '#c9ccd1',
  // 液態薄膜原本各自寫死一個偏藍紫色常數的 5 處，現在各自開一個選色器直接
  // 取代常數，選色器選什麼顏色，畫面上那一處就是那個顏色。預設值都是原本
  // 那個常數本身，維持改動前的外觀。
  membraneBaseColor: '#7a9ec7',
  membraneVeilColor: '#b8e6ff',
  membraneReflectionColor: '#94b8e6',
  membraneCardColor: '#94c7ff',
  membraneShadeColor: '#85b8e6',
  ...Object.fromEntries(SPECTRAL_CAUSTIC_DEFAULTS.map(
    (color, index) => [`spectralCausticCol${index}`, color],
  )),
};
