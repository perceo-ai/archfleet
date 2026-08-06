"""Deterministic desktop executor for `script_task` nodes — computer use WITHOUT
an LLM. Runs a fixed list of pyautogui actions on the guest :0 desktop and emits
the same RunReport JSON the controller transport expects.

Task JSON on stdin: {"instruction": <actions>, ...} where <actions> is a JSON
array, e.g.:
  [{"click":[100,200]},{"type":"hello"},{"key":"enter"},{"hotkey":["ctrl","s"]},
   {"move":[10,10]},{"scroll":-300},{"wait":500},{"screenshot":true}]
Values may contain {{secret.x}}/{{param.x}} — the controller resolves them first.
"""

from __future__ import annotations

import json
import os
import sys

from agent_runner import RunReport

VALID = {"click", "doubleclick", "rightclick", "move", "type", "text", "key", "press", "hotkey", "scroll", "wait", "screenshot"}


def parse_actions(instruction: str) -> list[dict]:
    """Parse instruction into an action list. Pure — unit tested. Validates keys."""
    text = (instruction or "").strip()
    if not text:
        raise ValueError("empty script task")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"script_task needs a JSON actions array: {e}")
    steps = data.get("actions") if isinstance(data, dict) else data
    if not isinstance(steps, list):
        raise ValueError("script_task actions must be a JSON array")
    for s in steps:
        if not isinstance(s, dict) or not (set(s.keys()) & VALID):
            raise ValueError(f"unknown action: {s}")
    return steps


def _run(actions: list[dict], run_id: str) -> RunReport:
    import pyautogui  # lazy: needs a display

    art_dir = f"/tmp/cuf-artifacts/{run_id}"
    os.makedirs(art_dir, exist_ok=True)
    saved: list[str] = []
    for i, a in enumerate(actions):
        if "click" in a:
            pyautogui.click(a["click"][0], a["click"][1])
        elif "doubleclick" in a:
            pyautogui.doubleClick(a["doubleclick"][0], a["doubleclick"][1])
        elif "rightclick" in a:
            pyautogui.rightClick(a["rightclick"][0], a["rightclick"][1])
        elif "move" in a:
            pyautogui.moveTo(a["move"][0], a["move"][1], duration=0.1)
        elif "type" in a or "text" in a:
            pyautogui.typewrite(a.get("type", a.get("text")), interval=0.02)
        elif "key" in a or "press" in a:
            pyautogui.press(a.get("key", a.get("press")))
        elif "hotkey" in a:
            pyautogui.hotkey(*a["hotkey"])
        elif "scroll" in a:
            pyautogui.scroll(int(a["scroll"]))
        elif "wait" in a:
            pyautogui.sleep(int(a["wait"]) / 1000.0)
        # screenshot after each action
        path = f"{art_dir}/step_{i}.png"
        pyautogui.screenshot(path)
        saved.append(path)
    return RunReport("succeeded", "script_done", len(actions), saved)


def main() -> int:
    raw = json.load(sys.stdin)
    run_id = os.environ.get("CUF_RUN_ID", "adhoc")
    try:
        actions = parse_actions(raw.get("instruction", ""))
        report = _run(actions, run_id)
    except Exception as e:
        import traceback

        traceback.print_exc(file=sys.stderr)
        report = RunReport("failed", f"script_error: {e!r}", 0)
    print(report.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
