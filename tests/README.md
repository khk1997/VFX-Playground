# VFX browser checks

`vfx_regression.py` checks the shared controls and basic rendering behavior across
all effect pages.

`bubble_baseline.py` captures a repeatable Bubble matrix at a fixed simulation
time. It writes canvas-only and full-UI desktop/mobile screenshots plus FPS,
shader, DPR, raymarch, and browser-error data to `report.json`. The canvas capture
temporarily hides floating controls so its pixel metrics describe the glass itself.
Keep its output outside the repository; WebGL pixels and throughput vary by GPU.

Run it through the repository server helper:

```sh
python3 ~/.codex/skills/webapp-testing/scripts/with_server.py \
  --server "python3 serve.py 4173" --port 4173 -- \
  python3 tests/bubble_baseline.py --output /tmp/vfx-bubble-baseline/phase-1
```

Later runs can reject a material FPS regression against the local reference:

```sh
python3 tests/bubble_baseline.py \
  --output /tmp/vfx-bubble-baseline/current \
  --reference /tmp/vfx-bubble-baseline/phase-1/report.json
```

`bubble_adaptive_runtime.py` exercises the runtime policies that screenshots do
not cover: automatic desktop quality, OS reduced-motion pause/override, and
single-pointer canvas dragging.

`bubble_inspector_ux.py` verifies progressive common/full controls, persistent
keyboard tabs, A/B quick comparison, and the mobile sheet's sticky layout.

`adaptive_quality.mjs` unit-tests the extracted quality state machine without a
browser or WebGL context.

`bubble_real_browser.py` opens the installed Google Chrome and macOS Safari,
checks the Installing mode on dark/light backgrounds, records actual GPU renderer
information, and writes screenshots plus an acceptance report outside the repo.
It can also run Playwright WebKit as an engine-compatibility fallback; that result
is labelled WebKit and is not treated as a system Safari run. Start both the project
server and `safaridriver` when running the complete real-browser matrix.
