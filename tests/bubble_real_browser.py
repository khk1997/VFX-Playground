"""Run Bubble acceptance checks in installed Chrome and system Safari.

Unlike the deterministic baseline, this runner opens the browsers installed on
the Mac. Its report is intended for hardware/GPU acceptance before a release.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, sync_playwright

from bubble_baseline import compact_diag, image_metrics, sample_fps, set_select, wait_for_shader


CASES = (("installing-dark", "dark"), ("installing-light", "light"))
STAGE_CAPTURE_STYLE = """
#homeBtn, #toggleBtn, #exportBtn, #playCtl, #panel {
  visibility: hidden !important;
}
"""
READY_SCRIPT = """
const report = typeof window.__bubbleDiagReport === 'function'
  ? window.__bubbleDiagReport() : null;
const variant = report && report['變體'];
return Boolean(variant && variant['首編已完成']
  && variant['目前key'] === variant['應該要的key']
  && !variant['進行中編譯'] && !variant['待補做的切換']);
"""


def browser_facts(report: dict[str, Any]) -> dict[str, Any]:
    gl = report["gl環境"]
    renderer = str(gl.get("UNMASKED_RENDERER_WEBGL", ""))
    software = any(word in renderer.lower() for word in ("swiftshader", "software", "llvmpipe"))
    return {
        "userAgent": report.get("瀏覽器", {}).get("userAgent"),
        "webgl": gl.get("webgl版本"),
        "renderer": renderer,
        "hardwareAccelerated": not software,
    }


def ui_state(script, webdriver: bool = False) -> dict[str, Any]:
    expression = """(() => {
  const panel = document.querySelector('#panel');
  const status = document.querySelector('#renderQualityStatus');
  return {
    viewport: { width: innerWidth, height: innerHeight },
    panelOverflowX: panel.scrollWidth - panel.clientWidth,
    qualityStatus: status ? status.textContent.trim() : null,
    qualityStatusVisible: Boolean(status && status.getBoundingClientRect().width),
    canvasCursor: getComputedStyle(document.querySelector('#stage')).cursor,
  };
})()"""
    return script(f"return {expression};" if webdriver else expression)


def run_playwright_browser(
    browser_name: str,
    browser_type_name: str,
    base_url: str,
    output: Path,
    headless: bool,
) -> dict[str, Any]:
    with sync_playwright() as playwright:
        browser_type = getattr(playwright, browser_type_name)
        launch_options: dict[str, Any] = {"headless": headless}
        if browser_type_name == "chromium":
            launch_options.update(channel="chrome", args=["--disable-background-timer-throttling"])
        browser = browser_type.launch(**launch_options)
        profiles = []
        for name, viewport, mobile in (
            ("desktop", {"width": 960, "height": 640}, False),
            ("mobile-emulation", {"width": 390, "height": 844}, True),
        ):
            context = browser.new_context(
                viewport=viewport,
                device_scale_factor=1,
                is_mobile=mobile,
                has_touch=mobile,
            )
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            response = page.goto(
                f"{base_url}/bubble/index.html?diag=real-browser&diagTime=2.4",
                wait_until="networkidle",
                timeout=45_000,
            )
            assert response and response.ok, f"{browser_name} failed to load Bubble"
            wait_for_shader(page)
            case_results = []
            profile_dir = output / browser_type_name / name
            profile_dir.mkdir(parents=True, exist_ok=True)
            for case_name, backdrop in CASES:
                set_select(page, "#motion", "research")
                set_select(page, "#backdrop", backdrop)
                wait_for_shader(page)
                performance = sample_fps(page, 1800)
                raw = page.evaluate("window.__bubbleDiagReport()")
                stage_path = profile_dir / f"{case_name}-stage.png"
                ui_path = profile_dir / f"{case_name}-ui.png"
                # macOS headful Chrome's page screenshot path can omit the
                # hardware WebGL layer. The stage fills the viewport, and its
                # locator capture includes fixed controls painted above it.
                page.locator("#stage").screenshot(path=str(ui_path))
                page.locator("#stage").screenshot(path=str(stage_path), style=STAGE_CAPTURE_STYLE)
                case_results.append({
                    "name": case_name,
                    "performance": performance,
                    "diagnostics": compact_diag(raw),
                    "ui": ui_state(page.evaluate),
                    "screenshots": {
                        "stage": image_metrics(stage_path),
                        "ui": image_metrics(ui_path),
                    },
                })
            facts = browser_facts(page.evaluate("window.__bubbleDiagReport()"))
            assert not errors, f"{browser_name} {name} page errors: {errors}"
            assert all(case["ui"]["panelOverflowX"] <= 1 for case in case_results)
            profiles.append({"name": name, "facts": facts, "cases": case_results, "errors": errors})
            context.close()
        browser.close()
    return {"browser": browser_name, "profiles": profiles}


class SafariWebDriver:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")
        self.session_id: str | None = None

    def request(self, method: str, path: str, payload: dict | None = None) -> Any:
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            self.endpoint + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        try:
            with urllib.request.urlopen(request, timeout=95) as response:
                value = json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"Safari WebDriver {method} {path}: {error.code} {detail}") from error
        if isinstance(value, dict) and isinstance(value.get("value"), dict) and value["value"].get("error"):
            raise RuntimeError(f"Safari WebDriver: {value['value']}")
        return value.get("value") if isinstance(value, dict) else value

    def start(self) -> None:
        value = self.request("POST", "/session", {
            "capabilities": {"alwaysMatch": {"browserName": "safari"}},
        })
        self.session_id = value.get("sessionId") if isinstance(value, dict) else None
        if not self.session_id:
            raise RuntimeError(f"Safari WebDriver did not return a session: {value}")
        self.request("POST", self.path("/timeouts"), {"script": 30_000, "pageLoad": 45_000})

    def path(self, suffix: str) -> str:
        assert self.session_id
        return f"/session/{self.session_id}{suffix}"

    def execute(self, script: str, args: list | None = None) -> Any:
        return self.request("POST", self.path("/execute/sync"), {"script": script, "args": args or []})

    def execute_async(self, script: str, args: list | None = None) -> Any:
        return self.request("POST", self.path("/execute/async"), {"script": script, "args": args or []})

    def close(self) -> None:
        if self.session_id:
            try:
                self.request("DELETE", self.path(""))
            finally:
                self.session_id = None


def wait_for_safari_shader(driver: SafariWebDriver) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if driver.execute(READY_SCRIPT):
            time.sleep(0.25)
            return
        time.sleep(0.25)
    raise TimeoutError("Safari shader did not become ready")


def safari_fps(driver: SafariWebDriver, duration: int = 1800) -> dict[str, float]:
    return driver.execute_async("""
const duration = arguments[0], done = arguments[arguments.length - 1];
const samples = [], started = performance.now(); let previous = started;
function frame(now) {
  samples.push(now - previous); previous = now;
  if (now - started >= duration) {
    const elapsed = now - started;
    const sorted = samples.slice(1).sort((a,b) => a-b);
    const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
    done({frames: Math.max(0, samples.length - 1), durationMs: elapsed,
      fps: samples.length > 1 ? (samples.length - 1) * 1000 / elapsed : 0,
      medianFrameMs: pick(.5), p95FrameMs: pick(.95)});
    return;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
""", [duration])


def safari_screenshot(driver: SafariWebDriver, path: Path, clean_stage: bool = False) -> None:
    if clean_stage:
        driver.execute("""
const style = document.createElement('style'); style.id = '__acceptanceCapture';
style.textContent = arguments[0]; document.head.append(style); return true;
""", [STAGE_CAPTURE_STYLE])
    encoded = driver.request("GET", driver.path("/screenshot"))
    path.write_bytes(base64.b64decode(encoded))
    if clean_stage:
        driver.execute("document.querySelector('#__acceptanceCapture')?.remove(); return true;")


def run_safari(base_url: str, endpoint: str, output: Path) -> dict[str, Any]:
    driver = SafariWebDriver(endpoint)
    driver.start()
    try:
        driver.request("POST", driver.path("/window/rect"), {"width": 960, "height": 720, "x": 20, "y": 40})
        driver.request("POST", driver.path("/url"), {
            "url": f"{base_url}/bubble/index.html?diag=real-browser&diagTime=2.4",
        })
        wait_for_safari_shader(driver)
        driver.execute("""
window.__acceptanceErrors = [];
addEventListener('error', e => window.__acceptanceErrors.push(e.message));
return true;
""")
        result_dir = output / "safari" / "desktop"
        result_dir.mkdir(parents=True, exist_ok=True)
        cases = []
        for case_name, backdrop in CASES:
            driver.execute("""
for (const [selector, value] of arguments[0]) {
  const node = document.querySelector(selector); node.value = value;
  node.dispatchEvent(new Event('change', {bubbles:true}));
}
return true;
""", [[['#motion', 'research'], ['#backdrop', backdrop]]])
            wait_for_safari_shader(driver)
            performance = safari_fps(driver)
            raw = driver.execute("return window.__bubbleDiagReport();")
            stage_path = result_dir / f"{case_name}-stage.png"
            ui_path = result_dir / f"{case_name}-ui.png"
            safari_screenshot(driver, ui_path)
            safari_screenshot(driver, stage_path, clean_stage=True)
            cases.append({
                "name": case_name,
                "performance": performance,
                "diagnostics": compact_diag(raw),
                "ui": ui_state(driver.execute, webdriver=True),
                "screenshots": {
                    "stage": image_metrics(stage_path),
                    "ui": image_metrics(ui_path),
                },
            })
        final_report = driver.execute("return window.__bubbleDiagReport();")
        errors = driver.execute("return window.__acceptanceErrors || [];")
        assert not errors, f"Safari page errors: {errors}"
        assert all(case["ui"]["panelOverflowX"] <= 1 for case in cases)
        return {
            "browser": "Safari",
            "profiles": [{"name": "desktop", "facts": browser_facts(final_report), "cases": cases, "errors": errors}],
        }
    finally:
        driver.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--safari-endpoint", default="http://127.0.0.1:4444")
    parser.add_argument("--output", type=Path, default=Path("/tmp/vfx-bubble-real-browser"))
    parser.add_argument("--headless-chrome", action="store_true")
    parser.add_argument("--require-hardware", action="store_true")
    parser.add_argument("--browser", choices=("all", "chrome", "webkit", "safari"), default="all")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    if args.browser in ("all", "chrome"):
        results.append(run_playwright_browser(
            "Google Chrome", "chromium", args.base_url, args.output, args.headless_chrome,
        ))
    if args.browser == "webkit":
        results.append(run_playwright_browser(
            "Playwright WebKit", "webkit", args.base_url, args.output, True,
        ))
    if args.browser in ("all", "safari"):
        results.append(run_safari(args.base_url, args.safari_endpoint, args.output))
    if args.require_hardware:
        software = [
            f"{browser['browser']}/{profile['name']}"
            for browser in results for profile in browser["profiles"]
            if not profile["facts"]["hardwareAccelerated"]
        ]
        assert not software, f"software rendering detected: {software}"
    report = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for browser in results:
        for profile in browser["profiles"]:
            median = sorted(case["performance"]["fps"] for case in profile["cases"])[len(profile["cases"]) // 2]
            print(f"{browser['browser']} {profile['name']}: {median:.1f} FPS, {profile['facts']['renderer']}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, RuntimeError, TimeoutError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
