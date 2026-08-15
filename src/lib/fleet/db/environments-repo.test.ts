import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  getEnvironment,
  listEnvironments,
  saveEnvironment,
  setEnvironmentHealth,
  touchEnvironment,
} from "./environments-repo";
import type { PreparedEnvironment } from "../types";

function environment(id: string, overrides: Partial<PreparedEnvironment> = {}): PreparedEnvironment {
  return {
    id,
    name: "Portal (logged in)",
    description: "Chrome with a trusted, logged-in portal session",
    labels: ["linux-desktop", "browser", "profile:portal"],
    profileRef: "portal",
    health: "ready",
    snapshotState: "golden-warm",
    lastUsedAt: undefined,
    recoveryState: undefined,
    setupNotes: "Log in manually once, then capture",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("environments repo", () => {
  it("round-trips an environment", () => {
    const db = openDb(":memory:");
    saveEnvironment(db, environment("env_1"));
    expect(getEnvironment(db, "env_1")).toEqual(environment("env_1"));
    db.close();
  });

  it("round-trips structured state, warm snapshot, and clone metadata", () => {
    const db = openDb(":memory:");
    const env = environment("env_1", {
      state: {
        browser: "Chromium with saved portal session",
        accounts: [{ site: "portal.example.com", username: "ops@example.com", secretRef: "portal_password", mfa: "device-trusted, no prompt" }],
        deviceTrust: ["portal.example.com"],
        extensions: ["uBlock Origin"],
        files: ["template.xlsx"],
        secretRefs: ["portal_password"],
        mfaExpectations: ["email OTP on fresh sessions"],
      },
      warmSnapshot: "portal-warm-3",
      clonedFrom: "env_golden",
    });
    saveEnvironment(db, env);
    expect(getEnvironment(db, "env_1")).toEqual(env);
    // Empty state stays undefined, not {}.
    saveEnvironment(db, environment("env_2"));
    expect(getEnvironment(db, "env_2")?.state).toBeUndefined();
    db.close();
  });

  it("lists ordered by name and upserts", () => {
    const db = openDb(":memory:");
    saveEnvironment(db, environment("env_b", { name: "Zeta" }));
    saveEnvironment(db, environment("env_a", { name: "Alpha" }));
    saveEnvironment(db, environment("env_b", { name: "Beta" }));
    expect(listEnvironments(db).map((e) => e.name)).toEqual(["Alpha", "Beta"]);
    db.close();
  });

  it("touches last used and updates health", () => {
    const db = openDb(":memory:");
    saveEnvironment(db, environment("env_1"));
    touchEnvironment(db, "env_1", "2026-08-12T05:00:00.000Z");
    expect(getEnvironment(db, "env_1")?.lastUsedAt).toBe("2026-08-12T05:00:00.000Z");
    setEnvironmentHealth(db, "env_1", "recovering", "reverting to golden snapshot");
    const got = getEnvironment(db, "env_1");
    expect(got?.health).toBe("recovering");
    expect(got?.recoveryState).toBe("reverting to golden snapshot");
    db.close();
  });
});
