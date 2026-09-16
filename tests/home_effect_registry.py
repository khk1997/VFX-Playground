"""首頁效果 registry：卡片、?mode= 初始化與預覽嵌入的來回。

液態玻璃那一族的每個動態模式都是首頁上的一張獨立卡片，但它們共用同一份頁面，
只差 ?mode= 參數。這支盯住三件事：卡片資料真的來自 registry（不是手寫的）、
指定模式在開機遮罩撤掉之前就已經就位（不會先畫一次預設模式再跳），以及
?preview=1 仍然把 UI 藏起來。
"""

from __future__ import annotations

import argparse
import sys

from playwright.sync_api import Page, sync_playwright

from bubble_baseline import set_select, wait_for_shader


# 每一幀記一次「這一刻是哪個模式」。開機遮罩撤掉之前畫布是蓋住的，所以只要遮罩
# 撤掉那一刻已經是目標模式，使用者就不可能看到別的模式先畫一幀。
WATCH_BOOT = """
window.__bootTrail = [];
window.__revealMotion = null;
(function poll() {
  const booting = !document.body || document.body.hasAttribute('data-bubble-boot');
  let motion = null;
  try { motion = window.__bubbleDiagReport && window.__bubbleDiagReport().模式.motion; } catch (_) {}
  if (motion) {
    if (booting) {
      if (window.__bootTrail[window.__bootTrail.length - 1] !== motion) window.__bootTrail.push(motion);
    } else if (window.__revealMotion === null) {
      window.__revealMotion = motion;
      return;
    }
  }
  requestAnimationFrame(poll);
})();
"""

READ_CARDS = """() => {
  const cards = [...document.querySelectorAll('#cards .card')].filter(c => !c.hasAttribute('aria-hidden'));
  return cards.map(c => ({
    href: c.getAttribute('href'),
    title: c.querySelector('.card-title')?.textContent,
  }));
}"""

READ_REGISTRY = """async () => {
  const { EFFECTS } = await import('./effects.js?v=home-registry-1');
  return EFFECTS.map(fx => ({
    id: fx.id ?? null, title: fx.title, href: fx.href,
    previewSrc: fx.previewSrc, runtime: fx.runtime ?? null,
  }));
}"""


def open_home(page: Page, base_url: str) -> None:
    response = page.goto(f"{base_url}/index.html", wait_until="networkidle", timeout=45_000)
    assert response and response.ok, "home page did not load"
    page.wait_for_timeout(1500)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        # 1. 卡片資料來自 registry，而且每張卡片的連結與預覽指向同一個模式。
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        open_home(page, args.base_url)
        cards = page.evaluate(READ_CARDS)
        registry = page.evaluate(READ_REGISTRY)
        assert not errors, f"the home page raised: {errors}"
        assert len(cards) == len(registry), (
            f"{len(cards)} cards rendered from a registry of {len(registry)}"
        )
        by_href = {entry["href"]: entry for entry in registry}
        modes = []
        for card in cards:
            entry = by_href.get(card["href"])
            assert entry, f"card {card['href']!r} is not in the registry"
            assert card["title"] == entry["title"], (
                f"card title {card['title']!r} drifted from the registry's {entry['title']!r}"
            )
            if "mode=" not in card["href"]:
                continue
            mode = card["href"].split("mode=")[1]
            modes.append(mode)
            assert entry["previewSrc"] == f"bubble/index.html?mode={mode}&preview=1", (
                f"{mode}: the card preview does not open the same mode as the card"
            )
            assert entry["runtime"], f"{mode} has no runtime module registered"
        assert len(modes) == 10, f"expected ten liquid-glass modes, got {modes}"
        # 已移除的模式不該在首頁留下任何痕跡。
        assert not page.evaluate("() => document.body.innerHTML.includes('split')"), (
            "the removed split motion is still referenced on the home page"
        )
        context.close()

        # 2. 每個模式的 ?mode= 都要在遮罩撤掉之前就位。
        for mode in modes:
            context = browser.new_context(viewport={"width": 960, "height": 640})
            context.add_init_script(WATCH_BOOT)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error, m=mode: errors.append(f"{m}: {error}"))
            response = page.goto(
                f"{args.base_url}/bubble/index.html?mode={mode}&diag=baseline",
                wait_until="networkidle", timeout=60_000,
            )
            assert response and response.ok
            wait_for_shader(page)
            state = page.evaluate("""() => ({
              motion: window.__bubbleDiagReport().模式.motion,
              select: document.getElementById('motion').value,
              booting: document.body.hasAttribute('data-bubble-boot'),
              bootTrail: window.__bootTrail,
              revealMotion: window.__revealMotion,
            })""")
            assert not errors, errors
            assert state["motion"] == mode == state["select"], (
                f"?mode={mode} booted as {state['motion']!r} / {state['select']!r}"
            )
            assert not state["booting"], f"?mode={mode} left the boot mask in place"
            stray = [m for m in state["bootTrail"] if m != mode]
            assert not stray, f"?mode={mode} ran as {stray} before settling"
            assert state["revealMotion"] in (mode, None), (
                f"?mode={mode} revealed the canvas while showing {state['revealMotion']!r}"
            )
            context.close()

        # 3. 預覽嵌入：模式照樣套用，UI 照樣藏起來。
        context = browser.new_context(viewport={"width": 660, "height": 570})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{args.base_url}/bubble/index.html?mode=jelly&preview=1&diag=baseline",
                  wait_until="networkidle", timeout=60_000)
        # 預覽巢狀在首頁卡片裡，預設停在暫停狀態等宿主喊開始（見 home.js）。
        page.evaluate("() => window.postMessage('vfx-play', '*')")
        wait_for_shader(page)
        preview = page.evaluate("""() => ({
          motion: window.__bubbleDiagReport().模式.motion,
          preview: window.__bubbleDiagReport().模式.preview,
          previewClass: document.documentElement.classList.contains('preview-mode'),
          panelShown: (() => { const n = document.querySelector('#panel');
            return !!n && getComputedStyle(n).display !== 'none'; })(),
          homeShown: (() => { const n = document.querySelector('#homeBtn');
            return !!n && getComputedStyle(n).display !== 'none'; })(),
        })""")
        assert not errors, errors
        assert preview["motion"] == "jelly", "the preview ignored ?mode="
        assert preview["preview"] and preview["previewClass"], "?preview=1 did not take effect"
        assert not preview["panelShown"] and not preview["homeShown"], (
            "?preview=1 left the UI visible"
        )
        context.close()

        # 4. 認不得的模式當作沒帶；液態玻璃頁原本的下拉切換也還在。
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{args.base_url}/bubble/index.html?mode=no-such-mode&diag=baseline",
                  wait_until="networkidle", timeout=60_000)
        wait_for_shader(page)
        assert page.evaluate("() => document.getElementById('motion').value") == "static", (
            "an unknown ?mode= must fall back to the default motion"
        )
        page.goto(f"{args.base_url}/bubble/index.html?mode=jelly&diag=baseline",
                  wait_until="networkidle", timeout=60_000)
        wait_for_shader(page)
        set_select(page, "#motion", "melt")
        wait_for_shader(page)
        assert page.evaluate("() => document.getElementById('motion').value") == "melt", (
            "the liquid-glass page can no longer switch motions from its own menu"
        )
        # 網址要跟著模式走，否則重新整理會跳回卡片帶進來的那個模式。
        assert "mode=melt" in page.url, (
            f"switching motions left the url at {page.url!r}"
        )
        page.reload(wait_until="networkidle", timeout=60_000)
        wait_for_shader(page)
        assert page.evaluate("() => document.getElementById('motion').value") == "melt", (
            "reloading after a motion switch did not stay on the switched motion"
        )
        # 乾淨的網址一開始就等於畫面（預設模式），不該被動到。
        page.goto(f"{args.base_url}/bubble/index.html?diag=baseline",
                  wait_until="networkidle", timeout=60_000)
        wait_for_shader(page)
        assert "mode=" not in page.url, (
            f"a default-motion visit rewrote its own url to {page.url!r}"
        )
        menu = page.evaluate(
            "() => [...document.querySelectorAll('#motion option')].map(n => n.value)")
        assert "split" not in menu and "cinematic" not in menu, (
            f"the removed split motion is still in the menu: {menu}"
        )
        assert not errors, errors
        context.close()
        browser.close()

    print(f"Home effect registry, ?mode= boot, and preview embedding passed ({len(modes)} modes)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
