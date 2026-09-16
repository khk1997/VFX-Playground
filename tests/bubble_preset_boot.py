"""Boot Bubble with and without a saved parameter file, then import one by hand.

The autosave snapshot is user data: it comes from whichever version wrote it and it
may be unusable. Restoring it runs at module top level, so it sits directly in front
of the rest of the boot sequence -- including the removal of the ``data-bubble-boot``
mask. A user stuck behind that mask cannot reach the controls to undo whatever broke
them, so these checks pin both halves: restoring a snapshot must not raise, and a
restore that raises anyway must still leave a usable panel.
"""

from __future__ import annotations

import argparse
import json
import sys

from playwright.sync_api import BrowserContext, Page, sync_playwright

from bubble_baseline import set_select, wait_for_shader


STORAGE_KEY = "vfx:prism-drops:last"
# 靜態方體與毛細波各自的專屬參數：這兩個模式共用同一組表面紋理控制項，存進去的
# 值必須連模式一起回來，才算真的還原。rampCount 則是專門盯住 afterApply：色標
# 列的顯示數量得靠 updateRampRows 補刷，那一行曾經整個是未定義的。
SAVED_VALUES = {
    "motion": "capillary",
    "capillaryHeight": "0.18",
    "capillaryRings": "5",
    "capillarySpeed": "2",
    "capillaryDirectionX": "-0.6",
    "rampCount": "4",
}
SAVED_PAYLOAD = {"effect": "prism-drops", "version": 1, "values": SAVED_VALUES}

READ_CONTROLS = """() => {
  const v = id => document.getElementById(id)?.value;
  return {
    motion: v('motion'), capillaryHeight: v('capillaryHeight'),
    capillaryRings: v('capillaryRings'), capillarySpeed: v('capillarySpeed'),
    capillaryDirectionX: v('capillaryDirectionX'), rampCount: v('rampCount'),
    // 色標列是被 inline style 開關的；外層的配色模式另有自己的 CSS 閘門，
    // 所以這裡只看 updateRampRows 自己寫下的那一層。
    laidOutStopRows: [...document.querySelectorAll('[id^=stopRow]')]
      .filter(row => row.style.display !== 'none').length,
    booting: document.body.hasAttribute('data-bubble-boot'),
    panelVisible: !!document.querySelector('#panel')
      && getComputedStyle(document.querySelector('#panel')).visibility !== 'hidden',
    snapshot: (() => { try { return localStorage.getItem('vfx:prism-drops:last'); }
      catch (_) { return null; } })(),
  };
}"""

# 讓 restore() 丟出例外，藉此檢查開機遮罩不依賴使用者資料是否還原得動。
# 從外面包住 window.PresetIO，不必也不該去動效果本身的程式碼。
BREAK_RESTORE = """
let real = null;
Object.defineProperty(window, 'PresetIO', {
  configurable: true,
  get: () => (real ? {
    ...real,
    init: config => ({
      ...real.init(config),
      restore() { throw new Error('forced restore failure'); },
    }),
  } : real),
  set: value => { real = value; },
});
"""


def seed(context: BrowserContext, payload: object | None) -> None:
    """Write a snapshot into localStorage before any page script runs."""
    raw = "null" if payload is None else json.dumps(json.dumps(payload))
    context.add_init_script(
        # add_init_script 不收參數，值只能直接編進腳本裡。
        f"""(() => {{
          const key = {json.dumps(STORAGE_KEY)};
          const raw = {raw};
          try {{ raw === null ? localStorage.removeItem(key) : localStorage.setItem(key, raw); }}
          catch (_) {{ /* 無痕模式：這一輪就當作沒有保存檔 */ }}
        }})()"""
    )


def open_bubble(page: Page, base_url: str) -> None:
    response = page.goto(f"{base_url}/bubble/index.html", wait_until="networkidle", timeout=60_000)
    assert response and response.ok, "bubble page did not load"
    wait_for_shader(page)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        def fresh_page(payload: object | None, *, break_restore: bool = False):
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            seed(context, payload)
            if break_restore:
                context.add_init_script(BREAK_RESTORE)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            return context, page, errors

        # 1. 沒有保存檔：以預設值開機，遮罩一定要撤掉。
        context, page, errors = fresh_page(None)
        open_bubble(page, args.base_url)
        first_run = page.evaluate(READ_CONTROLS)
        assert not errors, f"first-run boot raised: {errors}"
        assert not first_run["booting"], "a first-run boot left the data-bubble-boot mask in place"
        context.close()

        # 2. 有保存檔：還原不得丟例外，值、相依 UI 與保存檔本身都要留下來。
        context, page, errors = fresh_page(SAVED_PAYLOAD)
        open_bubble(page, args.base_url)
        restored = page.evaluate(READ_CONTROLS)
        assert not errors, f"restoring a saved parameter file raised: {errors}"
        assert not restored["booting"], "a restored boot left the data-bubble-boot mask in place"
        for key, expected in SAVED_VALUES.items():
            assert restored[key] == expected, (
                f"{key} restored as {restored[key]!r}, expected {expected!r}"
            )
        assert restored["laidOutStopRows"] == int(SAVED_VALUES["rampCount"]), (
            "restoring did not lay out the gradient stop rows"
            f" ({restored['laidOutStopRows']} shown)"
        )
        # restore() 把任何失敗都當成「這份檔壞了」，直接把快照從 localStorage 刪掉
        # （見 preset-io.js）。所以「保存檔還在」正是「還原這一趟從頭到尾沒有出事」
        # 最直接的證據：afterApply 只要中途丟例外，使用者的設定就此消失。
        assert restored["snapshot"], (
            "restoring the snapshot failed part-way and the saved parameter file was dropped"
        )

        # 3. 手動匯入：同一份 payload 走 apply() 那條路，同樣不得丟例外。
        set_select(page, "#motion", "static")
        wait_for_shader(page)
        outcome = page.evaluate(
            """payload => {
              try {
                return { ok: true, applied: window.PresetIO.of('prism-drops').apply(payload).applied };
              } catch (error) {
                return { ok: false, message: String(error) };
              }
            }""",
            SAVED_PAYLOAD,
        )
        assert outcome["ok"], f"importing a parameter file threw: {outcome.get('message')}"
        wait_for_shader(page)
        imported = page.evaluate(READ_CONTROLS)
        assert imported["motion"] == "capillary", "import did not switch back to the saved motion"
        assert imported["laidOutStopRows"] == int(SAVED_VALUES["rampCount"]), (
            "importing a parameter file did not lay out the gradient stop rows"
        )
        assert not errors, f"importing a parameter file raised: {errors}"
        context.close()

        # 4. 還原整個炸掉：面板仍然要開得起來，使用者才有機會把設定改回去。
        context, page, errors = fresh_page(SAVED_PAYLOAD, break_restore=True)
        open_bubble(page, args.base_url)
        broken = page.evaluate(READ_CONTROLS)
        assert not broken["booting"], (
            "a failed restore left the data-bubble-boot mask in place"
        )
        assert broken["panelVisible"], "a failed restore left the panel unusable"
        context.close()
        browser.close()

    print("Bubble preset boot, restore, and import paths passed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
