# VFX Playground

🔗 **線上展示：[https://khk1997.github.io/VFX-Playground/](https://khk1997.github.io/VFX-Playground/)**

## Windows 上第一次進造型模式要等很久？換 ANGLE 後端

在 Windows 上，Chrome 的 WebGL 走 ANGLE，而 ANGLE 預設用 **D3D11** 後端 —— 那條路是
`GLSL → HLSL → fxc`，fxc 會把所有函式攤平成一個巨大函式，優化成本對攤平後的大小是
超線性的。這支 shader 的造型模式因此要編數十秒。macOS 沒有這個問題，因為那邊是
ANGLE 的 Metal 後端，編譯器完全不同。差別不在 GPU，在中間那層編譯器。

同一台機器（RTX 5070 Ti）、同一份 shader，七個造型模式各一次 cold compile：

| ANGLE 後端 | 七個模式合計 | 最慢的一個（morph） | 切一次模式最久卡住主執行緒 |
| --- | --- | --- | --- |
| D3D11（Chrome 預設） | 154s | 55s | 0.54s |
| **Vulkan** | **20s** | **5s** | 0.39s |
| OpenGL | 46s | 8s | 3.34s |

Vulkan 快七倍以上，而且主執行緒幾乎不停頓 —— 它走 `GLSL → SPIR-V`，完全不經過 fxc。
要換：

* 一次性測試：`start-server.bat vulkan`（會開一個獨立 profile 的 Chrome）
* 想固定下來：Chrome 開 `chrome://flags/#use-angle`，選 **Vulkan**，重開瀏覽器

兩個已知的取捨，都實測過：

* Vulkan 沒有 `KHR_parallel_shader_compile`，所以 three.js 的 `compileAsync` 會退回同步
  路徑。實測那個同步段是 **0.39 秒**（D3D11 是背景編譯、主執行緒只停 0.54 秒但總共要等
  34 秒）。0.39 秒是一次掉幀，不是凍結。
* 畫面幾乎相同但不是逐位元相同：取樣通道的最大誤差 220（約 1% 的像素，全部落在實體
  上，背景完全沒有差異），3× 放大並排看是最亮那條金屬帶上多了很細的橫向條紋。
  OpenGL 後端則與 D3D11 幾乎完全一致（最大誤差 ±1，只有 morph 是 ±3）。

不換後端也不會卡：頁面在首編落地之後會自動在背景把各模式的 shader 預先編好
（見 `bubble.js` 的 `prewarmVariants`），所以「等」只會發生在第一次開站的那一兩分鐘，
而且期間畫面照常算繪、面板照常可用。Chrome 的 shader 快取是跟著 profile 持久的，
之後每次進站都是即時。

要看目前實際生效的後端與編譯狀況，在 console 呼叫 `__bubbleDiagReport()`，看
`gl環境` 與 `變體.預熱` 兩段。
