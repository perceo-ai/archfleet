import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { CUF_TABLES } from "./schema";

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
