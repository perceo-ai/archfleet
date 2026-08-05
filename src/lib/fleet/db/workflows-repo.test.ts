import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { getWorkflow, listWorkflows, saveWorkflow } from "./workflows-repo";
import { seedFleetState } from "../seed";

describe("workflows repo", () => {
  it("round-trips the seed workflow graph", () => {
    const db = openDb(":memory:");
    const wf = seedFleetState().workflows[0];
    saveWorkflow(db, wf, "2026-08-04T00:00:00Z");
    const got = getWorkflow(db, wf.id);
    expect(got?.name).toBe(wf.name);
    expect(got?.nodes.length).toBe(wf.nodes.length);
    expect(got?.edges.length).toBe(wf.edges.length);
    expect(got?.triggerKinds).toEqual(wf.triggerKinds);
    db.close();
  });

  it("upsert preserves created_at but updates name", () => {
    const db = openDb(":memory:");
    const wf = seedFleetState().workflows[0];
    saveWorkflow(db, wf, "2026-08-01T00:00:00Z");
    saveWorkflow(db, { ...wf, name: "Renamed" }, "2026-08-05T00:00:00Z");
    const row = db.prepare("SELECT created_at, updated_at, name FROM cuf_workflows WHERE id=?").get(wf.id) as {
      created_at: string;
      updated_at: string;
      name: string;
    };
    expect(row.created_at).toBe("2026-08-01T00:00:00Z");
    expect(row.updated_at).toBe("2026-08-05T00:00:00Z");
    expect(row.name).toBe("Renamed");
    expect(listWorkflows(db)).toHaveLength(1);
    db.close();
  });
});
