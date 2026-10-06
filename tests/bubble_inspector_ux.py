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
    # 參數檔在桌面上搬進右上角的 ⋯；真的重設鈕仍在面板裡（⋯ 的「全部重設」按的就是它）。
    assert page.locator("#moreMenu #presetIO").count() == 1
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
    # 深淺底在桌面上是右上角的開關（面板頂端那個下拉藏起來了）。
    page.locator("#backdropBtn").click()
    assert page.locator("#backdrop").input_value() == "light"
    prism.click()
    light_shell = page.locator("#researchShellTint").input_value()
    assert light_shell != dark_shell, "preset did not distinguish light and dark tuning"
    page.locator("#backdropBtn").click()
    assert page.locator("#backdrop").input_value() == "dark"
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
    # 舊的「進階」拆成燈光與後期；透射率回到玻璃區、邊緣光與光譜取樣不開給使用者，
    # 抗鋸齒是右上角的「畫質」。「更多與管理」在桌面上搬進右上角的 ⋯（面板裡那一區
    # 只留給手機）。
    assert sections == ["造型", "玻璃", "地板", "燈光", "鏡頭", "背景", "後期", "更多與管理"], sections
    assert page.locator("#panel .inspectorUtilities.inspectorTopBarMirrored").is_hidden()
    # 光暈只開放開關、強度與範圍；門檻、柔度、最大亮度、光暈色自動決定。打開光暈時
    # 那一組跟著展開。
    for key in ("bloomThreshold", "bloomKnee", "bloomClamp", "bloomTint"):
        assert page.locator(f"#{key}").evaluate("el => el.closest('.row').hidden"), key
    page.locator("#bloomEnabled").evaluate(
        "el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }")
    page.wait_for_function("document.getElementById('bloomGroup').open")
    assert page.locator("#bloomIntensity").evaluate("el => el.closest('.row').querySelector('label').textContent") == "光暈強度"
    page.locator("#bloomEnabled").evaluate(
        "el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }")
    assert page.locator("#inspectorPage-studio #fresnel").count() == 0
    assert page.locator("#inspectorPage-studio #spectralSamples").count() == 0
    # 右上角由右而左：面板、⋯、輸出、畫質；靜態沒有播放鍵。
    top = page.evaluate("""() => Object.fromEntries(['qualityBtn', 'exportBtn', 'moreBtn', 'toggleBtn', 'playCtl'].map(id => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        return [id, getComputedStyle(el).display === 'none' ? null : { left: r.left, right: r.right }];
    }))""")
    assert top["playCtl"] is None, "the static module should have no play button"
    assert (top["qualityBtn"]["right"] < top["exportBtn"]["left"] < top["exportBtn"]["right"]
            < top["moreBtn"]["left"] < top["moreBtn"]["right"] < top["toggleBtn"]["left"]), top
    page.locator("#qualityBtn").click()
    page.locator("#qualityMenu button", has_text="最高").click()
    assert page.locator("#antialiasLevel").input_value() == "ultra"
    assert page.locator("#qualityMenu").is_hidden()
    page.locator("#qualityBtn").click()
    page.locator("#qualityMenu button", has_text="中").click()
    # ⋯：參數檔整個搬進選單；全部重設要按兩次（第一次只換成確認）。用 JS 點：無頭
    # 瀏覽器是軟體算繪，Playwright 等「兩幀不動」就會超過確認的那幾秒。
    page.locator("#moreBtn").click()
    assert page.locator("#moreMenu #presetIO").count() == 1
    assert page.locator("#moreMenu button", has_text="複製參數").is_visible()
    page.locator("#absorb").evaluate("el => { el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    danger = page.locator("#moreMenu .topMenuDanger")
    danger.evaluate("el => el.click()")
    assert page.locator("#absorb").input_value() == "7", "the first click must only ask for confirmation"
    assert danger.text_content() == "再按一次確認重設"
    danger.evaluate("el => el.click()")
    assert page.locator("#absorb").input_value() == "4", "the confirmed reset did not run"
    assert page.locator("#moreMenu").is_hidden()
    # 用 wait_for 而不是 is_visible：開機遮罩撤掉之後面板還會做最後一次 refresh
    # （收合空區塊、套 gate），is_visible 不等待，偶爾會剛好量到那一瞬間。
    # 影子深度在右側的地板卡（見下面），不在面板上。
    for key in ("ior", "dispersionScale", "cameraFov"):
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

    # 右側欄：左緣對齊「輸出」、右緣對齊「面板」（中間是 ⋯）；造型卡在燈光卡上面。
    shape_card = page.locator("#studioShapeCard")
    assert shape_card.is_visible(), "the shape card is missing"
    # 造型與背景兩區在桌面上都搬到右側卡片，面板裡那兩區藏起來。
    # 燈光與地板也是：桌面上改由右側的卡片操作。
    mirrored = page.locator("#panel .studioDesktopMirrored")
    assert mirrored.count() == 4, mirrored.count()
    assert all(mirrored.nth(i).is_hidden() for i in range(4)), "the mirrored panel sections should be hidden on desktop"
    # 右側由上而下：造型、地板、背景與燈光，互不重疊。
    stack = page.evaluate("""() => ['studioShapeCard', 'studioFloorCard', 'studioQuickDock']
        .map(id => document.getElementById(id).getBoundingClientRect().toJSON())""")
    assert stack[0]["bottom"] <= stack[1]["top"] and stack[1]["bottom"] <= stack[2]["top"], stack
    assert page.locator("#studioFloorCard .studioQuickDockTitle").text_content() == "地板"
    # 靜態的面板拆成卡片：看得到的區塊各自一張，間距跟右側一樣 12px。
    cards = page.evaluate("""() => [...document.querySelectorAll('#inspectorPage-studio > .inspectorSection')]
        .filter(node => getComputedStyle(node).display !== 'none')
        .map(node => ({ title: node.querySelector(':scope > summary h3').textContent,
                        top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom,
                        first: node.classList.contains('is-firstCard') }))""")
    assert [card["title"] for card in cards] == ["玻璃", "鏡頭", "後期"], cards
    assert cards[0]["first"] and not any(card["first"] for card in cards[1:]), cards
    for upper, lower in zip(cards, cards[1:]):
        assert abs(lower["top"] - upper["bottom"] - 12) <= 1, (upper, lower)
    # 卡片固定在欄位裡：滾輪只捲游標下那張卡，面板本身與其他卡不動。
    glass = page.locator("#inspectorPage-studio > .inspectorSection.is-firstCard")
    camera_top = page.locator("#inspectorPage-studio > .inspectorSection", has_text="鏡頭").bounding_box()["y"]
    box = glass.bounding_box()
    page.mouse.move(box["x"] + 150, box["y"] + 150)
    page.mouse.wheel(0, 300)
    page.wait_for_function(
        "document.querySelector('#inspectorPage-studio > .inspectorSection.is-firstCard').scrollTop > 0")
    assert page.evaluate("document.getElementById('panel').scrollTop") == 0, "the whole panel scrolled"
    assert page.locator("#inspectorPage-studio > .inspectorSection", has_text="鏡頭").bounding_box()["y"] == camera_top
    glass.evaluate("el => { el.scrollTop = 0; }")
    # 深底／淺底是右上角的開關（面板頂端的「預覽底色」在桌面上藏起來）。
    assert page.locator("#backdrop").evaluate("el => getComputedStyle(el.closest('.row')).display") == "none"
    switch = page.locator("#backdropBtn")
    assert switch.get_attribute("aria-checked") == "false"
    switch.click()
    assert page.locator("#backdrop").input_value() == "light"
    assert switch.get_attribute("aria-checked") == "true"
    switch.click()
    assert page.locator("#backdrop").input_value() == "dark"
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
    # 標題列右邊還有「細調」按鈕，只比標題本身那段文字。
    assert page.locator("#studioQuickDock .studioQuickDockTitle").evaluate(
        "el => el.firstChild.textContent") == "背景與燈光"
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
    page.locator("#moreBtn").click()
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
    page.keyboard.press("Escape")
    page.locator("#resetBtn").evaluate("el => el.click()")
    assert not errors, f"static inspector page errors: {errors}"
    context.close()
    return {"singlePage": True, "modeLocked": True}


def check_studio_motion(browser, base_url: str) -> dict[str, object]:
    """A moving studio-glass mode gets the same single page, plus its own motion section."""
    context = browser.new_context(viewport={"width": 1100, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{base_url}/bubble/index.html?mode=capillary&diag=inspector-ux", wait_until="networkidle", timeout=45_000)
    page.wait_for_selector('#panel.inspector[data-layout="studio"]')
    page.wait_for_function("() => !document.body.hasAttribute('data-bubble-boot')", timeout=90_000)
    assert page.locator(".inspectorTabs").is_hidden()
    visible_sections = page.evaluate(
        """() => [...document.querySelectorAll('#inspectorPage-studio > details')]
            .filter(node => !node.classList.contains('is-emptyHidden') && !node.closest('.gated-off'))
            .map(node => node.querySelector(':scope > summary h3').textContent)"""
    )
    # 造型在右側卡片（桌面）；毛細波沒有水滴，「水滴」整區要被閘門收掉。
    for name in ("玻璃", "動態", "地板", "燈光", "鏡頭", "後期"):
        assert name in visible_sections, f"missing studio section {name}: {visible_sections}"
    assert "水滴" not in visible_sections, visible_sections
    motion = page.locator("#inspectorPage-studio > details", has_text="動態")
    for key in ("loopDuration", "capillaryHeight", "capillaryRings", "capillarySpeed"):
        assert motion.locator(f"#{key}").count() == 1, f"{key} is not in the motion section"
    # 舊的加色外觀不在這一頁。
    for key in ("rayDispersionEnabled", "spectralCausticEnabled", "filmEnabled", "materialExposure"):
        assert page.locator(f"#inspectorPage-studio #{key}").count() == 0, f"{key} leaked into the studio page"
    # 造型卡片是匯入那一組，不是靜態的內建幾何。
    card = page.locator("#studioShapeCard")
    assert card.is_visible()
    labels = card.locator(".studioQuickDockRow:not([hidden])").all_inner_texts()
    assert not any("形狀" in text for text in labels), labels
    assert any("檔案類型" in text for text in labels), labels
    assert page.locator("#cameraFov").input_value() == "28"
    # 會動的模組：播放鍵在畫質左邊（跟輸出換了位置）。
    play = page.locator("#playCtl").bounding_box()
    aa = page.locator("#qualityBtn").bounding_box()
    export = page.locator("#exportBtn").bounding_box()
    assert play["x"] + play["width"] < aa["x"] < export["x"], (play, aa, export)
    # 「面板」收起時右側卡片要一起收（往右滑出、點不到），打開時一起回來。
    side_state = """() => {
        const stack = document.getElementById('studioSideStack');
        const dock = document.getElementById('studioQuickDock').getBoundingClientRect();
        const hit = document.elementFromPoint(dock.x + dock.width / 2, dock.y + dock.height / 2);
        return { opacity: getComputedStyle(stack).opacity, clickable: !!hit?.closest('#studioQuickDock') };
    }"""
    assert page.evaluate(side_state) == {"opacity": "1", "clickable": True}
    page.locator("#toggleBtn").click()
    page.wait_for_function("() => getComputedStyle(document.getElementById('studioSideStack')).opacity === '0'")
    assert page.evaluate(side_state)["clickable"] is False, "the side cards stayed clickable while collapsed"
    page.locator("#toggleBtn").click()
    page.wait_for_function("() => getComputedStyle(document.getElementById('studioSideStack')).opacity === '1'")
    assert page.evaluate(side_state)["clickable"] is True

    # 方位盤選燈：選了邊光之後，方向鍵調的是邊光，而且地平線以下的高度留得住
    # （邊光預設 -17.5°，舊的盤面會把它夾成 0）。
    rim_before = float(page.locator("#lightRimElevation").input_value())
    key_before = page.locator("#lightKeyElevation").input_value()
    assert rim_before < 0, rim_before
    page.locator("#studioQuickDock .lightDialPicker button", has_text="邊光").click()
    page.locator("#studioQuickDock .lightDialCanvas").focus()
    page.keyboard.press("ArrowDown")
    assert float(page.locator("#lightRimElevation").input_value()) == rim_before - 5
    assert page.locator("#lightKeyElevation").input_value() == key_before, "the key light moved"
    # 細調：只列選中那盞燈的大小與強度，加上共用設定；Esc、點外面都會關。
    popover = page.locator("#studioLightPopover")
    assert popover.is_hidden()
    page.locator("#studioQuickDock .studioQuickDockToggle").click()
    assert popover.is_visible()
    assert popover.locator(".studioQuickDockTitle").text_content() == "邊光 細調"
    rows = popover.locator(".studioQuickDockRow:not([hidden])").all_inner_texts()
    assert [row.split("\n")[0] for row in rows] == ["大小", "強度", "燈的亮度", "燈的衰減", "燈的銳利度", "環境亮度"], rows
    page.locator("#studioQuickDock .lightDialPicker button", has_text="黑卡A").click()
    assert popover.locator(".studioQuickDockTitle").text_content() == "黑卡 A 細調"
    assert len(popover.locator(".studioQuickDockRow:not([hidden])").all_inner_texts()) == 5, "a black card has no power"
    page.keyboard.press("Escape")
    assert popover.is_hidden()
    page.locator("#studioQuickDock .studioQuickDockToggle").click()
    page.mouse.click(400, 400)
    assert popover.is_hidden(), "clicking the canvas should close the light popover"
    # 桌面上「燈光」區在右下卡片裡，面板那一區藏起來。
    assert page.locator("#panel .studioDesktopMirrored", has_text="主光 方向").is_hidden()
    assert not errors, f"capillary inspector page errors: {errors}"
    context.close()
    return {"singlePage": True, "motionSection": True}


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
            "studioMotion": check_studio_motion(browser, args.base_url),
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
