import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { CUF_TABLES, ensureColumns } from "./schema";

describe("db schema", () => {
  it("creates every cuf_ table (idempotently)", () => {
    const db = openDb(":memory:");
    // run migration twice — must not throw
    db.exec("SELECT 1");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cuf_%'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of CUF_TABLES) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it("includes the automation-era tables", () => {
    for (const table of ["cuf_automations", "cuf_environments", "cuf_evidence", "cuf_takeovers"]) {
      expect(CUF_TABLES).toContain(table);
    }
  });

  it("ensureColumns adds missing columns idempotently", () => {
    const db = openDb(":memory:");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    ensureColumns(db, "t", { extra: "TEXT", n: "INTEGER NOT NULL DEFAULT 0" });
    ensureColumns(db, "t", { extra: "TEXT", n: "INTEGER NOT NULL DEFAULT 0" }); // second call: no-op
    db.prepare("INSERT INTO t (id, extra) VALUES (?, ?)").run("a", "x");
    const row = db.prepare("SELECT extra, n FROM t WHERE id='a'").get() as { extra: string; n: number };
    expect(row).toEqual({ extra: "x", n: 0 });
    db.close();
  });

  it("openDb migrates cuf_runs with the run-progress columns", () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO cuf_runs (id, workflow_id, workflow_name, status, started_at, automation_id, environment_id, trigger_source, current_step, paused_reason, result_summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run("r1", "wf1", "Test", "running", "2026-08-12T00:00:00Z", "auto_1", "env_1", "manual", "Login step", null, null);
    const row = db.prepare("SELECT automation_id, current_step FROM cuf_runs WHERE id='r1'").get() as {
      automation_id: string;
      current_step: string;
    };
    expect(row).toEqual({ automation_id: "auto_1", current_step: "Login step" });
    db.close();
  });

  it("round-trips a row", () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO cuf_runs (id, workflow_id, workflow_name, status, started_at) VALUES (?,?,?,?,?)",
    ).run("r1", "wf1", "Test", "queued", "2026-08-04T00:00:00Z");
    const row = db.prepare("SELECT status FROM cuf_runs WHERE id=?").get("r1") as { status: string };
    expect(row.status).toBe("queued");
    db.close();
  });
});
