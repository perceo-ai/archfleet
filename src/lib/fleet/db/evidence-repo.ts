// Persistence for run evidence: screenshots, files, logs, and human criteria
// reviews. Evidence is what makes a run's success criteria checkable after the fact.

import type { Db } from "./db";
import type { EvidenceItem, EvidenceType } from "../types";

export function addEvidence(db: Db, item: EvidenceItem): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_evidence
       (id, run_id, automation_id, type, artifact_ref, step_id, description, verdict, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    item.id,
    item.runId,
    item.automationId ?? null,
    item.type,
    item.artifactRef ?? null,
    item.stepId ?? null,
    item.description,
    item.verdict ?? null,
    item.createdAt,
  );
}

function rowToEvidence(row: Record<string, unknown>): EvidenceItem {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    automationId: (row.automation_id as string) ?? undefined,
    type: row.type as EvidenceType,
    artifactRef: (row.artifact_ref as string) ?? undefined,
    stepId: (row.step_id as string) ?? undefined,
    description: row.description as string,
    verdict: (row.verdict as EvidenceItem["verdict"]) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export function listEvidenceByRun(db: Db, runId: string, filter: { type?: EvidenceType } = {}): EvidenceItem[] {
  const sql = filter.type
    ? "SELECT * FROM cuf_evidence WHERE run_id=? AND type=? ORDER BY created_at, id"
    : "SELECT * FROM cuf_evidence WHERE run_id=? ORDER BY created_at, id";
  const args = filter.type ? [runId, filter.type] : [runId];
  return (db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map(rowToEvidence);
}

export function listEvidenceByAutomation(
  db: Db,
  automationId: string,
  filter: { type?: EvidenceType } = {},
): EvidenceItem[] {
  const sql = filter.type
    ? "SELECT * FROM cuf_evidence WHERE automation_id=? AND type=? ORDER BY created_at DESC, id"
    : "SELECT * FROM cuf_evidence WHERE automation_id=? ORDER BY created_at DESC, id";
  const args = filter.type ? [automationId, filter.type] : [automationId];
  return (db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map(rowToEvidence);
}
