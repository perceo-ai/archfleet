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

from agent_runner import Limits, RunReport, TaskSlice, run_task


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
    import os
    import pyautogui  # lazy: needs a display
    from backends import AgentSBackend, MockBackend

    # Model-free demo/integration mode: exercises the full loop without models.
    backend = MockBackend() if os.environ.get("CUF_AGENT_BACKEND") == "mock" else AgentSBackend()

    # Save each step's screenshot so the controller can scp them back as artifacts.
    run_id = os.environ.get("CUF_RUN_ID", "adhoc")
    art_dir = f"/tmp/cuf-artifacts/{run_id}"  # user-writable regardless of /opt perms
    os.makedirs(art_dir, exist_ok=True)
    saved: list[str] = []

    def screenshot() -> bytes:
        import io

        img = pyautogui.screenshot()
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        path = f"{art_dir}/step_{len(saved)}.png"
        try:
            img.save(path)
            saved.append(path)
        except Exception:
            pass
        return buf.getvalue()

    def execute(actions):
        for action in actions:
            try:
                exec(action, {"pyautogui": pyautogui})  # noqa: S102 — Agent S action code
            except Exception as e:  # a bad action must not crash the whole run
                sys.stderr.write(f"[runner] action failed: {e!r}\n")

    report = run_task(
        task,
        backend,
        limits=limits,
        screenshot=screenshot,
        clock=time.time,
        execute=execute,
    )
    # Surface saved screenshots as artifacts (deduped with any the backend added).
    for path in saved:
        if path not in report.artifacts:
            report.artifacts.append(path)
    return report


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
    try:
        report = _run_real(task, limits)
    except Exception as e:
        # Always emit a valid report so the controller gets a structured result
        # instead of a transport parse error.
        import traceback

        traceback.print_exc(file=sys.stderr)
        report = RunReport("failed", f"runner_exception: {e!r}", 0)
    print(report.to_json())
    # needs_human / timed_out are not process failures — the controller decides.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
