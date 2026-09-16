export function parseBubbleRuntimeOptions(search = '') {
  const params = new URLSearchParams(search);
/* ===== 預覽嵌入模式（?preview=1）===== */
const PREVIEW = params.has('preview');

// ===== 診斷開關（?diag=…，可用逗號組合，例如 ?diag=lowres,lowsteps）=====
// 純粹為了在 Windows Chrome 上逐項 A/B 找出 bubble 卡頓的來源。沒有帶 diag
// 參數時每一個旗標都是 false，正常行為完全不變 —— 下面所有使用處都是
// 「if (DIAG.xxx)」的形式，不會改動既有的計算。
//
//   lowres       強制 drawing buffer DPR = 1（CSS 尺寸不變）
//   lowsteps     只把 raymarch 主迴圈步數壓到 32
//   nodispersion 關掉色散／稜光／光譜焦散三個既有開關
//   static       初始化完成後只算繪一幀，不啟動 RAF 迴圈
//   compileonly  只建立 renderer 並編譯 program，不算繪全螢幕影格
//   minshader    編譯期排除造型場／毛細波／微滴三大區塊（見 shaderFeatures）
//   minshader2   minshader 再加上：主滴迴圈上限 12→4、稜光光芒只留預設晶格圖樣
//   probe-snoise  以 compilerbaseline 為基底，只加回 snoise 本體（含 mod289 /
//                permute / taylorInvSqrt），在 main 裡呼叫一次。不含 fbm、
//                不含 fbmFast、不進 mapScene —— 所以不在 raymarch 呼叫鏈內。
//   probe-fbm    以 compilerbaseline 為基底，加回 snoise + fbm（含它那 4 次迴圈），
//                fbm 只在 main 裡呼叫一次。不含 fbmFast、不進 mapScene。
//                用來把「snoise 展開 4 次」與「進 raymarch 呼叫鏈」分開量：
//                probe-snoise（單次呼叫）已確認秒開，所以這一步只增加倍數。
//   probe-noise-mapscene-N  跟 probe-noise-mapscene 完全相同，只把 march 展開上限
//                換成 N（1~88，例如 probe-noise-mapscene-88）。用來二分找出 ANGLE
//                的臨界點：snoise 展開份數 ≈ (N + 4) × 2。
//   probe-noise-mapscene  以 compilerbaseline 為基底，加回 snoise + fbmFast，且把
//                fbmFast 放進 mapScene —— 也就是進入 raymarch 呼叫鏈。這是正式版
//                geometry wobble 的實際路徑。probe-snoise（1 次）與 probe-fbm
//                （4 次展開）都秒開，所以這一步隔離的是「被 mapScene 的呼叫者
//                重複 inline」這個變因：main 裡 4 步 march 加 calcNormal 的 4 次
//                取樣，等於 mapScene 被呼叫 8 次，而每次裡面有 2 份 snoise。
//   probe-noise  以 compilerbaseline 為基底，只加回 snoise / fbm / fbmFast
//                （沿用正式 shader 同一份 NOISE_GLSL）與最小呼叫路徑。
//   compilerbaseline  換成一支獨立的最小 fragment shader（見 shaders.js 的
//                    FRAG_BASELINE）。同一套 Three.js / WebGL2 / ShaderMaterial /
//                    renderer / camera / scene / 全螢幕算繪架構，但 GLSL 只剩
//                    「相機射線 → 4 步 raymarch → 法線 → Lambert」。畫面只有一兩顆
//                    藍球，用來確認 ANGLE 在這個架構下到不到得了「能正常編譯」。
//   single-reflection-sample  把 sampleReflection 的環形補樣在編譯期移除，只留
//                中心那一次 textureCubeUV（9 次 → 1 次）。可與任何其他 diag 疊加，
//                因為它要回答的是「同一支 shader、只差 PMREM 取樣這一塊」的
//                cold compile 差距。fxc 只對 sampleReflection 與 backgroundSample
//                發出 X4000 警告，而 textureCubeUV 每次都展開整份 three.js 的
//                cube_uv_reflection_fragment，所以它是第一個該被單獨量的對象。
//                注意：畫面會少掉高粗糙度的環形預濾波，這是探針不是可上線的設定。
//   probe-no-late-shading  探針 A。編譯期移除 main() 光線行進之後的六個著色區塊：
//                稜光光芒、液態薄膜材質分支、稜光彩度後處理、色散/光譜、光譜焦散、
//                薄膜深度。raymarch、noise、thinFilm、內部折射全部保留。
//   probe-no-refraction  探針 B。編譯期抽掉三支函式的「本體」（簽章保留，所以呼叫點
//                與 main() 的控制流都不變）：traceExitSurface（自帶 raymarch 迴圈 +
//                calcNormal）、thinFilm（4 次 fbm + 取樣）、artisticDispersionOPD
//                （4 次 fbm）。等同於下面三個同時開。
//   probe-no-trace-exit / probe-no-thin-film / probe-no-art-dispersion
//                B 的三個成分各自單獨（B1 / B2 / B3），用來二分 B 本身：是「fbm 的
//                靜態展開份數」在主導，還是 traceExitSurface → mapScene → calcNormal
//                那個結構性的放大器。三者互斥可組合，也都可以跟其他 diag 疊加。
//   probe-no-wobble  探針 C。只把正式 mapScene 尾端 geometry wobble 那一次 fbmFast
//                在編譯期移除，其餘完全不動。測「同一份 noise 被 13 個 mapScene
//                呼叫點重複 inline」的代價。
//   以上三個都可與其他 diag 疊加（例如 ?diag=lowcompileloops,probe-no-wobble），
//   預設全部關閉，正式版行為完全不變。畫面會少東西，它們是探針不是可上線的設定。
//   lowcompileloops  minshader2 再加上：主 raymarch 展開上限 88→16、內部折射 28→8。
//                    純二分診斷探針 —— 步數不足畫面會破，只用來確認 ANGLE 是否
//                    卡在 loop expansion，不會套用到正式版。
// ?shaderRun=N —— 純粹用來強迫 cold compile。N 會注入成 SHADER_RUN define，
// 而 shader 裡讓它真的參與一次運算（見 shaders.js 的 SHADER_RUN_SALT），所以不同 N
// 會產生不同的 GLSL 原始碼、不同的 Three.js program cache key、也不同的翻譯結果，
// 驅動的 shader bytecode 快取必然 miss。
//
// 這件事是必要的：先前那一系列 probe 的「秒開 / 卡死」結論其實混進了快取暖機的影響
// —— 同一個 URL 重測時已經不是 cold compile 了。
const SHADER_RUN = (() => {
  const raw = params.get('shaderRun');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
})();

// ?diagTiming=1 —— 計時工具，跟 shaderRun 完全獨立。
//
// 拆開是必要的，而且已經證實有意義：舊版計時用同步的 LINK_STATUS 查詢逼連結完成，
// Windows 實測 shaderRun=2100/2101 帶 diagTiming 就卡死、2200/2201 不帶就正常 ——
// 卡頓來自量測工具而不是 shader。現在計時改成非阻塞輪詢（見 startDiagTiming）。
const DIAG_TIMING = params.get('diagTiming') === '1';

// ?diagTime=<秒> —— 把動畫時間釘死在固定值。
//
// 存在的理由是畫面 A/B：兩個 shader 變體必須在「完全相同的一幀」上比較，否則
// simT 會因為載入時間的抖動而不同，量到的像素差是動畫時間造成的，跟 shader 無關。
// 未指定時完全不介入，正式行為不變。
const DIAG_TIME = (() => {
  const raw = params.get('diagTime');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
})();

// ?diagCapture=<key> —— 算繪完那一幀之後把 drawing buffer 讀回來存進 localStorage，
// 供跨頁面載入的逐像素比對。必須在 render 之後的同一個 task 內讀，因為
// preserveDrawingBuffer 是 false，交還給合成器之後內容就沒了。
const DIAG_CAPTURE = params.get('diagCapture');

// ?forceFeatures=FEATURE_A,FEATURE_B —— 驗證用：強制把指定的功能編進去，即使當下
// 狀態不需要它。
//
// 這是驗證變體特化正確性的主力工具。特化的主張是「該狀態下這個功能的 runtime 條件
// 恆為 false，所以編不編都一樣」。要證明它，就把功能單獨加回去編一次，然後在同一幀
// 逐像素比對 —— 兩者必須完全相同。一次只加一個，錯了才知道是哪一個。
//
// 比整支「全功能版」好用的地方在於成本：全功能版在這台機器上會編到 GPU driver
// 逾時重置（實測 91.8 秒時 webglcontextlost），根本量不完。
const FORCE_FEATURES = (params.get('forceFeatures') || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const DIAG = (() => {
  const raw = params.get('diag');
  const set = new Set((raw || '').split(',').map(s => s.trim()).filter(Boolean));
  return {
    any: set.size > 0,
    list: [...set],
    lowres: set.has('lowres'),
    lowsteps: set.has('lowsteps'),
    nodispersion: set.has('nodispersion'),
    static: set.has('static'),
    compileonly: set.has('compileonly'),
    minshader: set.has('minshader'),
    minshader2: set.has('minshader2'),
    lowcompileloops: set.has('lowcompileloops'),
    compilerbaseline: set.has('compilerbaseline'),
    // 環境／PMREM 取樣的探針。可以跟任何其他 diag 疊加（例如
    // ?diag=lowcompileloops,single-reflection-sample），因為 A/B 要的是
    // 「同一支 shader、只差這一塊」。見 shaders.js 的 sampleReflection。
    singleReflectionSample: set.has('single-reflection-sample'),
    // 正式 FRAG 的 feature-level 二分。三個都可以跟任何其他 diag 疊加，因為要比的是
    // 「同一支 shader、只差這一塊」。見 shaders.js 對應的 #ifndef 區塊。
    //   A 後段著色：稜光、液態薄膜分支、彩度後處理、色散/光譜、光譜焦散、薄膜深度
    //   B 折射/薄膜群：traceExitSurface、thinFilm、artisticDispersionOPD（保留簽章、抽掉本體）
    //   C 只拿掉 mapScene 尾端的 geometry wobble noise
    probeNoLateShading: set.has('probe-no-late-shading'),
    // 後段著色的 8 個單獨隔離探針（第七、八項不在 main() 的後段，但同屬這一輪）。
    // 每個只關一個功能，其餘完全維持基底。
    probeNoPrismBeam: set.has('probe-no-prism-beam'),
    probeNoLiquidFilmMaterial: set.has('probe-no-liquid-film-material'),
    probeNoPrismSaturation: set.has('probe-no-prism-saturation'),
    probeNoDispersionSpectral: set.has('probe-no-dispersion-spectral'),
    probeNoSpectralCaustics: set.has('probe-no-spectral-caustics'),
    probeNoThinFilmDepth: set.has('probe-no-thin-film-depth'),
    probeNoEnvPmrem: set.has('probe-no-env-pmrem'),
    probeNoRefractionFilm: set.has('probe-no-refraction'),
    probeNoWobble: set.has('probe-no-wobble'),
    // B 的三個成分，用來二分 B 本身。probe-no-refraction 等於這三個同時開。
    probeNoTraceExit: set.has('probe-no-trace-exit'),
    // B1 的兩個成分：B1a 拿掉 traceExitSurface 結尾的 calcNormal（10 個 mapScene tap
    // × 2 個呼叫點），B1b 拿掉它自己的 march 迴圈。
    probeNoTraceNormal: set.has('probe-no-trace-normal'),
    probeNoTraceMarch: set.has('probe-no-trace-march'),
    // B1b 的乾淨版：保留迴圈與 found 的動態性，只把迴圈體裡的 mapScene 換成便宜的
    // 包圍球 SDF。舊的 probe-no-trace-march 會讓 main() 的折射分支被 dead-strip，
    // 量到的不只是迴圈成本，保留它只是為了對照。
    probeCheapTraceSdf: set.has('probe-cheap-trace-sdf'),
    // 方向 1 + 2 合併的候選修法探針：calcNormal 的 SVG 分支只在造型場有編進來時
    // 保留，且 traceExitSurface 的出口法線改用獨立的 4-tap 四面體。
    probeLeanNormals: set.has('probe-lean-normals'),
    // 依模式編譯 shader variant 的探針。三選一：
    //   probe-mode-none   無造型／一般 metaball／分裂 → 只編四面體 4-tap
    //   probe-mode-voxel  體素（GLB）造型生效中      → 也只需要四面體 4-tap
    //   probe-mode-svg    SVG 造型生效中             → 只編 SVG 6-tap
    // 「生效中」是 variant 鍵的一部分：uShapeProgress 還在 0 附近時走的是四面體那條，
    // 所以造型成形過程要用 none 那支 variant，否則法線數學就不一致了。
    // mapScene 的模式特化探針：
    //   probe-mapscene-plain  一般 Bubble（無造型）
    // 方案 A：把 calcNormal 的四個 tetrahedral tap 收進一個 uniform 守衛的迴圈。
    // 目標是靜態展開份數（15 → 6），runtime 仍然算四次，數學不變。
    // 驗證用：編進所有功能，等同變體特化之前的萬能 shader（見 shaderFeatures）。
    allFeatures: set.has('allfeatures'),
    probeLoopNormalTaps: set.has('probe-loop-normal-taps'),
    // 反向探針：把 SVG 分軸差分的六個 tap 換回展開式，用來證明迴圈化沒有改變數學
    // （見 shaders.js 的 PROBE_UNROLLED_SVG_TAPS）。
    probeUnrolledSvgTaps: set.has('probe-unrolled-svg-taps'),
    probeMapscenePlain: set.has('probe-mapscene-plain'),
    probeModeNone: set.has('probe-mode-none'),
    probeModeVoxel: set.has('probe-mode-voxel'),
    probeModeSvg: set.has('probe-mode-svg'),
    probeNoThinFilm: set.has('probe-no-thin-film'),
    probeNoArtDispersion: set.has('probe-no-art-dispersion'),
    probeNoise: set.has('probe-noise'),
    probeSnoise: set.has('probe-snoise'),
    probeFbm: set.has('probe-fbm'),
    probeNoiseMapscene: set.has('probe-noise-mapscene'),
    // probe-noise-mapscene-N：跟上面那個完全相同，只是把 MAX_MARCH_COMPILE 換成 N。
    // 做成參數化是為了二分：16 / 32 / 64 / 88 都直接可用，不必每個值改一次程式碼。
    probeMarchBound: (() => {
      for (const t of set) {
        const m = t.match(/^probe-noise-mapscene-(\d+)$/);
        if (m) return Math.max(1, Math.min(88, Number(m[1])));
      }
      return 0;
    })(),
  };
})();
return {
    preview: PREVIEW,
    shaderRun: SHADER_RUN,
    diagTiming: DIAG_TIMING,
    diagTime: DIAG_TIME,
    diagCapture: DIAG_CAPTURE,
    forceFeatures: FORCE_FEATURES,
    diagnostics: DIAG,
  };
}

