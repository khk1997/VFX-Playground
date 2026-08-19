'use strict';
import { smoothstepCPU } from './util.js?v=svg-shape-76';

// 這個模組同時服務兩個模式：形狀匯聚（完整的 gather → hold → release 時間軸）
// 與穿梭環繞（只借用自由飛行軌道的手法，不吸收水滴）。兩者共用 freeOrbitPosition
// 這條「整數諧波軌道」，拆開反而要把同一段數學複製兩份，所以放在一起。
//
// 錨點是 bubble.js 那邊隨匯入形狀重算的陣列（會整個換掉，不是就地修改），所以
// 用 getter 取得而不是把陣列本身傳進來——直接傳會抓到換掉之前的舊陣列。
export const MAIN_ORBIT_TUNE = { x2: 1.7, ax2: 0.12, y1: 0.62, y3: 0.8, ay3: 0.08, z2: 1.3, az2: 0.48 };
export const MICRO_ORBIT_TUNE = { x2: 1.3, ax2: 0.16, y1: 0.72, y3: 0.7, ay3: 0.10, z2: 1.9, az2: 0.52 };

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));

export default function createFormationMotion(P, {
  dropSeeds, anchors, weaveAnchors, frontAnchors, edgeScale,
}) {

// 亂流＋晶格的實際幅度。乘上 edgeScale（見 bubble.js 的 rebuildFormationEdgeScale）
// ——細筆畫的造型撐不住為厚實造型調出來的擾動量。波前餘裕與水滴出發參差都讀
// 這一個值，兩邊各縮各的會讓實體與水滴脫鉤。
const breakAmount = () => (P.formationNoise + P.formationCell) * (edgeScale?.() ?? 1);

// 自由軌道的暫存向量。刻意不與 bubble.js 那顆共用：那邊算微滴時也會呼叫
// freeOrbitPosition，共用同一顆就會在巢狀呼叫時互相覆寫。
const orbitScratch = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

// 定格呼吸：成形停留那段期間（gatherEnd → holdEnd）整顆造型的縮放呼吸，回傳
// 縮放增量（0 = 原尺寸）。
//
// 兩個「不是」：
//   不走距離場的等距膨脹（uShapeSwell，崩解噴濺蓄力用的那條）—— 等距偏移是把
//   輪廓整圈加粗，細筆畫之間還會互相靠攏黏起來，看起來是造型變胖而不是呼吸。
//   不走 formationAmount —— 那個值被十幾處 smoothstep 讀成「匯聚程度」，壓低它
//   等於把水滴又吐回去，正是舊「脈動呼吸」模式跟形狀匯聚看起來重疊的原因。
//
// 用 (1-cos) 的整數個週期，值與一階導數在 hold 兩端都是 0：呼吸不會滲進 gather /
// release，定格的頭尾也沒有速度跳變（慣性形變會讀速度）。
const HOLD_BREATH_CYCLES = 2;
function holdBreathScale(phase) {
  if (P.motion !== 'formation' || P.holdBreath <= 0) return 0;
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  if (holdEnd <= gatherEnd || phase <= gatherEnd || phase >= holdEnd) return 0;
  const u = (phase - gatherEnd) / (holdEnd - gatherEnd);
  return P.holdBreath * 0.5 * (1 - Math.cos(u * HOLD_BREATH_CYCLES * Math.PI * 2));
}

function formationAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  const gather = smoothstepCPU(phase, 0.04, gatherEnd);
  const release = smoothstepCPU(phase, holdEnd, 0.98);
  return gather * (1 - release);
}

function formationFidelityAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  // 直接使用循環 phase，而非已 smoothstep 過的 formationAmount 再平滑一次。
  // 預設 12 秒循環約有 2.6 秒完成吸收，避免末段在幾幀內由水滴跳成模型。
  const absorbStart = Math.max(0.08, gatherEnd - 0.22);
  const gatherAbsorb = smoothstepCPU(phase, absorbStart, gatherEnd);
  const releaseAbsorb = 1 - smoothstepCPU(phase, holdEnd, 0.98);
  return gatherAbsorb * releaseAbsorb;
}

function formationReleaseAmount(phase) {
  const gatherEnd = Math.max(0.15, P.gatherDuration);
  const holdEnd = Math.min(0.94, gatherEnd + P.shapeHold);
  return smoothstepCPU(phase, holdEnd, 0.98);
}

// ── 成型波前 ──────────────────────────────────────────────────────────────
// 形狀變形的「消失方式」整組搬過來，但語意是反過來的：morph 是波掃過的地方
// 消失，這裡是波掃過的地方才長出來。shader 端共用同一個 dissolveField 與同一組
// uniform（uShapeCut／uMorphBreak／uMorphNecking），只多了一道單向切削，不是
// 另一套實作。
//
// 真正的關鍵不是波前本身，而是「水滴的抵達順序也改由這個場決定」。舊版的順序
// 來自 dropSeeds 的 h3（純亂數），實體則走全域等距侵蝕——兩套時間軸各走各的，
// 水滴落定與形體浮現只是碰巧重疊，讀不出因果，所以水滴看起來不像在組成什麼。
// 改成同一把尺之後，波前的位置是直接從水滴的完成條件反解出來的（見
// formationCutFront），形體才會真的從水滴落定的地方長出來。理由與 morph.js 的
// morphFronts 同源，只是那邊解的是離開順序。

// 必須跟 shaders.js 的 dissolveField 是同一條式子（波前形狀那一層）。兩邊算的
// 不一樣，實體被放出來的位置就跟水滴抵達的位置對不上。亂流與晶格那兩層不在
// CPU 複製——理由同 morph.js：逐字重現成本高又容易走鐘，水滴那側改用索引雜湊
// 給等效的參差（見 formationLead）。
function formationFieldCPU(x, y, angle) {
  const front = Math.round(P.formationFront);
  if (front === 1) return Math.hypot(x, y);
  if (front === 2) return Math.hypot(x, y) + Math.atan2(y, x) * P.formationSpiral;
  return x * Math.cos(angle) + y * Math.sin(angle);
}

// 掃描範圍一定要用「這個角度下實際的投影範圍」，不能用外接半徑之類的固定尺度：
// 固定尺度時投影幾乎取不到兩端，最後一批水滴永遠等不到波前，形狀會缺一角。
// 每幀對錨點掃一遍是幾百筆加法，角度／波前形狀／錨點都沒動時結果不變，所以拿
// 它們當快取 key。錨點在換形狀時是整個陣列換掉（不是就地改），比對物件本身就夠。
let rangePool = null, rangeKey = '', rangeLo = 0, rangeSpan = 1;
function formationWaveRange(angle) {
  const pool = frontAnchors?.() || anchors();
  const key = `${angle}:${P.formationFront}:${P.formationSpiral}`;
  if (rangePool !== pool || rangeKey !== key) {
    let lo = Infinity, hi = -Infinity;
    for (const s of pool) {
      const value = formationFieldCPU(s.x, s.y, angle);
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    rangePool = pool;
    rangeKey = key;
    rangeLo = Number.isFinite(lo) ? lo : 0;
    rangeSpan = Math.max(1e-4, hi - lo);
  }
  return { lo: rangeLo, span: rangeSpan };
}

const waveAngle = () => P.formationWaveAngle * DEG;
const staggerAmount = () => Math.max(0, Math.min(0.9, P.formationStagger));
// 錯開量 0 會讓波前的反解發散（所有水滴同時抵達，波前就沒有寬度可言），夾一個
// 下限當防呆。跟 morph.js 的 MIN_STAGGER 是同一件事，不是想調出什麼效果。
const MIN_STAGGER = 0.05;

// 索引雜湊：同一顆水滴每幀必須拿到完全一樣的偏移，否則它自己會抖。
const hashJitter = i => (Math.sin(i * 78.233 + 12.9898) * 43758.5453) % 1;

// 一個目標點在掃描順序上的位置：0 = 最先成形，1 = 最後。疊上去的參差有兩個
// 來源——實體邊緣的擾動量（亂流／晶格開得愈大，邊緣愈參差，水滴的抵達時機也
// 該跟著參差），以及使用者自己要的隨機錯開 formationJitter。
function formationLead(x, y, i) {
  const angle = waveAngle();
  const { lo, span } = formationWaveRange(angle);
  const spatial = (formationFieldCPU(x, y, angle) - lo) / span;
  const jitterAmp = breakAmount() * 0.5 + P.formationJitter * 0.3;
  return clamp01(spatial + hashJitter(i) * jitterAmp);
}

// 把全域的匯聚程度平移成單顆水滴的 0→1。散開時 amount 自己走回來，這條式子
// 不必特別處理回程——最後成形的區域最先化回水滴，本來就是逆放的樣子。
function formationLocalAmount(amount, lead) {
  const stagger = staggerAmount();
  return clamp01((amount - lead * stagger) / (1 - stagger));
}

// 餘裕：形狀本身一定比錨點的包圍範圍再大一圈（描邊有寬度、擠出有厚度），而且
// 亂流與晶格是直接加在場值上的。波前不多走這一段，邊緣就會留下永遠長不出來的
// 缺口。
//
// 0.10 是從錨點取樣密度回推的：錨點鋪在形狀上的網格步距約是世界尺寸的 1/32
// （見 shape-field.js 的 step），加上筆畫半寬，0.1×投影範圍已經綽綽有餘。原本
// 沿用 morph 的 0.18 —— 那個值在實測裡讓波前的行程比形狀本身長 76%，等於掃描
// 有四成時間停在形狀外面，讀起來就是「等很久、然後突然一次長完」。
const FRONT_MARGIN = 0.10;

// 實體的成型波前，給 shader 的 uShapeCut 用。
//
// 不是另外編出來的曲線，而是從水滴的完成條件反解：水滴在
// amount = lead·stagger + (1-stagger) 時抵達，把 lead 解出來就是「到這裡為止的
// 水滴都已經落定」那條線。所以實體與水滴天生咬合，不是兩條各自調出來的曲線。
function formationCutFront(amount) {
  const angle = waveAngle();
  const { lo, span } = formationWaveRange(angle);
  const width = Math.max(MIN_STAGGER, staggerAmount());
  const margin = FRONT_MARGIN * span + breakAmount();
  const lead = clamp01((amount - (1 - width)) / width);
  return {
    nx: Math.cos(angle),
    ny: Math.sin(angle),
    front: lo - margin + lead * (span + margin * 2),
  };
}

// 每顆水滴的自由段只使用整數諧波，因此 phase=0/1 的位置與速度完全相同。
// 匯集與散開共用同一個 formationAmount，故兩段是同一路徑的正反向。
// 匯聚前的自由飛行軌道。原本每顆水滴共用同一組 sin/cos 相位，只有起始角不同，
// 於是整群一律同方向繞行、又都在同一個軌道平面上，看起來像一塊剛體在轉。
// formationVariety 讓每顆各自決定旋轉方向與軌道平面傾角。
//
// 方向只取 ±1、諧波仍然只用整數倍，所以 phase=0/1 的位置與速度依舊完全相同 ——
// 循環接縫不會跳（跟 weaveDropPosition 是同一條限制）。
// varietyAmount 讓呼叫端決定用哪一根「多樣性」滑桿：形狀匯聚吃 formationVariety、
// 穿梭環繞吃 weaveVariety。不寫死成 P.formationVariety，是因為那樣等於讓匯聚那根
// 滑桿偷偷控制另一個模式。
function freeOrbitPosition(a, anchor, orbit, h2, h3, tune, out, varietyAmount = P.formationVariety) {
  const variety = Math.max(0, Math.min(1, varietyAmount));
  // h3 < variety/2 的那些反向繞行：variety=0 時沒有任何一顆反向，=1 時約半數。
  const spin = a * (h3 < variety * 0.5 ? -1 : 1);
  const radial = 1 + (h2 - 0.5) * variety * 0.6;
  const x = (Math.cos(spin + anchor) * orbit
    + Math.cos(spin * 2 + anchor * tune.x2) * orbit * tune.ax2) * radial;
  const y = (Math.sin(spin + anchor) * orbit * tune.y1
    + Math.sin(spin * 3 + anchor * tune.y3) * orbit * tune.ay3) * radial;
  const z = Math.sin(spin * 2 + anchor * tune.z2) * orbit * tune.az2 * radial;
  // 繞 X 軸把整條軌道傾斜；y/z 一起轉，軌道本身的形狀不變，只是換了個平面。
  const tilt = (h3 - 0.5) * variety * Math.PI;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return out.set(x, y * ct - z * st, y * st + z * ct);
}

// 液體離開自由飄浮、被吸進造型時是「先鼓起一段弧線再拉進去」，不是直線飛過去——
// 直接搬 morph.js 的弧線隆起手法（那邊已經證明過直線插值看起來像瞬移）。方向取
// 自由位置與目標位置中點相對原點的外凸向量；弧高隨這段實際要走的距離收放，
// 幾乎不用移動的水滴不該憑空往外彈。amount 兩端（未出發／已定格）都是 0，
// 所以只在匯聚/散開途中出現，不影響 hold 段的最終外形。
function formationArcLift(freeX, freeY, freeZ, tx, ty, tz, amount, out) {
  const arc = P.formationArc;
  if (arc <= 0) return out;
  const mx = (freeX + tx) * 0.5, my = (freeY + ty) * 0.5, mz = (freeZ + tz) * 0.5;
  const mLen = Math.hypot(mx, my, mz);
  const ox = mLen > 1e-4 ? mx / mLen : 0;
  const oy = mLen > 1e-4 ? my / mLen : 1;
  const oz = mLen > 1e-4 ? mz / mLen : 0;
  const dist = Math.hypot(tx - freeX, ty - freeY, tz - freeZ);
  const lift = arc * Math.sin(Math.PI * Math.max(0, Math.min(1, amount))) * Math.min(1, dist);
  return out.set(out.x + ox * lift, out.y + oy * lift, out.z + oz * lift);
}

function formationDropPosition(i, phase, count, out) {
  const a = phase * TAU;
  const { h1, h2, h3 } = dropSeeds[i];
  const anchor = i * TAU / count + h1 * 1.4;
  const orbit = P.spread * (1.25 + h2 * 0.65);
  const free = freeOrbitPosition(a, anchor, orbit, h2, h3, MAIN_ORBIT_TUNE, orbitScratch);
  const freeX = free.x, freeY = free.y, freeZ = free.z;
  const pool = anchors();
  const target = pool.length ? pool[i % pool.length] : null;
  const tx = target ? target.x : Math.cos(anchor) * 0.7;
  const ty = target ? target.y : Math.sin(anchor) * 0.7;
  const tz = target ? target.z : 0;
  // 主滴跟微滴讀同一套抵達順序：波前掃到這顆的目標位置，它才落定。沒有錨點
  // （還沒匯入形狀）時退回全域進度，那種情況下也沒有波前可言。
  const amount = P.formationFrontOn && target
    ? formationLocalAmount(formationAmount(phase), formationLead(tx, ty, i))
    : formationAmount(phase);
  const eased = amount * amount * (3 - 2 * amount);
  out.set(
    freeX + (tx - freeX) * eased,
    freeY + (ty - freeY) * eased,
    freeZ + (tz - freeZ) * eased,
  );
  return formationArcLift(freeX, freeY, freeZ, tx, ty, tz, amount, out);
}

// 造型的外接半徑（錨點離原點最遠的距離）。繞行軌道要照造型大小走，寫死的話
// 寬扁的文字外框會被一個圓形軌道整個罩住、水滴永遠離造型很遠。錨點換形狀時是
// 整個陣列換掉，比對物件本身就夠當快取 key。
let radiusPool = null, shapeRadius = 1;
function weaveShapeRadius(pool) {
  if (radiusPool !== pool) {
    let r = 0;
    for (const p of pool) r = Math.max(r, Math.hypot(p.x, p.y, p.z));
    radiusPool = pool;
    shapeRadius = Math.max(0.35, r);
  }
  return shapeRadius;
}

// 穿梭環繞：水滴繞著造型跑，繞到背面時會被玻璃折射過去——這個模式的名字承諾的
// 就是這件事。
//
// 舊版不是這樣：每顆水滴分到一個表面錨點當「家」，然後一整個循環都只在家附近
// 原地晃（幅度約 0.14~0.26），沒有任何位移軌跡。六顆還共用同一條 sin/cos 式子、
// 只差相位，於是畫的是同一個小李薩如圖形。讀起來是「六顆球在不動的造型旁邊
// 抖」，眼睛沒有東西可以追。
//
// 現在改成在「原地飄浮」與「繞行造型」之間插值，由 weaveOrbit 控制：0 完全等於
// 舊行為（想退回去隨時可以），1 是繞一整圈。兩條路徑都是整數諧波、同一個週期，
// 所以插值出來仍然滿足 phase=0/1 位置與速度完全相同，循環接縫不會跳。
//
// 繞行段直接用 freeOrbitPosition——那條式子已經處理好接縫、反向繞行與軌道平面
// 傾斜（傾斜正是水滴會跑到造型前後的原因），沒有理由再寫一份。
function weaveDropPosition(i, phase, count, out) {
  const surface = weaveAnchors();
  const pool = surface.length ? surface : anchors();
  if (!pool.length) return out.set(0, 0, 0);
  const { h1, h2, h3 } = dropSeeds[i];
  const home = pool[Math.floor(h2 * pool.length) % pool.length];
  // 速度只能用整數倍率：sin(k·phase·2π) 對整數 k 而言在 phase=0/1 仍完全同值，
  // 换成非整數會在循環接縫留下跳變。繞行與飄浮共用同一個倍率，兩者才同週期。
  const speed = Math.max(1, Math.round(P.weaveDriftSpeed));
  const a = phase * TAU * speed;
  const driftScale = (0.14 + h1 * 0.12) * P.weaveDriftAmount;
  const wx = Math.cos(a + h1 * TAU) * driftScale
    + Math.cos(a * 2 + h3 * TAU) * driftScale * 0.4;
  const wy = Math.sin(a * 2 + h2 * TAU) * driftScale * 0.8
    + Math.sin(a * 3 + h1 * TAU) * driftScale * 0.3;
  const wz = Math.sin(a + h3 * TAU) * driftScale * 0.6;
  const orbitAmount = Math.max(0, Math.min(1, P.weaveOrbit));
  if (orbitAmount <= 0) return out.set(home.x + wx, home.y + wy, home.z + wz);
  // 半徑跨在造型外接半徑上下：偏小的那些會從造型的凹處與筆畫之間穿過去（「穿梭」），
  // 偏大的在外圍繞（「環繞」）。起始角依索引均分，六顆才不會擠成一團。
  const orbit = weaveShapeRadius(pool) * (0.78 + h2 * 0.62);
  const anchor = i * TAU / Math.max(1, count) + h1 * 1.4;
  const ring = freeOrbitPosition(
    a, anchor, orbit, h2, h3, MICRO_ORBIT_TUNE, orbitScratch, P.weaveVariety,
  );
  return out.set(
    (home.x + (ring.x - home.x) * orbitAmount) + wx,
    (home.y + (ring.y - home.y) * orbitAmount) + wy,
    (home.z + (ring.z - home.z) * orbitAmount) + wz,
  );
}

  return {
    holdBreathScale,
    formationAmount,
    formationFidelityAmount,
    formationReleaseAmount,
    freeOrbitPosition,
    formationDropPosition,
    formationArcLift,
    formationLead,
    formationLocalAmount,
    formationCutFront,
    weaveDropPosition,
  };
}
