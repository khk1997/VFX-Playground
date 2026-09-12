"""Profile Bubble quality tiers with hardware WebGL timer queries."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from bubble_baseline import compact_diag, set_select, wait_for_shader
from bubble_real_browser import browser_facts


CASES = (
    ("installing-dark", "research", "dark"),
    ("installing-light", "research", "light"),
    ("static-dark", "static", "dark"),
    ("capillary-dark", "capillary", "dark"),
)
TIERS = ("high", "balanced", "low")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", type=Path, default=Path("/tmp/vfx-bubble-gpu-profile"))
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--samples", type=int, default=16)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    cases = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel="chrome",
            headless=args.headless,
            args=["--disable-background-timer-throttling"],
        )
        context = browser.new_context(
            viewport={"width": 960, "height": 640},
            device_scale_factor=2,
        )
        page = context.new_page()
        page.set_default_timeout(90_000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(
            f"{args.base_url}/bubble/index.html?diag=gpu-profile",
            wait_until="networkidle",
            timeout=45_000,
        )
        assert response and response.ok
        wait_for_shader(page)
        assert page.evaluate("typeof window.__bubbleProfileGpu === 'function'")
        facts = browser_facts(page.evaluate("window.__bubbleDiagReport()"))
        assert facts["hardwareAccelerated"], f"hardware GPU required, got {facts['renderer']}"
        for name, motion, backdrop in CASES:
            set_select(page, "#motion", motion)
            set_select(page, "#backdrop", backdrop)
            wait_for_shader(page)
            tiers = {}
            for tier in TIERS:
                result = page.evaluate(
                    "options => window.__bubbleProfileGpu(options)",
                    {"tier": tier, "samples": args.samples, "warmup": 3},
                )
                assert result["supported"], f"{name}/{tier}: {result.get('reason')}"
                assert result["samples"] == args.samples
                assert result["medianMs"] > 0
                assert result["quality"]["tier"] == tier
                tiers[tier] = result
            assert tiers["low"]["medianMs"] < tiers["high"]["medianMs"], (
                f"{name}: low tier did not reduce GPU time "
                f"({tiers['high']['medianMs']:.3f} -> {tiers['low']['medianMs']:.3f} ms)"
            )
            cases.append({
                "name": name,
                "motion": motion,
                "backdrop": backdrop,
                "tiers": tiers,
                "diagnostics": compact_diag(page.evaluate("window.__bubbleDiagReport()")),
            })
        context.close()
        browser.close()
    assert not errors, f"GPU profile page errors: {errors}"
    improvements = [
        1 - case["tiers"]["low"]["medianMs"] / case["tiers"]["high"]["medianMs"]
        for case in cases
    ]
    report = {
        "browser": "Google Chrome",
        "facts": facts,
        "samplesPerTier": args.samples,
        "medianLowTierImprovement": statistics.median(improvements),
        "cases": cases,
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for case in cases:
        values = ', '.join(f"{tier}={case['tiers'][tier]['medianMs']:.3f}ms" for tier in TIERS)
        print(f"{case['name']}: {values}")
    print(f"Median low-tier GPU improvement: {statistics.median(improvements):.1%}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
