// Secret persistence. Values are AES-256-GCM encrypted before they touch the db
// and decrypted only when a run needs them. The key lives in env, never in the db.

import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { decryptSecret, encryptSecret, loadKey } from "./crypto";
import type { Secret } from "../types";

export type UpsertSecretInput = {
  id?: string;
  name: string;
  scope: Secret["scope"];
  scopeId?: string;
  value: string;
  now?: string;
};

/** Encrypt + store a secret. Returns its id. */
export function saveSecret(db: Db, input: UpsertSecretInput, key = loadKey()): string {
  const id = input.id ?? `sec_${randomBytes(6).toString("hex")}`;
  const now = input.now ?? new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO cuf_secrets
       (id, name, scope_type, scope_id, encrypted_value, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, input.name, input.scope, input.scopeId ?? null, encryptSecret(input.value, key), now, now);
  return id;
}

/** Decrypt every stored secret into the in-memory Secret shape the runtime uses.
 * Call only inside the server process, right before injecting into a node. */
export function loadSecrets(db: Db, key = loadKey()): Secret[] {
  const rows = db.prepare("SELECT * FROM cuf_secrets ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    scope: row.scope_type as Secret["scope"],
    value: decryptSecret(row.encrypted_value as string, key),
  }));
}

/** Metadata for display — names + scopes, never values. */
export function listSecretMeta(db: Db): { id: string; name: string; scope: string }[] {
  const rows = db
    .prepare("SELECT id, name, scope_type FROM cuf_secrets ORDER BY name")
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, scope: r.scope_type as string }));
}
