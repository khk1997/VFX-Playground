'use strict';

import createMeltMotion, { selectBottomAnchors } from '../melt.js?v=svg-shape-76';

// 融化的執行期模組。
//
// 這個模式的形狀從頭到尾完整不變：滴下去的是額外長出來的水滴，不是造型被削掉
// 的部分。所以它自己的內容只有三樣——滴落點、每顆水滴的「長出→墜落→縮到 0」
// 包絡、以及那顆水滴當下被拉成什麼形狀。
//
// 滴落點取自形狀底部，取樣範圍與種子是滑桿，所以跟崩解切法一樣用 key 快取而不是
// 每幀重挑。形狀本身（shapeTargets）與它的版本號（shapeSerial）是 bubble.js 才
// 知道何時換掉的狀態，以 getter 傳進來。
export function createMeltRuntime({ params: P, maxDrops, shapeTargets, shapeSerial }) {
  let bottomAnchors = [];
  let anchorKey = null;

  const { meltDrop } = createMeltMotion(P, { bottomAnchors: () => bottomAnchors });

  // 每顆水滴這一幀的形狀（拉長／頸／彈動）。位置迴圈算出來，形變迴圈讀取——
  // 那個迴圈拿不到位置迴圈的區域變數，所以在這裡接一手。
  const deformNow = Array.from({ length: maxDrops }, () => null);

  const active = () => P.motion === 'melt';

  function rebuildAnchors() {
    const key = `${shapeSerial()}:${P.meltBand.toFixed(3)}:${Math.round(P.meltSeed)}`;
    if (key === anchorKey) return;
    anchorKey = key;
    bottomAnchors = selectBottomAnchors(
      shapeTargets(), maxDrops, P.meltBand, Math.round(P.meltSeed),
    );
  }

  return {
    active,
    rebuildAnchors,
    // 換形狀之後下一幀要重挑滴落點。key 本來就帶著形狀版本號，這裡是雙保險。
    resetAnchors() { anchorKey = null; },
    anchors: () => bottomAnchors,

    // 主滴。位置寫進 out，回傳 null 表示這顆水滴此刻不存在（呼叫端維持原位、
    // 半徑給 0）。順手記下這一幀的形變供下面的 deform() 讀。
    mainDrop(index, phase, out) {
      // 主滴與微滴餵不同的種子基底，同一個滴落點才會有大小、時機都不同的水滴
      // 輪流落下，看起來是連續的水流而不是整齊的節拍器。
      const state = meltDrop(index, phase, index * 7.13, out);
      deformNow[index] = state ? state.deform : null;
      return state;
    },

    // 微滴。滴落點就那幾個，只靠主滴撐不出「不停在滴」的密度，微滴補上去之後
    // 同一個位置才會有前後好幾滴同時在不同高度。
    microDrop(index, phase, out) {
      // 種子基底刻意跟主滴那條（index * 7.13）錯開，同一個滴落點的主滴與微滴才
      // 不會同步落下、疊成一顆。
      const state = meltDrop(index, phase, index * 3.41 + 101.7, out);
      return {
        // 微滴是主滴的縮小版，撐體積的是主滴，這裡只負責補密度。
        radius: state ? state.radius * 0.62 : 0,
        // 微滴的 SDF（microDropletDistance）只吃主軸與拉長，沒有尖端與彈動那兩個
        // 通道，所以只套得上垂直拉長；而且它把 stretch 夾在 [1, 1.65]，墜落期的
        // 壓扁（<1）會被夾成 1，等於微滴只在懸掛時被拉長。以微滴的尺寸來說看不出
        // 差別，不值得為它擴一組 uniform。
        stretch: state ? state.deform.stretch : 1,
      };
    },

    // 這顆主滴這一幀的形變；null 表示它此刻不存在。
    //
    // 呼叫端會把形變主軸固定朝上，不用量到的速度。理由有兩個：懸掛期水滴幾乎
    // 不動，speed 趨近 0 時通用那段會退化成 (1,0,0)，變成把水滴橫向拉長；而水滴
    // 重生的那一幀位置會從半空瞬移回錨點，量到的速度是個假尖峰。
    // 朝上（而不是朝著墜落方向）是因為 shader 的尖端長在 +軸端，而真實懸掛水滴
    // 的頸在上方、連著造型那一側。
    deform: index => deformNow[index],

    // 融合半徑取中間值：這個 uniform 是整幀共用的，而畫面上同時有「還黏在造型
    // 底部正在形成」與「已經墜到半空」兩種水滴。收太緊，正在形成的那顆會變成貼
    // 在表面的一顆獨立球，失去液體被拉出來的樣子；放太鬆，落下的幾滴會彼此牽絲
    // 黏成一條水柱。0.4 是兩者都還能看的折衷，再細調交給「黏度」滑桿。
    mergeScale: () => 0.4,
  };
}
