"""Concrete AgentBackend implementations.

`AgentSBackend` wraps the vendored/forked Agent S (AgentS3). Its imports are lazy
so this module (and the runner) import cleanly on the controller for the self-test
without pyautogui / gui_agents / a display present.

Project config (verified against gui-agents `main`):
  * planner (generation) = a model chosen by the user, routed through OpenRouter,
    consumed as an OpenAI-compatible endpoint (engine_type "openai" + base_url).
  * grounding = self-hosted UI-TARS served OpenAI/HF-compatibly (engine_type
    "huggingface" + base_url), see virt/ui-tars/.
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
    # Planner (main generation model) via OpenRouter.
    planner_model: str = os.environ.get("CUF_PLANNER_MODEL", "anthropic/claude-sonnet-4-6")
    planner_base_url: str = os.environ.get("CUF_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    planner_api_key: str = os.environ.get("OPENROUTER_API_KEY", "")
    # Grounding (UI-TARS) served locally or in a cloud container.
    grounding_model: str = os.environ.get("CUF_GROUNDING_MODEL", "ui-tars-1.5-7b")
    grounding_base_url: str = os.environ.get("CUF_GROUNDING_BASE_URL", "http://127.0.0.1:8080/v1")
    grounding_api_key: str = os.environ.get("CUF_GROUNDING_API_KEY", "EMPTY")
    grounding_width: int = int(os.environ.get("CUF_GROUNDING_WIDTH", "1920"))
    grounding_height: int = int(os.environ.get("CUF_GROUNDING_HEIGHT", "1080"))


def planner_engine_params(config: AgentSConfig) -> dict:
    """OpenAI-compatible generation params (OpenRouter). Pure — unit testable."""
    return {
        "engine_type": "openai",
        "model": config.planner_model,
        "base_url": config.planner_base_url,
        "api_key": config.planner_api_key,
    }


def grounding_engine_params(config: AgentSConfig) -> dict:
    """UI-TARS grounding params. Pure — unit testable."""
    return {
        "engine_type": "huggingface",
        "model": config.grounding_model,
        "base_url": config.grounding_base_url,
        "api_key": config.grounding_api_key,
        "grounding_width": config.grounding_width,
        "grounding_height": config.grounding_height,
    }


class MockBackend:
    """Model-free backend: takes a screenshot, does one harmless action, then
    reports done. Lets the whole pipeline run to a green success without any
    OpenRouter/UI-TARS model — for integration tests + demos. Enable with
    CUF_AGENT_BACKEND=mock."""

    def __init__(self, platform: str = "linux"):
        self.n = 0

    def predict(self, instruction, observation):
        self.n += 1
        if self.n >= 2:
            return {"done": True, "structured_output": {"mock": "ok", "instruction": instruction}}, []
        # A no-op mouse nudge proves action execution works on the display.
        return {}, ["pyautogui.moveTo(50, 50, duration=0.1)"]

    def is_done(self, info):
        return bool(info.get("done"))

    def reported_stuck(self, info):
        return bool(info.get("failed"))


class AgentSBackend:
    """Adapts AgentS3.predict() to the runner's AgentBackend protocol."""

    def __init__(self, config: AgentSConfig | None = None, platform: str = "linux"):
        self.config = config or AgentSConfig()
        self._agent = self._build_agent(platform)

    def _build_agent(self, platform: str):
        # Lazy import: only needed when actually driving a real display.
        from gui_agents.s3.agents.agent_s import AgentS3  # type: ignore
        from gui_agents.s3.agents.grounding import OSWorldACI  # type: ignore

        engine_params = planner_engine_params(self.config)
        grounding = OSWorldACI(
            env=None,  # we execute actions ourselves via pyautogui in the runner
            platform=platform,
            engine_params_for_generation=engine_params,
            engine_params_for_grounding=grounding_engine_params(self.config),
            width=self.config.grounding_width,
            height=self.config.grounding_height,
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
