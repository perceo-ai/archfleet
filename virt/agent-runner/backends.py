"""Concrete AgentBackend implementations.

`AgentSBackend` wraps the vendored/forked Agent S (AgentS3). Its imports are lazy
so this module (and the runner) can be imported on the controller for the
self-test without pyautogui / gui_agents / a display present.

Planner + grounding are configured per the project decision:
  * grounding = self-hosted UI-TARS (OpenAI-compatible endpoint)
  * planner   = a model chosen by the user, routed through OpenRouter
"""

from __future__ import annotations

import os
from dataclasses import dataclass


# Agent S emits these sentinel actions to signal terminal states.
_DONE_TOKENS = ("DONE", "agent.done", "COMPLETE")
_FAIL_TOKENS = ("FAIL", "agent.fail", "GIVE_UP", "CANNOT")


def _matches(actions, tokens) -> bool:
    return any(any(tok in str(a) for tok in tokens) for a in actions)


@dataclass
class AgentSConfig:
    planner_model: str = os.environ.get("CUF_PLANNER_MODEL", "anthropic/claude-sonnet-4-6")
    planner_base_url: str = os.environ.get("CUF_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    planner_api_key: str = os.environ.get("OPENROUTER_API_KEY", "")
    grounding_model: str = os.environ.get("CUF_GROUNDING_MODEL", "ui-tars-1.5-7b")
    grounding_base_url: str = os.environ.get("CUF_GROUNDING_BASE_URL", "http://127.0.0.1:8000/v1")
    grounding_resolution: str = os.environ.get("CUF_GROUNDING_RESOLUTION", "1920x1080")


class AgentSBackend:
    """Adapts AgentS3.predict() to the runner's AgentBackend protocol."""

    def __init__(self, config: AgentSConfig | None = None, platform: str = "linux"):
        self.config = config or AgentSConfig()
        self._agent = self._build_agent(platform)

    def _build_agent(self, platform: str):
        # Lazy import: only needed when actually driving a real display.
        from gui_agents.s3.agents.agent_s import AgentS3  # type: ignore
        from gui_agents.s3.agents.grounding import OSWorldACI  # type: ignore

        engine_params = {
            "engine_type": "openai",
            "model": self.config.planner_model,
            "base_url": self.config.planner_base_url,
            "api_key": self.config.planner_api_key,
        }
        grounding = OSWorldACI(
            platform=platform,
            engine_params_for_generation=engine_params,
            engine_params_for_grounding={
                "engine_type": "openai",
                "model": self.config.grounding_model,
                "base_url": self.config.grounding_base_url,
                "grounding_width": int(self.config.grounding_resolution.split("x")[0]),
                "grounding_height": int(self.config.grounding_resolution.split("x")[1]),
            },
        )
        return AgentS3(engine_params, grounding, platform=platform)

    def predict(self, instruction, observation):
        info, actions = self._agent.predict(instruction=instruction, observation=observation)
        if not isinstance(actions, list):
            actions = [actions]
        info = dict(info or {})
        # Agent S signals terminal states through sentinel actions; fold them into
        # info so the runner's is_done/reported_stuck can stay action-agnostic.
        if not info.get("done") and _matches(actions, _DONE_TOKENS):
            info["done"] = True
        if not info.get("failed") and _matches(actions, _FAIL_TOKENS):
            info["failed"] = True
        return info, actions

    def is_done(self, info):
        return bool(info.get("done"))

    def reported_stuck(self, info):
        return bool(info.get("failed"))
