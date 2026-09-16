"""Exercise every public Bubble motion through both backdrop contexts."""

from __future__ import annotations

import argparse
import sys

from playwright.sync_api import sync_playwright

from bubble_baseline import set_select, wait_for_shader


MOTIONS = (
    "static", "formation", "weave", "shatter", "melt", "morph",
    "jelly", "capillary", "research", "typewriter",
)
BACKDROPS = ("dark", "light")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 960, "height": 640},
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(
            f"{args.base_url}/bubble/index.html?diag=compilerbaseline",
            wait_until="networkidle",
            timeout=45_000,
        )
        assert response and response.ok
        wait_for_shader(page)

        public_options = page.locator("#motion option:not([hidden])").evaluate_all(
            "nodes => nodes.map(node => node.value)"
        )
        assert public_options == list(MOTIONS), "public motion menu changed without updating the matrix"

        checked: list[str] = []
        for backdrop in BACKDROPS:
            set_select(page, "#backdrop", backdrop)
            for motion in MOTIONS:
                # 動態模式那一列只在「完整」控制深度顯示，所以走跟其他測試同一支
                # JS helper，而不是 Playwright 的可見性感知點選。
                set_select(page, "#motion", motion)
                page.wait_for_function(
                    "motion => window.__bubbleDiagReport().模式.motion === motion",
                    arg=motion,
                )
                wait_for_shader(page)
                report = page.evaluate("window.__bubbleDiagReport()")
                assert report["模式"]["motion"] == motion
                assert report["變體"]["目前key"] == report["變體"]["應該要的key"]
                assert report["變體"]["進行中編譯"] is None
                active_blocks = page.locator(
                    f'#panel [data-gate="{motion}"]:not(.gated-off)'
                ).count()
                assert active_blocks > 0, f"{motion} has no active control block"
                checked.append(f"{backdrop}:{motion}")

        assert not errors, f"motion matrix page errors: {errors}"
        context.close()
        browser.close()
    print({"checked": checked, "count": len(checked)})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
