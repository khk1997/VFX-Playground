"""Runtime checks for Bubble adaptive quality, reduced motion, and pointer input."""

from __future__ import annotations

import argparse
import sys

from playwright.sync_api import Page, sync_playwright


def wait_for_shader(page: Page) -> None:
    page.wait_for_function(
        """() => {
            if (typeof window.__bubbleDiagReport !== 'function') return false;
            const variant = window.__bubbleDiagReport()['變體'];
            return variant['首編已完成']
                && variant['目前key'] === variant['應該要的key']
                && !variant['進行中編譯'];
        }""",
        timeout=90_000,
        polling=250,
    )


def open_page(page: Page, base_url: str) -> None:
    response = page.goto(
        f"{base_url}/bubble/index.html?diag=adaptive-runtime",
        wait_until="networkidle",
        timeout=45_000,
    )
    assert response and response.status == 200, "Bubble page did not load"
    wait_for_shader(page)


def check_reduced_motion(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(
        viewport={"width": 960, "height": 640},
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_page(page, base_url)
    page.wait_for_timeout(900)

    assert page.locator("body").get_attribute("data-reduced-motion") == "paused"
    assert page.locator("#playCtl").get_attribute("aria-label") == "播放動畫"
    report = page.evaluate("window.__bubbleDiagReport()")
    assert report["效能"]["減少動態效果暫停"] is True
    assert report["效能"]["自動品質層級"] == "low"
    assert report["效能"]["reflectionSamples"] == 4

    frame_a = page.locator("#stage").screenshot()
    page.wait_for_timeout(350)
    frame_b = page.locator("#stage").screenshot()
    assert frame_a == frame_b, "reduced-motion canvas kept animating"

    page.locator("#playCtl").click()
    page.wait_for_timeout(100)
    assert page.locator("body").get_attribute("data-reduced-motion") == "allowed"
    assert page.locator("#playCtl").get_attribute("aria-label") == "暫停動畫"
    frame_c = page.locator("#stage").screenshot()
    page.wait_for_timeout(350)
    frame_d = page.locator("#stage").screenshot()
    assert frame_c != frame_d, "explicit play did not override reduced motion"
    assert not errors, f"reduced-motion page errors: {errors}"
    context.close()
    return {"pausedFrameStable": True, "explicitPlayResumed": True}


def check_adaptive_quality(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 960, "height": 640})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_page(page, base_url)

    initial = page.evaluate("window.__bubbleDiagReport()['效能']")
    # Keep the page out of the intentional idle 30 FPS cap while the adaptive
    # sampler observes the real renderer throughput.
    page.evaluate(
        "window.__qualityKeepAwake = setInterval(() => "
        "window.dispatchEvent(new Event('click')), 900)"
    )
    page.wait_for_function(
        "window.__bubbleDiagReport()['效能']['自動品質層級'] !== 'high'",
        timeout=15_000,
        polling=500,
    )
    page.evaluate("clearInterval(window.__qualityKeepAwake)")
    adapted = page.evaluate("window.__bubbleDiagReport()['效能']")
    assert adapted["qualitySteps"] < initial["qualitySteps"]
    assert initial["reflectionSamples"] == 8
    assert adapted["reflectionSamples"] == 4
    assert adapted["最近取樣FPS"] is not None
    assert not errors, f"adaptive-quality page errors: {errors}"
    context.close()
    return {"initial": initial, "adapted": adapted}


def check_pointer_input(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_page(page, base_url)

    mobile_report = page.evaluate("window.__bubbleDiagReport()")
    assert mobile_report["效能"]["reflectionSamples"] == 4
    assert mobile_report["shaderVariant"]["編譯期迴圈上限"]["反射環形取樣上限"] == 4

    stage = page.locator("#stage")
    before = float(page.locator("#cameraRotationY").input_value())
    page.mouse.move(195, 220)
    page.mouse.down()
    assert stage.get_attribute("data-dragging") == "true"

    # A second pointer cannot steal the active drag.
    page.evaluate(
        """() => document.querySelector('#stage').dispatchEvent(new PointerEvent(
            'pointermove', { pointerId: 99, pointerType: 'touch', isPrimary: false,
            clientX: 380, clientY: 220, bubbles: true }
        ))"""
    )
    after_secondary = float(page.locator("#cameraRotationY").input_value())
    assert after_secondary == before

    page.mouse.move(235, 220, steps=3)
    after_primary = float(page.locator("#cameraRotationY").input_value())
    assert after_primary != before
    page.mouse.up()
    assert stage.get_attribute("data-dragging") is None

    # A non-primary touch cannot begin a new drag by itself.
    page.evaluate(
        """() => document.querySelector('#stage').dispatchEvent(new PointerEvent(
            'pointerdown', { pointerId: 100, pointerType: 'touch', isPrimary: false,
            clientX: 180, clientY: 220, bubbles: true }
        ))"""
    )
    assert stage.get_attribute("data-dragging") is None
    assert not errors, f"pointer-input page errors: {errors}"
    context.close()
    return {"rotationBefore": before, "rotationAfter": after_primary, "singlePointer": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        results = {
            "reducedMotion": check_reduced_motion(browser, args.base_url),
            "adaptiveQuality": check_adaptive_quality(browser, args.base_url),
            "pointerInput": check_pointer_input(browser, args.base_url),
        }
        browser.close()
    print(results)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
