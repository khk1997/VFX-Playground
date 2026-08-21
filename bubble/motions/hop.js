'use strict';

// 起跳彈跳 Hop：經典的落球彈跳。蓄力擠壓 → 彈射拉伸上升 → 落地擠壓吸震，然後
// 一次比一次矮地再彈幾下，最後貼地收乾淨。走的是動畫裡的 squash & stretch +
// anticipation，跟 jelly.js 一樣刻意不做真實物理（沒有碰撞解算、沒有真的重力
// 積分），用大家看慣的運動節奏去說服眼睛。
//
// 「一次比一次矮」是這個節奏的靈魂：等高重複跳看起來像機械彈簧，不像球。高度
// 每跳乘上 hopDecay，而每一跳的「滯空時間」則取 sqrt(高度)——這是自由落體
// h = ½gt² 的反解，也是為什麼真實的彈跳聽起來（跟看起來）是越來越急促的鼓點，
// 而不是等間隔。時間軸因此不能均分，必須按 sqrt 權重去切。
//
// 這個模組跟果凍是兩條獨立的彈簧，但共用同一顆形狀，所以刻意不去動角度／扭轉
// 那組欄位（那是果凍的地盤），只管「往上抬多高」跟「蓄力/拉伸擠壓多少」。
// 兩者的輸出在 bubble.js 相加合成，而不是二選一。
//
// 循環接縫：一圈的頭尾都是「貼在地上、未變形」的同一個狀態（第一跳起跳前的
// 蓄力段從鬆開開始，最後一跳落地後的收尾段回到鬆開），所以接得上，不需要額外
// 的緩動段。
export default function createHopMotion(P) {
  const hash = k => {
    const v = Math.sin(k * 63.913 + 7.238) * 12543.847;
    return v - Math.floor(v);
  };

  // 蓄力與收尾各自的時間權重（跟各段滯空的 sqrt 權重同一個尺度下比較）。
  // 蓄力壓一下就該彈出去，太長會像在拖時間；收尾要留得比蓄力寬，落地後的
  // 那幾下餘震（由果凍負責）才有地方響完。
  const ANTICIPATION_WEIGHT = 0.35;
  const SETTLE_WEIGHT = 1.2;

  // 接觸前後把拉伸收回圓球的那一小段（占一段滯空的比例）。
  //
  // 拉伸要跟著「速度」而不是「高度」：球在貼地附近跑得最快，該被拉最長；到了
  // 頂點速度為零，該是圓的。反過來做（頂點最長、貼地最圓）會變成「球在最高點
  // 被拉扁」，那是這版落地看起來怪的主因之一。
  //
  // 但純速度剖面 |cos(bπ)| 在接觸那一瞬是最大值，而每次彈跳的速度又因為衰減
  // 而不同（撞地前快、離地後慢），接縫兩側的拉伸量因此對不上，會在落地那一格
  // 跳一下。收這個尾巴同時解掉兩件事：接觸瞬間拉伸歸零，接縫兩側都是 0 所以
  // 精確接上；而且「接觸前一瞬收圓 → 撞擊壓扁 → 離地再拉長」正好就是傳統動畫
  // 畫落地那三格的樣子。
  const CONTACT_TAPER = 0.14;

  // 平滑收尾用的 smoothstep，兩端一階導數為 0，接起來不會有折角。
  const smooth = x => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  // 把一圈切成「蓄力 → 第1跳 → 第2跳 → … → 收尾」，回傳各段的起訖相位。
  // 每跳的高度遞減、滯空時間取 sqrt(高度)，所以段落寬度天生不等長。
  // 低於第一跳這個比例的彈跳直接不排。衰減調很兇時後面幾跳的高度會掉到
  // 幾乎為零，而段落寬度取 sqrt(高度)，於是那幾段會擠成比一格畫面還窄的
  // 細縫——肉眼看不到那顆球彈起來，卻每過一縫就重置一次果凍的戳擊，變成
  // 原地抽動。看不見的彈跳就別排進時間軸，把時間讓給收尾段抖完餘震。
  const MIN_VISIBLE_RATIO = 0.01;

  function buildArcs(height, hops, decay) {
    const arcs = [];
    let h = height;
    let weightSum = ANTICIPATION_WEIGHT;
    for (let i = 0; i < hops; i++) {
      if (i > 0 && h < height * MIN_VISIBLE_RATIO) break;
      const w = Math.sqrt(h);
      arcs.push({ height: h, weight: w });
      weightSum += w;
      h *= decay;
    }
    weightSum += SETTLE_WEIGHT * Math.sqrt(Math.max(arcs[arcs.length - 1].height, 1e-6));
    // 正規化成相位區間。
    let cursor = ANTICIPATION_WEIGHT / weightSum;
    const anticipationEnd = cursor;
    for (const arc of arcs) {
      arc.start = cursor;
      cursor += arc.weight / weightSum;
      arc.end = cursor;
    }
    return { anticipationEnd, arcs, settleStart: cursor, settleSpan: 1 - cursor };
  }

  function hopTransform(phase) {
    const height = Math.max(0, P.hopHeight);
    if (height <= 0) return null;
    const hops = Math.max(1, Math.round(P.hopCount));
    const decay = Math.min(1, Math.max(0.1, P.hopDecay));
    const anticipation = Math.max(0, P.hopAnticipation);
    const stretch = Math.max(0, P.hopStretch);
    const sway = P.hopSway;
    const gravity = P.hopGravity;

    const { anticipationEnd, arcs, settleStart, settleSpan } = buildArcs(height, hops, decay);

    let offsetY = 0;
    let scaleY = 1;
    // 擠壓拉伸的支點要不要壓在「腳底那條地面」上（1＝完全踩地，0＝完全以造型
    // 中心為支點）。踩在地上被壓扁時底部必須黏著地面，往上縮的是頭頂——支點
    // 放在中心的話整顆會往上縮、底部離地，看起來是懸空的球在自己變形。
    // 但騰空的時候相反：自由飛行中沒有接觸點，這時候的拉長本來就該從重心往
    // 兩端延伸，硬把底部釘住會變成「從一個固定點長高」。所以用離地高度去
    // 混——貼地時 1、頂點時 0，兩端都連續，不會在起跳／落地那一格跳掉。
    let groundAnchor = 1;
    // 交給果凍：每一次落地都是一發戳擊。index 換號代表「這是新的一次撞擊」，
    // driveE 是那次撞擊之後過了多久（0＝撞擊瞬間，1＝餘震收乾），driveStrength
    // 是這一下撞得多重（＝從多高掉下來，正規化成第一跳的比例）。撞擊力道要
    // 傳出去，越彈越矮時餘震才會跟著變小、最後安靜下來。
    let driveIndex = 0;
    let driveE = 1;
    let driveStrength = 0;
    // 側移的累進段數：每飛過一段就往同一個方向多推一點，看起來是「邊彈邊往前
    // 滾」而不是原地上下震。
    let swayBase = 0;
    let swayLocal = 0;

    if (phase < anticipationEnd) {
      // 蓄力：原地下壓，越接近起跳瞬間壓得越深。phase=0 時完全鬆開，跟上一圈
      // 收尾段的鬆開狀態接續。
      const a = anticipationEnd > 0 ? phase / anticipationEnd : 0;
      const squash = anticipation * Math.sin(a * Math.PI * 0.5) * (1 - a);
      scaleY = 1 - squash;
      // 蓄力是「還沒撞擊」，果凍維持收乾狀態，別在起跳前先抖起來。
      driveIndex = 0;
      driveE = 1;
    } else if (phase < settleStart) {
      let index = arcs.length - 1;
      for (let i = 0; i < arcs.length; i++) {
        if (phase < arcs[i].end) { index = i; break; }
      }
      const arc = arcs[index];
      const span = Math.max(1e-6, arc.end - arc.start);
      const b = (phase - arc.start) / span;
      // 一段對稱的弧線，頂點在半途、頭尾都回到地面（|2b-1|^g 在 b=0 與 b=1 都
      // 是 1，扣掉之後精確為 0，跟前後段的地面高度接得上）。
      //
      // 指數 g 就是「重力有多重」。原本寫死 sin(bπ)，它在撞地瞬間的速度是 π·h，
      // 比真實重力還慢——等加速度運動的軌跡是拋物線而不是正弦，撞地速度 4·h，
      // 差了約 27%，這是墜落覺得沒力的根本原因。
      //   g = 2 → 正好是拋物線，也就是真實的等加速度重力
      //   g > 2 → 頂點更平（滯空更久）、兩側更陡（撞地更快），誇張的沉重感
      //   g < 2 → 接近等速直線，飄浮感
      const g = Math.max(1.05, gravity);
      const away = Math.abs(2 * b - 1);
      const arcLift = 1 - Math.pow(away, g);
      offsetY = arcLift * arc.height;
      // 拉伸跟著速度：貼地附近跑最快、拉最長，頂點速度為零所以是圓的。接觸
      // 前後再用 CONTACT_TAPER 收回圓球（理由見上面那段註解）。振幅取
      // sqrt(高度)——起跳速度跟高度是平方關係，矮跳的拉伸才不會跟大跳一樣誇張。
      //
      // 速度就是 arcLift 的導數（正規化掉常數）：|2b-1|^(g-1)。g = 2 時剛好是
      // 線性的 |2b-1|——等加速度下速度隨時間線性增加，跟真實重力一致。
      //
      // 指數夾在 1 以上：g < 2 時真正的導數指數會小於 1，而 |x|^(<1) 在頂點的
      // 斜率是無限大——離開頂點一丁點，拉伸就從 0 暴衝上去，頂點會啪一下彈掉
      // （實測 g=1.2 時單步跳變 2.2e-2、頂點偏離圓 2.4%）。位置曲線本身沒事，
      // 壞的只有這個拉伸代理量，所以夾住它就好。g >= 2（含真實重力）不受影響。
      const speed = Math.pow(away, Math.max(1, g - 1));
      const taper = smooth(b / CONTACT_TAPER) * smooth((1 - b) / CONTACT_TAPER);
      scaleY = 1 + stretch * Math.sqrt(arc.height / height) * speed * taper;
      // 撞擊＝上一段的落地，也就是這一段的起點。第一段是從蓄力彈出去的「起跳」
      // 而不是落地，所以不給餘震（蓄力那段的下壓已經是它的形變了）。
      //
      // 餘震強度再乘上「離地程度」：撞擊變形是接觸現象，該在貼地附近發生完，
      // 不該一路震到最高點。不衰減的話餘震會在整段滯空裡來回擺盪，跟速度拉伸
      // 疊出好幾個拉伸峰——看起來就是起跳拉伸了兩下，而且頂點也不圓了。乘上
      // groundAnchor（貼地 1、頂點 0）之後，餘震被壓回落地那一小段，頂點必然
      // 回到純速度剖面決定的圓球。
      driveIndex = index;
      driveStrength = index > 0
        ? (arcs[index - 1].height / height) * (1 - arcLift)
        : 0;
      // 餘震窗不能跟著滯空時間伸縮：大跳滯空久，晃動會被拉成慢動作果凍；小跳
      // 又擠成蜂鳴。取一個固定的材質時間（收尾段的寬度），再用這一段的長度夾住
      // ——夾住是必要的，餘震一定要在下一次撞擊前收乾，否則 driveE 會從半途
      // 被重設成 0，晃動就跳一格。
      const ringSpan = Math.min(settleSpan, span);
      driveE = Math.min(1, (phase - arc.start) / ringSpan);
      swayBase = index;
      swayLocal = b;
      groundAnchor = 1 - arcLift;
    } else {
      // 收尾：最後一跳落地了，貼在地上把餘震抖完。位移歸零，形變交給果凍，
      // 這裡只把 scaleY 留在 1，phase→1 時就是循環開頭那個鬆開狀態。
      const s = (phase - settleStart) / Math.max(1e-6, 1 - settleStart);
      driveIndex = arcs.length;
      driveStrength = arcs[arcs.length - 1].height / height;
      driveE = s;
      swayBase = arcs.length;
      swayLocal = s;
    }

    const scaleXZ = 1 - (scaleY - 1) * 0.45;
    // 側移：整圈往同一個方向推進，每段推 sway 的距離；一圈結束前的收尾段把
    // 累積量帶回 0，循環才接得上（否則每圈都會往同一邊平移過去）。
    const totalSegments = arcs.length + 1;
    const swayProgress = (swayBase + swayLocal) / totalSegments;
    const dir = hash(1) * 2 - 1;
    const offsetX = sway * dir * Math.sin(swayProgress * Math.PI);

    return {
      offsetX,
      offsetY,
      scaleX: scaleXZ,
      scaleY,
      scaleZ: scaleXZ,
      driveIndex,
      driveE,
      driveStrength,
      groundAnchor,
    };
  }

  return { hopTransform };
}
