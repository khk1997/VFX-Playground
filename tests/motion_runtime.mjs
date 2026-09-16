// 每個動態模式的執行期模組（bubble/motions/runtime/）都只是把原本攤在
// updateDropUniforms 裡的那幾段搬了家，對外的回傳值必須跟搬家前逐字相同。
// 這支測試把「搬家前那段程式碼」照抄成參考實作，拿同一組參數餵兩邊比對——
// 截圖比對抓得到畫面差異，但抓不到「差在小數點後第六位、只在某些相位才顯形」
// 的接線錯誤，這裡補上那一段。
import assert from 'node:assert/strict';

import {
  COLOR_DEFAULTS, DEFAULTS, SELECT_DEFAULTS, TOGGLE_DEFAULTS,
} from '../bubble/runtime-defaults.js';
import { MOTION_UNIFORM_MAP } from '../bubble/motions/registry.js';
import createJellyMotion from '../bubble/motions/jelly.js';
import createHopMotion from '../bubble/motions/hop.js';
import createResearchMotion from '../bubble/motions/research.js';
import createMeltMotion, { selectBottomAnchors } from '../bubble/motions/melt.js';
import { createStaticCapillaryRuntime } from '../bubble/motions/runtime/static-capillary.js';
import { createJellyRuntime } from '../bubble/motions/runtime/jelly.js';
import { createResearchRuntime } from '../bubble/motions/runtime/research.js';
import { createMeltRuntime } from '../bubble/motions/runtime/melt.js';

const PHASES = [0, 0.07, 0.19, 0.33, 0.5, 0.64, 0.78, 0.91, 0.999];

function makeParams(overrides = {}) {
  return {
    ...DEFAULTS, ...SELECT_DEFAULTS, ...TOGGLE_DEFAULTS, ...COLOR_DEFAULTS, ...overrides,
  };
}

// 只需要 .set() 與 .x/.y/.z，用不到 three。
function vec() {
  return {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
  };
}
function vec4() {
  return {
    x: 0, y: 0, z: 0, w: 0,
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
    read() { return [this.x, this.y, this.z, this.w]; },
  };
}

/* ===== 靜態方體／毛細波 ===== */
{
  const P = makeParams({ motion: 'static' });
  const runtime = createStaticCapillaryRuntime({ params: P, motionUniformMap: MOTION_UNIFORM_MAP });

  for (const motion of ['static', 'capillary']) {
    P.motion = motion;
    assert.equal(runtime.active(), true, `${motion} must be handled by the static/capillary runtime`);
  }
  for (const motion of ['formation', 'melt', 'jelly', 'research', 'split']) {
    P.motion = motion;
    assert.equal(runtime.active(), false, `${motion} must not be handled by the static/capillary runtime`);
  }

  // 毛細波是純形狀場模式：不論參數檔裡存著什麼數量，主滴一律不出現。
  P.motion = 'capillary';
  P.count = 9;
  assert.equal(runtime.dropCount(), 0);
  assert.equal(runtime.keepsShapeFull(), false);
  // 靜態方體沿用面板上的數量，但造型進度恆為滿值。
  P.motion = 'static';
  assert.equal(runtime.dropCount(), null);
  assert.equal(runtime.keepsShapeFull(), true);
  P.motion = 'formation';
  assert.equal(runtime.dropCount(), null);
  assert.equal(runtime.keepsShapeFull(), false);

  // uniform：整組值與改動前那段三元式逐字相同。
  P.motion = 'capillary';
  Object.assign(P, {
    capillaryHeight: 0.17, capillaryRings: 5, capillarySpeed: 1.5, capillaryWarp: 0.4,
    capillaryField: 2.4, capillaryTexture: 3.6, capillaryCrestSoftness: 0.7,
    capillaryDirectionX: -0.6, capillaryDirectionY: 0.2, capillaryDirectionZ: 0.8,
    edgeDropsEnabled: true, wobble: 0.42,
  });
  const uniforms = {
    uEdgeDropCount: { value: 7 },
    uWobble: { value: 9 },
    uExtendedMotion: { value: -1 },
    uExtendedParams: { value: vec4() },
    uCapillaryStyle: { value: vec4() },
    uCapillaryDirection: { value: vec() },
  };
  runtime.writeUniforms(uniforms);
  assert.equal(uniforms.uEdgeDropCount.value, 0, 'edge drops must stay sealed off');
  assert.equal(uniforms.uWobble.value, 0, 'the generic surface wobble must stay sealed off');
  assert.equal(uniforms.uExtendedMotion.value, MOTION_UNIFORM_MAP.capillary);
  assert.deepEqual(uniforms.uExtendedParams.value.read(), [0.17, 5, 1.5, 0.4]);
  assert.deepEqual(uniforms.uCapillaryStyle.value.read(), [2, 4, 0.7, 0]);
  assert.deepEqual(
    [uniforms.uCapillaryDirection.value.x, uniforms.uCapillaryDirection.value.y,
      uniforms.uCapillaryDirection.value.z],
    [-0.6, 0.2, 0.8],
  );
  P.motion = 'static';
  runtime.writeUniforms(uniforms);
  assert.equal(uniforms.uExtendedMotion.value, MOTION_UNIFORM_MAP.static,
    'the static box and the capillary wave must not share one motion id');
}

/* ===== 果凍 ===== */
{
  const P = makeParams({ motion: 'jelly' });
  const anchors = [
    { x: 0.1, y: 0.2, z: -0.3 }, { x: -0.4, y: 0.5, z: 0.6 }, { x: 0.7, y: -0.8, z: 0.9 },
  ];
  const bottom = () => -0.62;
  const runtime = createJellyRuntime({
    params: P, shapeBottom: bottom,
    surfaceAnchors: () => anchors, fallbackAnchors: () => [],
  });
  // 參考實作：改動前 updateDropUniforms 裡的那兩條分支。
  const { jellyTransform } = createJellyMotion(P);
  const { hopTransform } = createHopMotion(P);
  const reference = phase => {
    if (P.jellyStyle === 'bounce') {
      const hop = hopTransform(phase);
      const jelly = hop && jellyTransform(phase, {
        index: hop.driveIndex, e: hop.driveE, strength: hop.driveStrength,
      });
      if (!hop) return null;
      const scaleY = (jelly ? jelly.scaleY : 1) * hop.scaleY;
      const anchored = bottom() * (1 - scaleY) * hop.groundAnchor;
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
    return jellyTransform(phase);
  };

  for (const style of ['bounce', 'poke']) {
    P.jellyStyle = style;
    for (const phase of PHASES) {
      assert.deepEqual(runtime.shapeRigid(phase), reference(phase),
        `jelly ${style} transform drifted at phase ${phase}`);
    }
  }

  assert.equal(runtime.active(), true);
  P.motion = 'melt';
  assert.equal(runtime.active(), false);
  P.motion = 'jelly';

  // 水滴貼在表面錨點上，挑法與改動前同一條：h2 × 錨點數，取模。
  const out = vec();
  for (const seed of [0, 0.34, 0.5, 0.99]) {
    assert.equal(runtime.dropPosition(seed, out), true);
    const home = anchors[Math.floor(seed * anchors.length) % anchors.length];
    assert.deepEqual([out.x, out.y, out.z], [home.x, home.y, home.z]);
  }
  // 表面錨點是空的就退回備用那組；兩組都空就維持呼叫端原本的位置。
  const empty = createJellyRuntime({
    params: P, shapeBottom: bottom, surfaceAnchors: () => [], fallbackAnchors: () => anchors,
  });
  assert.equal(empty.dropPosition(0.5, out), true);
  const none = createJellyRuntime({
    params: P, shapeBottom: bottom, surfaceAnchors: () => [], fallbackAnchors: () => [],
  });
  out.set(1, 2, 3);
  assert.equal(none.dropPosition(0.5, out), false);
  assert.deepEqual([out.x, out.y, out.z], [1, 2, 3], 'an anchorless jelly must not move the drop');
}

/* ===== 私語 ===== */
{
  const P = makeParams({ motion: 'research', wobble: 0.42, researchCompanionFusion: 0.31 });
  const dropSeeds = Array.from({ length: 4 }, (_, i) => ({
    h1: (i * 0.17) % 1, h2: (i * 0.41) % 1, h3: (i * 0.73) % 1, radius: 0.8 + i * 0.05,
  }));
  const runtime = createResearchRuntime({ params: P, dropSeeds });
  const motion = createResearchMotion(P, { dropSeeds });

  assert.equal(runtime.active(), true);
  assert.equal(runtime.dropCount(), 2, 'the shell and its companion are the mode, not a drop count');
  P.motion = 'weave';
  assert.equal(runtime.active(), false);
  assert.equal(runtime.dropCount(), null);
  P.motion = 'research';

  const mine = vec();
  const theirs = vec();
  for (const phase of PHASES) {
    assert.deepEqual(runtime.shapeRigid(phase), motion.shapeRigidMotion(phase),
      `research shell transform drifted at phase ${phase}`);
    for (let i = 0; i < 2; i++) {
      const factor = runtime.dropPosition(i, phase, mine);
      const state = motion.dropPosition(i, phase, theirs);
      assert.deepEqual([mine.x, mine.y, mine.z], [theirs.x, theirs.y, theirs.z],
        `research shell ${i} moved at phase ${phase}`);
      assert.equal(factor, state.reveal * state.pulse,
        `research shell ${i} radius factor drifted at phase ${phase}`);
    }
    assert.equal(runtime.wobble(phase), P.wobble * motion.shellEnvelope(phase),
      `research shell wobble drifted at phase ${phase}`);
  }

  assert.equal(runtime.mergeScale(), Math.max(0.02, P.researchCompanionFusion));
  P.researchCompanionFusion = 0;
  assert.equal(runtime.mergeScale(), 0.02, 'fully closing the fusion would harden the contact seam');
}

/* ===== 融化 ===== */
{
  const MAX_DROPS = 12;
  const P = makeParams({ motion: 'melt' });
  // 形狀底部散開的取樣點；只要有 y 就足以讓 selectBottomAnchors 挑得出滴落點。
  const targets = Array.from({ length: 64 }, (_, i) => ({
    x: Math.sin(i * 1.7) * 0.5, y: -0.9 + (i % 8) * 0.12, z: Math.cos(i * 2.3) * 0.5,
    radiusHint: 0.05 + (i % 5) * 0.01,
  }));
  let serial = 0;
  const runtime = createMeltRuntime({
    params: P, maxDrops: MAX_DROPS,
    shapeTargets: () => targets, shapeSerial: () => serial,
  });

  assert.equal(runtime.active(), true);
  P.motion = 'morph';
  assert.equal(runtime.active(), false);
  P.motion = 'melt';

  // 滴落點：跟改動前同一條 selectBottomAnchors，同一組參數。
  runtime.rebuildAnchors();
  const expected = selectBottomAnchors(targets, MAX_DROPS, P.meltBand, Math.round(P.meltSeed));
  assert.deepEqual(runtime.anchors(), expected);
  assert.ok(expected.length, 'the melt drip points must not be empty');

  // key 快取：同一個形狀版本與同一組滑桿值不重挑（回傳的是同一個陣列實例）。
  const first = runtime.anchors();
  runtime.rebuildAnchors();
  assert.equal(runtime.anchors(), first, 'the drip points were reselected without a reason to');
  // 換形狀（版本號跳號）要重挑。
  serial += 1;
  runtime.rebuildAnchors();
  assert.notEqual(runtime.anchors(), first, 'a new shape must reselect the drip points');
  // 取樣範圍是滑桿，改了也要重挑。
  const beforeBand = runtime.anchors();
  P.meltBand = P.meltBand * 0.5 + 0.05;
  runtime.rebuildAnchors();
  assert.notEqual(runtime.anchors(), beforeBand, 'a new sampling band must reselect the drip points');
  // resetAnchors 是換形狀時的雙保險：不改任何滑桿也要重挑。
  const beforeReset = runtime.anchors();
  runtime.resetAnchors();
  runtime.rebuildAnchors();
  assert.notEqual(runtime.anchors(), beforeReset, 'resetAnchors must force a reselect');
  assert.deepEqual(runtime.anchors(),
    selectBottomAnchors(targets, MAX_DROPS, P.meltBand, Math.round(P.meltSeed)));

  // 參考實作：改動前 updateDropUniforms／updateMicroDrops 裡的那兩段。
  const { meltDrop } = createMeltMotion(P, { bottomAnchors: () => runtime.anchors() });
  const mine = vec();
  const theirs = vec();
  for (const phase of PHASES) {
    for (let i = 0; i < MAX_DROPS; i++) {
      const state = runtime.mainDrop(i, phase, mine);
      const reference = meltDrop(i, phase, i * 7.13, theirs);
      assert.deepEqual(state ? state.radius : null, reference ? reference.radius : null,
        `melt drop ${i} radius drifted at phase ${phase}`);
      if (reference) {
        assert.deepEqual([mine.x, mine.y, mine.z], [theirs.x, theirs.y, theirs.z],
          `melt drop ${i} moved at phase ${phase}`);
      }
      // 形變由 mainDrop 記下、由 deform() 讀回，兩者必須是同一幀的同一份。
      assert.deepEqual(runtime.deform(i), reference ? reference.deform : null,
        `melt drop ${i} deform drifted at phase ${phase}`);

      const micro = runtime.microDrop(i, phase, mine);
      const microReference = meltDrop(i, phase, i * 3.41 + 101.7, theirs);
      assert.equal(micro.radius, microReference ? microReference.radius * 0.62 : 0,
        `melt micro drop ${i} radius drifted at phase ${phase}`);
      assert.equal(micro.stretch, microReference ? microReference.deform.stretch : 1,
        `melt micro drop ${i} stretch drifted at phase ${phase}`);
      if (microReference) {
        assert.deepEqual([mine.x, mine.y, mine.z], [theirs.x, theirs.y, theirs.z],
          `melt micro drop ${i} moved at phase ${phase}`);
      }
    }
  }
  // 主滴與微滴的種子基底必須錯開，否則同一個滴落點的兩顆會同步落下疊成一顆。
  const sameSeed = PHASES.every(phase => {
    const a = meltDrop(3, phase, 3 * 7.13, theirs);
    const b = meltDrop(3, phase, 3 * 3.41 + 101.7, mine);
    return (a ? a.radius : 0) === (b ? b.radius : 0);
  });
  assert.equal(sameSeed, false, 'the main and micro drops fell on the same schedule');

  assert.equal(runtime.mergeScale(), 0.4);
}

console.log('Motion runtime modules match the inline code they replaced');
