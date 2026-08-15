import { describe, expect, it } from "vitest";
import { evaluateEvidenceChecks, parseEvidenceChecks, type EvidenceCheck } from "./evidence-checks";
import type { WorkflowRun } from "./types";

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "r1",
    workflowId: "wf1",
    workflowName: "Portal login check",
    status: "succeeded",
    startedAt: "2026-08-12T01:00:00Z",
    events: [
      { id: "e1", level: "info", message: 'Node "Log in" succeeded (dashboard loaded) after 3 steps.', timestamp: "t" },
      { id: "e2", level: "info", message: "API GET https://portal.example.test/health -> 200.", timestamp: "t" },
    ],
    artifacts: [
      { id: "a1", runId: "r1", type: "file", path: "/data/artifacts/r1/shot.png", createdAt: "t" },
      { id: "a2", runId: "r1", type: "file", path: "/data/artifacts/r1/report.csv", createdAt: "t" },
    ],
    ...overrides,
  };
}

describe("evaluateEvidenceChecks", () => {
  it("text_found passes when any event contains the text", () => {
    const checks: EvidenceCheck[] = [
      { type: "text_found", value: "dashboard loaded" },
      { type: "text_found", value: "error 500" },
    ];
    const results = evaluateEvidenceChecks(checks, run());
    expect(results[0].verdict).toBe("pass");
    expect(results[1].verdict).toBe("fail");
  });

  it("url_reached passes on a 2xx api_call event for that url", () => {
    const checks: EvidenceCheck[] = [
      { type: "url_reached", value: "https://portal.example.test/health" },
      { type: "url_reached", value: "https://portal.example.test/missing" },
    ];
    const results = evaluateEvidenceChecks(checks, run());
    expect(results[0].verdict).toBe("pass");
    expect(results[1].verdict).toBe("fail");
  });

  it("screenshot_captured and file_downloaded inspect artifacts", () => {
    const checks: EvidenceCheck[] = [
      { type: "screenshot_captured" },
      { type: "file_downloaded", value: ".csv" },
      { type: "file_downloaded", value: ".pdf" },
    ];
    const results = evaluateEvidenceChecks(checks, run());
    expect(results.map((r) => r.verdict)).toEqual(["pass", "pass", "fail"]);

    const bare = evaluateEvidenceChecks([{ type: "screenshot_captured" }], run({ artifacts: [] }));
    expect(bare[0].verdict).toBe("fail");
  });

  it("element_visible passes when the agent reported seeing the element", () => {
    const results = evaluateEvidenceChecks(
      [
        { type: "element_visible", value: "dashboard" },
        { type: "element_visible", value: "logout button" },
      ],
      run(),
    );
    expect(results.map((r) => r.verdict)).toEqual(["pass", "fail"]);
  });

  it("form_submitted needs a submit report in the events", () => {
    const submitted = run({
      events: [
        { id: "e1", level: "info", message: 'Node "Fill form" succeeded (submitted the request form, confirmation shown) after 4 steps.', timestamp: "t" },
      ],
    });
    expect(evaluateEvidenceChecks([{ type: "form_submitted" }], submitted)[0].verdict).toBe("pass");
    expect(evaluateEvidenceChecks([{ type: "form_submitted", value: "request form" }], submitted)[0].verdict).toBe("pass");
    expect(evaluateEvidenceChecks([{ type: "form_submitted", value: "billing form" }], submitted)[0].verdict).toBe("fail");
    expect(evaluateEvidenceChecks([{ type: "form_submitted" }], run())[0].verdict).toBe("fail");
  });

  it("email_received passes on a fetched OTP or matching event text", () => {
    const otp = run({
      events: [
        { id: "e1", level: "info", message: 'Node "Get code" : fetched OTP into param "otp".', timestamp: "t" },
      ],
    });
    expect(evaluateEvidenceChecks([{ type: "email_received" }], otp)[0].verdict).toBe("pass");
    expect(evaluateEvidenceChecks([{ type: "email_received" }], run())[0].verdict).toBe("fail");
  });

  it("output_extracted looks for a non-image artifact or an extraction report", () => {
    expect(evaluateEvidenceChecks([{ type: "output_extracted", value: "report" }], run())[0].verdict).toBe("pass");
    expect(evaluateEvidenceChecks([{ type: "output_extracted", value: "invoices" }], run())[0].verdict).toBe("fail");
    expect(
      evaluateEvidenceChecks([{ type: "output_extracted" }], run({ artifacts: [] }))[0].verdict,
    ).toBe("fail");
  });

  it("visual_state_changed needs at least two distinct screenshots", () => {
    const two = run({
      artifacts: [
        { id: "a1", runId: "r1", type: "file", path: "/a/before.png", createdAt: "t" },
        { id: "a2", runId: "r1", type: "file", path: "/a/after.png", createdAt: "t" },
      ],
    });
    expect(evaluateEvidenceChecks([{ type: "visual_state_changed" }], two)[0].verdict).toBe("pass");
    expect(evaluateEvidenceChecks([{ type: "visual_state_changed" }], run())[0].verdict).toBe("fail");
  });
});

describe("parseEvidenceChecks", () => {
  it("parses 'type: value' lines, ignoring blanks and unknown types", () => {
    const parsed = parseEvidenceChecks(
      "text_found: dashboard loaded\n\nurl_reached: https://x\nscreenshot_captured\nbogus_type: nope",
    );
    expect(parsed).toEqual([
      { type: "text_found", value: "dashboard loaded" },
      { type: "url_reached", value: "https://x" },
      { type: "screenshot_captured" },
    ]);
  });

  it("round-trips through formatEvidenceChecks", async () => {
    const { formatEvidenceChecks } = await import("./evidence-checks");
    const checks: EvidenceCheck[] = [
      { type: "text_found", value: "ok" },
      { type: "screenshot_captured" },
    ];
    expect(parseEvidenceChecks(formatEvidenceChecks(checks))).toEqual(checks);
  });
});
