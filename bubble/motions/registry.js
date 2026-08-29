'use strict';

// 動態模式的單一資料來源。
//
// 這些欄位原本散在 bubble.js 的六張表裡（SHAPE_MOTIONS、motionCounts、
// motionRadius、motionLoopDuration、SELECTS.motion.map、GATES），新增一個模式
// 得同時改六個地方、漏一個就是難查的錯。集中之後，「加一個模式」在這個檔案裡
// 就是加一筆，行為本身則放在各自的 motions/<name>.js。
//
// 欄位說明：
//   uniform        shader 的 uMotion 值。歷史編號有跳號（2 曾是已移除的脈動呼吸），
//                  沿用原值以免既有參數組合檔對不上。
//   usesShapeField 要不要匯入／顯示 SVG/GLB 形狀。比「走匯聚時間軸」範圍更廣：
//                  穿梭環繞與崩解噴濺也要同一顆形狀，只是不吸收水滴。
//   gate           UI 面板的 data-gate 值，決定哪些參數列在這個模式顯示。
//   count/radius/loopDuration/dolly
//                  該模式的預設值。這幾項按模式各自記憶——使用者在某個模式下
//                  調過的值會保留，切回來時恢復，只有初始預設不同。
//   svgDemo        使用者還沒自己匯入 SVG 時，這個模式該顯示哪個內建展示形狀
//                  （見 default-shapes.js）。只有需要形狀的模式才有意義。值取的是
//                  形狀本身的名字（question／ice），不是模式名——同一顆形狀可能
//                  被多個模式共用，用模式名當值會誤導。
//   overrides      稀疏表：「擠出外形／輪廓液滴」那組參數（shapeDepth、
//                  edgeDropsEnabled…）原本是全域共用一份 DEFAULTS，只有某個
//                  模式需要不一樣的預設時才在這裡列一筆，沒列到的鍵繼續沿用
//                  共用預設。跟 count/radius/loopDuration/dolly 不同——那三項
//                  是「每個模式的值天生就不一樣」，這裡是「大多數模式相同，
//                  少數模式需要覆寫」，不必為了一個模式的特例把同樣的數字
//                  在五個模式裡各抄一次。
export const MOTIONS = {
  static: {
    label: '靜態 Static',
    uniform: 8,
    // 「匯入 SVG／GLB」選項要借用形狀匯聚那整套匯入／烘焙管線，所以跟毛細波
    // 一樣一律開著；沒選匯入時（staticShape 0-6）shader 端會直接跳過形狀場，
    // 改走程序化 SDF（見 shaders.js 的 FEATURE_STATIC_SHAPE），不會兩個一起畫。
    usesShapeField: true,
    gate: 'static',
    // 沒有水滴、沒有動態——純粹展示材質本身在一個簡單體積上的樣子。
    count: 0,
    radius: 0.24,
    loopDuration: 4,
    dolly: false,
    svgDemo: 'question',
    // 這是進入模組後看到的第一個畫面，所以整組數值是實際調出來、存成參數檔之後
    // 搬過來的，不是隨手填的。材質底子沿用毛細波那組（通用玻璃 + 稜光棚燈），
    // 其餘為這顆landing 畫面各自調整。
    overrides: {
      materialStyle: 'universal',
      rayBeamIntensity: 13.5,
      rayBeamSeparation: 0.065,
      rayBeamChroma: 1.3,
      rayBeamZoom: 5,
      rayBeamFresnelMask: 0.8,
      rayBeamNoiseScale: 0.5,
      spectralCausticEnabled: false,
      dispersionEnabled: false,
      cameraDistance: 6.8,
      cameraRotationX: -40.4,
      cameraRotationY: 47.7,
      // 靜止的展示畫面，鏡頭不自己繞。
      spin: 0,
      // 表面帶一層很淡的 Wave 波紋（0 = Wave）。這裡的用法跟毛細波模式不同：
      // 那邊波紋是主角，這邊只是讓幾何體表面不要平得像一塊塑膠，所以振幅小、
      // 環數少、速度慢。四個值都按模式記憶，不會汙染毛細波自己的設定。
      capillaryTexture: 0,
      capillaryHeight: 0.11,
      capillaryRings: 2,
      capillarySpeed: 1,
    },
    // 幾何選項用數字枚舉（不是字串），這樣才能沿用 bindControls 既有的「數值
    // 滑桿／數字型 select 一律 parseFloat」那條路徑，不必為了一個字串型 select
    // 額外開一條特例（毛細波的 capillaryField／capillaryTexture 也是同樣理由
    // 用數字枚舉）。0 方體、1 平面、2 圓盤、3 球體、4 圓柱、5 圓錐、6 圓環、
    // 7 匯入——7 是唯一會讓 shader 改吃形狀場貼圖、而不是程序化 SDF 的值。
    params: [
      {
        key: 'staticShape', label: '幾何形狀', type: 'select', value: 0,
        options: [
          { value: 0, label: '方體 Cube' },
          { value: 1, label: '平面 Plane' },
          { value: 2, label: '圓盤 Circle' },
          { value: 3, label: '球體 UV/Ico Sphere' },
          { value: 4, label: '圓柱 Cylinder' },
          { value: 5, label: '圓錐 Cone' },
          { value: 6, label: '圓環 Torus' },
          { value: 7, label: '匯入 SVG／GLB…' },
        ],
      },
      {
        key: 'boxSize', label: '方塊大小', min: 0.3, max: 1.2, step: 0.01, value: 0.75,
        gate: 'staticShapeBox',
      },
      {
        key: 'boxCornerRadius', label: '圓角', min: 0, max: 0.4, step: 0.005, value: 0.12,
        gate: 'staticShapeBox',
      },
      {
        key: 'primitiveSize', label: '尺寸', min: 0.2, max: 1.2, step: 0.01, value: 0.6,
        gate: 'staticShapePrimitive',
      },
      {
        key: 'primitiveHeight', label: '高度', min: 0.2, max: 1.6, step: 0.01, value: 0.75,
        gate: 'staticShapeCylOrCone',
      },
      {
        key: 'primitiveTubeRatio', label: '管徑比例', min: 0.1, max: 0.6, step: 0.01, value: 0.35,
        gate: 'staticShapeTorus',
      },
    ],
  },
  split: {
    label: '分裂 Split',
    uniform: 0,
    usesShapeField: false,
    gate: 'split',
    count: 2,
    radius: 0.4,
    loopDuration: 12,
    dolly: false,
  },
  research: {
    label: '私語 Whisper',
    uniform: 9,
    usesShapeField: false,
    gate: 'research',
    count: 1,
    radius: 0.76,
    loopDuration: 4.5,
    dolly: false,
    overrides: {
      materialStyle: 'universal',
      cameraDistance: 4.8,
      spin: 0,
      wobble: 0.05,
      // 外殼起伏定格。這個模式的主角是內部那兩顆 icon，外殼再自己流動會搶掉
      // 注意力；wobble 保留（起伏的「形狀」還在），只把時間項關掉。
      wobbleSpeed: 0,
      viscosity: 0.82,
      surfaceTension: 0.92,
      // 以下整組材質與 RAY 色散是這個模式的指定外觀，逐項寫死而不是只列出
      // 與全域 DEFAULTS 不同的幾個 —— 全域預設之後若被調動，這裡不該跟著漂。
      transmission: 1,
      reflect: 1.6,
      materialExposure: 1,
      roughness: 0.16,
      fresnel: 0.45,
      ior: 1.17,
      rayDispersionEnabled: true,
      rayBeamPattern: 'grid',
      rayBeamIntensity: 17.55,
      rayBeamSeparation: 0.055,
      rayBeamChroma: 1.5,
      rayBeamZoom: 6,
      rayBeamRings: 2.5,
      rayBeamGlow: 1,
      rayBeamSpeed: 0,
      rayBeamAzimuth: -54,
      rayBeamElevation: 0,
      rayBeamRefract: 1,
      rayBeamFresnelMask: 0.57,
      rayBeamNoiseMask: 1,
      rayBeamNoiseScale: 0.7,
      spectralCausticEnabled: false,
      dispersionEnabled: true,
      dispersionSeparation: 0.24,
    },
    params: [
      {
        // 0-6 跟毛細波的「程序紋理」是同一份詞彙與數學(見 shaders.js 的
        // researchProceduralTexture),只是餵進去的座標換成外殼自己的球面
        // 方向,而不是毛細波的行進方向場。7-9 是三種自創動態(駐波/湍流/脈動,
        // 見 researchShellStanding/Turbulence/Pulse),跟前面七種並存,不是
        // 取代關係。「起伏大小」「起伏速度」「起伏密度」三根滑桿全部十種共用,
        // 語意依各自的公式解讀。
        //
        // 「無」用 6 而不是插在 0——理由跟毛細波那份保留註解一樣:0–5 的編號
        // 用意是「跟毛細波的 capillaryTexture 值一一對應」，方便理解，不是
        // 因為有舊檔案相容性負擔（這是全新參數）。
        key: 'researchShellTexture', label: '程序紋理', type: 'select', value: 0,
        options: [
          { value: 6, label: '無' },
          { value: 0, label: 'Wave' },
          { value: 1, label: 'Noise' },
          { value: 2, label: 'Voronoi' },
          { value: 3, label: 'Gabor' },
          { value: 4, label: 'Gradient' },
          { value: 5, label: 'Magic' },
          { value: 7, label: '駐波 Standing Wave' },
          { value: 8, label: '湍流 Turbulence' },
          { value: 9, label: '脈動 Pulse' },
        ],
      },
      {
        key: 'researchShellAmount', label: '外殼起伏大小',
        min: 0, max: 0.08, step: 0.001, value: 0.04,
      },
      {
        key: 'researchShellSpeed', label: '外殼起伏速度',
        min: 0, max: 4, step: 1, value: 1,
      },
      {
        key: 'researchShellDensity', label: '外殼起伏密度',
        min: 0.4, max: 2.2, step: 0.05, value: 0.5,
      },
      {
        key: 'researchBreath', label: '整體呼吸幅度',
        min: 0, max: 0.06, step: 0.001, value: 0.02,
      },
      {
        // 這是內部 icon「相對於外殼玻璃」的折射率，不是絕對值，所以它會跟著
        // 材質那根 IOR 滑桿一起走。1 代表與外殼完全相同 —— 光學上分辨不出來，
        // icon 會直接消失，因此下限留在 1.02 而不是 1。
        key: 'researchIconIOR', label: 'icon 折射率(相對外殼)',
        min: 1.02, max: 2.2, step: 0.01, value: 1.2,
      },
      {
        // 兩顆各自給一根，而不是「大小 + 差異比」那種間接參數化：這是美術調校，
        // 直接操作比換算好用。
        //
        // 下限 0.2 是算出來的，不是隨手填：本體最短半軸是 0.120 × size，拉伸時
        // 還要再乘約 0.8，而它必須維持在 researchIconNormal 的取樣間距
        // （h = 0.0018）的 8 倍以上，否則中央差分算出來的法線是噪音而不是梯度
        // ——那正是先前 icon 剛冒出來時滿是同心紋路的成因。臨界值約 0.15。
        key: 'researchIconSizeA', label: 'icon A 大小(右)',
        min: 0.2, max: 1.6, step: 0.01, value: 1.14,
      },
      {
        key: 'researchIconSizeB', label: 'icon B 大小(左)',
        min: 0.2, max: 1.6, step: 0.01, value: 1.12,
      },
      {
        // 0 = 圓鈍，1 = 相當尖。不做到真正的針尖：尾端半徑同樣不能細過取樣間距，
        // 所以對應的錐體末端半徑只從 0.055 收到 0.010（世界尺度約 0.008，仍是
        // h 的 4.5 倍）。
        key: 'researchIconTailTip', label: '尾巴尖度',
        min: 0, max: 1, step: 0.01, value: 1,
      },
      {
        // 本體的寬高比。1.0 是正圓,越大越扁寬。
        //
        // 預設從原本的 1.10 改成 1.45:接近正圓時讀起來是「一顆泡泡」,橫向拉開
        // 才讀得出「對話框」—— 寬度是承載「裡面裝著話」這個意義的地方。
        // 厚度(z)不跟著變,維持扁平的玻璃片感。
        key: 'researchIconAspect', label: '本體扁度',
        min: 1.0, max: 1.9, step: 0.01, value: 1.5,
      },
      {
        // 兩顆對稱移動。開「間距 + 高度錯位」兩根，而不是每顆各給 X/Y 四根：
        // 面板已經很長，而實務上要調的就是「離多開」與「錯多少」。真的需要單獨
        // 挪某一顆再加。Z 軸不開——透過外殼折射幾乎看不出差別。
        key: 'researchIconSpread', label: 'icon 間距',
        min: 0.05, max: 0.45, step: 0.005, value: 0.31,
      },
      {
        key: 'researchIconStagger', label: 'icon 高度錯位',
        min: -0.3, max: 0.3, step: 0.005, value: -0.14,
      },
      {
        // 前後(z)錯位。我先前判斷「透過外殼折射幾乎看不出差別」而沒有開這一根,
        // 那個判斷太武斷:外殼本身就是一片厚透鏡,z 一動,放大率、前方玻璃的
        // 體積吸收、以及兩顆互相的遮擋順序都會跟著變,是讀得出來的。
        key: 'researchIconDepth', label: 'icon 前後錯位',
        min: -0.3, max: 0.3, step: 0.005, value: 0.2,
      },
    ],
  },
  typewriter: {
    label: '打字 Typewriter',
    uniform: 10,
    // 字形不走 SVG／GLB 那條匯入管線，而是自己烘一份字形圖集
    // （glyph-field.js）——每個字要能獨立動畫，整句話烘成一張距離場做不到。
    usesShapeField: false,
    gate: 'typewriter',
    // 字本身就是玻璃主體，不需要 metaball 主滴。使用者想加幾顆當「墨滴」仍然
    // 可以拉高，那些水滴會照一般模式繞著行走。
    count: 0,
    radius: 0.24,
    // 這個模式的循環秒數是由下面四段時間軸的總和推導出來的（見 bubble.js 的
    // syncTypewriterLoopDuration），這裡的值只是切進模式那一幀還沒算出來之前
    // 的占位，實際會在同一幀被覆寫掉。
    loopDuration: 8,
    dolly: false,
    overrides: {
      materialStyle: 'universal',
      // 使用者實測後定案的一整組外觀預設（2026-08-27 存檔匯入）。鏡頭改成斜一點
      // 是刻意的——第一版鏡頭幾乎正對著字，擠出字的正面與背面是兩片平行平面，
      // 平行界面幾乎不折射，只有輪廓那一圈有玻璃感、中間讀起來像描邊；斜一點
      // 才看得到側壁，厚度才變成看得見的東西。
      cameraDistance: 5.1,
      cameraRotationX: 0.2,
      cameraRotationY: 23.2,
      antialiasLevel: 'ultra',
      // 字要看得清楚，鏡頭不繞、表面不晃。
      spin: 0,
      wobble: 0,
      wobbleSpeed: 0.53,
      transmission: 0.97,
      roughness: 0.12,
      fresnel: 0,
      ior: 1.5,
      reflect: 2,
      materialExposure: 0.85,
      shapeSoftness: 0.025,
      meltSizeMax: 0.53,
      meltStretch: 0.1,
      meltNeck: 0.22,
      capillaryHeight: 0.09,
      capillaryRings: 3,
      capillarySpeed: 2,
      dispersionEnabled: true,
      dispersionSeparation: 0.32,
      rayBeamIntensity: 2.05,
      rayBeamSeparation: 0.04,
      rayBeamChroma: 2.3,
      rayBeamZoom: 1.5,
      rayBeamRings: 1.5,
      rayBeamGlow: 0.28,
      rayBeamAzimuth: -8,
      rayBeamElevation: 66,
      rayBeamFresnelMask: 0.28,
      rayBeamNoiseMask: 0.42,
      rayBeamNoiseScale: 1.6,
      spectralCausticEnabled: true,
      spectralCausticCol3: '#f9b43e',
      spectralCausticCol6: '#ff4d4d',
      spectralCausticIntensity: 6,
      spectralCausticFlow: 0,
      hdriYaw: -56,
      hdriPitch: 0,
      hdriBlur: 0.18,
      envRefraction: 0.07,
    },
    params: [
      {
        key: 'typeText', label: '文字內容', type: 'text',
        value: 'LIQUID',
      },
      {
        // 使用者實測後定案：1.5 比先前調過的 0.82／0.95 都更大——鏡頭距離改回跟
        // 其他模式共用的預設之後，字需要更大才能撐滿畫面。上限跟著從 1.2 拉高到
        // 4：字級圖集取樣已經換成三次 B-spline（見 typeAtlasSampleSmooth），放到
        // 這個放大倍率邊緣依然平滑，不會露出圖集烘焙解析度的格狀。
        key: 'typeSize', label: '字級', min: 0.2, max: 4, step: 0.01, value: 1.5,
      },
      {
        // 1（第一版）是圖集本身的 advance，字距剛好等於字寬，相鄰字幾乎貼在一起，
        // 密度太高、不容易一眼分開每個字母。1.15 留出可讀的呼吸間隔。
        key: 'typeTracking', label: '字距', min: 0.6, max: 1.6, step: 0.01, value: 1.15,
      },
      {
        // 使用者實測後定案（2026-08-27 存檔匯入）。
        key: 'typeDepth', label: '擠出厚度', min: 0.02, max: 0.4, step: 0.005, value: 0.115,
      },
      {
        key: 'typeBevel', label: '邊緣圓角', min: 0, max: 0.12, step: 0.002, value: 0.1,
      },
      {
        // 關閉：字直接完整出現，不做基線往上長的液態動畫。
        key: 'typeGrow', label: '液態長出', min: 0, max: 1, step: 0.01, value: 0,
      },
      {
        // 不能叫 typeCaret：uniform 名稱是從 key 自動推導的（'u' + 首字大寫），
        // 那樣會撞上 shader 端那顆 vec4 uTypeCaret，通用綁定迴圈會把它整個覆寫成
        // 一個 float。撞名是靜默的——uniforms[uName] 存在就寫，沒有任何警告。
        key: 'typeCaretWidth', label: '游標寬度', min: 0, max: 0.4, step: 0.01, value: 0.16,
      },
      // 以下四條是絕對時間，不是相對權重——循環秒數由它們的總和推導出來（見
      // motions/typewriter.js 開頭與 bubble.js 的 syncTypewriterLoopDuration）。
      // 第一版走相對權重，結果把示範文字從三句短句換成兩個字的「hi」時，總權重
      // 掉了七成但循環秒數沒變，每字反而從 79ms 變慢成 275ms——字打得越少越慢，
      // 這跟任何人對「打字」的直覺都相反。數值上盡量貼近原型（55ms／字、
      // 1100ms 停留、30ms／字刪除、320ms 換句空檔）。
      {
        key: 'typeCharTime', label: '每字時間', min: 0, max: 400, step: 5, value: 55,
      },
      {
        key: 'typeHold', label: '打完停留', min: 0, max: 10, step: 0.1, value: 1.1,
      },
      {
        key: 'typeEraseTime', label: '每字刪除', min: 0, max: 200, step: 5, value: 30,
      },
      {
        key: 'typeGap', label: '換句空檔', min: 0, max: 2, step: 0.02, value: 0.32,
      },
    ],
  },
  formation: {
    label: '形狀匯聚 Formation',
    uniform: 1,
    usesShapeField: true,
    gate: 'formation',
    // 匯聚只需要 1 顆種子，其餘體積由微滴群逐漸填出來。
    count: 1,
    // 依賴外部形狀的模式改用較小的滴徑，吸附進外形時顆粒感更細。
    radius: 0.25,
    loopDuration: 12,
    dolly: false,
    svgDemo: 'question',
  },
  weave: {
    label: '穿梭環繞 Weave',
    uniform: 3,
    usesShapeField: true,
    gate: 'weave',
    // 沒有逐漸填滿的微滴群，畫面豐富度全靠主水滴撐，所以顆數比匯聚多得多。
    count: 6,
    radius: 0.25,
    loopDuration: 12,
    dolly: false,
    svgDemo: 'question',
  },
  melt: {
    label: '融化 Melt',
    // 2 是已移除的「脈動呼吸」留下的空號，正好補上。
    uniform: 2,
    usesShapeField: true,
    gate: 'melt',
    // 滴落點散在底部，主滴多一點才看得出「到處都在滴」；另外還有微滴群加量。
    count: 8,
    radius: 0.25,
    // 融化是永遠播下去的循環，沒有敘事段落要交代，循環短一點滴落密度才夠。
    loopDuration: 6,
    // 鏡頭推軌是「分裂 ~0.24、融合 ~0.80」那組敘事節拍，跟融化的持續滴落
    // 毫無關係；融化的形狀本身也該完全靜止，所以預設關掉。使用者仍可以在
    // UI 打開——見 bubble.js 的 dolly 計算與 index.html 的「前後拉伸」開關。
    dolly: false,
    // 問號的底部只有一個小圓點，滴落點會擠成一團看不出「整個底部在滴」；
    // 冰塊的底邊夠寬，才挑得出好幾個分散的滴落點。
    svgDemo: 'ice',
    // 融化持續滴落、水滴本身就在動，跟形狀匯聚那套「擠出外形＋輪廓液滴」
    // 的共用預設（原本是設計給靜止展示模型用的）不搭：擠出深度、邊緣圓角
    // 都要拉高才看得出冰塊的立體感；輪廓液滴則直接打開、水滴分佈與大小
    // 調整過、流速歸零（融化的水滴已經有自己的滴落動畫，輪廓液滴只負責
    // 靜態鑲邊，動起來反而互相干擾）。
    overrides: {
      shapeDepth: 0.28,
      shapeEdgeBevel: 0.129,
      edgeDropsEnabled: true,
      shapeLiquid: 1,
      shapeLiquidPosition: 6,
      shapeLiquidSize: 0.77,
      shapeLiquidSpeed: 0,
    },
  },
  morph: {
    label: '形狀變形 Morph',
    uniform: 5,
    usesShapeField: true,
    gate: 'morph',
    // 實體全程都在畫面上，水滴只是波前那一小撮飛行中的液體，不必多。
    count: 6,
    radius: 0.25,
    loopDuration: 6.5,
    // 變形本身已經是全畫面的運動，鏡頭再推軌只會讓人看不清波掃到哪裡。
    dolly: false,
    // 形狀 A。B 目前固定是內建星形（見 default-shapes.js 的 MORPH_TARGET_SVG_TEXT），
    // 還不能由使用者匯入——兩個匯入槽留到下一步。
    svgDemo: 'question',
    // 這個模式的形狀從頭到尾都是實體，擠出厚度與邊緣圓角的手感跟「水滴逐漸
    // 長成形狀」那套共用預設不一樣：薄一點、圓角大一點，切口與收頸才不會被
    // 厚實的側壁蓋住。
    overrides: {
      shapeDepth: 0.09,
      shapeEdgeBevel: 0.086,
    },
  },
  jelly: {
    label: '果凍 Jelly',
    uniform: 6,
    usesShapeField: true,
    gate: 'jelly',
    // 造型本身就是全部的戲：水滴預設不出場。使用者想加幾顆點綴仍然可以調高，
    // 那些水滴會貼在表面錨點上跟著果凍一起晃（見 bubble.js 的 jelly 分支）。
    count: 0,
    radius: 0.24,
    // 戳一下、晃幾下、平息——這個節奏要短才有彈性感，12 秒會變成慢動作。
    loopDuration: 4,
    // 果凍是原地晃動，鏡頭推軌會跟形變混在一起，分不清是誰在動。
    dolly: false,
    svgDemo: 'question',
    // 厚實圓潤才像一塊果凍；薄片擠出被壓扁時看起來是紙在抖，不是膠體在晃。
    overrides: {
      shapeDepth: 0.14,
      shapeEdgeBevel: 0.051,
      materialStyle: 'universal',
      rayBeamIntensity: 13.5,
      rayBeamSeparation: 0.065,
      rayBeamChroma: 1.3,
      rayBeamZoom: 5,
      spectralCausticEnabled: false,
      cameraDistance: 3.7,
      cameraRotationX: 9.4,
      cameraRotationY: 27.9,
    },
  },
  shatter: {
    label: '崩解噴濺 Shatter',
    uniform: 4,
    usesShapeField: true,
    gate: 'shatter',
    // 碎片愈多愈像噴濺，主水滴與微滴一起當碎片用。
    count: 8,
    // 「水滴大小」在這個模式是碎片的整體乘數，0.25 這個預設值剛好＝×1 原尺寸
    // （見 shatter.js 的 SHATTER_RADIUS_BASE）。滑桿本身可以拉到 0（碎片完全
    // 消失），所以這個值是「基準」而不是「下限」。
    radius: 0.25,
    // 四段時長預設 1.1 / 0.5 / 0.4 / 2.0 合計正好 4 秒，面板才顯示得出實際秒數。
    loopDuration: 4,
    dolly: false,
    svgDemo: 'question',
  },
  capillary: {
    label: '毛細波 Capillary Wave', uniform: 7, usesShapeField: true, gate: 'capillary',
    // 毛細波只作用在 SVG／GLB 距離場本體，不生成主滴、微滴或輪廓液滴。
    count: 0, radius: 0.24, loopDuration: 4, dolly: false,
    overrides: {
      shapeEdgeBevel: 0.051,
      materialStyle: 'universal',
      rayBeamIntensity: 13.5,
      rayBeamSeparation: 0.065,
      rayBeamChroma: 1.3,
      rayBeamZoom: 5,
      spectralCausticEnabled: false,
      cameraDistance: 3.7,
      cameraRotationX: 9.4,
      cameraRotationY: 27.9,
    },
    // 「程序紋理」是這一整組的總開關：選「無」時表面完全不產生偏移，其餘每一條
    // 都變成調了沒反應的死滑桿，所以一律掛上 capillaryTextureOn 這個 gate 收起來。
    params: [
      {
        key: 'capillaryHeight', label: '波浪高度', min: 0, max: 0.8, step: 0.01, value: 0.09,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryCrestSoftness', label: '波峰過渡', min: 0, max: 1, step: 0.01, value: 1,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryRings', label: '環波密度', min: 1, max: 8, step: 1, value: 3,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillarySpeed', label: '傳播速度', min: -4, max: 4, step: 1, value: 2,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryField', label: '波場類型', type: 'select', value: 1,
        gate: 'capillaryTextureOn',
        options: [
          { value: 0, label: '同心放射' },
          { value: 1, label: '定向推進' },
          { value: 2, label: '螺旋擴散' },
        ],
      },
      {
        key: 'capillaryTexture', label: '程序紋理', type: 'select', value: 0,
        // 「無」用 6 而不是插在 0：既有的 0–5 是已經被參數組合檔存下來的值，
        // 重新編號會讓舊檔案的紋理全部錯位。顯示順序由 options 的排列決定，
        // 跟數值無關，所以擺在第一個不影響相容性。
        options: [
          { value: 6, label: '無' },
          { value: 0, label: 'Wave' },
          { value: 1, label: 'Noise' },
          { value: 2, label: 'Voronoi' },
          { value: 3, label: 'Gabor' },
          { value: 4, label: 'Gradient' },
          { value: 5, label: 'Magic' },
        ],
      },
      {
        key: 'capillaryDirectionX', label: '波向 X', min: -1, max: 1, step: 0.05, value: 0.4,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryDirectionY', label: '波向 Y', min: -1, max: 1, step: 0.05, value: 0.5,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryDirectionZ', label: '波向 Z', min: -1, max: 1, step: 0.05, value: 0,
        gate: 'capillaryTextureOn',
      },
      {
        key: 'capillaryWarp', label: '紋理扭曲', min: 0, max: 1, step: 0.01, value: 0.18,
        gate: 'capillaryTextureOn',
      },
    ],
  },
};

const entries = Object.entries(MOTIONS);
const pick = field => Object.fromEntries(entries.map(([key, m]) => [key, m[field]]));

export const MOTION_UNIFORM_MAP = pick('uniform');
export const MOTION_DEFAULT_COUNTS = pick('count');
export const MOTION_DEFAULT_RADIUS = pick('radius');
export const MOTION_DEFAULT_LOOP_DURATION = pick('loopDuration');
export const MOTION_DEFAULT_DOLLY = pick('dolly');
export const MOTION_SVG_DEMO = pick('svgDemo');
export const MOTION_OVERRIDES = pick('overrides');
export const MOTION_KEYS = Object.keys(MOTIONS);
export const MOTION_PARAMS = Object.fromEntries(entries.map(([key, motion]) => [key, motion.params || []]));

// 文字型參數（type: 'text'）刻意不進 MOTION_PARAM_DEFAULTS。bubble.js 的 DEFAULTS
// 明確是「數值滑桿」那一組，它的通用綁定迴圈對每個 key 一律 parseFloat——字串混
// 進去會變成 NaN。改走一張獨立的表，跟 SELECTS／TOGGLES／COLORS 各有各的表是
// 同一個作法。
const isTextParam = param => param.type === 'text';
export const MOTION_PARAM_DEFAULTS = Object.fromEntries(
  entries.flatMap(([, motion]) => (motion.params || [])
    .filter(param => !isTextParam(param))
    .map(param => [param.key, param.value])),
);
export const MOTION_TEXT_DEFAULTS = Object.fromEntries(
  entries.flatMap(([, motion]) => (motion.params || [])
    .filter(isTextParam)
    .map(param => [param.key, param.value])),
);

export const usesShapeField = motion => Boolean(MOTIONS[motion]?.usesShapeField);

// UI 面板的 data-gate → 判斷式。除了每個模式自己的 gate，另外有一個涵蓋全部
// 需要形狀的模式的 'shape'。
export function motionGates(currentMotion) {
  const gates = {};
  for (const [key, m] of entries) gates[m.gate] = () => currentMotion() === key;
  gates.shape = () => usesShapeField(currentMotion());
  return gates;
}
