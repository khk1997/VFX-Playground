import assert from 'node:assert/strict';
import {
  buildStoredZip, canvasToBlob, crc32, nextPaint, zipDateTime,
} from '../bubble/export-utils.js';

const encoder = new TextEncoder();
assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);

const stamp = zipDateTime(new Date(2024, 0, 2, 3, 4, 6));
assert.equal(stamp.time, (3 << 11) | (4 << 5) | 3);
assert.equal(stamp.date, ((2024 - 1980) << 9) | (1 << 5) | 2);

const payload = encoder.encode('hello');
const zip = buildStoredZip([{ name: 'frame.txt', bytes: payload }]);
assert.equal(zip.type, 'application/zip');
const bytes = new Uint8Array(await zip.arrayBuffer());
const view = new DataView(bytes.buffer);
assert.equal(view.getUint32(0, true), 0x04034b50, 'local file header is missing');
assert.equal(view.getUint16(8, true), 0, 'export ZIP must remain uncompressed');
assert.equal(view.getUint32(14, true), crc32(payload));
assert.equal(view.getUint32(18, true), payload.length);
const nameLength = view.getUint16(26, true);
assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + nameLength)), 'frame.txt');
assert.deepEqual(bytes.slice(30 + nameLength, 30 + nameLength + payload.length), payload);

const endOffset = bytes.length - 22;
assert.equal(view.getUint32(endOffset, true), 0x06054b50, 'end of central directory is missing');
assert.equal(view.getUint16(endOffset + 8, true), 1);
assert.equal(view.getUint16(endOffset + 10, true), 1);
assert.equal(view.getUint32(view.getUint32(endOffset + 16, true), true), 0x02014b50);

await assert.rejects(canvasToBlob({ toBlob(callback) { callback(null); } }), /PNG 編碼失敗/);
const previousRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = callback => { callback(42); return 1; };
assert.equal(await nextPaint(), 42);
globalThis.requestAnimationFrame = previousRaf;

console.log('PNG promise, CRC32, stored ZIP, and paint scheduling utilities passed');
