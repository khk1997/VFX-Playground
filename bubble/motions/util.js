'use strict';

// 動態模式共用的純函式。與 shader 端同名的 CPU 版本，水滴動畫每幀在 CPU 算一次
// 位置與半徑時使用。沒有狀態、不讀參數，所以各模式模組可以直接匯入。

export const fract = x => x - Math.floor(x);

export const hash11CPU = n => fract(Math.sin(n * 127.1) * 43758.5453123);

export function smoothstepCPU(value, edge0, edge1) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}
