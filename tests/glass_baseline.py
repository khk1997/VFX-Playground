"""Capture a per-mode glass baseline so a shader change can prove what it did not touch.

The玻璃 shader is one program shared by every motion mode; the modes differ only by
the defines that `shader-variants.js` hands the compiler. That makes "did this edit
leak into the other cards?" a question with an exact answer rather than an eyeball
one: freeze the animation clock with `?diagTime=`, render one frame through the same
path the runtime uses, and hash it. A mode whose defines did not change must hash
identically — and when it does not, the sampled channels say by how much.

The PNGs are A/B evidence for a human; the hashes are the pass/fail. Both land
outside the repository by default because WebGL pixels differ across GPUs and
ANGLE backends, so a hash is only comparable against another run on the same
machine with the same `--angle` backend.

    python tests/glass_baseline.py --output /tmp/glass/phase-0
    python tests/glass_baseline.py --output /tmp/glass/phase-1 \
        --reference /tmp/glass/phase-0/report.json --expect-changed static
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright


DEFAULT_URL = "http://127.0.0.1:8642"
DIAG_TIME = "2.5"
VIEWPORT = {"width": 960, "height": 640}

HIDE_UI_STYLE = """
#homeBtn, #toggleBtn, #exportBtn, #playCtl, #panel, #mobileSheet {
    visibility: hidden !important;
}
"""

# (case name, motion mode, backdrop, staticShape or None)
#
# Every mode is captured on both backdrops: the brief for this branch is "static
# only", and a light-backdrop change that silently reached 毛細波 would otherwise
# be invisible until someone opened that card.
CASES: tuple[tuple[str, str, str, str | None], ...] = (
    ("static-builtin-dark", "static", "dark", "0"),
    ("static-builtin-light", "static", "light", "0"),
    ("static-import-dark", "static", "dark", "7"),
    # 圓環：唯一一個表面處處有曲率的內建造型。方體與多數匯入造型是大片平面加
    # 一圈圓角，而平行面的淨偏折是零 —— 色散只可能出現在那一圈圓角上，看起來
    # 就是幾點色斑。要判斷分光本身做得好不好，得有一個曲率連續的表面。
    ("static-torus-dark", "static", "dark", "6"),
    ("static-torus-light", "static", "light", "6"),
    ("static-import-light", "static", "light", "7"),
    ("formation-dark", "formation", "dark", None),
    ("formation-light", "formation", "light", None),
    ("weave-dark", "weave", "dark", None),
    ("weave-light", "weave", "light", None),
    ("shatter-dark", "shatter", "dark", None),
    ("shatter-light", "shatter", "light", None),
    ("melt-dark", "melt", "dark", None),
    ("melt-light", "melt", "light", None),
    ("morph-dark", "morph", "dark", None),
    ("morph-light", "morph", "light", None),
    ("jelly-dark", "jelly", "dark", None),
    ("jelly-light", "jelly", "light", None),
    ("capillary-dark", "capillary", "dark", None),
    ("capillary-light", "capillary", "light", None),
    ("research-dark", "research", "dark", None),
    ("research-light", "research", "light", None),
    ("typewriter-dark", "typewriter", "dark", None),
    ("typewriter-light", "typewriter", "light", None),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--reference",
        type=Path,
        help="A previous report.json to compare against.",
    )
    parser.add_argument(
        "--expect-changed",
        default="",
        help=(
            "Comma separated case-name prefixes allowed to differ from the "
            "reference. Every other case must hash identically."
        ),
    )
    parser.add_argument(
        "--profile",
        type=Path,
        help=(
            "Persistent Chromium profile directory. Reusing one keeps the shader "
            "cache warm, which is the difference between a two minute run and a "
            "twenty minute one on Windows."
        ),
    )
    parser.add_argument(
        "--angle",
        default="vulkan",
        choices=("vulkan", "d3d11", "gl", "default"),
        help=(
            "ANGLE backend. Vulkan compiles this shader roughly seven times "
            "faster than Chrome's D3D11 default (see the repository README); "
            "hashes are only comparable within one backend."
        ),
    )
    parser.add_argument("--only", default="", help="Comma separated case names to run.")
    parser.add_argument("--headed", action="store_true")
    return parser.parse_args()


def wait_for_shader(page: Page) -> None:
    page.wait_for_function(
        """() => {
            if (typeof window.__bubbleDiagReport !== 'function') return false;
            const variant = window.__bubbleDiagReport()['變體'];
            return variant['首編已完成']
                && variant['目前key'] === variant['應該要的key']
                && !variant['進行中編譯']
                && !variant['待補做的切換'];
        }""",
        timeout=180_000,
        polling=250,
    )
    page.wait_for_timeout(300)


def set_select(page: Page, selector: str, value: str) -> None:
    page.eval_on_selector(
        selector,
        """(node, nextValue) => {
            if (node.value === nextValue) return;
            node.value = nextValue;
            node.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        value,
    )


def chroma_metrics(path: Path) -> dict[str, float]:
    """How much colour the frame carries, as max(RGB) - min(RGB) per pixel.

    A hash says a frame changed but not in which direction, and the point of
    this branch is colour appearing on the glass.

    The threshold is 16 rather than something smaller because the light
    backdrop is not perfectly neutral: its lower gradient stop is #c9ccd1,
    whose channels already span exactly 8. At a threshold of 8 the entire
    backdrop counted as coloured, the object was a rounding error beside it,
    and a dispersion change of nearly a factor of two moved the number by
    0.2 percentage points -- a metric that reported almost nothing. Above 16
    only the glass contributes, and the same change moves it by half its value.

    p999Chroma is the strongest colour actually present: rainbow fringes live
    on a thin band of pixels, so a percentile describes them better than a mean
    over a frame that is mostly backdrop.
    """
    image = Image.open(path).convert("RGB")
    chroma = sorted(max(pixel) - min(pixel) for pixel in image.getdata())
    total = len(chroma)
    return {
        "meanChroma": round(sum(chroma) / total, 3),
        "colouredPct": round(sum(1 for c in chroma if c >= 16) / total * 100, 3),
        "p999Chroma": chroma[int(total * 0.999)],
    }


def reach_state(page: Page, base_url: str, mode: str, backdrop: str,
                static_shape: str | None) -> None:
    page.goto(
        f"{base_url}/bubble/index.html?mode={mode}&diagTime={DIAG_TIME}",
        wait_until="domcontentloaded",
    )
    wait_for_shader(page)

    if static_shape is not None:
        set_select(page, "#staticShape", static_shape)
        wait_for_shader(page)
    set_select(page, "#backdrop", backdrop)
    wait_for_shader(page)


def capture_case(page: Page, base_url: str, case, output: Path) -> dict:
    name, mode, backdrop, static_shape = case

    # Reach the state twice and capture only the second visit.
    #
    # A program compiled for the first time does not produce the same pixels as
    # the same program loaded back from Chrome's cache: measured here, the first
    # baseline disagreed with every later run on fourteen of twenty-two cases,
    # by 1-15 per channel and only on the object, never the background. Stashing
    # the shader edit and re-running reproduced the later hashes exactly, so the
    # edit was never involved -- the first sweep was simply the cold one.
    #
    # The second visit always reads a cached program, whatever state the profile
    # started in, which makes a run comparable against any other run. It costs
    # one extra page load per case and no extra compile.
    reach_state(page, base_url, mode, backdrop, static_shape)
    reach_state(page, base_url, mode, backdrop, static_shape)

    # The capture helper cancels the frame loop after reading pixels, so it has to
    # be the last thing that happens on this page load. The next case reloads.
    captured = page.evaluate(
        "key => window.__bubbleDiagRenderAndCapture(key)", name
    )
    # 擷取與自動保存一起清掉。自動保存按模組分格（vfx:prism-drops:<mode>:last），
    # 留著的話，重複使用 --profile 時下一次跑的第一次造訪會先還原上一次的狀態
    # （例如淺底關掉的稜光），整批深底的 hash 都跟著變。
    page.evaluate(
        "() => Object.keys(localStorage)"
        ".filter(k => k.startsWith('vfx:diagpix:') || k.startsWith('vfx:prism-drops:'))"
        ".forEach(k => localStorage.removeItem(k))"
    )
    if "錯誤" in captured:
        raise RuntimeError(f"{name}: capture failed: {captured['錯誤']}")

    page.add_style_tag(content=HIDE_UI_STYLE)
    shot = output / f"{name}.png"
    page.screenshot(path=shot, animations="disabled")

    return {
        "mode": mode,
        "backdrop": backdrop,
        "staticShape": static_shape,
        "hash": captured["hash"],
        "size": captured["尺寸"],
        "simT": captured["simT"],
        "variant": captured["目前變體"],
        **chroma_metrics(shot),
    }


def compare(current: dict, reference_path: Path, expect_changed: list[str]) -> int:
    reference = json.loads(reference_path.read_text(encoding="utf-8"))["cases"]
    unexpected: list[str] = []
    changed_as_planned: list[str] = []
    missing: list[str] = []

    for name, entry in current.items():
        if name not in reference:
            missing.append(name)
            continue
        same = reference[name]["hash"] == entry["hash"]
        allowed = any(name.startswith(prefix) for prefix in expect_changed)
        if same:
            if allowed:
                changed_as_planned.append(f"{name} (allowed to change, did not)")
        elif allowed:
            before = reference[name].get("colouredPct")
            after = entry.get("colouredPct")
            delta = (
                f" 有色像素 {before}% -> {after}%"
                if before is not None and after is not None
                else ""
            )
            changed_as_planned.append(name + delta)
        else:
            unexpected.append(
                f"{name}: {reference[name]['hash']} -> {entry['hash']}"
            )

    print("\n--- 對照 " + str(reference_path) + " ---")
    if changed_as_planned:
        print("預期內的變動：")
        for line in changed_as_planned:
            print("  " + line)
    if missing:
        print("參照裡沒有的 case：" + ", ".join(missing))
    if unexpected:
        print("不該變卻變了：")
        for line in unexpected:
            print("  " + line)
        return 1
    print("其餘 case 全部逐位元相同。")
    return 0


def main() -> int:
    args = parse_args()
    output: Path = args.output
    output.mkdir(parents=True, exist_ok=True)

    only = [name.strip() for name in args.only.split(",") if name.strip()]
    cases = [case for case in CASES if not only or case[0] in only]

    launch_args = []
    if args.angle != "default":
        launch_args.append(f"--use-angle={args.angle}")

    errors: list[str] = []
    results: dict[str, dict] = {}

    with sync_playwright() as playwright:
        if args.profile:
            args.profile.mkdir(parents=True, exist_ok=True)
            context = playwright.chromium.launch_persistent_context(
                str(args.profile),
                headless=not args.headed,
                args=launch_args,
                viewport=VIEWPORT,
                device_scale_factor=1,
            )
            browser = None
        else:
            browser = playwright.chromium.launch(
                headless=not args.headed, args=launch_args
            )
            context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)

        page = context.new_page()
        page.on(
            "pageerror",
            lambda error: errors.append(f"{page.url}: {error}"),
        )

        for case in cases:
            print(f"[glass] {case[0]} ...", flush=True)
            results[case[0]] = capture_case(page, args.base_url, case, output)
            print(f"        hash={results[case[0]]['hash']}", flush=True)

        context.close()
        if browser:
            browser.close()

    report = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "angle": args.angle,
        "viewport": VIEWPORT,
        "diagTime": DIAG_TIME,
        "pageErrors": errors,
        "cases": results,
    }
    (output / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n寫到 {output / 'report.json'}（{len(results)} 個 case）")

    if errors:
        print("頁面錯誤：")
        for line in errors:
            print("  " + line)
        return 1

    if args.reference:
        expect_changed = [
            prefix.strip()
            for prefix in args.expect_changed.split(",")
            if prefix.strip()
        ]
        return compare(results, args.reference, expect_changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
