'use strict';

import createJellyMotion from '../jelly.js?v=svg-shape-76';
import createHopMotion from '../hop.js?v=svg-shape-76';

// 果凍的執行期模組。
//
// 這個模式有兩條互斥的分支，由 jellyStyle 選：
//   * 原地戳擊：造型完整靜止，週期性被戳一下做阻尼彈簧回彈（jelly.js）。
//   * 落地彈跳：走自己的蓄力／拋物線／速度拉伸（hop.js），每次落地把撞擊的時機
//     與力道交給 jellyTransform 當驅動，果凍在這條路上不跑自己的戳擊節奏。
// 兩條都產出跟 shapeRigidMotion 同一種形狀的變換物件，所以 bubble.js 那條
// 「歐拉角 → 旋轉矩陣」的通用轉換照舊共用。
//
// 需要形狀底部的位置（支點補正）與表面錨點（水滴要貼在造型上），這兩樣都是
// bubble.js 才知道何時失效的形狀場狀態，所以以 getter 形式傳進來，而不是在
// 這裡自己算一份。
export function createJellyRuntime({
  params: P, shapeBottom, surfaceAnchors, fallbackAnchors,
}) {
  const { jellyTransform } = createJellyMotion(P);
  const { hopTransform } = createHopMotion(P);

  const active = () => P.motion === 'jelly';

  // 造型的剛體變換。回傳 null 表示這一幀沒有變換（等同恆等）。
  //
  // 果凍走自己那條阻尼彈簧，不疊「造型動態」那組週期性旋轉／呼吸：兩者都在改
  // 同一份變換，疊起來會看不出哪一下是被戳的。果凍的形變本身就是這個模式的
  // 全部內容，讓它獨佔這個通道。
  function shapeRigid(phase) {
    if (P.jellyStyle !== 'bounce') {
      // 原地戳擊：完全是改動前的那條路，一個字都沒動——既有的參數組合檔載進來
      // 外觀必須一模一樣。
      return jellyTransform(phase);
    }
    // 落地彈跳：起跳的拋物線負責位移與速度拉伸，果凍只在每次落地被撞出餘震
    // （見 hop.js 的 driveIndex／driveE／driveStrength）。這條路上果凍不跑自己
    // 的戳擊節奏，「戳擊次數」在面板上是關掉的。
    const hop = hopTransform(phase);
    if (!hop) return null;
    const jelly = jellyTransform(phase, {
      index: hop.driveIndex, e: hop.driveE, strength: hop.driveStrength,
    });
    const scaleY = (jelly ? jelly.scaleY : 1) * hop.scaleY;
    // 支點補正：applyShapeRigid（跟 shader 的 shapeP）是以原點為支點縮放的，
    // 所以壓扁時底部會跟著往上縮、離地。把底部縮掉的那段補回來，腳底就黏在
    // 同一條地面上，看起來才是「撞到地面被壓扁」而不是「懸空自己變形」。
    //   縮放後底部落在 B·scaleY，要回到 B，需要平移 B·(1 - scaleY)。
    // groundAnchor 控制補多少：貼地時全補、騰空時不補（見 hop.js）。
    //
    // 果凍自己那段手調的下沉（jelly.js 的 offsetY）在這條路上不用——那是原地
    // 戳擊沒有地面概念時的近似值，這裡有真正的幾何支點補正，兩者不該疊加。
    const anchored = shapeBottom() * (1 - scaleY) * hop.groundAnchor;
    return {
      angleX: jelly ? jelly.angleX : 0,
      angleY: jelly ? jelly.angleY : 0,
      angleZ: jelly ? jelly.angleZ : 0,
      offsetX: hop.offsetX,
      offsetY: hop.offsetY + anchored,
      scaleX: (jelly ? jelly.scaleX : 1) * hop.scaleX,
      scaleY,
      scaleZ: (jelly ? jelly.scaleZ : 1) * hop.scaleZ,
    };
  }

  // 果凍預設沒有水滴（count 0）。使用者調高的話讓它們貼在表面錨點上，呼叫端的
  // applyShapeRigid 會把果凍的形變一併套上去，水滴因此跟著一起晃，而不是浮在
  // 旁邊各動各的。
  // 沒有錨點可用時回傳 false，呼叫端維持原本的位置（原點）。
  function dropPosition(seed, out) {
    const surface = surfaceAnchors();
    const pool = surface.length ? surface : fallbackAnchors();
    const home = pool.length ? pool[Math.floor(seed * pool.length) % pool.length] : null;
    if (!home) return false;
    out.set(home.x, home.y, home.z);
    return true;
  }

  return { active, shapeRigid, dropPosition };
}
