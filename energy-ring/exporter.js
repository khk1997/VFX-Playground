/* ===== PNG 序列輸出（去背）+ 極簡 ZIP（store 無壓縮）===== */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const enc = new TextEncoder();
  let offset = 0;
  const chunks = [], central = [];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, sz, true); cd.setUint32(24, sz, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + sz;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/* 尺寸欄位：🔗 開啟時鎖定長寬比連動（Photoshop 式） */
const expWEl = document.getElementById('expW'), expHEl = document.getElementById('expH');
const linkBtn = document.getElementById('linkBtn');
let linkOn = true, linkRatio = 1;
linkBtn.addEventListener('click', () => {
  linkOn = !linkOn;
  linkBtn.classList.toggle('off', !linkOn);
  if (linkOn) linkRatio = (parseFloat(expWEl.value) || 1) / (parseFloat(expHEl.value) || 1);
});
expWEl.addEventListener('input', () => {
  const w = parseFloat(expWEl.value);
  if (linkOn && w > 0) expHEl.value = Math.max(16, Math.round(w / linkRatio));
});
expHEl.addEventListener('input', () => {
  const h = parseFloat(expHEl.value);
  if (linkOn && h > 0) expWEl.value = Math.max(16, Math.round(h * linkRatio));
});

document.getElementById('syncLoopBtn').addEventListener('click', () => {
  document.getElementById('exportSec').value = P.loopSec.toFixed(1);
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  if (exporting) return;
  const btn = document.getElementById('exportBtn');
  const status = document.getElementById('exportStatus');
  exporting = true;
  btn.disabled = true;
  try {
    const fps = Math.max(1, Math.round(P.fps || 60));
    // 循環秒數對齊幀數：四捨五入到整數幀，差異通常 <半幀時長，不可察覺，
    // 但能保證「幀數 ÷ fps」剛好等於循環秒數，不會因為除不盡而在接縫處留下極小的跳動
    const framesPerLoop = Math.max(1, Math.round((P.loopSec || 5) * fps));
    const correctedLoopSec = framesPerLoop / fps;
    // 輸出秒數可以是循環秒數的整數倍（例如想要 3 個循環接在一起），四捨五入取最接近的整數倍
    const loopsRequested = Math.max(1, Math.round((P.exportSec || P.loopSec || 5) / (P.loopSec || 5)));
    const total = framesPerLoop * loopsRequested;
    const ew = Math.min(4096, Math.max(16, Math.round(parseFloat(expWEl.value) || 1080)));
    const eh = Math.min(4096, Math.max(16, Math.round(parseFloat(expHEl.value) || 1080)));

    // 匯出快照：把當下所有參數複製一份給 Q 讀取，跟使用者接下來在面板上的操作完全隔離，
    // 匯出途中調整滑桿只會改到 P，不會污染正在進行中的這次匯出
    const snapshot = { ...P, loopSec: correctedLoopSec };
    Q = snapshot;

    const ec = document.createElement('canvas');
    ec.width = ew; ec.height = eh;
    const ectx = ec.getContext('2d');
    const files = [];

    // 暖機：完整渲染「前一個循環」（用負數時間，靠三角函數天生的週期性直接銜接），
    // 而不是渲染任意 N 幀再假設拖尾已經穩定 —— 這樣暖機後的狀態保證跟無限循環播放時完全一致
    for (let i = -framesPerLoop; i < 0; i++) {
      renderFrame(ectx, ew, eh, 1 / fps, true, i / fps);
    }
    for (let i = 0; i < total; i++) {
      renderFrame(ectx, ew, eh, 1 / fps, true, i / fps);
      const blob = await new Promise(r => ec.toBlob(r, 'image/png'));
      files.push({ name: `frame_${String(i).padStart(4, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
      status.textContent = `輸出中… ${i + 1}/${total}`;
      if (i % 5 === 0) await new Promise(r => setTimeout(r)); // 讓 UI 有機會更新
    }
    const url = URL.createObjectURL(makeZip(files));
    const a = document.createElement('a');
    a.href = url;
    a.download = `energy-ring_${ew}x${eh}_${fps}fps_${total}f.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = `完成：${total} 張去背 PNG（${ew}×${eh}，${loopsRequested} 個循環）`;
  } catch (e) {
    status.textContent = '輸出失敗：' + e.message;
  } finally {
    Q = P; // 還原即時預覽讀取的來源
    btn.disabled = false;
    exporting = false;
    last = performance.now(); // 避免恢復播放時 dt 暴衝
  }
});
