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

CREATE TABLE IF NOT EXISTS cuf_automations (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  goal             TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT 'general',
  target           TEXT NOT NULL DEFAULT '',
  spec_markdown    TEXT NOT NULL DEFAULT '',
  workflow_id      TEXT NOT NULL,
  environment_id   TEXT,
  success_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  required_secrets TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  mfa_expectation  TEXT,
  artifact_policy  TEXT NOT NULL DEFAULT '',
  retry_policy     TEXT NOT NULL DEFAULT '',
  takeover_policy  TEXT NOT NULL DEFAULT '',
  trigger_suggestion TEXT,
  risk_notes       TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | active | disabled
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_automations_workflow ON cuf_automations(workflow_id);
CREATE INDEX IF NOT EXISTS cuf_automations_status ON cuf_automations(status);

CREATE TABLE IF NOT EXISTS cuf_environments (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  labels_json    TEXT NOT NULL DEFAULT '[]',
  profile_ref    TEXT,                            -- profile:<slug> convention
  health         TEXT NOT NULL DEFAULT 'unknown', -- ready | degraded | recovering | unknown
  snapshot_state TEXT,
  last_used_at   TEXT,
  recovery_state TEXT,
  setup_notes    TEXT,
  state_json     TEXT NOT NULL DEFAULT '{}',      -- structured EnvironmentState
  warm_snapshot  TEXT,
  cloned_from    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuf_evidence (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  automation_id TEXT,
  type          TEXT NOT NULL,                    -- screenshot | file | log | criteria_review
  artifact_ref  TEXT,
  step_id       TEXT,
  description   TEXT NOT NULL DEFAULT '',
  verdict       TEXT,                             -- pass | fail (criteria_review)
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_evidence_run ON cuf_evidence(run_id);
CREATE INDEX IF NOT EXISTS cuf_evidence_automation ON cuf_evidence(automation_id);

CREATE TABLE IF NOT EXISTS cuf_takeovers (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  environment_id   TEXT,
  vm_id            TEXT,
  reason           TEXT NOT NULL DEFAULT '',
  requested_action TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open',  -- open | resolved
  opened_at        TEXT NOT NULL,
  resolved_at      TEXT,
  operator_notes   TEXT,
  notified_at      TEXT,
  escalated_at     TEXT
);
CREATE INDEX IF NOT EXISTS cuf_takeovers_run ON cuf_takeovers(run_id);
CREATE INDEX IF NOT EXISTS cuf_takeovers_status ON cuf_takeovers(status);

-- Per-run resource telemetry, collected for later optimization surfaces (boot
-- time, warm pools, queue tuning). Backend-only: the UX stays automation-first.
CREATE TABLE IF NOT EXISTS cuf_run_metrics (
  run_id         TEXT PRIMARY KEY,
  automation_id  TEXT,
  environment_id TEXT,
  vm_id          TEXT,
  status         TEXT NOT NULL,
  queued_ms      INTEGER,
  execution_ms   INTEGER,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cuf_run_metrics_created ON cuf_run_metrics(created_at);

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
  "cuf_automations",
  "cuf_environments",
  "cuf_evidence",
  "cuf_takeovers",
  "cuf_run_metrics",
] as const;

/** Columns added after a table first shipped. `CREATE TABLE IF NOT EXISTS`
 * cannot alter existing databases, so `openDb` applies these via ensureColumns. */
export const COLUMN_MIGRATIONS: Record<string, Record<string, string>> = {
  cuf_runs: {
    automation_id: "TEXT",
    environment_id: "TEXT",
    trigger_source: "TEXT",
    current_step: "TEXT",
    paused_reason: "TEXT",
    result_summary: "TEXT",
    branch_ref: "TEXT",
    pr_ref: "TEXT",
  },
  cuf_automations: {
    evidence_checks: "TEXT NOT NULL DEFAULT '[]'",
  },
  cuf_environments: {
    state_json: "TEXT NOT NULL DEFAULT '{}'",
    warm_snapshot: "TEXT",
    cloned_from: "TEXT",
  },
  cuf_takeovers: {
    notified_at: "TEXT",
    escalated_at: "TEXT",
  },
};

type SqlRunner = {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
  exec(sql: string): void;
};

/** Add any missing columns to `table`. Idempotent — existing columns are left alone. */
export function ensureColumns(db: SqlRunner, table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, ddl] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
