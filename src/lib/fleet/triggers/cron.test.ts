import { describe, expect, it } from "vitest";
import { nextRun, parseCron } from "./cron";

const from = new Date("2026-08-04T10:15:30.000Z"); // Tuesday

describe("parseCron", () => {
  it("rejects wrong field count", () => {
    expect(() => parseCron("* * * *")).toThrow(/5 fields/);
  });
  it("parses steps and ranges", () => {
    const spec = parseCron("*/15 9-17 * * 1-5");
    expect([...spec.minute]).toEqual([0, 15, 30, 45]);
    expect(spec.hour.has(9)).toBe(true);
    expect(spec.hour.has(18)).toBe(false);
    expect(spec.dow.has(6)).toBe(false);
  });
});

describe("nextRun", () => {
  it("every minute -> next minute", () => {
    expect(nextRun("* * * * *", from)).toBe("2026-08-04T10:16:00.000Z");
  });

  it("top of next hour", () => {
    expect(nextRun("0 * * * *", from)).toBe("2026-08-04T11:00:00.000Z");
  });

  it("daily at a fixed time rolls to tomorrow when already past", () => {
    expect(nextRun("0 9 * * *", from)).toBe("2026-08-05T09:00:00.000Z");
  });

  it("*/15 gives the next quarter", () => {
    expect(nextRun("*/15 * * * *", from)).toBe("2026-08-04T10:30:00.000Z");
  });

  it("weekday restriction (Mon-Fri) skips the weekend", () => {
    // 2026-08-07 is Friday; from Friday 23:00 next weekday 09:00 is Monday 2026-08-10
    const fri = new Date("2026-08-07T23:00:00.000Z");
    expect(nextRun("0 9 * * 1-5", fri)).toBe("2026-08-10T09:00:00.000Z");
  });

  it("dom OR dow when both restricted", () => {
    // day-of-month 1 OR Sunday(0). From 2026-08-04, next is Sunday 2026-08-09.
    expect(nextRun("0 0 1 * 0", from)).toBe("2026-08-09T00:00:00.000Z");
  });
});
