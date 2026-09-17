"""Diagnose every home-card live preview, including load time and frame motion."""

from __future__ import annotations

import argparse
import io
import json

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright


def changed_ratio(before: bytes, after: bytes) -> float:
    image_a = Image.open(io.BytesIO(before)).convert("RGB")
    image_b = Image.open(io.BytesIO(after)).convert("RGB")
    difference = ImageChops.difference(image_a, image_b)
    changed = sum(1 for pixel in difference.getdata() if max(pixel) > 3)
    return changed / (image_a.width * image_a.height)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--only", type=int, help="one-based card index")
    args = parser.parse_args()

    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.goto(f"{args.base_url}/index.html", wait_until="networkidle", timeout=45_000)

        cards = page.locator("#cards .card")
        indices = range(cards.count()) if args.only is None else [args.only - 1]
        for index in indices:
            card = cards.nth(index)
            title = card.locator(".card-title").inner_text()
            page.evaluate("card => card.scrollIntoView({ block: 'center' })", card.element_handle())
            card.hover()
            started = page.evaluate("performance.now()")
            ready = True
            try:
                card.locator("iframe.is-ready").wait_for(state="attached", timeout=20_000)
            except Exception:
                ready = False
            elapsed = round(page.evaluate("performance.now()") - started)

            ratio = 0.0
            perf = None
            pending = None
            if ready:
                page.wait_for_timeout(350)
                child_frames = [frame for frame in page.frames if frame != page.main_frame]
                stage = child_frames[-1].locator("#stage") if child_frames else None
                target = stage if stage and stage.count() else card.locator(".card-preview")
                before = target.screenshot(animations="allow")
                page.wait_for_timeout(850)
                after = target.screenshot(animations="allow")
                ratio = changed_ratio(before, after)
                if child_frames:
                    perf = child_frames[-1].evaluate("""() => ({
                      scheduler: window.__vfxPreviewPerf ? {
                        paused: window.__vfxPreviewPerf.paused,
                        fps: window.__vfxPreviewPerf.fps,
                        dpr: window.__vfxPreviewPerf.dpr,
                        hidden: document.hidden,
                      } : null,
                      energy: window.__energyRingDiag?.() ?? null,
                      bubble: window.__bubblePreviewDiag?.() ?? null,
                    })""")
            else:
                child_frames = [frame for frame in page.frames if frame != page.main_frame]
                if child_frames:
                    pending = child_frames[-1].evaluate("""() => ({
                      href: location.href,
                      stageReady: document.body?.dataset.stageReady ?? null,
                      stagePresented: document.body?.dataset.stagePresented ?? null,
                      bubble: window.__bubblePreviewDiag?.() ?? null,
                    })""")

            results.append({
                "index": index + 1,
                "title": title,
                "ready": ready,
                "readyMs": elapsed,
                "changedRatio": round(ratio, 6),
                "previewPerf": perf,
                "pending": pending,
            })
            page.mouse.move(1, 1)
            page.wait_for_timeout(120)

        context.close()
        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
