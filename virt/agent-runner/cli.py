"""Guest entrypoint for the computer-use runner.

Modes:
  --selftest        Run the bounded loop with a fake backend + fake display.
                    No pyautogui / gui_agents / display needed. Prints a report.
                    Used as a portable smoke test (controller or guest).
  (default)         Read a task slice as JSON from --task-file or stdin, drive the
                    real local display via pyautogui + AgentSBackend, print the
                    JSON report to stdout.

Report JSON on stdout is the runner's contract with the controller transport.
Task JSON: {"instruction": str, "past_work"?: str, "params"?: {}, "limits"?: {}}
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from agent_runner import Limits, TaskSlice, run_task


def _parse_task(raw: dict) -> tuple[TaskSlice, Limits]:
    task = TaskSlice(
        instruction=raw["instruction"],
        past_work=raw.get("past_work", ""),
        params=raw.get("params", {}),
    )
    lim = raw.get("limits", {})
    limits = Limits(
        max_steps=lim.get("max_steps", 40),
        timeout_s=lim.get("timeout_s", 600.0),
        max_no_progress=lim.get("max_no_progress", 3),
    )
    return task, limits


def _run_real(task: TaskSlice, limits: Limits) -> "RunReport":  # noqa: F821
    import pyautogui  # lazy: needs a display
    from backends import AgentSBackend

    def screenshot() -> bytes:
        import io

        buf = io.BytesIO()
        pyautogui.screenshot().save(buf, format="PNG")
        return buf.getvalue()

    def execute(actions):
        for action in actions:
            exec(action, {"pyautogui": pyautogui})  # noqa: S102 — Agent S action code

    return run_task(
        task,
        AgentSBackend(),
        limits=limits,
        screenshot=screenshot,
        clock=time.time,
        execute=execute,
    )


def _run_selftest() -> "RunReport":  # noqa: F821
    """Fake backend that clicks once then reports done — proves the loop end to
    end with no display or model."""

    class FakeBackend:
        def __init__(self):
            self.n = 0

        def predict(self, instruction, observation):
            self.n += 1
            if self.n >= 2:
                return {"done": True, "structured_output": {"selftest": "ok"}}, []
            return {}, ["click(10, 10)"]

        def is_done(self, info):
            return bool(info.get("done"))

        def reported_stuck(self, info):
            return bool(info.get("failed"))

    shots = iter([b"frame-1", b"frame-2", b"frame-3"])
    return run_task(
        TaskSlice("self-test", past_work="none"),
        FakeBackend(),
        limits=Limits(max_steps=5, timeout_s=10, max_no_progress=3),
        screenshot=lambda: next(shots, b"end"),
        clock=time.time,
        execute=lambda actions: None,
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="agent-runner")
    parser.add_argument("--selftest", action="store_true", help="run a no-display smoke test")
    parser.add_argument("--task-file", help="path to task JSON (default: stdin)")
    args = parser.parse_args(argv)

    if args.selftest:
        report = _run_selftest()
        print(report.to_json())
        return 0 if report.status == "succeeded" else 1

    raw = json.load(open(args.task_file)) if args.task_file else json.load(sys.stdin)
    task, limits = _parse_task(raw)
    report = _run_real(task, limits)
    print(report.to_json())
    # needs_human / timed_out are not process failures — the controller decides.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
