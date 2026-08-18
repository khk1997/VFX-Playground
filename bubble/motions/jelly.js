'use strict';

// 果凍 Jelly：造型從頭到尾完整靜止，只是週期性被「戳一下」，然後像果凍一樣
// 阻尼彈簧回彈晃動幾下才平息。
//
// 這個模式刻意不做真實物理（沒有質量、沒有碰撞、沒有重力解算）。真要寫實地
// 模擬軟體形變，需要的是體積網格與彈簧解算器，而 metaball + SDF 這條管線給不
// 出那種東西——硬做只會落進「像慢動作融化」的詭異谷。改走卡通彈性語言：用
// 「瞬間衝擊 → 過衝 → 遞減回彈」這個大家看慣的運動節奏去說服眼睛，觀眾就
// 不會用「這物理對不對」去挑剔它。
//
// 循環接縫的保證（跟 shapeRigid.js 是同一條限制，但這裡不是用整數諧波）：
//   包絡 env(e) = exp(-decay·e) · (1 - e) 在 e = 1 時精確為 0；
//   振盪 sin(2π·bounces·e) 在整數 bounces 下於 e = 0 與 e = 1 都精確為 0。
// 兩者相乘，位移與其一階導數在每一次戳擊的頭尾都是 0 —— 前一次的晃動一定
// 收乾淨了下一次才開始，循環頭尾也因此精確接上，不需要額外的收尾緩動段。
//
// e = 0 那一瞬間位移是 0 但速度不是（env(0)·2π·bounces），這正是「被戳到」
// 該有的樣子：衝擊是速度的突變，不是位置的突變。位置突變看起來會像跳格。
export default function createJellyMotion(P) {
  // 每次戳擊的表現差異。同一顆果凍每次都用完全一樣的晃法會很機械，所以依
  // 戳擊序號雜湊出扭轉方向與側傾量。用序號而不是時間雜湊：同一次戳擊在它
  // 持續的那段時間裡必須拿到同一組值，否則果凍會自己抖。
  const hash = k => {
    const v = Math.sin(k * 91.7351 + 4.1327) * 43758.5453;
    return v - Math.floor(v);
  };

  function jellyTransform(phase) {
    const amp = Math.max(0, P.jellyAmount);
    if (amp <= 0) return null;
    // 戳擊次數必須是整數，否則最後一次會被循環接縫切斷在晃動中途。
    const pokes = Math.max(1, Math.round(P.jellyPokes));
    const bounces = Math.max(1, Math.round(P.jellyBounces));
    const decay = Math.max(0, P.jellyDamping);

    // 這一次戳擊是第幾發、以及距離它過了多久（e ∈ [0, 1)）。
    const scaled = phase * pokes;
    const index = Math.floor(scaled);
    const e = scaled - index;

    // 阻尼包絡。(1 - e) 那一項是循環接縫的保險：純指數衰減永遠不會真的到 0，
    // 阻尼調低時晃動會拖過接縫，接上下一次戳擊時就跳一下。
    const env = Math.exp(-decay * e) * (1 - e);
    const wobble = env * Math.sin(bounces * Math.PI * 2 * e);

    // 垂直擠壓拉伸是「果凍被戳」最好讀的一項：往下壓扁時橫向鼓出去，回彈時
    // 反過來。XZ 收放取 Y 的 0.45 倍而不是等量，讓體積看起來大致守恆但仍留
    // 一點「被壓縮」的份量，完全守恆反而顯得僵硬。
    const squash = wobble * amp;
    const scaleY = 1 + squash;
    const scaleXZ = 1 - squash * 0.45;

    // 側傾與扭轉：同一條波形、每次戳擊換一次方向與強度，看起來像從不同角度
    // 被戳到。振幅刻意小（最大 ±jellyTwist 度），主角仍是擠壓拉伸。
    const dir = hash(index + 1) * 2 - 1;
    const twist = wobble * P.jellyTwist * dir * Math.PI / 180;
    const lean = wobble * P.jellyTwist * (hash(index + 7) * 2 - 1) * 0.6 * Math.PI / 180;

    return {
      angleX: lean,
      angleY: twist,
      angleZ: twist * 0.5,
      // 被戳下去時整顆略微下沉，回彈時抬起——擠壓與重心同步，果凍才不會看
      // 起來是「原地變形的橡皮」而是「真的被推了一下」。
      offsetY: -squash * 0.35,
      scaleX: scaleXZ,
      scaleY,
      scaleZ: scaleXZ,
    };
  }

  return { jellyTransform };
}
