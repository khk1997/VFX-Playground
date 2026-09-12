"""Capture repeatable visual and performance baselines for the Bubble module.

The screenshots are intentionally written outside the repository by default. WebGL
pixels can differ across GPUs, so this script treats them as local A/B evidence and
uses runtime errors plus shader readiness as the portable pass/fail checks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import Page, sync_playwright


DEFAULT_URL = "http://127.0.0.1:4173"
STAGE_CAPTURE_STYLE = """
#homeBtn, #toggleBtn, #exportBtn, #playCtl, #quickSlots, #panel {
    visibility: hidden !important;
}
"""
PROFILES = (
    {
        "name": "desktop",
        "viewport": {"width": 960, "height": 640},
        "device_scale_factor": 1,
        "is_mobile": False,
        "cases": (
            ("static-dark", "static", "dark"),
            ("split-dark", "split", "dark"),
            ("installing-dark", "research", "dark"),
            ("installing-light", "research", "light"),
            ("capillary-dark", "capillary", "dark"),
            ("typewriter-dark", "typewriter", "dark"),
        ),
    },
    {
        "name": "mobile",
        "viewport": {"width": 390, "height": 844},
        "device_scale_factor": 1,
        "is_mobile": True,
        "cases": (
            ("installing-dark", "research", "dark"),
            ("installing-light", "research", "light"),
        ),
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path, default=Path("/tmp/vfx-bubble-baseline"))
    parser.add_argument(
        "--reference",
        type=Path,
        help="Optional earlier report.json. Fails when median FPS regresses past the limit.",
    )
    parser.add_argument(
        "--max-fps-regression",
        type=float,
        default=0.20,
        help="Allowed median FPS loss compared with --reference (default: 0.20).",
    )
    return parser.parse_args()


def wait_for_shader(page: Page) -> None:
    page.wait_for_function(
        """() => {
            if (typeof window.__bubbleDiagReport !== 'function') return false;
            const variant = window.__bubbleDiagReport()['變體'];
            return variant['首編已完成']
                && variant['目前key'] === variant['應該要的key']
                && !variant['進行中編譯']
                && !variant['待補做的切換'];
        }""",
        timeout=90_000,
        polling=250,
    )
    page.wait_for_timeout(250)


def set_select(page: Page, selector: str, value: str) -> None:
    """Update native selects even when the mobile custom-select UI hides them."""
    page.eval_on_selector(
        selector,
        """(node, nextValue) => {
            node.value = nextValue;
            node.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        value,
    )


def sample_fps(page: Page, duration_ms: int = 1600) -> dict[str, float | int]:
    return page.evaluate(
        """duration => new Promise(resolve => {
            const samples = [];
            const started = performance.now();
            let previous = started;
            function frame(now) {
                samples.push(now - previous);
                previous = now;
                if (now - started >= duration) {
                    const elapsed = now - started;
                    const sorted = samples.slice(1).sort((a, b) => a - b);
                    const percentile = p => sorted.length
                        ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
                        : 0;
                    resolve({
                        frames: Math.max(0, samples.length - 1),
                        durationMs: Math.round(elapsed),
                        fps: samples.length > 1 ? (samples.length - 1) * 1000 / elapsed : 0,
                        medianFrameMs: percentile(0.5),
                        p95FrameMs: percentile(0.95),
                    });
                    return;
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        })""",
        duration_ms,
    )


def image_metrics(path: Path) -> dict[str, object]:
    raw = path.read_bytes()
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        stat = ImageStat.Stat(rgb)
        return {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "width": image.width,
            "height": image.height,
            "meanRgb": [round(value, 2) for value in stat.mean],
            "stddevRgb": [round(value, 2) for value in stat.stddev],
        }


def compact_diag(report: dict) -> dict[str, object]:
    variant = report["變體"]
    return {
        "motion": report["模式"]["motion"],
        "gl": report["gl環境"],
        "dimensions": report["尺寸"],
        "adaptiveQuality": report.get("效能"),
        "raymarch": report["raymarch"],
        "variant": {
            "activeKey": variant["目前key"],
            "expectedKey": variant["應該要的key"],
            "state": variant["狀態"],
            "initialCompileMs": variant["預熱"]["首編耗時ms"],
            "lastCompileMs": variant.get("最後完成耗時ms"),
            "cachedCount": len(variant["已快取"]),
        },
        "shader": {
            "effectiveLines": report["shaderVariant"]["有效行數"],
            "loopCount": report["shaderVariant"]["loop數"],
            "compiledPrograms": report["render管線"]["已編譯program數"],
        },
    }


def median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def compare_performance(current: dict, reference_path: Path, maximum_loss: float) -> list[str]:
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    failures = []
    for profile in current["profiles"]:
        old_profile = next(
            (item for item in reference["profiles"] if item["name"] == profile["name"]),
            None,
        )
        if not old_profile:
            continue
        current_fps = median([case["performance"]["fps"] for case in profile["cases"]])
        old_fps = median([case["performance"]["fps"] for case in old_profile["cases"]])
        if old_fps > 0 and current_fps < old_fps * (1 - maximum_loss):
            loss = (1 - current_fps / old_fps) * 100
            failures.append(
                f"{profile['name']}: median FPS regressed {loss:.1f}% "
                f"({old_fps:.1f} -> {current_fps:.1f})"
            )
    return failures


def main() -> int:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result: dict[str, object] = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": args.base_url,
        "fixedSimulationTime": 2.4,
        "profiles": [],
    }
    failures: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for profile in PROFILES:
            context = browser.new_context(
                viewport=profile["viewport"],
                device_scale_factor=profile["device_scale_factor"],
                is_mobile=profile["is_mobile"],
                has_touch=profile["is_mobile"],
            )
            page = context.new_page()
            console_errors: list[str] = []
            page_errors: list[str] = []
            failed_requests: list[dict[str, str | None]] = []
            page.on(
                "console",
                lambda message: console_errors.append(message.text)
                if message.type == "error"
                else None,
            )
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on(
                "requestfailed",
                lambda request: failed_requests.append(
                    {"url": request.url, "error": request.failure}
                ),
            )

            url = f"{args.base_url}/bubble/index.html?diag=baseline&diagTime=2.4"
            response = page.goto(url, wait_until="networkidle", timeout=45_000)
            if not response or response.status != 200:
                failures.append(f"{profile['name']}: HTTP {response.status if response else 'none'}")
                context.close()
                continue
            wait_for_shader(page)

            profile_result = {
                "name": profile["name"],
                "viewport": profile["viewport"],
                "deviceScaleFactor": profile["device_scale_factor"],
                "cases": [],
            }
            profile_dir = args.output / profile["name"]
            profile_dir.mkdir(parents=True, exist_ok=True)

            for case_name, motion, backdrop in profile["cases"]:
                set_select(page, "#motion", motion)
                set_select(page, "#backdrop", backdrop)
                wait_for_shader(page)
                performance = sample_fps(page)
                diag = compact_diag(page.evaluate("window.__bubbleDiagReport()"))

                stage_path = profile_dir / f"{case_name}-stage.png"
                ui_path = profile_dir / f"{case_name}-ui.png"
                # Locator screenshots include fixed elements painted above the canvas.
                # Hide product chrome here so stage metrics describe only the glass;
                # the following full-page screenshot separately validates the UI.
                # The stage fills the viewport. Capturing its painted bounds keeps
                # hardware WebGL layers that macOS page screenshots can omit, while
                # still including the fixed product controls above the canvas.
                page.locator("#stage").screenshot(path=str(ui_path))
                page.locator("#stage").screenshot(
                    path=str(stage_path),
                    style=STAGE_CAPTURE_STYLE,
                )
                stage_info = image_metrics(stage_path)
                ui_info = image_metrics(ui_path)
                if stage_info["width"] <= 1 or stage_info["height"] <= 1:
                    failures.append(f"{profile['name']}/{case_name}: empty canvas capture")
                if not all(math.isfinite(value) for value in performance.values()):
                    failures.append(f"{profile['name']}/{case_name}: invalid FPS sample")

                profile_result["cases"].append(
                    {
                        "name": case_name,
                        "motion": motion,
                        "backdrop": backdrop,
                        "performance": {
                            key: round(value, 2) if isinstance(value, float) else value
                            for key, value in performance.items()
                        },
                        "diagnostics": diag,
                        "screenshots": {"stage": stage_info, "ui": ui_info},
                    }
                )

            profile_result["consoleErrors"] = console_errors
            profile_result["pageErrors"] = page_errors
            profile_result["failedRequests"] = failed_requests
            if console_errors:
                failures.append(f"{profile['name']}: console errors: {console_errors}")
            if page_errors:
                failures.append(f"{profile['name']}: page errors: {page_errors}")
            result["profiles"].append(profile_result)
            context.close()
        browser.close()

    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.reference:
        failures.extend(compare_performance(result, args.reference, args.max_fps_regression))

    for profile in result["profiles"]:
        fps_values = [case["performance"]["fps"] for case in profile["cases"]]
        print(
            f"{profile['name']}: median {median(fps_values):.1f} FPS across "
            f"{len(fps_values)} cases"
        )
    print(f"Report: {report_path}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
