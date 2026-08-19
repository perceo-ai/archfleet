import { describe, expect, it } from "vitest";
import { setupChecks, summarizeSetup, type SetupInput } from "./setup-status";

const bare: SetupInput = {
  authConfigured: false,
  secretStoreReady: false,
  plannerConfigured: false,
  groundingConfigured: false,
  desktopCount: 0,
  environmentCount: 0,
  notifyConfigured: false,
  automationCount: 0,
  runCount: 0,
};

const ready: SetupInput = {
  authConfigured: true,
  secretStoreReady: true,
  plannerConfigured: true,
  groundingConfigured: true,
  desktopCount: 4,
  environmentCount: 2,
  notifyConfigured: true,
  automationCount: 3,
  runCount: 22,
};

describe("setupChecks", () => {
  it("says nothing is done on a fresh install, and everything is on a live one", () => {
    expect(setupChecks(bare).every((c) => !c.done)).toBe(true);
    expect(setupChecks(ready).every((c) => c.done)).toBe(true);
  });

  it("treats locking the instance down and the secret store as blocking", () => {
    const required = setupChecks(bare).filter((c) => c.required).map((c) => c.id);
    expect(required).toEqual(["auth", "secrets"]);
  });

  it("counts what exists rather than repeating the instructions", () => {
    const detail = (id: string) => setupChecks(ready).find((c) => c.id === id)!.detail;
    expect(detail("desktops")).toContain("4 desktops");
    expect(detail("environment")).toContain("2 ready");
    expect(detail("first-automation")).toContain("3 built, 22 runs");
  });

  it("uses the singular when there is one desktop", () => {
    const one = setupChecks({ ...ready, desktopCount: 1 }).find((c) => c.id === "desktops")!;
    expect(one.detail).toContain("1 desktop in the fleet");
  });

  it("points every unfinished check at somewhere that fixes it", () => {
    for (const check of setupChecks(bare)) {
      expect(check.href.startsWith("/")).toBe(true);
      expect(check.action.length).toBeGreaterThan(0);
      expect(check.unlocks.length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeSetup", () => {
  it("is not ready until the blocking checks pass", () => {
    expect(summarizeSetup(bare).ready).toBe(false);
    expect(summarizeSetup({ ...bare, authConfigured: true }).ready).toBe(false);
    expect(summarizeSetup({ ...bare, authConfigured: true, secretStoreReady: true }).ready).toBe(true);
  });

  it("counts progress", () => {
    const summary = summarizeSetup({ ...bare, authConfigured: true, notifyConfigured: true });
    expect(summary.done).toBe(2);
    expect(summary.total).toBe(8);
  });

  it("knows a fresh install from a working one", () => {
    expect(summarizeSetup(bare).fresh).toBe(true);
    expect(summarizeSetup(ready).fresh).toBe(false);
    // an install with automations but no runs yet is still not "fresh" enough to
    // take over the inbox
    expect(summarizeSetup({ ...bare, automationCount: 1 }).fresh).toBe(false);
  });
});
