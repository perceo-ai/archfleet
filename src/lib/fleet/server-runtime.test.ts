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
    expect(run.events.some((e) => e.message.includes("no_matching_vm"))).toBe(true);
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
});