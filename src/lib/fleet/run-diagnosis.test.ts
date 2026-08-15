import { describe, expect, it } from "vitest";
import { diagnoseFailure } from "./run-diagnosis";
import type { RunEvent, WorkflowRun } from "./types";

function failedRun(messages: { level: RunEvent["level"]; message: string }[], currentStep?: string): WorkflowRun {
  return {
    id: "r1",
    workflowId: "wf1",
    workflowName: "Portal login check",
    status: "failed",
    startedAt: "2026-08-12T01:00:00Z",
    currentStep,
    events: messages.map((m, i) => ({ id: `e${i}`, level: m.level, message: m.message, timestamp: "t" })),
  };
}

describe("diagnoseFailure", () => {
  it("recognizes connection problems", () => {
    const d = diagnoseFailure(
      failedRun([{ level: "error", message: 'Node "Log in" transport error: Error: connect ECONNREFUSED' }]),
    );
    expect(d.confident).toBe(true);
    expect(d.cause).toMatch(/could not reach/);
    expect(d.suggestion).toMatch(/Recover the environment/);
  });

  it("recognizes exhausted retries and login failures", () => {
    expect(
      diagnoseFailure(failedRun([{ level: "warn", message: 'Node "Retry login": retries exhausted.' }])).cause,
    ).toMatch(/after all configured retries/);
    expect(
      diagnoseFailure(failedRun([{ level: "warn", message: 'Node "Sign in" failed (wrong password page) after 4 steps.' }]))
        .suggestion,
    ).toMatch(/takeover point|secrets/);
  });

  it("recognizes failed API calls", () => {
    const d = diagnoseFailure(
      failedRun([{ level: "warn", message: "API GET https://portal.example.test/report -> 503." }]),
    );
    expect(d.confident).toBe(true);
    expect(d.cause).toMatch(/API call returned an error/);
  });

  it("uses the most recent matching error, not the first", () => {
    const d = diagnoseFailure(
      failedRun([
        { level: "warn", message: "API GET https://x -> 500." },
        { level: "error", message: 'Node "Download" timed_out waiting for page.' },
      ]),
    );
    expect(d.cause).toMatch(/timed out/);
  });

  it("falls back honestly when nothing matches", () => {
    const d = diagnoseFailure(failedRun([{ level: "error", message: "something odd" }], "Download report"));
    expect(d.confident).toBe(false);
    expect(d.cause).toContain("Download report");
  });
});
