"""Measure what the static mode's shader costs to compile, cold.

Adding code to the static variant is not free: static is the default mode, so
it is the shader every first visit waits on, and the README documents that this
program can take tens of seconds on Chrome's D3D11 ANGLE backend. A change that
makes the glass better and the first paint a minute later is not obviously a
win, so the cost gets measured rather than assumed.

Cold is the whole point, so every run gets a throwaway profile directory: a
warm run reads the program back from Chrome's cache and reports a number that
says nothing about compilation. That also makes this the opposite of
glass_baseline.py, which needs a warm cache to be reproducible.

    python tests/glass_compile_cost.py --angle d3d11 --repeat 2
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


DEFAULT_URL = "http://127.0.0.1:8642"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_URL)
    parser.add_argument("--mode", default="static")
    parser.add_argument("--repeat", type=int, default=2)
    parser.add_argument(
        "--angle",
        default="vulkan",
        choices=("vulkan", "d3d11", "gl", "default"),
        help="Backends differ by roughly sevenfold here; compare like with like.",
    )
    parser.add_argument("--label", default="current")
    parser.add_argument("--json", type=Path, help="Write the samples here.")
    return parser.parse_args()


def measure_once(playwright, args, profile: Path) -> dict:
    launch_args = []
    if args.angle != "default":
        launch_args.append(f"--use-angle={args.angle}")
    context = playwright.chromium.launch_persistent_context(
        str(profile),
        headless=True,
        args=launch_args,
        viewport={"width": 960, "height": 640},
    )
    try:
        page = context.new_page()
        # Wall clock from navigation to a settled first compile.
        #
        # The runtime's own 首編耗時ms comes back null here, so this measures the
        # whole cold path instead: page load, shape bake and compile together. It
        # is a superset of compilation, but both sides of a before/after pay the
        # same constant, and it needs nothing instrumented to be comparable.
        started = page.evaluate("() => performance.now()")
        page.goto(
            f"{args.base_url}/bubble/index.html?mode={args.mode}",
            wait_until="domcontentloaded",
        )
        page.wait_for_function(
            """() => {
                if (typeof window.__bubbleDiagReport !== 'function') return false;
                return window.__bubbleDiagReport()['變體']['首編已完成'];
            }""",
            timeout=300_000,
            polling=250,
        )
        report = page.evaluate("() => window.__bubbleDiagReport()['變體']")
        settled = page.evaluate("() => performance.now()")
        return {
            "coldReadyMs": round(settled - started),
            "firstCompileMs": report.get("首編耗時ms"),
            "variant": report.get("目前key"),
        }
    finally:
        context.close()


def main() -> int:
    args = parse_args()
    samples: list[dict] = []
    with sync_playwright() as playwright:
        for index in range(args.repeat):
            profile = Path(tempfile.mkdtemp(prefix="glass-cold-"))
            try:
                sample = measure_once(playwright, args, profile)
            finally:
                shutil.rmtree(profile, ignore_errors=True)
            samples.append(sample)
            print(
                f"[{args.label}] run {index + 1}: "
                f"{sample['coldReadyMs']}ms cold-ready  variant={sample['variant']}",
                flush=True,
            )

    times = [s["coldReadyMs"] for s in samples if s["coldReadyMs"] is not None]
    result = {
        "label": args.label,
        "mode": args.mode,
        "angle": args.angle,
        "samples": samples,
        "medianMs": statistics.median(times) if times else None,
    }
    print(f"[{args.label}] median {result['medianMs']}ms over {len(times)} cold runs")
    if args.json:
        args.json.write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
