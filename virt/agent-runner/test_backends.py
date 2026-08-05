"""Tests for AgentS backend config wiring. The pure param-builders are tested
without gui_agents; real AgentS3 construction is gated on the package being
importable (skipped otherwise). Stdlib unittest only.

    python3 -m unittest discover -s virt/agent-runner
"""

import importlib.util
import unittest

from backends import (
    AgentSConfig,
    grounding_engine_params,
    planner_engine_params,
)

_HAS_GUI_AGENTS = importlib.util.find_spec("gui_agents") is not None


class ParamBuilderTest(unittest.TestCase):
    def test_planner_uses_openrouter_openai_compatible(self):
        cfg = AgentSConfig(
            planner_model="anthropic/claude-opus-4-8",
            planner_base_url="https://openrouter.ai/api/v1",
            planner_api_key="sk-or-x",
        )
        params = planner_engine_params(cfg)
        self.assertEqual(params["engine_type"], "openai")
        self.assertEqual(params["model"], "anthropic/claude-opus-4-8")
        self.assertEqual(params["base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(params["api_key"], "sk-or-x")

    def test_grounding_uses_uitars_with_resolution(self):
        cfg = AgentSConfig(
            grounding_model="ui-tars-1.5-7b",
            grounding_base_url="http://gpu-host:8080/v1",
            grounding_width=1920,
            grounding_height=1080,
        )
        params = grounding_engine_params(cfg)
        self.assertEqual(params["engine_type"], "huggingface")
        self.assertEqual(params["base_url"], "http://gpu-host:8080/v1")
        self.assertEqual(params["grounding_width"], 1920)
        self.assertEqual(params["grounding_height"], 1080)


@unittest.skipUnless(_HAS_GUI_AGENTS, "gui_agents not installed")
class AgentSConstructionTest(unittest.TestCase):
    def test_constructs_without_error(self):
        from backends import AgentSBackend

        backend = AgentSBackend(AgentSConfig(planner_api_key="test"))
        self.assertTrue(hasattr(backend, "predict"))


if __name__ == "__main__":
    unittest.main()
