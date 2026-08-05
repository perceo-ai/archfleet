import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { ensureSeeded } from "./init-db";
import { listWorkflows } from "./workflows-repo";

describe("ensureSeeded", () => {
  it("seeds workflows into an empty db and is idempotent", () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const first = listWorkflows(db).length;
    expect(first).toBeGreaterThan(0);
    ensureSeeded(db); // second call must not duplicate
    expect(listWorkflows(db)).toHaveLength(first);
    db.close();
  });
});
