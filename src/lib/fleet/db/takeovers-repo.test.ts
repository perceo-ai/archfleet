import { describe, expect, it } from "vitest";
import {
  listStaleOpenTakeovers,
  markTakeoverEscalated,
  markTakeoverNotified,
} from "./takeovers-repo";
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
    expect(getTakeover(db, "tk_1")).toMatchObject(takeover("tk_1"));
    expect(getOpenTakeoverForRun(db, "r1")?.id).toBe("tk_1");
    db.close();
  });

  it("derives an ask for rows written before asks existed", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_1"));
    // No ask stored: the requested action becomes the question, so the UI can
    // still render something rather than an empty panel.
    expect(getTakeover(db, "tk_1")?.ask).toEqual({
      kind: "acknowledge",
      question: "Complete the MFA challenge, then resume the run",
      detail: undefined,
    });
    db.close();
  });

  it("round-trips a structured ask and its answers", () => {
    const db = openDb(":memory:");
    openTakeover(db, {
      ...takeover("tk_ask"),
      ask: {
        kind: "input",
        question: "Which PO number should this be filed under?",
        fields: [{ name: "po", label: "PO number", type: "text", required: true }],
      },
    });
    const stored = getTakeover(db, "tk_ask");
    expect(stored?.ask?.kind).toBe("input");
    expect(stored?.ask?.fields?.[0].name).toBe("po");

    resolveTakeover(db, "tk_ask", { answers: { po: "PO-4821" } });
    expect(getTakeover(db, "tk_ask")?.answers).toEqual({ po: "PO-4821" });
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

  it("tracks notification and escalation timestamps", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_1"));
    markTakeoverNotified(db, "tk_1", "2026-08-12T01:00:05.000Z");
    markTakeoverNotified(db, "tk_1", "2026-08-12T09:99:99.000Z"); // second page keeps the first stamp
    markTakeoverEscalated(db, "tk_1", "2026-08-12T01:35:00.000Z");
    const got = getTakeover(db, "tk_1");
    expect(got?.notifiedAt).toBe("2026-08-12T01:00:05.000Z");
    expect(got?.escalatedAt).toBe("2026-08-12T01:35:00.000Z");
    db.close();
  });

  it("lists stale open takeovers awaiting escalation", () => {
    const db = openDb(":memory:");
    openTakeover(db, takeover("tk_old", { openedAt: "2026-08-12T01:00:00.000Z" }));
    openTakeover(db, takeover("tk_new", { runId: "r2", openedAt: "2026-08-12T03:00:00.000Z" }));
    openTakeover(db, takeover("tk_done", { runId: "r3", openedAt: "2026-08-12T00:00:00.000Z" }));
    resolveTakeover(db, "tk_done", {});
    const cutoff = "2026-08-12T02:00:00.000Z";
    expect(listStaleOpenTakeovers(db, cutoff).map((t) => t.id)).toEqual(["tk_old"]);
    markTakeoverEscalated(db, "tk_old", "2026-08-12T02:01:00.000Z");
    expect(listStaleOpenTakeovers(db, cutoff)).toEqual([]);
    db.close();
  });
});
