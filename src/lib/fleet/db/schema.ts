// SQLite schema for the fleet manager. Tables are prefixed `cuf_` so this can
// live inside a single shared Perceo SQLite database without colliding with other
// components (e.g. Archductor). All statements are idempotent (IF NOT EXISTS).

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cuf_workflows (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  graph_json    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuf_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  status        TEXT NOT NULL,
  vm_id         TEXT,
  trigger_id    TEXT,
  params_json   TEXT NOT NULL DEFAULT '{}',
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS cuf_runs_workflow ON cuf_runs(workflow_id);
CREATE INDEX IF NOT EXISTS cuf_runs_started ON cuf_runs(started_at);

CREATE TABLE IF NOT EXISTS cuf_events (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  node_id    TEXT,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  seq        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_events_run ON cuf_events(run_id, seq);

CREATE TABLE IF NOT EXISTS cuf_artifacts (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  node_id       TEXT,
  type          TEXT NOT NULL,
  path          TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_artifacts_run ON cuf_artifacts(run_id);

CREATE TABLE IF NOT EXISTS cuf_triggers (
  id                TEXT PRIMARY KEY,
  workflow_id       TEXT NOT NULL,
  type              TEXT NOT NULL,               -- manual | schedule | webhook
  config_json       TEXT NOT NULL DEFAULT '{}',
  enabled           INTEGER NOT NULL DEFAULT 1,
  secret_token_hash TEXT,                        -- for webhook triggers
  cron              TEXT,                        -- for schedule triggers
  next_run_at       TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_triggers_workflow ON cuf_triggers(workflow_id);
CREATE INDEX IF NOT EXISTS cuf_triggers_due ON cuf_triggers(type, enabled, next_run_at);

CREATE TABLE IF NOT EXISTS cuf_vms (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL,
  labels_json    TEXT NOT NULL DEFAULT '[]',
  domain         TEXT,
  warm_snapshot  TEXT,
  xrdp_host      TEXT,
  xrdp_port      INTEGER,
  ssh_host       TEXT,
  ssh_port       INTEGER,
  username       TEXT,
  last_health_at TEXT
);

CREATE TABLE IF NOT EXISTS cuf_secrets (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope_type      TEXT NOT NULL,
  scope_id        TEXT,
  encrypted_value TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuf_params (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id   TEXT,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuf_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_users_username ON cuf_users(username);
`;

/** Table names created by the schema — used by tests to assert migration. */
export const CUF_TABLES = [
  "cuf_workflows",
  "cuf_runs",
  "cuf_events",
  "cuf_artifacts",
  "cuf_triggers",
  "cuf_vms",
  "cuf_secrets",
  "cuf_params",
  "cuf_users",
] as const;
