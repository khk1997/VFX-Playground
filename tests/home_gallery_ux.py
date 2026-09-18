"""Smoke-test the multi-card Liquid Glass home gallery and preview budget."""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--output", default="/tmp/vfx-home-gallery-ux")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        desktop = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = desktop.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{args.base_url}/index.html", wait_until="networkidle", timeout=45_000)
        page.wait_for_timeout(900)

        cards = page.locator("#cards .card")
        assert cards.count() == 13, f"expected 13 cards, got {cards.count()}"
        assert page.locator(".hero, .gallery-title, .gallery-kicker").count() == 0, (
            "home reintroduced explanatory hero copy above the cards"
        )
        assert page.locator(".card-description").count() == 13
        assert page.locator(".card-poster").count() == 13
        assert page.locator("iframe").count() == 0, "home mounted a live preview before intent"
        assert page.evaluate(
            "() => document.querySelectorAll('.topbar .filters .filter-btn').length"
        ) == 5, "filters are no longer the topbar's only control"
        assert page.evaluate(
            "() => getComputedStyle(document.querySelector('#cards')).gridTemplateColumns.split(' ').length"
        ) == 10, "desktop gallery is not using five two-track card columns"
        page.evaluate("() => [...document.images].forEach(image => image.loading = 'eager')")
        page.wait_for_function(
            "() => [...document.images].every(image => image.complete)", timeout=15_000
        )
        assert page.evaluate(
            "() => [...document.images].every(image => image.complete && image.naturalWidth > 0)"
        ), "one or more poster images failed to load"
        page.wait_for_timeout(100)
        assert page.evaluate("""() => [...document.querySelectorAll('#cards .card')].every(card => {
          const tags = card.querySelector('.card-tags').getBoundingClientRect();
          const box = card.getBoundingClientRect();
          return box.bottom - tags.bottom <= 24;
        })"""), "one or more cards still leaves excess space below its tags"

        cards.nth(0).hover()
        page.wait_for_timeout(1_100)
        assert page.locator("iframe").count() == 1, "hover did not activate one live preview"
        live_frame = page.locator("iframe.is-ready")
        assert live_frame.count() == 1, "live preview iframe loaded but was never revealed"
        preview_a = cards.nth(0).locator(".card-preview").screenshot(animations="allow")
        page.wait_for_timeout(500)
        preview_b = cards.nth(0).locator(".card-preview").screenshot(animations="allow")
        assert preview_a != preview_b, "live preview is visible but its rendered frame is static"
        cards.nth(1).hover()
        page.wait_for_timeout(1_100)
        assert page.locator("iframe").count() == 1, "hover mounted more than one live preview"
        assert cards.nth(1).get_attribute("class").find("is-previewing") >= 0
        assert cards.nth(1).locator("iframe.is-ready").count() == 1, (
            "Energy Ring live preview loaded but was never revealed"
        )
        energy_a = cards.nth(1).locator(".card-preview").screenshot(animations="allow")
        page.wait_for_timeout(700)
        energy_b = cards.nth(1).locator(".card-preview").screenshot(animations="allow")
        assert energy_a != energy_b, "Energy Ring live preview is visible but not animating"

        page.locator('[data-filter="liquid"]').click()
        assert page.locator("#cards .card:visible").count() == 10
        page.locator('[data-filter="typography"]').click()
        assert page.locator("#cards .card:visible").count() == 1
        page.locator('[data-filter="all"]').click()
        page.screenshot(path=str(output / "desktop.png"), full_page=True, animations="disabled")
        assert not errors, errors
        desktop.close()

        mobile = browser.new_context(
            viewport={"width": 390, "height": 844},
            has_touch=True,
            is_mobile=True,
        )
        page = mobile.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{args.base_url}/index.html", wait_until="networkidle", timeout=45_000)
        page.wait_for_timeout(700)
        assert page.locator("#cards .card").count() == 13
        assert page.locator("iframe").count() == 0, "mobile should stay on lightweight posters"
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        page.locator('[data-filter="canvas"]').click()
        assert page.locator("#cards .card:visible").count() == 3
        assert page.locator("iframe").count() == 0
        page.screenshot(path=str(output / "mobile.png"), full_page=True, animations="disabled")
        assert not errors, errors
        mobile.close()
        browser.close()

    print("Home gallery layout, filters, posters, and single-preview budget passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
