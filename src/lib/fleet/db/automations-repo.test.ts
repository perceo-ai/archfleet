import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  activationReadiness,
  automationHealth,
  deleteAutomation,
  getAutomation,
  getAutomationByWorkflowId,
  listAutomations,
  saveAutomation,
} from "./automations-repo";
import { addEvidence } from "./evidence-repo";
import { saveRun } from "./runs-repo";
import type { Automation, WorkflowRun } from "../types";

function automation(id: string, overrides: Partial<Automation> = {}): Automation {
  return {
    id,
    name: "Portal login check",
    goal: "Verify the portal login flow works end to end",
    category: "semantic_test",
    target: "portal.example.com",
    specMarkdown: "1. Open the portal\n2. Log in\n3. Confirm dashboard loads",
    workflowId: `wf_${id}`,
    environmentId: "env_default",
    successCriteria: ["Dashboard heading is visible after login"],
    requiredSecrets: ["portal_password"],
    mfaExpectation: "May prompt for email OTP on new devices",
    artifactPolicy: "Screenshot after login",
    retryPolicy: "Retry once on failure",
    takeoverPolicy: "Pause for human on MFA",
    triggerSuggestion: "Run on every release",
    riskNotes: ["Login page layout changes may break selectors"],
    evidenceChecks: [{ type: "text_found", value: "dashboard" }],
    status: "active",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function run(id: string, automationId: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "wf1",
    workflowName: "Portal login check",
    status: "succeeded",
    startedAt: "2026-08-12T01:00:00.000Z",
    events: [],
    artifacts: [],
    automationId,
    ...overrides,
  };
}

describe("automations repo", () => {
  it("round-trips an automation", () => {
    const db = openDb(":memory:");
    saveAutomation(db, automation("auto_1"));
    const got = getAutomation(db, "auto_1");
    expect(got).toEqual(automation("auto_1"));
    db.close();
  });

  it("upserts and lists with filters", () => {
    const db = openDb(":memory:");
    saveAutomation(db, automation("auto_1", { status: "draft", category: "general" }));
    saveAutomation(db, automation("auto_2", { status: "active" }));
    saveAutomation(db, automation("auto_1", { name: "Renamed", status: "draft", category: "general" }));
    expect(listAutomations(db)).toHaveLength(2);
    expect(listAutomations(db, { status: "draft" })[0].name).toBe("Renamed");
    expect(listAutomations(db, { category: "semantic_test" }).map((a) => a.id)).toEqual(["auto_2"]);
    db.close();
  });

  it("finds by workflow id and deletes", () => {
    const db = openDb(":memory:");
    saveAutomation(db, automation("auto_1"));
    expect(getAutomationByWorkflowId(db, "wf_auto_1")?.id).toBe("auto_1");
    expect(deleteAutomation(db, "auto_1")).toBe(true);
    expect(deleteAutomation(db, "auto_1")).toBe(false);
    expect(getAutomation(db, "auto_1")).toBeUndefined();
    db.close();
  });

  it("derives health from recent runs", () => {
    const db = openDb(":memory:");
    saveAutomation(db, automation("auto_1"));
    expect(automationHealth(db, "auto_1").health).toBe("unknown");

    saveRun(db, run("r1", "auto_1", { status: "succeeded", startedAt: "2026-08-12T01:00:00Z" }));
    expect(automationHealth(db, "auto_1").health).toBe("healthy");

    saveRun(db, run("r2", "auto_1", { status: "failed", startedAt: "2026-08-12T02:00:00Z" }));
    const failing = automationHealth(db, "auto_1");
    expect(failing.health).toBe("failing");
    expect(failing.lastRun?.id).toBe("r2");

    saveRun(db, run("r3", "auto_1", { status: "paused", startedAt: "2026-08-12T03:00:00Z" }));
    expect(automationHealth(db, "auto_1").health).toBe("needs_attention");
    db.close();
  });

  it("blocks activation until a run has succeeded", () => {
    const db = openDb(":memory:");
    const a = automation("auto_1", { status: "draft" });
    saveAutomation(db, a);
    expect(activationReadiness(db, a).ok).toBe(false);
    expect(activationReadiness(db, a).reason).toMatch(/successful run/i);

    saveRun(db, run("r1", "auto_1", { status: "failed" }));
    expect(activationReadiness(db, a).ok).toBe(false);
    db.close();
  });

  it("blocks activation until criteria are reviewed on a successful run", () => {
    const db = openDb(":memory:");
    const a = automation("auto_1", { status: "draft" });
    saveAutomation(db, a);
    saveRun(db, run("r1", "auto_1", { status: "succeeded" }));
    // Succeeded but nobody reviewed the evidence yet.
    expect(activationReadiness(db, a).ok).toBe(false);
    expect(activationReadiness(db, a).reason).toMatch(/review/i);

    addEvidence(db, {
      id: "ev1",
      runId: "r1",
      automationId: "auto_1",
      type: "criteria_review",
      description: a.successCriteria[0],
      verdict: "fail",
      createdAt: "2026-08-12T01:05:00.000Z",
    });
    // Reviewed but the verdict was fail — still not activatable.
    expect(activationReadiness(db, a).ok).toBe(false);

    // Re-reviews append NEW rows (unique ids); the latest verdict wins, so a
    // corrected fail stops blocking.
    addEvidence(db, {
      id: "ev2",
      runId: "r1",
      automationId: "auto_1",
      type: "criteria_review",
      description: a.successCriteria[0],
      verdict: "pass",
      createdAt: "2026-08-12T01:06:00.000Z",
    });
    expect(activationReadiness(db, a).ok).toBe(true);
    db.close();
  });

  it("requires EVERY criterion reviewed pass, not just one", () => {
    const db = openDb(":memory:");
    const a = automation("auto_1", {
      status: "draft",
      successCriteria: ["Dashboard visible", "Report downloaded"],
    });
    saveAutomation(db, a);
    saveRun(db, run("r1", "auto_1", { status: "succeeded" }));
    addEvidence(db, {
      id: "ev1",
      runId: "r1",
      automationId: "auto_1",
      type: "criteria_review",
      description: "Dashboard visible",
      verdict: "pass",
      createdAt: "2026-08-12T01:05:00.000Z",
    });
    // One of two criteria reviewed — still blocked.
    expect(activationReadiness(db, a).ok).toBe(false);
    addEvidence(db, {
      id: "ev2",
      runId: "r1",
      automationId: "auto_1",
      type: "criteria_review",
      description: "Report downloaded",
      verdict: "pass",
      createdAt: "2026-08-12T01:06:00.000Z",
    });
    expect(activationReadiness(db, a).ok).toBe(true);
    db.close();
  });

  it("activation needs only a successful run when there are no criteria", () => {
    const db = openDb(":memory:");
    const a = automation("auto_1", { status: "draft", successCriteria: [] });
    saveAutomation(db, a);
    saveRun(db, run("r1", "auto_1", { status: "succeeded" }));
    expect(activationReadiness(db, a).ok).toBe(true);
    db.close();
  });
});
