// Persistence for prepared environments — the user-facing wrapper around fleet
// profiles: a reusable, ready-to-run desktop state (logins, device trust, browser).

import type { Db } from "./db";
import type { EnvironmentHealth, EnvironmentState, PreparedEnvironment } from "../types";

export function saveEnvironment(db: Db, env: PreparedEnvironment): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_environments
       (id, name, description, labels_json, profile_ref, health, snapshot_state,
        last_used_at, recovery_state, setup_notes, state_json, warm_snapshot, cloned_from,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    env.id,
    env.name,
    env.description,
    JSON.stringify(env.labels),
    env.profileRef ?? null,
    env.health,
    env.snapshotState ?? null,
    env.lastUsedAt ?? null,
    env.recoveryState ?? null,
    env.setupNotes ?? null,
    JSON.stringify(env.state ?? {}),
    env.warmSnapshot ?? null,
    env.clonedFrom ?? null,
    env.createdAt,
    env.updatedAt,
  );
}

function rowToEnvironment(row: Record<string, unknown>): PreparedEnvironment {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    labels: JSON.parse((row.labels_json as string) || "[]"),
    profileRef: (row.profile_ref as string) ?? undefined,
    health: row.health as EnvironmentHealth,
    snapshotState: (row.snapshot_state as string) ?? undefined,
    lastUsedAt: (row.last_used_at as string) ?? undefined,
    recoveryState: (row.recovery_state as string) ?? undefined,
    setupNotes: (row.setup_notes as string) ?? undefined,
    state: parseState(row.state_json as string),
    warmSnapshot: (row.warm_snapshot as string) ?? undefined,
    clonedFrom: (row.cloned_from as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function parseState(json: string | null | undefined): EnvironmentState | undefined {
  const state = JSON.parse(json || "{}") as EnvironmentState;
  return Object.keys(state).length ? state : undefined;
}

export function getEnvironment(db: Db, id: string): PreparedEnvironment | undefined {
  const row = db.prepare("SELECT * FROM cuf_environments WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function listEnvironments(db: Db): PreparedEnvironment[] {
  const rows = db.prepare("SELECT * FROM cuf_environments ORDER BY name").all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToEnvironment);
}

export function touchEnvironment(db: Db, id: string, lastUsedAt: string): void {
  db.prepare("UPDATE cuf_environments SET last_used_at=? WHERE id=?").run(lastUsedAt, id);
}

export function setEnvironmentHealth(
  db: Db,
  id: string,
  health: EnvironmentHealth,
  recoveryState?: string,
): void {
  db.prepare("UPDATE cuf_environments SET health=?, recovery_state=COALESCE(?, recovery_state) WHERE id=?").run(
    health,
    recoveryState ?? null,
    id,
  );
}
