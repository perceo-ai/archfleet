import { describe, expect, it } from "vitest";
import { draftAutomation, DRAFT_SYSTEM } from "./automation-draft";
import type { AgentExec } from "./cli-agent-runner";

const DRAFT = {
  name: "Portal login check",
  goal: "Verify a user can log into the portal",
  category: "semantic_test",
  target: "portal.example.com",
  spec_markdown: "1. Open the portal\n2. Log in with the saved account\n3. Confirm the dashboard loads",
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "login", type: "computer_use_task", name: "Log in", config: { prompt: "log in", requiredLabels: ["browser"] } },
    { id: "end", type: "end", name: "End" },
  ],
  edges: [
    { from: "start", to: "login", condition: "always" },
    { from: "login", to: "end", condition: "success" },
  ],
  required_secrets: ["portal_password"],
  mfa_expectation: "May prompt for email OTP",
  success_criteria: ["Dashboard heading visible after login"],
  trigger_suggestion: "Run on every release",
  artifact_policy: "Screenshot after login",
  retry_policy: "Retry once on transient failure",
  takeover_policy: "Pause for a human on MFA",
  risk_notes: ["Portal layout changes may break the flow"],
  clarifying_questions: ["Which account should be used?"],
};

function execReturning(payload: unknown): AgentExec {
  return async () => ({
    code: 0,
    stdout: `{"type":"result","result":${JSON.stringify(payload)}}`,
    stderr: "",
  });
}

describe("draftAutomation", () => {
  it("teaches the drafter the full automation shape", () => {
    expect(DRAFT_SYSTEM).toContain("success_criteria");
    expect(DRAFT_SYSTEM).toContain("clarifying_questions");
    expect(DRAFT_SYSTEM).toContain("human_takeover");
  });

  it("builds a draft automation + disabled workflow from agent JSON", async () => {
    const now = () => "2026-08-12T10:00:00.000Z";
    const draft = await draftAutomation("check portal login works", execReturning(DRAFT), { now });
    expect(draft.errors).toEqual([]);
    expect(draft.automation.name).toBe("Portal login check");
    expect(draft.automation.category).toBe("semantic_test");
    expect(draft.automation.successCriteria).toEqual(["Dashboard heading visible after login"]);
    expect(draft.automation.requiredSecrets).toEqual(["portal_password"]);
    expect(draft.automation.status).toBe("draft");
    expect(draft.automation.workflowId).toBe(draft.workflow.id);
    expect(draft.automation.createdAt).toBe("2026-08-12T10:00:00.000Z");
    expect(draft.workflow.enabled).toBe(false);
    expect(draft.workflow.nodes.some((n) => n.type === "computer_use_task")).toBe(true);
    expect(draft.clarifyingQuestions).toEqual(["Which account should be used?"]);
    expect(draft.warnings).toContain("Portal layout changes may break the flow");
    expect(draft.warnings.some((w) => w.toLowerCase().includes("run") && w.toLowerCase().includes("once"))).toBe(true);
  });

  it("falls back to sane defaults when the agent returns junk", async () => {
    const exec: AgentExec = async () => ({ code: 0, stdout: "cannot help", stderr: "" });
    const draft = await draftAutomation("do a thing", exec);
    expect(draft.errors.length).toBeGreaterThan(0);
    expect(draft.automation.name).toBeTruthy();
    expect(draft.automation.category).toBe("general");
    expect(draft.automation.status).toBe("draft");
    expect(draft.workflow.nodes).toEqual([]);
  });

  it("keeps automation fields even when only partial JSON is returned", async () => {
    const partial = { goal: "Download the weekly report", nodes: DRAFT.nodes, edges: DRAFT.edges };
    const draft = await draftAutomation("download report", execReturning(partial), {});
    expect(draft.automation.goal).toBe("Download the weekly report");
    expect(draft.automation.successCriteria).toEqual([]);
    expect(draft.errors).toEqual([]);
  });
});
