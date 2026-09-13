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

`bubble_motion_matrix.py` switches every public motion through both dark and
light backdrops, verifies its control block and shader variant settle, and fails
on browser errors. It uses the baseline diagnostic shader so the test protects
runtime routing without cold-compiling every production variant.

`bubble_inspector_ux.py` verifies progressive common/full controls, persistent
keyboard tabs, A/B quick comparison, and the mobile sheet's sticky layout.

`adaptive_quality.mjs` unit-tests the extracted quality state machine without a
browser or WebGL context.

`drop_physics.mjs` unit-tests the extracted split timeline, volume conservation,
surface-pair selection, satellite-drop trajectories, and conservative ray bounds.

`bubble_real_browser.py` opens the installed Google Chrome and macOS Safari,
checks the Installing mode on dark/light backgrounds, records actual GPU renderer
information, and writes screenshots plus an acceptance report outside the repo.
It can also run Playwright WebKit as an engine-compatibility fallback; that result
is labelled WebKit and is not treated as a system Safari run. Start both the project
server and `safaridriver` when running the complete real-browser matrix.

`bubble_visual_presets.py` captures all three coordinated Installing styles on
both backgrounds and verifies that the six fixed-time renders remain distinct.

`bubble_gpu_profile.py` uses Chrome's hardware WebGL timer-query extension to
measure complete GPU composite time for representative modes at high, balanced,
and low adaptive-quality tiers.

`shader_structure.mjs` verifies that the large fragment shader is assembled from
the environment, geometry, and optics source modules exactly once and in the
required order. The extraction preserved the assembled shader byte-for-byte;
the structural test protects the module boundaries without freezing future GLSL
changes to a permanent hash.

`run_release_checks.py` is the single pre-publish entry point. It runs every Node
unit test and Python syntax check, starts the local preview server, and then checks
Bubble's basic controls, adaptive runtime, inspector layout, and six Installing
visual-preset renders:

```sh
python3 tests/run_release_checks.py
```

Hardware GPU timing and the installed-browser matrix remain manual release checks
because CI does not provide representative Apple/Windows GPU hardware or system
Safari. GitHub Actions runs the deterministic subset with `--unit-only`; hosted
Linux software WebGL blocks the browser main thread while compiling this unusually
large shader, so it cannot provide a stable or representative animation result.
