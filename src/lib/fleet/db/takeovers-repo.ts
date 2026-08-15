// Persistence for human takeover requests: why a run paused, what the operator
// should do, and how it was resolved. The paused VM stays held so the human lands
// on the same desktop state.

import type { Db } from "./db";
import type { HumanTakeover, TakeoverStatus } from "../types";

export function openTakeover(db: Db, t: HumanTakeover): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_takeovers
       (id, run_id, environment_id, vm_id, reason, requested_action, status, opened_at, resolved_at,
        operator_notes, notified_at, escalated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    t.id,
    t.runId,
    t.environmentId ?? null,
    t.vmId ?? null,
    t.reason,
    t.requestedAction,
    t.status,
    t.openedAt,
    t.resolvedAt ?? null,
    t.operatorNotes ?? null,
    t.notifiedAt ?? null,
    t.escalatedAt ?? null,
  );
}

function rowToTakeover(row: Record<string, unknown>): HumanTakeover {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    environmentId: (row.environment_id as string) ?? undefined,
    vmId: (row.vm_id as string) ?? undefined,
    reason: row.reason as string,
    requestedAction: row.requested_action as string,
    status: row.status as TakeoverStatus,
    openedAt: row.opened_at as string,
    resolvedAt: (row.resolved_at as string) ?? undefined,
    operatorNotes: (row.operator_notes as string) ?? undefined,
    notifiedAt: (row.notified_at as string) ?? undefined,
    escalatedAt: (row.escalated_at as string) ?? undefined,
  };
}

/** Record that the operator webhook was paged about this takeover. */
export function markTakeoverNotified(db: Db, id: string, at: string): void {
  db.prepare("UPDATE cuf_takeovers SET notified_at=? WHERE id=? AND notified_at IS NULL").run(at, id);
}

/** Record that a reminder page went out because nobody responded. */
export function markTakeoverEscalated(db: Db, id: string, at: string): void {
  db.prepare("UPDATE cuf_takeovers SET escalated_at=? WHERE id=? AND escalated_at IS NULL").run(at, id);
}

/** Open takeovers waiting since before `cutoffIso` that have not been escalated. */
export function listStaleOpenTakeovers(db: Db, cutoffIso: string): HumanTakeover[] {
  const rows = db
    .prepare(
      "SELECT * FROM cuf_takeovers WHERE status='open' AND escalated_at IS NULL AND opened_at <= ? ORDER BY opened_at",
    )
    .all(cutoffIso) as Record<string, unknown>[];
  return rows.map(rowToTakeover);
}

export function getTakeover(db: Db, id: string): HumanTakeover | undefined {
  const row = db.prepare("SELECT * FROM cuf_takeovers WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTakeover(row) : undefined;
}

export function getOpenTakeoverForRun(db: Db, runId: string): HumanTakeover | undefined {
  const row = db
    .prepare("SELECT * FROM cuf_takeovers WHERE run_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1")
    .get(runId) as Record<string, unknown> | undefined;
  return row ? rowToTakeover(row) : undefined;
}

export function resolveTakeover(
  db: Db,
  id: string,
  fields: { operatorNotes?: string; resolvedAt?: string },
): boolean {
  const res = db
    .prepare(
      "UPDATE cuf_takeovers SET status='resolved', resolved_at=?, operator_notes=COALESCE(?, operator_notes) WHERE id=? AND status='open'",
    )
    .run(fields.resolvedAt ?? new Date().toISOString(), fields.operatorNotes ?? null, id);
  return res.changes === 1;
}

export function listTakeovers(db: Db, filter: { status?: TakeoverStatus } = {}): HumanTakeover[] {
  const sql = filter.status
    ? "SELECT * FROM cuf_takeovers WHERE status=? ORDER BY opened_at DESC"
    : "SELECT * FROM cuf_takeovers ORDER BY opened_at DESC";
  const args = filter.status ? [filter.status] : [];
  return (db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[]).map(rowToTakeover);
}
