"""Generate the lightweight poster images used by the home gallery cards."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


POSTERS = {
    "sakura": "sakura-blizzard/index.html?preview=1",
    "energy-ring": "energy-ring/index.html?preview=1",
    "aurora": "aurora/index.html?preview=1",
    "research": "bubble/index.html?mode=research&preview=1",
    "formation": "bubble/index.html?mode=formation&preview=1",
    "morph": "bubble/index.html?mode=morph&preview=1",
    "melt": "bubble/index.html?mode=melt&preview=1",
    "jelly": "bubble/index.html?mode=jelly&preview=1",
    "shatter": "bubble/index.html?mode=shatter&preview=1",
    "weave": "bubble/index.html?mode=weave&preview=1",
    "capillary": "bubble/index.html?mode=capillary&preview=1",
    "typewriter": "bubble/index.html?mode=typewriter&preview=1",
    "static": "bubble/index.html?mode=static&preview=1",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", default="image/previews")
    parser.add_argument("--only", choices=POSTERS.keys())
    parser.add_argument("--settle-ms", type=int, default=650)
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 660, "height": 570}, device_scale_factor=1)
        page = context.new_page()

        posters = POSTERS.items() if not args.only else [(args.only, POSTERS[args.only])]
        for name, route in posters:
            page.goto(f"{args.base_url}/{route}", wait_until="domcontentloaded", timeout=90_000)
            if route.startswith("bubble/"):
                page.evaluate("() => window.postMessage('vfx-play', '*')")
                page.wait_for_function(
                    "() => window.__bubbleDiagReport && !document.body.hasAttribute('data-bubble-boot')",
                    timeout=90_000,
                )
                page.wait_for_timeout(args.settle_ms)
            else:
                page.wait_for_timeout(1_800)

            temporary = output / f".{name}.png"
            page.screenshot(path=str(temporary), animations="disabled")
            with Image.open(temporary) as source:
                source.convert("RGB").save(output / f"{name}.webp", "WEBP", quality=84, method=6)
            temporary.unlink()
            print(f"generated {name}.webp")

        context.close()
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
