// Persistence for runs + their events + artifacts. A run and all its children are
// saved atomically. Events are already secret-redacted by the orchestrator before
// they reach here, so nothing sensitive is written.

import type { Db } from "./db";
import type { RunArtifact, RunEvent, RunStatus, WorkflowRun } from "../types";

export type RunSummary = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  vmId?: string;
  startedAt: string;
  finishedAt?: string;
};

/** Insert a run with its events + artifacts atomically. */
export function saveRun(db: Db, run: WorkflowRun): void {
  const insertRun = db.prepare(
    `INSERT OR REPLACE INTO cuf_runs
       (id, workflow_id, workflow_name, status, vm_id, trigger_id, started_at, finished_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const insertEvent = db.prepare(
    `INSERT OR REPLACE INTO cuf_events (id, run_id, node_id, level, message, timestamp, seq)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const insertArtifact = db.prepare(
    `INSERT OR REPLACE INTO cuf_artifacts (id, run_id, node_id, type, path, metadata_json, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  );

  db.exec("BEGIN");
  try {
    insertRun.run(
      run.id,
      run.workflowId,
      run.workflowName,
      run.status,
      run.vmId ?? null,
      run.triggerId ?? null,
      run.startedAt,
      run.finishedAt ?? null,
    );
    run.events.forEach((e, i) =>
      insertEvent.run(e.id, run.id, null, e.level, e.message, e.timestamp, i),
    );
    (run.artifacts ?? []).forEach((a) =>
      insertArtifact.run(
        a.id,
        run.id,
        a.nodeId ?? null,
        a.type,
        a.path,
        JSON.stringify(a.metadata ?? {}),
        a.createdAt,
      ),
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Full run with events + artifacts, or undefined if not found. */
export function getRun(db: Db, id: string): WorkflowRun | undefined {
  const row = db.prepare("SELECT * FROM cuf_runs WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;

  const events = (
    db.prepare("SELECT * FROM cuf_events WHERE run_id=? ORDER BY seq").all(id) as Record<
      string,
      unknown
    >[]
  ).map(
    (e): RunEvent => ({
      id: e.id as string,
      level: e.level as RunEvent["level"],
      message: e.message as string,
      timestamp: e.timestamp as string,
    }),
  );

  const artifacts = (
    db.prepare("SELECT * FROM cuf_artifacts WHERE run_id=? ORDER BY created_at").all(id) as Record<
      string,
      unknown
    >[]
  ).map(
    (a): RunArtifact => ({
      id: a.id as string,
      runId: id,
      nodeId: (a.node_id as string) ?? undefined,
      type: a.type as string,
      path: a.path as string,
      metadata: JSON.parse((a.metadata_json as string) || "{}"),
      createdAt: a.created_at as string,
    }),
  );

  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    workflowName: row.workflow_name as string,
    status: row.status as RunStatus,
    vmId: (row.vm_id as string) ?? undefined,
    triggerId: (row.trigger_id as string) ?? undefined,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? undefined,
    events,
    artifacts,
  };
}

/**
 * Atomically claim the oldest queued run for processing: flips it queued->running
 * and returns its id. Returns undefined if none queued or another worker won the
 * race. Safe across concurrent workers / hosted instances.
 */
export function claimQueuedRun(db: Db, nowIso = new Date().toISOString()): string | undefined {
  const row = db
    .prepare(
      "SELECT id FROM cuf_runs WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY started_at LIMIT 1",
    )
    .get(nowIso) as { id: string } | undefined;
  if (!row) return undefined;
  const res = db
    .prepare("UPDATE cuf_runs SET status='running', attempts=attempts+1 WHERE id=? AND status='queued'")
    .run(row.id);
  return res.changes === 1 ? row.id : undefined;
}

/** Push a run's next eligible attempt into the future (backoff for no-VM retries). */
export function deferRun(db: Db, id: string, nextAttemptIso: string): void {
  db.prepare("UPDATE cuf_runs SET next_attempt_at=? WHERE id=?").run(nextAttemptIso, id);
}

/** Overwrite just a run's status (+ optional finishedAt). */
export function setRunStatus(db: Db, id: string, status: RunStatus, finishedAt?: string): void {
  db.prepare("UPDATE cuf_runs SET status=?, finished_at=COALESCE(?, finished_at) WHERE id=?").run(
    status,
    finishedAt ?? null,
    id,
  );
}

/** Recent run summaries, newest first. */
export function listRuns(db: Db, limit = 50): RunSummary[] {
  const rows = db
    .prepare("SELECT * FROM cuf_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    workflowName: row.workflow_name as string,
    status: row.status as RunStatus,
    vmId: (row.vm_id as string) ?? undefined,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? undefined,
  }));
}
