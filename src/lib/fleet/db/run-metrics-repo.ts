// Per-run resource telemetry: how long runs wait in the queue and how long they
// execute, by environment/VM. Collected so later optimization surfaces (warm
// pools, queue tuning, environment density) have data — deliberately not a
// user-facing dashboard today.

import type { Db } from "./db";
import type { RunStatus } from "../types";

export type RunMetric = {
  runId: string;
  automationId?: string;
  environmentId?: string;
  vmId?: string;
  status: RunStatus;
  /** Enqueue -> execution start. Null when the run never executed. */
  queuedMs?: number;
  /** Execution start -> finish. */
  executionMs?: number;
  createdAt: string;
};

export function recordRunMetric(db: Db, m: RunMetric): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_run_metrics
       (run_id, automation_id, environment_id, vm_id, status, queued_ms, execution_ms, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    m.runId,
    m.automationId ?? null,
    m.environmentId ?? null,
    m.vmId ?? null,
    m.status,
    m.queuedMs ?? null,
    m.executionMs ?? null,
    m.createdAt,
  );
}

export type RunMetricsSummary = {
  runs: number;
  avgQueuedMs?: number;
  maxQueuedMs?: number;
  avgExecutionMs?: number;
  maxExecutionMs?: number;
  byStatus: Record<string, number>;
};

/** Aggregate telemetry, optionally windowed with `sinceIso`. */
export function summarizeRunMetrics(db: Db, opts: { sinceIso?: string } = {}): RunMetricsSummary {
  const where = opts.sinceIso ? "WHERE created_at >= ?" : "";
  const args = opts.sinceIso ? [opts.sinceIso] : [];
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS runs,
              AVG(queued_ms) AS avg_queued, MAX(queued_ms) AS max_queued,
              AVG(execution_ms) AS avg_exec, MAX(execution_ms) AS max_exec
       FROM cuf_run_metrics ${where}`,
    )
    .get(...(args as never[])) as {
    runs: number;
    avg_queued: number | null;
    max_queued: number | null;
    avg_exec: number | null;
    max_exec: number | null;
  };
  const statusRows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM cuf_run_metrics ${where} GROUP BY status`)
    .all(...(args as never[])) as { status: string; c: number }[];
  return {
    runs: agg.runs,
    avgQueuedMs: agg.avg_queued != null ? Math.round(agg.avg_queued) : undefined,
    maxQueuedMs: agg.max_queued ?? undefined,
    avgExecutionMs: agg.avg_exec != null ? Math.round(agg.avg_exec) : undefined,
    maxExecutionMs: agg.max_exec ?? undefined,
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.c])),
  };
}
