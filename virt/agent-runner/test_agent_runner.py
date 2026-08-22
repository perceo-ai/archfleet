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


# The old model budgeted the whole task on one wall clock, so a single slow
# model round (cold grounding server + planner + grounder) burned the entire
# budget and killed honest work after one step. Stalling is now judged per step.
class TestLongRunningTasks:
    def _clock(self, steps):
        """Clock that advances by a scripted amount per predict() call."""
        t = {"now": 0.0}
        it = iter(steps)

        def tick():
            return t["now"]

        def advance():
            t["now"] += next(it, 0.0)

        return tick, advance

    def test_many_slow_steps_still_finish(self):
        # 10 steps at 5 minutes each = 50 minutes of real work. Under the old
        # 600s wall clock this died on step 3.
        tick, advance = self._clock([300.0] * 12)

        class Slow:
            def __init__(self): self.n = 0
            def predict(self, i, o):
                self.n += 1
                advance()
                if self.n >= 10:
                    return {"done": True}, []
                return {}, [f"pyautogui.click({self.n}, {self.n})"]
            def is_done(self, info): return bool(info.get("done"))
            def reported_stuck(self, info): return bool(info.get("failed"))

        n = {"i": 0}
        def shot():
            n["i"] += 1
            return f"frame-{n['i']}".encode()

        r = run_task(TaskSlice("long task"), Slow(), limits=Limits(),
                     screenshot=shot, clock=tick, execute=lambda a: None)
        assert r.status == "succeeded"
        assert r.steps == 10

    def test_one_wedged_step_is_caught(self):
        tick, advance = self._clock([4000.0])

        class Wedged:
            def predict(self, i, o):
                advance()
                return {}, ["pyautogui.click(1, 1)"]
            def is_done(self, info): return False
            def reported_stuck(self, info): return False

        r = run_task(TaskSlice("wedged"), Wedged(),
                     limits=Limits(step_timeout_s=1800.0),
                     screenshot=lambda: b"f", clock=tick, execute=lambda a: None)
        assert r.status == "timed_out"
        assert "step_timeout" in r.reason

    def test_a_slow_final_step_that_finishes_still_succeeds(self):
        # Work that completes is honoured even if that step ran long — the point
        # is to catch wedging, not to punish slowness.
        tick, advance = self._clock([4000.0])

        class SlowButDone:
            def predict(self, i, o):
                advance()
                return {"done": True, "reason": "finished slowly"}, []
            def is_done(self, info): return bool(info.get("done"))
            def reported_stuck(self, info): return False

        r = run_task(TaskSlice("slow finish"), SlowButDone(),
                     limits=Limits(step_timeout_s=60.0),
                     screenshot=lambda: b"f", clock=tick, execute=lambda a: None)
        assert r.status == "succeeded"

    def test_overall_ceiling_still_applies(self):
        tick, advance = self._clock([100.0] * 50)

        class Forever:
            def __init__(self): self.n = 0
            def predict(self, i, o):
                self.n += 1
                advance()
                return {}, [f"pyautogui.click({self.n}, 0)"]
            def is_done(self, info): return False
            def reported_stuck(self, info): return False

        n = {"i": 0}
        def shot():
            n["i"] += 1
            return f"f{n['i']}".encode()

        r = run_task(TaskSlice("runaway"), Forever(),
                     limits=Limits(timeout_s=500.0, step_timeout_s=1e9),
                     screenshot=shot, clock=tick, execute=lambda a: None)
        assert r.status == "timed_out"
        assert r.reason == "wall_clock_timeout"

    def test_defaults_allow_hours_of_work(self):
        d = Limits()
        assert d.timeout_s >= 14400
        assert d.step_timeout_s >= 900
        assert d.max_steps >= 200
