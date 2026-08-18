"""Deterministic browser executor for `browser_task` nodes. Runs a Playwright
script (headed, on the guest :0 desktop so it's visible + human-takeover-able) and
emits the same RunReport JSON the controller transport expects.

Task JSON on stdin (same envelope as cli.py): {"instruction": <steps>, ...} where
<steps> is a JSON array like:
  [{"goto":"https://x"},{"fill":["#user","{{...}}"]},{"click":"#submit"},{"wait":1000},{"screenshot":true}]
(the controller resolves {{secret.x}}/{{param.x}} before sending). A bare URL runs
a single goto.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable

from agent_runner import RunReport


def parse_steps(instruction: str) -> list[dict]:
    """Parse the instruction into a list of step dicts. Pure — unit tested."""
    text = (instruction or "").strip()
    if not text:
        raise ValueError("empty browser task")
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("steps"), list):
            return data["steps"]
    except json.JSONDecodeError:
        pass
    if text.startswith("http://") or text.startswith("https://"):
        return [{"goto": text}]
    raise ValueError("browser_task needs a JSON steps array or a URL")


def save_screenshot(page, path: str, fallback: Callable[[str], None] | None = None) -> None:
    """Save a screenshot, falling back to the visible desktop if Playwright fails."""
    try:
        page.screenshot(path=path)
        return
    except Exception:
        if fallback is not None:
            fallback(path)
            return
        import pyautogui  # lazy: needs a display

        pyautogui.screenshot(path)


def _run(steps: list[dict], run_id: str) -> RunReport:
    from playwright.sync_api import sync_playwright  # lazy: needs playwright+chromium

    art_dir = f"/tmp/cuf-artifacts/{run_id}"
    os.makedirs(art_dir, exist_ok=True)
    saved: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        for i, step in enumerate(steps):
            if "goto" in step:
                page.goto(step["goto"])
            elif "click" in step:
                page.click(step["click"])
            elif "fill" in step:
                sel, val = step["fill"]
                page.fill(sel, val)
            elif "wait" in step:
                w = step["wait"]
                page.wait_for_selector(w) if isinstance(w, str) else page.wait_for_timeout(int(w))
            elif "press" in step:
                page.keyboard.press(step["press"])
            # screenshot after every step regardless
            path = f"{art_dir}/step_{i}.png"
            save_screenshot(page, path)
            saved.append(path)
        browser.close()
    return RunReport("succeeded", "browser_done", len(steps), saved)


def main() -> int:
    raw = json.load(sys.stdin)
    run_id = os.environ.get("CUF_RUN_ID", "adhoc")
    try:
        steps = parse_steps(raw.get("instruction", ""))
        report = _run(steps, run_id)
    except Exception as e:
        import traceback

        traceback.print_exc(file=sys.stderr)
        report = RunReport("failed", f"browser_error: {e!r}", 0)
    print(report.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
