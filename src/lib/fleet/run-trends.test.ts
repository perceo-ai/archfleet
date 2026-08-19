import { describe, expect, it } from "vitest";
import { bucketRunsByHour, successTrend } from "./run-trends";
import type { RunSummary } from "./db/runs-repo";

const NOW = Date.parse("2026-08-12T12:00:00Z");

function run(hoursAgo: number, status: RunSummary["status"], id = `r${hoursAgo}${status}`): RunSummary {
  return {
    id,
    workflowId: "wf",
    workflowName: "wf",
    status,
    startedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  } as RunSummary;
}

describe("bucketRunsByHour", () => {
  it("puts the newest runs in the last bucket", () => {
    const buckets = bucketRunsByHour([run(0, "succeeded"), run(0, "failed")], 4, NOW);
    expect(buckets).toHaveLength(4);
    expect(buckets.at(-1)).toEqual({ total: 2, succeeded: 1, failed: 1, paused: 0 });
    expect(buckets[0].total).toBe(0);
  });

  it("orders buckets oldest first", () => {
    const buckets = bucketRunsByHour([run(3, "succeeded"), run(1, "failed")], 4, NOW);
    expect(buckets[0].succeeded).toBe(1);
    expect(buckets[2].failed).toBe(1);
  });

  it("drops runs outside the window and unparseable timestamps", () => {
    const buckets = bucketRunsByHour(
      [run(99, "succeeded"), { ...run(0, "failed"), startedAt: "nonsense" }],
      4,
      NOW,
    );
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });

  it("counts paused runs separately", () => {
    const buckets = bucketRunsByHour([run(0, "paused")], 2, NOW);
    expect(buckets.at(-1)!.paused).toBe(1);
    expect(buckets.at(-1)!.succeeded).toBe(0);
  });
});

describe("successTrend", () => {
  it("carries the last known rate through quiet hours", () => {
    const buckets = bucketRunsByHour(
      [run(3, "succeeded"), run(3, "failed"), run(0, "succeeded")],
      4,
      NOW,
    );
    expect(successTrend(buckets)).toEqual([50, 50, 50, 100]);
  });

  it("starts optimistic when nothing has finished", () => {
    expect(successTrend(bucketRunsByHour([], 3, NOW))).toEqual([100, 100, 100]);
  });
});
