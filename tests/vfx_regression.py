import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("VFX_BASE_URL", "http://127.0.0.1:4173")
OUTPUT_DIR = Path(os.environ.get("VFX_OUTPUT_DIR", "/tmp/vfx-regression"))
MODE = os.environ.get("VFX_MODE", "current")
VIEWPORT_WIDTH = int(os.environ.get("VFX_VIEWPORT_WIDTH", "1280"))
VIEWPORT_HEIGHT = int(os.environ.get("VFX_VIEWPORT_HEIGHT", "800"))
PAGES = [
    ("home", "/index.html"),
    ("aurora", "/aurora/index.html"),
    ("bubble", "/bubble/index.html"),
    ("energy-ring", "/energy-ring/index.html"),
    ("fireworks", "/fireworks/index.html"),
    ("fluid-ink", "/fluid-ink/index.html"),
    ("lightning", "/lightning/index.html"),
    ("nebula", "/nebula/index.html"),
    ("sakura-blizzard", "/sakura-blizzard/index.html"),
    ("text-particles", "/text-particles/index.html"),
]
ONLY_PAGE = os.environ.get("VFX_ONLY_PAGE")


def main():
    output = OUTPUT_DIR / MODE
    output.mkdir(parents=True, exist_ok=True)
    results = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            device_scale_factor=1,
        )

        for name, route in PAGES:
            if ONLY_PAGE and name != ONLY_PAGE:
                continue
            page = context.new_page()
            console_errors = []
            page_errors = []
            failed_requests = []
            page.on("console", lambda msg, bucket=console_errors: bucket.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
            page.on(
                "requestfailed",
                lambda request, bucket=failed_requests: bucket.append(
                    {"url": request.url, "error": request.failure}
                ),
            )

            response = page.goto(BASE_URL + route, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(1200)

            metrics = page.evaluate(
                """() => {
                    const rect = selector => {
                        const node = document.querySelector(selector);
                        if (!node) return null;
                        const box = node.getBoundingClientRect();
                        const style = getComputedStyle(node);
                        return {
                            x: box.x, y: box.y, width: box.width, height: box.height,
                            display: style.display, visibility: style.visibility,
                            opacity: style.opacity
                        };
                    };
                    return {
                        title: document.title,
                        bodyClass: document.body.className,
                        canvas: rect('#stage'),
                        panel: rect('#panel'),
                        homeBtn: rect('#homeBtn'),
                        toggleBtn: rect('#toggleBtn'),
                        playCtl: rect('#playCtl'),
                        controls: document.querySelectorAll('input, select, button').length
                    };
                }"""
            )

            if name != "home":
                toggle = page.locator("#toggleBtn, #toggle").first
                if toggle.count() and toggle.is_visible():
                    before = page.locator("#panel").get_attribute("class") or ""
                    toggle.click()
                    page.wait_for_timeout(150)
                    after = page.locator("#panel").get_attribute("class") or ""
                    metrics["panelToggleChanged"] = before != after
                    metrics["panelToggleTested"] = True

                play = page.locator("#playCtl")
                if play.count() and play.is_visible():
                    before = play.inner_text()
                    play.click()
                    page.wait_for_timeout(100)
                    after = play.inner_text()
                    metrics["playToggleChanged"] = before != after
                    metrics["playToggleTested"] = True

                first_range = page.locator('input[type="range"]').first
                if first_range.count():
                    old_value = first_range.input_value()
                    minimum = float(first_range.get_attribute("min") or 0)
                    maximum = float(first_range.get_attribute("max") or 100)
                    step = float(first_range.get_attribute("step") or 1)
                    old_number = float(old_value)
                    candidate_number = old_number + step
                    if candidate_number > maximum:
                        candidate_number = old_number - step
                    candidate = str(min(maximum, max(minimum, candidate_number)))
                    first_range.evaluate(
                        """(node, value) => {
                            node.value = value;
                            node.dispatchEvent(new Event('input', { bubbles: true }));
                        }""",
                        candidate,
                    )
                    new_value = first_range.input_value()
                    metrics["rangeInputProbe"] = {
                        "id": first_range.get_attribute("id"),
                        "old": old_value,
                        "candidate": candidate,
                        "new": new_value,
                        "step": first_range.get_attribute("step"),
                    }
                    metrics["rangeInputChanged"] = new_value != old_value
            else:
                next_button = page.locator("#nextBtn")
                if next_button.count() and next_button.is_visible():
                    before = page.locator("#selectionIndex").inner_text()
                    next_button.click()
                    page.wait_for_timeout(200)
                    after = page.locator("#selectionIndex").inner_text()
                    metrics["carouselChanged"] = before != after

            page.screenshot(path=str(output / f"{name}.png"))
            results[name] = {
                "status": response.status if response else None,
                "metrics": metrics,
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
                "failedRequests": failed_requests,
            }
            page.close()

        context.close()
        browser.close()

    (output / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    failures = []
    for name, result in results.items():
        if result["status"] != 200:
            failures.append(f"{name}: HTTP {result['status']}")
        if result["pageErrors"]:
            failures.append(f"{name}: page errors: {result['pageErrors']}")
        if name != "home":
            metrics = result["metrics"]
            if metrics.get("panelToggleTested") and not metrics.get("panelToggleChanged"):
                failures.append(f"{name}: panel toggle did not change state")
            if metrics.get("playToggleTested") and not metrics.get("playToggleChanged"):
                failures.append(f"{name}: play control did not change state")
            if name != "home" and not metrics.get("rangeInputChanged"):
                failures.append(f"{name}: range input did not accept updates")
            if name == "home" and not metrics.get("carouselChanged"):
                failures.append("home: carousel did not change selection")

    if failures:
        print("\n".join(failures))
        return 1
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
