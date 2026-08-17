// SQLite access via the built-in node:sqlite (Node 22+, synchronous). One shared
// database file — path from CUF_DB_PATH so it can point at the whole-stack Perceo
// DB. `openDb(path)` is used by tests with a tmp/':memory:' file; `getDb()` is the
// app singleton.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { COLUMN_MIGRATIONS, SCHEMA_SQL, ensureColumns } from "./schema";
import { ensureSeeded } from "./init-db";

export type Db = DatabaseSync;

export function defaultDbPath(): string {
  return process.env.CUF_DB_PATH ?? `${process.cwd()}/data/fleet.db`;
}

/** Open a database at `path`, applying the (idempotent) schema. */
export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    ensureColumns(db, table, columns);
  }
  return db;
}

let singleton: Db | undefined;

/** Process-wide database singleton at the configured path. */
export function getDb(): Db {
  if (!singleton) {
    singleton = openDb(defaultDbPath());
    ensureSeeded(singleton);
  }
  return singleton;
}
