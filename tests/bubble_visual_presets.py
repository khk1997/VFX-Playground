"""Capture and distinguish the six Installing visual-preset variants."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from bubble_baseline import STAGE_CAPTURE_STYLE, image_metrics, set_select, wait_for_shader


PRESETS = ("prism", "arctic", "pearl")
BACKDROPS = ("dark", "light")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", type=Path, default=Path("/tmp/vfx-bubble-visual-presets"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 640})
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(
            f"{args.base_url}/bubble/index.html?diag=visual-presets&diagTime=2.4",
            wait_until="networkidle",
            timeout=45_000,
        )
        assert response and response.ok
        wait_for_shader(page)
        set_select(page, "#motion", "research")
        page.locator("#inspectorTab-look").click()
        for backdrop in BACKDROPS:
            set_select(page, "#backdrop", backdrop)
            for preset in PRESETS:
                page.locator(f'[data-visual-preset="{preset}"]').click()
                wait_for_shader(page)
                path = args.output / f"{backdrop}-{preset}.png"
                page.locator("#stage").screenshot(path=str(path), style=STAGE_CAPTURE_STYLE)
                values = page.evaluate("""() => ({
                  shell: Number(document.querySelector('#researchShellTint').value),
                  icon: Number(document.querySelector('#researchIconTint').value),
                  shellEdge: Number(document.querySelector('#researchShellTintEdge').value),
                  iconEdge: Number(document.querySelector('#researchIconTintEdge').value),
                })""")
                results.append({"backdrop": backdrop, "preset": preset, "values": values, "image": image_metrics(path)})
        browser.close()
    assert not errors, f"visual preset page errors: {errors}"
    for backdrop in BACKDROPS:
        hashes = [item["image"]["sha256"] for item in results if item["backdrop"] == backdrop]
        assert len(set(hashes)) == len(PRESETS), f"{backdrop} visual presets rendered identically"
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"6 visual preset renders are distinct; report: {report_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
