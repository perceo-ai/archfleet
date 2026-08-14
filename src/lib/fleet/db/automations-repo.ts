// Persistence for automations — the user-facing object wrapping a workflow graph
// with intent, environment, success criteria, and policies.

import type { Db } from "./db";
import type { Automation, AutomationHealth, AutomationStatus } from "../types";
import { listEvidenceByAutomation } from "./evidence-repo";
import { listRuns, type RunSummary } from "./runs-repo";

export type AutomationListFilter = {
  status?: AutomationStatus;
  category?: string;
};

export function saveAutomation(db: Db, a: Automation): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_automations
       (id, name, goal, category, target, spec_markdown, workflow_id, environment_id,
        success_criteria, required_secrets, mfa_expectation, artifact_policy, retry_policy,
        takeover_policy, trigger_suggestion, risk_notes, evidence_checks, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    a.id,
    a.name,
    a.goal,
    a.category,
    a.target,
    a.specMarkdown,
    a.workflowId,
    a.environmentId ?? null,
    JSON.stringify(a.successCriteria),
    JSON.stringify(a.requiredSecrets),
    a.mfaExpectation ?? null,
    a.artifactPolicy,
    a.retryPolicy,
    a.takeoverPolicy,
    a.triggerSuggestion ?? null,
    JSON.stringify(a.riskNotes),
    JSON.stringify(a.evidenceChecks ?? []),
    a.status,
    a.createdAt,
    a.updatedAt,
  );
}

function rowToAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string,
    name: row.name as string,
    goal: row.goal as string,
    category: row.category as string,
    target: row.target as string,
    specMarkdown: row.spec_markdown as string,
    workflowId: row.workflow_id as string,
    environmentId: (row.environment_id as string) ?? undefined,
    successCriteria: JSON.parse((row.success_criteria as string) || "[]"),
    requiredSecrets: JSON.parse((row.required_secrets as string) || "[]"),
    mfaExpectation: (row.mfa_expectation as string) ?? undefined,
    artifactPolicy: row.artifact_policy as string,
    retryPolicy: row.retry_policy as string,
    takeoverPolicy: row.takeover_policy as string,
    triggerSuggestion: (row.trigger_suggestion as string) ?? undefined,
    riskNotes: JSON.parse((row.risk_notes as string) || "[]"),
    evidenceChecks: JSON.parse((row.evidence_checks as string) || "[]"),
    status: row.status as AutomationStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getAutomation(db: Db, id: string): Automation | undefined {
  const row = db.prepare("SELECT * FROM cuf_automations WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAutomation(row) : undefined;
}

export function getAutomationByWorkflowId(db: Db, workflowId: string): Automation | undefined {
  const row = db.prepare("SELECT * FROM cuf_automations WHERE workflow_id=? LIMIT 1").get(workflowId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAutomation(row) : undefined;
}

export function listAutomations(db: Db, filter: AutomationListFilter = {}): Automation[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter.category) {
    where.push("category = ?");
    args.push(filter.category);
  }
  const sql = `SELECT * FROM cuf_automations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, name`;
  const rows = db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
  return rows.map(rowToAutomation);
}

export function deleteAutomation(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM cuf_automations WHERE id=?").run(id).changes === 1;
}

export type ActivationReadiness = {
  ok: boolean;
  /** Why activation is blocked — user-facing, absent when ok. */
  reason?: string;
};

/** Draft lifecycle gate: a draft can only become active after at least one run
 * succeeded AND (when the automation has success criteria) a human reviewed that
 * run's evidence with no failing verdicts. Keeps "activate" honest — an automation
 * is only repeatable once someone has watched it work. */
export function activationReadiness(db: Db, a: Automation): ActivationReadiness {
  const succeeded = listRuns(db, 50, { automationId: a.id, statuses: ["succeeded"] });
  if (!succeeded.length) {
    return {
      ok: false,
      reason: "No successful run yet. Run it once and watch it succeed before activating.",
    };
  }
  if (!a.successCriteria.length) return { ok: true };
  const reviews = listEvidenceByAutomation(db, a.id, { type: "criteria_review" });
  const byRun = new Map<string, { pass: number; fail: number }>();
  for (const r of reviews) {
    const tally = byRun.get(r.runId) ?? { pass: 0, fail: 0 };
    tally[r.verdict === "fail" ? "fail" : "pass"]++;
    byRun.set(r.runId, tally);
  }
  const reviewedOk = succeeded.some((run) => {
    const tally = byRun.get(run.id);
    return tally && tally.pass > 0 && tally.fail === 0;
  });
  if (!reviewedOk) {
    return {
      ok: false,
      reason:
        "Success criteria not reviewed yet. Open a successful run and mark the criteria pass against its evidence.",
    };
  }
  return { ok: true };
}

/** Health from the most recent runs: last run failed → failing; paused (waiting on a
 * human) → needs_attention; succeeded → healthy; no runs yet → unknown. */
export function automationHealth(
  db: Db,
  id: string,
): { health: AutomationHealth; lastRun?: RunSummary } {
  const recent = listRuns(db, 5, { automationId: id });
  const settled = recent.find((r) => r.status !== "queued" && r.status !== "running");
  const lastRun = recent[0];
  if (!settled) return { health: "unknown", lastRun };
  const health: AutomationHealth =
    settled.status === "succeeded"
      ? "healthy"
      : settled.status === "failed"
        ? "failing"
        : "needs_attention"; // paused or canceled — a human decision is pending
  return { health, lastRun };
}
