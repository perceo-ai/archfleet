import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { recordRunMetric, summarizeRunMetrics } from "./run-metrics-repo";

describe("run metrics repo", () => {
  it("records and aggregates queue/execution telemetry", () => {
    const db = openDb(":memory:");
    recordRunMetric(db, {
      runId: "r1",
      status: "succeeded",
      queuedMs: 1000,
      executionMs: 60000,
      vmId: "vm1",
      environmentId: "env_1",
      createdAt: "2026-08-12T01:00:00Z",
    });
    recordRunMetric(db, { runId: "r2", status: "failed", queuedMs: 3000, executionMs: 20000, createdAt: "2026-08-12T02:00:00Z" });
    const summary = summarizeRunMetrics(db);
    expect(summary.runs).toBe(2);
    expect(summary.avgQueuedMs).toBe(2000);
    expect(summary.maxQueuedMs).toBe(3000);
    expect(summary.avgExecutionMs).toBe(40000);
    expect(summary.byStatus).toEqual({ succeeded: 1, failed: 1 });
    // Upsert per run — a retry replaces, not duplicates.
    recordRunMetric(db, { runId: "r2", status: "succeeded", queuedMs: 100, executionMs: 5000, createdAt: "2026-08-12T03:00:00Z" });
    expect(summarizeRunMetrics(db).runs).toBe(2);
    // Windowing.
    expect(summarizeRunMetrics(db, { sinceIso: "2026-08-12T02:30:00Z" }).runs).toBe(1);
    db.close();
  });

  it("summarizes an empty table without NaNs", () => {
    const db = openDb(":memory:");
    const summary = summarizeRunMetrics(db);
    expect(summary.runs).toBe(0);
    expect(summary.avgQueuedMs).toBeUndefined();
    expect(summary.byStatus).toEqual({});
    db.close();
  });
});
