import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  getOpenTakeoverForRun,
  getTakeover,
  listTakeovers,
  openTakeover,
  resolveTakeover,
} from "./takeovers-repo";
import type { HumanTakeover } from "../types";

function takeover(id: string, overrides: Partial<HumanTakeover> = {}): HumanTakeover {
  return {
    id,
    runId: "r1",
    environmentId: "env_1",
    vmId: "vm1",
    reason: "MFA prompt on portal login",
    requestedAction: "Complete the MFA challenge, then resume the run",
    status: "open",
    openedAt: "2026-08-12T01:00:00.000Z",
    ...overrides,
  };
}

describe("takeovers repo", () => {
  it("opens and reads back a takeover", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_1"));
    expect(getTakeover(db, "tk_1")).toEqual(takeover("tk_1"));
    expect(getOpenTakeoverForRun(db, "r1")?.id).toBe("tk_1");
    db.close();
  });

  it("resolves with operator notes", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_1"));
    expect(
      resolveTakeover(db, "tk_1", { operatorNotes: "Approved MFA on phone", resolvedAt: "2026-08-12T01:05:00.000Z" }),
    ).toBe(true);
    const got = getTakeover(db, "tk_1");
    expect(got?.status).toBe("resolved");
    expect(got?.operatorNotes).toBe("Approved MFA on phone");
    expect(got?.resolvedAt).toBe("2026-08-12T01:05:00.000Z");
    expect(getOpenTakeoverForRun(db, "r1")).toBeUndefined();
    expect(resolveTakeover(db, "tk_1", {})).toBe(false); // already resolved
    db.close();
  });

  it("lists filtered by status, newest first", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_1", { openedAt: "2026-08-12T01:00:00Z" }));
    openTakeover(db, takeover("tk_2", { runId: "r2", openedAt: "2026-08-12T02:00:00Z" }));
    resolveTakeover(db, "tk_1", {});
    expect(listTakeovers(db).map((t) => t.id)).toEqual(["tk_2", "tk_1"]);
    expect(listTakeovers(db, { status: "open" }).map((t) => t.id)).toEqual(["tk_2"]);
    db.close();
  });
});
