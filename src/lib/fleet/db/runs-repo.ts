// Persistence for runs + their events + artifacts. A run and all its children are
// saved atomically. Events are already secret-redacted by the orchestrator before
// they reach here, so nothing sensitive is written.

import type { Db } from "./db";
import type { RunArtifact, RunEvent, RunStatus, TriggerSource, WorkflowRun } from "../types";

export type RunSummary = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  vmId?: string;
  startedAt: string;
  finishedAt?: string;
  automationId?: string;
  environmentId?: string;
  triggerSource?: TriggerSource;
  currentStep?: string;
  resultSummary?: string;
  branchRef?: string;
  prRef?: string;
};

export type RunListFilter = {
  automationId?: string;
  statuses?: RunStatus[];
  branchRef?: string;
  prRef?: string;
};

/** Upsert a run with its events + artifacts atomically. Columns not owned by the
 * WorkflowRun shape (params_json, attempts, next_attempt_at) are preserved on
 * conflict so a final post-run save can't wipe queue bookkeeping. */
export function saveRun(db: Db, run: WorkflowRun): void {
  const insertRun = db.prepare(
    `INSERT INTO cuf_runs
       (id, workflow_id, workflow_name, status, vm_id, trigger_id, started_at, finished_at,
        automation_id, environment_id, trigger_source, current_step, paused_reason, result_summary,
        branch_ref, pr_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       workflow_id=excluded.workflow_id,
       workflow_name=excluded.workflow_name,
       status=excluded.status,
       vm_id=excluded.vm_id,
       trigger_id=excluded.trigger_id,
       started_at=excluded.started_at,
       finished_at=excluded.finished_at,
       automation_id=excluded.automation_id,
       environment_id=excluded.environment_id,
       trigger_source=excluded.trigger_source,
       current_step=excluded.current_step,
       paused_reason=excluded.paused_reason,
       result_summary=excluded.result_summary,
       branch_ref=excluded.branch_ref,
       pr_ref=excluded.pr_ref`,
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
      run.automationId ?? null,
      run.environmentId ?? null,
      run.triggerSource ?? null,
      run.currentStep ?? null,
      run.pausedReason ?? null,
      run.resultSummary ?? null,
      run.branchRef ?? null,
      run.prRef ?? null,
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
    automationId: (row.automation_id as string) ?? undefined,
    environmentId: (row.environment_id as string) ?? undefined,
    triggerSource: (row.trigger_source as TriggerSource) ?? undefined,
    currentStep: (row.current_step as string) ?? undefined,
    pausedReason: (row.paused_reason as string) ?? undefined,
    resultSummary: (row.result_summary as string) ?? undefined,
    branchRef: (row.branch_ref as string) ?? undefined,
    prRef: (row.pr_ref as string) ?? undefined,
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

/** Re-queue a terminal/paused run for another attempt (human takeover: retry/resume). */
export function retryRun(db: Db, id: string): boolean {
  const res = db
    .prepare(
      "UPDATE cuf_runs SET status='queued', finished_at=NULL, next_attempt_at=NULL, paused_reason=NULL WHERE id=? AND status IN ('failed','paused','canceled')",
    )
    .run(id);
  return res.changes === 1;
}

/** Cancel a queued/running/paused run. */
export function cancelRun(db: Db, id: string, nowIso = new Date().toISOString()): boolean {
  const res = db
    .prepare(
      "UPDATE cuf_runs SET status='canceled', finished_at=? WHERE id=? AND status IN ('queued','running','paused')",
    )
    .run(nowIso, id);
  return res.changes === 1;
}

/** Overwrite just a run's status (+ optional finishedAt). */
export function setRunStatus(db: Db, id: string, status: RunStatus, finishedAt?: string): void {
  db.prepare("UPDATE cuf_runs SET status=?, finished_at=COALESCE(?, finished_at) WHERE id=?").run(
    status,
    finishedAt ?? null,
    id,
  );
}

/** Record which node is currently executing (live progress for the run view). */
export function setRunProgress(db: Db, id: string, currentStep: string): void {
  db.prepare("UPDATE cuf_runs SET current_step=? WHERE id=?").run(currentStep, id);
}

/** Write outcome fields after a run settles. Pass null to clear a field. */
export function setRunOutcome(
  db: Db,
  id: string,
  fields: { pausedReason?: string | null; resultSummary?: string | null },
): void {
  if (fields.pausedReason !== undefined) {
    db.prepare("UPDATE cuf_runs SET paused_reason=? WHERE id=?").run(fields.pausedReason, id);
  }
  if (fields.resultSummary !== undefined) {
    db.prepare("UPDATE cuf_runs SET result_summary=? WHERE id=?").run(fields.resultSummary, id);
  }
}

/** Recent run summaries, newest first. */
export function listRuns(db: Db, limit = 50, filter: RunListFilter = {}): RunSummary[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.automationId) {
    where.push("automation_id = ?");
    args.push(filter.automationId);
  }
  if (filter.statuses?.length) {
    where.push(`status IN (${filter.statuses.map(() => "?").join(",")})`);
    args.push(...filter.statuses);
  }
  if (filter.branchRef) {
    where.push("branch_ref = ?");
    args.push(filter.branchRef);
  }
  if (filter.prRef) {
    where.push("pr_ref = ?");
    args.push(filter.prRef);
  }
  const sql = `SELECT * FROM cuf_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...(args as never[]), limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    workflowName: row.workflow_name as string,
    status: row.status as RunStatus,
    vmId: (row.vm_id as string) ?? undefined,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? undefined,
    automationId: (row.automation_id as string) ?? undefined,
    environmentId: (row.environment_id as string) ?? undefined,
    triggerSource: (row.trigger_source as TriggerSource) ?? undefined,
    currentStep: (row.current_step as string) ?? undefined,
    resultSummary: (row.result_summary as string) ?? undefined,
    branchRef: (row.branch_ref as string) ?? undefined,
    prRef: (row.pr_ref as string) ?? undefined,
  }));
}
