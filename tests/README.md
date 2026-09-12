# VFX browser checks

`vfx_regression.py` checks the shared controls and basic rendering behavior across
all effect pages.

`bubble_baseline.py` captures a repeatable Bubble matrix at a fixed simulation
time. It writes desktop and mobile screenshots plus FPS, shader, DPR, raymarch,
and browser-error data to `report.json`. Keep its output outside the repository;
WebGL pixels and throughput vary by GPU.

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
