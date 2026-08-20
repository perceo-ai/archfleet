import { describe, expect, it } from "vitest";
import { groupFailures, normalizeCause } from "./failure-groups";
import type { RunSummary } from "./db/runs-repo";

function run(over: Partial<RunSummary> & { id: string }): RunSummary {
  return {
    workflowId: "wf",
    workflowName: "wf",
    status: "failed",
    startedAt: "2026-08-12T00:00:00Z",
    ...over,
  } as RunSummary;
}

describe("normalizeCause", () => {
  it("collapses run-specific ids and counts so equivalent failures match", () => {
    expect(normalizeCause('failed after 3 tries (12s) on run_ab12cd')).toBe(
      "failed after #n tries (#n) on #id",
    );
  });
});

describe("groupFailures", () => {
  it("groups runs that failed the same way at the same step", () => {
    const groups = groupFailures([
      run({ id: "r1", currentStep: "Download CSV", resultSummary: "failed after 3 tries", automationId: "a1" }),
      run({ id: "r2", currentStep: "Download CSV", resultSummary: "failed after 7 tries", automationId: "a2", startedAt: "2026-08-12T02:00:00Z" }),
      run({ id: "r3", currentStep: "Sign in", resultSummary: "transport error", automationId: "a1" }),
      run({ id: "r4", status: "succeeded", resultSummary: "fine" }),
    ]);

    expect(groups).toHaveLength(2);
    // biggest blast radius first
    expect(groups[0].runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(groups[0].automationIds).toEqual(["a1", "a2"]);
    expect(groups[0].step).toBe("Download CSV");
    // the headline is the newest run's wording
    expect(groups[0].cause).toBe("failed after 7 tries");
    expect(groups[0].firstSeen).toBe("2026-08-12T00:00:00Z");
    expect(groups[0].lastSeen).toBe("2026-08-12T02:00:00Z");
  });

  it("keeps genuinely different causes apart and ignores non-failures", () => {
    const groups = groupFailures([
      run({ id: "r1", currentStep: "Download CSV", resultSummary: "element not found" }),
      run({ id: "r2", currentStep: "Download CSV", resultSummary: "session expired" }),
      run({ id: "r3", status: "running" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.runs.length === 1)).toBe(true);
  });

  it("still groups failures with no recorded reason", () => {
    const groups = groupFailures([run({ id: "r1" }), run({ id: "r2" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cause).toBe("Failed without a recorded reason.");
  });
});
