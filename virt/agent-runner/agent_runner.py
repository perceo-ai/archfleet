"""Bounded computer-use loop wrapping a GUI agent (Agent S / AgentS3).

The controller hands the guest a small *task slice* (a narrow instruction plus
prior-work context). This module runs the agent's screenshot -> predict -> act
loop against the local display, but wraps it with the guarantees Agent S does
not provide on its own:

  * a hard step budget,
  * a wall-clock timeout,
  * a no-progress detector (repeated screen + action),
  * an explicit "the agent reported it is stuck" path,

and always emits a structured report so a node can decide success / retry /
human-takeover. Everything external (screen capture, clock, action execution,
the agent backend) is injected, so the core loop is unit tested with fakes and
never needs a real display.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Callable, Protocol


# --------------------------------------------------------------------------- #
# Task slice + limits
# --------------------------------------------------------------------------- #
@dataclass
class TaskSlice:
    instruction: str
    past_work: str = ""          # summary of prior node outputs / context
    params: dict = field(default_factory=dict)


@dataclass
class Limits:
    max_steps: int = 40
    timeout_s: float = 600.0
    max_no_progress: int = 3     # identical screen+action repeats before bailing


def build_instruction(task: TaskSlice) -> str:
    """Fold past-work context and params into the single instruction string
    Agent S consumes."""
    parts = [task.instruction.strip()]
    if task.past_work.strip():
        parts.append("\nContext from prior steps:\n" + task.past_work.strip())
    if task.params:
        rendered = "\n".join(f"- {k}: {v}" for k, v in task.params.items())
        parts.append("\nParameters:\n" + rendered)
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# Backend contract — implemented by the real AgentS3 wrapper and by test fakes
# --------------------------------------------------------------------------- #
class AgentBackend(Protocol):
    def predict(self, instruction: str, observation: dict) -> tuple[dict, list[str]]:
        """Return (info, actions). `actions` are executable strings.
        `info` may carry {'done': bool, 'failed': bool, 'reason': str,
        'structured_output': Any}."""

    def is_done(self, info: dict) -> bool: ...

    def reported_stuck(self, info: dict) -> bool: ...


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #
ReportStatus = str  # "succeeded" | "failed" | "needs_human" | "timed_out"


@dataclass
class RunReport:
    status: ReportStatus
    reason: str
    steps: int
    artifacts: list[str] = field(default_factory=list)
    structured_output: object = None

    def to_json(self) -> str:
        return json.dumps(asdict(self))


def _digest(screenshot: bytes, actions: list[str]) -> str:
    h = hashlib.sha256()
    h.update(screenshot)
    h.update("\x00".join(actions).encode("utf-8"))
    return h.hexdigest()


# --------------------------------------------------------------------------- #
# Core loop
# --------------------------------------------------------------------------- #
def run_task(
    task: TaskSlice,
    backend: AgentBackend,
    *,
    limits: Limits | None = None,
    screenshot: Callable[[], bytes],
    clock: Callable[[], float],
    execute: Callable[[list[str]], None],
) -> RunReport:
    limits = limits or Limits()
    instruction = build_instruction(task)
    start = clock()
    last_digest: str | None = None
    repeat_count = 0

    for step in range(1, limits.max_steps + 1):
        if clock() - start > limits.timeout_s:
            return RunReport("timed_out", "wall_clock_timeout", step - 1)

        shot = screenshot()
        info, actions = backend.predict(instruction, {"screenshot": shot})

        if backend.is_done(info):
            return RunReport(
                "succeeded",
                info.get("reason", "agent_reported_done"),
                step,
                list(info.get("artifacts", [])),
                info.get("structured_output"),
            )

        if backend.reported_stuck(info):
            # The agent itself says it cannot complete this slice -> hand to human.
            return RunReport(
                "needs_human",
                info.get("reason", "agent_reported_stuck"),
                step,
                list(info.get("artifacts", [])),
            )

        # No-progress detection: same screen + same proposed actions repeatedly.
        digest = _digest(shot, actions)
        if digest == last_digest:
            repeat_count += 1
            if repeat_count >= limits.max_no_progress:
                return RunReport("needs_human", "no_progress", step)
        else:
            repeat_count = 0
            last_digest = digest

        execute(actions)

    return RunReport("needs_human", "step_budget_exhausted", limits.max_steps)
