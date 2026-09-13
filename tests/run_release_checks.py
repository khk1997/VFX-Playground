"""Run the repeatable Bubble checks used before publishing and in CI."""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE_TESTS = sorted((ROOT / "tests").glob("*.mjs"))
BROWSER_TESTS = (
    ("vfx_regression.py", ()),
    ("bubble_adaptive_runtime.py", ("--base-url",)),
    ("bubble_motion_matrix.py", ("--base-url",)),
    ("bubble_inspector_ux.py", ("--base-url",)),
    ("bubble_visual_presets.py", ("--base-url", "--output")),
)


def run(command: list[str], env: dict[str, str] | None = None) -> None:
    print(f"\n$ {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def wait_for_server(port: int, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"preview server exited with status {process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"preview server did not open port {port}")


def ensure_port_available(port: int) -> None:
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", port))
    except OSError as error:
        raise RuntimeError(f"preview port {port} is already in use") from error
    finally:
        probe.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--output", type=Path, default=Path("/tmp/vfx-release-checks"))
    parser.add_argument(
        "--unit-only",
        action="store_true",
        help="run deterministic source checks without starting a WebGL browser",
    )
    args = parser.parse_args()

    for test in NODE_TESTS:
        run(["node", str(test.relative_to(ROOT))])
    run([sys.executable, "-m", "compileall", "-q", "tests"])

    if args.unit_only:
        print("\nAll deterministic Bubble checks passed.")
        return 0

    ensure_port_available(args.port)
    server = subprocess.Popen(
        [sys.executable, "serve.py", str(args.port)],
        cwd=ROOT,
    )
    try:
        wait_for_server(args.port, server)
        base_url = f"http://127.0.0.1:{args.port}"
        common_env = os.environ.copy()
        common_env.update(
            {
                "VFX_BASE_URL": base_url,
                "VFX_ONLY_PAGE": "bubble",
                "VFX_OUTPUT_DIR": str(args.output / "regression"),
            }
        )
        for filename, options in BROWSER_TESTS:
            command = [sys.executable, f"tests/{filename}"]
            if "--base-url" in options:
                command.extend(("--base-url", base_url))
            if "--output" in options:
                command.extend(("--output", str(args.output / "visual-presets")))
            run(command, common_env)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()

    print("\nAll Bubble release checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (subprocess.CalledProcessError, RuntimeError, TimeoutError) as error:
        print(f"Release checks failed: {error}", file=sys.stderr)
        raise SystemExit(1)
