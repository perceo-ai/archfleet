// Trigger persistence + lookup. Webhook tokens are stored only as a sha256 hash;
// the plaintext token is returned once at creation and never persisted.

import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/db";
import type { Trigger, TriggerKind } from "../types";
import { nextRun } from "./cron";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreateTriggerInput = {
  id?: string;
  workflowId: string;
  type: TriggerKind;
  config?: Record<string, unknown>;
  enabled?: boolean;
  cron?: string;
  now?: string; // ISO, for computing first schedule fire
};

export type CreateTriggerResult = {
  trigger: Trigger;
  /** Present only for webhook triggers — show once, then it's unrecoverable. */
  webhookToken?: string;
};

function rowToTrigger(row: Record<string, unknown>): Trigger {
  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    type: row.type as TriggerKind,
    config: JSON.parse((row.config_json as string) || "{}"),
    enabled: Boolean(row.enabled),
    cron: (row.cron as string) ?? undefined,
    nextRunAt: (row.next_run_at as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

export function createTrigger(db: Db, input: CreateTriggerInput): CreateTriggerResult {
  const id = input.id ?? `trg_${randomBytes(6).toString("hex")}`;
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;

  let tokenHash: string | null = null;
  let webhookToken: string | undefined;
  if (input.type === "webhook") {
    webhookToken = randomBytes(24).toString("hex");
    tokenHash = hashToken(webhookToken);
  }

  let nextRunAt: string | null = null;
  if (input.type === "schedule") {
    if (!input.cron) throw new Error("schedule trigger requires a cron expression");
    nextRunAt = nextRun(input.cron, new Date(now));
  }

  db.prepare(
    `INSERT INTO cuf_triggers
       (id, workflow_id, type, config_json, enabled, secret_token_hash, cron, next_run_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.workflowId,
    input.type,
    JSON.stringify(input.config ?? {}),
    enabled ? 1 : 0,
    tokenHash,
    input.cron ?? null,
    nextRunAt,
    now,
  );

  return { trigger: getTrigger(db, id)!, webhookToken };
}

export function getTrigger(db: Db, id: string): Trigger | undefined {
  const row = db.prepare("SELECT * FROM cuf_triggers WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTrigger(row) : undefined;
}

export function listTriggers(db: Db, workflowId?: string): Trigger[] {
  const rows = workflowId
    ? (db.prepare("SELECT * FROM cuf_triggers WHERE workflow_id=? ORDER BY created_at").all(workflowId) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM cuf_triggers ORDER BY created_at").all() as Record<string, unknown>[]);
  return rows.map(rowToTrigger);
}

/** Enabled webhook trigger whose token matches, or undefined. */
export function findByWebhookToken(db: Db, token: string): Trigger | undefined {
  const row = db
    .prepare("SELECT * FROM cuf_triggers WHERE type='webhook' AND enabled=1 AND secret_token_hash=?")
    .get(hashToken(token)) as Record<string, unknown> | undefined;
  return row ? rowToTrigger(row) : undefined;
}

/** Enabled schedule triggers due at or before `nowIso`. */
export function dueScheduleTriggers(db: Db, nowIso: string): Trigger[] {
  const rows = db
    .prepare(
      "SELECT * FROM cuf_triggers WHERE type='schedule' AND enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at",
    )
    .all(nowIso) as Record<string, unknown>[];
  return rows.map(rowToTrigger);
}

export function updateNextRun(db: Db, id: string, nextRunAt: string | null): void {
  db.prepare("UPDATE cuf_triggers SET next_run_at=? WHERE id=?").run(nextRunAt, id);
}

export function setEnabled(db: Db, id: string, enabled: boolean): void {
  db.prepare("UPDATE cuf_triggers SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
}
