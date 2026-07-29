/* ===== 主迴圈 ===== */
let last = performance.now(), noiseT = 0, lastDraw = 0, exporting = false, rafId = 0;

function syncLoop() {
  const insetSettled = Math.abs(panelInsetTarget - panelInsetX) < 0.05;
  const shouldRun = !exporting && (!(paused || previewPaused()) || !insetSettled || paramsDirty);
  if (!shouldRun) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    return;
  }
  if (!rafId) {
    rafId = requestAnimationFrame(frame);
  }
}

function frame(now) {
  rafId = 0;
  if (exporting) { syncLoop(); return; } // 輸出中暫停即時繪製，避免共用狀態被打亂
  const interval = 1000 / Math.max(1, P.fps || 60);
  if (now - lastDraw < interval - 1) { syncLoop(); return; } // FPS 上限
  lastDraw = now;
  const realDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const halted = paused || previewPaused();
  let dt = halted ? 0 : realDt;
  // 面板開合時，畫面圓心平滑地滑往目標偏移（跟面板的滑動動畫節奏一致），避免瞬間跳動。
  // 用 realDt（不受暫停影響）驅動，暫停時也能繼續完成這個純 UI 過渡
  panelInsetX += (panelInsetTarget - panelInsetX) * Math.min(1, realDt * 10);
  const insetSettled = Math.abs(panelInsetTarget - panelInsetX) < 0.05;
  // 暫停、畫面已經完全靜止、而且沒有人在調參數時，直接跳過整幀重繪 —— 反正 dt=0 算出來的結果
  // 會跟上一幀逐像素相同，沒必要每 1/FPS 秒就重算一次幾百個漸層跟環束多邊形，白白吃 GPU/CPU。
  // 但暫停中調整滑桿會把 paramsDirty 標記起來，讓它用同一個凍結的時間點重畫「這一張」反映新參數的畫面，
  // 畫完立刻清掉標記，畫面依然停在原地，不會恢復播放
  if (halted && insetSettled && !paramsDirty) { syncLoop(); return; }
  paramsDirty = false;
  renderFrame(ctx, W, H, dt, false, undefined, panelInsetX);
  syncLoop();
}

/* ===== 拖尾持久緩衝區 =====
   環/火花/煙霧等「應該有拖尾流動感」的內容都畫在這張獨立、跨幀保留內容的畫布上；
   星辰則完全不進來，畫完直接疊在最終輸出畫布上，兩者的持久性從架構上就分開，
   不必依賴「清得夠不夠快」這種容易漏洞的做法（見星辰殘影問題的最終修法）。
   用 WeakMap 依照輸出目標（即時預覽的 ctx／每次匯出新建的 ectx）各自保留一份，
   避免即時預覽和匯出共用同一份緩衝區而互相污染。 */
const TRAIL_BUFFERS = new WeakMap();
function getTrailBuffer(outputCtx) {
  let buf = TRAIL_BUFFERS.get(outputCtx);
  const ow = outputCtx.canvas.width, oh = outputCtx.canvas.height;
  if (!buf) {
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    buf = { canvas, ctx: canvas.getContext('2d') };
    TRAIL_BUFFERS.set(outputCtx, buf);
  } else if (buf.canvas.width !== ow || buf.canvas.height !== oh) {
    buf.canvas.width = ow; buf.canvas.height = oh; // 尺寸變動時視窗本來就會重置畫面，跟現有 resize() 行為一致
  }
  buf.ctx.setTransform(outputCtx.getTransform());
  return buf.ctx;
}

// transparent=true 時以去背模式繪製（拖尾用 destination-out 淡出而非疊黑）
// atTime 有給值時（匯出用）：直接用「幀索引/幀率」精確設定時間，不用累加 dt，完全沒有浮點誤差累積
// centerOffsetX：即時預覽在面板開啟時，把畫面圓心往右偏移避開面板；匯出時永遠是 0（維持正中央）
const RIBBON_SEGS = 220;
const ribbonCos = new Float32Array(RIBBON_SEGS + 1);
const ribbonSin = new Float32Array(RIBBON_SEGS + 1);
const ribbonRadius = new Float32Array(RIBBON_SEGS + 1);
const ribbonHalfWidth = new Float32Array(RIBBON_SEGS + 1);
const ARC_SEGS = 16;
const arcPathX = new Float32Array(ARC_SEGS + 1);
const arcPathY = new Float32Array(ARC_SEGS + 1);

function fillRibbonPath(ctx, cx, cy, scale) {
  ctx.beginPath();
  for (let i = 0; i <= RIBBON_SEGS; i++) {
    const r = ribbonRadius[i] + ribbonHalfWidth[i] * scale;
    const x = cx + ribbonCos[i] * r, y = cy + ribbonSin[i] * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  for (let i = RIBBON_SEGS; i >= 0; i--) {
    const r = ribbonRadius[i] - ribbonHalfWidth[i] * scale;
    ctx.lineTo(cx + ribbonCos[i] * r, cy + ribbonSin[i] * r);
  }
  ctx.closePath();
  ctx.fill();
}

function strokeArcPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(arcPathX[0], arcPathY[0]);
  for (let i = 1; i <= ARC_SEGS; i++) ctx.lineTo(arcPathX[i], arcPathY[i]);
  ctx.stroke();
}

function renderFrame(outputCtx, W, H, dt, transparent, atTime, centerOffsetX = 0) {
  if (W <= 0 || H <= 0) return; // 畫布尚未有尺寸（例如分頁在背景 innerWidth=0）時直接跳過，避免對 0×0 畫布操作
  const ctx = getTrailBuffer(outputCtx); // 以下所有 ctx.xxx 都畫在持久緩衝區上，星辰除外（見函式尾端）
  noiseT = atTime !== undefined ? atTime : noiseT + dt;

  // 循環相位：每經過 loopSec 秒精確繞完一圈 2π，之後所有雜訊都用它的整數倍當引數 → 無縫循環
  const LOOP_SEC = Math.max(0.5, Q.loopSec || 5);
  const loopPhase = (noiseT / LOOP_SEC) * TWO_PI;
  const lst = coef => loopSeedTerm(LOOP_SEC, loopPhase, coef); // CASE2 用（嵌入 pn 的 seed 引數）
  const ltN = coef => loopN(LOOP_SEC, coef);                    // CASE1/3 用（直接當 t/角度引數）

  const cx = W / 2 + centerOffsetX, cy = H / 2;
  const minDim = Math.min(W, H);
  const R = Q.radius * minDim;
  const dir = Q.ccw ? -1 : 1;

  // 轉速對齊循環：四捨五入成整數圈，確保旋轉在循環邊界完全銜接（無縫循環的必要條件）。
  // 轉速 > 0 時至少 1 圈，避免「短循環 × 慢轉速」被四捨五入成 0 圈而完全靜止
  const turnsPerLoop = Q.speed > 0 ? Math.max(1, Math.round(Q.speed * LOOP_SEC)) : 0;
  // 速度脈動：以角度擺盪（而非速度累加）表示，在整數圈內平均為 0，不影響每循環的總圈數，
  // 且是 loopPhase 的封閉式函數 → 天生無縫，不需要逐幀累加
  const pulseWobble = Q.pulse > 0 ? Q.pulse * 0.5 * pn(loopPhase * ltN(1.5), 1, 0) : 0;
  // 任何「旋轉的倍率」（各環自轉速度差異、煙霧/太陽紋理跟轉、白熱亮點公轉）都要各自對齊整數圈，
  // 否則個別倍率非整數時，該元素在循環邊界會轉到不同角度，看起來就是接縫跳動
  const ringAngle = mult => {
    const turns = Math.round(turnsPerLoop * mult);
    return loopPhase * dir * turns + dir * pulseWobble * turns;
  };

  // 整體閃爍
  const flick = 1 + Q.flicker * 0.35 * pn(loopPhase * ltN(13.7), 1, 0);

  /* --- 拖尾：trail 越高殘影越長；去背模式用 destination-out 淡出 --- */
  ctx.globalCompositeOperation = transparent ? 'destination-out' : 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${1 - Q.trail})`;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  /* --- 外圈柔光暈 --- */
  if (Q.glow > 0.01) {
    const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.5);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, `hsla(${Q.hue},${Q.sat}%,50%,${0.10 * Q.glow * flick})`);
    g.addColorStop(0.62, `hsla(${Q.hue},${Q.sat}%,45%,${0.05 * Q.glow * flick})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2);
  }

  /* --- 流體煙霧：環外圍漂流的墨霧（畫在最底層，讓主環蓋在上面）--- */
  if (Q.smoke > 0.005) {
    smokeTick++;
    if (smokeTick % 2 === 1) drawSmokeTexture(ringAngle(0.35), loopPhase); // 隔幀重算（煙霧流動慢，看不出差異）
    const sext = R * SMOKE_EXT;
    ctx.drawImage(smokeCanvas, cx - sext, cy - sext, sext * 2, sext * 2);
  }

  /* --- 太陽米粒組織：翻騰的對流層貼在環的外層表面 --- */
  if (Q.granule > 0.005) {
    drawSunTexture(ringAngle(0.6), loopPhase);
    const ext = R * SUN_EXT;
    ctx.drawImage(sunCanvas, cx - ext, cy - ext, ext * 2, ext * 2);
  }

  /* --- 能量脈衝波：從核心向外擴散的柔邊圓形波紋（畫在環的下層）---
     waveCount 顆波以等間隔相位錯開，同時獨立擴散 → 畫面上真的會同時看到 N 圈，
     不是同一顆波更頻繁重播。每顆波的進度仍是 loopPhase 的封閉式函數 → 天生無縫循環。
     畫在拖尾緩衝區上，殘影會自然留下一點「波過去了」的餘韻。 --- */
  if (Q.waveAmount > 0.005) {
    const wc = Math.max(1, Math.round(Q.waveCount));
    const rStart = R * 0.22;
    const rEnd = R * (1 + Q.waveReach);
    // 速度：把「每秒幾次擴散-淡出」對齊成每循環整數次，跟轉速對齊循環的做法（turnsPerLoop）同理，
    // 確保循環邊界精確銜接，不會在接縫處看到波紋位置跳動
    const waveTurns = Math.max(1, Math.round(Q.waveSpeed * LOOP_SEC));
    const basePhase = ((loopPhase / TWO_PI) * waveTurns) % 1; // 0..1
    for (let wi = 0; wi < wc; wi++) {
      const prog0 = (basePhase + wi / wc) % 1; // 每顆波錯開 1/wc 個循環起跑
      // 進度用 ease-out：出生時衝很快、遠處減速淡出（爆發感）
      const eased = 1 - Math.pow(1 - prog0, 2.2);
      const wr = rStart + (rEnd - rStart) * eased;
      // 淡入極快、隨距離淡出；乘 flick 跟全域閃爍同步
      const aIn = Math.min(1, prog0 * 12);
      const wAlpha = Q.waveAmount * 0.55 * aIn * Math.pow(1 - prog0, 1.6) * flick;
      if (wAlpha <= 0.01) continue;
      const band = R * 0.05 * Q.waveWidth * (0.6 + eased * 1.4); // 波環越遠越寬、越淡
      const g = ctx.createRadialGradient(cx, cy, Math.max(0, wr - band), cx, cy, wr + band);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.45, `hsla(${Q.hue},${Q.sat}%,60%,${wAlpha * 0.5})`);
      g.addColorStop(0.55, `hsla(${Q.hue},${Math.max(0, Q.sat - 30)}%,85%,${wAlpha})`);
      g.addColorStop(0.65, `hsla(${Q.hue},${Q.sat}%,55%,${wAlpha * 0.4})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      const ext = wr + band;
      ctx.fillRect(cx - ext, cy - ext, ext * 2, ext * 2);
    }
  }

  /* --- 多層旋轉光弧（多絲線 + 細節毛絲 + 裂紋斷點） --- */
  const SEGS = RIBBON_SEGS;
  const segA = (Math.PI * 2) / SEGS;
  ctx.lineCap = 'round';
  const jitterAmp = Q.fray * R * 0.022;

  for (let ri = 0; ri < Q.ringCount; ri++) {
    const s = RING_SEEDS[ri];
    const rr = R + (ri - (Q.ringCount - 1) / 2) * Q.ringGap + s.radiusJitter * 3;
    const ringRot = ringAngle(s.speedMul);

    // 顏色沿著環的角度變化，跟亮度共用同一條曲線：亮部（跟白熱亮核同源）偏向副色相，暗部維持主色相，
    // 呼應參考圖那種「同一條線本身沿途變色」而非整條線固定一色的效果。
    // 用 conic gradient 一次性做完整圈的顏色分佈（起始角對齊 ringRot，天生跟著環旋轉且無縫循環），
    // 不用像亮度/寬度那樣逐段（220 個點）計算，效能開銷幾乎跟原本的單色 fillStyle 一樣。
    const colorBrightnessAt = (t, freq, fSeed) => {
      let bf = 0.5 + 0.5 * Math.sin(t * freq + fSeed);
      bf = Math.pow(Math.max(0, bf), 1.6);
      bf *= 0.55 + 0.45 * pn(t, 3, fSeed * 2 + lst(0.6));
      return Math.max(0, Math.min(1, bf));
    };
    const HUE_GRAD_STOPS = 32;
    const makeHueGradient = (freq, fSeed, hueOffset, styleFn) => {
      const grad = ctx.createConicGradient(ringRot, cx, cy);
      for (let i = 0; i <= HUE_GRAD_STOPS; i++) {
        const frac = i / HUE_GRAD_STOPS;
        const bf = colorBrightnessAt(frac * Math.PI * 2, freq, fSeed);
        const hue = (Q.hue + bf * Q.hueShift + hueOffset + 360) % 360;
        grad.addColorStop(frac, styleFn(hue));
      }
      return grad;
    };

    // 低頻形變：讓環不是正圓，微微歪扭（noise texture 感）
    // 以 t（環座標）索引 → 形變跟著環一起旋轉；循環相位讓形狀緩慢演化且首尾無縫
    const warpAmp = Q.warp * R * 0.045;
    const wSeed = s.phase * 5.3 + ri * 7.1;
    const warpFn = t =>
      warpAmp * (
        pn(t, 2, wSeed + lst(0.18)) * 0.6 +
        pn(t, 5, -wSeed * 1.4 + lst(0.12)) * 0.4
      );

    // 整環柔光暈：一次性 shadowBlur，取代逐段外光暈，效能較佳（沿形變路徑）
    if (Q.glow > 0.01) {
      ctx.save();
      ctx.shadowColor = `hsla(${Q.hue},${Q.sat}%,50%,0.9)`;
      ctx.shadowBlur = Q.thickness * 3.2 * Q.glow;
      ctx.strokeStyle = makeHueGradient(s.freq, s.phase * 3.7, 0,
        hue => `hsla(${hue},${Q.sat}%,50%,${0.16 * Q.glow * flick})`);
      ctx.lineWidth = Q.thickness * 1.6;
      ctx.beginPath();
      const GSEGS = 72;
      for (let i = 0; i <= GSEGS; i++) {
        const t = i * (Math.PI * 2 / GSEGS);
        const gr = rr + warpFn(t);
        const a = t + ringRot;
        const gx = cx + Math.cos(a) * gr, gy = cy + Math.sin(a) * gr;
        i === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
      }
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }

    const fCount = Q.filaments;
    for (let k = 0; k < fCount; k++) {
      const fSeed = s.phase * 3.7 + k * 11.3;
      const fSpread = fCount > 1 ? (k / (fCount - 1) - 0.5) : 0; // -0.5..0.5
      const strandBase = rr + fSpread * Q.thickness * 1.3;
      const freq = s.freq + (k % 3);
      const hueOffset = fSpread * 10;

      // 先算出整條絲線的路徑點與每點半寬 → 再填成連續變寬絲帶（避免逐段圓頭造成珠珠感）
      const wBase = Q.thickness * (0.85 / Math.max(1, Math.sqrt(fCount)));
      for (let i = 0; i <= SEGS; i++) {
        const t = i * segA;
        const a0 = t + ringRot;

        // 沿圓周的亮度分佈：波瓣 + 雜訊 → 不均勻的流光
        let b = 0.5 + 0.5 * Math.sin(t * freq + fSeed);
        b = Math.pow(Math.max(0, b), 1.6);
        b *= 0.55 + 0.45 * pn(t, 3, fSeed * 2 + lst(0.6));
        b = Math.max(0, b) * flick;
        b = b * Q.wobble + (1 - Q.wobble) * 0.65 * flick; // wobble=0 → 均勻圓環

        // 裂紋斷點：把寬度掐到近乎 0，形成細小暗縫
        if (Q.crackle > 0.01) {
          let gap = 0.5 + 0.5 * pn(t, 42, fSeed * 5 + lst(0.15));
          gap = Math.pow(Math.max(0, gap), 4);
          b *= (1 - Q.crackle) + Q.crackle * gap;
        }

        // 細節毛絲：徑向微抖動，讓路徑不是完美圓，模擬手繪流線
        const jitter = jitterAmp * (
          pn(t, 26, fSeed * 4.1 + lst(0.5)) * 0.7 +
          pn(t, 61, fSeed * 7.7 - lst(0.3)) * 0.3
        );
        // 每條絲線對整環形變的跟隨程度略不同 → 絲線間會微微分岔再合攏
        const rj = strandBase + warpFn(t) * (0.85 + fSpread * 0.5) + jitter;

        // 粗細變化：低頻雜訊沿環調變寬度，同一環有粗有細（筆觸壓力感）。
        // widthVar=1 時最細處逼近 0（幾乎看不見線），最粗處變 2 倍，差距拉到最大
        const wn = 1 + Q.widthVar * 0.98 * pn(t, 3, fSeed * 2.9 + lst(0.25));
        const hw = wBase * (0.5 + b * 0.9) * Math.max(0, wn) * 0.95;

        ribbonCos[i] = Math.cos(a0);
        ribbonSin[i] = Math.sin(a0);
        ribbonRadius[i] = rj;
        ribbonHalfWidth[i] = Math.max(0.01, hw);
      }

      // 絲帶填色：外緣順走 + 內緣倒走圍成封閉多邊形 → 寬度連續平滑無接縫
      // 同一條絲帶畫三層：外圈微光 → 主體 → 白熱核心，三層都套用同一條沿角度變化的色彩漸層
      ctx.fillStyle = makeHueGradient(freq, fSeed, hueOffset,
        hue => `hsla(${hue},${Q.sat}%,50%,${0.22 * flick})`);
      fillRibbonPath(ctx, cx, cy, 1.9);
      ctx.fillStyle = makeHueGradient(freq, fSeed, hueOffset,
        hue => `hsla(${hue},${Q.sat}%,58%,${0.5 * flick})`);
      fillRibbonPath(ctx, cx, cy, 1.0);
      ctx.fillStyle = makeHueGradient(freq, fSeed, hueOffset,
        hue => `hsla(${hue},${Math.max(0, Q.sat - 45)}%,92%,${0.55 * flick})`);
      fillRibbonPath(ctx, cx, cy, 0.32);
    }
  }

  /* --- 白熱亮點（沿環移動的過曝高光）：全部共用同一個轉速基準，只用角度均分區分彼此，
     確保任何時刻都精確等距（2 顆永遠對角、3 顆永遠 120° 等分），不會各自飄移而散開。
     高光本體改成沿著環的真實弧線取樣多個小光斑疊起來（而不是單一壓扁橢圓），
     這樣尺寸開很大時形狀會跟著環的弧度彎曲，不會變成一條戳出去的直線切線。 --- */
  const hotspotRot = ringAngle(1);
  const HOTSPOT_SUB = 10; // 弧形高光的取樣點數，越多過渡越平滑
  for (let h = 0; h < Q.hotspots; h++) {
    const a = hotspotRot + h * (Math.PI * 2 / Math.max(1, Q.hotspots));
    const rr = R + (h % Math.max(1, Q.ringCount) - (Q.ringCount - 1) / 2) * Q.ringGap;
    const len = R * 0.35 * Q.hotspotSize; // 高光沿弧長方向的總長度
    const angHalfWidth = Math.min(Math.PI * 0.8, len / rr); // 弧長換算成半張角，避免包裹超過半圈

    for (let si = 0; si <= HOTSPOT_SUB; si++) {
      const off = (si / HOTSPOT_SUB) * 2 - 1; // -1..1
      const sa = a + off * angHalfWidth;
      const sx = cx + Math.cos(sa) * rr, sy = cy + Math.sin(sa) * rr;
      const fall = Math.exp(-(off * off) * 2.2); // 中心最亮、往兩端淡出
      if (fall < 0.02) continue;
      const subLen = Math.max(1, len * 0.5);
      const sTa = sa + Math.PI / 2 * (Q.ccw ? -1 : 1); // 這一點自己的切線方向，讓壓扁跟著弧度轉

      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, subLen);
      grad.addColorStop(0, `hsla(${Q.hue},30%,97%,${0.75 * flick * fall})`);
      grad.addColorStop(0.25, `hsla(${Q.hue},${Q.sat}%,70%,${0.4 * flick * fall})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(sTa);
      ctx.scale(1, 0.3); // 沿當地切線方向壓扁，垂直於弧線的方向收窄
      ctx.rotate(-sTa);
      ctx.translate(-sx, -sy);
      ctx.fillStyle = grad;
      ctx.fillRect(sx - subLen, sy - subLen, subLen * 2, subLen * 2);
      ctx.restore();
    }
  }

  /* --- 星辰：固定不消散、散布在環外側、跟著環轉的粒子層（與電漿火花是獨立系統）---
     畫在獨立畫布上、每幀清空重畫。這裡只準備好這一幀的星辰圖案，實際疊到畫面上是在
     函式最尾端直接畫在「輸出畫布」上，完全繞過持久緩衝區的拖尾 —— 之前只是把星辰畫在
     獨立畫布上還不夠，因為最後仍是疊回會拖尾的那張畫布，舊星星還是會被拖尾疊加殘留
     （使用者回報的匯出殘影就是這個原因）；現在星辰從架構上就不會進入拖尾緩衝區。*/
  if (Q.starCount > 0) {
    // 用跟輸出畫布相同的實際像素尺寸與縮放矩陣（含 DPR），避免疊上去時被二次縮放而模糊
    if (starCanvas.width !== outputCtx.canvas.width || starCanvas.height !== outputCtx.canvas.height) {
      starCanvas.width = outputCtx.canvas.width; starCanvas.height = outputCtx.canvas.height;
    }
    starCtx.setTransform(outputCtx.getTransform());
    starCtx.clearRect(0, 0, W, H);
    starCtx.globalCompositeOperation = 'lighter';

    const stars = getStarPool(Math.round(Q.starCount));
    const starTurns = Q.starSpeed > 0 ? Math.max(1, Math.round(Q.starSpeed * LOOP_SEC)) : 0;
    const starRot = loopPhase * dir * starTurns;
    // 清晰度：0 = 柔和瀰漫的光暈點；1 = 邊緣分明的銳利小光點
    const haloMul = 1.2 + (1 - Q.starSharpness) * 4.8;
    const coreStop = Math.min(0.92, 0.15 + Q.starSharpness * 0.55);
    const minSz = Math.min(Q.starMinSize, Q.starMaxSize);
    const maxSz = Math.max(Q.starMinSize, Q.starMaxSize);

    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      const a = st.angle0 + starRot;
      const sr = R * (1 + Q.starSpread * st.radiusFactor);
      const x = cx + Math.cos(a) * sr, y = cy + Math.sin(a) * sr;
      const size = minSz + (maxSz - minSz) * st.sizeT;
      const alpha = st.briT * flick;
      if (alpha <= 0.01 || size <= 0.02) continue;
      const rad = size * haloMul;
      const g = starCtx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `hsla(${Q.hue},${Math.max(0, Q.sat - 20)}%,92%,${alpha})`);
      g.addColorStop(coreStop, `hsla(${Q.hue},${Q.sat}%,65%,${alpha * 0.7})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      starCtx.fillStyle = g;
      starCtx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 注意：這裡刻意不疊回 ctx（拖尾緩衝區），星辰圖案先留在 starCanvas 裡，
    // 等函式最尾端把緩衝區貼到輸出畫布之後，再直接畫在輸出畫布上（見函式最後）
  }

  /* --- 電漿火花（確定性排程：年齡取模循環，位置由封閉式公式算出）--- */
  if (Q.sparkAmount > 0.005) {
    const pool = getSparkPool(LOOP_SEC);
    const activeCount = Math.round(Q.sparkAmount * SPARK_MAX_RATE * LOOP_SEC);
    const tLoop = ((noiseT % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
    const arcRad = (Q.sparkArc * Math.PI / 180);
    const turb = Q.turbulence * 60;
    // 火花羽流有獨立轉速（與環的轉速脫鉤），同樣貼齊整數圈以維持無縫循環
    const sparkTurns = Q.sparkSpeed > 0 ? Math.max(1, Math.round(Q.sparkSpeed * LOOP_SEC)) : 0;

    for (let i = 0; i < activeCount && i < pool.length; i++) {
      const sp = pool[i];
      const age = ((tLoop - sp.birth) % LOOP_SEC + LOOP_SEC) % LOOP_SEC;
      if (age > sp.maxLife) continue;
      const lt = age / sp.maxLife;

      // 出生角：出生時刻的羽流旋轉角（每循環轉整數圈 → 模 2π 後每一循環都相同）+ 扇區內抖動
      const birthRot = dir * sparkTurns * TWO_PI * (sp.birth / LOOP_SEC);
      const a = birthRot + Math.PI * 0.15 + sp.angJitter * arcRad;
      const cosA = Math.cos(a), sinA = Math.sin(a);

      // 封閉式位置：起點(環上) + 徑向等速漂移 + 切線等加速(0.5·k·age²) + 紊流擾動(年齡驅動、可循環)
      const drift = sp.speed0 * Q.sparkReach * sp.velScale * age;
      const tanDisp = sp.tangent * 0.05 * age * age;
      const turbX = pn(age * 2.4, 1, sp.seed) * turb * age * 0.5;
      const turbY = pn(age * 2.1, 1, sp.seed * 1.7) * turb * age * 0.5;
      const x = cx + cosA * (R + drift) - sinA * tanDisp + turbX;
      const y = cy + sinA * (R + drift) + cosA * tanDisp + turbY;

      const alpha = (1 - lt) * (0.5 + 0.5 * pn(age * 8, 1, sp.seed)) * flick;
      if (alpha <= 0.02) continue;
      const size = sp.size * (1 + lt * 2.5) * Q.sparkReach;
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
      g.addColorStop(0, `hsla(${Q.hue},${Q.sat}%,85%,${alpha * 0.5})`);
      g.addColorStop(0.35, `hsla(${Q.hue},${Q.sat}%,55%,${alpha * 0.3})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - size * 3, y - size * 3, size * 6, size * 6);
    }
  }

  /* --- 吸積粒子：從環外向核心螺旋墜落，落到核心時閃光（確定性排程，無縫循環）---
     跟火花完全獨立：火花往外噴發、吸積往內墜落，畫面上形成「進 vs 出」的對照。 --- */
  if (Q.accAmount > 0.005) {
    const pool = getAccretionPool(LOOP_SEC);
    const activeCount = Math.round(Q.accAmount * ACC_MAX_RATE * LOOP_SEC);
    const tLoop = ((noiseT % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
    // 整個吸積盤有獨立公轉（與環脫鉤），一樣貼齊整數圈以維持無縫循環
    const accTurns = Math.max(1, Math.round(0.15 * LOOP_SEC));
    const discRot = dir * accTurns * TWO_PI * (tLoop / LOOP_SEC);

    for (let i = 0; i < activeCount && i < pool.length; i++) {
      const ap = pool[i];
      const age = ((tLoop - ap.birth) % LOOP_SEC + LOOP_SEC) % LOOP_SEC;
      if (age > ap.maxLife) continue;
      // 墜落進度：0（出生於外圈）→ 1（抵達核心）。ease-in：越靠近核心掉得越快（重力感）
      const raw = Math.min(1, (age / ap.maxLife) * Q.accSpeed);
      const lt = Math.min(1, Math.pow(raw, 1.6));

      const startR = R * (1 + Q.accStart * ap.startJitter);
      const rNow = startR * (1 - lt); // 線性半徑收縮（配合 ease-in 的 lt → 實際越近越快）
      // 螺旋：角度隨墜落進度累加，圈數 × 螺旋感滑桿；再加上整盤公轉
      const spiralA = ap.spiralDir * Q.accSpiral * ap.spiralTurns * TWO_PI * lt;
      const a = ap.angle0 + spiralA + discRot;
      const x = cx + Math.cos(a) * rNow, y = cy + Math.sin(a) * rNow;

      // 亮度：出生淡入、墜落途中最亮、抵達核心前開始收；拖著往內的短尾巴
      const fade = lt < 0.15 ? lt / 0.15 : 1;
      const alpha = fade * (1 - lt * 0.4) * (0.5 + 0.5 * pn(age * 6, 1, ap.seed)) * ap.briT * flick;
      if (alpha > 0.02) {
        const size = ap.size * (1.2 - lt * 0.7); // 越靠近核心略縮小
        const g = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
        g.addColorStop(0, `hsla(${Q.hue},${Math.max(0, Q.sat - 25)}%,88%,${alpha * 0.6})`);
        g.addColorStop(0.4, `hsla(${Q.hue},${Q.sat}%,60%,${alpha * 0.3})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - size * 3, y - size * 3, size * 6, size * 6);
      }

      // 落點閃光：抵達核心的瞬間（lt 接近 1）在核心處爆一小閃
      if (Q.accFlash > 0.01 && lt > 0.88) {
        const fl = (lt - 0.88) / 0.12; // 0..1
        const flAlpha = Math.sin(fl * Math.PI) * Q.accFlash * ap.briT * flick;
        if (flAlpha > 0.02) {
          const fr = R * 0.12 * (0.4 + fl);
          const cxr = cx + Math.cos(ap.angle0 + discRot) * R * 0.04;
          const cyr = cy + Math.sin(ap.angle0 + discRot) * R * 0.04;
          const fg = ctx.createRadialGradient(cxr, cyr, 0, cxr, cyr, fr);
          fg.addColorStop(0, `hsla(${Q.hue},30%,96%,${flAlpha * 0.8})`);
          fg.addColorStop(0.5, `hsla(${Q.hue},${Q.sat}%,65%,${flAlpha * 0.3})`);
          fg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = fg;
          ctx.fillRect(cxr - fr, cyr - fr, fr * 2, fr * 2);
        }
      }
    }
  }

  /* --- 環間電弧：相鄰兩環之間閃現的鋸齒閃電（確定性排程，無縫循環）---
     路徑端點釘在兩個環的半徑上，中段用亂數中點位移出鋸齒；亂數種子含 floor(age×45)，
     所以同一道電弧在短短的生命期內會頻閃換形好幾次 —— 閃電的抖動感。 --- */
  if (Q.arcAmount > 0.005) {
    const pool = getArcPool(LOOP_SEC);
    const activeArcs = Math.round(Q.arcAmount * ARC_MAX_RATE * LOOP_SEC);
    const tLoop = ((noiseT % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
    const arcRot = ringAngle(1); // 電弧的出生角跟著主環旋轉
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const NSEG = ARC_SEGS;
    for (let i = 0; i < activeArcs && i < pool.length; i++) {
      const arc = pool[i];
      const age = ((tLoop - arc.birth) % LOOP_SEC + LOOP_SEC) % LOOP_SEC;
      if (age > arc.maxLife) continue;
      const lt = age / arc.maxLife;

      // 端點所在的兩個環：從池子的 0..1 值映射到目前環數，取相鄰一對；單環時往外跳一小段
      const nRings = Math.max(1, Math.round(Q.ringCount));
      const ringRadius = ri => R + (ri - (nRings - 1) / 2) * Q.ringGap;
      let r1, r2;
      if (nRings > 1) {
        const riA = Math.min(nRings - 2, Math.floor(arc.ringA * (nRings - 1)));
        r1 = ringRadius(riA); r2 = ringRadius(riA + 1);
      } else {
        r1 = R; r2 = R + (arc.ringB > 0.5 ? 1 : -1) * R * 0.12;
      }
      // 環距太小時電弧會扁到看不見 → 保底一個最小徑向落差
      if (Math.abs(r2 - r1) < R * 0.05) r2 = r1 + Math.sign(r2 - r1 || 1) * R * 0.05;

      const span = arc.spanT * Q.arcSpan * 1.1; // 角度跨幅（弧度）
      const a0 = arc.angle0 + arcRot;
      // 亮度包絡：快進快出 + 頻閃（種子隨 floor(age×45) 重擲 → 生命期內閃爍換形）
      const strobe = Math.floor(age * 45);
      const rnd = mulberry32(arc.seed + strobe * 131);
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, lt)), 0.5);
      const alpha = env * (0.55 + rnd() * 0.45) * flick;
      if (alpha < 0.03) continue;

      // 鋸齒路徑：角度線性走完跨幅，半徑從 r1 走到 r2，徑向抖動兩端釘死、中段最大
      const jagAmp = Q.arcJag * (Math.abs(r2 - r1) * 0.9 + R * 0.03);
      for (let sIdx = 0; sIdx <= NSEG; sIdx++) {
        const t = sIdx / NSEG;
        const ang = a0 + span * (t - 0.5);
        const pin = Math.sin(Math.PI * t); // 端點釘死
        const rj = r1 + (r2 - r1) * t + (rnd() - 0.5) * 2 * jagAmp * pin;
        arcPathX[sIdx] = cx + Math.cos(ang) * rj;
        arcPathY[sIdx] = cy + Math.sin(ang) * rj;
      }
      // 外層光暈 → 白熱核心，兩筆
      ctx.strokeStyle = `hsla(${Q.hue},${Q.sat}%,65%,${alpha * 0.3})`;
      ctx.lineWidth = Q.arcThickness * 4.5;
      strokeArcPath(ctx);
      ctx.strokeStyle = `hsla(${Q.hue},${Math.max(0, Q.sat - 55)}%,95%,${alpha})`;
      ctx.lineWidth = Q.arcThickness * 1.3;
      strokeArcPath(ctx);
      // 兩端接觸點的小閃光
      for (let endpoint = 0; endpoint <= NSEG; endpoint += NSEG) {
        const ex = arcPathX[endpoint], ey = arcPathY[endpoint];
        const fr = Q.arcThickness * 7;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, fr);
        g.addColorStop(0, `hsla(${Q.hue},30%,97%,${alpha * 0.8})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(ex - fr, ey - fr, fr * 2, fr * 2);
      }
    }
  }

  // 把拖尾緩衝區（環、火花、煙霧、太陽米粒等會拖尾流動的內容）貼到真正的輸出畫布上；
  // 星辰在這之後才畫，直接畫在輸出畫布上、完全不進入緩衝區，所以永遠不會被拖尾疊加殘影。
  // 注意：貼圖要用 1:1 實際像素（歸零變形矩陣），貼完務必還原成原本的 DPR 縮放矩陣，
  // 否則下一幀開始所有座標都會少縮放一次 DPR，環會越畫越小、拖尾也只淡到畫布左上角一小塊
  // （這正是稍早發現的「兩個環+黑色矩形接縫」那個 bug 的成因）。
  const outputTransform = outputCtx.getTransform();
  outputCtx.setTransform(1, 0, 0, 1, 0, 0);
  outputCtx.globalCompositeOperation = 'source-over';
  outputCtx.clearRect(0, 0, outputCtx.canvas.width, outputCtx.canvas.height);
  outputCtx.drawImage(ctx.canvas, 0, 0);

  // 放射光芒：先在獨立緩衝畫銳利的錐形光束，再整層模糊 → 柔邊 god-ray 質感。
  // 跟星辰一樣不進拖尾緩衝區，直接疊在輸出畫布上（旋轉時才不會被拖尾抹成一圈糊光）。
  if (Q.spikeAmount > 0.005) {
    if (spikeCanvas.width !== outputCtx.canvas.width || spikeCanvas.height !== outputCtx.canvas.height) {
      spikeCanvas.width = outputCtx.canvas.width; spikeCanvas.height = outputCtx.canvas.height;
    }
    spikeCtx.setTransform(outputTransform);
    spikeCtx.clearRect(0, 0, W, H);
    spikeCtx.globalCompositeOperation = 'lighter';
    const activeSpikes = Math.round(Q.spikeAmount * SPIKE_POOL_MAX);
    const spikeRot = ringAngle(1); // 跟主環同步旋轉
    for (let i = 0; i < activeSpikes; i++) {
      const sp = SPIKE_POOL[i];
      const a = sp.angle0 + spikeRot;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const tanX = -sinA, tanY = cosA; // 切線方向（錐形基部沿此展開）
      // 基部緊貼環面（帶微偏），往外放射；長度非線性分布，有長有短
      const rBase = R + sp.baseJitter * Q.thickness * 1.5;
      const outLen = R * (0.04 + Q.spikeLength * (0.12 + 0.9 * sp.lenT));
      const rTip = rBase + outLen;
      const halfW = Q.spikeWidth * (0.5 + 0.8 * sp.widT);
      const bx = cx + cosA * rBase, by = cy + sinA * rBase;
      const tx = cx + cosA * rTip, ty = cy + sinA * rTip;
      const alpha = sp.briT * flick;
      const grad = spikeCtx.createLinearGradient(bx, by, tx, ty);
      grad.addColorStop(0, `hsla(${Q.hue},${Q.sat}%,88%,${alpha})`);   // 基部最亮
      grad.addColorStop(0.35, `hsla(${Q.hue},${Q.sat}%,72%,${alpha * 0.5})`);
      grad.addColorStop(1, `hsla(${Q.hue},${Q.sat}%,65%,0)`);          // 尖端淡出
      spikeCtx.fillStyle = grad;
      // 錐形：基部寬、尖端收成一點
      spikeCtx.beginPath();
      spikeCtx.moveTo(bx - tanX * halfW, by - tanY * halfW);
      spikeCtx.lineTo(bx + tanX * halfW, by + tanY * halfW);
      spikeCtx.lineTo(tx, ty);
      spikeCtx.closePath();
      spikeCtx.fill();
    }
    // 整層模糊做出柔邊；柔邊=0 時完全銳利，往上調越糊越像光暈。
    // 用實際畫布縮放（outputTransform.a）換算成物理像素，讓即時預覽與匯出的模糊比例一致
    const pxScale = outputTransform.a || 1;
    const blurPx = Q.spikeBlur * Math.min(W, H) * 0.012 * pxScale;
    outputCtx.globalCompositeOperation = 'lighter';
    outputCtx.filter = blurPx > 0.3 ? `blur(${blurPx}px)` : 'none';
    outputCtx.drawImage(spikeCanvas, 0, 0);
    outputCtx.filter = 'none';
  }

  if (Q.starCount > 0) {
    outputCtx.globalCompositeOperation = 'lighter';
    outputCtx.drawImage(starCanvas, 0, 0);
  }

  /* --- 全域 Bloom：對「已經合成好的最終畫面」（環、電弧、脈衝波、火花、放射光芒、星辰全部在內）
     萃取亮部、模糊、疊加回去，讓所有元素的高光一起產生溢出光暈，而不是逐元素各自加光暈。
     用 CSS filter 的 contrast+brightness 粗略模擬「亮部萃取」：門檻越高，中低亮度被壓得越接近黑，
     模糊後幾乎不貢獻光量，只留下真正的亮部散開；縮小解析度畫也是一種便宜的模糊，同時省效能。 --- */
  if (Q.bloomAmount > 0.005) {
    const bw = outputCtx.canvas.width, bh = outputCtx.canvas.height;
    const bloomScale = 0.4;
    const dw = Math.max(1, Math.round(bw * bloomScale)), dh = Math.max(1, Math.round(bh * bloomScale));
    if (bloomCanvas.width !== dw || bloomCanvas.height !== dh) { bloomCanvas.width = dw; bloomCanvas.height = dh; }
    bloomCtx.clearRect(0, 0, dw, dh);
    const contrastPct = 100 + Q.bloomThreshold * 260;
    bloomCtx.filter = `contrast(${contrastPct}%) brightness(${60 - Q.bloomThreshold * 20}%)`;
    bloomCtx.drawImage(outputCtx.canvas, 0, 0, dw, dh);
    bloomCtx.filter = 'none';

    const pxScale = outputTransform.a || 1;
    const blurPx = Q.bloomRadius * Math.min(W, H) * 0.02 * pxScale;
    outputCtx.globalCompositeOperation = 'lighter';
    outputCtx.filter = blurPx > 0.3 ? `blur(${blurPx}px)` : 'none';
    outputCtx.globalAlpha = Math.min(1, Q.bloomAmount);
    outputCtx.drawImage(bloomCanvas, 0, 0, bw, bh);
    outputCtx.globalAlpha = 1;
    outputCtx.filter = 'none';
  }

  outputCtx.setTransform(outputTransform);
}
syncLoop();
