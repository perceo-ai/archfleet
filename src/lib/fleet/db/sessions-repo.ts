// Persistence for computer-use sessions. Sessions outlive a single request (an
// agent opens one, drives it over many calls, closes it), so they cannot live in
// process memory the way profile operations do.

import type { Db } from "./db";
import type { Session, SessionMode, SessionStatus } from "../sessions";

export function saveSession(db: Db, session: Session): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_sessions
       (id, environment_id, environment_name, mode, status, task, run_id, vm_id, domain,
        opened_by, expires_at, opened_at, updated_at, closed_at, result_summary, captured_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    session.id,
    session.environmentId,
    session.environmentName ?? null,
    session.mode,
    session.status,
    session.task ?? null,
    session.runId ?? null,
    session.vmId ?? null,
    session.domain ?? null,
    session.openedBy ?? null,
    session.expiresAt,
    session.openedAt,
    session.updatedAt,
    session.closedAt ?? null,
    session.resultSummary ?? null,
    session.capturedAt ?? null,
  );
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    environmentId: row.environment_id as string,
    environmentName: (row.environment_name as string) ?? undefined,
    mode: row.mode as SessionMode,
    status: row.status as SessionStatus,
    task: (row.task as string) ?? undefined,
    runId: (row.run_id as string) ?? undefined,
    vmId: (row.vm_id as string) ?? undefined,
    domain: (row.domain as string) ?? undefined,
    openedBy: (row.opened_by as string) ?? undefined,
    expiresAt: row.expires_at as string,
    openedAt: row.opened_at as string,
    updatedAt: row.updated_at as string,
    closedAt: (row.closed_at as string) ?? undefined,
    resultSummary: (row.result_summary as string) ?? undefined,
    capturedAt: (row.captured_at as string) ?? undefined,
  };
}

export function getSession(db: Db, id: string): Session | undefined {
  const row = db.prepare("SELECT * FROM cuf_sessions WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToSession(row) : undefined;
}

export function listSessions(
  db: Db,
  opts: { open?: boolean; environmentId?: string; limit?: number } = {},
): Session[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.open) where.push("status NOT IN ('closed','failed')");
  if (opts.environmentId) {
    where.push("environment_id=?");
    args.push(opts.environmentId);
  }
  const sql = `SELECT * FROM cuf_sessions${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY opened_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...args, opts.limit ?? 50) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/** Patch a live session. Never resurrects a settled one — a late `act` from an
 * agent that did not notice its session ended must not reopen it. */
export function updateSession(
  db: Db,
  id: string,
  patch: Partial<Pick<Session, "status" | "vmId" | "domain" | "runId" | "expiresAt" | "resultSummary" | "closedAt" | "capturedAt">>,
  now: string,
): Session | undefined {
  const current = getSession(db, id);
  if (!current) return undefined;
  saveSession(db, { ...current, ...patch, updatedAt: now });
  return getSession(db, id);
}

/** Sessions whose holder walked away. The worker closes these and hands the
 * desktops back. */
export function listExpiredSessions(db: Db, now: string): Session[] {
  const rows = db
    .prepare(
      "SELECT * FROM cuf_sessions WHERE status NOT IN ('closed','failed') AND expires_at <= ? ORDER BY expires_at",
    )
    .all(now) as Record<string, unknown>[];
  return rows.map(rowToSession);
}
