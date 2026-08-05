"""Unit tests for the bounded computer-use loop. Stdlib unittest only — runs
anywhere (controller or guest) with no third-party deps.

    python3 -m unittest discover -s virt/agent-runner
"""

import unittest

from agent_runner import (
    Limits,
    RunReport,
    TaskSlice,
    build_instruction,
    run_task,
)


class ScriptedBackend:
    """Yields a queued (info, actions) per predict() call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    def predict(self, instruction, observation):
        self.calls += 1
        if self.script:
            return self.script.pop(0)
        return ({}, ["noop()"])

    def is_done(self, info):
        return bool(info.get("done"))

    def reported_stuck(self, info):
        return bool(info.get("failed"))


def fixed_clock(times):
    it = iter(times)
    last = [0.0]

    def clock():
        try:
            last[0] = next(it)
        except StopIteration:
            pass
        return last[0]

    return clock


class BuildInstructionTest(unittest.TestCase):
    def test_folds_past_work_and_params(self):
        out = build_instruction(
            TaskSlice("Log into portal", past_work="Already opened Firefox", params={"url": "x"})
        )
        self.assertIn("Log into portal", out)
        self.assertIn("Already opened Firefox", out)
        self.assertIn("url: x", out)


class RunTaskTest(unittest.TestCase):
    def _run(self, backend, limits=None, shots=None, times=None):
        shot_seq = iter(shots or [b"a", b"b", b"c", b"d", b"e"])
        executed = []
        report = run_task(
            TaskSlice("do it"),
            backend,
            limits=limits or Limits(max_steps=5, timeout_s=100, max_no_progress=3),
            screenshot=lambda: next(shot_seq, b"z"),
            clock=fixed_clock(times or [0, 1, 2, 3, 4, 5]),
            execute=lambda actions: executed.append(actions),
        )
        return report, executed

    def test_succeeds_when_agent_reports_done(self):
        backend = ScriptedBackend([({}, ["click()"]), ({"done": True, "structured_output": {"ok": 1}}, [])])
        report, executed = self._run(backend)
        self.assertEqual(report.status, "succeeded")
        self.assertEqual(report.steps, 2)
        self.assertEqual(report.structured_output, {"ok": 1})
        self.assertEqual(len(executed), 1)  # only the first step's action ran

    def test_needs_human_when_agent_reports_stuck(self):
        backend = ScriptedBackend([({"failed": True, "reason": "captcha"}, [])])
        report, _ = self._run(backend)
        self.assertEqual(report.status, "needs_human")
        self.assertEqual(report.reason, "captcha")

    def test_needs_human_on_no_progress(self):
        # Same screenshot + same action every step -> trips the repeat detector.
        backend = ScriptedBackend([({}, ["click()"]) for _ in range(5)])
        report, _ = self._run(backend, shots=[b"same"] * 6)
        self.assertEqual(report.status, "needs_human")
        self.assertEqual(report.reason, "no_progress")

    def test_needs_human_on_step_budget(self):
        backend = ScriptedBackend([({}, [f"click{i}()"]) for i in range(10)])
        report, _ = self._run(
            backend,
            limits=Limits(max_steps=3, timeout_s=100, max_no_progress=99),
            shots=[b"1", b"2", b"3", b"4"],
        )
        self.assertEqual(report.status, "needs_human")
        self.assertEqual(report.reason, "step_budget_exhausted")
        self.assertEqual(report.steps, 3)

    def test_timed_out(self):
        backend = ScriptedBackend([({}, ["click()"]) for _ in range(5)])
        report, _ = self._run(
            backend,
            limits=Limits(max_steps=5, timeout_s=2, max_no_progress=99),
            times=[0, 5, 5, 5],  # second clock check exceeds timeout
        )
        self.assertEqual(report.status, "timed_out")

    def test_report_json_roundtrip(self):
        import json

        r = RunReport("succeeded", "done", 2, ["a.png"], {"k": "v"})
        parsed = json.loads(r.to_json())
        self.assertEqual(parsed["status"], "succeeded")
        self.assertEqual(parsed["artifacts"], ["a.png"])


if __name__ == "__main__":
    unittest.main()
