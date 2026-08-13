// Persistence for human takeover requests: why a run paused, what the operator
// should do, and how it was resolved. The paused VM stays held so the human lands
// on the same desktop state.

import type { Db } from "./db";
import type { HumanTakeover, TakeoverStatus } from "../types";

export function openTakeover(db: Db, t: HumanTakeover): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_takeovers
       (id, run_id, environment_id, vm_id, reason, requested_action, status, opened_at, resolved_at, operator_notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
  };
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
