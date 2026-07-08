# VFX Playground

🔗 **線上展示：[https://khk1997.github.io/VFX-Playground/](https://khk1997.github.io/VFX-Playground/)**

一個以 Switch 主機選單為靈感的互動式視覺特效展示網站。純 Canvas 2D 實作，無任何外部套件依賴。

## 特效清單

| 特效 | 技術 | 連結 |
| --- | --- | --- |
| 能量光環 Energy Ring | Canvas 2D · Additive Blending · Value Noise · Domain Warping · PNG 序列輸出 | [energy-ring/](energy-ring/index.html) |

## 使用方式

直接開啟 [`index.html`](index.html)，用方向鍵或滑鼠切換卡片，Enter 或點擊進入特效頁；每個特效頁面都提供即時可調參數面板。

本機預覽：

```bash
python3 -m http.server 8123
# 開啟 http://localhost:8123
```
