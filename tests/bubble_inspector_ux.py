"""Check Bubble's progressive controls and mobile panel layout."""

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
    assert page.locator("#motion").is_hidden(), "the motion row must be hidden at concise depth"
    expert_count = page.locator("#panel .inspectorExpert").count()
    assert expert_count > 40, "too few controls were classified for progressive disclosure"

    before = control_snapshot(page)
    page.get_by_role("button", name="完整", exact=True).click()
    assert panel.get_attribute("data-control-depth") == "complete"
    assert page.locator("#inspectorPage-look details:has(#postExposure)").is_visible()
    assert control_snapshot(page) == before, "depth switch changed control values"

    # Tabs use roving focus and remember the last page.
    page.locator("#inspectorTab-shape").click()
    page.locator("#inspectorTab-shape").press("ArrowRight")
    assert page.locator("#inspectorTab-motion").get_attribute("aria-selected") == "true", "ArrowRight did not select motion"

    # 每個模式是獨立的模組，任何深度都不能切成另一個模式。
    assert page.locator("#motion").is_hidden(), "the motion row must stay hidden at complete depth"

    # 快速暫存／A/B 比較那一排已經移除，畫面上不該再留下任何殘骸。
    assert page.locator("#quickSlots").count() == 0, "the removed quick-slot bar is still in the page"
    assert page.locator("[data-slot]").count() == 0, "a stray quick-slot button survived"

    # Coordinated visual presets tune shell/icons separately for each backdrop,
    # while continuing to use the existing per-backdrop memory.
    page.goto(f"{base_url}/bubble/index.html?mode=research&diag=inspector-ux", wait_until="networkidle")
    page.wait_for_selector("#panel.inspector[data-control-depth=\"complete\"]")
    page.locator("#inspectorTab-motion").click()
    assert panel.get_attribute("role") == "region"
    assert page.locator(".inspectorTabs").get_attribute("aria-orientation") == "horizontal"

    # Readouts expose direct numeric entry and changed values are visibly
    # identified. A section reset restores only that section through the
    # normal control event path.
    breath = page.locator("#researchBreath")
    breath_readout = page.locator("#researchBreath_v")
    assert breath_readout.is_visible()
    readout_style = breath_readout.evaluate(
        "node => ({ background: getComputedStyle(node).backgroundColor, radius: getComputedStyle(node).borderRadius })"
    )
    assert readout_style["background"] != "rgba(0, 0, 0, 0)"
    assert float(readout_style["radius"].replace("px", "")) >= 10
    breath_readout.click()
    assert breath_readout.locator("input[type=number]").is_visible()
    breath_readout.locator("input[type=number]").press("Escape")
    breath_default = breath.input_value()
    breath.evaluate(
        """node => {
            node.value = String(Math.min(Number(node.max), Number(node.value) + 0.1));
            node.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    breath_row = page.locator("#researchBreath").locator("xpath=ancestor::*[contains(@class, 'row')][1]")
    page.wait_for_function("document.querySelector('#researchBreath').closest('.row').classList.contains('is-modified')")
    assert "is-modified" in (breath_row.get_attribute("class") or "")
    # 重設是以分頁為單位的：一頁一顆，而且只動這一頁的參數（見 inspector.js 的
    # PAGES 迴圈）。這裡順便確認它沒有越界——外觀分頁的染色強度必須原封不動。
    shell_tint = page.locator("#researchShellTint")
    shell_tint.evaluate(
        """node => {
            node.value = '0.33';
            node.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    page.locator("#inspectorPage-motion .inspectorPageReset").click()
    page.wait_for_function(
        "expected => document.querySelector('#researchBreath').value === expected",
        arg=breath_default,
    )
    assert "is-modified" not in (breath_row.get_attribute("class") or "")
    assert shell_tint.input_value() == "0.33", "the motion reset reached into the look page"

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

    # 常用深度會藏掉大部分參數，區塊很容易剩下一個打開沒東西的空殼。凡是還看得到
    # 展開箭頭的區塊，裡面就必須有東西可以調（見 inspector.js 的 pruneEmptySections）。
    for depth in ("concise", "complete"):
        page.evaluate(
            """depth => [...document.querySelectorAll('.inspectorDepthPicker button')]
                 .find(b => b.dataset.value === depth).click()""",
            depth,
        )
        page.wait_for_timeout(200)
        for tab in ("shape", "motion", "look", "scene"):
            page.locator(f"#inspectorTab-{tab}").click()
            page.wait_for_timeout(150)
            empty = page.evaluate(
                """() => [...document.querySelectorAll('#panel .inspectorPage details')]
                     .filter(node => node.offsetParent !== null || node.getClientRects().length)
                     .filter(node => !node.classList.contains('is-bodyEmpty'))
                     .filter(node => ![...node.querySelectorAll('input, select, textarea, button')]
                       .some(el => !el.closest('summary')
                         && (el.offsetParent !== null || el.getClientRects().length)))
                     .map(node => node.querySelector(':scope > summary h3, :scope > summary h4')?.textContent)"""
            )
            assert not empty, f"{depth}/{tab} still shows sections that open onto nothing: {empty}"
    page.evaluate(
        """() => [...document.querySelectorAll('.inspectorDepthPicker button')]
             .find(b => b.dataset.value === 'complete').click()"""
    )
    page.locator("#inspectorTab-look").click()

    page.reload(wait_until="networkidle")
    page.wait_for_selector("#panel.inspector[data-control-depth=\"complete\"]")
    assert page.locator("#inspectorTab-look").get_attribute("aria-selected") == "true", "last inspector page was not restored"
    assert not errors, f"desktop inspector page errors: {errors}"
    context.close()
    return {
        "expertControls": expert_count,
        "valuesPreserved": True,
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
    handle = page.locator(".mobile-sheet-handle")
    assert handle.get_attribute("role") == "button"
    assert page.locator("body").get_attribute("data-mobile-sheet") == "half"
    handle.press("Enter")
    assert page.locator("body").get_attribute("data-mobile-sheet") == "full"
    handle.press("Space")
    assert page.locator("body").get_attribute("data-mobile-sheet") == "peek"
    assert not errors, f"mobile inspector page errors: {errors}"
    context.close()
    return {"noHorizontalOverflow": True, "stickyHeader": True, "touchTabs": True}


def check_static(browser, base_url: str) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1100, "height": 760}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{base_url}/bubble/index.html?mode=static&diag=inspector-ux", wait_until="networkidle", timeout=45_000)
    page.wait_for_selector('#panel.inspector[data-layout="studio"]')
    # 開機遮罩（body[data-bubble-boot]）撤掉之前面板是藏著的；只等版面屬性的話，
    # 機器慢一點時下面的 is_visible 會剛好落在遮罩還在的那一刻，間歇失敗。
    page.wait_for_function("() => !document.body.hasAttribute('data-bubble-boot')", timeout=90_000)

    # 靜態模組是單頁面板：沒有分頁、沒有常用／完整、沒有模式選單。
    assert page.locator(".inspectorTabs").is_hidden()
    assert page.locator(".inspectorDepthPicker").is_hidden()
    assert page.locator("#motion").is_hidden()
    assert page.locator("#inspectorPage-studio").is_visible()
    sections = page.evaluate(
        """() => [...document.querySelectorAll('#inspectorPage-studio > details > summary h3')]
             .map(node => node.textContent)"""
    )
    # 風格已經拿掉；造型那一區還在面板裡（手機用），桌面上藏起來、改由右側卡片操作。
    assert sections[:5] == ["造型", "玻璃", "地板", "鏡頭", "背景"], sections
    # 用 wait_for 而不是 is_visible：開機遮罩撤掉之後面板還會做最後一次 refresh
    # （收合空區塊、套 gate），is_visible 不等待，偶爾會剛好量到那一瞬間。
    for key in ("ior", "dispersionScale", "studioShadowStrength", "cameraFov"):
        try:
            page.locator(f"#{key}").wait_for(state="visible", timeout=5_000)
        except Exception:
            raise AssertionError(f"{key} is not on the static panel")
    # 阿貝數不開給使用者（跟彩虹強度只差一個比值）；折射率底下有常見材料可以點。
    assert page.locator("#dispersionAbbe").is_hidden(), "the Abbe number should not be on the static panel"
    glass_order = page.evaluate(
        """() => [...document.querySelectorAll('#inspectorPage-studio .row input, #inspectorPage-studio .row select')]
             .map(el => el.id).filter(id => ['absorbColor', 'absorb', 'roughness', 'ior', 'reflect', 'dispersionScale'].includes(id))"""
    )
    assert glass_order == ["absorbColor", "absorb", "roughness", "dispersionScale", "reflect", "ior"], glass_order
    # 材料按鈕緊接在折射率那一列後面。
    assert page.evaluate("() => document.getElementById('ior').closest('.row').nextElementSibling"
                         ".classList.contains('inspectorIorPresets')"), "the IOR chips should follow the IOR row"
    page.locator('.inspectorIorPresets button[data-ior="2.42"]').click()
    assert page.locator("#ior").input_value() == "2.42", page.locator("#ior").input_value()
    assert page.locator('.inspectorIorPresets button[data-ior="2.42"]').get_attribute("aria-pressed") == "true"
    page.locator('.inspectorIorPresets button[data-ior="1.5"]').click()
    assert page.locator("#ior").input_value() == "1.5"
    # 邊緣彩虹不開給使用者；燈光強度與明暗對比改成畫面右下角的常駐調整。
    for key in ("edgeDispersion", "studioCardStrength", "studioFlag"):
        assert page.locator(f"#{key}").is_hidden(), f"{key} should not be on the static panel"
    assert page.locator("#absorbColor").input_value() == "#ffffff"
    assert page.locator("#absorb").input_value() == "4"

    # 右下角的鏡像滑桿：拖它要寫回真正的參數（連同自動保存），重設要讓它跟著回去。
    dock = page.locator("#studioQuickDock")
    assert dock.is_visible(), "the quick light dock is missing"
    mirror = dock.locator("input[type=range]").first
    mirror.evaluate("el => { el.value = '0.9'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#studioCardStrength").input_value() == "0.9"
    page.wait_for_function(
        "(JSON.parse(localStorage.getItem('vfx:prism-drops:static:last') || '{}').values || {}).studioCardStrength === '0.9'"
    )
    # 重設鈕此刻收在尚未展開的工具區裡，直接派發點擊。
    page.locator("#resetBtn").evaluate("el => el.click()")
    page.wait_for_function(
        "document.querySelector('#studioQuickDock input[type=range]').value"
        " === document.querySelector('#studioCardStrength').value"
    )

    # 主光用方位盤調：往正上方拖是逆光，也就是跟鏡頭方位差 180°。
    dial = page.locator("#studioQuickDock .lightDialCanvas")
    assert dial.is_visible(), "the light dial is missing from the quick dock"
    dial.scroll_into_view_if_needed()
    box = dial.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 20)
    azimuth = float(page.locator("#lightKeyAzimuth").input_value())
    camera = float(page.locator("#cameraRotationY").input_value())
    assert abs(((azimuth - camera) % 360) - 180) < 3, (azimuth, camera)

    assert page.locator("[data-static-look]").count() == 0, "the style presets should be gone"

    # 右側欄：左緣對齊「輸出」、右緣對齊「面板」；造型卡在燈光卡上面。
    shape_card = page.locator("#studioShapeCard")
    assert shape_card.is_visible(), "the shape card is missing"
    # 造型與背景兩區在桌面上都搬到右側卡片，面板裡那兩區藏起來。
    mirrored = page.locator("#panel .studioDesktopMirrored")
    assert mirrored.count() == 2, mirrored.count()
    assert all(mirrored.nth(i).is_hidden() for i in range(2)), "the mirrored panel sections should be hidden on desktop"
    geometry = page.evaluate(
        """() => Object.fromEntries(['exportBtn', 'toggleBtn', 'studioShapeCard', 'studioQuickDock']
             .map(id => [id, document.getElementById(id).getBoundingClientRect().toJSON()]))"""
    )
    for card in ("studioShapeCard", "studioQuickDock"):
        assert abs(geometry[card]["left"] - geometry["exportBtn"]["left"]) <= 1, (card, geometry)
        assert abs(geometry[card]["right"] - geometry["toggleBtn"]["right"]) <= 1, (card, geometry)
    assert geometry["studioShapeCard"]["bottom"] < geometry["studioQuickDock"]["top"], geometry
    light_top = geometry["studioQuickDock"]["top"]

    # 背景色併進「背景與燈光」卡片：深底一個色票，改色要寫回真的 bgColor。
    assert page.locator("#studioQuickDock .studioQuickDockTitle").text_content() == "背景與燈光"
    color_rows = """() => [...document.querySelectorAll('#studioQuickDock .studioQuickDockColorRow')]
        .filter(r => !r.hidden).map(r => r.textContent.trim())"""
    assert page.evaluate(color_rows) == ["背景"], page.evaluate(color_rows)
    page.locator("#studioQuickDock .studioQuickDockColor").first.evaluate(
        "el => { el.value = '#223344'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#bgColor").input_value() == "#223344", page.locator("#bgColor").input_value()
    assert page.locator("#bgColor").evaluate("el => getComputedStyle(el.closest('details')).display") == "none", \
        "the panel background section should be hidden on desktop"

    # 輸出對話框開著時，右側欄要跟左邊面板一樣收起來，關掉後回來。
    assert dock.is_visible(), "the light dock is not visible before opening export"
    page.locator("#exportBtn").evaluate("el => el.click()")
    page.wait_for_function("document.getElementById('exportDialog').open")
    assert dock.is_hidden(), "the light dock is showing over the export dialog"
    page.locator("#exportDialog").evaluate("el => el.close()")
    page.wait_for_function("!document.getElementById('exportDialog').open")
    assert dock.is_visible(), "the light dock did not come back after the export dialog closed"

    # 形狀只剩方體、圓環、匯入（真的選單與右側卡片的鏡像都是）。
    shapes = page.locator("#staticShape option").evaluate_all("els => els.map(el => el.value)")
    assert shapes == ["0", "6", "7"], shapes
    mirror_shape = shape_card.locator("select").first
    assert mirror_shape.locator("option").evaluate_all("els => els.map(el => el.value)") == ["0", "6", "7"]

    # 匯入形狀時才出現檔案按鈕與擠出參數；卡片變高，但燈光卡不動。
    # 等的是頁面自己的狀態（那一列的 hidden），不是 Playwright 的可見性判斷：切形狀
    # 的頭一兩百毫秒裡 gate 會連續套好幾次，可見性輪詢偶爾會卡在那段抖動裡。
    #
    # 逾時給 20 秒：這支測試的瀏覽器沒有 GPU，切到「匯入」要換的 shader 變體在
    # SwiftShader（CPU）上編，主執行緒會一次卡住將近 7 秒（實測 6.8s；有 GPU 時是
    # 0.17s）。那段期間 wait_for_function 的輪詢本身也跑不了，5 秒一定逾時。
    shape_switch_timeout = 20_000
    button_row_hidden = """() => document.querySelector('#studioShapeCard .studioQuickDockButton')
        .closest('.studioQuickDockRow').hidden"""
    page.wait_for_function(button_row_hidden, timeout=shape_switch_timeout)
    mirror_shape.select_option("7")
    assert page.locator("#staticShape").input_value() == "7", "the mirror did not reach the real control"
    page.wait_for_function(f"() => !({button_row_hidden})()", timeout=shape_switch_timeout)
    moved = page.evaluate("() => document.getElementById('studioQuickDock').getBoundingClientRect().top")
    assert abs(moved - light_top) <= 1, (moved, light_top)
    mirror_shape.select_option("0", timeout=shape_switch_timeout)
    page.wait_for_function(button_row_hidden, timeout=shape_switch_timeout)

    # 參數檔記著別的模式也不能把模組切走，而且檔案裡「按模式記憶」的值
    # （cameraFov）要落在這個模組，不能在切走再切回來時被丟掉。
    page.locator(".inspectorUtilities > summary").click()
    page.locator("#presetIO button", has_text="貼上參數").click()
    page.locator("#presetIO textarea").fill(
        '{"effect":"prism-drops","values":{"motion":"formation",'
        '"dispersionScale":1.6,"cameraFov":33}}'
    )
    page.locator("#presetIO button", has_text="套用").click()
    page.wait_for_function("document.querySelector('#dispersionScale').value === '1.6'")
    assert page.locator("#motion").input_value() == "static", "a preset switched the module"
    assert page.locator("#cameraFov").input_value() == "33", (
        "a per-mode value from the preset was dropped: "
        + page.locator("#cameraFov").input_value()
    )
    assert "mode=static" in page.url, f"the preset rewrote the module URL: {page.url}"
    page.locator("#resetBtn").click()
    assert not errors, f"static inspector page errors: {errors}"
    context.close()
    return {"singlePage": True, "modeLocked": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        results = {
            "desktop": check_desktop(browser, args.base_url),
            "mobile": check_mobile(browser, args.base_url),
            "static": check_static(browser, args.base_url),
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
