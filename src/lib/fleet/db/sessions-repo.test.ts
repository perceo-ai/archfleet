import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { getSession, listExpiredSessions, listSessions, saveSession, updateSession } from "./sessions-repo";
import type { Session } from "../sessions";

const T0 = "2026-08-20T10:00:00.000Z";
const T1 = "2026-08-20T10:30:00.000Z";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "sess_1",
    environmentId: "env_portal",
    environmentName: "Portal — logged in",
    mode: "lease",
    status: "active",
    expiresAt: T1,
    openedAt: T0,
    updatedAt: T0,
    ...over,
  };
}

describe("sessions repo", () => {
  it("round-trips a session", () => {
    const db = openDb(":memory:");
    saveSession(db, session({ task: "book a room", runId: "run_1", openedBy: "hermes" }));
    const got = getSession(db, "sess_1");
    expect(got?.task).toBe("book a room");
    expect(got?.runId).toBe("run_1");
    expect(got?.openedBy).toBe("hermes");
    db.close();
  });

  it("filters to open sessions and by environment", () => {
    const db = openDb(":memory:");
    saveSession(db, session({ id: "a" }));
    saveSession(db, session({ id: "b", status: "closed" }));
    saveSession(db, session({ id: "c", environmentId: "env_other" }));

    expect(listSessions(db, { open: true }).map((s) => s.id).sort()).toEqual(["a", "c"]);
    expect(listSessions(db, { environmentId: "env_other" }).map((s) => s.id)).toEqual(["c"]);
    db.close();
  });

  it("lists only sessions whose hold has lapsed", () => {
    const db = openDb(":memory:");
    saveSession(db, session({ id: "live", expiresAt: T1 }));
    saveSession(db, session({ id: "lapsed", expiresAt: T0 }));
    saveSession(db, session({ id: "settled", expiresAt: T0, status: "closed" }));

    // A closed session's desktop is already back — sweeping it again is noise.
    expect(listExpiredSessions(db, "2026-08-20T10:15:00.000Z").map((s) => s.id)).toEqual(["lapsed"]);
    db.close();
  });

  // A settled session is immutable. An `act` already in flight when the session
  // was closed would otherwise write `active` back over it, leaving an
  // apparently usable session whose desktop has been released — and possibly
  // re-leased to somebody else.
  it("refuses to reopen a settled session", () => {
    const db = openDb(":memory:");
    saveSession(db, session({ status: "closed", closedAt: T1 }));

    const after = updateSession(db, "sess_1", { status: "active", expiresAt: "2999-01-01T00:00:00.000Z" }, T1);
    expect(after?.status).toBe("closed");
    expect(getSession(db, "sess_1")?.expiresAt).toBe(T1);
    db.close();
  });

  it("refuses to reopen a failed session too", () => {
    const db = openDb(":memory:");
    saveSession(db, session({ status: "failed", resultSummary: "lease lost" }));
    expect(updateSession(db, "sess_1", { status: "active" }, T1)?.status).toBe("failed");
    db.close();
  });

  it("still patches a live session", () => {
    const db = openDb(":memory:");
    saveSession(db, session());
    const after = updateSession(db, "sess_1", { status: "closed", closedAt: T1 }, T1);
    expect(after?.status).toBe("closed");
    expect(after?.closedAt).toBe(T1);
    db.close();
  });

  it("returns undefined for a session that never existed", () => {
    const db = openDb(":memory:");
    expect(updateSession(db, "nope", { status: "closed" }, T1)).toBeUndefined();
    db.close();
  });
});
