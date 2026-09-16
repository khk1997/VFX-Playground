"""Check Bubble's progressive controls, A/B slots, and mobile panel layout."""

from __future__ import annotations

import argparse
import sys

from playwright.sync_api import sync_playwright


def open_inspector(page, base_url: str) -> None:
    response = page.goto(
        f"{base_url}/bubble/index.html?diag=inspector-ux",
        wait_until="networkidle",
        timeout=45_000,
    )
    assert response and response.status == 200
    page.wait_for_selector("#panel.inspector[data-control-depth]")
    page.wait_for_function(
        "document.querySelector('[data-slot=\"0\"]')?.textContent === 'A'"
    )


def control_snapshot(page) -> dict[str, object]:
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll(
            '#panel input[id], #panel select[id], #panel textarea[id]'
        )].map(node => [node.id, node.type === 'checkbox' ? node.checked : node.value]))"""
    )


def check_desktop(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(
        viewport={"width": 1100, "height": 760},
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_inspector(page, base_url)

    panel = page.locator("#panel")
    panel_toggle = page.locator("#toggleBtn")
    export_button = page.locator("#exportBtn")
    export_dialog = page.locator("#exportDialog")
    assert panel_toggle.get_attribute("aria-expanded") == "true", "panel toggle did not start expanded"

    # Parameter editing and export are mutually exclusive desktop workspaces.
    export_button.click()
    assert export_dialog.get_attribute("open") is not None, "export dialog did not open"
    assert panel.get_attribute("class") and "collapsed" in panel.get_attribute("class"), "export did not collapse panel"
    assert export_button.get_attribute("aria-expanded") == "true", "export button did not expose open state"
    assert panel_toggle.get_attribute("aria-expanded") == "false", "panel toggle did not expose collapsed state"
    panel_toggle.click()
    page.wait_for_function(
        "!document.querySelector('#exportDialog').open && !document.querySelector('#panel').classList.contains('collapsed')"
    )
    assert "collapsed" not in (panel.get_attribute("class") or ""), "panel request did not expand panel"
    assert export_button.get_attribute("aria-expanded") == "false", "export button stayed expanded after switching"
    assert panel_toggle.get_attribute("aria-expanded") == "true", "panel toggle stayed collapsed after switching"

    # Closing export restores the state that preceded it, including a closed panel.
    panel_toggle.click()
    assert "collapsed" in (panel.get_attribute("class") or ""), "panel toggle did not collapse panel"
    export_button.click()
    page.locator(".exportClose").click()
    page.wait_for_function(
        "!document.querySelector('#exportDialog').open && document.querySelector('#panel').classList.contains('collapsed')"
    )
    assert "collapsed" in (panel.get_attribute("class") or ""), "closing export unexpectedly restored a closed panel"
    panel_toggle.click()
    header_height = page.locator(".inspectorHeader").bounding_box()["height"]
    assert header_height < 210, f"desktop inspector header is still too tall: {header_height}"
    assert page.locator(".inspectorContext").count() == 1
    assert page.locator(".inspectorUtilities #presetIO").count() == 1
    assert page.locator(".inspectorUtilities #resetBtn").count() == 1
    assert panel.get_attribute("data-control-depth") == "concise"
    assert page.locator("#inspectorPage-look details:has(#postExposure)").is_hidden()
    assert page.locator("[data-slot=\"2\"]").is_hidden()
    expert_count = page.locator("#panel .inspectorExpert").count()
    assert expert_count > 40, "too few controls were classified for progressive disclosure"

    before = control_snapshot(page)
    page.get_by_role("button", name="完整", exact=True).click()
    assert panel.get_attribute("data-control-depth") == "complete"
    assert page.locator("#inspectorPage-look details:has(#postExposure)").is_visible()
    assert page.locator("[data-slot=\"2\"]").is_visible()
    assert control_snapshot(page) == before, "depth switch changed control values"

    # Tabs use roving focus and remember the last page.
    page.locator("#inspectorTab-shape").click()
    page.locator("#inspectorTab-shape").press("ArrowRight")
    assert page.locator("#inspectorTab-motion").get_attribute("aria-selected") == "true", "ArrowRight did not select motion"

    # A/B reuses the existing quick-slot serialization instead of maintaining a
    # second preset implementation.
    reflect = page.locator("#reflect")
    original = reflect.input_value()
    page.locator("[data-slot=\"0\"]").click()
    assert "is-saved" in (page.locator("[data-slot=\"0\"]").get_attribute("class") or "")
    reflect.evaluate(
        """node => {
            node.value = String(Math.min(Number(node.max), Number(node.value) + 0.1));
            node.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    changed = reflect.input_value()
    assert changed != original
    page.locator("[data-slot=\"1\"]").click()
    page.locator("[data-slot=\"0\"]").click()
    page.wait_for_timeout(150)
    assert reflect.input_value() == original, "A/B slot did not restore the saved value"

    # Coordinated visual presets tune shell/icons separately for each backdrop,
    # while continuing to use the existing per-backdrop memory.
    page.locator("#motion").select_option("research")
    page.locator("#inspectorTab-look").click()
    prism = page.locator('[data-visual-preset="prism"]')
    assert prism.is_visible(), "Prism preset is not visible in Installing/look"
    prism.click()
    assert page.locator("#researchShellMultiTint").is_checked(), "shell multicolor was not enabled"
    assert page.locator("#researchIconMultiTint").is_checked(), "icon multicolor was not enabled"
    dark_shell = page.locator("#researchShellTint").input_value()
    dark_icon = page.locator("#researchIconTint").input_value()
    assert dark_shell != dark_icon, "preset collapsed shell and icon tuning"
    page.locator("#backdrop").select_option("light")
    prism.click()
    light_shell = page.locator("#researchShellTint").input_value()
    assert light_shell != dark_shell, "preset did not distinguish light and dark tuning"
    page.locator("#backdrop").select_option("dark")
    page.wait_for_timeout(100)
    assert page.locator("#researchShellTint").input_value() == dark_shell, "dark preset memory was not restored"

    page.reload(wait_until="networkidle")
    page.wait_for_selector("#panel.inspector[data-control-depth=\"complete\"]")
    assert page.locator("#inspectorTab-look").get_attribute("aria-selected") == "true", "last inspector page was not restored"
    assert not errors, f"desktop inspector page errors: {errors}"
    context.close()
    return {
        "expertControls": expert_count,
        "valuesPreserved": True,
        "abCompared": True,
        "visualPresets": True,
    }


def check_mobile(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_inspector(page, base_url)
    panel = page.locator("#panel")
    metrics = panel.evaluate(
        """node => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })"""
    )
    assert metrics["scrollWidth"] <= metrics["clientWidth"] + 1

    tabs = page.locator(".inspectorTabs button")
    assert tabs.count() == 4
    for index in range(tabs.count()):
        assert tabs.nth(index).bounding_box()["height"] >= 40

    header_box = page.locator(".inspectorHeader").bounding_box()
    before_top = header_box["y"]
    assert header_box["height"] < 190, f"mobile inspector header is still too tall: {header_box['height']}"
    panel.evaluate("node => { node.scrollTop = 360; }")
    page.wait_for_timeout(100)
    after_top = page.locator(".inspectorHeader").bounding_box()["y"]
    assert abs(before_top - after_top) <= 2, "mobile inspector header did not remain sticky"
    assert not errors, f"mobile inspector page errors: {errors}"
    context.close()
    return {"noHorizontalOverflow": True, "stickyHeader": True, "touchTabs": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        results = {
            "desktop": check_desktop(browser, args.base_url),
            "mobile": check_mobile(browser, args.base_url),
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
