# VFX Playground

🔗 **線上展示：[https://khk1997.github.io/VFX-Playground/](https://khk1997.github.io/VFX-Playground/)**

一個以 Switch 主機選單為靈感的互動式視覺特效展示網站。純 Canvas 2D 實作，無任何外部套件依賴。

## 特效清單

| 特效 | 技術 | 連結 |
| --- | --- | --- |
| 能量光環 Energy Ring | Canvas 2D · 粒子 · Bloom | [energy-ring/](energy-ring/index.html) |
| 電漿閃電 Lightning Storm | Canvas 2D · 分形 · 互動 | [lightning/](lightning/index.html) |
| 粒子星雲 Particle Nebula | Canvas 2D · 流場 · 粒子 | [nebula/](nebula/index.html) |
| 流體墨水 Fluid Ink | Canvas 2D · 流體模擬 · 互動 | [fluid-ink/](fluid-ink/index.html) |
| 文字粒子 Text Particles | Canvas 2D · 粒子 · 文字 | [text-particles/](text-particles/index.html) |
| 璀璨烟火 Fireworks | Canvas 2D · 粒子 · 互動 | [fireworks/](fireworks/index.html) |
| 數位雨 Matrix Rain | Canvas 2D · 文字 · Glitch | [matrix-rain/](matrix-rain/index.html) |
| 黑洞 Black Hole | Canvas 2D · 引力透鏡 · 粒子 | [black-hole/](black-hole/index.html) |
| 音訊視覺 Audio Visualizer | Canvas 2D · Web Audio · FFT | [audio-viz/](audio-viz/index.html) |

## 使用方式

直接開啟 [`index.html`](index.html)，用方向鍵、滑鼠或觸控滑動切換卡片，Enter 或點擊進入特效頁；每個特效頁面都提供即時可調參數面板，並有「← 首頁」按鈕可返回。

首頁功能：卡片預覽為即時運算的特效本體（非 active 卡片會自動暫停以節省效能）、切換與進入時有合成音效（右上角可靜音）、進入特效頁有放大轉場。

本機預覽：

```bash
python3 -m http.server 8123
# 開啟 http://localhost:8123
```

## 各特效頁共通慣例

- 單一自足的 `index.html`，零外部依賴。
- 左側可收合參數面板、`⏸ 暫停`、`↺ 重設`。
- `?preview=1`：隱藏所有 UI，供首頁卡片以 iframe 嵌入。
- 接收 `postMessage('vfx-pause' / 'vfx-play')` 控制播放，分頁隱藏時自動暫停。
