import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { executeManualRun, enqueueManualRun, processPendingRuns } from "./server-runtime";
import { openDb } from "./db/db";
import { getRun, listRuns } from "./db/runs-repo";
import { ensureSeeded } from "./db/init-db";

describe("executeManualRun (sync, real assembly)", () => {
  it("queues a computer-use workflow when no domain-bound VM is configured", async () => {
    const state = seedFleetState();
    // A computer_use workflow needs a VM; with none configured it queues.
    const wf = {
      ...state.workflows[0],
      id: "wf_cu",
      nodes: [
        { id: "start", type: "start" as const, name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "t1",
          type: "computer_use_task" as const,
          name: "Probe",
          position: { x: 1, y: 0 },
          config: { prompt: "screenshot", requiredLabels: ["linux-desktop"] },
        },
        { id: "end", type: "end" as const, name: "End", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "t1", condition: "always" as const },
        { id: "e2", from: "t1", to: "end", condition: "success" as const },
      ],
    };
    const db = openDb(":memory:");
    let n = 0;
    const run = await executeManualRun(state, wf, { now: () => `t${n++}`, db });
    expect(run.status).toBe("queued");
    expect(run.events.some((e) => e.message.includes("no desktop available"))).toBe(true);
    expect(getRun(db, run.id)?.status).toBe("queued");
    db.close();
  });
});

describe("async run queue", () => {
  it("enqueue persists a queued run immediately without executing", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    let n = 0;
    const run = enqueueManualRun(undefined, { db, now: () => `t${n++}` });
    expect(run.status).toBe("queued");
    expect(getRun(db, run.id)?.status).toBe("queued");
    db.close();
  });

  it("enqueue persists run-level params (e.g. webhook payload)", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const run = enqueueManualRun(undefined, { db, params: { url: "https://x", n: 5 } });
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(run.id) as { params_json: string };
    expect(JSON.parse(row.params_json)).toEqual({ url: "https://x", n: 5 });
    db.close();
  });

  it("enqueue strips reserved __ params so callers cannot skip workflow steps", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const run = enqueueManualRun(undefined, {
      db,
      params: { url: "https://x", __resumeFrom: "end", __anything: "nope" },
    });
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(run.id) as { params_json: string };
    expect(JSON.parse(row.params_json)).toEqual({ url: "https://x" });
    db.close();
  });

  it("processPendingRuns claims + executes queued runs to a terminal state", async () => {
    const db = openDb(":memory:");
    // A no-op start->end workflow: executes instantly with no VM or CLI spawn,
    // keeping this test deterministic regardless of what's installed on the host.
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_noop",
      name: "Noop",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 1, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "end", condition: "always" }],
    });
    enqueueManualRun("wf_noop", { db });
    enqueueManualRun("wf_noop", { db });
    const processed = await processPendingRuns(db, 5);
    expect(processed).toBe(2);
    expect(await processPendingRuns(db, 5)).toBe(0);
    expect(listRuns(db)).toHaveLength(2);
    // both reached a terminal success (no executable nodes)
    expect(listRuns(db).every((r) => r.status === "succeeded")).toBe(true);
    db.close();
  });

  it("consumes __resumeFrom once the run settles (later retries start fresh)", async () => {
    const db = openDb(":memory:");
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_noop",
      name: "Noop",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 1, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "end", condition: "always" }],
    });
    const run = enqueueManualRun("wf_noop", { db });
    // The action route (not caller params) sets the checkpoint.
    db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(
      JSON.stringify({ __resumeFrom: "end" }),
      run.id,
    );
    await processPendingRuns(db, 1);
    expect(listRuns(db)[0].status).toBe("succeeded");
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(run.id) as {
      params_json: string;
    };
    expect(JSON.parse(row.params_json)).toEqual({});
    db.close();
  });

  it("keeps params a resumed run computed, instead of restoring a stale snapshot", async () => {
    // The clearing of __resumeFrom used to write back a copy of params read
    // *before* execution, erasing everything the run had just worked out.
    const db = openDb(":memory:");
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_compute",
      name: "Compute",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        {
          id: "set",
          type: "set_params",
          name: "Work it out",
          position: { x: 0, y: 1 },
          config: { assign: { total: "40 + 2", note: '"after the pause"' } },
        },
        { id: "end", type: "end", name: "E", position: { x: 0, y: 2 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "set", condition: "always" },
        { id: "e2", from: "set", to: "end", condition: "always" },
      ],
    });
    const run = enqueueManualRun("wf_compute", { db });
    db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run(
      JSON.stringify({ __resumeFrom: "set", answered: "earlier" }),
      run.id,
    );

    await processPendingRuns(db, 1);

    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get(run.id) as {
      params_json: string;
    };
    expect(JSON.parse(row.params_json)).toEqual({
      answered: "earlier",
      total: 42,
      note: "after the pause",
    });
    db.close();
  });
});
describe("automation-aware run lifecycle", () => {
  async function seedTakeoverWorkflow(db: import("./db/db").Db) {
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_tk",
      name: "Needs Human",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        {
          id: "h1",
          type: "human_takeover",
          name: "Manual MFA",
          position: { x: 1, y: 0 },
          config: { prompt: "Approve the MFA prompt" },
        },
        { id: "end", type: "end", name: "E", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "h1", condition: "always" },
        { id: "e2", from: "h1", to: "end", condition: "success" },
      ],
    });
  }

  it("enqueue links the run to its automation and environment", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    await seedTakeoverWorkflow(db);
    const { saveAutomation } = await import("./db/automations-repo");
    saveAutomation(db, {
      id: "auto_tk",
      name: "MFA automation",
      goal: "",
      category: "general",
      target: "",
      specMarkdown: "",
      workflowId: "wf_tk",
      environmentId: "env_1",
      successCriteria: [],
      requiredSecrets: [],
      artifactPolicy: "",
      retryPolicy: "",
      takeoverPolicy: "",
      riskNotes: [],
      status: "active",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "2026-08-12T00:00:00Z",
    });
    const run = enqueueManualRun("wf_tk", { db, triggerSource: "manual" });
    const persisted = getRun(db, run.id);
    expect(persisted?.automationId).toBe("auto_tk");
    expect(persisted?.environmentId).toBe("env_1");
    expect(persisted?.triggerSource).toBe("manual");
    db.close();
  });

  it("paused run opens a takeover and preserves linkage through execution", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    await seedTakeoverWorkflow(db);
    const { saveAutomation } = await import("./db/automations-repo");
    saveAutomation(db, {
      id: "auto_tk",
      name: "MFA automation",
      goal: "",
      category: "general",
      target: "",
      specMarkdown: "",
      workflowId: "wf_tk",
      successCriteria: [],
      requiredSecrets: [],
      artifactPolicy: "",
      retryPolicy: "",
      takeoverPolicy: "",
      riskNotes: [],
      status: "active",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "2026-08-12T00:00:00Z",
    });
    enqueueManualRun("wf_tk", { db, triggerSource: "manual" });
    await processPendingRuns(db, 5);
    const run = listRuns(db)[0];
    expect(run.status).toBe("paused");
    expect(run.automationId).toBe("auto_tk"); // final save must not wipe linkage
    expect(run.currentStep).toBe("Manual MFA");
    const full = getRun(db, run.id);
    expect(full?.pausedReason).toBe("Approve the MFA prompt");
    const { getOpenTakeoverForRun } = await import("./db/takeovers-repo");
    const takeover = getOpenTakeoverForRun(db, run.id);
    expect(takeover?.requestedAction).toBe("Approve the MFA prompt");
    expect(takeover?.reason).toContain("Manual MFA");
    db.close();
  });

  it("writes a result summary on settled runs", async () => {
    const db = openDb(":memory:");
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_noop2",
      name: "Noop",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "S", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "E", position: { x: 1, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "end", condition: "always" }],
    });
    enqueueManualRun("wf_noop2", { db });
    await processPendingRuns(db, 5);
    const run = listRuns(db)[0];
    expect(run.status).toBe("succeeded");
    expect(run.resultSummary).toContain("succeeded");
    db.close();
  });
});

describe("evidence checks + PR association through execution", () => {
  it("evaluates automation evidence checks into check evidence rows", async () => {
    const db = openDb(":memory:");
    const { saveWorkflow } = await import("./db/workflows-repo");
    saveWorkflow(db, {
      id: "wf_noop3",
      name: "Noop",
      description: "",
      enabled: true,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "Start step", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "End", position: { x: 1, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "start", to: "end", condition: "always" }],
    });
    const { saveAutomation } = await import("./db/automations-repo");
    saveAutomation(db, {
      id: "auto_chk",
      name: "Checked",
      goal: "",
      category: "general",
      target: "",
      specMarkdown: "",
      workflowId: "wf_noop3",
      successCriteria: [],
      requiredSecrets: [],
      artifactPolicy: "",
      retryPolicy: "",
      takeoverPolicy: "",
      riskNotes: [],
      evidenceChecks: [
        { type: "screenshot_captured" },
      ],
      status: "active",
      createdAt: "t",
      updatedAt: "t",
    });
    enqueueManualRun("wf_noop3", { db, prRef: "42", branchRef: "main" });
    await processPendingRuns(db, 5);
    const run = listRuns(db)[0];
    expect(run.status).toBe("succeeded");
    expect(run.prRef).toBe("42");
    expect(run.branchRef).toBe("main");
    const { listEvidenceByRun } = await import("./db/evidence-repo");
    const checks = listEvidenceByRun(db, run.id, { type: "check" });
    expect(checks).toHaveLength(1);
    expect(checks[0].verdict).toBe("fail"); // noop run captures no screenshots
    db.close();
  });
});

describe("automation workflow guard", () => {
  it("throws instead of falling back to the seed workflow when an automation's workflow is missing", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    expect(() =>
      enqueueManualRun("wf_does_not_exist", { db, automationId: "auto_orphan" }),
    ).toThrow(/workflow wf_does_not_exist not found/);
    // without an automationId the seed fallback stays (bare-workflow demo path)
    const run = enqueueManualRun("wf_does_not_exist", { db });
    expect(run.workflowId).toBe("wf_portal_login");
    db.close();
  });
});
